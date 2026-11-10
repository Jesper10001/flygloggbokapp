// Nattid räknad ur rutt och tider för många flygningar (ändringen "Recalculate night time" i app/bulk-edit.tsx).
// Samma motor som Log flight och importens uppskattning (utils/dayNight). En flygning utan giltig avgångstid
// eller utan koordinater för start eller landning får inget värde och lämnas av planen.
import { getAirportTzInfo } from '../../db/icao';
import { computeNightHoursTimed } from '../../utils/dayNight';
import type { Flight } from '../../types/flight';

const HHMM = /^(\d{1,2}):(\d{2})$/;
function utcMs(dateISO: string, hhmm: string): number | null {
  const m = HHMM.exec((hhmm || '').trim());
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) return null;
  if (+m[1] > 23 || +m[2] > 59) return null;
  const ms = Date.parse(`${dateISO}T${m[1].padStart(2, '0')}:${m[2]}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export async function recalcNight(flights: Flight[]): Promise<Record<number, number>> {
  const codes = [...new Set(flights.flatMap((f) => [f.dep_place, f.arr_place]).map((c) => (c || '').trim().toUpperCase()).filter(Boolean))];
  const pos = new Map<string, { lat: number; lon: number }>();
  for (let i = 0; i < codes.length; i += 400) {
    const rows = await getAirportTzInfo(codes.slice(i, i + 400));
    for (const r of rows) pos.set((r.icao || '').toUpperCase(), { lat: r.lat, lon: r.lon });
  }
  const out: Record<number, number> = {};
  for (const f of flights) {
    const dep = pos.get((f.dep_place || '').trim().toUpperCase());
    const arr = pos.get((f.arr_place || '').trim().toUpperCase());
    const tt = Number(f.total_time) || 0;
    const depMs = utcMs(f.date, f.dep_utc);
    if (!dep || !arr || tt <= 0 || depMs == null) continue;
    // Flygtiden som varaktighet (robustare än ankomstklockslaget, som kan sakna dygnsbyte).
    const night = computeNightHoursTimed([dep, arr], depMs, depMs + tt * 3600000);
    out[f.id] = Math.max(0, Math.min(tt, Math.round(night * 10) / 10));
  }
  return out;
}
