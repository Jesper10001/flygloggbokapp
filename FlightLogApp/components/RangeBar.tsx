// Dubbel-handtags range-slider: min–max på EN bar (redigeras från både vänster och höger). JS-only
// (reanimated + gesture-handler, som MaxAltBar) → ingen native-modul. Handtagen kan inte passera
// varandra (minsta glapp = step). Live-drag på UI-tråden; commit vid släpp.
// Valfri `dist` (histogram över hela intervallet) ritas som en mjuk fördelningskurva ovanför baren;
// delarna UTANFÖR valt intervall dimmas LIVE medan man drar → man ser hur många flygplatser man sållar bort.
import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '../constants/colors';

const HANDLE = 22;
const TRACK_H = 4;
const CURVE_H = 38;

// Bygger en mjuk area-kurva (Catmull-Rom → cubic bezier) i viewBox 0..100 × 0..CURVE_H från histogrammet.
// Lätt utjämning (glidande medel ±2) så råa staplar blir en mjuk fördelning.
function buildAreaPath(dist: number[]): string {
  const n = dist.length;
  if (n < 2) return '';
  const sm = dist.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) { s += dist[j]; c++; } }
    return s / c;
  });
  const maxC = Math.max(1, ...sm);
  const top = 3, usable = CURVE_H - top - 1;
  const pts = sm.map((v, i) => ({ x: (i / (n - 1)) * 100, y: top + (1 - v / maxC) * usable }));
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  d += ` L 100 ${CURVE_H} L 0 ${CURVE_H} Z`;
  return d;
}

export function RangeBar({ min, max, low, high, step, onChange, onGrab, onRelease, label, unit, format, dist }: {
  min: number; max: number; low: number; high: number; step: number;
  onChange: (low: number, high: number) => void;
  onGrab?: () => void; onRelease?: () => void;
  label: string; unit: string; format?: (v: number) => string;
  dist?: number[];
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
  // Dimma kurvan UTANFÖR [lo, hi] live (pixlar via width → i linje med handtagen).
  const leftDimStyle = useAnimatedStyle(() => ({ width: Math.max(0, ((lo.value - min) / RANGE) * width.value) }));
  const rightDimStyle = useAnimatedStyle(() => { const x = ((hi.value - min) / RANGE) * width.value; return { left: x, width: Math.max(0, width.value - x) }; });

  const hasDist = !!dist && dist.length > 1;

  return (
    <View style={{ paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: hasDist ? 4 : 10 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{shownLo}–{shownHi}<Text style={styles.unit}> {unit}</Text></Text>
      </View>
      {hasDist && (
        <View style={styles.curveWrap}>
          <Svg width="100%" height={CURVE_H} viewBox={`0 0 100 ${CURVE_H}`} preserveAspectRatio="none">
            <Path d={buildAreaPath(dist!)} fill={Colors.primary + '2E'} stroke={Colors.primary} strokeWidth={1.1} />
          </Svg>
          {/* Live-dimning av bortsållade delar (vänster om lo, höger om hi). */}
          <Animated.View pointerEvents="none" style={[styles.dim, { left: 0 }, leftDimStyle]} />
          <Animated.View pointerEvents="none" style={[styles.dim, rightDimStyle]} />
        </View>
      )}
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
  curveWrap: { height: CURVE_H, position: 'relative', marginBottom: 2 },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(15,22,38,0.72)' },
  trackWrap: { height: HANDLE, justifyContent: 'center', position: 'relative' },
  trackBg: { position: 'absolute', left: 0, right: 0, height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { position: 'absolute', height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: Colors.primary },
  handle: { position: 'absolute', top: 0, width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: Colors.primary },
});
