// Insights: fyra lika förhandsvisningar i ett rutnät 2 × 2 — Projections och Next licence överst, Longest XC och
// Best week under. Samma byggsätt i alla: en bild i hela rutan (kurva eller karta), rubriken överst, värdet nederst
// med LED-siffror. Rutorna går inte att dra i; ett tryck öppnar helskärmen (Projections, Next licence) eller
// milstolpens sida (Premium). Kartorna är Apple-kartan utan linjer och markörer.

import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native';
import Svg, { Path, Circle, Line, Rect, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { router } from 'expo-router';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, projectionUnlock, fmtIntH, PROJECTION_MIN_FLIGHTS, PROJECTION_MIN_DAYS } from './insightsData';
import { projectionModel, useProjectionView, absNow, mLabel, labelOf, one, led } from './projectionModel';
import { buildState, readyAt, type LicState } from './licenceState';
import { useLicenceSet, useLicenceView, LIC_IDS, type LicId } from './licenceView';
import { StaticMap, regionFor } from '../milestones/MilestoneMap';
import { useFlightStore } from '../../store/flightStore';
import { useBestWeekDetails, useLongestXcLegs } from '../../hooks/useMilestoneDetails';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import { presentPaywall } from '../../services/purchases';

const MONO = 'JetBrainsMono';
const H = 214;                       // rutornas höjd; kurvorna ritas i ett rutnät 177 brett som skalas med rutan
const LABEL = '#9DBAD6';
const CARD = '#0F1E3A';
const MAP_SCRIM = '#08101E';
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const yShort = (a: number) => `’${String(Math.floor(a / 12)).slice(2)}`;
const dayShort = (d: Date) => `${d.getDate()} ${MON3[d.getMonth()]}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function InsightsPreviews() {
  const { width } = useWindowDimensions();
  const w = (width - 24 - 12) / 2;   // Insights har 12 pt kant, 12 pt mellan rutorna
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <ProjectionsTile w={w} />
        <LicenceTile w={w} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <LongestXcTile />
        <BestWeekTile />
      </View>
    </View>
  );
}

// ── Gemensamt skal ────────────────────────────────────────────────────────────────────────

function Tile({ title, right, rightColor, value, valueColor, unit, unitColor, sub, onPress, a11y, background, scrim, extra, bg }: {
  title: string; right?: string; rightColor?: string; value: string; valueColor?: string; unit?: string; unitColor?: string;
  sub: string; onPress?: () => void; a11y: string; background: React.ReactNode; scrim: string; extra?: React.ReactNode; bg: string;
}) {
  const C = useInsightsTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={a11y}
      style={({ pressed }) => [st.tile, { borderColor: C.border, backgroundColor: bg, transform: [{ scale: pressed ? 0.97 : 1 }] } as ViewStyle]}>
      {background}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="tileScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={scrim} stopOpacity={0.88} />
            <Stop offset="0.21" stopColor={scrim} stopOpacity={0} />
            <Stop offset="0.56" stopColor={scrim} stopOpacity={0} />
            <Stop offset="0.86" stopColor={scrim} stopOpacity={0.95} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tileScrim)" />
      </Svg>
      <View style={st.head} pointerEvents="none">
        <Text numberOfLines={1} style={st.title}>{title}</Text>
        {right ? <Text numberOfLines={1} style={[st.right, rightColor ? { color: rightColor } : null]}>{right}</Text> : null}
      </View>
      {extra}
      <View style={st.foot} pointerEvents="none">
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
          <Text numberOfLines={1} style={[st.led, valueColor ? { color: valueColor } : null]}>{value}</Text>
          {unit ? <Text numberOfLines={1} style={[st.unit, { color: unitColor ?? C.primary }]}>{unit}</Text> : null}
        </View>
        <Text numberOfLines={1} style={st.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

// ── Projections ───────────────────────────────────────────────────────────────────────────

function ProjectionsTile({ w }: { w: number }) {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const flights = useFlightStore((s) => s.flights);
  const unlock = useMemo(() => projectionUnlock(flights), [flights]);
  const view = useProjectionView();
  const nowA = absNow();
  const M = projectionModel(D, view, nowA);
  const sx = w / 177, top = 56, bottom = 196, nowX = 100 * sx;

  // Kurvan: de senaste tre åren fram till i dag, skalad mot målet; streckad vidare mot målet.
  const s = M.series.slice(-37);
  const yOf = (h: number) => r1(bottom - (Math.min(h, M.tgt) / Math.max(1, M.tgt)) * (bottom - top));
  const pts = s.map((p, i) => [r1((s.length > 1 ? i / (s.length - 1) : 1) * nowX), yOf(p.cum)] as const);
  const line = pts.length ? `M${pts.map((p) => `${p[0]} ${p[1]}`).join(' L')}` : '';
  const nowY = pts.length ? pts[pts.length - 1][1] : bottom;
  const tgtX = 170 * sx;

  if (!unlock.ready) {
    const flightsLeft = Math.max(0, PROJECTION_MIN_FLIGHTS - unlock.flights);
    const daysLeft = Math.max(0, PROJECTION_MIN_DAYS - unlock.days);
    return (
      <View style={{ flex: 1 }}>
        <Tile title="PROJECTIONS" right={`${unlock.flights}/${PROJECTION_MIN_FLIGHTS} flights`} rightColor={LABEL} bg={CARD} scrim={CARD}
          value={String(flightsLeft || daysLeft)} valueColor="#CFE0EE" unit={flightsLeft ? 'flights to go' : 'days to go'} unitColor={LABEL}
          sub={unlock.unlockDate && daysLeft ? `Unlocks ${dayShort(unlock.unlockDate)}` : 'Unlocks soon'}
          a11y={`Projections unlock after ${flightsLeft} more flights${daysLeft ? ` and ${daysLeft} days` : ''}`}
          background={
            <Svg width={w} height={H} style={StyleSheet.absoluteFill}>
              <Path d={`M0 91 H${w} M0 126 H${w} M0 161 H${w}`} stroke="#1C2E47" strokeWidth={1} />
              <Line x1={0} y1={top} x2={w} y2={top} stroke="#2C3B50" strokeWidth={1} strokeDasharray="3 4" />
              {line ? <Path d={line} fill="none" stroke={C.quiet} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
            </Svg>
          } />
      </View>
    );
  }

  const etaA = M.etaM != null ? nowA + M.etaM : null;
  const kind = view.metric === 'total' ? '' : `${labelOf(view.metric)} · `;
  return (
    <View style={{ flex: 1 }}>
      <Tile title="PROJECTIONS" right={M.pace > 0 ? `${one(M.pace)} h/mo` : undefined} bg={CARD} scrim={CARD}
        value={led(M.have)} unit={`/ ${fmtIntH(M.tgt)} h`} sub={`${kind}${etaA != null ? `ETA ${mLabel(etaA)}` : 'No pace yet'}`}
        a11y={`Projections: ${fmtIntH(M.have)} of ${fmtIntH(M.tgt)} hours${etaA != null ? `, ETA ${mLabel(etaA)}` : ''}. Open full screen`}
        onPress={() => router.push('/projections-full')}
        background={
          <Svg width={w} height={H} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.primary} stopOpacity={0.3} />
                <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={`M0 91 H${w} M0 126 H${w} M0 161 H${w}`} stroke="#1C2E47" strokeWidth={1} />
            <SvgText x={w - 6} y={122} textAnchor="end" fontFamily={MONO} fontSize={8.5} fill="#56708E">{fmtIntH(M.tgt / 2)}</SvgText>
            <Line x1={nowX} y1={top} x2={nowX} y2={H} stroke={C.quiet} strokeWidth={1} strokeDasharray="1 3" />
            {M.etaM != null ? <Path d={`M${nowX} ${nowY} L${w} ${top - 14} L${w} ${top + 40} Z`} fill={C.soft} fillOpacity={0.08} /> : null}
            <Line x1={0} y1={top} x2={w} y2={top} stroke={C.quiet} strokeWidth={1} strokeDasharray="3 4" />
            {line ? <Path d={`${line} L${nowX} ${H} L0 ${H} Z`} fill="url(#pvFill)" /> : null}
            {line ? <Path d={line} fill="none" stroke={C.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
            {M.etaM != null ? <Path d={`M${nowX} ${nowY} L${tgtX} ${top}`} stroke={C.soft} strokeOpacity={0.75} strokeWidth={1.6} strokeDasharray="4 4" /> : null}
            <Circle cx={nowX} cy={nowY} r={7} fill={C.primary} fillOpacity={0.22} />
            <Circle cx={nowX} cy={nowY} r={3.5} fill={C.primary} />
            <Rect x={w - 46} y={top - 8} width={40} height={16} rx={8} fill={C.soft} />
            <SvgText x={w - 26} y={top + 3.5} textAnchor="middle" fontFamily={MONO} fontSize={9} fontWeight="700" fill={C.deep}>{fmtIntH(M.tgt)}</SvgText>
          </Svg>
        } />
    </View>
  );
}

// ── Next licence ──────────────────────────────────────────────────────────────────────────

function LicenceTile({ w }: { w: number }) {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const { standard, flights, set } = useLicenceSet();
  const unlock = useMemo(() => projectionUnlock(flights), [flights]);

  if (standard === 'other' || !set) {
    return (
      <View style={{ flex: 1 }}>
        <Tile title="NEXT LICENCE" bg={CARD} scrim={CARD} value="—" valueColor={C.quiet} sub="Choose EASA, FAA or CAA"
          a11y="Licence tracking isn't available for the Other framework" background={null} />
      </View>
    );
  }

  const nowA = absNow();
  const startA = D.journey.length ? D.journey[0].date.getFullYear() * 12 + D.journey[0].date.getMonth() : nowA;
  const states: Record<LicId, LicState> = { ppl: buildState(set.ppl, D, nowA), cpl: buildState(set.cpl, D, nowA), atpl: buildState(set.atpl, D, nowA) };
  const current = LIC_IDS.find((id) => !states[id].done) ?? 'atpl';
  const S = states[current];
  const locked = !unlock.ready && !S.done;
  const readyPct = S.done ? 100 : Math.min(99, Math.floor(S.ready * 100));
  const etaA = S.etaM != null ? nowA + S.etaM : null;

  // Hur redo över tid (de senaste tre åren), streckad vidare mot 100 %, med ringar för kraven.
  const sx = w / 177, top = 66, bottom = 196, nowX = 100 * sx, endX = 170 * sx;
  const a0 = Math.max(startA, nowA - 36);
  const span = Math.max(1, nowA - a0);
  const xOf = (a: number) => r1(((a - a0) / span) * nowX);
  const yOf = (p: number) => r1(bottom - p * (bottom - top));
  const pts: string[] = [];
  for (let a = a0; a <= nowA; a++) pts.push(`${xOf(a)} ${yOf(readyAt(S, a, nowA))}`);
  const line = pts.length > 1 ? `M${pts.join(' L')}` : '';
  const nowY = yOf(S.done ? 1 : S.ready);
  const showAhead = !S.done && !locked && S.etaM != null && S.etaM > 0;
  const metRings = S.reqs.filter((r) => r.metA != null && r.metA >= a0 && r.metA <= nowA).map((r) => ({ key: r.key, x: xOf(r.metA!), y: yOf(readyAt(S, r.metA!, nowA)) }));
  const openRings = showAhead
    ? S.open.filter((r) => r.m != null && r.m > 0 && r.m < (S.etaM ?? 0)).map((r) => {
      const t = (r.m ?? 0) / (S.etaM ?? 1);
      return { key: r.key, x: r1(nowX + (endX - nowX) * t), y: r1(nowY + (top - nowY) * t) };
    })
    : [];
  const sub = S.done ? `${S.code} · Done` : locked ? `${S.code} · dates later` : etaA != null ? `${S.code} · ${mLabel(etaA)}` : `${S.code} · no pace yet`;

  // Stegen PPL · CPL · ATPL: klara med år, den pågående med hur redo man är.
  const ladder = (
    <View style={[st.ladder]} pointerEvents="none">
      {LIC_IDS.map((id) => {
        const L = states[id], cur = id === current && !L.done;
        const code = L.code.replace(/\s*\(.*\)$/, '');
        return (
          <View key={id} style={{ flex: 1, gap: 3 }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: '#22344F', overflow: 'hidden' }}>
              <View style={{ width: `${L.done ? 100 : Math.min(99, Math.floor(L.ready * 100))}%`, height: '100%', backgroundColor: L.done ? C.text2 : cur ? C.primary : C.quiet }} />
            </View>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: cur ? C.text : L.done ? C.text2 : C.quiet }}>
              {L.done && L.doneA != null ? `${code} ${yShort(L.doneA)}` : code}
            </Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Tile title="NEXT LICENCE" right={`${S.metCount}/${S.reqs.length} met`} bg={CARD} scrim={CARD}
        value={String(readyPct)} unit={S.done ? '%' : '% ready'} sub={sub} extra={ladder}
        a11y={`Next licence: ${S.code}, ${readyPct} percent ready${!locked && etaA != null ? `, ETA ${mLabel(etaA)}` : ''}. Open full screen`}
        onPress={() => { useLicenceView.setState({ sel: null }); router.push('/licence-full'); }}
        background={
          <Svg width={w} height={H} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="lvFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.primary} stopOpacity={0.3} />
                <Stop offset="1" stopColor={C.primary} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={`M0 ${yOf(0.75)} H${w} M0 ${yOf(0.5)} H${w} M0 ${yOf(0.25)} H${w}`} stroke="#1C2E47" strokeWidth={1} />
            <SvgText x={w - 6} y={yOf(0.75) - 4} textAnchor="end" fontFamily={MONO} fontSize={8.5} fill="#56708E">75%</SvgText>
            <SvgText x={w - 6} y={yOf(0.5) - 4} textAnchor="end" fontFamily={MONO} fontSize={8.5} fill="#56708E">50%</SvgText>
            <Line x1={nowX} y1={top} x2={nowX} y2={H} stroke={C.quiet} strokeWidth={1} strokeDasharray="1 3" />
            <Line x1={0} y1={top} x2={w} y2={top} stroke={C.quiet} strokeWidth={1} strokeDasharray="3 4" />
            {line ? <Path d={`${line} L${nowX} ${H} L0 ${H} Z`} fill="url(#lvFill)" /> : null}
            {line ? <Path d={line} fill="none" stroke={C.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
            {showAhead ? <Path d={`M${nowX} ${nowY} L${endX} ${top}`} stroke={C.soft} strokeOpacity={0.75} strokeWidth={1.6} strokeDasharray="4 4" /> : null}
            {metRings.map((r) => <Circle key={r.key} cx={r.x} cy={r.y} r={3} fill={CARD} stroke={C.text2} strokeWidth={1.5} />)}
            {openRings.map((r) => <Circle key={r.key} cx={r.x} cy={r.y} r={3} fill={CARD} stroke={C.soft} strokeOpacity={0.8} strokeWidth={1.4} />)}
            <Circle cx={nowX} cy={nowY} r={7} fill={C.primary} fillOpacity={0.22} />
            <Circle cx={nowX} cy={nowY} r={3.5} fill={C.primary} />
          </Svg>
        } />
    </View>
  );
}

// ── Longest XC och Best week: kartan utan linjer och markörer ─────────────────────────────

function LongestXcTile() {
  const st0 = useFlightStore((s) => s.stats);
  const isPremium = useFlightStore((s) => s.isPremium);
  const isMax = useFlightStore((s) => s.isMax);
  const legs = useLongestXcLegs(st0?.longest_xc_date || undefined);
  const nm = Math.round(st0?.longest_xc_km ?? 0);   // fältet lagrar nautiska mil
  const date = st0?.longest_xc_date ? new Date(`${st0.longest_xc_date.slice(0, 10)}T12:00:00`) : null;
  const has = nm > 0 && !!st0?.longest_xc_id;
  const route = has ? `${st0?.longest_xc_first_dep || '—'} → ${st0?.longest_xc_last_arr || '—'}` : 'No cross-country yet';
  return (
    <View style={{ flex: 1 }}>
      <Tile title="LONGEST XC" bg="#0A1524" scrim={MAP_SCRIM}
        value={has ? nm.toLocaleString('en-US') : '—'} valueColor={has ? undefined : '#4A5C72'} unit="NM" unitColor={has ? undefined : '#4A5C72'}
        sub={has && date ? `${route} · ${dayShort(date)}` : route}
        a11y={has ? `Longest cross-country: ${nm} nautical miles, ${route}. Open` : 'Longest cross-country: none yet'}
        onPress={has ? () => { if (!(isPremium || isMax)) { presentPaywall('Longest XC'); return; } router.push('/milestones/longest-xc'); } : undefined}
        background={<StaticMap region={regionFor(legs)} style={StyleSheet.absoluteFill} />} />
    </View>
  );
}

function BestWeekTile() {
  const st0 = useFlightStore((s) => s.stats);
  const isPremium = useFlightStore((s) => s.isPremium);
  const isMax = useFlightStore((s) => s.isMax);
  const details = useBestWeekDetails(st0?.best_week_start || undefined);
  const hours = st0?.best_week_hours ?? 0;
  const has = hours > 0 && !!st0?.best_week_start;
  const coords = Object.values(details.geo?.coords ?? {});
  const week = (st0?.best_week_label || '').split(' · ')[0].replace(/^W/, 'Week ');
  const sub = has ? [week, details.sectors ? `${details.sectors} ${details.sectors === 1 ? 'sector' : 'sectors'}` : ''].filter(Boolean).join(' · ') : 'Fly a week to set it';
  return (
    <View style={{ flex: 1 }}>
      <Tile title="BEST WEEK" bg="#0A1524" scrim={MAP_SCRIM}
        value={has ? decimalToHHMM(hours) : '--:--'} valueColor={has ? undefined : '#4A5C72'} unit="h" unitColor={has ? undefined : '#4A5C72'}
        sub={sub} a11y={has ? `Best week: ${decimalToHHMM(hours)} hours, ${sub}. Open` : 'Best week: none yet'}
        onPress={has ? () => { if (!(isPremium || isMax)) { presentPaywall('Best week'); return; } router.push('/milestones/best-week'); } : undefined}
        background={<StaticMap region={regionFor(coords)} style={[StyleSheet.absoluteFill, { opacity: has ? 1 : 0.45 }]} />} />
    </View>
  );
}

const st = StyleSheet.create({
  tile: { height: H, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  head: { position: 'absolute', left: 14, right: 14, top: 14, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  title: { flexShrink: 1, fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6, color: LABEL },
  right: { fontFamily: MONO, fontSize: 10, fontWeight: '700', color: '#CFE0EE' },
  ladder: { position: 'absolute', left: 14, right: 14, top: 34, flexDirection: 'row', gap: 4 },
  foot: { position: 'absolute', left: 14, right: 14, bottom: 14, gap: 5 },
  led: { fontFamily: FONT_LED7, fontSize: 30, fontWeight: '800', color: '#FFFFFF', lineHeight: 32 },
  unit: { flexShrink: 1, fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  sub: { fontFamily: MONO, fontSize: 11, color: LABEL },
});
