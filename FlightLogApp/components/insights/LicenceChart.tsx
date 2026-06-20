// En kurva per krav över tid; cirkel vid projicerad/uppnådd 100%, target-linje +
// datum. Krav på 0 h plottas inte. Delas av LicenceJourney och GoalCard (custom).
import Svg, { Path, Line as SvgLine, Circle, Text as SvgText, G } from 'react-native-svg';
import { View, Text } from 'react-native';
import type { InsightsTheme } from './insightsTheme';
import type { JourneyPt } from './insightsData';

const MONO = 'JetBrainsMono';
export interface Req { label: string; key: string; required: number }

export function LicenceChart({ C, reqs, journey, haveFor, rateFor, metDateFor }: {
  C: InsightsTheme; reqs: Req[]; journey: JourneyPt[];
  haveFor: (k: string) => number; rateFor: (k: string) => number;
  metDateFor?: (k: string, required: number) => string | null;
}) {
  if (journey.length < 2) {
    return <Text style={{ fontFamily: MONO, fontSize: 10, color: C.faint, textAlign: 'center', paddingVertical: 24 }}>Not enough history yet.</Text>;
  }
  const careerStart = journey[0].date, now = journey[journey.length - 1].date;
  const mBetween = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const addM = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; };
  const fmtD = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const careerMonths = Math.max(1, mBetween(careerStart, now));
  const COLORS = [C.primary, C.gold, C.success, C.purple, '#5DA9FF', C.danger];

  const built = reqs.map((r, i) => {
    const have = haveFor(r.key);
    if (have <= 0) return null;
    const met = have >= r.required;
    const slopeHist = have / careerMonths;
    const rate = rateFor(r.key) || slopeHist || 1;
    const md = met ? metDateFor?.(r.key, r.required) : null;
    const completion = met ? (md ? new Date(md) : addM(careerStart, r.required / (slopeHist || 1))) : addM(now, (r.required - have) / rate);
    return { ...r, have, met, completion, color: COLORS[i % COLORS.length], normNow: have / r.required };
  }).filter(Boolean) as (Req & { have: number; met: boolean; completion: Date; color: string; normNow: number })[];

  if (!built.length) {
    return <Text style={{ fontFamily: MONO, fontSize: 10, color: C.faint, textAlign: 'center', paddingVertical: 24 }}>Log some hours to see the projection.</Text>;
  }

  const futureMax = built.reduce((mx, r) => (r.completion > mx ? r.completion : mx), now);
  const t0 = careerStart.getTime(), t1 = futureMax.getTime();
  const W = 320, H = 188, padL = 8, padR = 8, padT = 14, padB = 30;
  const yMaxPct = 1.25;
  const x = (d: Date) => padL + ((d.getTime() - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (pct: number) => padT + (1 - Math.min(pct, yMaxPct) / yMaxPct) * (H - padT - padB);
  const y100 = y(1);
  const years: Date[] = [];
  const yr0 = careerStart.getFullYear(), yr1 = futureMax.getFullYear();
  const step = Math.max(1, Math.ceil((yr1 - yr0 + 1) / 8));
  for (let yr = yr0; yr <= yr1; yr++) if ((yr - yr0) % step === 0) years.push(new Date(yr, 0, 1));

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <SvgLine x1={padL} y1={y100} x2={W - padR} y2={y100} stroke={C.gold} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
        <SvgText x={padL} y={y100 - 4} fontSize={7.5} fontFamily={MONO} fontWeight="700" fill={C.gold} textAnchor="start">TARGET 100%</SvgText>
        {years.map((d, i) => (
          <G key={i}>
            <SvgLine x1={x(d)} y1={padT} x2={x(d)} y2={H - padB} stroke={C.separator} strokeWidth={1} />
            <SvgText x={x(d)} y={H - padB + 12} fontSize={8} fontFamily={MONO} fontWeight="700" fill={C.faint} textAnchor="middle">{d.getFullYear()}</SvgText>
          </G>
        ))}
        <SvgLine x1={x(now)} y1={padT} x2={x(now)} y2={H - padB} stroke={C.text3} strokeWidth={1} strokeDasharray="1 3" opacity={0.5} />
        <SvgText x={x(now)} y={padT - 4} fontSize={7} fontFamily={MONO} fontWeight="700" fill={C.text3} textAnchor="middle">NOW</SvgText>
        {built.map((r, i) => {
          const histPath = r.met ? `M ${x(careerStart)} ${y(0)} L ${x(r.completion)} ${y100}` : `M ${x(careerStart)} ${y(0)} L ${x(now)} ${y(r.normNow)}`;
          const projPath = !r.met ? `M ${x(now)} ${y(r.normNow)} L ${x(r.completion)} ${y100}` : '';
          return (
            <G key={i}>
              <Path d={histPath} fill="none" stroke={r.color} strokeWidth={2} strokeLinecap="round" />
              {projPath ? <Path d={projPath} fill="none" stroke={r.color} strokeWidth={1.6} strokeDasharray="3 3" opacity={0.85} /> : null}
              <Circle cx={x(r.completion)} cy={y100} r={4.5} fill={r.met ? r.color : C.deep} stroke={r.color} strokeWidth={2} />
            </G>
          );
        })}
      </Svg>
      <View style={{ gap: 6, marginTop: 10 }}>
        {built.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: r.met ? r.color : C.deep, borderWidth: 2, borderColor: r.color }} />
            <Text style={{ flex: 1, fontSize: 12, color: C.text2 }}>{r.label}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.text, minWidth: 64, textAlign: 'right' }}>
              {Math.round(r.have)}<Text style={{ color: C.muted, fontWeight: '400' }}>/{r.required}h</Text>
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: r.met ? C.success : C.muted, minWidth: 64, textAlign: 'right' }}>
              {r.met ? `✓ ${fmtD(r.completion)}` : `→ ${fmtD(r.completion)}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
