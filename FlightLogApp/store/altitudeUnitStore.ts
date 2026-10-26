import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

// Höjdenhet i drönarläget (Settings → General): styr Log flights Max alt, detaljvyn, 120 m-varningen och
// CSV-exporten. Lagringen är alltid meter (drone_flights.max_altitude_m) → byte räknar bara om visningen.
export type AltitudeUnit = 'ft' | 'm';

interface AltitudeUnitStore {
  unit: AltitudeUnit;
  setUnit: (u: AltitudeUnit) => Promise<void>;
  load: () => Promise<void>;
}

export const useAltitudeUnitStore = create<AltitudeUnitStore>((set) => ({
  unit: 'ft',

  setUnit: async (u: AltitudeUnit) => {
    set({ unit: u });
    await setSetting('altitude_unit', u);
  },

  load: async () => {
    const saved = await getSetting('altitude_unit');
    if (saved === 'ft' || saved === 'm') set({ unit: saved });
  },
}));
