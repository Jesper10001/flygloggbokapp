// LED-display: lysande digital avläsning för tider/total (7-seg) och ICAO (14-seg).
// "Ghost-8" bakgrund (svaga hela siffror bakom) ger den autentiska segment-känslan
// när DSEG7 väl är buntad; med mono-fallback blir den bara en svag skugga.
import { View, Text } from 'react-native';
import type { TextStyle } from 'react-native';
import { Colors } from '../../constants/colors';
import { FONT_LED7, FONT_LED14, ledGlow } from './tokens';

export function LedDisplay({
  value, size = 30, variant = 'seg7', color, glow = true, placeholder = '--:--',
}: {
  value: string;
  size?: number;
  variant?: 'seg7' | 'seg14';
  color?: string;
  glow?: boolean;
  placeholder?: string;
}) {
  const font = variant === 'seg14' ? FONT_LED14 : FONT_LED7;
  const c = color || Colors.textPrimary;
  const shown = value && value.length ? value : placeholder;
  // Ghost-8: bakomliggande "alla segment tända" (bara siffror; behåll separatorer).
  const ghost = variant === 'seg7' ? shown.replace(/\d/g, '8') : '';
  const base: TextStyle = {
    fontFamily: font, fontSize: size, fontWeight: '700',
    letterSpacing: variant === 'seg14' ? 2 : 1, color: c,
  };
  return (
    <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
      {ghost ? (
        <Text style={[base, { position: 'absolute', left: 0, top: 0, opacity: 0.08 }]} numberOfLines={1}>{ghost}</Text>
      ) : null}
      <Text style={[base, glow ? ledGlow(c) : null]} numberOfLines={1}>{shown}</Text>
    </View>
  );
}
