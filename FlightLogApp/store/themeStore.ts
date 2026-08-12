import { create } from 'zustand';

// FÖRENAT TEMA: hela appen (pilot + drönare) använder ett enda mörkt navy-tema.
// Bright- och drönar-teman (industrial/neon) är borttagna. Store-API:t behålls
// (setTheme/loadTheme/applyForMode) så befintliga anropare inte bryts — men temat
// är alltid 'navy'.
export type Theme = 'navy';

interface ThemeStore {
  theme: Theme;
  setTheme: (theme?: Theme) => Promise<void>;
  loadTheme: () => Promise<void>;
  applyForMode: (mode: 'manned' | 'drone') => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'navy',
  setTheme: async () => { set({ theme: 'navy' }); },
  loadTheme: async () => { set({ theme: 'navy' }); },
  applyForMode: async () => { set({ theme: 'navy' }); },
}));
