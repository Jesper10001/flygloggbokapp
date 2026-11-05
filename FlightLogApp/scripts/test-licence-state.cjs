// Test av Next licence-kortets beräkningar (components/insights/licenceState.ts): vilket krav som sätter datumet,
// ETA, det troliga fönstret, klara licenser och krav utan takt. Kör: node scripts/test-licence-state.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports;
}
const L = load(path.join(__dirname, '../components/insights/licenceState.ts'));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FEL:', msg); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const now = new Date();
const nowA = now.getFullYear() * 12 + now.getMonth();
const iso = (a) => `${Math.floor(a / 12)}-${String((a % 12) + 1).padStart(2, '0')}-15`;

// Låtsasdata: varje kategori flygs med ett jämnt antal timmar i månaden från en startmånad t.o.m. i år.
function fakeData(spec) {
  const series = {}, have = {};
  for (const [key, { perMonth, months, stopAgo = 0 }] of Object.entries(spec)) {
    const out = [];
    let cum = 0;
    for (let i = months - 1; i >= 0; i--) {
      if (i >= stopAgo) cum += perMonth;
      const a = nowA - i;
      out.push({ date: new Date(Math.floor(a / 12), a % 12, 1), cum });
    }
    series[key] = out;
    have[key] = cum;
  }
  return {
    haveFor: (k) => have[k] ?? 0,
    rateFor: (k) => (spec[k] && !spec[k].stopAgo ? spec[k].perMonth : 0),
    seriesFor: (k) => series[k] ?? [],
    metDateFor: (k, req) => {
      const s = series[k] ?? [];
      const p = s.find((x) => x.cum >= req);
      return p ? iso(p.date.getFullYear() * 12 + p.date.getMonth()) : null;
    },
  };
}

const ATPL = { code: 'ATPL', reqs: [
  { label: 'Total flight time', key: 'total', required: 1500 },
  { label: 'Multi-crew ops', key: 'multi_pilot', required: 500 },
  { label: 'PIC', key: 'pic', required: 250 },
  { label: 'Cross-country', key: 'xc', required: 200 },
  { label: 'Instrument (IFR)', key: 'ifr', required: 75 },
  { label: 'Night', key: 'night', required: 100 },
] };
const PPL = { code: 'PPL', reqs: [
  { label: 'Total flight time', key: 'total', required: 45 },
  { label: 'Dual instruction', key: 'dual', required: 25 },
  { label: 'Solo flight', key: 'pic', required: 10 },
  { label: 'Solo cross-country', key: 'xc_pic', required: 5 },
  { label: 'Night', key: 'night', required: 5 },
] };

console.log('ATPL på väg');
{
  const D = fakeData({
    total: { perMonth: 20, months: 60 },        // 1200 h, 300 kvar → 15 mån
    multi_pilot: { perMonth: 10, months: 30 },  // 300 h, 200 kvar → 20 mån
    pic: { perMonth: 5, months: 60 },           // 300 h, klart
    xc: { perMonth: 4, months: 60 },            // 240 h, klart
    ifr: { perMonth: 1, months: 60 },           // 60 h, 15 kvar → 15 mån
    night: { perMonth: 1, months: 72 },         // 72 h, 28 kvar → 28 mån
  });
  const S = L.buildState(ATPL, D, nowA);
  ok(!S.done && S.metCount === 2, `2 av 6 klara, fick ${S.metCount}`);
  ok(S.lim && S.lim.key === 'night', `Night sätter datumet, fick ${S.lim && S.lim.key}`);
  ok(S.etaM === 28, `ETA om 28 månader, fick ${S.etaM}`);
  ok(S.reqs.find((r) => r.key === 'pic').short === 'PIC' && S.reqs.find((r) => r.key === 'multi_pilot').short === 'Multi-crew', 'korta namn');
  const expReady = (1200 / 1500 + 300 / 500 + 1 + 1 + 60 / 75 + 72 / 100) / 6;
  ok(near(S.ready, expReady), `READY ${S.ready} ≠ ${expReady}`);
  ok(near(L.readyAt(S, nowA, nowA), S.ready), 'kurvan slutar i READY idag');
  ok(near(L.projAt(S, S.etaM, (r) => r.pace), 1), 'projektionen når 100 % på ETA');
  ok(L.projAt(S, S.etaM - 1, (r) => r.pace) < 1, 'projektionen är under 100 % månaden före');
  ok(S.fastM != null && S.slowM != null && S.fastM <= S.etaM && S.slowM >= S.etaM, `fönstret ${S.fastM}–${S.slowM} omfattar ${S.etaM}`);
  ok(L.readyAt(S, nowA - 80, nowA) === 0, 'före loggboken är man 0 % redo');
  ok(S.doneA === null, 'ingen klar-månad för en pågående licens');

  // Helskärmens takter: den vanliga ger samma datum som kortet, den bästa och den långsammaste som fönstret.
  const usual = L.etaFor(S, L.pacePick('usual')), fast = L.etaFor(S, L.pacePick('fast')), slow = L.etaFor(S, L.pacePick('slow'));
  ok(usual.m === S.etaM && usual.lim === S.lim, `vanlig takt = kortets ETA, fick ${usual.m}`);
  ok(fast.m === S.fastM && slow.m === S.slowM, `bästa/långsammaste = fönstret, fick ${fast.m}/${slow.m}`);
  ok(L.monthsAt(S.reqs.find((r) => r.key === 'pic'), L.pacePick('slow')) === 0, 'ett klart krav har 0 månader kvar');
}

