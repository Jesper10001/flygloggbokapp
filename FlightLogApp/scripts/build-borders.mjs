// Genererar FlightLogApp/assets/borders.json (exakta lands-/regiongränser) från Natural Earth.
// Körs vid behov: `node scripts/build-borders.mjs`  (Node 18+, dev-deps: topojson-server/simplify/client)
//
// TOPOLOGI-BEVARANDE: bygger en TopoJSON av admin-1, förenklar delade bågar GEMENSAMT (så grannregioner
// delar exakt samma gränslinje → inga glapp/överlapp, som Apple Maps), och SLÅR IHOP (merge) finare
// enheter till seedens regioner (ex IT-provinser → IT-regioner) så koderna matchar appens r[3].
// Format: { countries: { <ISO2>: rings }, regions: { <ISO3166-2>: rings } }, ring = platt [lon,lat,...].
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify';
import { merge } from 'topojson-client';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'assets', 'borders.json');
const FIX_OUT = join(__dir, '..', 'assets', 'airportRegionFix.json');
const AIRPORTS = join(__dir, '..', 'assets', 'icao-airports.json');
const LOCAL = join(__dir, 'ne-data');
const URLS = {
  admin0: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  admin1: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson',
};
// Länder där Natural Earth är föråldrat → hämta AKTUELLA regioner från geoBoundaries (gbOpen ADM1,
// shapeISO = ISO 3166-2). Ex DR Kongo: NE har 11 gamla provinser, seed/verkligheten har 26 nya (2015).
// media.githubusercontent.com serverar Git-LFS-innehållet (raw ger bara en LFS-pekare).
// Reform-/föråldrade länder där seed-koderna (airportmap.de) inte matchar Natural Earth → använd
// geoBoundaries ADM1 och tilldela flygplatser via PIP (geografi), oberoende av seed-kodernas vintage.
const GEOBOUNDARIES = ['CD', 'KE', 'KZ', 'NO'];
const GB_ISO3 = { CD: 'COD', KE: 'KEN', KZ: 'KAZ', NO: 'NOR' }; // geoBoundaries indexeras på ISO3
const GB_URL = (iso3) => `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1_simplified.geojson`;
const CAP = 160;          // flygplatstak: land delas per region när det överstigs
const SIMPLIFY_Q = 0.1;   // topojson quantile: LÄGRE p = kraftigare generalisering (behåller de mest
                          // signifikanta punkterna). 0.1 = full täckning + topologi-alignade gränser (~1 MB).
const ROUND = 1000;       // 3 decimaler (~100 m)
const MIN_SPAN = 0.12;    // släpp småöar vars bbox < detta (grader)
const MAX_RINGS = 8;      // tak ringar per enhet (håll filen liten)

