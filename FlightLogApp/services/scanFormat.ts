// Loggbokens format (kolumner, rader, tidsformat, summeringsrader) läst EN gång från första uppslaget i
// "Scan your whole logbook". Formatet sparas med ett id; varje skanningsomgång i samma bok bär id:t med sig, och
// granskningen ger Claude formatet som auktoritativ kolumnlista (samma väg som en digital boks mall) i stället
// för att Claude ska lista ut boken på nytt i varje omgång.

import * as FileSystem from 'expo-file-system/legacy';
import { callAnthropicTool } from './anthropicClient';
import { OCR_MODEL } from './ocr';
import { getSetting, setSetting } from '../db/flights';
import type { LogbookLayout, LayoutColumn, LayoutFieldType } from './logbookLayout';

export interface ScanFormatColumn {
  label: string;
  group?: string;
  field: string | null;     // fältet värdena läses till (samma namn som skannern), null = omappad
  page: 'left' | 'right';
  left: number;             // 0–1 av uppslagets bredd
  right: number;
}

export interface ScanFormat {
  id: string;
  createdAt: string;
  columns: ScanFormatColumn[];
  rowsPerPage: number;
  timeFormat: 'decimal' | 'hhmm';
  remarksPilotNames: boolean;   // anmärkningens rubrik: pilotens namn skrivs där ("name of PIC")
  footer: { broughtForward: boolean; totalThisPage: boolean; totalToDate: boolean };
  pageNumbers: { left: number | null; right: number | null };   // första uppslagets tryckta sidnummer
  spine: number;                // 0–1, var vänstersidan slutar
}

// Fälten en kolumn kan läsas till (samma som skannerns flights-schema och mallarnas layout).
const FIELDS = new Set([
  'date', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'aircraft_type', 'registration', 'se_time', 'me_time',
  'single_pilot', 'multi_pilot', 'total_time', 'second_pilot', 'landings_day', 'landings_night', 'night', 'ifr',
  'pic', 'co_pilot', 'dual', 'instructor', 'picus', 'spic', 'nvg', 'sim', 'sim_category', 'remarks',
  'other_flight_time', 'other_flight_time_2', 'other_flight_time_3',
]);

const FORMAT_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          group: { type: 'string' },
          field: { type: ['string', 'null'] },
          left: { type: 'number' },
          right: { type: 'number' },
        },
        required: ['label', 'left', 'right'],
      },
    },
    rows_printed: { type: 'integer' },
    spine: { type: 'number' },
    time_format: { type: 'string', enum: ['decimal', 'hhmm'] },
    remarks_pilot_names: { type: 'boolean' },
    page_numbers: {
      type: 'object',
      properties: { left: { type: ['integer', 'null'] }, right: { type: ['integer', 'null'] } },
    },
    footer: {
      type: 'object',
      properties: {
        brought_forward: { type: 'boolean' },
        total_this_page: { type: 'boolean' },
        total_to_date: { type: 'boolean' },
      },
    },
  },
  required: ['columns', 'rows_printed'],
};

const FORMAT_PROMPT = `Du läser FORMATET i en pilots pappersloggbok från ett foto av ett uppslag (vänster och höger sida).
Läs INTE flygningarna — bara hur boken är uppbyggd. Formatet används för att läsa resten av boken, så det ska stämma exakt.`;

