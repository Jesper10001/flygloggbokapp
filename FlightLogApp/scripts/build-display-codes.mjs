// Visningskoder för flygplatser utan ICAO-kod (nyckeln är då OurAirports egna ident, t.ex. RU-8363 eller CH-0004).
// Användarens regel (2026-11-19): ICAO i första hand, annars local_code, annars gps_code; finns ingen behålls identen.
// Undantag Brasilien: gps_code (ANAC:s fyrbokstavskod) före local_code, se nedan.
// Nyckeln ändras ALDRIG (flygningar, favoriter, landningar och banor pekar på den) — bara koden som VISAS.
// Skriver assets/airport-display-codes.json: { d: { nyckel: kod }, a: [nycklar vars kod är tvetydig] }.
// Tvetydig = koden är också en annan flygplats nyckel, IATA eller gps-kod, eller delas av flera (t.ex. "MCO" =
// Los Menucos lokala kod och Orlandos IATA). Tvetydiga koder visas men används aldrig för att slå upp en flygplats,
// i Log Flight eller i CSV-exporten (där står nyckeln, så att en import hittar rätt flygplats).
// Körs efter build-airports.mjs (läser dess cache scripts/am-data/oa-airports.csv). Kör: node scripts/build-display-codes.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'));
const csv = fs.readFileSync(path.join(__dirname, 'am-data', 'oa-airports.csv'), 'utf8');

// Enkel CSV-läsare (citattecken med kommatecken inuti).
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const [head, ...body] = parseCSV(csv);
const ix = Object.fromEntries(head.map((h, i) => [h, i]));
const oa = new Map(body.map((r) => [r[ix.ident], r]));

const isGenerated = (k) => /^[A-Z]{2}-[A-Z0-9]+$/.test(k);
// kod → nycklarna till de flygplatser som redan har den som nyckel/IATA/gps. En flygplats egen gps-kod räknas inte
// som krock (takenByOther), bara andra flygplatsers.
const takenBy = new Map();
for (const r of seed) for (const c of new Set([r[0], r[6], r[11]].filter(Boolean).map((x) => String(x).toUpperCase()))) (takenBy.get(c) ?? takenBy.set(c, new Set()).get(c)).add(r[0]);
const takenByOther = (code, self) => [...(takenBy.get(code) ?? [])].some((k) => k !== self);

const d = {};
for (const r of seed) {
  if (!isGenerated(r[0])) continue;
  const o = oa.get(r[0]); if (!o) continue;
  const local = (o[ix.local_code] || '').trim().toUpperCase(), gps = (o[ix.gps_code] || '').trim().toUpperCase();
  // Brasilien (användarens beslut 2026-11-19): local_code är ett registernummer (SP0598) medan gps_code är ANAC:s
  // fyrbokstavskod (SJBM) som piloterna skriver → gps först, men bara om koden inte redan är en annan flygplats
  // (brasilianska koder återanvänds: en stängd heliports SSZJ tillhör nu en fazenda 1 250 km bort).
  // Gamla rader (nycklar som inte längre finns i OurAirports) räknas inte: koden har då gått vidare till det här fältet.
  const brGps = r[2] === 'BR' && /^[A-Z]{4}$/.test(gps) && ![...(takenBy.get(gps) ?? [])].some((k) => k !== r[0] && oa.has(k));
  const code = brGps ? gps : local || gps;
  if (code && code !== r[0] && /^[A-Z0-9-]{2,8}$/.test(code)) d[r[0]] = code;
}
const shared = new Map();
for (const c of Object.values(d)) shared.set(c, (shared.get(c) || 0) + 1);
const a = Object.keys(d).filter((k) => takenByOther(d[k], k) || shared.get(d[k]) > 1).sort();
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'airport-display-codes.json'), JSON.stringify({ d, a }));
const gen = seed.filter((r) => isGenerated(r[0])).length;
console.log(`Flygplatser utan ICAO: ${gen} · får visningskod: ${Object.keys(d).length} (varav tvetydiga ${a.length}) · behåller identen: ${gen - Object.keys(d).length}`);
