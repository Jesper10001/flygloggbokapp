import { getDatabase } from './database';
import type { IcaoAirport } from '../types/flight';
import type { SeedRow } from '../components/GlobalAirportMap';
import { loadJsonAsset } from '../utils/loadJsonAsset';

// Off-airport placeholder codes: ICAO-standard "no location indicator assigned" (ZZZZ, ICAO Doc 4444).
// These are NOT real places — the same code is reused for any off-airport site, so we never link them
// to coordinates, never treat them as an unknown airport, and never prompt to place them on the map.
const OFF_AIRPORT_CODES = new Set(['ZZZZ']);
export function isOffAirportCode(code: string | null | undefined): boolean {
  return !!code && OFF_AIRPORT_CODES.has(code.trim().toUpperCase());
}

// Airport-seed (8,5 MB) laddas som BUNTAD ASSET (icao-airports.dat), inte via require() — en så
// stor JSON inlinad blir ett objekt-literal som Hermes i SDK 57 inte klarar bytecode-kompilera
// (require kastade → "airport database unavailable"). Lazy + cachad: bara första anropet läser filen.
let _airportData: SeedRow[] | null = null;
let _airportLoading: Promise<SeedRow[]> | null = null;
function loadAirportData(): Promise<SeedRow[]> {
  if (_airportData) return Promise.resolve(_airportData);
  if (!_airportLoading) {
    _airportLoading = loadJsonAsset<SeedRow[]>(require('../assets/icao-airports.dat'))
      .then((d) => { _airportData = d; console.log(`[ICAO] airport data loaded: ${Array.isArray(d) ? d.length : 'NOT-ARRAY'} airports`); return d; })
      .catch((e) => { console.warn('[ICAO] airport data load FAILED:', e?.message ?? e); _airportData = []; return [] as SeedRow[]; });
  }
  return _airportLoading;
}

export function getSeedAirports(): Promise<SeedRow[]> {
  return loadAirportData();
}

// Diakrit-vikning för sökning: viker latinska accenttecken (svenska/tyska/franska/spanska/nordiska
// m.fl.) till ASCII och versaliserar. "Luleå"→"LULEA", "Bückeburg"→"BUCKEBURG", "Nîmes"→"NIMES".
// Egen tabell (inte String.normalize) — Hermes saknar pålitligt ICU-stöd i RN.
const FOLD_MAP: Record<string, string> = {
  À: 'A', Á: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A', Ā: 'A', Ă: 'A', Ą: 'A', Æ: 'AE',
  Ç: 'C', Ć: 'C', Č: 'C', Ċ: 'C',
  Ð: 'D', Đ: 'D', Ď: 'D',
  È: 'E', É: 'E', Ê: 'E', Ë: 'E', Ē: 'E', Ĕ: 'E', Ė: 'E', Ę: 'E', Ě: 'E',
  Ĝ: 'G', Ğ: 'G',
  Ì: 'I', Í: 'I', Î: 'I', Ï: 'I', Ĩ: 'I', Ī: 'I', Į: 'I', İ: 'I',
  Ł: 'L', Ľ: 'L', Ĺ: 'L',
  Ñ: 'N', Ń: 'N', Ň: 'N',
  Ò: 'O', Ó: 'O', Ô: 'O', Õ: 'O', Ö: 'O', Ø: 'O', Ō: 'O', Ŏ: 'O', Ő: 'O', Œ: 'OE',
  Ŕ: 'R', Ř: 'R',
  Ś: 'S', Š: 'S', Ş: 'S', Ș: 'S', ẞ: 'SS', ß: 'SS',
  Ť: 'T', Ţ: 'T', Ț: 'T', Þ: 'TH',
  Ù: 'U', Ú: 'U', Û: 'U', Ü: 'U', Ũ: 'U', Ū: 'U', Ŭ: 'U', Ů: 'U', Ű: 'U', Ų: 'U',
  Ý: 'Y', Ÿ: 'Y',
  Ź: 'Z', Ž: 'Z', Ż: 'Z',
};
export function foldDiacritics(s: string): string {
  let out = '';
  for (const ch of (s || '').toUpperCase()) out += FOLD_MAP[ch] ?? ch;
  return out;
}

