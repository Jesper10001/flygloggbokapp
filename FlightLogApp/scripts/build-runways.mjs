// Genererar assets/runway-geo.json från OurAirports (runways.csv) — tröskelkoordinater + mått
// per bana, grupperat per flygplats-ident. Källa: OurAirports (public domain).
// Körs manuellt vid behov:  node scripts/build-runways.mjs
//
// Format (kompakt tuple per bana):
//   { "ESSA": [ [leIdent, heIdent, leLat, leLon, heLat, heLon, widthM, lengthM], ... ], ... }
// Koordinater 5 decimaler (~1 m). Mått i meter (avrundat). Stängda banor + banor utan
// tröskelkoordinater hoppas över.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'runway-geo.json');
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
  if (fs.existsSync(CACHE)) { console.log('Använder cache:', CACHE); return fs.readFileSync(CACHE, 'utf8'); }
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

const data = {};
let total = 0, kept = 0;
for (const r of rows) {
  total++;
  const ident = (r[2] || '').trim().toUpperCase();
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

fs.writeFileSync(OUT, JSON.stringify(data));
const bytes = fs.statSync(OUT).size;
console.log(`Banor totalt: ${total} · med koordinater: ${kept} · flygplatser: ${Object.keys(data).length}`);
console.log(`Skrev ${OUT} (${(bytes / 1048576).toFixed(2)} MB)`);
