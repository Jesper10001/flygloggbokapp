// Test av jämförelsen med loggboken (services/logbookMatch.ts): dubbletter (tider, lokal tid mot UTC, utan tider,
// varv samma dag, samma rad två gånger i filen) och krockar i tid. Kör: node scripts/test-logbook-match.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

let logbook = [];     // flights
let drones = [];      // drone_flights
const fakeDb = {
  getAllAsync: async (sql, params) => {
    const [from, to] = params;
    if (/FROM drone_flights/.test(sql)) return drones.filter((f) => f.date >= from && f.date <= to && f.source !== 'summary');
    return logbook.filter((f) => f.date >= from && f.date <= to && !['Blades previous experience', '[BACKFILL]'].includes(f.remarks ?? ''));
  },
};
const mocks = {
  '../db/database': { getDatabase: async () => fakeDb },
  '../db/icao': { getAirportByIcao: async (c) => ({ icao: c, country: 'SE', region: '', lon: 18 }) },
  '../db/backfill': { PREV_EXP_REMARK: 'Blades previous experience' },
  '../utils/timezone': { localOffsetMinutes: () => 120 },   // Sverige sommartid
};
function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (m) => mocks[m] ?? {});
  return mod.exports;
}
const M = load(path.join(__dirname, '../services/logbookMatch.ts'));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } else console.log('  ok:', msg); };
let id = 0;
const lg = (date, dep, arr, d, a, total, o = {}) => ({ id: ++id, date, dep_place: dep, arr_place: arr, dep_utc: d, arr_utc: a, total_time: total, aircraft_type: 'C172', registration: 'SE-ABC', source: 'ocr', remarks: '', ...o });
const inc = (date, dep, arr, d, a, total) => ({ date, dep_place: dep, arr_place: arr, dep_utc: d, arr_utc: a, total_time: String(total) });