const SEED_VERSION = '2026-09-28-namenorm'; // om-seed: land-koder (ESCF=SE) + name_norm för diakrit-okänslig sökning

// Kanariefåglar: kända flygplatser vars land ALDRIG ändras. Om en seedad rad avviker (eller saknas)
// är enhetens DB inaktuell (t.ex. ESCF felaktigt 'US' från ett äldre dataset) → tvinga om-seed även
// om seed-versionen råkar stämma. Billig kontroll (några rader), oberoende av 8,5 MB-assetens laddning.
const SEED_CANARIES: Record<string, string> = {
  ESCF: 'SE', // Malmen (svensk flagga visades felaktigt som US)
  ESSA: 'SE', // Stockholm Arlanda
  KJFK: 'US', // New York JFK
  EGLL: 'GB', // London Heathrow
};

async function seedLooksStale(db: Awaited<ReturnType<typeof getDatabase>>): Promise<boolean> {
  const codes = Object.keys(SEED_CANARIES);
  // Ingen custom/temp-filtrering: vi kollar den rad appen FAKTISKT visar (getAirportTzInfo filtrerar
  // inte heller). En inaktuell custom/temp-rad som skuggar en riktig flygplats (t.ex. ESCF='US') fångas.
  const rows = await db.getAllAsync<{ icao: string; country: string }>(
    `SELECT icao, country FROM icao_airports WHERE icao IN (${codes.map(() => '?').join(',')})`,
    codes
  ).catch(() => [] as { icao: string; country: string }[]);
  const byIcao = new Map(rows.map((r) => [r.icao, r.country]));
  for (const [icao, expected] of Object.entries(SEED_CANARIES)) {
    // Saknad kanariefågel ELLER fel land → inaktuell seed.
    if (byIcao.get(icao) !== expected) return true;
  }
  return false;
}

// In-flight-lås: seedIcaoAirports triggas från flera håll (start i _layout, iCloud-restore, och
// fire-and-forget vid premium-byte i flightStore). Utan lås kan två körningar överlappa → två
// samtidiga DELETE/INSERT-transaktioner på samma connection (nested BEGIN / korrupt data / flimmer).
// Alla anropare delar samma pågående löfte → seeden körs alltid till slut, exakt en gång i taget.
let _seedInFlight: Promise<void> | null = null;

export function seedIcaoAirports(premium = false): Promise<void> {
  if (_seedInFlight) return _seedInFlight;
  _seedInFlight = runSeed(premium).finally(() => { _seedInFlight = null; });
  return _seedInFlight;
}

