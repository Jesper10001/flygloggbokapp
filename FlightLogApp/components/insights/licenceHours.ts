// Timmar mot ett licenskrav ur loggboken, utan React. Utöver vanliga kolumner finns sammansatta mått
// (ATPL-natt som PIC eller co-pilot, PIC-alternativen med PICUS, tid i helikopter, FAA:s nattkredit för
// landningar) och simulatortid som reglerna låter räknas med ett tak (t.ex. högst 100 h FFS/FNPT mot
// ATPL(A):s 1500 h, varav högst 25 h FNPT). FAA räknar cross-country på avståndet fågelvägen (`xcNm`).

import type { Flight } from '../../types/flight';

export type SimKind = 'FFS' | 'FTD' | 'FNPT_II' | 'FNPT_I' | 'BITD';
export interface SimCredit {
  max: number;                // högst så här många simulatortimmar räknas mot kravet
  fnptMax?: number;           // varav högst så här många i FNPT
  kinds?: SimKind[];          // vilka simulatorer som räknas (utan = alla FSTD)
}
export interface ReqOpts {
  sim?: SimCredit;
  xcNm?: number;              // FAA: cross-country = landning mer än så här många NM fågelvägen från avgången
}
export interface ReqDef extends ReqOpts { label: string; key: string; required: number }
export interface ReqPoint { date: string; cum: number }

// Flygplatsernas positioner och farkostkategori per typ ('airplane' | 'helicopter' | ''), laddas av licenceContext.
export interface LicenceCtx {
  coords: Record<string, { lat: number; lon: number }>;
  cats: Record<string, string>;
}

// Sammansatta mått:
//  night_pc               natt som PIC eller co-pilot (ATPL)
//  atpl_pic_a / _h        EASA-PIC med PICUS-alternativen, som timmar mot 250
//  xc_dual                cross-country-utbildning (dual-tid på XC-flygningar)
//  heli, heli_pic, heli_pic_picus, heli_night, heli_ifr_pic_picus, heli_xc_pic   samma sak i helikopter
//  plane_pic_picus, plane_pic_picus_xc, plane_pic_picus_night                     samma sak i flygplan
//  night_faa_atp          FAA ATP-natt med kredit för nattlandningar (§ 61.159(b))
//  night_xc_dual_<NM>     den längsta natt-XC:n med instruktör, längre än NM fågelvägen (en flygning, inte en summa)
const DERIVED = new Set([
  'night_pc', 'atpl_pic_a', 'atpl_pic_h', 'xc_dual', 'night_faa_atp',
  'heli', 'heli_pic', 'heli_pic_picus', 'heli_night', 'heli_ifr_pic_picus', 'heli_xc_pic',
  'plane_pic_picus', 'plane_pic_picus_xc', 'plane_pic_picus_night',
]);
const MAX_KEY = /^night_xc_dual_(\d+)$/;
export const isDerivedKey = (key: string) => DERIVED.has(key) || MAX_KEY.test(key);
const PIC_KEYS = new Set(['atpl_pic_a', 'atpl_pic_h']);
export const needsTimeline = (key: string, opts?: ReqOpts) =>
  !!opts?.sim || opts?.xcNm != null || isDerivedKey(key) || key.includes('+');

const FSTD: string[] = ['FFS', 'FTD', 'FNPT_II', 'FNPT_I', 'BITD'];
const isFnpt = (k: string) => k === 'FNPT_I' || k === 'FNPT_II';
const n = (f: Flight, k: string) => Number((f as any)[k]) || 0;
const up = (s?: string) => (s || '').trim().toUpperCase();

function nmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Längsta avståndet fågelvägen från avgången till en landningsplats (ankomst eller mellanlandning), i NM.
// null när avgången eller alla landningsplatser saknar position.
export function landingDistNm(f: Flight, ctx?: LicenceCtx | null): number | null {
  const d = ctx?.coords[up(f.dep_place)];
  if (!d) return null;
  let best: number | null = null;
  for (const p of [f.arr_place, (f as any).stop_place as string | undefined]) {
    const c = ctx!.coords[up(p)];
    if (c) best = Math.max(best ?? 0, nmBetween(d, c));
  }
  return best;
}

// Utan xcNm (EASA) räknas XC som avgång ≠ ankomst och minst 0,5 h. Med xcNm (FAA) gäller avståndet,
// och där positionen saknas faller det tillbaka på samma uppskattning.
function isXcFor(f: Flight, xcNm: number | undefined, ctx?: LicenceCtx | null): boolean {
  const rough = f.dep_place !== f.arr_place && (f.total_time || 0) >= 0.5;
  if (xcNm == null) return rough;
  const d = landingDistNm(f, ctx);
  return d == null ? rough : d > xcNm;
}

// Okänd kategori räknas som helikopter i helikopterkraven och som flygplan i flygplanskraven.
const isHeli = (f: Flight, ctx?: LicenceCtx | null) => (ctx?.cats[up(f.aircraft_type)] ?? '') !== 'airplane';
const isPlane = (f: Flight, ctx?: LicenceCtx | null) => (ctx?.cats[up(f.aircraft_type)] ?? '') !== 'helicopter';

