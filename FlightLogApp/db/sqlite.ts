// SQLCipher-adapter: öppnar op-sqlite (AES-256, transparent nyckel) och exponerar EXAKT den
// expo-sqlite-kompatibla ytan som resten av koden använder (getAllAsync/getFirstAsync/runAsync/
// execAsync/withTransactionAsync). Därför behöver inget i db/*.ts eller services/ ändras — bara
// db/database.ts öppnar via denna. Kräver op-sqlite byggd med SQLCipher
// (package.json: "op-sqlite": { "sqlcipher": true }).
import { open, isSQLCipher } from '@op-engineering/op-sqlite';

export interface SqliteDb {
  getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
  runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }>;
  execAsync(sql: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

// executeSync = synkron JSI (mycket snabb, inga trådhopp) → matchar expo-sqlites async-yta via Promise.
export function openEncryptedDatabase(name: string, encryptionKey: string): SqliteDb {
  const db = open({ name, encryptionKey });

  return {
    async getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]> {
      return (db.executeSync(sql, params ?? []).rows ?? []) as T[];
    },
    async getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null> {
      const rows = db.executeSync(sql, params ?? []).rows ?? [];
      return (rows.length ? rows[0] : null) as T | null;
    },
    async runAsync(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowId: number }> {
      const res = db.executeSync(sql, params ?? []);
      return { changes: res.rowsAffected ?? 0, lastInsertRowId: res.insertId ?? 0 };
    },
    async execAsync(sql: string): Promise<void> {
      // Kör flera satser (PRAGMA + schema). Inga triggers finns → säkert att dela på ';'.
      for (const part of sql.split(';')) {
        const stmt = part.trim();
        if (stmt) db.executeSync(stmt);
      }
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      db.executeSync('BEGIN');
      try {
        await task();
        db.executeSync('COMMIT');
      } catch (e) {
        try { db.executeSync('ROLLBACK'); } catch { /* redan avbruten */ }
        throw e;
      }
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
