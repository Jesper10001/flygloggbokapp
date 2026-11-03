// Exakta positioner för granskningen med hjälp av Apple Vision (on-device textigenkänning).
//
// 1. logbookBounds: var i ett foto loggboken sitter (det största sammanhängande textområdet), så att
//    bilden kan beskäras till boken innan Claude läser den — t.ex. ett foto ur kamerarullen med bord runt.
// 2. alignGrid: Claudes rutnät är ungefärligt. Värden Claude läste (datum, registreringar, ICAO, tider …)
//    matchas mot Visions ord, och en robust linjär anpassning (x och y för sig) flyttar rutnätet dit orden
//    faktiskt sitter. Tryckta rader är lika höga, så det räcker med en förskjutning och en skala per axel.
//
// Ren logik utan I/O → testbar (scripts/test-scan-geometry.cjs).

import type { PageGrid, Rect } from './scanGeometry';
import { cellRect, rowBand } from './scanGeometry';

export interface VisionBox { text: string; x: number; y: number; w: number; h: number; confidence?: number } // 0–1, origo uppe till vänster

const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function withinEdit1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return withinEdit1(b, a);
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; }
    else { if (++edits > 1) return false; if (la === lb) { i++; j++; } else { j++; } }
  }
  return edits + (lb - j) <= 1;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/**
 * Loggbokens område i bilden, eller null om det inte går att avgöra (för lite text). Tar den största
 * gruppen ord i höjdled (statusrader, skärmknappar och liknande längre bort faller bort) och lägger till
 * en marginal så att tabellens kanter kommer med.
 */
export function logbookBounds(words: VisionBox[]): Rect | null {
  const ws = words.filter((w) => norm(w.text).length >= 1 && w.h > 0 && w.h < 0.12 && w.w < 0.95);
  if (ws.length < 12) return null;

  // Grupper i höjdled: ett glapp större än 6 % av bilden delar grupperna.
  const sorted = [...ws].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const groups: VisionBox[][] = [];
  let cur: VisionBox[] = [];
  let lastBottom = -1;
  for (const w of sorted) {
    if (cur.length && w.y - lastBottom > 0.06) { groups.push(cur); cur = []; lastBottom = -1; }
    cur.push(w);
    lastBottom = Math.max(lastBottom, w.y + w.h);
  }
  if (cur.length) groups.push(cur);
  const main = groups.sort((a, b) => b.length - a.length)[0];
  if (!main || main.length < 12) return null;

  const x0 = quantile(main.map((w) => w.x), 0.01);
  const x1 = quantile(main.map((w) => w.x + w.w), 0.99);
  const y0 = Math.min(...main.map((w) => w.y));
  const y1 = Math.max(...main.map((w) => w.y + w.h));
  const padX = (x1 - x0) * 0.04, padY = (y1 - y0) * 0.08;
  const x = Math.max(0, x0 - padX), y = Math.max(0, y0 - padY);
  return { x, y, w: Math.min(1, x1 + padX) - x, h: Math.min(1, y1 + padY) - y };
}

/**
 * Hur mycket läsbar text Vision hittade: antal tecken viktat med säkerheten. Rättvänd text ger mycket
 * högre poäng än text på tvären, så den vridning som ger högst poäng är den där boken står rätt.
 */
export function textScore(words: VisionBox[]): number {
  return words.reduce((s, w) => s + norm(w.text).length * (typeof w.confidence === 'number' ? w.confidence : 0.5), 0);
}

// Tryckta rubriker ovanför tabellen och texter på summeringsraderna under den (EASA-loggböcker).
const HEAD_KEYS = ['DEPARTURE', 'ARRIVAL', 'ROUTE', 'AIRCRAFT', 'LANDING', 'REMARK', 'FUNCTION', 'SYNTHETIC', 'OPERAT', 'REGISTR', 'VARIANT'];
const FOOT_KEYS = ['THISPAGE', 'TODATE', 'PAGE', 'CERTIFIED', 'SIGNATURE', 'CORRECT'];

/**
 * Hur rättvänd en vridning av bilden ser ut, utifrån var Vision hittade orden (px = bildens storlek i pixlar).
 * Textmängden duger inte: Vision läser text på högkant nästan lika bra som rättvänd (0° = 822, 90° = 859).
 *  - Rättvänd text ger ord som är bredare än höga; på högkant blir de höga och smala.
 *  - Rubrikerna ("Departure", "Pilot function time", "Landings" …) står ovanför "Total this page"/"Total to
 *    date" — avgör upp och ner (90° mot 270°, 0° mot 180°).
 * Att ett uppslag är liggande vägs in av den som anropar (bokens område, inte hela fotot).
 */
export function orientationScore(words: VisionBox[], pxW: number, pxH: number): number {
  const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : null);
  const centresY = (keys: string[]) => words.filter((w) => { const n = norm(w.text); return keys.some((k) => n.includes(k)); }).map((w) => w.y + w.h / 2);
  let s = 0;
  const multi = words.filter((w) => norm(w.text).length >= 4);
  if (multi.length >= 5) s += 4 * (multi.filter((w) => w.w * pxW > w.h * pxH).length / multi.length - 0.5);
  const hy = med(centresY(HEAD_KEYS)), fy = med(centresY(FOOT_KEYS));
  if (hy != null && fy != null) s += hy < fy ? 3 : -3;
  return s;
}

