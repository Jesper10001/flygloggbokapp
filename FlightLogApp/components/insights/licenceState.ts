// Next licence-kortets beräkningar, utan React: varje kravs timmar, takt och datum, vilket krav som sätter datumet,
// och hur redo man är (snittet av kraven, vart och ett högst 100 %) vid en viss månad. Månader räknas som år*12+mån.

import type { InsightsData, JourneyPt } from './insightsData';
import type { WLicenceSet } from '../EASAProgressChart';

const absOf = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const absOfIso = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

export interface LicReq {
  label: string; key: string; required: number; short: string;
  have: number; met: boolean; toGo: number;
  pace: number; fast: number; slow: number;   // h/mån: 12 månader, snabbaste och långsammaste takten (0 = ingen)
  m: number | null;                           // månader kvar i 12-månaderstakten, 0 om uppfyllt, null utan takt
  metA: number | null;                        // månaden (år*12+mån) kravet uppfylldes
  series: JourneyPt[];
}
export interface LicState {
  code: string; reqs: LicReq[]; open: LicReq[];
  lim: LicReq | null;                         // kravet som sätter datumet (eller saknar takt)
  done: boolean; ready: number; metCount: number;
  etaM: number | null; fastM: number | null; slowM: number | null;
  doneA: number | null;
}

export function cumAt(r: LicReq, a: number, nowA: number): number {
  if (a >= nowA) return r.have;
  const s = r.series;
  if (!s.length) return 0;
  const i = a - absOf(s[0].date);
  return i < 0 ? 0 : s[Math.min(s.length - 1, i)].cum;
}
export const readyAt = (S: LicState, a: number, nowA: number) =>
  S.reqs.reduce((t, r) => t + Math.min(1, cumAt(r, a, nowA) / r.required), 0) / (S.reqs.length || 1);
export const projAt = (S: LicState, t: number, pick: (r: LicReq) => number) =>
  S.reqs.reduce((s, r) => s + Math.min(1, (r.have + pick(r) * t) / r.required), 0) / (S.reqs.length || 1);

// Korta namn för rutorna och texterna.
function shortOf(label: string, key: string): string {
  if (key === 'total') return 'Total';
  if (key === 'dual') return 'Dual';
  if (key === 'pic') return /^solo/i.test(label) ? 'Solo' : /helicopter/i.test(label) ? 'Heli' : 'PIC';
  if (key === 'atpl_pic_a' || key === 'atpl_pic_h') return 'PIC';
  if (key === 'xc_pic') return /^solo/i.test(label) ? 'Solo XC' : 'XC PIC';
  if (key === 'xc') return 'XC';
  if (key === 'ifr') return 'IFR';
  if (key === 'night' || key === 'night_pc') return 'Night';
  if (key === 'multi_pilot') return 'Multi-crew';
  return label;
}

export function buildState(lic: WLicenceSet, D: InsightsData, nowA: number): LicState {
  const reqs: LicReq[] = lic.reqs.filter((q) => q.required > 0).map((q) => {
    const have = D.haveFor(q.key, q.sim), series = D.seriesFor(q.key, q.sim), pace = D.rateFor(q.key, q.sim);
    const monthly = series.map((p, i) => p.cum - (i ? series[i - 1].cum : 0));
    const natural = [monthly.slice(-3).reduce((a, b) => a + b, 0) / 3, pace, series.length ? have / series.length : 0].filter((p) => p > 0);
    const met = have >= q.required, toGo = Math.max(0, q.required - have);
    const md = met ? D.metDateFor(q.key, q.required, q.sim) : null;
    return {
      label: q.label, key: q.key, required: q.required, short: shortOf(q.label, q.key),
      have, met, toGo, pace,
      fast: natural.length ? Math.max(...natural) : 0, slow: natural.length ? Math.min(...natural) : 0,
      m: met ? 0 : pace > 0 ? Math.ceil(toGo / pace) : null,
      metA: met ? (md ? absOfIso(md) : nowA) : null,
      series,
    };
  });
  const open = reqs.filter((r) => !r.met);
  const stalled = open.find((r) => r.m == null) ?? null;
  const lim = stalled ?? open.reduce<LicReq | null>((b, r) => (!b || (r.m ?? 0) > (b.m ?? 0) ? r : b), null);
  const worst = (pick: (r: LicReq) => number): number | null =>
    open.every((r) => pick(r) > 0) ? open.reduce((mx, r) => Math.max(mx, Math.ceil(r.toGo / pick(r))), 0) : null;
  return {
    code: lic.code, reqs, open, lim, done: !open.length,
    ready: reqs.length ? reqs.reduce((t, r) => t + Math.min(1, r.have / r.required), 0) / reqs.length : 0,
    metCount: reqs.length - open.length,
    etaM: stalled ? null : lim ? lim.m : 0,
    fastM: worst((r) => r.fast), slowM: worst((r) => r.slow),
    doneA: open.length ? null : reqs.reduce((mx, r) => Math.max(mx, r.metA ?? nowA), 0),
  };
}

// Timmar i texter: en decimal under 10 h (5 h-krav syns annars inte), annars hela timmar.
export function hoursTxt(h: number): string {
  if (h < 10) return String(Math.round(h * 10) / 10);
  return Math.round(h).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
