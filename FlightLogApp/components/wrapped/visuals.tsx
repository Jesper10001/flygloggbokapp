// Wrapped data visuals — RN port of the prototype charts.jsx + map.jsx visuals.
// Bars/meters grow from a shared 0→1 factor (useGrow). Globe orbit + currency
// ring use react-native-svg. All gate on `active`.

import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Ellipse, Line, Path, G, Defs, RadialGradient, Stop, ClipPath } from 'react-native-svg';
import { WC, SERIF, MONO, fmtInt, useCountUp, Rise } from './WrappedKit';
import type { WAirport } from './wrappedData';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 0→1 growth factor honoring reduced motion (via useCountUp).
function useGrow(active: boolean, dur = 900, delay = 0): number {
  return useCountUp(1, active, { dur, delay });
}

// ── Monthly hours bars ───────────────────────────────────────────────────────
export function WMonthlyBars({ accent, active, data }: { accent: string; active: boolean; data: { label: string; h: number }[] }) {
  const g = useGrow(active, 900, 100);
  const max = Math.max(...data.map((d) => d.h), 1);
  const best = Math.max(...data.map((d) => d.h), 0);
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 200 }}>
      {data.map((d, i) => {
        const isBest = d.h === best && d.h > 0;
        const pct = (d.h / max) * 100 * g;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: isBest ? accent : WC.muted, opacity: g }}>{d.h}</Text>
            <View style={{ width: '100%', borderRadius: 5, height: `${pct}%` as any, backgroundColor: isBest ? accent : WC.border }} />
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: isBest ? WC.text : WC.faint }}>{d.label[0]}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Role split stacked bar + legend ──────────────────────────────────────────
export function WRoleSplit({ accent, active, roles }: { accent: string; active: boolean; roles: { label: string; h: number }[] }) {
  const g = useGrow(active, 1000);
  const total = roles.reduce((s, r) => s + r.h, 0) || 1;
  const cols = [accent, WC.text3, WC.muted];
  return (
    <View style={{ alignSelf: 'stretch', gap: 16 }}>
      <View style={{ flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: WC.separator }}>
        {roles.map((r, i) => (
          <View key={r.label} style={{ width: `${(r.h / total) * 100 * g}%` as any, backgroundColor: cols[i % cols.length] }} />
        ))}
      </View>
      <View style={{ gap: 10 }}>
        {roles.map((r, i) => (
          <Rise key={r.label} show={active} delay={i * 90 + 200}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: cols[i % cols.length] }} />
              <Text style={{ flex: 1, fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: WC.text2 }}>{r.label}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: i === 0 ? accent : WC.text }}>{fmtInt(r.h)} h</Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, color: WC.muted, width: 38, textAlign: 'right' }}>{Math.round((r.h / total) * 100)}%</Text>
            </View>
          </Rise>
        ))}
      </View>
    </View>
  );
}

// ── Split meter (Day/Night, IFR/VFR) ─────────────────────────────────────────
export function WSplitMeter({ accent, active, label, a, b, aLabel, bLabel, delay = 0 }: {
  accent: string; active: boolean; label: string; a: number; b: number; aLabel: string; bLabel: string; delay?: number;
}) {
  const g = useGrow(active, 1000, delay);
  const pct = a + b > 0 ? (a / (a + b)) * 100 : 0;
  return (
    <Rise show={active} delay={delay} style={{ alignSelf: 'stretch' }}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: WC.muted, textTransform: 'uppercase' }}>{label}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: accent }}>{fmtInt(a)} h <Text style={{ color: WC.muted }}>· {Math.round(pct)}%</Text></Text>
        </View>
        <View style={{ height: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: WC.separator }}>
          <View style={{ height: '100%', width: `${pct * g}%` as any, backgroundColor: accent }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, color: WC.text3 }}>{aLabel}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, color: WC.text3 }}>{bLabel} · {fmtInt(b)} h</Text>
        </View>
      </View>
    </Rise>
  );
}

// ── Aircraft type breakdown ──────────────────────────────────────────────────
export function WTypeBreakdown({ accent, active, rows }: { accent: string; active: boolean; rows: { type: string; hours: number }[] }) {
  const g = useGrow(active, 900);
  const max = rows[0]?.hours || 1;
  return (
    <View style={{ alignSelf: 'stretch', gap: 8 }}>
      {rows.slice(0, 6).map((r, i) => (
        <Rise key={r.type} show={active} delay={i * 60}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', width: 52, color: i === 0 ? accent : WC.text }}>{r.type}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 4, backgroundColor: WC.separator, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${(r.hours / max) * 100 * g}%` as any, backgroundColor: i === 0 ? accent : WC.border }} />
            </View>
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', width: 60, textAlign: 'right', color: WC.text2 }}>{fmtInt(r.hours)}h</Text>
          </View>
        </Rise>
      ))}
    </View>
  );
}

