// Genererar FlightLogApp/assets/country-outlines.json: landskonturer för Visited airports (guldkonturen när man
// väljer ett land). Separat från borders.json (Global maps regionsdrill, grövre för att hålla den filen liten):
// här Natural Earth 50m admin-0, förenklad lagom (Douglas–Peucker ~1 km) så att kusten följer kartan. Appen
// rundar av hörnen när den ritar (utils/countryOutline.ts).
// Kör: node scripts/build-country-outlines.mjs   (läser scripts/ne-data/ne_50m_admin_0_countries.geojson)
// Format: { <ISO2>: [ [lon,lat,lon,lat,…], … ] }, yttre ringar, 3 decimaler.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dir, 'ne-data', 'ne_50m_admin_0_countries.geojson');
const OUT = join(__dir, '..', 'assets', 'country-outlines.json');
const TOL = 0.01;        // grader (~1 km): Douglas–Peucker
const MIN_SPAN = 0.06;   // öar mindre än så (grader) tas inte med
const MAX_RINGS = 60;    // största ringarna per land

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      // Sluten ring (första = sista punkten): avståndet till punkten i stället för till linjen.
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const gj = JSON.parse(readFileSync(SRC, 'utf8'));
const out = {};
let points = 0;
for (const f of gj.features) {
  const p = f.properties || {};
  let cc = [p.ISO_A2, p.ISO_A2_EH, p.WB_A2].find((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c));
  if (!cc) continue;
  const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  const rings = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    const xs = outer.map((c) => c[0]), ys = outer.map((c) => c[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (span < MIN_SPAN) continue;
    const simple = dp(outer, TOL);
    if (simple.length < 4) continue;
    rings.push({ span, flat: simple.flatMap(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) });
  }
  rings.sort((a, b) => b.span - a.span);
  const kept = rings.slice(0, MAX_RINGS).map((r) => r.flat);
  if (!kept.length) continue;
  out[cc] = (out[cc] || []).concat(kept);
  points += kept.reduce((s, r) => s + r.length / 2, 0);
}
writeFileSync(OUT, JSON.stringify(out));
console.log(`${Object.keys(out).length} länder, ${points} punkter, ${(statSync(OUT).size / 1024).toFixed(0)} kB → ${OUT}`);
for (const cc of ['SE', 'NO', 'DE', 'DK', 'FR', 'GB']) console.log(cc, out[cc] ? `${out[cc].length} ringar, ${out[cc].reduce((s, r) => s + r.length / 2, 0)} punkter` : 'saknas');
