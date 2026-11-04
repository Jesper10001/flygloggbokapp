// Hur redo man är för en licens över tid: snittet av kraven (vart och ett högst 100 %). Historiken är cyan, projektionen
// streckad guld mot taket på 100 %, som är licensen. Varje krav får en punkt där det blir (eller blev) uppfyllt, och
// kravet som sätter datumet lyser. Den svaga guldkilen är det troliga fönstret mellan den snabbaste och den långsammaste
// takten. Samma geometri och färger som ProjectionChart.

import { useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import type { InsightsTheme } from './insightsTheme';
import { readyAt, projAt, hoursTxt, type LicReq, type LicState } from './licenceState';

const MONO = 'JetBrainsMono';
const H = 184, L = 4, T = 12, B = 164, TAPE = 56, SC = 1.12;

export function LicenceChart({ C, S, nowA, startA, focus }: {
  C: InsightsTheme; S: LicState; nowA: number;
  startA: number;                             // första månaden i loggboken
  focus: string | null;                       // kravet som är markerat i rutorna under kurvan
}) {
  const [W, setW] = useState(0);
  const R = W - TAPE;
  const accent = C.soft;

  let body = null;
  if (W > 0) {
    // En pågående licens visar tre år bakåt och fram till datumet, en klar licens hela vägen dit.
    const etaA = S.etaM != null ? nowA + S.etaM : null;
    let a0: number, a1: number, histEnd: number;
    if (S.done) {
      a0 = startA; a1 = Math.min(nowA, Math.max((S.doneA ?? nowA) + 8, startA + 18)); histEnd = a1;
    } else {
      a0 = Math.max(startA, nowA - 36); a1 = Math.max(nowA + 12, Math.min((etaA ?? nowA + 20) + 4, nowA + 120)); histEnd = nowA;
    }
    const horizon = Math.max(0, a1 - nowA);
    const x = (a: number) => L + ((a - a0) / (a1 - a0 || 1)) * (R - L);
    const y = (v: number) => B - (v / SC) * (B - T);
    const f1 = (n: number) => n.toFixed(1);
    const usual = (r: LicReq) => r.pace;

    let hist = '';
    for (let a = a0; a <= histEnd; a++) hist += `${a === a0 ? 'M' : ' L'} ${f1(x(a))} ${f1(y(readyAt(S, a, nowA)))}`;
    const area = `${hist} L ${f1(x(histEnd))} ${B} L ${f1(x(a0))} ${B} Z`;

    let proj = '', cone = '';
    if (!S.done) {
      const pEnd = S.etaM != null ? Math.min(S.etaM, horizon) : horizon;
      for (let t = 0; t <= pEnd; t++) proj += `${t ? ' L' : 'M'} ${f1(x(nowA + t))} ${f1(y(projAt(S, t, usual)))}`;
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
      if (r.m == null || r.m > horizon) return null;
      return { x: x(nowA + r.m), y: y(projAt(S, r.m, usual)) };
    };
    const metPts: { x: number; y: number }[] = [], openPts: { x: number; y: number }[] = [];
    for (const r of S.reqs) {
      if (S.done ? r.metA === S.doneA : r === S.lim) continue;
      const p = pointOf(r);
      if (p) (r.met ? metPts : openPts).push(p);
    }
    const glow = S.done
      ? { x: x(S.doneA ?? nowA), y: y(1) }
      : S.etaM != null ? { x: x(Math.min(nowA + S.etaM, a1)), y: y(projAt(S, Math.min(S.etaM, horizon), usual)) } : null;

    const focusReq = S.reqs.find((r) => r.key === focus) ?? null;
    const fp = focusReq ? pointOf(focusReq) : null;
    const focusText = focusReq
      ? focusReq.met ? `${focusReq.short} met · ${hoursTxt(focusReq.required)} h`
        : `${focusReq.short} · ${hoursTxt(focusReq.toGo < 10 ? Math.ceil(focusReq.toGo * 10) / 10 : Math.ceil(focusReq.toGo))} h to go`
      : '';
    const fw = focusText.length * 6.2 + 18;

    const years: { label: string; x: number }[] = [];
    const y0 = Math.floor(a0 / 12) + 1, y1 = Math.floor(a1 / 12), every = Math.max(1, Math.ceil((y1 - y0 + 1) / 5));
    for (let yr = y0; yr <= y1; yr += every) {
      const xx = x(yr * 12);
      if (xx >= L + 12 && xx <= R - 12) years.push({ label: `’${String(yr).slice(2)}`, x: xx });
    }
    const dots = (pts: { x: number; y: number }[], r: number) =>
      pts.map((p) => `M ${f1(p.x - r)} ${f1(p.y)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`).join(' ');

    body = (
      <>
        <Svg width={W} height={H}>
          <Defs>
            <LinearGradient id="licArea" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={C.primary} stopOpacity={0.22} />
              <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={[0.25, 0.5, 0.75].map((v) => `M ${L} ${f1(y(v))} H ${R}`).join(' ')} fill="none" stroke={C.separator} strokeWidth={1} />
          {cone ? <Path d={cone} fill={C.soft} fillOpacity={0.06} /> : null}
          {!S.done ? <Path d={`M ${f1(x(nowA))} ${T} L ${f1(x(nowA))} ${B}`} fill="none" stroke={C.text2} strokeWidth={1} strokeDasharray="1 3" opacity={0.6} /> : null}
          <Path d={area} fill="url(#licArea)" />
          <Path d={`M ${L} ${f1(y(1))} L ${R} ${f1(y(1))}`} fill="none" stroke={C.quiet} strokeWidth={1.1} strokeDasharray="4 4" />
          {fp ? <Path d={`M ${f1(fp.x)} ${f1(fp.y + 6)} L ${f1(fp.x)} ${B}`} fill="none" stroke={C.text2} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} /> : null}
          {proj ? <Path d={proj} fill="none" stroke={C.soft} strokeWidth={1.8} strokeDasharray="5 4" strokeLinecap="round" opacity={0.85} /> : null}
          <Path d={hist} fill="none" stroke={C.primary} strokeWidth={2.3} strokeLinejoin="round" strokeLinecap="round" />
          {metPts.length ? <Path d={dots(metPts, 3.5)} fill={C.text2} stroke={C.card} strokeWidth={1.5} /> : null}
          {openPts.length ? <Path d={dots(openPts, 3.8)} fill={C.card} stroke={C.text2} strokeWidth={1.6} /> : null}
          {fp ? <Circle cx={fp.x} cy={fp.y} r={5} fill={C.text} stroke={C.card} strokeWidth={2} /> : null}
          {glow ? <Circle cx={glow.x} cy={glow.y} r={8} fill={accent} opacity={0.14} /> : null}
          {glow ? <Circle cx={glow.x} cy={glow.y} r={4} fill={accent} /> : null}
          {!S.done ? <Circle cx={x(nowA)} cy={y(S.ready)} r={5} fill={C.primary} stroke={C.card} strokeWidth={2.5} /> : null}
          {[0.25, 0.5, 0.75].map((v) => (
            <SvgText key={v} x={R + 6} y={y(v) + 3} fontSize={9} fontFamily={MONO} fill={v <= S.ready ? C.muted : C.text2}>{`${v * 100}%`}</SvgText>
          ))}
          {years.map((yr) => (
            <SvgText key={yr.label} x={yr.x} y={B + 14} fontSize={9} fontFamily={MONO} fontWeight="700" fill={C.muted} textAnchor="middle">{yr.label}</SvgText>
          ))}
        </Svg>
        <View pointerEvents="none" style={{
          position: 'absolute', right: 0, top: y(1) - 11, minWidth: 58, height: 22, paddingHorizontal: 6, borderRadius: 7, backgroundColor: accent,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
        }}>
          {S.done ? <Ionicons name="checkmark" size={11} color={C.deep} /> : null}
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.deep }}>{S.code}</Text>
        </View>
        {fp ? (
          <View pointerEvents="none" style={{
            position: 'absolute', left: Math.max(0, Math.min(R - fw, fp.x - fw / 2)), top: fp.y < 40 ? fp.y + 12 : fp.y - 30,
            height: 20, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: C.quiet, backgroundColor: C.deep, justifyContent: 'center',
          }}>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.text }}>{focusText}</Text>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ height: H }} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {body}
    </View>
  );
}
