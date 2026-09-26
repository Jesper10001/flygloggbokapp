// "Manage app data": inventering av all användarinlagd data + total radering (allt utom den seedade
// flygplatsdatabasen och krypteringsnyckeln i Keychain). Promo-koder ligger på Cloudflare och påverkas ej.
import { getDatabase } from './database';

export interface DataInventory {
  flights: number;
  droneFlights: number;
  aircraft: number;
  drones: number;
  logbooks: number;
  certificates: number;
  templates: number;
  media: number;
  customPlaces: number;
  profileName: string;
}

async function count(sql: string): Promise<number> {
  try {
    const db = await getDatabase();
    const r = await db.getFirstAsync<{ c: number }>(sql);
    return r?.c ?? 0;
  } catch { return 0; }
}

export async function getUserDataInventory(): Promise<DataInventory> {
  const db = await getDatabase();
  let profileName = '';
  try {
    const f = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key='profile_first_name'");
    const l = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key='profile_last_name'");
    profileName = `${f?.value ?? ''} ${l?.value ?? ''}`.trim();
  } catch { /* ignore */ }

  const [flights, droneFlights, aircraft, drones, logbooks, certificates, templates, media, customPlaces] = await Promise.all([
    count('SELECT COUNT(*) c FROM flights'),
    count('SELECT COUNT(*) c FROM drone_flights'),
    count('SELECT COUNT(*) c FROM aircraft_registry'),
    count('SELECT COUNT(*) c FROM drone_registry'),
    count('SELECT COUNT(*) c FROM logbook_books'),
    count('SELECT COUNT(*) c FROM drone_certificates'),
    count('SELECT COUNT(*) c FROM custom_templates'),
    count("SELECT COUNT(*) c FROM flights WHERE photo_uri IS NOT NULL AND photo_uri <> ''"),
    count('SELECT COUNT(*) c FROM icao_airports WHERE custom = 1 OR COALESCE("temporary",0) > 0'),
  ]);

  return { flights, droneFlights, aircraft, drones, logbooks, certificates, templates, media, customPlaces, profileName };
}

// Raderar ALL användardata ur databasen. Behåller: den seedade flygplatsdatabasen (custom=0,
// temporary=0) och 'icao_seed_version' (så vi slipper om-seeda 8,5 MB). Alla övriga inställningar
// (profil, onboarding, app-lås, promo-flagga, standard, tidsformat …) raderas → appen återgår till onboarding.
export async function wipeAllUserData(): Promise<void> {
  const db = await getDatabase();
  const run = async (sql: string) => { try { await db.runAsync(sql); } catch { /* saknad tabell → hoppa */ } };
  await run('DELETE FROM flights');
  await run('DELETE FROM drone_flights');
  await run('DELETE FROM drone_registry');
  await run('DELETE FROM drone_certificates');
  await run('DELETE FROM aircraft_registry');
  await run('DELETE FROM audit_log');
  await run('DELETE FROM ocr_learned');
  await run('DELETE FROM logbook_books');
  await run('DELETE FROM custom_templates');
  await run('DELETE FROM scan_summaries');
  await run('DELETE FROM favorite_airports');
  await run('DELETE FROM icao_airports WHERE custom = 1 OR COALESCE("temporary",0) > 0');
  await run("DELETE FROM settings WHERE key <> 'icao_seed_version'");
}