// Ett flygpass bidrag till ett summerbart krav (samma regler som Insights).
export function flightValue(f: Flight, key: string, xcNm?: number, ctx?: LicenceCtx | null): number {
  if (key.includes('+')) { const [a, b] = key.split('+'); return n(f, a) > 0 ? n(f, b) : 0; }
  const tt = f.total_time || 0, pp = n(f, 'pic') + n(f, 'picus');
  switch (key) {
    case 'total': return tt;
    case 'xc': return isXcFor(f, xcNm, ctx) ? tt : 0;
    case 'xc_pic': return (isXcFor(f, xcNm, ctx) && n(f, 'pic') > 0) ? tt : 0;
    case 'xc_dual': return isXcFor(f, xcNm, ctx) ? n(f, 'dual') : 0;
    case 'night_pc': return Math.min(n(f, 'night'), n(f, 'pic') + n(f, 'co_pilot') + n(f, 'picus'));
    case 'heli': return isHeli(f, ctx) ? tt : 0;
    case 'heli_pic': return isHeli(f, ctx) ? n(f, 'pic') : 0;
    case 'heli_pic_picus': return isHeli(f, ctx) ? Math.min(tt, pp) : 0;
    case 'heli_night': return isHeli(f, ctx) ? n(f, 'night') : 0;
    case 'heli_ifr_pic_picus': return isHeli(f, ctx) ? Math.min(n(f, 'ifr'), pp) : 0;
    case 'heli_xc_pic': return (isHeli(f, ctx) && isXcFor(f, xcNm, ctx) && n(f, 'pic') > 0) ? tt : 0;
    case 'plane_pic_picus': return isPlane(f, ctx) ? Math.min(tt, pp) : 0;
    case 'plane_pic_picus_xc': return (isPlane(f, ctx) && isXcFor(f, xcNm, ctx)) ? Math.min(tt, pp) : 0;
    case 'plane_pic_picus_night': return isPlane(f, ctx) ? Math.min(n(f, 'night'), pp) : 0;
  }
  return n(f, key);
}

// Simulatorpassets tid för kravet: hela passet mot total tid och klasstid; mot IFR den loggade IFR-tiden,
// annars hela passet om det flögs IFR (simpass sparas med IFR = 0 och flygreglerna satta).
function simValue(f: Flight, key: string): number {
  if (key === 'total' || key === 'me_time') return f.total_time || 0;
  if (key === 'ifr' || key === 'dual+ifr') return n(f, 'ifr') > 0 ? n(f, 'ifr') : /^(IFR|Y|Z)$/.test(f.flight_rules || '') ? (f.total_time || 0) : 0;
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

// § 61.159(b): efter 20 nattstarter och -landningar till full stop räknas varje ytterligare som 1 h natt, högst 25 h.
export const faaNightCredit = (nightH: number, toN: number, fsN: number) =>
  nightH + Math.min(25, Math.max(0, Math.min(toN, fsN) - 20));

// Kravets kumulativa värde efter varje pass i tidsordning. Simulatorpass räknas bara med `sim`,
// i den ordning de flögs tills taket är nått.
export function reqTimeline(flights: Flight[], key: string, opts?: ReqOpts, ctx?: LicenceCtx | null): ReqPoint[] {
  const sim = opts?.sim, xcNm = opts?.xcNm;
  const items = flights
    .filter((f) => !!f.date && (f.flight_type !== 'sim' || !!sim))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.dep_utc || '').localeCompare(b.dep_utc || '') || ((a.id ?? 0) - (b.id ?? 0)));
  const picKey = PIC_KEYS.has(key), nightAtp = key === 'night_faa_atp';
  const maxNm = MAX_KEY.exec(key);
  let sum = 0, pic = 0, picus = 0, picusMp = 0, toN = 0, fsN = 0, simSum = 0, fnpt = 0;
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
    } else if (nightAtp) {
      sum += n(f, 'night'); toN += n(f, 'takeoffs_night'); fsN += n(f, 'landings_fs_night');
    } else if (maxNm) {
      // En enda flygning: med instruktör, i mörker och längre bort än gränsen. Okänd position räknas inte.
      const d = n(f, 'dual') > 0 ? landingDistNm(f, ctx) : null;
      const v = d != null && d > Number(maxNm[1]) ? Math.min(n(f, 'night'), f.total_time || 0) : 0;
      if (v <= sum) continue;
      sum = v;
    } else {
      const v = flightValue(f, key, xcNm, ctx);
      if (v <= 0) continue;
      sum += v;
    }
    const base = picKey ? picCredit(key, pic, picus, picusMp) : nightAtp ? faaNightCredit(sum, toN, fsN) : sum;
    out.push({ date: f.date, cum: base + simSum });
  }
  return out;
}

export const reqHave = (flights: Flight[], key: string, opts?: ReqOpts, ctx?: LicenceCtx | null): number => {
  const t = reqTimeline(flights, key, opts, ctx);
  return t.length ? t[t.length - 1].cum : 0;
};
