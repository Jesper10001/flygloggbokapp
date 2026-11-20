// Test av NOTAM i klartext (utils/notamDecode.ts): öppettider → veckorad (bara entydiga), förkortningar utskrivna,
// svensk lokal tid. Indata = riktiga NOTAM ur LFV:s PIB 2026-11-20. Kör: node scripts/test-notam-decode.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../utils/notamDecode.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { parseHoursNotam, decodeNotamText, seOffsetHours, shiftHHMM } = mod.exports;
let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };

const twr = parseHoursNotam('AERODROME CONTROL TOWER (TWR) HOURS OF SERVICE ARE NOW MON-TUE AERODROME CONTROL TOWER (TWR) HOURS OF SERVICE ARE NOW MON-TUE 0500-2100, WED-THU 0500-2215, FRI 0500-1915, SAT 0700-1500, SUN 0700-2215');
eq(twr && twr.title, 'Tower hours', 'TWR-titel');
eq(twr && twr.days.map((d) => d.h), ['0500-2100', '0500-2100', '0500-2215', '0500-2215', '0500-1915', '0700-1500', '0700-2215'], 'TWR-tider');
const ad = parseHoursNotam('AERODROME OPERATING HOURS OF SERVICE ARE NOW MON-TUE 0445-2100, WED-THU 0445-2220, FRI 0445-1905, SAT CLSD, SUN 1325-2215.');
eq(ad && ad.title, 'Aerodrome hours', 'AD-titel');
eq(ad && ad.days[5], { d: 'Sat', h: null, next: false, h24: false, closed: true }, 'lördag stängd');
const jkg = parseHoursNotam('AERODROME HOURS OF SERVICE ARE NOW MON 0530-2359, TUE-THU 0000-0115 0530-2359, FRI 0000-0115 0530-1500, SAT-SUN CLSD.');
eq(jkg && jkg.days.map((d) => (d.closed ? 'CLSD' : d.h + (d.next ? '+1' : ''))), ['0530-0115+1', '0530-0115+1', '0530-0115+1', '0530-0115+1', '0530-1500', 'CLSD', 'CLSD'], 'över midnatt (ESGJ)');
eq(parseHoursNotam('AD HOURS OF SERVICE MON-FRI 0600-1000 1200-1600, SAT-SUN CLSD'), null, 'två pass samma dag → vanlig NOTAM');
eq(parseHoursNotam('AERODROME OPERATING HOURS MON-FRI 0600-1800'), null, 'helg saknas → ingen veckorad');
eq(parseHoursNotam('RWY 03/21 CLSD'), null, 'inte en tid-NOTAM');
eq(parseHoursNotam('HOURS OF SERVICE MON-FRI 0600-1800, FRI 0700-1500, SAT-SUN CLSD'), null, 'fredag två gånger → inte entydigt');

eq(decodeNotamText('RWY 12/30 POOR COND DUE CRACKS, HOLES AND RISK OF FOREIGN OBJECT DEBRIS. LDG AND TKOF AT OWN RISK.'),
  'Runway 12/30 poor condition due to cracks, holes and risk of foreign object debris. Landing and take-off at own risk.', 'RWY-NOTAM');
eq(decodeNotamText('MIL PAPI RWY 26 U/S.'), 'Military PAPI runway 26 unserviceable.', 'PAPI');
eq(decodeNotamText('TWY ZS CLSD BTN TWY X AND TWY Z'), 'Taxiway ZS closed between taxiway X and taxiway Z', 'taxiway-bokstäver kvar');
eq(decodeNotamText('PPR-REQUESTS SHALL BE SUBMITTED TO RNB.GROUNDHANDLING(AT)SWEDAVIA.SE'), 'PPR-requests shall be submitted to rnb.groundhandling@swedavia.se', 'mejl');

eq(seOffsetHours(new Date(Date.UTC(2026, 10, 20))), 1, 'november = CET');
eq(seOffsetHours(new Date(Date.UTC(2026, 6, 1))), 2, 'juli = CEST');
eq(shiftHHMM('2330', 1), '0030', 'över midnatt');
if (fails) { console.log(`${fails} fel`); process.exit(1); }
console.log('NOTAM i klartext: alla kontroller gick igenom');
