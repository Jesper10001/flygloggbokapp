// Exakta lands-/regiongränser (paketerad GeoJSON → assets/borders.json). Apple Maps exponerar inte
// sina inbyggda gränser via API:t, så vi ritar egen data som polygoner. Filen genereras av
// scripts/build-borders.mjs; saknas data för en kod → null → anroparen faller tillbaka på convex-hull.
// Format: { countries: { <ISO2>: rings }, regions: { <ISO3166-2>: rings } }, ring = platt [lon,lat,...].
export type LL = { latitude: number; longitude: number };
type BordersData = { countries: Record<string, number[][]>; regions: Record<string, number[][]>; regionNames?: Record<string, string> };

let _data: BordersData | null | undefined;
function data(): BordersData | null {
  if (_data === undefined) {
    try { _data = require('../assets/borders.json'); } catch { _data = null; }
  }
  return _data ?? null;
}

const _cache = new Map<string, LL[][] | null>();
function toRings(flatRings: number[][] | undefined): LL[][] | null {
  if (!flatRings || !flatRings.length) return null;
  const out: LL[][] = [];
  for (const flat of flatRings) {
    const ring: LL[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ latitude: flat[i + 1], longitude: flat[i] });
    if (ring.length >= 3) out.push(ring);
  }
  return out.length ? out : null;
}

/** Exakt landsgräns (flera ringar för öar) — null om data saknas. */
export function countryBorder(cc: string): LL[][] | null {
  const key = `c:${cc}`;
  if (_cache.has(key)) return _cache.get(key) ?? null;
  const v = toRings(data()?.countries?.[cc]);
  _cache.set(key, v);
  return v;
}

/** Exakt regiongräns (ISO 3166-2, ex "US-CA") — null om data saknas. */
export function regionBorder(code: string): LL[][] | null {
  const key = `r:${code}`;
  if (_cache.has(key)) return _cache.get(key) ?? null;
  const v = toRings(data()?.regions?.[code]);
  _cache.set(key, v);
  return v;
}

/** Läsbart regionnamn för geoBoundaries-regioner (borders.json regionNames) — annars undefined. */
export function regionDisplayName(code: string): string | undefined {
  return data()?.regionNames?.[code];
}

// Airport→region-korrigering (assets/airportRegionFix.json): flygplatser vars seed-regionkod saknar
// border (pseudo/gamla koder, ex BR-U-A, NO-XX) → geografiskt rätt region (byggd med punkt-i-polygon).
// Utan detta bildar de en "Other"-grupp vars hull flyter över de riktiga regionerna.
let _fix: Record<string, string> | null | undefined;
export function airportRegionFix(icao: string): string | undefined {
  if (_fix === undefined) {
    try { _fix = require('../assets/airportRegionFix.json'); } catch { _fix = null; }
  }
  return _fix?.[icao];
}
