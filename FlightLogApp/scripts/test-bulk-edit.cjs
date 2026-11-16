// Test av motorn bakom "Edit many flights" (services/bulkEdit/engine.ts): planen ändrar rätt fält på rätt
// flygningar, lämnar summeringsrader, simulatorpass och flygningar där ändringen inte passar, håller
// NVG ≤ natt ≤ flygtid, och går att ångra till exakt samma värden.
// Kör: node scripts/test-bulk-edit.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '..', 'services/bulkEdit/engine.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const E = mod.exports;

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok:' : '  FEL:', m); };
const sum = (rows, f) => Math.round(rows.reduce((a, r) => a + (Number(r[f]) || 0), 0) * 100) / 100;
const ids = (rows) => rows.map((r) => r.id);
/** Ångra: sätt tillbaka från-värdena där fältet fortfarande har planens värde. */
const undo = (rows, plan) => rows.map((r) => { const c = plan.changes.find((x) => x.id === r.id); if (!c) return r; const n = { ...r }; for (const [f, ch] of Object.entries(c.fields)) n[f] = ch.from; return n; });

// ── Pilotläget ──
const P = [
  { id: 1, total_time: 2.0, night: 1.5, nvg: 0, flight_rules: 'VFR', pic: 2.0, co_pilot: 0, dual: 0, multi_pilot: 0, single_pilot: 2.0, ifr: 0, vfr: 2.0, flight_type: 'normal', remarks: '' },
  { id: 2, total_time: 1.0, night: 1.0, nvg: 0, flight_rules: 'IFR', pic: 0, co_pilot: 1.0, dual: 0, multi_pilot: 1.0, single_pilot: 0, ifr: 1.0, vfr: 0, flight_type: 'normal', remarks: '' },
  { id: 3, total_time: 1.2, night: 0, nvg: 0, flight_rules: 'VFR', pic: 0, co_pilot: 0, dual: 1.2, instructor: 0, multi_pilot: 0, single_pilot: 0, ifr: 0, vfr: 1.2, flight_type: 'normal', remarks: '' },
  { id: 4, total_time: 1.8, night: 1.8, nvg: 1.0, flight_rules: 'VFR', pic: 1.8, instructor: 1.8, examiner: 1.8, co_pilot: 0, dual: 0, multi_pilot: 0, single_pilot: 0, ifr: 0, vfr: 1.8, flight_type: 'normal', remarks: '' },
  { id: 5, total_time: 3.0, night: 3.0, nvg: 0, flight_type: 'sim', remarks: '' },
  { id: 6, total_time: 0, night: 12, pic: 25, flight_type: 'summary', remarks: 'Blades previous experience' },
  { id: 7, total_time: 1.0, night: 1.4, nvg: 1.6, flight_rules: 'VFR', pic: 0, co_pilot: 0, dual: 0, multi_pilot: 0, single_pilot: 0, flight_type: 'normal', remarks: '' },
];

console.log('Pilot: NVG = nattiden på alla nattflygningar');
let plan = E.planBulkEdit('pilot', P, ids(P), { kind: 'fill', field: 'nvg', of: 'night', pct: 100 });
let after = E.applyPlan(P, plan);
ok(plan.changes.length === 3 && after[0].nvg === 1.5 && after[3].nvg === 1.8 && after[6].nvg === 1.4, `tre flygningar ändras: 1.5, 1.8 och 1.4 (fick ${plan.changes.length}: ${after[0].nvg}, ${after[3].nvg}, ${after[6].nvg})`);
ok(after[1].nvg === 0 && plan.skipped.some((s) => s.id === 2 && s.reason === 'IFR flight'), 'IFR-flygningen lämnas (NVG flygs inte under IFR)');
ok(plan.skipped.some((s) => s.id === 3 && /night/i.test(s.reason)), 'flygningen utan nattid lämnas');
ok(plan.skipped.some((s) => s.id === 5 && s.reason === 'Simulator session') && plan.skipped.some((s) => s.id === 6 && s.reason === 'Summary row'), 'simulatorpasset och summeringsraden lämnas');
ok(after.every((r) => r.flight_type !== 'normal' || (Number(r.nvg) || 0) <= (Number(r.night) || 0) + 0.005), 'NVG är aldrig mer än natten');
const t = plan.totals.find((x) => x.field === 'nvg');
ok(t && t.before === 2.6 && t.after === sum(after, 'nvg'), `totalen före och efter stämmer med flygningarna (${t && t.before} → ${t && t.after})`);
ok(JSON.stringify(undo(after, plan)) === JSON.stringify(P), 'ångra ger exakt samma flygningar som före');

