// Insights-data — härleder allt sektionerna behöver ur befintlig data (flightStore
// flights + stats). Inget nytt påhittat. Inkl. journey (kumulativ tid), per-månad
// PIC, samt haveFor/rateFor för licens-/målkurvor. Kombikategorier (roll+villkor,
// t.ex. PIC+Natt) = SUM(villkor) där roll>0, exakt under "roll hålls hela passet".

import { useMemo } from 'react';
import { useFlightStore } from '../../store/flightStore';
import type { Flight } from '../../types/flight';
import { reqTimeline, needsTimeline, DERIVED_KEYS, type ReqPoint, type SimCredit } from './licenceHours';

const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const num = (f: Flight, k: string) => (f as any)[k] || 0;

export interface JourneyPt { date: Date; cum: number }

// Projections visar en projektion först när takten bygger på riktig historik: minst 60 dagar
// sedan första flygningen och minst 10 flygningar (simulatorpass räknas inte, som i projektionen).
export const PROJECTION_MIN_DAYS = 60;
export const PROJECTION_MIN_FLIGHTS = 10;

export interface ProjectionUnlock {
  ready: boolean;
  flights: number;            // flygningar utan simulatorpass
  days: number;               // dagar sedan första flygningen
  firstDate: Date | null;
  unlockDate: Date | null;    // första flygningen + 60 dagar
}

export function projectionUnlock(flights: Flight[], today = new Date()): ProjectionUnlock {
  let first: string | null = null, n = 0;
  for (const f of flights) {
    if (f.flight_type === 'sim' || !f.date) continue;
    n++;
    if (!first || f.date < first) first = f.date;
  }
  if (!first) return { ready: false, flights: 0, days: 0, firstDate: null, unlockDate: null };
  const [y, m, d] = first.slice(0, 10).split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.max(0, Math.round((t0.getTime() - start.getTime()) / 86400000));
  return {
    ready: days >= PROJECTION_MIN_DAYS && n >= PROJECTION_MIN_FLIGHTS,
    flights: n, days, firstDate: start, unlockDate: new Date(y, m - 1, d + PROJECTION_MIN_DAYS),
  };
}

export interface InsightsData {
  total: number; ytd: number; m3: number; m6: number; m12: number;
  cats: Record<string, number>;
  counts: Record<string, number>;
  landings: { day: number; night: number };
  monthly: Record<string, number>;
  journey: JourneyPt[];
  journeyPic: JourneyPt[];
  // `sim` = licenskravets simulatorkredit (se licenceHours). Sammansatta nycklar (night_pc, atpl_pic_*) går också.
  seriesFor: (key: string, sim?: SimCredit) => JourneyPt[];
  haveFor: (key: string, sim?: SimCredit) => number;
  rateFor: (key: string, sim?: SimCredit) => number;
  metDateFor: (key: string, required: number, sim?: SimCredit) => string | null;
}

