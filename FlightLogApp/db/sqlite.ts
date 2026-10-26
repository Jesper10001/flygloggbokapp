// SQLite-adapter: öppnar op-sqlite och exponerar EXAKT den expo-sqlite-kompatibla ytan som resten av
// koden använder (getAllAsync/getFirstAsync/runAsync/execAsync/withTransactionAsync). Därför behöver
// inget i db/*.ts eller services/ ändras — bara db/database.ts öppnar via denna.
// Loggboken är okrypterad som standard (skyddas av iOS dataskydd). Med extra kryptering påslagen öppnas
// den med en AES-256-nyckel via SQLCipher → kräver op-sqlite byggd med SQLCipher
// (package.json: "op-sqlite": { "sqlcipher": true }).
import { open, isSQLCipher, type DB } from '@op-engineering/op-sqlite';

export interface SqliteDb {
  getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
  runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
  execAsync(sql: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

// En SqliteDb vars underliggande anslutning kan bytas ut medan appen kör (när användaren slår på/av extra
// kryptering byts databasfilen). Resten av appen behåller samma objekt → inga referenser till en stängd anslutning.
export interface ManagedDb extends SqliteDb {
  /** Aktuell op-sqlite-anslutning (bara för konverteringen i db/database.ts). */
  raw(): DB;
  /** Byt anslutning. Returnerar den gamla — anroparen stänger/raderar den. */
  swap(next: DB): DB;
  /** Spärra nya frågor tills den returnerade funktionen anropas. Väntar först ut pågående transaktioner. */
  pause(): Promise<() => void>;
}

/** Öppna (eller skapa) en databasfil i op-sqlites standardmapp. Tom nyckel = okrypterad. */
export function openDbFile(name: string, encryptionKey = ''): DB {
  return encryptionKey ? open({ name, encryptionKey }) : open({ name });
}

/** Finns databasfilen? Öppnar utan att skapa och stänger direkt. Inga läsningar sker → en krypterad fil
 *  (och dess WAL) rörs inte trots att ingen nyckel anges (verifierat mot SQLCipher). */
export function dbFileExists(name: string): boolean {
  try {
    open({ name, failOnCreate: true }).close();
    return true;
  } catch {
    return false;
  }
}

// executeSync = synkron JSI (mycket snabb, inga trådhopp) → matchar expo-sqlites async-yta via Promise.
// Utan aktiv paus körs frågan direkt i anropet, precis som förut (ingen extra await).
export function createManagedDb(initial: DB): ManagedDb {
  let conn = initial;
  let gate: Promise<void> | null = null;
  let activeTx = 0;
  const waitGate = async () => { while (gate) await gate; };

  return {
    async getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]> {
      if (gate) await waitGate();
      return (conn.executeSync(sql, params ?? []).rows ?? []) as T[];
    },
    async getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null> {
      if (gate) await waitGate();
      const rows = conn.executeSync(sql, params ?? []).rows ?? [];
      return (rows.length ? rows[0] : null) as T | null;
    },
    async runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }> {
      if (gate) await waitGate();
      const res = conn.executeSync(sql, params ?? []);
      return { changes: res.rowsAffected ?? 0, lastInsertRowId: res.insertId ?? 0 };
    },
    async execAsync(sql: string): Promise<void> {
      if (gate) await waitGate();
      // Kör flera satser (PRAGMA + schema). Inga triggers finns → säkert att dela på ';'.
      for (const part of sql.split(';')) {
        const stmt = part.trim();
        if (stmt) conn.executeSync(stmt);
      }
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      if (gate) await waitGate();
      activeTx++;
      try {
        conn.executeSync('BEGIN');
        try {
          await task();
          conn.executeSync('COMMIT');
        } catch (e) {
          try { conn.executeSync('ROLLBACK'); } catch { /* redan avbruten */ }
          throw e;
        }
      } finally {
        activeTx--;
      }
    },
    raw: () => conn,
    swap(next: DB): DB {
      const prev = conn;
      conn = next;
      return prev;
    },
    async pause(): Promise<() => void> {
      // En transaktion kör frågor inuti sig → låt den bli klar först. Kontrollen och stängningen av
      // grinden sker i samma synkrona steg, så ingen ny transaktion hinner börja emellan.
      while (gate || activeTx > 0) await (gate ?? new Promise((r) => setTimeout(r, 20)));
      let release!: () => void;
      gate = new Promise<void>((r) => { release = r; });
      return () => { gate = null; release(); };
    },
  };
}

// DEV-ONLY självtest: bekräftar (1) att op-sqlite är byggt med SQLCipher, (2) att en krypterad temp-DB
// bara går att läsa med RÄTT nyckel och (3) avvisar FEL nyckel. Loggar PASS/FAIL i konsolen. Rör aldrig
// den riktiga databasen (egen temp-fil som raderas efteråt). Anropas bakom __DEV__ i app/_layout.tsx.
export function runEncryptionSelfTest(): void {
  const NAME = 'crypto_selftest.db';
  const realKey = 'selftest-real-key';
  try {
    const cipher = isSQLCipher();
    console.log(`[crypto] SQLCipher build: ${cipher ? 'ACTIVE ✅' : 'NOT ACTIVE ❌'}`);

    // 1) Skapa krypterad temp-DB + skriv en hemlighet.
    const a = open({ name: NAME, encryptionKey: realKey });
    a.executeSync('CREATE TABLE IF NOT EXISTS t (x TEXT)');
    a.executeSync('DELETE FROM t');
    a.executeSync("INSERT INTO t (x) VALUES ('secret')");
    a.close();

    // 2) Positiv kontroll: RÄTT nyckel kan läsa värdet.
    let realCanRead = false;
    try {
      const b = open({ name: NAME, encryptionKey: realKey });
      const r = b.executeSync('SELECT x FROM t');
      realCanRead = (r.rows?.[0] as any)?.x === 'secret';
      b.close();
    } catch { /* läsning misslyckades */ }

    // 3) Negativ kontroll: FEL nyckel ska INTE kunna läsa (krypterad → "file is not a database").
    let wrongRejected = false;
    try {
      const c = open({ name: NAME, encryptionKey: 'totally-wrong-key' });
      c.executeSync('SELECT x FROM t');
      c.close();
    } catch {
      wrongRejected = true;
    }

    console.log(`[crypto] real key reads: ${realCanRead ? 'YES ✅' : 'NO ❌'} · wrong key rejected: ${wrongRejected ? 'YES ✅' : 'NO ❌'}`);
    console.log(`[crypto] SELF-TEST: ${cipher && realCanRead && wrongRejected ? 'PASS ✅ encryption verified' : 'FAIL ❌ check op-sqlite sqlcipher flag / rebuild'}`);

    // Städa: radera temp-DB:n.
    try { open({ name: NAME, encryptionKey: realKey }).delete(); } catch { /* ignore */ }
  } catch (e) {
    console.log('[crypto] self-test error', e);
  }
}