console.log('Pilot: bara de valda flygningarna');
plan = E.planBulkEdit('pilot', P, [1], { kind: 'fill', field: 'nvg', of: 'night', pct: 50 });
ok(plan.changes.length === 1 && plan.changes[0].fields.nvg.to === 0.75 && plan.skipped.length === 0, `flygning 1 får halva natten, inga andra berörs (fick ${plan.changes.length}, ${plan.changes[0] && plan.changes[0].fields.nvg.to})`);
plan = E.planBulkEdit('pilot', P, [4], { kind: 'fill', field: 'nvg', of: 'night', pct: 0 });
ok(plan.changes.length === 1 && plan.changes[0].fields.nvg.to === 0, 'ta bort NVG: 1.0 → 0');
plan = E.planBulkEdit('pilot', E.applyPlan(P, E.planBulkEdit('pilot', P, ids(P), { kind: 'fill', field: 'nvg', of: 'night', pct: 100 })), ids(P), { kind: 'fill', field: 'nvg', of: 'night', pct: 100 });
ok(plan.changes.length === 0 && plan.unchanged === 3, `samma ändring en gång till ändrar ingenting (fick ${plan.changes.length} ändringar, ${plan.unchanged} oförändrade)`);

console.log('Pilot: nattid och NVG hänger ihop');
plan = E.planBulkEdit('pilot', P, [7], { kind: 'fill', field: 'night', of: 'total_time', pct: 100 });
ok(plan.changes[0].fields.night.to === 1.0 && plan.changes[0].fields.nvg.to === 1.0, 'natten kapas till flygtiden och NVG följer med ned');
plan = E.planBulkEdit('pilot', P, ids(P), { kind: 'night', values: { 1: 0.4, 4: 5, 3: 0 } });
after = E.applyPlan(P, plan);
ok(after[0].night === 0.4 && after[3].night === 1.8 && after[3].nvg === 1.0, `omräknad natt: 0.4, och 5 h kapas till flygtiden 1.8 (fick ${after[0].night}, ${after[3].night})`);
ok(plan.skipped.some((s) => s.id === 2 && /position/i.test(s.reason)), 'flygningen utan beräknat värde lämnas');

console.log('Pilot: roll, single/multi och flygregler');
plan = E.planBulkEdit('pilot', P, [3, 4], { kind: 'role', role: 'co_pilot' });
after = E.applyPlan(P, plan);
ok(after[2].co_pilot === 1.2 && after[2].dual === 0, 'dual-flygningen blir co-pilot med hela flygtiden');
ok(after[3].co_pilot === 1.8 && after[3].pic === 0 && after[3].instructor === 0 && after[3].examiner === 0, 'PIC + instruktör + examinator → co-pilot: påbyggnadsrollerna tas bort');
plan = E.planBulkEdit('pilot', P, [4], { kind: 'role', role: 'picus' });
after = E.applyPlan(P, plan);
ok(after[3].picus === 1.8 && after[3].instructor === 1.8 && after[3].examiner === 0, 'PICUS behåller instruktörstiden men inte examinatorstiden');
plan = E.planBulkEdit('pilot', P, [3, 4], { kind: 'crew', multi: true });
after = E.applyPlan(P, plan);
ok(after[2].multi_pilot === 1.2 && after[3].multi_pilot === 1.8 && after[2].single_pilot === 0, 'multi-pilot = flygtiden, single-pilot = 0');
plan = E.planBulkEdit('pilot', P, [4], { kind: 'rules', rules: 'IFR' });
after = E.applyPlan(P, plan);
ok(after[3].flight_rules === 'IFR' && after[3].ifr === 1.8 && after[3].vfr === 0 && after[3].nvg === 0, 'IFR: IFR-tid = flygtiden, VFR-tid 0 och NVG nollas');
ok(JSON.stringify(undo(after, plan)) === JSON.stringify(P), 'ångra ger tillbaka regler, tider och NVG');

