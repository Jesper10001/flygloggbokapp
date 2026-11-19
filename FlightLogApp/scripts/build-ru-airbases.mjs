// Bygger assets/ru-airbases.json ur användarens fil scripts/ru-airbases/flygbaser_ryssland.csv (ryska flygbaser med
// förband och flygplanstyper, sammanställt ur OurAirports, Scramble.nl och Wikipedia). Används av filtret
// Air Bases → Specific på global map och av förbandskortet (components/UnitCard.tsx).
// Filen är på svenska; appen är på engelska → namn, förband, kommandon och regioner översätts här.
// Nyckel = flygplatsens nyckel i icao-airports.dat: filens OurAirports-ident, annars närmaste flygplats inom 1,5 km
// (13 baser har ett nyare OurAirports-ident än appens data, t.ex. Lipetsk-2 = UUWL).
// Kör: node scripts/build-ru-airbases.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icao-airports.dat'), 'utf8'));
const keys = new Map(seed.map((r) => [r[0], r]));

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
const [head, ...body] = parseCSV(fs.readFileSync(path.join(__dirname, 'ru-airbases', 'flygbaser_ryssland.csv'), 'utf8'));
const ix = Object.fromEntries(head.map((h, i) => [h, i]));

// ── Översättningar ─────────────────────────────────────────────────────────────
const NAME = {
  'Kursk-Vostotjnyj (Chalino)': 'Kursk-Vostochny (Khalino)', 'Voronezj-Baltimor': 'Voronezh-Baltimor', 'Chotilovo': 'Khotilovo',
  'Sjatalovo': 'Shatalovo', 'Tjkalovsk': 'Chkalovsk', 'Montjegorsk': 'Monchegorsk', 'Savaslejka': 'Savasleyka', 'Pusjkin': 'Pushkin',
  'Vjazma-Dvojevka': 'Vyazma-Dvoyevka', 'Levasjovo': 'Levashovo', 'Vladimir-Semjazino': 'Vladimir-Semyazino', 'Budjonnovsk': 'Budyonnovsk',
  'Primorsko-Achtarsk': 'Primorsko-Akhtarsk', 'Gvardejskoje': 'Gvardeyskoye', 'Dzjankoj': 'Dzhankoi', 'Rostov-na-Donu Tsentralnyj': 'Rostov-on-Don Tsentralny',
  'Kansk-Dalnij': 'Kansk-Dalny', 'Perm-Bolsjoje Savino': 'Perm-Bolshoye Savino', 'Jekaterinburg-Koltsovo': 'Yekaterinburg-Koltsovo',
  'Novosibirsk-Tolmatjovo': 'Novosibirsk-Tolmachevo', 'Kamensk-Uralskij': 'Kamensk-Uralsky', 'Tjita-Tjerjomusjki': 'Chita-Cheryomushki',
  'Komsomolsk-na-Amure (Dzjomgi)': 'Komsomolsk-on-Amur (Dzyomgi)', 'Churba': 'Khurba', 'Tsentralnaja Uglovaja': 'Tsentralnaya Uglovaya',
  'Tjernigovka': 'Chernigovka', 'Varfolomejevka': 'Varfolomeyevka', 'Kljutji': 'Klyuchi', 'Sjajkovka': 'Shaykovka', 'Olenja (Olenegorsk)': 'Olenya (Olenegorsk)',
  'Belaja': 'Belaya', 'Djagilevo (Rjazan)': 'Dyagilevo (Ryazan)', 'Sesjtja': 'Seshcha', 'Ivanovo-Severnyj': 'Ivanovo-Severny',
  'Taganrog-Tsentralnyj': 'Taganrog-Tsentralny', 'Uljanovsk-Vostotjnyj': 'Ulyanovsk-Vostochny', 'Tjernjachovsk': 'Chernyakhovsk', 'Donskoje': 'Donskoye',
  'Katja': 'Kacha', 'Jelizovo (Petropavlovsk-Kamtjatskij)': 'Yelizovo (Petropavlovsk-Kamchatsky)', 'Kamennyj Rutjej (Mongochto)': 'Kamenny Ruchey (Mongokhto)',
  'Nikolajevka': 'Nikolayevka', 'Jejsk': 'Yeysk', 'Achtubinsk': 'Akhtubinsk', 'Bagaj-Baranovka': 'Bagay-Baranovka', 'Naltjik': 'Nalchik',
  'Tjkalovskij': 'Chkalovsky', 'Balasjov': 'Balashov', 'Kusjtjovskaja': 'Kushchyovskaya', 'Majkop-Chanskaja': 'Maykop-Khanskaya', 'Mitjurinsk': 'Michurinsk',
  'Rtisjtjevo': 'Rtishchevo', 'Tichoretsk': 'Tikhoretsk', 'Syzran-Trojekurovka': 'Syzran-Troyekurovka', 'Torzjok': 'Torzhok',
};
const REGION = {
  'Kursk oblast': 'Kursk Oblast', 'Voronezj oblast': 'Voronezh Oblast', 'Karelen': 'Karelia', 'Tver oblast': 'Tver Oblast', 'Smolensk oblast': 'Smolensk Oblast',
  'Kaliningrad oblast': 'Kaliningrad Oblast', 'Murmansk oblast': 'Murmansk Oblast', 'Nizjnij Novgorod oblast': 'Nizhny Novgorod Oblast', 'Pskov oblast': 'Pskov Oblast',
  'S:t Petersburg': 'St Petersburg', 'Leningrad oblast': 'Leningrad Oblast', 'Vladimir oblast': 'Vladimir Oblast', 'Krasnodar kraj': 'Krasnodar Krai',
  'Rostov oblast': 'Rostov Oblast', 'Volgograd oblast': 'Volgograd Oblast', 'Stavropol kraj': 'Stavropol Krai', 'Krim (ockuperat)': 'Crimea (occupied)',
  'Nordossetien': 'North Ossetia', 'Jerevan, Armenien': 'Yerevan', 'Kirgizistan': '', 'Krasnojarsk kraj': 'Krasnoyarsk Krai', 'Perm kraj': 'Perm Krai',
  'Sverdlovsk oblast': 'Sverdlovsk Oblast', 'Novosibirsk oblast': 'Novosibirsk Oblast', 'Irkutsk oblast': 'Irkutsk Oblast', 'Tuva': 'Tuva',
  'Tjeljabinsk oblast': 'Chelyabinsk Oblast', 'Zabajkalje kraj': 'Zabaykalsky Krai', 'Chabarovsk kraj': 'Khabarovsk Krai', 'Primorje kraj': 'Primorsky Krai',
  'Sachalin oblast (Kurilerna)': 'Kuril Islands', 'Kamtjatka kraj': 'Kamchatka Krai', 'Saratov oblast': 'Saratov Oblast', 'Kaluga oblast': 'Kaluga Oblast',
  'Novgorod oblast': 'Novgorod Oblast', 'Amur oblast': 'Amur Oblast', 'Rjazan oblast': 'Ryazan Oblast', 'Tambov oblast': 'Tambov Oblast',
  'Sacha (Jakutien)': 'Sakha (Yakutia)', 'Brjansk oblast': 'Bryansk Oblast', 'Ivanovo oblast': 'Ivanovo Oblast', 'Orenburg oblast': 'Orenburg Oblast',
  'Uljanovsk oblast': 'Ulyanovsk Oblast', 'Vologda oblast': 'Vologda Oblast', 'Lipetsk oblast': 'Lipetsk Oblast', 'Moskva oblast': 'Moscow Oblast',
  'Astrachan oblast': 'Astrakhan Oblast', 'Kabardino-Balkarien': 'Kabardino-Balkaria', 'Adygeja': 'Adygea', 'Samara oblast': 'Samara Oblast',
};
const COMMAND = {
  '6:e armén': '6th Air Army', '6:e armén (enl. Scramble)': '6th Air Army', '4:e armén': '4th Air Army', '14:e armén': '14th Air Army', '11:e armén': '11th Air Army',
  'Fjärrflyget': 'Long-Range Aviation', 'Fjärrflyget (enl. Scramble)': 'Long-Range Aviation', 'Transportflyget': 'Military Transport Aviation',
  'Marinflyget (Norra flottan)': 'Northern Fleet aviation', 'Marinflyget (Östersjöflottan)': 'Baltic Fleet aviation', 'Marinflyget (Svartahavsflottan)': 'Black Sea Fleet aviation',
  'Marinflyget (Stillahavsflottan)': 'Pacific Fleet aviation', 'Marinflyget': 'Naval Aviation', '7:e flygkåren (Norra flottan)': '7th Air Corps, Northern Fleet',
  'Flygvapnets HK': 'Air Force headquarters', 'Arméflyget': 'Army Aviation', '–': '',
};
// Förband: ordningstal + fraser (längsta först).
const ord = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')); };
const UNIT_WORDS = [
  ['+ räddningsdetachement', 'and rescue detachment'],
  ['instruktörs- och forskningsregementet', 'Instructor and Research Aviation Regt'], ['instruktörs- och provhelikopterregementet', 'Instructor and Test Helicopter Regt'],
  ['instruktörshelikopterskvadronen', 'Instructor Helicopter Squadron'], ['luftburna tidig varning-regementet', 'Airborne Early Warning Regt'],
  ['ubåtsjakthelikopterregementet', 'Anti-Submarine Helicopter Regt'], ['självst. spaningsflygskvadronen', 'Separate Reconnaissance Squadron'],
  ['självst. blandade flygregementet', 'Separate Composite Aviation Regt'], ['självst. blandade flygskvadronen', 'Separate Composite Aviation Squadron'],
  ['självst. helikopterregementet', 'Separate Helicopter Regt'], ['självst. transportflygregementet', 'Separate Transport Aviation Regt'],
  ['självst. provflygskvadronen', 'Separate Test Squadron'], ['Självst. ubåtsjaktskvadron', 'Separate Anti-Submarine Squadron'],
  ['skeppsburna jaktflygregementet', 'Shipborne Fighter Regt'], ['marina attackflygregementet', 'Naval Assault Aviation Regt'],
  ['blandade helikopterregementet', 'Composite Helicopter Regt'], ['tunga bombflygregementet', 'Heavy Bomber Aviation Regt'],
  ['blandade flygregementet', 'Composite Aviation Regt'], ['skolhelikopterregementet', 'Training Helicopter Regt'], ['skolflygregementet', 'Training Aviation Regt'],
  ['lufttankningsregementet', 'Air Refuelling Regt'], ['jaktflygregementet', 'Fighter Aviation Regt'], ['bombflygregementet', 'Bomber Aviation Regt'],
  ['attackflygregementet', 'Assault Aviation Regt'], ['transportflygregementet', 'Transport Aviation Regt'], ['ubåtsjaktregementet', 'Anti-Submarine Aviation Regt'],
  ['arméflygbrigaden', 'Army Aviation Brigade'], ['arméflygbrig.', 'Army Aviation Brigade'], ['transportflygreg.', 'Transport Aviation Regt'],
  ['helikopterreg.', 'Helicopter Regt'], ['flygreg.', 'Aviation Regt'], ['specialflygregementena', 'Special Purpose Aviation Regts'],
  ['utbildningscentrum', 'Training Centre'], ['uppvisningscentrum', 'Display Centre'], ['provflygcentrum', 'Flight Test Centre'], ['Bergsprovcentrum', 'Mountain Test Centre'],
  ['flygbasen', 'Air Base'], ['gardes', 'Guards'], ['detachement', 'detachment'], ['blandad skvadron', 'composite squadron'], ['flyggrupp', 'flight group'],
  ['Tu-142-del', 'Tu-142 element'], [' och ', ' and '],
  ['Okänt regemente', 'Unknown regiment'], ['Ej namngivet förband', 'Unit not named in sources'], ['Framskjuten bas', 'Forward operating base'],
];
function unit(s) {
  let t = s.replace(/(\d+):(?:e|a)\b/g, (_, n) => ord(Number(n)));
  for (const [sv, en] of UNIT_WORDS) t = t.split(sv).join(en);
  return t.replace(/\s+/g, ' ').trim();
}

