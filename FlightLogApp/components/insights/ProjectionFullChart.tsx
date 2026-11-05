// Den breda kurvan i Projections helskärm. Samma lager som ProjectionChart (historiken i cyan, projektionen streckad,
// det troliga fönstret som en svag kil, målet som en linje), plus: fönstret utmärkt på mållinjen med månaderna under,
// en ETA-etikett, år (och kvartal i "Last 2 yr") på tidsaxeln och avläsning: tryck och dra på kurvan för att se en
// månad, loggad bakåt och projicerad framåt. Målet dras på skalan till höger, och skalan står still medan man drar.
// "Last 2 yr" visar de två senaste åren och framtiden, med en skala som börjar nära dagens timmar i stället för på noll.

import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, PanResponder } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import type { InsightsTheme } from './insightsTheme';
import type { JourneyPt } from './insightsData';
import { absOf, mLabel, mShort, one } from './projectionModel';

const MONO = 'JetBrainsMono';
const L = 4, T = 34, TAPE = 58, AXIS = 22;
const TICKS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const fmtH = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const f1 = (n: number) => n.toFixed(1);

export type ChartRange = 'all' | 'near';

export function ProjectionFullChart({ C, series, have, target, pace, fast, slow, step, snap, minTarget, nowA, range, onRange, onTarget }: {
  C: InsightsTheme; series: JourneyPt[]; have: number; target: number; pace: number;
  fast: number; slow: number;            // snabbaste/långsammaste takten (h/mån) för det troliga fönstret
  step: number; snap: number; minTarget: number; nowA: number;
  range: ChartRange; onRange: (r: ChartRange) => void; onTarget: (v: number) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [, bump] = useState(0);
  const frozen = useRef<{ a1: number; vmin: number; vmax: number } | null>(null);
  const startX = useRef(0), startY = useRef(0);
  const W = size.w, H = size.h, B = H - AXIS, R = W - TAPE;

  const toGo = Math.max(0, target - have);
  const etaA = pace > 0 ? nowA + Math.ceil(toGo / pace) : null;
  const fastA = fast > 0 ? nowA + Math.ceil(toGo / fast) : null, slowA = slow > 0 ? nowA + Math.ceil(toGo / slow) : null;
  const hasWin = fastA != null && slowA != null && fastA !== slowA;
  const aStart = series.length ? absOf(series[0].date) : nowA;
  const cumAt = (a: number) => {
    if (a >= nowA) return have;
    if (!series.length || a < aStart) return 0;
    return series[Math.min(series.length - 1, a - aStart)].cum;
  };
  const near = range === 'near', fr = frozen.current;
  const far = Math.max(etaA ?? nowA, hasWin ? slowA! : nowA);
  const a1 = fr ? fr.a1 : Math.max(nowA + 12, Math.min(far + 4, nowA + 120));
  const a0 = near ? Math.max(aStart, nowA - 24) : aStart;
  const vmin = fr ? fr.vmin : near ? Math.floor((cumAt(a0) * 0.96) / step) * step : 0;
  const vmax = fr ? fr.vmax : Math.max(vmin + 1, vmin + (Math.max(target, have) - vmin) * 1.12);
  const x = (a: number) => L + ((a - a0) / (a1 - a0 || 1)) * (R - L);
  const y = (v: number) => B - ((v - vmin) / (vmax - vmin)) * (B - T);

  // Det PanResponders (skapade en gång) behöver läsa från senaste renderingen.
  const live = useRef({ a0, a1, vmin, vmax, B, R, snap, minTarget, target, onTarget });
  live.current = { a0, a1, vmin, vmax, B, R, snap, minTarget, target, onTarget };
  const setFrom = (py: number) => {
    const s = live.current;
    let v = s.vmin + ((s.B - py) / (s.B - T)) * (s.vmax - s.vmin);
    v = Math.round(v / s.snap) * s.snap;
    v = Math.max(s.minTarget, Math.min(v, Math.floor(s.vmax / s.snap) * s.snap));
    if (v !== s.target) s.onTarget(v);
  };
  const scrubAt = (px: number) => {
    const s = live.current;
    const a = Math.max(s.a0, Math.min(s.a1, Math.round(s.a0 + ((px - L) / (s.R - L || 1)) * (s.a1 - s.a0))));
    setScrub((p) => (p === a ? p : a));
  };
  const endDrag = () => {
    if (!frozen.current) return;
    frozen.current = null;
    bump((n) => n + 1);
  };
  const tapePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const s = live.current;
      frozen.current = { a1: s.a1, vmin: s.vmin, vmax: s.vmax };
      startY.current = e.nativeEvent.locationY;
      Haptics.selectionAsync().catch(() => {});
      setScrub(null);
      setFrom(startY.current);
    },
    onPanResponderMove: (_, g) => setFrom(startY.current + g.dy),
    onPanResponderRelease: endDrag,
    onPanResponderTerminate: endDrag,
  })).current;
  const scrubPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      startX.current = e.nativeEvent.locationX;
      Haptics.selectionAsync().catch(() => {});
      scrubAt(startX.current);
    },
    onPanResponderMove: (_, g) => scrubAt(startX.current + g.dx),
    onPanResponderRelease: () => setScrub(null),
    onPanResponderTerminate: () => setScrub(null),
  })).current;

  let body = null;
  if (W > 0 && H > 0) {
    let hist = near ? '' : `M ${f1(x(a0))} ${f1(y(0))}`;
    for (let a = a0; a <= nowA; a++) hist += `${hist ? ' L' : 'M'} ${f1(x(a))} ${f1(y(cumAt(a)))}`;
    const xNow = x(nowA), yHave = y(have), yT = y(target);

    let proj = '', etaPt: { x: number; y: number } | null = null, onChart = false;
    if (pace > 0 && etaA != null) {
      let endA = a1, endV = have + pace * (a1 - nowA);
      if (etaA <= a1) { endA = etaA; endV = target; onChart = true; }
      if (endV > vmax) { endA = nowA + (vmax - have) / pace; endV = vmax; }
      proj = `M ${f1(xNow)} ${f1(yHave)} L ${f1(x(endA))} ${f1(y(endV))}`;
      etaPt = { x: x(endA), y: y(endV) };
    }

    let cone = '', band = '', wticks = '';
    const winLabels: { text: string; left: number; width: number }[] = [];
    if (hasWin) {
      const edge = (p: number) => {
        const vEnd = have + p * (a1 - nowA);
        if (vEnd <= vmax) return { x: R, y: y(vEnd), top: false };
        return { x: x(nowA + (vmax - have) / p), y: T, top: true };
      };
      const ef = edge(fast), es = edge(slow);
      cone = `M ${f1(xNow)} ${f1(yHave)} L ${f1(ef.x)} ${f1(ef.y)}${ef.top && !es.top ? ` L ${R} ${T}` : ''} L ${f1(es.x)} ${f1(es.y)} Z`;
      const xf = x(Math.min(fastA!, a1)), xs = x(Math.min(slowA!, a1));
      band = `M ${f1(xf)} ${f1(yT)} L ${f1(xs)} ${f1(yT)}`;
      wticks = `M ${f1(xf)} ${f1(yT - 5)} V ${f1(yT + 5)} M ${f1(xs)} ${f1(yT - 5)} V ${f1(yT + 5)}`;
      const lab = (text: string, cx: number) => {
        const width = text.length * 6 + 10;
        winLabels.push({ text, width, left: Math.max(0, Math.min(R - width, cx - width / 2)) });
      };
      if (xs - xf >= 56) { lab(mShort(fastA!), xf); lab(mShort(slowA!), xs); }
      else lab(`${mShort(fastA!)}–${mShort(slowA!)}`, (xf + xs) / 2);
    }
    const etaTag = etaPt ? (onChart ? `ETA ${mShort(etaA!)}` : `${mShort(etaA!)} →`) : '';
    const etaW = etaTag.length * 6.4 + 12;

    const span = vmax - vmin;
    const tick = TICKS.find((t) => span / t <= 5) ?? TICKS[TICKS.length - 1];
    let grid = '';
    const tickLabels: { v: number; y: number }[] = [];
    for (let v = Math.ceil((vmin + 1) / tick) * tick; v < vmax; v += tick) {
      grid += `M ${L} ${f1(y(v))} H ${R} `;
      if (Math.abs(y(v) - yT) >= 15) tickLabels.push({ v, y: y(v) });
    }
    if (near && vmin > 0) tickLabels.push({ v: vmin, y: B });

    let ylines = '', axis = `M ${L} ${B} H ${R} `;
    const years: { label: string; x: number }[] = [];
    const every = near ? 1 : Math.max(1, Math.ceil((Math.floor(a1 / 12) - Math.floor(a0 / 12)) / 7));
    for (let yr = Math.floor(a0 / 12) + 1; yr * 12 <= a1; yr++) {
      const xx = x(yr * 12);
      ylines += `M ${f1(xx)} ${T} V ${B} `;
      axis += `M ${f1(xx)} ${B} v 5 `;
      if (yr % every === 0 && xx >= L + 14 && xx <= R - 14) years.push({ label: near ? String(yr) : `’${String(yr).slice(2)}`, x: xx });
    }
    if (near) for (let q = Math.ceil(a0 / 3) * 3; q <= a1; q += 3) if (q % 12) axis += `M ${f1(x(q))} ${B} v 3 `;

    // Avläsningen: loggad tid bakåt, projicerad (med det troliga spannet) framåt.
    let read: { x: number; y: number | null; l1: string; l2: string } | null = null;
    if (scrub != null && scrub >= a0 && scrub <= a1) {
      let val: number | null = null, l1 = mLabel(scrub), l2 = '';
      if (scrub <= nowA) { val = cumAt(scrub); l1 += ` · ${fmtH(val)} h`; l2 = 'logged'; }
      else if (pace > 0) {
        const t = scrub - nowA;
        val = have + pace * t;
        l1 += ` · ≈ ${fmtH(val)} h`;
        l2 = hasWin ? `likely ${fmtH(have + slow * t)}–${fmtH(have + fast * t)} h` : `at ${one(pace)} h/mo`;
      } else l2 = 'No pace yet';
      read = { x: x(scrub), y: val != null && val >= vmin && val <= vmax ? y(val) : null, l1, l2 };
    }
    const readW = read ? Math.max(read.l1.length, read.l2.length) * 6.1 + 18 : 0;
    const readLeft = read ? Math.max(0, Math.min(R - readW, read.x - readW / 2)) : 0;

    body = (
      <>
        <Svg width={W} height={H}>
          <Defs>
            <LinearGradient id="projFullArea" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={C.primary} stopOpacity={0.24} />
              <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={ylines} fill="none" stroke={C.separator} strokeWidth={1} opacity={0.7} />
          <Path d={grid} fill="none" stroke={C.separator} strokeWidth={1} />
          {cone ? <Path d={cone} fill={C.soft} fillOpacity={0.06} /> : null}
          <Path d={`M ${f1(xNow)} ${T} L ${f1(xNow)} ${B}`} fill="none" stroke={C.text2} strokeWidth={1} strokeDasharray="1 3" opacity={0.6} />
          <Path d={`${hist} L ${f1(xNow)} ${B} L ${f1(x(a0))} ${B} Z`} fill="url(#projFullArea)" />
          <Path d={`M ${L} ${f1(yT)} L ${R} ${f1(yT)}`} fill="none" stroke={C.quiet} strokeWidth={1.1} strokeDasharray="4 4" />
          {band ? <Path d={band} fill="none" stroke={C.soft} strokeWidth={5} strokeLinecap="round" opacity={0.2} /> : null}
          {band ? <Path d={wticks} fill="none" stroke={C.soft} strokeWidth={1.4} opacity={0.7} /> : null}
          <Path d={axis} fill="none" stroke={C.border} strokeWidth={1} />
          {proj ? <Path d={proj} fill="none" stroke={C.soft} strokeWidth={1.8} strokeDasharray="5 4" strokeLinecap="round" opacity={0.85} /> : null}
          <Path d={hist} fill="none" stroke={C.primary} strokeWidth={2.3} strokeLinejoin="round" strokeLinecap="round" />
          {read ? <Path d={`M ${f1(read.x)} ${T} V ${B}`} fill="none" stroke={C.text2} strokeWidth={1} opacity={0.6} /> : null}
          {etaPt ? <Circle cx={etaPt.x} cy={etaPt.y} r={8} fill={C.soft} opacity={0.14} /> : null}
          {etaPt ? <Circle cx={etaPt.x} cy={etaPt.y} r={4} fill={C.soft} /> : null}
          <Circle cx={xNow} cy={yHave} r={5} fill={C.primary} stroke={C.bg} strokeWidth={2.5} />
          {read && read.y != null ? <Circle cx={read.x} cy={read.y} r={4.5} fill={C.text} stroke={C.bg} strokeWidth={2} /> : null}
          <SvgText x={xNow} y={T - 6} fontSize={8} fontFamily={MONO} fontWeight="700" fill={C.muted} textAnchor="middle" letterSpacing={1.2}>NOW</SvgText>
          {tickLabels.map((t) => (
            <SvgText key={t.v} x={R + 6} y={t.y + 3} fontSize={9} fontFamily={MONO} fill={t.v <= have ? C.muted : C.text2}>{fmtH(t.v)}</SvgText>
          ))}
          {years.map((yr) => (
            <SvgText key={yr.label} x={yr.x} y={B + 15} fontSize={9} fontFamily={MONO} fontWeight="700" fill={C.muted} textAnchor="middle">{yr.label}</SvgText>
          ))}
        </Svg>
        {winLabels.map((w) => (
          <View key={w.text} pointerEvents="none" style={{ position: 'absolute', left: w.left, top: yT + 8, width: w.width, borderRadius: 4, backgroundColor: C.bg }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, lineHeight: 14, color: C.text2, textAlign: 'center' }}>{w.text}</Text>
          </View>
        ))}
        {etaPt ? (
          <View pointerEvents="none" style={{
            position: 'absolute', left: Math.max(0, Math.min(R - etaW - 2, etaPt.x - etaW / 2)), top: Math.max(26, etaPt.y - 28),
            width: etaW, height: 18, borderRadius: 5, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: C.deep }}>{etaTag}</Text>
          </View>
        ) : null}
        <View {...scrubPan.panHandlers} style={{ position: 'absolute', left: 0, top: 24, width: R - 4, height: H - 24 }}
          accessible accessibilityLabel="Chart. Touch and drag to read a month" />
        <View
          {...tapePan.panHandlers}
          style={{ position: 'absolute', left: R - 4, top: 0, width: TAPE + 4, height: H }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Target"
          accessibilityHint="Drag up or down on the scale to change your target"
          accessibilityValue={{ text: `${fmtH(target)} hours` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') onTarget(target + snap);
            if (e.nativeEvent.actionName === 'decrement') onTarget(Math.max(minTarget, target - snap));
          }}
        />
        <View pointerEvents="none" style={{
          position: 'absolute', left: R - 2, top: yT - 11, width: 58, height: 22, borderRadius: 7, backgroundColor: C.soft,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          <View style={{ width: 8, height: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ width: 2.6, height: 2.6, borderRadius: 1.3, backgroundColor: C.deep }} />)}
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.deep }}>{fmtH(target)}</Text>
        </View>
        <RangeSwitch C={C} options={[['all', 'All years'], ['near', 'Last 2 yr']]} value={range} onChange={(r) => { setScrub(null); onRange(r as ChartRange); }} />
        {read ? (
          <View pointerEvents="none" style={{
            position: 'absolute', left: readLeft, top: readLeft < 150 ? 27 : 0, width: readW, paddingVertical: 4, paddingHorizontal: 8,
            borderRadius: 7, borderWidth: 1, borderColor: C.quiet, backgroundColor: C.deep, gap: 1,
          }}>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.text }}>{read.l1}</Text>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9.5, color: C.text2 }}>{read.l2}</Text>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) })}>
      {body}
    </View>
  );
}

// Växlingen uppe till vänster i kurvan (delas med Next licence).
export function RangeSwitch({ C, options, value, onChange }: {
  C: InsightsTheme; options: [string, string][]; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, flexDirection: 'row', gap: 2, padding: 2, borderRadius: 8, backgroundColor: C.deep }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <TouchableOpacity key={k} onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(k); }} accessibilityRole="button"
            accessibilityState={{ selected: on }} hitSlop={{ top: 8, bottom: 8 }}
            style={{ minHeight: 22, paddingHorizontal: 8, borderRadius: 6, justifyContent: 'center', backgroundColor: on ? C.elevated : 'transparent' }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: on ? C.text : C.muted }}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
