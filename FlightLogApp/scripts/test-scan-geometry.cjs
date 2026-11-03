// Test av granskningsvyns geometri (services/scanGeometry.ts): rutnät från skannern eller mallen,
// omräkning av halvsidor vid ryggen, cellrutor och träff-test. Kör: node scripts/test-scan-geometry.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Minimal laddare: transpilerar services/*.ts och löser relativa importer mellan dem.
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const src = fs.readFileSync(path.join(__dirname, '../services', name + '.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[name] = mod.exports;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (p) => (p.startsWith('./') ? load(p.slice(2)) : require(p)));
  return (cache[name] = mod.exports);
}
const G = load('scanGeometry');
const A = load('scanAlign');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// En enkel uppslagsmall: 4 kolumner vänster, 3 höger, 13 rader.
const layout = {
  pageMode: 'spread', rowsPerPage: 13, leftWidthFraction: 0.55,
  columns: [
    { field: 'date', label: 'Date', page: 'left', width: 40 },
    { field: 'dep_place', label: 'Dep', page: 'left', width: 30 },
    { field: 'arr_place', label: 'Arr', page: 'left', width: 30 },
    { field: 'aircraft_type', label: 'Type', page: 'left', width: 40 },
    { field: 'total_time', label: 'Total', page: 'right', width: 30 },
    { field: 'pic', label: 'PIC', page: 'right', width: 30 },
    { field: 'remarks', label: 'Remarks', page: 'right', width: 90 },
  ],
};

console.log('1. Skannerns rutnät (hela uppslaget, index → fält)');
{
  const raw = {
    table_top: 20, table_bottom: 85,
    columns: layout.columns.map((c, i) => ({ index: i + 1, left: 2 + i * 13, right: 2 + i * 13 + 12 })),
  };
  const grid = G.buildPageGrid(raw, layout, layout.columns.map((c) => ({ field: c.field, label: c.label })));
  ok(grid && grid.source === 'scanner', 'källa ska vara scanner');
  ok(grid.columns.length === 7, 'sju kolumner');
  ok(grid.columns[4].field === 'total_time' && grid.columns[4].label === 'Total', 'index 5 → total_time');
  ok(near(grid.tableTop, 0.2) && near(grid.tableBottom, 0.85), 'tabellens kanter');
  const r1 = G.rowRect(grid, 1);
  ok(near(r1.y, 0.2) && near(r1.h, 0.65 / 13), 'rad 1 börjar vid table_top');
  // Mitten av varje cell träffar sin egen rad och kolumn.
  for (let row = 1; row <= 13; row++) {
    for (const c of layout.columns) {
      const cr = G.cellRect(grid, row, c.field);
      const hit = G.hitTest(grid, cr.x + cr.w / 2, cr.y + cr.h / 2);
      if (!hit || hit.rowIndex !== row || hit.field !== c.field) { ok(false, `träff rad ${row} ${c.field}: ${JSON.stringify(hit)}`); }
    }
  }
  ok(G.hitTest(grid, 0.5, 0.1) === null, 'ovanför tabellen ger ingen träff');
  ok(G.hitTest(grid, 0.5, 0.9) === null, 'under tabellen ger ingen träff');
}

console.log('2. Halvsidor vid ryggen räknas om till hela uppslaget');
{
  const lf = 0.55;
  const left = G.remapRawGridX({ table_top: 20, table_bottom: 80, columns: [{ field: 'date', left: 0, right: 50 }] }, 0, lf);
  const right = G.remapRawGridX({ table_top: 22, table_bottom: 82, columns: [{ field: 'total_time', left: 50, right: 100 }] }, lf * 100, 1 - lf);
  ok(near(left.columns[0].left, 0) && near(left.columns[0].right, 27.5), 'vänster halva: x · 0,55');
  ok(near(right.columns[0].left, 55 + 22.5) && near(right.columns[0].right, 100), 'höger halva: 55 + x · 0,45');
  const box = G.remapBoxX({ left: 10, right: 20, top: 30, bottom: 35 }, lf * 100, 1 - lf);
  ok(near(box.left, 59.5) && near(box.right, 64) && box.top === 30, 'rutan flyttas bara i x');
}

console.log('3. Utan skannerns geometri används mallens bredder');
{
  const grid = G.buildPageGrid(undefined, layout, null);
  ok(grid && grid.source === 'template', 'källa ska vara template');
  ok(grid.columns.length === 7, 'alla mallens kolumner');
  const lastLeft = grid.columns[3], firstRight = grid.columns[4];
  ok(lastLeft.right <= 0.55 && firstRight.left >= 0.55, 'ryggen skiljer vänster och höger sida');
  ok(grid.columns.every((c, i) => i === 0 || c.left >= grid.columns[i - 1].right - 1e-9), 'kolumnerna överlappar inte');
  // För få skannerkolumner → mallen tar över.
  const sparse = G.buildPageGrid({ table_top: 20, table_bottom: 80, columns: [{ field: 'date', left: 2, right: 10 }] }, layout, null);
  ok(sparse.source === 'template', 'en enda skannerkolumn räcker inte');
}

console.log('4. Fält utan egen kolumn får en närliggande');
{
  const grid = G.buildPageGrid(undefined, layout, null);
  ok(G.cellRect(grid, 3, 'second_pilot') !== null, 'second_pilot → remarks');
  ok(G.cellRect(grid, 3, 'night') === null, 'night saknas i mallen → ingen ruta');
  const u = G.unionRect([G.cellRect(grid, 2, 'dep_place'), G.cellRect(grid, 2, 'arr_place')]);
  ok(u && near(u.x, grid.columns[1].left) && near(u.x + u.w, grid.columns[2].right), 'union av två celler');
  ok(G.boxRect({ left: 10, top: 20, right: 10.1, bottom: 30 }) === null, 'för smal ruta ignoreras');
}

console.log('5. Loggboken hittas i ett foto med annat runt omkring');
{
  const words = [{ text: '22:53', x: 0.08, y: 0.01, w: 0.1, h: 0.015 }];   // statusraden i en skärmdump
  for (let r = 0; r < 14; r++) for (let c = 0; c < 8; c++) {
    words.push({ text: 'ETHB', x: 0.08 + c * 0.11, y: 0.46 + r * 0.011, w: 0.05, h: 0.008 });
  }
  const b = A.logbookBounds(words);
  ok(b && b.y > 0.4 && b.y < 0.46 && b.y + b.h < 0.66, `höjdled runt boken, inte statusraden: ${JSON.stringify(b)}`);
  ok(b && b.x < 0.08 && b.x + b.w > 0.9, 'hela bredden kommer med');
  ok(A.logbookBounds(words.slice(0, 5)) === null, 'för få ord → ingen beskärning');
  const inCrop = A.wordsInCrop(words, b);
  ok(inCrop.every((w) => w.y >= -0.01 && w.y <= 1) && inCrop.length === words.length - 1, 'orden flyttas in i beskärningen');
}

console.log('6. Claudes felplacerade rutnät rättas mot Visions ord');
{
  // Sant rutnät: tabellen på 30–80 %, kolumnerna där mallen säger. Claude tror 55–95 % och +3 % i x.
  const truth = G.buildPageGrid(undefined, layout, null);
  truth.tableTop = 0.30; truth.tableBottom = 0.80;
  const claude = { ...truth, tableTop: 0.55, tableBottom: 0.95, columns: truth.columns.map((c) => ({ ...c, left: c.left + 0.03, right: c.right + 0.03 })) };
  const rows = [], words = [];
  const regs = ['D-HNSA', 'D-HNFB', 'D-HMFC', 'D-HMFE', 'D-HNFA', 'D-HMFF', 'D-HMVB', 'D-HMFA', 'D-HMVC', 'D-HNSB'];
  for (let r = 1; r <= 10; r++) {
    const values = { date: `2023-01-${String(r + 10)}`, dep_place: r % 2 ? 'ETHB' : 'DUDI', aircraft_type: regs[r - 1], total_time: '1.5' };
    rows.push({ rowIndex: r, values });
    for (const [field, v] of Object.entries(values)) {
      const cell = G.cellRect(truth, r, field);
      words.push({ text: v, x: cell.x + cell.w * 0.2, y: cell.y + cell.h * 0.2, w: cell.w * 0.6, h: cell.h * 0.6 });
    }
  }
  const res = A.alignGrid(claude, rows, words);
  ok(res.grid.source === 'aligned', 'rutnätet justeras');
  ok(Math.abs(res.grid.tableTop - 0.30) < 0.01 && Math.abs(res.grid.tableBottom - 0.80) < 0.01, `tabellens höjd: ${res.grid.tableTop.toFixed(3)}–${res.grid.tableBottom.toFixed(3)}`);
  ok(Math.abs(res.grid.columns[0].left - truth.columns[0].left) < 0.01, `kolumnerna i sidled: ${res.grid.columns[0].left.toFixed(3)} vs ${truth.columns[0].left.toFixed(3)}`);
  const none = A.alignGrid(claude, rows, []);
  ok(none.grid.tableTop === 0.55 && none.grid.source !== 'aligned', 'utan ord lämnas rutnätet orört');
}

console.log('7. Rätt vridning ger högst textpoäng');
{
  const upright = Array.from({ length: 40 }, (_, i) => ({ text: '2023-01-' + (10 + i), x: 0.1, y: i * 0.02, w: 0.1, h: 0.01, confidence: 0.9 }));
  const sideways = Array.from({ length: 30 }, () => ({ text: 'l1', x: 0.1, y: 0.1, w: 0.01, h: 0.05, confidence: 0.3 }));
  ok(A.textScore(upright) > A.textScore(sideways) * 1.25, 'rättvänd text vinner klart');
  ok(A.textScore([]) === 0, 'ingen text ger noll');
}

console.log('8. Högersidans kolumner läggs till från de tryckta rubrikerna');
{
  // Claude gav bara vänstersidans kolumner.
  const grid = { tableTop: 0.3, tableBottom: 0.8, rowsPerPage: 10, source: 'aligned',
    columns: [{ field: 'date', label: 'Date', left: 0.02, right: 0.1 }, { field: 'total_time', label: 'Total', left: 0.4, right: 0.46 }, { field: 'night', label: 'Night', left: 0.47, right: 0.5 }] };
  const words = [
    { text: 'PIC', x: 0.56, y: 0.22, w: 0.03, h: 0.02 },
    { text: 'Dual', x: 0.66, y: 0.22, w: 0.04, h: 0.02 },
    { text: 'Landings', x: 0.84, y: 0.18, w: 0.06, h: 0.02 },
    { text: 'Day/Night', x: 0.84, y: 0.22, w: 0.06, h: 0.02 },
    { text: 'Night', x: 0.87, y: 0.25, w: 0.03, h: 0.015 },          // del av landningsrubriken, inte nattkolumnen
    { text: 'REMARKS', x: 0.92, y: 0.2, w: 0.06, h: 0.02 },
    { text: '7', x: 0.85, y: 0.3 + 0.05 * 1 + 0.01, w: 0.01, h: 0.02 }, // rad 2, dag-halvan
  ];
  const g2 = A.completeGridFromHeaders(grid, words);
  const f = (name) => g2.columns.find((c) => c.field === name);
  ok(f('pic') && f('dual') && f('remarks'), 'PIC, Dual och Remarks läggs till');
  ok(f('landings_day') && f('landings_night') && f('landings_day').right <= f('landings_night').left + 1e-9, 'Landings delas i dag och natt');
  ok(g2.columns.filter((c) => c.field === 'night').length === 1 && f('night').left === 0.47, 'nattkolumnen rörs inte av "Night" i landningsrubriken');
  ok(G.cellRect(g2, 2, 'landings_day') !== null, 'dag-landningar får en cell');
  ok(A.visionDigitsInCell(g2, 2, 'landings_day', words) === '7', 'Vision läser 7 i cellen');
  const checks = A.crossCheckCounts(g2, [{ rowIndex: 2, read: { landings_day: '1' } }, { rowIndex: 3, read: { landings_day: '1' } }], words);
  ok(checks.length === 1 && checks[0].vision === '7' && checks[0].rowIndex === 2, 'landning 1 mot 7 blir en fråga, tom cell ingen');
  const same = A.crossCheckCounts(g2, [{ rowIndex: 2, read: { landings_day: '7' } }], words);
  ok(same.length === 0, 'samma tal ger ingen fråga');
}

console.log('8b. Landningarnas D och N rättar Claudes kolumner som hamnat en kolumn fel');
{
  // Claude lade "dag" på syntetkolumnen och "natt" över dagens siffror (som i användarens bok).
  const grid = { tableTop: 0.3, tableBottom: 0.8, rowsPerPage: 10, source: 'aligned', columns: [
    { field: 'total_time', label: 'Total', left: 0.4, right: 0.5 },
    { field: 'landings_day', label: 'Landings', left: 0.6, right: 0.7 },
    { field: 'landings_night', label: 'Landings', left: 0.7, right: 0.75 },
    { field: 'remarks', label: 'Remarks', left: 0.8, right: 0.98 },
  ] };
  const words = [
    { text: 'Synthetic', x: 0.61, y: 0.2, w: 0.08, h: 0.02 },
    { text: 'Landings', x: 0.71, y: 0.2, w: 0.08, h: 0.02 },
    { text: 'D', x: 0.718, y: 0.27, w: 0.008, h: 0.015 },
    { text: 'N', x: 0.768, y: 0.27, w: 0.008, h: 0.015 },
    { text: '3', x: 0.716, y: 0.3 + 0.05 * 4 + 0.01, w: 0.01, h: 0.02 },   // rad 5, dag-halvan
  ];
  const g2 = A.completeGridFromHeaders(grid, words);
  const f = (name) => g2.columns.find((c) => c.field === name);
  ok(f('landings_day') && Math.abs((f('landings_day').left + f('landings_day').right) / 2 - 0.722) < 0.01, `dagkolumnen flyttas till D (${f('landings_day') && f('landings_day').left.toFixed(3)})`);
  ok(f('landings_night') && f('landings_night').left >= f('landings_day').right - 1e-9, 'nattkolumnen till höger om dagen');
  ok(A.visionDigitsInCell(g2, 5, 'landings_day', words, 0.1) === '3', 'Vision läser 3 i dagcellen');
  ok(A.crossCheckCounts(g2, [{ rowIndex: 5, read: { landings_day: '3', landings_night: '' } }], words).length === 0, 'ingen fråga när Claude läst 3 som dag');
  ok(f('sim') && f('sim').left < 0.7, 'syntetkolumnen får sitt fält från rubriken');
  // Stämmer Claudes kolumner redan rörs de inte.
  const right = { ...grid, columns: [{ field: 'landings_day', label: 'D', left: 0.70, right: 0.747 }, { field: 'landings_night', label: 'N', left: 0.747, right: 0.79 }] };
  const g3 = A.completeGridFromHeaders(right, words);
  ok(g3.columns.find((c) => c.field === 'landings_day').left === 0.70, 'rätt kolumner lämnas orörda');
}

console.log('9. Claudes rutor räknas om med rutnätets rättning');
{
  const grid = { tableTop: 0.3, tableBottom: 0.8, rowsPerPage: 10, columns: [], source: 'aligned', xform: { ax: 0, bx: 1, ay: -0.25, by: 1 } };
  const r = G.mappedBoxRect({ left: 10, top: 75, right: 20, bottom: 78 }, grid);
  ok(Math.abs(r.y - 0.5) < 1e-9 && Math.abs(r.x - 0.1) < 1e-9, `rutan flyttas som rutnätet (${r.y.toFixed(3)})`);
  ok(G.mappedBoxRect({ left: 10, top: 75, right: 20, bottom: 78 }, null).y === 0.75, 'utan rutnät oförändrad');
}

console.log('10. Koordinater som bråk (0–1) i stället för procent tolkas rätt');
{
  const frac = { table_top: 0.2, table_bottom: 0.85, columns: [
    { field: 'date', left: 0.02, right: 0.1 }, { field: 'registration', left: 0.1, right: 0.18 },
    { field: 'dep_place', left: 0.18, right: 0.24 }, { field: 'total_time', left: 0.4, right: 0.46 },
  ] };
  const g = G.buildPageGrid(frac, null, null);
  ok(g && g.columns.length === 4, 'kolumnerna behålls');
  ok(g && Math.abs(g.tableTop - 0.2) < 1e-9 && Math.abs(g.tableBottom - 0.85) < 1e-9, 'tabellens kanter');
  ok(g && Math.abs(g.columns[1].left - 0.1) < 1e-9, 'kolumnens kant');
  const b = G.boxRect({ left: 0.1, top: 0.3, right: 0.18, bottom: 0.33 });
  ok(b && Math.abs(b.x - 0.1) < 1e-9 && Math.abs(b.h - 0.03) < 1e-9, 'rutan kring ett värde');
  const pct = G.buildPageGrid({ table_top: 20, table_bottom: 85, columns: frac.columns.map((c) => ({ ...c, left: c.left * 100, right: c.right * 100 })) }, null, null);
  ok(pct && Math.abs(pct.columns[1].left - 0.1) < 1e-9, 'procent fungerar som förut');
}

console.log('11. Raderna mäts var för sig (buktande sida, olika på vänster och höger sida)');
{
  const h = 0.05;
  const grid = { tableTop: 0.2, tableBottom: 0.8, rowsPerPage: 12, source: 'aligned', columns: [
    { field: 'date', label: 'Date', left: 0.02, right: 0.1 },
    { field: 'dep_place', label: 'Dep', left: 0.1, right: 0.15 },
    { field: 'dep_utc', label: 'Time', left: 0.15, right: 0.2 },
    { field: 'total_time', label: 'Total', left: 0.55, right: 0.6 },
    { field: 'dual', label: 'Dual', left: 0.6, right: 0.65 },
  ] };
  const uniform = (r) => 0.2 + (r - 0.5) * h;
  const leftY = (r) => uniform(r) + 0.03 * (r / 12) ** 2;      // vänster sida: allt längre ner (upp till 0,6 rad)
  const rightY = (r) => uniform(r) - 0.015 * (r / 12);         // höger sida: lite uppåt
  const rows = [], words = [];
  const word = (text, cx, cy) => words.push({ text, x: cx - 0.015, y: cy - 0.008, w: 0.03, h: 0.016 });
  for (let r = 1; r <= 12; r++) {
    const date = `2023-01-${String(10 + r)}`, time = `09:${String(10 + r)}`, total = (1 + r / 10).toFixed(1);
    rows.push({ rowIndex: r, values: { date, dep_place: 'ETHB', dep_utc: time, total_time: total, dual: '1.7' } });
    word(date, 0.06, leftY(r)); word('ETHB', 0.125, leftY(r)); word(time, 0.175, leftY(r));
    word(total, 0.575, rightY(r)); word('1.7', 0.625, rightY(r));
  }
  const centre = (c) => c.y + c.h / 2;
  ok(Math.abs(centre(G.cellRect(grid, 12, 'dep_utc')) - leftY(12)) > 0.5 * h, 'utan mätning hamnar rad 12 mer än en halv rad fel');
  const g = A.measureRows(grid, rows, words);
  for (const r of [3, 8, 12]) {
    ok(Math.abs(centre(G.cellRect(g, r, 'dep_utc')) - leftY(r)) < 0.25 * h, `vänster rad ${r} hamnar rätt (${((centre(G.cellRect(g, r, 'dep_utc')) - leftY(r)) / h).toFixed(2)} rad)`);
    ok(Math.abs(centre(G.cellRect(g, r, 'dual')) - rightY(r)) < 0.25 * h, `höger rad ${r} hamnar rätt (${((centre(G.cellRect(g, r, 'dual')) - rightY(r)) / h).toFixed(2)} rad)`);
  }
  ok(G.hitTest(g, 0.625, rightY(8)).rowIndex === 8, 'tryck på höger rad 8 träffar rad 8');
  ok(G.hitTest(g, 0.175, leftY(12)).rowIndex === 12, 'tryck på vänster rad 12 träffar rad 12');
  // Ett ord på fel ställe (samma klockslag en rad för högt) får inte flytta raden.
  const noisy = [...words, { text: '09:16', x: 0.16, y: leftY(6) - h - 0.008, w: 0.03, h: 0.016 }];
  const g2 = A.measureRows(grid, rows, noisy);
  ok(Math.abs(centre(G.cellRect(g2, 6, 'dep_utc')) - leftY(6)) < 0.25 * h, 'ett felplacerat ord flyttar inte raden');
  // Utan Visions ord: rutnätet oförändrat.
  ok(A.measureRows(grid, rows, []) === grid, 'utan ord oförändrat');
}

console.log('12. Ett talfält flyttas till kolumnen där värdena faktiskt står (simulatortid i en handskriven kolumn)');
{
  const h = 0.05;
  const grid = { tableTop: 0.2, tableBottom: 0.8, rowsPerPage: 12, source: 'aligned', columns: [
    { field: 'dual', label: 'Dual', left: 0.30, right: 0.35 },
    { field: null, label: 'AR landings', left: 0.35, right: 0.40 },
    { field: null, label: 'Simulator time', left: 0.40, right: 0.45 },
    { field: 'sim', label: 'Synthetic training session', left: 0.50, right: 0.55 },
    { field: 'landings_day', label: 'D', left: 0.56, right: 0.60 },
  ] };
  const cy = (r) => 0.2 + (r - 0.5) * h;
  const word = (text, cx, r) => ({ text, x: cx - 0.012, y: cy(r) - 0.008, w: 0.024, h: 0.016 });
  const rows = [], words = [];
  for (let r = 1; r <= 9; r++) { rows.push({ rowIndex: r, values: { dual: '1.7' } }); words.push(word('1.7', 0.325, r), word(String(10 + r), 0.375, r)); }
  for (let r = 10; r <= 12; r++) { rows.push({ rowIndex: r, values: { sim: '1.4', total_time: '1.4', flight_type: 'sim' } }); words.push(word('1.4', 0.425, r)); }
  const { grid: g, moved } = A.relocateColumnsByValues(grid, rows, words);
  ok(moved.length === 1 && g.columns.find((c) => c.field === 'sim').label === 'Simulator time', `sim flyttas till "Simulator time" (${moved.join(', ')})`);
  ok(g.columns.find((c) => c.label === 'Synthetic training session').field === null, 'den tomma tryckta kolumnen blir omappad');
  ok(g.columns.find((c) => c.field === 'dual').label === 'Dual', 'dual stannar (värdena står där)');
  ok(Math.abs(G.cellRect(g, 11, 'sim').x - 0.40) < 1e-9, 'rutan för simulatortid på rad 11 hamnar i den handskrivna kolumnen');
  // Står värdena redan i kolumnen flyttas inget.
  const right = [...words.filter((w) => w.text !== '1.4'), ...[10, 11, 12].map((r) => word('1.4', 0.525, r))];
  ok(A.relocateColumnsByValues(grid, rows, right).moved.length === 0, 'inget flyttas när värdena står i kolumnen');
  // AR-landningarna (andra tal) lockar inte iväg dual.
  ok(!moved.some((m) => m.startsWith('dual')), 'dual flyttas inte till AR landings');
}

console.log('16. Simulatortid i en handskriven kolumn som rutnätet saknar: kolumnen läggs där värdena står');
{
  const h = 0.05;
  const grid = { tableTop: 0.2, tableBottom: 0.8, rowsPerPage: 12, source: 'aligned', columns: [
    { field: 'total_time', label: 'Total time', left: 0.10, right: 0.15 },
    { field: 'sim', label: 'Simulator time', left: 0.30, right: 0.35 },    // Claude: under Co-Pilot (fel)
    { field: 'dual', label: 'Dual', left: 0.45, right: 0.50 },
    { field: null, label: 'AR landings', left: 0.55, right: 0.62 },
    // Ingen kolumn vid x 0.70–0.75, där "Simulator time" faktiskt står.
    { field: 'landings_day', label: 'D', left: 0.80, right: 0.84 },
  ] };
  const cy = (r) => 0.2 + (r - 0.5) * h;
  const word = (text, cx, r) => ({ text, x: cx - 0.012, y: cy(r) - 0.008, w: 0.024, h: 0.016 });
  const rows = [], words = [];
  for (let r = 1; r <= 9; r++) { rows.push({ rowIndex: r, values: { total_time: '1.4', dual: '1.4' } }); words.push(word('1.4', 0.125, r), word('1.4', 0.475, r)); }
  for (let r = 10; r <= 12; r++) { rows.push({ rowIndex: r, values: { sim: '1.4', total_time: '1.4', flight_type: 'sim' } }); words.push(word('1.4', 0.725, r)); }
  const { grid: g, moved } = A.relocateColumnsByValues(grid, rows, words);
  const simCell = G.cellRect(g, 11, 'sim');
  ok(moved.some((m) => m.startsWith('sim')), `sim läggs där värdena står (${moved.join(', ')})`);
  ok(simCell && Math.abs(simCell.x + simCell.w / 2 - 0.725) < 0.01, `rutan för simulatortid på rad 11 hamnar vid x 0.725 (${simCell && (simCell.x + simCell.w / 2).toFixed(3)})`);
  ok(g.columns.filter((c) => c.field === 'sim').length === 1, 'bara en sim-kolumn');
  ok(g.columns.find((c) => c.field === 'dual').left === 0.45 && g.columns.find((c) => c.field === 'total_time').left === 0.10, 'total och dual (samma tal 1.4) rörs inte');
  // Samma tal på olika ställen (ingen gemensam kolumn) → inget flyttas.
  const scattered = [...words.filter((w) => !(w.text === '1.4' && Math.abs(w.x + 0.012 - 0.725) < 1e-6)), word('1.4', 0.66, 10), word('1.4', 0.92, 11), word('1.4', 0.70, 12)];
  ok(!A.relocateColumnsByValues(grid, rows, scattered).moved.some((m) => m.startsWith('sim')), 'utspridda träffar flyttar inte sim');
}

console.log('13. Vridningen: ett liggande uppslag som kommer stående (dokumentskannern) vrids rätt');
{
  // Rättvänt uppslag 2000×1300 px: rubriker överst, rader med ord, summeringsraden nederst.
  const W = 2000, H = 1300;
  const up = [];
  const add = (text, x, y, wPx) => up.push({ text, x, y, w: wPx / W, h: 28 / H, confidence: 0.9 });
  ['Departure', 'Arrival', 'Aircraft', 'Pilot function time', 'Landings', 'REMARKS'].forEach((t2, n) => add(t2, 0.05 + n * 0.15, 0.15, 160));
  for (let r = 0; r < 12; r++) { add('2023-02-' + (10 + r), 0.03, 0.25 + r * 0.045, 150); add('ETHB', 0.2, 0.25 + r * 0.045, 80); add('09:' + (10 + r), 0.3, 0.25 + r * 0.045, 90); }
  add('Total this page', 0.3, 0.86, 220); add('Total to date', 0.3, 0.9, 200);
  // Vrid ord (normerade koordinater) medurs deg grader; bildens mått byts vid 90/270.
  const rot = (ws, deg) => ws.map((w) => deg === 90 ? { ...w, x: 1 - (w.y + w.h), y: w.x, w: w.h, h: w.w }
    : deg === 180 ? { ...w, x: 1 - (w.x + w.w), y: 1 - (w.y + w.h) }
    : deg === 270 ? { ...w, x: w.y, y: 1 - (w.x + w.w), w: w.h, h: w.w } : w);
  const dims = (deg) => (deg === 90 || deg === 270 ? [H, W] : [W, H]);
  const score = (ws, pw, ph) => A.orientationScore(ws, pw, ph) + (A.bookAspect(ws, pw, ph) >= 1 ? 3 : 0);
  // Dokumentskannern gav uppslaget vridet 90° (stående bild). Appen prövar 0°, 90° och 270° på den.
  const scanned = rot(up, 90), [sw, sh] = dims(90);
  const cand = [0, 90, 270].map((deg) => {
    const ws = deg === 0 ? scanned : deg === 90 ? rot(scanned, 90) : rot(scanned, 270);
    const [pw, ph] = deg === 0 ? [sw, sh] : [sh, sw];
    return { deg, s: score(ws, pw, ph) };
  });
  const best = cand.reduce((a, b) => (b.s > a.s ? b : a));
  ok(best.deg === 270, `den stående bilden vrids 270° så att uppslaget blir rättvänt (${cand.map((c) => c.deg + '°=' + c.s.toFixed(1)).join(' ')})`);
  ok(A.bookAspect(scanned, sw, sh) < 1, 'boken står på högkant i den skannade bilden');
  ok(score(up, W, H) > score(rot(up, 180), W, H), 'rättvänt slår upp och ner');
  ok(A.orientationScore(up, W, H) > A.orientationScore(scanned, sw, sh), 'ord på rad slår ord på högkant');
}

console.log('14. Lutningen mäts (snett foto) så att bilden kan rätas upp');
{
  const W = 2000, H = 1300;
  const page = (deg) => {
    const ws = [], tn = Math.tan((deg * Math.PI) / 180);
    for (let r = 0; r < 14; r++) for (let c = 0; c < 12; c++) {
      const x = 80 + c * 150, y = 200 + r * 60 + x * tn;     // raderna lutar deg grader (nedåt åt höger om positivt)
      ws.push({ text: 'AB' + r + c, x: (x - 40) / W, y: (y - 12) / H, w: 80 / W, h: 24 / H });
    }
    return ws;
  };
  for (const deg of [0, 2, -3.5, 1.2]) {
    const est = A.estimateSkew(page(deg), W, H);
    ok(Math.abs(est - deg) <= 0.15, `lutning ${deg}° mäts till ${est}°`);
  }
  ok(A.estimateSkew(page(2).slice(0, 10), W, H) === 0, 'för få ord → 0');
  // Tabell med glesa kolumner (radavstånd 60, kolumnavstånd 600 px): diagonalerna lutar ~5,7° men raderna är raka.
  const grid = (deg, colGap) => {
    const ws = [], tn = Math.tan((deg * Math.PI) / 180);
    for (let r = 0; r < 14; r++) for (let c = 0; c < 6; c++) {
      for (let k = 0; k < 3; k++) {                       // tre ord per cell, som "ETHB 08:10 1.7"
        const x = 60 + c * colGap + k * 70, y = 200 + r * 60 + x * tn;
        ws.push({ text: 'W' + r + c + k, x: (x - 25) / W, y: (y - 12) / H, w: 50 / W, h: 24 / H });
      }
    }
    return ws;
  };
  ok(Math.abs(A.estimateSkew(grid(0, 330), W, H)) <= 0.15, `rakt tabellrutnät → ~0° (${A.estimateSkew(grid(0, 330), W, H)}°), inte diagonalen`);
  ok(Math.abs(A.estimateSkew(grid(2, 330), W, H) - 2) <= 0.15, `lutat tabellrutnät 2° → ${A.estimateSkew(grid(2, 330), W, H)}°`);
  // Vänster sida lutar +3°, höger −3° (bok i V-form): ingen gemensam vridning.
  const left = grid(3, 330).filter((w) => w.x < 0.5), right = grid(-3, 330).filter((w) => w.x >= 0.5);
  ok(A.estimateSkew([...left, ...right], W, H) === 0, 'sidorna lutar åt olika håll → 0');
}

console.log('15. Raderna lutar inom varje sida (bok i V-form): rutan hamnar rätt även långt från mitten');
{
  const h = 0.05;
  const grid = { tableTop: 0.2, tableBottom: 0.8, rowsPerPage: 12, source: 'aligned', columns: [
    { field: 'date', label: 'Date', left: 0.02, right: 0.1 },
    { field: 'dep_place', label: 'Dep', left: 0.1, right: 0.16 },
    { field: 'dep_utc', label: 'Time', left: 0.16, right: 0.22 },
    { field: 'arr_utc', label: 'Arr', left: 0.38, right: 0.44 },
    { field: 'pic', label: 'PIC', left: 0.55, right: 0.6 },
    { field: 'dual', label: 'Dual', left: 0.62, right: 0.67 },
    { field: 'remarks', label: 'Remarks', left: 0.85, right: 0.97 },
  ] };
  const uniform = (r) => 0.2 + (r - 0.5) * h;
  // Vänster sida lutar nedåt åt höger, höger sida uppåt åt höger (dy/dx).
  const y = (r, x) => uniform(r) + (x < 0.5 ? 0.06 * (x - 0.25) : -0.05 * (x - 0.75));
  const rows = [], words = [];
  const word = (text, cx, r) => words.push({ text, x: cx - 0.012, y: y(r, cx) - 0.008, w: 0.024, h: 0.016 });
  for (let r = 1; r <= 12; r++) {
    const date = `2023-02-${10 + r}`, dep = `08:${10 + r}`, arr = `10:${10 + r}`, pic = (1 + r / 10).toFixed(1), rem = 'REM' + r;
    rows.push({ rowIndex: r, values: { date, dep_place: 'ESCF', dep_utc: dep, arr_utc: arr, pic, dual: '1.7', remarks: rem } });
    word(date, 0.06, r); word('ESCF', 0.13, r); word(dep, 0.19, r); word(arr, 0.41, r);
    word(pic, 0.575, r); word('1.7', 0.645, r); word(rem, 0.91, r);
  }
  const g = A.measureRows(grid, rows, words);
  const c = (r, f) => { const x = G.cellRect(g, r, f); return x.y + x.h / 2; };
  for (const [f, x] of [['date', 0.06], ['arr_utc', 0.41], ['pic', 0.575], ['remarks', 0.91]]) {
    for (const r of [1, 6, 12]) ok(Math.abs(c(r, f) - y(r, x)) < 0.25 * h, `${f} rad ${r} hamnar rätt (${((c(r, f) - y(r, x)) / h).toFixed(2)} rad)`);
  }
  ok(g.rowSlopes && g.rowSlopes.left && Math.abs(g.rowSlopes.left.slope - 0.06) < 0.01, `vänster sidas lutning mäts (${g.rowSlopes?.left?.slope?.toFixed(3)})`);
  ok(g.rowSlopes && g.rowSlopes.right && Math.abs(g.rowSlopes.right.slope + 0.05) < 0.01, `höger sidas lutning mäts (${g.rowSlopes?.right?.slope?.toFixed(3)})`);
  ok(G.hitTest(g, 0.91, y(7, 0.91)).rowIndex === 7, 'tryck på anmärkningen på rad 7 träffar rad 7');
}

// ── Bokens kolumner: samma tryck, olika foton ──
{
  console.log('Bokens kolumner: mallen från ett bra uppslag räddar ett uppslag med fel kolumner');
  // Bokens tryck i uppslagets koordinater (vänster sida 0–0.5, höger 0.5–1).
  const COLS = [
    ['date', 0.02, 0.07], ['dep_place', 0.07, 0.13], ['dep_utc', 0.13, 0.18], ['arr_place', 0.18, 0.24], ['arr_utc', 0.24, 0.29],
    ['registration', 0.29, 0.35], ['total_time', 0.35, 0.40], ['ifr', 0.40, 0.45], ['night', 0.45, 0.49],
    ['pic', 0.52, 0.57], ['co_pilot', 0.57, 0.62], ['dual', 0.62, 0.67], ['sim', 0.70, 0.75],
  ];
  const HEAD = { total_time: 'Total', ifr: 'IFR', night: 'Night', pic: 'PIC', co_pilot: 'Co-Pilot', dual: 'Dual', sim: 'Synthetic' };
  const rowsIn = Array.from({ length: 10 }, (_, k) => ({
    rowIndex: k + 1,
    values: { date: `2023-09-${String(k + 1).padStart(2, '0')}`, dep_place: 'ETHB', dep_utc: `08:${String(10 + k)}`, arr_place: 'ETHB', arr_utc: `10:${String(20 + k)}`, registration: `826${k}`, total_time: '2.4', ifr: '2.4', dual: '2.4' },
  }));
  // Ett foto: förskjutning och skala per sida. Vision läser värden och rubriker där de faktiskt står.
  const photo = (ax, bx) => {
    const X = (x) => ax + bx * x, top = 0.25, h = 0.05, out = [];
    const put = (text, field, y) => { const c = COLS.find((q) => q[0] === field); const cx = X((c[1] + c[2]) / 2); out.push({ text, x: cx - 0.012, y: y - 0.008, w: 0.024, h: 0.016 }); };
    for (const [f, t] of Object.entries(HEAD)) put(t, f, top - 0.04);
    rowsIn.forEach((r) => { for (const [f, v] of Object.entries(r.values)) put(v, f, top + h * (r.rowIndex - 0.5)); });
    return out;
  };
  const gridFrom = (cols, ax = 0, bx = 1) => ({ tableTop: 0.25, tableBottom: 0.75, rowsPerPage: 10, source: 'scanner', spine: 0.5,
    columns: cols.map(([field, l, r]) => ({ field, label: field, left: ax + bx * l, right: ax + bx * r })) });

  const wordsA = photo(0, 1), good = gridFrom(COLS);
  const goodScore = A.gridScore(good, rowsIn, wordsA);
  ok(goodScore > 0.9, `rätt rutnät får hög poäng (${goodScore.toFixed(2)})`);

  // Vänstersidans kolumner i procent av sidan (utdragna ×2), som i skärmdumpen.
  const stretched = gridFrom(COLS.map(([f, l, r]) => (l < 0.5 ? [f, l * 2, r * 2] : [f, l, r])));
  const badScore = A.gridScore(stretched, rowsIn, wordsA);
  ok(badScore < goodScore - 0.3, `utdragna kolumner får låg poäng (${badScore.toFixed(2)})`);
  const fixed = A.repairHalfPageColumns(stretched);
  ok(fixed && Math.abs(fixed.columns.find((c) => c.field === 'total_time').left - 0.35) < 0.001, 'halvsideskoordinater skalas om');
  ok(A.repairHalfPageColumns(good) === null, 'rätt rutnät rörs inte');

  // Nästa foto är förskjutet och lite mindre, och Claudes kolumner är fel (dual hoptryckt under PIC).
  const wordsB = photo(0.03, 0.93);
  const wrong = gridFrom(COLS.map(([f, l, r]) => (f === 'dual' ? [f, 0.53, 0.54] : [f, l, r])));
  const book = { columns: good.columns, spine: 0.5, score: goodScore };
  const choice = A.chooseBookGrid(wrong, rowsIn, wordsB, book);
  ok(choice.source === 'book', `bokens mall väljs (${JSON.stringify(choice.scores)})`);
  const dual = choice.grid.columns.find((c) => c.field === 'dual');
  ok(Math.abs((dual.left + dual.right) / 2 - (0.03 + 0.93 * 0.645)) < 0.01, 'dual hamnar där den står på fotot');
  ok(choice.score > 0.9, `valda rutnätet stämmer (${choice.score.toFixed(2)})`);

  // Ett rutnät som redan stämmer byts inte, och utan ankare görs inget.
  const keep = A.chooseBookGrid(good, rowsIn, wordsA, book);
  ok(keep.source === 'own' && keep.grid === good, 'ett bra rutnät behålls');
  ok(A.mapBookColumns(book, good, [], []) === null, 'utan ord: ingen mall');
  const noWords = A.chooseBookGrid(wrong, rowsIn, [], book);
  ok(noWords.grid === wrong, 'utan Visions ord behålls Claudes rutnät');
}

console.log(fails === 0 ? '\ninga fel' : `\n${fails} fel`);
process.exit(fails === 0 ? 0 : 1);
