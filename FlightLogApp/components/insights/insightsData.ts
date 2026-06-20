// Insights-data — härleder allt sektionerna behöver ur befintlig data (flightStore
// flights + stats). Inget nytt påhittat. Inkl. journey (kumulativ tid), per-månad
// PIC, samt haveFor/rateFor för licens-/målkurvor. Kombikategorier (roll+villkor,
// t.ex. PIC+Natt) = SUM(villkor) där roll>0, exakt under "roll hålls hela passet".

import { useMemo } from 'react';
import { useFlightStore } from '../../store/flightStore';
import type { Flight } from '../../types/flight';

const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const num = (f: Flight, k: string) => (f as any)[k] || 0;

export interface JourneyPt { date: Date; cum: number }

export interface InsightsData {
  total: number; ytd: number; m3: number; m6: number; m12: number;
  cats: Record<string, number>;
  landings: { day: number; night: number };
  monthly: Record<string, number>;
  journey: JourneyPt[];
  journeyPic: JourneyPt[];
  haveFor: (key: string) => number;
  rateFor: (key: string) => number;
  metDateFor: (key: string, required: number) => string | null;
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

    const cats: Record<string, number> = {
      pic: stats?.total_pic ?? 0, co_pilot: stats?.total_co_pilot ?? 0, dual: stats?.total_dual ?? 0,
      picus: stats?.total_picus ?? 0, instructor: stats?.total_instructor ?? 0, multi_pilot: stats?.total_multi_pilot ?? 0,
      nvg: stats?.total_nvg ?? 0, sim: stats?.total_sim ?? 0, ifr: stats?.total_ifr ?? 0,
      night: stats?.total_night ?? 0, vfr: stats?.total_vfr ?? 0, xc, xc_pic: xcPic,
    };

    const haveFor = (key: string): number => {
      if (key.includes('+')) { const [a, b] = key.split('+'); return real.filter((f) => num(f, a) > 0).reduce((s, f) => s + num(f, b), 0); }
      if (key === 'total') return stats?.total_time ?? sumSince('0000-01-01');
      return cats[key] ?? 0;
    };
    const rateFor = (key: string): number => {
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
    const metDateFor = (key: string, required: number): string | null => {
      if (required <= 0) return null;
      let cum = 0;
      for (const f of byDate) { cum += valOf(f, key); if (cum >= required && f.date) return f.date; }
      return null;
    };

    const yearStart = `${new Date().getFullYear()}-01-01`;
    return {
      total: stats?.total_time ?? sumSince('0000-01-01'),
      ytd: stats?.year_to_date ?? sumSince(yearStart),
      m3: stats?.last_90_days ?? sumSince(monthsAgoISO(3)),
      m6: sumSince(monthsAgoISO(6)),
      m12: stats?.last_12_months ?? sumSince(monthsAgoISO(12)),
      cats, landings: { day: stats?.total_landings_day ?? 0, night: stats?.total_landings_night ?? 0 },
      monthly, journey, journeyPic, haveFor, rateFor, metDateFor,
    };
  }, [flights, stats]);
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
