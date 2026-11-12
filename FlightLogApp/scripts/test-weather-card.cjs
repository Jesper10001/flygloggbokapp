// Test av väderkortets värden (services/weather.ts): de fyra rutorna ur en METAR (metarCells) och raden med
// nästa förändring ur en TAF (tafNextChange). Indata har samma form som aviationweather.gov svarar med.
// Kör: node scripts/test-weather-card.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '../services/weather.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({})); // databasen behövs inte här
const { metarCells, tafNextChange } = mod.exports;

let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };
const sp = ' ';
const at = (day, hh, mm = 0) => Date.UTC(2026, 10, day, hh, mm) / 1000; // november 2026, sekunder
const NOW = at(12, 13, 30) * 1000;
const cell = (value, unit) => ({ value, unit });

// ── METAR → fyra rutor ──
eq(metarCells({ rawOb: 'METAR ESCF 121320Z 21009KT 9999 BKN013 04/03 Q0986', wdir: 210, wspd: 9, visib: '6+', clouds: [{ cover: 'BKN', base: 1300 }], altim: 986 }),
  { wind: cell('210°/9', 'kt'), vis: cell('10+', 'km'), cloud: cell(`1${sp}300`, 'ft, broken'), qnh: cell('986', 'hPa') }, 'vanlig METAR');
eq(metarCells({ rawOb: 'METAR OMDB 121330Z 28014KT CAVOK 29/16 Q1016', wdir: 280, wspd: 14, visib: '6+', clouds: [{ cover: 'CAVOK' }], altim: 1016 }).cloud, cell('CAVOK', ''), 'CAVOK');
eq(metarCells({ rawOb: 'x', wdir: 40, wspd: 17, wgst: 28, visib: '6+', clouds: [{ cover: 'FEW', base: 3800 }, { cover: 'BKN', base: 26000 }], altim: 1000 }),
  { wind: cell('040°/17', 'kt, gusts 28'), vis: cell('10+', 'km'), cloud: cell(`26${sp}000`, 'ft, broken'), qnh: cell('1000', 'hPa') }, 'byar, taket går före ett lägre few-lager');
eq(metarCells({ rawOb: 'x', wdir: 'VRB', wspd: 3, visib: 0.56, clouds: [{ cover: 'SCT', base: 800 }], altim: 29.92 }),
  { wind: cell('VRB/3', 'kt'), vis: cell('900', 'm'), cloud: cell('800', 'ft, scattered'), qnh: cell('29.92', 'inHg') }, 'variabel vind, sikt under 1 km, inHg');
eq(metarCells({ rawOb: 'x', wdir: 0, wspd: 0, visib: 2.49, clouds: [], altim: 1013 }),
  { wind: cell('Calm', ''), vis: cell('4', 'km'), cloud: cell('Clear', ''), qnh: cell('1013', 'hPa') }, 'vindstilla, klar himmel');
eq(metarCells({ rawOb: 'x' }), { wind: cell('—', ''), vis: cell('—', ''), cloud: cell('Clear', ''), qnh: cell('—', '') }, 'saknade fält ger streck');

// ── TAF → nästa förändring ──
const base = (o) => ({ fcstChange: null, probability: null, visib: '', wxString: null, clouds: [], wdir: null, wspd: null, wgst: null, ...o });
const taf = (validTo, fcsts) => ({ validTimeTo: validTo, fcsts });

// Tillfällig period som pågår: bara det den anger.
eq(tafNextChange(taf(at(12, 21), [
  base({ timeFrom: at(12, 13), timeTo: at(12, 21), visib: '6+', clouds: [{ cover: 'BKN', base: 1200 }], wdir: 190, wspd: 8 }),
  base({ fcstChange: 'TEMPO', timeFrom: at(12, 13), timeTo: at(12, 18), clouds: [{ cover: 'SCT', base: 1500 }] }),
  base({ fcstChange: 'TEMPO', timeFrom: at(12, 18), timeTo: at(12, 21), visib: 2.49, wxString: '-RA', clouds: [{ cover: 'BKN', base: 800 }] }),
]), NOW), { text: `At times until 18z: scattered clouds at 1${sp}500 ft`, category: null }, 'TEMPO som pågår');

// Kommande TEMPO med tak, väder och sikt → kategori.
eq(tafNextChange(taf(at(12, 21), [
  base({ timeFrom: at(12, 13), timeTo: at(12, 21), visib: '6+', clouds: [{ cover: 'BKN', base: 3500 }], wdir: 190, wspd: 8 }),
  base({ fcstChange: 'TEMPO', timeFrom: at(12, 18), timeTo: at(12, 21), visib: 2.49, wxString: '-RA', clouds: [{ cover: 'BKN', base: 800 }] }),
]), NOW), { text: 'At times 18z–21z: cloud base 800 ft, light rain, visibility 4 km', category: 'IFR' }, 'kommande TEMPO');

