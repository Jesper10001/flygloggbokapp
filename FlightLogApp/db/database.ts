import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('flightlog.db');
    await initializeDatabase(db);
  }
  return db;
}

async function initializeDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
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

    CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);
    CREATE INDEX IF NOT EXISTS idx_audit_log_flight ON audit_log(flight_id);
    CREATE INDEX IF NOT EXISTS idx_icao ON icao_airports(icao);
  `);

  // Steg 2: Migrationer — lägg till nya kolumner om de saknas
  await runMigrations(db);

  // Steg 3: Index som beror på migrerade kolumner skapas sist
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_flights_status ON flights(status);
  `);
}

async function addColumnIfMissing(db: SQLite.SQLiteDatabase, col: string, definition: string): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE flights ADD COLUMN ${col} ${definition}`);
  } catch {
    // Kolumnen finns redan — ignorera
  }
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'status',       `TEXT NOT NULL DEFAULT 'manual'`);
  await addColumnIfMissing(db, 'source',       `TEXT NOT NULL DEFAULT 'manual'`);
  await addColumnIfMissing(db, 'original_data',`TEXT`);
  await addColumnIfMissing(db, 'flight_rules', `TEXT NOT NULL DEFAULT 'VFR'`);
  await addColumnIfMissing(db, 'second_pilot', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'nvg',          `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'tng_count',    `INTEGER NOT NULL DEFAULT 0`);
}
