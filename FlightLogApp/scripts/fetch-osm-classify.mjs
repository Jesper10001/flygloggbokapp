// Hämtar underlag från OpenStreetMap (Overpass) för att dela upp flygplatstyperna på global map:
//  1) Rutor (samma uppdelning som fetch-osm-runways.mjs): alla aeroway=aerodrome/heliport/helipad och
//     man_made=offshore_platform med taggar + mittpunkt → scripts/osm-data/classify/tiles/*.json.
//     Används för flygbaser (operator/military), flygfältstyper (gliding/ultralight …) och helipads.
//  2) Punkter: byggnader (building / building:part, med geometri) inom 80 m från varje heliport i seeden,
//     100 heliports per fråga → scripts/osm-data/classify/bld/*.json. build-airport-subtypes.mjs räknar
//     sedan själv ut om plattan ligger på en byggnad (punkt-i-polygon).
// Allt går att köra om efter ett avbrott: hämtade rutor/satser hoppas över. Data © OpenStreetMap contributors, ODbL.
// Kör: node scripts/fetch-osm-classify.mjs [--tiles-only|--bld-only] [--part=0/2]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'osm-data', 'classify');
const TILES = path.join(DIR, 'tiles');
const BLD = path.join(DIR, 'bld');
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let preferred = 0;
fs.mkdirSync(TILES, { recursive: true });
fs.mkdirSync(BLD, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(q, label) {
  let wait = 5000;
  for (let attempt = 0; attempt < 10; attempt++) {
    const si = (preferred + attempt) % SERVERS.length;
    try {
      const res = await fetch(SERVERS[si], { method: 'POST', headers: { 'User-Agent': 'BladesAirportBuild/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(400000) });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) {
        const j = JSON.parse(text);
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 120));
        preferred = si;
        return j.elements || [];
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.log(`  ${label}: ${e.message} → försöker igen om ${wait / 1000} s`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
  throw new Error(`Gav upp på ${label}`);
}

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'))
  .filter((r) => Number.isFinite(r[4]) && Number.isFinite(r[5]));
const only = process.argv.find((a) => a === '--tiles-only' || a === '--bld-only');

// ── 1) Rutor ────────────────────────────────────────────────────────────────
if (only !== '--bld-only') {
  const STEP = 20, MAX_AP = 800, MIN_STEP = 1.25;
  const countIn = (la, lo, st) => SEED.reduce((n, r) => n + (r[4] >= la && r[4] < la + st && r[5] >= lo && r[5] < lo + st ? 1 : 0), 0);
  const jobs = [];
  const plan = (la, lo, st) => {
    const n = countIn(la, lo, st);
    if (n > MAX_AP && st / 2 >= MIN_STEP) { for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) plan(la + a * st / 2, lo + b * st / 2, st / 2); return; }
    jobs.push({ la, lo, st, n });   // även tomma rutor: oljeplattformar ligger till havs
  };
  for (let la = -90; la < 90; la += STEP) for (let lo = -180; lo < 180; lo += STEP) plan(la, lo, STEP);
  const have = new Set(fs.readdirSync(TILES).map((f) => f.replace('.json', '')));
  let pending = jobs.filter((j) => !have.has(`${j.la}_${j.lo}_${j.st}`)), done = jobs.length - pending.length;
  console.log(`Rutor: ${jobs.length} totalt, ${pending.length} kvar`);
  for (let pass = 1; pending.length && pass <= 4; pass++) {
    const failed = [];
    for (const j of pending) {
      const bbox = `${j.la},${j.lo},${j.la + j.st},${j.lo + j.st}`;
      const q = `[out:json][timeout:300];(nwr["aeroway"~"^(aerodrome|airstrip|heliport|helipad)$"](${bbox});nwr["man_made"="offshore_platform"](${bbox}););out tags center;`;
      try {
        const els = await query(q, bbox);
        fs.writeFileSync(path.join(TILES, `${j.la}_${j.lo}_${j.st}.json`), JSON.stringify(els.map((e) => ({ t: e.type[0], id: e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags }))));
        done++;
        console.log(`ruta ${done}/${jobs.length} · ${bbox} (${j.n} i seed): ${els.length} objekt`);
      } catch (e) { console.log(`  hoppar över ${bbox}: ${e.message}`); failed.push(j); }
      await sleep(1200);
    }
    pending = failed;
  }
  if (pending.length) console.log(`OBS: ${pending.length} rutor saknas`);
}

// ── 2) Byggnader runt heliports ─────────────────────────────────────────────
if (only !== '--tiles-only') {
  const heli = SEED.filter((r) => r[8] === 'heliport').sort((a, b) => (a[2] + a[0]).localeCompare(b[2] + b[0]));
  const N = 100, batches = [];
  for (let i = 0; i < heli.length; i += N) batches.push(heli.slice(i, i + N));
  const have = new Set(fs.readdirSync(BLD));
  // --part=K/N: den här arbetaren tar var N:e sats (Overpass tillåter två samtidiga frågor per användare).
  const pm = (process.argv.find((a) => a.startsWith('--part=')) || '').match(/--part=(\d+)\/(\d+)/);
  const [pk, pn] = pm ? [Number(pm[1]), Number(pm[2])] : [0, 1];
  let pending = batches.map((b, i) => ({ b, i })).filter(({ i }) => !have.has(`${i}.json`) && i % pn === pk), done = batches.length - pending.length;
  console.log(`Heliports: ${heli.length} i ${batches.length} satser, ${pending.length} kvar`);
  for (let pass = 1; pending.length && pass <= 4; pass++) {
    const failed = [];
    for (const { b, i } of pending) {
      if (fs.existsSync(path.join(BLD, `${i}.json`))) continue;   // hämtad av en annan arbetare
      const around = b.map((r) => `way["building"](around:80,${r[4]},${r[5]});way["building:part"](around:80,${r[4]},${r[5]});`).join('');
      const q = `[out:json][timeout:300];(${around});out tags geom;`;
      try {
        const els = await query(q, `sats ${i}`);
        const slim = els.filter((e) => e.geometry).map((e) => ({ id: e.id, g: e.geometry.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]), tags: { building: e.tags?.building, 'building:part': e.tags?.['building:part'], levels: e.tags?.['building:levels'], height: e.tags?.height, min_level: e.tags?.['building:min_level'] } }));
        fs.writeFileSync(path.join(BLD, `${i}.json`), JSON.stringify({ ids: b.map((r) => r[0]), els: slim }));
        done++;
        console.log(`sats ${done}/${batches.length} (${b[0][2]}): ${slim.length} byggnader`);
      } catch (e) { console.log(`  hoppar över sats ${i}: ${e.message}`); failed.push({ b, i }); }
      await sleep(1200);
    }
    pending = failed;
  }
  if (pending.length) console.log(`OBS: ${pending.length} satser saknas`);
}
console.log('KLART');
