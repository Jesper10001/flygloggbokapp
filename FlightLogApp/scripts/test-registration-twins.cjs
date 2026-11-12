// Test av tvillingregistreringar (services/registrationTwins.ts): samma registrering med nolla och med O.
// Kör: node scripts/test-registration-twins.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../services/registrationTwins.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { twinMerges, twinOf, ozKey } = mod.exports;

let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };
const obj = (m) => Object.fromEntries([...m.entries()].sort());
const regs = (list, n = 1) => list.map((registration) => ({ registration, n }));

// Flottan från skärmdumpen: 22 med O, nio av dem finns också med nolla. O vinner alla nio, även där
// nollvarianten har fler flygningar (KIL026).
const kilo = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 46, 83].map((x) => `KILO${x}`);
const zero = [22, 26, 27, 28, 29, 31, 32, 34, 37].map((x) => `KIL0${x}`);
const fleet = [...regs(kilo, 2), ...regs(zero, 1), { registration: 'KIL026', n: 40 }];
const m = twinMerges(fleet);
eq(m.size, 9, 'nio tvillingar');
eq([...m.values()].every((to) => to.startsWith('KILO')), true, 'alla blir KILO med O');
eq(m.get('KIL026'), 'KILO26', 'KIL026 → KILO26 trots fler flygningar på nollan');
eq(m.has('KILO21'), false, 'en registrering utan tvilling rörs inte');

// En ensam tvilling utan syskon: flest flygningar vinner; lika → O.
eq(obj(twinMerges([{ registration: 'SE-H0A', n: 5 }, { registration: 'SE-HOA', n: 2 }])), { 'SE-HOA': 'SE-H0A' }, 'flest flygningar');
eq(obj(twinMerges([{ registration: 'AB0', n: 1 }, { registration: 'ABO', n: 1 }])), { AB0: 'ABO' }, 'lika → O');

// Inga tvillingar: ingenting. Skiftläge och mellanslag runt om spelar ingen roll.
eq(twinMerges(regs(['SE-JRA', 'SE-JRB', 'KILO21'])).size, 0, 'inga tvillingar');
eq(obj(twinMerges([{ registration: ' kilo26 ', n: 3 }, { registration: 'KIL026', n: 1 }])), { KIL026: 'KILO26' }, 'skiftläge');
// Andra förväxlingar (I och 1, bindestreck) hör inte hit.
eq(twinMerges(regs(['SE-JRI', 'SE-JR1', 'SEJRA', 'SE-JRA'])).size, 0, 'bara O och nolla');

// Import: loggbokens stavning vinner även när filen har fler rader med den andra.
eq(obj(twinMerges([{ registration: 'KILO26', n: 1 }, { registration: 'KIL026', n: 50 }], new Set(['KILO26']))), { KIL026: 'KILO26' }, 'loggbokens stavning vinner');
// Import utan att loggboken har någon av dem: filens vanligaste stavning.
eq(obj(twinMerges([...regs(['KILO21', 'KILO22', 'KILO23'], 4), { registration: 'KIL022', n: 1 }], new Set())), { KIL022: 'KILO22' }, 'filens vanligaste stavning');

eq(twinOf('KIL026', ['KILO21', 'KILO26']), 'KILO26', 'twinOf hittar tvillingen');
eq(twinOf('KILO26', ['KILO26']), null, 'twinOf: samma registrering är ingen tvilling');
eq(ozKey('kilo26'), 'KIL026', 'ozKey');

console.log(fails ? `\n${fails} fel` : 'Tvillingregistreringar: alla kontroller gick igenom');
process.exit(fails ? 1 : 0);