async function runSeed(premium = false): Promise<void> {
  const db = await getDatabase();

  // Check if table already has data
  const tableCount = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM icao_airports`
  ).catch(() => ({ cnt: 0 }));

  const existing = await db.getFirstAsync<{ v: string }>(
    `SELECT value as v FROM settings WHERE key = 'icao_seed_version'`
  ).catch(() => null);

  const versionOk = existing?.v === SEED_VERSION && !!tableCount?.cnt && tableCount.cnt > 0;
  // Även om versionen stämmer: verifiera kanariefåglarna. Fångar enheter som blev "markerade som
  // seedade" med inaktuell data (t.ex. ESCF='US') och därför aldrig självläkt via versionsjämförelsen.
  if (versionOk && !(await seedLooksStale(db))) {
    return;
  }

  const data = await loadAirportData();
  // Skyddsräcke: om asseten inte kunde laddas (tom array) — rör INTE befintliga rader och markera
  // INTE som seedad. Annars skulle vi radera bra data och fastna på en tom/trasig seed.
  if (!Array.isArray(data) || data.length === 0) {
    console.warn('[ICAO] seed aborted: airport data empty/unavailable — keeping existing rows');
    return;
  }

  const BATCH = 200;
  await db.withTransactionAsync(async () => {
    // Version bytt → rensa gamla seed-rader (behåll användarens custom + off-airport) och skriv om berikat.
    await db.runAsync(`DELETE FROM icao_airports WHERE custom = 0 AND COALESCE(temporary, 0) = 0`);
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,0)').join(',');
      const params = chunk.flatMap(([icao, name, country, region, lat, lon, iata, alt, type, municipality, , gps]) =>
        [icao, name, country, region, lat, lon, iata ?? '', alt ?? null, type ?? '', municipality ?? '', gps ?? '', foldDiacritics(name ?? '')]
      );
      // OR REPLACE (inte OR IGNORE): seed-datan är auktoritativ för riktiga ICAO-koder. Skriver över
      // inaktuella custom/temp-rader som skuggar en riktig flygplats (t.ex. ESCF/ESDF felaktigt 'US'
      // med custom=1 som DELETE ovan inte tar bort). Rör bara koder som finns i seed-datan → användarens
      // egna off-airport/custom-platser (egna koder utanför seeden) berörs aldrig.
      await db.runAsync(
        `INSERT OR REPLACE INTO icao_airports (icao, name, country, region, lat, lon, iata, alt, type, municipality, gps, name_norm, custom)
         VALUES ${placeholders}`,
        params
      );
    }
    // Markera seedad INUTI transaktionen → versionen skrivs bara om raderna faktiskt committades.
    // (Tidigare skrevs den utanför → en tyst rollback kunde lämna enheten "seedad" med gammal data.)
    await db.runAsync(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('icao_seed_version', ?)`,
      [SEED_VERSION]
    );
  });
}

// Söker på BÅDE ICAO och IATA + flygplatsnamn. Prioritering överst: exakt ICAO → exakt IATA →
// ICAO-prefix → IATA-prefix → namnträff. nameMinLen: flygplatsnamn matchas först från så många tecken
// (default 5 → de fyra första tecknen reserverade för koder, så IATA/ICAO inte begravs av namnträffar).
export async function searchAirports(query: string, nameMinLen = 5): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  const upper = query.toUpperCase();
  const like = `%${upper}%`, pre = `${upper}%`;
  const foldLike = `%${foldDiacritics(query)}%`; // diakrit-okänslig namnträff ("lulea"↔"Luleå")
  // Koderna matchas som PREFIX (det man skriver är början av ICAO/IATA-koden), namn som delsträng.
  const clauses = ['UPPER(icao) LIKE ?', 'UPPER(iata) LIKE ?'];
  const whereParams: string[] = [pre, pre];
  // Namn matchas både rått (accenttecken man själv skrev) OCH normaliserat (name_norm, seedade rader).
  if (upper.length >= nameMinLen) { clauses.push(`(UPPER(name) LIKE ? OR (name_norm != '' AND name_norm LIKE ?))`); whereParams.push(like, foldLike); }
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
  lat: number, lon: number, limit = 5, degRange = 1.5
): Promise<IcaoAirport[]> {
  const db = await getDatabase();
  // Longituden vägs med cos²(lat) i den grova avstånds-sorteringen så ORDER BY/​LIMIT verkligen fångar
  // de NÄRMASTE raderna (inte en godtycklig delmängd) även när boxen är stor (expanderande sökning).
  const cosL = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const rows = await db.getAllAsync<IcaoAirport>(
    `SELECT * FROM icao_airports
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
       AND (temporary IS NULL OR temporary = 0)
       AND lat != 0 AND lon != 0
     ORDER BY ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?) * ?)
     LIMIT 400`,
    [lat - degRange, lat + degRange, lon - degRange, lon + degRange, lat, lat, lon, lon, cosL * cosL]
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
  // Exclude ZZZZ: an off-airport placeholder is never a site that needs a position on the map.
  return db.getAllAsync<IcaoAirport>(
    "SELECT * FROM icao_airports WHERE temporary = 1 AND icao != 'ZZZZ' AND (lat = 0 OR lon = 0 OR lat IS NULL OR lon IS NULL)"
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
