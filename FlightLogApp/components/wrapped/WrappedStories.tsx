import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useProfileStore } from '../../store/profileStore';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
import { useLanguageStore } from '../../store/languageStore';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { getSetting, getStressHours, getMonthlyHours, getVisitedAirportIcaos } from '../../db/flights';
import { getDatabase } from '../../db/database';
import { FlightChart } from '../FlightChart';
import { ClassBreakdown } from '../ClassBreakdown';
import { EASAProgressCharts } from '../EASAProgressChart';
import { BWDayBars } from '../milestones/BWDayBars';
import { MiniRouteMap } from '../milestones/MiniRouteMap';
import { useBestWeekFull, useLongestXcFull } from '../../hooks/useMilestoneDetails';
import type { FlightStats } from '../../types/flight';
import {
  SlideBody, SlideTitle, SlideSub, Hero, StatRow, WrappedStressRing, wrappedAccents, MONO,
} from './WrappedKit';

interface Slide { key: string; accent: string; interactive?: boolean; render: () => React.ReactNode }

interface VisitedAgg { count: number; countries: number; top: { icao: string; count: number }[] }

export function WrappedStories({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const stats = useFlightStore(s => s.stats);
  const profile = useProfileStore(s => s.profile);
  const standard = useRegulationStandardStore(s => s.standard);
  const sv = useLanguageStore(s => s.language) === 'sv';
  const { formatTime } = useTimeFormat();

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [stress, setStress] = useState<{ recent14: number; yearAvg14: number }>({ recent14: 0, yearAvg14: 0 });
  const [monthlyHasData, setMonthlyHasData] = useState(false);
  const [visited, setVisited] = useState<VisitedAgg>({ count: 0, countries: 0, top: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [fn, sh, monthly, vIcaos] = await Promise.all([
        getSetting('profile_first_name').catch(() => ''),
        getStressHours().catch(() => ({ recent14: 0, yearAvg14: 0 })),
        getMonthlyHours().catch(() => [] as { year: number; month: number; hours: number }[]),
        getVisitedAirportIcaos().catch(() => [] as string[]),
      ]);
      if (!alive) return;
      setFirstName(fn || '');
      setStress(sh);
      setMonthlyHasData((monthly || []).some(m => m.hours > 0));

      let agg: VisitedAgg = { count: 0, countries: 0, top: [] };
      if (vIcaos.length) {
        try {
          const db = await getDatabase();
          const ph = vIcaos.map(() => '?').join(',');
          const rows = await db.getAllAsync<{ country: string }>(
            `SELECT country FROM icao_airports WHERE icao IN (${ph})`, vIcaos,
          );
          const countries = new Set(rows.map(r => r.country).filter(Boolean));
          const topRows = await db.getAllAsync<{ place: string; c: number }>(
            `SELECT place, COUNT(*) c FROM (
               SELECT dep_place AS place FROM flights WHERE flight_type != 'sim'
               UNION ALL SELECT arr_place AS place FROM flights WHERE flight_type != 'sim'
             ) WHERE place IN (${ph}) GROUP BY place ORDER BY c DESC LIMIT 5`,
            vIcaos,
          );
          agg = { count: vIcaos.length, countries: countries.size, top: topRows.map(r => ({ icao: r.place, count: r.c })) };
        } catch {
          agg = { count: vIcaos.length, countries: 0, top: [] };
        }
      }
      if (alive) { setVisited(agg); setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  const slides = useMemo<Slide[]>(() => {
    if (!stats) return [];
    const A = wrappedAccents();
    let n = 0;
    const acc = () => A[(n++) % A.length];
    const out: Slide[] = [];
    const has = stats.total_flights > 0;
    const recent = stress.recent14 > 0; // "senaste 14 dagarna"-mätarna är bara relevanta vid färsk aktivitet
    const lastAccent = () => out[out.length - 1].accent;

    out.push({ key: 'intro', accent: acc(), render: () => {
      const a = out[0].accent;
      return (
        <SlideBody accent={a} eyebrow="BLADES · WRAPPED">
          <SlideTitle>{sv ? `Välkommen${firstName ? `, ${firstName}` : ''}` : `Welcome${firstName ? `, ${firstName}` : ''}`}</SlideTitle>
          <SlideSub>{sv ? 'Din loggbok är inläst. Här är din historia i siffror.' : 'Your logbook is in. Here is your story in numbers.'}</SlideSub>
          <StatRow accent={a} items={[
            { label: sv ? 'Flygningar' : 'Flights', value: String(stats.total_flights) },
            { label: sv ? 'Totala timmar' : 'Total hours', value: formatTime(stats.total_time) },
          ]} />
          <Text style={st.tapHint}>{sv ? 'Tryck för att bläddra' : 'Tap to flip through'}  ›</Text>
        </SlideBody>
      );
    } });

    if (has) out.push({ key: 'total', accent: acc(), render: () => {
      const a = lastAccent();
      return (
        <SlideBody accent={a} eyebrow={sv ? 'TOTALT FLUGET' : 'TOTAL TIME'}>
          <Hero value={formatTime(stats.total_time)} label={sv ? 'totala timmar' : 'total hours'} accent={a} />
          <StatRow accent={a} items={[
            { label: sv ? 'I år' : 'This year', value: formatTime(stats.year_to_date) },
            { label: sv ? '12 mån' : '12 months', value: formatTime(stats.last_12_months) },
            { label: sv ? 'Flygningar' : 'Flights', value: String(stats.total_flights) },
          ]} />
        </SlideBody>
      );
    } });

    if (monthlyHasData) out.push({ key: 'monthly', accent: acc(), render: () => {
      const a = lastAccent();
      return (
        <SlideBody accent={a} eyebrow={sv ? 'ÖVER TID' : 'OVER TIME'}
          visual={<View pointerEvents="none" style={st.cardWrap}><FlightChart accent={a} /></View>}>
          <SlideTitle>{sv ? 'Timmar per månad' : 'Hours per month'}</SlideTitle>
        </SlideBody>
      );
    } });

    if (has) out.push({ key: 'class', accent: acc(), render: () => {
      const a = lastAccent();
      return (
        <SlideBody accent={a} eyebrow={sv ? 'FÖRDELNING' : 'BREAKDOWN'}
          visual={<View pointerEvents="none" style={st.cardWrap}><ClassBreakdown variant="large" /></View>}>
          <SlideTitle>{sv ? 'Hur dina timmar fördelas' : 'How your hours split'}</SlideTitle>
        </SlideBody>
      );
    } });

    if (stats.best_week_start) out.push({ key: 'bestweek', accent: acc(), render: () => (
      <BestWeekSlide accent={lastAccent()} stats={stats} sv={sv} />
    ) });

    if (stats.longest_xc_date) out.push({ key: 'longestxc', accent: acc(), render: () => (
      <LongestXcSlide accent={lastAccent()} stats={stats} sv={sv} />
    ) });

    if (visited.count > 0) out.push({ key: 'airports', accent: acc(), render: () => {
      const a = lastAccent();
      const list = visited.top.length > 0 ? (
        <View style={{ alignSelf: 'stretch', gap: 11 }}>
          {visited.top.map((tp, i) => (
            <View key={tp.icao} style={st.airportRow}>
              <Text style={[st.airportRank, { color: i === 0 ? a : Colors.textMuted }]}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={st.airportIcao}>{tp.icao}</Text>
              <View style={st.airportTrackWrap}>
                <View style={[st.airportTrack, { width: `${Math.round((tp.count / visited.top[0].count) * 100)}%`, backgroundColor: i === 0 ? a : Colors.cardBorder }]} />
              </View>
              <Text style={[st.airportCount, { color: i === 0 ? a : Colors.textSecondary }]}>{tp.count}×</Text>
            </View>
          ))}
        </View>
      ) : undefined;
      return (
        <SlideBody accent={a} eyebrow={sv ? 'DINA FLYGPLATSER' : 'YOUR AIRPORTS'} visual={list}>
          <Hero value={String(visited.count)} label={sv ? `flygplatser i ${visited.countries} länder` : `airports across ${visited.countries} countries`} accent={a} />
        </SlideBody>
      );
    } });

    // "Senaste rytm" sist och bara vid färsk aktivitet — currency-ringen är ett
    // nutidsvidget, inte en historisk återblick (tomt för äldre importer).
    if (recent) out.push({ key: 'currency', accent: acc(), render: () => {
      const a = lastAccent();
      return (
        <SlideBody accent={a} eyebrow={sv ? 'DIN RYTM' : 'YOUR RHYTHM'}
          visual={<WrappedStressRing recent14={stress.recent14} yearAvg14={stress.yearAvg14} size={190} />}>
          <SlideTitle>{sv ? 'Senaste 14 dagarna' : 'The last 14 days'}</SlideTitle>
          <SlideSub>{sv ? 'Din aktivitet mot din egen baslinje.' : 'Your activity against your own baseline.'}</SlideSub>
        </SlideBody>
      );
    } });

    if (profile?.mainRole === 'pilot-manned') out.push({ key: 'easa', accent: acc(), interactive: true, render: () => {
      const a = lastAccent();
      return (
        <SlideBody accent={a} eyebrow={sv ? 'DINA KRAV' : 'YOUR REQUIREMENTS'}>
          <SlideTitle>{sv ? 'Vägen till nästa licens' : 'The road to your next licence'}</SlideTitle>
          <SlideSub>{sv ? 'Svep mellan PPL · CPL · ATPL.' : 'Swipe between PPL · CPL · ATPL.'}</SlideSub>
          <View style={st.cardWrap}><EASAProgressCharts standard={standard} forceUnlock /></View>
        </SlideBody>
      );
    } });

    out.push({ key: 'outro', accent: acc(), render: () => {
      const a = lastAccent();
      return (
        <SlideBody accent={a} eyebrow="BLADES · WRAPPED">
          <SlideTitle>{sv ? 'Det här är bara början.' : 'This is just the beginning.'}</SlideTitle>
          <SlideSub>{sv ? 'Varje flygning du loggar gör bilden skarpare. Lycka till där uppe.' : 'Every flight you log sharpens the picture. See you up there.'}</SlideSub>
        </SlideBody>
      );
    } });

    return out;
  }, [stats, profile, standard, sv, firstName, stress, monthlyHasData, visited, formatTime]);

  if (!loaded || !stats || slides.length === 0) {
    return (
      <View style={[st.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  const safeIdx = Math.min(index, slides.length - 1);
  const slide = slides[safeIdx];
  const accent = slide.accent;
  const last = safeIdx === slides.length - 1;

  const next = () => { if (last) onClose(); else setIndex(safeIdx + 1); };
  const prev = () => { if (safeIdx > 0) setIndex(safeIdx - 1); };

  return (
    <View style={st.root}>
      <LinearGradient
        colors={[accent + '30', accent + '00']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={st.glow} pointerEvents="none"
      />

      {/* Header: progress bars + close */}
      <View style={[st.header, { paddingTop: insets.top + 10 }]}>
        <View style={st.bars}>
          {slides.map((s2, i) => (
            <View key={s2.key} style={st.barTrack}>
              <View style={[st.barFill, { backgroundColor: i <= safeIdx ? accent : 'transparent' }]} />
            </View>
          ))}
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={st.close}>
          <Ionicons name="close" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={slide.key} entering={FadeInUp.duration(400)} style={{ flex: 1, alignSelf: 'stretch' }}>
            {slide.render()}
          </Animated.View>
        </ScrollView>

        {/* Tap-navigering: helskärm (vänster bak / höger fram). På interaktiva
            slides (EASA-svep) bara smala kanter så mitten kan svepas. */}
        {slide.interactive ? (
          <>
            <Pressable style={[st.tapZone, { left: 0, width: '16%' }]} onPress={prev} />
            <Pressable style={[st.tapZone, { right: 0, width: '16%' }]} onPress={next} />
          </>
        ) : (
          <>
            <Pressable style={[st.tapZone, { left: 0, width: '32%' }]} onPress={prev} />
            <Pressable style={[st.tapZone, { right: 0, width: '68%' }]} onPress={next} />
          </>
        )}
      </View>
    </View>
  );
}

// ── Milestone sub-slides (own data hooks) ────────────────────────────────────

function BestWeekSlide({ accent, stats, sv }: { accent: string; stats: FlightStats; sv: boolean }) {
  const bw = useBestWeekFull(stats.best_week_start, stats.best_week_label, stats.best_week_hours);
  return (
    <SlideBody accent={accent} eyebrow={sv ? 'BÄSTA VECKAN' : 'BEST WEEK'}
      visual={bw.days.length > 0 ? <View pointerEvents="none" style={{ alignSelf: 'stretch' }}><BWDayBars days={bw.days} accent={accent} showLabels /></View> : undefined}>
      <Hero value={bw.hoursLabel || '—'} label={bw.weekLabel || stats.best_week_label || ''} accent={accent} />
      <StatRow accent={accent} items={[
        { label: sv ? 'Sektorer' : 'Sectors', value: String(bw.sectors) },
        { label: sv ? 'Flygplatser' : 'Airports', value: String(bw.airports) },
        { label: sv ? 'vs snitt' : 'vs avg', value: bw.vsAvg ? `${bw.vsAvg.toFixed(1)}×` : '—' },
      ]} />
    </SlideBody>
  );
}

function LongestXcSlide({ accent, stats, sv }: { accent: string; stats: FlightStats; sv: boolean }) {
  const xc = useLongestXcFull({
    date: stats.longest_xc_date,
    km: stats.longest_xc_km,
    hours: stats.longest_xc_hours,
    flightId: stats.longest_xc_id,
    firstDep: stats.longest_xc_first_dep,
    lastArr: stats.longest_xc_last_arr,
  });
  const nm = xc.distanceNm || stats.longest_xc_km || 0;
  const km = xc.distanceKm || Math.round((stats.longest_xc_km || 0) * 1.852);
  const [mapW, setMapW] = useState(0);
  const visual = (
    <View
      pointerEvents="none"
      style={{ alignSelf: 'stretch', height: 200 }}
      onLayout={e => setMapW(Math.round(e.nativeEvent.layout.width))}
    >
      {xc.legs.length > 0 && mapW > 0 && (
        <MiniRouteMap width={mapW} height={200} legs={xc.legs} accent={accent} showGraticule animate={false} />
      )}
    </View>
  );
  return (
    <SlideBody accent={accent} eyebrow={sv ? 'LÄNGSTA FLYGNINGEN' : 'LONGEST FLIGHT'} visual={visual}>
      <Hero value={String(nm)} unit="NM" label={`${xc.routeFrom} → ${xc.routeTo}`} accent={accent} />
      <StatRow accent={accent} items={[
        { label: sv ? 'Tid' : 'Time', value: xc.durationLabel || '—' },
        { label: sv ? 'Datum' : 'Date', value: xc.dateShort || '—' },
        { label: 'KM', value: String(km) },
      ]} />
    </SlideBody>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: '55%' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  bars: { flex: 1, flexDirection: 'row', gap: 4 },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: Colors.cardBorder, overflow: 'hidden' },
  barFill: { height: '100%', width: '100%', borderRadius: 2 },
  close: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  tapZone: { position: 'absolute', top: 0, bottom: 0 },

  cardWrap: { alignSelf: 'stretch' },
  tapHint: { fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: Colors.textMuted, marginTop: 10 },

  airportRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  airportRank: { fontFamily: MONO, fontSize: 12, fontWeight: '700', width: 22 },
  airportIcao: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, width: 54 },
  airportTrackWrap: { flex: 1, height: 5, borderRadius: 3, backgroundColor: Colors.cardBorder, overflow: 'hidden' },
  airportTrack: { height: '100%', borderRadius: 3 },
  airportCount: { fontFamily: MONO, fontSize: 13, fontWeight: '700', width: 42, textAlign: 'right' },
});
