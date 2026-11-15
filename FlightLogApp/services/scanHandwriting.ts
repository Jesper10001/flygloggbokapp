// Handstilsprofilen: siffror som förväxlas i pilotens handstil (t.ex. att 5:or läses som 6:or), lärda av
// användarens rättningar i skanningen. Ren logik utan I/O (scripts/test-scan-handwriting.cjs).
//
// Spärrarna (för att en felaktig regel inte ska sprida fel i tysthet):
//   • Bara rättningar av Claudes egen läsning räknas (inte rättningar av egna rättningar), en gång per cell.
//   • En förväxling gäller först efter MIN_CORRECTIONS rättningar, och bara om motsatt förväxling är sällsynt.
//   • Profilen rättar bara när något annat i boken bekräftar det: blocktiden (avgång–ankomst) eller sidans summa,
//     och bara när just den rättningen ensam får det att gå ihop. Annars blir cellen gul med förslaget, och bara
//     om raden eller kolumnen inte går ihop som den står. Celler användaren själv rört lämnas alltid ifred.
//   • Allt som rättats kan ångras; att ångra nollställer förväxlingen.
//   • Claude får förväxlingen som en uppmaning att flagga, aldrig att läsa om.

export const MIN_CORRECTIONS = 3;

/** Profilen per loggbok. pairs["6>5"] = antal rättningar där Claude läste 6 och det skulle vara 5. */
export interface HandwritingProfile { v: 1; pairs: Record<string, number> }

export const emptyProfile = (): HandwritingProfile => ({ v: 1, pairs: {} });

export const HAND_FIELDS = new Set([
  'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'multi_pilot', 'single_pilot',
  'picus', 'spic', 'nvg', 'sim', 'se_time', 'me_time', 'dep_utc', 'arr_utc', 'landings_day', 'landings_night',
]);
const COUNTS = new Set(['landings_day', 'landings_night']);

const digitsOf = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');

/**
 * Siffrorna som byttes i en rättning: samma antal siffror och högst två som skiljer sig. "8267" → "8257" ger
 * [{ read: '6', actual: '5' }]. Annat (ett helt annat tal, en siffra mer eller mindre) säger inget om handstilen.
 */
export function digitSwaps(from: unknown, to: unknown): { read: string; actual: string }[] {
  const a = digitsOf(from), b = digitsOf(to);
  if (!a || a.length !== b.length || a === b) return [];
  const out: { read: string; actual: string }[] = [];
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) out.push({ read: a[k], actual: b[k] });
  return out.length <= 2 ? out : [];
}

/** Lägger till en rättning i profilen. Returnerar en ny profil. */
export function recordCorrection(p: HandwritingProfile, swaps: { read: string; actual: string }[]): HandwritingProfile {
  if (!swaps.length) return p;
  const pairs = { ...p.pairs };
  for (const s of swaps) pairs[`${s.read}>${s.actual}`] = (pairs[`${s.read}>${s.actual}`] ?? 0) + 1;
  return { ...p, pairs };
}

/** Förväxlingar som gäller: minst MIN_CORRECTIONS rättningar, och motsatt håll högst hälften så ofta. */
export function activePairs(p: HandwritingProfile, blocked: Set<string> = new Set()): { read: string; actual: string; n: number }[] {
  return Object.entries(p.pairs)
    .map(([k, n]) => { const [read, actual] = k.split('>'); return { read, actual, n, key: k }; })
    .filter((x) => !blocked.has(x.key) && x.n >= MIN_CORRECTIONS && (p.pairs[`${x.actual}>${x.read}`] ?? 0) <= x.n / 2)
    .map(({ read, actual, n }) => ({ read, actual, n }));
}

