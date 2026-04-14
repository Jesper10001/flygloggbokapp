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
  // Bakgrunder
  background: '#EEF3F8',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#C8D8E8',
  elevated: '#E2ECF5',

  // Primär cyan-accent (mörkare för läsbarhet på vitt)
  primary: '#0099BB',
  primaryLight: '#00C8E8',
  primaryDark: '#007799',

  accent: '#0099BB',
  accentLight: '#00C8E8',

  // Status
  success: '#00A870',
  warning: '#D48A00',
  warningLight: '#F5C842',
  danger: '#D93050',
  dangerLight: '#F07090',
  info: '#0099BB',

  // Text
  textPrimary: '#0A1628',
  textSecondary: '#2A5070',
  textMuted: '#7A9AB8',
  textInverse: '#FFFFFF',

  // Gräns / Separator
  border: '#C0D0E0',
  separator: '#D8E8F0',

  // Premium / Gold
  gold: '#C8860A',
  goldLight: '#E8A820',

  // Tab-ikoner
  tabIconDefault: '#7A9AB8',
  tabIconActive: '#0099BB',
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
