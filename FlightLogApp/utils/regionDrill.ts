// Region-drill-down på kartan (ersätter den gamla land-listan). En nod definieras av sin GEOGRAFISKA
// scope (land + ev. ISO-region + halvplans-snitt) — INTE av en fryst flygplatsuppsättning. Nodens
// flygplatser härleds live ur det aktuella (filtrerade) urvalet, så att man kan redigera filter och
// stanna kvar på samma plats. Är noden ≤ CAP flygplatser → ICAO-pins; annars delas den i delnoder
// med markör (etikett + antal) + cyan convex-hull:
//   land       → grupp per ISO-region (r[3]), etikett regionName()
//   region/geo → antal avgör: ≤ 2·CAP → North/South (2), annars NW/NE/SW/SE (4); rekursivt tills ≤ CAP
import type { SeedRow } from '../components/GlobalAirportMap';
import { concaveHull, smoothRing } from './geoHull';
import { regionName } from '../constants/isoRegions';
import { REGION_OVERRIDES, HULL_EXCLUDE } from '../constants/regionFixes';

/** Regionkod med kurerad override (rättar äkta mislabels, ex FANX → ZA-WC). */
export function regionOf(r: SeedRow): string { return REGION_OVERRIDES[r[0]] ?? r[3]; }

// Under detta → visa ICAO-pins direkt. Över → dela geografiskt: ≤ 2·CAP → North/South, annars kvadranter
// (ex Ontario 613 → ~153×4, ligger under 160 → 4 löv). Håller antalet samtidiga egna markörvyer säkert.
export const DRILL_CAP = 160;

export type LL = { latitude: number; longitude: number };
export type Cut = { axis: 4 | 5; gte: boolean; value: number }; // gte:true → r[axis] >= value, annars <
export type DrillNode = {
  key: string;                                    // path-baserad, unik
  label: string;
  kind: 'country' | 'region' | 'quad';
  base: string;                                   // regionnamn för etikettkomposition
  cc: string;                                     // land
  region: string | null;                          // ISO-regionkod-begränsning (r[3]); null = ingen
  cuts: Cut[];                                     // geografiska halvplans-snitt
};
export type DrillChild = { node: DrillNode; count: number; lat: number; lon: number; hull: LL[] };

/** Predikat: hör raden till nodens scope? (land + ev. regionkod + alla cuts). */
export function nodeScope(node: DrillNode): (r: SeedRow) => boolean {
  return (r) => {
    if (r[2] !== node.cc) return false;
    if (node.region !== null && regionOf(r) !== node.region) return false;
    for (const c of node.cuts) { const v = r[c.axis]; if (c.gte ? v < c.value : v >= c.value) return false; }
    return true;
  };
}
/** Nodens flygplatser ur det aktuella (filtrerade) urvalet. */
export function nodeAirports(node: DrillNode, seed: SeedRow[]): SeedRow[] {
  return seed.filter(nodeScope(node));
}

/** Rotnod för ett land (scope = hela landet). */
export function countryRoot(cc: string, label: string): DrillNode {
  return { key: cc, label, kind: 'country', base: label, cc, region: null, cuts: [] };
}

// Korsar raderna antimeridianen (lon-spann > 180°, ex Chukotka)? → veckla ut negativa lon (+360).
function crossesAntimeridian(rows: SeedRow[]): boolean {
  let mn = 180, mx = -180;
  for (const r of rows) { if (r[5] < mn) mn = r[5]; if (r[5] > mx) mx = r[5]; }
  return mx - mn > 180;
}
function centroid(rows: SeedRow[]): { lat: number; lon: number } {
  const wrap = crossesAntimeridian(rows);
  let la = 0, lo = 0;
  for (const r of rows) { la += r[4]; lo += wrap && r[5] < 0 ? r[5] + 360 : r[5]; }
  let lon = lo / rows.length; if (lon > 180) lon -= 360;
  return { lat: la / rows.length, lon };
}
const HULL_SAMPLE = 180; // nedsampling före hull (prestanda; formen påverkas försumbart)
const HULL_NN_CAP = 400; // spik-borttagning (O(n²)) körs bara upp till denna storlek

