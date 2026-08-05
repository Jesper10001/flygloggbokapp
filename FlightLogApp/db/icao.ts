import { getDatabase } from './database';
import type { IcaoAirport } from '../types/flight';
import type { SeedRow } from '../components/GlobalAirportMap';

let airportData: SeedRow[] = [];
try {
  airportData = require('../assets/icao-airports.json');
} catch {
  console.warn('[ICAO] icao-airports.json not found — airport database unavailable');
}

export function getSeedAirports(): Promise<SeedRow[]> {
  return Promise.resolve(airportData);
}

const SEED_VERSION = '2026-07-30-no-zzzz'; // ZZZZ borttagen (off-airport-kod) → tvingar om-seed

export async function seedIcaoAirports(premium = false): Promise<void> {
  const db = await getDatabase();

  // Check if table already has data
  const tableCount = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM icao_airports`
  ).catch(() => ({ cnt: 0 }));

  const existing = await db.getFirstAsync<{ v: string }>(
    `SELECT value as v FROM settings WHERE key = 'icao_seed_version'`
  ).catch(() => null);

  if (existing?.v === SEED_VERSION && tableCount?.cnt && tableCount.cnt > 0) {
    return;
  }

  const data = airportData;

  const BATCH = 200;
  await db.withTransactionAsync(async () => {
    // Version bytt → rensa gamla seed-rader (behåll användarens custom + off-airport) och skriv om berikat.
    await db.runAsync(`DELETE FROM icao_airports WHERE custom = 0 AND COALESCE(temporary, 0) = 0`);
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,0)').join(',');
      const params = chunk.flatMap(([icao, name, country, region, lat, lon, iata, alt, type, municipality, , gps]) =>
        [icao, name, country, region, lat, lon, iata ?? '', alt ?? null, type ?? '', municipality ?? '', gps ?? '']
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO icao_airports (icao, name, country, region, lat, lon, iata, alt, type, municipality, gps, custom)
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

// Söker på BÅDE ICAO och IATA + flygplatsnamn. Prioritering överst: exakt ICAO → exakt IATA →
// ICAO-prefix → IATA-prefix → namnträff. nameMinLen: flygplatsnamn matchas först från så många tecken
// (default 5 → de fyra första tecknen reserverade för koder, så IATA/ICAO inte begravs av namnträffar).
export async function searchAirports(query: string, nameMinLen = 5): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  const upper = query.toUpperCase();
  const like = `%${upper}%`, pre = `${upper}%`;
  // Koderna matchas som PREFIX (det man skriver är början av ICAO/IATA-koden), namn som delsträng.
  const clauses = ['UPPER(icao) LIKE ?', 'UPPER(iata) LIKE ?'];
  const whereParams: string[] = [pre, pre];
  if (upper.length >= nameMinLen) { clauses.push('UPPER(name) LIKE ?'); whereParams.push(like); }
  return await db.getAllAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE ${clauses.join(' OR ')}
     ORDER BY
       CASE WHEN UPPER(icao) = ? THEN 0
            WHEN UPPER(iata) = ? THEN 1
            WHEN UPPER(icao) LIKE ? THEN 2
            WHEN UPPER(iata) LIKE ? THEN 3
            ELSE 4 END,
       COALESCE(temporary, 0) ASC,
       custom DESC,
       name ASC
     LIMIT 20`,
    [...whereParams, upper, upper, pre, pre]
  );
}

export async function getTempPlaceByName(name: string): Promise<IcaoAirport | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE temporary = 1 AND UPPER(name) = ?',
    [name.trim().toUpperCase()]
  );
}

export async function getAirportByIcao(icao: string): Promise<IcaoAirport | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE icao=?',
    [icao.toUpperCase()]
  );
}

// Kod-matchning mot ICAO / IATA / GPS (för fritext-inmatningen i Log Flight). Hela koden måste
// stämma (ingen prefix-matchning), men skiljetecken ignoreras: "RU0626" matchar "RU-0626".
// Matchar riktiga flygplatser (seed/custom) OCH registrerade off-airport-platser (temporary=1);
// riktiga flygplatser prioriteras före off-airport vid krock. Prioritet: ICAO → IATA → GPS.
export async function getAirportByAnyCode(code: string): Promise<IcaoAirport | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  const db = await getDatabase();
  // 1) Exakt matchning först (indexerad → snabb, täcker de allra flesta koderna).
  const exact = await db.getFirstAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE UPPER(icao) = ? OR UPPER(iata) = ? OR UPPER(gps) = ?
     ORDER BY COALESCE(temporary,0) ASC, CASE WHEN UPPER(icao) = ? THEN 0 WHEN UPPER(iata) = ? THEN 1 ELSE 2 END
     LIMIT 1`,
    [c, c, c, c, c]
  );
  if (exact) return exact;
  // 2) Fallback: normalisera bort skiljetecken (bindestreck/mellanslag/./ /) på BÅDA sidor, så att
  //    användaren slipper skriva "-" (t.ex. "RU0626" ↔ lagrad "RU-0626"). Körs bara när exakt missar.
  const cn = c.replace(/[^A-Z0-9]/g, '');
  if (!cn) return null;
  const strip = (col: string) => `REPLACE(REPLACE(REPLACE(REPLACE(UPPER(${col}), '-', ''), ' ', ''), '.', ''), '/', '')`;
  return await db.getFirstAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE ${strip('icao')} = ? OR ${strip('iata')} = ? OR ${strip('gps')} = ?
     ORDER BY COALESCE(temporary,0) ASC, CASE WHEN ${strip('icao')} = ? THEN 0 WHEN ${strip('iata')} = ? THEN 1 ELSE 2 END
     LIMIT 1`,
    [cn, cn, cn, cn, cn]
  );
}

