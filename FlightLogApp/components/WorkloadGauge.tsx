// Dashboardens arbetsbelastning (Flight load) — delas av pilot- och drönardashboarden så båda ser likadana ut:
//  - WorkloadBar: stapel i appens cyan som fylls (dämpad → klar) fram till en liten vit prick; en vit markering
//    visar 100 % (= ditt snitt).
//  - LoadRing: öppen 270°-mätare i samma cyan, 100 % rakt upp (samma logik som stapelns mittmarkering),
//    procenten i vitt och zonen som liten text i öppningen.
// Lugnt mot resten av dashboarden: zonfärgen visas bara i rubrikens etikett, ringens zontext och 14D/AVG-värdet.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, AccessibilityInfo } from 'react-native';
import { useIsFocused } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { Colors } from '../constants/colors';
import { stressZone } from '../utils/workload';

export type LoadZone = 'low' | 'light' | 'normal' | 'elevated' | 'high' | 'critical';

const LOW = '#8A97A8'; // ljus skiffer → "låg" syns även på den ljusare bakgrunden (textMuted försvann)
export const LOAD_MAX = 200; // skalans slut (%) — 100 % hamnar mitt på stapeln och rakt upp i ringen

export function loadZoneColor(zone: LoadZone): string {
  if (zone === 'low') return LOW;
  if (zone === 'light') return Colors.primary;
  if (zone === 'normal') return Colors.success;
  if (zone === 'elevated') return Colors.warning;
  return Colors.danger; // high / critical
}

const ACCENT = Colors.primary; // stapel + ring i appens cyan (samma som resten av dashboarden)
const FILL = [ACCENT + '2E', ACCENT + 'E6'] as const; // dämpad → klar fram till pricken

export function ZoneChip({ zone, color }: { zone: LoadZone; color: string }) {
  return (
    <View style={[s.chip, { backgroundColor: color + '1F', borderColor: color + '59' }]}>
      <Text style={[s.chipText, { color }]} maxFontSizeMultiplier={1.2}>{zone.toUpperCase()}</Text>
    </View>
  );
}

/**
 * Stressfactor-knappen (ersätter zonetiketten i WORKLOAD-raden): minigrafen över de senaste två månaderna, utan
 * ram, som ett levande EKG. Bara den streckade linjen (ditt normala, 100 %) syns hela tiden; kurvan ritas fram från vänster till höger med en
 * lysande prick (i zonfärgen för periodens snitt) tills hela grafen är belyst, tonas snabbt ut och börjar om — ett varv var 6:e sekund. Varje bit av linjen har dagens zonfärg.
 * Höjden skalas mellan grafens eget lägsta och högsta värde och
 * exponentiellt, så att låga dagar blir en lugn baslinje och höga dagar spikar (mer som ett EKG). Svepet ritas om bildruta för bildruta i JS (animerade
 * streckmönster i SVG uppdateras inte pålitligt). Går bara när dashboarden syns; stilla med "Reducera rörelse".
 */
const SWEEP_MS = 5500, HOLD_MS = 250, FADE_MS = 250;   // helt belyst var 6:e sekund
const CYCLE_MS = SWEEP_MS + HOLD_MS + FADE_MS;
const EKG_K = 2.4;   // hur kraftigt höga värden förstärks (0 = linjärt)

