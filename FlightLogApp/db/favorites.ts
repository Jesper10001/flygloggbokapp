// Favoritmarkerade flygplatser (egen tabell → överlever om-seed av icao_airports). Nås via
// "Favorites"-knappen på globala kartan; ikon på flygplatskortet togglar.
import { getDatabase } from './database';

export async function getFavoriteIcaos(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string }>('SELECT icao FROM favorite_airports').catch(() => []);
  return rows.map((r) => r.icao);
}

export async function setFavorite(icao: string, fav: boolean): Promise<void> {
  const db = await getDatabase();
  if (fav) await db.runAsync('INSERT OR IGNORE INTO favorite_airports (icao) VALUES (?)', [icao.toUpperCase()]);
  else await db.runAsync('DELETE FROM favorite_airports WHERE icao = ?', [icao.toUpperCase()]);
}
