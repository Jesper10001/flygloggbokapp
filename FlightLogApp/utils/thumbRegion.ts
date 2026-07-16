// Väljer den kontinent där flest (besökta) flygplatser ligger och returnerar en region som ramar
// in den + raderna i den kontinenten. Används för de små kart-thumbnailsen på dashboard-knapparna.
import { continentForCountry } from '../constants/continents';

type SeedRow = [string, string, string, string, number, number];
export type ThumbRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

const DEFAULT: ThumbRegion = { latitude: 20, longitude: 0, latitudeDelta: 80, longitudeDelta: 80 };

export function topContinentThumb(rows: SeedRow[]): { region: ThumbRegion; rows: SeedRow[] } {
  const valid = rows.filter((r) => isFinite(r[4]) && isFinite(r[5]) && !(r[4] === 0 && r[5] === 0));
  if (!valid.length) return { region: DEFAULT, rows: [] };

  const byCont = new Map<string, SeedRow[]>();
  for (const r of valid) {
    const cont = continentForCountry(r[2]) ?? '??';
    const arr = byCont.get(cont); if (arr) arr.push(r); else byCont.set(cont, [r]);
  }
  let best: SeedRow[] = valid, bestN = -1;
  for (const arr of byCont.values()) if (arr.length > bestN) { bestN = arr.length; best = arr; }

  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const r of best) { minLa = Math.min(minLa, r[4]); maxLa = Math.max(maxLa, r[4]); minLo = Math.min(minLo, r[5]); maxLo = Math.max(maxLo, r[5]); }
  const region: ThumbRegion = {
    latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2,
    latitudeDelta: Math.max(5, (maxLa - minLa) * 1.5 + 5),
    longitudeDelta: Math.max(5, (maxLo - minLo) * 1.5 + 5),
  };
  return { region, rows: best };
}
