// Info-kortets nätanrop: NOTAM ur LFV:s officiella PIB (gratis, proxyn GET /notam) och ↻ som hämtar om en
// flygplats ur dess officiella källor (proxyn POST /airport-info/refresh, 3 Blade coins, citatkontrollerat på servern).
import { getDeviceId } from './anthropicClient';
import type { InfoRec } from '../store/airportInfoStore';

const PROXY_URL = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').replace(/\/+$/, '');

export type Notam = { text: string; from?: string; to?: string | null; est?: boolean; sched?: string };
export type NotamResult = {
  icao: string; issued: string | null; pibUrl: string; listUrl: string; covered: boolean;
  notams: Notam[]; snowtam: { issued: string; text: string } | null;
};

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

// Hämtade NOTAM sparas i minnet en timme per flygplats: att stänga och öppna AD info hämtar inte om,
// bara ↻ i NOTAM-raden (force) gör det. (Proxyn har dessutom en delad 15-minuterscache mot LFV.)
const NOTAM_TTL_MS = 60 * 60 * 1000;
const notamCache = new Map<string, { at: number; r: NotamResult }>();
export function cachedNotams(icao: string): NotamResult | null {
  const c = notamCache.get(icao);
  return c && Date.now() - c.at < NOTAM_TTL_MS ? c.r : null;
}

export async function fetchNotams(icao: string, force = false): Promise<NotamResult> {
  const hit = !force && cachedNotams(icao);
  if (hit) return hit;
  if (!PROXY_URL) throw new Error('notam_unavailable');
  const res = await withTimeout(30000, (signal) => fetch(`${PROXY_URL}/notam?icao=${encodeURIComponent(icao)}`, { headers: { 'Cache-Control': 'no-cache' }, signal }));
  if (!res.ok) throw new Error('notam_unavailable');
  const r = (await res.json()) as NotamResult;
  notamCache.set(icao, { at: Date.now(), r });
  return r;
}

export class RefreshError extends Error { constructor(public code: string) { super(code); } }

export async function refreshAirportInfo(key: string): Promise<{ record: InfoRec; changed: string[] }> {
  if (!PROXY_URL) throw new RefreshError('unavailable');
  const res = await withTimeout(90000, (signal) => fetch(`${PROXY_URL}/airport-info/refresh`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Device-ID': getDeviceId() },
    body: JSON.stringify({ key }),
  }));
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) throw new RefreshError('no_coins');
  if (!res.ok || !body.record) throw new RefreshError(body.error ?? 'failed');
  return { record: body.record, changed: body.changed ?? [] };
}
