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
// - OURAIRPORTS-ÖVERLÄGG: airportmap.de uppdateras sällan (senast 2026-02), OurAirports (dess källa)
//   löpande. Överlägget LÄGGER BARA TILL: nya ICAO-koder som alias i gps-fältet (kodbyten, t.ex.
//   UTTT → UZTT — appens kod-uppslag matchar gps), helt nya flygplatser (ingen flygplats inom 3 km),
//   stängningar (type → closed) och nya/ändrade IATA-koder (t.ex. LUKK KIV → RMO — en ändrad IATA gör att
//   den gamla koden slutar fungera för NY inmatning; loggade flygningar påverkas inte, de pekar på nyckeln).
//   Befintliga nycklar, namn och koordinater rörs ALDRIG (loggade flygningar pekar på dem, och OurAirports
//   återanvänder ibland koder för andra fält).
// - `--refresh` hämtar om alla källfiler (annars används cachen i am-data/).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_AIR = join(__dir, '..', 'assets', 'icao-airports.dat'); // .dat = buntas som asset (Metro), JSON-innehåll
const OUT_RWY = join(__dir, '..', 'assets', 'icao-runways.json');
const OUT_META = join(__dir, '..', 'assets', 'airport-data-meta.json'); // { updated } → "Last updated" i global map
const LOCAL = join(__dir, 'am-data');
const LEGACY_AIR = join(LOCAL, 'legacy-airports.json');
const LEGACY_RWY = join(LOCAL, 'legacy-runways.json');
const BASE = 'https://raw.githubusercontent.com/komed3/airportmap-database/master';
const OA_AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OA_RUNWAYS_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const OA_RUNWAYS_CACHE = join(__dir, 'runways.csv'); // delas med build-runways.mjs
const REFRESH = process.argv.includes('--refresh');

