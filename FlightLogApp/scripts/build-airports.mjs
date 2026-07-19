// Genererar assets/icao-airports.json (berikad) + assets/icao-runways.json från airportmap.de
// (komed3/airportmap-database, MIT — härledd från OurAirports). Körs vid behov: `node scripts/build-airports.mjs`.
//
// - Berikad seed-tupel: [icao, name, country, region, lat, lon, iata, alt, type, municipality, restriction]
//   (index 0–5 OFÖRÄNDRADE → befintlig kod + build-borders.mjs fortsätter fungera).
//   type = airportmap.de:s kategori (large/medium/small/heliport/seaplane/altiport/balloonport/closed).
//   restriction = public/private/military/joint_use ('' = okänd). "Air base" = military.
// - closed INKLUDERAS (filtrerbar i appen) men exkluderas från standardvyn där (inte här).
// - MERGE: airportmap.de saknar ~4k ident som finns i nuvarande seed → dessa behålls (bryter inga
//   redan loggade flygningars flygplatsuppslag). En engångs-backup av original-seeden sparas i am-data/.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_AIR = join(__dir, '..', 'assets', 'icao-airports.json');
const OUT_RWY = join(__dir, '..', 'assets', 'icao-runways.json');
const LOCAL = join(__dir, 'am-data');
const LEGACY_AIR = join(LOCAL, 'legacy-airports.json');
const LEGACY_RWY = join(LOCAL, 'legacy-runways.json');
const BASE = 'https://raw.githubusercontent.com/komed3/airportmap-database/master';

async function load(name, url) {
  const p = join(LOCAL, name);
  if (existsSync(p)) { console.log('läser lokalt', p); return readFileSync(p, 'utf8'); }
  console.log('hämtar', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const t = await r.text();
  try { if (!existsSync(LOCAL)) mkdirSync(LOCAL, { recursive: true }); writeFileSync(p, t); } catch {}
  return t;
}

// CSV-rad → fält (respekterar citattecken, "" → ").
function parseCSV(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g) || [];
    out.push(m.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
  }
  return out;
}
const nn = (v) => (v == null || v === 'NULL' || v === '' ? '' : v); // airportmap.de NULL → ''
const round = (n) => Math.round(n * 1e5) / 1e5;
function guessType(name) {
  const s = (name || '').toLowerCase();
  if (/heliport|helipad|helibase/.test(s)) return 'heliport';
  if (/sea ?plane|float ?plane|water aerodrome|hydro/.test(s)) return 'seaplane';
  return 'small'; // legacy-ident (obskyra fält) → rimlig default så de syns under Airfields
}

async function main() {
  // Engångs-backup av original-seed/runways (för deterministisk merge vid om-körning).
  if (!existsSync(LOCAL)) mkdirSync(LOCAL, { recursive: true });
  if (!existsSync(LEGACY_AIR) && existsSync(OUT_AIR)) writeFileSync(LEGACY_AIR, readFileSync(OUT_AIR, 'utf8'));
  if (!existsSync(LEGACY_RWY) && existsSync(OUT_RWY)) writeFileSync(LEGACY_RWY, readFileSync(OUT_RWY, 'utf8'));

  // ── Flygplatser ──────────────────────────────────────────────────────────────
  const air = parseCSV(await load('airport.csv', `${BASE}/airport.csv`));
  const ix = {}; air[0].forEach((h, i) => (ix[h.trim()] = i));
  const seed = new Map();
  const typeCount = {};
  for (let i = 1; i < air.length; i++) {
    const r = air[i];
    const icao = nn(r[ix.ICAO]); if (!icao) continue;
    const lat = parseFloat(r[ix.lat]), lon = parseFloat(r[ix.lon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const altN = parseInt(r[ix.alt], 10);
    const type = nn(r[ix.type]);
    typeCount[type] = (typeCount[type] || 0) + 1;
    seed.set(icao, [
      icao, nn(r[ix.name]) || icao, nn(r[ix.country]), nn(r[ix.region]), round(lat), round(lon),
      nn(r[ix.IATA]), isFinite(altN) ? altN : null, type, nn(r[ix.municipality]), nn(r[ix.restriction]),
    ]);
  }
  const fromAm = seed.size;

  // Merge: behåll nuvarande ident som airportmap.de saknar (inga brutna uppslag).
  let kept = 0;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_AIR, 'utf8'));
    for (const r of legacy) {
      if (seed.has(r[0])) continue;
      seed.set(r[0], [r[0], r[1], r[2], r[3], r[4], r[5], '', null, guessType(r[1]), '', '']);
      kept++;
    }
  } catch {}
  const airOut = [...seed.values()];
  writeFileSync(OUT_AIR, JSON.stringify(airOut));

  // ── Rullbanor ────────────────────────────────────────────────────────────────
  const rwy = parseCSV(await load('runway.csv', `${BASE}/runway.csv`));
  const rix = {}; rwy[0].forEach((h, i) => (rix[h.trim()] = i));
  const byApt = {};
  for (let i = 1; i < rwy.length; i++) {
    const r = rwy[i];
    const apt = nn(r[rix.airport]); if (!apt || !seed.has(apt)) continue;
    const len = parseInt(r[rix.length], 10);
    (byApt[apt] = byApt[apt] || []).push([
      nn(r[rix.ident]), isFinite(len) ? len : 0, nn(r[rix.surface]),
      r[rix.lighted] === '1' ? 1 : 0, r[rix.inuse] === '1' ? 0 : 1, // inuse=1 → öppen
    ]);
  }
  // Behåll legacy-banor för ident som airportmap.de saknar.
  let rwyKept = 0;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_RWY, 'utf8'));
    for (const id in legacy) { if (!byApt[id] && seed.has(id)) { byApt[id] = legacy[id]; rwyKept++; } }
  } catch {}
  writeFileSync(OUT_RWY, JSON.stringify(byApt));

  const kb = (f) => Math.round(readFileSync(f).length / 1024);
  console.log(`\nSkrev ${OUT_AIR}: ${airOut.length} flygplatser (${fromAm} airportmap.de + ${kept} behållna legacy), ~${(kb(OUT_AIR) / 1024).toFixed(1)} MB`);
  console.log('  typer:', JSON.stringify(typeCount));
  console.log(`Skrev ${OUT_RWY}: ${Object.keys(byApt).length} med banor (${rwyKept} legacy), ~${(kb(OUT_RWY) / 1024).toFixed(1)} MB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
