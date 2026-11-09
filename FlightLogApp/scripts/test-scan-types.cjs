// Test av flygplanstyperna i en skanning (services/scanTypes.ts): skrivsätt som är samma luftfartyg slås ihop
// till en typ, och finns typen i flottan används flottans namn. Kör: node scripts/test-scan-types.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

// Modulerna laddas som i appen: scanTypes och aircraftFamily kräver varandra.
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const src = fs.readFileSync(path.join(__dirname, `../services/${name}.ts`), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache[name] = mod;
  const req = (p) => (p.startsWith('./') ? load(p.slice(2)) : require(p));
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
}
const T = load('scanTypes');
const F = load('aircraftFamily');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } };
const rows = (list) => list.flatMap(([written, reg, n = 1]) => Array.from({ length: n }, () => ({ written, registration: reg })));
const typeOf = (res, written) => res.groupOf.get(T.typeKey(written))?.suggested;
const noFleet = { types: [], regs: [] };

// 1. Varianter
ok(T.isVariant('EC135', 'EC135T1'), 'EC135 ~ EC135T1');
ok(T.isVariant('B206', 'B206L'), 'B206 ~ B206L');
ok(T.isVariant('AS350', 'AS350B3'), 'AS350 ~ AS350B3');
ok(!T.isVariant('EC13', 'EC135'), 'EC13 ≁ EC135 (modellnumret fortsätter)');
ok(!T.isVariant('A320', 'A321'), 'A320 ≁ A321');
ok(!T.isVariant('B737', 'B738'), 'B737 ≁ B738');
ok(!T.isVariant('EC', 'EC135'), 'för kort');
ok(!T.isVariant('A320', 'A320NEOX'), 'för långt suffix');

// 2. Användarens fall: EC35, EC135, EC135T1 i samma bok, ingen av dem i flottan → EN typ.
let r = T.resolveScanTypes(
  rows([['EC135T1', '8265', 20], ['EC135', '8263', 8], ['EC35', '8265', 10], ['B206', 'SE-JVC', 4]]),
  [{ as_written: 'EC135T1', resolved: 'EC35' }, { as_written: 'EC135', resolved: 'EC35' }, { as_written: 'B206', resolved: 'B06' }],
  noFleet,
);
ok(r.groups.length === 2, `två typer (${r.groups.map((g) => g.id).join(' / ')})`);
ok(typeOf(r, 'EC135T1') === 'EC135T1' && typeOf(r, 'EC135') === 'EC135T1' && typeOf(r, 'EC35') === 'EC135T1', `alla EC135 → det vanligaste skrivna namnet EC135T1 (${typeOf(r, 'EC135')})`);
ok(r.groupOf.get('EC135').rows === 38, 'raderna räknas ihop');
ok(r.groupOf.get('B206').suggested === 'B206', `B206 behåller sitt skrivna namn, inte typkoden B06 (${r.groupOf.get('B206').suggested})`);

// 3. Utan Claudes typkoder: samma registrering räcker.
r = T.resolveScanTypes(rows([['EC135T1', '8265', 3], ['EC-135', '8265', 2]]), [], noFleet);
ok(r.groups.length === 1 && r.groups[0].merged.includes('registration'), 'samma registrering slår ihop');
ok(typeOf(r, 'EC135T1') === 'EC135T1', `vanligaste skrivsättet blir typen (${typeOf(r, 'EC135T1')})`);

// 4. Flottan har redan "EC135": alla skrivsätt får flottans namn.
r = T.resolveScanTypes(
  rows([['EC135T1', '9999', 5], ['EC35', '9998', 2]]),
  [{ as_written: 'EC135T1', resolved: 'EC35' }],
  { types: ['EC135', 'B206'], regs: [] },
);
ok(typeOf(r, 'EC135T1') === 'EC135' && typeOf(r, 'EC35') === 'EC135', `→ flottans EC135 (${typeOf(r, 'EC135T1')}, ${typeOf(r, 'EC35')})`);
ok(r.groupOf.get('EC135T1').fleet === 'EC135', 'matchad mot flottan');

