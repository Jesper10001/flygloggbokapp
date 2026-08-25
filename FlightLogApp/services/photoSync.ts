// Foto-synk: matchar bilder/videor ur användarens fotobibliotek mot loggade flygningar
// baserat på tidsstämplar. Allt sker lokalt — inga bilder lämnar enheten, och endast
// referensen (localIdentifier) sparas (aldrig filen).
//
// OBS: expo-media-library är en NATIVE-modul. Den lazy-laddas (require i funktion) så att
// importen inte kraschar i builds som saknar den — funktionen degraderar tills nästa dev build.
import type * as ML from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { getFlights, getSetting, setSetting } from '../db/flights';
import { buildInstants } from '../utils/flightTime';
import type { Flight } from '../types/flight';

const WINDOW_MS = 30 * 60 * 1000;           // ±30 min buffertfönster
const LAST_SYNC_KEY = 'last_photo_sync';

export type PhotoPermission = 'full' | 'limited' | 'denied' | 'undetermined' | 'unavailable';
export type FlightMatch = { flight: Flight; assets: ML.Asset[] };

// Lazy-laddad native-modul (null om den inte finns i denna build).
let _ml: typeof import('expo-media-library') | null | undefined;
function ml(): typeof import('expo-media-library') | null {
  if (_ml === undefined) { try { _ml = require('expo-media-library'); } catch { _ml = null; } }
  return _ml ?? null;
}
export function isPhotoSyncAvailable(): boolean { return ml() !== null; }