/**
 * Bokens bredd/höjd i pixlar, från hur långt orden sträcker sig (2–98 %), eller hela bildens om orden inte
 * räcker. (Inte logbookBounds: den delar orden i rader uppifrån och ner, och på en bok som står på högkant
 * blir varje kolumn en egen "rad" — boken ser då bred ut.)
 */
export function bookAspect(words: VisionBox[], pxW: number, pxH: number): number {
  const ws = words.filter((w) => norm(w.text).length >= 2);
  if (ws.length < 12) return pxW / pxH;
  const x0 = quantile(ws.map((w) => w.x), 0.02), x1 = quantile(ws.map((w) => w.x + w.w), 0.98);
  const y0 = quantile(ws.map((w) => w.y), 0.02), y1 = quantile(ws.map((w) => w.y + w.h), 0.98);
  return ((x1 - x0) * pxW) / Math.max(1e-6, (y1 - y0) * pxH);
}

/**
 * Hur mycket boken lutar i fotot, i grader (positivt = raderna lutar nedåt åt höger), eller 0 när det inte
 * går att säga säkert. Ett foto är sällan helt rakt, och redan 2° gör att en rad glider mer än en rad över ett
 * uppslag.
 *
 * Följer riktiga textrader: varje ord kopplas till närmaste ord till höger som står på nästan samma höjd
 * (högst ~70 % av ordhöjden upp eller ner), så att kedjan aldrig kan hoppa till nästa rad. (En projektion
 * över hela bilden lurades av tabellens rutnät: orden i rader och kolumner bildar diagonaler, och
 * radavstånd/kolumnavstånd gav en falsk lutning på ~5,6°.) En rät linje anpassas till varje kedja som
 * sträcker sig en bit över bilden; svaret är medianen. Lutar kedjorna olika (t.ex. vänster och höger sida åt
 * olika håll) returneras 0 — då rättar radmätningen per sida i stället.
 */
export function estimateSkew(words: VisionBox[], pxW: number, pxH: number): number {
  const ws = words
    .filter((w) => norm(w.text).length >= 1 && w.h > 0 && w.h < 0.08)
    .map((w) => ({ x: (w.x + w.w / 2) * pxW, y: (w.y + w.h / 2) * pxH, h: w.h * pxH, w: w.w * pxW }))
    .sort((a, b) => a.x - b.x);
  if (ws.length < 20) return 0;
  const medW = [...ws].sort((a, b) => a.w - b.w)[ws.length >> 1].w;
  const maxDx = Math.max(medW * 4, pxW * 0.08);

  // Närmaste granne till höger på samma höjd; varje ord tas högst en gång som granne.
  const next = new Array<number>(ws.length).fill(-1);
  const taken = new Set<number>();
  for (let i = 0; i < ws.length; i++) {
    let best = -1, bestDx = Infinity;
    for (let j = i + 1; j < ws.length && ws[j].x - ws[i].x <= maxDx; j++) {
      const dx = ws[j].x - ws[i].x;
      if (dx < medW * 0.3 || taken.has(j)) continue;
      if (Math.abs(ws[j].y - ws[i].y) > 0.7 * Math.max(ws[i].h, ws[j].h)) continue;
      if (dx < bestDx) { bestDx = dx; best = j; }
    }
    if (best >= 0) { next[i] = best; taken.add(best); }
  }
  const angles: number[] = [];
  for (let i = 0; i < ws.length; i++) {
    if (taken.has(i)) continue;                      // kedjan börjar bara vid ett ord utan granne till vänster
    const chain: typeof ws = [];
    for (let k = i; k >= 0; k = next[k]) chain.push(ws[k]);
    if (chain.length < 4 || chain[chain.length - 1].x - chain[0].x < pxW * 0.2) continue;
    const mx = chain.reduce((u, p) => u + p.x, 0) / chain.length, my = chain.reduce((u, p) => u + p.y, 0) / chain.length;
    let num = 0, den = 0;
    for (const p of chain) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
    if (den > 0) angles.push((Math.atan(num / den) * 180) / Math.PI);
  }
  if (angles.length < 3) return 0;
  angles.sort((a, b) => a - b);
  const q = (f: number) => angles[Math.min(angles.length - 1, Math.floor(f * angles.length))];
  if (q(0.75) - q(0.25) > 1.5) return 0;            // raderna lutar olika → ingen gemensam vridning
  return Math.round(q(0.5) * 100) / 100;
}

/** Flyttar ord till en beskuren bilds koordinater (och tar bort ord utanför). */
export function wordsInCrop(words: VisionBox[], crop: Rect): VisionBox[] {
  return words
    .map((w) => ({ ...w, x: (w.x - crop.x) / crop.w, y: (w.y - crop.y) / crop.h, w: w.w / crop.w, h: w.h / crop.h }))
    .filter((w) => w.x + w.w > 0 && w.x < 1 && w.y + w.h > 0 && w.y < 1);
}

export interface AlignRow { rowIndex: number; values: Record<string, string> }
export interface AlignResult { grid: PageGrid; matchesX: number; matchesY: number }

interface Pair { pred: number; obs: number; weight: number }

