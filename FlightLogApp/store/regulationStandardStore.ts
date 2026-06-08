import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

// UK CAA speglar EASA FCL — 'caa' behandlas som EASA i alla konsumenter (export,
// progresskartor) men sparas som eget värde så valet bevaras.
export type RegulationStandard = 'easa' | 'faa' | 'caa';

interface RegulationStandardStore {
  standard: RegulationStandard;
  loaded: boolean;
  load: () => Promise<void>;
  setStandard: (s: RegulationStandard) => Promise<void>;
}

export const useRegulationStandardStore = create<RegulationStandardStore>((set) => ({
  standard: 'easa',
  loaded: false,
  load: async () => {
    const v = await getSetting('regulation_standard');
    const next: RegulationStandard = v === 'faa' ? 'faa' : v === 'caa' ? 'caa' : 'easa';
    set({ standard: next, loaded: true });
  },
  setStandard: async (s) => {
    await setSetting('regulation_standard', s);
    set({ standard: s });
  },
}));
