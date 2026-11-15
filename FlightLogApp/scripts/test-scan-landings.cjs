// Test av landningsbesluten (services/scanLandings.ts): när Claude och Apple Vision läser olika avgör appen med
// sidans summor, nattiden, Visions läge och den andra titten. Kör: node scripts/test-scan-landings.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../services/scanLandings.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const L = { exports: {} };
new Function('module', 'exports', 'require', js)(L, L.exports, require);
const { landingCandidates, decideLandings, decideBySecondLook, landingQuestion } = L.exports;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } else console.log('  ok:', msg); };
const row = (rowIndex, day, night, extra = {}) => ({ rowIndex, data: { landings_day: String(day), landings_night: String(night), total_time: '1.8', night: '0', ...extra } });
const pick = (ds, ri) => ds.find((d) => d.rowIndex === ri);

console.log('1. Bild 1: Claude 1, Vision 2 i dagkolumnen, sidans summa går ihop med 2');
{
  const rows = [row(1, 2, 0), row(2, 1, 0), row(3, 1, 0)];
  const cands = landingCandidates([{ rowIndex: 2, field: 'landings_day', vision: '2', read: '1' }], rows);
  ok(cands.length === 1 && cands[0].kind === 'value' && cands[0].vision.day === 2, 'kandidat: värde 1 → 2');
  const ds = decideLandings(cands, { day: 4, night: 0 }, { day: 5, night: 0 }, 0);
  ok(pick(ds, 2)?.pick === 'vision' && pick(ds, 2)?.why === 'totals', 'summan avgör: Vision (2)');
  const ds2 = decideLandings(cands, { day: 4, night: 0 }, { day: 4, night: 0 }, 0);
  ok(pick(ds2, 2)?.pick === 'claude' && pick(ds2, 2)?.why === 'totals', 'summan stämmer redan: Claude (1)');
  const ds3 = decideLandings(cands, { day: 4, night: 0 }, {}, 5);
  ok(ds3.length === 0, 'utan summa och bara ett värde: inget beslut (går till andra titten)');
}

console.log('2. Bild 2: Claude 9 som natt, Vision 9 under dag');
{
  const rows = [row(12, 0, 9)];
  const cands = landingCandidates([{ rowIndex: 12, field: 'landings_day', vision: '9', read: '0' }], rows);
  ok(cands.length === 1 && cands[0].kind === 'move' && cands[0].vision.day === 9 && cands[0].vision.night === 0, 'kandidat: flytt natt → dag');
  const ds = decideLandings(cands, { day: 0, night: 9 }, {}, 0);
  ok(pick(ds, 12)?.pick === 'vision' && pick(ds, 12)?.why === 'night_time', 'ingen nattid → dag (nattiden avgör)');
  const withNight = landingCandidates([{ rowIndex: 12, field: 'landings_day', vision: '9', read: '0' }], [row(12, 0, 9, { night: '0.5' })]);
  const ds2 = decideLandings(withNight, { day: 0, night: 9 }, {}, 3);
  ok(pick(ds2, 12)?.pick === 'vision' && pick(ds2, 12)?.why === 'position', 'med nattid: Visions läge avgör när rutnätet bevisat stämmer');
  const ds3 = decideLandings(withNight, { day: 0, night: 9 }, {}, 1);
  ok(ds3.length === 0, 'för få överens-rader: inget beslut');
  const q = landingQuestion(withNight[0]);
  ok(q.field === 'landings_day' && q.options.length === 0 && /day or night/.test(q.reason), 'frågan: dag eller natt');
}

console.log('3. Hel natt: Vision lägger landningen under dag → Claude (natt) vinner');
{
  const cands = landingCandidates([{ rowIndex: 4, field: 'landings_day', vision: '1', read: '0' }], [row(4, 0, 1, { night: '1.8' })]);
  const ds = decideLandings(cands, { day: 0, night: 1 }, {}, 5);
  ok(pick(ds, 4)?.pick === 'claude' && pick(ds, 4)?.why === 'night_time', 'helt mörker → natt');
}

console.log('4. Vision ser en nattlandning, raden saknar nattid → Claude');
{
  const cands = landingCandidates([{ rowIndex: 5, field: 'landings_night', vision: '1', read: '' }], [row(5, 1, 0)]);
  const ds = decideLandings(cands, { day: 1, night: 0 }, {}, 0);
  ok(pick(ds, 5)?.pick === 'claude', 'ingen nattid → ingen nattlandning');
}

console.log('5. Två kandidater, bara en kombination går ihop med summorna');
{
  const rows = [row(1, 1, 0), row(2, 1, 0), row(3, 3, 0)];
  const cands = landingCandidates([
    { rowIndex: 1, field: 'landings_day', vision: '2', read: '1' },
    { rowIndex: 2, field: 'landings_day', vision: '4', read: '1' },
  ], rows);
  const ds = decideLandings(cands, { day: 5, night: 0 }, { day: 6, night: 0 }, 0);
  ok(pick(ds, 1)?.pick === 'vision' && pick(ds, 2)?.pick === 'claude', 'rad 1 Vision, rad 2 Claude');
  const amb = landingCandidates([
    { rowIndex: 1, field: 'landings_day', vision: '2', read: '1' },
    { rowIndex: 2, field: 'landings_day', vision: '2', read: '1' },
  ], rows);
  ok(decideLandings(amb, { day: 5, night: 0 }, { day: 6, night: 0 }, 0).length === 0, 'två lika kombinationer: inget beslut');
}

console.log('6. Andra titten');
{
  const [c] = landingCandidates([{ rowIndex: 2, field: 'landings_day', vision: '2', read: '1' }], [row(2, 1, 0)]);
  ok(decideBySecondLook(c, { day: 2, night: null, sure: true })?.pick === 'vision', 'säger 2 → Vision');
  ok(decideBySecondLook(c, { day: 1, night: null, sure: true })?.pick === 'claude', 'säger 1 → Claude');
  ok(decideBySecondLook(c, { day: 2, night: null, sure: false }) === null, 'osäker → fråga');
  ok(decideBySecondLook(c, { day: 7, night: null, sure: true }) === null, 'ett tredje tal → fråga');
  const q = landingQuestion(c);
  ok(q.options.join() === '1,2' && /1 or 2/.test(q.reason), 'frågan har båda läsningarna som val');
}

console.log(fails ? `\n${fails} FEL` : '\nAlla tester gick igenom');
process.exit(fails ? 1 : 0);