// Kina: seed = GB/2260-numeriska koder (CN-11), Natural Earth = ISO-alfa (CN-BJ) → remap alfa→num.
const CN_MAP = {
  'CN-BJ': 'CN-11', 'CN-TJ': 'CN-12', 'CN-HE': 'CN-13', 'CN-SX': 'CN-14', 'CN-NM': 'CN-15',
  'CN-LN': 'CN-21', 'CN-JL': 'CN-22', 'CN-HL': 'CN-23', 'CN-SH': 'CN-31', 'CN-JS': 'CN-32',
  'CN-ZJ': 'CN-33', 'CN-AH': 'CN-34', 'CN-FJ': 'CN-35', 'CN-JX': 'CN-36', 'CN-SD': 'CN-37',
  'CN-HA': 'CN-41', 'CN-HB': 'CN-42', 'CN-HN': 'CN-43', 'CN-GD': 'CN-44', 'CN-GX': 'CN-45',
  'CN-HI': 'CN-46', 'CN-CQ': 'CN-50', 'CN-SC': 'CN-51', 'CN-GZ': 'CN-52', 'CN-YN': 'CN-53',
  'CN-XZ': 'CN-54', 'CN-SN': 'CN-61', 'CN-GS': 'CN-62', 'CN-QH': 'CN-63', 'CN-NX': 'CN-64', 'CN-XJ': 'CN-65',
};
// Norge: NE har gamla län; seed 2024-reformens koder → merge/remap (ex Innlandet = Hedmark+Oppland).
const NO_MAP = {
  'NO-01': 'NO-31', 'NO-02': 'NO-32', 'NO-06': 'NO-33', 'NO-04': 'NO-34', 'NO-05': 'NO-34',
  'NO-07': 'NO-39', 'NO-08': 'NO-40', 'NO-09': 'NO-42', 'NO-10': 'NO-42', 'NO-11': 'NO-11',
  'NO-12': 'NO-46', 'NO-14': 'NO-46', 'NO-15': 'NO-15', 'NO-16': 'NO-50', 'NO-17': 'NO-50',
  'NO-18': 'NO-18', 'NO-19': 'NO-55', 'NO-20': 'NO-56', 'NO-03': 'NO-03', 'NO-21': 'NO-21',
};
// GB: geonunit (nation) → seedens 4 nationskoder.
const GB_NAT = { England: 'GB-ENG', Scotland: 'GB-SCT', Wales: 'GB-WLS', 'Northern Ireland': 'GB-NIR' };
// Kod-varianter (NE → seed).
const FIX = {
  'DE-BB': 'DE-BR', 'ZA-LP': 'ZA-NP',
  'ES-ME': 'ES-ML', 'ES-MU': 'ES-MC', 'ES-NA': 'ES-NC', 'ES-LO': 'ES-RI', 'ES-PM': 'ES-IB',
};

// NE-feature → seedens regionkod (eller '' om ej relevant).
function derive(p) {
  const raw = (p.iso_3166_2 || '').toUpperCase();
  const cc = raw.split('-')[0];
  let code;
  if (p.admin === 'United Kingdom') code = GB_NAT[p.geonunit] || '';
  else if (cc === 'CN') code = CN_MAP[raw] || raw;
  else if (cc === 'NO') code = NO_MAP[raw] || '';
  else if (cc === 'IT' || cc === 'FR' || cc === 'ES') code = (p.region_cod || '').trim().replace('.', '-').toUpperCase() || raw;
  else code = raw;
  return FIX[code] || code;
}

// Läsbart regionnamn för en NE-feature. Sammanslagna regioner (IT/FR/ES via region_cod, GB via nation)
// → förälderns namn; annars subdivisionens eget namn.
function deriveName(p, code) {
  const cc = code.split('-')[0];
  if (p.admin === 'United Kingdom') return p.geonunit || p.name || '';
  if (cc === 'IT' || cc === 'FR' || cc === 'ES') return p.region || p.name || '';
  return p.name || '';
}

const iso2 = (p) => (p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2 && p.ISO_A2 !== '-99' ? p.ISO_A2 : p.iso_a2) || '';

