// Test av NOTAM i klartext (utils/notamDecode.ts): öppettider → veckorad eller rader (flera pass, datum),
// SNOWTAM → rad per bana, förkortningar/namn/beteckningar, svensk lokal tid. Indata = riktiga NOTAM ur
// LFV:s PIB 2026-11-20 (VFR, IFR, 99 days). Kör: node scripts/test-notam-decode.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../utils/notamDecode.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
const { parseHoursNotam, parseSnowtam, decodeNotamText, seOffsetHours, shiftHHMM } = mod.exports;
let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };
const gridOf = (h) => h && h.grid && h.grid.map((d) => (d.closed ? 'CLSD' : d.h + (d.next ? '+1' : '')));
const rowsOf = (h) => h && h.rows.map((r) => `${r.label} ${r.closed ? 'CLSD' : r.iv.join(' ')}`);

// Öppettider
const twr = parseHoursNotam('AERODROME CONTROL TOWER (TWR) HOURS OF SERVICE ARE NOW MON-TUE AERODROME CONTROL TOWER (TWR) HOURS OF SERVICE ARE NOW MON-TUE 0500-2100, WED-THU 0500-2215, FRI 0500-1915, SAT 0700-1500, SUN 0700-2215');
eq(twr && twr.title, 'Tower hours', 'TWR-titel');
eq(gridOf(twr), ['0500-2100', '0500-2100', '0500-2215', '0500-2215', '0500-1915', '0700-1500', '0700-2215'], 'TWR-veckorad');
eq(gridOf(parseHoursNotam('AERODROME HOURS OF SERVICE ARE NOW MON 0530-2359, TUE-THU 0000-0115 0530-2359, FRI 0000-0115 0530-1500, SAT-SUN CLSD.')),
  ['0530-0115+1', '0530-0115+1', '0530-0115+1', '0530-0115+1', '0530-1500', 'CLSD', 'CLSD'], 'över midnatt (ESGJ)');
eq(gridOf(parseHoursNotam('AERODROME CONTROL TOWER (TWR) HOURS OF SERVICE ARE NOWMON-WED 0700-1530, THU-FRI CLSD, SAT 0700-1500, SUN 0700-1630')),
  ['0700-1530', '0700-1530', '0700-1530', 'CLSD', 'CLSD', '0700-1500', '0700-1630'], 'hopklistrat NOWMON (ESDF)');
const afis = parseHoursNotam('AFIS HOURS OF SERVICE ARE NOW MON-FRI 0445-0600 0840-0955 1445-1600 1835-1950, SAT CLSD, SUN 1440-1740. OTHER HRS O/R TEL +46 950 275 60 OR +46 950 275 51.');
eq(afis && afis.title, 'AFIS hours', 'AFIS-titel');
eq(afis && afis.grid, null, 'flera pass → rader, inte veckorad');
eq(rowsOf(afis), ['Mon–Fri 0445-0600 0840-0955 1445-1600 1835-1950', 'Sat CLSD', 'Sun 1440-1740'], 'AFIS-rader (ESNL)');
eq(afis && afis.note, 'Other hours on request phone +46 950 275 60 or +46 950 275 51.', 'anmärkning efter tiderna');
eq(rowsOf(parseHoursNotam('AFIS HOURS OF SERVICE CHANGED TO FRI 1200-1430, SAT-SUN CLSD')), ['Fri 1200-1430', 'Sat–Sun CLSD'], 'bara vissa dagar');
const xmas = parseHoursNotam('OSTGOTA APPROACH CONTROL SERVICE (APP) HOURS OF SERVICE CHANGED TO 24DEC 0530-1030, 25DEC CLSD. SERVICE PROVIDED ACCORDING TO ES AIP ENR 2.1');
eq(xmas && xmas.title, 'Approach hours', 'APP-titel');
eq(rowsOf(xmas), ['24 Dec 0530-1030', '25 Dec CLSD'], 'datum');
eq(parseHoursNotam('RWY 03/21 CLSD'), null, 'inte en tid-NOTAM');
eq(parseHoursNotam('HOURS OF SERVICE MON-FRI 0600-1800, FRI 0700-1500, SAT-SUN CLSD'), null, 'fredag två gånger → inte entydigt');

