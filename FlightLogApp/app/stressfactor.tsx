// Stressfactor: hur Flight load (arbetsbelastningen) har varierat över tid. Öppnas från dashboardens
// Stressfactor-knapp (pilot och drönare, ?mode=drone). Överst läget just nu i ord, med zonskalan och en markör.
// Under: en kalenderperiod (månad, tre månader eller år) som man stegar bakåt i med pilarna, en graf i procent av
// ditt normala där normalzonen är ett fast band (70–130 %) och zonernas namn står längs kanten, en mening om
// perioden och periodens busy periods. Varje dag räknas som dashboardens siffra gjorde den dagen (utils/workload:
// stressSeries), med samma zoner och färger. Dra fingret i grafen för att se en dag.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions, PanResponder, ActivityIndicator, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Line, Text as SvgText, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { loadZoneColor } from '../components/WorkloadGauge';
import { stressSeries, stressZone, stressFactorSummary, busyPeriods, type StressPoint, type StressZone } from '../utils/workload';
import { getStressDaily } from '../db/flights';
import { getDroneStressDaily } from '../db/drones';
import { formatTimeValue } from '../hooks/useTimeFormat';
import { useTimeFormatStore } from '../store/timeFormatStore';

type Span = 'month' | '3m' | 'year';
const SPANS: { key: Span; label: string }[] = [{ key: 'month', label: 'Month' }, { key: '3m', label: '3 months' }, { key: 'year', label: 'Year' }];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Zonernas gränser (%), samma som stressZone. Grafen slutar vid 250 %, så Critical ritas 200–250.
const MAX_PCT = 250;
const ZONES: { zone: StressZone; from: number; to: number }[] = [
  { zone: 'low', from: 0, to: 30 }, { zone: 'light', from: 30, to: 70 }, { zone: 'normal', from: 70, to: 130 },
  { zone: 'elevated', from: 130, to: 170 }, { zone: 'high', from: 170, to: 200 }, { zone: 'critical', from: 200, to: MAX_PCT },
];
const zoneName = (z: StressZone) => z.charAt(0).toUpperCase() + z.slice(1);

