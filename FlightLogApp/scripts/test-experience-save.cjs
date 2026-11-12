// Test av drönarens Block import manually mot riktig SQLite (node:sqlite) och appens schema (db/database.ts):
// kolumnen h_other_cats finns, summeringsrader per drönare + restrad räknas rätt i totalen, och militära/NATO-
// timmar (JSON) kommer fram bland kategorierna i Insights (getDroneHoursBank). Kör: node scripts/test-experience-save.cjs
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const transpile = (file, extra = '') => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + extra;

const d = new DatabaseSync(':memory:');
const p = (a) => (Array.isArray(a) ? a : a == null ? [] : [a]).map((v) => (v === undefined ? null : v));
const db = {
  execAsync: async (sql) => { d.exec(sql); },
  runAsync: async (sql, params) => { const r = d.prepare(sql).run(...p(params)); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
  getFirstAsync: async (sql, params) => d.prepare(sql).get(...p(params)) ?? null,
  getAllAsync: async (sql, params) => d.prepare(sql).all(...p(params)),
  withTransactionAsync: async (fn) => { d.exec('BEGIN'); try { await fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; } },
};

// Appens moduler; databasen och inställningarna pekas mot testdatabasen, allt annat utanför stubbas.
const cache = new Map();
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'documentDirectory' ? '/tmp/' : stub()), apply: () => undefined });
const fakes = {
  [path.join(APP, 'db/database')]: { getDatabase: async () => db },
  [path.join(APP, 'db/flights')]: {
    getSetting: async (k) => d.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? null,
    setSetting: async (k, v) => { d.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v); },
  },
};
function load(file) {
  if (fakes[file]) return fakes[file];
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (q) => (q.startsWith('.') ? load(path.join(path.dirname(file), q)) : stub());
  new Function('module', 'exports', 'require', transpile(file + '.ts'))(mod, mod.exports, req);
  return mod.exports;
}

let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };

(async () => {
  const initMod = { exports: {} };
  new Function('exports', 'require', 'module', transpile(path.join(APP, 'db/database.ts'), '\nmodule.exports.__init = initializeDatabase;'))(initMod.exports, () => stub(), initMod);
  await initMod.exports.__init(db);
  const cols = d.prepare(`PRAGMA table_info(drone_flights)`).all().map((c) => c.name);
  eq(cols.includes('h_other_cats'), true, 'kolumnen h_other_cats finns');

  const D = load(path.join(APP, 'db/drones'));
  const id1 = await D.addDrone({ drone_type: '', model: 'Black Hornet 4', registration: '', mtow_g: 0, category: '', drone_class: '', notes: '' });
  const base = { location: '', mission_type: '', category: '', flight_mode: '', max_altitude_m: '', is_night: false, has_observer: false, observer_name: '', source: 'summary', remarks: 'Experience summary 2024', date: '2024-12-31' };
  // Samma som skärmen sparar: 37:15 totalt, 23:15 på drönaren, resten 14:00 + nedbrytningarna.
  await D.insertDroneFlight({ ...base, drone_id: id1, total_time: String(23.25), night_time: '0', landings_day: '0', landings_night: '0' });
  await D.insertDroneFlight({ ...base, drone_id: null, total_time: '14', night_time: '3.6667', h_night: '3.6667', landings_day: '176', landings_night: '14',
    h_vlos: '28.6667', h_evlos: '6.3333', h_bvlos: '2.25', h_a2: '8.1667', h_other_cats: JSON.stringify({ MRPAS: 23.25, 'NATO-CI-Mini': 2 }) });
  // En vanlig flygning i MRPAS (category-kolumnen) läggs ihop med summeringsradens MRPAS.
  d.prepare(`INSERT INTO drone_flights (date, total_time, category, source) VALUES ('2025-03-01', 1.5, 'MRPAS', 'manual')`).run();

  const bank = await D.getDroneHoursBank();
  eq(bank.total, 38.75, 'totalen = 37:15 + 1:30');
  eq(bank.flights, 1, 'summeringsrader räknas inte som flygningar');
  const cat = Object.fromEntries(bank.cats.map((c) => [c.label, c.v]));
  eq(cat.MRPAS, 24.75, 'MRPAS = 23:15 (summering) + 1:30 (flygning)');
  eq(cat['NATO-CI-Mini'], 2, 'NATO-klassen kommer med');
  eq(cat.A2, 8.17, 'civila kategorier som förut');
  eq(Math.round(bank.vlos * 100) / 100, 30.17, 'VLOS = restradens 28:40 + flygningen (flight_mode VLOS som standard)');
  eq(bank.landings_day, 176, 'landningar');
  const usage = await D.getDroneUsage();
  eq(usage.find((u) => u.drone_id === id1)?.total_time, 23.25, 'drönaren får sin tid i Fleet');
  const cut = await D.getDroneHoursBank('2025-01-01');
  eq(cut.cats.find((c) => c.label === 'MRPAS')?.v, 1.5, 'med datumgräns räknas bara det efter gränsen');

  // Trasig JSON fäller inte Insights.
  d.prepare(`UPDATE drone_flights SET h_other_cats='{trasig' WHERE drone_id IS NULL AND source='summary'`).run();
  const bank2 = await D.getDroneHoursBank();
  eq(bank2.cats.find((c) => c.label === 'MRPAS')?.v, 1.5, 'trasig JSON hoppas över');

  console.log(fails ? `${fails} fel` : 'Alla tester gick igenom');
  process.exit(fails ? 1 : 0);
})();