// Off-airport-plats (från Manage airports > Off-airport): temporary=1 men med land + koordinater.
// Koden (icao) = den bokstavskombination användaren skrev i Log Flight, så den matchar nästa gång.
export async function addOffAirportPlace(icao: string, name: string, country: string, lat = 0, lon = 0): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, custom, temporary)
     VALUES (?, ?, ?, '', ?, ?, 0, 1)`,
    [icao.toUpperCase(), name || icao.toUpperCase(), country || '', lat, lon]
  );
}

export async function getPlaceDisplayName(icao: string): Promise<string> {
  if (!icao) return '';
  const airport = await getAirportByIcao(icao);
  if (airport?.temporary && airport.name && airport.name !== icao) return airport.name;
  return icao;
}

export async function batchPlaceNames(icaos: string[]): Promise<Record<string, string>> {
  if (icaos.length === 0) return {};
  const db = await getDatabase();
  const unique = [...new Set(icaos.filter(Boolean).map(s => s.toUpperCase()))];
  const result: Record<string, string> = {};
  for (const code of unique) {
    result[code] = code;
  }
  const rows = await db.getAllAsync<{ icao: string; name: string; temporary: number }>(
    `SELECT icao, name, temporary FROM icao_airports WHERE temporary = 1 AND icao IN (${unique.map(() => '?').join(',')})`,
    unique
  );
  for (const r of rows) {
    if (r.name && r.name !== r.icao) result[r.icao] = r.name;
  }
  return result;
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

// Som getAirportCoordinates men inkluderar land + region (för tidszons-uppslag).
export async function getAirportTzInfo(
  icaoCodes: string[]
): Promise<{ icao: string; country: string; region: string; lat: number; lon: number }[]> {
  if (!icaoCodes.length) return [];
  const db = await getDatabase();
  const placeholders = icaoCodes.map(() => '?').join(',');
  return await db.getAllAsync<{ icao: string; country: string; region: string; lat: number; lon: number }>(
    `SELECT icao, country, region, lat, lon FROM icao_airports WHERE icao IN (${placeholders}) AND lat IS NOT NULL`,
    icaoCodes
  );
}

export async function getNearbyAirports(
  lat: number, lon: number, limit = 5
): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  const degRange = 1.5;
  const rows = await db.getAllAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
       AND (temporary IS NULL OR temporary = 0)
       AND lat != 0 AND lon != 0
     LIMIT 200`,
    [lat - degRange, lat + degRange, lon - degRange, lon + degRange]
  );
  return rows
    .map(r => ({ ...r, dist: calculateDistance(lat, lon, r.lat, r.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit);
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
  const displayName = name || icao.toUpperCase();

  // Check if a similar temporary place already exists
  const similar = await findSimilarTemporaryPlace(displayName);

  if (similar) {
    // Update the existing similar place with new name and coordinates
    await db.runAsync(
      'UPDATE icao_airports SET name = ?, lat = ?, lon = ? WHERE icao = ? AND temporary = 1',
      [displayName, lat || similar.lat, lon || similar.lon, similar.icao]
    );
  } else {
    // Add as new temporary place
    await db.runAsync(
      `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, custom, temporary)
       VALUES (?, ?, '', '', ?, ?, 0, 1)`,
      [icao.toUpperCase(), displayName, lat, lon]
    );
  }
}

function calculateSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

async function findSimilarTemporaryPlace(name: string, threshold = 0.60): Promise<IcaoAirport | null> {
  const db = await getDatabase();
  const allTemp = await db.getAllAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE temporary = 1'
  );

  const normalized = name.toUpperCase().trim();

  for (const place of allTemp) {
    const placeName = place.name?.toUpperCase() || place.icao;
    const similarity = calculateSimilarity(normalized, placeName);

    // Match if similarity is high enough, or if one is a clear prefix of the other
    const isPrefix = placeName.startsWith(normalized) || normalized.startsWith(placeName);
    if (similarity >= threshold || (isPrefix && similarity >= 0.50)) {
      return place;
    }
  }

  return null;
}

export async function generateTemporaryIcao(name: string): Promise<string> {
  const db = await getDatabase();
  const base = name.toUpperCase().trim();
  if (!base) return 'TEMP';

  // Check for exact match first
  let candidate = base;
  const exists = await db.getFirstAsync('SELECT 1 FROM icao_airports WHERE icao = ?', [candidate]);
  if (!exists) return candidate;

  // Check for similar temporary places
  const similar = await findSimilarTemporaryPlace(name);
  if (similar) return similar.icao;

  // Fall back to numeric variants
  for (let i = 2; i <= 99; i++) {
    candidate = `${base}${i}`;
    const variantExists = await db.getFirstAsync('SELECT 1 FROM icao_airports WHERE icao = ?', [candidate]);
    if (!variantExists) return candidate;
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

export async function getAllTempPlaces(): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  return db.getAllAsync<IcaoAirport>('SELECT * FROM icao_airports WHERE temporary = 1');
}

export async function getUnlocatedTemporaryPlaces(): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  return db.getAllAsync<IcaoAirport>(
    'SELECT * FROM icao_airports WHERE temporary = 1 AND (lat = 0 OR lon = 0 OR lat IS NULL OR lon IS NULL)'
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
