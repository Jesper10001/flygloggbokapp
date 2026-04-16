import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';
import type { PilotType } from '../constants/droneCategories';

interface PilotTypeStore {
  pilotType: PilotType;
  loaded: boolean;
  load: () => Promise<void>;
  setPilotType: (p: PilotType) => Promise<void>;
}

export const usePilotTypeStore = create<PilotTypeStore>((set) => ({
  pilotType: 'commercial',
  loaded: false,
  load: async () => {
    const v = await getSetting('drone_pilot_type');
    const next: PilotType = v === 'military' ? 'military' : 'commercial';
    set({ pilotType: next, loaded: true });
  },
  setPilotType: async (p) => {
    await setSetting('drone_pilot_type', p);
    set({ pilotType: p });
  },
}));
