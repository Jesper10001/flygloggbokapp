import { useThemeStore } from '../store/themeStore';

const NavyColors = {
  // Bakgrunder
  background: '#0A1628',
  surface: '#0F1E3A',
  card: '#0F1E3A',
  cardBorder: '#1A3A5A',
  elevated: '#152338',

  // Primär cyan-accent
  primary: '#00C8E8',
  primaryLight: '#33D4ED',
  primaryDark: '#00A8C8',

  accent: '#00C8E8',
  accentLight: '#33D4ED',

  // Status
  success: '#00E8A0',
  warning: '#FFB830',
  warningLight: '#FFD080',
  danger: '#FF4D6A',
  dangerLight: '#FF8099',
  info: '#00C8E8',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#7FA8C8',
  textMuted: '#3A5A7A',
  textInverse: '#0A1628',

  // Gräns / Separator
  border: '#1A3A5A',
  separator: '#122030',

  // Premium / Gold
  gold: '#FFB830',
  goldLight: '#FFD080',

  // Tab-ikoner
  tabIconDefault: '#3A5A7A',
  tabIconActive: '#00C8E8',
};

const BrightColors = {
  // Bakgrunder — varm off-white med lätt slate-ton för mjukt intryck
  background: '#F6F7F9',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#E2E8F0',
  elevated: '#F1F4F8',

  // Primär — lugnare indigo-blå som harmoniserar utan att skära
  primary: '#2563EB',
  primaryLight: '#3B82F6',
  primaryDark: '#1D4ED8',

  accent: '#2563EB',
  accentLight: '#3B82F6',

  // Status — dämpade men tydliga
  success: '#059669',
  warning: '#D97706',
  warningLight: '#F59E0B',
  danger: '#DC2626',
  dangerLight: '#F87171',
  info: '#2563EB',

  // Text — slate-skala för neutral läsbarhet
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Gräns / Separator — mjuka avgränsningar
  border: '#E2E8F0',
  separator: '#EEF1F5',

  // Premium / Gold — varm amber
  gold: '#B45309',
  goldLight: '#D97706',

  // Tab-ikoner
  tabIconDefault: '#94A3B8',
  tabIconActive: '#2563EB',
};

export type ColorPalette = typeof NavyColors;

// Proxy som läser från themeStore synkront – fungerar både i och utanför React-komponenter
export const Colors = new Proxy({} as ColorPalette, {
  get(_, key: string) {
    const theme = useThemeStore.getState().theme;
    const palette = theme === 'bright' ? BrightColors : NavyColors;
    return palette[key as keyof ColorPalette];
  },
}) as ColorPalette;

export { NavyColors, BrightColors };
