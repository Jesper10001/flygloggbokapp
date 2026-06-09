// Wrapped foundation — tokens, motion hooks and editorial primitives.
// RN port of the design prototype's shared.jsx. The Wrapped story is a bespoke,
// always-navy screen (pilot-manned), so tokens are fixed literals matching the
// design rather than the theme proxy.

import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export const WC = {
  bg: '#0A1628', bgDeep: '#06101E', surface: '#0F1E3A', surface2: '#132845',
  elevated: '#152338', border: '#1A3A5A', separator: '#122030',
  primary: '#00C8E8', gold: '#FFB830', success: '#00E8A0', violet: '#9B8CFF',
  text: '#FFFFFF', text2: '#A8BFD6', text3: '#7FA8C8', muted: '#5A7FA0', faint: '#3A5A7A', ink: '#04101F',
};

export const SERIF = 'Fraunces';
export const MONO = 'JetBrainsMono';

// Reduced-motion flag — set once by the engine; hooks honor it (instant state).
let REDUCED = false;
export function setWrappedReduced(v: boolean) { REDUCED = v; }

// Space-grouped integer (EU look) without relying on Intl (Hermes-safe).
export function fmtInt(n: number): string {
  return Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// True a beat after `active` flips true → drives entrance transitions.
export function useReveal(active: boolean, delay = 0): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) { setOn(false); return; }
    if (REDUCED) { setOn(true); return; }
    const t = setTimeout(() => setOn(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);
  return on;
}

// Count up to `target` whenever `active` becomes true.
export function useCountUp(target: number, active: boolean, opts: { dur?: number; delay?: number } = {}): number {
  const { dur = 1300, delay = 250 } = opts;
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) { setV(0); return; }
    if (REDUCED) { setV(target); return; }
    let raf = 0;
    const t0 = Date.now() + delay;
    const tick = () => {
      const p = Math.min(1, Math.max(0, (Date.now() - t0) / dur));
      const e = 1 - Math.pow(1 - p, 3);
      setV(target * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setV(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, dur, delay]);
  return v;
}

// Entrance wrapper — fades + lifts children when `show` is true.
export function Rise({ show, delay = 0, y = 16, style, children }: {
  show: boolean; delay?: number; y?: number; style?: ViewStyle | ViewStyle[]; children: React.ReactNode;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (REDUCED) { v.setValue(show ? 1 : 0); return; }
    Animated.timing(v, {
      toValue: show ? 1 : 0, duration: 700, delay: show ? delay : 0,
      easing: Easing.bezier(0.2, 0.7, 0.2, 1), useNativeDriver: true,
    }).start();
  }, [show, delay, v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [y, 0] });
  return <Animated.View style={[style as any, { opacity: v, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

// ── Primitives ───────────────────────────────────────────────────────────────

export function Eyebrow({ accent, children, show = true, delay = 0 }: {
  accent: string; children: React.ReactNode; show?: boolean; delay?: number;
}) {
  return (
    <Rise show={show} delay={delay}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 22, height: 1, backgroundColor: accent, opacity: 0.65 }} />
        <Text style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, letterSpacing: 0.1, color: accent }}>
          {children}
        </Text>
      </View>
    </Rise>
  );
}

export function HeroNum({ value, unit, accent }: { value: string; unit?: string; accent: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 9 }}>
      <Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: 92, lineHeight: 92, letterSpacing: -3, color: WC.text, fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      {unit ? (
        <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 16, color: accent, letterSpacing: 2, marginBottom: 8 }}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

export function ChapterTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: SERIF, fontWeight: '400', fontSize: 38, lineHeight: 40, letterSpacing: -0.6, color: WC.text }}>
      {children}
    </Text>
  );
}

export function ChapterSub({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 16, lineHeight: 24, color: WC.text2, maxWidth: 330 }}>{children}</Text>
  );
}

export function StatTrio({ items, accent, show, delay = 0 }: {
  items: { value: string; label: string }[]; accent: string; show: boolean; delay?: number;
}) {
  return (
    <Rise show={show} delay={delay} style={{ alignSelf: 'stretch' }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        {items.map((it, i) => (
          <View key={i} style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 18, color: i === 0 ? accent : WC.text, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
              {it.value}
            </Text>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 9, letterSpacing: 1.4, color: WC.muted, textTransform: 'uppercase' }}>
              {it.label}
            </Text>
          </View>
        ))}
      </View>
    </Rise>
  );
}

// Subtle radial-ish accent wash over the navy background (editorial).
export function ChapterBG({ accent }: { accent: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: WC.bg }]} />
      <LinearGradient
        colors={[accent + '22', accent + '00']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
