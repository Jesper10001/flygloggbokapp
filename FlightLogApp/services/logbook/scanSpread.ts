// Ett skannat uppslag ritat som loggbok, för att jämföra rad för rad med pappersboken ("Present as logbook
// for cross-reference" i skanningsrapporten). Kolumnerna kommer från det fotade uppslagets rutnät
// (PageGrid: fält, ordning, bredd och vänster/höger sida), så att boken på skärmen har samma upplägg som
// boken på bordet. Flygningarna står på sina tryckta rader (rowIndex) med tomma rader emellan.
// Ren logik utan I/O — samma renderare som den digitala loggboken (renderSpread).

import type { PageGrid } from '../scanGeometry';
import type { ScanRow } from '../scanImport';
import { getTemplate, bookGroupFor, bookHeaderRows, applyBookRules, type LogbookTemplate, type LogbookColumn } from '../../constants/logbookTemplates';
import { deriveLogbookFields, numericColumns, type LogbookSpread, type ColumnTotals } from './paginate';
import { label as fieldLabel } from '../scanFields';

// Kort etikett per kolumn (gruppen över kolumnerna kommer från bookGroupFor, som i en EASA-bok).
const LABEL: Record<string, string> = {
  date: 'Date', aircraft_type: 'Type', registration: 'Reg', dep_place: 'Place', dep_utc: 'UTC', arr_place: 'Place',
  arr_utc: 'UTC', total_time: 'Total time', ifr: 'IFR', night: 'Night', pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual',
  instructor: 'Instructor', sim: 'FSTD', landings_day: 'Day', landings_night: 'Night', remarks: 'Remarks',
  second_pilot: 'Second pilot', multi_pilot: 'Multi-pilot', single_pilot: 'Single-pilot', picus: 'PICUS', spic: 'SPIC', nvg: 'NVG',
};
// Simulatorpass står i FSTD-kolumnen och inte i "Total time of flight" (deriveLogbookFields).
const FLIGHT_KEY: Record<string, string> = { total_time: 'tt_total', sim: 'fstd' };
const DECIMAL = new Set(['total_time', 'ifr', 'night', 'pic', 'co_pilot', 'dual', 'instructor', 'sim', 'multi_pilot', 'single_pilot', 'picus', 'spic', 'nvg']);
const INT = new Set(['landings_day', 'landings_night', 'tng_count']);
const LEFT_PAGE = new Set(['date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time', 'ifr', 'night']);
const RIGHT_PAGE = new Set(['pic', 'co_pilot', 'dual', 'instructor', 'sim', 'landings_day', 'landings_night', 'remarks', 'second_pilot']);
const SPREAD_PX = 1400;   // uppslagets bredd i CSS-px; kolumnerna får fotots andelar av den
const MIN_COL_PX = 30;

function formatFor(field: string, label: string): LogbookColumn['format'] {
  if (field === 'date') return 'date';
  if (field === 'dep_place' || field === 'arr_place') return 'icao';
  if (field === 'dep_utc' || field === 'arr_utc') return 'time-utc';
  if (INT.has(field) || /landing|ldg|count/i.test(label)) return 'int';
  if (DECIMAL.has(field) || field.startsWith('other_flight_time')) return 'decimal';
  return 'text';
}