// ── Flygplanstyper → roller ────────────────────────────────────────────────────
const ROLE_RX = [
  ['training', /Yak-130|L-39|DA42|Tu-134UBL|L-410UVP|Su-25UTG/],
  ['special', /A-50|Il-78|Il-20|Il-22|Il-38|Tu-142|Su-24MR|An-30|Be-12|UAV|Forpost/],
  ['fighter', /Su-27|Su-30|Su-33|Su-35|Su-57|MiG-29|MiG-31|MiG-35/],
  ['bomber', /Su-24|Su-34|Tu-22M|Tu-95|Tu-160/],
  ['attack', /Su-25/],
  ['heli', /^(Ka|Mi)-|Ansat/],
  ['transport', /An-12|An-22|An-26|An-72|An-124|An-148|Il-76|L-410|Tu-134|Tu-154/],
];
function types(s) {
  if (/^(Ej angivet|Från )/.test(s.trim())) return [];
  const out = [];
  for (let t of s.replace(/\([^)]*\)/g, '').replace(/m\.fl\./g, '').split(/[;,]/)) {
    t = t.trim().replace(/AMTSj/g, 'AMTSh');
    if (!t) continue;
    if (t === 'Su-24M/MR') out.push('Su-24M', 'Su-24MR');   // två roller: bombare och spaning
    else out.push(t);
  }
  return [...new Set(out)];
}

