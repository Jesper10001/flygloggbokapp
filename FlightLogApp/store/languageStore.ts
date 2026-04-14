import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

type Language = 'en' | 'sv';

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: 'en',

  setLanguage: async (lang: Language) => {
    set({ language: lang });
    await setSetting('app_language', lang);
  },

  loadLanguage: async () => {
    const saved = await getSetting('app_language');
    if (saved === 'en' || saved === 'sv') {
      set({ language: saved });
    }
  },
}));
