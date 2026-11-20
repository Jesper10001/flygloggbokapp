// Tester för OSINT-lagret (INSTRUKTION_osint_lager.md avsnitt 7), körs mot samma kod som proxyn: node proxy/scripts/test-osint.mjs
// 3–5 (konfliktländer bara hemmabaser, rapporterade placeringar) gäller inte än: lagret har inga reported_deployment
// (användarens beslut 2026-11-20: Ryssland som i dag). Test 3 kontrollerar därför bara att inget kind-fält smugit in.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { filterLayer, makeOsintHandler } from '../src/osint.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const layer = JSON.parse(fs.readFileSync(path.join(dir, '..', 'data', 'osint-airbases.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(dir, '..', 'config', 'osint_exclusions.json'), 'utf8'));
const codes = JSON.parse(fs.readFileSync(path.join(dir, '..', '..', 'FlightLogApp', 'assets', 'airport-display-codes.json'), 'utf8')).d;
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FEL '} ${msg}`); if (!cond) fail++; };

const out = filterLayer(layer.bases, cfg);
const vals = Object.entries(out);
const nato = new Set([...cfg.nato, ...cfg.nato_operator_labels]);
const terr = new Set(cfg.nato_territories);
const extra = new Set(cfg.extra_excluded_countries);

ok(vals.every(([, b]) => !nato.has(b.c) && !terr.has(b.c) && !extra.has(b.c)), '1. ingen bas i Natoland, Natoterritorium, Schweiz eller Österrike');
ok(vals.every(([, b]) => b.c !== 'UA' || b.ops.every((o) => o.o === 'RU')), '1. baser i Ukraina bara med ryska förband (ockuperat område)');
ok(!out.LCRA, '1. Akrotiri (brittiskt basområde på Cypern) saknas');
ok(vals.every(([, b]) => b.ops.every((o) => !nato.has(o.o) && o.o !== 'UA' && !extra.has(o.o))), '2. inga förband från Nato, Ukraina, Schweiz eller Österrike, oavsett land');
ok(vals.every(([, b]) => b.ops.length > 0), '2. ingen bas utan förband kvar');
ok(vals.every(([, b]) => !('kind' in b) && b.ops.every((o) => !('kind' in o))), '3–5. inga rapporterade placeringar i lagret (bara hemmabaser)');
// 6. Koden appen visar (utils/airportCodes.layerCode): visningskoden, men aldrig en OurAirports-ident → "–"
const layerCode = (k) => { const d = codes[k] ?? k; return /^[A-Z]{2}-\d+$/.test(d) ? '–' : d; };
ok(vals.every(([k]) => !/^[A-Z]{2}-\d+$/.test(layerCode(k))), '6. inget visat kodvärde matchar ^[A-Z]{2}-\\d+$');
// Kända fall
ok(!!out.UUBW || !!Object.values(out).find((b) => b.c === 'RU'), 'ryska baser finns kvar');
ok(!Object.values(out).some((b) => b.c === 'SE'), 'svenska baser borta');
const misawa = Object.values(out).find((b) => /Misawa/.test(b.n));
ok(!!misawa && misawa.ops.every((o) => o.o === 'JP'), 'Misawa: bara japanska förband (amerikanska dolda)');

// 7. Spärrade länder → 451 utan data; övriga → 200 med lagret; ETag → 304
const handle = makeOsintHandler(layer, cfg);
for (const cc of cfg.blocked_countries) {
  const r = handle(new Request('https://x/osint/airbases', { headers: { 'CF-IPCountry': cc } }));
  const body = await r.text();
  ok(r.status === 451 && !body.includes('"bases"'), `7. ${cc} → ${r.status}, ingen data`);
}
const r = handle(new Request('https://x/osint/airbases', { headers: { 'CF-IPCountry': 'SE' } }));
const j = await r.json();
ok(r.status === 200 && Object.keys(j.bases).length === vals.length, `SE → 200 med ${Object.keys(j.bases).length} baser`);
const r304 = handle(new Request('https://x/osint/airbases', { headers: { 'CF-IPCountry': 'SE', 'If-None-Match': r.headers.get('ETag') } }));
ok(r304.status === 304, 'oförändrat lager → 304');
const shownTypes = new Set(vals.flatMap(([, b]) => b.ops.flatMap((o) => o.g.flatMap(([, ts]) => ts))));
ok(Object.keys(j.fam ?? {}).every((t) => shownTypes.has(t)), `Types: bara typer från visade baser (${Object.keys(j.fam ?? {}).length} typer, ${new Set(Object.values(j.fam ?? {})).size} familjer)`);
ok(Object.keys(j.desc ?? {}).every((f) => Object.values(j.fam).includes(f)), `Types: beskrivningar bara för skickade familjer (${Object.keys(j.desc ?? {}).length})`);
console.log(fail ? `${fail} fel` : `Alla gröna (${vals.length} av ${Object.keys(layer.bases).length} baser kvar)`);
process.exit(fail ? 1 : 0);
