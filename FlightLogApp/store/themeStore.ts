import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export type Theme =
  | 'navy'
  | 'bright'
  | 'drone-industrial'
  | 'drone-neon';

const MANNED_THEMES: Theme[] = ['navy', 'bright'];
const DRONE_THEMES: Theme[] = ['drone-industrial', 'drone-neon'];

interface ThemeStore {
  theme: Theme;
  mannedTheme: Theme;
  droneTheme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  loadTheme: () => Promise<void>;
  applyForMode: (mode: 'manned' | 'drone') => Promise<void>;
}

function isValidTheme(v: any): v is Theme {
  return ['navy', 'bright', 'drone-industrial', 'drone-neon'].includes(v);
}

// Backwards-compat: migrera gamla dröntema → 'drone-industrial' (Matt)
function migrateTheme(v: any): Theme | null {
  if (v === 'drone-dji' || v === 'drone-forest') return 'drone-industrial';
  if (isValidTheme(v)) return v as Theme;
  return null;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: 'navy',
  mannedTheme: 'navy',
  droneTheme: 'drone-industrial',

  setTheme: async (theme: Theme) => {
    set({ theme });
    await setSetting('app_theme', theme);
    if (MANNED_THEMES.includes(theme)) {
      set({ mannedTheme: theme });
      await setSetting('app_theme_manned', theme);
    } else {
      set({ droneTheme: theme });
      await setSetting('app_theme_drone', theme);
    }
  },

  loadTheme: async () => {
    const savedManned = await getSetting('app_theme_manned');
    const savedDrone = await getSetting('app_theme_drone');
    const legacy = await getSetting('app_theme');
    const mannedMig = migrateTheme(savedManned);
    const mannedLegacy = migrateTheme(legacy);
    const manned: Theme = (mannedMig && MANNED_THEMES.includes(mannedMig))
      ? mannedMig
      : (mannedLegacy && MANNED_THEMES.includes(mannedLegacy) ? mannedLegacy : 'navy');
    const droneMig = migrateTheme(savedDrone);
    const drone: Theme = (droneMig && DRONE_THEMES.includes(droneMig)) ? droneMig : 'drone-industrial';
    set({ mannedTheme: manned, droneTheme: drone, theme: manned });
  },

  applyForMode: async (mode) => {
    const { mannedTheme, droneTheme } = get();
    const next = mode === 'drone' ? droneTheme : mannedTheme;
    set({ theme: next });
    await setSetting('app_theme', next);
  },
}));