// SNOWTAM
const sm = parseSnowtam('ESMX 11201436 01 6/6/6 25/25/25 NR/NR/NR WET/WET/WET');
eq(sm, { observed: '20 Nov 14:36Z', runways: [{ rwy: '01', line: 'Wet, 25 % · Braking normal (6/6/6)' }], remarks: '' }, 'SNOWTAM ESMX');
const sn = parseSnowtam('ESNL 11201548 14 3/3/3 100/100/100 03/03/03 WET SNOW ON TOP OF ICE/WET SNOW ON TOP OF ICE/WET SNOW ON TOP OF ICE TWY A POOR. APRON 1 POOR. RWY 14 UPGRADED FROZEN SAND.');
eq(sn && sn.runways[0].line, 'Wet snow on top of ice, 100 %, 3 mm deep · Braking medium (3/3/3)', 'SNOWTAM med djup');
eq(sn && sn.remarks, 'Taxiway A poor. Apron 1 poor. Runway 14 upgraded frozen sand.', 'SNOWTAM-anmärkningar, TWY A');
const sk = parseSnowtam('ESKM 11201539 16 6/6/5 100/100/100 NR/NR/03 DRY/DRY/DRY SNOW ALL APRONS POOR. TWY B CLSD.');
eq(sk && sk.runways[0].line, 'Dry / dry / dry snow, 100 %, –/–/3 mm deep · Braking normal / normal / good (6/6/5)', 'SNOWTAM olika tredjedelar');
eq(sk && sk.remarks, 'All aprons poor. Taxiway B closed.', 'flerordsbeläggning sist');
eq(parseSnowtam('ESSB 11201316 12 5/5/5 100/100/100 NR/NR/NR WET/WET/WET RWY 12 CHEMICALLY TREATED. ESSD - BORLAENGE - VOR RWY 32').remarks, 'Runway 12 chemically treated.', 'nästa flygplats läcker inte in');

// Klartext
eq(decodeNotamText('RWY 12/30 POOR COND DUE CRACKS, HOLES AND RISK OF FOREIGN OBJECT DEBRIS. LDG AND TKOF AT OWN RISK.'),
  'Runway 12/30 poor condition due to cracks, holes and risk of foreign object debris. Landing and take-off at own risk.', 'RWY-NOTAM');
eq(decodeNotamText('DME ROE U/S DUE TO MAINT'), 'DME ROE unserviceable due to maintenance', 'inget "due to to", fyrnamn i versaler');
eq(decodeNotamText('TWY ZS CLSD BTN TWY X AND TWY Z'), 'Taxiway ZS closed between taxiway X and taxiway Z', 'taxiway-bokstäver');
eq(decodeNotamText('CRANE ERECTED PSN 574308N 0120312E HGT 99FT AGL ELEV 253FT AMSL. LGTD F R.'),
  'Crane erected position 574308N 0120312E height 99FT AGL elevation 253FT AMSL. Lighted (fixed red).', 'kran, fast rött ljus');
eq(decodeNotamText('MOBILE CRANE ERECTED 356M W OF ARP'), 'Mobile crane erected 356M west of aerodrome reference point', 'väderstreck');
eq(decodeNotamText('OSTGOTA TMA CHANGED. STAR RWY 32 ORCOX 1F NOT AVBL.'), 'Ostgota TMA changed. STAR runway 32 ORCOX 1F not available.', 'ortnamn och waypoint');
eq(decodeNotamText('PPR-REQUESTS SHALL BE SUBMITTED TO RNB.GROUNDHANDLING(AT)SWEDAVIA.SE'), 'PPR-requests shall be submitted to rnb.groundhandling@swedavia.se', 'mejl');

eq(seOffsetHours(new Date(Date.UTC(2026, 10, 20))), 1, 'november = CET');
eq(seOffsetHours(new Date(Date.UTC(2026, 6, 1))), 2, 'juli = CEST');
eq(shiftHHMM('2330', 1), '0030', 'över midnatt');
if (fails) { console.log(`${fails} fel`); process.exit(1); }
console.log('NOTAM i klartext: alla kontroller gick igenom');
