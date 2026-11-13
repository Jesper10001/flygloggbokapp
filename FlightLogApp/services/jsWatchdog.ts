// Vakt för JavaScript-tråden (typ 2-frysningar). iPhonens frysningsdetektering och Sentrys "App Hanging"
// bevakar bara huvudtråden; när appens JavaScript står still (tung kod som räknar länge) är huvudtråden ofta
// frisk, så ingen av dem märker något — knapparna slutar bara svara. Två sätt att fånga det:
//
//  1. Stopp som släpper: en timer tickar var 500 ms. Kommer en tick mer än STALL_MS för sent stod JavaScript
//     still så länge → en varning till Sentry med hur länge och vilken skärm (bara skärmens namn, ingen data).
//  2. Stopp som aldrig släpper: medan appen är framme skrivs ett hjärtslag (tid + skärm) till en liten fil var
//     5:e sekund, och "inte framme" skrivs så fort appen går undan (även app-väljaren). Står JavaScript still
//     hinner det aldrig skrivas — så hittar nästa start ett hjärtslag som säger "framme" och rapporterar att
//     förra gången slutade med appen framme, på den skärmen. (En vanlig krasch rapporterar Sentry för sig och
//     räknas inte här.) Appen laddas aldrig om medan den är framme (EAS-uppdateringar gäller vid nästa start).
//
// Gör ingenting utan Sentry (dev-byggen och byggen utan DSN), se services/crashReporting.ts.
import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { crashReportingActive, reportHang, addBreadcrumb, crashedLastRun } from './crashReporting';

const TICK_MS = 500;
const STALL_MS = 2000;          // så här länge får JavaScript stå still innan det rapporteras
const BEAT_MS = 5000;
const MAX_REPORTS = 5;          // per session, så att en dålig skärm inte översvämmar Sentry
const FILE = (FileSystem.documentDirectory ?? '') + 'js-watchdog.json';

let started = false;
let screen = 'start';
let screenSince = Date.now();
let reports = 0;
let active = AppState.currentState === 'active';
let checked = false;            // förra sessionens hjärtslag läst (skrivs inte över innan)

// Skärmens namn utan id:n (/flight/detail/123 → /flight/detail/:id).
const clean = (path: string) => path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id') || '/';

/** Vilken skärm som visas (anropas vid varje skärmbyte, från app/_layout.tsx). */
export function setWatchdogScreen(path: string): void {
  const next = clean(path);
  if (next === screen) return;
  screen = next;
  screenSince = Date.now();
  addBreadcrumb('navigation', next);
  if (active) writeBeat(true);
}

function writeBeat(foreground: boolean): void {
  if (!FileSystem.documentDirectory || !checked) return;
  FileSystem.writeAsStringAsync(FILE, JSON.stringify({ foreground, at: Date.now(), screen, screenSince })).catch(() => {});
}

async function checkLastSession(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return;
    const last = JSON.parse(await FileSystem.readAsStringAsync(FILE));
    // En krasch rapporterar Sentry redan själv; annars frös JavaScript (och appen stängdes) eller så stängde
    // iOS appen medan den var framme (t.ex. minnet).
    if (last?.foreground && (await crashedLastRun()) !== true) {
      reportHang('Previous session ended while the app was in front: JavaScript froze, or iOS closed the app', {
        screen: String(last.screen ?? ''),
        lastHeartbeat: new Date(Number(last.at) || 0).toISOString(),
        onScreenSeconds: Math.round(((Number(last.at) || 0) - (Number(last.screenSince) || 0)) / 1000),
      }, 'js_unclean_exit');
    }
  } catch { /* trasig fil: strunta i den */ }
}

/** Startar vakten en gång (från app/_layout.tsx). */
export function startJsWatchdog(): void {
  if (started || !crashReportingActive()) return;
  started = true;
  checkLastSession().finally(() => { checked = true; writeBeat(active); });

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const late = now - last - TICK_MS;
    last = now;
    // I bakgrunden står timrarna still med flit — det är inget stopp.
    if (!active || late < STALL_MS || reports >= MAX_REPORTS) return;
    reports++;
    reportHang(`JavaScript froze for ${(late / 1000).toFixed(1)} s`, {
      screen, frozenMs: Math.round(late), onScreenSeconds: Math.round((now - screenSince) / 1000),
    }, 'js_stall');
  }, TICK_MS);

  let beat: ReturnType<typeof setInterval> | null = active ? setInterval(() => writeBeat(true), BEAT_MS) : null;
  AppState.addEventListener('change', (st: AppStateStatus) => {
    const nowActive = st === 'active';
    if (nowActive === active) return;
    active = nowActive;
    last = Date.now();   // tiden i bakgrunden räknas inte
    if (beat) { clearInterval(beat); beat = null; }
    if (active) { writeBeat(true); beat = setInterval(() => writeBeat(true), BEAT_MS); }
    else writeBeat(false);
  });
}
