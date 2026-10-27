import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

// Samtycke till AI-funktionerna (App Store 5.1.2(i)): inget skickas till Anthropic förrän användaren har
// tillåtit det. Valet sparas i settings-tabellen ('ai_consent'); saknas raden har användaren inte valt än.
// Dialogen och spärren ligger i services/aiConsent.ts — storen håller bara valet (styr Settings-reglaget).
export type AiConsent = 'granted' | 'declined' | 'unset';

interface AiConsentStore {
  consent: AiConsent;
  loaded: boolean;
  load: () => Promise<AiConsent>;
  setConsent: (c: 'granted' | 'declined') => Promise<void>;
}

export const useAiConsentStore = create<AiConsentStore>((set, get) => ({
  consent: 'unset',
  loaded: false,

  load: async () => {
    if (get().loaded) return get().consent;
    let consent: AiConsent = 'unset';
    try {
      const saved = await getSetting('ai_consent');
      if (saved === 'granted' || saved === 'declined') consent = saved;
    } catch { /* oläsbar databas → behandla som ej valt (frågar hellre en gång för mycket) */ }
    set({ consent, loaded: true });
    return consent;
  },

  setConsent: async (c) => {
    set({ consent: c, loaded: true });
    try { await setSetting('ai_consent', c); } catch { /* valet gäller ändå för den här sessionen */ }
  },
}));