export function useInsightsData(): InsightsData {
  const flights = useFlightStore((s) => s.flights);
  const stats = useFlightStore((s) => s.stats);

  return useMemo(() => {
    const real = flights.filter((f) => f.flight_type !== 'sim');
    const sumSince = (cut: string) => real.filter((f) => f.date >= cut).reduce((s, f) => s + (f.total_time || 0), 0);
    const isXC = (f: Flight) => f.dep_place !== f.arr_place && (f.total_time || 0) >= 0.5;
    const xc = real.filter(isXC).reduce((s, f) => s + (f.total_time || 0), 0);
    const xcPic = real.filter((f) => isXC(f) && (f.pic || 0) > 0).reduce((s, f) => s + (f.total_time || 0), 0);

    const monthly: Record<string, number> = {};
    const monthlyPic: Record<string, number> = {};
    for (const f of real) {
      if (!f.date) continue;
      const k = f.date.slice(0, 7);
      monthly[k] = (monthly[k] || 0) + (f.total_time || 0);
      monthlyPic[k] = (monthlyPic[k] || 0) + (f.pic || 0);
    }

    const buildJourney = (map: Record<string, number>): JourneyPt[] => {
      const ks = Object.keys(map).sort();
      if (!ks.length) return [];
      const [fy, fm] = ks[0].split('-').map(Number);
      const now = new Date();
      const out: JourneyPt[] = [];
      let cum = 0, y = fy, m = fm;
      let guard = 0;
      while ((y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) && guard++ < 1200) {
        cum += map[`${y}-${String(m).padStart(2, '0')}`] || 0;
        out.push({ date: new Date(y, m - 1, 1), cum: Math.round(cum * 10) / 10 });
        m++; if (m > 12) { m = 1; y++; }
      }
      return out;
    };
    const journey = buildJourney(monthly);
    const journeyPic = buildJourney(monthlyPic);

    const cut12 = monthsAgoISO(12);
    const r12 = real.filter((f) => f.date >= cut12);
    const rate = (pred: (f: Flight) => boolean, col: string) => r12.filter(pred).reduce((s, f) => s + num(f, col), 0) / 12;

    const sumField = (k: string) => real.reduce((s, f) => s + num(f, k), 0);

    const cats: Record<string, number> = {
      pic: stats?.total_pic ?? 0, co_pilot: stats?.total_co_pilot ?? 0, dual: stats?.total_dual ?? 0,
      picus: stats?.total_picus ?? 0, instructor: stats?.total_instructor ?? 0, multi_pilot: stats?.total_multi_pilot ?? 0,
      nvg: stats?.total_nvg ?? 0, sim: stats?.total_sim ?? 0, ifr: stats?.total_ifr ?? 0,
      night: stats?.total_night ?? 0, vfr: stats?.total_vfr ?? 0, xc, xc_pic: xcPic,
      // Utökade timkategorier (ur stats) + pilot flying (summeras direkt).
      single_pilot: stats?.total_single_pilot ?? 0, spic: stats?.total_spic ?? 0,
      examiner: stats?.total_examiner ?? 0, safety_pilot: stats?.total_safety_pilot ?? 0,
      observer: stats?.total_observer ?? 0, relief_crew: stats?.total_relief_crew ?? 0,
      ferry_pic: stats?.total_ferry_pic ?? 0, se: stats?.total_se ?? 0, me: stats?.total_me ?? 0,
      pilot_flying: sumField('pilot_flying'),
    };

    // Antal (landningar/starter/approacher/holds) — summeras ur flighter (även FAA-natt-varianter).
    const counts: Record<string, number> = {
      takeoffs_day: sumField('takeoffs_day'), takeoffs_night: sumField('takeoffs_night'), takeoffs_faa_night: sumField('takeoffs_faa_night'),
      landings_day: stats?.total_landings_day ?? sumField('landings_day'),
      landings_night: stats?.total_landings_night ?? sumField('landings_night'),
      landings_faa_night: sumField('landings_faa_night'),
      landings_fs_day: sumField('landings_fs_day'), landings_fs_night: sumField('landings_fs_night'), landings_fs_faa_night: sumField('landings_fs_faa_night'),
      tng: sumField('tng_count'), app_2d: sumField('app_2d'), app_3d: sumField('app_3d'), holds: sumField('holds'),
    };

    // (Backfill läggs INTE på här längre — den speglas till en riktig loggboksrad som redan ingår i
    // `flights`/`stats` ovan, så den räknas automatiskt en gång.)

    // Sammansatta mått och simulatorkredit räknas pass för pass i tidsordning (licenceHours).
    const tlCache = new Map<string, ReqPoint[]>();
    const timeline = (key: string, sim?: SimCredit): ReqPoint[] => {
      const ck = `${key}|${sim ? JSON.stringify(sim) : ''}`;
      let t = tlCache.get(ck);
      if (!t) { t = reqTimeline(flights, key, sim); tlCache.set(ck, t); }
      return t;
    };

    const haveFor = (key: string, sim?: SimCredit): number => {
      if (needsTimeline(key, sim)) { const t = timeline(key, sim); return t.length ? t[t.length - 1].cum : 0; }
      if (key.includes('+')) { const [a, b] = key.split('+'); return real.filter((f) => num(f, a) > 0).reduce((s, f) => s + num(f, b), 0); }
      if (key === 'total') return stats?.total_time ?? sumSince('0000-01-01');
      return cats[key] ?? 0;
    };
    // Takten bygger bara på riktiga flygningar: simulatorkrediten har ett tak och tar slut.
    const rateFor = (key: string, _sim?: SimCredit): number => {
      if (DERIVED_KEYS.has(key)) {
        const t = timeline(key);
        const now = t.length ? t[t.length - 1].cum : 0;
        let then = 0;
        for (const p of t) { if (p.date >= cut12) break; then = p.cum; }
        return (now - then) / 12;
      }
      if (key.includes('+')) { const [a, b] = key.split('+'); return rate((f) => num(f, a) > 0, b); }
      if (key === 'total') return rate(() => true, 'total_time');
      if (key === 'xc') return rate(isXC, 'total_time');
      if (key === 'xc_pic') return rate((f) => isXC(f) && num(f, 'pic') > 0, 'total_time');
      return rate(() => true, key);
    };

    // exakt datum då en kategoris kumulativa timmar passerade `required` (för uppfyllda krav)
    const byDate = [...real].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') || (a.dep_utc || '').localeCompare(b.dep_utc || '') || ((a.id ?? 0) - (b.id ?? 0)));
    const valOf = (f: Flight, key: string): number => {
      if (key.includes('+')) { const [a, b] = key.split('+'); return num(f, a) > 0 ? num(f, b) : 0; }
      if (key === 'total') return f.total_time || 0;
      if (key === 'xc') return isXC(f) ? (f.total_time || 0) : 0;
      if (key === 'xc_pic') return (isXC(f) && num(f, 'pic') > 0) ? (f.total_time || 0) : 0;
      return num(f, key);
    };
    const metDateFor = (key: string, required: number, sim?: SimCredit): string | null => {
      if (required <= 0) return null;
      if (needsTimeline(key, sim)) return timeline(key, sim).find((p) => p.cum >= required)?.date ?? null;
      let cum = 0;
      for (const f of byDate) { cum += valOf(f, key); if (cum >= required && f.date) return f.date; }
      return null;
    };

    // Kumulativ månadsserie för valfri kategori (samma regler som valOf), från kategorins första månad med tid
    // t.o.m. innevarande månad. Byggs första gången den behövs.
    const seriesCache = new Map<string, JourneyPt[]>([['total', journey], ['pic', journeyPic]]);
    const seriesFor = (key: string, sim?: SimCredit): JourneyPt[] => {
      const ck = sim ? `${key}|${JSON.stringify(sim)}` : key;
      let s = seriesCache.get(ck);
      if (!s && needsTimeline(key, sim)) {
        // månadens ökning = skillnaden i kumulativt värde (PIC-alternativen är inte summerbara pass för pass)
        const map: Record<string, number> = {};
        let prev = 0;
        for (const p of timeline(key, sim)) { const m = p.date.slice(0, 7); map[m] = (map[m] || 0) + (p.cum - prev); prev = p.cum; }
        s = buildJourney(map);
        seriesCache.set(ck, s);
      }
      if (!s) {
        const map: Record<string, number> = {};
        for (const f of real) {
          const v = f.date ? valOf(f, key) : 0;
          if (v > 0) map[f.date.slice(0, 7)] = (map[f.date.slice(0, 7)] || 0) + v;
        }
        s = buildJourney(map);
        seriesCache.set(key, s);
      }
      return s;
    };

    const yearStart = `${new Date().getFullYear()}-01-01`;
    return {
      total: stats?.total_time ?? sumSince('0000-01-01'),
      ytd: stats?.year_to_date ?? sumSince(yearStart),
      m3: stats?.last_90_days ?? sumSince(monthsAgoISO(3)),
      m6: sumSince(monthsAgoISO(6)),
      m12: stats?.last_12_months ?? sumSince(monthsAgoISO(12)),
      cats, counts, landings: { day: stats?.total_landings_day ?? 0, night: stats?.total_landings_night ?? 0 },
      monthly, journey, journeyPic, seriesFor, haveFor, rateFor, metDateFor,
    };
  }, [flights, stats]);
}

