// Den breda kurvan i Next licence helskärm: hur redo man är över tid, som LicenceChart, men projektionen följer den
// takt man valt, kravens namn står direkt vid punkterna (ovanför om det får plats, annars under, annars inget: rutorna
// under kurvan har det ändå), och man läser av en månad genom att trycka och dra. Skalan räcker till den långsammaste
// takten, så den står still när man byter takt.

import { useRef, useState } from 'react';
import { View, Text, PanResponder } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { InsightsTheme } from './insightsTheme';
import { readyAt, projAt, monthsAt, hoursTxt, type LicReq, type LicState } from './licenceState';
import { mLabel, mShort } from './projectionModel';
import { RangeSwitch } from './ProjectionFullChart';

const MONO = 'JetBrainsMono';
const L = 4, T = 34, TAPE = 52, AXIS = 22, SC = 1.12;
const f1 = (n: number) => n.toFixed(1);
const pct = (v: number) => Math.min(100, Math.floor(v * 100));

export type LicRange = 'recent' | 'all';

export function LicenceFullChart({ C, S, nowA, startA, pick, etaM, lim, scaleM, focus, range, onRange }: {
  C: InsightsTheme; S: LicState; nowA: number;
  startA: number;                             // första månaden i loggboken
  pick: (r: LicReq) => number;                // den valda takten per krav
  etaM: number | null; lim: LicReq | null;    // datumet och kravet som sätter det, i den valda takten
  scaleM: number | null;                      // månader till den långsammaste takten
  focus: string | null; range: LicRange; onRange: (r: LicRange) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const startX = useRef(0);
  const W = size.w, H = size.h, B = H - AXIS, R = W - TAPE;

  let a0: number, a1: number, histEnd: number;
  if (S.done) {
    a0 = startA; a1 = Math.min(nowA, Math.max((S.doneA ?? nowA) + 8, startA + 18)); histEnd = a1;
  } else {
    a0 = range === 'all' ? startA : Math.max(startA, nowA - 36);
    a1 = Math.max(nowA + 12, Math.min(nowA + (scaleM ?? etaM ?? 20) + 4, nowA + 120)); histEnd = nowA;
  }
  if (a1 <= a0) a1 = a0 + 1;
  const horizon = Math.max(0, a1 - nowA);
  const x = (a: number) => L + ((a - a0) / (a1 - a0)) * (R - L);
  const y = (v: number) => B - (v / SC) * (B - T);

  const live = useRef({ a0, a1, R });
  live.current = { a0, a1, R };
  const scrubAt = (px: number) => {
    const s = live.current;
    const a = Math.max(s.a0, Math.min(s.a1, Math.round(s.a0 + ((px - L) / (s.R - L || 1)) * (s.a1 - s.a0))));
    setScrub((p) => (p === a ? p : a));
  };
  const scrubPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      startX.current = e.nativeEvent.locationX;
      Haptics.selectionAsync().catch(() => {});
      scrubAt(startX.current);
    },
    // locationX i målvyn, inte skärmens dx: då fungerar avläsningen även när helskärmen är vriden i stående läge.
    onPanResponderMove: (e) => scrubAt(e.nativeEvent.locationX),
    onPanResponderRelease: () => setScrub(null),
    onPanResponderTerminate: () => setScrub(null),
  })).current;

  let body = null;
  if (W > 0 && H > 0) {
    let hist = '';
    for (let a = a0; a <= histEnd; a++) hist += `${a === a0 ? 'M' : ' L'} ${f1(x(a))} ${f1(y(readyAt(S, a, nowA)))}`;
    const area = `${hist} L ${f1(x(histEnd))} ${B} L ${f1(x(a0))} ${B} Z`;

    let proj = '', cone = '';
    if (!S.done) {
      const pEnd = etaM != null ? Math.min(etaM, horizon) : horizon;
      for (let t = 0; t <= pEnd; t++) proj += `${t ? ' L' : 'M'} ${f1(x(nowA + t))} ${f1(y(projAt(S, t, pick)))}`;
      if (S.fastM != null && S.slowM != null && S.fastM !== S.slowM) {
        const fwd: string[] = [], back: string[] = [];
        for (let u = 0; u <= horizon; u++) {
          fwd.push(`${f1(x(nowA + u))} ${f1(y(projAt(S, u, (r) => r.fast)))}`);
          back.unshift(`${f1(x(nowA + u))} ${f1(y(projAt(S, u, (r) => r.slow)))}`);
        }
        cone = `M ${fwd.join(' L ')} L ${back.join(' L ')} Z`;
      }
    }

    const pointOf = (r: LicReq): { x: number; y: number } | null => {
      if (r.met) return r.metA != null && r.metA >= a0 && r.metA <= histEnd ? { x: x(r.metA), y: y(readyAt(S, r.metA, nowA)) } : null;
      const m = monthsAt(r, pick);
      if (m == null || m > horizon) return null;
      return { x: x(nowA + m), y: y(projAt(S, m, pick)) };
    };
    const metPts: { x: number; y: number }[] = [], openPts: { x: number; y: number }[] = [];
    const labs: { r: LicReq; p: { x: number; y: number } }[] = [];
    for (const r of S.reqs) {
      const p = pointOf(r);
      if (!p) continue;
      labs.push({ r, p });
      if (S.done ? r.metA === S.doneA : r === lim) continue;
      (r.met ? metPts : openPts).push(p);
    }
    const glow = S.done
      ? { x: x(S.doneA ?? nowA), y: y(1) }
      : etaM != null ? { x: x(Math.min(nowA + etaM, a1)), y: y(projAt(S, Math.min(etaM, horizon), pick)) } : null;

    labs.sort((p, q) => p.p.x - q.p.x);
    let lastAbove = -1e9, lastBelow = -1e9;
    const dotLabels: { text: string; left: number; top: number; width: number; color: string }[] = [];
    for (const o of labs) {
      if (o.r.key === focus) continue;
      const isLim = !S.done && o.r === lim;
      const text = isLim && etaM != null ? `${o.r.short} · ${mShort(nowA + etaM)}` : o.r.short;
      const width = text.length * 5.6 + 8, left = Math.max(0, Math.min(R - width, o.p.x - width / 2));
      let above: boolean;
      if (left > lastAbove + 4 && o.p.y - 20 >= T - 8) { above = true; lastAbove = left + width; }
      else if (left > lastBelow + 4 && o.p.y + 20 <= B) { above = false; lastBelow = left + width; }
      else continue;
      dotLabels.push({ text, left, width, top: above ? o.p.y - 20 : o.p.y + 8, color: isLim ? C.text : o.r.met ? C.muted : C.text2 });
    }

    const focusReq = S.reqs.find((r) => r.key === focus) ?? null;
    const fp = focusReq ? pointOf(focusReq) : null;
    const fm = focusReq ? monthsAt(focusReq, pick) : null;
    const focusText = focusReq
      ? focusReq.met ? `${focusReq.short} met · ${mShort(focusReq.metA ?? nowA)}`
        : `${focusReq.short} · ${hoursTxt(focusReq.toGo < 10 ? Math.ceil(focusReq.toGo * 10) / 10 : Math.ceil(focusReq.toGo))} h to go${fm != null ? ` · ${mShort(nowA + fm)}` : ''}`
      : '';
    const fw = focusText.length * 6.2 + 18;

    let ylines = '', axis = `M ${L} ${B} H ${R} `;
    const years: { label: string; x: number }[] = [];
    const nYears = Math.floor(a1 / 12) - Math.floor(a0 / 12), every = Math.max(1, Math.ceil(nYears / 7)), full = nYears <= 7;
    for (let yr = Math.floor(a0 / 12) + 1; yr * 12 <= a1; yr++) {
      const xx = x(yr * 12);
      ylines += `M ${f1(xx)} ${T} V ${B} `;
      axis += `M ${f1(xx)} ${B} v 5 `;
      if (yr % every === 0 && xx >= L + 14 && xx <= R - 14) years.push({ label: full ? String(yr) : `’${String(yr).slice(2)}`, x: xx });
    }
    if (full) for (let q = Math.ceil(a0 / 3) * 3; q <= a1; q += 3) if (q % 12) axis += `M ${f1(x(q))} ${B} v 3 `;

    let read: { x: number; y: number; l1: string; l2: string } | null = null;
    if (scrub != null && scrub >= a0 && scrub <= a1) {
      if (scrub <= histEnd) {
        const v = readyAt(S, scrub, nowA);
        read = { x: x(scrub), y: y(v), l1: `${mLabel(scrub)} · ${pct(v)}% ready`, l2: 'logged' };
      } else {
        const t = scrub - nowA, v = projAt(S, t, pick);
        read = {
          x: x(scrub), y: y(v), l1: `${mLabel(scrub)} · ≈ ${pct(v)}% ready`,
          l2: S.fastM != null && S.slowM != null ? `likely ${pct(projAt(S, t, (r) => r.slow))}–${pct(projAt(S, t, (r) => r.fast))}%` : 'at this pace',
        };
      }
    }
    const readW = read ? Math.max(read.l1.length, read.l2.length) * 6.1 + 18 : 0;
    const readLeft = read ? Math.max(0, Math.min(R - readW, read.x - readW / 2)) : 0;
    const dots = (pts: { x: number; y: number }[], r: number) =>
      pts.map((p) => `M ${f1(p.x - r)} ${f1(p.y)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`).join(' ');

    body = (
      <>
        <Svg width={W} height={H}>
          <Defs>
            <LinearGradient id="licFullArea" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={C.primary} stopOpacity={0.22} />
              <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={ylines} fill="none" stroke={C.separator} strokeWidth={1} opacity={0.7} />
          <Path d={[0.25, 0.5, 0.75].map((v) => `M ${L} ${f1(y(v))} H ${R}`).join(' ')} fill="none" stroke={C.separator} strokeWidth={1} />
          {cone ? <Path d={cone} fill={C.soft} fillOpacity={0.06} /> : null}
          {!S.done ? <Path d={`M ${f1(x(nowA))} ${T} L ${f1(x(nowA))} ${B}`} fill="none" stroke={C.text2} strokeWidth={1} strokeDasharray="1 3" opacity={0.6} /> : null}
          <Path d={area} fill="url(#licFullArea)" />
          <Path d={`M ${L} ${f1(y(1))} L ${R} ${f1(y(1))}`} fill="none" stroke={C.quiet} strokeWidth={1.1} strokeDasharray="4 4" />
          <Path d={axis} fill="none" stroke={C.border} strokeWidth={1} />
          {fp ? <Path d={`M ${f1(fp.x)} ${f1(fp.y + 6)} L ${f1(fp.x)} ${B}`} fill="none" stroke={C.text2} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} /> : null}
          {proj ? <Path d={proj} fill="none" stroke={C.soft} strokeWidth={1.8} strokeDasharray="5 4" strokeLinecap="round" opacity={0.85} /> : null}
          <Path d={hist} fill="none" stroke={C.primary} strokeWidth={2.3} strokeLinejoin="round" strokeLinecap="round" />
          {metPts.length ? <Path d={dots(metPts, 3.5)} fill={C.text2} stroke={C.bg} strokeWidth={1.5} /> : null}
          {openPts.length ? <Path d={dots(openPts, 3.8)} fill={C.bg} stroke={C.text2} strokeWidth={1.6} /> : null}
          {read ? <Path d={`M ${f1(read.x)} ${T} V ${B}`} fill="none" stroke={C.text2} strokeWidth={1} opacity={0.6} /> : null}
          {fp ? <Circle cx={fp.x} cy={fp.y} r={5} fill={C.text} stroke={C.bg} strokeWidth={2} /> : null}
          {glow ? <Circle cx={glow.x} cy={glow.y} r={8} fill={C.soft} opacity={0.14} /> : null}
          {glow ? <Circle cx={glow.x} cy={glow.y} r={4} fill={C.soft} /> : null}
          {!S.done ? <Circle cx={x(nowA)} cy={y(S.ready)} r={5} fill={C.primary} stroke={C.bg} strokeWidth={2.5} /> : null}
          {read ? <Circle cx={read.x} cy={read.y} r={4.5} fill={C.text} stroke={C.bg} strokeWidth={2} /> : null}
          {!S.done ? <SvgText x={x(nowA)} y={T - 6} fontSize={8} fontFamily={MONO} fontWeight="700" fill={C.muted} textAnchor="middle" letterSpacing={1.2}>NOW</SvgText> : null}
          {[0.25, 0.5, 0.75].map((v) => (
            <SvgText key={v} x={R + 6} y={y(v) + 3} fontSize={9} fontFamily={MONO} fill={v <= S.ready ? C.muted : C.text2}>{`${v * 100}%`}</SvgText>
          ))}
          {years.map((yr) => (
            <SvgText key={yr.label} x={yr.x} y={B + 15} fontSize={9} fontFamily={MONO} fontWeight="700" fill={C.muted} textAnchor="middle">{yr.label}</SvgText>
          ))}
        </Svg>
        {dotLabels.map((d, i) => (
          <Text key={i} pointerEvents="none" numberOfLines={1}
            style={{ position: 'absolute', left: d.left, top: d.top, width: d.width, textAlign: 'center', fontFamily: MONO, fontSize: 8.5, lineHeight: 12, fontWeight: '700', color: d.color }}>
            {d.text}
          </Text>
        ))}
        <View pointerEvents="none" style={{
          position: 'absolute', left: R - 2, top: y(1) - 11, width: TAPE + 2, height: 22, borderRadius: 7, backgroundColor: C.soft,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
        }}>
          {S.done ? <Ionicons name="checkmark" size={11} color={C.deep} /> : null}
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.deep }}>{S.code}</Text>
        </View>
        {fp ? (
          <View pointerEvents="none" style={{
            position: 'absolute', left: Math.max(0, Math.min(R - fw, fp.x - fw / 2)), top: fp.y < 60 ? fp.y + 12 : fp.y - 30,
            height: 20, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: C.quiet, backgroundColor: C.deep, justifyContent: 'center',
          }}>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.text }}>{focusText}</Text>
          </View>
        ) : null}
        <View {...scrubPan.panHandlers} style={{ position: 'absolute', left: 0, top: 24, width: R, height: H - 24 }}
          accessible accessibilityLabel="Chart. Touch and drag to read a month" />
        {!S.done ? (
          <RangeSwitch C={C} options={[['recent', 'Last 3 yr'], ['all', 'All years']]} value={range}
            onChange={(r) => { setScrub(null); onRange(r as LicRange); }} />
        ) : null}
        {read ? (
          <View pointerEvents="none" style={{
            position: 'absolute', left: readLeft, top: !S.done && readLeft < 150 ? 27 : 0, width: readW, paddingVertical: 4, paddingHorizontal: 8,
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
