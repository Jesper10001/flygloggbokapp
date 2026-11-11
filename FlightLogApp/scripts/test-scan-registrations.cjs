// Test av services/scanRegistrations.ts: vilka registreringar i en skanning som är nya mot flottan, vilka som
// ser fellästa ut och vilka granskningen frågar om.
// Kör: node scripts/test-scan-registrations.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const load = (rel, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, req || (() => ({})));
  return m.exports;
};
const share = load('services/flightShare.ts');
const R = load('services/scanRegistrations.ts', () => share);

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok:' : '  FEL:', m); };
const row = (i, registration, page = 0) => ({ key: `r${i}`, page, rowIndex: i, registration });
const by = (list, reg) => list.find((x) => x.reg === reg);

console.log('Mot en flotta');
const fleet = [{ registration: 'KILO31', n: 30 }, { registration: 'KILO33', n: 12 }, { registration: 'KILO39', n: 6 }, { registration: 'SE-HEM', n: 3 }];
let c = R.checkRegistrations([row(1, 'kilo39'), row(2, 'KIL031'), row(3, 'KILO83'), row(4, 'KILO83'), row(5, 'SE-XYZ'), row(6, '')], fleet);
ok(c.length === 4 && !by(c, 'KILO39').isNew && !by(c, 'KILO39').ask, 'en registrering i flottan (även med gemener) frågas inte om; tom läsning räknas inte');
ok(by(c, 'KIL031').isNew && by(c, 'KIL031').twin === 'KILO31' && by(c, 'KIL031').similar[0] === 'KILO31' && by(c, 'KIL031').ask, 'O och 0: tvillingen i flottan föreslås först');
ok(by(c, 'KILO83').ask && by(c, 'KILO83').twin === null && by(c, 'KILO83').similar.includes('KILO33') && by(c, 'KILO83').rows.join() === 'r3,r4', 'ett tecken ifrån en i flottan: föreslås, båda raderna hör till frågan');
ok(by(c, 'SE-XYZ').ask && by(c, 'SE-XYZ').similar.length === 0, 'ny registrering som inte liknar något frågas om när det finns en flotta');
ok(c[0].isNew && !c[c.length - 1].isNew, 'de nya står först');

console.log('Tvillingar som redan finns i flottan');
c = R.checkRegistrations([row(1, 'KIL031'), row(2, 'KILO31')], [{ registration: 'KILO31', n: 30 }, { registration: 'KIL031', n: 5 }]);
ok(!by(c, 'KIL031').isNew && by(c, 'KIL031').ask && by(c, 'KIL031').twin === 'KILO31' && !by(c, 'KILO31').ask, 'den med färre flygningar frågas om, den vanliga inte');
c = R.checkRegistrations([row(1, 'KIL031')], [{ registration: 'KILO31', n: 30 }, { registration: 'KIL031', n: 5 }], new Set(['KIL031']));
ok(!by(c, 'KIL031').ask, 'och inte igen när användaren har svarat');

console.log('Redan besvarade');
c = R.checkRegistrations([row(1, 'KIL031'), row(2, 'SE-XYZ')], fleet, new Set(['SE-XYZ']));
ok(!by(c, 'SE-XYZ').ask && by(c, 'SE-XYZ').confirmed && by(c, 'SE-XYZ').isNew && by(c, 'KIL031').ask, 'en läsning användaren har svarat om frågas inte om igen men är fortfarande ny');

console.log('Utan flotta (första skanningen)');
c = R.checkRegistrations([row(1, 'KILO33'), row(2, 'KILO33'), row(3, 'KILO33'), row(4, 'KIL033'), row(5, 'SE-ABC'), row(6, 'KILO83')], []);
ok(!by(c, 'KILO33').ask && !by(c, 'SE-ABC').ask, 'utan flotta frågas bara om det som ser fel ut');
ok(by(c, 'KIL033').ask && by(c, 'KIL033').twin === 'KILO33' && by(c, 'KILO83').ask && by(c, 'KILO83').similar[0] === 'KILO33', 'en läsning som liknar en vanligare i samma skanning frågas om');
c = R.checkRegistrations([row(1, 'SE-JRA'), row(2, 'SE-JRB')], []);
ok(c.every((x) => !x.ask), 'två lika vanliga som liknar varandra (SE-JRA, SE-JRB) frågas inte om');

console.log(fails ? `\n${fails} fel` : '\n---- inga fel');
process.exit(fails ? 1 : 0);
