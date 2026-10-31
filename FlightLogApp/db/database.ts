import * as FileSystem from 'expo-file-system/legacy';
import * as Application from 'expo-application';
import type { DB } from '@op-engineering/op-sqlite';
import { createManagedDb, dbFileExists, openDbFile, type ManagedDb, type SqliteDb } from './sqlite';
import { getDbKey, getOrCreateDbKey } from '../services/dbKey';
import { reportError } from '../services/crashReporting';

// Loggboken ligger i EN av två filer, och filnamnet ÄR läget → läget går alltid att härleda från disken:
//  - PLAIN_FILE: standard. Ingen extra kryptering — filen skyddas av iOS dataskydd.
//  - ENC_FILE:   extra kryptering påslagen (SQLCipher AES-256, nyckel i Keychain). Samma namn som alla byggen
//                före opt-in använde → befintliga installationer förblir krypterade utan migrering.
// db-mode.json (Documents) pekar ut den levande filen. Den behövs bara om BÅDA filerna finns (en konvertering
// avbröts), och den andra filen raderas bara när markören (läst från disk) bekräftar vilken som gäller.
const ENC_FILE = 'flightlog.db';
const PLAIN_FILE = 'flightlog-plain.db';
type DbFile = typeof ENC_FILE | typeof PLAIN_FILE;
const MODE_MARKER = (FileSystem.documentDirectory ?? '') + 'db-mode.json';

let db: ManagedDb | null = null;
let dbInit: Promise<SqliteDb> | null = null;
let liveFile: DbFile = PLAIN_FILE;
let converting = false;
// Båda filerna fanns men ingen markör → vi gissar inte vilken som är äldst: inget raderas, ingen konvertering.
let ambiguousFiles = false;

const otherFile = (f: DbFile): DbFile => (f === ENC_FILE ? PLAIN_FILE : ENC_FILE);

async function readModeMarker(): Promise<DbFile | null> {
  try {
    if (!(await FileSystem.getInfoAsync(MODE_MARKER)).exists) return null;
    const file = JSON.parse(await FileSystem.readAsStringAsync(MODE_MARKER))?.file;
    return file === ENC_FILE || file === PLAIN_FILE ? file : null;
  } catch {
    return null;
  }
}

async function writeModeMarker(file: DbFile): Promise<void> {
  await FileSystem.writeAsStringAsync(MODE_MARKER, JSON.stringify({ file, updatedAt: new Date().toISOString() }));
}

// Stäng + radera en databas inklusive WAL: journal_mode=DELETE checkpointar och tar bort -wal/-shm (op-sqlites
// delete() tar bara huvudfilen). Går det inte (fel nyckel/korrupt) raderas huvudfilen ändå — en kvarlämnad WAL
// utan huvudfil tar SQLite själv bort nästa gång en tom fil med samma namn öppnas (verifierat).
function dropConnection(conn: DB): void {
  try { conn.executeSync('PRAGMA journal_mode = DELETE'); } catch { /* fel nyckel → bara huvudfilen */ }
  try { conn.delete(); } catch { try { conn.close(); } catch { /* redan stängd */ } }
}

function removeDbFile(name: DbFile, key: string): void {
  if (!dbFileExists(name)) return;
  try { dropConnection(openDbFile(name, key)); } catch { /* kunde inte öppnas → lämna */ }
}

// Vilken fil är loggboken? Markören om dess fil finns; annars den fil som finns (en äldre installation har bara
// ENC_FILE); annars en ny installation → markörens läge, eller standard = ingen extra kryptering.
async function resolveLiveFile(): Promise<{ file: DbFile; marker: DbFile | null; otherExists: boolean }> {
  const marker = await readModeMarker();
  const exists: Record<DbFile, boolean> = { [ENC_FILE]: dbFileExists(ENC_FILE), [PLAIN_FILE]: dbFileExists(PLAIN_FILE) };
  let file: DbFile;
  if (marker && exists[marker]) file = marker;
  else if (exists[ENC_FILE]) file = ENC_FILE;
  else if (exists[PLAIN_FILE]) file = PLAIN_FILE;
  else file = marker ?? PLAIN_FILE;
  return { file, marker, otherExists: exists[otherFile(file)] };
}

// ── Säkerhetskopia före uppgradering ─────────────────────────────────────────────────────────────────────────
// Första gången en ny version av appen startar (nytt bygge ELLER ny EAS-uppdatering — migrationerna ligger i JS)
// kopieras loggboken till en egen fil INNAN migrationerna körs, och kopian verifieras (samma tabeller, samma antal
// rader, integritetskontroll). Kopian ligger bredvid loggboken med samma kryptering och nyckel; de två senaste
// sparas. Går en uppgradering någonsin snett kan loggboken återställas därifrån (en återställning kan skickas
// som EAS-uppdatering). Får aldrig stoppa appstarten: misslyckas kopian körs appen vidare som förut.
const LAST_VERSION_KEY = 'last_code_version';
const BACKUP_PREFIX = 'preupdate-';
const BACKUPS_KEPT = 2;