// Robust linjär anpassning obs = a + b·pred: prova linjer genom par av matchningar, välj den med flest
// punkter inom toleransen, och anpassa sedan med minsta kvadrat på de punkterna.
function robustFit(pairs: Pair[], tol: number, bMin: number, bMax: number): { a: number; b: number; inliers: number } | null {
  if (pairs.length < 3) return null;
  let best: { a: number; b: number; score: number } | null = null;
  const cand = pairs.length > 60 ? pairs.slice(0, 60) : pairs;
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const p = cand[i], q = cand[j];
      if (Math.abs(q.pred - p.pred) < 0.02) continue;
      const b = (q.obs - p.obs) / (q.pred - p.pred);
      if (b < bMin || b > bMax) continue;
      const a = p.obs - b * p.pred;
      let score = 0;
      for (const r of pairs) if (Math.abs(a + b * r.pred - r.obs) < tol) score += r.weight;
      if (!best || score > best.score) best = { a, b, score };
    }
  }
  // Ren förskjutning som reserv (alla matchningar på nästan samma rad/kolumn).
  for (const p of pairs) {
    const a = p.obs - p.pred;
    let score = 0;
    for (const r of pairs) if (Math.abs(a + r.pred - r.obs) < tol) score += r.weight;
    if (!best || score > best.score + 0.5) best = { a, b: 1, score };
  }
  if (!best) return null;
  const inl = pairs.filter((r) => Math.abs(best!.a + best!.b * r.pred - r.obs) < tol);
  if (inl.length < 3) return null;
  // Minsta kvadrat på inliers (viktat), med skalan begränsad.
  const sw = inl.reduce((s, r) => s + r.weight, 0);
  const mx = inl.reduce((s, r) => s + r.weight * r.pred, 0) / sw;
  const my = inl.reduce((s, r) => s + r.weight * r.obs, 0) / sw;
  const sxx = inl.reduce((s, r) => s + r.weight * (r.pred - mx) ** 2, 0);
  const sxy = inl.reduce((s, r) => s + r.weight * (r.pred - mx) * (r.obs - my), 0);
  let b = sxx > 1e-6 ? sxy / sxx : best.b;
  b = Math.max(bMin, Math.min(bMax, b));
  return { a: my - b * mx, b, inliers: inl.length };
}

/**
 * Justerar rutnätet efter var Vision hittade Claudes värden. Returnerar oförändrat rutnät om det inte
 * finns tillräckligt med säkra matchningar.
 */
export function alignGrid(grid: PageGrid, rows: AlignRow[], words: VisionBox[]): AlignResult {
  const tokens = words.map((w) => ({ ...w, n: norm(w.text) })).filter((w) => w.n.length >= 2);
  const rowH = (grid.tableBottom - grid.tableTop) / Math.max(1, grid.rowsPerPage);
  const ys: Pair[] = [], xs: Pair[] = [];

  for (const row of rows) {
    for (const [field, raw] of Object.entries(row.values)) {
      const v = norm(raw);
      if (v.length < 3) continue;                     // "1.4" o.d. finns på för många ställen
      const cell = cellRect(grid, row.rowIndex, field);
      if (!cell) continue;
      const hits = tokens.filter((t) => t.n === v || (v.length >= 4 && (t.n.includes(v) || withinEdit1(t.n, v))));
      if (hits.length === 0 || hits.length > 6) continue;
      const weight = 1 / hits.length;
      for (const h of hits) {
        ys.push({ pred: cell.y + cell.h / 2, obs: h.y + h.h / 2, weight });
        // x bara när ordet är ungefär värdet (inte en hel rad text som råkar innehålla det).
        if (h.n.length <= v.length + 2) xs.push({ pred: cell.x + cell.w / 2, obs: h.x + h.w / 2, weight });
      }
    }
  }

  const fy = robustFit(ys, Math.max(0.006, rowH * 0.45), 0.4, 2.5);
  const fx = robustFit(xs, 0.025, 0.7, 1.4);
  const mapY = (y: number) => (fy ? fy.a + fy.b * y : y);
  const mapX = (x: number) => (fx ? fx.a + fx.b * x : x);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  return {
    grid: {
      ...grid,
      tableTop: clamp01(mapY(grid.tableTop)),
      tableBottom: clamp01(mapY(grid.tableBottom)),
      columns: grid.columns.map((c) => ({ ...c, left: clamp01(mapX(c.left)), right: clamp01(mapX(c.right)) })),
      source: fy || fx ? 'aligned' : grid.source,
      xform: { ax: fx?.a ?? 0, bx: fx?.b ?? 1, ay: fy?.a ?? 0, by: fy?.b ?? 1 },
    },
    matchesX: fx?.inliers ?? 0,
    matchesY: fy?.inliers ?? 0,
  };
}

/**
 * Mäter var varje rad faktiskt står (per sida av uppslaget) med hjälp av Visions ord: för varje värde Claude
 * läst söks samma text i dess cell nära där rutnätet tror att raden är. Radens mitt blir medianen av träffarna.
 * Ger rowCenters i rutnätet, så att rutorna följer en buktande sida i stället för att glida en halv rad fel.
 *
 * Två steg, eftersom ett värde som står på flera rader ("ETHB", "1.7") kan träffa grannraden när raden är
 * förskjuten: först värden som bara finns på en rad (datum, klockslag) i ett brett fönster, sedan alla värden
 * i ett smalt fönster runt de redan rättade raderna. Punkter som avviker från grannarna slängs.
 * Körs efter completeGridFromHeaders, så att även högersidans kolumner (tider, landningar) räknas med.
 */