const out = {}, skipped = [], unmatched = [];
const km = (a, b, c, d) => Math.hypot(a - c, (b - d) * Math.cos((a * Math.PI) / 180)) * 111;
for (const r of body) {
  const name = r[ix.namn]; if (!name) continue;
  let key = r[ix.ourairports_ident];
  const lat = parseFloat(r[ix.latitud]), lon = parseFloat(r[ix.longitud]);
  if (!keys.has(key)) {
    key = null;
    if (Number.isFinite(lat)) {
      let best = null;
      for (const s of seed) { if (Math.abs(s[4] - lat) > 0.05 || Math.abs(s[5] - lon) > 0.1) continue; const d = km(lat, lon, s[4], s[5]); if (d <= 1.5 && (!best || (best[1][8] === 'closed' && s[8] !== 'closed') || d < best[0])) best = [d, s]; }
      if (best) key = best[1][0];
    }
  }
  if (!key) { skipped.push(name); continue; }
  const groups = [];
  for (const t of types(r[ix.flygplanstyper])) {
    const role = (ROLE_RX.find(([, rx]) => rx.test(t)) || [null])[0];
    if (!role) { unmatched.push(`${name}: ${t}`); continue; }
    const g = groups.find((x) => x[0] === role);
    g ? g[1].push(t) : groups.push([role, [t]]);
  }
  const region = REGION[r[ix.region]], command = COMMAND[r[ix.kommando]];
  if (region === undefined || command === undefined) throw new Error(`Saknar översättning: ${r[ix.region]} / ${r[ix.kommando]}`);
  // o = förbandets land: flaggan på kartan visar förbandet, inte var basen ligger (Krim, Armenien, Kirgizistan → RU).
  // Samma form som Europas baser (build-eu-airbases.mjs): ops = ett eller flera länders förband på basen.
  out[key] = { n: NAME[name] || name, r: region, s: 'ru', ops: [{ o: 'RU', c: command, u: r[ix.forband].split(';').map((s) => unit(s)).filter(Boolean), g: groups }] };
}
const left = Object.values(out).flatMap((b) => [b.n, ...b.ops[0].u]).filter((s) => /[åäö]|reg\.|ena\b|sj|tj|emente/.test(s));
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'ru-airbases.json'), JSON.stringify(out));
console.log(`Skrev ${Object.keys(out).length} baser. Hoppade över: ${skipped.join(', ') || '–'}. Typer utan roll: ${unmatched.join(' | ') || '–'}`);
if (left.length) console.log('KONTROLLERA (ser oöversatt ut):', left);
