import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { Eyebrow } from '../milestones/MilestoneUI';

export const SERIF = 'Fraunces';
export const MONO = 'JetBrainsMono';

// Navy-bas med accent-stänk: varje slide får en egen accent ur denna cykel.
export function wrappedAccents(): string[] {
  return [Colors.primary, Colors.gold, Colors.success, Colors.warning, Colors.primaryLight, Colors.info];
}

// ── Slide-ram: eyebrow högst upp, innehåll vertikalt centrerat ───────────────
export function SlideShell({ accent, eyebrow, children }: { accent: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <View style={k.shell}>
      <Eyebrow accent={accent}>{eyebrow}</Eyebrow>
      <View style={{ gap: 18, alignSelf: 'stretch' }}>{children}</View>
    </View>
  );
}

// Stående slide: eyebrow högst upp, text + visualisering staplade och
// vertikalt centrerade.
export function SlideBody({ accent, eyebrow, visual, children }: {
  accent: string; eyebrow: string; visual?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <View style={k.shell}>
      <Eyebrow accent={accent}>{eyebrow}</Eyebrow>
      <View style={{ gap: 18, alignSelf: 'stretch' }}>{children}{visual}</View>
    </View>
  );
}

export function SlideTitle({ children }: { children: React.ReactNode }) {
  return <Text style={k.title}>{children}</Text>;
}

export function SlideSub({ children }: { children: React.ReactNode }) {
  return <Text style={k.sub}>{children}</Text>;
}

// ── Stort serif-hjältetal ────────────────────────────────────────────────────
export function Hero({ value, unit, label, accent }: { value: string; unit?: string; label: string; accent: string }) {
  return (
    <View style={{ alignSelf: 'stretch' }}>
      <Text style={k.heroValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={[k.heroUnit, { color: accent }]}> {unit}</Text> : null}
      </Text>
      <Text style={k.heroLabel}>{label}</Text>
    </View>
  );
}

// ── Rad med små stat-block ───────────────────────────────────────────────────
export function StatRow({ items, accent }: { items: { label: string; value: string }[]; accent: string }) {
  return (
    <View style={k.statRow}>
      {items.map((it, i) => (
        <View key={i} style={k.statItem}>
          <Text style={[k.statValue, { color: i === 0 ? accent : Colors.textPrimary }]} numberOfLines={1}>{it.value}</Text>
          <Text style={k.statLabel}>{it.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Currency/stress-ring (duplicerad från dashboard, prop-driven) ────────────
export type StressZone = 'low' | 'light' | 'normal' | 'elevated' | 'high' | 'critical';

export function computeStressZone(recent14: number, yearAvg14: number): { index: number; zone: StressZone; advice: string } {
  const ratio = yearAvg14 > 0 ? recent14 / yearAvg14 : recent14 > 0 ? 2 : 0;
  const index = Math.round(ratio * 100);
  const zone: StressZone =
    index <= 29 ? 'low' : index <= 69 ? 'light' : index <= 130 ? 'normal'
    : index <= 169 ? 'elevated' : index <= 200 ? 'high' : 'critical';
  const advice: Record<StressZone, string> = {
    low: 'Low activity. A refresher helps when returning to ops.',
    light: 'Below average. Ideal time to sharpen skills.',
    normal: 'Balanced workload — currency well maintained.',
    elevated: 'Above average. Ensure adequate rest between flights.',
    high: 'High workload. Monitor fatigue and plan recovery.',
    critical: 'Very high workload. Consider easing the tempo.',
  };
  return { index, zone, advice: advice[zone] };
}

function zoneColor(zone: StressZone): string {
  if (zone === 'low') return Colors.textMuted;
  if (zone === 'light') return Colors.primary;
  if (zone === 'normal') return Colors.success;
  if (zone === 'elevated') return Colors.warning;
  return Colors.danger; // high / critical
}

export function WrappedStressRing({ recent14, yearAvg14, size = 168 }: { recent14: number; yearAvg14: number; size?: number }) {
  const { index, zone } = computeStressZone(recent14, yearAvg14);
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const targetPct = Math.min(index, 240) / 240;
  const color = zoneColor(zone);

  const animVal = useRef(new Animated.Value(0)).current;
  const [displayPct, setDisplayPct] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);

  useEffect(() => {
    animVal.setValue(0);
    Animated.timing(animVal, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    const id = animVal.addListener(({ value }) => {
      setDisplayPct(value * targetPct);
      setDisplayIndex(Math.round(value * index));
    });
    return () => animVal.removeListener(id);
  }, [index]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.separator} strokeWidth={9} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={9} fill="none"
          strokeDasharray={`${circ * displayPct} ${circ * (1 - displayPct)}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          rotation={-90} origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={{ fontFamily: SERIF, fontSize: 40, fontWeight: '600', color }}>{displayIndex}%</Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: Colors.textMuted, marginTop: 2 }}>
        {zone.toUpperCase()}
      </Text>
    </View>
  );
}

const k = StyleSheet.create({
  shell: { flex: 1, justifyContent: 'center', alignItems: 'flex-start', gap: 20, alignSelf: 'stretch' },
  title: { fontFamily: SERIF, fontSize: 34, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.6, lineHeight: 40 },
  sub: { fontSize: 15, color: Colors.textSecondary, lineHeight: 21 },

  heroValue: { fontFamily: SERIF, fontSize: 76, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -1.5 },
  heroUnit: { fontFamily: SERIF, fontSize: 30, fontWeight: '600' },
  heroLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1.8, color: Colors.textMuted, textTransform: 'uppercase', marginTop: 4 },

  statRow: { flexDirection: 'row', gap: 14, alignSelf: 'stretch' },
  statItem: { flex: 1, gap: 3 },
  statValue: { fontFamily: MONO, fontSize: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: Colors.textMuted },
});
