// Test av jämförelsen bakom notisen "Saved flight" (services/flightSaveDiff.ts): raden före och efter Save
// ger rätt rader med + och −, och en flygning som sparas utan ändring ger inga rader.
// Kör: node scripts/test-flight-save-diff.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '..', 'services/flightSaveDiff.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { diffSavedFlight } = mod.exports;

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok:' : '  FEL:', m); };
const line = (ls, label) => ls.find((l) => l.label === label);

const base = {
  id: 1, date: '2024-12-03', aircraft_type: 'A109', registration: 'KILO26', dep_place: 'ESND', dep_place_raw: null, arr_place: 'ESND', arr_place_raw: null,
  dep_utc: '19:28', arr_utc: '21:01', total_time: 1.6, ifr: 1.6, vfr: 0, night: 1.6, nvg: 0, pic: 0, co_pilot: 0, dual: 1.6,
  landings_day: 0, landings_night: 6, remarks: '', flight_rules: 'VFR', flight_type: 'normal', second_pilot: 'HM', second_pilot_role: 'PIC', max_fl: 0,
};

console.log('IFR bort, VFR och NVG in (flygningen i felrapporten)');
let ls = diffSavedFlight(base, { ...base, ifr: 0, vfr: 1.6, nvg: 1.6, flight_rules: 'VFR' });
ok(ls.length === 3, `tre rader (fick ${ls.length}: ${ls.map((l) => l.label).join(', ')})`);
ok(line(ls, 'IFR')?.delta === -1.6 && line(ls, 'VFR')?.delta === 1.6 && line(ls, 'NVG')?.delta === 1.6, 'IFR −1.6, VFR +1.6, NVG +1.6');
ok(ls.every((l) => l.kind === 'time'), 'alla är tider');

console.log('Ingen ändring');
ok(diffSavedFlight(base, { ...base }).length === 0, 'samma rad ger inga rader');
ok(diffSavedFlight(base, { ...base, dep_place_raw: '', max_fl: '0', remarks: ' ', total_time: '1.60' }).length === 0, 'tomt, 0 och 1.60 räknas som samma värde');
ok(diffSavedFlight(null, base).length === 0 && diffSavedFlight(base, null).length === 0, 'saknad rad ger inga rader');

console.log('Antal och text');
ls = diffSavedFlight(base, { ...base, landings_night: 4, landings_day: 1, remarks: 'Hoist training', registration: 'KILO27' });
ok(line(ls, 'Night landings')?.delta === -2 && line(ls, 'Day landings')?.delta === 1, 'landningar: −2 natt, +1 dag');
ok(line(ls, 'Remarks')?.kind === 'text' && line(ls, 'Registration')?.kind === 'text', 'anmärkning och registrering nämns vid namn');
ok(ls.findIndex((l) => l.kind === 'text') > ls.findIndex((l) => l.kind === 'count'), 'antal kommer före text');

console.log('Flygregler');
ls = diffSavedFlight(base, { ...base, flight_rules: 'IFR' });
ok(ls.length === 1 && ls[0].label === 'Flight rules', 'bara regeln ändrad: nämns vid namn');
ls = diffSavedFlight(base, { ...base, flight_rules: 'IFR', vfr: 0.5 });
ok(!line(ls, 'Flight rules') && line(ls, 'VFR'), 'regel + tid ändrad: tiden räcker');

console.log('Plats: skiftläge spelar ingen roll, ny plats gör det');
ok(diffSavedFlight(base, { ...base, dep_place: 'esnd' }).length === 0, 'esnd = ESND');
ok(line(diffSavedFlight(base, { ...base, arr_place: 'ESSA' }), 'Arrival'), 'ny landningsplats nämns');

console.log(fails ? `\n${fails} FEL` : '\nAlla gröna');
process.exit(fails ? 1 : 0);
