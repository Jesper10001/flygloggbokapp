// TILLFÄLLIG felsökning: bygger en komplett rapport över var loggbokens totaler kommer ifrån,
// så vi kan förstå varför "total to date" ≠ faktiskt importerade timmar. Loggas till Metro-
// terminalen vid app-start (logLogbookDiagnostics) → kopiera därifrån. Ta bort när buggen är löst.
import { getFlights, getFlightStats } from '../../db/flights';
import { listDigitalBooks } from '../../db/digitalBooks';
import { getBackfill } from '../../db/backfill';
import { getTemplate } from '../../constants/logbookTemplates';
import { resolveOpeningBalance, assignFlightsToBooks } from './books';
import { computeBroughtForward, buildBookSpreads, deriveLogbookFields } from './paginate';
import type { Flight } from '../../types/flight';

const r1 = (n: number) => Math.round(n * 10) / 10;
const sumField = (flights: Flight[], key: string): number => {
  let s = 0;
  for (const f of flights) { const n = parseFloat(String((f as any)[key])); if (!isNaN(n)) s += n; }
  return r1(s);
};
const countBy = (flights: Flight[], key: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const f of flights) { const v = String((f as any)[key] ?? '∅'); out[v] = (out[v] ?? 0) + 1; }
  return out;
};

export async function buildLogbookDiagnostics(): Promise<string> {
  const L: string[] = [];
  const p = (s = '') => L.push(s);
  try {
    const flights = await getFlights(100000);
    const summaryRows = flights.filter((f) => (f as any).flight_type === 'summary');
    const backfillFlights = flights.filter((f) => (f.remarks ?? '') === '[BACKFILL]');
    const nonSummary = flights.filter((f) => (f as any).flight_type !== 'summary');
    const nonSummaryNonBF = nonSummary.filter((f) => (f.remarks ?? '') !== '[BACKFILL]');
    const simRows = flights.filter((f) => (f as any).flight_type === 'sim');

    p('===== LOGBOOK DIAGNOSTICS =====');
    p('');
    p('[FLIGHTS]');
    p(`total flights: ${flights.length}`);
    p(`by flight_type: ${JSON.stringify(countBy(flights, 'flight_type'))}`);
    p(`by source: ${JSON.stringify(countBy(flights, 'source'))}`);
    p(`by status: ${JSON.stringify(countBy(flights, 'status'))}`);
    p('');
    p(`SUM total_time ALL flights:            ${sumField(flights, 'total_time')} h`);
    p(`SUM total_time excl summary:           ${sumField(nonSummary, 'total_time')} h`);
    p(`SUM total_time excl summary & backfill:${sumField(nonSummaryNonBF, 'total_time')} h`);
    p(`SUM total_time SUMMARY rows only:      ${sumField(summaryRows, 'total_time')} h   (count=${summaryRows.length})`);
    p(`SUM total_time SIM rows:               ${sumField(simRows, 'total_time')} h   (count=${simRows.length})`);
    p(`SUM pic ALL:  ${sumField(flights, 'pic')} | night ALL: ${sumField(flights, 'night')} | ifr ALL: ${sumField(flights, 'ifr')}`);
    p(`[BACKFILL] flights present: ${backfillFlights.length}`);
    p('');

    p('[SUMMARY ROWS] (flight_type=summary → feeds brought-forward)');
    if (!summaryRows.length) p('  (none)');
    for (const f of summaryRows) {
      p(`  id=${f.id} date=${f.date} tt=${f.total_time} pic=${f.pic} night=${f.night} ifr=${f.ifr} src=${(f as any).source} rmk="${(f.remarks ?? '').slice(0, 40)}"`);
    }
    p('');

    p('[BACKFILL SETTING] settings[backfill_hours]');
    try { p('  ' + JSON.stringify(await getBackfill())); } catch (e: any) { p('  ERR ' + e?.message); }
    p('');

    p('[APP STATS] getFlightStats()');
    try { p('  ' + JSON.stringify(await getFlightStats())); } catch (e: any) { p('  ERR ' + e?.message); }
    p('');

    const books = await listDigitalBooks();
    p(`[DIGITAL BOOKS] count=${books.length}`);
    for (const book of books) {
      const template = getTemplate(book.template_id);
      p('');
      p(`  ── BOOK id=${book.id} "${book.name}" ─────────────`);
      p(`  template_id=${book.template_id} active=${(book as any).is_active} display_order=${(book as any).display_order}`);
      p(`  starting_page=${book.starting_page} rows_per_spread=${book.rows_per_spread} anchor_flight_id=${book.anchor_flight_id}`);
      p(`  opening_balance (raw JSON): ${book.opening_balance || '{}'}`);
      let obEff: any = {}, obAuto: any = {};
      try { obEff = resolveOpeningBalance(book, books, flights, template); } catch (e: any) { p('  resolveOpeningBalance ERR ' + e?.message); }
      try { obAuto = computeBroughtForward(flights, template, book.anchor_flight_id); } catch (e: any) { p('  computeBroughtForward ERR ' + e?.message); }
      p(`  resolveOpeningBalance (EFFECTIVE brought-forward): ${JSON.stringify(obEff)}`);
      p(`  computeBroughtForward (auto, before anchor):        ${JSON.stringify(obAuto)}`);
      try {
        const slice = assignFlightsToBooks(books, flights).find((s) => s.book.id === book.id);
        const sf = slice?.flights ?? [];
        p(`  slice: flightCount=${sf.length} leadingEmptyRows=${slice?.leadingEmptyRows ?? 0}`);
        p(`  slice SUM total_time=${sumField(sf, 'total_time')} h | tt_total(derived, sim excl)=${sumField(sf.map(deriveLogbookFields), 'tt_total')} h`);
        const spreads = buildBookSpreads(sf, template, {
          startingPage: book.starting_page,
          rowsPerSpread: book.rows_per_spread,
          openingBalance: obEff,
          leadingEmptyRows: slice?.leadingEmptyRows ?? 0,
        });
        p(`  spreads: ${spreads.length}`);
        if (spreads.length) {
          p(`  FIRST spread brought_forward: ${JSON.stringify(spreads[0].brought_forward)}`);
          const last = spreads[spreads.length - 1];
          p(`  LAST spread total_this_page:  ${JSON.stringify(last.total_this_page)}`);
          p(`  LAST spread TOTAL_TO_DATE:    ${JSON.stringify(last.total_to_date)}`);
        }
      } catch (e: any) { p('  spreads ERR ' + e?.message); }
    }
    p('');
    p('===== END =====');
  } catch (e: any) {
    p('DIAGNOSTICS FATAL: ' + (e?.message ?? String(e)));
  }
  return L.join('\n');
}

// Loggar rapporten till Metro-terminalen (Expo Go). Tydliga markörer så den är lätt att kopiera.
export async function logLogbookDiagnostics(): Promise<void> {
  try {
    const report = await buildLogbookDiagnostics();
    console.log('\n\n<<<<<<<<<< COPY FROM HERE >>>>>>>>>>\n' + report + '\n<<<<<<<<<< COPY TO HERE >>>>>>>>>>\n\n');
  } catch (e: any) {
    console.log('logLogbookDiagnostics ERR', e?.message ?? e);
  }
}