/** Mallen för det fotade uppslaget, eller null om rutnätet är för tunt (då används standardmallen). */
export function templateFromGrid(
  grid: PageGrid | null, other: { keys: string[]; labels: Record<string, string> }, rowsPerPage: number,
): LogbookTemplate | null {
  const cols = (grid?.columns ?? []).filter((c) => c.right - c.left > 0.004).slice().sort((a, b) => a.left - b.left);
  if (cols.filter((c) => c.field).length < 4) return null;
  const spine = grid?.spine ?? 0.5;
  // Överlappar kolumnerna har ena sidan angetts i halvsidans koordinater (t.ex. vänstersidan 9–99 %). Då
  // avgör fältet sidan (EASA: datum … natt vänster, funktionstid … anmärkning höger), annars läget.
  const overlaps = cols.slice(1).filter((c, i) => cols[i].right - c.left > 0.012).length;
  const sideOf = (c: (typeof cols)[number]): 'left' | 'right' =>
    overlaps >= 2 && c.field && (LEFT_PAGE.has(c.field) || RIGHT_PAGE.has(c.field) || /^other/.test(c.field))
      ? (LEFT_PAGE.has(c.field) ? 'left' : 'right')
      : (c.left + c.right) / 2 < spine ? 'left' : 'right';
  // Bredderna räknas per sida (sidorna är lika breda i en bok), så att koordinatfel inte sprider sig.
  const sideTotal = { left: 0, right: 0 };
  for (const c of cols) sideTotal[sideOf(c)] += c.right - c.left;
  const seen = new Set<string>();
  const left: LogbookColumn[] = [];
  const right: LogbookColumn[] = [];
  const freeOther = other.keys.slice();
  cols.forEach((c, i) => {
    // "Other type of flight time": rutnätet kan kalla kolumnen något annat än nyckeln i raderna
    // (other_times, other_flight_time …) → nästa lediga nyckel som raderna har.
    let f = c.field;
    if (f && /^other/.test(f) && !other.keys.includes(f)) f = freeOther[0] ?? f;
    if (f) { const k = freeOther.indexOf(f); if (k >= 0) freeOther.splice(k, 1); }
    // Samma fält i två kolumner (t.ex. handskriven "Simulator time" och tryckt FSTD): värdena visas i den
    // första, den andra blir en tom kolumn med sin rubrik.
    const field = f && !seen.has(f) ? f : null;
    if (field) seen.add(field);
    const printed = c.label && !/^[a-z_0-9]+$/.test(c.label) ? c.label : '';
    const label = field
      ? other.labels[field] || LABEL[field] || printed || (/^other/.test(field) ? 'Other time' : fieldLabel(field))
      : printed;
    const col: LogbookColumn = {
      id: `c${i}`,
      label,
      width: Math.max(MIN_COL_PX, Math.round(((c.right - c.left) / (sideTotal[sideOf(c)] || 1)) * (SPREAD_PX / 2))),
      ...(field ? { flightKey: FLIGHT_KEY[field] ?? field, format: formatFor(field, label) } : {}),
      ...(field && bookGroupFor(field) ? { group: bookGroupFor(field) } : {}),
      ...(field === 'date' ? { date_format: 'iso' } : {}),
    };
    (sideOf(c) === 'left' ? left : right).push(col);
  });
  if (!left.length || !right.length) return null;
  return {
    id: 'scan-crossref', name: 'As photographed', rows_per_spread: rowsPerPage, language: 'en', time_format: 'decimal',
    left_columns: left, right_columns: right,
    footer: { this_page_total: true, total_to_date: false, signature: false, brought_forward: false },
  };
}

// "Other type of flight time" i raderna: nycklarna i ordning och bokens rubriker.
function otherColumns(rows: ScanRow[]): { keys: string[]; labels: Record<string, string> } {
  const other = { keys: [] as string[], labels: {} as Record<string, string> };
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.data.other_times ?? {})) if (v && !other.keys.includes(k)) other.keys.push(k);
    for (const [k, v] of Object.entries(r.data.other_time_labels ?? {})) if (v && !other.labels[k]) other.labels[k] = v;
  }
  return other;
}

/**
 * En riktig digital loggbok med det skannade uppslagets kolumner ("Use as my digital logbook"): samma
 * kolumner, ordning, bredder och sidor, stabila kolumn-id:n och en rubrik som i boken. Kolumner som appen
 * inte sparar något i (tomma, eller "Other type of flight time" som AR landings) blir tomma kolumner med
 * bokens rubrik, som man kan trycka på och ge en tidstyp (NVG/NVD blir NVG-tid direkt). Brought forward,
 * Total this page och Total to date som i en pappersbok. Null om rutnätet är för tunt.
 */