// creationTime kan vara ms (nyare) eller sekunder (äldre plattformar) → normalisera till ms.
function ctMs(a: ML.Asset): number {
  return a.creationTime > 1e12 ? a.creationTime : a.creationTime * 1000;
}
function flightInterval(f: Flight): { dep: number; arr: number } | null {
  const inst = buildInstants(f.date, f.dep_utc, f.arr_utc, 0);
  return inst ? { dep: inst.dep.getTime(), arr: inst.arr.getTime() } : null;
}
function flightCreatedMs(f: Flight): number {
  const d = new Date(((f.created_at as any) || '').replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function mapPerm(res: ML.PermissionResponse): PhotoPermission {
  if (res.granted) return res.accessPrivileges === 'limited' ? 'limited' : 'full';
  if (res.canAskAgain && res.status === 'undetermined') return 'undetermined';
  return 'denied';
}

export async function getPhotoPermissionStatus(): Promise<PhotoPermission> {
  const M = ml(); if (!M) return 'unavailable';
  return mapPerm(await M.getPermissionsAsync());
}
export async function requestPhotoPermission(): Promise<PhotoPermission> {
  const M = ml(); if (!M) return 'unavailable';
  // writeOnly=false → begär FULL läsåtkomst till fotobiblioteket (inte bara add-only).
  return mapPerm(await M.requestPermissionsAsync(false));
}

// Hämta alla media (foto+video) i ett tidsfönster (paginerat, tak för säkerhet).
async function assetsInWindow(afterMs: number, beforeMs: number): Promise<ML.Asset[]> {
  const M = ml(); if (!M || afterMs >= beforeMs) return [];
  const out: ML.Asset[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 8; page++) {
    const res = await M.getAssetsAsync({
      mediaType: [M.MediaType.photo, M.MediaType.video],
      createdAfter: afterMs,
      createdBefore: beforeMs,
      sortBy: [[M.SortBy.creationTime, false]],
      first: 100,
      after: cursor,
    });
    out.push(...res.assets);
    if (!res.hasNextPage) break;
    cursor = res.endCursor;
  }
  return out;
}

/** Full/inkrementell synk. Returnerar matchningar per flygning (äldst först) + antal skannade. */
export async function syncPhotos(onProgress?: (done: number, total: number) => void): Promise<{ matches: FlightMatch[]; scanned: number }> {
  if (!ml()) return { matches: [], scanned: 0 };
  const flightsAll = await getFlights(100000);
  const now = Date.now();

  // Kandidater: giltiga tider + ännu inte kopplade (kopplade dyker inte upp igen).
  const cands = flightsAll
    .map((f) => { const iv = flightInterval(f); return iv ? { f, dep: iv.dep, arr: iv.arr } : null; })
    .filter((c): c is { f: Flight; dep: number; arr: number } => !!c && !c.f.photo_local_id);

  // Hämta media i HELA ±30-min-fönstret för VARJE okopplad flygning (oavsett ålder) → dedupe. Den
  // gamla "bara media efter senaste synk"-optimeringen gjorde fönstret tomt för historiska/importerade
  // flygningar (dep i det förflutna < last_sync ⇒ after ≥ before) → inga bilder hittades alls.
  const assetMap = new Map<string, ML.Asset>();
  let done = 0;
  for (const c of cands) {
    const found = await assetsInWindow(Math.max(0, c.dep - WINDOW_MS), c.arr + WINDOW_MS);
    for (const a of found) assetMap.set(a.id, a);
    done++; onProgress?.(done, cands.length);
  }

  // Överlappslogik: varje media tillhör EXAKT EN flygning — den vars flygtid ligger närmast.
  // 1) media INOM dep–arr vinner (avstånd 0). 2) annars kortast avstånd till dep/arr.
  const byFlight = new Map<number, ML.Asset[]>();
  for (const a of assetMap.values()) {
    const t = ctMs(a);
    let bestF: Flight | null = null;
    let bestInside = 2, bestDist = Infinity;
    for (const c of cands) {
      if (t < c.dep - WINDOW_MS || t > c.arr + WINDOW_MS) continue; // utanför ±30-min-fönstret
      const inside = t >= c.dep && t <= c.arr ? 0 : 1;
      const dist = inside === 0 ? 0 : Math.min(Math.abs(t - c.dep), Math.abs(t - c.arr));
      if (inside < bestInside || (inside === bestInside && dist < bestDist)) {
        bestInside = inside; bestDist = dist; bestF = c.f;
      }
    }
    if (bestF) { const arr = byFlight.get(bestF.id) ?? []; arr.push(a); byFlight.set(bestF.id, arr); }
  }

  await setSetting(LAST_SYNC_KEY, String(now));

  const matches: FlightMatch[] = cands
    .filter((c) => byFlight.has(c.f.id))
    .map((c) => ({ flight: c.f, assets: byFlight.get(c.f.id)!.sort((x, y) => ctMs(x) - ctMs(y)) }))
    .sort((a, b) => (flightInterval(a.flight)?.dep ?? 0) - (flightInterval(b.flight)?.dep ?? 0)); // äldst först
  return { matches, scanned: cands.length };
}

/** Finns det något att synka? Sant om aldrig synkat, eller om det finns ännu okopplade
 *  flygningar skapade efter senaste synk (dvs. "nya flighter har tillkommit"). Falskt om
 *  native-modulen saknas (då är synk inte möjlig alls). Styr utgråning av Sync-knappen. */
export async function hasPendingSync(): Promise<boolean> {
  if (!ml()) return false;
  const lastSync = parseInt((await getSetting(LAST_SYNC_KEY)) || '0', 10) || 0;
  if (!lastSync) return true; // aldrig synkat
  const flights = await getFlights(100000);
  return flights.some((f) => !f.photo_local_id && !!flightInterval(f) && flightCreatedMs(f) > lastSync);
}

/** Full fönstersökning för EN flygning (manuell om-koppling från detaljsidan — inte inkrementell). */
export async function getFlightPhotoCandidates(f: Flight): Promise<ML.Asset[]> {
  const iv = flightInterval(f);
  if (!iv) return [];
  const found = await assetsInWindow(iv.dep - WINDOW_MS, iv.arr + WINDOW_MS);
  return found.sort((x, y) => ctMs(x) - ctMs(y));
}

// iOS Photos-videor: getAssetInfoAsync().localUri kan vara en skyddad sökväg som varken
// expo-video eller VideoThumbnails kan läsa → kopiera till app-cachen (TEMPORÄRT, ej persistent)
// för en garanterat spelbar file://-uri. Cacheas per asset (kopieras bara en gång).
async function ensurePlayableVideo(src: string, filename: string | undefined, localId: string): Promise<string> {
  if (!src.startsWith('file://') && !src.startsWith('/')) return src; // ph:// e.d. — kan ej kopieras
  try {
    const ext = (filename?.split('.').pop() || 'mov').toLowerCase();
    const dest = `${FileSystem.cacheDirectory}bfvid_${localId.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists) await FileSystem.copyAsync({ from: src, to: dest });
    return dest;
  } catch {
    return src;
  }
}

/** Uri + mediatyp (+ ev. GPS-position för kartvyn) för en localIdentifier (null om mediet
 *  inte finns). Videor kopieras till cachen för spelbarhet. */
export async function getAssetDisplay(localId: string): Promise<{ uri: string; isVideo: boolean; location?: { latitude: number; longitude: number } | null } | null> {
  const M = ml(); if (!M) return null;
  try {
    const info = await M.getAssetInfoAsync(localId);
    let uri = info?.localUri || info?.uri;
    if (!uri) return null;
    const isVideo = info.mediaType === 'video';
    if (isVideo) uri = await ensurePlayableVideo(uri, info.filename, localId);
    return { uri, isVideo, location: info.location ?? null };
  } catch {
    return null;
  }
}

/** Löser upp en localIdentifier till en visningsbar/spelbar URI (null om mediet raderats). */
export async function getAssetDisplayUri(localId: string): Promise<string | null> {
  return (await getAssetDisplay(localId))?.uri ?? null;
}
