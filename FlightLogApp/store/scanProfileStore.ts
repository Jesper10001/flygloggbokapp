import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export interface ScanProfile {
  aircraftTypes: string[];           // 1. Farkoster du flugit
  homeCountries: string[];           // 2. Land du utgår från
  frequentIcaos: string[];           // 2b. Vanligaste flygplatser
  crewType: 'sp' | 'mp' | 'both';   // 3. SP/MP/Båda
  flightRules: 'vfr' | 'ifr' | 'both'; // Bonus: VFR/IFR default
  columnOrder: string[];             // 4. Kolumnordning
  rowsPerPage: number;               // 4b. Antal flygningsrader per sida
  summaryRowColumns: string[];       // 4c. Kolumner som har summa-rader (B/F, TTP, TTD)
  crewFormat: string;                // 5. Hur andrepilot anges
  timeFormat: 'decimal' | 'hhmm' | 'mixed'; // 6. Tidsformat i loggboken
  usesDitto: boolean;                // 7. Använder ditto-tecken
}

const EMPTY_PROFILE: ScanProfile = {
  aircraftTypes: [],
  homeCountries: [],
  frequentIcaos: [],
  crewType: 'sp',
  flightRules: 'both',
  columnOrder: [],
  rowsPerPage: 0,
  summaryRowColumns: [],
  crewFormat: '',
  timeFormat: 'hhmm',
  usesDitto: false,
};

interface ScanProfileState {
  profile: ScanProfile;
  loaded: boolean;
  load: () => Promise<void>;
  save: (p: ScanProfile) => Promise<void>;
  hasProfile: () => boolean;
}

export const useScanProfileStore = create<ScanProfileState>((set, get) => ({
  profile: EMPTY_PROFILE,
  loaded: false,

  load: async () => {
    const raw = await getSetting('scan_profile');
    if (raw) {
      try {
        set({ profile: { ...EMPTY_PROFILE, ...JSON.parse(raw) }, loaded: true });
      } catch {
        set({ loaded: true });
      }
    } else {
      set({ loaded: true });
    }
  },

  save: async (p: ScanProfile) => {
    await setSetting('scan_profile', JSON.stringify(p));
    set({ profile: p });
  },

  hasProfile: () => {
    const p = get().profile;
    return p.aircraftTypes.length > 0 || p.columnOrder.length > 0;
  },
}));

// All possible logbook columns for column ordering
export const LOGBOOK_COLUMNS = [
  { key: 'date', label_en: 'Date', label_sv: 'Datum' },
  { key: 'aircraft_type', label_en: 'Type / Model', label_sv: 'Typ / Modell' },
  { key: 'registration', label_en: 'Registration', label_sv: 'Registrering' },
  { key: 'dep_place', label_en: 'Departure', label_sv: 'Avgång' },
  { key: 'dep_utc', label_en: 'Dep time', label_sv: 'Avgångstid' },
  { key: 'arr_place', label_en: 'Arrival', label_sv: 'Ankomst' },
  { key: 'arr_utc', label_en: 'Arr time', label_sv: 'Ankomsttid' },
  { key: 'total_time', label_en: 'Total time', label_sv: 'Total tid' },
  { key: 'pic', label_en: 'PIC', label_sv: 'PIC' },
  { key: 'co_pilot', label_en: 'Co-pilot', label_sv: 'Co-pilot' },
  { key: 'dual', label_en: 'Dual', label_sv: 'Dual' },
  { key: 'instructor', label_en: 'Instructor', label_sv: 'Instruktör' },
  { key: 'multi_pilot', label_en: 'Multi-pilot', label_sv: 'Flerpilot' },
  { key: 'single_pilot', label_en: 'Single-pilot', label_sv: 'Enpilot' },
  { key: 'ifr', label_en: 'IFR', label_sv: 'IFR' },
  { key: 'vfr', label_en: 'VFR', label_sv: 'VFR' },
  { key: 'night', label_en: 'Night', label_sv: 'Natt' },
  { key: 'nvg', label_en: 'NVG', label_sv: 'NVG' },
  { key: 'landings_day', label_en: 'Landings day', label_sv: 'Ldg dag' },
  { key: 'landings_night', label_en: 'Landings night', label_sv: 'Ldg natt' },
  { key: 'flight_rules', label_en: 'Flight rules', label_sv: 'Flygregler' },
  { key: 'se_time', label_en: 'SE', label_sv: 'SE' },
  { key: 'me_time', label_en: 'ME', label_sv: 'ME' },
  { key: 'other_flight_time', label_en: 'Other type', label_sv: 'Annan flygtid' },
  { key: 'sim', label_en: 'Sim / STD', label_sv: 'Sim / STD' },
  { key: 'remarks', label_en: 'Remarks / 2nd pilot', label_sv: 'Anm. / Andrepilot' },
];

