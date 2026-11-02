// Geometri för granskningsvyn: var på den skannade bilden en rad, en kolumn eller ett enskilt värde sitter.
// Allt är normaliserat 0–1 (x från vänster, y uppifrån) relativt HELA bilden som skickades till skannern.
// Ren logik utan I/O → testbar (scripts/test-scan-geometry.cjs).
//
// Skannern anger tabellens över- och underkant (table_top/table_bottom) och varje kolumns kanter. Tryckta
// loggboksrader är lika höga, så rad n ligger på table_top + (n-1)·radhöjd. Saknas skannerns geometri
// används mallens relativa kolumnbredder och en uppskattad tabellhöjd.

import type { LogbookLayout } from './logbookLayout';

export interface GridColumn {
  field: string | null;   // flight-fältet kolumnen mappar till (null = omappad kolumn)
  label: string;
  left: number;
  right: number;
}

export interface PageGrid {
  tableTop: number;
  tableBottom: number;
  rowsPerPage: number;
  columns: GridColumn[];
  source: 'scanner' | 'template' | 'aligned';
  // Rättningen från alignGrid (obs = a + b·pred per axel) — används för Claudes egna rutor kring värden.
  xform?: { ax: number; bx: number; ay: number; by: number };   // aligned = justerat mot Apple Visions ord (scanAlign.ts)
  // Uppmätta radmitter (y) per sida av uppslaget, från Visions ord på raden: [radnummer, y]. Raderna är inte
  // jämnt fördelade när sidan buktar (nära ryggen); mellan mätpunkterna interpoleras avvikelsen (measureRows).
  rowCenters?: { left?: [number, number][]; right?: [number, number][] };
  // Radernas lutning inom varje sida (dy/dx i bildens andelar) kring xref — ett snett foto, eller sidor som
  // lutar olika (bok i V-form). rowCenters gäller vid xref.
  rowSlopes?: { left?: { slope: number; xref: number }; right?: { slope: number; xref: number } };
  spine?: number;            // x där uppslaget delas i vänster/höger sida (standard 0.5)
}

export interface Rect { x: number; y: number; w: number; h: number }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Rå geometri från skannerns verktygsanrop (procent 0–100), redan omräknad till hela bilden.
export interface RawGrid {
  table_top?: number;
  table_bottom?: number;
  rows_printed?: number;
  columns?: { index?: number; field?: string; label?: string; left?: number; right?: number }[];
}

/** Flyttar en halvsidas geometri (split vid ryggen) till hela uppslagets koordinater. */
export function remapRawGridX(raw: RawGrid | undefined, offsetPct: number, scale: number): RawGrid | undefined {
  if (!raw) return raw;
  return {
    ...raw,
    columns: (raw.columns ?? []).map((c) => ({
      ...c,
      left: typeof c.left === 'number' ? offsetPct + c.left * scale : c.left,
      right: typeof c.right === 'number' ? offsetPct + c.right * scale : c.right,
    })),
  };
}

/** Samma omräkning för ett fältproblems ruta (procent). */
export function remapBoxX<T extends { left?: number; right?: number }>(box: T | undefined, offsetPct: number, scale: number): T | undefined {
  if (!box) return box;
  return {
    ...box,
    left: typeof box.left === 'number' ? offsetPct + box.left * scale : box.left,
    right: typeof box.right === 'number' ? offsetPct + box.right * scale : box.right,
  };
}

/**
 * Bygger sidans rutnät. `columnList` är kolumnerna i den ordning skannern fick dem (index 1…n), så att
 * skannerns `index` kan översättas till fält. Returnerar null om varken skannern eller mallen ger något.
 */
// Skannern ska ange procent (0–100), men vissa modeller skriver bråk (0–1). Är alla värden ≤ 1,5 tolkas
// de som bråk och skalas till procent, så att geometrin inte kastas som "för smal".
function toPercentGrid(raw: RawGrid | undefined): RawGrid | undefined {
  if (!raw) return raw;
  const vals = [raw.table_top, raw.table_bottom, ...(raw.columns ?? []).flatMap((c) => [c.left, c.right])]
    .map(Number).filter(Number.isFinite);
  if (vals.length === 0 || Math.max(...vals) > 1.5) return raw;
  const k = (n?: number) => (typeof n === 'number' ? n * 100 : n);
  return {
    ...raw,
    table_top: k(raw.table_top), table_bottom: k(raw.table_bottom),
    columns: (raw.columns ?? []).map((c) => ({ ...c, left: k(c.left), right: k(c.right) })),
  };
}