// ── Drönarläget ──
const D = [
  { id: 1, total_time: 0.5, night_time: 0, is_night: 1, category: '', flight_mode: 'VLOS', h_vlos: 0.3, h_evlos: 0, h_bvlos: 0.2, operation_type: '', mission_type: '', pilot_role: '', co_pilot_fpv: 0, dual: 0, instructor: 0, source: 'manual' },
  { id: 2, total_time: 0.4, night_time: 0, is_night: 0, category: 'A2', flight_mode: 'VLOS', h_vlos: 0, h_evlos: 0, h_bvlos: 0, operation_type: 'COM', mission_type: 'Survey', pilot_role: 'sic', co_pilot_fpv: 0.4, dual: 0, instructor: 0, source: 'import' },
  { id: 3, total_time: 120, night_time: 0, is_night: 0, category: '', flight_mode: 'VLOS', h_vlos: 80, h_night: 10, source: 'summary' },
];
console.log('Drönare: kategori, siktläge, natt och roll');
plan = E.planBulkEdit('drone', D, ids(D), { kind: 'set', field: 'category', value: 'A3' });
after = E.applyPlan(D, plan);
ok(after[0].category === 'A3' && after[1].category === 'A3' && after[2].category === '' && plan.skipped.length === 1, 'båda flygningarna får A3, summeringsraden lämnas');
plan = E.planBulkEdit('drone', D, [1], { kind: 'set', field: 'flight_mode', value: 'BVLOS' });
after = E.applyPlan(D, plan);
ok(after[0].flight_mode === 'BVLOS' && after[0].h_vlos === 0 && after[0].h_bvlos === 0, 'siktläget byts och den delade tiden tas bort');
plan = E.planBulkEdit('drone', D, ids(D), { kind: 'fill', field: 'night_time', of: 'total_time', pct: 100 });
after = E.applyPlan(D, plan);
ok(after[0].night_time === 0.5 && after[0].is_night === 1 && after[1].night_time === 0.4 && after[1].is_night === 1, 'nattid = flygtiden och nattflaggan sätts');
plan = E.planBulkEdit('drone', D, [2], { kind: 'role', role: 'dual' });
after = E.applyPlan(D, plan);
ok(after[1].pilot_role === 'dual' && after[1].dual === 0.4 && after[1].co_pilot_fpv === 0, 'co-pilot → student: tiden flyttas till dual');
ok(JSON.stringify(undo(after, plan)) === JSON.stringify(D), 'ångra ger exakt samma drönarflygningar som före');
plan = E.planBulkEdit('drone', D, ids(D), { kind: 'remarks', add: 'Wind gusts' });
after = E.applyPlan(D, plan);
ok(plan.changes.length === 2 && after[0].remarks === 'Wind gusts' && after[1].remarks === 'Wind gusts' && !after[2].remarks, 'drönare: text i remarks på båda flygningarna, inte på summeringsraden');
plan = E.planBulkEdit('drone', D, [2], { kind: 'delete' });
ok(plan.changes.length === 1 && plan.changes[0].fields[E.DELETED_FIELD], 'drönare: en flygning går att radera');
const DD = [
  { id: 11, date: '2026-05-01', location: 'Grinda', takeoff_time: '10:00', total_time: 0.3, registration: 'MINI4-01', source: 'manual' },
  { id: 12, date: '2026-05-01', location: 'grinda', takeoff_time: '10:00', total_time: 0.3, registration: 'MINI4-01', source: 'import' },
  { id: 13, date: '2026-05-01', location: 'Grinda', takeoff_time: '', total_time: 0.3, registration: 'MINI4-01', source: 'manual' },
  { id: 14, date: '2026-05-01', location: 'Grinda', takeoff_time: '', total_time: 0.3, registration: 'MINI4-01', source: 'manual' },
];
const dup = E.suggestionsFor('drone', DD).find((x) => x.id === 'duplicates');
ok(dup && dup.ids.join() === '12' && dup.column === 'cleanup', `drönare: dubbletten (samma plats och starttid) föreslås raderad, pass utan starttid lämnas (fick ${dup && dup.ids.join()})`);
ok(E.suggestionsFor('drone', D).every((x) => E.DRONE_COLUMNS.some((c) => c.key === x.column)), 'drönare: varje förslag hör till en ruta i rutnätet');

