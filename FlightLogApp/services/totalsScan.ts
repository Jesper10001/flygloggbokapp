// Block import från foto: Claude läser summaraderna längst ner i ett uppslag (Brought forward, Total this
// page, Total to date) per kolumn, flygplanen på sidan och — för år för år — raderna från det tidigare året
// när ett nytt år börjar på uppslaget. Allt räknas och kontrolleras här i koden, aldrig av modellen:
//   • värdet per fält = Total to date; Brought forward + this page = to date är kontrollen (gult när den inte
//     går ihop eller något var oläsligt),
//   • slutet av ett år = Brought forward + årets rader på uppslaget där nästa år börjar,
//   • tiden per år = skillnaden mellan två årsslut (saknas ett årsskifte slås åren ihop).
// Rena funktioner (readingFromTool, yearEndFromTool, buildPeriods) testas i scripts/test-totals-scan.cjs.
import { callAnthropicTool } from './anthropicClient';

export const TOTAL_FIELDS = [
  'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'multi_pilot',
  'single_pilot_se', 'single_pilot_me', 'single_pilot', 'nvg', 'landings_day', 'landings_night', 'sim',
] as const;
export type TotalField = typeof TOTAL_FIELDS[number];
/** Fälten formuläret använder (single_pilot_se + _me slås ihop till single_pilot). */
export type FormField = Exclude<TotalField, 'single_pilot_se' | 'single_pilot_me'>;
export const COUNT_FIELDS = new Set<string>(['landings_day', 'landings_night']);

export interface FieldValue {
  value: number;          // minuter (tider) eller antal (landningar)
  check: boolean;         // gult: kontrollen gick inte ihop eller något var oläsligt
  bf?: number;            // Brought forward
  page?: number;          // Total this page
}
export interface TotalsReading {
  found: boolean;
  fields: Partial<Record<FormField, FieldValue>>;
  aircraft: { type: string; registration: string }[];
  years: number[];        // årtal i radernas datum
  latestYear: number | null;
  yearEnd: YearEnd | null;  // finns ett årsskifte på uppslaget: summorna i slutet av det tidigare året
  note: string;
}
export interface YearEnd {
  year: number;
  fields: Partial<Record<FormField, number>>;  // saknas ett fält gick det inte att räkna ut
  aircraft: string[];
}

// ── Tolkning ──────────────────────────────────────────────────────────────────

/** "1201:10", "1201.2", "1201,2", "1201h10" → minuter; landningar → antal. null om tomt/oläsligt. */
export function parseValue(raw: unknown, count: boolean): number | null {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/\s/g, '').replace(',', '.').replace(/h/i, ':');
  if (!t) return null;
  if (count) { const n = parseInt(t, 10); return Number.isFinite(n) && n >= 0 ? n : null; }
  const m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) { const mm = parseInt(m[2], 10); return mm < 60 ? parseInt(m[1], 10) * 60 + mm : null; }
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  return null;
}