export function buildPageGrid(
  rawIn: RawGrid | undefined,
  layout: LogbookLayout | null,
  columnList: { field: string | null; label: string }[] | null,
  preferScanner = false,   // foto (skanningsgranskningen): mallens bredder stämmer inte med bilden → Claudes kolumner
): PageGrid | null {
  const raw = toPercentGrid(rawIn);
  const printed = Number(raw?.rows_printed);
  const rowsPerPage = layout?.rowsPerPage && layout.rowsPerPage > 0
    ? layout.rowsPerPage
    : (Number.isFinite(printed) && printed >= 4 && printed <= 40 ? printed : 0);
  const top = Number(raw?.table_top), bottom = Number(raw?.table_bottom);
  const scannerRows = Number.isFinite(top) && Number.isFinite(bottom) && bottom - top > 10;

  const cols: GridColumn[] = [];
  for (const c of raw?.columns ?? []) {
    const left = Number(c.left), right = Number(c.right);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right - left < 0.3) continue;
    let field: string | null = typeof c.field === 'string' && c.field ? c.field : null;
    let label = (typeof c.label === 'string' && c.label) || field || '';
    const idx = Number(c.index);
    if (columnList && Number.isFinite(idx) && idx >= 1 && idx <= columnList.length) {
      field = columnList[idx - 1].field ?? field;
      label = columnList[idx - 1].label;
    }
    cols.push({ field, label, left: clamp01(left / 100), right: clamp01(right / 100) });
  }
  cols.sort((a, b) => a.left - b.left);

  const templateCols = layout ? templateColumns(layout) : [];
  // Skannerns kolumner används om de täcker en rimlig del av mallens; annars mallens bredder.
  const useScannerCols = cols.length >= (preferScanner ? 3 : Math.max(3, Math.round(templateCols.length * 0.5)));
  const columns = useScannerCols ? cols : templateCols;
  if (columns.length === 0) return null;

  return {
    tableTop: scannerRows ? clamp01(top / 100) : 0.2,
    tableBottom: scannerRows ? clamp01(bottom / 100) : 0.86,
    rowsPerPage: rowsPerPage || 12,
    columns,
    source: useScannerCols && scannerRows ? 'scanner' : 'template',
  };
}

// Mallens kolumner utlagda efter relativ bredd: vänster sida 0…ryggen, höger sida ryggen…1.
export function templateColumns(layout: LogbookLayout): GridColumn[] {
  const out: GridColumn[] = [];
  const place = (cols: LogbookLayout['columns'], from: number, to: number) => {
    const total = cols.reduce((s, c) => s + (c.width || 50), 0) || 1;
    let x = from;
    for (const c of cols) {
      const w = ((c.width || 50) / total) * (to - from);
      out.push({ field: c.field, label: c.label, left: x, right: x + w });
      x += w;
    }
  };
  const left = layout.columns.filter((c) => c.page === 'left');
  const right = layout.columns.filter((c) => c.page === 'right');
  if (right.length === 0) place(left, 0.02, 0.98);
  else {
    place(left, 0.02, layout.leftWidthFraction - 0.01);
    place(right, layout.leftWidthFraction + 0.01, 0.98);
  }
  return out;
}

export function rowHeight(grid: PageGrid): number {
  return (grid.tableBottom - grid.tableTop) / Math.max(1, grid.rowsPerPage);
}

// Radens mitt (y). Utan mätpunkter jämnt fördelat mellan tableTop och tableBottom. Med mätpunkter (rowCenters)
// för samma sida av uppslaget: avvikelsen från den jämna fördelningen interpoleras linjärt mellan punkterna och
// hålls konstant utanför dem. Saknar sidan punkter lånas den andra sidans.
export function rowCenter(grid: PageGrid, rowIndex: number, x?: number): number {
  const h = rowHeight(grid);
  const uniform = (r: number) => grid.tableTop + (r - 0.5) * h;
  const side = x != null && x >= (grid.spine ?? 0.5) ? 'right' : 'left';
  const own = grid.rowCenters?.[side];
  const useSide = own && own.length ? side : side === 'left' ? 'right' : 'left';
  const anchors = grid.rowCenters?.[useSide];
  // Lutningen inom sidan: raden ligger högre/lägre ju längre från xref kolumnen står.
  const sl = grid.rowSlopes?.[side] ?? grid.rowSlopes?.[useSide];
  const tilt = sl && x != null ? sl.slope * (x - sl.xref) : 0;
  if (!anchors || anchors.length === 0) return uniform(rowIndex) + tilt;
  const off = anchors.map(([r, y]) => [r, y - uniform(r)] as const);
  if (rowIndex <= off[0][0]) return uniform(rowIndex) + off[0][1] + tilt;
  const last = off[off.length - 1];
  if (rowIndex >= last[0]) return uniform(rowIndex) + last[1] + tilt;
  for (let i = 0; i < off.length - 1; i++) {
    const [r0, o0] = off[i], [r1, o1] = off[i + 1];
    if (rowIndex >= r0 && rowIndex <= r1) return uniform(rowIndex) + o0 + ((rowIndex - r0) / (r1 - r0)) * (o1 - o0) + tilt;
  }
  return uniform(rowIndex) + tilt;
}

