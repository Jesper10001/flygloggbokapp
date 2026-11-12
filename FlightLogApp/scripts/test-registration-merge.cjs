// Test av sammanslagningen av tvillingregistreringar (db/registrationTwins.ts) mot riktig SQLite (node:sqlite)
// och appens eget schema (db/database.ts): flygningarna byter registrering, registret städas, ändringen går att
// ångra, simulatorpass rörs inte, och den körs bara en gång. Kör: node scripts/test-registration-merge.cjs
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
  // Schemat: appens egen initializeDatabase.
  const initMod = { exports: {} };
  new Function('exports', 'require', 'module', transpile(path.join(APP, 'db/database.ts'), '\nmodule.exports.__init = initializeDatabase;'))(initMod.exports, () => stub(), initMod);
  await initMod.exports.__init(db);

  const add = (reg, n, extra = {}) => {
    for (let i = 0; i < n; i++) {
      d.prepare(`INSERT INTO flights (date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc, total_time, flight_type, remarks) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run('2026-11-01', 'A109', reg, 'ESCF', '10:00', 'ESCF', '11:00', 1, extra.flight_type ?? 'normal', extra.remarks ?? '');
    }
  };
  for (const x of [21, 23, 24, 25, 30]) add(`KILO${x}`, 2);
  add('KILO26', 1); add('KIL026', 5);          // nollan har fler flygningar, O ska vinna ändå
  add('KILO22', 3); add('KIL022', 1);
  add('KIL026', 1, { flight_type: 'sim' });    // simulatorpass: rörs inte
  d.prepare(`INSERT INTO aircraft_registry (aircraft_type, registration) VALUES ('A109','KIL026'), ('A109','KILO26'), ('A109','KIL037'), ('A109','KILO37'), ('A109','KIL034')`).run();
  add('KILO34', 1);                            // KIL034 finns bara i registret, KILO34 är flugen

  const regs = () => Object.fromEntries(d.prepare(`SELECT registration, COUNT(*) n FROM flights WHERE flight_type != 'sim' GROUP BY registration ORDER BY registration`).all().map((r) => [r.registration, r.n]));
  const registry = () => d.prepare(`SELECT registration FROM aircraft_registry ORDER BY registration`).all().map((r) => r.registration);

  const { mergeRegistrationTwinsOnce } = load(path.join(APP, 'db/registrationTwins'));
  const merged = await mergeRegistrationTwinsOnce();
  eq(merged.map((m) => `${m.from}>${m.to}:${m.flights}`).sort(), ['KIL022>KILO22:1', 'KIL026>KILO26:5', 'KIL034>KILO34:0', 'KIL037>KILO37:0'], 'det som slogs ihop');
  eq(regs(), { KILO21: 2, KILO22: 4, KILO23: 2, KILO24: 2, KILO25: 2, KILO26: 6, KILO30: 2, KILO34: 1 }, 'flygningarna efter sammanslagningen');
  eq(registry(), ['KILO26', 'KILO34', 'KILO37'], 'registret efter sammanslagningen: inga nollvarianter kvar');
  eq(d.prepare(`SELECT registration FROM flights WHERE flight_type='sim'`).get().registration, 'KIL026', 'simulatorpasset är orört');
  eq(d.prepare(`SELECT COUNT(*) n FROM audit_log WHERE field_name='registration'`).get().n, 6, 'en rad i audit_log per ändrad flygning');
  eq(d.prepare(`PRAGMA integrity_check`).get().integrity_check, 'ok', 'databasen är hel');

  // Bara en gång: en tvilling som kommer in senare (eget val vid import) lämnas.
  add('KIL021', 1);
  eq(await mergeRegistrationTwinsOnce(), [], 'andra körningen gör ingenting');
  eq(regs().KIL021, 1, 'en senare tvilling är kvar');

  // Ångra (Edit flights → Recent changes) lägger tillbaka de gamla registreringarna.
  const { listBulkEdits, undoBulkEdit } = load(path.join(APP, 'db/bulkEdits'));
  const edits = await listBulkEdits('pilot');
  eq(edits.length, 1, 'ändringen finns bland Recent changes');
  const undone = await undoBulkEdit(edits[0].id);
  eq([undone.restored, undone.kept], [6, 0], 'ångra återställer alla sex');
  eq([regs().KIL026, regs().KILO26, regs().KIL022], [5, 1, 1], 'registreringarna efter ångra');

  console.log(fails ? `\n${fails} fel` : 'Sammanslagningen av registreringar: alla kontroller gick igenom');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
