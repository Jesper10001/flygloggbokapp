// Hämtar alla banor (aeroway=runway) från OpenStreetMap via Overpass, i rutor om 20° × 20° (en global fråga är för
// tung för servrarna), och sparar dem i scripts/osm-data/runways.json (gitignoreas). Rutor som redan hämtats
// hoppas över, så skriptet kan köras om efter ett avbrott. Används av scripts/build-runways.mjs.
// Kör: node scripts/fetch-osm-runways.mjs   (--refresh hämtar allt på nytt)
// Data © OpenStreetMap contributors, ODbL.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'osm-data');
const TILES = path.join(DIR, 'tiles');
const OUT = path.join(DIR, 'runways.json');
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let preferred = 0;   // servern som svarade senast prövas först
const STEP = 20;
fs.mkdirSync(TILES, { recursive: true });
if (process.argv.includes('--refresh')) for (const f of fs.readdirSync(TILES)) fs.unlinkSync(path.join(TILES, f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function query(bbox) {
  const q = `[out:json][timeout:300];way["aeroway"="runway"](${bbox});out tags geom;`;
  let wait = 5000;
  for (let attempt = 0; attempt < 8; attempt++) {
    const si = (preferred + attempt) % SERVERS.length;
    const url = SERVERS[si];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'BladesRunwayBuild/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) {
        const j = JSON.parse(text);
        if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
        preferred = si;
        return j.elements || [];
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.log(`  ${bbox}: ${e.message} → försöker igen om ${wait / 1000} s`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
  throw new Error(`Gav upp på ${bbox}`);
}

// Rutor i 20° × 20°. En ruta med många flygplatser i appens seed delas i fyra, och vidare tills varje bit har
// högst MAX_AP flygplatser eller är MIN_STEP stor: täta områden (USA, Europa) blir många små och lätta frågor,
// glesa förblir stora. Bitar utan flygplatser hoppas över. Hämtade bitar sparas som <lat>_<lon>_<storlek>.json
// (gamla 20°-rutor som <lat>_<lon>.json); en bit som redan täcks av en hämtad större ruta hämtas inte igen.
const MAX_AP = 1000, MIN_STEP = 2.5;
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'))
  .filter((r) => Number.isFinite(r[4]) && Number.isFinite(r[5]));
const countIn = (la, lo, st) => SEED.reduce((n, r) => n + (r[4] >= la && r[4] < la + st && r[5] >= lo && r[5] < lo + st ? 1 : 0), 0);
const fetched = new Set(fs.readdirSync(TILES).map((f) => f.replace('.json', '')));
const covered = (la, lo, st) => {   // täcks biten redan av en hämtad 20°-ruta eller en hämtad större bit?
  if (fetched.has(`${la - ((la + 90) % STEP)}_${lo - ((lo + 180) % STEP)}`)) return true;
  for (let s2 = st * 2; s2 <= STEP; s2 *= 2) {
    const pla = la - (((la + 90) % s2) + s2) % s2, plo = lo - (((lo + 180) % s2) + s2) % s2;
    if (fetched.has(`${pla}_${plo}_${s2}`)) return true;
  }
  return false;
};
const jobs = [];
function plan(la, lo, st) {
  const n = countIn(la, lo, st);
  if (!n) return;
  if (n > MAX_AP && st / 2 >= MIN_STEP) {
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) plan(la + a * st / 2, lo + b * st / 2, st / 2);
    return;
  }
  jobs.push({ la, lo, st, n });
}
for (let la = -90; la < 90; la += STEP) for (let lo = -180; lo < 180; lo += STEP) plan(la, lo, STEP);
const todo = jobs.filter((j) => !covered(j.la, j.lo, j.st) && !fetched.has(`${j.la}_${j.lo}_${j.st}`));
console.log(`${jobs.length} bitar totalt, ${todo.length} kvar att hämta`);

let pending = todo, pass = 0, done = jobs.length - todo.length;
while (pending.length && pass < 4) {
  pass++;
  const failed = [];
  for (const j of pending) {
    const bbox = `${j.la},${j.lo},${j.la + j.st},${j.lo + j.st}`;
    try {
      const els = await query(bbox);
      fs.writeFileSync(path.join(TILES, `${j.la}_${j.lo}_${j.st}.json`), JSON.stringify(els));
      done++;
      console.log(`${done}/${jobs.length} klara · ${bbox} (${j.n} flygplatser): ${els.length} banor`);
    } catch (e) {
      console.log(`  hoppar över ${bbox} tills vidare: ${e.message}`);
      failed.push(j);
    }
    await sleep(1500);
  }
  pending = failed;
  if (pending.length) console.log(`Varv ${pass}: ${pending.length} bitar misslyckades, försöker igen`);
}
if (pending.length) console.log(`OBS: ${pending.length} bitar kunde inte hämtas: ${pending.map((j) => `${j.la},${j.lo},${j.st}`).join(' ')}`);
const all = new Map();
for (const f of fs.readdirSync(TILES)) for (const w of JSON.parse(fs.readFileSync(path.join(TILES, f), 'utf8'))) all.set(w.id, w);
fs.writeFileSync(OUT, JSON.stringify([...all.values()]));
console.log(`Klart: ${all.size} banor → ${OUT}`);