/** Radens band (y, höjd) vid x — höjden följer avståndet till grannraderna. */
export function rowBand(grid: PageGrid, rowIndex: number, x?: number): { y: number; h: number } {
  const h0 = rowHeight(grid);
  const c = rowCenter(grid, rowIndex, x);
  const local = (rowCenter(grid, rowIndex + 1, x) - rowCenter(grid, rowIndex - 1, x)) / 2;
  const h = Math.min(h0 * 1.4, Math.max(h0 * 0.6, local || h0));
  return { y: c - h / 2, h };
}

/** Radens rektangel över hela tabellbredden. rowIndex är den tryckta positionen, 1 = översta raden. */
export function rowRect(grid: PageGrid, rowIndex: number): Rect {
  const left = grid.columns[0]?.left ?? 0;
  const right = grid.columns[grid.columns.length - 1]?.right ?? 1;
  const band = rowBand(grid, rowIndex);
  return { x: left, y: band.y, w: right - left, h: band.h };
}

// Fält som delar kolumn i vissa mallar (t.ex. "Departure place" + "time" i en grupp) hittas ändå via
// närmaste släkting, så att en ruta aldrig saknas för ett vanligt fält.
const FIELD_FALLBACK: Record<string, string[]> = {
  sim_category: ['sim', 'total_time'],
  other_time_role: ['other_flight_time', 'remarks'],
  flight_type: ['sim', 'total_time'],
  tng_count: ['landings_day', 'remarks'],
  stop_place: ['remarks'],
  second_pilot: ['remarks'],
};

export function columnFor(grid: PageGrid, field: string): GridColumn | null {
  const exact = grid.columns.find((c) => c.field === field);
  if (exact) return exact;
  for (const alt of FIELD_FALLBACK[field] ?? []) {
    const hit = grid.columns.find((c) => c.field === alt);
    if (hit) return hit;
  }
  return null;
}

/** Cellens rektangel, eller null om fältet saknar kolumn i boken. */
export function cellRect(grid: PageGrid, rowIndex: number, field: string): Rect | null {
  const col = columnFor(grid, field);
  if (!col) return null;
  const band = rowBand(grid, rowIndex, (col.left + col.right) / 2);
  return { x: col.left, y: band.y, w: col.right - col.left, h: band.h };
}

/** Skannerns egen ruta kring ett värde (procent) → Rect, om den är rimlig. */
export function boxRect(box: { left?: number; top?: number; right?: number; bottom?: number } | undefined): Rect | null {
  if (!box) return null;
  let l = Number(box.left), t = Number(box.top), r = Number(box.right), b = Number(box.bottom);
  if ([l, t, r, b].every((n) => Number.isFinite(n) && n <= 1.5)) { l *= 100; t *= 100; r *= 100; b *= 100; }   // bråk → procent
  if (![l, t, r, b].every(Number.isFinite) || r - l < 0.2 || b - t < 0.2) return null;
  return { x: clamp01(l / 100), y: clamp01(t / 100), w: clamp01((r - l) / 100), h: clamp01((b - t) / 100) };
}

/** Claudes ruta (procent) med samma rättning som rutnätet fick av Apple Vision. */
export function mappedBoxRect(box: { left?: number; top?: number; right?: number; bottom?: number } | undefined, grid: PageGrid | null): Rect | null {
  const r = boxRect(box);
  if (!r || !grid?.xform) return r;
  const { ax, bx, ay, by } = grid.xform;
  return { x: ax + bx * r.x, y: ay + by * r.y, w: bx * r.w, h: by * r.h };
}

/** Sammanfogar rektanglar (t.ex. avgångs- och landningstid för en tidskonflikt). */
export function unionRect(rects: (Rect | null)[]): Rect | null {
  const rs = rects.filter((r): r is Rect => !!r);
  if (rs.length === 0) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Vilken rad och kolumn en punkt (0–1) träffar, eller null utanför tabellen. */
export function hitTest(grid: PageGrid, x: number, y: number): { rowIndex: number; field: string | null } | null {
  const col = grid.columns.find((c) => x >= c.left && x <= c.right);
  if (!col) return null;
  // Raden vars band (vid kolumnen) innehåller punkten — banden följer sidans buktning.
  for (let r = 1; r <= grid.rowsPerPage; r++) {
    const band = rowBand(grid, r, x);
    if (y >= band.y && y < band.y + band.h) return { rowIndex: r, field: col.field };
  }
  return null;
}