async function load(name, url, path = join(LOCAL, name)) {
  const p = path;
  if (!REFRESH && existsSync(p)) { console.log('läser lokalt', p); return readFileSync(p, 'utf8'); }
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
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function main() {
  // Engångs-backup av original-seed/runways (för deterministisk merge vid om-körning).
  if (!existsSync(LOCAL)) mkdirSync(LOCAL, { recursive: true });
  if (!existsSync(LEGACY_AIR) && existsSync(OUT_AIR)) writeFileSync(LEGACY_AIR, readFileSync(OUT_AIR, 'utf8'));
  if (!existsSync(LEGACY_RWY) && existsSync(OUT_RWY)) writeFileSync(LEGACY_RWY, readFileSync(OUT_RWY, 'utf8'));

  // ── Flygplatser ──────────────────────────────────────────────────────────────
  const air = parseCSV(await load('airport.csv', `${BASE}/airport.csv`));
  const ix = {}; air[0].forEach((h, i) => (ix[h.trim()] = i));
  const seed = new Map();
  const amCodes = new Set();      // alla koder (ICAO/GPS/LOCAL) → undvik legacy-dubbletter under annan kod
  const amByName = new Map();     // land|normaliserat namn → [[lat,lon]] → fånga dubbletter utan gemensam kod
  const typeCount = {};
  for (let i = 1; i < air.length; i++) {
    const r = air[i];
    const icao = nn(r[ix.ICAO]);
    for (const c of [icao, nn(r[ix.GPS]), nn(r[ix.LOCAL])]) if (c) amCodes.add(c);
    if (!icao) continue;
    if (icao === 'ZZZZ') continue; // reserverad off-airport-kod → aldrig en riktig flygplats i seeden
    const lat = parseFloat(r[ix.lat]), lon = parseFloat(r[ix.lon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const altN = parseInt(r[ix.alt], 10);
    const type = nn(r[ix.type]);
    const country = nn(r[ix.country]), name = nn(r[ix.name]) || icao;
    typeCount[type] = (typeCount[type] || 0) + 1;
    seed.set(icao, [
      icao, name, country, nn(r[ix.region]), round(lat), round(lon),
      nn(r[ix.IATA]), isFinite(altN) ? altN : null, type, nn(r[ix.municipality]), nn(r[ix.restriction]), nn(r[ix.GPS]),
    ]);
    const nk = `${country}|${normName(name)}`;
    let arr = amByName.get(nk); if (!arr) { arr = []; amByName.set(nk, arr); } arr.push([round(lat), round(lon)]);
  }
  const fromAm = seed.size;

  // Merge: behåll nuvarande ident som airportmap.de saknar HELT. Hoppa över dubbletter — dvs samma kod
  // (ICAO/GPS/LOCAL) ELLER samma land+namn nära en airportmap.de-flygplats (ex OKKK = dubblett av OKBK
  // Kuwait International; legacy blir annars "small"/airfield + dubbel pin).
  let kept = 0, skipped = 0;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_AIR, 'utf8'));
    for (const r of legacy) {
      if (seed.has(r[0])) continue;
      if (r[0] === 'ZZZZ') continue; // reserverad off-airport-kod
      const near = amByName.get(`${r[2]}|${normName(r[1])}`);
      const nameDup = near && near.some(([la, lo]) => Math.abs(la - r[4]) < 0.1 && Math.abs(lo - r[5]) < 0.1);
      if (amCodes.has(r[0]) || nameDup) { skipped++; continue; }
      seed.set(r[0], [r[0], r[1], r[2], r[3], r[4], r[5], '', null, guessType(r[1]), '', '', '']);
      kept++;
    }
  } catch {}
  // ── OurAirports-överlägg (se huvudkommentaren) ──────────────────────────────
  const OA_TYPE = { large_airport: 'large', medium_airport: 'medium', small_airport: 'small', heliport: 'heliport', seaplane_base: 'seaplane', balloonport: 'balloonport', closed: 'closed' };
  const oa = parseCSV(await load('oa-airports.csv', OA_AIRPORTS_URL));
  const ox = {}; oa[0].forEach((h, i) => (ox[h.trim()] = i));
  const resolvable = new Set(); // alla koder appen redan kan slå upp (nyckel/IATA/gps)
  const iataOwner = new Map();  // IATA → nyckel (undvik två flygplatser med samma IATA)
  for (const r of seed.values()) {
    resolvable.add(r[0]);
    if (r[6]) { resolvable.add(r[6].toUpperCase()); iataOwner.set(r[6].toUpperCase(), r[0]); }
    if (r[11]) resolvable.add(r[11].toUpperCase());
  }
  // Närhetsrutnät (0,1°) för "samma flygplats under ny kod".
  const grid = new Map();
  const cell = (la, lo) => `${Math.floor(la * 10)}|${Math.floor(lo * 10)}`;
  for (const r of seed.values()) { const k = cell(r[4], r[5]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r); }
  const km = (a1, o1, a2, o2) => {
    const R = 6371, t = Math.PI / 180, dA = (a2 - a1) * t, dO = (o2 - o1) * t;
    const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const nearest = (la, lo, country, maxKm) => {
    let best = null, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const r of grid.get(`${Math.floor(la * 10) + dx}|${Math.floor(lo * 10) + dy}`) || []) {
        if (r[2] !== country) continue;
        const d = km(la, lo, r[4], r[5]);
        if (d <= maxKm && d < bd) { bd = d; best = r; }
      }
    }
    return best ? { r: best, d: bd } : null;
  };
  const STOP = new Set(['airport', 'international', 'intl', 'air', 'base', 'airfield', 'aerodrome', 'airstrip', 'heliport', 'field', 'station', 'force', 'regional', 'municipal', 'national', 'domestic', 'the', 'aeroporto', 'aeropuerto', 'aeroport', 'aerodromo']);
  const words = (s) => new Set((s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const sameName = (a, b) => { const B = words(b); for (const w of words(a)) if (B.has(w)) return true; return false; };
  const JUNK = /duplicate|\[delete|non-existent|do not use/i;
  const isIcao = (c) => /^[A-Z]{4}$/.test(c);
  const ov = { closed: 0, iataFill: 0, iataChange: 0, alias: 0, aliasNear: 0, added: 0, skippedAlias: 0, reused: 0 };
  const addedByIdent = new Map(); // OA-ident → ny nyckel (för banor nedan)
  const notable = [];
  for (let i = 1; i < oa.length; i++) {
    const r = oa[i];
    const ident = nn(r[ox.ident]).trim().toUpperCase();
    const type = nn(r[ox.type]);
    const name = nn(r[ox.name]);
    const icaoCode = nn(r[ox.icao_code]).trim().toUpperCase();
    const icao = isIcao(icaoCode) ? icaoCode : (isIcao(ident) ? ident : '');
    const iata = nn(r[ox.iata_code]).trim().toUpperCase();
    const la = parseFloat(r[ox.latitude_deg]), lo = parseFloat(r[ox.longitude_deg]);
    if (!isFinite(la) || !isFinite(lo)) continue;
    const own = seed.get(ident);
    if (own) {
      // Samma kod — men bara samma FLYGPLATS om posterna ligger nära varandra. OurAirports återanvänder
      // ibland koder för helt andra fält (upp till tusentals km bort) → rör då ingenting.
      if (km(la, lo, own[4], own[5]) > 5) { ov.reused++; continue; }
      if (type === 'closed' && own[8] !== 'closed') { own[8] = 'closed'; ov.closed++; }
      if (/^[A-Z0-9]{3}$/.test(iata) && own[6] !== iata && (!iataOwner.has(iata) || iataOwner.get(iata) === own[0])) {
        if (own[6]) { ov.iataChange++; notable.push(`IATA-byte: ${own[0]} ${own[6]} → ${iata} (${name})`); iataOwner.delete(own[6]); }
        else ov.iataFill++;
        own[6] = iata; iataOwner.set(iata, own[0]); resolvable.add(iata);
      }
      if (icao && icao !== own[0] && !resolvable.has(icao)) {
        if (!own[11] || own[11] === own[0]) {
          own[11] = icao; resolvable.add(icao); ov.alias++;
          if (OA_TYPE[type] === 'large' || OA_TYPE[type] === 'medium') notable.push(`alias ${own[0]} → ${icao} (${name})`);
        } else ov.skippedAlias++;
      }
      continue;
    }
    if (!icao || resolvable.has(icao) || type === 'closed' || JUNK.test(name)) continue;
    const country = nn(r[ox.iso_country]);
    const nb = nearest(la, lo, country, 3);
    if (nb) {
      // Kodbyte där även OA:s gamla ident försvunnit (t.ex. OKBK → OKKK): alias på flygplatsen intill,
      // men bara om det uppenbart är samma fält (liknande namn eller < 0,5 km) och aliaset är ledigt.
      if ((sameName(name, nb.r[1]) || nb.d <= 0.5) && (!nb.r[11] || nb.r[11] === nb.r[0])) {
        nb.r[11] = icao; resolvable.add(icao); ov.aliasNear++;
        if (OA_TYPE[type] === 'large' || OA_TYPE[type] === 'medium') notable.push(`alias ${nb.r[0]} → ${icao} (${name}, ${nb.d.toFixed(2)} km)`);
      } else ov.skippedAlias++;
      continue;
    }
    // Helt ny flygplats.
    const altN = parseInt(r[ox.elevation_ft], 10);
    const useIata = /^[A-Z0-9]{3}$/.test(iata) && !iataOwner.has(iata) ? iata : '';
    const row = [
      icao, name || icao, country, nn(r[ox.iso_region]), round(la), round(lo),
      useIata, isFinite(altN) ? altN : null, OA_TYPE[type] || 'small', nn(r[ox.municipality]),
      /air ?base|air force|military|naval/i.test(name) ? 'military' : '', nn(r[ox.gps_code]).trim().toUpperCase(),
    ];
    seed.set(icao, row); resolvable.add(icao);
    if (useIata) { resolvable.add(useIata); iataOwner.set(useIata, icao); }
    const k = cell(row[4], row[5]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(row);
    addedByIdent.set(ident, icao); ov.added++;
    notable.push(`ny ${icao} ${name} (${country}, ${row[8]})`);
  }

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
  // Banor för flygplatser som lagts till via OurAirports-överlägget ([ident, length_ft, yta, tänd, stängd]).
  let rwyOa = 0;
  if (addedByIdent.size) {
    const orw = parseCSV(await load('runways.csv', OA_RUNWAYS_URL, OA_RUNWAYS_CACHE));
    const ow = {}; orw[0].forEach((h, i) => (ow[h.trim()] = i));
    for (let i = 1; i < orw.length; i++) {
      const r = orw[i];
      const key = addedByIdent.get(nn(r[ow.airport_ident]).trim().toUpperCase());
      if (!key) continue;
      const le = nn(r[ow.le_ident]).trim(), he = nn(r[ow.he_ident]).trim();
      const len = parseInt(r[ow.length_ft], 10);
      (byApt[key] = byApt[key] || []).push([
        [le, he].filter(Boolean).join('/'), isFinite(len) ? len : 0, nn(r[ow.surface]),
        r[ow.lighted] === '1' ? 1 : 0, r[ow.closed] === '1' ? 1 : 0,
      ]);
      rwyOa++;
    }
  }

  // Behåll legacy-banor för ident som airportmap.de saknar.
  let rwyKept = 0;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_RWY, 'utf8'));
    for (const id in legacy) { if (!byApt[id] && seed.has(id)) { byApt[id] = legacy[id]; rwyKept++; } }
  } catch {}
  writeFileSync(OUT_RWY, JSON.stringify(byApt));
  // Datum då källorna hämtades (bara vid --refresh, så en om-körning mot cachen inte flyttar datumet).
  if (REFRESH || !existsSync(OUT_META)) writeFileSync(OUT_META, JSON.stringify({ updated: new Date().toISOString().slice(0, 10) }));

  const kb = (f) => Math.round(readFileSync(f).length / 1024);
  console.log(`\nSkrev ${OUT_AIR}: ${airOut.length} flygplatser (${fromAm} airportmap.de + ${kept} behållna legacy, ${skipped} legacy-dubbletter skippade), ~${(kb(OUT_AIR) / 1024).toFixed(1)} MB`);
  console.log('  typer:', JSON.stringify(typeCount));
  console.log(`OurAirports-överlägg: ${ov.added} nya flygplatser · ${ov.alias + ov.aliasNear} nya ICAO-alias (${ov.aliasNear} via grannflygplats) · ${ov.closed} stängda · IATA ${ov.iataFill} ifyllda / ${ov.iataChange} bytta · ${ov.skippedAlias} alias överhoppade (upptagna) · ${ov.reused} återanvända koder orörda (> 5 km) · ${rwyOa} banor till nya`);
  for (const n of notable.filter((x) => !x.startsWith('ny ') || /large|medium/.test(x)).slice(0, 80)) console.log('   ', n);
  console.log(`Skrev ${OUT_RWY}: ${Object.keys(byApt).length} med banor (${rwyKept} legacy), ~${(kb(OUT_RWY) / 1024).toFixed(1)} MB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
