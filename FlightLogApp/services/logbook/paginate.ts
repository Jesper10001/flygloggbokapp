// Auto-paginering av den digitala loggboken.
//
// Till skillnad från transkriberingsflödet (db/logbookBooks.ts) som stämplar
// flygningar till uppslag manuellt, härleder den här modulen ALLA uppslag
// deterministiskt från flygdatan. Sida = startsida + uppslag*2. Brought
// forward / total this page / total to date beräknas kumulativt — helt utan
// OCR. Ingående balans (karriärtimmar i pappersboken innan digital loggning
// började) matas in manuellt en gång och adderas till alla "to date"-totaler.

import type { Flight } from '../../types/flight';
import type { LogbookTemplate, LogbookColumn } from '../../constants/logbookTemplates';

/** Totaler per kolumn, nycklade på flightKey (t.ex. total_time, pic, ifr …). */
export type ColumnTotals = Record<string, number>;

export interface LogbookSpread {
  spread_number: number;        // 1-indexerat
  page_left: number;            // sidnummer vänster
  page_right: number;           // sidnummer höger
  flights: Flight[];            // upp till rowsPerSpread flygningar
  total_this_page: ColumnTotals;
  brought_forward: ColumnTotals;
  total_to_date: ColumnTotals;
}

export interface LogbookConfig {
  startingPage: number;         // sidnumret för uppslag 1:s vänstersida
  rowsPerSpread: number;
  openingBalance: ColumnTotals; // ingående balans (manuellt inmatad)
}

/** De numeriska kolumner som ackumuleras (decimal/int med en flightKey). */
export function numericColumns(template: LogbookTemplate): LogbookColumn[] {
  return [...template.left_columns, ...template.right_columns].filter(
    (c) => (c.format === 'decimal' || c.format === 'int') && !!c.flightKey,
  );
}

/** Kronologisk ordning — samma sortering som transkriberingen använder. */
export function sortFlightsChrono(flights: Flight[]): Flight[] {
  return [...flights].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const da = a.dep_utc ?? '';
    const db = b.dep_utc ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  });
}

function sumFlights(flights: Flight[], cols: LogbookColumn[]): ColumnTotals {
  const out: ColumnTotals = {};
  for (const c of cols) {
    const key = c.flightKey!;
    let sum = 0;
    for (const f of flights) {
      const n = parseFloat(String((f as any)[key]));
      if (!isNaN(n)) sum += n;
    }
    // Avrunda decimaltimmar till en decimal så summorna inte driver iväg.
    out[key] = c.format === 'int' ? Math.round(sum) : Math.round(sum * 10) / 10;
  }
  return out;
}

function addTotals(a: ColumnTotals, b: ColumnTotals): ColumnTotals {
  const out: ColumnTotals = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = Math.round(((out[k] ?? 0) + b[k]) * 10) / 10;
  }
  return out;
}

const num = (v: any): number => {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
};

// Härledda "virtuella" fält som vissa mallar mappar mot (t.ex. Professional
// Pilot Logbook). De speglar hur en EASA-bok faktiskt fylls i:
//  - sim-pass hamnar i FSTD-kolumnen, inte i Total time of flight
//  - Single-Pilot SE/ME fylls bara för enpilotsflygningar (multi-pilot lämnas tomt)
export function deriveLogbookFields(f: Flight): Flight {
  const tt = num(f.total_time);
  const isSim = (f as any).flight_type === 'sim';
  const mp = num((f as any).multi_pilot);
  const se = num((f as any).se_time);
  const me = num((f as any).me_time);
  const singlePilot = !isSim && mp <= 0;
  return {
    ...f,
    tt_total: isSim ? 0 : tt,
    fstd: isSim ? tt : 0,
    sp_se: singlePilot ? se : 0,
    sp_me: singlePilot ? me : 0,
  } as Flight;
}

/**
 * Bygger alla uppslag från flygningarna. Tom loggbok ger ett (tomt) uppslag
 * så att vyn alltid har en sida att visa.
 */
export function buildSpreads(
  flights: Flight[],
  template: LogbookTemplate,
  config: LogbookConfig,
): LogbookSpread[] {
  const cols = numericColumns(template);
  const sorted = sortFlightsChrono(flights).map(deriveLogbookFields);
  const rows = Math.max(1, config.rowsPerSpread);
  const totalSpreads = Math.max(1, Math.ceil(sorted.length / rows));

  const spreads: LogbookSpread[] = [];
  let runningToDate: ColumnTotals = { ...config.openingBalance };

  for (let i = 0; i < totalSpreads; i++) {
    const chunk = sorted.slice(i * rows, i * rows + rows);
    const thisPage = sumFlights(chunk, cols);
    const broughtForward = { ...runningToDate };
    const toDate = addTotals(broughtForward, thisPage);
    runningToDate = toDate;

    const n = i + 1;
    spreads.push({
      spread_number: n,
      page_left: config.startingPage + (n - 1) * 2,
      page_right: config.startingPage + (n - 1) * 2 + 1,
      flights: chunk,
      total_this_page: thisPage,
      brought_forward: broughtForward,
      total_to_date: toDate,
    });
  }
  return spreads;
}
