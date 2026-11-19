// Sätter undertyper (SeedRow[12], kommaseparerade koder) på flygplatserna i assets/icao-airports.dat, för filtren
// på global map (constants/mapFilters.ts: FILTER_GROUPS). Körs EFTER build-airports.mjs (som skriver om .dat).
// Rör aldrig något annat fält — nycklar, namn och koordinater är orörda.
//
// Källor (cachade, gitignorerade):
//  - scripts/osm-data/classify/ov/*.json: Overture Maps base/infrastructure (OSM-härlett, ODbL) — flygplatser,
//    helipads och oljeplattformar med OSM-taggar (se scripts/fetch-overture-aero.py).
//  - scripts/osm-data/classify/bld/*.json: byggnader runt varje heliport (scripts/fetch-osm-classify.mjs --bld-only).
//  - scripts/runways.csv: OurAirports banor (yta: ROOF-TOP, ICE, SNOW …).
//  - scripts/ne-data/ne_50m_admin_0_countries.geojson: land (är punkten till havs?).
// Koder: hp helipad (upphöjd på byggnad) · os offshore · af/nv/ar flygbas (Air Force/Navy & Marines/Army) ·
//        gl gliding · ul ultralight · fr farm & ranch · ap airpark · ag agricultural · lc lodge & camp · is island ·
//        sk skydiving · ic is/snö · sp spaceport · bh strandlandning
// Kör: node scripts/build-airport-subtypes.mjs [--dry]   (--dry skriver bara rapporten, inte .dat)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAT = path.join(__dirname, '..', 'assets', 'icao-airports.dat');
const CL = path.join(__dirname, 'osm-data', 'classify');
const DRY = process.argv.includes('--dry');
const seed = JSON.parse(fs.readFileSync(DAT, 'utf8'));

