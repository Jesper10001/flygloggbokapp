// EAS Update hämtas helt tyst. Vid start kollar och hämtar expo-updates själv i bakgrunden (app.json:
// checkAutomatically ON_LOAD), och det som hämtats används nästa gång appen startar från början. Ingenting visas
// under tiden: varken hämtningen eller någon uppmaning att starta om. Det enda användaren ser är
// "Blades was updated" (UpdateAppliedModal) när den nya koden körs.
//
// iOS håller ofta appen vid liv i bakgrunden i dagar, och då görs ingen kontroll vid start. Därför kollas och
// hämtas även när appen kommer tillbaka från bakgrunden, högst en gång i halvtimmen. Appen laddas aldrig om
// här: det skulle kasta det användaren håller på med (t.ex. en halvfylld flygning).

import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

const ENABLED = !__DEV__ && Updates.isEnabled;
const MIN_GAP_MS = 30 * 60 * 1000;

export function SilentUpdates() {
  useEffect(() => {
    if (!ENABLED) return;
    let last = Date.now(); // starten har redan kollat
    let busy = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || busy || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      busy = true;
      (async () => {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) await Updates.fetchUpdateAsync();
      })().catch(() => {}).finally(() => { busy = false; }); // utan nät: nästa tillfälle
    });
    return () => sub.remove();
  }, []);
  return null;
}