/** Raden till Claudes instruktion: en uppmaning att flagga, inte att läsa om. Tom sträng utan förväxlingar. */
export function handwritingHint(p: HandwritingProfile): string {
  const act = activePairs(p);
  if (!act.length) return '';
  const list = act.map((x) => `${x.actual} som kan se ut som ${x.read}`).join(', ');
  return `PILOTENS HANDSTIL (lärt av pilotens egna rättningar): siffror som förväxlas: ${list}. Läs varje siffra som vanligt — ändra ALDRIG en läsning bara på grund av detta. Men när en sådan siffra i en tid, ett klockslag eller en landning kan vara någon av dem: lägg cellen i field_issues med suggested_value = det andra alternativet.`;
}

export interface HandRow { key: string; page: number; skip?: boolean; data: Record<string, any> }
export interface HandFix { rowKey: string; field: string; from: string; to: string; pair: string; why: 'block' | 'total' }
export interface HandSuggestion { rowKey: string; field: string; value: string; pair: string; reason: string }

const num = (v: unknown) => parseFloat(String(v ?? '0').replace(',', '.')) || 0;
const clockMin = (s?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Går flygtiden ihop med avgång–ankomst (plus bokens tillägg)? null = går inte att avgöra. Gräns 6 min. */
function blockFits(d: Record<string, any>, add: number): boolean | null {
  if (d.flight_type === 'sim') return null;
  const dep = clockMin(d.dep_utc), arr = clockMin(d.arr_utc), total = num(d.total_time);
  if (dep == null || arr == null || !(total > 0)) return null;
  const block = ((arr - dep + 1440) % 1440) / 60;
  return Math.abs(total - add - block) <= 0.1 + 1e-9;
}

/** Varianter av värdet där en förekomst av read byts mot actual ("16:46", 6>5 → "15:46", "16:45"). */
function variants(value: string, read: string, actual: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < value.length; k++) if (value[k] === read) out.push(value.slice(0, k) + actual + value.slice(k + 1));
  return out;
}

/**
 * Går igenom skanningens celler med de förväxlingar som gäller. Rättar (fixes) bara där blocktiden eller sidans
 * summa bekräftar, och bara när just den varianten ensam får det att gå ihop; föreslår (suggestions) där raden
 * eller kolumnen inte går ihop som den står. untouchable = celler ("rowKey|field") som inte får röras.
 * printed[page][field] = sidans summa (redan rimlighetskontrollerad, som columnTotals).
 */