// 5. Flottan har "EC35" (typkoden): skrivsätten matchas via typkoden.
r = T.resolveScanTypes(rows([['EC135T2', '', 4]]), [{ as_written: 'EC135T2', resolved: 'EC35' }], { types: ['EC35'], regs: [] });
ok(typeOf(r, 'EC135T2') === 'EC35' && r.groups[0].via === 'type-code', `typkoden = flottans namn (${r.groups[0].via})`);

// 6. Registreringen är känd i flottan som en annan typ → flottans typ (samma luftfartyg).
r = T.resolveScanTypes(rows([['H135', 'D-HABC', 3]]), [{ as_written: 'H135', resolved: 'EC35' }],
  { types: ['EC135'], regs: [{ registration: 'D-HABC', aircraft_type: 'EC135', n: 40 }] });
ok(typeOf(r, 'H135') === 'EC135' && r.groups[0].via === 'registration', `känd registrering → flottans typ (${typeOf(r, 'H135')}, ${r.groups[0].via})`);

// 7. Skrivsätt med bindestreck/mellanslag är samma namn som i flottan.
r = T.resolveScanTypes(rows([['C-172', '', 2], ['c172', '', 1]]), [], { types: ['C172'], regs: [] });
ok(r.groups.length === 1 && typeOf(r, 'C-172') === 'C172' && r.groups[0].via === 'name', 'C-172 = flottans C172');

// 8. PA28 och PA28R: olika typkoder → hålls isär, även mot flottan.
r = T.resolveScanTypes(rows([['PA28', '', 5], ['PA28R', '', 3]]),
  [{ as_written: 'PA28', resolved: 'P28A' }, { as_written: 'PA28R', resolved: 'P28R' }], noFleet);
ok(r.groups.length === 2, 'PA28 och PA28R hålls isär');
r = T.resolveScanTypes(rows([['PA28R', '', 3], ['PA28', '', 1]]),
  [{ as_written: 'PA28R', resolved: 'P28R' }, { as_written: 'PA28', resolved: 'P28A' }], { types: ['PA28'], regs: [] });
ok(typeOf(r, 'PA28R') !== 'PA28', `PA28R blir inte flottans PA28 (${typeOf(r, 'PA28R')})`);

// 9. Variantsuffix mot flottan utan motsägelse → flottans typ, markerat "similar".
r = T.resolveScanTypes(rows([['B206L', '', 2]]), [], { types: ['B206'], regs: [] });
ok(typeOf(r, 'B206L') === 'B206' && r.groups[0].via === 'similar', 'B206L → flottans B206 (similar)');

// 10. "Keep separate": skrivsättet slås inte ihop och matchas bara på exakt namn.
r = T.resolveScanTypes(rows([['EC135T1', '8265', 5], ['EC135', '8265', 3]]), [], noFleet, new Set(['EC135T1']));
ok(r.groups.length === 2, 'hålls isär på begäran');
r = T.resolveScanTypes(rows([['B206L', '', 2]]), [], { types: ['B206'], regs: [] }, new Set(['B206L']));
ok(typeOf(r, 'B206L') === 'B206L' && !r.groups[0].fleet, 'isärhållen variant blir egen typ');

// 11. A320 och A321 i samma bok, olika registreringar → två typer.
r = T.resolveScanTypes(rows([['A320', 'SE-ROA', 3], ['A321', 'SE-ROB', 2]]),
  [{ as_written: 'A320', resolved: 'A320' }, { as_written: 'A321', resolved: 'A321' }], noFleet);
ok(r.groups.length === 2, 'A320 och A321 är olika');

// 13. Varianter: EC135T1 och EC135T2 har samma typkod men slås inte ihop, och behåller sina namn.
r = T.resolveScanTypes(rows([['EC135T1', 'SE-HMA', 10], ['EC135T2', 'SE-HMB', 6]]),
  [{ as_written: 'EC135T1', resolved: 'EC35' }, { as_written: 'EC135T2', resolved: 'EC35' }], noFleet);
