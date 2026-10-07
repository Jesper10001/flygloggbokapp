// Backfill missing hours — lump sum per fält (oberoende av total flygtid).
//
// Lagras som en JUSTERING i settings (JSON) OCH speglas till en SYNLIG loggboksrad ("Blades previous
// experience") daterad dagen före första loggade flygningen. Raden är den som räknas i statistiken
// (getFlightStats summerar den som en vanlig flygning) — därför adderas INTE settings-värdena längre i
// getFlightStats/Insights/Book (skulle dubbelräkna). Radens total_time = 0 (backfill har ingen total),
// bara kategorifälten fylls, så totala flygtimmar påverkas inte (som tidigare). Sim-timmar läggs på en
// separat sim-rad. Settings-JSON är fortfarande redigerarens källa (BackfillMissingHours).
import { getDatabase } from './database';

const KEY = 'backfill_hours';
const BF_MARKER = '[BACKFILL]'; // gamla dolda backfill-flygningar (migreras bort)
const PREV_EXP_REMARK = 'Blades previous experience';
const ROW_ID_KEY = 'backfill_row_id';          // id för kategori-raden (flight_type='summary')
const SIM_ROW_ID_KEY = 'backfill_sim_row_id';  // id för sim-raden (flight_type='sim')

export type BackfillValues = {
  total: number; // justering av TOTAL flygtid (loggas som radens total_time, påverkar inga kategorier)
  pic: number; co_pilot: number; dual: number; picus: number; instructor: number;
  ifr: number; night: number; cross_country: number; multi_pilot: number;
  landings_day: number; landings_night: number; sim: number;
  // Utökade fält (flödar in i Insights → Hours bank; nyckelnamnen = Flight-kolumnerna).
  examiner: number; single_pilot: number; pilot_flying: number; safety_pilot: number;
  observer: number; relief_crew: number; ferry_pic: number; spic: number;
  se_time: number; me_time: number; nvg: number;
  takeoffs_day: number; takeoffs_night: number; takeoffs_faa_night: number;
  landings_faa_night: number; tng_count: number; app_2d: number; app_3d: number; holds: number;
};
export const ZERO_BACKFILL: BackfillValues = {
  total: 0,
  pic: 0, co_pilot: 0, dual: 0, picus: 0, instructor: 0, ifr: 0, night: 0,
  cross_country: 0, multi_pilot: 0, landings_day: 0, landings_night: 0, sim: 0,
  examiner: 0, single_pilot: 0, pilot_flying: 0, safety_pilot: 0, observer: 0,
  relief_crew: 0, ferry_pic: 0, spic: 0, se_time: 0, me_time: 0, nvg: 0,
  takeoffs_day: 0, takeoffs_night: 0, takeoffs_faa_night: 0, landings_faa_night: 0,
  tng_count: 0, app_2d: 0, app_3d: 0, holds: 0,
};

async function getVal(db: any, key: string): Promise<string | null> {
  const r = await db.getFirstAsync('SELECT value FROM settings WHERE key=?', [key]);
  return (r as any)?.value ?? null;
}
async function setVal(db: any, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}

// Migrera bort gamla dolda backfill-flygningar ([BACKFILL]) → settings-justering, EN gång.
let migrated = false;
async function migrateLegacy(db: any): Promise<void> {
  if (migrated) return;
  migrated = true;
  const rows = (await db.getAllAsync('SELECT * FROM flights WHERE remarks=?', [BF_MARKER])) as any[];
  if (!rows.length) return;
  const existing = await getVal(db, KEY);
  if (!existing) {
    const v = { ...ZERO_BACKFILL };
    for (const r of rows) {
      if (r.flight_type === 'sim') v.sim += r.total_time || 0;
      else {
        v.pic += r.pic || 0; v.co_pilot += r.co_pilot || 0; v.dual += r.dual || 0; v.picus += r.picus || 0;
        v.instructor += r.instructor || 0; v.ifr += r.ifr || 0; v.night += r.night || 0;
        v.cross_country += r.cross_country || 0; v.multi_pilot += r.multi_pilot || 0;
        v.landings_day += r.landings_day || 0; v.landings_night += r.landings_night || 0;
      }
    }
    await setVal(db, KEY, JSON.stringify(v));
  }
  await db.runAsync('DELETE FROM flights WHERE remarks=?', [BF_MARKER]);
}

