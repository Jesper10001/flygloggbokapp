import { getDatabase } from './database';
import type { IcaoAirport } from '../types/flight';
import { SEED_AIRPORTS } from './seedAirports';

const SEED_VERSION = '2026-04-22-global';

export async function seedIcaoAirports(premium = false): Promise<void> {
  if (!premium) return;

  const db = await getDatabase();

  const existing = await db.getFirstAsync<{ v: string }>(
    `SELECT value as v FROM settings WHERE key = 'icao_seed_version'`
  ).catch(() => null);

  if (existing?.v === SEED_VERSION) return;

  const data = SEED_AIRPORTS;

  const BATCH = 200;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,0)').join(',');
      const params = chunk.flatMap(([icao, name, country, region, lat, lon]) =>
        [icao, name, country, region, lat, lon]
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO icao_airports (icao, name, country, region, lat, lon, custom)
         VALUES ${placeholders}`,
        params
      );
    }
  });

  await db.runAsync(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('icao_seed_version', ?)`,
    [SEED_VERSION]
  );
}

export async function searchAirports(query: string): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  const q = `%${query.toUpperCase()}%`;
  return await db.getAllAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE icao LIKE ? OR UPPER(name) LIKE ?
     ORDER BY
       COALESCE(temporary, 0) ASC,
       CASE WHEN icao = ? THEN 0
            WHEN icao LIKE ? THEN 1
            ELSE 2 END,
       custom DESC,
       name ASC
     LIMIT 20`,
    [q, `%${query}%`, query.toUpperCase(), `${query.toUpperCase()}%`]
  );
}

export async function getAirportByIcao(icao: string): Promise<IcaoAirport | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE icao=?',
    [icao.toUpperCase()]
  );
}

export async function getAirportCoordinates(
  icaoCodes: string[]
): Promise<{ icao: string; name: string; lat: number; lon: number }[]> {
  if (!icaoCodes.length) return [];
  const db = await getDatabase();
  const placeholders = icaoCodes.map(() => '?').join(',');
  return await db.getAllAsync<{ icao: string; name: string; lat: number; lon: number }>(
    `SELECT icao, name, lat, lon FROM icao_airports WHERE icao IN (${placeholders}) AND lat IS NOT NULL`,
    icaoCodes
  );
}

export async function addCustomAirport(airport: Omit<IcaoAirport, 'custom'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, custom)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [airport.icao.toUpperCase(), airport.name, airport.country, airport.region, airport.lat, airport.lon]
  );
}

export async function getAllUserAirports(): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  return await db.getAllAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE custom = 1 OR "temporary" = 1
     ORDER BY "temporary" ASC, icao ASC`
  );
}

export async function deleteCustomAirport(icao: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM icao_airports WHERE icao=? AND custom=1 AND ("temporary" IS NULL OR "temporary"=0)',
    [icao.toUpperCase()]
  );
}

export async function deleteTemporaryPlace(icao: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM icao_airports WHERE icao=? AND "temporary"=1',
    [icao.toUpperCase()]
  );
}

export async function renameCustomAirport(icao: string, newName: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE icao_airports SET name=? WHERE icao=? AND (custom=1 OR "temporary"=1)',
    [newName.trim(), icao.toUpperCase()]
  );
}

export async function updateUserAirport(
  icao: string,
  name: string,
  lat: number,
  lon: number,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE icao_airports SET name=?, lat=?, lon=? WHERE icao=? AND (custom=1 OR "temporary"=1)',
    [name.trim(), lat, lon, icao.toUpperCase()]
  );
}

export async function addTemporaryPlace(icao: string, name: string, lat = 0, lon = 0): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, custom, temporary)
     VALUES (?, ?, '', '', ?, ?, 0, 1)`,
    [icao.toUpperCase(), name || icao.toUpperCase(), lat, lon]
  );
}

export async function generateTemporaryIcao(name: string): Promise<string> {
  const db = await getDatabase();
  const letters = name.toUpperCase().replace(/[^A-ZÅÄÖ]/g, '')
    .replace(/Å/g,'A').replace(/Ä/g,'A').replace(/Ö/g,'O');
  const base = (letters + 'ZZZZ').slice(0, 4);
  let candidate = base;
  for (let i = 1; i <= 99; i++) {
    const exists = await db.getFirstAsync('SELECT 1 FROM icao_airports WHERE icao = ?', [candidate]);
    if (!exists) return candidate;
    const suf = String(i);
    candidate = base.slice(0, 4 - suf.length) + suf;
  }
  return base;
}

export async function getNearbyTemporaryPlaces(
  lat: number, lon: number, radiusKm: number
): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  const all = await db.getAllAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE temporary = 1 AND lat != 0'
  );
  return all.filter(a => calculateDistance(lat, lon, a.lat, a.lon) <= radiusKm);
}

export async function getAllTemporaryPlaces(): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  return db.getAllAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE temporary = 1 AND lat != 0 AND lon != 0'
  );
}

export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
