// Test av licenskravens timmar (components/insights/licenceHours.ts) mot Part-FCL: PIC-alternativen med PICUS
// för ATPL(A)/(H), natt som PIC eller co-pilot och simulatortid med tak. Kör: node scripts/test-licence-hours.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports;
}
const H = load(path.join(__dirname, '../components/insights/licenceHours.ts'));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

let id = 0;
const fl = (date, o = {}) => ({ id: ++id, date, dep_utc: '', dep_place: 'ESSA', arr_place: 'ESGG', flight_type: 'normal', sim_category: '', flight_rules: 'VFR', total_time: 1, ...o });
const sim = (date, cat, h, o = {}) => fl(date, { flight_type: 'sim', sim_category: cat, total_time: h, ...o });

console.log('PIC-alternativ ATPL(A), FCL.510.A(b)(2)');
const A = (pic, picus) => H.picCredit('atpl_pic_a', pic, picus, 0);
ok(near(A(250, 0), 250), '250 h PIC räcker');
ok(near(A(0, 500), 250), '500 h PICUS räcker');
ok(near(A(70, 180), 250), '70 h PIC + 180 h PICUS räcker');
ok(A(69, 300) < 250, '69 h PIC räcker inte, hur mycket PICUS det än är');
ok(A(0, 400) < 250, '400 h PICUS utan PIC räcker inte');
ok(near(A(50, 250), 230), '50 PIC + 250 PICUS = 230 (20 h PIC kvar)');
ok(near(A(300, 0), 250), 'taket är 250');

console.log('PIC-alternativ ATPL(H), FCL.510.H(c)(2)');
const Hh = (pic, picus, mp) => H.picCredit('atpl_pic_h', pic, picus, mp);
ok(near(Hh(250, 0, 0), 250), '250 h PIC räcker');
ok(near(Hh(100, 150, 0), 250), '100 h PIC + 150 h PICUS räcker');
ok(Hh(99, 200, 0) < 250, '99 h PIC + 200 h PICUS räcker inte');
ok(near(Hh(0, 250, 250), 250), '250 h PICUS i multi-pilot räcker');
ok(Hh(0, 250, 100) < 250, 'PICUS utanför multi-pilot räknas inte för det alternativet');
ok(near(Hh(200, 60, 0), 200), '200 PIC + 60 PICUS = 200 (50 h PIC kvar)');

console.log('Natt som PIC eller co-pilot');
ok(H.flightValue(fl('2024-01-01', { night: 2, dual: 2 }), 'night_pc') === 0, 'dual-natt räknas inte');
ok(H.flightValue(fl('2024-01-01', { night: 2, co_pilot: 3 }), 'night_pc') === 2, 'co-pilot-natt räknas');
ok(H.flightValue(fl('2024-01-01', { night: 1.5, pic: 1, dual: 1 }), 'night_pc') === 1, 'natt räknas högst med PIC/co-pilot-tiden');
ok(H.flightValue(fl('2024-01-01', { night: 1, picus: 1 }), 'night_pc') === 1, 'PICUS-natt räknas (co-pilot)');

console.log('Simulatortid med tak');
const ATPL_A_TOTAL = { max: 100, fnptMax: 25, kinds: ['FFS', 'FNPT_II', 'FNPT_I'] };
const book = [
  fl('2024-01-10', { total_time: 1400 }),
  sim('2024-02-01', 'FNPT_II', 40),
  sim('2024-03-01', 'FFS', 80),
  sim('2024-04-01', 'BITD', 20),
  sim('2024-04-02', 'CPT_PPT', 20),
  sim('2024-04-03', '', 20),
];
ok(near(H.reqHave(book, 'total'), 1400), 'utan simkredit räknas inga simulatorpass');
ok(near(H.reqHave(book, 'total', ATPL_A_TOTAL), 1500), 'ATPL(A): 25 h FNPT + 75 h FFS = 100 h kredit');
const tl = H.reqTimeline(book, 'total', ATPL_A_TOTAL);
ok(tl.find((p) => p.cum >= 1500)?.date === '2024-03-01', 'kravet uppfylls när FFS-passet flögs');
ok(near(H.reqHave(book, 'total', { max: 100 }), 1500), 'alla FSTD: taket 100 h håller');
ok(near(H.reqHave([fl('2024-01-01', { total_time: 10 }), sim('2024-01-02', 'BITD', 3), sim('2024-01-03', 'CPT_PPT', 3), sim('2024-01-04', '', 2)], 'total', { max: 5 }), 15),
  'PPL: BITD och okänd typ räknas (FSTD), CPT/PPT aldrig, tak 5 h');
ok(near(H.reqHave([sim('2024-01-04', '', 2)], 'total', ATPL_A_TOTAL), 0), 'okänd simulatortyp räknas inte där bara vissa typer godkänns');

const ifrBook = [
  fl('2024-01-01', { ifr: 40 }),
  sim('2024-02-01', 'FFS', 4, { flight_rules: 'IFR' }),
  sim('2024-02-02', 'FFS', 4, { flight_rules: 'VFR' }),
  sim('2024-02-03', 'FNPT_II', 4, { flight_rules: 'VFR', ifr: 3 }),
];
ok(near(H.reqHave(ifrBook, 'ifr', { max: 30 }), 47), 'IFR: IFR-pass hela tiden, VFR-pass utan IFR inget, loggad IFR räknas');
ok(near(H.reqHave(ifrBook, 'ifr', { max: 5 }), 45), 'IFR: taket 5 h (CPL)');

console.log('Kravtabellerna (EASAProgressChart.tsx)');
const src = fs.readFileSync(path.join(__dirname, '../components/EASAProgressChart.tsx'), 'utf8');
const table = (name) => (src.match(new RegExp(`const ${name}: ReqDef\\[\\] = \\[([\\s\\S]*?)\\];`)) || [])[1] || '';
ok(table('PPL_A') && !/key: 'night'/.test(table('PPL_A')), 'PPL(A) har inget nattkrav');
ok(/key: 'multi_pilot', required: 350/.test(table('ATPL_H')), 'ATPL(H) kräver 350 h multi-pilot');
ok(/key: 'atpl_pic_a', required: 250/.test(table('ATPL_A')) && /key: 'atpl_pic_h', required: 250/.test(table('ATPL_H')), 'ATPL räknar PIC med PICUS-alternativen');
ok(/key: 'night_pc', required: 100/.test(table('ATPL_A')) && /key: 'night_pc', required: 100/.test(table('ATPL_H')), 'ATPL-natten är som PIC eller co-pilot');

if (fails) { console.log(`\n${fails} test(er) misslyckades`); process.exit(1); }
console.log('\nAlla tester gröna');