export function measureRows(grid: PageGrid, rows: AlignRow[], words: VisionBox[]): PageGrid {
  const tokens = words.map((w) => ({ ...w, n: norm(w.text) })).filter((w) => w.n.length >= 1);
  const h = (grid.tableBottom - grid.tableTop) / Math.max(1, grid.rowsPerPage);
  const spine = grid.spine ?? 0.5;
  type Side = 'left' | 'right';

  // Hur många rader som har samma värde i samma fält (1 = unikt på sidan).
  const seen = new Map<string, number>();
  for (const row of rows) for (const [f, raw] of Object.entries(row.values)) {
    const k = `${f}|${norm(raw)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }

  type Pt = { x: number; y: number };
  // winY: hur långt från radens förväntade höjd (i rader), winX: hur långt utanför kolumnen (i kolumnbredder).
  const collect = (g: PageGrid, onlyUnique: boolean, winY: number, winX: number) => {
    const found: Record<Side, Map<number, Pt[]>> = { left: new Map(), right: new Map() };
    for (const row of rows) {
      for (const [field, raw] of Object.entries(row.values)) {
        const v = norm(raw);
        if (v.length < 2 || v === '00') continue;
        if (onlyUnique && (seen.get(`${field}|${v}`) ?? 0) > 1) continue;
        const cell = cellRect(g, row.rowIndex, field);
        if (!cell) continue;
        const cy = cell.y + cell.h / 2;
        const hits = tokens.filter((t) => {
          const tx = t.x + t.w / 2, ty = t.y + t.h / 2;
          if (tx < cell.x - cell.w * winX || tx > cell.x + cell.w * (1 + winX) || Math.abs(ty - cy) > h * winY) return false;
          return t.n === v || (v.length >= 4 && (t.n.includes(v) || withinEdit1(t.n, v)));
        });
        if (hits.length === 0) continue;
        const best = hits.reduce((p, q) => (Math.abs(p.y + p.h / 2 - cy) <= Math.abs(q.y + q.h / 2 - cy) ? p : q));
        const side: Side = cell.x + cell.w / 2 >= spine ? 'right' : 'left';
        const list = found[side].get(row.rowIndex) ?? [];
        list.push({ x: best.x + best.w / 2, y: best.y + best.h / 2 });
        found[side].set(row.rowIndex, list);
      }
    }
    return found;
  };

  const median = (xs: number[]) => { const s2 = [...xs].sort((p, q) => p - q); const m = s2.length >> 1; return s2.length % 2 ? s2[m] : (s2[m - 1] + s2[m]) / 2; };
  // Lutningen inom en sida: på varje rad med träffar långt isär jämförs höjden; medianen av dy/dx.
  const slopeOf = (m: Map<number, Pt[]>): { slope: number; xref: number } | undefined => {
    const all = [...m.values()].flat();
    if (all.length < 4) return undefined;
    const samples: number[] = [];
    for (const pts of m.values()) {
      const sorted = [...pts].sort((p, q) => p.x - q.x);
      for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
        const dx = sorted[j].x - sorted[i].x;
        if (dx >= 0.06) samples.push((sorted[j].y - sorted[i].y) / dx);
      }
    }
    if (samples.length < 3) return undefined;
    const slope = Math.max(-0.2, Math.min(0.2, median(samples)));
    return { slope, xref: median(all.map((p) => p.x)) };
  };
  // Radens mitt vid xref = median av träffarna (lutningen räknad bort); en punkt vars avvikelse skiljer sig mer
  // än 0,3 rad från grannarnas slängs.
  const clean = (m: Map<number, Pt[]>, sl?: { slope: number; xref: number }): [number, number][] => {
    const pts = [...m.entries()]
      .map(([r, ps]) => [r, median(ps.map((p) => p.y - (sl ? sl.slope * (p.x - sl.xref) : 0)))] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    const off = pts.map(([r, y]) => y - (grid.tableTop + (r - 0.5) * h));
    return pts.filter((_, i) => Math.abs(off[i] - median(off.slice(Math.max(0, i - 2), i + 3))) <= h * 0.3);
  };
  const build = (found: Record<Side, Map<number, Pt[]>>): PageGrid => {
    const sl = { left: slopeOf(found.left), right: slopeOf(found.right) };
    return { ...grid, spine, rowSlopes: sl, rowCenters: { left: clean(found.left, sl.left), right: clean(found.right, sl.right) } };
  };

  // Steg 1: unika värden (datum, klockslag) i ett brett fönster — tål sneda och förskjutna kolumner.
  const g1 = build(collect(grid, true, 0.9, 0.6));
  // Steg 2: alla värden i ett smalt fönster runt de redan rättade (och lutade) raderna.
  const g2 = build(collect(g1, false, 0.45, 0.2));
  const n = (g: PageGrid) => (g.rowCenters?.left?.length ?? 0) + (g.rowCenters?.right?.length ?? 0);
  if (n(g2) > 0) return g2;
  return n(g1) > 0 ? g1 : grid;
}

// Tryckta kolumnrubriker → fält. Används när Claudes rutnät saknar en kolumn (t.ex. hela högersidan).
const HEADER_FIELDS: [RegExp, string][] = [
  [/^DUAL$/, 'dual'],
  [/^PIC$/, 'pic'],
  [/^COPILOT/, 'co_pilot'],
  [/^INSTRUCTOR/, 'instructor'],
  [/^IFR$/, 'ifr'],
  [/^NIGHT$/, 'night'],
  [/^REMARKS?/, 'remarks'],
  [/^SYNTHETIC/, 'sim'],
];

/**
 * De tryckta underrubrikerna "D" och "N" under "Landings": var dag- och natthalvan står. Ett D med ett N strax
 * till höger på samma höjd (närmast landningsrubriken om den finns).
 */
function landingSubHeaders(header: VisionBox[], landing: VisionBox | undefined): { d: number; n: number } | null {
  const cx = (w: VisionBox) => w.x + w.w / 2;
  const ds = header.filter((w) => norm(w.text) === 'D');
  const ns = header.filter((w) => norm(w.text) === 'N');
  let best: { d: number; n: number; score: number } | null = null;
  for (const d of ds) for (const n of ns) {
    const gap = cx(n) - cx(d);
    if (gap < 0.008 || gap > 0.12 || Math.abs((d.y + d.h / 2) - (n.y + n.h / 2)) > 0.02) continue;
    const mid = (cx(d) + cx(n)) / 2;
    if (landing && (mid < landing.x - 0.05 || mid > landing.x + landing.w + 0.05)) continue;
    const score = landing ? Math.abs(mid - cx(landing)) : 0;
    if (!best || score < best.score) best = { d: cx(d), n: cx(n), score };
  }
  return best ? { d: best.d, n: best.n } : null;
}

/**
 * Lägger till kolumner som saknas i rutnätet, utifrån var Vision hittade de tryckta rubrikerna ovanför
 * tabellen. "Landings" delas i dag/natt (vänster/höger halva). Befintliga kolumner rörs inte, utom
 * landningarnas: de tryckta "D" och "N" visar exakt var halvorna står och går före Claudes kolumner, som
 * lätt hamnar en kolumn fel där talen står tätt.
 */
export function completeGridFromHeaders(grid: PageGrid, words: VisionBox[]): PageGrid {
  const header = words.filter((w) => w.y + w.h <= grid.tableTop + 0.01 && w.y >= grid.tableTop - 0.3);
  const added: PageGrid['columns'] = [];
  const pad = 0.004;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const landing = header.find((w) => norm(w.text).includes('LANDING'));
  let landX: [number, number] | null = null;
  let g = grid;
  const dn = landingSubHeaders(header, landing);
  if (dn) {
    const half = (dn.n - dn.d) / 2;
    const split = (dn.d + dn.n) / 2;
    const day = { field: 'landings_day', label: 'Landings day', left: clamp01(dn.d - half), right: split };
    const night = { field: 'landings_night', label: 'Landings night', left: split, right: clamp01(dn.n + half) };
    const centre = (c?: { left: number; right: number }) => (c ? (c.left + c.right) / 2 : NaN);
    const off = (field: string, want: { left: number; right: number }) => {
      const c = g.columns.find((x) => x.field === field);
      return !c || !(Math.abs(centre(c) - centre(want)) <= half * 0.5);
    };
    if (off('landings_day', day) || off('landings_night', night)) {
      g = { ...g, columns: [...g.columns.filter((c) => c.field !== 'landings_day' && c.field !== 'landings_night'), day, night].sort((a, b) => a.left - b.left) };
    }
    landX = [day.left, night.right];
  }
  const have = new Set(g.columns.map((c) => c.field).filter(Boolean));

  if (landing && !landX) {
    // "Day/Night" under rubriken ger en säkrare bredd än själva ordet "Landings".
    const sub = header.find((w) => norm(w.text).includes('DAYNIGHT') || norm(w.text) === 'DN');
    const src = sub ?? landing;
    landX = [clamp01(src.x - pad), clamp01(src.x + src.w + pad)];
    const mid = (landX[0] + landX[1]) / 2;
    if (!have.has('landings_day')) added.push({ field: 'landings_day', label: 'Landings day', left: landX[0], right: mid });
    if (!have.has('landings_night')) added.push({ field: 'landings_night', label: 'Landings night', left: mid, right: landX[1] });
  }
  for (const w of header) {
    const t = norm(w.text);
    const hit = HEADER_FIELDS.find(([re]) => re.test(t));
    if (!hit) continue;
    const field = hit[1];
    const cx = w.x + w.w / 2;
    if (field === 'night' && landX && cx >= landX[0] && cx <= landX[1]) continue;   // "Night" i landningsrubriken
    if (have.has(field) || added.some((c) => c.field === field)) continue;
    added.push({ field, label: w.text, left: clamp01(w.x - pad), right: clamp01(w.x + w.w + pad) });
  }
  if (added.length === 0) return g;
  return { ...g, columns: [...g.columns, ...added].sort((a, b) => a.left - b.left) };
}

// Talfält vars kolumn kan flyttas om värdena står någon annanstans.
const NUMERIC_FIELDS = ['total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'multi_pilot', 'single_pilot', 'nvg'];

/**
 * Flyttar ett talfälts kolumn dit värdena faktiskt står. Exempel: piloten skriver simulatortid i en handskriven
 * kolumn "Simulator time" under "Other type of flight time", men rutnätet kopplade sim till den tryckta
 * kolumnen "Synthetic training session", som är tom. Då hamnar ringar och avläsningar på fel ställe.
 *
 * För varje talfält med värden på minst två rader räknas hur ofta Vision läser samma siffror i fältets kolumn.
 * Hittas de nästan aldrig där, men på de flesta rader i en annan kolumn som inte används av något annat fält,
 * kopplas fältet om till den kolumnen (den gamla blir omappad).
 */
export function relocateColumnsByValues(grid: PageGrid, rows: { rowIndex: number; values: Record<string, string | undefined> }[], words: VisionBox[]): { grid: PageGrid; moved: string[] } {
  const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  const used = new Set(NUMERIC_FIELDS.filter((f) => rows.some((r) => Number(r.values[f]) > 0)));
  const inCell = (col: { left: number; right: number }, rowIndex: number) => {
    const band = rowBand(grid, rowIndex, (col.left + col.right) / 2);
    const w = col.right - col.left;
    const inside = words.filter((t) => {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      return cx >= col.left && cx <= col.right && cy >= band.y && cy <= band.y + band.h && t.w <= w * 1.6;
    });
    return digits(inside.map((t) => t.text).join(''));
  };
  let columns = grid.columns;
  const moved: string[] = [];
  for (const field of NUMERIC_FIELDS) {
    // På simulatorrader är total = simulatortiden, så de säger inget om var total tid står.
    const withValue = rows.filter((r) => Number(r.values[field]) > 0 && !(field === 'total_time' && r.values.flight_type === 'sim'));
    if (withValue.length < 2) continue;
    const col = columns.find((c) => c.field === field);
    const hitsIn = (c: { left: number; right: number }) => withValue.filter((r) => inCell(c, r.rowIndex) === digits(r.values[field])).length;
    const here = col ? hitsIn(col) : 0;
    if (here > withValue.length * 0.25) continue;
    let best: { c: typeof columns[number]; n: number } | null = null;
    for (const c of columns) {
      if (c === col || (c.field && (used.has(c.field) || !NUMERIC_FIELDS.includes(c.field) && !/^other/.test(c.field)))) continue;
      const n = hitsIn(c);
      if (n > (best?.n ?? 0)) best = { c, n };
    }
    if (!best || best.n < Math.max(2, Math.ceil(withValue.length * 0.6))) {
      // Ingen kolumn i rutnätet där värdena står (t.ex. en handskriven "Simulator time" som Claude inte gav
      // någon kolumn): kolumnen läggs där Vision läser värdena — samma x på raderna, utanför kolumner som
      // redan hör till andra fält (total, dual …, där samma tal kan stå).
      const taken = columns.filter((c) => c.field && c.field !== field && used.has(c.field));
      const xsAt: number[] = [];
      for (const r of withValue) {
        const want = digits(r.values[field]);
        const hits = words.filter((t) => {
          const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
          const b = rowBand(grid, r.rowIndex, cx);
          return cy >= b.y && cy <= b.y + b.h && digits(t.text) === want && !taken.some((c) => cx >= c.left && cx <= c.right);
        });
        if (hits.length === 1) xsAt.push(hits[0].x + hits[0].w / 2);
      }
      if (xsAt.length < Math.max(2, Math.ceil(withValue.length * 0.6))) continue;
      const sx = [...xsAt].sort((u, v) => u - v);
      if (sx[sx.length - 1] - sx[0] > 0.04) continue;                    // inte en kolumn
      const mid = sx[Math.floor(sx.length / 2)];
      const widths = columns.filter((c) => c.field && NUMERIC_FIELDS.includes(c.field)).map((c) => c.right - c.left).sort((u, v) => u - v);
      const w = col ? col.right - col.left : widths.length ? widths[Math.floor(widths.length / 2)] : 0.04;
      // En omappad kolumn (eller "other…") som redan täcker platsen tar fältet; annars en ny kolumn där.
      const host = columns.find((c) => c !== col && mid >= c.left && mid <= c.right && (!c.field || /^other/.test(c.field)));
      if (col && mid >= col.left && mid <= col.right) continue;
      const cleared = columns.map((c) => (c === col ? { ...c, field: null } : c));
      columns = host
        ? cleared.map((c) => (c === host ? { ...c, field } : c))
        : [...cleared, { field, label: col?.label ?? field, left: mid - w / 2, right: mid + w / 2 }].sort((a, b) => a.left - b.left);
      moved.push(`${field} → där värdena står (x ${Math.round(mid * 100)} %)`);
      continue;
    }
    const target = best.c;
    columns = columns.map((c) => (c === target ? { ...c, field } : c === col ? { ...c, field: null } : c));
    moved.push(`${field} → "${target.label}"`);
  }
  return { grid: moved.length ? { ...grid, columns } : grid, moved };
}

/**
 * Siffrorna Vision läser i en cell (ord vars mitt ligger i cellen och som inte spänner över flera
 * kolumner). Null om cellen saknas eller är tom.
 */
export function visionDigitsInCell(grid: PageGrid, rowIndex: number, field: string, words: VisionBox[], margin = 0): string | null {
  const cell = cellRect(grid, rowIndex, field);
  if (!cell) return null;
  // margin: ordets mitt måste ligga minst så långt (andel av cellbredden) från cellens sidor — för smala
  // halvor (dag/natt) där ett handskrivet tal kan ligga över skiljelinjen.
  const inside = words.filter((w) => {
    const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
    return cx >= cell.x + cell.w * margin && cx <= cell.x + cell.w * (1 - margin) && cy >= cell.y && cy <= cell.y + cell.h && w.w <= cell.w * 1.6;
  });
  const digits = inside.map((w) => w.text.replace(/[^0-9]/g, '')).join('');
  return digits && digits.length <= 3 ? digits : null;
}

/**
 * Jämför Claudes landningar med vad Vision läser i samma cell. Returnerar granskningspunkter för celler
 * där de skiljer sig (eller där Claude inte läste något och appen bara fyllt i standardvärdet).
 */
export function crossCheckCounts(
  grid: PageGrid,
  rows: { rowIndex: number; read: Record<string, string | undefined> }[],
  words: VisionBox[],
): { rowIndex: number; field: string; vision: string; read: string }[] {
  const out: { rowIndex: number; field: string; vision: string; read: string }[] = [];
  for (const r of rows) {
    const day = visionDigitsInCell(grid, r.rowIndex, 'landings_day', words, 0.1);
    const nightRaw = visionDigitsInCell(grid, r.rowIndex, 'landings_night', words, 0.25);
    const night = nightRaw && nightRaw === day ? null : nightRaw;   // samma tal över skiljelinjen → dag
    for (const field of ['landings_day', 'landings_night']) {
      const vision = field === 'landings_day' ? day : night;
      if (!vision) continue;
      const read = r.read[field];
      const same = read != null && read !== '' && Number(read) === Number(vision);
      if (!same) out.push({ rowIndex: r.rowIndex, field, vision: String(Number(vision)), read: read ?? '' });
    }
  }
  return out;
}

// ── Bokens kolumner: samma tryck på varje uppslag ────────────────────────────────────────────────────────────
// Varje uppslag läses för sig, och Claude uppskattar kolumnernas lägen på nytt varje gång. Ibland anges de i
// procent av en sida i stället för hela uppslaget (kolumnerna blir utdragna eller hoptryckta). Men de tryckta
// kolumnerna är desamma i hela boken; bara fotot skiljer (förskjutning och skala, per sida av uppslaget).
// Därför: kolumnerna från uppslaget som stämmer bäst med bilden blir bokens mall, och mallen läggs på de andra
// uppslagen med Visions ord som ankare. Det som stämmer bäst med orden i bilden vinner, så ett bra rutnät byts
// aldrig mot ett sämre.

export interface BookColumns { columns: PageGrid['columns']; spine: number; score: number }
export interface GridChoice { grid: PageGrid; source: 'own' | 'repaired' | 'book'; score: number; scores: Record<string, number> }

const LEFT_FIELDS = new Set(['date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time', 'ifr', 'night']);
const RIGHT_FIELDS = new Set(['pic', 'co_pilot', 'dual', 'instructor', 'sim', 'landings_day', 'landings_night', 'remarks', 'second_pilot']);
const NUMERIC_VALUE = new Set(['total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'landings_day', 'landings_night', 'multi_pilot', 'single_pilot', 'nvg']);
// Värden som nästan bara står på ett ställe på raden: bra ankare för kolumnerna.
const ANCHOR_VALUES = ['dep_utc', 'arr_utc', 'registration', 'date'];
const COLUMN_HEADERS: [RegExp, string][] = [...HEADER_FIELDS, [/^TOTAL$/, 'total_time']];

const digitsOf = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');

/**
 * Hur väl rutnätet stämmer med bilden: andelen värden som Vision läser i "sin" cell, med avdrag för kolumner som
 * går in i varandra eller har orimlig bredd (en jättebred kolumn skulle annars träffa allt).
 */
export function gridScore(grid: PageGrid, rows: AlignRow[], words: VisionBox[]): number {
  const tokens = words.map((w) => ({ ...w, n: norm(w.text) })).filter((w) => w.n.length >= 1);
  let hits = 0, total = 0;
  for (const row of rows) {
    for (const [field, raw] of Object.entries(row.values)) {
      const numeric = NUMERIC_VALUE.has(field);
      const v = numeric ? digitsOf(raw) : norm(raw);
      if (!v || v === '0' || (!numeric && v.length < 3)) continue;
      const cell = cellRect(grid, row.rowIndex, field);
      if (!cell || !grid.columns.some((c) => c.field === field)) { total++; continue; }
      total++;
      const inside = tokens.filter((t) => {
        const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
        return cx >= cell.x && cx <= cell.x + cell.w && cy >= cell.y && cy <= cell.y + cell.h && t.w <= cell.w * 1.6;
      });
      const hit = numeric
        ? digitsOf(inside.map((t) => t.text).join('')) === v
        : inside.some((t) => t.n === v || (v.length >= 4 && withinEdit1(t.n, v)));
      if (hit) hits++;
    }
  }
  if (total === 0) return -1;
  const cols = grid.columns.filter((c) => c.field).slice().sort((a, b) => a.left - b.left);
  const widths = cols.map((c) => c.right - c.left).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  let faults = 0;
  cols.forEach((c, i) => {
    if (i > 0 && cols[i - 1].right - c.left > 0.012) faults++;
    const w = c.right - c.left;
    if (c.field !== 'remarks' && (w > median * 2.6 || w < median * 0.35)) faults++;
  });
  return hits / total - faults * 0.06;
}

/**
 * Lägger bokens mall på ett nytt foto: en förskjutning och skala per sida av uppslaget, anpassad mot tryckta
 * rubriker och värden som bara står på ett ställe (klockslag, registreringar). Null utan säkra ankare.
 */
export function mapBookColumns(book: BookColumns, grid: PageGrid, rows: AlignRow[], words: VisionBox[]): PageGrid | null {
  const tokens = words.map((w) => ({ ...w, n: norm(w.text) })).filter((w) => w.n.length >= 2);
  const centre = (c: { left: number; right: number }) => (c.left + c.right) / 2;
  const colOf = (field: string) => book.columns.find((c) => c.field === field);
  const pairs: { pred: number; obs: number; weight: number }[] = [];

  const header = words.filter((w) => w.y + w.h <= grid.tableTop + 0.01 && w.y >= grid.tableTop - 0.3);
  const seen = new Set<string>();
  for (const w of header) {
    const hit = COLUMN_HEADERS.find(([re]) => re.test(norm(w.text)));
    const col = hit && colOf(hit[1]);
    if (!hit || !col || seen.has(hit[1])) continue;
    seen.add(hit[1]);
    pairs.push({ pred: centre(col), obs: w.x + w.w / 2, weight: 2 });
  }
  const dn = landingSubHeaders(header, header.find((w) => norm(w.text).includes('LANDING')));
  if (dn) {
    const d = colOf('landings_day'), n = colOf('landings_night');
    if (d) pairs.push({ pred: centre(d), obs: dn.d, weight: 2 });
    if (n) pairs.push({ pred: centre(n), obs: dn.n, weight: 2 });
  }
  for (const row of rows) {
    for (const field of ANCHOR_VALUES) {
      const v = norm(row.values[field]);
      const col = colOf(field);
      if (!col || v.length < 3) continue;
      const hits = tokens.filter((t) => t.n === v);
      if (hits.length === 1) pairs.push({ pred: centre(col), obs: hits[0].x + hits[0].w / 2, weight: 1 });
    }
  }

  const fit = (ps: typeof pairs) => robustFit(ps, 0.02, 0.6, 1.6);
  const all = fit(pairs);
  const left = fit(pairs.filter((p) => p.pred < book.spine)) ?? all;
  const right = fit(pairs.filter((p) => p.pred >= book.spine)) ?? all;
  if (!left && !right) return null;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const columns = book.columns.map((c) => {
    const f = (centre(c) < book.spine ? left : right) ?? left ?? right!;
    return { ...c, left: clamp01(f.a + f.b * c.left), right: clamp01(f.a + f.b * c.right) };
  }).sort((a, b) => a.left - b.left);
  const onLeft = book.columns.filter((c) => centre(c) < book.spine);
  const spineAt = left ? left.a + left.b * Math.max(...onLeft.map((c) => c.right), book.spine) : grid.spine ?? 0.5;
  return { ...grid, columns, spine: clamp01(spineAt) };
}

/**
 * Claude angav en sidas kolumner i procent av sidan i stället för hela uppslaget: vänstersidans fält sträcker sig
 * över ryggen, eller högersidans börjar före den. Då skalas de om till rätt halva. Null om inget tyder på det.
 */
export function repairHalfPageColumns(grid: PageGrid): PageGrid | null {
  const spine = grid.spine ?? 0.5;
  const onLeft = grid.columns.filter((c) => c.field && LEFT_FIELDS.has(c.field));
  const onRight = grid.columns.filter((c) => c.field && RIGHT_FIELDS.has(c.field));
  const leftWide = onLeft.length >= 2 && Math.max(...onLeft.map((c) => c.right)) > spine + 0.05;
  const rightWide = onRight.length >= 2 && Math.min(...onRight.map((c) => c.left)) < spine - 0.05;
  if (!leftWide && !rightWide) return null;
  const columns = grid.columns.map((c) => {
    if (leftWide && c.field && LEFT_FIELDS.has(c.field)) return { ...c, left: c.left * spine, right: c.right * spine };
    if (rightWide && c.field && RIGHT_FIELDS.has(c.field)) return { ...c, left: spine + c.left * (1 - spine), right: spine + c.right * (1 - spine) };
    return c;
  });
  return { ...grid, columns: columns.sort((a, b) => a.left - b.left) };
}

/** Bästa rutnätet för uppslaget: det egna, det omskalade eller bokens mall, efter hur väl de stämmer med bilden. */
export function chooseBookGrid(own: PageGrid, rows: AlignRow[], words: VisionBox[], book: BookColumns | null): GridChoice {
  const ownScore = gridScore(own, rows, words);
  let best: GridChoice = { grid: own, source: 'own', score: ownScore, scores: { own: ownScore } };
  const consider = (g: PageGrid | null, source: GridChoice['source']) => {
    if (!g) return;
    const measured = measureRows(g, rows, words);
    const score = gridScore(measured, rows, words);
    best.scores[source] = score;
    if (score > best.score + 0.03) best = { ...best, grid: measured, source, score };
  };
  const fixed = repairHalfPageColumns(own);
  if (fixed) consider(alignGrid(fixed, rows, words).grid, 'repaired');
  if (book) consider(mapBookColumns(book, own, rows, words), 'book');
  return best;
}
