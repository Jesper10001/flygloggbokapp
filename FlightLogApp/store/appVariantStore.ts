import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

// Vilken app man använder: den vanliga (Blades Extensive) eller Blades Essential, ett enkelt skal för den som bara
// vill logga och ha loggboken digitalt (app/essential). Samma data och funktioner; bara ytan skiljer.
export type AppVariant = 'extensive' | 'essential';

export const useAppVariantStore = create<{
  variant: AppVariant;
  load: () => Promise<void>;
  setVariant: (v: AppVariant) => Promise<void>;
}>((set) => ({
  variant: 'extensive',
  load: async () => {
    const v = await getSetting('app_variant').catch(() => null);
    set({ variant: v === 'essential' ? 'essential' : 'extensive' });
  },
  setVariant: async (variant) => {
    set({ variant });
    await setSetting('app_variant', variant);
  },
}));