// ── Hjälpare ────────────────────────────────────────────────────────────────
const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
const distM = (la1, lo1, la2, lo2) => {
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
// Punkt i polygon (ring = [[lat, lon], …] eller [[lon, lat], …] med flaggan lonFirst).
function inRing(lat, lon, ring, lonFirst = false) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = lonFirst ? ring[i][1] : ring[i][0], xi = lonFirst ? ring[i][0] : ring[i][1];
    const yj = lonFirst ? ring[j][1] : ring[j][0], xj = lonFirst ? ring[j][0] : ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Rutnätsindex (0,05°) för närhetsuppslag.
function gridIndex(items, cell = 0.05) {
  const m = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.lat / cell)}_${Math.floor(it.lon / cell)}`;
    (m.get(k) ?? m.set(k, []).get(k)).push(it);
  }
  return (lat, lon, rM) => {
    const span = Math.ceil(rM / 111000 / cell) + 0;
    const a = Math.floor(lat / cell), b = Math.floor(lon / cell), out = [];
    for (let i = a - span - 1; i <= a + span + 1; i++) for (let j = b - span - 1; j <= b + span + 1; j++) for (const it of m.get(`${i}_${j}`) ?? []) if (distM(lat, lon, it.lat, it.lon) <= rM) out.push(it);
    return out;
  };
}
// Polygonens yta i m² (ring = [[lat, lon], …]), plan approximation — räcker för byggnader.
const areaM2 = (ring) => {
  let a = 0; const k = Math.cos(toRad(ring[0][0])) * 111320;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][1] * k) * (ring[i][0] * 110540) - (ring[i][1] * k) * (ring[j][0] * 110540);
  return Math.abs(a / 2);
};
const MIN_BLD_M2 = Number(process.env.MIN_BLD_M2 ?? 400);
const NOSURF = !!process.env.NOSURF;   // bara för mätning: stäng av ytregeln
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Data ────────────────────────────────────────────────────────────────────
// [{c, n, lat, lon, lv, h, t:{…}}] — en fil per Overture-del (läses alltid direkt, så att inget saknas om två
// arbetare skrivit den sammanfogade filen vid olika tidpunkter).
const ov = fs.readdirSync(path.join(CL, 'ov')).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(CL, 'ov', f), 'utf8')));
// OBS: Overtures klass 'platform' är mest perronger — oljeplattformar känns igen på OSM-taggen man_made=offshore_platform.
const isPlat = (o) => o.t?.man_made === 'offshore_platform' || o.c === 'offshore_platform';
const AERO_C = new Set(['airport', 'regional_airport', 'airstrip', 'international_airport', 'military_airport', 'private_airport', 'municipal_airport', 'seaplane_airport']);
const ovAero = ov.filter((o) => AERO_C.has(o.c) && !isPlat(o));
const ovPads = ov.filter((o) => o.c === 'helipad' || o.c === 'heliport');
const ovPlat = ov.filter(isPlat);
const ovLaunch = ov.filter((o) => o.c === 'launchpad');
const nearAero = gridIndex(ovAero), nearPad = gridIndex(ovPads), nearPlat = gridIndex(ovPlat), nearLaunch = gridIndex(ovLaunch);
// Kodindex: OSM icao/faa/ref/local_ref → objekt.
const byCode = new Map();
for (const o of ovAero) for (const k of ['icao', 'faa', 'ref', 'local_ref', 'iata', 'gps_code']) { const v = o.t?.[k]; if (v) for (const c of String(v).split(/[;,\s]+/)) if (c.length >= 3) byCode.set(c.toUpperCase(), o); }

// Byggnader runt heliports.
const bldById = new Map();   // heliport-ident → byggnadslista
for (const f of fs.existsSync(path.join(CL, 'bld')) ? fs.readdirSync(path.join(CL, 'bld')) : []) {
  const { ids, els } = JSON.parse(fs.readFileSync(path.join(CL, 'bld', f), 'utf8'));
  const bl = els.map((e) => { let la = 0, lo = 0; e.g.forEach((p) => { la += p[0]; lo += p[1]; }); return { ...e, lat: la / e.g.length, lon: lo / e.g.length }; });
  const near = gridIndex(bl, 0.01);
  for (const id of ids) bldById.set(id, near);
}

// OurAirports-banor: yta per flygplats.
const oaSurf = new Map();
{
  const lines = fs.readFileSync(path.join(__dirname, 'runways.csv'), 'utf8').split('\n').slice(1);
  for (const ln of lines) {
    const m = ln.match(/^\d+,\d+,"([^"]*)",[^,]*,[^,]*,"([^"]*)"/);
    if (!m) continue;
    (oaSurf.get(m[1]) ?? oaSurf.set(m[1], []).get(m[1])).push(m[2].toUpperCase());
  }
}

// Land (Natural Earth 50 m) → till havs?
const land = [];
{
  const ne = JSON.parse(fs.readFileSync(path.join(__dirname, 'ne-data', 'ne_50m_admin_0_countries.geojson'), 'utf8'));
  for (const f of ne.features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) { const ring = p[0]; let a = 90, b = -90, c = 180, d = -180; for (const [x, y] of ring) { a = Math.min(a, y); b = Math.max(b, y); c = Math.min(c, x); d = Math.max(d, x); } land.push({ ring, a, b, c, d }); }
  }
}
const onLand = (lat, lon) => land.some((p) => lat >= p.a && lat <= p.b && lon >= p.c && lon <= p.d && inRing(lat, lon, p.ring, true));
// Vid kusten: någon punkt 2,5 km bort (16 riktningar) ligger till havs. (Landgränser mot grannländer räknas inte —
// där är andra sidan också land.)
const coastal = (lat, lon, km = 2.5) => {
  const d = km / 111;
  for (let k = 0; k < 16; k++) { const t = (k * Math.PI) / 8; if (!onLand(lat + d * Math.sin(t), lon + (d * Math.cos(t)) / Math.cos(toRad(lat)))) return true; }
  return false;
};

// ── Regler ──────────────────────────────────────────────────────────────────
const RX = {
  gl: /\bglider|(?<!para)gliding|gliderport|segelf|soaring|vol a voile|velivol|zweefvlieg|svaeveflyv|svæveflyv|seilfly|purjelento|szybowisk|planeador|planador|plachtar|segelflyg/,
  ul: /ultralight|ultra-light|ultra light|microlight|\bulm\b|\bul\b|ultraleicht|ultralehk|ultralett|ultrakevyt|\bulf\b|ultralightport|aeroclub ul/,
  ap: /airpark|air park|\bfly-?in\b|skypark|sky park|aero estates|air estates|airstrip estates|fly in community/,
  ag: /\bag\b|\bagri(cultur|col)|crop dust|dusting|aerial applic|flying service|aerial spray|\bspray/,
  fr: /\branch\b|\bfarms?\b|fazenda|estancia|hacienda|plantation|\bstation\b|\bfinca\b|\bgranja\b|\bdairy\b|\borchard/,
  lc: /\blodge\b|\bresort\b|\bcamp\b|\bfishing\b|\bhunting\b|\boutfitters?\b|\bsafari\b|\bwilderness\b/,
  is: /\bisland\b|\bilha\b|\bisla\b|\bisle\b|\bisola\b|\bile\b|\binsel\b|\boy\b|\bsaari\b|\bcay\b|\bislet\b/,
  sk: /skydiv|parachut|drop zone|fallschirm|parachutisme|paracaidis|skydive/,
  sp: /spaceport|space port|cosmodrome|space center|spaceflight/,
  ic: /\bice runway|\bsea ice|skiway|ski-way|altisurface du glacier|glacier landing|\bglacier$|\bice strip|snow runway|blue ice|\bneve\b|\bice airstrip|\bice airfield/,
  af: /air force|\bafb\b|\braf\b|\braaf\b|\brcaf\b|\brnzaf\b|\bsaaf\b|\bjasdf\b|\brokaf\b|base aerea|base aérea|fliegerhorst|flygflottilj|flottilj|luftwaffe|air base|airbase|\bab\b|aviabaz|авиабаз|base aerienne|base aérienne|luchtmacht|vliegbasis|flyestasjon|lentotukikohta|baza lotnicza|letiste|letecka zakladna|hava us|air national guard|\bang\b|air reserve|\barb\b|\bpaf\b|\biaf\b|\btaf\b|\bplaaf\b/,
  nv: /naval|\bnavy\b|\bnas\b|\bnalf\b|\bolf\b|\brnas\b|\bjmsdf\b|marine corps|royal marines|\bmcas\b|\bmcaf\b|\bmcolf\b|marinefliegerhorst|marineflieger|aeronaval|aéronaval|aeronavale|base aeronaval|naval air|coast guard|\buscg\b|garde cote|kustbevakning|fleet air arm|\bins\b/,
  ar: /\barmy\b|\baaf\b|\bejercito\b|\bexercito\b|aviacion del ejercito|army airfield|army heliport|stagefield|stage field|\bjgsdf\b|heeresflieger|heeresflugplatz|\bfort\b|\bcamp\b|army air corps|\baac\b|aviation legere|aviation légère|\balat\b|\bcavalry\b|landing zone|\blz\b|\bfob\b|\bcop\b|garrison/,
};
const OPS = {   // OSM operator / military_service → vapenslag
  af: /air force|luftwaffe|armee de l'air|aeronautica militare|ejercito del aire|forca aerea|fuerza aerea|flygvapnet|luftforsvaret|flyvevaabnet|ilmavoimat|sily powietrzne|воздушн|вкс|air_force|aerospace forces|space force|space_force|\bfab\b|\bfap\b|\bfach\b|region aerea/,
  nv: /navy|naval|marine|kriegsmarine|marina militare|armada|marinha|marinen|sjoforsvaret|merivoimat|coast guard|coastguard|морск|флот|marines|coast_guard|semar|secretaria de marina/,
  ar: /army|heer\b|esercito|ejercito|exercito|armee\b|armee de terre|haeren|hæren|maavoimat|wojska ladowe|сухопут|армия|army aviation/,
};

const out = new Map();     // ident → Set(koder)
const add = (id, c) => (out.get(id) ?? out.set(id, new Set()).get(id)).add(c);
const report = { hp: [], os: [], why: {} };

for (const r of seed) {
  const [id, name, cc, , lat, lon, , alt, type, , restr, gps] = r;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || type === 'closed') continue;
  const nm = norm(name);
  // Närmaste Overture-flygplats: kodmatchning först, annars ≤ 1,5 km.
  let o = byCode.get(String(id).toUpperCase()) || (gps && byCode.get(String(gps).toUpperCase()));
  if (o && distM(lat, lon, o.lat, o.lon) > 8000) o = null;
  if (!o) { const near = nearAero(lat, lon, 1500).sort((a, b) => distM(lat, lon, a.lat, a.lon) - distM(lat, lon, b.lat, b.lon)); o = near[0] || null; }
  const t = o?.t || {};
  const tagStr = norm([t['aerodrome:type'], t.aerodrome, t.sport, t.operator, t.military_service, t.military, t['aerodrome:use'], t.landuse].filter(Boolean).join(' '));
  const surfs = oaSurf.get(id) || (gps ? oaSurf.get(gps) : null) || [];

  // Flygbaser
  if (restr === 'military') {
    const ops = norm([t.operator, t.military_service, t['operator:type']].filter(Boolean).join(' '));
    let b = null;
    for (const k of ['nv', 'ar', 'af']) if (RX[k].test(nm)) { b = k; break; }
    if (!b) for (const k of ['af', 'nv', 'ar']) if (OPS[k].test(ops)) { b = k; break; }
    if (b) add(id, b);
  }

  // Helikopter
  if (type === 'heliport') {
    // Offshore: oljeplattform inom 1,5 km, eller till havs + namn som plattform/fartyg.
    const plat = nearPlat(lat, lon, 1500).length > 0;
    const sea = !onLand(lat, lon);
    const offName = /\bplatform\b|\brig\b|\bfpso\b|\bfso\b|\bfpu\b|offshore|helideck|jack-?up|drill ?ship|\bvessel\b|\bblock [a-z0-9]|\bunit\b.*\bfield|semi-?sub/.test(nm);
    if (plat || (sea && offName) || (sea && /\b[a-z]+ [a-z]\b$/.test(nm) && cc !== 'US')) { add(id, 'os'); report.os.push([id, name, cc, plat ? 'plattform' : 'hav+namn']); continue; }
    // Helipad: tak-yta i OurAirports, OSM-helipad med tak/våningstaggar nära, eller punkten (eller en OSM-helipad inom
    // 60 m) ligger inuti en byggnad.
    let why = null;
    if (!NOSURF && surfs.some((s) => /ROOF|RFT|ROOFTOP|DECK|ELEV/.test(s))) why = 'yta';
    const pads = nearPad(lat, lon, 120);
    if (!why && pads.some((p) => /roof|rooftop|building/.test(norm(p.t?.location)) || (p.lv ?? 0) >= 1 || /^[1-9]/.test(p.t?.level || '') || p.t?.building)) why = 'osm-tak';
    const near = bldById.get(id);
    if (!why && near) {
      const cands = near(lat, lon, 200);
      // Byggnaden måste vara stor nog att bära en helikopterplatta (MIN_BLD_M2); små hus/lador under en privat
      // markplatta med lite fel koordinat räknas inte.
      const inB = (la, lo) => cands.some((b) => b.tags?.building !== 'roof' && b.tags?.building !== 'no' && areaM2(b.g) >= MIN_BLD_M2 && inRing(la, lo, b.g));
      if (inB(lat, lon)) why = 'byggnad';
      else if (pads.filter((p) => distM(lat, lon, p.lat, p.lon) <= 60).some((p) => inB(p.lat, p.lon))) why = 'osm-pad i byggnad';
    }
    if (why) { add(id, 'hp'); report.hp.push([id, name, cc, why]); report.why[why] = (report.why[why] || 0) + 1; }
    continue;
  }

  // Flygfält + övrigt
  if (RX.gl.test(nm) || /gliding|glider/.test(tagStr)) add(id, 'gl');
  if (RX.ul.test(nm) || /ultralight|microlight|ultraleger/.test(tagStr)) add(id, 'ul');
  if (RX.sk.test(nm) || /parachut|skydiv/.test(tagStr)) add(id, 'sk');
  if (RX.sp.test(nm) || nearLaunch(lat, lon, 15000).length > 0 && /space|launch|cosmo/.test(nm)) add(id, 'sp');
  if (RX.ic.test(nm) || (surfs.length && surfs.every((s) => /^(ICE|SNOW|SNW|SNO|ICE\/SNOW|SNOW\/ICE|GLACIER)/.test(s)))) add(id, 'ic');
  // Strandlandning: alla banor av sand och fältet ligger vid kusten (Barra, Sable Island, Copalis). Namnet räcker inte —
  // "Beach" är oftast en stad (Myrtle Beach, Palm Beach).
  if (surfs.length && surfs.every((x) => /SAND|^SAN$|BEACH/.test(x)) && coastal(lat, lon)) add(id, 'bh');
  if (type === 'small') {
    if (RX.lc.test(nm) && restr !== 'military') add(id, 'lc');
    if (RX.is.test(nm)) add(id, 'is');
    if (RX.ap.test(nm)) add(id, 'ap');
    if (RX.ag.test(nm) || /agricultur/.test(tagStr)) add(id, 'ag');
    if (RX.fr.test(nm)) add(id, 'fr');
  }
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const cnt = {};
for (const s of out.values()) for (const c of s) cnt[c] = (cnt[c] || 0) + 1;
const heli = seed.filter((r) => r[8] === 'heliport').length;
console.log(`Undertyper: ${JSON.stringify(cnt)}`);
console.log(`Heliports: ${heli} · helipads ${report.hp.length} (${JSON.stringify(report.why)}) · offshore ${report.os.length} · byggnadsdata för ${bldById.size}`);
const mil = seed.filter((r) => r[10] === 'military' && r[8] !== 'closed');
console.log(`Flygbaser: ${mil.length} · utan vapenslag ${mil.filter((r) => !['af', 'nv', 'ar'].some((c) => out.get(r[0])?.has(c))).length}`);
fs.writeFileSync(path.join(CL, 'subtypes-report.json'), JSON.stringify({ helipads: report.hp, offshore: report.os, counts: cnt }, null, 1));

if (!DRY) {
  let n = 0;
  const rows = seed.map((r) => {
    const s = out.get(r[0]);
    const base = r.slice(0, 12);
    while (base.length < 12) base.push('');
    if (!s || !s.size) return r.length > 12 ? base : r;   // inga koder → raden som förut (utan fält 12)
    n++;
    return [...base, [...s].sort().join(',')];
  });
  fs.writeFileSync(DAT, JSON.stringify(rows));
  console.log(`Skrev ${DAT}: ${n} flygplatser med undertyp`);
}
