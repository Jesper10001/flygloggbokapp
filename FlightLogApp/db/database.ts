import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
let dbInit: Promise<SQLite.SQLiteDatabase> | null = null;

// Delad init-promise: db exponeras FÖRST när schema + migrationer körts klart. Utan detta kan en
// parallell anropare (komponent/store på mount) få en halv-initierad db och köra frågor innan nya
// kolumner lagts till (t.ex. "table icao_airports has no column named gps").
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbInit) {
    dbInit = (async () => {
      const d = await SQLite.openDatabaseAsync('flightlog.db');
      await initializeDatabase(d);
      db = d;
      return d;
    })().catch((e) => { dbInit = null; throw e; });
  }
  return dbInit;
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
  // Drönar-register: klass (militär/civil), anges själv i drönar-modalen.
  await addColumnIfMissingOnTable(db, 'drone_registry', 'drone_class', "TEXT NOT NULL DEFAULT ''"); // military | civil
  // Fleet-foto per drönare (valt ur bibliotek) + VisionKit-urklipp (pop-out), = manned Fleet.
  await addColumnIfMissingOnTable(db, 'drone_registry', 'image_url', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissingOnTable(db, 'drone_registry', 'cutout_url', "TEXT NOT NULL DEFAULT ''");
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

  // Test data: seed summary flights to meet ALL EASA requirements (PPL/CPL/ATPL H)
  const seeded = await db.getFirstAsync<{ v: string }>(`SELECT value as v FROM settings WHERE key='test_atpl_seeded_v3'`).catch(() => null);
  if (!seeded) {
    // Remove old seed data
    await db.runAsync(`DELETE FROM flights WHERE remarks = 'Experience summary'`);
    await db.runAsync(`DELETE FROM settings WHERE key IN ('test_atpl_seeded','test_atpl_seeded_v2')`);

    const existing = await db.getFirstAsync<{ t: number }>(`SELECT ROUND(SUM(total_time),1) as t FROM flights WHERE flight_type != 'sim'`);
    const currentTotal = existing?.t ?? 0;
    if (currentTotal > 0) {
      // ATPL(H) needs: total 1000, pic 250, xc 200, ifr 30, night 100
      // CPL(H) also needs: dual 30, xc_pic 10
      // We spread flights across many different dep/arr pairs with total_time >= 0.5 for xc credit
      const routes = [
        ['ESCF','ESSA'], ['ESSA','ESGG'], ['ESGG','ESCF'], ['ESCF','ESSV'],
        ['ESSV','ESSA'], ['ESSA','ESMX'], ['ESMX','ESGG'], ['ESGG','ESSV'],
      ];
      const totalNeeded = Math.max(0, 1000 - currentTotal);
      const flightsToAdd = 20;
      const perFlight = totalNeeded / flightsToAdd;

      for (let i = 0; i < flightsToAdd; i++) {
        const [dep, arr] = routes[i % routes.length];
        const month = String((i % 12) + 1).padStart(2, '0');
        const year = i < 10 ? '2024' : '2025';
        const day = String(5 + (i % 20)).padStart(2, '0');
        const date = `${year}-${month}-${day}`;
        const total = perFlight;
        const pic = perFlight * 0.85;
        const dual = i < 4 ? perFlight * 0.5 : 0; // first 4 flights have dual
        const night = perFlight * 0.35;
        const ifr = perFlight * 0.15;
        const multi = perFlight * 0.6;
        const single = total - multi;

        await db.runAsync(
          `INSERT INTO flights (date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc, total_time, pic, co_pilot, dual, night, ifr, multi_pilot, single_pilot, landings_day, landings_night, remarks, status, source, flight_type, flight_rules)
           VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,1,0,'Experience summary','manual','manual','normal','IFR')`,
          [date, 'A109LUH', 'KILO28', dep, '08:00', arr, '12:00', total, pic, dual, night, ifr, multi, single]
        );
      }
      await db.runAsync(`INSERT OR REPLACE INTO settings (key, value) VALUES ('test_atpl_seeded_v3', '1')`);
    }
  }
}
