// Uppskatta NATTID vid import när filen saknar ett night-fält. Använder ICAO-koordinaterna (dep/arr) +
// tiderna och appens dag/natt-motor (computeNightHoursTimed) → nattandelen av varje flygning läggs där
// den faktiskt inträffar längs rutten. Local-tid konverteras till UTC via longitud-offset (≈ medelsoltid
// vid avgångsfältet) — en uppskattning, men rätt frame för en sol-baserad beräkning.
import { computeNightHoursTimed } from '../utils/dayNight';
import type { OcrFlightResult } from '../types/flight';

export type NightBasis = 'utc' | 'local';
export type Coords = Record<string, { lat: number; lon: number }>;

export type NightEstimate = {
  perFlight: (number | null)[]; // nattid (h) per flygningsindex; null = kunde inte beräknas
  totalNight: number;           // summa nattid (h)
  nightFlights: number;         // antal flygningar med nattid > 0
  computed: number;             // antal flygningar som kunde beräknas
  skipped: number;              // antal som saknade koordinater/tid → hoppades över
};

const HHMM = /^(\d{1,2}):(\d{2})$/;
function utcMs(dateISO: string, hhmm: string): number | null {
  const m = HHMM.exec((hhmm || '').trim());
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  const ms = Date.parse(`${dateISO}T${String(h).padStart(2, '0')}:${m[2]}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Hur många flygningar SKULLE kunna få nattid beräknad (dep+arr-koord + avgångstid + flygtid). */
export function countComputable(flights: OcrFlightResult[], coords: Coords): number {
  let n = 0;
  for (const f of flights) {
    const dep = coords[(f.dep_place || '').trim().toUpperCase()];
    const arr = coords[(f.arr_place || '').trim().toUpperCase()];
    const tt = parseFloat(String(f.total_time ?? '')) || 0;
    if (dep && arr && tt > 0 && utcMs(f.date || '', f.dep_utc || '') != null) n++;
  }
  return n;
}

export function estimateNightForImport(flights: OcrFlightResult[], coords: Coords, basis: NightBasis): NightEstimate {
  const perFlight: (number | null)[] = [];
  let totalNight = 0, nightFlights = 0, computed = 0, skipped = 0;
  for (const f of flights) {
    const dep = coords[(f.dep_place || '').trim().toUpperCase()];
    const arr = coords[(f.arr_place || '').trim().toUpperCase()];
    const tt = parseFloat(String(f.total_time ?? '')) || 0;
    const depMsUtc = utcMs(f.date || '', f.dep_utc || '');
    if (!dep || !arr || tt <= 0 || depMsUtc == null) { perFlight.push(null); skipped++; continue; }
    // Local → UTC: logga-tiden är lokal vid avgång → dra av longitud-offset (öst = +). UTC-läge: 0.
    const offsetMs = basis === 'local' ? (dep.lon / 15) * 3600000 : 0;
    const depMs = depMsUtc - offsetMs;
    const arrMs = depMs + tt * 3600000; // använd flygtiden som varaktighet (robustare än ankomst-klockslag)
    let night = computeNightHoursTimed([{ lat: dep.lat, lon: dep.lon }, { lat: arr.lat, lon: arr.lon }], depMs, arrMs);
    night = Math.max(0, Math.min(tt, Math.round(night * 100) / 100));
    perFlight.push(night);
    if (night > 0) nightFlights++;
    totalNight += night;
    computed++;
  }
  return { perFlight, totalNight: Math.round(totalNight * 10) / 10, nightFlights, computed, skipped };
}
