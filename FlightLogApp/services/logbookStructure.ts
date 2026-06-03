// Foto-först-detektering av en loggboks kolumnstruktur, plus en byggare som
// omvandlar detekteringen till en LogbookTemplate (custom-bok). Samma artefakt
// driver både den digitala bokens rendering och OCR-layouten (logbookLayout).
//
// Detekteringen är en lättversion av STRUCTURE_PROMPT — den läser de TRYCKTA
// kolumnrubrikerna en gång; värdena läses sedan av den vanliga OCR:en.

import { callAnthropicJson } from './anthropicClient';
import type { LogbookTemplate, LogbookColumn } from '../constants/logbookTemplates';

export interface StructureScan {
  columns: string[];                 // fältnycklar vänster→höger över hela uppslaget
  rows_per_page: number;
  page_layout: 'single' | 'double';
  right_page_start_index: number;    // index (0-baserat) där höger sida börjar; 0 om okänt/single
  custom_columns: { key: string; header_text: string; description: string }[];
  summary_rows: { brought_forward?: boolean; total_this_page?: boolean; total_to_date?: boolean };
}

// Fältval som erbjuds i editorn (känt → mappar mot en flight-property).
export const FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'aircraft_type', label: 'Type / Model' },
  { key: 'registration', label: 'Registration' },
  { key: 'dep_place', label: 'Departure (ICAO)' },
  { key: 'dep_utc', label: 'Departure time' },
  { key: 'arr_place', label: 'Arrival (ICAO)' },
  { key: 'arr_utc', label: 'Arrival time' },
  { key: 'total_time', label: 'Total time' },
  { key: 'pic', label: 'PIC' },
  { key: 'co_pilot', label: 'Co-pilot / SIC' },
  { key: 'dual', label: 'Dual' },
  { key: 'instructor', label: 'Instructor' },
  { key: 'cross_country', label: 'Cross-country' },
  { key: 'solo', label: 'Solo' },
  { key: 'ifr', label: 'IFR / Instrument' },
  { key: 'vfr', label: 'VFR' },
  { key: 'night', label: 'Night' },
  { key: 'nvg', label: 'NVG' },
  { key: 'multi_pilot', label: 'Multi-pilot' },
  { key: 'single_pilot', label: 'Single-pilot' },
  { key: 'picus', label: 'PICUS' },
  { key: 'spic', label: 'SPIC' },
  { key: 'se_time', label: 'SE' },
  { key: 'me_time', label: 'ME' },
  { key: 'sim', label: 'Sim / FSTD' },
  { key: 'landings_day', label: 'Landings day' },
  { key: 'landings_night', label: 'Landings night' },
  { key: 'remarks', label: 'Remarks / 2nd pilot' },
];

const FORMAT_BY_KEY: Record<string, NonNullable<LogbookColumn['format']>> = {
  date: 'date',
  dep_utc: 'time-utc', arr_utc: 'time-utc',
  dep_place: 'icao', arr_place: 'icao',
  aircraft_type: 'text', registration: 'text', remarks: 'text',
  landings_day: 'int', landings_night: 'int', tng_count: 'int',
};

// Render-härledda nycklar (sim-medvetna) för vissa fält — matchar inbyggda mallar.
const FIELD_TO_FLIGHTKEY: Record<string, string> = {
  total_time: 'tt_total',
  sim: 'fstd',
};

