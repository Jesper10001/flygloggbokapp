// Blades introduction — smal bildtextrad längst ner medan loggningsdemon fyller i formuläret
// (ersätter info-kortet så inget skymmer fälten). Läser bildtext + förlopp ur tourStore.
// Renderas av TourHost (med Skip) och även INUTI de modaler demon öppnar (sökrutan, Sun route),
// eftersom native-modaler ligger ovanpå rundturens root-överlägg. still = ingen egen intoning
// (modalen tonar redan in → raden ligger exakt över TourHosts rad utan att "hoppa").

import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTourStore } from '../store/tourStore';

export function TourCaptionBar({ onSkip, still = false }: { onSkip?: () => void; still?: boolean }) {
  const insets = useSafeAreaInsets();
  const caption = useTourStore((s) => s.caption);
  const progress = useTourStore((s) => s.demoProgress);
  const done = useTourStore((s) => s.logDemoDoneAt > 0);
  // Pulserande punkt = "pågår"; blir en bock när flygningen är sparad.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(
      withTiming(0.35, { duration: 650, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
    ), -1, false);
  }, [pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const fill = useSharedValue(progress);
  useEffect(() => { fill.value = withTiming(progress, { duration: 420, easing: Easing.out(Easing.cubic) }); }, [progress, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 100)}%` }));

  return (
    <Animated.View entering={still ? undefined : FadeInDown.duration(320)} pointerEvents={onSkip ? 'box-none' : 'none'}
      style={[styles.shadow, { bottom: Math.max(insets.bottom, 10) + 10 }]}>
      <View style={styles.clip}>
        <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
        <View style={styles.row}>
          {done
            ? <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
            : <Animated.View style={[styles.dot, dotStyle]} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>{done ? 'SAVED' : 'LOGGING AN EXAMPLE FLIGHT'}</Text>
            <Animated.Text key={caption ?? '-'} entering={FadeIn.duration(240)} style={styles.text} numberOfLines={2}>
              {caption ?? 'Preparing an example flight…'}
            </Animated.Text>
          </View>
          {onSkip ? <TouchableOpacity onPress={onSkip} hitSlop={10}><Text style={styles.skip}>Skip</Text></TouchableOpacity> : null}
        </View>
        <View style={styles.track}><Animated.View style={[styles.fill, fillStyle]} /></View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute', left: 14, right: 14,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 14,
  },
  clip: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.primary + '4D' },
  tint: { backgroundColor: 'rgba(10,22,40,0.52)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary, marginHorizontal: 4 },
  eyebrow: { color: Colors.primary, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 2 },
  text: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', lineHeight: 18 },
  skip: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  track: { height: 2.5, backgroundColor: '#FFFFFF14' },
  fill: { height: '100%', backgroundColor: Colors.primary },
});
