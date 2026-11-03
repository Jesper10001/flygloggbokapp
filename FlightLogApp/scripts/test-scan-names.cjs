// Test av det som lärs under en skanning (services/scanValueRules.ts) och andrepiloternas namn (services/scanNames.ts).
// Kör: node scripts/test-scan-names.cjs
const fs = require('fs'), path = require('path'), ts = require('typescript');
const load = (f) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../services', f + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require); return m.exports;
};
const R = load('scanValueRules'), N = load('scanNames');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('  FEL:', m); } };

// ── Svar som lärs ──
const a = new Map();
ok(R.noteAnswer(a, [], 'arr_place', 'r1', 'ETNB', 'ETHB') === null, 'första svaret: ingen regel');
ok(R.noteAnswer(a, [], 'arr_place', 'r1', 'ETNB', 'ETHB') === null, 'samma cell räknas en gång');
ok(R.noteAnswer(a, [], 'dep_place', 'r1', 'ETNB', 'ETHB') === null, 'andra cellen: ingen regel');
ok(R.noteAnswer(a, [], 'arr_place', 'r2', 'ETNB', 'ETND') === null, 'annat svar räknas för sig');
const rule = R.noteAnswer(a, [], 'arr_place', 'r3', 'etnb', 'ethb');
ok(rule && rule.from === 'ETNB' && rule.to === 'ETHB' && rule.cls === 'place', 'tredje svaret: regel');
ok(R.noteAnswer(new Map(), [], 'total_time', 'r1', '2.1', '2.4') === null, 'siffror lärs aldrig');
ok(R.noteAnswer(a, [rule], 'arr_place', 'r9', 'ETNB', 'ETHB') === null, 'finns redan: ingen ny regel');

const rows = [
  { key: 'a', data: { dep_place: 'ETNB', arr_place: 'etnb', field_issues: [{ field: 'dep_place' }, { field: 'arr_place' }, { field: 'dual' }] } },
  { key: 'b', data: { dep_place: 'ESCF', arr_place: 'ETNB' } },
  { key: 'c', data: { dep_place: 'ESCF', arr_place: 'ESSL', registration: 'ETNB' } },
];
const stash = new Map();
const after = R.applyValueRules(rows, [rule], stash);
ok(after[0].data.dep_place === 'ETHB' && after[0].data.arr_place === 'ETHB', 'båda platserna rättas');
ok(after[0].data.field_issues.length === 1 && after[0].data.field_issues[0].field === 'dual', 'platsfrågorna tas bort, andra blir kvar');
ok(after[1].data.arr_place === 'ETHB' && after[1].data.dep_place === 'ESCF', 'rader utan fråga rättas också, andra värden rörs inte');
ok(after[2] === rows[2], 'en registrering påverkas inte av en platsregel');
ok(rows[0].data.dep_place === 'ETNB', 'indatan ändras inte');
const back = R.undoValueRule(after, rule, stash);
ok(back[0].data.dep_place === 'ETNB' && back[0].data.field_issues.length === 3, 'ångra: läsningen och frågorna kommer tillbaka');
ok(stash.size === 0, 'ångra tömmer det sparade');
const keep = { cls: 'place', from: 'ETNB', to: 'ETNB' };
const kept = R.applyValueRules(rows, [keep], new Map());
ok(kept[0].data.dep_place === 'ETNB' && kept[0].data.field_issues.length === 1, '"Looks right": värdet kvar, frågan borta');

// ── Namn ──
let r = N.resolveNames(['WOLFF', 'WOLFF', 'Wolff', 'WOFF'], []);
ok(r.groups.length === 1 && r.groups[0].name === 'WOLFF', `WOLFF/Wolff/WOFF blir ett namn (${JSON.stringify(r.groups)})`);
ok(r.nameOf('WOFF') === 'WOLFF' && r.nameOf('Wolff') === 'WOLFF', 'alla får namnet');
ok(r.groups[0].similar === true && r.groups[0].rows === 4, 'markeras som likhet');
r = N.resolveNames(['WOFF'], [{ name: 'Wolff', n: 40 }]);
ok(r.nameOf('WOFF') === 'Wolff', 'ett namn som redan finns vinner, med sin stavning');
r = N.resolveNames(['wolff'], [{ name: 'Wolff', n: 40 }, { name: 'WOLFF', n: 3 }]);
ok(r.nameOf('wolff') === 'Wolff' && r.groups[0].similar === false, 'bara stora/små bokstäver: mest använda stavningen');
r = N.resolveNames(['PU', 'PUA', 'SI', 'SX'], []);
ok(r.groups.length === 4, 'initialer slås aldrig ihop');
r = N.resolveNames(['ULF', 'ULFF'], []);
ok(r.groups.length === 2, 'ett kort namn slås inte ihop');
r = N.resolveNames(['Wolf', 'Wolff'], [{ name: 'Wolf', n: 20 }, { name: 'Wolff', n: 15 }]);
ok(r.groups.length === 2, 'två etablerade personer hålls isär');
r = N.resolveNames(['WOLFF', 'WOFF'], [], new Set(['WOFF']));
ok(r.groups.length === 2 && r.nameOf('WOFF') === 'WOFF', '"Keep separate" håller isär');
r = N.resolveNames(['Öge', 'OGE'], []);
ok(r.groups.length === 1, 'accenter spelar ingen roll');
r = N.resolveNames(['Hansen', 'Larsen'], []);
ok(r.groups.length === 2, 'olika namn hålls isär');

console.log(fails ? `${fails} fel` : 'inga fel');
process.exit(fails ? 1 : 0);
