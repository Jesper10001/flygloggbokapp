// Bygger assets/eu-airbases.json ur scripts/eu-airbases/flygbaser_europa.csv (Europas flygbaser med förband och
// flygplanstyper, sammanställd 2026-11-19 ur Wikipedia, flygvapnens/försvarsministeriernas sidor m.fl.; Ukraina ej med).
// Samma form som ru-airbases.json: { nyckel: { n, r, s: 'eu', ops: [{ o, c, u, g }] } } — flera länders förband på
// samma bas blir flera ops. Nyckel = flygplatsens nyckel i icao-airports.dat (OurAirports-ident, kod eller närmast ≤ 1,5 km).
// Kör: node scripts/build-eu-airbases.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'));
const keys = new Map(seed.map((r) => [r[0], r]));
const byCode = new Map();
for (const r of seed) for (const c of [r[0], r[11]]) if (c && !byCode.has(String(c).toUpperCase())) byCode.set(String(c).toUpperCase(), r);

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
const [head, ...body] = parseCSV(fs.readFileSync(path.join(__dirname, 'eu-airbases', 'flygbaser_europa.csv'), 'utf8'));
const ix = Object.fromEntries(head.map((h, i) => [h, i]));

// Roll per flygplanstyp (första träff vinner; ordningen spelar roll: tankning/spaning före transport, skol före jakt).
// Mönstren har ordgräns bara FÖRE namnet, så att varianter som F-35A och F-16C/D Block 52+ också träffar.
const ROLE_RX = [
  ['special', /\b(E-3|E-7|AWACS|Sentry|Wedgetail|RC-135|Rivet Joint|P-8|Poseidon|P-3|Orion|Atlantique|ATR 72 ?MP|P-72|C-?295 ?(MPA|Persuader|MSA|W MSA)|C295W MSA|CN-235M?(-100)? ?MP|Falcon 50M|Falcon 2000 ?(MRA|LXS)|MRTT|KC-|Voyager|Phénix|Tanker|SIGINT|ELINT|Korpen|S 102|S 100|Global ?Eye|Shadow R1|Airseeker|Sentinel|MQ-|RQ-|Reaper|Predator|SkyGuardian|Protector|Heron|Hermes|Bayraktar|TB2|Akinci|Anka|Global Hawk|Triton|Phoenix|UAV|Drone|ScanEagle|Camcopter|Schiebel|C-135FR|MC-130|EC-27J|Jedi|CAEW|G550|E-2|Hawkeye|Saab 340 AEW|Erieye|ASaC|Vigilance|Archange|ALSR|CL-215|CL-415|DHC-515|Canadair|AT-802|Air Tractor|Dromader|M-18)/i],
  ['heli', /\b(NH-?90|SH-90|MH-90|AW101|EH-?101|HH-101|MH-101|SH-101|AW109|A109|HH-139|VH-139|AW139|AW149|AW169|AW189|A129|AH-129|T129|ATAK|Mangusta|H145|H135|H160|H175|H215|H225|H125|EC135|EC145|EC635|EC725|EC225|AS ?332|AS ?532|AS ?350|AS ?365|AS ?565|AS ?555|SA ?330|SA ?341|SA ?342|SA ?316|SA ?319|IAR 330|Alouette|Gazelle|Puma|Cougar|Caracal|Super Puma|Dauphin|Panther|Fennec|Écureuil|Ecureuil|Tiger|Tigre|EC665|Apache|AH-64|Chinook|CH-47|Black ?Hawk|UH-60|HH-60|MH-60|S-70|Seahawk|Sea ?Hawk|SH-60|Sea King|Lynx|Wildcat|Merlin|Jupiter|Juno|Puma HC|Bell ?(205|206|212|412|429|505)|Bell AH-1|Bell UH-1|UH-1|AB[- ]?(205|206|212|412)|Huey|Viper|Venom|Mil |Mi-|Ka-|W-3|PZL W-3|Sokół|Sokol|Głuszec|Anakonda|S-92|CH-53|Sikorsky CH-53|MD 500|NH-500|MD 902|Sea Lynx|Super Lynx|SH-3|AW159|Cobra|AH-1|Kiowa|OH-58|UH-72|Lakota|Bo 105|Bo-105|BO 105|Osprey|CV-22|MV-22|Helicopter|Hkp)/i],
  ['training', /\b((?<!(Black|Sea|Global|Night) )Hawk|M-346|T-346|M-345|T-345|Master|Alpha ?Jet|PC-21|PC-9|PC-7|Pilatus PC-9|T-6|Texan|T-7|T-38|Talon|Grob|G ?120|G ?115|SK 40|SF[.-]?260|S\.208|Tucano|Super Tucano|Epsilon|TB ?30|Cirrus|SR20|SR22|Diamond|DA ?20|DA ?40|DA ?42|Zl[ií]n|L-39|Aermacchi|MB-339|Hürkuş|Hurkus|KT-1|Firefly|Tutor|Prefect|Viking|Vigilant|Avenger|glider|Gliders|Discus|Nimbus|LAK-|ASK ?2\d|Twin Astir|Phoebus|Blaník|Blanik|PZL-130|Orlik|Bielik|Lasta|IAR ?99|Șoim|Soim|Iak-52|Yak-52|Yak-130|T-45|TB-?20|Socata|Robin|DR ?400|EC120|H120|Colibri|AW119|Koala|SW-4|Puszczyk|Cabri|MFI-1[57]|Safari|Supporter|Extra 3|Jodel|CAP ?10|Dimona|Chipmunk|DHC-1|Super Cub|L-21|Pelegrin|Tarragon|C-101|Aviojet|Mirage 2000B|TAV-8|Jet Provost|Bulldog)/i],
  ['fighter', /\b(F-35|F-16|F-15|F\/A-18|EF-18|C\.15|F-18|CF-18|Hornet|Typhoon|Eurofighter|Rafale|Gripen|JAS ?39|Mirage ?2000|Mirage 2000-5|MiG-29|Mikoyan|MiG-21|Su-27|Su-30|Su-35|F-4|Phantom|F-5|NF-5|FA-50|Kfir|Harrier|AV-8|Spitfire|Hurricane)/i],
  ['bomber', /\b(Tornado|Mirage 2000D|Mirage 2000N|Su-24|Su-34|B-52|B-1|B-2|Lancaster)/i],
  ['attack', /\b(A-10|Thunderbolt|AMX|A-11|Su-25|Su-22|Ghibli|A-29|EMB-314|L-159|Super Galeb|Orao|J-22)/i],
  ['transport', /\b(C-130|Hercules|C-160|Transall|A400M|Atlas|C-27J|Spartan|CASA C-?295|C-?295|CN-?235|C-17|Globemaster|KC-390|C-390|Millennium|C-5|Galaxy|C-21|C-37|C-40|C-12|Huron|C-26|Learjet|Falcon|Dassault|Gulfstream|Global|Bombardier|Challenger|Embraer|EMB-1[23]|Legacy|Phenom|ERJ|E-190|E190|A3[0-4]\d|Airbus|Boeing|737|757|767|777|Tp 84|Tp 100|Tp 102|Tp 106|Saab 340|Saab 2000|King Air|Beech|Beechcraft|PC-12|PC12|Pilatus PC-12|PC-6|Porter|Dornier|Do ?228|Twin Otter|DHC-6|Dash 8|Q400|ATR|An-|PZL An-|M28|PZL M28|Skytruck|Bryza|L-410|Let 410|Turbolet|Il-76|Tu-134|Tu-154|Yak-40|Citation|Cessna|Piaggio|P\.180|P180|Avanti|Islander|Defender|BN-2|CASA 212|C-212|Aviocar|Sherpa|Caravan|Kodiak|Super King|Shorts|EMB-145|Lineage|Fokker|Hawker|BAe 146|Bae 146|Envoy|Avro RJ|TBM|Xingu|Dakota|C-47|Super Ventura)/i],
];
const roleOf = (t) => (ROLE_RX.find(([, rx]) => rx.test(t)) || [null])[0];