// ── Adaptive EASA bars ───────────────────────────────────────────────────────
export function WEasaBars({ accent, active, bars }: { accent: string; active: boolean; bars: { label: string; have: number; need: number }[] }) {
  const g = useGrow(active, 900);
  return (
    <View style={{ alignSelf: 'stretch', gap: 12 }}>
      {bars.map((b, i) => {
        const ratio = Math.min(b.have / b.need, 1);
        const met = b.have >= b.need;
        return (
          <Rise key={b.label} show={active} delay={i * 70}>
            <View style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: WC.text2 }}>{b.label}</Text>
                <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: met ? WC.success : accent }}>{fmtInt(b.have)} / {fmtInt(b.need)} h {met ? '✓' : ''}</Text>
              </View>
              <View style={{ height: 7, borderRadius: 4, backgroundColor: WC.separator, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${ratio * 100 * g}%` as any, backgroundColor: met ? WC.success : accent }} />
              </View>
            </View>
          </Rise>
        );
      })}
    </View>
  );
}

// ── Top-10 airports ──────────────────────────────────────────────────────────
export function WTopAirports({ accent, active, rows }: { accent: string; active: boolean; rows: WAirport[] }) {
  const g = useGrow(active, 1000);
  const max = rows[0]?.visits || 1;
  return (
    <View style={{ alignSelf: 'stretch', gap: 7 }}>
      {rows.map((r, i) => (
        <Rise key={`${r.icao}-${i}`} show={active} delay={i * 55}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 11, width: 18, color: i === 0 ? accent : WC.muted }}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 13, width: 44, color: WC.text }}>{r.icao}</Text>
            {r.home ? (
              <View style={{ backgroundColor: accent + '1F', borderColor: accent + '55', borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: accent }}>HOME</Text>
              </View>
            ) : null}
            <View style={{ flex: 1, height: 5, borderRadius: 99, backgroundColor: WC.separator, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${(r.visits / max) * 100 * g}%` as any, backgroundColor: i === 0 ? accent : WC.border }} />
            </View>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 12, width: 40, textAlign: 'right', color: i === 0 ? accent : WC.text2 }}>{r.visits}×</Text>
          </View>
        </Rise>
      ))}
    </View>
  );
}

// ── Bottom-5 airports ────────────────────────────────────────────────────────
export function WBottomFive({ active, rows }: { active: boolean; rows: WAirport[] }) {
  return (
    <View style={{ alignSelf: 'stretch', gap: 7 }}>
      {rows.map((r, i) => (
        <Rise key={`${r.icao}-${i}`} show={active} delay={i * 50}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 12, width: 46, color: WC.text2 }}>{r.icao}</Text>
            <Text style={{ flex: 1, fontSize: 11, color: WC.text3 }} numberOfLines={1}>{r.name}</Text>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 11, color: WC.muted }}>{r.visits}×</Text>
          </View>
        </Rise>
      ))}
    </View>
  );
}