// BECMG som bara ändrar vinden (API:t fyller i resten av läget): bara vinden, ingen kategori.
eq(tafNextChange(taf(at(13, 18), [
  base({ timeFrom: at(12, 12), timeTo: at(13, 3), visib: '6+', wxString: 'NSW', clouds: [{ cover: 'NSC', base: null }], wdir: 10, wspd: 12 }),
  base({ fcstChange: 'BECMG', timeFrom: at(13, 3), timeTo: at(13, 18), timeBec: at(13, 6), visib: '6+', wxString: 'NSW', clouds: [{ cover: 'NSC', base: null }], wdir: 310, wspd: 8 }),
]), NOW), { text: 'From 03z tomorrow: wind 310°/8 kt', category: null }, 'BECMG med bara vind');

// FM med hela läget: bara skillnaden mot perioden före; vind med byar står med.
eq(tafNextChange(taf(at(13, 18), [
  base({ timeFrom: at(12, 12), timeTo: at(12, 16), visib: '6+', clouds: [{ cover: 'OVC', base: 6000 }], wdir: 100, wspd: 12 }),
  base({ fcstChange: 'FM', timeFrom: at(12, 16), timeTo: at(12, 19), visib: '6+', wxString: '-SHRA', clouds: [{ cover: 'BKN', base: 2500 }, { cover: 'OVC', base: 4000 }], wdir: 100, wspd: 13, wgst: 20 }),
]), NOW), { text: `From 16z: cloud base 2${sp}500 ft, light showers of rain, wind 100°/13 kt, gusts 20`, category: 'MVFR' }, 'FM jämförs med perioden före');

// BECMG som pågår → "By".
eq(tafNextChange(taf(at(13, 12), [
  base({ timeFrom: at(12, 12), timeTo: at(12, 13), visib: 0.5, wxString: 'SN', clouds: [{ cover: 'OVC', base: 400 }], wdir: 30, wspd: 7 }),
  base({ fcstChange: 'BECMG', timeFrom: at(12, 13), timeTo: at(13, 12), timeBec: at(12, 15), visib: 2.49, wxString: '-SN', clouds: [{ cover: 'BKN', base: 800 }], wdir: 30, wspd: 7 }),
]), NOW), { text: 'By 15z: cloud base 800 ft, light snow, visibility 4 km', category: 'IFR' }, 'BECMG som pågår');

// Sannolikhet, åska i molnen.
eq(tafNextChange(taf(at(12, 18), [
  base({ timeFrom: at(12, 12), timeTo: at(12, 18), visib: '6+', clouds: [{ cover: 'SCT', base: 2500 }], wdir: 190, wspd: 7 }),
  base({ fcstChange: 'PROB', probability: 40, timeFrom: at(12, 17), timeTo: at(12, 18), clouds: [{ cover: 'BKN', base: 3500, type: 'CB' }] }),
]), NOW), { text: `40% chance 17z–18z: cloud base 3${sp}500 ft, cumulonimbus`, category: 'VFR' }, 'PROB40 med CB');

// Väder som upphör.
eq(tafNextChange(taf(at(13, 12), [
  base({ timeFrom: at(12, 12), timeTo: at(12, 20), visib: '6+', wxString: '-RA', clouds: [{ cover: 'BKN', base: 1500 }], wdir: 160, wspd: 7 }),
  base({ fcstChange: 'FM', timeFrom: at(12, 20), timeTo: at(13, 12), visib: '6+', wxString: null, clouds: [{ cover: 'BKN', base: 1500 }], wdir: 160, wspd: 7 }),
]), NOW), { text: 'From 20z: no significant weather', category: null }, 'regnet upphör');

// Inget kvar som ändras, och en utgången TAF.
eq(tafNextChange(taf(at(12, 21), [
  base({ timeFrom: at(12, 12), timeTo: at(12, 21), visib: '6+', clouds: [{ cover: 'BKN', base: 1200 }], wdir: 190, wspd: 8 }),
]), NOW), { text: 'No change expected before 21z', category: null }, 'ingen förändring');
eq(tafNextChange(taf(at(12, 12), [base({ timeFrom: at(12, 3), timeTo: at(12, 12), visib: '6+' })]), NOW), { text: 'This forecast has expired', category: null }, 'utgången TAF');

console.log(fails ? `\n${fails} fel` : 'Väderkortet: alla kontroller gick igenom');
process.exit(fails ? 1 : 0);
