// Drönarläge — färggrund. SAMMA navy-bas som pilot-manned (så det läser som EN
// app) + en trådbar ACCENT som är användarval (cyan default). Navy-tokens speglar
// NavyColors i constants/colors.ts; accenten hålls separat i droneAccentStore.

export const DR = {
  background: '#0A1628',  // navy — identisk med manned
  bgDeep:    '#06101E',   // kart-/scrim-bakgrund
  surface:   '#0F1E3A',   // kort, header-bar
  surface2:  '#132845',   // bok-omslag, upphöjt
  elevated:  '#16314E',   // inre brickor, ikon-chips
  border:    '#1A3A5A',
  borderSoft:'#142B45',
  separator: '#122030',

  text:      '#FFFFFF',
  text2:     '#A8BFD6',
  text3:     '#7FA8C8',
  muted:     '#5A7FA0',
  faint:     '#3A5A7A',

  success:   '#3FB950',
  warning:   '#FFC857',
  danger:    '#FF6B5B',
  good:      '#00E8A0',

  inkOnAccent: '#0A1628', // text/ikon på accent-fyllning (FAB, save-knapp)
} as const;

export type DroneAccentKey = 'cyan' | 'amber' | 'violet' | 'lime';

export const DRONE_ACCENTS: Record<DroneAccentKey, string> = {
  cyan:   '#22D3EE',
  amber:  '#FF8C42',
  violet: '#A855F7',
  lime:   '#7BE25B',
};

export const DRONE_ACCENT_ORDER: DroneAccentKey[] = ['cyan', 'amber', 'violet', 'lime'];
export const DEFAULT_DRONE_ACCENT: DroneAccentKey = 'cyan';

// hex (#RRGGBB) → rgba med alpha. För accentens soft/line-toner.
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export const accentSoft = (hex: string) => withAlpha(hex, 0.14); // mjuk fyllning
export const accentLine = (hex: string) => withAlpha(hex, 0.42); // kontur