export function labelForField(key: string): string {
  return FIELD_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function formatForField(key: string): NonNullable<LogbookColumn['format']> {
  return FORMAT_BY_KEY[key] ?? 'decimal';
}

/** flightKey att lagra i mallen för ett valt fält (render-medvetet). */
export function flightKeyForField(key: string): string {
  return FIELD_TO_FLIGHTKEY[key] ?? key;
}

function defaultWidth(format: NonNullable<LogbookColumn['format']>): number {
  switch (format) {
    case 'date': return 84;
    case 'text': return 90;
    case 'icao': return 56;
    case 'time-utc': return 52;
    case 'int': return 46;
    default: return 52;
  }
}

/** Bygger en LogbookColumn för ett känt fält (eller en omappad fri kolumn om key=''). */
export function columnForField(key: string, idx: number): LogbookColumn {
  if (!key) {
    return { id: `col_${idx}`, label: 'Column', format: 'decimal', width: 52 };
  }
  const format = formatForField(key);
  return {
    id: `${key}_${idx}`,
    label: labelForField(key),
    flightKey: flightKeyForField(key),
    format,
    width: defaultWidth(format),
  };
}

const STRUCTURE_PROMPT = `Du är expert på flygloggböcker (EASA, FAA m.fl.). Analysera bilden av en loggbokssida och identifiera den TRYCKTA kolumnstrukturen.

GRUNDREGEL: Antalet element i "columns" MÅSTE vara EXAKT antalet fysiska kolumner i tabellen. Räkna vertikala linjer minus 1. Slå ALDRIG ihop flera kolumner.

ARBETSORDNING:
1. Räkna det totala antalet fysiska kolumner (vänster + höger sida).
2. Läs ALLA tryckta kolumnrubriker, vänster → höger.
3. Om det är ett uppslag (två sidor): ange right_page_start_index = index (0-baserat) för den FÖRSTA kolumnen på HÖGER sida.
4. Mappa varje rubrik till en nyckel:
   date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc,
   total_time, pic, co_pilot, dual, instructor, multi_pilot, single_pilot,
   cross_country, solo, ifr, vfr, night, nvg, se_time, me_time,
   landings_day, landings_night, sim, remarks
   - co_pilot används även för FAA "SIC".
   - ifr används även för FAA "Actual Instrument".
   - För kolumner som inte matchar (egendefinierade/tomma) → använd nyckeln "other_flight_time" (eller other_flight_time_2, _3 för flera).
5. aircraft_type inkluderar ALLTID modell/variant. remarks inkluderar ALLTID andrepilot.

Returnera ENBART JSON enligt schema:
{"columns":["date",...],"rows_per_page":12,"page_layout":"double","right_page_start_index":10,"custom_columns":[{"key":"other_flight_time","header_text":"AR","description":""}],"summary_rows":{"brought_forward":true,"total_this_page":true,"total_to_date":true}}

Svara ENBART med JSON.`;

export async function analyzeLogbookStructure(base64: string, mediaType: string): Promise<StructureScan> {
  const parsed = await callAnthropicJson<any>({
    system: STRUCTURE_PROMPT,
    maxTokens: 2000,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Analysera kolumnstrukturen. Svara ENBART med JSON.' },
    ],
  });
  const sr = parsed.summary_rows ?? {};
  return {
    columns: Array.isArray(parsed.columns) ? parsed.columns.map((c: any) => String(c)) : [],
    rows_per_page: Number(parsed.rows_per_page) || 0,
    page_layout: parsed.page_layout === 'single' ? 'single' : 'double',
    right_page_start_index: Number(parsed.right_page_start_index) || 0,
    custom_columns: Array.isArray(parsed.custom_columns)
      ? parsed.custom_columns.map((c: any) => ({
          key: String(c.key ?? ''),
          header_text: String(c.header_text ?? ''),
          description: String(c.description ?? ''),
        }))
      : [],
    summary_rows: {
      brought_forward: !!sr.brought_forward,
      total_this_page: !!sr.total_this_page,
      total_to_date: !!sr.total_to_date,
    },
  };
}

/** Omvandlar en detekterad struktur till en (redigerbar) LogbookTemplate-draft. */
export function templateFromStructure(struct: StructureScan, name: string, id: string): LogbookTemplate {
  const cols = struct.columns.map((k, i) => columnForField(k.startsWith('other_flight_time') ? '' : k, i));
  let split: number;
  if (struct.page_layout === 'single') {
    split = cols.length; // allt på en sida
  } else if (struct.right_page_start_index > 0 && struct.right_page_start_index < cols.length) {
    split = struct.right_page_start_index;
  } else {
    split = Math.ceil(cols.length / 2);
  }
  return {
    id,
    name,
    rows_per_spread: struct.rows_per_page || 12,
    language: 'en',
    time_format: 'decimal',
    left_columns: cols.slice(0, split),
    right_columns: cols.slice(split),
    summary_layout: 'bottom',
    footer: {
      brought_forward: !!struct.summary_rows.brought_forward,
      this_page_total: !!struct.summary_rows.total_this_page,
      total_to_date: !!struct.summary_rows.total_to_date,
      signature: true,
    },
  };
}
