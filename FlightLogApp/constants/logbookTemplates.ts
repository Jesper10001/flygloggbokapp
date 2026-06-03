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

// Flygtidstyper som piloten kan tilldela en tom kolumn. Bara typer som inte
// redan finns i loggboken och som piloten har data för erbjuds (filtreras i UI).
export interface AssignableField {
  key: string;                // flightKey i datan
  label: string;              // rubrik i loggboken
  format: 'decimal' | 'int';
}

export const ASSIGNABLE_TIME_FIELDS: AssignableField[] = [
  { key: 'nvg', label: 'NVG', format: 'decimal' },
  { key: 'picus', label: 'PICUS', format: 'decimal' },
  { key: 'spic', label: 'SPIC', format: 'decimal' },
  { key: 'vfr', label: 'VFR', format: 'decimal' },
  { key: 'examiner', label: 'Examiner', format: 'decimal' },
  { key: 'safety_pilot', label: 'Safety Pilot', format: 'decimal' },
  { key: 'observer', label: 'Observer', format: 'decimal' },
  { key: 'ferry_pic', label: 'Ferry PIC', format: 'decimal' },
  { key: 'relief_crew', label: 'Relief Crew', format: 'decimal' },
  { key: 'cross_country', label: 'Cross-country', format: 'decimal' },
  { key: 'solo', label: 'Solo', format: 'decimal' },
  { key: 'tng_count', label: 'Touch & Go', format: 'int' },
];

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
      { id: 'date',       label: 'Date',         flightKey: 'date',          format: 'date',     width: 88, group: 'Date of flight or session' },
      { id: 'ac_mm',      label: 'Make/mod/var', flightKey: 'aircraft_type', format: 'text',     width: 84, group: 'Aircraft or FSTD' },
      { id: 'ac_reg',     label: 'Reg',          flightKey: 'registration',  format: 'text',     width: 78, group: 'Aircraft or FSTD' },
      { id: 'dep_place',  label: 'Place',        flightKey: 'dep_place',     format: 'icao',     width: 56, group: 'Departure / time' },
      { id: 'dep_utc',    label: 'UTC',          flightKey: 'dep_utc',       format: 'time-utc', width: 52, group: 'Departure / time' },
      { id: 'arr_place',  label: 'Place',        flightKey: 'arr_place',     format: 'icao',     width: 56, group: 'Arrival / time' },
      { id: 'arr_utc',    label: 'UTC',          flightKey: 'arr_utc',       format: 'time-utc', width: 52, group: 'Arrival / time' },
      { id: 'total_time', label: 'Total',        flightKey: 'tt_total',      format: 'decimal',  width: 64 },
      { id: 'ifr',        label: 'IFR',          flightKey: 'ifr',           format: 'decimal',  width: 52, group: 'Operational condition time' },
      { id: 'night',      label: 'Night',        flightKey: 'night',         format: 'decimal',  width: 52, group: 'Operational condition time' },
    ],
    right_columns: [
      { id: 'pic',            label: 'PIC',        flightKey: 'pic',           format: 'decimal', width: 52, group: 'Pilot function time' },
      { id: 'dual',           label: 'Dual',       flightKey: 'dual',          format: 'decimal', width: 52, group: 'Pilot function time' },
      { id: 'instructor',     label: 'Instructor', flightKey: 'instructor',    format: 'decimal', width: 64, group: 'Pilot function time' },
      { id: 'oft_sea',        label: 'Sea',                                                       width: 56, group: 'Other type of flight time' },
      { id: 'oft_instrument', label: 'Instrument',                                                width: 64, group: 'Other type of flight time' },
      { id: 'oft_iri',        label: 'IRI',                                                       width: 52, group: 'Other type of flight time' },
      { id: 'fstd',           label: 'FSTD',       flightKey: 'fstd',          format: 'decimal', width: 60 },
      { id: 'ldg_day',        label: 'Day',        flightKey: 'landings_day',  format: 'int',     width: 46, group: 'Landings' },
      { id: 'ldg_night',      label: 'Night',      flightKey: 'landings_night',format: 'int',     width: 48, group: 'Landings' },
      { id: 'ldg_sea',        label: 'Sea',                                                       width: 46, group: 'Landings' },
      { id: 'remarks',        label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 220 },
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
      { id: 'date',       label: 'Date',         flightKey: 'date',          format: 'date',     width: 88 },
      { id: 'ac_mm',      label: 'Make/mod/var', flightKey: 'aircraft_type', format: 'text',     width: 78, group: 'Aircraft or FSTD' },
      { id: 'ac_reg',     label: 'Reg',          flightKey: 'registration',  format: 'text',     width: 72, group: 'Aircraft or FSTD' },
      { id: 'dep_place',  label: 'Place',        flightKey: 'dep_place',     format: 'icao',     width: 52, group: 'Departure / time' },
      { id: 'dep_utc',    label: 'UTC',          flightKey: 'dep_utc',       format: 'time-utc', width: 50, group: 'Departure / time' },
      { id: 'arr_place',  label: 'Place',        flightKey: 'arr_place',     format: 'icao',     width: 52, group: 'Arrival / time' },
      { id: 'arr_utc',    label: 'UTC',          flightKey: 'arr_utc',       format: 'time-utc', width: 50, group: 'Arrival / time' },
      { id: 'total_time', label: 'Total',        flightKey: 'tt_total',      format: 'decimal',  width: 58 },
      { id: 'multi_pilot',label: 'MP',           flightKey: 'multi_pilot',   format: 'decimal',  width: 60 },
      { id: 'sp_se',      label: 'SE',           flightKey: 'sp_se',         format: 'decimal',  width: 44, group: 'Single-Pilot time' },
      { id: 'sp_me',      label: 'ME',           flightKey: 'sp_me',         format: 'decimal',  width: 44, group: 'Single-Pilot time' },
      { id: 'note_left',  label: '',                                                             width: 58 },
      { id: 'fstd',       label: 'FSTD',         flightKey: 'fstd',          format: 'decimal',  width: 58 },
    ],
    right_columns: [
      { id: 'pic',        label: 'PIC',          flightKey: 'pic',           format: 'decimal',  width: 50, group: 'Pilot function time' },
      { id: 'co_pilot',   label: 'Co-Pilot',     flightKey: 'co_pilot',      format: 'decimal',  width: 58, group: 'Pilot function time' },
      { id: 'dual',       label: 'Dual',         flightKey: 'dual',          format: 'decimal',  width: 50, group: 'Pilot function time' },
      { id: 'instructor', label: 'Instructor',   flightKey: 'instructor',    format: 'decimal',  width: 64, group: 'Pilot function time' },
      { id: 'note_right', label: '',                                                             width: 54, group: 'Pilot function time' },
      { id: 'ifr',        label: 'IFR',          flightKey: 'ifr',           format: 'decimal',  width: 50, group: 'Operational condition time' },
      { id: 'night',      label: 'Night',        flightKey: 'night',         format: 'decimal',  width: 52, group: 'Operational condition time' },
      { id: 'ldg_day',    label: 'Day',          flightKey: 'landings_day',  format: 'int',      width: 42, group: 'Landings' },
      { id: 'ldg_night',  label: 'Night',        flightKey: 'landings_night',format: 'int',      width: 44, group: 'Landings' },
      { id: 'ldg_sea',    label: 'Sea',                                                          width: 42, group: 'Landings' },
      { id: 'remarks',    label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 210 },
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
  {
    id: 'sv-easa-standard',
    name: 'Svensk EASA Pilot Logbook (12 rader)',
    rows_per_spread: 12,
    language: 'sv',
    time_format: 'decimal',
    left_columns: [
      { id: 'date',         label: 'Date of flight', flightKey: 'date',         format: 'date',     width: 95 },
      { id: 'ac_mm',        label: 'Make/Mod/Var',   flightKey: 'aircraft_type',format: 'text',     width: 75, group: 'Aircraft' },
      { id: 'ac_reg',       label: 'Registration',   flightKey: 'registration', format: 'text',     width: 80, group: 'Aircraft' },
      { id: 'dep_place',    label: 'Place',          flightKey: 'dep_place',    format: 'icao',     width: 55, group: 'Departure' },
      { id: 'dep_utc',      label: 'Time UTC',       flightKey: 'dep_utc',      format: 'time-utc', width: 60, group: 'Departure' },
      { id: 'arr_place',    label: 'Place',          flightKey: 'arr_place',    format: 'icao',     width: 55, group: 'Arrival' },
      { id: 'arr_utc',      label: 'Time UTC',       flightKey: 'arr_utc',      format: 'time-utc', width: 60, group: 'Arrival' },
      { id: 'total_time',   label: 'Total time',     flightKey: 'total_time',   format: 'decimal',  width: 65 },
      { id: 'ifr',          label: 'IFR',            flightKey: 'ifr',          format: 'decimal',  width: 55, group: 'Op. condition' },
      { id: 'night',        label: 'Night',          flightKey: 'night',        format: 'decimal',  width: 55, group: 'Op. condition' },
    ],
    right_columns: [
      { id: 'pic',          label: 'PIC',            flightKey: 'pic',          format: 'decimal',  width: 55, group: 'Pilot function' },
      { id: 'co_pilot',     label: 'Co-Pilot',       flightKey: 'co_pilot',     format: 'decimal',  width: 60, group: 'Pilot function' },
      { id: 'dual',         label: 'Dual',           flightKey: 'dual',         format: 'decimal',  width: 55, group: 'Pilot function' },
      { id: 'other',        label: 'Other',                                                         width: 110, group: 'Other type' },
      { id: 'std',          label: 'STD session',                                                   width: 65, group: 'Synthetic' },
      { id: 'ldg_day',      label: 'D',              flightKey: 'landings_day', format: 'int',      width: 40, group: 'Landings' },
      { id: 'ldg_night',    label: 'N',              flightKey: 'landings_night', format: 'int',    width: 40, group: 'Landings' },
      { id: 'remarks',      label: 'Remarks and endorsements', flightKey: 'remarks', format: 'text', width: 200 },
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
    name: 'Drönare Loggbok (15 rader)',
    rows_per_spread: 15,
    language: 'sv',
    time_format: 'decimal',
    left_columns: [
      { id: 'date',         label: 'Datum',          flightKey: 'date',         format: 'date',     width: 90 },
      { id: 'ac_type',      label: 'Dröntyp',        flightKey: 'aircraft_type',format: 'text',     width: 85 },
      { id: 'ac_reg',       label: 'Registrering',   flightKey: 'registration', format: 'text',     width: 85 },
      { id: 'dep_place',    label: 'Plats',          flightKey: 'dep_place',    format: 'icao',     width: 75 },
      { id: 'dep_utc',      label: 'Start UTC',      flightKey: 'dep_utc',      format: 'time-utc', width: 65 },
      { id: 'arr_utc',      label: 'Landning UTC',   flightKey: 'arr_utc',      format: 'time-utc', width: 75 },
      { id: 'total_time',   label: 'Total tid',      flightKey: 'total_time',   format: 'decimal',  width: 70 },
    ],
    right_columns: [
      { id: 'pic',          label: 'PIC',            flightKey: 'pic',          format: 'decimal',  width: 55 },
      { id: 'ifr',          label: 'IFR',            flightKey: 'ifr',          format: 'decimal',  width: 50 },
      { id: 'night',        label: 'Natt',           flightKey: 'night',        format: 'decimal',  width: 55 },
      { id: 'distance',     label: 'Avstånd (km)',                                                  width: 85 },
      { id: 'altitude',     label: 'Max höjd (m)',                                                  width: 85 },
      { id: 'battery',      label: 'Batteri %',                                                    width: 75 },
      { id: 'remarks',      label: 'Anteckningar',   flightKey: 'remarks',      format: 'text',     width: 200 },
    ],
    footer: {
      this_page_total: true,
      total_to_date: true,
      signature: true,
      brought_forward: true,
    },
  },
  // ── FAA Pilot Logbook ────────────────────────────────────────────────────
  // Representativ FAA-layout som startpunkt. FAA-böcker varierar mellan förlag —
  // användaren finjusterar via custom-skaparen. Skillnader mot EASA som speglas:
  //  • ingen block-tid (dep/arr UTC saknas), bara "Total Duration"
  //  • återanvänder befintliga fält: actual instrument → ifr, SIC → co_pilot
  //  • förstklassiga: cross_country, solo. Free-kolumner (approaches, simulated
  //    instrument) lämnas omappade tills de promotas.
  {
    id: 'faa-pilot-logbook',
    name: 'FAA Pilot Logbook',
    rows_per_spread: 10,
    language: 'en',
    time_format: 'decimal',
    summary_layout: 'bottom',
    left_columns: [
      { id: 'date',      label: 'Date',         flightKey: 'date',          format: 'date', width: 80, group: 'Date' },
      { id: 'ac_mm',     label: 'Make & Model', flightKey: 'aircraft_type', format: 'text', width: 90, group: 'Aircraft' },
      { id: 'ac_id',     label: 'Ident',        flightKey: 'registration',  format: 'text', width: 78, group: 'Aircraft' },
      { id: 'from',      label: 'From',         flightKey: 'dep_place',     format: 'icao', width: 56, group: 'Route of flight' },
      { id: 'to',        label: 'To',           flightKey: 'arr_place',     format: 'icao', width: 56, group: 'Route of flight' },
      { id: 'appr',      label: 'Appr',                                     format: 'int',  width: 44 },
    ],
    right_columns: [
      { id: 'xc',        label: 'Cross Country', flightKey: 'cross_country', format: 'decimal', width: 60, group: 'Conditions of flight' },
      { id: 'night',     label: 'Night',         flightKey: 'night',         format: 'decimal', width: 52, group: 'Conditions of flight' },
      { id: 'actual',    label: 'Actual Inst',   flightKey: 'ifr',           format: 'decimal', width: 56, group: 'Conditions of flight' },
      { id: 'simulated', label: 'Sim Inst',                                  format: 'decimal', width: 56, group: 'Conditions of flight' },
      { id: 'dual',      label: 'Dual Rcvd',     flightKey: 'dual',          format: 'decimal', width: 56, group: 'Type of piloting time' },
      { id: 'pic',       label: 'PIC',           flightKey: 'pic',           format: 'decimal', width: 52, group: 'Type of piloting time' },
      { id: 'sic',       label: 'SIC',           flightKey: 'co_pilot',      format: 'decimal', width: 52, group: 'Type of piloting time' },
      { id: 'solo',      label: 'Solo',          flightKey: 'solo',          format: 'decimal', width: 52, group: 'Type of piloting time' },
      { id: 'ldg_day',   label: 'Day',           flightKey: 'landings_day',  format: 'int',     width: 44, group: 'Landings' },
      { id: 'ldg_night', label: 'Night',         flightKey: 'landings_night',format: 'int',     width: 46, group: 'Landings' },
      { id: 'total',     label: 'Total',         flightKey: 'tt_total',      format: 'decimal', width: 60 },
      { id: 'remarks',   label: 'Remarks, Procedures, Endorsements', flightKey: 'remarks', format: 'text', width: 200 },
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
