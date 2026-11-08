// Foto-synk för flygalbumet (piloten): ETT svep genom fotobiblioteket. Varje bild/video tagen inom 15 minuter från
// en loggad flygning sparas till den flygning den ligger närmast (inne i flygtiden vinner); tidsfönstret
// (utils/photoWindow.ts) väljer sedan vad albumet visar, så fönstret kan ändras utan att biblioteket läses om.
// Allt sker lokalt — inga bilder lämnar enheten, och bara referensen (localIdentifier) sparas (db/flightPhotos.ts).
// Omslaget är flights.photo_local_id som förut (dashboarden, loggboken och delningskortet använder det).
//
// OBS: expo-media-library är en NATIVE-modul. Den lazy-laddas (require i funktion) så att
// importen inte kraschar i builds som saknar den — funktionen degraderar tills nästa dev build.
import type * as ML from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { getFlights, getSetting, setSetting, setFlightPhotoLocalId } from '../db/flights';
import {
  getAlbumPhotoRows, getKnownLocalIds, getFlightIdsWithAlbumPhotos, seedCoverPhotos, insertFlightPhotos,
  setFlightPhotoTakenAt, type NewFlightPhoto,
} from '../db/flightPhotos';
import { buildInstants } from '../utils/flightTime';
import {
  MAX_WINDOW_MIN, DEFAULT_WINDOW, placeTime, inWindow, windowFromMinutes, windowToMinutes,
  type PhotoWindow, type Phase,
} from '../utils/photoWindow';
import type { Flight } from '../types/flight';

const WINDOW_MS = 30 * 60 * 1000;           // ±30 min: kandidaterna när man byter bild på flygningens sida
const LAST_SYNC_KEY = 'last_photo_sync';
const WINDOW_KEY = 'photo_album_window';
const PAGE = 500;

export type PhotoPermission = 'full' | 'limited' | 'denied' | 'undetermined' | 'unavailable';

