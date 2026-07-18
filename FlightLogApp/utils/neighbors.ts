// Grannländer för globala kartan: när man valt ett land visas kringliggande länders gränser (cyan
// hulls) + klickbara chip, så man kan hoppa till ett grannland utan att gå tillbaka till världsvyn.
// Statiskt (beräknas en gång per land) → ingen markör-churn, kraschsäkert.
import type { SeedRow } from '../components/GlobalAirportMap';
import { hullOf, type LL } from './regionDrill';
import { countryNameFull } from '../constants/countryNames';

export type NeighborCountry = { cc: string; label: string; count: number; lat: number; lon: number; hull: LL[] };

/** Länder vars flygplatser ligger i en utökad ram runt `cc` (närmast först, max `maxN`). */
export function neighborCountries(seed: SeedRow[], cc: string, maxN = 8): NeighborCountry[] {
  // Landets bounds.
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180, n = 0;
  for (const r of seed) {
    if (r[2] !== cc) continue;
    minLa = Math.min(minLa, r[4]); maxLa = Math.max(maxLa, r[4]);
    minLo = Math.min(minLo, r[5]); maxLo = Math.max(maxLo, r[5]); n++;
  }
  if (!n) return [];
  // Utökad ram (×0.6 av spannet åt varje håll). Antimeridian-spann → hoppa över (grannlogik opålitlig där).
  if (maxLo - minLo > 180) return [];
  const mLat = Math.max(2, (maxLa - minLa) * 0.6), mLon = Math.max(2, (maxLo - minLo) * 0.6);
  const latMin = minLa - mLat, latMax = maxLa + mLat, lonMin = minLo - mLon, lonMax = maxLo + mLon;

  // Andra länders flygplatser i ramen, grupperat per land.
  const byCC = new Map<string, SeedRow[]>();
  for (const r of seed) {
    if (r[2] === cc) continue;
    if (r[4] >= latMin && r[4] <= latMax && r[5] >= lonMin && r[5] <= lonMax) {
      const a = byCC.get(r[2]); if (a) a.push(r); else byCC.set(r[2], [r]);
    }
  }
  // Ranka efter hur NÄRA grannen kommer landets bounding-box (0 = tangerar) → äkta landgrannar först,
  // före länder tvärs över hav (deras flygplatser ligger längre från kanten). Centroid för markören.
  const distToBox = (la: number, lo: number) => {
    const dLa = Math.max(0, minLa - la, la - maxLa), dLo = Math.max(0, minLo - lo, lo - maxLo);
    return Math.sqrt(dLa * dLa + dLo * dLo);
  };
  const cand: { cc: string; rows: SeedRow[]; lat: number; lon: number; dist: number }[] = [];
  for (const [ncc, rows] of byCC) {
    if (rows.length < 2) continue; // strunta i enstaka spridda punkter (t.ex. avlägsna öar)
    let la = 0, lo = 0, near = Infinity;
    for (const r of rows) { la += r[4]; lo += r[5]; near = Math.min(near, distToBox(r[4], r[5])); }
    la /= rows.length; lo /= rows.length;
    cand.push({ cc: ncc, rows, lat: la, lon: lo, dist: near });
  }
  cand.sort((a, b) => a.dist - b.dist);
  return cand.slice(0, maxN).map((c) => ({
    cc: c.cc, label: countryNameFull(c.cc), count: c.rows.length, lat: c.lat, lon: c.lon, hull: hullOf(c.rows),
  }));
}