const km = (a, b, c, d) => Math.hypot(a - c, (b - d) * Math.cos((a * Math.PI) / 180)) * 111;
const out = {}, skipped = [], unmatched = new Map();
for (const r of body) {
  const name = r[ix.namn]; if (!name) continue;
  const lat = parseFloat(r[ix.latitud]), lon = parseFloat(r[ix.longitud]);
  let key = keys.has(r[ix.ourairports_ident]) ? r[ix.ourairports_ident] : null;
  if (!key) for (const c of [r[ix.icao_code], r[ix.visningskod], r[ix.gps_code]]) { const hit = c && byCode.get(c.toUpperCase()); if (hit && Number.isFinite(lat) && km(lat, lon, hit[4], hit[5]) < 5) { key = hit[0]; break; } }
  if (!key && Number.isFinite(lat)) {
    let best = null;
    for (const s of seed) { if (Math.abs(s[4] - lat) > 0.05 || Math.abs(s[5] - lon) > 0.1) continue; const d = km(lat, lon, s[4], s[5]); if (d <= 1.5 && (!best || (best[1][8] === 'closed' && s[8] !== 'closed') || d < best[0])) best = [d, s]; }
    if (best) key = best[1][0];
  }
  if (!key) { skipped.push(`${r[ix.forband_land]} ${name}`); continue; }
  const groups = [];
  for (const t of r[ix.flygplanstyper].split(/,\s*(?![^()]*\))/).map((x) => x.trim()).filter(Boolean)) {
    const role = roleOf(t);
    if (!role) { unmatched.set(t, (unmatched.get(t) || 0) + 1); continue; }
    const g = groups.find((x) => x[0] === role);
    g ? (g[1].includes(t) || g[1].push(t)) : groups.push([role, [t]]);
  }
  const op = { o: r[ix.forband_land], c: r[ix.kommando], u: r[ix.forband].split(';').map((s) => s.trim()).filter(Boolean), g: groups };
  if (out[key]) out[key].ops.push(op);
  else out[key] = { n: name, r: r[ix.region], s: 'eu', ops: [op] };
}
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'eu-airbases.json'), JSON.stringify(out));
const multi = Object.values(out).filter((b) => b.ops.length > 1).map((b) => `${b.n} (${b.ops.map((o) => o.o).join('+')})`);
console.log(`Skrev ${Object.keys(out).length} baser (${body.filter((r) => r[ix.namn]).length} rader). Flera länder: ${multi.join(', ') || '–'}`);
console.log(`Utan position/nyckel (${skipped.length}): ${skipped.join(', ') || '–'}`);
console.log(`Typer utan roll (${unmatched.size}): ${[...unmatched.keys()].join(' | ') || '–'}`);
