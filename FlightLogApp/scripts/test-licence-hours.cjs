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
ok(near(H.reqHave(book, 'total', { sim: ATPL_A_TOTAL }), 1500), 'ATPL(A): 25 h FNPT + 75 h FFS = 100 h kredit');
const tl = H.reqTimeline(book, 'total', { sim: ATPL_A_TOTAL });
ok(tl.find((p) => p.cum >= 1500)?.date === '2024-03-01', 'kravet uppfylls när FFS-passet flögs');
ok(near(H.reqHave(book, 'total', { sim: { max: 100 } }), 1500), 'alla FSTD: taket 100 h håller');
ok(near(H.reqHave([fl('2024-01-01', { total_time: 10 }), sim('2024-01-02', 'BITD', 3), sim('2024-01-03', 'CPT_PPT', 3), sim('2024-01-04', '', 2)], 'total', { sim: { max: 5 } }), 15),
  'PPL: BITD och okänd typ räknas (FSTD), CPT/PPT aldrig, tak 5 h');
ok(near(H.reqHave([sim('2024-01-04', '', 2)], 'total', { sim: ATPL_A_TOTAL }), 0), 'okänd simulatortyp räknas inte där bara vissa typer godkänns');

const ifrBook = [
  fl('2024-01-01', { ifr: 40 }),
  sim('2024-02-01', 'FFS', 4, { flight_rules: 'IFR' }),
  sim('2024-02-02', 'FFS', 4, { flight_rules: 'VFR' }),
  sim('2024-02-03', 'FNPT_II', 4, { flight_rules: 'VFR', ifr: 3 }),
];
ok(near(H.reqHave(ifrBook, 'ifr', { sim: { max: 30 } }), 47), 'IFR: IFR-pass hela tiden, VFR-pass utan IFR inget, loggad IFR räknas');
ok(near(H.reqHave(ifrBook, 'ifr', { sim: { max: 5 } }), 45), 'IFR: taket 5 h (CPL)');

console.log('Kravtabellerna (EASAProgressChart.tsx)');
const src = fs.readFileSync(path.join(__dirname, '../components/EASAProgressChart.tsx'), 'utf8');
const table = (name) => (src.match(new RegExp(`const ${name}: ReqDef\\[\\] = \\[([\\s\\S]*?)\\];`)) || [])[1] || '';
ok(table('PPL_A') && !/key: 'night'/.test(table('PPL_A')), 'PPL(A) har inget nattkrav');
ok(/key: 'multi_pilot', required: 350/.test(table('ATPL_H')), 'ATPL(H) kräver 350 h multi-pilot');
ok(/key: 'atpl_pic_a', required: 250/.test(table('ATPL_A')) && /key: 'atpl_pic_h', required: 250/.test(table('ATPL_H')), 'ATPL räknar PIC med PICUS-alternativen');
ok(/key: 'night_pc', required: 100/.test(table('ATPL_A')) && /key: 'night_pc', required: 100/.test(table('ATPL_H')), 'ATPL-natten är som PIC eller co-pilot');

console.log('FAA: cross-country på avståndet fågelvägen (§ 61.1)');
// ESSA–ESOW ≈ 39 NM, ESSA–ESGG ≈ 214 NM, ESSA–ESSB ≈ 21 NM. ZZZZ saknar position.
const ctx = {
  coords: { ESSA: { lat: 59.6519, lon: 17.9186 }, ESOW: { lat: 59.5894, lon: 16.6336 }, ESGG: { lat: 57.6628, lon: 12.2798 }, ESSB: { lat: 59.3544, lon: 17.9417 } },
  cats: { R44: 'helicopter', C172: 'airplane' },
};
ok(H.landingDistNm(fl('2024-01-01', { arr_place: 'ESOW' }), ctx) > 36 && H.landingDistNm(fl('2024-01-01', { arr_place: 'ESOW' }), ctx) < 42, 'ESSA–ESOW ≈ 39 NM');
const xcBook = [
  fl('2024-01-01', { arr_place: 'ESOW', pic: 1 }),
  fl('2024-01-02', { arr_place: 'ESGG', pic: 1 }),
  fl('2024-01-03', { arr_place: 'ESSA', stop_place: 'ESGG', pic: 1 }),
  fl('2024-01-04', { arr_place: 'ZZZZ', pic: 1 }),
  fl('2024-01-05', { arr_place: 'ESSB', pic: 1 }),
];
ok(near(H.reqHave(xcBook, 'xc_pic', { xcNm: 50 }, ctx), 3), 'flygplan >50 NM: ESGG, mellanlandning i ESGG och okänd position (uppskattning) räknas, ESOW och ESSB inte');
ok(near(H.reqHave(xcBook, 'xc_pic', { xcNm: 25 }, ctx), 4), 'helikopter >25 NM: även ESOW räknas, ESSB (21 NM) inte');
ok(near(H.reqHave(xcBook, 'xc_pic', {}, ctx), 4), 'EASA utan xcNm: avgång ≠ ankomst och minst 0,5 h, som förut');