export function handwritingSweep(
  rows: HandRow[],
  pairs: { read: string; actual: string }[],
  printed: Record<number, Record<string, number>>,
  untouchable: Set<string>,
  add = 0,
): { fixes: HandFix[]; suggestions: HandSuggestion[] } {
  const fixes: HandFix[] = [], suggestions: HandSuggestion[] = [];
  if (!pairs.length) return { fixes, suggestions };
  type Cand = { row: HandRow; field: string; from: string; to: string; pair: string };
  const cands: Cand[] = [];
  for (const row of rows) {
    if (row.skip) continue;
    for (const field of HAND_FIELDS) {
      const v = String(row.data[field] ?? '');
      if (!v || untouchable.has(`${row.key}|${field}`)) continue;
      if ((row.data.field_issues ?? []).some((x: { field: string }) => x.field === field)) continue;   // har redan en fråga
      for (const p of pairs) for (const to of variants(v, p.read, p.actual)) {
        if (COUNTS.has(field) ? !/^\d+$/.test(to) : CLOCK_RE(field) ? clockMin(to) == null : !Number.isFinite(num(to))) continue;
        cands.push({ row, field, from: v, to, pair: `${p.read}>${p.actual}` });
      }
    }
  }
  if (!cands.length) return { fixes, suggestions };

  const sumOf = (page: number, field: string, swap?: Cand) => rows.filter((r) => r.page === page).reduce((s, r) => {
    if (field === 'total_time' && r.data.flight_type === 'sim') return s;
    const v = swap && swap.row === r && swap.field === field ? swap.to : r.data[field];
    return s + num(v);
  }, 0);
  const totalOk = (page: number, field: string, swap?: Cand): boolean | null => {
    const p = printed[page]?.[field];
    if (typeof p !== 'number') return null;
    return Math.abs(sumOf(page, field, swap) - p) < (COUNTS.has(field) ? 0.5 : 0.05);
  };
  const withSwap = (c: Cand) => ({ ...c.row.data, [c.field]: c.to });

  // Bevis per kandidat: blocktiden eller summan går ihop med varianten men inte som det står.
  const evidence = (c: Cand): 'block' | 'total' | null => {
    if (c.field === 'total_time' || c.field === 'dep_utc' || c.field === 'arr_utc') {
      const now = blockFits(c.row.data, add), alt = blockFits(withSwap(c), add);
      if (now === false && alt === true) return 'block';
      if (now === true && alt === false) return null;   // raden går ihop som den står: rör inte
    }
    if (totalOk(c.row.page, c.field) === false && totalOk(c.row.page, c.field, c) === true) return 'total';
    return null;
  };
  const proven = cands.map((c) => ({ c, why: evidence(c) })).filter((x) => x.why) as { c: Cand; why: 'block' | 'total' }[];
  // Ensam: ingen annan kandidat med bevis i samma rad (blocktid) eller samma kolumn på sidan (summa).
  for (const x of proven) {
    const rivals = proven.filter((y) => y !== x && (x.why === 'block'
      ? y.why === 'block' && y.c.row === x.c.row
      : y.why === 'total' && y.c.row.page === x.c.row.page && y.c.field === x.c.field));
    if (rivals.length) continue;
    if (fixes.some((f) => f.rowKey === x.c.row.key && f.field === x.c.field)) continue;
    fixes.push({ rowKey: x.c.row.key, field: x.c.field, from: x.c.from, to: x.c.to, pair: x.c.pair, why: x.why });
  }

  // Förslag: raden eller kolumnen går inte ihop som den står, och varianten för den närmare. Högst tre kandidater
  // per kolumn och sida (fler = för osäkert att peka ut en cell; sidans summafråga tar det).
  const blockGap = (d: Record<string, any>) => {
    const dep = clockMin(d.dep_utc), arr = clockMin(d.arr_utc), total = num(d.total_time);
    return dep == null || arr == null || !(total > 0) || d.flight_type === 'sim' ? null : Math.abs(total - add - ((arr - dep + 1440) % 1440) / 60);
  };
  const totalGap = (page: number, field: string, swap?: Cand) => {
    const p = printed[page]?.[field];
    return typeof p === 'number' ? Math.abs(sumOf(page, field, swap) - p) : null;
  };
  const helps = (c: Cand): 'block' | 'total' | null => {
    if (c.field === 'total_time' || CLOCK_RE(c.field)) {
      const now = blockGap(c.row.data), alt = blockGap(withSwap(c));
      if (now != null && now > 0.1 + 1e-9 && alt != null && alt < now - 1e-9) return 'block';
    }
    const now = totalGap(c.row.page, c.field), alt = totalGap(c.row.page, c.field, c);
    const tol = COUNTS.has(c.field) ? 0.5 : 0.05;
    return now != null && now >= tol && alt != null && alt < now - 1e-9 ? 'total' : null;
  };
  const helping = cands.filter((c) => !fixes.some((f) => f.rowKey === c.row.key && f.field === c.field))
    .map((c) => ({ c, how: helps(c) })).filter((x) => x.how) as { c: Cand; how: 'block' | 'total' }[];
  for (const { c, how } of helping) {
    if (suggestions.some((x) => x.rowKey === c.row.key && x.field === c.field)) continue;
    const crowd = new Set(helping.filter((y) => y.how === 'total' && y.c.row.page === c.row.page && y.c.field === c.field).map((y) => y.c.row.key)).size;
    if (how === 'total' && crowd > 3) continue;
    const [read, actual] = c.pair.split('>');
    suggestions.push({ rowKey: c.row.key, field: c.field, value: c.to, pair: c.pair, reason: `Your ${actual}s can look like ${read}s. Is it ${c.to}?` });
  }
  return { fixes, suggestions };
}

function CLOCK_RE(field: string) { return field === 'dep_utc' || field === 'arr_utc'; }