console.log('PPL klar');
{
  const D = fakeData({
    total: { perMonth: 8, months: 24 }, dual: { perMonth: 3, months: 24, stopAgo: 12 },
    pic: { perMonth: 2, months: 24 }, xc_pic: { perMonth: 1, months: 20 }, night: { perMonth: 0.5, months: 20 },
  });
  const S = L.buildState(PPL, D, nowA);
  ok(S.done && S.metCount === 5, 'alla fem krav klara');
  ok(S.etaM === 0 && S.lim === null, 'ingen ETA kvar');
  const dualMet = S.reqs.find((r) => r.key === 'dual').metA;
  ok(S.doneA === Math.max(...S.reqs.map((r) => r.metA)), 'klar när sista kravet blev klart');
  ok(dualMet === nowA - 23 + 8, `dual klar efter 9 månader, fick ${dualMet - (nowA - 23)}`);
  ok(S.reqs.find((r) => r.key === 'pic').short === 'Solo' && S.reqs.find((r) => r.key === 'xc_pic').short === 'Solo XC', 'korta namn i PPL');
}

console.log('Krav utan takt');
{
  const D = fakeData({
    total: { perMonth: 20, months: 60 }, multi_pilot: { perMonth: 10, months: 30 }, pic: { perMonth: 5, months: 60 },
    xc: { perMonth: 4, months: 60 }, ifr: { perMonth: 1, months: 60, stopAgo: 14 }, night: { perMonth: 1, months: 72 },
  });
  const S = L.buildState(ATPL, D, nowA);
  ok(S.etaM === null, `ingen ETA när IFR inte flugits på ett år, fick ${S.etaM}`);
  ok(S.lim && S.lim.key === 'ifr', `IFR pekas ut, fick ${S.lim && S.lim.key}`);
  ok(S.reqs.find((r) => r.key === 'ifr').m === null, 'IFR har inget datum');
  const u = L.etaFor(S, L.pacePick('usual'));
  ok(u.m === null && u.lim && u.lim.key === 'ifr', 'etaFor: inget datum, IFR pekas ut');
}

console.log('Tom loggbok');
{
  const S = L.buildState(ATPL, fakeData({}), nowA);
  ok(S.ready === 0 && S.metCount === 0 && !S.done, 'inget klart');
  ok(S.etaM === null && S.fastM === null, 'inga datum');
  ok(L.readyAt(S, nowA - 5, nowA) === 0, 'kurvan ligger på 0');
}

console.log('Timmar i texter');
ok(L.hoursTxt(4.6) === '4.6' && L.hoursTxt(5) === '5' && L.hoursTxt(1184.4) === '1 184', 'hoursTxt');

console.log(fails ? `${fails} fel` : 'Alla gröna');
process.exit(fails ? 1 : 0);
