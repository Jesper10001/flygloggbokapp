// EAS Update hämtas i bakgrunden: vid start kollar och hämtar expo-updates själv (app.json: checkAutomatically
// ON_LOAD). Medan appen är öppen kollas det dessutom en gång i timmen, och direkt när appen kommer tillbaka från
// bakgrunden (högst var femte minut). iOS fryser appen i bakgrunden, så där körs ingen kontroll; den görs i stället
// när man kommer tillbaka. En hämtad uppdatering används vid nästa start, eller direkt via "Restart now" i
// UpdateReadyDialog (på dashboarden, aldrig före onboarding och Blades introduction). Appen laddas aldrig om här:
// det skulle kasta det användaren håller på med (t.ex. en halvfylld flygning).

import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

const ENABLED = !__DEV__ && Updates.isEnabled;
const HOURLY_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 5 * 60 * 1000;

export function SilentUpdates() {
  useEffect(() => {
    if (!ENABLED) return;
    let last = Date.now(); // starten har redan kollat
    let busy = false;
    const run = (minGap: number) => {
      if (busy || Date.now() - last < minGap) return;
      last = Date.now();
      busy = true;
      (async () => {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) await Updates.fetchUpdateAsync(); // → useUpdates().isUpdatePending (UpdateReadyDialog)
      })().catch(() => {}).finally(() => { busy = false; }); // utan nät: nästa tillfälle
    };
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') run(MIN_GAP_MS); });
    // Varje timme medan appen är öppen (timern står still när iOS fryser appen i bakgrunden).
    const timer = setInterval(() => { if (AppState.currentState === 'active') run(HOURLY_MS - 60 * 1000); }, HOURLY_MS);
    return () => { sub.remove(); clearInterval(timer); };
  }, []);
  return null;
}