/** Region-gräns som {latitude,longitude}-ring (concave hull), robust mot spikande outliers. */
export function hullOf(rows: SeedRow[]): LL[] {
  if (rows.length < 3) return [];
  // 1) Hårdkodad exkludering (antimeridian-kluster som självkalibreringen missar).
  let pts = rows.filter((r) => !HULL_EXCLUDE.has(r[0]));
  // Antimeridian (ex Chukotka): veckla ut negativa lon (+360) så alla beräkningar blir kontinuerliga
  // — annars tror algoritmen att +179° och -179° är ~358° isär och ritar hullen "långa vägen" runt
  //   jorden. Vecklas tillbaka vid output (>180 → -360) så polygonen ritas rätt över datumgränsen.
  const wrap = crossesAntimeridian(pts);
  const lonU = (lo: number) => (wrap && lo < 0 ? lo + 360 : lo);
  // 2) Självkalibrerande spik-borttagning: en punkt vars närmaste egen-region-granne är onormalt
  //    långt bort (jfr regionens median-avstånd) drar iväg hullen → uteslut. Rör inte gränsflygplatser
  //    (de har nära grannar) och över-klipper inte glesa regioner (tröskeln skalar med median).
  if (pts.length >= 4 && pts.length <= HULL_NN_CAP) {
    const nn = pts.map((a, i) => {
      let m = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue; const b = pts[j];
        const dla = a[4] - b[4], dlo = (lonU(a[5]) - lonU(b[5])) * Math.cos(a[4] * Math.PI / 180);
        const dd = dla * dla + dlo * dlo; if (dd < m) m = dd;
      }
      return Math.sqrt(m) * 111;
    });
    const thr = Math.max(200, 4 * median(nn));
    const kept = pts.filter((_, i) => nn[i] <= thr);
    if (kept.length >= 3) pts = kept;
  }
  if (pts.length < 3) pts = rows;
  // 3) Nedsampling för prestanda.
  let sample = pts;
  if (pts.length > HULL_SAMPLE) {
    sample = []; const step = pts.length / HULL_SAMPLE;
    for (let i = 0; i < pts.length; i += step) sample.push(pts[Math.floor(i)]);
  }
  // 4) Concave hull (rundar konkava regioner; convex fallback internt), sedan Chaikin-utjämning
  //    så gränsen blir mjuk i stället för hackig/lobig. Beräknas i utvecklad lon, vecklas tillbaka.
  const h = concaveHull(sample.map((r) => ({ lat: r[4], lon: lonU(r[5]) })));
  const smooth = smoothRing(h, 2);
  return smooth.map((p) => ({ latitude: p.lat, longitude: p.lon > 180 ? p.lon - 360 : p.lon }));
}
function toChild(node: DrillNode, rows: SeedRow[]): DrillChild {
  const c = centroid(rows);
  return { node, count: rows.length, lat: c.lat, lon: c.lon, hull: hullOf(rows) };
}
function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function byRegion(node: DrillNode, airports: SeedRow[]): DrillChild[] {
  const groups = new Map<string, SeedRow[]>();
  for (const r of airports) { const k = regionOf(r) || ''; const a = groups.get(k); if (a) a.push(r); else groups.set(k, [r]); }
  if (groups.size <= 1) return geoSplit(node, airports); // inga meningsfulla regionkoder → geografisk split
  return [...groups.entries()].map(([code, rows]) => {
    const label = code ? regionName(code) : 'Other';
    const child: DrillNode = { key: `${node.key}/${code || 'none'}`, label, kind: 'region', base: label, cc: node.cc, region: code, cuts: [] };
    return toChild(child, rows);
  }).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
}

function geoChild(parent: DrillNode, id: string, label: string, extra: Cut[], rows: SeedRow[]): DrillChild {
  const node: DrillNode = { key: `${parent.key}/${id}`, label, kind: 'quad', base: parent.base, cc: parent.cc, region: parent.region, cuts: parent.cuts.concat(extra) };
  return toChild(node, rows);
}

function northSouth(node: DrillNode, airports: SeedRow[]): DrillChild[] {
  const med = median(airports.map((r) => r[4]));
  const north = airports.filter((r) => r[4] >= med), south = airports.filter((r) => r[4] < med);
  return [
    geoChild(node, 'N', `North ${node.base}`, [{ axis: 4, gte: true, value: med }], north),
    geoChild(node, 'S', `South ${node.base}`, [{ axis: 4, gte: false, value: med }], south),
  ].filter((c) => c.count > 0);
}

function quadrants(node: DrillNode, airports: SeedRow[]): DrillChild[] {
  const medLat = median(airports.map((r) => r[4]));
  const north = airports.filter((r) => r[4] >= medLat), south = airports.filter((r) => r[4] < medLat);
  const medLonN = north.length ? median(north.map((r) => r[5])) : 0;
  const medLonS = south.length ? median(south.map((r) => r[5])) : 0;
  const nw = north.filter((r) => r[5] < medLonN), ne = north.filter((r) => r[5] >= medLonN);
  const sw = south.filter((r) => r[5] < medLonS), se = south.filter((r) => r[5] >= medLonS);
  return [
    geoChild(node, 'NW', `NW ${node.base}`, [{ axis: 4, gte: true, value: medLat }, { axis: 5, gte: false, value: medLonN }], nw),
    geoChild(node, 'NE', `NE ${node.base}`, [{ axis: 4, gte: true, value: medLat }, { axis: 5, gte: true, value: medLonN }], ne),
    geoChild(node, 'SW', `SW ${node.base}`, [{ axis: 4, gte: false, value: medLat }, { axis: 5, gte: false, value: medLonS }], sw),
    geoChild(node, 'SE', `SE ${node.base}`, [{ axis: 4, gte: false, value: medLat }, { axis: 5, gte: true, value: medLonS }], se),
  ].filter((c) => c.count > 0);
}

// Geografisk split: antal avgör 2 (North/South) eller 4 (kvadranter) så varje del hamnar ~≤ CAP.
function geoSplit(node: DrillNode, airports: SeedRow[]): DrillChild[] {
  return airports.length <= 2 * DRILL_CAP ? northSouth(node, airports) : quadrants(node, airports);
}

/** Delnoder för en nod som är för stor (> CAP) — beräknas live ur nodens aktuella flygplatser. */
export function buildChildren(node: DrillNode, airports: SeedRow[]): DrillChild[] {
  if (node.kind === 'country') return byRegion(node, airports);
  return geoSplit(node, airports); // 'region' + geo-noder → 2 eller 4 beroende på antal (rekursivt)
}
