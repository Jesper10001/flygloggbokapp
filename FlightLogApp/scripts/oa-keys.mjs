// OurAirports-ident → nyckel i vår flygplats-seed (assets/icao-airports.dat). Oftast samma kod (ICAO),
// men OurAirports har ibland kvar en gammal/lokal kod som ident och ICAO-koden i icao_code (t.ex.
// ident "16A" + icao_code "PPIT", eller ident "UTTT" + icao_code "UZTT"). Seeden har flygplatsen antingen
// under OA:s ident (från airportmap.de) eller under icao_code (tillagd via OurAirports-överlägget i
// build-airports.mjs). Används av build-frequencies/build-runways/build-runway-headings så att
// frekvenser och banor alltid hamnar på samma nyckel som appen slår upp flygplatsen med.
//
// Kräver att build-airports.mjs körts först (den cachar OA:s airports.csv i am-data/).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DAT = join(__dir, '..', 'assets', 'icao-airports.dat');
const OA_AIRPORTS = join(__dir, 'am-data', 'oa-airports.csv');

// CSV-rad → fält (respekterar citattecken, "" → ").
function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Returnerar (ident) → seed-nyckel, eller null om flygplatsen inte finns i seeden. */
export function seedKeyMapper() {
  const seed = new Set(JSON.parse(readFileSync(DAT, 'utf8')).map((r) => r[0]));
  const icaoByIdent = new Map();
  if (existsSync(OA_AIRPORTS)) {
    const lines = readFileSync(OA_AIRPORTS, 'utf8').split(/\r?\n/).filter(Boolean);
    const head = parseLine(lines[0]);
    const iId = head.indexOf('ident'), iIcao = head.indexOf('icao_code');
    for (let i = 1; i < lines.length; i++) {
      const r = parseLine(lines[i]);
      const ident = (r[iId] || '').trim().toUpperCase(), icao = (r[iIcao] || '').trim().toUpperCase();
      if (ident && icao && icao !== ident) icaoByIdent.set(ident, icao);
    }
  } else {
    console.warn('oa-keys: am-data/oa-airports.csv saknas — kör build-airports.mjs först (bara ident används nu)');
  }
  return (ident) => {
    const id = (ident || '').trim().toUpperCase();
    if (seed.has(id)) return id;
    const icao = icaoByIdent.get(id);
    return icao && seed.has(icao) ? icao : null;
  };
}
