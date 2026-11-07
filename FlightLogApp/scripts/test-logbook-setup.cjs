// Test av bokplanen när den digitala loggboken skapas (services/logbook/setupPlan.ts) tillsammans med bokens
// fördelning och uppslag (services/logbook/books.ts, paginate.ts): den senaste flygningen hamnar på sidan och raden
// man angav, tidigare böcker och Brought forward stämmer, och Total to date = alla timmar fram till flygningen.
// Kör: node scripts/test-logbook-setup.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const cache = {};
function load(rel) {
  const file = path.join(__dirname, '..', rel);
  if (cache[file]) return cache[file];
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[file] = mod.exports;
  const req = (m) => (m === './paginate' ? load('services/logbook/paginate.ts') : {});
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
}
const P = load('services/logbook/paginate.ts');
const B = load('services/logbook/books.ts');
const S = load('services/logbook/setupPlan.ts');
const T = load('constants/logbookTemplates.ts');
const tpl = T.getTemplate('easa-pilot-logbook');

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok:' : '  FEL:', m); };

// 742 flygningar, en per dag från 2014-03-12, 1.0 h var (PIC), plus en summeringsrad och backfill-raden.
const flights = [];
const d0 = Date.parse('2014-03-12T00:00:00Z');
for (let i = 0; i < 742; i++) {
  const date = new Date(d0 + i * 86400000 * 6).toISOString().slice(0, 10);
  flights.push({ id: i + 1, date, dep_utc: '10:00', arr_utc: '11:00', dep_place: 'ESCF', arr_place: 'ESCF', total_time: 1, pic: 1, night: 0, ifr: 0, dual: 0, instructor: 0, landings_day: 1, landings_night: 0, flight_type: 'normal', source: 'import' });
}
flights.push({ id: 9001, date: '2014-03-11', dep_utc: '', total_time: 0, pic: 25, landings_day: 0, flight_type: 'summary', remarks: 'Blades previous experience', source: 'manual' });
const bookFlights = P.sortFlightsChrono(flights.filter((f) => f.flight_type !== 'summary' && f.remarks !== '[BACKFILL]'));

function fake(plan) {
  return plan.books.map((b, i) => ({
    id: i + 1, name: `${i + 1}`, template_id: tpl.id, starting_page: b.startingPage, rows_per_spread: 12, end_page: b.endPage, end_row: 0,
    is_active: i === plan.books.length - 1 ? 1 : 0, created_at: '', kind: 'digital', opening_balance: '{}', custom_cols: '{}',
    anchor_flight_id: b.anchorFlightId, anchor_page: b.anchorPage, anchor_row: b.anchorRow, display_order: i, acked_spread: 0,
  }));
}
// Var flygningen hamnar: sidan (vänster) och raden på uppslaget, och uppslagets Total to date.
function locate(books, flightId) {
  const slices = B.assignFlightsToBooks(books, flights);
  for (const sl of slices) {
    const ob = B.resolveOpeningBalance(sl.book, books, flights, tpl);
    const spreads = P.buildBookSpreads(sl.flights, tpl, { startingPage: sl.book.starting_page, rowsPerSpread: 12, openingBalance: ob, leadingEmptyRows: sl.leadingEmptyRows });
    for (const sp of spreads) {
      const i = sp.flights.findIndex((f) => f.id === flightId);
      if (i >= 0) return { book: sl.book.id, page: sp.page_left, row: (sp.leadingBlanks ?? 0) + i + 1, toDate: sp.total_to_date, slices };
    }
  }
  return null;
}
const base = { bookFlightIds: bookFlights.map((f) => f.id), firstPage: 1, lastPage: 0, rowsPerSpread: 12, earlierLastPage: 100 };
const latest = bookFlights.length - 1;

console.log('En bok, alla flygningar får plats (förslaget: sida 123, rad 10)');
let plan = S.planBooks({ ...base, anchorPos: latest, page: 123, row: 10, earlierChoice: null });
ok(plan.earlier === 0 && plan.books.length === 1, `ingen tidigare bok (earlier ${plan.earlier})`);
let at = locate(fake(plan), bookFlights[latest].id);
ok(at && at.page === 123 && at.row === 10, `senaste flygningen på sida 123, rad 10 (fick ${at && at.page}, ${at && at.row})`);
ok(at && Math.abs(at.toDate.tt_total - 742) < 1e-6 && Math.abs(at.toDate.pic - 767) < 1e-6, `Total to date = alla timmar (fick total ${at && at.toDate.tt_total}, PIC ${at && at.toDate.pic} med 25 h backfill)`);

