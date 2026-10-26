// Genererar assets/runways.json från OurAirports (runways.csv): banriktningar per flygplats som
// bannummer × 10 för banans låga ände (03/21 → 30, 04L/22R + 04R/22L → 40), unika per flygplats.
// Används för approach-banvalet i Log flight, banorna i flygplatskartan och delningskortet.
// Samma regler som den ursprungliga filen (juni 2026): bara öppna banor med numeriskt bannummer,
// nyckel = flygplatsens nyckel i vår seed (oa-keys.mjs) när den är en 4-bokstavskod.
// Körs efter build-airports.mjs + build-runways.mjs (delar cachen scripts/runways.csv):
//   node scripts/build-runway-headings.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedKeyMapper } from './oa-keys.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'runways.json');
const CACHE = path.join(__dirname, 'runways.csv');
if (!fs.existsSync(CACHE)) { console.error('Saknar', CACHE, '— kör build-runways.mjs först'); process.exit(1); }

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

const seedKey = seedKeyMapper();
const rows = fs.readFileSync(CACHE, 'utf8').split(/\r?\n/).filter(Boolean).slice(1).map(parseCsv);
const data = {};
for (const r of rows) {
  const oaIdent = (r[2] || '').trim().toUpperCase();
  const key = seedKey(oaIdent) ?? oaIdent;
  if (!/^[A-Z]{4}$/.test(key) || r[7] === '1') continue; // bara 4-bokstavskoder, inga stängda banor
  const m = /^(\d{1,2})/.exec((r[8] || '').trim());      // le_ident, t.ex. "04L"
  if (!m) continue;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 36) continue;
  const hdg = n * 10;
  const list = (data[key] ||= []);
  if (!list.includes(hdg)) list.push(hdg);
}
fs.writeFileSync(OUT, JSON.stringify(data));
const bytes = fs.statSync(OUT).size;
console.log(`Flygplatser med banriktningar: ${Object.keys(data).length}`);
console.log(`Skrev ${OUT} (${(bytes / 1024).toFixed(0)} KB)`);
