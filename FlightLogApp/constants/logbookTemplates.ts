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
}

export const LOGBOOK_TEMPLATES: LogbookTemplate[] = [
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