/** Bygget (version + byggnummer) plus vilken EAS-uppdatering som körs, t.ex. "1.0.1+15/embedded". */
function currentCodeVersion(): string {
  let update = 'embedded';
  try {
    const Updates = require('expo-updates');
    if (Updates?.isEnabled && Updates.updateId && !Updates.isEmbeddedLaunch) update = String(Updates.updateId).slice(0, 8);
  } catch { /* expo-updates saknas (äldre dev-klient) */ }
  return `${Application.nativeApplicationVersion ?? '?'}+${Application.nativeBuildVersion ?? '?'}/${update}`;
}

async function backupBeforeUpgrade(conn: DB, key: string, version: string): Promise<void> {
  // Ny installation (inget schema än) → inget att kopiera.
  const hasSettings = (conn.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").rows ?? []).length > 0;
  if (!hasSettings) return;
  const last = (conn.executeSync('SELECT value AS v FROM settings WHERE key = ?', [LAST_VERSION_KEY]).rows?.[0] as any)?.v ?? null;
  if (last === version) return;

  const dbPath = conn.getDbPath();
  const dir = dbPath.slice(0, dbPath.lastIndexOf('/') + 1);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-'); // 20261031-211500
  const name = `${BACKUP_PREFIX}${stamp}.db`;
  let attached = false;
  try {
    try { conn.executeSync('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* exporten läser genom WAL ändå */ }
    conn.executeSync('ATTACH DATABASE ? AS bak KEY ?', [dir + name, key]); // nyckeln binds som parameter
    attached = true;
    await conn.execute("SELECT sqlcipher_export('bak')"); // tung kopiering på bakgrundstråd → UI:t lever
    const userVersion = Number((conn.executeSync('PRAGMA user_version').rows?.[0] as any)?.user_version ?? 0);
    conn.executeSync(`PRAGMA bak.user_version = ${userVersion}`);
    conn.executeSync('DETACH DATABASE bak');
    attached = false;
    const copy = openDbFile(name, key);
    try { await verifyCopy(conn, copy); } finally { try { copy.close(); } catch { /* ignore */ } }
  } catch (e) {
    if (attached) { try { conn.executeSync('DETACH DATABASE bak'); } catch { /* ignore */ } }
    await FileSystem.deleteAsync('file://' + dir + name, { idempotent: true }).catch(() => {});
    throw e;
  }
  // Behåll de nyaste kopiorna (namnen sorteras i tidsordning).
  const all = (await FileSystem.readDirectoryAsync('file://' + dir).catch(() => [] as string[]))
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) {
    await FileSystem.deleteAsync('file://' + dir + old, { idempotent: true }).catch(() => {});
  }
}

// Delad init-promise: db exponeras FÖRST när schema + migrationer körts klart. Utan detta kan en
// parallell anropare (komponent/store på mount) få en halv-initierad db och köra frågor innan nya
// kolumner lagts till (t.ex. "table icao_airports has no column named gps").
export async function getDatabase(): Promise<SqliteDb> {
  if (db) return db;
  if (!dbInit) {
    dbInit = (async () => {
      const { file, marker, otherExists } = await resolveLiveFile();
      // Krypterad loggbok: nyckeln hämtas transparent ur Keychain (ingen prompt). Saknas den skapas ALDRIG en
      // ny (filen vore då permanent oläsbar) — getDbKey kastar och startsidan visar felet med "Try again".
      const key = file === ENC_FILE ? await getDbKey() : '';
      const conn = openDbFile(file, key);
      const d = createManagedDb(conn);
      const version = currentCodeVersion();
      try {
        await backupBeforeUpgrade(conn, key, version);
      } catch (e) {
        reportError(e, { where: 'backupBeforeUpgrade' }); // aldrig stoppande — appen startar som förut
      }
      try {
        await initializeDatabase(d);
      } catch (e) {
        try { conn.close(); } catch { /* ignore */ }
        throw e;
      }
      try { await d.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [LAST_VERSION_KEY, version]); } catch { /* nästa start försöker igen */ }
      liveFile = file;
      db = d;
      // Markören skrivs först när filen bevisligen gick att öppna. Rester av en avbruten konvertering raderas
      // bara när markören från disk bekräftar att DEN HÄR filen är loggboken.
      if (marker === file) {
        if (otherExists) removeDbFile(otherFile(file), otherFile(file) === ENC_FILE ? await getDbKey().catch(() => '') : '');
      } else if (marker === null && otherExists) {
        ambiguousFiles = true;
        console.warn('[db] both logbook files exist without a mode marker — keeping both');
      } else {
        await writeModeMarker(file).catch(() => {});
      }
      return d;
    })().catch((e) => { dbInit = null; throw e; });
  }
  return dbInit;
}

/** Är extra kryptering (SQLCipher AES-256) påslagen? Giltig när getDatabase() har körts. */
export function isDatabaseEncrypted(): boolean {
  return liveFile === ENC_FILE;
}

/** Pågår en konvertering (på/av)? iCloud-backup väntar då. */
export function isDatabaseConverting(): boolean {
  return converting;
}

export async function getDatabaseEncryption(): Promise<boolean> {
  await getDatabase();
  return isDatabaseEncrypted();
}

// Samma schema, samma antal rader i varje tabell och samma user_version — plus SQLite:s egen snabbkontroll.
async function verifyCopy(src: DB, dst: DB): Promise<void> {
  const one = (d: DB, sql: string): any => d.executeSync(sql).rows?.[0] ?? {};
  const tables = (src.executeSync("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").rows ?? [])
    .map((r: any) => String(r.name));
  for (const t of tables) {
    if (Number(one(src, `SELECT COUNT(*) AS c FROM "${t}"`).c) !== Number(one(dst, `SELECT COUNT(*) AS c FROM "${t}"`).c)) {
      throw new Error(`Copy verification failed (${t}).`);
    }
  }
  const schema = (d: DB) => `${one(d, 'SELECT COUNT(*) AS c FROM sqlite_master').c}/${one(d, 'PRAGMA user_version').user_version}`;
  if (schema(src) !== schema(dst)) throw new Error('Copy verification failed (schema).');
  const qc = (await dst.execute('PRAGMA quick_check')).rows?.[0] as any;
  if (qc?.quick_check !== 'ok') throw new Error('Copy verification failed (integrity).');
}

/** Slå på/av extra kryptering. Loggboken kopieras till den andra filen (krypterad resp. okrypterad), kopian
 *  verifieras i en separat anslutning och tas i bruk — först därefter raderas originalet. Fel eller avbrott
 *  före bytet → originalet gäller fortfarande och kopian tas bort. Inga andra frågor körs under bytet. */
export async function setDatabaseEncryption(on: boolean): Promise<void> {
  await getDatabase();
  const managed = db!;
  if (isDatabaseEncrypted() === on) return;
  if (converting) throw new Error('The logbook is already being converted.');
  if (ambiguousFiles) throw new Error('Two logbook files were found on this device, so encryption was left unchanged.');
  converting = true;
  const release = await managed.pause();
  const src = managed.raw();
  const dstFile: DbFile = on ? ENC_FILE : PLAIN_FILE;
  let dstKey = '';
  let dst: DB | null = null;
  let attached = false;
  let committed = false;
  try {
    // Slå på: befintlig nyckel (lokal → iCloud Keychain) eller en ny. Pushas till iCloud Keychain vid nästa backup.
    dstKey = on ? await getOrCreateDbKey() : '';
    removeDbFile(dstFile, dstKey); // rester av ett tidigare avbrutet försök → målfilen ska inte finnas
    const srcPath = src.getDbPath();
    const dstPath = srcPath.slice(0, srcPath.lastIndexOf('/') + 1) + dstFile;
    try { src.executeSync('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* bara städning — exporten läser genom WAL */ }
    // Nyckeln binds som parameter (hamnar aldrig i SQL-texten). Tom nyckel = okrypterad målfil.
    src.executeSync('ATTACH DATABASE ? AS conv KEY ?', [dstPath, dstKey]);
    attached = true;
    await src.execute("SELECT sqlcipher_export('conv')"); // tung kopiering på bakgrundstråd → UI:t lever
    const userVersion = Number((src.executeSync('PRAGMA user_version').rows?.[0] as any)?.user_version ?? 0);
    src.executeSync(`PRAGMA conv.user_version = ${userVersion}`); // sqlcipher_export kopierar inte user_version
    src.executeSync('DETACH DATABASE conv');
    attached = false;

    // Separat anslutning i normalt läge (inte failOnCreate — då kan den inte ATTACH:a nya filer senare).
    dst = openDbFile(dstFile, dstKey);
    await verifyCopy(src, dst);
    dst.executeSync('PRAGMA journal_mode = WAL');
    dst.executeSync('PRAGMA foreign_keys = ON');

    await writeModeMarker(dstFile); // commit-punkt: från och med nu är målfilen loggboken
    managed.swap(dst);
    liveFile = dstFile;
    dst = null;
    committed = true;
  } catch (e) {
    if (attached) { try { src.executeSync('DETACH DATABASE conv'); } catch { /* ignore */ } }
    if (dst) dropConnection(dst);
    else removeDbFile(dstFile, dstKey);
    throw e;
  } finally {
    // Originalet raderas sist. Misslyckas det tas det bort vid nästa start (markören pekar på den nya filen).
    if (committed) dropConnection(src);
    release();
    converting = false;
  }
}

async function initializeDatabase(db: SqliteDb): Promise<void> {
  await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`);

  // Steg 1: Skapa grundtabeller (utan de nya kolumnerna — de läggs till i migrationen)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      aircraft_type TEXT NOT NULL,
      registration TEXT NOT NULL,
      dep_place TEXT NOT NULL,
      dep_utc TEXT NOT NULL,
      arr_place TEXT NOT NULL,
      arr_utc TEXT NOT NULL,
      total_time REAL NOT NULL DEFAULT 0,
      ifr REAL NOT NULL DEFAULT 0,
      night REAL NOT NULL DEFAULT 0,
      pic REAL NOT NULL DEFAULT 0,
      co_pilot REAL NOT NULL DEFAULT 0,
      dual REAL NOT NULL DEFAULT 0,
      landings_day INTEGER NOT NULL DEFAULT 0,
      landings_night INTEGER NOT NULL DEFAULT 0,
      remarks TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_id INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS icao_airports (
      icao TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT NOT NULL,
      region TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      custom INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorite_airports (
      icao TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scan_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_name TEXT NOT NULL DEFAULT '',
      page_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_this_page TEXT NOT NULL DEFAULT '{}',
      brought_forward TEXT NOT NULL DEFAULT '{}',
      total_to_date TEXT NOT NULL DEFAULT '{}',
      row_count INTEGER NOT NULL DEFAULT 0,
      flight_count_at_save INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);
    CREATE INDEX IF NOT EXISTS idx_audit_log_flight ON audit_log(flight_id);
    CREATE INDEX IF NOT EXISTS idx_icao ON icao_airports(icao);

    CREATE TABLE IF NOT EXISTS drone_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drone_type TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      registration TEXT NOT NULL DEFAULT '',
      mtow_g INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(drone_type, registration)
    );

    CREATE TABLE IF NOT EXISTS drone_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cert_type TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      issued_date TEXT NOT NULL DEFAULT '',
      expires_date TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS drone_flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      drone_id INTEGER,
      drone_type TEXT NOT NULL DEFAULT '',
      registration TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      lat REAL NOT NULL DEFAULT 0,
      lon REAL NOT NULL DEFAULT 0,
      mission_type TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      flight_mode TEXT NOT NULL DEFAULT 'VLOS',
      total_time REAL NOT NULL DEFAULT 0,
      max_altitude_m INTEGER NOT NULL DEFAULT 0,
      is_night INTEGER NOT NULL DEFAULT 0,
      has_observer INTEGER NOT NULL DEFAULT 0,
      observer_name TEXT NOT NULL DEFAULT '',
      remarks TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (drone_id) REFERENCES drone_registry(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_drone_flights_date ON drone_flights(date);
  `);

  // Steg 2: Migrationer — lägg till nya kolumner om de saknas
  await runMigrations(db);

  // Steg 3: Index som beror på migrerade kolumner skapas sist
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_flights_status ON flights(status);
  `);
}

async function addColumnIfMissing(db: SqliteDb, col: string, definition: string): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE flights ADD COLUMN ${col} ${definition}`);
  } catch {
    // Kolumnen finns redan — ignorera
  }
}

