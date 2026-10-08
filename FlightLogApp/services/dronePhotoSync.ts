// Drönar-foto-synk — DRÖNAR-motsvarigheten till services/photoSync.ts. Matchar bibliotekets
// bilder/videor mot loggade DRÖNARflygningar på tid och kopplar referensen (localIdentifier) till
// drone_flights.photo_local_id. Allt lokalt; endast referensen sparas. Egna settings-nycklar så
// pilot- och drönar-synken inte krockar. Delade lågnivå-helpers (behörighet, asset-uppslag) återanvänds
// från photoSync så vi inte duplicerar native-hanteringen.
import type * as ML from 'expo-media-library/legacy';
import { getDroneFlights, setDroneFlightPhotoLocalId, type DroneFlight } from '../db/drones';
import { getSetting, setSetting } from '../db/flights';
import {
  isPhotoSyncAvailable, getPhotoPermissionStatus, requestPhotoPermission,
  getAssetDisplay, getAssetDisplayUri, type PhotoPermission,
} from './photoSync';

export { isPhotoSyncAvailable, getPhotoPermissionStatus, requestPhotoPermission, getAssetDisplay, getAssetDisplayUri, setDroneFlightPhotoLocalId };
export type { PhotoPermission };
export type DroneFlightMatch = { flight: DroneFlight; assets: ML.Asset[] };
// Wizarden använder samma namn (FlightMatch) — exportera en alias för enhetlig konsumtion.
export type FlightMatch = DroneFlightMatch;

const WINDOW_MS = 30 * 60 * 1000;                 // ±30 min buffertfönster
const LAST_SYNC_KEY = 'drone_last_photo_sync';
const SKIPPED_KEY = 'drone_photo_sync_skipped';
const SESSION_KEY = 'drone_photo_sync_session';

// Lazy-laddad native-modul (egen cache, samma modul som photoSync).
let _ml: typeof import('expo-media-library/legacy') | null | undefined;
function ml(): typeof import('expo-media-library/legacy') | null {
  if (_ml === undefined) { try { _ml = require('expo-media-library/legacy'); } catch { _ml = null; } }
  return _ml ?? null;
}

function ctMs(a: ML.Asset): number { return a.creationTime > 1e12 ? a.creationTime : a.creationTime * 1000; }

