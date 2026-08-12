// Drönarlägets accentfärg som användarinställning (cyan default). Trådas in i
// dashboard, chips, barer, FAB, total-bar och aktiv flik. Persistas i settings.

import { create } from 'zustand';
import { type DroneAccentKey } from '../constants/droneTheme';
import { NavyColors } from '../constants/colors';

// FÖRENAT FÄRGSCHEMA: drönarläget använder samma accent som pilot manned (navy-temats
// primary, cyan). Ingen accent-växling längre — behåller store-API:t så befintliga
// skärmar (som läser .color) fungerar, men färgen är fast.
const UNIFIED_ACCENT = NavyColors.primary; // '#00C8E8'

interface DroneAccentState {
  key: DroneAccentKey;
  color: string;
  loaded: boolean;
  load: () => Promise<void>;
  setAccent: (key: DroneAccentKey) => Promise<void>;
}

export const useDroneAccentStore = create<DroneAccentState>((set) => ({
  key: 'cyan',
  color: UNIFIED_ACCENT,
  loaded: true,
  load: async () => { set({ color: UNIFIED_ACCENT, loaded: true }); },
  setAccent: async () => { set({ color: UNIFIED_ACCENT }); }, // no-op — färgen är fast
}));
