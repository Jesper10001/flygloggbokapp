// Test av vädersidans modell (services/wxPage.ts) med ESSA-exemplet från designen. Kör: node scripts/test-wx-page.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const load = (file, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, resolveJsonModule: true, esModuleInterop: true } }).outputText;
  const M = { exports: {} };
  new Function('module', 'exports', 'require', js)(M, M.exports, req);
  return M.exports;
};
const weather = load('services/weather.ts', (p) => (p === '../db/icao' ? {} : require(p)));
const { buildWxPage, runwayWinds, fmtTime } = load('services/wxPage.ts', (p) => (p === './weather' ? weather : require(p)));

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  FEL:', msg); } else console.log('  ok:', msg); };
const T = (d, h, m = 0) => Date.UTC(2026, 10, d, h, m) / 1000;
const now = T(15, 15, 11) * 1000;
const metar = { icaoId: 'ESSA', rawOb: 'METAR ESSA 151450Z 19015KT CAVOK 04/M02 Q1000 NOSIG', fltCat: 'VFR', wdir: 190, wspd: 15, visib: '6+', temp: 4, dewp: -2, altim: 1000, clouds: [{ cover: 'CAVOK' }] };
const taf = {
  icaoId: 'ESSA', issueTime: '2026-11-15T11:00:00.000Z', validTimeFrom: T(15, 12), validTimeTo: T(16, 18),
  rawTAF: 'TAF ESSA 151100Z 1512/1618 19012KT 9999 FEW030 BECMG 1520/1522 20018G28KT 6000 -RA BKN012 PROB40 1600/1615 3000 RA BKN009 BECMG 1614/1616 24010KT 9999 SCT025',
  fcsts: [
    { timeFrom: T(15, 12), timeTo: T(16, 18), fcstChange: null, wdir: 190, wspd: 12, visib: '6+', clouds: [{ cover: 'FEW', base: 3000 }] },
    { timeFrom: T(15, 20), timeTo: T(15, 22), timeBec: T(15, 22), fcstChange: 'BECMG', wdir: 200, wspd: 18, wgst: 28, visib: 3.73, wxString: '-RA', clouds: [{ cover: 'BKN', base: 1200 }] },
    { timeFrom: T(16, 0), timeTo: T(16, 15), fcstChange: 'PROB', probability: 40, visib: 1.86, wxString: 'RA', clouds: [{ cover: 'BKN', base: 900 }] },
    { timeFrom: T(16, 14), timeTo: T(16, 16), timeBec: T(16, 16), fcstChange: 'BECMG', wdir: 240, wspd: 10, visib: '6+', wxString: 'NSW', clouds: [{ cover: 'SCT', base: 2500 }] },
  ],
};

console.log('1. ESSA i UTC');
const p = buildWxPage(metar, taf, 'utc', now);
console.log('   summary:', p.summary);
ok(p.nowCat === 'VFR', 'Now = VFR');
ok(/Good VFR now/.test(p.summary) && /MVFR/.test(p.summary) && /40% chance of IFR/.test(p.summary), 'meningen nämner VFR, MVFR och 40% IFR');
ok(p.glance.length === 3 && p.glance[1].cat === 'MVFR' && p.glance[2].label === '40% IFR', 'överblick: Now, MVFR, 40% IFR → ' + p.glance.map((g) => `${g.when}:${g.label}:${g.note}`).join(' | '));
ok(p.now.tiles.map((x) => x.value).join(',') === '10+,None,4°/-2°,1000', 'METAR-rutor ' + p.now.tiles.map((x) => x.value + x.unit + '(' + x.note + ')').join(' '));
ok(p.timeline && p.timeline.base.some((s) => s.kind === 'becmg') && p.timeline.temp.length === 1, 'tidslinje med övergång och en PROB-rad');
ok(p.timeline.ticks[0].label === 'NOW' && p.timeline.ticks.length >= 9, 'ticks ' + p.timeline.ticks.map((x) => x.label).join(' '));
ok(p.timeline.winds.some((w) => w.gust === 28), 'byar 28 i vindraden');
ok(p.cards.length === 4 && p.cards[2].kind === '40% CHANCE' && p.cards[2].cat === 'IFR', 'kort: ' + p.cards.map((c) => `${c.when} ${c.kind} ${c.cat}`).join(' | '));
ok(p.rawTaf.length === 4 && p.rawTaf[2].cat === 'IFR' && p.rawTaf[1].cat === 'MVFR', 'rå TAF i fyra färgade grupper');
ok(p.tafIssued === '11Z', 'TAF utfärdad 11Z');
p.timeline.base.concat(p.timeline.temp.flat()).forEach((s) => console.log('     ', s.kind, s.label, s.when, '·', s.text));

console.log('2. Lokal tid');
const l = buildWxPage(metar, taf, 'local', now);
ok(!/z\b/.test(l.cards.map((c) => c.when).join(' ')), 'inga z-tider i lokalt läge: ' + l.cards.map((c) => c.when).join(' | '));
ok(fmtTime(T(16, 0), 'utc', T(15, 15)) === '00z tomorrow', 'UTC-dag: 00z tomorrow');

console.log('3. Banor och vind');
const rw = [{ leIdent: '01L', heIdent: '19R', bearing: 10 }, { leIdent: '01R', heIdent: '19L', bearing: 10 }, { leIdent: '08', heIdent: '26', bearing: 80 }];
const r = runwayWinds(rw, 190, 15);
ok(r.list[0].ident === '19L/R' && r.list[0].head === 15 && r.list[0].cross === 0, '19L/R 15 head 0 cross');
ok(r.list[1].ident === '26' && r.list[1].head === 5 && r.list[1].cross === 14, '26 5 head 14 cross');
ok(r.favored.sort().join() === '0,1', 'båda 01/19 lyses upp');
ok(runwayWinds(rw, null, 5).list.length === 0, 'variabel vind: ingen lista');

console.log('4. Utan TAF och utan METAR');
const a = buildWxPage(metar, null, 'utc', now);
ok(a.timeline === null && a.cards.length === 0 && /Good VFR/.test(a.summary), 'bara METAR');
const b = buildWxPage(null, taf, 'utc', now);
ok(b.now === null && b.timeline && b.nowCat === 'VFR', 'bara TAF');

console.log(fails ? `\n${fails} FEL` : '\nAlla tester gick igenom');
process.exit(fails ? 1 : 0);
