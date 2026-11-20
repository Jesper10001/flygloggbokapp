// Test av TAF-tidslinjen på kartans väderkort (utils/tafTimeline.ts) med riktiga TAF:ar 2026-11-20
// (aviationweather.gov, scripts/fixtures/taf-2026-11-20.json). Kör: node scripts/test-taf-timeline.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const load = (f, req) => { const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, req); return m.exports; };
const W = load('services/weather.ts', () => ({}));
const T = load('utils/tafTimeline.ts', (p) => (p.includes('weather') ? W : {}));
const tafs = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/taf-2026-11-20.json'), 'utf8')).map((t) => [t.icaoId, t]));
let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };
const NOW = Date.UTC(2026, 10, 20, 22, 10);
const bar = (k) => T.tafBar(tafs[k]).map((b) => `${new Date(b.from * 1000).getUTCHours()}-${new Date(b.to * 1000).getUTCHours()} ${b.cat}`);

eq(T.tafTicks(tafs.ESGG), ['21z', '03z', '09z', '15z', '21z'], '24 h: var 6:e timme');
eq(T.tafTicks(tafs.ESNQ), ['15z', '16z', '17z'], '2 h: varje timme');
eq(T.tafTicks(tafs.ESCF), ['09z', '14z'], '5 h: bara början och slut');
eq(bar('ESGG'), ['21-21 VFR'], 'ESGG en VFR-period');
eq(bar('ESSA'), ['21-17 IFR', '17-21 LIFR'], 'ESSA IFR → LIFR');
const rows = T.tafChanges(tafs.ESSA, NOW);
eq(rows.map((r) => r.time), ['By 23z', '23z–08z', '06z–08z'], 'ESSA tider (BECMG pågår, TEMPO, BECMG)');
eq(rows.map((r) => r.kind), ['BECMG', 'TEMPO', 'BECMG'], 'ESSA typer');
eq(rows[2].text, 'Wind 330°/15 kt, gusts 25', 'ren vindändring jämförs med perioden före');
eq(rows[2].cat, null, 'vindändring har ingen kategori');
eq(rows[1].cat, 'LIFR', 'TEMPO-kategori');
eq(T.tafExpired(tafs.ESCF, NOW), true, 'ESCF utgången');
eq(T.tafExpired(tafs.ESSA, NOW), false, 'ESSA gäller');
// Lokal tid (GMT+1): samma ändringar, tider utan "z"
const loc = (sec) => String((new Date(sec * 1000).getUTCHours() + 1) % 24).padStart(2, '0');
eq(T.tafChanges(tafs.ESSA, NOW, 3, loc).map((r) => r.time), ['By 00', '00–09', '07–09'], 'ESSA i GMT+1');
eq(T.tafTicks(tafs.ESGG, loc), ['22', '04', '10', '16', '22'], 'tidsetiketter i GMT+1');
if (fails) { console.log(`${fails} fel`); process.exit(1); }
console.log('TAF-tidslinjen: alla kontroller gick igenom');