// Lazy-laddad native-modul (null om den inte finns i denna build).
let _ml: typeof import('expo-media-library/legacy') | null | undefined;
function ml(): typeof import('expo-media-library/legacy') | null {
  if (_ml === undefined) { try { _ml = require('expo-media-library/legacy'); } catch { _ml = null; } }
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

/** Synken kan alltid köras när modulen finns: den hittar nya bilder även för flygningar som redan har bilder. */
export async function hasPendingSync(): Promise<boolean> {
  return ml() !== null;
}
/** Den gamla granskningen flygning för flygning finns inte längre (allt läggs till på en gång). */
export async function hasUnfinishedReview(): Promise<boolean> {
  return false;
}

// ── Tidsfönstret ────────────────────────────────────────────────────────────────────────
export async function getPhotoWindow(): Promise<PhotoWindow> {
  try { return windowFromMinutes(JSON.parse((await getSetting(WINDOW_KEY)) || 'null')); } catch { return { ...DEFAULT_WINDOW }; }
}
export async function setPhotoWindow(w: PhotoWindow): Promise<void> {
  await setSetting(WINDOW_KEY, JSON.stringify(windowToMinutes(w)));
}

// ── Svepet ──────────────────────────────────────────────────────────────────────────────
export interface ScanProgress { read: number; total: number | null; flights: number; fraction: number }

/**
 * Läser biblioteket en gång och lägger till varje ny bild inom 15 minuter från en flygning. Ligger flygningarna
 * tätt (eller är biblioteket litet) läses hela tidsspannet i ett svep; annars bara fönstren runt flygningarna.
 * Bilder som redan hör till en flygning (även borttagna ur albumet) läggs aldrig till igen.
 */
export async function scanLibrary(
  onProgress?: (p: ScanProgress) => void,
  shouldStop?: () => boolean,
): Promise<{ read: number; added: number; flights: number }> {
  const M = ml();
  if (!M) return { read: 0, added: 0, flights: 0 };
  await seedCoverPhotos();
  const PAD = MAX_WINDOW_MIN * 60000;
  const flights = (await getFlights(100000))
    .map((f) => ({ f, iv: flightInterval(f) }))
    .filter((x): x is { f: Flight; iv: { dep: number; arr: number } } => !!x.iv && x.iv.arr >= x.iv.dep)
    .sort((a, b) => a.iv.dep - b.iv.dep);
  const near = await getFlightIdsWithAlbumPhotos();
  if (!flights.length) return { read: 0, added: 0, flights: near.size };

  // Sammanslagna sökfönster runt flygningarna.
  const ranges: [number, number][] = [];
  for (const { iv } of flights) {
    // En minut extra åt båda hållen: biblioteket räknar gränserna som exklusiva (matchningen nedan avgör de 15 minuterna).
    const lo = iv.dep - PAD - 60000, hi = iv.arr + PAD + 60000;
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  const span: [number, number] = [ranges[0][0], ranges[ranges.length - 1][1]];
  const mediaType = [M.MediaType.photo, M.MediaType.video];
  let total: number | null = null;
  try { total = (await M.getAssetsAsync({ mediaType, createdAfter: span[0], createdBefore: span[1], first: 1 })).totalCount; } catch { /* okänt */ }
  const sweep = total != null && Math.ceil(total / PAGE) <= ranges.length;
  const work = sweep ? [span] : ranges;

  // Närmaste flygning för en tidpunkt: binärsökning på avgång, sedan de flygningar vars fönster täcker t.
  const deps = flights.map((x) => x.iv.dep);
  const maxBlock = Math.max(...flights.map((x) => x.iv.arr - x.iv.dep));
  const match = (t: number): Flight | null => {
    let lo = 0, hi = deps.length;
    const from = t - PAD - maxBlock;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (deps[mid] < from) lo = mid + 1; else hi = mid; }
    let best: Flight | null = null, bestInside = 2, bestDist = Infinity;
    for (let i = lo; i < flights.length && deps[i] <= t + PAD; i++) {
      const { dep, arr } = flights[i].iv;
      if (t < dep - PAD || t > arr + PAD) continue;
      const inside = t >= dep && t <= arr ? 0 : 1;
      const dist = inside === 0 ? 0 : Math.min(Math.abs(t - dep), Math.abs(t - arr));
      if (inside < bestInside || (inside === bestInside && dist < bestDist)) { best = flights[i].f; bestInside = inside; bestDist = dist; }
    }
    return best;
  };

  const known = await getKnownLocalIds();
  const rows: NewFlightPhoto[] = [];
  let read = 0, rangesDone = 0;
  const report = () => onProgress?.({
    read, total: sweep ? total : null, flights: near.size,
    fraction: sweep && total ? Math.min(1, read / Math.max(1, total)) : rangesDone / work.length,
  });
  const readRange = async (lo: number, hi: number) => {
    let cursor: string | undefined;
    for (;;) {
      if (shouldStop?.()) return;
      const res = await M.getAssetsAsync({ mediaType, createdAfter: lo, createdBefore: hi, first: PAGE, after: cursor });
      for (const a of res.assets) {
        read++;
        if (known.has(a.id)) continue;
        const t = ctMs(a);
        const f = match(t);
        if (!f) continue;
        known.add(a.id);
        near.add(f.id);
        rows.push({ flightId: f.id, localId: a.id, takenAt: t, isVideo: a.mediaType === 'video', duration: a.duration || 0 });
      }
      report();
      if (!res.hasNextPage) return;
      cursor = res.endCursor;
    }
  };
  // Fönstren läses fyra åt gången (ett svep är bara ett).
  for (let i = 0; i < work.length; i += 4) {
    if (shouldStop?.()) break;
    await Promise.all(work.slice(i, i + 4).map(async ([lo, hi]) => { await readRange(lo, hi); rangesDone++; report(); }));
  }
  if (shouldStop?.()) return { read, added: 0, flights: near.size };
  await insertFlightPhotos(rows);
  await setSetting(LAST_SYNC_KEY, String(Date.now()));
  return { read, added: rows.length, flights: near.size };
}

// ── Albumet ─────────────────────────────────────────────────────────────────────────────
export interface AlbumPhoto {
  key: string;            // stabil nyckel i listor
  rowId: number | null;   // flight_photos.id (null = bilden som lagts till för hand)
  localId: string | null; // fotobiblioteket
  uri: string | null;     // bilden som lagts till för hand (photo_uri)
  flightId: number;
  takenAt: number | null;
  isVideo: boolean;
  duration: number;
  phase: Phase;
  rel: number;
  frac: number;
}
export interface AlbumFlight { flight: Flight; dep: number; arr: number; photos: AlbumPhoto[] }

/**
 * Albumets alla bilder per flygning (ej borttagna), med var de ligger i förhållande till flygningen. Rader utan
 * tid (foton kopplade före albumet) får sin tid från biblioteket här, en gång.
 */
export async function loadAlbum(): Promise<AlbumFlight[]> {
  await seedCoverPhotos().catch(() => {});
  const [rows, flights] = await Promise.all([getAlbumPhotoRows(), getFlights(100000)]);
  const M = ml();
  const missing = rows.filter((r) => r.taken_at == null);
  if (M && missing.length) {
    await Promise.all(missing.map(async (r) => {
      try {
        const info: any = await M.getAssetInfoAsync(r.local_id, { shouldDownloadFromNetwork: false });
        if (info?.creationTime) { const t = ctMs(info); r.taken_at = t; await setFlightPhotoTakenAt(r.id, t); }
      } catch { /* bilden finns inte längre — visas utan tid */ }
    }));
  }
  const byFlight = new Map<number, typeof rows>();
  for (const r of rows) { const a = byFlight.get(r.flight_id); if (a) a.push(r); else byFlight.set(r.flight_id, [r]); }
  const out: AlbumFlight[] = [];
  for (const f of flights) {
    const list = byFlight.get(f.id) ?? [];
    if (!list.length && !f.photo_uri) continue;
    const iv = flightInterval(f);
    const dep = iv?.dep ?? 0, arr = iv?.arr ?? 0;
    const photos: AlbumPhoto[] = list.map((r) => {
      const pl = iv ? placeTime(r.taken_at, dep, arr) : { phase: 'unknown' as Phase, rel: 0, frac: 0 };
      return {
        key: `p${r.id}`, rowId: r.id, localId: r.local_id, uri: null, flightId: f.id, takenAt: r.taken_at,
        isVideo: !!r.is_video, duration: r.duration || 0, ...pl,
      };
    });
    if (f.photo_uri) {
      photos.push({
        key: `m${f.id}`, rowId: null, localId: null, uri: f.photo_uri, flightId: f.id, takenAt: null,
        isVideo: f.media_type === 'video', duration: 0, phase: 'unknown', rel: 0, frac: 0,
      });
    }
    photos.sort((a, b) => (a.takenAt ?? Number.MAX_SAFE_INTEGER) - (b.takenAt ?? Number.MAX_SAFE_INTEGER));
    out.push({ flight: f, dep, arr, photos });
  }
  out.sort((a, b) => (b.dep || 0) - (a.dep || 0) || (b.flight.date || '').localeCompare(a.flight.date || ''));
  return out;
}

/** Det albumet visar med fönstret w. Omslaget visas alltid (det är valt). */
export function visiblePhotos(af: AlbumFlight, w: PhotoWindow): AlbumPhoto[] {
  return af.photos.filter((p) => p.localId === af.flight.photo_local_id || p.uri || inWindow(p, w));
}

/** Omslaget: det valda om det syns, annars första bilden i luften, annars första. */
export function coverOf(af: AlbumFlight, visible: AlbumPhoto[]): AlbumPhoto | null {
  return visible.find((p) => p.localId && p.localId === af.flight.photo_local_id)
    ?? visible.find((p) => p.phase === 'air')
    ?? visible[0] ?? null;
}

/** Flygningar som har bilder men inget omslag får det automatiska (dashboarden, loggboken och delningen visar det). */
export async function assignCovers(w: PhotoWindow): Promise<void> {
  for (const af of await loadAlbum()) {
    if (af.flight.photo_local_id) continue;
    const vis = visiblePhotos(af, w).filter((p) => p.localId);
    const c = coverOf(af, vis);
    if (c?.localId) await setFlightPhotoLocalId(af.flight.id, c.localId, af.flight.photo_uri ? undefined : c.isVideo ? 'video' : 'image');
  }
}

// ── Miniatyrer ──────────────────────────────────────────────────────────────────────────
// Upplösta uri:er per bild (fil på telefonen). Fyra åt gången, så att en lång lista inte läser hela biblioteket
// på en gång. Videor får en stillbild (VideoThumbnails).
const thumbCache = new Map<string, Promise<string | null>>();
const thumbDone = new Map<string, string>();
let thumbActive = 0;
const thumbQueue: (() => void)[] = [];
function inSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const run = () => {
      thumbActive++;
      fn().then(resolve, () => resolve(null as T)).finally(() => { thumbActive--; thumbQueue.shift()?.(); });
    };
    if (thumbActive < 4) run(); else thumbQueue.push(run);
  });
}
/** Redan upplöst miniatyr (för att rita direkt utan blink). */
export function peekThumb(key: string): string | undefined { return thumbDone.get(key); }
export function thumbFor(localId: string | null, isVideo: boolean, fileUri?: string | null): Promise<string | null> {
  const key = localId ?? fileUri ?? '';
  if (!key) return Promise.resolve(null);
  let p = thumbCache.get(key);
  if (p) return p;
  p = inSlot(async () => {
    let uri: string | null = null;
    if (fileUri) uri = fileUri;
    else if (localId) {
      const M = ml();
      if (M && !isVideo) {
        try { const info: any = await M.getAssetInfoAsync(localId, { shouldDownloadFromNetwork: false }); uri = info?.localUri || null; } catch { /* nedan */ }
      }
      if (!uri) uri = (await getAssetDisplay(localId))?.uri ?? null;
    }
    if (uri && isVideo) {
      try { uri = (await VideoThumbnails.getThumbnailAsync(uri, { time: 0 })).uri; } catch { uri = null; }
    }
    if (uri) thumbDone.set(key, uri);
    return uri;
  });
  thumbCache.set(key, p);
  return p;
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
