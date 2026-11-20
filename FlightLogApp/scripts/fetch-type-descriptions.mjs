// Kort militär beskrivning per modellfamilj i OSINT-lagret (Specific → Types), t.ex. "Su-57" → "5th gen multirole
// fighter". Källan är Wikipedias kortbeskrivning (Wikidata) för första sökträffen på "<familj> aircraft", förkortad.
// Resultat + källsida i scripts/osint-data/type-descriptions.json (befintliga poster hämtas inte igen;
// manual: true = handskriven, rörs aldrig). Kör: node scripts/fetch-type-descriptions.mjs  (därefter build-osint-layer.mjs)
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { familyOf } from './osint-families.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, 'osint-data', 'type-descriptions.json');
const sets = ['world', 'eu', 'ru'].map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'osint-data', `${f}-airbases.json`), 'utf8')));
const fams = new Set();
for (const s of sets) for (const b of Object.values(s)) for (const op of b.ops) for (const [, ts] of op.g) for (const t of ts) { const f = familyOf(t); if (f) fams.add(f); }
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const UA = 'BladesBaseResearch/1.0 (open-data research)';

const DEMONYM = /^(?:(?:Soviet|Russian|American|US|U\.S\.|Chinese|French|British|German|Italian|Swedish|Brazilian|Indian|Japanese|Israeli|Spanish|Czech|Czechoslovak|Polish|Ukrainian|Turkish|South Korean|Korean|Swiss|Canadian|Argentine|Argentinian|Pakistani|Iranian|Taiwanese|South African|Australian|Dutch|Austrian|Yugoslav|Serbian|Romanian|Chilean|Indonesian|European|Anglo-French|Franco-German|Sino-Pakistani|Italian-Brazilian|Spanish-Indonesian|Belgian|Norwegian|Finnish|Danish|Greek|Hungarian|Mexican|Colombian|Peruvian|Egyptian|Saudi|Emirati|Singaporean|Malaysian|Thai|Vietnamese|Filipino|North Korean|New Zealand|Irish|Portuguese|Slovak|Slovenian|Croatian|Bulgarian|Belarusian|Kazakh|Georgian|Armenian|Azerbaijani|Uzbek|Algerian|Moroccan|Nigerian|Kenyan|Ethiopian|Venezuelan|Ecuadorian|Bolivian|Uruguayan|Paraguayan|Cuban|multinational|international)(?:[- ](?:built|made|designed))?[ ,]+(?:and |& )?)+/i;

function shorten(d) {
  let s = d.trim();
  s = s.replace(DEMONYM, '');
  s = s.replace(/\bfifth[- ]generation\b/gi, '5th gen').replace(/\bfourth[- ]generation\b/gi, '4th gen').replace(/\bthird[- ]generation\b/gi, '3rd gen')
    .replace(/\b(\d)(?:th|rd|nd)[- ]generation\b/gi, '$1th gen').replace(/\bfamily of\b\s*/i, '').replace(/\bseries of\b\s*/i, '')
    .replace(/\b(military|combat)\s+(?=transport|helicopter|trainer)/i, '$1 ')
    .replace(/\s+aircraft\b(?! carrier)/i, '').replace(/\s+airplane\b/i, '')
    .replace(/,? (?:developed|designed|built|manufactured|produced|made) (?:by|in) .*$/i, '')
    .replace(/,? first flown .*$/i, '').replace(/ \(\d{4}\)$/, '').replace(/ in service .*$/i, '');
  s = s.split(/;|, which /)[0].trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > 48 ? s.slice(0, 48).replace(/\s+\S*$/, '') : s;
}
const AVIATION = /aircraft|airplane|aeroplane|helicopter|fighter|bomber|trainer|airliner|transport|jet|drone|unmanned|UAV|glider|airlifter|tanker|seaplane|amphibi|airship|turboprop|biplane|monoplane|gunship|interceptor|reconnaissance|rotorcraft|tiltrotor/i;

let n = 0;
// Steg 1 (det här skriptet): källa per familj — Wikipedias titel, kortbeskrivning och första mening. Steg 2: den korta
// militära beskrivningen (d) skrivs utifrån källan och läggs i samma fil (manual: true).
for (const fam of [...fams].sort()) {
  if (out[fam]?.title || out[fam]?.manual) continue;
  const q = encodeURIComponent(`${fam} aircraft`);
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrlimit=3&prop=description%7Cextracts&exintro=1&explaintext=1&exsentences=1&exlimit=3&redirects=1`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let txt = '';
    try { txt = execFileSync('curl', ['-s', '--max-time', '20', '-A', UA, '-w', '\\n%{http_code}', url]).toString(); } catch { /* nätfel */ }
    const code = txt.slice(txt.lastIndexOf('\n') + 1);
    if (code === '429' || !txt) { execFileSync('sleep', [String(10 * (attempt + 1))]); continue; }
    try {
      const j = JSON.parse(txt.slice(0, txt.lastIndexOf('\n')));
      const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => a.index - b.index);
      const hit = pages.find((p) => AVIATION.test(`${p.description ?? ''} ${p.extract ?? ''}`)) ?? null;
      if (hit) out[fam] = { ...(out[fam] ?? {}), title: hit.title, raw: hit.description ?? '', extract: (hit.extract ?? '').slice(0, 220),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}` };
      else out[fam] = { ...(out[fam] ?? {}), title: '–' };   // ingen flygplanssida hittad
    } catch { /* trasigt svar */ }
    break;
  }
  if (++n % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`${n} hämtade`); }
  execFileSync('sleep', ['1.2']);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const miss = Object.entries(out).filter(([, v]) => !v.title || v.title === '–').map(([k]) => k);
console.log(`Klart: ${Object.keys(out).length} familjer, ${miss.length} utan källsida: ${miss.join(' | ')}`);