async function load(name, url) {
  const local = join(LOCAL, name);
  if (existsSync(local)) { console.log('läser lokalt', local); return JSON.parse(readFileSync(local, 'utf8')); }
  console.log('hämtar', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kunde inte hämta ${url}: ${res.status}`);
  const txt = await res.text();
  try { if (!existsSync(LOCAL)) mkdirSync(LOCAL, { recursive: true }); writeFileSync(local, txt); } catch {} // cacha för snabb iteration
  return JSON.parse(txt);
}

function bboxSpan(ring) {
  let mnx = 180, mny = 90, mxx = -180, mxy = -90;
  for (const [x, y] of ring) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  return Math.max(mxx - mnx, mxy - mny);
}
// Punkt-i-polygon (ray casting) mot full geometri → vilken region ligger en flygplats i?
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function geomContains(geom, x, y) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (!ringContains(poly[0], x, y)) continue;
    let inHole = false;
    for (let k = 1; k < poly.length; k++) if (ringContains(poly[k], x, y)) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}
function bboxCenter(geom) {
  let mnx = 180, mny = 90, mxx = -180, mxy = -90;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) for (const [x, y] of poly[0]) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  return [(mnx + mxx) / 2, (mny + mxy) / 2];
}
// Merge-resultat (GeoJSON Polygon/MultiPolygon) → platta yttre ringar (avrundade, småöar bort, tak).
function geomToRings(geom) {
  if (!geom) return [];
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const out = [];
  for (const poly of polys) {
    const ext = poly[0];
    if (!ext || ext.length < 4 || bboxSpan(ext) < MIN_SPAN) continue;
    const flat = [];
    for (const [lon, lat] of ext) flat.push(Math.round(lon * ROUND) / ROUND, Math.round(lat * ROUND) / ROUND);
    if (flat.length >= 6) out.push(flat);
  }
  out.sort((a, b) => b.length - a.length);
  return out.slice(0, MAX_RINGS);
}

// Bygg en topologi av taggade features (properties._k = grupp-nyckel), förenkla topologi-bevarande,
// slå ihop per nyckel → { nyckel: rings }.
function topoLayer(features) {
  if (!features.length) return {};
  const fc = { type: 'FeatureCollection', features: features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: f.properties })) };
  let topo = topology({ r: fc });
  topo = presimplify(topo, sphericalTriangleArea);
  topo = simplify(topo, quantile(topo, SIMPLIFY_Q));
  const groups = new Map();
  for (const g of topo.objects.r.geometries) {
    const k = g.properties && g.properties._k; if (!k) continue;
    const a = groups.get(k); if (a) a.push(g); else groups.set(k, [g]);
  }
  const out = {};
  for (const [k, geoms] of groups) {
    const rings = geomToRings(merge(topo, geoms));
    if (rings.length) out[k] = rings;
  }
  return out;
}

async function main() {
  // Exkludera closed (type[8]) — de ingår inte i originalpresentationen, ska inte driva regionbehov.
  const seed = JSON.parse(readFileSync(AIRPORTS, 'utf8')).filter((r) => r[8] !== 'closed');
  const perC = new Map();
  for (const r of seed) { const c = r[2]; let e = perC.get(c); if (!e) { e = { n: 0, codes: new Set() }; perC.set(c, e); } e.n++; if (r[3]) e.codes.add(r[3]); }
  const needed = new Map();
  for (const [c, e] of perC) if (e.n > CAP && e.codes.size > 1) needed.set(c, e.codes);

  const [a0, a1] = await Promise.all([load('ne_50m_admin_0_countries.geojson', URLS.admin0), load('ne_10m_admin_1_states_provinces.geojson', URLS.admin1)]);

  // Regioner (Natural Earth): tagga varje relevant admin-1-feature med seedens kod (_k). Hoppa över
  // GEOBOUNDARIES-länder (föråldrade i NE) — de byggs från geoBoundaries nedan.
  // Läsbara regionnamn (kod → namn) för alla byggda regioner → borders.json. regionName() i appen
  // faller tillbaka hit så inga regioner visas som bara siffror (ex UA-30 → "Kyiv").
  const regionNames = {};
  const regFeatures = [];
  for (const f of a1.features) {
    const code = derive(f.properties);
    if (!code || !code.includes('-')) continue;
    const cc = code.split('-')[0];
    if (GEOBOUNDARIES.includes(cc)) continue;
    const want = needed.get(cc);
    if (!want || !want.has(code)) continue;
    regFeatures.push({ geometry: f.geometry, properties: { _k: code } });
    if (!regionNames[code]) { const nm = deriveName(f.properties, code); if (nm) regionNames[code] = nm; }
  }
  const regions = topoLayer(regFeatures);

  // Regioner (geoBoundaries): AKTUELLA provinser för föråldrade/reformerade länder. Bygg ALLA ADM1
  // (ej filtrerat på seed-koder, som kan ha annan vintage) → flygplatser tilldelas via PIP nedan.
  // Egen topologi/simplify per land → interna gränser delas (inga glapp). Samla även läsbara namn.
  const gbFeats = [];
  for (const cc of GEOBOUNDARIES) {
    if (!needed.has(cc)) continue; // bygg bara om landet är över cap
    const gj = await load(`geoBoundaries-${cc}-ADM1.geojson`, GB_URL(GB_ISO3[cc] || cc));
    const feats = [];
    for (const f of gj.features) {
      const code = (f.properties.shapeISO || '').toUpperCase();
      if (!code.includes('-')) continue;
      feats.push({ geometry: f.geometry, properties: { _k: code } });
      gbFeats.push({ cc, code, geometry: f.geometry });
      if (f.properties.shapeName) regionNames[code] = f.properties.shapeName;
    }
    Object.assign(regions, topoLayer(feats));
    console.log(`geoBoundaries ${cc}: ${feats.length} provinser`);
  }

  // Länder: tagga admin-0 med ISO2 (_k), topologi + merge (jämna landskonturer).
  const c0Features = [];
  for (const f of a0.features) {
    const cc = (iso2(f.properties) || '').toUpperCase();
    if (!cc || cc.length !== 2) continue;
    c0Features.push({ geometry: f.geometry, properties: { _k: cc } });
  }
  const countries = topoLayer(c0Features);

  if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
  const payload = { countries, regions, regionNames };
  writeFileSync(OUT, JSON.stringify(payload));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024);
  console.log(`\nSkrev ${OUT}: ${Object.keys(countries).length} länder, ${Object.keys(regions).length} regioner, ~${kb} KB\n`);

  console.log('Täckning per land som delas upp:');
  const report = [...needed.entries()].map(([cc, codes]) => {
    const have = [...codes].filter((c) => regions[c]).length;
    return { cc, need: codes.size, have, miss: codes.size - have };
  }).sort((a, b) => b.miss - a.miss || b.need - a.need);
  for (const r of report) console.log(`  ${r.cc}: ${r.have}/${r.need}` + (r.miss ? `  (saknar ${r.miss})` : ' ✓'));

  // ── Airport→region-fix ────────────────────────────────────────────────────────
  // Flygplatser vars seed-kod SAKNAR border (pseudo/gamla koder: BR-U-A, NO-XX, gamla NO-län osv.)
  // ger en "Other"-grupp vars hull flyter över de riktiga regionerna. Tilldela dem rätt region via
  // punkt-i-polygon mot FULL geometri; hamnar den utanför alla (offshore) → närmaste region-centroid.
  // Skrivs som { icao: kod } och slås in i regionOf() → inga fler överflödande "Other"-hull.
  const fix = {};
  let offshore = 0;
  for (const [cc, want] of needed) {
    const isGb = GEOBOUNDARIES.includes(cc);
    // geoBoundaries-land → alla dess byggda regioner; NE-land → seed-koder som fått border.
    const bounded = new Set(isGb
      ? gbFeats.filter((g) => g.cc === cc && regions[g.code]).map((g) => g.code)
      : [...want].filter((c) => regions[c]));
    if (!bounded.size) continue;
    const feats = (isGb
      ? gbFeats.filter((g) => g.cc === cc && bounded.has(g.code)).map((g) => ({ code: g.code, geom: g.geometry }))
      : a1.features.filter((f) => bounded.has(derive(f.properties))).map((f) => ({ code: derive(f.properties), geom: f.geometry }))
    ).map((f) => ({ ...f, cen: bboxCenter(f.geom) }));
    if (!feats.length) continue;
    for (const r of seed) {
      if (r[2] !== cc) continue;
      // NE-land: rör ej redan korrekt bordade. geoBoundaries-land: PIP-tilldela ALLA (seed-kod kan ha
      // annan vintage → matcha på geografi).
      if (!isGb && r[3] && bounded.has(r[3])) continue;
      const lon = r[5], lat = r[4];
      let code = null;
      for (const f of feats) if (geomContains(f.geom, lon, lat)) { code = f.code; break; }
      if (!code) { offshore++; let best = Infinity; for (const f of feats) { const d = (f.cen[0] - lon) ** 2 + (f.cen[1] - lat) ** 2; if (d < best) { best = d; code = f.code; } } }
      if (code && code !== r[3]) fix[r[0]] = code; // skriv bara när det ändrar seed-koden
    }
  }
  writeFileSync(FIX_OUT, JSON.stringify(fix));
  console.log(`\nSkrev ${FIX_OUT}: ${Object.keys(fix).length} airport→region-fixar (varav ${offshore} via närmaste, utanför alla polygoner)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
