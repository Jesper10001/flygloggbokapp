// Kumulativ flygtid (Y) över tid (X) + framtidsprojektion (streckad gold) mot ett mål.
import Svg, { Path, Line as SvgLine, Circle, Defs, LinearGradient, Stop, Text as SvgText, G } from 'react-native-svg';
import { View, Text } from 'react-native';
import type { InsightsTheme } from './insightsTheme';
import type { JourneyPt } from './insightsData';

const MONO = 'JetBrainsMono';

export function JourneyChart({ C, series, goal, rate }: { C: InsightsTheme; series: JourneyPt[]; goal: number | null; rate: number }) {
  if (series.length < 2) {
    return <Text style={{ fontFamily: MONO, fontSize: 10, color: C.faint, textAlign: 'center', paddingVertical: 24 }}>Not enough history yet.</Text>;
  }
  const now = series[series.length - 1];
  const proj: JourneyPt[] = [];
  if (goal && goal > now.cum && rate > 0) {
    let cum = now.cum; const d = new Date(now.date); let g = 0;
    proj.push({ date: new Date(d), cum });
    while (cum < goal && g++ < 600) { cum += rate; d.setMonth(d.getMonth() + 1); proj.push({ date: new Date(d), cum: Math.min(cum, goal) }); }
  }
  const W = 320, H = 176, padL = 36, padB = 26, padT = 10, padR = 10;
  const t0 = series[0].date.getTime();
  const tEnd = (proj.length ? proj[proj.length - 1].date : now.date).getTime();
  const yMax = ((goal && goal > now.cum ? goal : now.cum) * 1.08) || 1;
  const x = (d: Date) => padL + ((d.getTime() - t0) / (tEnd - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / yMax) * (H - padB - padT);
  const line = (pts: JourneyPt[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(p.date).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(' ');
  const actualPath = line(series);
  const projPath = proj.length ? line(proj) : '';
  const area = `${actualPath} L ${x(now.date).toFixed(1)} ${H - padB} L ${x(series[0].date).toFixed(1)} ${H - padB} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  const years: Date[] = [];
  const y0 = series[0].date.getFullYear(), y1 = new Date(tEnd).getFullYear();
  const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 10));
  for (let yr = y0; yr <= y1; yr++) if ((yr - y0) % step === 0) years.push(new Date(yr, 0, 1));

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="inJourney" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={C.primary} stopOpacity={0.28} />
            <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {yTicks.map((v, i) => (
          <G key={i}>
            <SvgLine x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={C.separator} strokeWidth={1} />
            <SvgText x={padL - 6} y={y(v) + 3} fontSize={8} fontFamily={MONO} fill={C.muted} textAnchor="end">{v}</SvgText>
          </G>
        ))}
        {years.map((d, i) => (x(d) >= padL - 1 && x(d) <= W - padR + 1
          ? <SvgText key={i} x={x(d)} y={H - 8} fontSize={8} fontFamily={MONO} fontWeight="700" fill={C.faint} textAnchor="middle">{d.getFullYear()}</SvgText>
          : null))}
        {projPath ? <Path d={projPath} fill="none" stroke={C.gold} strokeWidth={2} strokeLinecap="round" strokeDasharray="4 4" opacity={0.95} /> : null}
        {goal && goal > now.cum && proj.length ? (
          <G>
            <SvgLine x1={padL} y1={y(goal)} x2={W - padR} y2={y(goal)} stroke={C.gold} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
            <Circle cx={x(proj[proj.length - 1].date)} cy={y(goal)} r={4} fill={C.gold} />
          </G>
        ) : null}
        <Path d={area} fill="url(#inJourney)" />
        <Path d={actualPath} fill="none" stroke={C.primary} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={x(now.date)} cy={y(now.cum)} r={4.5} fill={C.primary} stroke={C.card} strokeWidth={2} />
      </Svg>
    </View>
  );
}
