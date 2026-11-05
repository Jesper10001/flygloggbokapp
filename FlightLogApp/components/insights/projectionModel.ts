// Projections-beräkningarna som kortet (GoalCard) och helskärmen (ProjectionsFull) delar, och valen som följer med
// mellan dem: sorts tid, mål och takt ligger i en liten store, så helskärmen öppnar där kortet var och tvärtom.

import { create } from 'zustand';
import type { InsightsData, JourneyPt } from './insightsData';

export const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const CATS = [
  { key: 'total', label: 'Total' }, { key: 'pic', label: 'PIC' }, { key: 'ifr', label: 'IFR' },
  { key: 'night', label: 'Night' }, { key: 'nvg', label: 'NVG' }, { key: 'multi_pilot', label: 'Multi-pilot' },
  { key: 'co_pilot', label: 'Co-pilot' }, { key: 'dual', label: 'Dual' }, { key: 'xc', label: 'Cross-country' },
];
export const labelOf = (k: string) => CATS.find((c) => c.key === k)?.label ?? k;

// Milstolpar efter hur mycket tid man har: steg om 50 h under 150 h, sedan 100, 250 och 500.
export const stepFor = (h: number) => (h < 150 ? 50 : h < 500 ? 100 : h < 1500 ? 250 : 500);
export const milestonesFor = (h: number) => { const s = stepFor(h); const m1 = Math.ceil((h + 1) / s) * s; return [m1, m1 + s, m1 + 2 * s, m1 + 5 * s]; };

export const absNow = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
export const absOf = (d: Date) => d.getFullYear() * 12 + d.getMonth();
export const absOfIso = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
export const mLabel = (a: number) => `${MON3[((a % 12) + 12) % 12]} ${Math.floor(a / 12)}`;
export const mShort = (a: number) => `${MON3[((a % 12) + 12) % 12]} ’${String(Math.floor(a / 12)).slice(2)}`;
export const dur = (m: number) => (m < 12 ? `${m} mo` : `${Math.floor(m / 12)} yr${m % 12 ? ` ${m % 12} mo` : ''}`);
export const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const led = (h: number) => (h < 100 ? h.toFixed(1) : String(Math.round(h)));

export type PaceMode = 'r3' | 'r12' | 'career' | 'custom';
export interface ProjectionView { metric: string; target: number | null; paceMode: PaceMode; customPace: number }

// target null = näst närmaste milstolpen.
export const useProjectionView = create<ProjectionView>(() => ({ metric: 'total', target: null, paceMode: 'r12', customPace: 0 }));

export function setProjectionMetric(k: string, t: number | null = null) {
  const s = useProjectionView.getState();
  useProjectionView.setState({ metric: k, target: t, ...(s.paceMode === 'custom' ? { paceMode: 'r12' as PaceMode } : {}) });
}

export interface ProjectionModel {
  series: JourneyPt[]; have: number; monthly: number[];
  P: { r3: number; r12: number; career: number };
  pace: number; snap: number; minTarget: number; tgt: number; toGo: number; etaM: number | null;
  fast: number; slow: number; fastA: number | null; slowA: number | null; hasWindow: boolean;
  mult: number;                 // takten jämfört med 12-månaderstakten (målen skalas med den)
  diff: number; paceDelta: string; paceStep: number;
}

export function projectionModel(D: InsightsData, v: ProjectionView, nowA: number): ProjectionModel {
  const series = D.seriesFor(v.metric);
  const have = series.length ? series[series.length - 1].cum : 0;
  const monthly = series.map((p, i) => p.cum - (i ? series[i - 1].cum : 0));
  const P = {
    r3: monthly.slice(-3).reduce((a, b) => a + b, 0) / 3,
    r12: D.rateFor(v.metric),
    career: series.length ? have / series.length : 0,
  };
  const pace = Math.max(0, v.paceMode === 'custom' ? v.customPace : P[v.paceMode]);
  const snap = stepFor(have) / 10;
  const minTarget = Math.ceil((have + snap) / snap) * snap;
  const tgt = Math.max(minTarget, v.target ?? milestonesFor(have)[1]);
  const toGo = tgt - have;
  const etaM = pace > 0 ? Math.ceil(toGo / pace) : null;
  const natural = [P.r3, P.r12, P.career].filter((p) => p > 0);
  const fast = natural.length ? Math.max(...natural) : 0, slow = natural.length ? Math.min(...natural) : 0;
  const fastA = fast > 0 ? nowA + Math.ceil(toGo / fast) : null, slowA = slow > 0 ? nowA + Math.ceil(toGo / slow) : null;
  const baseM = P.r12 > 0 ? Math.ceil(toGo / P.r12) : null;
  const diff = baseM != null && etaM != null ? baseM - etaM : 0;
  const paceDelta = v.paceMode === 'r12' ? 'Your usual pace'
    : diff === 0 ? 'Same month as your usual pace'
    : diff > 0 ? `${dur(diff)} sooner than usual` : `${dur(-diff)} later than usual`;
  return {
    series, have, monthly, P, pace, snap, minTarget, tgt, toGo, etaM, fast, slow, fastA, slowA,
    hasWindow: fastA != null && slowA != null && fastA !== slowA,
    mult: P.r12 > 0 && pace > 0 ? pace / P.r12 : 1,
    diff, paceDelta, paceStep: P.r12 >= 5 ? 1 : 0.5,
  };
}