/** Läser aktuella backfill-värden (0 om inget satts). */
export async function getBackfill(): Promise<BackfillValues> {
  const db = await getDatabase();
  await migrateLegacy(db);
  const raw = await getVal(db, KEY);
  if (!raw) return { ...ZERO_BACKFILL };
  try { return { ...ZERO_BACKFILL, ...(JSON.parse(raw) as Partial<BackfillValues>) }; } catch { return { ...ZERO_BACKFILL }; }
}

/** Sparar backfill-justeringen (settings-JSON) + synkar den synliga loggboksraden. */
export async function setBackfill(v: BackfillValues): Promise<void> {
  const db = await getDatabase();
  await setVal(db, KEY, JSON.stringify(v));
  lastSyncedJson = null; // tvinga om-synk med de nya värdena
  await syncBackfillRow(db);
}

// ── Synlig loggboksrad ("Blades previous experience") ───────────────────────
// Dagen före första riktiga flygningen (exkl. summary/sim); fallback: idag.
async function backfillRowDate(db: any): Promise<string> {
  const r = await db.getFirstAsync("SELECT MIN(date) as d FROM flights WHERE flight_type NOT IN ('summary','sim') AND date != ''");
  const first = (r as any)?.d as string | null;
  if (!first) return new Date().toISOString().slice(0, 10);
  const d = new Date(first + 'T00:00:00Z');
  if (isNaN(d.getTime())) return first;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Kategori-kolumner på raden (total_time = 0). Nycklar = flights-kolumner, värden = backfill-fält.
const ROW_COLS: Record<string, keyof BackfillValues> = {
  pic: 'pic', co_pilot: 'co_pilot', dual: 'dual', picus: 'picus', instructor: 'instructor',
  ifr: 'ifr', night: 'night', nvg: 'nvg', cross_country: 'cross_country',
  multi_pilot: 'multi_pilot', single_pilot: 'single_pilot', spic: 'spic', ferry_pic: 'ferry_pic',
  observer: 'observer', relief_crew: 'relief_crew', examiner: 'examiner', safety_pilot: 'safety_pilot',
  se_time: 'se_time', me_time: 'me_time', pilot_flying: 'pilot_flying',
  landings_day: 'landings_day', landings_night: 'landings_night',
  takeoffs_day: 'takeoffs_day', takeoffs_night: 'takeoffs_night',
  takeoffs_faa_night: 'takeoffs_faa_night', landings_faa_night: 'landings_faa_night',
  tng_count: 'tng_count', app_2d: 'app_2d', app_3d: 'app_3d', holds: 'holds',
};
const INT_COLS = new Set(['landings_day', 'landings_night', 'takeoffs_day', 'takeoffs_night', 'takeoffs_faa_night', 'landings_faa_night', 'tng_count', 'app_2d', 'app_3d', 'holds']);

async function getStoredRowId(db: any, key: string): Promise<number | null> {
  const raw = await getVal(db, key);
  const id = raw ? parseInt(raw, 10) : NaN;
  return isNaN(id) ? null : id;
}
async function rowExists(db: any, id: number): Promise<boolean> {
  const r = await db.getFirstAsync('SELECT 1 as x FROM flights WHERE id=?', [id]);
  return !!r;
}

let lastSyncedJson: string | null = null;
// Serialisera synken: getFlightStats (loadStats) kan köras parallellt → utan kö skulle två
// samtidiga körningar båda passera json-vakten och INSERT:a varsin rad (dubblett). Kön kör en i taget.
let syncChain: Promise<any> = Promise.resolve();

/**
 * Speglar settings-backfillen till en synlig loggboksrad. Idempotent — kör upsert bara när värdena
 * ändrats sedan förra synken. Serialiserad (kö) så parallella anrop aldrig skapar dubbletter.
 * Anropas av getFlightStats (så dashboard-statistiken alltid har raden) och av setBackfill.
 */
export function syncBackfillRow(db?: any): Promise<void> {
  const run = syncChain.then(() => doSyncBackfillRow(db));
  syncChain = run.catch(() => {}); // håll kön vid liv även om en körning fallerar
  return run;
}

async function doSyncBackfillRow(db?: any): Promise<void> {
  db = db ?? await getDatabase();
  const v = await getBackfill(); // migrerar ev. legacy + läser settings (färska värden varje körning)
  const json = JSON.stringify(v);
  if (json === lastSyncedJson) return; // inget ändrat sedan förra körningen
  const rowId = await getStoredRowId(db, ROW_ID_KEY);
  const simId = await getStoredRowId(db, SIM_ROW_ID_KEY);

  const date = await backfillRowDate(db);

  // ── "Blades previous experience"-raden (summary): total_time = total-justeringen, + kategorifält ──
  const total = Number(v.total) || 0;
  const hasCats = total > 0 || Object.values(ROW_COLS).some((f) => (Number(v[f]) || 0) > 0);
  if (hasCats) {
    const cols = Object.keys(ROW_COLS);
    const vals = cols.map((c) => {
      const n = Number(v[ROW_COLS[c]]) || 0;
      return INT_COLS.has(c) ? Math.round(n) : n;
    });
    if (rowId && await rowExists(db, rowId)) {
      await db.runAsync(
        `UPDATE flights SET date=?, remarks=?, total_time=?, ${cols.map((c) => `${c}=?`).join(', ')} WHERE id=?`,
        [date, PREV_EXP_REMARK, total, ...vals, rowId],
      );
    } else {
      const res = await db.runAsync(
        `INSERT INTO flights (date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc,
           total_time, remarks, status, source, flight_rules, flight_type, ${cols.join(', ')})
         VALUES (?, '', '', '', '', '', '', ?, ?, 'manual', 'manual', 'VFR', 'summary', ${cols.map(() => '?').join(', ')})`,
        [date, total, PREV_EXP_REMARK, ...vals],
      );
      await setVal(db, ROW_ID_KEY, String((res as any).lastInsertRowId));
    }
  } else if (rowId) {
    await db.runAsync('DELETE FROM flights WHERE id=?', [rowId]);
    await db.runAsync('DELETE FROM settings WHERE key=?', [ROW_ID_KEY]);
  }

  // ── Sim-raden (flight_type='sim', total_time = sim-timmar) ──
  const sim = Number(v.sim) || 0;
  if (sim > 0) {
    if (simId && await rowExists(db, simId)) {
      await db.runAsync('UPDATE flights SET date=?, total_time=?, remarks=? WHERE id=?', [date, sim, PREV_EXP_REMARK, simId]);
    } else {
      const res = await db.runAsync(
        `INSERT INTO flights (date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc,
           total_time, remarks, status, source, flight_rules, flight_type)
         VALUES (?, '', '', '', '', '', '', ?, ?, 'manual', 'manual', 'VFR', 'sim')`,
        [date, sim, PREV_EXP_REMARK],
      );
      await setVal(db, SIM_ROW_ID_KEY, String((res as any).lastInsertRowId));
    }
  } else if (simId) {
    await db.runAsync('DELETE FROM flights WHERE id=?', [simId]);
    await db.runAsync('DELETE FROM settings WHERE key=?', [SIM_ROW_ID_KEY]);
  }

  lastSyncedJson = json;
}
