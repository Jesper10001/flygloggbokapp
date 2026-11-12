// Test av ordningen på registreringar i listorna (utils/registrationSort.ts): bokstavsdel, sedan nummer, och
// tvillingar som bara skiljer på O och nolla bredvid varandra. Kör: node scripts/test-registration-sort.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../utils/registrationSort.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { compareRegistrations } = mod.exports;

let fails = 0;
const eq = (input, want, msg) => {
  const got = [...input].sort(compareRegistrations);
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', got.join(' '), '\n    väntat', want.join(' ')); }
};

// Nolla och bokstaven O i samma flotta: tvillingarna bredvid varandra, nollan först, i nummerordning.
eq(['KILO37', 'KIL022', 'KILO21', 'KIL037', 'KILO22', 'KILO40', 'KIL026', 'KILO83', 'KILO26', 'KILO23'],
  ['KILO21', 'KIL022', 'KILO22', 'KILO23', 'KIL026', 'KILO26', 'KIL037', 'KILO37', 'KILO40', 'KILO83'], 'O och nolla');
// Nummer jämförs som tal, inte tecken för tecken.
eq(['KILO10', 'KILO9', 'KILO100', 'KILO22'], ['KILO9', 'KILO10', 'KILO22', 'KILO100'], 'numerisk ordning');
// Bokstavsdelen först; ett O som inte står intill en siffra är en vanlig bokstav.
eq(['SE-JOO', 'SE-JAA', 'KILO5', 'SE-HXA', 'D-HABC'], ['D-HABC', 'KILO5', 'SE-HXA', 'SE-JAA', 'SE-JOO'], 'bokstavsordning');
// Skiftläge spelar ingen roll.
eq(['se-kxy', 'SE-KXA'], ['SE-KXA', 'se-kxy'], 'skiftläge');

console.log(fails ? `\n${fails} fel` : 'Registreringarnas ordning: alla kontroller gick igenom');
process.exit(fails ? 1 : 0);
