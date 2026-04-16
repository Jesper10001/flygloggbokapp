import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';
import { getDatabase } from '../db/database';
import { useThemeStore } from './themeStore';

export type AppMode = 'manned' | 'drone';

interface AppModeStore {
  mode: AppMode;
  initialized: boolean;
  hasChosen: boolean;
  setMode: (mode: AppMode) => Promise<void>;
  loadMode: () => Promise<void>;
}

export const useAppModeStore = create<AppModeStore>((set) => ({
  mode: 'manned',
  initialized: false,
  hasChosen: false,

  setMode: async (mode: AppMode) => {
    set({ mode, hasChosen: true });
    await setSetting('app_mode', mode);
    await setSetting('app_mode_chosen', '1');
    await useThemeStore.getState().applyForMode(mode);
  },

  loadMode: async () => {
    const saved = await getSetting('app_mode');
    const chosen = await getSetting('app_mode_chosen');
    if (saved === 'manned' || saved === 'drone') {
      set({ mode: saved, hasChosen: chosen === '1', initialized: true });
    } else {
      // Befintliga installer (uppgraderar) defaultar till manned utan splash
      // Ny install (ingen flight-data) triggar splash
      const db = await getDatabase();
      const flightCount = await db.getFirstAsync<{ c: number }>(
        'SELECT COUNT(*) as c FROM flights'
      );
      const hasExisting = (flightCount?.c ?? 0) > 0;
      set({
        mode: 'manned',
        hasChosen: hasExisting,
        initialized: true,
      });
      if (hasExisting) {
        await setSetting('app_mode', 'manned');
        await setSetting('app_mode_chosen', '1');
        await setSetting('manned_onboarded', '1');
        await setSetting('manned_preview_done', '1');
      }
    }
  },
}));
