import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export type Theme = 'navy' | 'bright';

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  loadTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'navy',

  setTheme: async (theme: Theme) => {
    set({ theme });
    await setSetting('app_theme', theme);
  },

  loadTheme: async () => {
    const saved = await getSetting('app_theme');
    if (saved === 'navy' || saved === 'bright') {
      set({ theme: saved });
    }
  },
}));