/** Två fält slås ihop (enmotorigt + flermotorigt single pilot) — bara värden som finns. */
function addOpt(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Verktygssvaret → värden per fält med kontroll. */
export function readingFromTool(raw: any): TotalsReading {
  const cols: any[] = Array.isArray(raw?.columns) ? raw.columns : [];
  const per: Record<string, { bf: number | null; page: number | null; td: number | null; unclear: boolean }> = {};
  for (const c of cols) {
    const f = String(c?.field ?? '');
    if (!(TOTAL_FIELDS as readonly string[]).includes(f)) continue;
    const count = COUNT_FIELDS.has(f);
    const cur = per[f];
    const v = { bf: parseValue(c.brought_forward, count), page: parseValue(c.this_page, count), td: parseValue(c.to_date, count), unclear: !!c.unclear };
    // Samma fält i flera kolumner (t.ex. två pilotfunktionskolumner) — summera.
    per[f] = cur ? { bf: addOpt(cur.bf, v.bf), page: addOpt(cur.page, v.page), td: addOpt(cur.td, v.td), unclear: cur.unclear || v.unclear } : v;
  }
  // Single pilot: SE + ME (EASA-böcker delar kolumnen) eller en gemensam.
  const se = per.single_pilot_se, me = per.single_pilot_me;
  if ((se || me) && !per.single_pilot) {
    per.single_pilot = {
      bf: addOpt(se?.bf, me?.bf), page: addOpt(se?.page, me?.page), td: addOpt(se?.td, me?.td),
      unclear: !!(se?.unclear || me?.unclear),
    };
  }
  const fields: Partial<Record<FormField, FieldValue>> = {};
  for (const [f, v] of Object.entries(per)) {
    if (f === 'single_pilot_se' || f === 'single_pilot_me') continue;
    const tol = COUNT_FIELDS.has(f) ? 0 : 1;
    let out: FieldValue | null = null;
    if (v.td != null) {
      const adds = v.bf != null && v.page != null ? Math.abs(v.bf + v.page - v.td) <= tol : null;
      out = { value: v.td, check: v.unclear || adds === false, bf: v.bf ?? undefined, page: v.page ?? undefined };
    } else if (v.bf != null && v.page != null) {
      out = { value: v.bf + v.page, check: v.unclear, bf: v.bf, page: v.page };
    } else if (v.bf != null) {
      out = { value: v.bf, check: true, bf: v.bf };
    }
    if (out && out.value >= 0) fields[f as FormField] = out;
  }
  const years = (Array.isArray(raw?.years) ? raw.years : []).map((y: any) => parseInt(y, 10)).filter((y: number) => y >= 1950 && y <= 2100);
  const seen = new Set<string>();
  const aircraft: { type: string; registration: string }[] = [];
  for (const a of Array.isArray(raw?.aircraft) ? raw.aircraft : []) {
    const type = String(a?.type ?? '').trim();
    if (!type || seen.has(type.toUpperCase())) continue;
    seen.add(type.toUpperCase());
    aircraft.push({ type, registration: String(a?.registration ?? '').trim().toUpperCase() });
  }
  const reading: TotalsReading = {
    found: raw?.logbook_found !== false && Object.keys(fields).length > 0,
    fields, aircraft, years: [...new Set<number>(years)].sort(), latestYear: years.length ? Math.max(...years) : null,
    yearEnd: null, note: String(raw?.note ?? ''),
  };
  reading.yearEnd = yearEndFromTool(raw, reading);
  return reading;
}

/** Ett nytt år börjar på uppslaget: slutet av det tidigare året = Brought forward + det årets rader. */
export function yearEndFromTool(raw: any, reading: Pick<TotalsReading, 'fields' | 'years' | 'aircraft'>): YearEnd | null {
  const rows: any[] = Array.isArray(raw?.earlier_year_rows) ? raw.earlier_year_rows : [];
  const earlier = parseInt(raw?.earlier_year, 10) || (reading.years.length > 1 ? reading.years[0] : NaN);
  if (!(earlier >= 1950 && earlier <= 2100)) return null;
  if (reading.years.length < 2 && !rows.length) return null;
  const fields: Partial<Record<FormField, number>> = {};
  for (const [f, v] of Object.entries(reading.fields) as [FormField, FieldValue][]) {
    if (v.bf == null) continue;  // utan Brought forward går årsslutet inte att räkna ut
    const count = COUNT_FIELDS.has(f);
    let sum = 0;
    for (const r of rows) {
      const vals = r?.values ?? {};
      const one = f === 'single_pilot' && vals.single_pilot == null
        ? addOpt(parseValue(vals.single_pilot_se, false), parseValue(vals.single_pilot_me, false))
        : parseValue(vals[f], count);
      sum += one ?? 0;
    }
    fields[f] = v.bf + sum;
  }
  return { year: earlier, fields, aircraft: reading.aircraft.map((a) => a.type) };
}

// ── År för år ─────────────────────────────────────────────────────────────────

export interface Period {
  from: number | null;    // null = från början
  to: number;
  fields: Partial<Record<FormField, number>>;
  check: Partial<Record<FormField, boolean>>;  // negativ skillnad → gult
  aircraft: string[];
  merged: boolean;        // två eller fler år ihop (ett årsskifte saknas)
}

/** Årsslut + senaste uppslagets totaler → en period per år (eller ihopslagna år där ett foto saknas). */
export function buildPeriods(latest: { year: number; fields: Partial<Record<FormField, number>>; aircraft: string[] }, ends: YearEnd[]): Period[] {
  const byYear = new Map<number, YearEnd>();
  for (const e of ends) if (!byYear.has(e.year) && e.year < latest.year) byYear.set(e.year, e);
  const sorted = [...byYear.values()].sort((a, b) => a.year - b.year);
  const out: Period[] = [];
  const diff = (a: Partial<Record<FormField, number>>, b: Partial<Record<FormField, number>> | null) => {
    const fields: Partial<Record<FormField, number>> = {};
    const check: Partial<Record<FormField, boolean>> = {};
    for (const [f, v] of Object.entries(a) as [FormField, number][]) {
      if (b == null) { fields[f] = v; continue; }
      const prev = b[f];
      if (prev == null) continue;
      const d = v - prev;
      if (d < 0) { check[f] = true; continue; }
      fields[f] = d;
    }
    return { fields, check };
  };
  let prev: YearEnd | null = null;
  for (const e of sorted) {
    const from = prev ? prev.year + 1 : null;
    const { fields, check } = diff(e.fields, prev ? prev.fields : null);
    out.push({ from, to: e.year, fields, check, aircraft: e.aircraft, merged: from != null && e.year > from });
    prev = e;
  }
  const from = prev ? prev.year + 1 : null;
  const { fields, check } = diff(latest.fields, prev ? prev.fields : null);
  out.push({ from, to: latest.year, fields, check, aircraft: latest.aircraft, merged: from != null && latest.year > from });
  return out;
}

/** "–2016", "2017", "2018–19". */
export function periodLabel(p: { from: number | null; to: number }): string {
  if (p.from == null) return `–${p.to}`;
  if (p.from === p.to) return String(p.to);
  return `${p.from}–${String(p.to).slice(2)}`;
}

// ── Läsning ───────────────────────────────────────────────────────────────────

const FIELD_HELP = `total_time = total time of flight (block time); pic = pilot-in-command; co_pilot = co-pilot; dual = dual received;
instructor = flight instructor; ifr = IFR / instrument time; night = night time; multi_pilot = multi-pilot time;
single_pilot_se and single_pilot_me = single-pilot time on single-engine and multi-engine (use single_pilot when the book has one
single-pilot column); nvg = NVG time; landings_day and landings_night = numbers of landings; sim = FSTD / synthetic training time.`;

const SYSTEM = `You read the summary lines at the bottom of a pilot's paper logbook spread (two facing pages).
Most logbooks have up to three lines under each time column: "Total this page", "Brought forward" (the total from all earlier pages)
and "Total to date". For every column you can map to one of the fields, copy the three values as written in that column.

Fields: ${FIELD_HELP}

Rules:
- Times: return "H:MM" when the logbook counts hours and minutes (also when written 12.30, 12h30, or in separate hour and minute
  sub-columns: combine them as "12:30"). Return a decimal like "1201.5" only when the logbook counts decimal hours.
- Landings are whole numbers.
- Leave a value out when the cell is empty. Set unclear = true when a value is hard to read; never guess silently.
- Do not add anything up yourself.
- aircraft: every aircraft type written in the flight rows, once each, as written (with one registration seen for it).
- years: the years in the dates of the flight rows on the spread (dates may only show day and month; use the year written at the top
  of the date column or on the page).
- When the spread holds flights from two different years (a new year starts on it), set earlier_year to the earlier year and list
  in earlier_year_rows every flight row dated in that earlier year, with its values for the same fields.
- logbook_found = false when the photo shows no logbook summary lines at all.`;

const FIELD_ENUM = [...TOTAL_FIELDS];
const ROW_VALUES = { type: 'object', properties: Object.fromEntries(FIELD_ENUM.map((f) => [f, { type: 'string' }])) };
const SCHEMA = {
  type: 'object',
  properties: {
    logbook_found: { type: 'boolean' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: FIELD_ENUM },
          header: { type: 'string' },
          brought_forward: { type: 'string' },
          this_page: { type: 'string' },
          to_date: { type: 'string' },
          unclear: { type: 'boolean' },
        },
        required: ['field'],
      },
    },
    aircraft: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, registration: { type: 'string' } }, required: ['type'] } },
    years: { type: 'array', items: { type: 'integer' } },
    earlier_year: { type: 'integer' },
    earlier_year_rows: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, values: ROW_VALUES } } },
    note: { type: 'string' },
  },
  required: ['logbook_found', 'columns'],
};

/** Läser ett uppslag. yearChange: be uttryckligen om årets rader (foto av ett årsskifte). */
export async function readTotalsPhoto(base64: string, mediaType: string, opts: { yearChange?: boolean } = {}): Promise<TotalsReading> {
  const raw = await callAnthropicTool<any>({
    model: 'claude-sonnet-5-5',
    system: SYSTEM,
    toolName: 'emit_totals',
    toolDescription: 'Return the summary lines, aircraft and years read from the logbook spread',
    inputSchema: SCHEMA,
    maxTokens: opts.yearChange ? 8000 : 3000,
    timeoutMs: 90000,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      {
        type: 'text',
        text: opts.yearChange
          ? 'This spread is where a new year starts. Read the summary lines, the aircraft and the years, and list every row from the earlier year.'
          : 'This is the latest spread the pilot has written on. Read the summary lines, the aircraft and the years.',
      },
    ],
  });
  return readingFromTool(raw);
}
