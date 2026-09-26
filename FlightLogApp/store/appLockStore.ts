// App-lås med Face ID / Touch ID. Toggle i Settings → App security. När på krävs biometrisk
// upplåsning vid appstart och när appen återvänder från bakgrunden. Nyckellogik:
//  - enabled: användarens val (persistas i settings 'app_lock')
//  - unlocked: sessionsstatus (true efter lyckad auth denna förgrund)
//  - available: enheten har biometrik registrerad
// LocalAuthentication lazy-requires → en build UTAN native-modulen kraschar inte (available=false).
import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

function LA(): any | null {
  try { return require('expo-local-authentication'); } catch { return null; }
}

interface AppLockStore {
  enabled: boolean;
  unlocked: boolean;
  available: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setEnabled: (v: boolean) => Promise<boolean>; // returnerar om åtgärden lyckades
  authenticate: () => Promise<boolean>;
  lock: () => void;
}

async function checkAvailable(): Promise<boolean> {
  const la = LA();
  if (!la) return false;
  try {
    const hw = await la.hasHardwareAsync();
    const enrolled = await la.isEnrolledAsync();
    return !!hw && !!enrolled;
  } catch { return false; }
}

export const useAppLockStore = create<AppLockStore>((set, get) => ({
  enabled: false,
  unlocked: true,
  available: false,
  loaded: false,

  load: async () => {
    const [saved, available] = await Promise.all([
      getSetting('app_lock').catch(() => null),
      checkAvailable(),
    ]);
    const enabled = saved === '1' && available;
    // Om låst → starta som EJ upplåst (gaten kräver auth); annars upplåst.
    set({ enabled, available, unlocked: !enabled, loaded: true });
  },

  authenticate: async () => {
    const la = LA();
    if (!la) { set({ unlocked: true }); return true; }
    try {
      const r = await la.authenticateAsync({
        promptMessage: 'Unlock Blades',
        fallbackLabel: 'Use passcode',
        disableDeviceFallback: false,
      });
      if (r.success) { set({ unlocked: true }); return true; }
      return false;
    } catch {
      return false;
    }
  },

  setEnabled: async (v: boolean) => {
    if (v) {
      const available = await checkAvailable();
      if (!available) { set({ available: false }); return false; }
      // Bekräfta med en auth innan vi slår på (så användaren inte låser ut sig av misstag).
      const ok = await get().authenticate();
      if (!ok) return false;
      await setSetting('app_lock', '1').catch(() => {});
      set({ enabled: true, available: true, unlocked: true });
      return true;
    }
    await setSetting('app_lock', '0').catch(() => {});
    set({ enabled: false, unlocked: true });
    return true;
  },

  // Anropas när appen går till bakgrunden → kräv ny upplåsning vid återkomst.
  lock: () => {
    if (get().enabled) set({ unlocked: false });
  },
}));