export function buildScanContext(p: ScanProfile): string {
  const lines: string[] = [];

  if (p.aircraftTypes.length > 0) {
    lines.push(`KNOWN AIRCRAFT TYPES: ${p.aircraftTypes.join(', ')}. Use these ONLY to resolve ambiguous handwriting — do NOT replace a clearly readable type with a different one from this list. If the logbook clearly says EC135, return EC135 even if A109 is also in the list.`);
  }
  if (p.homeCountries.length > 0) {
    lines.push(`HOME COUNTRIES: ${p.homeCountries.join(', ')}. ICAO codes will predominantly start with prefixes for these countries.`);
  }
  if (p.frequentIcaos.length > 0) {
    lines.push(`FREQUENT AIRPORTS: ${p.frequentIcaos.join(', ')}. Prioritize these when interpreting unclear ICAO codes.`);
  }
  if (p.crewType === 'sp') {
    lines.push('CREW TYPE: Single-pilot. Pilot time will appear in ONE of PIC, Dual, or Instructor — use the COLUMN POSITION to determine which field it is. Do NOT assume it is always PIC.');
  } else if (p.crewType === 'mp') {
    lines.push('CREW TYPE: Multi-pilot. Time may appear in PIC, Co-pilot, Dual, or Instructor columns. Use the COLUMN POSITION to determine the field.');
  }
  if (p.flightRules === 'vfr') {
    lines.push('FLIGHT RULES: Predominantly VFR. Default to VFR unless clearly marked IFR.');
  } else if (p.flightRules === 'ifr') {
    lines.push('FLIGHT RULES: Predominantly IFR. Default to IFR unless clearly marked VFR.');
  }
  if (p.columnOrder.length > 0) {
    const numbered = p.columnOrder.map((key, i) => `Column ${i + 1} = ${key}`).join('\n  ');
    lines.push(`COLUMN MAPPING (OVERRIDES the generic column structure in system prompt):\n  ${numbered}`);
    lines.push(`Total columns: ${p.columnOrder.length}. Count from left edge of LEFT page to right edge of RIGHT page.`);
    lines.push('This mapping is AUTHORITATIVE and OVERRIDES any column order described earlier in this prompt.');
    lines.push('Do NOT guess which column is which — use the position numbers above.');
    lines.push('If column 10 = dual, then the 10th physical column from the left contains DUAL time, not PIC or anything else.');
    lines.push('NEVER copy a value from one column to another. Each JSON field gets ONLY the value from its mapped column position. If a column is empty, return 0.');
    if (p.columnOrder.includes('sim')) {
      const simIdx = p.columnOrder.indexOf('sim') + 1;
      lines.push(`SIMULATOR: Column ${simIdx} = sim. The printed header may say "Synthetic training session", "STD", "FSTD", or "FFS" — these ALL map to the "sim" field in JSON. If this column has a value, set flight_type="sim" and put the time in the "sim" field. Do NOT put it in total_time, dual, or any other field.`);
    }
    const otherCols = p.columnOrder.filter(k => k.startsWith('other_flight_time'));
    if (otherCols.length > 0) {
      lines.push(`OTHER FLIGHT TIME COLUMNS: This logbook has ${otherCols.length} "Other type of flight time" column(s): ${otherCols.join(', ')}.`);
      lines.push('These columns may have a handwritten label (e.g. "AR landings", "NVD", "NVG") or be empty.');
      lines.push('For each row, read the value in each other_flight_time column and return it in the "other_times" object.');
      lines.push('Also read the column header text (handwritten or printed) for each other column and return in "other_time_labels".');
      lines.push('ALWAYS flag other_flight_time values for review so the user can confirm what type of time it is.');
    }
  }
  if (p.rowsPerPage > 0) {
    lines.push(`ROWS PER PAGE: This logbook has exactly ${p.rowsPerPage} flight rows per page. If you detect more than ${p.rowsPerPage} rows, you have likely read a duplicate — compare the rows and remove the duplicate. If you detect fewer, some rows may be empty or you missed one.`);
  }
  if (p.summaryRowColumns.length > 0) {
    lines.push(`SUMMARY ROWS: This logbook has Brought forward / Total this page / Total to date rows with sums in these columns: ${p.summaryRowColumns.join(', ')}. Read and return these values in page_totals. Do NOT count summary rows as flight rows.`);
  }
  if (p.crewFormat) {
    lines.push(`CREW/REMARKS FORMAT: Second pilot and crew are written as: ${p.crewFormat}. Use this pattern to parse names from remarks.`);
  }
  if (p.timeFormat === 'decimal') {
    lines.push('TIME FORMAT: Decimal (e.g. 1.5 = 1h30m). Values like "1.5" mean one and a half hours.');
  } else if (p.timeFormat === 'hhmm') {
    lines.push('TIME FORMAT: HH:MM (e.g. 1:30 = 1h30m). A colon separates hours and minutes.');
  } else {
    lines.push('TIME FORMAT: Mixed — may use both decimal and HH:MM. Infer from context.');
  }
  if (p.usesDitto) {
    lines.push('DITTO MARKS: This logbook uses ditto marks (″, --, or similar) to repeat the value from the row above. Resolve these to actual values.');
  }

  return lines.length > 0
    ? `\n\nSCAN PROFILE (user-provided context about this logbook):\n${lines.join('\n')}`
    : '';
}
