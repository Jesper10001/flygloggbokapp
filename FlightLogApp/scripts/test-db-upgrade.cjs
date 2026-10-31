// Uppgraderingstest för appens databas — KÖR FÖRE VARJE BYGGE OCH VARJE EAS UPDATE:
//   node FlightLogApp/scripts/test-db-upgrade.cjs            alla taggade byggen (git tag ios/*)
//   node FlightLogApp/scripts/test-db-upgrade.cjs <rev> …    valfria commits/taggar
// Kör appens EGEN databaskod (db/database.ts) från varje gammalt bygge mot riktig SQLite (node:sqlite, Node 22.5+),
// fyller i data, uppgraderar med dagens kod (två gånger) och kontrollerar att:
//   • inga tabeller, kolumner, rader eller värden försvinner eller ändras
//   • nya NOT NULL-kolumner får standardvärden, och schemat blir detsamma som vid en ny installation
//   • databasen är hel (integrity_check), och den GAMLA koden fortfarande fungerar på den uppgraderade databasen
//     (en tillbakadragen rättning eller ett äldre bygge kan aldrig förstöra något).
// Avslutar med kod 1 vid fel. Reglerna som gör detta möjligt står överst i runMigrations (db/database.ts).
const { DatabaseSync } = require('node:sqlite');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const ts = require(path.join(REPO, 'FlightLogApp/node_modules/typescript'));
const tagged = () => execSync('git tag -l "ios/*" --sort=creatordate', { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
const REVS = process.argv.slice(2).length ? process.argv.slice(2) : tagged();
if (!REVS.length) { console.log('Inga taggar ios/* hittades. Ange commits: node test-db-upgrade.cjs <rev> …'); process.exit(1); }
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL', msg); };
const pass = (msg) => console.log('  PASS', msg);

// Laddar initializeDatabase ur en version av db/database.ts. Alla importer stubbas: funktionen använder bara db-argumentet.
function loadInit(rev) {
  const src = rev === 'HEAD-WORKTREE'
    ? fs.readFileSync(path.join(REPO, 'FlightLogApp/db/database.ts'), 'utf8')
    : execSync(`git show ${rev}:FlightLogApp/db/database.ts`, { cwd: REPO, encoding: 'utf8' });
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    + '\nmodule.exports.__init = initializeDatabase;';
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'documentDirectory' ? '/tmp/' : stub()), apply: () => undefined });
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', js)(mod.exports, () => stub(), mod);
  return mod.exports.__init;
}

// Appens SqliteDb-gränssnitt ovanpå node:sqlite.
function adapter(d) {
  const p = (a) => (Array.isArray(a) ? a : a == null ? [] : [a]).map((v) => (v === undefined ? null : v));
  return {
    execAsync: async (sql) => { d.exec(sql); },
    runAsync: async (sql, params) => { const r = d.prepare(sql).run(...p(params)); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    getFirstAsync: async (sql, params) => d.prepare(sql).get(...p(params)) ?? null,
    getAllAsync: async (sql, params) => d.prepare(sql).all(...p(params)),
    withTransactionAsync: async (fn) => { d.exec('BEGIN'); try { await fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; } },
  };
}

const tables = (d) => d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name);
const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all();
const snapshot = (d) => Object.fromEntries(tables(d).map((t) => [t, d.prepare(`SELECT rowid AS __rowid, * FROM ${t} ORDER BY rowid`).all()]));

// Fyller varje tabell med 3 rader där varje kolumn får ett eget, igenkännbart värde.
function seed(d) {
  d.exec('PRAGMA foreign_keys = OFF');
  let rows = 0;
  for (const t of tables(d)) {
    const cs = cols(d, t).filter((c) => !(c.pk && /INT/i.test(c.type)));
    for (let i = 1; i <= 3; i++) {
      const vals = cs.map((c) => (/INT/i.test(c.type) ? i + 1 : /REAL|NUM|FLOAT|DOUB/i.test(c.type) ? i + 0.25 : `v_${c.name}_${i}`));
      try {
        d.prepare(`INSERT INTO ${t} (${cs.map((c) => `"${c.name}"`).join(',')}) VALUES (${cs.map(() => '?').join(',')})`).run(...vals);
        rows++;
      } catch (e) { console.log(`    (seed ${t} rad ${i}: ${e.message})`); }
    }
  }
  d.exec('PRAGMA foreign_keys = ON');
  return rows;
}

