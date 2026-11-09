// En liten graf per krav i Next licence-listan (helskärmen): timmarna hittills, kravets linje med värdet, i dag, och
// vägen fram till datumet i den valda takten (eller var kravet klarades). Alla krav delar tidsaxeln (a0–a1), men har
// en egen höjdskala, så att 30 h instrument går att läsa bredvid 1 000 h total.

import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import type { InsightsTheme } from './insightsTheme';
import { cumAt, hoursTxt, type LicReq } from './licenceState';

const MONO = 'JetBrainsMono';
const H = 60, PT = 8, PB = 12;
const r1 = (n: number) => Math.round(n * 10) / 10;
const yShort = (a: number) => `’${String(Math.floor(a / 12)).slice(2)}`;

export function LicenceReqMini({ C, r, w, a0, a1, nowA, m, isLim }: {
  C: InsightsTheme; r: LicReq; w: number; a0: number; a1: number; nowA: number;
  m: number | null;      // månader kvar i den valda takten (null = ingen takt eller datumen låsta)
  isLim: boolean;        // kravet sätter datumet
}) {
  const X = (a: number) => r1(1 + ((a - a0) / Math.max(1, a1 - a0)) * (w - 2));
  const yMax = Math.max(r.required, r.have, 1) * 1.18;
  const Y = (h: number) => r1(H - PB - (h / yMax) * (H - PT - PB));
  const pts: string[] = [];
  for (let a = a0; a <= nowA; a++) pts.push(`${X(a)} ${Y(cumAt(r, a, nowA))}`);
  const line = pts.length > 1 ? `M${pts.join(' L')}` : '';
  const nowX = X(nowA), nowY = Y(r.have), tgtY = Y(r.required);
  const color = r.met ? C.text2 : C.primary;
  let years = '';
  const yearLabels: { x: number; t: string }[] = [];
  for (let y = Math.ceil(a0 / 12); y * 12 <= a1; y++) {
    const x = X(y * 12);
    years += `M${x} ${PT} V${H - PB} `;
    if (x < w - 14) yearLabels.push({ x: x + 2, t: yShort(y * 12) });
  }
  const etaX = !r.met && m != null ? X(nowA + m) : null;
  const tgtLabelY = tgtY - 4 < 9 ? tgtY + 10 : tgtY - 4;
  return (
    <Svg width={w} height={H}>
      <Defs>
        <LinearGradient id={`rm${r.key}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.24} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={`M0 0 H${w} V${H} H0 Z`} fill="#0C1A2E" />
      {years ? <Path d={years} stroke="#16273D" strokeWidth={1} /> : null}
      <Line x1={0} y1={tgtY} x2={w} y2={tgtY} stroke={C.quiet} strokeWidth={1} strokeDasharray="3 3" />
      {line ? <Path d={`${line} L${nowX} ${H - PB} L${X(a0)} ${H - PB} Z`} fill={`url(#rm${r.key})`} /> : null}
      {line ? <Path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" /> : null}
      {etaX != null ? <Path d={`M${nowX} ${nowY} L${etaX} ${tgtY}`} stroke={C.soft} strokeOpacity={0.8} strokeWidth={1.4} strokeDasharray="4 3" /> : null}
      {etaX != null ? <Circle cx={etaX} cy={tgtY} r={3.5} fill="#0C1A2E" stroke={isLim ? '#FFFFFF' : C.soft} strokeWidth={1.5} /> : null}
      {r.met && r.metA != null && r.metA >= a0 ? <Circle cx={X(r.metA)} cy={tgtY} r={3.5} fill={C.text2} /> : null}
      <Circle cx={nowX} cy={nowY} r={3} fill={color} />
      <SvgText x={4} y={tgtLabelY} fontFamily={MONO} fontSize={8.5} fontWeight="700" fill={C.text2}>{`${hoursTxt(r.required)} h`}</SvgText>
      {yearLabels.map((l) => <SvgText key={l.t} x={l.x} y={H - 2} fontFamily={MONO} fontSize={7.5} fill="#3E5878">{l.t}</SvgText>)}
    </Svg>
  );
}
