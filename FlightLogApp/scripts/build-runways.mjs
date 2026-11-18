// Genererar assets/runway-geo.json — bankoordinater + mått per bana, grupperat per flygplats-ident.
// Källor: OurAirports (public domain) och OpenStreetMap (© OpenStreetMap contributors, ODbL).
//   1. OurAirports ger grunden (som förut).
//   2. OpenStreetMap rättar läget: varje OA-bana som har en motsvarighet i OSM (samma flygplats, samma riktning,
//      nära) får OSM:s ändpunkter. OSM är ritat efter flygbilder och stämmer med satellitbilden; OA-trösklar
//      ligger ibland tiotals–hundratals meter fel (t.ex. ENOP). Banbeteckningen behålls från OA.
//   3. Flygplatser i seeden som saknar bandata i OA får OSM:s banor.
//   Flygplatser som saknas i OSM behåller OA-datan oförändrad.
// OSM-banorna hämtas först: node scripts/fetch-osm-runways.mjs  (→ scripts/osm-data/runways.json)
// Körs manuellt vid behov:  node scripts/build-runways.mjs
//
// Format (kompakt tuple per bana):
//   { "ESSA": [ [leIdent, heIdent, leLat, leLon, heLat, heLon, widthM, lengthM], ... ], ... }
// Koordinater 5 decimaler (~1 m). Mått i meter (avrundat). Stängda banor + banor utan
// tröskelkoordinater hoppas över. Nyckeln = flygplatsens nyckel i vår seed (oa-keys.mjs — kör
// build-airports.mjs först), annars OA-ident. `--refresh` hämtar om källfilen (annars cachen).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedKeyMapper } from './oa-keys.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.RUNWAY_OUT || path.join(__dirname, '..', 'assets', 'runway-geo.json');   // RUNWAY_OUT: provkörning till annan fil
const URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const CACHE = path.join(__dirname, 'runways.csv'); // lokal cache (gitignoreas)

function parseCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

async function getCsv() {
  if (!process.argv.includes('--refresh') && fs.existsSync(CACHE)) { console.log('Använder cache:', CACHE); return fs.readFileSync(CACHE, 'utf8'); }
  console.log('Hämtar', URL, '…');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Hämtning misslyckades: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(CACHE, text);
  return text;
}

const raw = await getCsv();
const lines = raw.split(/\r?\n/).filter(Boolean);
const rows = lines.slice(1).map(parseCsv);

const seedKey = seedKeyMapper();
const data = {};
let total = 0, kept = 0;
for (const r of rows) {
  total++;
  const oaIdent = (r[2] || '').trim().toUpperCase();
  const ident = seedKey(oaIdent) ?? oaIdent;
  const lenFt = num(r[3]), widFt = num(r[4]), closed = r[7] === '1';
  const leId = r[8], leLat = num(r[9]), leLon = num(r[10]);
  const heId = r[14], heLat = num(r[15]), heLon = num(r[16]);
  if (!ident || closed) continue;
  if (leLat == null || leLon == null || heLat == null || heLon == null) continue;
  if (leLat === 0 && leLon === 0) continue;
  const tuple = [
    (leId || '').trim(), (heId || '').trim(),
    +leLat.toFixed(5), +leLon.toFixed(5), +heLat.toFixed(5), +heLon.toFixed(5),
    widFt ? Math.round(widFt * 0.3048) : 0,
    lenFt ? Math.round(lenFt * 0.3048) : 0,
  ];
  (data[ident] ||= []).push(tuple);
  kept++;
}