console.log('Förslagen');
let sg = E.suggestionsFor('pilot', P);
const by = (id) => sg.find((x) => x.id === id);
ok(by('nvg_missing') && by('nvg_missing').ids.join() === '1', `natt utan NVG: flygning 1 (IFR-flygningen och simulatorn räknas inte) (fick ${by('nvg_missing') && by('nvg_missing').ids.join()})`);
ok(by('night_gt_total') && by('night_gt_total').ids.join() === '7' && by('nvg_gt_night').ids.join() === '7', 'mer natt än flygtid och mer NVG än natt: flygning 7');
ok(by('no_role') && by('no_role').ids.join() === '7' && by('no_crew').ids.join() === '3,4,7', `ingen roll: 7; varken single eller multi: 3, 4, 7 (fick ${by('no_role') && by('no_role').ids.join()} / ${by('no_crew') && by('no_crew').ids.join()})`);
plan = E.planBulkEdit('pilot', P, by('nvg_gt_night').ids, by('nvg_gt_night').op);
ok(plan.changes.length === 1 && plan.changes[0].fields.nvg.to === 1.4, 'förslagets ändring rättar felet');
sg = E.suggestionsFor('drone', D);
ok(sg.find((x) => x.id === 'no_category').ids.join() === '1' && sg.find((x) => x.id === 'no_operation').ids.join() === '1', 'drönare: flygning 1 saknar kategori och uppdragstyp, summeringsraden räknas inte');
ok(E.suggestionsFor('pilot', []).length === 0 && E.planBulkEdit('pilot', [], [], { kind: 'crew', multi: true }).changes.length === 0, 'inga flygningar: inga förslag och en tom plan');

