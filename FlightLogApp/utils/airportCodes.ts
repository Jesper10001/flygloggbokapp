// Koden som VISAS för en flygplats. Flygplatser utan ICAO-kod har OurAirports egna ident som nyckel (RU-8363,
// CH-0004); de visas i stället med sin local_code, annars gps_code (användarens regel 2026-11-19). Nyckeln ändras
// aldrig — flygningar, favoriter och landningar pekar på den. Tabellen byggs av scripts/build-display-codes.mjs.
// Tvetydiga koder (samma som en annan flygplats nyckel/IATA/gps, t.ex. "MCO" = Los Menucos och Orlando) visas,
// men används aldrig för att slå upp en flygplats eller i CSV-exporten.
import table from '../assets/airport-display-codes.json';

const D = (table as { d: Record<string, string>; a: string[] }).d;
const AMBIG = new Set((table as { a: string[] }).a);
let reverse: Map<string, string> | null = null;   // entydig visningskod → nyckel (byggs vid första uppslaget)

/** Koden som visas för en nyckel (eller en redan visningsbar kod, som lämnas orörd). */
export function displayCode(code?: string | null): string {
  const c = String(code ?? '');
  return D[c.toUpperCase()] ?? c;
}

/** Koden som får skrivas in/sparas som text och slås upp igen: visningskoden om den är entydig, annars nyckeln. */
export function safeCode(code?: string | null): string {
  const c = String(code ?? ''), k = c.toUpperCase();
  return D[k] && !AMBIG.has(k) ? D[k] : c;
}

/** Nyckeln för en entydig visningskod ("SP0385" → "BR-0417"), annars null. */
export function keyForDisplayCode(code?: string | null): string | null {
  if (!reverse) {
    reverse = new Map();
    for (const [k, v] of Object.entries(D)) if (!AMBIG.has(k)) reverse.set(v, k);
  }
  return reverse.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

/** Koden i OSINT-lagret (förbandskortet): visningskoden, men aldrig OurAirports egna ident (RU-8363) — då "–". */
export function layerCode(code?: string | null): string {
  const d = displayCode(code);
  return !d || /^[A-Z]{2}-\d+$/.test(d) ? '–' : d;
}