// ── OpenStreetMap ──────────────────────────────────────────────────────────────
const OSM = process.env.OSM_RUNWAYS || path.join(__dirname, 'osm-data', 'runways.json');
const SEED = path.join(__dirname, '..', 'assets', 'icao-airports.dat');
if (fs.existsSync(OSM)) {
  const osmWays = JSON.parse(fs.readFileSync(OSM, 'utf8'));
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const R = 6371000, rad = Math.PI / 180;
  const xy = (lat, lon, lat0) => [lon * rad * R * Math.cos(lat0 * rad), lat * rad * R];   // lokalt plan (meter)
  const bearing = (a, b) => { const k = Math.cos(((a.lat + b.lat) / 2) * rad); return ((Math.atan2((b.lon - a.lon) * k, b.lat - a.lat) / rad) + 360) % 360; };
  const angDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  const axisDiff = (a, b) => { const d = angDiff(a, b); return Math.min(d, 180 - d); };   // oriktad (banan åt båda hållen)
  const distM = (a, b) => { const [ax, ay] = xy(a.lat, a.lon, a.lat), [bx, by] = xy(b.lat, b.lon, a.lat); return Math.hypot(bx - ax, by - ay); };
  const segDist = (p, a, b) => {   // punkt → sträcka, meter
    const [px, py] = xy(p.lat, p.lon, p.lat), [ax, ay] = xy(a.lat, a.lon, p.lat), [bx, by] = xy(b.lat, b.lon, p.lat);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const parseWidth = (v) => { const m = /^\s*([\d.]+)\s*(m|ft|')?/.exec(String(v || '')); if (!m) return 0; const n = parseFloat(m[1]) * (m[2] && m[2] !== 'm' ? 0.3048 : 1); return n >= 5 && n <= 120 ? Math.round(n) : 0; };
  const pad = (s) => { const m = /^(\d{1,2})([LRC]?)$/.exec(s); return m ? m[1].padStart(2, '0') + m[2] : null; };
  const recip = (s) => { const m = /^(\d{2})([LRC]?)$/.exec(s); if (!m) return null; let n = (Number(m[1]) + 18) % 36; if (n === 0) n = 36; return String(n).padStart(2, '0') + ({ L: 'R', R: 'L', C: 'C' }[m[2]] ?? ''); };

  // Banorna ur OSM: linjer (inte ytor), inte nedlagda eller på vatten.
  const runways = [];
  for (const w of osmWays) {
    const t = w.tags || {}, g = w.geometry || [];
    if (g.length < 2) continue;
    const P = { lat: g[0].lat, lon: g[0].lon }, Q = { lat: g[g.length - 1].lat, lon: g[g.length - 1].lon };
    if (g.length > 3 && distM(P, Q) < 5) continue;   // sluten yta
    if (t.disused === 'yes' || t.abandoned === 'yes' || /^(water)$/.test(t.surface || '')) continue;
    if (/^(blast_pad|stopway|overrun)$/.test(t.runway || '')) continue;   // förlängningar utan landningsyta
    const dt = t.runway === 'displaced_threshold';   // förskjuten tröskel: del av banans yta, slås ihop med banan nedan
    const len = distM(P, Q);
    if (len < 100) continue;
    let le = null, he = null;
    const m = /^\s*(\d{1,2}[LRC]?)\s*(?:\/|-)\s*(\d{1,2}[LRC]?)\s*$/i.exec(t.ref || '');
    const single = /^\s*(\d{1,2}[LRC]?)\s*$/i.exec(t.ref || '');
    if (m) { const a = pad(m[1].toUpperCase()), b = pad(m[2].toUpperCase()); if (a && b) { [le, he] = Number(a.slice(0, 2)) <= Number(b.slice(0, 2)) ? [a, b] : [b, a]; } }
    else if (single) { const a = pad(single[1].toUpperCase()); const b = a && recip(a); if (a && b) [le, he] = Number(a.slice(0, 2)) <= Number(b.slice(0, 2)) ? [a, b] : [b, a]; }
    const brg = bearing(P, Q);
    if (!le) {   // utan beteckning: härled ur riktningen
      let n = Math.round(brg / 10) % 36; if (n === 0) n = 36;
      const a = String(n).padStart(2, '0'), b = recip(a);
      [le, he] = Number(a) <= Number(b) ? [a, b] : [b, a];
    }
    // Vilken ände är "le": därifrån pekar banan mot le × 10° (magnetiskt; ±90° räcker).
    const leFirst = angDiff(brg, Number(le.slice(0, 2)) * 10) <= 90;
    runways.push({ id: w.id, le, he, leP: leFirst ? P : Q, heP: leFirst ? Q : P, axis: brg, len, width: parseWidth(t.width), surface: t.surface || '', mid: { lat: (P.lat + Q.lat) / 2, lon: (P.lon + Q.lon) / 2 }, hasRef: !!(m || single) && !dt, dt });
  }

  // Delade banor → en bana från ytterändarna (görs före kopplingen till flygplatser: ytterbitarna kan ligga längre
  // än 2,5 km från flygplatsens punkt, t.ex. VIDP 11R/29L). OSM delar ofta en bana i flera bitar (förskjutna trösklar, bitar med
  // olika yta). Bitar slås ihop när de ligger i linje (axel < 8°, högst 30 m i sidled), nuddar varandra (< 150 m) och
  // inte har olika beteckningar; upprepas tills inget mer går ihop, så ordningen spelar ingen roll. En förskjuten
  // tröskel som inte hör till någon bana tas bort.
  const lateral = (p, a, b) => {   // punkt → linjen genom a–b, meter
    const [px, py] = xy(p.lat, p.lon, a.lat), [ax, ay] = xy(a.lat, a.lon, a.lat), [bx, by] = xy(b.lat, b.lon, a.lat);
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    return Math.abs((px - ax) * dy - (py - ay) * dx) / l;
  };
  const joinable = (a, b) => {
    if (axisDiff(a.axis, b.axis) >= 8) return false;
    if (a.hasRef && b.hasRef && `${a.le}/${a.he}` !== `${b.le}/${b.he}`) return false;
    const touch = Math.min(distM(a.leP, b.leP), distM(a.leP, b.heP), distM(a.heP, b.leP), distM(a.heP, b.heP)) < 150;
    if (!touch) return false;
    const [L, S] = a.len >= b.len ? [a, b] : [b, a];
    return lateral(S.leP, L.leP, L.heP) < 30 && lateral(S.heP, L.leP, L.heP) < 30;
  };
  const score = (r) => (r.dt ? 0 : 2) + (r.hasRef ? 1 : 0);
  const absorb = (keep, drop) => {
    const pts = [keep.leP, keep.heP, drop.leP, drop.heP];
    let A = pts[0], B = pts[1], far = 0;
    for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) { const d = distM(pts[x], pts[y]); if (d > far) { far = d; A = pts[x]; B = pts[y]; } }
    if (!keep.hasRef && drop.hasRef) { keep.le = drop.le; keep.he = drop.he; keep.hasRef = true; }
    const leFirst = angDiff(bearing(A, B), Number(keep.le.slice(0, 2)) * 10) <= 90;
    keep.leP = leFirst ? A : B; keep.heP = leFirst ? B : A; keep.len = far; keep.axis = bearing(keep.leP, keep.heP);
    keep.mid = { lat: (A.lat + B.lat) / 2, lon: (A.lon + B.lon) / 2 };
    keep.width = keep.width || drop.width;
    keep.surface = keep.surface || drop.surface;
    keep.dt = keep.dt && drop.dt;
  };
  const ECELL = 0.01;
  for (let merged = true; merged; ) {
    merged = false;
    const egrid = new Map();
    const ek = (p) => `${Math.floor(p.lat / ECELL)}|${Math.floor(p.lon / ECELL)}`;
    runways.forEach((r, idx) => { if (r.dead) return; for (const p of [r.leP, r.heP]) { const k = ek(p); (egrid.get(k) || egrid.set(k, []).get(k)).push(idx); } });
    for (let idx = 0; idx < runways.length; idx++) {
      const a = runways[idx];
      if (a.dead) continue;
      const near = new Set();
      for (const p of [a.leP, a.heP]) {
        const ci = Math.floor(p.lat / ECELL), cj = Math.floor(p.lon / ECELL);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const j of egrid.get(`${ci + di}|${cj + dj}`) || []) if (j !== idx) near.add(j);
      }
      for (const j of near) {
        const b = runways[j];
        if (b.dead || a.dead || !joinable(a, b)) continue;
        const [keep, drop] = score(a) > score(b) || (score(a) === score(b) && a.len >= b.len) ? [a, b] : [b, a];
        absorb(keep, drop);
        drop.dead = true;
        merged = true;
      }
    }
  }
  // En lång "tröskel" som inte gick ihop med något är en felmärkt bana (t.ex. LHDC 04R/22L) och behålls.
  const merged = runways.filter((r) => !r.dead && (!r.dt || r.len >= 800));

  // Varje OSM-bana → närmaste flygplats i seeden (avstånd från flygplatsens punkt till banan, max 2,5 km).
  const CELL = 0.1, grid = new Map();
  const cellKey = (lat, lon) => `${Math.floor(lat / CELL)}|${Math.floor(lon / CELL)}`;
  for (const r of seed) {
    if (!Number.isFinite(r[4]) || !Number.isFinite(r[5]) || r[8] === 'heliport' || r[8] === 'balloonport') continue;
    const k = cellKey(r[4], r[5]); (grid.get(k) || grid.set(k, []).get(k)).push(r);
  }
  const byAirport = new Map();
  for (const rw of merged) {
    let best = null, bestD = 2500;
    const ci = Math.floor(rw.mid.lat / CELL), cj = Math.floor(rw.mid.lon / CELL);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const a of grid.get(`${ci + di}|${cj + dj}`) || []) {
        // En nedlagd flygplats får bara banan om ingen aktiv ligger nära (annars kan den ta grannens bana).
        const d = segDist({ lat: a[4], lon: a[5] }, rw.leP, rw.heP) + (a[8] === 'closed' ? 1500 : 0);
        if (d < bestD) { bestD = d; best = a[0]; }
      }
    }
    if (best) (byAirport.get(best) || byAirport.set(best, []).get(best)).push(rw);
  }

  const r5 = (n) => +n.toFixed(5);
  const defaultWidth = (surface) => (/asphalt|concrete|paved/.test(surface) ? 30 : 20);
  let corrected = 0, unchanged = 0, newAirports = 0, newRunways = 0;
  const shifts = [];
  for (const [ic, list] of byAirport) {
    const oa = data[ic];
    if (oa && oa.length) {
      // OA-banan rättas efter OSM-banan med samma riktning som ligger närmast (högst 600 m från OA-banans mitt).
      // OSM vinner alltid, även när längden skiljer (t.ex. EFIM 09/27: bara den asfalterade biten är kvar) —
      // längden används bara för att välja mellan flera kandidater (UHBB 18: 3 km-banan, inte 1,2 km-banan bredvid).
      const used = new Set();
      for (const t of oa) {
        const leO = { lat: t[2], lon: t[3] }, heO = { lat: t[4], lon: t[5] };
        const axisO = bearing(leO, heO), midO = { lat: (leO.lat + heO.lat) / 2, lon: (leO.lon + heO.lon) / 2 };
        let best = null, bestD = 600;
        const lenO = t[7] || distM(leO, heO);
        for (const rw of list) {
          if (used.has(rw.id) || axisDiff(axisO, rw.axis) > 10) continue;
          const lenPenalty = lenO > 0 ? Math.min(400, Math.abs(Math.log(rw.len / lenO)) * 250) : 0;
          const d = segDist(midO, rw.leP, rw.heP) + (rw.hasRef && rw.le === t[0] ? 0 : 25) + lenPenalty;
          if (d < bestD) { bestD = d; best = rw; }
        }
        if (!best) { unchanged++; continue; }
        used.add(best.id);
        // Ändarna efter OA:s beteckning: OSM-änden närmast OA:s le-tröskel är le.
        const [L, H] = distM(best.leP, leO) + distM(best.heP, heO) <= distM(best.heP, leO) + distM(best.leP, heO) ? [best.leP, best.heP] : [best.heP, best.leP];
        shifts.push(distM({ lat: (L.lat + H.lat) / 2, lon: (L.lon + H.lon) / 2 }, midO));
        t[2] = r5(L.lat); t[3] = r5(L.lon); t[4] = r5(H.lat); t[5] = r5(H.lon);
        t[6] = best.width || t[6] || defaultWidth(best.surface);
        t[7] = Math.round(best.len);
        corrected++;
      }
    } else {
      data[ic] = list.map((rw) => [rw.le, rw.he, r5(rw.leP.lat), r5(rw.leP.lon), r5(rw.heP.lat), r5(rw.heP.lon), rw.width || defaultWidth(rw.surface), Math.round(rw.len)]);
      newAirports++; newRunways += list.length;
    }
  }
  shifts.sort((a, b) => a - b);
  const q = (p) => (shifts.length ? Math.round(shifts[Math.floor(p * (shifts.length - 1))]) : 0);
  console.log(`OSM: ${runways.length} banor, ${byAirport.size} flygplatser. Rättade OA-banor: ${corrected} (median ${q(0.5)} m, 90 % ${q(0.9)} m, ${shifts.filter((d) => d > 30).length} flyttade mer än 30 m), OA-banor utan OSM-motsvarighet: ${unchanged}, nya flygplatser: ${newAirports} (${newRunways} banor).`);
} else {
  console.log('Ingen OSM-data (kör node scripts/fetch-osm-runways.mjs) — bara OurAirports.');
}

// Banor utan bredd (OA anger ibland 0) får en standardbredd, annars ritas de som en streck.
// Banor utan längd räknas ut ur trösklarna.
for (const list of Object.values(data)) for (const t of list) {
  if (!(t[7] > 0)) {
    const k = Math.cos(((t[2] + t[4]) / 2) * Math.PI / 180);
    t[7] = Math.round(Math.hypot((t[4] - t[2]) * 111320, (t[5] - t[3]) * 111320 * k));
  }
  if (!(t[6] > 0)) t[6] = t[7] >= 1200 ? 30 : 20;
}

fs.writeFileSync(OUT, JSON.stringify(data));
const bytes = fs.statSync(OUT).size;
console.log(`Banor totalt: ${total} · med koordinater: ${kept} · flygplatser: ${Object.keys(data).length}`);
console.log(`Skrev ${OUT} (${(bytes / 1048576).toFixed(2)} MB)`);