(async () => {
  console.log('Pilot: dubbletter');
  logbook = [lg('2026-06-10', 'ESSA', 'ESGG', '08:00', '09:00', 1)];
  let m = await M.matchFlightsToLogbook([inc('2026-06-10', 'ESSA', 'ESGG', '08:00', '09:00', 1)]);
  ok(m.dups.get(0)?.logged?.id === logbook[0].id, 'samma flygning igen = dubblett');
  m = await M.matchFlightsToLogbook([inc('2026-06-10', 'essa', 'esgg', '08:03', '09:04', 1.02)]);
  ok(m.dups.has(0), 'tider några minuter isär (skanning mot CSV) = dubblett');
  m = await M.matchFlightsToLogbook([inc('2026-06-10', 'ESSA', 'ESGG', '10:00', '11:00', 1)]);
  ok(m.dups.has(0) && Math.abs(m.dups.get(0).zone) === 2, 'samma tider i lokal tid (2 h isär) = dubblett, zone 2');
  ok(!m.clashes.has(0), '… och ingen krock');
  logbook = [lg('2026-06-10', 'ESSA', 'ESGG', '06:00', '06:55', 0.92)];
  m = await M.matchFlightsToLogbook([inc('2026-06-10', 'ESSA', 'ESGG', '14:00', '14:55', 0.92)]);
  ok(!m.dups.has(0) && !m.clashes.has(0), 'samma rutt två gånger samma dag (8 h isär) = ny flygning');

  logbook = [lg('2026-06-11', 'ESSB', 'ESSB', '', '', 0.5), lg('2026-06-11', 'ESSB', 'ESSB', '', '', 0.5)];
  m = await M.matchFlightsToLogbook([0, 1, 2].map(() => inc('2026-06-11', 'ESSB', 'ESSB', '', '', 0.5)));
  ok(m.dups.size === 2 && !m.dups.has(2), 'tre varv i importen mot två i loggboken → ett nytt');
  ok(new Set([...m.dups.values()].map((d) => d.logged.id)).size === 2, '… och varje varv i loggboken används en gång');

  logbook = [lg('2026-06-12', 'ESSA', 'ESGG', '', '', 1)];
  m = await M.matchFlightsToLogbook([inc('2026-06-12', 'ESSA', 'ESGG', '', '', 1.3)]);
  ok(!m.dups.has(0), 'utan tider och 18 min olika totaltid = ny flygning');

  logbook = [lg('2026-06-12', 'ESSA', 'ESGG', '08:00', '09:00', 1, { remarks: 'Blades previous experience' })];
  m = await M.matchFlightsToLogbook([inc('2026-06-12', 'ESSA', 'ESGG', '08:00', '09:00', 1)]);
  ok(!m.dups.has(0), 'Backfill-raden räknas inte');

  console.log('Pilot: samma rad två gånger i filen');
  logbook = [];
  m = await M.matchFlightsToLogbook([inc('2026-06-13', 'ESSA', 'ESGG', '08:00', '09:00', 1), inc('2026-06-13', 'ESSA', 'ESGG', '08:00', '09:00', 1)], { withinFile: true });
  ok(m.dups.get(1)?.fileRow === 0 && !m.dups.has(0), 'andra raden = dubblett av första');
  m = await M.matchFlightsToLogbook([inc('2026-06-13', 'ESSB', 'ESSB', '', '', 0.5), inc('2026-06-13', 'ESSB', 'ESSB', '', '', 0.5)], { withinFile: true });
  ok(m.dups.size === 0, 'två varv utan tider sparas båda');
  m = await M.matchFlightsToLogbook([inc('2026-06-13', 'ESSA', 'ESGG', '08:00', '09:00', 1), inc('2026-06-13', 'ESSA', 'ESGG', '08:00', '09:00', 1)]);
  ok(m.dups.size === 0, 'utan withinFile (skanning) jämförs inte raderna med varandra');

  console.log('Pilot: krockar');
  logbook = [lg('2026-06-14', 'ESSA', 'EKCH', '08:30', '09:40', 1.17, { source: 'import' })];
  m = await M.matchFlightsToLogbook([inc('2026-06-14', 'ESSB', 'ESKN', '08:00', '09:00', 1)]);
  ok(m.clashes.get(0)?.[0]?.minutes === 30, 'annan rutt, 30 min överlapp = krock');
  ok(m.clashes.get(0)?.[0]?.logged.source === 'imported' && m.clashes.get(0)[0].logged.times === '08:30–09:40', '… med loggbokens tider och källa');
  ok(m.times.get(0) === '08:00–09:00', 'importens tider följer med');
  m = await M.matchFlightsToLogbook([inc('2026-06-14', 'ESSB', 'ESKN', '07:30', '08:33', 1)]);
  ok(!m.clashes.has(0), '3 min överlapp (avrundning vid vända) = ingen krock');
  logbook = [lg('2026-06-15', 'ESSA', 'ENGM', '23:30', '00:30', 1)];
  m = await M.matchFlightsToLogbook([inc('2026-06-16', 'ENGM', 'ESSA', '00:10', '01:00', 0.83)]);
  ok(m.clashes.get(0)?.[0]?.minutes === 20, 'över midnatt: 20 min överlapp dagen efter');
  logbook = [lg('2026-06-17', 'ESSA', 'ESGG', '08:00', '09:00', 1)];
  m = await M.matchFlightsToLogbook([inc('2026-06-17', 'ESSA', 'ESGG', '08:00', '09:00', 1), inc('2026-06-17', 'ESSB', 'ESKN', '08:15', '09:00', 0.75)]);
  ok(m.dups.has(0) && !m.clashes.has(1), 'krock mot en loggboksflygning som är dubblett av en annan rad visas inte');
  ok(M.idsToRemove({ ...m, clashes: new Map([[1, [{ logged: { id: 7 }, minutes: 10 }]]]) }, [1], () => false).join() === '7', 'idsToRemove: den nya behålls → loggbokens id');
  ok(M.idsToRemove({ ...m, clashes: new Map([[1, [{ logged: { id: 7 }, minutes: 10 }]]]) }, [1], () => true).length === 0, 'idsToRemove: inget tas bort om den nya lämnas utanför');

  console.log('Drönare');
  drones = [{ id: 1, date: '2026-07-01', takeoff_time: '10:00', total_time: 0.25, location: 'Hagaparken', lat: 59.36, lon: 18.03, drone_type: 'Mavic 3', registration: '', source: 'import' }];
  m = await M.matchDroneFlightsToLogbook([{ date: '2026-07-01', takeoff_time: '10:04', total_time: 0.25, location: 'Haga' }]);
  ok(m.dups.has(0), 'starttid 4 min isär, samma längd = dubblett');
  m = await M.matchDroneFlightsToLogbook([{ date: '2026-07-01', takeoff_time: '', total_time: 0.25, location: 'hagaparken' }]);
  ok(m.dups.has(0), 'utan starttid: samma plats och längd = dubblett');
  m = await M.matchDroneFlightsToLogbook([{ date: '2026-07-01', takeoff_time: '', total_time: 0.25, location: 'Djurgården', lat: 59.32, lon: 18.11 }]);
  ok(!m.dups.has(0), 'utan starttid, annan plats = ny flygning');
  m = await M.matchDroneFlightsToLogbook([{ date: '2026-07-01', takeoff_time: '10:08', total_time: 0.2, location: 'Djurgården' }]);
  ok(m.clashes.get(0)?.[0]?.minutes === 7, 'krock: 10:00–10:15 mot 10:08–10:20 = 7 min');
  drones.push({ id: 2, date: '2026-07-01', takeoff_time: '12:00', total_time: 5, location: '', lat: 0, lon: 0, drone_type: '', registration: '', source: 'summary' });
  m = await M.matchDroneFlightsToLogbook([{ date: '2026-07-01', takeoff_time: '13:00', total_time: 0.2, location: '' }]);
  ok(!m.clashes.has(0), 'summeringsrader räknas inte');

  console.log(fails ? `\n${fails} fel` : '\nAlla tester gick igenom');
  process.exit(fails ? 1 : 0);
})();
