// Test av Block import från foto (services/totalsScan.ts): tolkning av summaraderna, kontrollen
// Brought forward + this page = to date, årsslut ur årsskiftets rader och perioderna år för år.
// Kör: node scripts/test-totals-scan.cjs
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../services/totalsScan.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({ callAnthropicTool: async () => ({}) }));
const T = mod.exports;

let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };

// Tider
eq(T.parseValue('1201:10', false), 72070, 'h:mm');
eq(T.parseValue('1201.5', false), 72090, 'decimal');
eq(T.parseValue('12h30', false), 750, 'h-format');
eq(T.parseValue('1:75', false), null, 'ogiltiga minuter');
eq(T.parseValue('642', true), 642, 'landningar');
eq(T.parseValue('', false), null, 'tomt');

// Senaste uppslaget: total går ihop, natt går inte ihop, SE+ME slås ihop, oläsligt blir gult.
const r = T.readingFromTool({
  logbook_found: true,
  columns: [
    { field: 'total_time', brought_forward: '1201:10', this_page: '47:20', to_date: '1248:30' },
    { field: 'night', brought_forward: '280:00', this_page: '6:15', to_date: '286:45' },
    { field: 'single_pilot_se', brought_forward: '300:00', this_page: '2:10', to_date: '302:10' },
    { field: 'single_pilot_me', brought_forward: '110:00', this_page: '0:00', to_date: '110:00' },
    { field: 'ifr', this_page: '30:00', brought_forward: '875:40' },
    { field: 'landings_day', brought_forward: '630', this_page: '12', to_date: '642' },
    { field: 'pic', to_date: '412:10', unclear: true },
  ],
  aircraft: [{ type: 'ATR 72-600', registration: 'se-mkh' }, { type: 'atr 72-600' }, { type: 'PA-28-181' }],
  years: [2019],
});
eq(r.fields.total_time, { value: 74910, check: false, bf: 72070, page: 2840 }, 'total med kontroll');
eq(r.fields.night.check, true, 'natten går inte ihop → gul');
eq(r.fields.single_pilot.value, 24730, 'single pilot = SE + ME');
eq(r.fields.ifr, { value: 54340, check: false, bf: 52540, page: 1800 }, 'utan to date: bf + page');
eq(r.fields.landings_day.value, 642, 'landningar');
eq(r.fields.pic.check, true, 'oläsligt → gul');
eq(r.aircraft, [{ type: 'ATR 72-600', registration: 'SE-MKH' }, { type: 'PA-28-181', registration: '' }], 'flygplan en gång var');
eq(r.yearEnd, null, 'inget årsskifte');
eq(r.latestYear, 2019, 'senaste året');

// Årsskifte: slutet av 2017 = brought forward + 2017 års rader.
const y = T.readingFromTool({
  logbook_found: true,
  columns: [
    { field: 'total_time', brought_forward: '380:15', this_page: '20:00', to_date: '400:15' },
    { field: 'pic', brought_forward: '100:00', this_page: '5:00', to_date: '105:00' },
    { field: 'landings_day', brought_forward: '200', this_page: '10', to_date: '210' },
  ],
  years: [2017, 2018], earlier_year: 2017,
  earlier_year_rows: [
    { date: '28/12', values: { total_time: '5:00', pic: '1:00', landings_day: '2' } },
    { date: '30/12', values: { total_time: '4:00', landings_day: '1' } },
  ],
});
eq(y.yearEnd, { year: 2017, fields: { total_time: 23355, pic: 6060, landings_day: 203 }, aircraft: [] }, 'årsslut 2017');

// Perioder: –2016, 2017, 2018–19 (årsskiftet 2019 saknas), 2020.
const H = (h, m = 0) => h * 60 + m;
const ends = [
  { year: 2017, fields: { total_time: H(389, 15) }, aircraft: ['ATR'] },
  { year: 2016, fields: { total_time: H(175, 5) }, aircraft: ['PA-28'] },
  { year: 2019, fields: { total_time: H(1176, 10) }, aircraft: [] },
  { year: 2016, fields: { total_time: 1 }, aircraft: [] },   // dubblett → ignoreras
];
const p = T.buildPeriods({ year: 2020, fields: { total_time: H(1248, 30), night: 100 }, aircraft: ['ATR'] }, ends);
eq(p.map((x) => [T.periodLabel(x), x.fields.total_time, x.merged]), [
  ['–2016', H(175, 5), false], ['2017', H(214, 10), false], ['2018–19', H(786, 55), true], ['2020', H(72, 20), false],
], 'perioderna');
eq(p[3].fields.night, undefined, 'fält som saknas i föregående årsslut räknas inte');
const neg = T.buildPeriods({ year: 2020, fields: { total_time: 100 } , aircraft: [] }, [{ year: 2019, fields: { total_time: 200 }, aircraft: [] }]);
eq([neg[1].fields.total_time, neg[1].check.total_time], [undefined, true], 'negativ skillnad → gul, inget värde');
eq(T.buildPeriods({ year: 2020, fields: { total_time: 5 }, aircraft: [] }, []).map(T.periodLabel), ['–2020'], 'utan årsskiften: en period');

console.log(fails ? `${fails} fel` : 'Alla tester gick igenom');
process.exit(fails ? 1 : 0);
