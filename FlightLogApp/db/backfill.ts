// Backfill missing hours — lump sum per fält (oberoende av total flygtid).
//
// Lagras som en JUSTERING i settings (JSON), INTE som en flygning. Värdena adderas till de
// app-övergripande totalerna (getFlightStats → insights/projektioner) men skapar INGEN flight
// i loggboken/tidslinjer, så statistik och tidslinjer inte snedvrids av en fejkad flygning.
import { getDatabase } from './database';

const KEY = 'backfill_hours';
const BF_MARKER = '[BACKFILL]'; // gamla dolda backfill-flygningar (migreras bort)

export type BackfillValues = {
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

/** Sparar backfill-justeringen (settings-JSON). */
export async function setBackfill(v: BackfillValues): Promise<void> {
  const db = await getDatabase();
  await setVal(db, KEY, JSON.stringify(v));
}