// Hours bank per tidsintervall. 'all' hanteras separat (stats-baserad, inkl. backfill); övriga
// intervall summeras ur flights filtrerade på datum (backfill är ej datum-attribuerbar → utesluts).
export type BankRange = 'all' | 'm3' | 'm6' | 'y1' | 'ytd';

export function computeHoursBank(flights: Flight[], range: Exclude<BankRange, 'all'>): {
  cats: Record<string, number>; counts: Record<string, number>; total: number;
} {
  const cut = range === 'm3' ? monthsAgoISO(3)
    : range === 'm6' ? monthsAgoISO(6)
    : range === 'y1' ? monthsAgoISO(12)
    : `${new Date().getFullYear()}-01-01`; // ytd = sedan 1 jan i år
  const inRange = flights.filter((f) => (f.date || '') >= cut);
  const real = inRange.filter((f) => f.flight_type !== 'sim');
  const sum = (arr: Flight[], k: string) => arr.reduce((s, f) => s + (Number((f as any)[k]) || 0), 0);
  const isXC = (f: Flight) => f.dep_place !== f.arr_place && (f.total_time || 0) >= 0.5;

  const cats: Record<string, number> = {
    pic: sum(real, 'pic'), co_pilot: sum(real, 'co_pilot'), dual: sum(real, 'dual'),
    picus: sum(real, 'picus'), instructor: sum(real, 'instructor'), multi_pilot: sum(real, 'multi_pilot'),
    nvg: sum(real, 'nvg'), sim: sum(inRange.filter((f) => f.flight_type === 'sim'), 'total_time'),
    ifr: sum(real, 'ifr'), night: sum(real, 'night'), vfr: sum(real, 'vfr'),
    xc: real.filter(isXC).reduce((s, f) => s + (f.total_time || 0), 0),
    single_pilot: sum(real, 'single_pilot'), spic: sum(real, 'spic'),
    examiner: sum(real, 'examiner'), safety_pilot: sum(real, 'safety_pilot'),
    observer: sum(real, 'observer'), relief_crew: sum(real, 'relief_crew'), ferry_pic: sum(real, 'ferry_pic'),
    se: sum(real, 'se_time'), me: sum(real, 'me_time'), pilot_flying: sum(real, 'pilot_flying'),
  };
  const counts: Record<string, number> = {
    takeoffs_day: sum(real, 'takeoffs_day'), takeoffs_night: sum(real, 'takeoffs_night'), takeoffs_faa_night: sum(real, 'takeoffs_faa_night'),
    landings_day: sum(real, 'landings_day'), landings_night: sum(real, 'landings_night'), landings_faa_night: sum(real, 'landings_faa_night'),
    landings_fs_day: sum(real, 'landings_fs_day'), landings_fs_night: sum(real, 'landings_fs_night'), landings_fs_faa_night: sum(real, 'landings_fs_faa_night'),
    tng: sum(real, 'tng_count'), app_2d: sum(real, 'app_2d'), app_3d: sum(real, 'app_3d'), holds: sum(real, 'holds'),
  };
  return { cats, counts, total: sum(real, 'total_time') };
}

export const fmtIntH = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// dec timmar → "H:MM"
export function fmtHM(dec: number): string {
  const h = Math.floor(dec), m = Math.round((dec - h) * 60);
  return m === 60 ? `${h + 1}:00` : `${h}:${String(m).padStart(2, '0')}`;
}

// månader framåt från nu → { label, months } | null
export function forecastFwd(remaining: number, ratePerMonth: number): { label: string; months: number } | null {
  if (remaining <= 0 || ratePerMonth <= 0) return null;
  const months = Math.ceil(remaining / ratePerMonth);
  const d = new Date(); d.setMonth(d.getMonth() + months);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { label: `${M[d.getMonth()]} ${d.getFullYear()}`, months };
}
