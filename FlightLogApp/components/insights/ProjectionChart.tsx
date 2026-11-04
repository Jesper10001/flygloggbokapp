// Kumulativ tid över tid i Projections: historiken (cyan), projektionen mot målet (streckad guld),
// ett troligt fönster mellan den snabbaste och den långsammaste av användarens takter (svag guldkil) och målet
// som en guldlinje man drar upp och ner. Skalan står still medan man drar och anpassar sig när man släpper.

import { useRef, useState } from 'react';
import { View, Text, PanResponder } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import type { InsightsTheme } from './insightsTheme';
import type { JourneyPt } from './insightsData';

const MONO = 'JetBrainsMono';
const H = 184, L = 4, T = 12, B = 164, TAPE = 56;
const TICKS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const absOf = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const fmtH = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function ProjectionChart({ C, series, have, target, pace, fast, slow, snap, minTarget, nowA, onTarget, onDrag }: {
  C: InsightsTheme; series: JourneyPt[]; have: number; target: number; pace: number;
  fast: number; slow: number;            // snabbaste/långsammaste takten (h/mån) för det troliga fönstret
  snap: number; minTarget: number; nowA: number;
  onTarget: (v: number) => void; onDrag?: (active: boolean) => void;
}) {
  const [W, setW] = useState(0);
  const [, bump] = useState(0);
  const dragScale = useRef<number | null>(null);
  const startY = useRef(0);
  const R = W - TAPE;

  const toGo = Math.max(0, target - have);
  const etaA = pace > 0 ? nowA + Math.ceil(toGo / pace) : null;
  const a0 = series.length ? absOf(series[0].date) : nowA;
  const a1 = Math.max(nowA + 12, Math.min((etaA ?? nowA) + 4, nowA + 120));
  const scaleNow = Math.max(target, have) * 1.15 || 1;
  const scale = dragScale.current ?? scaleNow;

  // Det PanResponder (skapad en gång) behöver läsa från senaste renderingen.
  const live = useRef({ scale, scaleNow, snap, minTarget, target, onTarget, onDrag });
  live.current = { scale, scaleNow, snap, minTarget, target, onTarget, onDrag };
  const setFrom = (py: number) => {
    const s = live.current;
    let v = ((B - py) / (B - T)) * s.scale;
    v = Math.round(v / s.snap) * s.snap;
    v = Math.max(s.minTarget, Math.min(v, Math.floor(s.scale / s.snap) * s.snap));
    if (v !== s.target) s.onTarget(v);
  };
  const end = () => {
    if (dragScale.current == null) return;
    dragScale.current = null;
    live.current.onDrag?.(false);
    bump((n) => n + 1);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      dragScale.current = live.current.scaleNow;
      startY.current = e.nativeEvent.locationY;
      live.current.onDrag?.(true);
      Haptics.selectionAsync().catch(() => {});
      setFrom(startY.current);
    },
    onPanResponderMove: (_, g) => setFrom(startY.current + g.dy),
    onPanResponderRelease: end,
    onPanResponderTerminate: end,
  })).current;

  const x = (a: number) => L + ((a - a0) / (a1 - a0 || 1)) * (R - L);
  const y = (v: number) => B - (v / scale) * (B - T);
  const f1 = (n: number) => n.toFixed(1);

  let body = null;
  if (W > 0) {
    const hist = `M ${f1(x(a0))} ${f1(y(0))}` + series.map((p) => ` L ${f1(x(absOf(p.date)))} ${f1(y(p.cum))}`).join('');
    const xNow = x(nowA), yHave = y(have), yT = y(target);
    const onChart = etaA != null && etaA <= a1;
    const endA = onChart ? etaA! : a1;
    const endV = Math.min(scale, onChart ? target : have + pace * (a1 - nowA));
    const edge = (p: number) => {
      const vEnd = have + p * (a1 - nowA);
      if (vEnd <= scale) return { x: R, y: y(vEnd), top: false };
      return { x: x(nowA + (scale - have) / p), y: T, top: true };
    };
    let cone = '';
    if (fast > 0 && slow > 0 && fast !== slow) {
      const ef = edge(fast), es = edge(slow);
      cone = `M ${f1(xNow)} ${f1(yHave)} L ${f1(ef.x)} ${f1(ef.y)}${ef.top && !es.top ? ` L ${R} ${T}` : ''} L ${f1(es.x)} ${f1(es.y)} Z`;
    }
    const tick = TICKS.find((t) => scale / t <= 4) ?? TICKS[TICKS.length - 1];
    let grid = '';
    const tickLabels: { v: number; y: number }[] = [];
    for (let v = tick; v < scale; v += tick) {
      grid += `M ${L} ${f1(y(v))} H ${R} `;
      if (Math.abs(y(v) - yT) >= 13) tickLabels.push({ v, y: y(v) });
    }
    const years: { label: string; x: number }[] = [];
    const y0 = Math.floor(a0 / 12) + 1, y1 = Math.floor(a1 / 12), every = Math.max(1, Math.ceil((y1 - y0 + 1) / 5));
    for (let yr = y0; yr <= y1; yr += every) {
      const xx = x(yr * 12);
      if (xx >= L + 12 && xx <= R - 12) years.push({ label: `’${String(yr).slice(2)}`, x: xx });
    }
    body = (
      <>
        <Svg width={W} height={H}>
          <Defs>
            <LinearGradient id="projArea" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={C.primary} stopOpacity={0.24} />
              <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={grid} fill="none" stroke={C.separator} strokeWidth={1} />
          {cone ? <Path d={cone} fill={C.soft} fillOpacity={0.06} /> : null}
          <Path d={`M ${f1(xNow)} ${T} L ${f1(xNow)} ${B}`} fill="none" stroke={C.text2} strokeWidth={1} strokeDasharray="1 3" opacity={0.6} />
          <Path d={`${hist} L ${f1(xNow)} ${B} L ${f1(x(a0))} ${B} Z`} fill="url(#projArea)" />
          <Path d={`M ${L} ${f1(yT)} L ${R} ${f1(yT)}`} fill="none" stroke={C.quiet} strokeWidth={1.1} strokeDasharray="4 4" />
          {pace > 0 ? <Path d={`M ${f1(xNow)} ${f1(yHave)} L ${f1(x(endA))} ${f1(y(endV))}`} fill="none" stroke={C.soft} strokeWidth={1.8} strokeDasharray="5 4" strokeLinecap="round" opacity={0.85} /> : null}
          <Path d={hist} fill="none" stroke={C.primary} strokeWidth={2.3} strokeLinejoin="round" strokeLinecap="round" />
          {pace > 0 ? <Circle cx={x(endA)} cy={y(endV)} r={8} fill={C.soft} opacity={0.14} /> : null}
          {pace > 0 ? <Circle cx={x(endA)} cy={y(endV)} r={4} fill={C.soft} /> : null}
          <Circle cx={xNow} cy={yHave} r={5} fill={C.primary} stroke={C.card} strokeWidth={2.5} />
          {tickLabels.map((t) => (
            <SvgText key={t.v} x={R + 6} y={t.y + 3} fontSize={9} fontFamily={MONO} fill={t.v <= have ? C.muted : C.text2}>{fmtH(t.v)}</SvgText>
          ))}
          {years.map((yr) => (
            <SvgText key={yr.label} x={yr.x} y={B + 14} fontSize={9} fontFamily={MONO} fontWeight="700" fill={C.muted} textAnchor="middle">{yr.label}</SvgText>
          ))}
        </Svg>
        <View pointerEvents="none" style={{
          position: 'absolute', left: R - 2, top: yT - 11, width: 58, height: 22, borderRadius: 7, backgroundColor: C.soft,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          <View style={{ width: 8, height: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ width: 2.6, height: 2.6, borderRadius: 1.3, backgroundColor: C.deep }} />)}
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.deep }}>{fmtH(target)}</Text>
        </View>
        <View
          {...pan.panHandlers}
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Target"
          accessibilityHint="Drag up or down to change your target"
          accessibilityValue={{ text: `${fmtH(target)} hours` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') onTarget(target + snap);
            if (e.nativeEvent.actionName === 'decrement') onTarget(Math.max(minTarget, target - snap));
          }}
        />
      </>
    );
  }

  return (
    <View style={{ height: H }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {body}
    </View>
  );
}
