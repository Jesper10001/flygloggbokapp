// Genererar assets/airport-freq.json från OurAirports (airport-frequencies.csv) — TWR/GND/ATIS/APP
// per flygplats (ICAO). Källa: OurAirports (public domain, community-underhållen → kan vara ofullständig).
// Körs manuellt:  node scripts/build-frequencies.mjs
//
// Format: { "ESSA": { "twr": 118.5, "gnd": 121.7, "atis": 119, "app": 123.75 }, ... }
// Bara de fyra typerna, första giltiga förekomsten per typ. Saknade typer utelämnas. Nyckeln =
// flygplatsens nyckel i vår seed (oa-keys.mjs — kör build-airports.mjs först), annars 4-bokstavs-ident.
// Typ: exakt TWR/GND/ATIS/APP först; fritext-typer ("Gokcen TWR", "APP/DEP", "D-ATIS-ARR", "TOWER")
// fyller bara luckor. Värden utanför flygbandet (t.ex. "23.66") är fel i källan → hoppas över.
// `--refresh` hämtar om källfilen (annars används cachen).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedKeyMapper } from './oa-keys.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'airport-freq.json');
const URL = 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv';
const CACHE = path.join(__dirname, 'freq.csv'); // lokal cache (gitignoreas)

const WANT = { TWR: 'twr', GND: 'gnd', ATIS: 'atis', APP: 'app' };
// Fritext-typer → funktion (en typ kan täcka flera, t.ex. "TWR/APP").
const PATTERNS = [['atis', /ATIS/], ['twr', /TWR|TOWER/], ['gnd', /GND|GROUND|GRND/], ['app', /APP/]];
// VHF-flygbandet: ATIS sänds ibland på VOR-frekvenser (108–118), övriga på 118–137 MHz.
const inBand = (key, mhz) => (key === 'atis' ? mhz >= 108 : mhz >= 118) && mhz <= 137;

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
  if (!process.argv.includes('--refresh') && fs.existsSync(CACHE)) { console.log('Använder cache:', CACHE); return fs.readFileSync(CACHE, 'utf8'); }
  console.log('Hämtar', URL, '…');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Hämtning misslyckades: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(CACHE, text);
  return text;
}

const raw = await getCsv();
const rows = raw.split(/\r?\n/).filter(Boolean).slice(1).map(parseCsv);

const seedKey = seedKeyMapper();
const data = {};
let dropped = 0;
const put = (apt, key, mhz) => {
  if (!inBand(key, mhz)) { dropped++; return; }
  (data[apt] ||= {});
  if (data[apt][key] == null) data[apt][key] = mhz; // första giltiga förekomsten
};
const parsed = rows.map((r) => {
  const ident = (r[2] || '').trim().toUpperCase();
  return { apt: seedKey(ident) ?? (/^[A-Z]{4}$/.test(ident) ? ident : null), type: (r[3] || '').trim().toUpperCase(), mhz: parseFloat(r[5]) };
}).filter((x) => x.apt && Number.isFinite(x.mhz));
for (const x of parsed) if (WANT[x.type]) put(x.apt, WANT[x.type], x.mhz);           // 1) exakta typer
for (const x of parsed) {                                                              // 2) fritext fyller luckor
  if (WANT[x.type]) continue;
  for (const [key, re] of PATTERNS) if (re.test(x.type) && data[x.apt]?.[key] == null) put(x.apt, key, x.mhz);
}

fs.writeFileSync(OUT, JSON.stringify(data));
const bytes = fs.statSync(OUT).size;
const counts = { twr: 0, gnd: 0, atis: 0, app: 0 };
for (const v of Object.values(data)) for (const k of Object.keys(counts)) if (v[k] != null) counts[k]++;
console.log(`Flygplatser med minst en frekvens: ${Object.keys(data).length} (${dropped} värden utanför flygbandet hoppade över)`);
console.log(`  TWR ${counts.twr} · GND ${counts.gnd} · ATIS ${counts.atis} · APP ${counts.app}`);
console.log(`Skrev ${OUT} (${(bytes / 1048576).toFixed(2)} MB)`);