console.log('Sida 73, rad 10: 300 flygningar står i tidigare böcker');
plan = S.planBooks({ ...base, anchorPos: latest, page: 74, row: 10, earlierChoice: 'bf' });
ok(plan.leftPage === 73 && plan.room === 442 && plan.earlier === 300, `högersidan 74 = uppslag 73–74, plats 442, tidigare 300 (fick ${plan.leftPage}, ${plan.room}, ${plan.earlier})`);
at = locate(fake(plan), bookFlights[latest].id);
ok(at && at.page === 73 && at.row === 10, `Brought forward: senaste på sida 73, rad 10 (fick ${at && at.page}, ${at && at.row})`);
ok(at && Math.abs(at.toDate.tt_total - 742) < 1e-6, `Total to date = 742 h även med Brought forward (fick ${at && at.toDate.tt_total})`);
const first = at.slices[0];
ok(first.flights[0].id === bookFlights[300].id && first.leadingEmptyRows === 0, 'boken börjar med flygning 301 på rad 1');

plan = S.planBooks({ ...base, anchorPos: latest, page: 73, row: 10, earlierChoice: 'books' });
ok(plan.books.length === 2 && plan.books[0].count === 300, `tidigare loggböcker: 1st Logbook med 300 flygningar (fick ${plan.books.length} böcker, ${plan.books[0].count})`);
at = locate(fake(plan), bookFlights[latest].id);
ok(at && at.book === 2 && at.page === 73 && at.row === 10, `2nd Logbook: senaste på sida 73, rad 10 (fick bok ${at && at.book}, ${at && at.page}, ${at && at.row})`);
ok(at && Math.abs(at.toDate.tt_total - 742) < 1e-6, `Total to date = 742 h över båda böckerna (fick ${at && at.toDate.tt_total})`);
at = locate(fake(plan), bookFlights[0].id);
ok(at && at.book === 1 && at.page === 1 && at.row === 1, 'första flygningen på sida 1, rad 1 i 1st Logbook');

plan = S.planBooks({ ...base, anchorPos: latest, page: 73, row: 10, earlierChoice: 'books', earlierLastPage: 20 });
ok(plan.books.length === 4 && plan.books[0].count === 60 && plan.books[1].count === 120 && plan.books[2].count === 120, `små tidigare böcker (120 rader): 60 + 120 + 120 (fick ${plan.books.map((b) => b.count).join(', ')})`);
at = locate(fake(plan), bookFlights[latest].id);
ok(at && at.book === 4 && at.page === 73 && at.row === 10, `4th Logbook: senaste på sida 73, rad 10 (fick bok ${at && at.book}, ${at && at.page}, ${at && at.row})`);
at = locate(fake(plan), bookFlights[180].id);
ok(at && at.book === 3 && at.page === 1 && at.row === 1, `3rd Logbook börjar på sida 1, rad 1 (fick bok ${at && at.book}, ${at && at.page}, ${at && at.row})`);

plan = S.planBooks({ ...base, anchorPos: latest, page: 73, row: 10, earlierChoice: 'books', earlierFirstPage: 3, earlierLastPage: 22 });
ok(plan.books.length === 4 && plan.books[0].startingPage === 3 && plan.books[3].startingPage === 1, `tidigare böcker börjar på sida 3 (efter inledningen), den här på sida 1 (fick ${plan.books.map((b) => b.startingPage).join(', ')})`);
at = locate(fake(plan), bookFlights[180].id);
ok(at && at.book === 3 && at.page === 3 && at.row === 1, `3rd Logbook: första flygningen på sida 3, rad 1 (fick bok ${at && at.book}, ${at && at.page}, ${at && at.row})`);
at = locate(fake(plan), bookFlights[latest].id);
ok(at && at.book === 4 && at.page === 73 && at.row === 10, `den här boken oförändrad: sida 73, rad 10 (fick bok ${at && at.book}, ${at && at.page}, ${at && at.row})`);

console.log('Senaste flygningen i pappersboken är inte den senaste i Blades');
plan = S.planBooks({ ...base, anchorPos: latest - 2, page: 73, row: 10, earlierChoice: 'bf' });
at = locate(fake(plan), bookFlights[latest - 2].id);
ok(at && at.page === 73 && at.row === 10, `den inskrivna på sida 73, rad 10 (fick ${at && at.page}, ${at && at.row})`);
at = locate(fake(plan), bookFlights[latest].id);
ok(at && at.page === 73 && at.row === 12, `de två nyare på raderna efter (senaste på rad 12, fick ${at && at.page}, ${at && at.row})`);

console.log('Färre flygningar än plats: tomma rader överst');
plan = S.planBooks({ ...base, anchorPos: latest, page: 201, row: 3, earlierChoice: null });
at = locate(fake(plan), bookFlights[latest].id);
ok(plan.earlier === 0 && at && at.page === 201 && at.row === 3, `senaste på sida 201, rad 3 (fick ${at && at.page}, ${at && at.row})`);

console.log(fails ? `\n${fails} fel` : '\nAlla gröna');
process.exit(fails ? 1 : 0);
