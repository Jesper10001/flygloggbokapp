// Test av snapColumns (services/scanAlign.ts): den sista finjusteringen som flyttar varje kolumn i sidled dit
// rubriken och värdena faktiskt står, utan att röra kolumner som redan ligger rätt.
// Kör: node scripts/test-scan-snap.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const load = (rel, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, req || (() => ({})));
  return m.exports;
};
const G = load('services/scanGeometry.ts');
const A = load('services/scanAlign.ts', () => G);

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok:' : '  FEL:', m); };
const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol;

// Ett uppslag: tabellen 0.30–0.90 i höjd, 12 rader. Vänster sida datum och total tid, höger sida dual,
// landningar dag/natt och remarks.
const grid = {
  tableTop: 0.30, tableBottom: 0.90, rowsPerPage: 12, source: 'aligned', spine: 0.5,
  columns: [
    { field: 'date', label: 'Date', left: 0.05, right: 0.13 },
    { field: 'total_time', label: 'Total', left: 0.38, right: 0.43 },
    { field: 'dual', label: 'Dual', left: 0.650, right: 0.690 },
    { field: 'landings_day', label: 'Ldg D', left: 0.836, right: 0.864 },
    { field: 'landings_night', label: 'Ldg N', left: 0.864, right: 0.884 },
    { field: 'remarks', label: 'Remarks', left: 0.884, right: 0.995 },
  ],
};
const rowY = (r) => 0.30 + (r - 0.5) * 0.05;
const word = (text, cx, r, w = 0.02) => ({ text, x: cx - w / 2, y: rowY(r) - 0.012, w, h: 0.024 });
const head = (text, cx, w = 0.03) => ({ text, x: cx - w / 2, y: 0.25, w, h: 0.02 });
const rows = [
  { rowIndex: 1, values: { date: '2024-10-23', total_time: '1.7', dual: '1.7', landings_day: '5', landings_night: '' } },
  { rowIndex: 2, values: { date: '2024-10-24', total_time: '1.5', dual: '1.5', landings_day: '10', landings_night: '' } },
  { rowIndex: 3, values: { date: '2024-10-30', total_time: '1.6', dual: '', landings_day: '', landings_night: '5' } },
  { rowIndex: 4, values: { date: '2024-11-05', total_time: '1.4', dual: '1.4', landings_day: '6', landings_night: '' } },
  { rowIndex: 5, values: { date: '2024-11-09', total_time: '1.3', dual: '', landings_day: '', landings_night: '3' } },
];
// I boken står landningarna och remarks 0.008 längre till höger än rutnätet säger; resten ligger rätt.
const SHIFT = 0.008;
const words = [
  head('Dual', 0.670), head('Day/Night', 0.864 + SHIFT, 0.04), head('REMARKS AND ENDORSEMENTS', 0.9395 + SHIFT, 0.09),
  ...rows.flatMap((r) => [
    word(r.values.date, 0.09, r.rowIndex, 0.07), word(r.values.total_time, 0.405, r.rowIndex),
    ...(r.values.dual ? [word(r.values.dual, 0.670, r.rowIndex)] : []),
    ...(r.values.landings_day ? [word(r.values.landings_day, 0.850 + SHIFT, r.rowIndex, 0.012)] : []),
    ...(r.values.landings_night ? [word(r.values.landings_night, 0.874 + SHIFT, r.rowIndex, 0.01)] : []),
  ]),
];

console.log('Kolumner som ligger snett flyttas, de andra står kvar');
let out = A.snapColumns(grid, rows, words);
const col = (g, f) => g.columns.find((c) => c.field === f);
ok(near(col(out.grid, 'landings_day').left, 0.836 + SHIFT) && near(col(out.grid, 'landings_day').right, 0.864 + SHIFT), `landningar dag flyttad +0.8 % (fick ${col(out.grid, 'landings_day').left.toFixed(4)}–${col(out.grid, 'landings_day').right.toFixed(4)})`);
ok(near(col(out.grid, 'landings_night').left, 0.864 + SHIFT) && near(col(out.grid, 'landings_night').right, 0.884 + SHIFT), 'landningar natt flyttad lika mycket');
ok(near(col(out.grid, 'remarks').left, 0.884 + SHIFT), `remarks följer sin rubrik (fick ${col(out.grid, 'remarks').left.toFixed(4)})`);
ok(col(out.grid, 'date').left === 0.05 && col(out.grid, 'total_time').left === 0.38 && col(out.grid, 'dual').left === 0.650, 'datum, total tid och dual står kvar');
ok(out.moved.length === 3 && out.moved.every((m) => /landings|remarks/.test(m)), `tre kolumner flyttade (${out.moved.join(', ')})`);
const cols = [...out.grid.columns].sort((a, b) => a.left - b.left);
ok(cols.every((c, i) => i === 0 || c.left >= cols[i - 1].right - 1e-9), 'inga kolumner går in i varandra');

console.log('Utan underlag ändras inget');
ok(A.snapColumns(grid, rows, []).grid === grid, 'inga ord från Vision → samma rutnät');
out = A.snapColumns(grid, rows, words.filter((w) => w.y > 0.28 && w.x < 0.5));
ok(out.moved.length === 0, 'bara vänstersidans värden, som ligger rätt → inget flyttas');

console.log('Spretiga mätningar ger ingen flytt');
const messy = words.filter((w) => !/Day|REMARKS/.test(w.text)).map((w) => (w.x > 0.83 && w.w < 0.02 ? { ...w, x: w.x + (w.y * 7 % 1) * 0.03 - 0.015 } : w));
out = A.snapColumns(grid, rows, messy);
ok(!out.moved.some((m) => /landings_day/.test(m)) || near(col(out.grid, 'landings_day').left, 0.836, 0.03), 'landningar utan samstämmiga mätningar flyttas inte långt');

console.log('En ensam mätning räcker inte');
out = A.snapColumns(grid, [rows[0]], [word('5', 0.850 + 0.02, 1, 0.012)]);
ok(out.moved.length === 0, 'ett enda ord flyttar ingen kolumn');

console.log(fails ? `\n${fails} fel` : '\n---- inga fel');
process.exit(fails ? 1 : 0);