async function addColumnIfMissingOnTable(db: SqliteDb, table: string, col: string, definition: string): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
  } catch {
    // Kolumnen finns redan — ignorera
  }
}

// REGLER för migrationer — testas av scripts/test-db-upgrade.cjs mot alla taggade byggen före varje bygge:
//  1. Bara lägga till: CREATE TABLE IF NOT EXISTS och ADD COLUMN med DEFAULT. Aldrig DROP, RENAME eller ändrad
//     betydelse för en befintlig kolumn → både äldre och nyare appversioner kan läsa samma databas.
//  2. Allt här körs vid VARJE start och måste tåla det (idempotent). En användare som hoppar över flera versioner
//     får då allt som saknas på en gång.
//  3. Engångsändringar av data skyddas med en flagga i settings och rör bara det felet gäller.
// Före migrationerna tas en verifierad säkerhetskopia när versionen ändrats (backupBeforeUpgrade ovan).
async function runMigrations(db: SqliteDb): Promise<void> {
  await addColumnIfMissing(db, 'status',       `TEXT NOT NULL DEFAULT 'manual'`);
  await addColumnIfMissing(db, 'source',       `TEXT NOT NULL DEFAULT 'manual'`);
  await addColumnIfMissing(db, 'original_data',`TEXT`);
  await addColumnIfMissing(db, 'flight_rules', `TEXT NOT NULL DEFAULT 'VFR'`);
  await addColumnIfMissing(db, 'second_pilot', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'second_pilot_role', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'extra_pilots', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'nvg',          `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'tng_count',    `INTEGER NOT NULL DEFAULT 0`);
  // Rå inskriven dep/arr-kod (IATA/GPS/ICAO/okänt) — det som visas i loggbok/export. NULL = använd dep_place.
  await addColumnIfMissing(db, 'dep_place_raw', `TEXT`);
  await addColumnIfMissing(db, 'arr_place_raw', `TEXT`);

  // Luftfartygsregister — sparar kända typer och individer oberoende av loggade flygningar
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS aircraft_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aircraft_type TEXT NOT NULL,
      registration TEXT NOT NULL DEFAULT '',
      UNIQUE(aircraft_type, registration)
    );
    CREATE INDEX IF NOT EXISTS idx_aircraft_registry_type ON aircraft_registry(aircraft_type);
  `);

  // Marschfart i knop per fartygstyp (för avståndsskattning av lokala pass)
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'cruise_speed_kts', 'INTEGER NOT NULL DEFAULT 0');
  // Uthållighet i timmar per fartygstyp (används för att filtrera bort sim-pass från statistik)
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'endurance_h', 'REAL NOT NULL DEFAULT 0');
  // Besättningstyp: '' = okänd | 'sp' = single-pilot | 'mp' = multi-pilot (båda) | 'sp_only' = enbart SP | 'mp_only' = enbart MP
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'crew_type', "TEXT NOT NULL DEFAULT ''");
  // Farkosttyp: '' = okänd | 'airplane' = flygplan | 'helicopter' = helikopter
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'category', "TEXT NOT NULL DEFAULT ''");
  // Motortyp: '' = okänd | 'se' = single engine | 'me' = multi engine
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'engine_type', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'image_url', "TEXT NOT NULL DEFAULT ''");
  // Fotokredit för Wikimedia-bilden (JSON {text,url}, utils/photoCredit); '' = egen bild / ingen kredit.
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'image_credit', "TEXT NOT NULL DEFAULT ''");
  // Fleet-vy (pilot-manned): tillverkare, VNE, MTOW och typ-rating per modell.
  // Modell-nivå men lagras per (type, registration)-rad → läs med MAX(), skriv med WHERE aircraft_type=?.
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'maker', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'vne', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'vne_unit', "TEXT NOT NULL DEFAULT 'kt'");
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'mtow', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'mtow_unit', "TEXT NOT NULL DEFAULT 'kg'");
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'rating_expiry', "TEXT NOT NULL DEFAULT ''"); // ISO YYYY-MM-DD
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'rating_class', "TEXT NOT NULL DEFAULT ''");
  // Fleet-vy del 2: bränsleförbrukning (+enhet), effekt, tjänstetak, spännvidd/rotordiameter.
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'fuel_burn', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'fuel_burn_unit', "TEXT NOT NULL DEFAULT 'l/h'");
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'power_hp', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'ceiling_ft', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'wingspan_m', 'REAL NOT NULL DEFAULT 0');
  // Fleet-vy del 3 (Ledger-kort): tomvikt, bränslekapacitet, räckvidd + cachad urklippsbild.
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'empty_weight_kg', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'fuel_capacity_l', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'range_nm', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'cutout_url', "TEXT NOT NULL DEFAULT ''");
  // Flygningstyp: normal | sim | hot_refuel
  await addColumnIfMissing(db, 'flight_type', `TEXT NOT NULL DEFAULT 'normal'`);

  // Off-airport-platser (ZZZZ) — markeras i icao_airports, exkluderas från karta/statistik
  await addColumnIfMissingOnTable(db, 'icao_airports', 'temporary', 'INTEGER NOT NULL DEFAULT 0');
  // Berikad flygplatsdata (airportmap.de): IATA, elevation, kategori, ort
  await addColumnIfMissingOnTable(db, 'icao_airports', 'iata', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissingOnTable(db, 'icao_airports', 'alt', 'INTEGER');
  await addColumnIfMissingOnTable(db, 'icao_airports', 'type', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissingOnTable(db, 'icao_airports', 'municipality', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissingOnTable(db, 'icao_airports', 'gps', `TEXT NOT NULL DEFAULT ''`);
  // Diakrit-normaliserat namn (versaler, å/ä/ö/ü etc. → a/o/u) → sökning matchar "lulea"↔"Luleå",
  // "buckeburg"↔"Bückeburg". Fylls vid seed; tomt tills om-seeden körts.
  await addColumnIfMissingOnTable(db, 'icao_airports', 'name_norm', `TEXT NOT NULL DEFAULT ''`);
  // Flerpilottid (multi-crew operations)
  await addColumnIfMissing(db, 'multi_pilot',  `REAL NOT NULL DEFAULT 0`);
  // Enpilottid (single pilot operations)
  await addColumnIfMissing(db, 'single_pilot', `REAL NOT NULL DEFAULT 0`);
  // Instruktörstid (given dual instruction)
  await addColumnIfMissing(db, 'instructor',   `REAL NOT NULL DEFAULT 0`);
  // PICUS (Pilot-in-Command Under Supervision)
  await addColumnIfMissing(db, 'picus',        `REAL NOT NULL DEFAULT 0`);
  // Avancerade rolltyper
  await addColumnIfMissing(db, 'spic',          `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'examiner',      `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'safety_pilot',  `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'observer',      `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'ferry_pic',     `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'relief_crew',   `REAL NOT NULL DEFAULT 0`);
  // Sim-kategori: FFS | FTD | FNPT_II | FNPT_I | BITD (endast när flight_type='sim')
  await addColumnIfMissing(db, 'sim_category',  `TEXT NOT NULL DEFAULT ''`);
  // VFR-tid (kompletterar IFR-tid, summerar till total_time)
  await addColumnIfMissing(db, 'vfr',           `REAL NOT NULL DEFAULT 0`);
  // Motortyp per pass: 0 om okänd/ej tillämplig
  await addColumnIfMissing(db, 'se_time', `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'me_time', `REAL NOT NULL DEFAULT 0`);

  // FAA-specifika förstklassiga fält (hybrid — övriga FAA-fält tas via custom-kolumner)
  await addColumnIfMissing(db, 'solo',          `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'cross_country', `REAL NOT NULL DEFAULT 0`);

  // Mellanlandningsplats (touch & go / hot refuel)
  await addColumnIfMissing(db, 'stop_place', `TEXT NOT NULL DEFAULT ''`);

  // Operator-specific data (JSON) for non-pilot crew logbooks
  await addColumnIfMissing(db, 'operator_data', `TEXT NOT NULL DEFAULT ''`);

  // Foto kopplat till flygpass
  await addColumnIfMissing(db, 'photo_uri', `TEXT NOT NULL DEFAULT ''`);
  // Mediatyp: 'image' eller 'video' (default 'image' för bakåtkompatibilitet)
  await addColumnIfMissing(db, 'media_type', `TEXT NOT NULL DEFAULT 'image'`);
  // Foto-synk: referens (localIdentifier) till bild/video i fotobiblioteket. Filen kopieras aldrig.
  await addColumnIfMissing(db, 'photo_local_id', `TEXT`);
  // iCloud-backup: stabilt iCloud-foton-id (PHCloudIdentifier) → foton kan återlänkas på ny enhet.
  await addColumnIfMissing(db, 'photo_cloud_id', `TEXT`);
  // Max flight level (IFR/Y/Z flights)
  await addColumnIfMissing(db, 'max_fl', `INTEGER NOT NULL DEFAULT 0`);
  // Log Flight-redesign: start (dag/natt) + 2D/3D-inflygningar (utöver landningar/remarks).
  await addColumnIfMissing(db, 'takeoffs_day', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'takeoffs_night', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'app_2d', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'app_3d', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'pilot_flying', `REAL NOT NULL DEFAULT 0`);
  // Currency/recency (BLADES): full-stop-landningar + FAA-nattfönster (solnedgång+1h→soluppgång−1h)
  // dubbelklassade vid save; holds för FAA 6HITS. Historik = 0 tills backfill/redigering.
  await addColumnIfMissing(db, 'landings_fs_day', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'landings_fs_night', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'takeoffs_faa_night', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'landings_faa_night', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'landings_fs_faa_night', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'holds', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissingOnTable(db, 'aircraft_registry', 'is_tailwheel', 'INTEGER NOT NULL DEFAULT 0');

  // Drönar-flygningar: klockslag (för natt-auto), separat landningspunkt (BVLOS/korridor)
  await addColumnIfMissingOnTable(db, 'drone_flights', 'takeoff_time', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_flights', 'landing_location', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_flights', 'landing_lat', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'landing_lon', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'wind_ms', 'REAL NOT NULL DEFAULT 0');
  // Officiell drönar-loggbok (Transportstyrelsen): pilot-funktion, landningar, IFR, PRI/COM
  await addColumnIfMissingOnTable(db, 'drone_flights', 'co_pilot_fpv', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'dual', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'instructor', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'ifr', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'landings_day', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'landings_night', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'operation_type', "TEXT NOT NULL DEFAULT ''"); // PRI | COM
  // Kondition-tid (timmar) + flygregler — VFR/IFR-barer + natt-bar i Log Flight (Full).
  await addColumnIfMissingOnTable(db, 'drone_flights', 'night_time', 'REAL NOT NULL DEFAULT 0'); // nattandel i timmar
  await addColumnIfMissingOnTable(db, 'drone_flights', 'vfr', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'flight_rules', "TEXT NOT NULL DEFAULT 'VFR'");
  // Foto/video per drönarflygning (valt ur biblioteket), = manned flight photo.
  await addColumnIfMissingOnTable(db, 'drone_flights', 'photo_uri', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_flights', 'media_type', "TEXT NOT NULL DEFAULT 'image'");
  // Foto-synk: referens (localIdentifier) till bibliotekets media, matchat på tid (= manned).
  await addColumnIfMissingOnTable(db, 'drone_flights', 'photo_local_id', 'TEXT');
  // iCloud-backup: stabilt iCloud-foton-id (PHCloudIdentifier) → foton kan återlänkas på ny enhet.
  await addColumnIfMissingOnTable(db, 'drone_flights', 'photo_cloud_id', 'TEXT');
  // Källa för raden: 'manual' (loggat i appen) | 'import' (CSV) | 'summary' (bulk-historik) — driver
  // Imported data-batcher och backfill (= manned flights.source). Befintliga rader = manuella.
  await addColumnIfMissingOnTable(db, 'drone_flights', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  // Bulk-historik/summary-rader kan bära ÖVERLAPPANDE nedbrytnings-timmar per operation och kategori
  // (som pilotens pic/night/ifr-kolumner) — så en enda rad kan ange tid per VLOS/EVLOS/BVLOS OCH per
  // A1..Certified utan att dubbelräkna totalen. Vanliga flygningar lämnar dessa 0 och använder etiketterna
  // category/flight_mode. getDroneStats adderar h_*-summorna ovanpå etikett-summorna.
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_vlos', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_evlos', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_bvlos', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_a1', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_a2', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_a3', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_specific', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_certified', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_flights', 'h_night', 'REAL NOT NULL DEFAULT 0');
  // Drönar-besättning (= pilotens second pilot): egen roll inkl. "Other"-rollerna (constants/droneRoles.ts;
  // tom = härleds ur tidshinkarna) + medpilot med roll + fler medpiloter som JSON [{ role, name }].
  await addColumnIfMissingOnTable(db, 'drone_flights', 'pilot_role', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_flights', 'second_pilot', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_flights', 'second_pilot_role', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_flights', 'extra_pilots', "TEXT NOT NULL DEFAULT ''");
  // Drönar-register: klass (militär/civil), anges själv i drönar-modalen.
  await addColumnIfMissingOnTable(db, 'drone_registry', 'drone_class', "TEXT NOT NULL DEFAULT ''"); // military | civil
  // Fleet-foto per drönare (valt ur bibliotek) + VisionKit-urklipp (pop-out), = manned Fleet.
  await addColumnIfMissingOnTable(db, 'drone_registry', 'image_url', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_registry', 'cutout_url', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_registry', 'image_credit', "TEXT NOT NULL DEFAULT ''"); // = aircraft_registry
  // Fleet-specar (hämtas via AI-uppslag): tillverkare, C-klass (C0–C6), max flygtid (min),
  // max hastighet (km/h), tjänstetak (m), länkräckvidd (km). Lagras per rad, grupperas per modell.
  await addColumnIfMissingOnTable(db, 'drone_registry', 'manufacturer', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_registry', 'c_class', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_registry', 'max_flight_min', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_registry', 'max_speed_kmh', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_registry', 'ceiling_m', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissingOnTable(db, 'drone_registry', 'range_km', 'REAL NOT NULL DEFAULT 0');

  // Papperloggböcker — referens för transkribering av digitala flygningar till papper
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS logbook_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template_id TEXT NOT NULL DEFAULT 'sv-easa-standard',
      starting_page INTEGER NOT NULL DEFAULT 1,
      rows_per_spread INTEGER NOT NULL DEFAULT 12,
      transcribed_spreads INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Sista sida/rad i boken — när vi nått dit är boken full
  await addColumnIfMissingOnTable(db, 'logbook_books', 'end_page', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'end_row', `INTEGER NOT NULL DEFAULT 0`);

  // Digitala loggböcker (flera böcker) — återanvänder logbook_books-tabellen.
  // kind='paper' = gamla transkriberingsböcker, kind='digital' = nya digitala böcker.
  // Default 'paper' gör att alla BEFINTLIGA rader (samt legacy addBook) automatiskt
  // räknas som papper; createDigitalBook sätter kind='digital' explicit.
  await addColumnIfMissingOnTable(db, 'logbook_books', 'kind', `TEXT NOT NULL DEFAULT 'paper'`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'opening_balance', `TEXT NOT NULL DEFAULT '{}'`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'custom_cols', `TEXT NOT NULL DEFAULT '{}'`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'anchor_flight_id', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'anchor_page', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'anchor_row', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'display_order', `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissingOnTable(db, 'logbook_books', 'acked_spread', `INTEGER NOT NULL DEFAULT 0`);

  // Vilken papperbok + uppslag en flygning är transkriberad till (0 = ej skriven)
  await addColumnIfMissing(db, 'book_id',       `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'spread_number', `INTEGER NOT NULL DEFAULT 0`);

  // Användarskapade loggboksmallar — custom-böcker som matchar valfri fysisk
  // loggbok (t.ex. FAA eller en udda layout). json = serialiserad LogbookTemplate.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS custom_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // AI-inlärning: sparar bekräftade mappningar så nästa skanning blir bättre
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ocr_learned (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      resolved_value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, raw_text)
    );
  `);

  // scan_summaries: ersätt enkelt name-fält med book_name + page_name
  await addColumnIfMissingOnTable(db, 'scan_summaries', 'book_name', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissingOnTable(db, 'scan_summaries', 'page_name', `TEXT NOT NULL DEFAULT ''`);
  // Kopiera gamla name-värdet till book_name om book_name är tomt (engångsmigration)
  try {
    await db.execAsync(`UPDATE scan_summaries SET book_name = name WHERE book_name = '' AND name IS NOT NULL AND name != ''`);
  } catch {
    // name-kolumnen kanske inte finns — ignorera
  }

  // BUGGFIX (kritisk): en tidigare migration seedade "Experience summary"-flygningar som fyllde ut totalen
  // till 1000h i RIKTIGA loggböcker (den kördes för alla med befintliga flygningar som saknade flaggan,
  // inte bara dev-profiler). Seedningen är helt borttagen. Nedan städas ev. redan inlagda sådana rader bort
  // EN gång så drabbade loggböcker läks, och seed-flaggorna nollställs så inget kan återuppliva den.
  try {
    const purged = await db.getFirstAsync<{ v: string }>(`SELECT value as v FROM settings WHERE key='exp_summary_purged'`).catch(() => null);
    if (!purged) {
      await db.runAsync(`DELETE FROM flights WHERE remarks = 'Experience summary'`);
      await db.runAsync(`DELETE FROM settings WHERE key IN ('test_atpl_seeded','test_atpl_seeded_v2','test_atpl_seeded_v3')`);
      await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES ('exp_summary_purged', '1')`);
    }
  } catch {
    // om städningen fallerar (t.ex. schema saknas) — ignorera; den försöker igen nästa start
  }

  // Engångsstädning: en tidigare import-bugg dumpade appens egna export-kolumner ("Flight type: Normal",
  // "Sim category: …") i remarks vid om-import. Ta bort exakt de segmenten (' | '-separerade) ur
  // befintliga flygningars remarks. Guardad med settings-flagga → körs bara en gång.
  try {
    const cleaned = await db.getFirstAsync<{ v: string }>(`SELECT value as v FROM settings WHERE key = 'remarks_meta_cleaned'`).catch(() => null);
    if (!cleaned) {
      const rows = await db.getAllAsync<{ id: number; remarks: string }>(
        `SELECT id, remarks FROM flights WHERE remarks LIKE '%Flight type:%' OR remarks LIKE '%Sim category:%'`
      ).catch(() => [] as { id: number; remarks: string }[]);
      for (const r of rows) {
        const next = (r.remarks || '')
          .split(' | ')
          .filter((seg) => !/^\s*Flight type:\s*(Normal|Hot refuel|FFS\/Sim|Sim)\s*$/i.test(seg) && !/^\s*Sim category:/i.test(seg))
          .join(' | ')
          .trim();
        if (next !== (r.remarks || '')) await db.runAsync(`UPDATE flights SET remarks = ? WHERE id = ?`, [next, r.id]);
      }
      await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES ('remarks_meta_cleaned', '1')`);
    }
  } catch { /* städning får aldrig blockera appstart */ }
}
