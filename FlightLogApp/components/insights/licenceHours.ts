// Timmar mot ett licenskrav ur loggboken, utan React. Utöver vanliga kolumner finns sammansatta mått
// (ATPL-natt som PIC eller co-pilot, PIC-alternativen med PICUS för ATPL) och simulatortid som Part-FCL
// låter räknas med ett tak (t.ex. högst 100 h FFS/FNPT mot ATPL(A):s 1500 h, varav högst 25 h FNPT).

import type { Flight } from '../../types/flight';

export type SimKind = 'FFS' | 'FTD' | 'FNPT_II' | 'FNPT_I' | 'BITD';
export interface SimCredit {
  max: number;                // högst så här många simulatortimmar räknas mot kravet
  fnptMax?: number;           // varav högst så här många i FNPT
  kinds?: SimKind[];          // vilka simulatorer som räknas (utan = alla FSTD)
}
export interface ReqDef { label: string; key: string; required: number; sim?: SimCredit }
export interface ReqPoint { date: string; cum: number }

// night_pc: natt som PIC eller co-pilot (ATPL). atpl_pic_a/_h: PIC-kravet med PICUS-alternativen,
// uttryckt som timmar mot 250 (uppfyllt exakt när något av FCL.510-alternativen är uppfyllt).
export const DERIVED_KEYS = new Set(['night_pc', 'atpl_pic_a', 'atpl_pic_h']);
const PIC_KEYS = new Set(['atpl_pic_a', 'atpl_pic_h']);
export const needsTimeline = (key: string, sim?: SimCredit) => !!sim || DERIVED_KEYS.has(key);

const FSTD: string[] = ['FFS', 'FTD', 'FNPT_II', 'FNPT_I', 'BITD'];
const isFnpt = (k: string) => k === 'FNPT_I' || k === 'FNPT_II';
const n = (f: Flight, k: string) => Number((f as any)[k]) || 0;
const isXC = (f: Flight) => f.dep_place !== f.arr_place && (f.total_time || 0) >= 0.5;

// Ett flygpass bidrag till ett summerbart krav (samma regler som Insights).
export function flightValue(f: Flight, key: string): number {
  if (key.includes('+')) { const [a, b] = key.split('+'); return n(f, a) > 0 ? n(f, b) : 0; }
  if (key === 'total') return f.total_time || 0;
  if (key === 'xc') return isXC(f) ? (f.total_time || 0) : 0;
  if (key === 'xc_pic') return (isXC(f) && n(f, 'pic') > 0) ? (f.total_time || 0) : 0;
  if (key === 'night_pc') return Math.min(n(f, 'night'), n(f, 'pic') + n(f, 'co_pilot') + n(f, 'picus'));
  return n(f, key);
}

// Simulatorpassets tid för kravet: hela passet mot total tid; mot IFR den loggade IFR-tiden,
// annars hela passet om det flögs IFR (simpass sparas med IFR = 0 och flygreglerna satta).
function simValue(f: Flight, key: string): number {
  if (key === 'total') return f.total_time || 0;
  if (key === 'ifr') return n(f, 'ifr') > 0 ? n(f, 'ifr') : /^(IFR|Y|Z)$/.test(f.flight_rules || '') ? (f.total_time || 0) : 0;
  return 0;
}

// FCL.510.A(b)(2): 500 h PICUS, eller 250 h PIC, eller 250 h med minst 70 h PIC och resten PICUS.
// FCL.510.H(c)(2): 250 h PIC, eller 100 h PIC + 150 h PICUS, eller 250 h PICUS i multi-pilot-helikopter.
export function picCredit(key: string, pic: number, picus: number, picusMp: number): number {
  if (key === 'atpl_pic_a') {
    const p = Math.min(pic, 250);
    return Math.max(Math.min(picus, 500) / 2, p + Math.min(picus, Math.max(0, 250 - Math.max(p, 70))));
  }
  return Math.max(Math.min(pic, 250), Math.min(pic, 100) + Math.min(picus, 150), Math.min(picusMp, 250));
}

// Kravets kumulativa värde efter varje pass i tidsordning. Simulatorpass räknas bara med `sim`,
// i den ordning de flögs tills taket är nått.
export function reqTimeline(flights: Flight[], key: string, sim?: SimCredit): ReqPoint[] {
  const items = flights
    .filter((f) => !!f.date && (f.flight_type !== 'sim' || !!sim))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.dep_utc || '').localeCompare(b.dep_utc || '') || ((a.id ?? 0) - (b.id ?? 0)));
  const picKey = PIC_KEYS.has(key);
  let sum = 0, pic = 0, picus = 0, picusMp = 0, simSum = 0, fnpt = 0;
  const out: ReqPoint[] = [];
  for (const f of items) {
    if (f.flight_type === 'sim') {
      const cat = f.sim_category || '';
      // Okänd simulatortyp räknas bara där alla FSTD godkänns. CPT/PPT och CBT räknas aldrig.
      if (!(sim!.kinds ? (sim!.kinds as string[]).includes(cat) : cat === '' || FSTD.includes(cat))) continue;
      let v = simValue(f, key);
      if (isFnpt(cat) && sim!.fnptMax != null) v = Math.min(v, sim!.fnptMax - fnpt);
      v = Math.min(v, sim!.max - simSum);
      if (v <= 0) continue;
      simSum += v;
      if (isFnpt(cat)) fnpt += v;
    } else if (picKey) {
      const pu = n(f, 'picus');
      pic += n(f, 'pic'); picus += pu;
      if (n(f, 'multi_pilot') > 0) picusMp += pu;
    } else {
      const v = flightValue(f, key);
      if (v <= 0) continue;
      sum += v;
    }
    out.push({ date: f.date, cum: (picKey ? picCredit(key, pic, picus, picusMp) : sum) + simSum });
  }
  return out;
}

export const reqHave = (flights: Flight[], key: string, sim?: SimCredit): number => {
  const t = reqTimeline(flights, key, sim);
  return t.length ? t[t.length - 1].cum : 0;
};
