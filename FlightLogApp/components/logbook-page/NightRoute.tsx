// DEP → ARR där den avslutande natt-andelen färgas platina.
// Per-tecken solid färgning (robust i RN; "% night"-captionen är auktoritativ).
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT_SERIF, NIGHT_FILL } from './tokens';

export function NightRoute({ dep, arr, nightFrac, size = 30, accent, dayColor = '#FFFFFF' }: {
  dep: string; arr: string; nightFrac: number; size?: number; accent: string; dayColor?: string;
}) {
  const total = dep.length + arr.length;
  const nightStart = total * (1 - Math.max(0, Math.min(1, nightFrac)));
  const renderWord = (word: string, offset: number) =>
    [...word].map((ch, i) => {
      const isNight = offset + i >= nightStart - 0.0001;
      return (
        <Text
          key={`${offset}-${i}`}
          style={{
            fontFamily: FONT_SERIF, fontSize: size, fontWeight: '600',
            color: isNight ? NIGHT_FILL : dayColor,
            ...(isNight ? { textShadowColor: NIGHT_FILL + '66', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 } : null),
          }}
        >
          {ch}
        </Text>
      );
    });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row' }}>{renderWord(dep, 0)}</View>
      <Ionicons name="arrow-forward" size={size * 0.6} color={accent} />
      <View style={{ flexDirection: 'row' }}>{renderWord(arr, dep.length)}</View>
    </View>
  );
}
