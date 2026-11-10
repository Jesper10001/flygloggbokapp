// Pilot CV: siffrorna ur loggboken. Totalerna är samma som på dashboarden och i boken (getFlightStats, som också
// räknar in Backfill missing hours); tabellen per typ, staplarna per månad och milstolparna räknas ur flygningarna.

import { getFlights, getFlightStats } from '../../db/flights';
import type { Flight } from '../../types/flight';
import type { TileKey } from './cvConfig';

export interface CvData {
  total: number;
  totals: Record<TileKey, number>;
  flights: number;
  landings: number;
  types: { type: string; hours: number; pic: number; ifr: number; last: string }[];
  months: { label: string; hours: number }[];
  last12: number;
  milestones: { year: number; text: string }[];
  asOf: string; // "10 Nov 2026"
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
/** "2027-01-31" → "31 Jan 2027"; annat lämnas som det skrevs. */
export function prettyDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}` : (s || '').trim();
}
const monthYear = (iso: string) => { const m = /^(\d{4})-(\d{2})/.exec(iso); return m ? `${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}` : ''; };

export async function loadCvData(): Promise<CvData> {
  const [all, st] = await Promise.all([getFlights(99999), getFlightStats()]);
  const s: any = st ?? {};
  // Riktiga flygningar: inga simulatorpass, summeringsrader eller gamla dolda justeringsrader.
  const real = (all as Flight[]).filter((f: any) => f.flight_type !== 'sim' && f.flight_type !== 'summary' && f.remarks !== '[BACKFILL]');
  const n = (v: any) => Number(v) || 0;

  const byType = new Map<string, { hours: number; pic: number; ifr: number; last: string }>();
  for (const f of real) {
    const t = (f.aircraft_type || '').trim();
    if (!t) continue;
    const c = byType.get(t) ?? { hours: 0, pic: 0, ifr: 0, last: '' };
    c.hours += n(f.total_time); c.pic += n(f.pic); c.ifr += n(f.ifr);
    if ((f.date || '') > c.last) c.last = f.date;
    byType.set(t, c);
  }
  const types = [...byType.entries()].map(([type, v]) => ({ type, hours: v.hours, pic: v.pic, ifr: v.ifr, last: monthYear(v.last) }))
    .sort((a, b) => b.hours - a.hours);

  const today = new Date();
  const months: CvData['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ label: MONTHS[d.getMonth()][0], hours: real.filter((f) => (f.date || '').slice(0, 7) === ym).reduce((a, f) => a + n(f.total_time), 0) });
  }

  // Milstolpar: första loggade flygningen och första flygningen på de största typerna.
  const dated = real.filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f.date || '')).sort((a, b) => a.date.localeCompare(b.date));
  const milestones: CvData['milestones'] = [];
  if (dated.length) {
    const first = dated[0];
    milestones.push({ year: Number(first.date.slice(0, 4)), text: `First logged flight${first.aircraft_type ? `, ${first.aircraft_type}` : ''}` });
    for (const t of types.slice(0, 3)) {
      if (t.type === first.aircraft_type) continue;
      const f = dated.find((x) => x.aircraft_type === t.type);
      if (f) milestones.push({ year: Number(f.date.slice(0, 4)), text: `First flight on ${t.type}` });
    }
    milestones.sort((a, b) => b.year - a.year);
  }

  const landings = n(s.total_landings_day) + n(s.total_landings_night);
  const flights = n(s.total_flights) || real.length;
  return {
    total: n(s.total_time),
    totals: {
      pic: n(s.total_pic), co_pilot: n(s.total_co_pilot), dual: n(s.total_dual), instructor: n(s.total_instructor),
      ifr: n(s.total_ifr), night: n(s.total_night), nvg: n(s.total_nvg), me: n(s.total_me), se: n(s.total_se),
      mp: n(s.total_multi_pilot), sp: n(s.total_single_pilot), picus: n(s.total_picus), sim: n(s.total_sim),
      last12: n(s.last_12_months), last90: n(s.last_90_days), landings, flights,
    },
    flights, landings, types, months, last12: n(s.last_12_months), milestones, asOf: fmtDate(today),
  };
}
