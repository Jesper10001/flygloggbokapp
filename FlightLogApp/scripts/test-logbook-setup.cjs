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

// ── En bok till: den nya boken börjar där dess ankare säger, inte med ankar-flygningen ──
{
  // 444 flygningar: 420 fyller första boken (sid 24–93, 12 rader), 24 står i den nya (senaste på sid 26, rad 12).
  // Plus summeringsraden och sim-raden från Backfill missing hours (de tar ingen rad).
  const fl = [];
  for (let i = 0; i < 444; i++) {
    const date = new Date(Date.parse('2023-01-16T00:00:00Z') + i * 86400000 * 3).toISOString().slice(0, 10);
    fl.push({ id: i + 1, date, dep_utc: '10:00', arr_utc: '11:00', dep_place: 'ESCF', arr_place: 'ESCF', total_time: 1, pic: 1, landings_day: 1, flight_type: 'flight', remarks: '', source: 'ocr' });
  }
  fl.push({ id: 9001, date: '2023-01-15', dep_utc: '', total_time: 0, pic: 25, landings_day: 0, flight_type: 'summary', remarks: 'Blades previous experience', source: 'manual' });
  fl.push({ id: 9002, date: '2023-01-15', dep_utc: '', total_time: -22.1, flight_type: 'sim', remarks: 'Blades previous experience', source: 'manual' });
  const book = (id, o) => ({ id, name: `${id}`, template_id: tpl.id, starting_page: 24, rows_per_spread: 12, end_page: 0, end_row: 0, is_active: 0, created_at: '', kind: 'digital',
    opening_balance: '{}', custom_cols: '{}', anchor_flight_id: 0, anchor_page: 0, anchor_row: 0, display_order: id - 1, acked_spread: 0, ...o });
  const where = (books, flightId) => {
    const slices = B.assignFlightsToBooks(books, fl);
    for (const sl of slices) {
      const ob = B.resolveOpeningBalance(sl.book, books, fl, tpl);
      const spreads = P.buildBookSpreads(sl.flights, tpl, { startingPage: sl.book.starting_page, rowsPerSpread: 12, openingBalance: ob, leadingEmptyRows: sl.leadingEmptyRows });
      for (const sp of spreads) {
        const i = sp.flights.findIndex((f) => f.id === flightId);
        if (i >= 0) return { book: sl.book.id, page: sp.page_left, row: (sp.leadingBlanks ?? 0) + i + 1, bf: spreads[0].brought_forward, toDate: sp.total_to_date, lastPage: spreads[spreads.length - 1].page_right };
      }
    }
    return null;
  };

  console.log('En bok till: senaste flygningen på sid 26, rad 12 i den nya boken');
  const b1 = book(1, { end_page: 93, anchor_flight_id: 420, anchor_page: 92, anchor_row: 12 });
  const b2 = book(2, { end_page: 125, anchor_flight_id: 444, anchor_page: 26, anchor_row: 12 });
  let sl = B.assignFlightsToBooks([b1], fl);
  ok(sl[0].flights.length === 420 && sl[0].overflowCount === 24 && sl[0].flights[0].id === 1, `ensam första bok: 420 flygningar, 24 väntar på nästa bok (fick ${sl[0].flights.length}, ${sl[0].overflowCount})`);
  sl = B.assignFlightsToBooks([b1, b2], fl);
  ok(sl[0].flights.length === 420 && sl[1].flights.length === 24, `420 i första boken, 24 i den nya (fick ${sl[0].flights.length}, ${sl[1].flights.length})`);
  ok(sl[0].overCapacity === 0 && sl[0].isFull && sl[1].leadingEmptyRows === 0, 'första boken är full men inte över sin sista sida');
  let w = where([b1, b2], 444);
  ok(w && w.book === 2 && w.page === 26 && w.row === 12, `senaste flygningen: bok 2, sid 26, rad 12 (fick bok ${w && w.book}, ${w && w.page}, ${w && w.row})`);
  ok(w && Math.abs(w.bf.tt_total - 420) < 1e-6 && Math.abs(w.toDate.tt_total - 444) < 1e-6, `nya bokens Brought forward = 420 h, Total to date = 444 h (fick ${w && w.bf.tt_total}, ${w && w.toDate.tt_total})`);
  w = where([b1, b2], 421);
  ok(w && w.book === 2 && w.page === 24 && w.row === 1, `flygning 421 börjar den nya boken på sid 24, rad 1 (fick bok ${w && w.book}, ${w && w.page}, ${w && w.row})`);
  w = where([b1, b2], 420);
  ok(w && w.book === 1 && w.page === 92 && w.row === 12 && w.lastPage === 93, `flygning 420 sist i första boken: sid 92, rad 12, boken slutar på sid 93 (fick ${w && w.page}, ${w && w.row}, ${w && w.lastPage})`);
  w = where([b1, b2], 1);
  ok(w && w.page === 24 && w.row === 1 && Math.abs((w.bf.fstd ?? 0) + 22.1) < 1e-6 && Math.abs(w.bf.pic - 25) < 1e-6, `första flygningen på sid 24, rad 1; sim-raden och summeringsraden är Brought forward (fick ${w && w.page}, ${w && w.row}, FSTD ${w && w.bf.fstd}, PIC ${w && w.bf.pic})`);

  console.log('En bok till: fler flygningar före ankaret än första boken rymmer');
  sl = B.assignFlightsToBooks([b1, book(2, { end_page: 125, anchor_flight_id: 444, anchor_page: 24, anchor_row: 12 })], fl);
  ok(sl[0].flights.length === 432 && sl[0].overCapacity === 12 && sl[1].flights.length === 12, `ankaret styr: 432 i första boken (12 över), 12 i den nya (fick ${sl[0].flights.length}, ${sl[0].overCapacity}, ${sl[1].flights.length})`);

  console.log('En bok till: den nya boken är tom');
  const empty = book(2, { end_page: 125 });
  sl = B.assignFlightsToBooks([b1, empty], fl);
  ok(sl[0].flights.length === 420 && sl[1].flights.length === 24 && sl[1].flights[0].id === 421, `utan ankare tar den nya boken vid där den förra blev full (fick ${sl[0].flights.length}, ${sl[1].flights.length})`);
  const fl420 = fl.filter((f) => f.id <= 420 || f.id > 9000);
  sl = B.assignFlightsToBooks([b1, empty], fl420);
  let ob = B.resolveOpeningBalance(empty, [b1, empty], fl420, tpl);
  ok(sl[1].flights.length === 0 && Math.abs(ob.tt_total - 420) < 1e-6 && Math.abs(ob.pic - 445) < 1e-6, `tom ny bok: Brought forward = allt i boken före (fick ${sl[1].flights.length} flygningar, total ${ob.tt_total}, PIC ${ob.pic})`);

  console.log('Den sista boken slutar vid sin sista sida');
  sl = B.assignFlightsToBooks([b1, book(2, { end_page: 25, anchor_flight_id: 421, anchor_page: 24, anchor_row: 1 })], fl);
  ok(sl[1].flights.length === 12 && sl[1].overflowCount === 12 && sl[1].isFull, `12 rader får plats, 12 väntar på nästa bok (fick ${sl[1].flights.length}, ${sl[1].overflowCount})`);

  console.log('Första boken med äldre timmar som Brought forward får en bok till');
  const bf1 = book(1, { end_page: 33, anchor_flight_id: 420, anchor_page: 32, anchor_row: 12 });   // 60 rader: flygning 361–420
  sl = B.assignFlightsToBooks([bf1], fl);
  ok(sl[0].flights[0].id === 361 && sl[0].flights.length === 60, `ensam: boken börjar med flygning 361 (fick ${sl[0].flights[0].id}, ${sl[0].flights.length})`);
  sl = B.assignFlightsToBooks([bf1, b2], fl);
  ok(sl[0].flights[0].id === 361 && sl[0].flights.length === 60 && sl[1].flights.length === 24, `med en bok till börjar den fortfarande med flygning 361 (fick ${sl[0].flights[0].id}, ${sl[0].flights.length}, ${sl[1].flights.length})`);
}

console.log(fails ? `\n${fails} fel` : '\nAlla gröna');
process.exit(fails ? 1 : 0);
