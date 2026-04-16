import { useThemeStore } from '../store/themeStore';
import { useAppModeStore } from '../store/appModeStore';

const NavyColors = {
  background: '#0A1628',
  surface: '#0F1E3A',
  card: '#0F1E3A',
  cardBorder: '#1A3A5A',
  elevated: '#152338',

  primary: '#00C8E8',
  primaryLight: '#33D4ED',
  primaryDark: '#00A8C8',

  accent: '#00C8E8',
  accentLight: '#33D4ED',

  success: '#00E8A0',
  warning: '#FFB830',
  warningLight: '#FFD080',
  danger: '#FF4D6A',
  dangerLight: '#FF8099',
  info: '#00C8E8',

  textPrimary: '#FFFFFF',
  textSecondary: '#7FA8C8',
  textMuted: '#3A5A7A',
  textInverse: '#0A1628',

  border: '#1A3A5A',
  separator: '#122030',

  gold: '#FFB830',
  goldLight: '#FFD080',

  tabIconDefault: '#3A5A7A',
  tabIconActive: '#00C8E8',
};

const BrightColors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#E2E8F0',
  elevated: '#F1F4F8',

  primary: '#2563EB',
  primaryLight: '#3B82F6',
  primaryDark: '#1D4ED8',

  accent: '#2563EB',
  accentLight: '#3B82F6',

  success: '#059669',
  warning: '#D97706',
  warningLight: '#F59E0B',
  danger: '#DC2626',
  dangerLight: '#F87171',
  info: '#2563EB',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  border: '#E2E8F0',
  separator: '#EEF1F5',

  gold: '#B45309',
  goldLight: '#D97706',

  tabIconDefault: '#94A3B8',
  tabIconActive: '#2563EB',
};

// ── DRÖNAR-PALETTER ──────────────────────────────────────────────────────────

// A — Industrial / Tool-of-trade, amber primär för solljus-synlighet
const DroneIndustrialColors = {
  background: '#14171D',
  surface: '#1A1D23',
  card: '#1A1D23',
  cardBorder: '#2A2E36',
  elevated: '#22262D',

  primary: '#FF8C42',
  primaryLight: '#FFA870',
  primaryDark: '#E07025',

  accent: '#FFC857',
  accentLight: '#FFE09A',

  success: '#3FB950',
  warning: '#FFC857',
  warningLight: '#FFE09A',
  danger: '#F85149',
  dangerLight: '#FF8F87',
  info: '#58A6FF',

  textPrimary: '#F3F4F6',
  textSecondary: '#A0A7B0',
  textMuted: '#5A6270',
  textInverse: '#14171D',

  border: '#2A2E36',
  separator: '#1E2129',

  gold: '#FFC857',
  goldLight: '#FFE09A',

  tabIconDefault: '#5A6270',
  tabIconActive: '#FF8C42',
};

// B — Futuristic neon, violet primär + cyan accent
const DroneNeonColors = {
  background: '#0A0A12',
  surface: '#12121F',
  card: '#12121F',
  cardBorder: '#2A1E4A',
  elevated: '#181828',

  primary: '#A855F7',
  primaryLight: '#C084FC',
  primaryDark: '#7E22CE',

  accent: '#22D3EE',
  accentLight: '#67E8F9',

  success: '#34D399',
  warning: '#FBBF24',
  warningLight: '#FCD34D',
  danger: '#F43F5E',
  dangerLight: '#FB7185',
  info: '#22D3EE',

  textPrimary: '#F5F3FF',
  textSecondary: '#A5A0C7',
  textMuted: '#4C4A6A',
  textInverse: '#0A0A12',

  border: '#2A1E4A',
  separator: '#1A1828',

  gold: '#FBBF24',
  goldLight: '#FCD34D',

  tabIconDefault: '#4C4A6A',
  tabIconActive: '#A855F7',
};

export type ColorPalette = typeof NavyColors;

function currentPalette(): ColorPalette {
  const mode = useAppModeStore.getState().mode;
  const theme = useThemeStore.getState().theme;
  if (mode === 'drone') {
    switch (theme) {
      case 'drone-industrial': return DroneIndustrialColors;
      case 'drone-neon':       return DroneNeonColors;
      default:                 return DroneIndustrialColors;
    }
  }
  return theme === 'bright' ? BrightColors : NavyColors;
}

export const Colors = new Proxy({} as ColorPalette, {
  get(_, key: string) {
    return currentPalette()[key as keyof ColorPalette];
  },
}) as ColorPalette;

export { NavyColors, BrightColors, DroneIndustrialColors, DroneNeonColors };