const FORMAT_TASK = `KOLUMNER (columns): en post per kolumn över hela uppslaget, i ordning vänster→höger. Ta med varje tryckt
kolumn, även tomma, och kolumner där piloten skrivit en egen rubrik. En grupp med delkolumner (t.ex. "Departure" med
"Place" och "Time") är flera kolumner. En tid med separata delkolumner för timmar och minuter är EN kolumn (från
timmarnas vänsterlinje till minuternas högerlinje).
- label: rubriken som den står, kort (t.ex. "Place", "Time", "Make, model, variant", "AR landings").
- group: grupprubriken ovanför, om den finns (t.ex. "Departure", "Single pilot time", "Landings").
- field: fältet kolumnens värden hör till:
  date, dep_place, dep_utc, arr_place, arr_utc, aircraft_type (typ/modell), registration, se_time (single-pilot SE),
  me_time (single-pilot ME), single_pilot (single-pilot utan SE/ME), multi_pilot, total_time (total flygtid),
  second_pilot (egen kolumn för befälhavarens namn), landings_day, landings_night, night, ifr, pic, co_pilot, dual,
  instructor, picus, spic, nvg, sim (simulator/FSTD/synthetic training: tid), sim_category (typ av simulator), remarks.
  Kolumner för något annat (t.ex. "Other type of flight time", eller en handskriven rubrik som "AR landings", "NVD"):
  other_flight_time, other_flight_time_2, other_flight_time_3 i ordning. En handskriven "Simulator time" är sim.
  Har två kolumner samma betydelse får den där piloten faktiskt skriver värdena fältet, den andra null.
  Ingen passar → null.
- left/right: kolumnens tryckta vänster- och högerlinje i procent (0–100) av hela bildens bredd, en decimal.

rows_printed: antal tryckta flygningsrader på EN sida. Räkna noggrant, även tomma rader; summeringsraderna längst ner
räknas inte.
spine: x i procent där vänstersidan slutar och högersidan börjar (ryggen).
time_format: "hhmm" om tiderna skrivs som timmar och minuter (1:30, eller delkolumner för h och min), annars "decimal".
remarks_pilot_names: true om anmärkningskolumnens TRYCKTA rubrik säger att befälhavarens eller den andra pilotens namn
skrivs där (t.ex. "Name(s) PIC", "name of PIC or if another").
page_numbers: de tryckta sidnumren på uppslaget {left, right}, null om de inte syns.
footer: vilka summeringsrader som finns längst ner: brought_forward, total_this_page, total_to_date.

Anropa emit_format direkt, utan någon text.`;

