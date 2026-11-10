// Blades introduction — smal bildtextrad längst ner medan loggningsexemplet fyller i formuläret
// (ersätter kortet så inget skymmer fälten). Läser bildtext + förlopp ur tourStore. Renderas av TourHost
// med paus och Skip (Skip hoppar bara över exemplet, inte hela rundturen). still = ingen egen intoning.

import { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTourStore } from '../store/tourStore';

export function TourCaptionBar({ onSkip, still = false, eyebrow }: { onSkip?: () => void; still?: boolean; eyebrow?: string }) {
  const insets = useSafeAreaInsets();
  const caption = useTourStore((s) => s.caption);
  const progress = useTourStore((s) => s.demoProgress);
  const done = useTourStore((s) => s.logDemoDoneAt > 0);
  const paused = useTourStore((s) => s.paused);
  const setPaused = useTourStore((s) => s.setPaused);
  // Pulserande punkt = "pågår"; blir en bock när flygningen är sparad.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(
      withTiming(0.35, { duration: 650, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
    ), -1, false);
  }, [pulse]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: paused ? 0.35 : pulse.value }));
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
            <Text style={styles.eyebrow}>{done ? 'SAVED' : paused ? 'PAUSED' : (eyebrow ?? 'LOGGING AN EXAMPLE FLIGHT')}</Text>
            <Animated.Text key={caption ?? '-'} entering={FadeIn.duration(240)} style={styles.text} numberOfLines={2}>
              {caption ?? 'Preparing an example flight…'}
            </Animated.Text>
          </View>
          {onSkip && !done ? (
            <>
              <TouchableOpacity onPress={() => setPaused(!paused)} activeOpacity={0.8} style={styles.pause}
                accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'}>
                <Ionicons name={paused ? 'play' : 'pause'} size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onSkip} style={styles.skipBtn} accessibilityRole="button" accessibilityLabel="Skip the example">
                <Text style={styles.skip}>Skip</Text>
              </TouchableOpacity>
            </>
          ) : null}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingLeft: 14, paddingRight: 8, minHeight: 62 },
  pause: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF29' },
  skipBtn: { height: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary, marginHorizontal: 4 },
  eyebrow: { color: Colors.primary, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 2 },
  text: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', lineHeight: 18 },
  skip: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  track: { height: 2.5, backgroundColor: '#FFFFFF14' },
  fill: { height: '100%', backgroundColor: Colors.primary },
});
