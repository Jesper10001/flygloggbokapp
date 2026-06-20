// Insights-temat — läser appens aktiva tema via Colors-proxyn (följer navy/bright)
// och fyller i de tokens designen behöver men som saknas i paletten (purple, en
// djup diagram-bakgrund). Allt övrigt mappas mot befintliga Colors så Insights
// adapterar till temat. Subscribar på themeStore → re-render vid temabyte.

import { useThemeStore } from '../../store/themeStore';
import { Colors } from '../../constants/colors';

export interface InsightsTheme {
  bg: string; deep: string; surface: string; card: string; elevated: string;
  border: string; separator: string;
  primary: string; gold: string; silver: string; purple: string;
  success: string; warning: string; danger: string;
  text: string; text2: string; text3: string; muted: string; faint: string;
}

export function useInsightsTheme(): InsightsTheme {
  const theme = useThemeStore((s) => s.theme);
  const bright = theme === 'bright';
  return {
    bg: Colors.background,
    deep: bright ? '#EFE7D2' : '#06101E',     // diagram-/scrim-bakgrund
    surface: Colors.surface,
    card: Colors.card,
    elevated: Colors.elevated,
    border: Colors.border,
    separator: Colors.separator,
    primary: Colors.primary,
    gold: Colors.gold,
    silver: Colors.silver,
    purple: bright ? '#7C3AED' : '#A855F7',   // all-time-rekord (saknas i paletten)
    success: Colors.success,
    warning: Colors.warning,
    danger: Colors.danger,
    text: Colors.textPrimary,
    text2: Colors.textSecondary,
    text3: Colors.textSecondary,
    muted: Colors.textMuted,
    faint: Colors.textMuted,
  };
}
