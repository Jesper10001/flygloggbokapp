// Vakt för JavaScript-tråden (typ 2-frysningar). iPhonens frysningsdetektering och Sentrys "App Hanging"
// bevakar bara huvudtråden; när appens JavaScript står still (tung kod som räknar länge) är huvudtråden ofta
// frisk, så ingen av dem märker något — knapparna slutar bara svara. Två sätt att fånga det:
//
//  1. Stopp som släpper: en timer tickar var 500 ms. Kommer en tick mer än STALL_MS för sent stod JavaScript
//     still så länge → en varning till Sentry med hur länge, vilken skärm, appens tillstånd och tid sedan
//     senaste tryck (bara skärmens namn, ingen data).
//  2. Stopp som aldrig släpper: medan appen är framme skrivs ett hjärtslag (tid + skärm) till en liten fil var
//     5:e sekund, och "inte framme" skrivs så fort appen går undan (även app-väljaren). Står JavaScript still
//     hinner det aldrig skrivas — så hittar nästa start ett hjärtslag som säger "framme" och rapporterar att
//     förra gången slutade med appen framme, på den skärmen. (En vanlig krasch rapporterar Sentry för sig och
//     räknas inte här.)
//
// Falsklarm som undviks (BLADES-IOS-6, 2026-11-21):
//  - "Restart" i uppdateringsrutan laddar om JavaScript medan appen är framme (Updates.reloadAsync) → före
//    omladdningen skrivs en ren avslutning (markCleanExit), och en ny uppdatering mellan två sessioner räknas
//    aldrig som frysning (hjärtslaget bär uppdateringens id).
//  - Skrivningarna köas i ordning: ett "framme" som startade strax före bytet till bakgrunden kan inte längre
//    landa efter "inte framme" och lämna filen i fel läge när appen sveps bort.
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
let lastTouch = 0;              // senaste tryck på skärmen (noteInteraction från app/_layout.tsx)
let reports = 0;
let appState: string = AppState.currentState ?? 'unknown';
let active = appState === 'active';
let checked = false;            // förra sessionens hjärtslag läst (skrivs inte över innan)
let writeQ: Promise<unknown> = Promise.resolve();

// Uppdateringens id (expo-updates) — byts det mellan två sessioner har appen startats om med en ny version.
function currentUpdateId(): string {
  try { return String(require('expo-updates').updateId ?? 'embedded'); } catch { return 'embedded'; }
}

// Skärmens namn utan id:n (/flight/detail/123 → /flight/detail/:id).
const clean = (path: string) => path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id') || '/';
const sinceTouch = (now = Date.now()) => (lastTouch ? Math.round((now - lastTouch) / 1000) : null);

/** Vilken skärm som visas (anropas vid varje skärmbyte, från app/_layout.tsx). */
export function setWatchdogScreen(path: string): void {
  const next = clean(path);
  if (next === screen) return;
  screen = next;
  screenSince = Date.now();
  addBreadcrumb('navigation', next);
  if (active) writeBeat(true);
}

/** Ett tryck på skärmen (onTouchStart på rotvyn) — "tid sedan senaste aktivitet" i rapporterna. */
export function noteInteraction(): void {
  lastTouch = Date.now();
}

/** Skriver hjärtslaget i tur och ordning (köat), så att ett sent "framme" aldrig skriver över "inte framme". */
function writeBeat(foreground: boolean, extra: Record<string, unknown> = {}): Promise<unknown> {
  if (!FileSystem.documentDirectory || !checked) return writeQ;
  const body = JSON.stringify({ foreground, at: Date.now(), screen, screenSince, appState, lastTouch, updateId: currentUpdateId(), ...extra });
  writeQ = writeQ.then(() => FileSystem.writeAsStringAsync(FILE, body)).catch(() => {});
  return writeQ;
}

/** Avsiktlig omstart (t.ex. "Restart" efter en uppdatering): markera att sessionen slutade rent. Vänta på den. */
export async function markCleanExit(reason: string): Promise<void> {
  addBreadcrumb('app.lifecycle', `clean exit: ${reason}`);
  await writeBeat(false, { clean: reason });
}

/** Ska förra sessionens hjärtslag rapporteras? Exporterad för testet (scripts/test-js-watchdog.cjs). */
export function shouldReportUncleanExit(last: any, updateIdNow: string, crashed: boolean | null): boolean {
  if (!last?.foreground) return false;                  // appen var inte framme → inget avbrott
  if (last.clean) return false;                          // avsiktlig omstart
  if (crashed === true) return false;                    // Sentry rapporterar kraschen själv
  if (last.updateId && last.updateId !== updateIdNow) return false;   // ny uppdatering = omstart, inte frysning
  return true;
}

async function checkLastSession(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return;
    const last = JSON.parse(await FileSystem.readAsStringAsync(FILE));
    if (shouldReportUncleanExit(last, currentUpdateId(), await crashedLastRun())) {
      const at = Number(last.at) || 0;
      reportHang('Previous session ended while the app was in front: JavaScript froze, or iOS closed the app', {
        screen: String(last.screen ?? ''),
        lastHeartbeat: new Date(at).toISOString(),
        onScreenSeconds: Math.round((at - (Number(last.screenSince) || 0)) / 1000),
        appState: String(last.appState ?? ''),
        secondsSinceTouch: last.lastTouch ? Math.round((at - Number(last.lastTouch)) / 1000) : null,
        minutesUntilNextStart: Math.round((Date.now() - at) / 60000),
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
      appState, secondsSinceTouch: sinceTouch(now - late),
    }, 'js_stall');
  }, TICK_MS);

  let beat: ReturnType<typeof setInterval> | null = active ? setInterval(() => writeBeat(true), BEAT_MS) : null;
  AppState.addEventListener('change', (st: AppStateStatus) => {
    appState = st;
    const nowActive = st === 'active';
    if (nowActive === active) return;
    active = nowActive;
    addBreadcrumb('app.lifecycle', `${st} on ${screen}`);
    last = Date.now();   // tiden i bakgrunden räknas inte
    if (beat) { clearInterval(beat); beat = null; }
    if (active) { writeBeat(true); beat = setInterval(() => writeBeat(true), BEAT_MS); }
    else writeBeat(false);
  });
}
