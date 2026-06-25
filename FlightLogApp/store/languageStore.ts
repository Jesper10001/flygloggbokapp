import { create } from 'zustand';

// Appen är numera enbart engelsk. Språkvalet (svenska/engelska) är borttaget.
// Storen är låst till 'en' så att t() och alla language-baserade ternärer
// (`language === 'sv' ? … : …`) alltid ger engelska. Typen behålls som
// 'en' | 'sv' så befintliga jämförelser fortfarande typecheckar.
type Language = 'en' | 'sv';

interface LanguageStore {
  language: Language;
  setLanguage: (lang?: Language) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: 'en',

  // No-op: språkvalet är borttaget — appen är alltid engelsk.
  setLanguage: async () => {
    set({ language: 'en' });
  },

  // Ignorera ev. tidigare sparat 'sv' — tvinga alltid engelska.
  loadLanguage: async () => {
    set({ language: 'en' });
  },
}));