const DAY = 86400000;
const parse = (iso: string) => new Date(iso + 'T00:00:00Z');
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayNum = (iso: string) => Math.round(parse(iso).getTime() / DAY);
const shortDate = (iso: string) => { const d = parse(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const longDate = (iso: string) => { const d = parse(iso); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const periodLabel = (a: string, b: string) => {
  const x = parse(a), y = parse(b);
  const sameYear = x.getUTCFullYear() === y.getUTCFullYear();
  return `${shortDate(a)}${sameYear ? '' : ` ${x.getUTCFullYear()}`} – ${shortDate(b)} ${y.getUTCFullYear()}`;
};

// Kalenderperioden: off = antal steg bakåt från den som innehåller idag.
function periodOf(span: Span, off: number, today: string): { from: string; to: string; label: string } {
  const t = parse(today), y = t.getUTCFullYear(), m = t.getUTCMonth();
  if (span === 'year') return { from: isoOf(Date.UTC(y - off, 0, 1)), to: isoOf(Date.UTC(y - off + 1, 0, 1) - DAY), label: String(y - off) };
  const first = span === 'month' ? m - off : m - 3 * off - 2, last = span === 'month' ? m - off : m - 3 * off;
  const a = new Date(Date.UTC(y, first, 1)), b = new Date(Date.UTC(y, last + 1, 1) - DAY);
  const label = span === 'month'
    ? `${MONTHS_LONG[a.getUTCMonth()]} ${a.getUTCFullYear()}`
    : `${MONTHS[a.getUTCMonth()]}${a.getUTCFullYear() !== b.getUTCFullYear() ? ` ${a.getUTCFullYear()}` : ''} – ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  return { from: isoOf(a.getTime()), to: isoOf(b.getTime()), label };
}

type Period = { from: string; to: string; days: number; peak: number; peakPoint: StressPoint };

export default function StressfactorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { timeFormat } = useTimeFormatStore();
  const [all, setAll] = useState<StressPoint[] | null>(null);
  const [daily, setDaily] = useState<Record<string, number>>({});
  const [span, setSpan] = useState<Span>('3m');
  const [off, setOff] = useState(0);
  const [sel, setSel] = useState<string | null>(null);              // vald dag
  const [selPeriod, setSelPeriod] = useState<string | null>(null);  // vald busy period (första datumet)
  const [how, setHow] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  // Hela historiken räknas en gång (snabbt: ~10 ms för tre år); perioderna är utsnitt.
  useEffect(() => {
    (mode === 'drone' ? getDroneStressDaily() : getStressDaily()).then((d) => {
      const first = Object.keys(d).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort()[0];
      const from = first && first < today ? first : isoOf(Date.now() - 59 * DAY);
      setDaily(d);
      setAll(stressSeries(d, from, today));
    }).catch(() => setAll([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => { setSel(null); setSelPeriod(null); }, [span, off]);

  const period = periodOf(span, off, today);
  const vis = useMemo(() => (all ?? []).filter((p) => p.date >= period.from && p.date <= period.to), [all, period.from, period.to]);
  const periods: Period[] = useMemo(() => busyPeriods(vis).map((p) => {
    const inside = vis.filter((x) => x.date >= p.from && x.date <= p.to);
    return { ...p, peakPoint: inside.reduce((a, b) => (b.index > a.index ? b : a)) };
  }), [vis]);

  const fmtH = (h: number) => formatTimeValue(h, timeFormat);
  const hasData = !!all && all.some((p) => p.hours14 > 0 || p.baseline14 > 0);
  const noBack = !all?.length || period.from <= all[0].date;
  const noFwd = off === 0;
  const flown = Object.entries(daily).reduce((s, [d, h]) => (d >= period.from && d <= period.to ? s + (h || 0) : s), 0);
  const selected = sel ? vis.find((p) => p.date === sel) ?? null : null;

  // Läget just nu, och var på zonskalan det ligger.
  const cur = all && all.length ? all[all.length - 1] : null;
  const curZone = cur ? stressZone(cur.index) : 'low';
  const marker = (() => {
    if (!cur) return 0;
    const v = Math.min(cur.index, MAX_PCT);
    const k = Math.max(0, ZONES.findIndex((z) => z.zone === curZone));
    const z = ZONES[k];
    return ((k + Math.max(0, Math.min(1, (v - z.from) / (z.to - z.from)))) / ZONES.length) * 100;
  })();

  // Perioden i en mening.
  const summary = (() => {
    if (!vis.length) return { title: 'No flight load in this period.', sub: '' };
    const count: Partial<Record<StressZone, number>> = {};
    vis.forEach((p) => { const z = stressZone(p.index); count[z] = (count[z] ?? 0) + 1; });
    const top = (Object.keys(count) as StressZone[]).reduce((a, b) => ((count[b] ?? 0) > (count[a] ?? 0) ? b : a));
    const busy = periods.length ? `, with ${periods.length} busy ${periods.length === 1 ? 'period' : 'periods'}` : '';
    return { title: `Mostly ${top}${busy}.`, sub: `Average ${stressFactorSummary(vis).avg}% · Drag across the chart to see a day.` };
  })();

  const choosePeriod = (p: Period) => {
    Haptics.selectionAsync().catch(() => {});
    const same = selPeriod === p.from;
    setSelPeriod(same ? null : p.from);
    setSel(same ? null : p.peakPoint.date);
  };
  const step = (d: number) => {
    if ((d > 0 && noBack) || (d < 0 && noFwd)) return;
    Haptics.selectionAsync().catch(() => {});
    setOff(off + d);
  };

  return (
    // Arket (iOS) börjar redan under statusfältet → ingen extra marginal där; Android visar sidan i helskärm.
    <View style={[s.root, { paddingTop: Platform.OS === 'ios' ? 6 : insets.top + 8 }]}>
      {Platform.OS === 'ios' && <View style={s.grabber} />}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Stressfactor</Text>
        <View style={s.headerBtn} />
      </View>

      {!all ? (
        <View style={s.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : !hasData || !cur ? (
        <View style={s.center}>
          <Ionicons name="pulse-outline" size={36} color={Colors.textSecondary} />
          <Text style={s.emptyTitle}>No flight load yet</Text>
          <Text style={s.emptyText}>Log or import a few flights and your Stressfactor builds up from there.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 40, gap: 22 }} showsVerticalScrollIndicator={false}>
          {/* Just nu: zonen i ord, timmarna mot ditt normala och markören på zonskalan. */}
          <View style={{ gap: 6 }}>
            <Text style={s.eyebrow}>Right now</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Text style={[s.heroZone, { color: loadZoneColor(curZone) }]}>{zoneName(curZone)}</Text>
              <Text style={[s.heroPct, { color: loadZoneColor(curZone) }]}>{cur.index}%</Text>
            </View>
            <Text style={s.heroSub}>
              {fmtH(cur.hours14)} h in the last 14 days{cur.baseline14 > 0 ? `. Your normal is ${fmtH(cur.baseline14)} h.` : '.'}
            </Text>
            <View style={{ marginTop: 10, gap: 6 }}>
              <View style={s.gauge}>
                {ZONES.map((z) => (
                  <View key={z.zone} style={[s.gaugeSeg, { backgroundColor: loadZoneColor(z.zone), opacity: z.zone === curZone ? 1 : 0.28 }]} />
                ))}
                <View style={[s.gaugeDot, { left: `${marker}%` }]} />
              </View>
              <View style={{ flexDirection: 'row', gap: 3 }}>
                {ZONES.map((z) => (
                  <Text key={z.zone} numberOfLines={1} style={[s.gaugeLabel, { color: z.zone === curZone ? loadZoneColor(z.zone) : Colors.textSecondary }]}>{zoneName(z.zone)}</Text>
                ))}
              </View>
            </View>
          </View>

          <View style={s.rule} />

          <View style={{ gap: 12 }}>
            <View style={s.segment} accessibilityRole="tablist">
              {SPANS.map((x) => {
                const on = span === x.key;
                return (
                  <TouchableOpacity key={x.key} style={[s.segBtn, on && s.segOn]} activeOpacity={0.8} accessibilityRole="tab" accessibilityState={{ selected: on }}
                    onPress={() => { if (!on) { Haptics.selectionAsync().catch(() => {}); setSpan(x.key); setOff(0); } }}>
                    <Text style={[s.segText, on && s.segTextOn]}>{x.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.nav}>
              <TouchableOpacity style={[s.navBtn, noBack && { opacity: 0.35 }]} onPress={() => step(1)} disabled={noBack} accessibilityLabel="Earlier period">
                <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text style={s.navLabel}>{period.label}</Text>
                <Text style={s.navSub}>{period.to > today ? 'So far: ' : ''}{fmtH(flown)} h flown</Text>
              </View>
              <TouchableOpacity style={[s.navBtn, noFwd && { opacity: 0.35 }]} onPress={() => step(-1)} disabled={noFwd} accessibilityLabel="Later period">
                <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <LoadChart points={vis} from={period.from} to={period.to} today={today} span={span} width={width - 32} height={244}
              selected={sel} highlight={periods.find((p) => p.from === selPeriod) ?? null}
              onSelect={(d) => { setSel(d); setSelPeriod(null); }} />

            {selected ? (
              <View style={s.card}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.cardTitle}>{longDate(selected.date)}</Text>
                  <Text style={s.cardSub}>{fmtH(selected.hours14)} h in 14 days · normal {fmtH(selected.baseline14)} h</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.cardPct, { color: loadZoneColor(stressZone(selected.index)) }]}>{selected.index}%</Text>
                  <Text style={[s.cardZone, { color: loadZoneColor(stressZone(selected.index)) }]}>{zoneName(stressZone(selected.index))}</Text>
                </View>
                <TouchableOpacity style={s.clear} onPress={() => { setSel(null); setSelPeriod(null); }} hitSlop={8} accessibilityLabel="Clear the selected day">
                  <Ionicons name="close" size={15} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[s.card, { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
                <Text style={s.cardTitle}>{summary.title}</Text>
                {summary.sub ? <Text style={s.cardSub}>{summary.sub}</Text> : null}
              </View>
            )}
          </View>

          {/* Busy periods: över normalt (130 %) i minst 3 dagar, nyast först. Ett tryck lyser upp perioden i grafen. */}
          <View style={{ gap: 8 }}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Busy periods</Text>
              <Text style={s.sectionMeta}>{periods.length > 6 ? `latest 6 of ${periods.length}` : ''}</Text>
            </View>
            {periods.length === 0 ? (
              <Text style={s.none}>None in this period. A busy period is three days or more above normal.</Text>
            ) : periods.slice(0, 6).map((p) => {
              const c = loadZoneColor(stressZone(p.peak));
              const on = selPeriod === p.from;
              return (
                <TouchableOpacity key={p.from} style={[s.period, on && { borderColor: c, backgroundColor: Colors.elevated }]} activeOpacity={0.75}
                  onPress={() => choosePeriod(p)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.periodTitle}>{periodLabel(p.from, p.to)}</Text>
                    <Text style={s.periodSub}>{p.days} days · up to {fmtH(p.peakPoint.hours14)} h in 14 days</Text>
                  </View>
                  <View style={[s.peakChip, { backgroundColor: c + '24' }]}>
                    <Text style={[s.peakText, { color: c }]}>{p.peak}%</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Förklaringen, hopfälld. */}
          <View style={s.howCard}>
            <TouchableOpacity style={s.howHead} onPress={() => setHow(!how)} activeOpacity={0.75} accessibilityRole="button" accessibilityState={{ expanded: how }}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
              <Text style={s.howTitle}>How Stressfactor works</Text>
              <Ionicons name={how ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            {how && (
              <View style={s.howBody}>
                <Text style={s.howText}>It compares the hours you flew in the last 14 days with your normal 14 days, worked out from the past 12 months with recent months counting more.</Text>
                <Text style={s.howText}>The shaded band is normal (70–130%). Above it you flew more than you normally do, below it less.</Text>
                <Text style={[s.howText, { color: Colors.textSecondary }]}>An awareness cue, not a medical or fitness-to-fly measure.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Grafen ────────────────────────────────────────────────────────────────────
// Y = Stressfactor i procent av ditt normala (0–250 %), X = periodens dagar (även de som inte kommit än, så att man
// ser var idag ligger). Normalzonen är ett fast band; zonernas namn står till vänster i stället för siffror. Linjen
// färgas efter dagens zon. Ett tryck eller drag väljer en dag.

const ZONE_LABEL_AT: Record<StressZone, number> = { low: 15, light: 50, normal: 100, elevated: 150, high: 185, critical: 225 };

function LoadChart({ points, from, to, today, span, width, height, selected, highlight, onSelect }: {
  points: StressPoint[]; from: string; to: string; today: string; span: Span; width: number; height: number;
  selected: string | null; highlight: Period | null; onSelect: (date: string) => void;
}) {
  const L = 58, R = 4, T = 8, B = 22;
  const pw = width - L - R, ph = height - T - B;
  const d0 = dayNum(from), days = Math.max(1, dayNum(to) - d0);
  const x = (iso: string) => L + ((dayNum(iso) - d0) / days) * pw;
  const y = (v: number) => T + (1 - Math.min(Math.max(v, 0), MAX_PCT) / MAX_PCT) * ph;

  // Linjen i bitar efter zon (samma zon i följd → en bit).
  const segs: { d: string; c: string }[] = [];
  points.forEach((p, k) => {
    if (k === 0) return;
    const c = loadZoneColor(stressZone(p.index));
    const prev = points[k - 1];
    const piece = ` L ${x(p.date).toFixed(1)} ${y(p.index).toFixed(1)}`;
    const last = segs[segs.length - 1];
    if (last && last.c === c) last.d += piece;
    else segs.push({ c, d: `M ${x(prev.date).toFixed(1)} ${y(prev.index).toFixed(1)}${piece}` });
  });

  // Tidsaxeln: veckodagar i en månad, månaderna annars.
  const ticks: { at: string; label: string }[] = [];
  const a = parse(from);
  if (span === 'month') [1, 8, 15, 22, 29].forEach((dd) => {
    const at = isoOf(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), dd));
    if (at <= to) ticks.push({ at, label: dd === 1 ? `1 ${MONTHS[a.getUTCMonth()]}` : String(dd) });
  });
  else for (let k = 0; k < (span === 'year' ? 12 : 3); k++) {
    const m = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + k, 1));
    ticks.push({ at: isoOf(m.getTime()), label: MONTHS[m.getUTCMonth()] });
  }

  const lastDate = useRef<string | null>(null);
  const pick = (px: number) => {
    if (!points.length) return;
    const f = Math.max(0, Math.min(1, (px - L) / pw));
    let at = isoOf((d0 + Math.round(f * days)) * DAY);
    if (at < points[0].date) at = points[0].date;
    if (at > points[points.length - 1].date) at = points[points.length - 1].date;
    if (at !== lastDate.current) { lastDate.current = at; Haptics.selectionAsync().catch(() => {}); onSelect(at); }
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
    onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
    onPanResponderTerminationRequest: () => false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, from, to, width]);

  const sp = selected ? points.find((p) => p.date === selected) ?? null : null;
  const last = points.length ? points[points.length - 1] : null;
  const showToday = !!last && last.date === today;

  return (
    <View {...pan.panHandlers} accessibilityLabel="Stressfactor chart. Drag across it to see a day.">
      <Svg width={width} height={height}>
        {/* Normalzonen som ett fast band, och tunna gränser mellan de andra zonerna. */}
        <Rect x={L} y={y(130)} width={pw} height={y(70) - y(130)} rx={6} fill={loadZoneColor('normal')} opacity={0.1} />
        {[30, 170, 200].map((v) => (
          <Line key={v} x1={L} x2={L + pw} y1={y(v)} y2={y(v)} stroke="#FFFFFF" strokeOpacity={0.06} strokeWidth={1} />
        ))}
        <Line x1={L} x2={L + pw} y1={T + ph} y2={T + ph} stroke="#FFFFFF" strokeOpacity={0.14} strokeWidth={1} />
        {ZONES.map((z) => (
          <SvgText key={z.zone} x={L - 8} y={y(ZONE_LABEL_AT[z.zone]) + 3.5} fontSize={9} fontWeight="700" letterSpacing={0.6}
            fill={loadZoneColor(z.zone)} fillOpacity={z.zone === 'normal' ? 0.95 : 0.7} textAnchor="end">{z.zone.toUpperCase()}</SvgText>
        ))}

        {highlight && (
          <Rect x={x(highlight.from) - 3} y={T} width={Math.max(6, x(highlight.to) - x(highlight.from) + 6)} height={ph} rx={4}
            fill={loadZoneColor(stressZone(highlight.peak))} opacity={0.14} />
        )}

        {segs.map((sg, k) => (
          <Path key={k} d={sg.d} stroke={sg.c} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {ticks.map((t) => (
          <SvgText key={t.at} x={x(t.at) + 1} y={height - 5} fontSize={10} fontWeight="600" fill={Colors.textSecondary} textAnchor="start">{t.label}</SvgText>
        ))}

        {showToday && last && (
          <>
            <Circle cx={x(last.date)} cy={y(last.index)} r={8} fill={loadZoneColor(stressZone(last.index))} opacity={0.25} />
            <Circle cx={x(last.date)} cy={y(last.index)} r={4} fill={loadZoneColor(stressZone(last.index))} stroke={Colors.background} strokeWidth={1.5} />
          </>
        )}
        {sp && (
          <>
            <Line x1={x(sp.date)} x2={x(sp.date)} y1={T} y2={T + ph} stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1} />
            <Circle cx={x(sp.date)} cy={y(sp.index)} r={5} fill="#FFFFFF" stroke={Colors.background} strokeWidth={2} />
          </>
        )}
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, marginBottom: 2 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 4 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  eyebrow: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  heroZone: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  heroPct: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'], opacity: 0.85 },
  heroSub: { color: Colors.textPrimary, opacity: 0.85, fontSize: 15, lineHeight: 21 },
  gauge: { flexDirection: 'row', gap: 3, height: 8 },
  gaugeSeg: { flex: 1, borderRadius: 4 },
  gaugeDot: { position: 'absolute', top: -4, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: Colors.background },
  gaugeLabel: { flex: 1, fontSize: 10.5, fontWeight: '700' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  segment: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: Colors.card },
  segBtn: { flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: Colors.primary },
  segText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
  segTextOn: { color: Colors.textInverse },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  navLabel: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  navSub: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  cardTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  cardSub: { color: Colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  cardPct: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cardZone: { fontSize: 12, fontWeight: '800' },
  clear: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.elevated, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800' },
  sectionMeta: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  none: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  period: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  periodTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  periodSub: { color: Colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  peakChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  peakText: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  howCard: { borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  howHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16 },
  howTitle: { flex: 1, color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  howBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  howText: { color: Colors.textPrimary, opacity: 0.85, fontSize: 14, lineHeight: 20 },
});
