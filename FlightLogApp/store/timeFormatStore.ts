import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export type TimeFormat = 'decimal' | 'hhmm';

interface TimeFormatStore {
  timeFormat: TimeFormat;
  setTimeFormat: (fmt: TimeFormat) => Promise<void>;
  loadTimeFormat: () => Promise<void>;
}

export const useTimeFormatStore = create<TimeFormatStore>((set) => ({
  timeFormat: 'decimal',

  setTimeFormat: async (fmt: TimeFormat) => {
    set({ timeFormat: fmt });
    await setSetting('time_format', fmt);
  },

  loadTimeFormat: async () => {
    const saved = await getSetting('time_format');
    if (saved === 'decimal' || saved === 'hhmm') {
      set({ timeFormat: saved });
    }
  },
}));
