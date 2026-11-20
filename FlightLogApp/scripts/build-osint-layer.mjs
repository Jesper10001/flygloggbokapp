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
import { familyOf, familyKey } from './osint-families.mjs';

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
// Specific → Types: modellfamilj per flygplanstyp (fam) och en kort beskrivning per familj (desc, ur
// fetch-type-descriptions.mjs → scripts/osint-data/type-descriptions.json).
const manual = JSON.parse(fs.readFileSync(path.join(__dirname, 'osint-data', 'type-descriptions-manual.json'), 'utf8'));
const descByKey = new Map(Object.entries(manual).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [familyKey(k), v]));
// Stavningsvarianter (G120, G-120, G 120) → en familj; namnet = den vanligaste stavningen
const spell = new Map();
for (const b of Object.values(bases)) for (const op of b.ops) for (const [, ts] of op.g) for (const t of ts) {
  const f = familyOf(t);
  if (!f) continue;
  const m = spell.get(familyKey(f)) ?? new Map();
  m.set(f, (m.get(f) ?? 0) + 1);
  spell.set(familyKey(f), m);
}
const shown = new Map([...spell].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
const fam = {}, desc = {};
for (const b of Object.values(bases)) for (const op of b.ops) for (const [, ts] of op.g) for (const t of ts) {
  const f = familyOf(t);
  if (!f) continue;
  const name = shown.get(familyKey(f));
  fam[t] = name;
  const d = descByKey.get(familyKey(f));
  if (d) desc[name] = d;
}
const compiled = { ru: '19 November 2026', eu: '19 November 2026', world: '20 November 2026' };
const v = crypto.createHash('sha1').update(JSON.stringify({ bases, fam, desc })).digest('hex').slice(0, 10);
const out = path.join(__dirname, '..', '..', 'proxy', 'data', 'osint-airbases.json');
fs.writeFileSync(out, JSON.stringify({ v, compiled, bases, fam, desc }));
console.log(`${new Set(Object.values(fam)).size} modellfamiljer, ${Object.keys(desc).length} med beskrivning. Skrev ${Object.keys(bases).length} baser (version ${v}) → proxy/data/osint-airbases.json${missing ? `; ${missing} utan land i seed (utelämnade)` : ''}`);
