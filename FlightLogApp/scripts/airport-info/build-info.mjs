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
    r.v = AIP_DATE;
  } else {
    const urls = [...new Set(['website', 'ppr', 'fuel', 'hours'].map((k) => a[k]?.url).concat((a.contacts || []).map((c) => c.url), (a.good_to_know || []).map((g) => g.url)).filter(Boolean))];
    r.src = urls.map((u) => ({ t: new URL(u).hostname.replace(/^www\./, ''), url: u }));
    r.v = a.as_of || RUN_DATE;
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
// Avgifter (FEES-raden, visas bara när de finns): reviewed/fees-*.json, citatkontrollerade med verify-fees.mjs
for (const f of read('fees-')) {
  if (out[f.key] && f.fees?.landing) out[f.key].fees = clean({ landing: f.fees.landing, parking: f.fees.parking, note: f.fees.note, year: f.fees.year, url: f.fees.url });
}
const file = path.join(dir, '..', '..', '..', 'proxy', 'data', 'airport-info-se.json');
fs.writeFileSync(file, JSON.stringify({ built: RUN_DATE, airports: out }));
console.log(`${Object.keys(out).length} flygplatser (${Object.values(out).filter((r) => r.kind === 'aip').length} AIP, ${Object.values(out).filter((r) => r.kind === 'web').length} hemsidor) → proxy/data/airport-info-se.json, ${Object.values(out).filter((r) => r.fees).length} med avgifter, ${fs.statSync(file).size} byte`);
