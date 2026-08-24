// Genererar assets/airport-freq.json från OurAirports (airport-frequencies.csv) — TWR/GND/ATIS/APP
// per flygplats (ICAO). Källa: OurAirports (public domain, community-underhållen → kan vara ofullständig).
// Körs manuellt:  node scripts/build-frequencies.mjs
//
// Format: { "ESSA": { "twr": 118.5, "gnd": 121.7, "atis": 119, "app": 123.75 }, ... }
// Bara de fyra typerna, bara 4-bokstavs-ICAO, första förekomsten per typ. Saknade typer utelämnas.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'airport-freq.json');
const URL = 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv';
const CACHE = path.join(__dirname, 'freq.csv'); // lokal cache (gitignoreas)

const WANT = { TWR: 'twr', GND: 'gnd', ATIS: 'atis', APP: 'app' };

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

async function getCsv() {
  if (fs.existsSync(CACHE)) { console.log('Använder cache:', CACHE); return fs.readFileSync(CACHE, 'utf8'); }
  console.log('Hämtar', URL, '…');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Hämtning misslyckades: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(CACHE, text);
  return text;
}

const raw = await getCsv();
const rows = raw.split(/\r?\n/).filter(Boolean).slice(1).map(parseCsv);

const data = {};
for (const r of rows) {
  const ident = (r[2] || '').trim().toUpperCase();
  const type = (r[3] || '').trim().toUpperCase();
  const mhz = parseFloat(r[5]);
  const key = WANT[type];
  if (!key || !/^[A-Z]{4}$/.test(ident) || !Number.isFinite(mhz)) continue;
  (data[ident] ||= {});
  if (data[ident][key] == null) data[ident][key] = mhz; // första förekomsten
}

fs.writeFileSync(OUT, JSON.stringify(data));
const bytes = fs.statSync(OUT).size;
const counts = { twr: 0, gnd: 0, atis: 0, app: 0 };
for (const v of Object.values(data)) for (const k of Object.keys(counts)) if (v[k] != null) counts[k]++;
console.log(`Flygplatser med minst en frekvens: ${Object.keys(data).length}`);
console.log(`  TWR ${counts.twr} · GND ${counts.gnd} · ATIS ${counts.atis} · APP ${counts.app}`);
console.log(`Skrev ${OUT} (${(bytes / 1048576).toFixed(2)} MB)`);