export function bookTemplateFromScan(
  rows: ScanRow[], grid: PageGrid | null, rowsPerPage: number, id: string, name: string,
): LogbookTemplate | null {
  const base = templateFromGrid(grid, otherColumns(rows.filter((r) => !r.skip)), rowsPerPage);
  if (!base) return null;
  const used = new Set<string>();
  let blank = 0;
  const conv = (c: LogbookColumn): LogbookColumn => {
    const empty = (): LogbookColumn => ({ id: `col_${++blank}`, label: c.label, width: c.width });
    let col: LogbookColumn;
    if (!c.flightKey) col = empty();
    else if (/^other/.test(c.flightKey)) {
      col = /\bnv[gd]\b|nvis/i.test(c.label) ? { ...c, flightKey: 'nvg', format: 'decimal', id: 'nvg' } : empty();
    } else col = { ...c, id: c.flightKey };
    if (used.has(col.id)) col = empty();
    used.add(col.id);
    return { ...col, ...(col.flightKey && bookGroupFor(col.flightKey) ? { group: bookGroupFor(col.flightKey) } : { group: undefined }) };
  };
  const left = base.left_columns.map(conv);
  const right = base.right_columns.map(conv);
  // Bokregeln: Total this page, Brought forward, Total to date längst ner, signaturen till vänster.
  return applyBookRules({
    ...base, id, name,
    left_columns: left, right_columns: right,
    header_rows: bookHeaderRows([...left, ...right]),
  });
}

/**
 * Uppslaget som loggbok: mall från rutnätet (eller standardmallen), flygningarna på sina tryckta rader och
 * sidans summa räknad på raderna. Brought forward och Total to date känner appen inte till — de visas inte.
 */
export function scanSpreadAsLogbook(
  rows: ScanRow[], grid: PageGrid | null, pages: { left: number | null; right: number | null }, rowsPerPage: number,
): { template: LogbookTemplate; spread: LogbookSpread; fromPhoto: boolean } {
  const pageRows = rows.filter((r) => !r.skip).sort((a, b) => a.rowIndex - b.rowIndex);
  const fromGrid = templateFromGrid(grid, otherColumns(pageRows), rowsPerPage);
  const template = fromGrid ?? getTemplate('easa-pilot-logbook');
  const hasSecondPilotCol = [...template.left_columns, ...template.right_columns].some((c) => c.flightKey === 'second_pilot');

  // Som i boken: andrepilotens initialer står först i anmärkningen när boken inte har en egen kolumn.
  const asFlight = (r: ScanRow) => {
    const d = r.data as any;
    const remarks = hasSecondPilotCol ? d.remarks : [d.second_pilot, d.remarks].filter(Boolean).join(', ');
    return deriveLogbookFields({ ...d, ...(d.other_times ?? {}), remarks } as any);
  };

  // Varje flygning på sin tryckta rad; en rad som redan är tagen (eller utanför sidan) hamnar på nästa lediga.
  const size = Math.max(rowsPerPage, pageRows.length);
  const slots: any[] = Array.from({ length: size }, () => null);
  for (const r of pageRows) {
    let i = Math.min(Math.max(r.rowIndex - 1, 0), size - 1);
    while (i < size && slots[i]) i++;
    if (i >= size) i = slots.findIndex((s) => !s);
    if (i >= 0) slots[i] = asFlight(r);
  }
  const flights = slots.map((s) => s ?? {});

  const thisPage: ColumnTotals = {};
  for (const c of numericColumns(template)) {
    const sum = flights.reduce((s, f) => s + (parseFloat(String((f as any)[c.flightKey!] ?? '')) || 0), 0);
    thisPage[c.flightKey!] = c.format === 'int' ? Math.round(sum) : Math.round(sum * 10) / 10;
  }
  const left = pages.left ?? 0;
  return {
    template,
    fromPhoto: !!fromGrid,
    spread: {
      spread_number: 1, page_left: left, page_right: pages.right ?? (left ? left + 1 : 0),
      flights: flights as any, rowsPerSpread: size,
      total_this_page: thisPage, brought_forward: {}, total_to_date: {},
    },
  };
}
