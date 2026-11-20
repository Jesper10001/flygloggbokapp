// Bygger proxyns OSINT-lager (Global map → Air Bases → Specific) ur de tre datamängderna i scripts/osint-data:
// ru (användarens fil), eu och world. Vid samma flygplats vinner ru, sedan eu. Varje bas får sitt land (c) ur
// icao-airports.dat så att proxyn kan filtrera enligt proxy/config/osint_exclusions.json (Nato, territorier, m.m.).
// Lagret ligger INTE i appen längre (2026-11-20): appen hämtar det från proxyns GET /osint/airbases.
// Kör efter build-ru-/build-eu-airbases.mjs: node scripts/build-osint-layer.mjs   → proxy/data/osint-airbases.json
// (därefter proxydeploy: npx wrangler deploy --config proxy/wrangler.toml)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'osint-data', f), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'));
const country = new Map(seed.map((r) => [r[0], r[2]]));

const bases = {};
let missing = 0;
for (const f of ['world-airbases.json', 'eu-airbases.json', 'ru-airbases.json']) {
  for (const [k, b] of Object.entries(read(f))) {
    const c = country.get(k);
    if (!c) { missing++; continue; }
    bases[k] = { ...b, c };
  }
}
const compiled = { ru: '19 November 2026', eu: '19 November 2026', world: '20 November 2026' };
const v = crypto.createHash('sha1').update(JSON.stringify(bases)).digest('hex').slice(0, 10);
const out = path.join(__dirname, '..', '..', 'proxy', 'data', 'osint-airbases.json');
fs.writeFileSync(out, JSON.stringify({ v, compiled, bases }));
console.log(`Skrev ${Object.keys(bases).length} baser (version ${v}) → proxy/data/osint-airbases.json${missing ? `; ${missing} utan land i seed (utelämnade)` : ''}`);