export function StressFactorChip({ zone, values, onPress }: { zone: LoadZone; values: number[]; onPress: () => void }) {
  const color = loadZoneColor(zone);
  const W = 64, H = 20, PAD = 3;                              // PAD: plats för prickens glöd vid kanterna
  const n = values.length;
  // Skalan rymmer alltid ditt normala (100 %), så att den streckade linjen alltid syns.
  const lo = Math.min(100, n ? Math.min(...values) : 100);
  const hi = Math.max(lo + 20, 100, n ? Math.max(...values) : 0);  // små skillnader förstoras inte till brus
  const yOf = (v: number) => {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const e = (Math.exp(EKG_K * t) - 1) / (Math.exp(EKG_K) - 1);
    return PAD + (H - 2 * PAD) * (1 - e);
  };
  const xs = values.map((_, i) => PAD + (n > 1 ? (i / (n - 1)) * (W - 2 * PAD) : (W - 2 * PAD) / 2));
  const ys = values.map(yOf);
  const cols = values.map((v) => loadZoneColor(stressZone(v)));

  // Bitar efter zon fram till x = upTo (en del av sista linjen om svepet är mitt i den).
  const pieces = (upTo: number) => {
    const out: { d: string; c: string }[] = [];
    for (let i = 1; i < n; i++) {
      if (xs[i - 1] >= upTo) break;
      const f = xs[i] <= upTo ? 1 : (upTo - xs[i - 1]) / (xs[i] - xs[i - 1]);
      const ex = xs[i - 1] + (xs[i] - xs[i - 1]) * f, ey = ys[i - 1] + (ys[i] - ys[i - 1]) * f;
      const last = out[out.length - 1];
      if (last && last.c === cols[i]) last.d += ` L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      else out.push({ c: cols[i], d: `M ${xs[i - 1].toFixed(1)} ${ys[i - 1].toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}` });
    }
    return out;
  };

  // Svepet: tid i cykeln → hur långt pricken kommit och hur synlig den klara kurvan är.
  const focused = useIsFocused();
  const [still, setStill] = useState(false);
  const [ms, setMs] = useState(SWEEP_MS);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {}); }, []);
  useEffect(() => {
    if (!focused || still || n < 2) { setMs(SWEEP_MS); return; }
    const start = Date.now();
    let raf = 0, last = 0;
    const tick = () => {
      const now = Date.now();
      if (now - last >= 24) { last = now; setMs((now - start) % CYCLE_MS); }   // ~40 bilder/s räcker
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focused, still, n]);

  const prog = Math.min(1, ms / SWEEP_MS);
  const lit = ms <= SWEEP_MS + HOLD_MS ? 1 : Math.max(0, 1 - (ms - SWEEP_MS - HOLD_MS) / FADE_MS);
  const headX = PAD + prog * (W - 2 * PAD);
  let headY = ys[0] ?? H / 2;
  for (let i = 1; i < n; i++) {
    if (xs[i] >= headX) { const f = (headX - xs[i - 1]) / Math.max(1e-6, xs[i] - xs[i - 1]); headY = ys[i - 1] + (ys[i] - ys[i - 1]) * f; break; }
  }
  const normalY = yOf(100);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
      accessibilityRole="button" accessibilityLabel={`Stressfactor. Last two months: ${zone}`} style={s.sfChip}>
      <Svg width={W} height={H}>
        <Line x1={PAD} x2={W - PAD} y1={normalY} y2={normalY} stroke="#FFFFFF" strokeOpacity={0.3} strokeWidth={0.8} strokeDasharray="2 2" />
        {/* Den klara kurvan fram till pricken */}
        {lit > 0 && pieces(headX).map((sg, k) => (
          <Path key={`n${k}`} d={sg.d} stroke={sg.c} strokeOpacity={lit} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {n > 1 && lit > 0 && prog < 1 && (
          <>
            <Circle cx={headX} cy={headY} r={4.5} fill={color} opacity={0.22} />
            <Circle cx={headX} cy={headY} r={2} fill={color} />
          </>
        )}
      </Svg>
    </TouchableOpacity>
  );
}

/** Stapeln. Pricken animerar från 0 till värdet varje gång indexet ändras. */
export function WorkloadBar({ index }: { index: number }) {
  const anim = useRef(new Animated.Value(0)).current; // 0–100 % av stapeln
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: Math.min((index / LOAD_MAX) * 100, 100),
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [index, anim]);

  const pos = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <View style={s.track}>
      <Animated.View style={[s.fill, { width: pos }]}>
        <LinearGradient colors={FILL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={s.avgTick} />
      <Animated.View pointerEvents="none" style={[s.knobWrap, { left: pos }]}>
        <View style={s.knobHalo} />
        <View style={s.knob} />
      </Animated.View>
    </View>
  );
}

const A0 = 135;    // start (nere till vänster), grader medurs från kl 3
const SWEEP = 270; // öppning nedtill
const RING_W = 6;  // bågens tjocklek

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(a0));
  const y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Ringen (ren visning). pct = 0–1 av skalan, value = talet som visas. children ritas ovanpå (t.ex. info-knappen). */
export function LoadRing({ value, pct, color, zone, size = 110, children }: {
  value: number; pct: number; color: string; zone: LoadZone; size?: number; children?: ReactNode;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 11;
  const p = Math.max(0, Math.min(1, pct));
  const aValue = A0 + SWEEP * p;
  const knobX = cx + r * Math.cos((aValue * Math.PI) / 180);
  const knobY = cy + r * Math.sin((aValue * Math.PI) / 180);
  const showArc = p > 0.004;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* Cyan som klarnar över ringen (dämpad nere till vänster → klar mot slutet), som stapeln. */}
          <SvgLinearGradient id="loadFill" gradientUnits="userSpaceOnUse" x1={cx - r} y1={0} x2={cx + r} y2={0}>
            <Stop offset={0} stopColor={ACCENT} stopOpacity={0.35} />
            <Stop offset={1} stopColor={ACCENT} stopOpacity={1} />
          </SvgLinearGradient>
          <RadialGradient id="loadDisc" cx="50%" cy="40%" r="60%">
            <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.045} />
            <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={r - 12} fill="url(#loadDisc)" />
        <Path d={arcPath(cx, cy, r, A0, A0 + SWEEP)} stroke="#FFFFFF" strokeOpacity={0.08} strokeWidth={RING_W}
          strokeLinecap="round" fill="none" />
        {showArc && (
          <>
            <Path d={arcPath(cx, cy, r, A0, aValue)} stroke={ACCENT} strokeOpacity={0.08} strokeWidth={RING_W + 5}
              strokeLinecap="round" fill="none" />
            <Path d={arcPath(cx, cy, r, A0, aValue)} stroke="url(#loadFill)" strokeWidth={RING_W}
              strokeLinecap="round" fill="none" />
          </>
        )}
        {/* 100 % (ditt snitt) rakt upp */}
        <Line x1={cx} y1={cy - r - RING_W / 2 - 4} x2={cx} y2={cy - r - RING_W / 2 - 1} stroke="#FFFFFF" strokeOpacity={0.45}
          strokeWidth={1.5} strokeLinecap="round" />
        <Circle cx={knobX} cy={knobY} r={5.5} fill={ACCENT} opacity={0.18} />
        <Circle cx={knobX} cy={knobY} r={3.6} fill="#FFFFFF" stroke={ACCENT} strokeWidth={1.6} />
      </Svg>
      <Text style={[s.value, { fontSize: size > 100 ? 23 : 17 }]} maxFontSizeMultiplier={1.2}>
        {value}<Text style={[s.valuePct, { fontSize: size > 100 ? 13 : 10 }]}>%</Text>
      </Text>
      {/* Zonen som liten text (rubrikraden har redan etiketten) → inte två färgade rutor. */}
      <View style={s.ringChip} pointerEvents="none">
        <Text style={[s.ringZone, { color }]} maxFontSizeMultiplier={1.2}>{zone.toUpperCase()}</Text>
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 0.8 },
  chipText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1, opacity: 0.9 },
  sfChip: { paddingVertical: 1 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 5 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, overflow: 'hidden' },
  avgTick: {
    position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1.5, marginLeft: -0.75,
    borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.45)',
  },
  knobWrap: { position: 'absolute', top: -4.5, width: 15, height: 15, marginLeft: -7.5, alignItems: 'center', justifyContent: 'center' },
  knobHalo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 7.5, backgroundColor: ACCENT, opacity: 0.18 },
  knob: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: ACCENT,
    shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 0 },
  },
  value: { fontWeight: '700', color: '#E6EEF7', fontFamily: 'Menlo', fontVariant: ['tabular-nums'], marginTop: -6 },
  valuePct: { color: Colors.textSecondary, fontFamily: 'Menlo', fontWeight: '700' },
  ringChip: { position: 'absolute', left: 0, right: 0, bottom: 3, alignItems: 'center' },
  ringZone: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1, opacity: 0.85 },
});