/** Läser formatet från ett förberett uppslag (fil). Kastar vid fel (t.ex. slut på Blade coins). */
export async function readLogbookFormat(uri: string): Promise<ScanFormat> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const t0 = Date.now();
  const raw = await callAnthropicTool<any>({
    model: OCR_MODEL,
    system: FORMAT_PROMPT,
    maxTokens: 4000,
    toolName: 'emit_format',
    toolDescription: 'Returnera loggbokens format (kolumner, rader, tidsformat, summeringsrader)',
    inputSchema: FORMAT_SCHEMA,
    // Proxyn ger skanningspris (halv vikt för Premium) bara åt emit_flights; formatläsningen dras fullt, och
    // appens egen räkning ska stämma med proxyns (annars drogs mellanskillnaden senare, när saldot hämtades).
    quotaWeight: 1,
    userContent: [
      { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg', data: base64 } },
      { type: 'text' as const, text: FORMAT_TASK },
    ],
  });
  // Procent (0–100) enligt instruktionen; skriver modellen bråk (alla värden ≤ 1,5) räknas de som andelar.
  const all = [raw?.spine, ...(Array.isArray(raw?.columns) ? raw.columns : []).flatMap((c: any) => [c?.left, c?.right])].map(Number).filter(Number.isFinite);
  const scale = all.length && Math.max(...all) <= 1.5 ? 1 : 100;
  const pct = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(1, v / scale)) : NaN; };
  const spine = Number.isFinite(pct(raw?.spine)) ? pct(raw.spine) : 0.5;
  const seen = new Set<string>();
  const columns: ScanFormatColumn[] = (Array.isArray(raw?.columns) ? raw.columns : [])
    .map((c: any) => ({ label: String(c?.label ?? '').trim(), group: c?.group ? String(c.group).trim() : undefined, field: c?.field, left: pct(c?.left), right: pct(c?.right) }))
    .filter((c: any) => Number.isFinite(c.left) && Number.isFinite(c.right) && c.right - c.left > 0.003)
    .sort((a: any, b: any) => a.left - b.left)
    .map((c: any) => {
      // Okända fält och samma fält två gånger blir omappade kolumner (rubriken behålls).
      let field: string | null = typeof c.field === 'string' && FIELDS.has(c.field) ? c.field : null;
      if (field && seen.has(field)) field = null;
      if (field) seen.add(field);
      return { label: c.label || c.group || 'Column', group: c.group, field, page: (c.left + c.right) / 2 < spine ? 'left' : 'right', left: c.left, right: c.right } as ScanFormatColumn;
    });
  if (columns.filter((c) => c.field).length < 4) throw new Error("Couldn't make out the columns on this spread. Try another photo.");
  const rows = Number(raw?.rows_printed);
  const pn = raw?.page_numbers ?? {};
  const num = (v: unknown) => (Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const format: ScanFormat = {
    id: `fmt_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    columns,
    rowsPerPage: Number.isFinite(rows) && rows >= 4 && rows <= 40 ? Math.round(rows) : 0,
    timeFormat: raw?.time_format === 'hhmm' ? 'hhmm' : 'decimal',
    remarksPilotNames: raw?.remarks_pilot_names === true,
    footer: {
      broughtForward: raw?.footer?.brought_forward !== false,
      totalThisPage: raw?.footer?.total_this_page !== false,
      totalToDate: raw?.footer?.total_to_date !== false,
    },
    pageNumbers: { left: num(pn.left), right: num(pn.right) },
    spine,
  };
  console.log(`[SCAN] Format läst på ${((Date.now() - t0) / 1000).toFixed(1)} s: ${columns.length} kolumner (${columns.filter((c) => c.field).length} mappade), ${format.rowsPerPage} rader, ${format.timeFormat}, sidor ${format.pageNumbers.left ?? '?'}–${format.pageNumbers.right ?? '?'}${format.remarksPilotNames ? ', namn i anmärkningen' : ''}`);
  return format;
}

const typeOf = (field: string | null): LayoutFieldType => {
  if (field === 'date') return 'date';
  if (field === 'dep_place' || field === 'arr_place') return 'icao';
  if (field === 'dep_utc' || field === 'arr_utc') return 'time-utc';
  if (field === 'landings_day' || field === 'landings_night') return 'int';
  if (!field || field === 'aircraft_type' || field === 'registration' || field === 'remarks' || field === 'second_pilot' || field === 'sim_category') return 'text';
  return 'decimal';
};

/** Formatet som LogbookLayout — samma kolumnlista som en digital boks mall ger skannern. */
export function formatToLayout(f: ScanFormat): LogbookLayout {
  const columns: LayoutColumn[] = f.columns.map((c, i) => {
    const type = typeOf(c.field);
    return {
      index: i + 1, id: `c${i + 1}`, label: c.group && c.group !== c.label ? `${c.group} – ${c.label}` : c.label, field: c.field, type,
      group: c.group, page: c.page, width: Math.max(10, Math.round((c.right - c.left) * 1000)),
      ...(c.field === 'registration' ? { validate: 'fleet' as const } : c.field === 'aircraft_type' ? { validate: 'aircraftType' as const }
        : type === 'icao' ? { validate: 'icao' as const } : type === 'decimal' && c.field ? { validate: 'range' as const } : {}),
    };
  });
  const hasRight = columns.some((c) => c.page === 'right');
  return {
    source: 'custom-scanned',
    templateId: f.id,
    pageMode: hasRight ? 'spread' : 'single',
    rowsPerPage: f.rowsPerPage,
    timeFormat: f.timeFormat,
    columns,
    leftWidthFraction: f.spine,
    summaryRows: { broughtForward: f.footer.broughtForward, totalThisPage: f.footer.totalThisPage, totalToDate: f.footer.totalToDate },
  };
}

/** Sidnumrering: ett nummer per uppslag (1) eller ett per sida (2). Okänt → 2. */
export const pageStep = (f: ScanFormat | null): 1 | 2 =>
  f?.pageNumbers.left != null && f.pageNumbers.right === f.pageNumbers.left ? 1 : 2;

// ── Sparade format (settings scan_formats: id → format) ──────────────────────
const KEY = 'scan_formats';

async function loadAll(): Promise<Record<string, ScanFormat>> {
  try { return JSON.parse((await getSetting(KEY)) || '{}') ?? {}; } catch { return {}; }
}

export async function saveScanFormat(f: ScanFormat): Promise<void> {
  const all = await loadAll();
  all[f.id] = f;
  await setSetting(KEY, JSON.stringify(all));
}

export async function loadScanFormat(id: string | null | undefined): Promise<ScanFormat | null> {
  if (!id) return null;
  return (await loadAll())[id] ?? null;
}

export async function deleteScanFormat(id: string): Promise<void> {
  const all = await loadAll();
  if (!all[id]) return;
  delete all[id];
  await setSetting(KEY, JSON.stringify(all));
}
