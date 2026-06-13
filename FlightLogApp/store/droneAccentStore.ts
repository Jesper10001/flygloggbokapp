// Drönarlägets accentfärg som användarinställning (cyan default). Trådas in i
// dashboard, chips, barer, FAB, total-bar och aktiv flik. Persistas i settings.

import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';
import { DRONE_ACCENTS, DEFAULT_DRONE_ACCENT, type DroneAccentKey } from '../constants/droneTheme';

interface DroneAccentState {
  key: DroneAccentKey;
  color: string;        // upplöst hex för aktuell accent
  loaded: boolean;
  load: () => Promise<void>;
  setAccent: (key: DroneAccentKey) => Promise<void>;
}

export const useDroneAccentStore = create<DroneAccentState>((set) => ({
  key: DEFAULT_DRONE_ACCENT,
  color: DRONE_ACCENTS[DEFAULT_DRONE_ACCENT],
  loaded: false,

  load: async () => {
    const saved = (await getSetting('drone_accent')) as DroneAccentKey | null;
    const key = saved && DRONE_ACCENTS[saved] ? saved : DEFAULT_DRONE_ACCENT;
    set({ key, color: DRONE_ACCENTS[key], loaded: true });
  },

  setAccent: async (key: DroneAccentKey) => {
    await setSetting('drone_accent', key);
    set({ key, color: DRONE_ACCENTS[key] });
  },
}));
