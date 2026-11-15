// Test av handstilsprofilen (services/scanHandwriting.ts) och dess spärrar. Kör: node scripts/test-scan-handwriting.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../services/scanHandwriting.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const M = { exports: {} };
new Function('module', 'exports', 'require', js)(M, M.exports, require);
const H = M.exports;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } else console.log('  ok:', msg); };
const row = (key, page, data) => ({ key, page, data: { flight_type: 'normal', ...data } });

console.log('1. Rättningar → förväxlingar');
{
  ok(JSON.stringify(H.digitSwaps('8267', '8257')) === '[{"read":"6","actual":"5"}]', '8267 → 8257 ger 6>5');
  ok(H.digitSwaps('1.6', '1.5').length === 1, '1.6 → 1.5 ger en förväxling');
  ok(H.digitSwaps('1.6', '12.5').length === 0, 'olika antal siffror: inget');
  ok(H.digitSwaps('1234', '5678').length === 0, 'fler än två siffror ändrade: inget (ett annat tal)');
  ok(H.digitSwaps('06:45', '06:45').length === 0, 'samma: inget');
}

console.log('2. Tröskel och motsatt håll');
{
  let p = H.emptyProfile();
  p = H.recordCorrection(p, [{ read: '6', actual: '5' }]);
  p = H.recordCorrection(p, [{ read: '6', actual: '5' }]);
  ok(H.activePairs(p).length === 0, 'två rättningar räcker inte');
  ok(H.handwritingHint(p) === '', 'ingen rad till Claude före tröskeln');
  p = H.recordCorrection(p, [{ read: '6', actual: '5' }]);
  ok(H.activePairs(p).length === 1, 'tre rättningar: 6>5 gäller');
  ok(/5 som kan se ut som 6/.test(H.handwritingHint(p)) && /ALDRIG/.test(H.handwritingHint(p)), 'raden till Claude: flagga, läs aldrig om');
  let q = p;
  q = H.recordCorrection(q, [{ read: '5', actual: '6' }]);
  q = H.recordCorrection(q, [{ read: '5', actual: '6' }]);
  ok(H.activePairs(q).length === 0, 'motsatt håll lika ofta (3 mot 2): slumpen, gäller inte');
  ok(H.activePairs(p, new Set(['6>5'])).length === 0, 'ångrad förväxling gäller inte');
}

const pairs = [{ read: '6', actual: '5' }];

console.log('3. Blocktiden bekräftar → rättas');
{
  // 06:45–08:12 = 1.45 h, men lästes 1.6 (utanför gränsen på 6 min); 1.5 går ihop
  const rows = [row('a', 0, { dep_utc: '06:45', arr_utc: '08:12', total_time: '1.6' })];
  const r = H.handwritingSweep(rows, pairs, {}, new Set());
  ok(r.fixes.length === 1 && r.fixes[0].field === 'total_time' && r.fixes[0].to === '1.5' && r.fixes[0].why === 'block', '1.6 → 1.5');
  const fits = [row('b', 0, { dep_utc: '06:45', arr_utc: '08:21', total_time: '1.6' })];
  const r2 = H.handwritingSweep(fits, pairs, {}, new Set());
  ok(r2.fixes.length === 0 && r2.suggestions.length === 0, 'raden går ihop som den står: rörs inte');
}

console.log('4. Två varianter får blocktiden att gå ihop → ingen rättning, bara förslag');
{
  // 06:46–08:15 = 1.48 h, total 1.6 går inte ihop; både total 1.5 och avgång 06:45 får den att gå ihop
  const rows = [row('c', 0, { dep_utc: '06:46', arr_utc: '08:15', total_time: '1.6' })];
  const r = H.handwritingSweep(rows, pairs, {}, new Set());
  ok(r.fixes.length === 0, 'ingen tyst rättning när flera celler kan vara felet');
  ok(r.suggestions.length === 2, 'båda föreslås (gula celler) i stället');
}

console.log('5. Sidans summa bekräftar → rättas, bara om ensam');
{
  const rows = [row('a', 0, { pic: '1.2' }), row('b', 0, { pic: '1.6' }), row('c', 0, { pic: '2.0' })];
  const r = H.handwritingSweep(rows, pairs, { 0: { pic: 4.7 } }, new Set());
  ok(r.fixes.length === 1 && r.fixes[0].rowKey === 'b' && r.fixes[0].to === '1.5' && r.fixes[0].why === 'total', 'PIC 1.6 → 1.5 när summan 4.7 bekräftar');
  const two = [row('a', 0, { pic: '1.6' }), row('b', 0, { pic: '1.6' }), row('c', 0, { pic: '2.0' })];
  const r2 = H.handwritingSweep(two, pairs, { 0: { pic: 5.1 } }, new Set());
  ok(r2.fixes.length === 0, 'två celler kan förklara summan: ingen rättning');
  ok(r2.suggestions.length === 2, 'båda föreslås');
  const okSum = H.handwritingSweep(rows, pairs, { 0: { pic: 4.8 } }, new Set());
  ok(okSum.fixes.length === 0 && okSum.suggestions.length === 0, 'summan går ihop: inget rörs');
}

console.log('6. Användarens celler och celler med frågor rörs aldrig');
{
  const rows = [row('a', 0, { dep_utc: '06:45', arr_utc: '08:12', total_time: '1.6' })];
  ok(H.handwritingSweep(rows, pairs, {}, new Set(['a|total_time'])).fixes.length === 0, 'cell användaren rört: rörs inte');
  const asked = [row('a', 0, { dep_utc: '06:45', arr_utc: '08:12', total_time: '1.6', field_issues: [{ field: 'total_time', reason: 'x', confidence: 0.5 }] })];
  ok(H.handwritingSweep(asked, pairs, {}, new Set()).fixes.length === 0, 'cell med fråga: rörs inte');
}

console.log('7. Inga förväxlingar → inget');
{
  const rows = [row('a', 0, { dep_utc: '06:45', arr_utc: '08:15', total_time: '1.6' })];
  const r = H.handwritingSweep(rows, [], {}, new Set());
  ok(r.fixes.length === 0 && r.suggestions.length === 0, 'tom profil gör ingenting');
}

console.log('8. Många kandidater i en kolumn → inga förslag');
{
  const rows = ['a', 'b', 'c', 'd', 'e'].map((k) => row(k, 0, { night: '0.6' }));
  const r = H.handwritingSweep(rows, pairs, { 0: { night: 2.0 } }, new Set());
  ok(r.fixes.length === 0 && r.suggestions.length === 0, 'fem möjliga celler: för osäkert, inget');
}

console.log(fails ? `\n${fails} FEL` : '\nAlla tester gick igenom');
process.exit(fails ? 1 : 0);
