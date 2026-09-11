// Dubbel-handtags range-slider: min–max på EN bar (redigeras från både vänster och höger). JS-only
// (reanimated + gesture-handler, som MaxAltBar) → ingen native-modul. Handtagen kan inte passera
// varandra (minsta glapp = step). Live-drag på UI-tråden; commit vid släpp.
import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors } from '../constants/colors';

const HANDLE = 22;
const TRACK_H = 4;

export function RangeBar({ min, max, low, high, step, onChange, onGrab, onRelease, label, unit, format }: {
  min: number; max: number; low: number; high: number; step: number;
  onChange: (low: number, high: number) => void;
  onGrab?: () => void; onRelease?: () => void;
  label: string; unit: string; format?: (v: number) => string;
}) {
  const RANGE = Math.max(1, max - min);
  const clampV = (v: number) => Math.max(min, Math.min(max, v));
  const width = useSharedValue(0);
  const lo = useSharedValue(clampV(low));
  const hi = useSharedValue(clampV(high));
  const startLo = useSharedValue(0);
  const startHi = useSharedValue(0);
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (!dragging.value) { lo.value = clampV(low); hi.value = clampV(high); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [low, high, min, max]);

  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const snap = (v: number) => Math.round(v / step) * step;
  const shownLo = fmt(snap(clampV(low)));
  const shownHi = fmt(snap(clampV(high)));

  const commit = () => onChange(snap(lo.value), snap(hi.value));

  const mkPan = (which: 'lo' | 'hi') => Gesture.Pan()
    .onStart(() => { 'worklet'; dragging.value = true; startLo.value = lo.value; startHi.value = hi.value; if (onGrab) runOnJS(onGrab)(); })
    .onUpdate((e) => {
      'worklet';
      const delta = (e.translationX / (width.value || 1)) * RANGE;
      if (which === 'lo') lo.value = Math.max(min, Math.min(hi.value - step, startLo.value + delta));
      else hi.value = Math.min(max, Math.max(lo.value + step, startHi.value + delta));
    })
    .onEnd(() => { 'worklet'; runOnJS(commit)(); })
    .onFinalize(() => { 'worklet'; if (dragging.value) { dragging.value = false; if (onRelease) runOnJS(onRelease)(); } });

  const fillStyle = useAnimatedStyle(() => ({
    left: `${((lo.value - min) / RANGE) * 100}%`,
    width: `${((hi.value - lo.value) / RANGE) * 100}%`,
  }));
  const loStyle = useAnimatedStyle(() => ({ left: Math.max(0, ((lo.value - min) / RANGE) * width.value - HANDLE / 2) }));
  const hiStyle = useAnimatedStyle(() => ({ left: Math.min((width.value || HANDLE) - HANDLE, ((hi.value - min) / RANGE) * width.value - HANDLE / 2) }));

  return (
    <View style={{ paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{shownLo}–{shownHi}<Text style={styles.unit}> {unit}</Text></Text>
      </View>
      <View style={styles.trackWrap} onLayout={(e) => { width.value = e.nativeEvent.layout.width; }}>
        <View style={styles.trackBg} />
        <Animated.View style={[styles.fill, fillStyle]} />
        <GestureDetector gesture={mkPan('lo')}>
          <Animated.View hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} style={[styles.handle, loStyle]} />
        </GestureDetector>
        <GestureDetector gesture={mkPan('hi')}>
          <Animated.View hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} style={[styles.handle, hiStyle]} />
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  value: { color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit: { color: Colors.textMuted, fontSize: 9.5, fontWeight: '700' },
  trackWrap: { height: HANDLE, justifyContent: 'center', position: 'relative' },
  trackBg: { position: 'absolute', left: 0, right: 0, height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { position: 'absolute', height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: Colors.primary },
  handle: { position: 'absolute', top: 0, width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: Colors.primary },
});
