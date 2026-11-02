// Stressfactor: hur Flight load (arbetsbelastningen) har varierat över tid. Öppnas från dashboardens
// Stressfactor-knapp (pilot och drönare, ?mode=drone). Y = Flight load i procent av ditt normala tempo,
// X = tid. Varje dag räknas som dashboardens siffra gjorde den dagen (utils/workload: stressSeries), med samma
// zoner och färger. Fokus på grafen och de intensiva perioderna (busy periods): perioderna skuggas i grafen,
// och ett tryck i listan lyser upp perioden. Dra fingret i grafen för att se en dag.

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

type Range = '2M' | '6M' | '1Y' | 'All';
const RANGE_DAYS: Record<Exclude<Range, 'All'>, number> = { '2M': 60, '6M': 182, '1Y': 365 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Zonernas gränser (%), samma som stressZone.
const BANDS: { zone: StressZone; from: number; to: number }[] = [
  { zone: 'low', from: 0, to: 30 }, { zone: 'light', from: 30, to: 70 }, { zone: 'normal', from: 70, to: 130 },
  { zone: 'elevated', from: 130, to: 170 }, { zone: 'high', from: 170, to: 200 }, { zone: 'critical', from: 200, to: 10000 },
];

const DAY = 86400000;
const parse = (iso: string) => new Date(iso + 'T00:00:00Z');
const shortDate = (iso: string) => { const d = parse(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const longDate = (iso: string) => { const d = parse(iso); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const periodLabel = (a: string, b: string) => {
  const x = parse(a), y = parse(b);
  const sameYear = x.getUTCFullYear() === y.getUTCFullYear();
  return `${shortDate(a)}${sameYear ? '' : ` ${x.getUTCFullYear()}`} – ${shortDate(b)} ${y.getUTCFullYear()}`;
};

type Period = { from: string; to: string; days: number; peak: number; i0: number; i1: number; peakIdx: number };

export default function StressfactorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { timeFormat } = useTimeFormatStore();
  const [all, setAll] = useState<StressPoint[] | null>(null);
  const [range, setRange] = useState<Range>('2M');
  const [sel, setSel] = useState<number | null>(null);
  const [selPeriod, setSelPeriod] = useState<string | null>(null);   // periodens första datum

  // Hela historiken räknas en gång (snabbt: ~10 ms för tre år); intervallen är utsnitt.
  useEffect(() => {
    (mode === 'drone' ? getDroneStressDaily() : getStressDaily()).then((daily) => {
      const today = new Date().toISOString().slice(0, 10);
      const first = Object.keys(daily).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0];
      const from = first && first < today ? first : new Date(Date.now() - 59 * DAY).toISOString().slice(0, 10);
      setAll(stressSeries(daily, from, today));
    }).catch(() => setAll([]));
  }, [mode]);

  const points = useMemo(() => {
    if (!all) return [];
    return range === 'All' ? all : all.slice(-RANGE_DAYS[range]);
  }, [all, range]);
  const summary = stressFactorSummary(all ? all.slice(-60) : []);
  // Perioderna med sina index i grafen (för skuggningen och för att välja toppen).
  const periods: Period[] = useMemo(() => busyPeriods(points).map((p) => {
    const i0 = points.findIndex((x) => x.date === p.from), i1 = points.findIndex((x) => x.date === p.to);
    let peakIdx = i0;
    for (let i = i0; i <= i1; i++) if (points[i].index > points[peakIdx].index) peakIdx = i;
    return { ...p, i0, i1, peakIdx };
  }), [points]);
  useEffect(() => { setSel(null); setSelPeriod(null); }, [range]);

  const selected = points.length ? points[sel ?? points.length - 1] : null;
  // All: bara ditt normala över tid (inte Stressfactor).
  const normalOnly = range === 'All';
  const normalStats = useMemo(() => {
    const withN = points.filter((p) => p.baseline14 > 0);
    if (!withN.length) return null;
    const now = withN[withN.length - 1];
    const yearAgo = withN.find((p) => p.date >= new Date(parse(now.date).getTime() - 365 * DAY).toISOString().slice(0, 10)) ?? null;
    const max = withN.reduce((a, b) => (b.baseline14 > a.baseline14 ? b : a));
    const min = withN.reduce((a, b) => (b.baseline14 < a.baseline14 ? b : a));
    const change = yearAgo && yearAgo !== now ? Math.round((now.baseline14 / yearAgo.baseline14 - 1) * 100) : 0;
    return { now, max, min, since: withN[0].date, yearAgo: yearAgo && yearAgo !== now ? yearAgo : null, change };
  }, [points]);
  const fmtH = (h: number) => formatTimeValue(h, timeFormat);
  const hasData = !!all && all.some((p) => p.hours14 > 0 || p.baseline14 > 0);
  const longest = Math.max(1, ...periods.map((p) => p.days));
  const choosePeriod = (p: Period) => {
    Haptics.selectionAsync().catch(() => {});
    const same = selPeriod === p.from;
    setSelPeriod(same ? null : p.from);
    setSel(same ? null : p.peakIdx);
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
      ) : !hasData ? (
        <View style={s.center}>
          <Ionicons name="pulse-outline" size={36} color={Colors.textSecondary} />
          <Text style={s.emptyTitle}>No flight load yet</Text>
          <Text style={s.emptyText}>Log or import a few flights and your Stressfactor builds up from there.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 40, gap: 18 }} showsVerticalScrollIndicator={false}>
          {/* De senaste två månaderna, på en rad (samma färg som knappen på dashboarden). */}
          <View style={s.summary}>
            <View style={[s.pill, { backgroundColor: loadZoneColor(summary.zone) + '1F', borderColor: loadZoneColor(summary.zone) + '59' }]}>
              <Text style={[s.pillText, { color: loadZoneColor(summary.zone) }]}>{summary.zone.toUpperCase()}</Text>
            </View>
            <Text style={s.summaryText}>avg {summary.avg}% over the last 2 months</Text>
          </View>

          {/* Vald dag (standard: idag) ovanför grafen. All: ditt normala vid den punkten. */}
          {selected && normalOnly && (
            <View style={s.readout}>
              <View style={{ flex: 1 }}>
                <Text style={s.readDate}>{sel == null ? 'Your normal now' : `Your normal · ${longDate(selected.date)}`}</Text>
                <Text style={s.readSub}>Flight hours per 14 days, from the 12 months before</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.readValue, { color: Colors.primary }]}>{selected.baseline14 > 0 ? `${fmtH(selected.baseline14)} h` : '–'}</Text>
                <Text style={[s.readZone, { color: Colors.primary }]}>PER 14 DAYS</Text>
              </View>
            </View>
          )}
          {selected && !normalOnly && (
            <View style={s.readout}>
              <View style={{ flex: 1 }}>
                <Text style={s.readDate}>{sel == null ? 'Today' : longDate(selected.date)}</Text>
                <Text style={s.readSub}>{fmtH(selected.hours14)} h in 14 days · normal {fmtH(selected.baseline14)} h</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.readValue, { color: loadZoneColor(stressZone(selected.index)) }]}>{selected.index}%</Text>
                <Text style={[s.readZone, { color: loadZoneColor(stressZone(selected.index)) }]}>{stressZone(selected.index).toUpperCase()}</Text>
              </View>
            </View>
          )}

          <View style={{ gap: 12 }}>
            <StressChart points={points} periods={periods} selPeriod={selPeriod} width={width - 32} height={290} selected={sel}
              log={range === '1Y'} robust={range === '6M' || range === '1Y'} sample={range === '1Y' || range === 'All' ? 14 : undefined}
              normalOnly={normalOnly}
              onSelect={(i) => { setSel(i); setSelPeriod(null); }} />
            <View style={s.segment}>
              {(['2M', '6M', '1Y', 'All'] as Range[]).map((r) => (
                <TouchableOpacity key={r} style={[s.segBtn, range === r && s.segOn]} onPress={() => setRange(r)} accessibilityRole="tab" accessibilityState={{ selected: range === r }}>
                  <Text style={[s.segText, range === r && s.segTextOn]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* All: hur ditt normala har ändrats (i stället för busy periods). */}
          {normalOnly && normalStats && (
            <View>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Your normal over time</Text>
                <Text style={s.sectionMeta}>since {MONTHS[parse(normalStats.since).getUTCMonth()]} {parse(normalStats.since).getUTCFullYear()}</Text>
              </View>
              {[
                { k: 'Now', v: `${fmtH(normalStats.now.baseline14)} h`, d: normalStats.yearAgo ? `${normalStats.change >= 0 ? '+' : '−'}${Math.abs(normalStats.change)}% vs a year ago` : '' },
                { k: 'Highest', v: `${fmtH(normalStats.max.baseline14)} h`, d: longDate(normalStats.max.date) },
                { k: 'Lowest', v: `${fmtH(normalStats.min.baseline14)} h`, d: longDate(normalStats.min.date) },
              ].map((r) => (
                <View key={r.k} style={s.normRow}>
                  <Text style={s.normKey}>{r.k}</Text>
                  <Text style={s.normSub}>{r.d}</Text>
                  <Text style={s.normVal}>{r.v}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Intensiva perioder: över normalt (130 %) i minst 3 dagar, nyast först. */}
          {!normalOnly && <View>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Busy periods</Text>
              <Text style={s.sectionMeta}>{periods.length ? `${periods.length} in ${range}` : ''}</Text>
            </View>
            {periods.length === 0 ? (
              <Text style={s.none}>No stretch above your normal pace in this range.</Text>
            ) : periods.slice(0, 8).map((p) => {
              const c = loadZoneColor(stressZone(p.peak));
              const on = selPeriod === p.from;
              return (
                <TouchableOpacity key={p.from} style={[s.period, on && s.periodOn]} activeOpacity={0.75} onPress={() => choosePeriod(p)}
                  accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={s.periodRow}>
                      <Text style={s.periodTitle}>{periodLabel(p.from, p.to)}</Text>
                      <Text style={[s.periodPeak, { color: c }]}>{p.peak}%</Text>
                    </View>
                    <View style={s.periodRow}>
                      <View style={s.track}><View style={[s.trackFill, { width: `${Math.max(6, (p.days / longest) * 100)}%`, backgroundColor: c }]} /></View>
                      <Text style={s.periodSub}>{p.days} days</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>}

          {/* Zonskalan + kort förklaring. */}
          <View style={{ gap: 8 }}>
            <View style={s.scale}>
              {BANDS.map((b) => <View key={b.zone} style={[s.scaleSeg, { backgroundColor: loadZoneColor(b.zone) }]} />)}
            </View>
            <View style={s.scaleLabels}>
              {BANDS.map((b) => <Text key={b.zone} style={s.scaleLabel} numberOfLines={1}>{b.zone === 'critical' ? '200+' : `${b.from}`}</Text>)}
            </View>
            <Text style={s.foot}>
              {normalOnly
                ? "All shows how your normal has changed: your usual flight hours per 14 days, based on the 12 months before each point, with recent months counting more. Your Stressfactor compares your last 14 days with it. An awareness cue, not a medical or fitness-to-fly measure."
                : "The line is your flight hours over the previous 14 days. The dashed line is your normal 14-day total, which changes over time: it's based on the past 12 months, with recent months counting more. Each day's Stressfactor compares the two, as they were that day. An awareness cue, not a medical or fitness-to-fly measure."}
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Grafen ────────────────────────────────────────────────────────────────────
// Y = timmar de senaste 14 dagarna, X = tid. Ditt normala ändras över tid och ritas som en egen streckad
// linje, med normal-korridoren (70–130 % av det normala) och zonerna ovanför (130–170 %, 170 %+) runt den.
// Linjen för dina timmar färgas efter dagens zon. Så syns både hur mycket du flugit och hur ditt normala rört sig.
// Långa intervall (1Y, All): logaritmisk timaxel (toppar drar inte), och dagarna slås ihop till ungefär en
// punkt per två pixlar (snitt), så att kurvan blir mjuk och läsbar. Valet och läsningen gäller alltid dagen.

// Jämna steg för den linjära timaxeln (högst ~5 linjer).
function niceStep(max: number): number {
  for (const st of [1, 2, 5, 10, 20, 25, 50, 100, 200]) if (max / st <= 5) return st;
  return 500;
}
// Tidsaxelns intervall i månader (0.5 = den 1:a och 15:e); det minsta där etiketterna får plats väljs.
const TICK_MONTHS = [0.5, 1, 2, 3, 6, 12, 24, 60, 120];
const TICK_GAP = 34;   // px mellan etiketterna

type Drawn = { i: number; h: number; b: number; index: number };

// Mjuk kurva genom punkterna utan att skjuta över dem (monoton kubisk interpolation, Fritsch–Carlson):
// tangenterna per punkt, och en Bézier-bit från punkt k till k+1.
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / Math.max(1e-6, xs[k + 1] - xs[k]));
  const m = new Array<number>(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k] / d[k], b = m[k + 1] / d[k], q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
  }
  return m;
}
function curveTo(xs: number[], ys: number[], m: number[], k: number): string {
  const h = xs[k + 1] - xs[k];
  const f = (v: number) => v.toFixed(1);
  return ` C ${f(xs[k] + h / 3)} ${f(ys[k] + (m[k] * h) / 3)} ${f(xs[k + 1] - h / 3)} ${f(ys[k + 1] - (m[k + 1] * h) / 3)} ${f(xs[k + 1])} ${f(ys[k + 1])}`;
}

function StressChart({ points, periods, selPeriod, width, height, selected, onSelect, log = false, robust = false, sample, normalOnly = false }: {
  points: StressPoint[]; periods: Period[]; selPeriod: string | null; width: number; height: number;
  selected: number | null; onSelect: (i: number) => void; log?: boolean; robust?: boolean; sample?: number;
  normalOnly?: boolean;   // All: bara ditt normala över tid, som en linje med fyllnad (inga zoner, ingen stress)
}) {
  const L = 34, R = 6, T = 8, B = 22;
  const pw = width - L - R, ph = height - T - B;
  const n = points.length;
  const x = (i: number) => L + (n > 1 ? (i / (n - 1)) * pw : pw / 2);

  // Det som ritas. sample (1Y, All): ett mått varannan vecka — 14-dagarsfönstret som slutar den dagen, räknat
  // bakåt från idag, så att fönstren inte överlappar och kurvan blir mjuk. Mycket lång historik glesas ut till
  // en multipel av två veckor (högst en punkt per ~3 px). Annars varje dag, eller snitt av några dagar.
  const per = Math.max(1, Math.ceil(n / (pw / 2)));
  const drawn: Drawn[] = [];
  if (sample && n > 1) {
    const stepDays = sample * Math.max(1, Math.ceil(n / sample / (pw / 3)));
    const idx: number[] = [];
    for (let i = n - 1; i >= 0; i -= stepDays) idx.push(i);
    for (const i of idx.reverse()) drawn.push({ i, h: points[i].hours14, b: points[i].baseline14, index: points[i].index });
  } else for (let a = 0; a < n; a += per) {
    const chunk = points.slice(a, Math.min(n, a + per));
    const withNormal = chunk.filter((p) => p.baseline14 > 0);
    drawn.push({
      i: a + (chunk.length - 1) / 2,
      h: chunk.reduce((t, p) => t + p.hours14, 0) / chunk.length,
      b: withNormal.length ? withNormal.reduce((t, p) => t + p.baseline14, 0) / withNormal.length : 0,
      index: Math.round(chunk.reduce((t, p) => t + p.index, 0) / chunk.length),
    });
  }

  // Skalan. Långa intervall (robust) förankras i ditt normala, så att enstaka extremer — dippar till 0 h under
  // semestern, en ensam topp — inte trycker ihop resten:
  //  - nederkant: halva ditt normala (men aldrig över korridoren, 70 %); semester och uppehåll hamnar under
  //  - överkant: ELEVATED-bandet (150 % av normalt) syns alltid; bara de högsta 2 % av dagarna kan gå över.
  // Det som ligger utanför ritas mot kanten, nedtonat och med en liten pil; avläsningen visar det verkliga
  // värdet. Utan normalt (nya användare): 5:e–98:e percentilen. Ligger skalan nära noll börjar den på noll.
  const hours = drawn.map((p) => p.h).sort((u, v) => u - v);
  const normals = drawn.filter((p) => p.b > 0).map((p) => p.b).sort((u, v) => u - v);
  const pct = (arr: number[], q: number) => (arr.length ? arr[Math.round(q * (arr.length - 1))] : 0);
  let lo = 0;
  let hi = Math.max(1, ...drawn.map((p) => Math.max(p.h, p.b * 1.75))) * 1.05;
  if (robust && hours.length > 20) {
    if (normals.length > 10) {
      const nLo = pct(normals, 0.05), nHi = pct(normals, 0.95);
      lo = Math.min(Math.max(pct(hours, 0.05), nLo * 0.5), nLo * 0.7);
      hi = Math.max(pct(hours, 0.98), nHi * 1.5);
    } else {
      lo = pct(hours, 0.05);
      hi = Math.max(pct(hours, 0.98), lo + 1);
    }
  }
  if (lo < Math.max(3, hi * 0.15)) lo = 0;   // låga nivåer: ingen inzoomning på småskillnader
  if (normalOnly) { lo = 0; hi = Math.max(1, ...drawn.map((p) => p.b)) * 1.2; }
  const tf = (h: number) => {
    const v = Math.min(Math.max(h, lo), hi);
    return log ? (lo > 0 ? Math.log(v) : Math.log1p(v)) : v;
  };
  const t0 = tf(lo), t1 = tf(hi);
  const padLo = lo === 0 ? 0 : (t1 - t0) * 0.06, padHi = (t1 - t0) * 0.06;
  const y = (h: number) => T + (1 - (tf(h) - (t0 - padLo)) / (t1 + padHi - (t0 - padLo))) * ph;
  const side = (h: number) => (h < lo - 1e-9 ? -1 : h > hi + 1e-9 ? 1 : 0);   // utanför skalan: under / över

  // Stödlinjer: logaritmiska steg eller jämna steg inom skalan, aldrig tätare än 16 px.
  let gridV: number[] = [];
  if (log) gridV = [0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500];
  else { const step = niceStep(hi - lo); for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) gridV.push(v); }
  gridV = gridV.filter((v) => v > lo && v < hi);
  gridV = gridV.reduce<number[]>((keep, v) => (!keep.length || y(keep[keep.length - 1]) - y(v) >= 16 ? [...keep, v] : keep), []);

  // Sammanhängande sträckor där det finns ett normalt (de första veckorna finns inget).
  const runs: [number, number][] = [];
  drawn.forEach((p, k) => {
    if (!(p.b > 0)) return;
    const last = runs[runs.length - 1];
    if (last && last[1] === k - 1) last[1] = k; else runs.push([k, k]);
  });
  // Ett band runt det normala: mellan from × normalt och top × normalt (top = null → grafens överkant).
  const band = (from: number, top: number | null) => runs.map(([a, b]) => {
    const up: string[] = [], down: string[] = [];
    for (let k = a; k <= b; k++) up.push(`${x(drawn[k].i).toFixed(1)} ${(top == null ? T : y(drawn[k].b * top)).toFixed(1)}`);
    for (let k = b; k >= a; k--) down.push(`${x(drawn[k].i).toFixed(1)} ${y(drawn[k].b * from).toFixed(1)}`);
    return `M ${up.join(' L ')} L ${down.join(' L ')} Z`;
  }).join(' ');
  const normalLine = runs.map(([a, b]) => {
    const xs: number[] = [], ys: number[] = [];
    for (let k = a; k <= b; k++) { xs.push(x(drawn[k].i)); ys.push(y(drawn[k].b)); }
    if (!sample || xs.length < 3) return `M ${xs.map((v, k) => `${v.toFixed(1)} ${ys[k].toFixed(1)}`).join(' L ')}`;
    const m = monotoneTangents(xs, ys);
    return `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}` + xs.slice(1).map((_, k) => curveTo(xs, ys, m, k)).join('');
  }).join(' ');

  // All: fyllnad under ditt normala.
  const normalArea = normalOnly ? runs.map(([a, b]) => {
    const xs: number[] = [], ys: number[] = [];
    for (let k = a; k <= b; k++) { xs.push(x(drawn[k].i)); ys.push(y(drawn[k].b)); }
    const m = xs.length > 2 && sample ? monotoneTangents(xs, ys) : null;
    const curve = m
      ? `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}` + xs.slice(1).map((_, k) => curveTo(xs, ys, m, k)).join('')
      : `M ${xs.map((v, k) => `${v.toFixed(1)} ${ys[k].toFixed(1)}`).join(' L ')}`;
    return `${curve} L ${xs[xs.length - 1].toFixed(1)} ${T + ph} L ${xs[0].toFixed(1)} ${T + ph} Z`;
  }).join(' ') : '';

  // Timmarna, i bitar efter zon (samma zon i följd → en bit).
  // Bitar utanför skalan tonas ner; en liten pil vid kanten markerar varje sträcka utanför.
  const segs: { d: string; c: string; out: boolean }[] = [];
  const hx = drawn.map((p) => x(p.i)), hy = drawn.map((p) => y(p.h));
  const hm = sample && drawn.length > 2 ? monotoneTangents(hx, hy) : null;   // mjuk kurva varannan vecka
  drawn.forEach((p, k) => {
    if (k === 0) return;
    const c = loadZoneColor(stressZone(p.index));
    const out = side(p.h) !== 0 || side(drawn[k - 1].h) !== 0;
    const piece = hm ? curveTo(hx, hy, hm, k - 1) : ` L ${hx[k].toFixed(1)} ${hy[k].toFixed(1)}`;
    const last = segs[segs.length - 1];
    if (last && last.c === c && last.out === out) last.d += piece;
    else segs.push({ c, out, d: `M ${hx[k - 1].toFixed(1)} ${hy[k - 1].toFixed(1)}${piece}` });
  });
  const arrows: { x: number; dir: -1 | 1 }[] = [];
  for (let k = 0; k < drawn.length;) {
    const dir = side(drawn[k].h);
    if (!dir) { k++; continue; }
    let ext = k, e = k;
    while (e < drawn.length && side(drawn[e].h) === dir) { if ((drawn[e].h - drawn[ext].h) * dir > 0) ext = e; e++; }
    arrows.push({ x: x(drawn[ext].i), dir: dir as -1 | 1 });
    k = e;
  }

  // Tidsaxeln: intervall efter hur mycket som får plats; årtalet står vid januari (och på årsintervallen).
  const every = TICK_MONTHS.find((iv) => ((n / 30.44) / iv) * TICK_GAP <= pw) ?? 120;
  const ticks: { i: number; label: string }[] = [];
  let lastX = -Infinity;
  points.forEach((p, i) => {
    const d = parse(p.date);
    const day = d.getUTCDate(), m = d.getUTCMonth(), yr = d.getUTCFullYear();
    let label: string | null = null;
    if (every === 0.5) { if (day === 1 || day === 15) label = shortDate(p.date); }
    else if (day === 1) {
      if (every < 12) { if ((yr * 12 + m) % every === 0) label = m === 0 ? String(yr) : MONTHS[m]; }
      else if (m === 0 && yr % (every / 12) === 0) label = String(yr);
    }
    if (!label) return;
    const px = x(i);
    if (px < L + 10 || px > L + pw - 10 || px - lastX < TICK_GAP * 0.8) return;   // inte utanför kanten, inte krock
    ticks.push({ i, label });
    lastX = px;
  });

  const lastIdx = useRef<number | null>(null);
  const pick = (px: number) => {
    if (!n) return;
    let i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / pw) * (n - 1))));
    // Varannan vecka: närmaste mätpunkt, så att markören ligger på linjen.
    if (sample && drawn.length) i = drawn.reduce((best, d) => (Math.abs(d.i - i) < Math.abs(best - i) ? d.i : best), drawn[0].i);
    if (i !== lastIdx.current) { lastIdx.current = i; Haptics.selectionAsync().catch(() => {}); onSelect(i); }
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
    onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
    onPanResponderTerminationRequest: () => false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [points, width, sample]);

  const si = selected ?? n - 1;
  const sp = points[si];
  const firstRun = runs.length ? drawn[runs[runs.length - 1][0]] : null;

  return (
    <View {...pan.panHandlers}>
      <Svg width={width} height={height}>
        {/* Korridoren runt ditt normala och zonerna ovanför (inte i All). */}
        {!normalOnly && (
          <>
            <Path d={band(1.7, null)} fill={loadZoneColor('high')} opacity={0.06} />
            <Path d={band(1.3, 1.7)} fill={loadZoneColor('elevated')} opacity={0.08} />
            <Path d={band(0.7, 1.3)} fill={loadZoneColor('normal')} opacity={0.09} />
          </>
        )}
        {/* Intensiva perioder skuggas; den valda lyser. */}
        {!normalOnly && periods.map((p) => {
          const on = selPeriod === p.from;
          const x0 = x(p.i0) - 1.5, x1 = x(p.i1) + 1.5;
          return (
            <Rect key={p.from} x={x0} y={T} width={Math.max(3, x1 - x0)} height={ph}
              fill={loadZoneColor(stressZone(p.peak))} opacity={on ? 0.14 : 0.05} rx={2} />
          );
        })}
        {gridV.map((v) => (
          <Line key={v} x1={L} x2={L + pw} y1={y(v)} y2={y(v)} stroke="#FFFFFF" strokeOpacity={0.06} strokeWidth={1} />
        ))}
        <Line x1={L} x2={L + pw} y1={T + ph} y2={T + ph} stroke="#FFFFFF" strokeOpacity={0.12} strokeWidth={1} />
        {(lo === 0 ? [0, ...gridV] : gridV).map((v) => (
          <SvgText key={`l${v}`} x={L - 6} y={y(v) + 3.5} fontSize={9.5} fill={Colors.textSecondary} textAnchor="end">{`${v} h`}</SvgText>
        ))}
        {log && <SvgText x={L + pw - 2} y={T + 10} fontSize={9} fill={Colors.textSecondary} textAnchor="end">Log scale</SvgText>}

        {/* All: ditt normala som linje med fyllnad. Annars streckat, med dina timmar ovanpå. */}
        {normalOnly ? (
          <>
            {normalArea ? <Path d={normalArea} fill={Colors.primary} opacity={0.12} /> : null}
            {normalLine ? <Path d={normalLine} stroke={Colors.primary} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
          </>
        ) : (
          <>
            {normalLine ? <Path d={normalLine} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="3 4" fill="none" /> : null}
            {firstRun && (
              <SvgText x={L + 4} y={y(firstRun.b * 1.3) - 5} fontSize={9.5} fill="#FFFFFF" fillOpacity={0.6}>Your normal</SvgText>
            )}
          </>
        )}

        {/* Dina timmar, färgade efter zon */}
        {!normalOnly && segs.map((sg, k) => (
          <Path key={k} d={sg.d} stroke={sg.c} strokeWidth={log ? 1.6 : 2} strokeOpacity={sg.out ? 0.3 : 1} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {!normalOnly && arrows.map((a, k) => {
          const yy = a.dir < 0 ? T + ph - 2 : T + 2;
          return (
            <Path key={`a${k}`} fill={Colors.textSecondary} opacity={0.8}
              d={a.dir < 0 ? `M ${a.x - 3.5} ${yy - 5} L ${a.x + 3.5} ${yy - 5} L ${a.x} ${yy} Z` : `M ${a.x - 3.5} ${yy + 5} L ${a.x + 3.5} ${yy + 5} L ${a.x} ${yy} Z`} />
          );
        })}

        {ticks.map((t) => (
          <SvgText key={`t${t.i}`} x={x(t.i)} y={height - 5} fontSize={9.5} fill={Colors.textSecondary} textAnchor="middle">{t.label}</SvgText>
        ))}

        {sp && normalOnly && sp.baseline14 > 0 && (
          <>
            <Line x1={x(si)} x2={x(si)} y1={T} y2={T + ph} stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={1} />
            <Circle cx={x(si)} cy={y(sp.baseline14)} r={7} fill={Colors.primary} opacity={0.25} />
            <Circle cx={x(si)} cy={y(sp.baseline14)} r={3.5} fill={Colors.primary} stroke={Colors.background} strokeWidth={1.2} />
          </>
        )}
        {sp && !normalOnly && (
          <>
            <Line x1={x(si)} x2={x(si)} y1={T} y2={T + ph} stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={1} />
            {sp.baseline14 > 0 && <Circle cx={x(si)} cy={y(sp.baseline14)} r={2.5} fill="#FFFFFF" opacity={0.7} />}
            <Circle cx={x(si)} cy={y(sp.hours14)} r={7} fill={loadZoneColor(stressZone(sp.index))} opacity={0.25} />
            <Circle cx={x(si)} cy={y(sp.hours14)} r={3.5} fill={loadZoneColor(stressZone(sp.index))} stroke={Colors.background} strokeWidth={1.2} />
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
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, borderWidth: 0.8 },
  pillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2 },
  summaryText: { color: Colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
  readout: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  readDate: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
  readSub: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 3 },
  readValue: { fontSize: 36, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 40 },
  readZone: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2 },
  segment: { flexDirection: 'row', alignSelf: 'center', gap: 4 },
  segBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999 },
  segOn: { backgroundColor: Colors.primary + '22' },
  segText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  segTextOn: { color: Colors.primary },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  sectionMeta: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  none: { color: Colors.textSecondary, fontSize: 13.5, paddingVertical: 10 },
  period: { paddingVertical: 12, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  periodOn: { backgroundColor: Colors.surface, borderTopColor: 'transparent' },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  periodTitle: { flex: 1, color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  periodPeak: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.07)' },
  trackFill: { height: 3, borderRadius: 2, opacity: 0.85 },
  periodSub: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 52, textAlign: 'right' },
  normRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  normKey: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', width: 72 },
  normSub: { flex: 1, color: Colors.textSecondary, fontSize: 12.5 },
  normVal: { color: Colors.primary, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scale: { flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden', gap: 2 },
  scaleSeg: { flex: 1, opacity: 0.85 },
  scaleLabels: { flexDirection: 'row' },
  scaleLabel: { flex: 1, color: Colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
  foot: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
});
