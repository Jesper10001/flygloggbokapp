// Drönar-backfill — lump-sum-timmar per fält (oberoende av loggade flygningar), speglar
// db/backfill.ts fast för drönare. Lagras som en JUSTERING i settings (JSON), INTE som en
// drönar-flygning: värdena adderas till drönar-totalerna (getDroneStats → dashboard/insights)
// men skapar ingen flygning i loggboken/tidslinjer. Fälten motsvarar DroneStats-kolumnerna, så
// allt man fyller i syns i statistiken.
import { getDatabase } from './database';

const KEY = 'drone_backfill_hours';

export type DroneBackfillValues = {
  total_time: number;
  vlos: number; evlos: number; bvlos: number;
  night: number;
  cat_a1: number; cat_a2: number; cat_a3: number; cat_specific: number; cat_certified: number;
};

export const ZERO_DRONE_BACKFILL: DroneBackfillValues = {
  total_time: 0, vlos: 0, evlos: 0, bvlos: 0, night: 0,
  cat_a1: 0, cat_a2: 0, cat_a3: 0, cat_specific: 0, cat_certified: 0,
};

async function getVal(db: any, key: string): Promise<string | null> {
  const r = await db.getFirstAsync('SELECT value FROM settings WHERE key=?', [key]);
  return (r as any)?.value ?? null;
}
async function setVal(db: any, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}

/** Läser aktuella drönar-backfill-värden (0 om inget satts). */
export async function getDroneBackfill(): Promise<DroneBackfillValues> {
  const db = await getDatabase();
  const raw = await getVal(db, KEY);
  if (!raw) return { ...ZERO_DRONE_BACKFILL };
  try { return { ...ZERO_DRONE_BACKFILL, ...(JSON.parse(raw) as Partial<DroneBackfillValues>) }; } catch { return { ...ZERO_DRONE_BACKFILL }; }
}

/** Sparar drönar-backfill-justeringen (settings-JSON). */
export async function setDroneBackfill(v: DroneBackfillValues): Promise<void> {
  const db = await getDatabase();
  await setVal(db, KEY, JSON.stringify(v));
}
