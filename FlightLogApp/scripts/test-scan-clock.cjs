// Test av klockslagen i en skanning (services/scanImport.ts prepareFlight): en läsning som inte är ett klockslag
// (07:80, 27:30) blir aldrig ett värde. Cellen töms och frågan erbjuder giltiga tider. Kör: node scripts/test-scan-clock.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Laddar en TS-modul ur appen; databasen behövs inte för prepareFlight.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (p) => {
    if (p.startsWith('../db/')) return {};
    if (p.startsWith('.')) return load(path.join(path.dirname(file), p) + '.ts');
    return require(p);
  };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
}
const { prepareFlight } = load(path.join(__dirname, '../services/scanImport.ts'));
const { clockValue } = load(path.join(__dirname, '../utils/format.ts'));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } };
const flight = (o) => ({ date: '2025-11-22', dep_place: 'ESCF', arr_place: 'ESCF', total_time: '0', field_issues: [], ...o });
const issue = (d, f) => (d.field_issues ?? []).find((i) => i.field === f);

// 1. clockValue: timmar 00–23, minuter 00–59
ok(clockValue('0730') === '07:30', '0730 → 07:30');
ok(clockValue('730') === '07:30', '730 → 07:30');
ok(clockValue('7:30') === '07:30', '7:30 → 07:30');
ok(clockValue('07.30') === '07:30', '07.30 → 07:30');
ok(clockValue('2359') === '23:59', '23:59 finns');
ok(clockValue('2400') === '00:00', '24:00 = midnatt');
ok(clockValue('0780') === null, '07:80 finns inte');
ok(clockValue('2410') === null, '24:10 finns inte');
ok(clockValue('2730') === null, '27:30 finns inte');
ok(clockValue('07:5') === null, 'för få siffror');
ok(clockValue('abc') === null, 'inte en tid');

// 2. Användarens fall: 0780 med ankomst 11:30 och 4.0 h → 07:30 först
let d = prepareFlight(flight({ dep_utc: '07:80', arr_utc: '11:30', total_time: '4.0',
  field_issues: [{ field: 'dep_utc', reason: 'Unclear time written 0780', confidence: 0.4, suggested_value: '07:80' }] }));
let i = issue(d, 'dep_utc');
ok(d.dep_utc === '', `cellen töms (${d.dep_utc})`);
ok(i && i.read_as === '07:80', 'läsningen sparas i frågan');
ok(i && !i.suggested_value, `Claudes ogiltiga förslag tas bort (${i && i.suggested_value})`);
ok(i && i.options[0] === '07:30', `07:30 först (${i && i.options.join(', ')})`);
ok(i && i.options.every((v) => clockValue(v) === v), 'bara giltiga tider');
ok(i && i.options.length <= 3, 'högst tre');
ok(d.field_issues.filter((x) => x.field === 'dep_utc').length === 1, 'en fråga per cell');
ok(i && /minutes only go up to 59/.test(i.reason), i && i.reason);

// 3. Utan total tid: troligaste förväxlingen först (8 → 3)
d = prepareFlight(flight({ dep_utc: '0780', arr_utc: '' }));
i = issue(d, 'dep_utc');
ok(i && i.options[0] === '07:30', `8 → 3 först (${i && i.options.join(', ')})`);

// 4. Helikopterbok med +0.2 h: 07:30 → 11:30 = 4.0, total 4.2
d = prepareFlight(flight({ dep_utc: '0780', arr_utc: '11:30', total_time: '4.2' }));
ok(issue(d, 'dep_utc').options[0] === '07:30', `med tillägg (${issue(d, 'dep_utc').options.join(', ')})`);

// 5. Ankomsten fel, timmar för höga: 19:05 → 2?:05 med 1.0 h → 20:05
d = prepareFlight(flight({ dep_utc: '19:05', arr_utc: '2805', total_time: '1.0' }));
i = issue(d, 'arr_utc');
ok(d.arr_utc === '' && d.dep_utc === '19:05', 'avgången står kvar');
ok(i && i.options[0] === '20:05', `20:05 först (${i && i.options.join(', ')})`);
ok(i && /hours only go up to 23/.test(i.reason), i && i.reason);

// 6. Giltiga tider skrivs som HH:MM, inga frågor
d = prepareFlight(flight({ dep_utc: '730', arr_utc: '9:15', total_time: '1.8' }));
ok(d.dep_utc === '07:30' && d.arr_utc === '09:15', `normaliserat (${d.dep_utc}, ${d.arr_utc})`);
ok(!issue(d, 'dep_utc') && !issue(d, 'arr_utc'), 'inga frågor');

// 7. Claudes tidskonflikt med en omöjlig tid försvinner (frågan om cellen tar över)
d = prepareFlight(flight({ dep_utc: '07:80', arr_utc: '11:30', total_time: '4.0',
  time_mismatch: { anchor_total_h: 4, read_dep: '07:80', read_arr: '11:30', computed_dep_if_arr_correct: '07:30', computed_arr_if_dep_correct: '12:20' } }));
ok(!d.time_mismatch, 'tidskonflikten tas bort');

// 8. Inte en tid alls
d = prepareFlight(flight({ dep_utc: 'O7:3O' }));
i = issue(d, 'dep_utc');
ok(d.dep_utc === '' && i && i.options.length === 0 && /isn't a time/.test(i.reason), i && i.reason);

console.log(fails ? `${fails} fel` : 'Alla klockslagstester gröna');
process.exit(fails ? 1 : 0);
