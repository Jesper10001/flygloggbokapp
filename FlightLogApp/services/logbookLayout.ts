// LogbookLayout — EN sanningskälla för "hur ser den här loggboken ut".
//
// Slår ihop mall-modellen (constants/logbookTemplates) till en typad
// kolumnkarta som driver OCR-skanningen: vilka kolumner som finns, i vilken
// ordning, på vilken fysisk sida, vilket fält de mappar till och vilken
// validering de kräver. En digital bok / inbyggd mall / engångs-scannad
// custom-mall blir alla en LogbookLayout via adaptrarna nedan.
//
// Adaptern är en ren projektion — ingen I/O, inga sidoeffekter.

import type { LogbookTemplate, LogbookColumn } from '../constants/logbookTemplates';

export type LayoutFieldType = 'date' | 'icao' | 'time-utc' | 'decimal' | 'int' | 'text';
export type LayoutValidate = 'fleet' | 'icao' | 'aircraftType' | 'range';

export interface LayoutColumn {
  index: number;            // 1-baserad position över hela uppslaget (vänster→höger)
  id: string;               // mallens kolumn-id
  label: string;            // rubrik
  field: string | null;     // OCR/flight-fält värdet hamnar i; null = fånga rått / ignorera
  type: LayoutFieldType;
  group?: string;           // tryckt grupphuvud (ges till modellen)
  page: 'left' | 'right';   // vilken fysisk sida — ger split-gränsen gratis
  validate?: LayoutValidate;
}

export interface LogbookLayout {
  source: 'template' | 'digital-book' | 'custom-scanned';
  templateId?: string;
  pageMode: 'single' | 'spread';
  rowsPerPage: number;
  timeFormat: 'decimal' | 'hhmm';
  columns: LayoutColumn[];
  summaryRows: {
    broughtForward: boolean;
    totalThisPage: boolean;
    totalToDate: boolean;
  };
}

// Render-härledda nycklar i mallen → råa OCR/flight-fält.
// (deriveLogbookFields i services/logbook/paginate.ts skapar dessa virtuella
//  fält för renderingen; OCR ska skriva till de underliggande råfälten.)
const RENDER_TO_OCR_FIELD: Record<string, string> = {
  tt_total: 'total_time',
  fstd: 'sim',
  sp_se: 'se_time',
  sp_me: 'me_time',
};

function ocrField(flightKey?: string): string | null {
  if (!flightKey) return null;
  return RENDER_TO_OCR_FIELD[flightKey] ?? flightKey;
}

function layoutType(format?: string): LayoutFieldType {
  switch (format) {
    case 'date': return 'date';
    case 'icao': return 'icao';
    case 'time-utc': return 'time-utc';
    case 'int': return 'int';
    case 'text': return 'text';
    default: return 'decimal';
  }
}

function validateFor(field: string | null, type: LayoutFieldType): LayoutValidate | undefined {
  if (!field) return undefined;
  if (field === 'registration') return 'fleet';
  if (field === 'aircraft_type') return 'aircraftType';
  if (field === 'dep_place' || field === 'arr_place' || field === 'stop_place') return 'icao';
  if (type === 'decimal') return 'range';
  return undefined;
}

/**
 * Bygger en LogbookLayout från en mall. customCols (per digital bok) kan
 * om-mappa tomma/tilldelningsbara kolumner — den vinner över mallens flightKey.
 */
export function layoutFromTemplate(t: LogbookTemplate, customCols?: Record<string, string>): LogbookLayout {
  const mapCols = (cols: LogbookColumn[], page: 'left' | 'right') =>
    cols.map((c) => {
      const rawKey = customCols?.[c.id] ?? c.flightKey;
      const field = ocrField(rawKey);
      const type = layoutType(c.format);
      return {
        id: c.id,
        label: c.label,
        field,
        type,
        group: c.group,
        page,
        validate: validateFor(field, type),
      };
    });

  const columns: LayoutColumn[] = [...mapCols(t.left_columns, 'left'), ...mapCols(t.right_columns, 'right')]
    .map((c, i) => ({ ...c, index: i + 1 }));

  return {
    source: t.id.startsWith('custom-') ? 'custom-scanned' : 'template',
    templateId: t.id,
    pageMode: t.right_columns.length > 0 ? 'spread' : 'single',
    rowsPerPage: t.rows_per_spread,
    timeFormat: t.time_format,
    columns,
    summaryRows: {
      broughtForward: !!t.footer?.brought_forward,
      totalThisPage: !!t.footer?.this_page_total,
      totalToDate: !!t.footer?.total_to_date,
    },
  };
}

/** Kolumner på en viss fysisk sida — för split-medveten OCR (ett anrop per sida). */
export function pageColumns(layout: LogbookLayout, side: 'left' | 'right'): LayoutColumn[] {
  return layout.columns.filter((c) => c.page === side);
}

/**
 * Auktoritativt layout-block för OCR-prompten — beskriver HELA uppslaget
 * (används medan capture ännu inte delar uppslaget i vänster/höger). Överstyr
 * den generiska kolumnstrukturen i systemprompten.
 */
export function buildLayoutContext(layout: LogbookLayout): string {
  const lines = layout.columns.map((c) => {
    const target = c.field ?? `"${c.label}" (ej mappad — läs men lämna i remarks/utelämna)`;
    const grp = c.group ? `, grupp: "${c.group}"` : '';
    const side = layout.pageMode === 'spread' ? ` [${c.page === 'left' ? 'vänster' : 'höger'} sida]` : '';
    return `  ${c.index}. ${target} (${c.type}${grp})${side}`;
  });
  return `\n\nLOGGBOKENS LAYOUT (AUKTORITATIV — överstyr den generiska kolumnstrukturen ovan).`
    + `\nBoken har ${layout.rowsPerPage} rader per sida. Tidsformat: ${layout.timeFormat === 'hhmm' ? 'HH:MM' : 'decimal'}.`
    + `\nKolumner i ordning (vänster→höger över uppslaget):\n${lines.join('\n')}`
    + `\nAnvänd kolumnpositionen för att avgöra vilket fält ett värde tillhör — gissa ALDRIG på värdet.`
    + ` Kopiera ALDRIG ett värde mellan kolumner. Tom kolumn → utelämna fältet.`;
}

/**
 * Bygger den auktoritativa kolumnlistan för OCR-prompten (R4) för en sida.
 * Ex:  "  1. date (date, grupp: \"Date of flight\")\n  2. total_time (decimal)"
 */
export function buildColumnPromptBlock(layout: LogbookLayout, side: 'left' | 'right'): string {
  return pageColumns(layout, side)
    .map((c, i) => {
      const target = c.field ?? `"${c.label}" (ej mappad — läs men lämna omappad)`;
      const grp = c.group ? `, grupp: "${c.group}"` : '';
      return `  ${i + 1}. ${target} (${c.type}${grp})`;
    })
    .join('\n');
}
