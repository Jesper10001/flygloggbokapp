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

    CREATE TABLE IF NOT EXISTS drone_batteries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drone_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      serial TEXT NOT NULL DEFAULT '',
      cycle_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (drone_id) REFERENCES drone_registry(id) ON DELETE CASCADE
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
      battery_id INTEGER,
      battery_start_cycles INTEGER NOT NULL DEFAULT 0,
      remarks TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (drone_id) REFERENCES drone_registry(id) ON DELETE SET NULL,
      FOREIGN KEY (battery_id) REFERENCES drone_batteries(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_drone_flights_date ON drone_flights(date);
    CREATE INDEX IF NOT EXISTS idx_drone_batteries_drone ON drone_batteries(drone_id);
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

async function addColumnIfMissingOnTable(db: SQLite.SQLiteDatabase, table: string, col: string, definition: string): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
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
  // Flygningstyp: normal | sim | hot_refuel
  await addColumnIfMissing(db, 'flight_type', `TEXT NOT NULL DEFAULT 'normal'`);

  // Tillfälliga landningsplatser — markeras i icao_airports, exkluderas från karta/statistik
  await addColumnIfMissingOnTable(db, 'icao_airports', 'temporary', 'INTEGER NOT NULL DEFAULT 0');
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

  // Mellanlandningsplats (touch & go / hot refuel)
  await addColumnIfMissing(db, 'stop_place', `TEXT NOT NULL DEFAULT ''`);

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
  // Vilken papperbok + uppslag en flygning är transkriberad till (0 = ej skriven)
  await addColumnIfMissing(db, 'book_id',       `INTEGER NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'spread_number', `INTEGER NOT NULL DEFAULT 0`);

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
}