// ── Best-week day bars (tall, readable) ──────────────────────────────────────
function hhmm(h: number): string {
  if (h <= 0) return '';
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

export function WWeekBars({ accent, active, days }: { accent: string; active: boolean; days: { dow: string; hours: number }[] }) {
  const g = useGrow(active, 850);
  const max = Math.max(...days.map((d) => d.hours), 1);
  return (
    <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 170 }}>
      {days.map((d, i) => {
        const peak = d.hours === max && d.hours > 0;
        const pct = (d.hours / max) * 100 * g;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: peak ? accent : WC.muted, opacity: d.hours > 0 ? g : 0 }}>{hhmm(d.hours)}</Text>
            <View style={{
              width: '100%', borderRadius: 5,
              height: `${d.hours > 0 ? Math.max(pct, 4) : 0}%` as any,
              backgroundColor: peak ? accent : (d.hours > 0 ? WC.border : 'transparent'),
            }} />
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: peak ? accent : WC.faint }}>{(d.dow || '')[0] ?? ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Currency ring ────────────────────────────────────────────────────────────
function zoneFor(index: number): string {
  if (index < 50) return 'LOW';
  if (index < 90) return 'LIGHT';
  if (index < 130) return 'NORMAL';
  if (index < 180) return 'HIGH';
  return 'PEAK';
}

export function WCurrencyRing({ accent, active, recent14, yearAvg14, size = 190 }: {
  accent: string; active: boolean; recent14: number; yearAvg14: number; size?: number;
}) {
  const index = yearAvg14 > 0 ? Math.round((recent14 / yearAvg14) * 100) : 0;
  const zone = zoneFor(index);
  const v = useCountUp(index, active, { dur: 1400, delay: 200 });
  const r = (size - 18) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(v, 240) / 240;
  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={WC.separator} strokeWidth={10} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={accent} strokeWidth={10} fill="none" strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`} />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: SERIF, fontSize: 46, fontWeight: '600', color: WC.text }}>{Math.round(v)}%</Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, color: accent, marginTop: 6 }}>{zone}</Text>
      </View>
    </View>
  );
}

// ── Globe + orbit (distance around the Earth) ────────────────────────────────
export function WGlobeOrbit({ accent, active, laps, km }: { accent: string; active: boolean; laps: number; km: number }) {
  const cx = 100, cy = 100, R = 60;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 7000, easing: Easing.linear, useNativeDriver: false }));
    if (active) loop.start();
    return () => loop.stop();
  }, [active, spin]);

  // Ellipse path points for the travelling dot (param around rx=90, ry=30).
  const N = 48;
  const inputRange: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k <= N; k++) {
    const ang = (2 * Math.PI * k) / N;
    inputRange.push(k / N);
    xs.push(cx + 90 * Math.cos(ang));
    ys.push(cy + 30 * Math.sin(ang));
  }
  const dotX = spin.interpolate({ inputRange, outputRange: xs });
  const dotY = spin.interpolate({ inputRange, outputRange: ys });

  const ringBack = `M ${cx - 90} ${cy} A 90 30 0 0 0 ${cx + 90} ${cy}`;
  const ringFront = `M ${cx - 90} ${cy} A 90 30 0 0 1 ${cx + 90} ${cy}`;
  const whole = laps >= 1;
  const big = whole ? `${Math.round(laps)}×` : `${Math.round(laps * 100)}%`;
  const lbl = whole ? 'times around the Earth' : 'of one lap around the Earth';
  const parallels = [-0.55, 0, 0.55].map((o) => ({ o, rx: R * Math.sqrt(Math.max(0, 1 - o * o)) }));

  return (
    <View style={{ alignItems: 'center', gap: 14, alignSelf: 'stretch' }}>
      <Svg width={200} height={200} viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id="w-globe" cx="38%" cy="30%" r="78%">
            <Stop offset="0" stopColor={WC.surface2} />
            <Stop offset="0.68" stopColor={WC.bgDeep} />
            <Stop offset="1" stopColor="#02080F" />
          </RadialGradient>
          <ClipPath id="w-globe-clip"><Circle cx={cx} cy={cy} r={R} /></ClipPath>
        </Defs>

        <G rotation={-18} origin={`${cx}, ${cy}`}>
          <Path d={ringBack} fill="none" stroke={accent} strokeWidth={1.3} strokeDasharray="5 7" opacity={0.45} />
        </G>

        <Circle cx={cx} cy={cy} r={R} fill="url(#w-globe)" stroke={accent} strokeOpacity={0.5} strokeWidth={1} />
        <G clipPath="url(#w-globe-clip)" stroke={accent} strokeWidth={0.7} fill="none" opacity={0.42}>
          <Ellipse cx={cx} cy={cy} rx={R * 0.32} ry={R} />
          <Ellipse cx={cx} cy={cy} rx={R * 0.64} ry={R} />
          <Line x1={cx} y1={cy - R} x2={cx} y2={cy + R} />
          {parallels.map((p, i) => (<Ellipse key={i} cx={cx} cy={cy + R * p.o} rx={p.rx} ry={6} />))}
        </G>

        <G rotation={-18} origin={`${cx}, ${cy}`}>
          <Path d={ringFront} fill="none" stroke={accent} strokeWidth={1.7} strokeDasharray="5 7" opacity={0.9} />
          <AnimatedCircle cx={dotX as any} cy={dotY as any} r={4.5} fill={accent} />
        </G>
      </Svg>

      <View style={{ alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Text style={{ fontFamily: SERIF, fontSize: 42, fontWeight: '600', color: WC.text }}>{big}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 1, color: accent, textTransform: 'uppercase' }}>{lbl}</Text>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 10, color: WC.muted, marginTop: 7 }}>≈ {fmtInt(km)} km flown · cruise × time</Text>
      </View>
    </View>
  );
}

export const _styles = StyleSheet.create({}); // (placeholder; styles are inline above)