ok(r.groups.length === 2, `T1 och T2 är två typer (${r.groups.map((g) => g.id).join(' / ')})`);
ok(typeOf(r, 'EC135T1') === 'EC135T1' && typeOf(r, 'EC135T2') === 'EC135T2', `namnen behålls (${typeOf(r, 'EC135T1')}, ${typeOf(r, 'EC135T2')})`);

// 14. Ett allmänt "EC135" bredvid både T1 och T2 går inte ihop med någon av dem.
r = T.resolveScanTypes(rows([['EC135T1', '', 10], ['EC135T2', '', 6], ['EC135', '', 3]]),
  [{ as_written: 'EC135T1', resolved: 'EC35' }, { as_written: 'EC135T2', resolved: 'EC35' }, { as_written: 'EC135', resolved: 'EC35' }], noFleet);
ok(r.groups.length === 3, `tre typer (${r.groups.map((g) => g.id).join(' / ')})`);

// 15. Flottan har EC135T1, skanningen EC135T2 → ny typ EC135T2 i EC135T1:s familj (inte "EC35", inte T1).
r = T.resolveScanTypes(rows([['EC135T2', 'SE-HMB', 6]]), [{ as_written: 'EC135T2', resolved: 'EC35' }],
  { types: ['EC135T1'], regs: [{ registration: 'SE-HMA', aircraft_type: 'EC135T1', n: 40 }] });
ok(typeOf(r, 'EC135T2') === 'EC135T2' && !r.groups[0].fleet, `T2 blir egen typ (${typeOf(r, 'EC135T2')}, fleet=${r.groups[0].fleet})`);
ok(r.groups[0].familyFleet === 'EC135T1', `familj med flottans T1 (${r.groups[0].familyFleet})`);

// 16. Samma registrering som flottans T1 → flottans typ (samma luftfartyg), trots annat skrivsätt.
r = T.resolveScanTypes(rows([['EC135T2', 'SE-HMA', 2]]), [{ as_written: 'EC135T2', resolved: 'EC35' }],
  { types: ['EC135T1'], regs: [{ registration: 'SE-HMA', aircraft_type: 'EC135T1', n: 40 }] });
ok(typeOf(r, 'EC135T2') === 'EC135T1' && r.groups[0].via === 'registration', 'känd registrering vinner');

// 17. Familjelogiken.
ok(F.distinctVariants('EC135T1', 'EC135T2') && F.distinctVariants('A109LUH', 'A109E') && F.distinctVariants('AS350B2', 'AS350B3'), 'olika varianter');
ok(!F.distinctVariants('EC135', 'EC135T1') && !F.distinctVariants('H125', 'H145') && !F.distinctVariants('B737', 'B738') && !F.distinctVariants('AW139', 'AW169'), 'inte olika varianter');
ok(F.sameFamily('EC135', 'EC135T1') && F.sameFamily('PA28', 'PA28R') && !F.sameFamily('A320', 'A321') && !F.sameFamily('H125', 'H145'), 'samma familj');
ok(F.familyName(['EC135T1', 'EC135T2', 'EC135']) === 'EC135' && F.familyName(['A109LUH', 'A109E']) === 'A109', `familjenamn (${F.familyName(['A109LUH', 'A109E'])})`);
let fam = F.computeFamilies([{ aircraft_type: 'EC135T1' }, { aircraft_type: 'EC135T2' }, { aircraft_type: 'R44' }, { aircraft_type: 'A109LUH', family_locked: 1 }, { aircraft_type: 'A109E' }]);
ok(fam.get('EC135T1') === 'EC135' && fam.get('EC135T2') === 'EC135' && !fam.has('R44') && !fam.has('A109E') && !fam.has('A109LUH'), `familjer i flottan (${[...fam].join(' ')})`);
fam = F.computeFamilies([{ aircraft_type: 'EC135T1', family: 'EC135' }]);
ok(fam.get('EC135T1') === '', 'ensam typ tappar familjen');

// 12. Tomma typer räknas inte.
r = T.resolveScanTypes(rows([['', '', 3]]), [], noFleet);
ok(r.groups.length === 0, 'tomma typer');

console.log(fails ? `${fails} fel` : 'inga fel');
process.exit(fails ? 1 : 0);
