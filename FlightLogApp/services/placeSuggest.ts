// Förslag på flygplatser när en avläst platskod är okänd eller osäker (skanningen): koder som skiljer sig med
// en bokstav som ofta förväxlas i handskrift (H↔N, A↔H, O↔D, U↔V …) och som finns i flygplatsdatabasen.
// Koder som redan förekommer i skanningen eller i loggboken kommer först. Kod, inte AI → gratis och direkt.

import { getDatabase } from '../db/database';
import { getAirportByIcao, isOffAirportCode } from '../db/icao';

// Bokstäver som förväxlas i handskrivna versaler (åt båda hållen).
const CONFUSABLE: Record<string, string> = {
  H: 'NAKM', N: 'HMAW', A: 'HNR', M: 'NWH', W: 'MVN', U: 'VOW', V: 'UWY', O: 'DQUC', D: 'OB', Q: 'O',
  E: 'FB', F: 'EP', I: 'LT', L: 'I', T: 'IJ', J: 'T', C: 'GO', G: 'CO', K: 'XH', X: 'KY', Y: 'VX',
  B: 'DER', R: 'PAB', P: 'RF', S: 'Z', Z: 'S',
};

/** Alla koder som skiljer sig med en förväxlingsbar bokstav. */
export function confusableVariants(code: string): string[] {
  const c = code.toUpperCase();
  const out: string[] = [];
  for (let i = 0; i < c.length; i++) {
    for (const alt of CONFUSABLE[c[i]] ?? '') {
      const v = c.slice(0, i) + alt + c.slice(i + 1);
      if (v !== c && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/**
 * Upp till `max` riktiga flygplatser som liknar koden. `seen` = hur ofta koder förekommer i skanningen
 * (vanligast först); därefter hur ofta de finns i loggboken.
 */
export async function similarAirports(code: string, seen: Map<string, number>, max = 4): Promise<string[]> {
  const c = (code ?? '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(c) || isOffAirportCode(c)) return [];
  const real: string[] = [];
  for (const v of confusableVariants(c)) {
    try { if (await getAirportByIcao(v)) real.push(v); } catch { /* utan databas: inga förslag */ }
  }
  if (!real.length) return [];
  const flown = new Map<string, number>();
  try {
    const db = await getDatabase();
    const marks = real.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ p: string; n: number }>(
      `SELECT p, COUNT(*) AS n FROM (SELECT dep_place AS p FROM flights WHERE dep_place IN (${marks})
         UNION ALL SELECT arr_place AS p FROM flights WHERE arr_place IN (${marks})) GROUP BY p`,
      [...real, ...real],
    );
    for (const r of rows) flown.set(r.p, r.n);
  } catch { /* rangordna bara efter skanningen */ }
  const score = (v: string) => (seen.get(v) ?? 0) * 1000 + (flown.get(v) ?? 0);
  return real.sort((a, b) => score(b) - score(a)).slice(0, max);
}
