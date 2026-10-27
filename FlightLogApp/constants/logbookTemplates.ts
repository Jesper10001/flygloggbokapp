// Mallar för fysiska papperloggböcker. Används när användaren ska transkribera
// sina digitalt loggade flygningar till sin papperloggbok.
//
// Varje mall definierar:
//  - rows_per_spread: antal flygningar som får plats på ett uppslag
//  - columns: kolumn-grupper och vilken flight-property som visas i varje ruta
//  - Fri-text-kolumner (t.ex. "Other") kan lämnas tomma per flygning
//
// Transkriberingsvyn renderas i landscape — bredderna är relativa (flex-weights).

export interface LogbookColumn {
  id: string;                 // unik inom mallen
  label: string;              // rubrik som visas i tabellen
  flightKey?: string;         // vilken property på flight som mappas hit; omitted = free text
  format?: 'date' | 'time-utc' | 'decimal' | 'int' | 'text' | 'icao';
  width: number;              // relativ bredd (flex-weight)
  group?: string;             // gruppetikett som spänner över flera kolumner
  date_format?: string;       // för format:'date' — ordning dag/månad/år: 'iso'|'dmy'|'mdy'|'dmy2'|'mdy2'|'dmon'
}

// En cell i en explicit, nästlad tabellrubrik (rad-/kolumnspann som en riktig bok).
// Anges per mall via header_rows; saknas den härleds rubriken från kolumnernas group.
export interface LogbookHeaderCell {
  label: string;
  sub?: string;               // mindre underrubrik (t.ex. "dd/mm/yy")
  colSpan?: number;
  rowSpan?: number;
  dashR?: boolean;            // streckad högerkant (t.ex. mellan SE och ME)
  colId?: string;             // koppling till en (tom) kolumn — gör rubriken valbar
}

// Flygtidstyper som piloten kan tilldela en tom kolumn. kind avgör var de erbjuds: en tom kolumn under
// "Pilot function time" får funktionstider, övriga tomma kolumner får övriga tidstyper (villkor m.m.).
// Typer som redan finns i loggboken filtreras bort i UI (app/logbook/index.tsx); loggad tid sorteras först.
export interface AssignableField {
  key: string;                // flightKey i datan
  label: string;              // rubrik i loggboken
  format: 'decimal' | 'int';
  kind: 'function' | 'other'; // function = pilotfunktionstid; other = övriga tidstyper (inte funktionstid)
}

export const ASSIGNABLE_TIME_FIELDS: AssignableField[] = [
  // Pilotfunktionstid
  { key: 'pic', label: 'PIC', format: 'decimal', kind: 'function' },
  { key: 'co_pilot', label: 'Co-Pilot', format: 'decimal', kind: 'function' },
  { key: 'dual', label: 'Dual', format: 'decimal', kind: 'function' },
  { key: 'instructor', label: 'Instructor', format: 'decimal', kind: 'function' },
  { key: 'picus', label: 'PICUS', format: 'decimal', kind: 'function' },
  { key: 'spic', label: 'SPIC', format: 'decimal', kind: 'function' },
  { key: 'examiner', label: 'Examiner', format: 'decimal', kind: 'function' },
  { key: 'safety_pilot', label: 'Safety Pilot', format: 'decimal', kind: 'function' },
  { key: 'ferry_pic', label: 'Ferry PIC', format: 'decimal', kind: 'function' },
  { key: 'relief_crew', label: 'Relief Crew', format: 'decimal', kind: 'function' },
  { key: 'observer', label: 'Observer', format: 'decimal', kind: 'function' },
  // Övriga tidstyper
  { key: 'nvg', label: 'NVG', format: 'decimal', kind: 'other' },
  { key: 'vfr', label: 'VFR', format: 'decimal', kind: 'other' },
  { key: 'ifr', label: 'IFR', format: 'decimal', kind: 'other' },
  { key: 'night', label: 'Night', format: 'decimal', kind: 'other' },
  { key: 'cross_country', label: 'Cross-country', format: 'decimal', kind: 'other' },
  { key: 'multi_pilot', label: 'Multi-Pilot', format: 'decimal', kind: 'other' },
  { key: 'solo', label: 'Solo', format: 'decimal', kind: 'other' },
  { key: 'tng_count', label: 'Touch & Go', format: 'int', kind: 'other' },
];