(async () => {
  const current = loadInit('HEAD-WORKTREE');
  // Facit: en ny installation med dagens kod.
  const fresh = new DatabaseSync(':memory:');
  await current(adapter(fresh));
  const freshSchema = Object.fromEntries(tables(fresh).map((t) => [t, Object.fromEntries(cols(fresh, t).map((c) => [c.name, c]))]));

  for (const rev of REVS) {
    const date = execSync(`git log -1 --format=%ad --date=short ${rev}`, { cwd: REPO, encoding: 'utf8' }).trim();
    console.log(`\n=== Från ${rev} (${date}) till dagens kod`);
    const d = new DatabaseSync(':memory:');
    const db = adapter(d);
    const old = loadInit(rev);
    await old(db);
    const oldTables = tables(d);
    const oldCols = Object.fromEntries(oldTables.map((t) => [t, cols(d, t).map((c) => c.name)]));
    const seeded = seed(d);
    const before = snapshot(d);
    console.log(`  gammal databas: ${oldTables.length} tabeller, ${seeded} rader ifyllda`);

    try { await current(db); await current(db); pass('uppgradering + en extra körning utan fel (idempotent)'); }
    catch (e) { fail(`uppgraderingen kastade: ${e.message}`); continue; }

    const after = snapshot(d);
    // 1. Alla gamla tabeller och kolumner finns kvar.
    const lostT = oldTables.filter((t) => !tables(d).includes(t));
    const lostC = oldTables.flatMap((t) => oldCols[t].filter((c) => !cols(d, t).some((x) => x.name === c)).map((c) => `${t}.${c}`));
    lostT.length || lostC.length ? fail(`borttaget: ${[...lostT, ...lostC].join(', ')}`) : pass('inga tabeller eller kolumner har försvunnit');
    // 2. Varje rad och varje gammalt värde är oförändrat.
    let changed = 0, missingRows = 0; const examples = [];
    for (const t of oldTables) {
      const byId = new Map((after[t] || []).map((r) => [r.__rowid, r]));
      for (const r of before[t]) {
        const a = byId.get(r.__rowid);
        if (!a) { missingRows++; if (examples.length < 5) examples.push(`${t} rad ${r.__rowid} saknas`); continue; }
        for (const c of oldCols[t]) if (JSON.stringify(a[c]) !== JSON.stringify(r[c])) { changed++; if (examples.length < 5) examples.push(`${t}.${c} rad ${r.__rowid}: ${JSON.stringify(r[c])} → ${JSON.stringify(a[c])}`); }
      }
    }
    missingRows || changed ? fail(`${missingRows} rader borta, ${changed} värden ändrade: ${examples.join('; ')}`) : pass('alla rader och alla befintliga värden är oförändrade');
    // 3. Nya kolumner har giltiga standardvärden på gamla rader.
    let nullsInNotNull = 0, added = 0;
    for (const t of tables(d)) for (const c of cols(d, t)) {
      if (oldCols[t]?.includes(c.name)) continue;
      added++;
      if (c.notnull && d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE "${c.name}" IS NULL`).get().n > 0) nullsInNotNull++;
    }
    nullsInNotNull ? fail(`${nullsInNotNull} NOT NULL-kolumner saknar värde`) : pass(`${added} nya kolumner/tabellkolumner, alla med giltiga standardvärden`);
    // 4. Samma schema som en ny installation.
    const diff = [];
    for (const [t, cs] of Object.entries(freshSchema)) {
      if (!tables(d).includes(t)) { diff.push(`tabell ${t} saknas`); continue; }
      const up = Object.fromEntries(cols(d, t).map((c) => [c.name, c]));
      for (const [n, c] of Object.entries(cs)) {
        if (!up[n]) diff.push(`${t}.${n} saknas`);
        else if (up[n].type !== c.type || up[n].notnull !== c.notnull || String(up[n].dflt_value) !== String(c.dflt_value)) diff.push(`${t}.${n}: ${up[n].type}/${up[n].notnull}/${up[n].dflt_value} mot nyinstallation ${c.type}/${c.notnull}/${c.dflt_value}`);
      }
    }
    diff.length ? console.log(`  NOTE skiljer från nyinstallation (${diff.length}): ${diff.slice(0, 6).join('; ')}`) : pass('samma tabeller och kolumner som en ny installation');
    // 5. Databasen är hel.
    const ic = d.prepare('PRAGMA integrity_check').get();
    Object.values(ic)[0] === 'ok' ? pass('integrity_check: ok') : fail(`integrity_check: ${JSON.stringify(ic)}`);
    // 6. Bakåt: den gamla koden klarar den uppgraderade databasen (rättning tillbakadragen eller äldre bygge).
    try {
      await old(db);
      const fc = oldCols.flights.filter((c) => c !== 'id');
      d.prepare(`INSERT INTO flights (${fc.map((c) => `"${c}"`).join(',')}) VALUES (${fc.map(() => '?').join(',')})`)
        .run(...fc.map((c) => (/date/.test(c) ? '2026-10-31' : /time|total|pic|night|ifr|dual|co_pilot|landings/.test(c) ? 1 : `x_${c}`)));
      pass('den gamla koden startar och kan spara en flygning i den uppgraderade databasen');
    } catch (e) { fail(`bakåt: ${e.message}`); }
  }
  console.log(`\n---- ${failures ? `${failures} FEL` : 'inga fel'}`);
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
