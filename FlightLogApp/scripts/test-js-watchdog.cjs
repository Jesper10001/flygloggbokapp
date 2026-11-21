// Test av JS-vakten (services/jsWatchdog.ts) med riktig kod och låtsade timrar/filsystem/Sentry:
// en provocerad frysning rapporteras fortfarande; avsiktlig omstart, ny uppdatering, krasch och bakgrund ger
// inget "unclean exit"-larm (Sentry BLADES-IOS-6, 2026-11-21). Kör: node scripts/test-js-watchdog.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../services/jsWatchdog.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

let fails = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('  FEL:', msg, '\n    fick  ', JSON.stringify(got), '\n    väntat', JSON.stringify(want)); } };
const flush = () => new Promise((r) => setImmediate(r));

function load({ file = null, updateId = 'u2', crashed = null } = {}) {
  const files = { 'doc/js-watchdog.json': file };
  const reports = [], crumbs = [], intervals = [];
  let appListener = null, now = 1_000_000;
  const mocks = {
    'react-native': { AppState: { currentState: 'active', addEventListener: (_e, f) => { appListener = f; } } },
    'expo-file-system/legacy': {
      documentDirectory: 'doc/',
      getInfoAsync: async (f) => ({ exists: files[f] != null }),
      readAsStringAsync: async (f) => files[f],
      writeAsStringAsync: async (f, b) => { files[f] = b; },
    },
    './crashReporting': {
      crashReportingActive: () => true,
      reportHang: (m, d, k) => reports.push({ m, d, k }),
      addBreadcrumb: (c, m) => crumbs.push(`${c}:${m}`),
      crashedLastRun: async () => crashed,
    },
    'expo-updates': { updateId },
  };
  const g = { setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; }, clearInterval: () => {}, Date: { now: () => now } };
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'setInterval', 'clearInterval', 'Date', js)(mod, mod.exports, (n) => mocks[n], g.setInterval, g.clearInterval, Object.assign(function (...a) { return new (globalThis.Date)(...a); }, { now: () => now }));
  return { W: mod.exports, files, reports, crumbs, intervals, setNow: (t) => { now = t; }, getNow: () => now, app: (st) => appListener(st) };
}

(async () => {
  // 1) Provocerad frysning: en tick som kommer 2,6 s sent → "JavaScript froze for 2.1 s"
  const a = load();
  a.W.startJsWatchdog();
  await flush(); await flush();
  a.W.setWatchdogScreen('/log');
  a.W.noteInteraction();
  const tick = a.intervals.find((i) => i.ms === 500).f;
  a.setNow(a.getNow() + 500); tick();
  eq(a.reports.length, 0, 'en normal tick rapporterar inget');
  a.setNow(a.getNow() + 2600); tick();
  eq(a.reports.map((r) => [r.k, r.m]), [['js_stall', 'JavaScript froze for 2.1 s']], 'provocerad frysning rapporteras');
  eq(a.reports[0].d.screen, '/log', 'skärmen följer med');
  eq(a.reports[0].d.appState, 'active', 'appens tillstånd följer med');
  eq(typeof a.reports[0].d.secondsSinceTouch, 'number', 'tid sedan senaste tryck följer med');

  // 2) Bakgrund: timrarna står still med flit → inget larm, brödsmula om bytet
  a.app('background');
  a.setNow(a.getNow() + 60000); tick();
  eq(a.reports.length, 1, 'ingen rapport i bakgrunden');
  eq(a.crumbs.includes('app.lifecycle:background on /log'), true, 'brödsmula vid byte till bakgrund');
  await flush();
  eq(JSON.parse(a.files['doc/js-watchdog.json']).foreground, false, 'hjärtslaget säger "inte framme" i bakgrunden');

  // 3) Förra sessionen: vilka fall rapporteras?
  const S = a.W.shouldReportUncleanExit;
  eq(S({ foreground: true, updateId: 'u2' }, 'u2', null), true, 'framme utan förklaring → rapportera');
  eq(S({ foreground: false, updateId: 'u2' }, 'u2', null), false, 'i bakgrunden → inget');
  eq(S({ foreground: true, clean: 'update restart', updateId: 'u2' }, 'u2', null), false, 'avsiktlig omstart → inget');
  eq(S({ foreground: true, updateId: 'u1' }, 'u2', null), false, 'ny uppdatering mellan sessionerna → inget');
  eq(S({ foreground: true, updateId: 'u2' }, 'u2', true), false, 'krasch (Sentry rapporterar själv) → inget');

  // 4) markCleanExit skriver en ren avslutning som nästa start respekterar
  const b = load();
  b.W.startJsWatchdog(); await flush(); await flush();
  await b.W.markCleanExit('update restart');
  const beat = JSON.parse(b.files['doc/js-watchdog.json']);
  eq([beat.foreground, beat.clean], [false, 'update restart'], 'ren avslutning skrivs före omladdning');
  const c = load({ file: JSON.stringify(beat) });
  c.W.startJsWatchdog(); await flush(); await flush();
  eq(c.reports.length, 0, 'start efter ren avslutning rapporterar inget');

  // 5) Verklig frysning förra gången (framme, samma uppdatering) rapporteras med detaljer
  const d = load({ file: JSON.stringify({ foreground: true, at: 999000, screen: '/', screenSince: 990000, appState: 'active', lastTouch: 998000, updateId: 'u2' }) });
  d.W.startJsWatchdog(); await flush(); await flush();
  eq(d.reports.map((r) => r.k), ['js_unclean_exit'], 'verkligt avbrott rapporteras');
  eq([d.reports[0].d.screen, d.reports[0].d.secondsSinceTouch], ['/', 1], 'skärm och tid sedan tryck i avbrottsrapporten');

  if (fails) { console.log(`${fails} fel`); process.exit(1); }
  console.log('JS-vakten: alla kontroller gick igenom');
})();