/** Vilken sorts tid passar i en tom kolumn: under "Pilot function time" → funktionstid, annars övrig tid. */
export function slotKind(template: LogbookTemplate, colId: string): AssignableField['kind'] {
  const col = [...template.left_columns, ...template.right_columns].find((c) => c.id === colId);
  return col?.group === 'Pilot function time' ? 'function' : 'other';
}

export interface LogbookTemplate {
  id: string;
  name: string;
  rows_per_spread: number;    // flygningar per uppslag (dubbelsida)
  language: 'sv' | 'en';
  time_format: 'decimal' | 'hhmm';
  left_columns: LogbookColumn[];
  right_columns: LogbookColumn[];
  footer: {
    this_page_total: boolean;
    total_to_date: boolean;
    signature: boolean;
    brought_forward: boolean;
  };
  cover?: number;             // require(...) av omslagsbild — visas i väljaren
  descriptionKey?: string;    // i18n-nyckel för detaljtext under omslaget
  header_rows?: LogbookHeaderCell[][]; // explicit nästlad rubrik
  dashed_after?: string[];    // kolumn-id vars högerkant ritas streckad
  summary_layout?: 'bf-top' | 'bottom'; // var brought forward-raden hamnar
}

export const LOGBOOK_TEMPLATES: LogbookTemplate[] = [
  {
    id: 'easa-pilot-logbook',
    name: 'Pilot logbook',
    rows_per_spread: 12,
    language: 'en',
    time_format: 'decimal',
    cover: require('../assets/logbooks/pilot-logbook.png'),
    descriptionKey: 'tpl_pilot_logbook_desc',
    summary_layout: 'bottom',
    dashed_after: ['ifr', 'pic', 'dual', 'oft_sea', 'oft_instrument', 'ldg_day', 'ldg_night'],
    left_columns: [
      { id: 'date',       label: 'Date',         flightKey: 'date',          format: 'date',     width: 97, group: 'Date of flight or session' },
      { id: 'ac_mm',      label: 'Make/mod/var', flightKey: 'aircraft_type', format: 'text',     width: 92, group: 'Aircraft or FSTD' },
      { id: 'ac_reg',     label: 'Reg',          flightKey: 'registration',  format: 'text',     width: 86, group: 'Aircraft or FSTD' },
      { id: 'dep_place',  label: 'Place',        flightKey: 'dep_place',     format: 'icao',     width: 62, group: 'Departure / time' },
      { id: 'dep_utc',    label: 'UTC',          flightKey: 'dep_utc',       format: 'time-utc', width: 57, group: 'Departure / time' },
      { id: 'arr_place',  label: 'Place',        flightKey: 'arr_place',     format: 'icao',     width: 62, group: 'Arrival / time' },
      { id: 'arr_utc',    label: 'UTC',          flightKey: 'arr_utc',       format: 'time-utc', width: 57, group: 'Arrival / time' },
      { id: 'total_time', label: 'Total',        flightKey: 'tt_total',      format: 'decimal',  width: 70 },
      { id: 'ifr',        label: 'IFR',          flightKey: 'ifr',           format: 'decimal',  width: 57, group: 'Operational condition time' },
      { id: 'night',      label: 'Night',        flightKey: 'night',         format: 'decimal',  width: 57, group: 'Operational condition time' },
    ],
    right_columns: [
      { id: 'pic',            label: 'PIC',        flightKey: 'pic',           format: 'decimal', width: 48, group: 'Pilot function time' },
      { id: 'dual',           label: 'Dual',       flightKey: 'dual',          format: 'decimal', width: 48, group: 'Pilot function time' },
      { id: 'instructor',     label: 'Instructor', flightKey: 'instructor',    format: 'decimal', width: 59, group: 'Pilot function time' },
      { id: 'oft_sea',        label: 'Sea',                                                       width: 51, group: 'Other type of flight time' },
      { id: 'oft_instrument', label: 'Instrument',                                                width: 59, group: 'Other type of flight time' },
      { id: 'oft_iri',        label: 'IRI',                                                       width: 48, group: 'Other type of flight time' },
      { id: 'fstd',           label: 'FSTD',       flightKey: 'fstd',          format: 'decimal', width: 55 },
      { id: 'ldg_day',        label: 'Day',        flightKey: 'landings_day',  format: 'int',     width: 42, group: 'Landings' },
      { id: 'ldg_night',      label: 'Night',      flightKey: 'landings_night',format: 'int',     width: 44, group: 'Landings' },
      { id: 'ldg_sea',        label: 'Sea',                                                       width: 42, group: 'Landings' },
      { id: 'remarks',        label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 201 },
    ],
    header_rows: [
      [
        { label: 'Date of flight or session', sub: 'dd/mm/yy', rowSpan: 3 },
        { label: 'Aircraft or FSTD', colSpan: 2 },
        { label: 'Route of flight and times', colSpan: 4 },
        { label: 'Total time of flight', rowSpan: 3 },
        { label: 'Operational condition time', colSpan: 2 },
        { label: 'Pilot function time', colSpan: 3 },
        { label: 'Other type of flight time', colSpan: 3 },
        { label: 'FSTD session', rowSpan: 3 },
        { label: 'Landings', colSpan: 3 },
        { label: 'Remarks and endorsements', sub: '(solo, SPIC, name of PIC if not self etc)', rowSpan: 3 },
      ],
      [
        { label: 'Make, mod, variant', rowSpan: 2 },
        { label: 'Registration', rowSpan: 2 },
        { label: 'Departure / time', colSpan: 2 },
        { label: 'Arrival / time', colSpan: 2 },
        { label: 'IFR', rowSpan: 2, dashR: true },
        { label: 'Night', rowSpan: 2 },
        { label: 'PIC', rowSpan: 2, dashR: true },
        { label: 'Dual', rowSpan: 2, dashR: true },
        { label: 'Instructor', rowSpan: 2 },
        { label: 'Sea', rowSpan: 2, colId: 'oft_sea', dashR: true },
        { label: 'Instrument', rowSpan: 2, colId: 'oft_instrument', dashR: true },
        { label: 'IRI', rowSpan: 2, colId: 'oft_iri' },
        { label: 'Day', rowSpan: 2, dashR: true },
        { label: 'Night', rowSpan: 2, dashR: true },
        { label: 'Sea', rowSpan: 2 },
      ],
      [
        { label: 'Place' },
        { label: 'UTC' },
        { label: 'Place' },
        { label: 'UTC' },
      ],
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
  {
    id: 'easa-professional-pilot',
    name: 'Professional Pilot Logbook',
    rows_per_spread: 12,
    language: 'en',
    time_format: 'decimal',
    cover: require('../assets/logbooks/professional-pilot-logbook.png'),
    descriptionKey: 'tpl_professional_desc',
    summary_layout: 'bottom',
    dashed_after: ['sp_se', 'ldg_day', 'ldg_night'],
    left_columns: [
      { id: 'date',       label: 'Date',         flightKey: 'date',          format: 'date',     width: 86 },
      { id: 'ac_mm',      label: 'Make/mod/var', flightKey: 'aircraft_type', format: 'text',     width: 76, group: 'Aircraft or FSTD' },
      { id: 'ac_reg',     label: 'Reg',          flightKey: 'registration',  format: 'text',     width: 70, group: 'Aircraft or FSTD' },
      { id: 'dep_place',  label: 'Place',        flightKey: 'dep_place',     format: 'icao',     width: 50, group: 'Departure / time' },
      { id: 'dep_utc',    label: 'UTC',          flightKey: 'dep_utc',       format: 'time-utc', width: 48, group: 'Departure / time' },
      { id: 'arr_place',  label: 'Place',        flightKey: 'arr_place',     format: 'icao',     width: 50, group: 'Arrival / time' },
      { id: 'arr_utc',    label: 'UTC',          flightKey: 'arr_utc',       format: 'time-utc', width: 48, group: 'Arrival / time' },
      { id: 'total_time', label: 'Total',        flightKey: 'tt_total',      format: 'decimal',  width: 56 },
      { id: 'multi_pilot',label: 'MP',           flightKey: 'multi_pilot',   format: 'decimal',  width: 58 },
      { id: 'sp_se',      label: 'SE',           flightKey: 'sp_se',         format: 'decimal',  width: 43, group: 'Single-Pilot time' },
      { id: 'sp_me',      label: 'ME',           flightKey: 'sp_me',         format: 'decimal',  width: 43, group: 'Single-Pilot time' },
      { id: 'note_left',  label: '',                                                             width: 56 },
      { id: 'fstd',       label: 'FSTD',         flightKey: 'fstd',          format: 'decimal',  width: 56 },
    ],
    right_columns: [
      { id: 'pic',        label: 'PIC',          flightKey: 'pic',           format: 'decimal',  width: 52, group: 'Pilot function time' },
      { id: 'co_pilot',   label: 'Co-Pilot',     flightKey: 'co_pilot',      format: 'decimal',  width: 60, group: 'Pilot function time' },
      { id: 'dual',       label: 'Dual',         flightKey: 'dual',          format: 'decimal',  width: 52, group: 'Pilot function time' },
      { id: 'instructor', label: 'Instructor',   flightKey: 'instructor',    format: 'decimal',  width: 66, group: 'Pilot function time' },
      { id: 'note_right', label: '',                                                             width: 56, group: 'Pilot function time' },
      { id: 'ifr',        label: 'IFR',          flightKey: 'ifr',           format: 'decimal',  width: 52, group: 'Operational condition time' },
      { id: 'night',      label: 'Night',        flightKey: 'night',         format: 'decimal',  width: 54, group: 'Operational condition time' },
      { id: 'ldg_day',    label: 'Day',          flightKey: 'landings_day',  format: 'int',      width: 43, group: 'Landings' },
      { id: 'ldg_night',  label: 'Night',        flightKey: 'landings_night',format: 'int',      width: 45, group: 'Landings' },
      { id: 'ldg_sea',    label: 'Sea',                                                          width: 43, group: 'Landings' },
      { id: 'remarks',    label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 217 },
    ],
    header_rows: [
      [
        { label: 'Date of flight or session', sub: 'dd/mm/yy', rowSpan: 3 },
        { label: 'Aircraft or FSTD', colSpan: 2 },
        { label: 'Route of flight and times', colSpan: 4 },
        { label: 'Total time of flight', rowSpan: 3 },
        { label: 'Multi-Pilot time', rowSpan: 3 },
        { label: 'Single-Pilot time', colSpan: 2 },
        { label: '', rowSpan: 3, colId: 'note_left' },
        { label: 'FSTD session', rowSpan: 3 },
        { label: 'Pilot function time', colSpan: 5 },
        { label: 'Operational condition time', colSpan: 2 },
        { label: 'Landings', colSpan: 3 },
        { label: 'Remarks and endorsements', sub: '(I.e solo, instrument time, PICUS etc.)', rowSpan: 3 },
      ],
      [
        { label: 'Make, mod, variant', rowSpan: 2 },
        { label: 'Registration', rowSpan: 2 },
        { label: 'Departure / time', colSpan: 2 },
        { label: 'Arrival / time', colSpan: 2 },
        { label: 'SE', rowSpan: 2, dashR: true },
        { label: 'ME', rowSpan: 2 },
        { label: 'PIC', rowSpan: 2 },
        { label: 'Co-Pilot', rowSpan: 2 },
        { label: 'Dual', rowSpan: 2 },
        { label: 'Instructor', rowSpan: 2 },
        { label: '', rowSpan: 2, colId: 'note_right' },
        { label: 'IFR', rowSpan: 2 },
        { label: 'Night', rowSpan: 2 },
        { label: 'Day', rowSpan: 2, dashR: true },
        { label: 'Night', rowSpan: 2, dashR: true },
        { label: 'Sea', rowSpan: 2 },
      ],
      [
        { label: 'Place' },
        { label: 'UTC' },
        { label: 'Place' },
        { label: 'UTC' },
      ],
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
  // ── EASA AMC1 FCL.050 ────────────────────────────────────────────────────
  // Det officiella EASA-standardformatet (AMC1 FCL.050) i den kolumnordning
  // regeln föreskriver: Single-pilot SE/ME → Multi-pilot → Total → Name(s) PIC
  // → Landings → Operational condition (Night/IFR) → Pilot function (PIC/Co-
  // pilot/Dual/Instructor) → FSTD session (Type/Total) → Remarks.
  {
    id: 'easa-amc1-fcl050',
    name: 'EASA AMC1 FCL.050',
    rows_per_spread: 12,
    language: 'en',
    time_format: 'decimal',
    summary_layout: 'bottom',
    dashed_after: ['sp_se', 'ldg_night', 'ifr', 'instructor', 'fstd'],
    left_columns: [
      { id: 'date',        label: 'Date',         flightKey: 'date',          format: 'date',     width: 94 },
      { id: 'ac_mm',       label: 'Make/mod/var', flightKey: 'aircraft_type', format: 'text',     width: 89, group: 'Aircraft or FSTD' },
      { id: 'ac_reg',      label: 'Reg',          flightKey: 'registration',  format: 'text',     width: 82, group: 'Aircraft or FSTD' },
      { id: 'dep_place',   label: 'Place',        flightKey: 'dep_place',     format: 'icao',     width: 57, group: 'Departure / time' },
      { id: 'dep_utc',     label: 'UTC',          flightKey: 'dep_utc',       format: 'time-utc', width: 53, group: 'Departure / time' },
      { id: 'arr_place',   label: 'Place',        flightKey: 'arr_place',     format: 'icao',     width: 57, group: 'Arrival / time' },
      { id: 'arr_utc',     label: 'UTC',          flightKey: 'arr_utc',       format: 'time-utc', width: 53, group: 'Arrival / time' },
      { id: 'sp_se',       label: 'SE',           flightKey: 'sp_se',         format: 'decimal',  width: 49, group: 'Single-pilot time' },
      { id: 'sp_me',       label: 'ME',           flightKey: 'sp_me',         format: 'decimal',  width: 49, group: 'Single-pilot time' },
      { id: 'multi_pilot', label: 'MP',           flightKey: 'multi_pilot',   format: 'decimal',  width: 61 },
      { id: 'total_time',  label: 'Total',        flightKey: 'tt_total',      format: 'decimal',  width: 65 },
    ],
    right_columns: [
      { id: 'ldg_day',    label: 'Day',          flightKey: 'landings_day',   format: 'int',     width: 44, group: 'Landings' },
      { id: 'ldg_night',  label: 'Night',        flightKey: 'landings_night', format: 'int',     width: 46, group: 'Landings' },
      { id: 'night',      label: 'Night',        flightKey: 'night',          format: 'decimal', width: 49, group: 'Operational condition time' },
      { id: 'ifr',        label: 'IFR',          flightKey: 'ifr',            format: 'decimal', width: 49, group: 'Operational condition time' },
      { id: 'pic',        label: 'PIC',          flightKey: 'pic',            format: 'decimal', width: 49, group: 'Pilot function time' },
      { id: 'co_pilot',   label: 'Co-Pilot',     flightKey: 'co_pilot',       format: 'decimal', width: 55, group: 'Pilot function time' },
      { id: 'dual',       label: 'Dual',         flightKey: 'dual',           format: 'decimal', width: 49, group: 'Pilot function time' },
      { id: 'instructor', label: 'Instructor',   flightKey: 'instructor',     format: 'decimal', width: 61, group: 'Pilot function time' },
      { id: 'fstd_type',  label: 'Type',                                                         format: 'text',    width: 53, group: 'FSTD session' },
      { id: 'fstd',       label: 'Total',        flightKey: 'fstd',           format: 'decimal', width: 53, group: 'FSTD session' },
      { id: 'remarks',    label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 201 },
    ],
    header_rows: [
      [
        { label: 'Date of flight or session', sub: 'dd/mm/yy', rowSpan: 3 },
        { label: 'Aircraft or FSTD', colSpan: 2 },
        { label: 'Route of flight and times', colSpan: 4 },
        { label: 'Single-pilot time', colSpan: 2 },
        { label: 'Multi-pilot time', rowSpan: 3 },
        { label: 'Total time of flight', rowSpan: 3 },
        { label: 'Landings', colSpan: 2 },
        { label: 'Operational condition time', colSpan: 2 },
        { label: 'Pilot function time', colSpan: 4 },
        { label: 'FSTD session', colSpan: 2 },
        { label: 'Remarks and endorsements', sub: '(solo, SPIC, name of PIC if not self etc)', rowSpan: 3 },
      ],
      [
        { label: 'Make, mod, variant', rowSpan: 2 },
        { label: 'Registration', rowSpan: 2 },
        { label: 'Departure / time', colSpan: 2 },
        { label: 'Arrival / time', colSpan: 2 },
        { label: 'SE', rowSpan: 2, dashR: true },
        { label: 'ME', rowSpan: 2 },
        { label: 'Day', rowSpan: 2, dashR: true },
        { label: 'Night', rowSpan: 2 },
        { label: 'Night', rowSpan: 2, dashR: true },
        { label: 'IFR', rowSpan: 2 },
        { label: 'PIC', rowSpan: 2, dashR: true },
        { label: 'Co-Pilot', rowSpan: 2, dashR: true },
        { label: 'Dual', rowSpan: 2, dashR: true },
        { label: 'Instructor', rowSpan: 2 },
        { label: 'Type', rowSpan: 2, dashR: true },
        { label: 'Total', rowSpan: 2 },
      ],
      [
        { label: 'Place' },
        { label: 'UTC' },
        { label: 'Place' },
        { label: 'UTC' },
      ],
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
  {
    id: 'sv-easa-standard',
    name: 'Swedish EASA Pilot Logbook (12 rows)',
    rows_per_spread: 12,
    language: 'sv',
    time_format: 'decimal',
    left_columns: [
      { id: 'date',         label: 'Date of flight', flightKey: 'date',         format: 'date',     width: 91 },
      { id: 'ac_mm',        label: 'Make/Mod/Var',   flightKey: 'aircraft_type',format: 'text',     width: 73, group: 'Aircraft' },
      { id: 'ac_reg',       label: 'Registration',   flightKey: 'registration', format: 'text',     width: 78, group: 'Aircraft' },
      { id: 'dep_place',    label: 'Place',          flightKey: 'dep_place',    format: 'icao',     width: 54, group: 'Departure' },
      { id: 'dep_utc',      label: 'Time UTC',       flightKey: 'dep_utc',      format: 'time-utc', width: 59, group: 'Departure' },
      { id: 'arr_place',    label: 'Place',          flightKey: 'arr_place',    format: 'icao',     width: 54, group: 'Arrival' },
      { id: 'arr_utc',      label: 'Time UTC',       flightKey: 'arr_utc',      format: 'time-utc', width: 59, group: 'Arrival' },
      { id: 'total_time',   label: 'Total time',     flightKey: 'total_time',   format: 'decimal',  width: 64 },
      { id: 'ifr',          label: 'IFR',            flightKey: 'ifr',          format: 'decimal',  width: 54, group: 'Op. condition' },
      { id: 'night',        label: 'Night',          flightKey: 'night',        format: 'decimal',  width: 54, group: 'Op. condition' },
    ],
    right_columns: [
      { id: 'pic',          label: 'PIC',            flightKey: 'pic',          format: 'decimal',  width: 56, group: 'Pilot function' },
      { id: 'co_pilot',     label: 'Co-Pilot',       flightKey: 'co_pilot',     format: 'decimal',  width: 61, group: 'Pilot function' },
      { id: 'dual',         label: 'Dual',           flightKey: 'dual',         format: 'decimal',  width: 56, group: 'Pilot function' },
      { id: 'other',        label: 'Other',                                                         width: 113, group: 'Other type' },
      { id: 'std',          label: 'STD session',                                                   width: 67, group: 'Synthetic' },
      { id: 'ldg_day',      label: 'D',              flightKey: 'landings_day', format: 'int',      width: 41, group: 'Landings' },
      { id: 'ldg_night',    label: 'N',              flightKey: 'landings_night', format: 'int',    width: 41, group: 'Landings' },
      { id: 'remarks',      label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 205 },
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
  {
    id: 'sv-drone-logbook',
    name: 'Remote Pilot Logbook',
    rows_per_spread: 15,
    language: 'en',
    time_format: 'decimal',
    // Enhetligt med pilotböckerna: Total this page → Brought forward → Total to date, och
    // pilotsignaturen som cell till vänster (samma bottom-layout i renderSpread).
    summary_layout: 'bottom',
    // Officiell svensk drönar-loggbok (Transportstyrelsen — RPAS/UAS/UAV, ICAO/EU/CAA).
    left_columns: [
      { id: 'date',         label: 'Date',        flightKey: 'date',         format: 'date',     width: 77, group: 'Date of flight' },
      { id: 'ac_mm',        label: 'Make-Mod',    flightKey: 'aircraft_type',format: 'text',     width: 79, group: 'RPAS / UAS / UAV' },
      { id: 'ac_reg',       label: 'Reg or S/N',  flightKey: 'registration', format: 'text',     width: 84, group: 'RPAS / UAS / UAV' },
      { id: 'location',     label: 'Location',    flightKey: 'dep_place',    format: 'text',     width: 79, group: 'Location of flight and times' },
      { id: 'dep_utc',      label: 'Start',       flightKey: 'dep_utc',      format: 'time-utc', width: 45, group: 'Location of flight and times' },
      { id: 'arr_utc',      label: 'Land',        flightKey: 'arr_utc',      format: 'time-utc', width: 45, group: 'Location of flight and times' },
      { id: 'mission',      label: 'Type/Cat',    flightKey: 'mission_cat',  format: 'text',     width: 59, group: 'Type and Cat of mission' },
      { id: 'total_time',   label: 'Total time',  flightKey: 'total_time',   format: 'decimal',  width: 55 },
      { id: 'multi_rotor',  label: 'Multi-rotor', flightKey: 'multi_rotor',  format: 'decimal',  width: 55 },
      { id: 'single_rotor', label: 'Single-rotor',flightKey: 'single_rotor', format: 'decimal',  width: 55 },
      { id: 'fixed_wing',   label: 'Fixed-wing',  flightKey: 'fixed_wing',   format: 'decimal',  width: 55 },
    ],
    right_columns: [
      { id: 'pic',          label: 'PIC',         flightKey: 'pic',          format: 'decimal',  width: 49, group: 'Pilot function time' },
      { id: 'co_pilot_fpv', label: 'Co-Pilot',    flightKey: 'co_pilot_fpv', format: 'decimal',  width: 53, group: 'Pilot function time' },
      { id: 'dual',         label: 'Dual',        flightKey: 'dual',         format: 'decimal',  width: 49, group: 'Pilot function time' },
      { id: 'instructor',   label: 'Instructor',  flightKey: 'instructor',   format: 'decimal',  width: 61, group: 'Pilot function time' },
      { id: 'ifr',          label: 'IFR',         flightKey: 'ifr',          format: 'decimal',  width: 47, group: 'Operational condition time' },
      { id: 'night',        label: 'Night',       flightKey: 'night',        format: 'decimal',  width: 49, group: 'Operational condition time' },
      { id: 'vlos',         label: 'VLOS',        flightKey: 'vlos',         format: 'decimal',  width: 49, group: 'Operational condition time' },
      { id: 'bvlos',        label: 'BVLOS',       flightKey: 'bvlos',        format: 'decimal',  width: 51, group: 'Operational condition time' },
      { id: 'ldg_day',      label: 'D',           flightKey: 'landings_day', format: 'int',      width: 40, group: 'Landings' },
      { id: 'ldg_night',    label: 'N',           flightKey: 'landings_night',format: 'int',     width: 40, group: 'Landings' },
      { id: 'remarks',      label: 'Remarks and endorsement', flightKey: 'remarks', format: 'text', width: 200 },
    ],
    header_rows: [
      [
        { label: 'Date of flight', sub: 'dd/mm/yyy', rowSpan: 3 },
        { label: 'RPAS / UAS / UAV', colSpan: 2 },
        { label: 'Location of flight and times', colSpan: 3 },
        { label: 'Type and Cat of mission', rowSpan: 3 },
        { label: 'Total time', rowSpan: 3 },
        { label: 'Multi-rotor', rowSpan: 3 },
        { label: 'Single-rotor', rowSpan: 3 },
        { label: 'Fixed-wing', rowSpan: 3 },
        { label: 'Pilot function time', colSpan: 4 },
        { label: 'Operational condition time', colSpan: 4 },
        { label: 'Landings', sub: 'Day / Night', colSpan: 2 },
        { label: 'Remarks and endorsement', rowSpan: 3 },
      ],
      [
        { label: 'Make-Mod', rowSpan: 2 },
        { label: 'Reg or S/N', rowSpan: 2 },
        { label: 'Location', rowSpan: 2 },
        { label: 'Start', dashR: true },
        { label: 'Land' },
        { label: 'PIC', rowSpan: 2, dashR: true },
        { label: 'Co-Pilot', sub: '(FPV)', rowSpan: 2, dashR: true },
        { label: 'Dual', rowSpan: 2, dashR: true },
        { label: 'Instructor', rowSpan: 2 },
        { label: 'IFR', rowSpan: 2, dashR: true },
        { label: 'Night', rowSpan: 2, dashR: true },
        { label: 'VLOS', rowSpan: 2, dashR: true },
        { label: 'BVLOS', rowSpan: 2 },
        { label: 'D', rowSpan: 2, dashR: true },
        { label: 'N', rowSpan: 2 },
      ],
      [
        { label: 'UTC' },
        { label: 'UTC' },
      ],
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
  // ── FAA 14 CFR 61.51 ─────────────────────────────────────────────────────
  // Speglar de uppgifter §61.51(b) kräver: datum, typ + ident, avgång/ankomst,
  // total tid; erfarenhetstyp (solo/PIC/SIC/dual); förhållanden (dag/natt,
  // actual/simulated instrument, FSTD). Ingen block-tid (dep/arr UTC saknas);
  // actual instrument → ifr, SIC → co_pilot. Fri kolumn (Sim Inst).
  {
    id: 'faa-61-51',
    name: 'FAA 14 CFR 61.51',
    rows_per_spread: 10,
    language: 'en',
    time_format: 'decimal',
    summary_layout: 'bottom',
    // Sidindelning: datum, flygplan, rutt + Conditions of flight till vänster; piloting time, landningar, total
    // och remarks till höger → jämnt uppslag (tidigare 5/13 kolumner, vecket vid 30 %).
    left_columns: [
      { id: 'date',   label: 'Date',         flightKey: 'date',          format: 'date', width: 75, group: 'Date' },
      { id: 'ac_mm',  label: 'Make & Model', flightKey: 'aircraft_type', format: 'text', width: 86, group: 'Aircraft' },
      { id: 'ac_id',  label: 'Ident',        flightKey: 'registration',  format: 'text', width: 73, group: 'Aircraft' },
      { id: 'from',   label: 'From',         flightKey: 'dep_place',     format: 'icao', width: 52, group: 'Route of flight' },
      { id: 'to',     label: 'To',           flightKey: 'arr_place',     format: 'icao', width: 52, group: 'Route of flight' },
      { id: 'xc',        label: 'Cross Country', flightKey: 'cross_country', format: 'decimal', width: 56, group: 'Conditions of flight' },
      { id: 'night',     label: 'Night',         flightKey: 'night',         format: 'decimal', width: 47, group: 'Conditions of flight' },
      { id: 'actual',    label: 'Actual Inst',   flightKey: 'ifr',           format: 'decimal', width: 51, group: 'Conditions of flight' },
      { id: 'simulated', label: 'Sim Inst',                                  format: 'decimal', width: 51, group: 'Conditions of flight' },
      { id: 'fstd',      label: 'FTD/FFS',       flightKey: 'fstd',          format: 'decimal', width: 51, group: 'Conditions of flight' },
    ],
    right_columns: [
      { id: 'dual',      label: 'Dual Rcvd',     flightKey: 'dual',          format: 'decimal', width: 60, group: 'Type of piloting time' },
      { id: 'pic',       label: 'PIC',           flightKey: 'pic',           format: 'decimal', width: 54, group: 'Type of piloting time' },
      { id: 'sic',       label: 'SIC',           flightKey: 'co_pilot',      format: 'decimal', width: 54, group: 'Type of piloting time' },
      { id: 'solo',      label: 'Solo',          flightKey: 'solo',          format: 'decimal', width: 54, group: 'Type of piloting time' },
      { id: 'ldg_day',   label: 'Day',           flightKey: 'landings_day',  format: 'int',     width: 47, group: 'Landings' },
      { id: 'ldg_night', label: 'Night',         flightKey: 'landings_night',format: 'int',     width: 49, group: 'Landings' },
      { id: 'total',     label: 'Total',         flightKey: 'tt_total',      format: 'decimal', width: 62 },
      { id: 'remarks',   label: 'Remarks, Procedures, Endorsements', flightKey: 'remarks', format: 'text', width: 214 },
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
];

export function getTemplate(id: string): LogbookTemplate {
  return LOGBOOK_TEMPLATES.find((t) => t.id === id) ?? LOGBOOK_TEMPLATES[0];
}

// Hjälpare — formatera ett fält enligt kolumnen
export function formatCell(value: any, column: LogbookColumn): string {
  if (value === undefined || value === null || value === '') return '';
  switch (column.format) {
    case 'date':     return String(value);
    case 'time-utc': return String(value);
    case 'icao':     return String(value).toUpperCase();
    case 'int': {
      const n = parseInt(String(value), 10);
      return isNaN(n) || n === 0 ? '' : String(n);
    }
    case 'decimal': {
      const n = parseFloat(String(value).replace(',', '.'));
      if (isNaN(n) || n === 0) return '';
      return n.toFixed(1);
    }
    default: return String(value);
  }
}