console.log('FAA: helikopter, PIC/PICUS och natt');
const mix = [
  fl('2024-01-01', { aircraft_type: 'R44', total_time: 2, pic: 2, night: 1, ifr: 1 }),
  fl('2024-01-02', { aircraft_type: 'C172', total_time: 3, pic: 3, night: 2, ifr: 1 }),
  fl('2024-01-03', { aircraft_type: 'R44', total_time: 2, picus: 2, co_pilot: 2, ifr: 2 }),
  fl('2024-01-04', { aircraft_type: 'EC35', total_time: 1, dual: 1 }),
];
ok(near(H.reqHave(mix, 'heli', {}, ctx), 5), 'helikoptertid: R44 och okänd typ, inte C172');
ok(near(H.reqHave(mix, 'heli_pic', {}, ctx), 2), 'PIC i helikopter');
ok(near(H.reqHave(mix, 'heli_pic_picus', {}, ctx), 4), 'PIC + PICUS i helikopter');
ok(near(H.reqHave(mix, 'heli_night', {}, ctx), 1), 'natt i helikopter');
ok(near(H.reqHave(mix, 'heli_ifr_pic_picus', {}, ctx), 3), 'IFR i helikopter som PIC/PICUS');
ok(near(H.reqHave(mix, 'plane_pic_picus', {}, ctx), 3), 'PIC/PICUS i flygplan');
ok(near(H.reqHave(mix, 'plane_pic_picus_night', {}, ctx), 2), 'natt som PIC/PICUS i flygplan');
ok(near(H.reqHave([fl('2024-01-01', { night: 2, dual: 2 }), fl('2024-01-02', { night: 1, pic: 1 })], 'dual+night'), 2), 'nattutbildning = natt med instruktör');
ok(near(H.reqHave([fl('2024-01-01', { arr_place: 'ESGG', dual: 1.5 }), fl('2024-01-02', { arr_place: 'ESSB', dual: 1 })], 'xc_dual', { xcNm: 50 }, ctx), 1.5), 'XC-utbildning bara på flygningar >50 NM');

console.log('FAA: nattkredit för landningar, § 61.159(b)');
ok(near(H.faaNightCredit(80, 20, 20), 80), '20 nattlandningar ger ingen kredit');
ok(near(H.faaNightCredit(80, 30, 32), 90), '10 extra starter och landningar = 10 h');
ok(near(H.faaNightCredit(60, 100, 100), 85), 'högst 25 h kredit');
ok(near(H.reqHave([fl('2024-01-01', { night: 50, takeoffs_night: 30, landings_fs_night: 25 })], 'night_faa_atp'), 55), 'räknas på det lägsta av starter och full stop-landningar');

console.log('FAA: en natt-XC med instruktör (§ 61.129)');
const nx = [
  fl('2024-01-01', { arr_place: 'ESGG', dual: 2.5, night: 1.5, total_time: 2.5 }),
  fl('2024-02-01', { arr_place: 'ESGG', dual: 2.2, night: 2.2, total_time: 2.2 }),
  fl('2024-03-01', { arr_place: 'ESOW', dual: 3, night: 3, total_time: 3 }),
  fl('2024-04-01', { arr_place: 'ESGG', pic: 3, night: 3, total_time: 3 }),
];
ok(near(H.reqHave(nx.slice(0, 1), 'night_xc_dual_100', {}, ctx), 1.5), 'bara nattdelen räknas');
ok(near(H.reqHave(nx, 'night_xc_dual_100', {}, ctx), 2.2), 'den längsta enskilda flygningen, ingen summa; för kort (ESOW) och utan instruktör räknas inte');
ok(H.reqTimeline(nx, 'night_xc_dual_100', {}, ctx).find((p) => p.cum >= 2)?.date === '2024-02-01', 'kravet uppfylls med flygningen i februari');

console.log('FAA: simulatortid');
const faaSim = [fl('2024-01-01', { total_time: 200 }), sim('2024-01-02', 'FFS', 30), sim('2024-01-03', 'FTD', 30), sim('2024-01-04', 'FNPT_II', 30)];
ok(near(H.reqHave(faaSim, 'total', { sim: { max: 50, kinds: ['FFS', 'FTD'] } }), 250), 'CPL(A): högst 50 h FFS/FTD, FNPT räknas inte');
ok(near(H.reqHave([fl('2024-01-01', { dual: 2, ifr: 2 }), sim('2024-01-02', 'BITD', 4, { flight_rules: 'IFR' })], 'dual+ifr', { sim: { max: 5 } }), 6), 'CPL(H): instrumentutbildning får göras i simulator (ATD)');

console.log('FAA-tabellerna');
ok(/key: 'xc_pic', required: 5, xcNm: 50/.test(table('FAA_PPL_A')), 'PPL(A): 5 h solo-XC över 50 NM');
ok(/key: 'dual\+ifr', required: 3/.test(table('FAA_PPL_A')) && /key: 'xc_dual', required: 3/.test(table('FAA_PPL_A')), 'PPL(A): 3 h instrument- och XC-utbildning');
ok(/key: 'dual\+night', required: 3/.test(table('FAA_PPL_H')), 'PPL(H): 3 h nattutbildning');
ok(/key: 'dual\+ifr', required: 10/.test(table('FAA_CPL_A')) && !/required: 20 \}/.test(table('FAA_CPL_A')), 'CPL(A): 10 h instrument, inte 20');
ok(/key: 'heli', required: 50/.test(table('FAA_CPL_H')) && /key: 'pic', required: 100/.test(table('FAA_CPL_H')), 'CPL(H): 50 h helikopter och 100 h PIC');
ok(/key: 'plane_pic_picus', required: 250/.test(table('FAA_ATPL_A')) && /key: 'me_time', required: 50/.test(table('FAA_ATPL_A')), 'ATP(A): 250 h PIC/PICUS och 50 h i klassen');
ok(/key: 'total', required: 1200/.test(table('FAA_ATPL_H')) && /key: 'heli', required: 200/.test(table('FAA_ATPL_H')), 'ATP(H): 1200 h och 200 h helikopter');

if (fails) { console.log(`\n${fails} test(er) misslyckades`); process.exit(1); }
console.log('\nAlla tester gröna');
