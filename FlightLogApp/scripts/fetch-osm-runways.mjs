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

// Bara rutor där appens seed har flygplatser (hav och Antarktis hoppas över).
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'));
const wanted = new Set(SEED.filter((r) => Number.isFinite(r[4]) && Number.isFinite(r[5]))
  .map((r) => `${Math.floor((r[4] + 90) / STEP) * STEP - 90}_${Math.floor((r[5] + 180) / STEP) * STEP - 180}`));
let done = 0, total = 0;
for (let lat = -90; lat < 90; lat += STEP) {
  for (let lon = -180; lon < 180; lon += STEP) {
    total++;
    const name = `${lat}_${lon}.json`;
    const file = path.join(TILES, name);
    if (fs.existsSync(file) || !wanted.has(`${lat}_${lon}`)) { done++; continue; }
    const bbox = `${lat},${lon},${lat + STEP},${lon + STEP}`;
    const els = await query(bbox);
    fs.writeFileSync(file, JSON.stringify(els));
    done++;
    console.log(`${done} rutor klara · ${bbox}: ${els.length} banor`);
    await sleep(1500);
  }
}
const all = new Map();
for (const f of fs.readdirSync(TILES)) for (const w of JSON.parse(fs.readFileSync(path.join(TILES, f), 'utf8'))) all.set(w.id, w);
fs.writeFileSync(OUT, JSON.stringify([...all.values()]));
console.log(`Klart: ${all.size} banor från ${total} rutor → ${OUT}`);