// ── Sparandet och ångra (db/bulkEdits.ts) mot riktig SQLite med appens eget schema ──
(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const tsx = (rel) => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'documentDirectory' ? '/tmp/' : stub()), apply: () => undefined });
  const dbMod = { exports: {} };
  new Function('exports', 'require', 'module', tsx('db/database.ts') + '\nmodule.exports.__init = initializeDatabase;')(dbMod.exports, () => stub(), dbMod);
  const d = new DatabaseSync(':memory:');
  const p = (a) => (Array.isArray(a) ? a : a == null ? [] : [a]).map((v) => (v === undefined ? null : v));
  let failAt = 0, calls = 0;
  const db = {
    execAsync: async (sql) => { d.exec(sql); },
    runAsync: async (sql, params) => { calls++; if (failAt && calls >= failAt) throw new Error('avbrott'); const r = d.prepare(sql).run(...p(params)); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    getFirstAsync: async (sql, params) => d.prepare(sql).get(...p(params)) ?? null,
    getAllAsync: async (sql, params) => d.prepare(sql).all(...p(params)),
    withTransactionAsync: async (fn) => { d.exec('BEGIN'); try { await fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; } },
  };
  await dbMod.exports.__init(db);
  const beMod = { exports: {} };
  new Function('exports', 'require', 'module', tsx('db/bulkEdits.ts'))(beMod.exports, (m) => (m === './database' ? { getDatabase: async () => db } : m.endsWith('bulkEdit/engine') ? E : {}), beMod);
  const BE = beMod.exports;

  console.log('Spara och ångra i databasen (pilotläget)');
  const ins = d.prepare(`INSERT INTO flights (date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc, total_time, night, nvg, pic, flight_rules, flight_type, remarks, status, source)
    VALUES (?, 'A109', 'SE-JRA', 'ESCF', '20:00', 'ESCF', '21:30', ?, ?, 0, ?, ?, 'normal', '', 'manual', 'import')`);
  ins.run('2026-01-10', 1.5, 1.5, 1.5, 'VFR'); ins.run('2026-01-11', 2.0, 1.0, 2.0, 'VFR'); ins.run('2026-01-12', 1.0, 1.0, 1.0, 'IFR'); ins.run('2026-01-13', 1.2, 0, 1.2, 'VFR');
  const read = () => d.prepare('SELECT * FROM flights ORDER BY id').all();
  const before = read();
  plan = E.planBulkEdit('pilot', before, before.map((r) => r.id), { kind: 'fill', field: 'nvg', of: 'night', pct: 100 });
  const editId = await BE.applyBulkEdit('pilot', 'NVG time = night time', plan);
  let now = read();
  ok(editId > 0 && now[0].nvg === 1.5 && now[1].nvg === 1.0 && now[2].nvg === 0 && now[3].nvg === 0, `två flygningar har fått NVG i databasen (fick ${now.map((r) => r.nvg).join(', ')})`);
  ok(d.prepare('SELECT COUNT(*) c FROM bulk_edit_changes WHERE edit_id=?').get(editId).c === 2 && d.prepare(`SELECT COUNT(*) c FROM audit_log WHERE field_name='nvg'`).get().c === 2, 'gammalt och nytt värde är sparat per flygning, och ändringsloggen har fått raderna');
  ok((await BE.listBulkEdits('pilot')).length === 1 && (await BE.listBulkEdits('drone')).length === 0, 'ändringen står under Recent changes för pilotläget');
  d.prepare('UPDATE flights SET nvg=0.7 WHERE id=?').run(now[1].id);   // användaren ändrar en flygning själv efteråt
  let u = await BE.undoBulkEdit(editId);
  now = read();
  ok(u.restored === 1 && u.kept === 1 && now[0].nvg === 0 && now[1].nvg === 0.7, `ångra: flygning 1 tillbaka till 0, den man ändrade själv ligger kvar på 0.7 (fick ${now[0].nvg}, ${now[1].nvg})`);
  u = await BE.undoBulkEdit(editId);
  ok(u.restored === 0 && (await BE.listBulkEdits('pilot')).length === 0, 'samma ändring kan inte ångras två gånger');

  console.log('Avbrott mitt i sparandet');
  d.prepare('UPDATE flights SET nvg=0').run();
  const clean = JSON.stringify(read());
  const edits = d.prepare('SELECT COUNT(*) c FROM bulk_edits').get().c;
  plan = E.planBulkEdit('pilot', read(), read().map((r) => r.id), { kind: 'fill', field: 'nvg', of: 'night', pct: 100 });
  calls = 0; failAt = 4;
  let threw = false;
  try { await BE.applyBulkEdit('pilot', 'NVG', plan); } catch { threw = true; }
  failAt = 0;
  ok(threw && JSON.stringify(read()) === clean && d.prepare('SELECT COUNT(*) c FROM bulk_edits').get().c === edits, 'allt eller inget: ingen flygning och ingen post är ändrad');

  console.log('Bara tillåtna kolumner skrivs');
  const evil = { changes: [{ id: before[0].id, fields: { total_time: { from: 1.5, to: 99 }, 'date=1; DROP TABLE flights; --': { from: '', to: 'x' } } }], skipped: [], unchanged: 0, totals: [] };
  await BE.applyBulkEdit('pilot', 'x', evil);
  ok(read()[0].total_time === 1.5 && read().length === 4, 'flygtiden och andra kolumner utanför listan rörs aldrig');

  console.log('Drönarläget i databasen');
  d.prepare(`INSERT INTO drone_flights (date, drone_type, registration, location, mission_type, category, flight_mode, total_time, observer_name, remarks) VALUES ('2026-02-01', 'Mavic 3', 'SE-1', 'Uppsala', '', '', 'VLOS', 0.5, '', '')`).run();
  const dr = d.prepare('SELECT * FROM drone_flights').all();
  plan = E.planBulkEdit('drone', dr, dr.map((r) => r.id), { kind: 'set', field: 'category', value: 'A2' });
  const dEdit = await BE.applyBulkEdit('drone', 'Category → A2', plan);
  ok(d.prepare('SELECT category FROM drone_flights').get().category === 'A2', 'kategorin är sparad på drönarflygningen');
  await BE.undoBulkEdit(dEdit);
  ok(d.prepare('SELECT category FROM drone_flights').get().category === '', 'och ångrad till tom');

  
// ── Pilotläget: nya ändringar (Edit flights) ──
const Q = [
  { id: 11, date: '2026-11-01', dep_place: 'ESSA', arr_place: 'ESGG', dep_place_raw: 'ARN', arr_place_raw: 'ESGG', dep_utc: '10:00', arr_utc: '11:00', total_time: 1.0, night: 0, aircraft_type: 'A109', registration: 'KILO39', takeoffs_day: 1, takeoffs_night: 0, landings_day: 1, landings_night: 0, remarks: 'HEMS', flight_type: 'normal' },
  { id: 12, date: '2026-11-01', dep_place: 'ESSA', arr_place: 'ESGG', dep_place_raw: 'ESSA', arr_place_raw: 'ESGG', dep_utc: '10:00', arr_utc: '11:00', total_time: 1.0, night: 0, aircraft_type: 'A109', registration: 'KILO39', takeoffs_day: 1, takeoffs_night: 0, landings_day: 1, landings_night: 0, remarks: 'HEMS\nPIC: Sam Berg', flight_type: 'normal' },
  { id: 13, date: '2026-11-02', dep_place: 'ESCF', arr_place: 'ESCF', dep_place_raw: 'ESCF', arr_place_raw: 'ESCF', dep_utc: '20:00', arr_utc: '21:30', total_time: 1.5, night: 1.5, aircraft_type: 'EC135', registration: 'SE-HEM', takeoffs_day: 0, takeoffs_night: 0, landings_day: 0, landings_night: 0, remarks: '', flight_type: 'normal' },
  { id: 14, date: '2026-11-03', dep_place: 'ESCF', arr_place: 'ESCF', dep_utc: '', arr_utc: '', total_time: 2.0, night: 0, aircraft_type: 'EC135', registration: 'SE-HEM', takeoffs_day: 0, takeoffs_night: 2, landings_day: 0, landings_night: 2, remarks: 'Training, hoist', flight_type: 'normal' },
  { id: 15, total_time: 3.0, flight_type: 'sim', remarks: '' },
];
console.log('Pilot: byt typ och registrering');
plan = E.planBulkEdit('pilot', Q, [11, 13, 15], { kind: 'set', field: 'aircraft_type', value: ' a109s ' });
after = E.applyPlan(Q, plan);
ok(plan.changes.length === 2 && after[0].aircraft_type === 'A109S' && after[2].aircraft_type === 'A109S' && plan.skipped.some((x) => x.id === 15), 'typen skrivs i versaler, simulatorpasset lämnas');
ok(JSON.stringify(undo(after, plan)) === JSON.stringify(Q), 'ångra ger samma värden');
plan = E.planBulkEdit('pilot', Q, [11], { kind: 'set', field: 'registration', value: 'KILO39' });
ok(plan.changes.length === 0 && plan.unchanged === 1, 'samma registrering → inget att ändra');

console.log('Pilot: flygplatskoder');
plan = E.planBulkEdit('pilot', Q, [11, 12, 13], { kind: 'codes', values: { 11: { dep: 'ESSA', arr: 'ESGG' }, 12: { dep: 'ESSA', arr: 'ESGG' } } });
after = E.applyPlan(Q, plan);
ok(plan.changes.length === 1 && after[0].dep_place_raw === 'ESSA' && plan.unchanged === 1 && plan.skipped.some((x) => x.id === 13), 'bara den visade koden byts; redan rätt och utan kod lämnas');
ok(after[0].dep_place === 'ESSA', 'flygplatsen (dep_place) rörs inte');

console.log('Pilot: starter och landningar');
plan = E.planBulkEdit('pilot', Q, [11, 13, 14], { kind: 'bump', what: 'landings', delta: 1 });
after = E.applyPlan(Q, plan);
ok(after[0].landings_day === 2 && after[2].landings_night === 1 && after[3].landings_night === 3, 'en landning till: dag, natt (hela flygningen i mörker) och nattens räknare');
ok(plan.totals.some((x) => x.field === 'landings_day' && x.int && x.after === x.before + 1), 'totalen räknas som antal');
plan = E.planBulkEdit('pilot', Q, [11, 13, 14], { kind: 'bump', what: 'takeoffs', delta: -1 });
after = E.applyPlan(Q, plan);
ok(after[0].takeoffs_day === 0 && after[3].takeoffs_night === 1 && plan.skipped.some((x) => x.id === 13 && /take-off/i.test(x.reason)), 'en start mindre; ingen att ta bort lämnas');
ok(after.every((r) => (r.takeoffs_day ?? 0) >= 0 && (r.takeoffs_night ?? 0) >= 0), 'aldrig under noll');

console.log('Pilot: text i remarks');
plan = E.planBulkEdit('pilot', Q, [11, 12, 13], { kind: 'remarks', add: 'Mountain' });
after = E.applyPlan(Q, plan);
ok(after[0].remarks === 'HEMS\nMountain' && after[1].remarks === 'HEMS\nPIC: Sam Berg\nMountain' && after[2].remarks === 'Mountain', 'texten läggs sist som egen rad');
plan = E.planBulkEdit('pilot', Q, [11, 12], { kind: 'remarks', add: 'hems' });
ok(plan.changes.length === 0 && plan.skipped.length === 2, 'finns raden redan läggs den inte till igen');
plan = E.planBulkEdit('pilot', Q, [11, 12, 14], { kind: 'remarks', remove: 'hems' });
after = E.applyPlan(Q, plan);
ok(after[0].remarks === '' && after[1].remarks === 'PIC: Sam Berg' && plan.skipped.some((x) => x.id === 14), 'texten tas bort, tomma rader försvinner, saknas den lämnas flygningen');
plan = E.planBulkEdit('pilot', Q, [14], { kind: 'remarks', remove: ', hoist' });
ok(E.applyPlan(Q, plan)[3].remarks === 'Training', 'en del av en rad tas bort');
plan = E.planBulkEdit('pilot', Q, [11], { kind: 'remarks', remove: 'HE.S' });
ok(plan.changes.length === 0, 'tecken i texten tolkas inte som mönster');

console.log('Pilot: radera och dubbletter');
plan = E.planBulkEdit('pilot', Q, [12, 15], { kind: 'delete' });
after = E.applyPlan(Q, plan);
ok(plan.changes.length === 1 && plan.changes[0].fields[E.DELETED_FIELD] && after.length === Q.length - 1 && !after.some((r) => r.id === 12), 'flygningen försvinner, simulatorpasset lämnas');
ok(plan.totals.some((x) => x.field === 'flights' && x.before === 4 && x.after === 3) && plan.totals.some((x) => x.field === 'total_time' && x.before === 5.5 && x.after === 4.5), 'antal och flygtid före och efter');
const dup = E.suggestionsFor('pilot', Q).find((x) => x.id === 'duplicates');
ok(dup && dup.ids.length === 1 && dup.ids[0] === 12 && dup.column === 'cleanup' && dup.op.kind === 'delete', 'dubbletten är kopian (högre id), originalet behålls');
ok(!E.suggestionsFor('pilot', [Q[3], { ...Q[3], id: 16 }]).some((x) => x.id === 'duplicates'), 'utan tider räknas två lika flygningar inte som dubbletter');
ok(E.PILOT_COLUMNS.length === 9 && E.suggestionsFor('pilot', P).every((x) => E.PILOT_COLUMNS.some((c) => c.key === x.column)), 'varje förslag hör till en kolumn');

// Flygplatskoderna (services/bulkEdit/codes.ts)
{
  const src2 = fs.readFileSync(path.join(__dirname, '..', 'services/bulkEdit/codes.ts'), 'utf8');
  const js2 = ts.transpileModule(src2, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m2 = { exports: {} };
  new Function('module', 'exports', 'require', js2)(m2, m2.exports, () => ({}));
  const lookup = { ESSA: { icao: 'ESSA', iata: 'ARN' }, ESGG: { icao: 'ESGG', iata: 'GOT' }, ESCF: { icao: 'ESCF', iata: '' } };
  const v = m2.exports.codeValues(Q, lookup, 'iata');
  ok(v[11].dep === 'ARN' && v[11].arr === 'GOT' && v[13] === undefined, 'IATA: koden slås upp på flygplatsen; saknas IATA lämnas flygningen');
  const w = m2.exports.codeValues(Q, lookup, 'icao');
  ok(w[11].dep === 'ESSA' && w[13].dep === 'ESCF', 'ICAO: flygplatsens fyrställiga kod');
}

  console.log('Radera och lägga tillbaka i databasen');
  {
    const rowsNow = read();
    const victim = rowsNow[1];
    plan = E.planBulkEdit('pilot', rowsNow, [victim.id], { kind: 'delete' });
    const delId = await BE.applyBulkEdit('pilot', 'Flights deleted', plan);
    ok(delId > 0 && !read().some((r) => r.id === victim.id) && read().length === rowsNow.length - 1, 'flygningen är borta ur databasen');
    const saved = d.prepare('SELECT field, old_value FROM bulk_edit_changes WHERE edit_id=?').get(delId);
    ok(saved.field === E.DELETED_FIELD && JSON.parse(saved.old_value).id === victim.id, 'hela raden är sparad för ångra');
    const back = await BE.undoBulkEdit(delId);
    const again = read().find((r) => r.id === victim.id);
    ok(back.restored === 1 && back.flights === 1 && again && JSON.stringify(again) === JSON.stringify(victim), 'ångra lägger tillbaka flygningen med samma id och samma värden');
    // Id:t upptaget av en annan flygning → raden kommer tillbaka med ett nytt id i stället för att skriva över.
    const last = read()[read().length - 1];
    plan = E.planBulkEdit('pilot', read(), [last.id], { kind: 'delete' });
    const delId2 = await BE.applyBulkEdit('pilot', 'Flights deleted', plan);
    d.prepare(`INSERT INTO flights (id, date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc, total_time, flight_type, remarks, status, source)
      VALUES (?, '2026-03-01', 'B206', 'SE-NEW', 'ESSA', '08:00', 'ESSA', '09:00', 1.0, 'normal', 'new', 'manual', 'manual')`).run(last.id);
    await BE.undoBulkEdit(delId2);
    const all2 = read();
    ok(all2.find((r) => r.id === last.id).remarks === 'new' && all2.some((r) => r.id !== last.id && r.date === last.date && r.total_time === last.total_time && r.registration === last.registration), 'upptaget id: den nya flygningen ligger kvar och den raderade kommer tillbaka med nytt id');
  }
  console.log('Text och antal i databasen');
  {
    const rowsNow = read();
    plan = E.planBulkEdit('pilot', rowsNow, [rowsNow[0].id], { kind: 'remarks', add: 'Mountain' });
    const e1 = await BE.applyBulkEdit('pilot', 'Remarks + Mountain', plan);
    plan = E.planBulkEdit('pilot', read(), [rowsNow[0].id], { kind: 'bump', what: 'landings', delta: 1 });
    const e2 = await BE.applyBulkEdit('pilot', 'Landing added', plan);
    let r0 = read()[0];
    ok(r0.remarks === 'Mountain' && r0.landings_day + r0.landings_night === rowsNow[0].landings_day + rowsNow[0].landings_night + 1, 'remarks och landningar är sparade');
    await BE.undoBulkEdit(e2); await BE.undoBulkEdit(e1);
    r0 = read()[0];
    ok(r0.remarks === rowsNow[0].remarks && r0.landings_day === rowsNow[0].landings_day && r0.landings_night === rowsNow[0].landings_night, 'och ångrade');
  }

  console.log(fails ? `\n${fails} fel` : '\nAlla gröna');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEL', e); process.exit(1); });
