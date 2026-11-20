// Bygger proxyns grunddata för Airport Info (proxy/data/airport-info-se.json) ur de granskade filerna:
// reviewed/aip-*.json (AIP, officiellt) och reviewed/web-*.json (fältens egna hemsidor). Citaten följer inte med
// till appen (de finns kvar här som underlag); varje post har källa och datum. Ändringar görs sedan i Ops och
// sparas i proxyns KV (de vinner över grunddatan). Kör: node scripts/airport-info/build-info.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (g) => fs.readdirSync(path.join(dir, 'reviewed')).filter((f) => f.startsWith(g) && f.endsWith('.json'))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, 'reviewed', f), 'utf8')));
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'aip', '_index.json'), 'utf8'));
const AIP_DATE = (idx.amdt.match(/(\d{4})_(\d{2})_(\d{2})$/) || []).slice(1).join('-');
const RUN_DATE = new Date().toISOString().slice(0, 10);
// "Verified" i appen = dagen då citaten kontrollerades mot källan (verify-info.py / verify-web.py skriver
// verified/), inte AIRAC-datumet och inte dagen filen byggs. AIP-utgåvan syns i källänken.
const verifiedOn = (prefix) => {
  const ms = fs.readdirSync(path.join(dir, 'verified')).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => fs.statSync(path.join(dir, 'verified', f)).mtimeMs);
  return ms.length ? new Date(Math.max(...ms)).toISOString().slice(0, 10) : RUN_DATE;
};
const AIP_VERIFIED = verifiedOn('aip-'), WEB_VERIFIED = verifiedOn('web-');
const seed = new Map(JSON.parse(fs.readFileSync(path.join(dir, '..', '..', 'assets', 'icao-airports.dat'), 'utf8')).map((r) => [r[0], r[1]]));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)));

function record(a, kind) {
  const r = { kind, name: seed.get(a.icao ?? a.key) ?? a.name ?? '' };
  if (a.ppr) r.ppr = clean({ s: a.ppr.status, n: a.ppr.note, ph: a.ppr.phone, url: a.ppr.request_url });
  if (a.fuel) r.fuel = clean({ t: a.fuel.types, n: a.fuel.note, h: a.fuel.hours });
  if (a.hours) r.hours = clean({ ad: a.hours.ad, n: a.hours.note });
  if (a.contacts?.length) r.contacts = a.contacts.filter((c) => c.phone).map((c) => ({ l: c.label, ph: c.phone }));
  if (a.good_to_know?.length) r.gtk = a.good_to_know.map((g) => g.text);
  if (a.website?.value) r.web = a.website.value;
  if (a.email?.value) r.email = a.email.value;
  if (kind === 'aip') {
    r.src = [{ t: `AIP Sweden AD 2 ${a.icao} (AIRAC ${idx.amdt.replace(/_.*$/, '').replace('AIRAC AIP AMDT ', 'AMDT ')})`, url: idx.aerodromes[a.icao]?.url }];
    r.v = AIP_VERIFIED;
  } else {
    const urls = [...new Set(['website', 'ppr', 'fuel', 'hours'].map((k) => a[k]?.url).concat((a.contacts || []).map((c) => c.url), (a.good_to_know || []).map((g) => g.url)).filter(Boolean))];
    r.src = urls.map((u) => ({ t: new URL(u).hostname.replace(/^www\./, ''), url: u }));
    r.v = WEB_VERIFIED;   // sidans egen uppdateringsdag (as_of) är inte vår kontroll
  }
  return r;
}
const out = {};
for (const a of read('aip-')) out[a.icao] = record(a, 'aip');
for (const a of read('web-')) {
  if (a.status !== 'ok' && !['ppr', 'fuel', 'hours', 'contacts', 'good_to_know'].some((k) => a[k])) continue;
  const r = record(a, 'web');
  if (Object.keys(r).some((k) => ['ppr', 'fuel', 'hours', 'contacts', 'gtk'].includes(k))) out[a.key] = r;
}
// Tornens/AFIS nummer (fetch-gen33.py ur AIP GEN 3.3 → reviewed/twr-*.json): först bland kontakterna,
// källsidan läggs till bland källorna
for (const t of read('twr-')) {
  const r = out[t.key];
  if (!r || !t.contacts?.length) continue;
  // Finns numret redan (under det syfte AIP AD 2 nämner, t.ex. "PPR school flights") flyttas det först och får
  // båda: "Tower (TWR) · PPR school flights"
  const digits = (x) => x.replace(/\D/g, '');
  const rest = [...(r.contacts ?? [])];
  const first = t.contacts.map((c) => {
    const i = rest.findIndex((x) => digits(x.ph) === digits(c.phone));
    if (i < 0) return { l: c.label, ph: c.phone };
    const [old] = rest.splice(i, 1);
    const extra = old.l.replace(/^(TWR|ATS|AFIS)\b\s*/i, '').replace(/^\((.*)\)$/, '$1').trim();
    return { l: extra ? `${c.label} · ${extra}` : c.label, ph: old.ph };
  });
  r.contacts = [...first, ...rest];
  for (const c of t.contacts) if (!r.src.some((x) => x.url === c.url)) r.src.push({ t: `AIP Sweden GEN 3.3 (AIRAC ${idx.amdt.replace(/_.*$/, '').replace('AIRAC AIP AMDT ', 'AMDT ')})`, url: c.url });
}
// Avgifter (FEES-raden, visas bara när de finns): reviewed/fees-*.json, citatkontrollerade med verify-fees.mjs
for (const f of read('fees-')) {
  if (out[f.key] && f.fees?.landing) out[f.key].fees = clean({ landing: f.fees.landing, parking: f.fees.parking, note: f.fees.note, year: f.fees.year, url: f.fees.url });
}
const file = path.join(dir, '..', '..', '..', 'proxy', 'data', 'airport-info-se.json');
// built = tidsstämpel (ingår i proxyns ETag): två byggen samma dag måste få olika ETag
fs.writeFileSync(file, JSON.stringify({ built: new Date().toISOString().replace(/[-:]/g, '').slice(0, 15), airports: out }));
console.log(`${Object.keys(out).length} flygplatser (${Object.values(out).filter((r) => r.kind === 'aip').length} AIP, ${Object.values(out).filter((r) => r.kind === 'web').length} hemsidor) → proxy/data/airport-info-se.json, ${Object.values(out).filter((r) => r.fees).length} med avgifter, ${fs.statSync(file).size} byte`);
