// Log Flight-redesign — lokala tokens. Allt utom LED-typsnitten läses från Colors
// (tema-medvetet). Speglar mönstret i components/logbook-page/tokens.ts.
import type { TextStyle } from 'react-native';

// LED-typsnitt. Byt FONT_LED7 → 'DSEG7Classic' och FONT_LED14 → 'ChakraPetch' när
// .ttf:erna lagts i assets/fonts/ och registrerats i app/_layout.tsx (Font.loadAsync).
// Tills dess faller de tillbaka på appens mono så allt fungerar direkt.
export const FONT_LED7 = 'DSEG7Classic';   // 7-segment: dep/arr-tider + total
export const FONT_LED14 = 'ChakraPetch';   // 14-segment: ICAO-koder

// Vit-LED glow (tema-oberoende). Lägg på LED-värden för det lysande utseendet.
export function ledGlow(color: string, radius = 6): TextStyle {
  return { textShadowColor: color, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: radius };
}