// Drönarens flygintervall: date + takeoff_time (LOKAL HH:MM) → +total_time. Saknas takeoff-tid
// matchas HELA dagen (drönare loggas ofta utan exakt tid). Fotons creationTime är också lokal epoch.
function droneInterval(f: DroneFlight): { dep: number; arr: number } | null {
  const [y, mo, d] = (f.date || '').split('-').map(Number);
  if (!y || !mo || !d) return null;
  const base = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
  const tk = (f.takeoff_time || '').trim();
  if (/^\d{1,2}:\d{2}$/.test(tk)) {
    const [hh, mm] = tk.split(':').map(Number);
    const dep = base + ((hh || 0) * 60 + (mm || 0)) * 60000;
    return { dep, arr: dep + Math.max(0, f.total_time || 0) * 3600000 };
  }
  return { dep: base, arr: base + 24 * 3600000 - 1 }; // hela dagen
}
function flightCreatedMs(f: DroneFlight): number {
  const d = new Date(((f.created_at as any) || '').replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
const hasMedia = (f: DroneFlight) => !!f.photo_local_id || !!f.photo_uri;

// ── Skippade (persisterad paus/återuppta) ────────────────────────────────────
export async function getSkippedFlightIds(): Promise<Set<number>> {
  try { const raw = await getSetting(SKIPPED_KEY); const arr = raw ? JSON.parse(raw) : []; return new Set(Array.isArray(arr) ? arr.map((x: any) => Number(x)) : []); }
  catch { return new Set(); }
}
async function saveSkipped(ids: Set<number>): Promise<void> { await setSetting(SKIPPED_KEY, JSON.stringify([...ids])).catch(() => {}); }
export async function addSkippedFlightId(id: number): Promise<void> { const s = await getSkippedFlightIds(); s.add(id); await saveSkipped(s); }
export async function removeSkippedFlightId(id: number): Promise<void> { const s = await getSkippedFlightIds(); s.delete(id); await saveSkipped(s); }
export async function clearSkippedFlightIds(): Promise<void> { await setSetting(SKIPPED_KEY, '[]').catch(() => {}); }

async function assetsInWindow(afterMs: number, beforeMs: number): Promise<ML.Asset[]> {
  const M = ml(); if (!M || afterMs >= beforeMs) return [];
  const out: ML.Asset[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 8; page++) {
    const res = await M.getAssetsAsync({
      mediaType: [M.MediaType.photo, M.MediaType.video],
      createdAfter: afterMs, createdBefore: beforeMs,
      sortBy: [[M.SortBy.creationTime, false]], first: 100, after: cursor,
    });
    out.push(...res.assets);
    if (!res.hasNextPage) break;
    cursor = res.endCursor;
  }
  return out;
}

/** Full/inkrementell synk för drönarflygningar. Returnerar matchningar per flygning (äldst först). */
export async function syncPhotos(onProgress?: (done: number, total: number) => void): Promise<{ matches: FlightMatch[]; scanned: number }> {
  if (!ml()) return { matches: [], scanned: 0 };
  const all = await getDroneFlights(100000);
  const now = Date.now();
  const skipped = await getSkippedFlightIds();

  const cands = all
    .map((f) => { const iv = droneInterval(f); return iv ? { f, dep: iv.dep, arr: iv.arr } : null; })
    .filter((c): c is { f: DroneFlight; dep: number; arr: number } => !!c && !hasMedia(c.f) && !skipped.has(c.f.id));

  const assetMap = new Map<string, ML.Asset>();
  let done = 0;
  for (const c of cands) {
    const found = await assetsInWindow(Math.max(0, c.dep - WINDOW_MS), c.arr + WINDOW_MS);
    for (const a of found) assetMap.set(a.id, a);
    done++; onProgress?.(done, cands.length);
  }

  // Varje media tillhör EXAKT EN flygning — den vars flygtid ligger närmast (inom-fönstret vinner).
  const byFlight = new Map<number, ML.Asset[]>();
  for (const a of assetMap.values()) {
    const t = ctMs(a);
    let bestF: DroneFlight | null = null;
    let bestInside = 2, bestDist = Infinity;
    for (const c of cands) {
      if (t < c.dep - WINDOW_MS || t > c.arr + WINDOW_MS) continue;
      const inside = t >= c.dep && t <= c.arr ? 0 : 1;
      const dist = inside === 0 ? 0 : Math.min(Math.abs(t - c.dep), Math.abs(t - c.arr));
      if (inside < bestInside || (inside === bestInside && dist < bestDist)) { bestInside = inside; bestDist = dist; bestF = c.f; }
    }
    if (bestF) { const arr = byFlight.get(bestF.id) ?? []; arr.push(a); byFlight.set(bestF.id, arr); }
  }

  await setSetting(LAST_SYNC_KEY, String(now));
  const matches: FlightMatch[] = cands
    .filter((c) => byFlight.has(c.f.id))
    .map((c) => ({ flight: c.f, assets: byFlight.get(c.f.id)!.sort((x, y) => ctMs(x) - ctMs(y)) }))
    .sort((a, b) => (droneInterval(a.flight)?.dep ?? 0) - (droneInterval(b.flight)?.dep ?? 0));
  await saveSession(matches);
  return { matches, scanned: cands.length };
}

export async function hasPendingSync(): Promise<boolean> {
  if (!ml()) return false;
  const lastSync = parseInt((await getSetting(LAST_SYNC_KEY)) || '0', 10) || 0;
  if (!lastSync) return true;
  const [flights, skipped] = await Promise.all([getDroneFlights(100000), getSkippedFlightIds()]);
  return flights.some((f) => !hasMedia(f) && !skipped.has(f.id) && !!droneInterval(f) && flightCreatedMs(f) > lastSync);
}

// ── Sparad granskningssession (paus/återuppta utan ny scanning) ──────────────
type StoredSession = { flightId: number; assetIds: string[] }[];
async function saveSession(matches: FlightMatch[]): Promise<void> {
  const data: StoredSession = matches.map((m) => ({ flightId: m.flight.id, assetIds: m.assets.map((a) => a.id) }));
  await setSetting(SESSION_KEY, JSON.stringify(data)).catch(() => {});
}
export async function clearReviewSession(): Promise<void> { await setSetting(SESSION_KEY, '[]').catch(() => {}); }
async function readSession(): Promise<StoredSession> {
  try { const raw = await getSetting(SESSION_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}
async function pendingSessionEntries(): Promise<StoredSession> {
  const [sess, flights, skipped] = await Promise.all([readSession(), getDroneFlights(100000), getSkippedFlightIds()]);
  if (!sess.length) return [];
  const byId = new Map(flights.map((f) => [f.id, f]));
  return sess.filter((e) => { const f = byId.get(e.flightId); return !!f && !hasMedia(f) && !skipped.has(e.flightId); });
}
export async function hasUnfinishedReview(): Promise<boolean> { return (await pendingSessionEntries()).length > 0; }
async function assetsByIds(ids: string[]): Promise<ML.Asset[]> {
  const M = ml(); if (!M) return [];
  // PARALLELLT + shouldDownloadFromNetwork:false → undviker seriell iCloud-nedladdning (annars "hänger" Resume).
  const results = await Promise.all(ids.map(async (id) => {
    try {
      const info: any = await M.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false });
      return info ? { ...(info as ML.Asset), id, uri: info.localUri || info.uri } : null;
    } catch { return null; }
  }));
  return results.filter((a): a is ML.Asset => !!a);
}
export async function resumeMatches(): Promise<FlightMatch[]> {
  const [entries, flights] = await Promise.all([pendingSessionEntries(), getDroneFlights(100000)]);
  const byId = new Map(flights.map((f) => [f.id, f]));
  const built = await Promise.all(entries.map(async (e) => {
    const f = byId.get(e.flightId); if (!f) return null;
    const assets = await assetsByIds(e.assetIds);
    return assets.length ? { flight: f, assets } : null;
  }));
  const matches: FlightMatch[] = built.filter((m): m is FlightMatch => !!m);
  matches.sort((a, b) => (droneInterval(a.flight)?.dep ?? 0) - (droneInterval(b.flight)?.dep ?? 0));
  return matches;
}
