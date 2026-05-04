import { useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { Colors } from '../../constants/colors';
import { AirportMapWidget } from '../../components/AirportMapWidget';
import { useTimeFormat, decimalToHHMM } from '../../hooks/useTimeFormat';
import { RouteMapModal } from '../../components/RouteMapModal';
import { BestWeekMapModal } from '../../components/BestWeekMapModal';
import { getStressHours, getSetting } from '../../db/flights';
import { useTranslation } from '../../hooks/useTranslation';
import { useProfileStore, isOperator, type SubRole } from '../../store/profileStore';
import { useThemeStore } from '../../store/themeStore';
import type { Flight } from '../../types/flight';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

// ── Stress helpers ──────────────────────────────────────────────────────────

type StressZone = 'low' | 'light' | 'normal' | 'elevated' | 'high' | 'critical';
type StressData = { index: number; zone: StressZone; hours14: number; baseline14: number; advice: string };

function computeStress(recent14: number, yearAvg14: number): StressData {
  const ratio = yearAvg14 > 0 ? recent14 / yearAvg14 : recent14 > 0 ? 2 : 0;
  const index = Math.round(ratio * 100);
  const zone: StressZone =
    index <= 30 ? 'low' : index <= 60 ? 'light' : index <= 120 ? 'normal'
    : index <= 160 ? 'elevated' : index <= 200 ? 'high' : 'critical';
  const adviceMap: Record<StressZone, string> = {
    low: 'Low activity. Consider a refresher if returning to ops.',
    light: 'Below average workload. Good time for training flights.',
    normal: 'Balanced workload. Maintaining currency well.',
    elevated: 'Above average. Ensure adequate rest between flights.',
    high: 'High workload. Monitor fatigue and plan recovery days.',
    critical: 'Very high workload. Consider reducing tempo to manage fatigue risk.',
  };
  return { index, zone, hours14: recent14, baseline14: yearAvg14, advice: adviceMap[zone] };
}

function zoneColor(zone: StressZone): string {
  if (zone === 'normal') return Colors.success;
  if (zone === 'elevated' || zone === 'high') return Colors.warning;
  if (zone === 'critical') return Colors.danger;
  return Colors.primary;
}

// ── StressRing ──────────────────────────────────────────────────────────────

function StressRing({ stress, size = 120, animKey = 0 }: { stress: StressData; size?: number; animKey?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const targetPct = Math.min(stress.index, 240) / 240;
  const color = zoneColor(stress.zone);

  const animVal = useRef(new Animated.Value(0)).current;
  const [displayPct, setDisplayPct] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);

  useEffect(() => {
    animVal.setValue(0);
    Animated.timing(animVal, {
      toValue: 1,
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    const listener = animVal.addListener(({ value }) => {
      setDisplayPct(value * targetPct);
      setDisplayIndex(Math.round(value * stress.index));
    });
    return () => animVal.removeListener(listener);
  }, [stress.index, animKey]);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size/2} cy={size/2} r={r} stroke={Colors.separator} strokeWidth={6} fill="none" />
        <Circle
          cx={size/2} cy={size/2} r={r}
          stroke={color} strokeWidth={6} fill="none"
          strokeDasharray={`${circ * displayPct} ${circ * (1 - displayPct)}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
          rotation={-90} origin={`${size/2}, ${size/2}`}
        />
      </Svg>
      <Text style={{ fontSize: size > 100 ? 26 : 20, fontWeight: '900', color, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] }}>
        {displayIndex}%
      </Text>
      <Text style={{ fontSize: 8, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, marginTop: 2 }}>
        {stress.zone.toUpperCase()}
      </Text>
    </View>
  );
}

// ── FlightRow (compact, for Latest Ops) ─────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function LatestFlightRow({ flight, onPress, isLast }: { flight: Flight; onPress: () => void; isLast?: boolean }) {
  const { formatTime } = useTimeFormat();
  const f = flight;
  const day = f.date?.split('-')[2] ?? '??';
  const mIdx = parseInt(f.date?.split('-')[1] ?? '0') - 1;
  return (
    <TouchableOpacity
      style={[s.latestRow, !isLast && { borderBottomWidth: 0.5, borderBottomColor: Colors.separator }]}
      onPress={onPress} activeOpacity={0.7}
    >
      <View style={s.latestDate}>
        <Text style={s.latestDay}>{day}</Text>
        <Text style={s.latestMonth}>{MONTH_ABBR[mIdx] ?? ''}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={s.latestRoute}>{f.dep_place} → {f.arr_place}</Text>
        <Text style={s.latestMeta}>{f.aircraft_type} · {f.registration}</Text>
      </View>
      <Text style={s.latestTime}>{formatTime(f.total_time)}</Text>
    </TouchableOpacity>
  );
}

// ── Operator stats helper ────────────────────────────────────────────────────

function computeOperatorStats(flights: Flight[], role: SubRole) {
  const opFlights = flights.filter(f => {
    if (!f.operator_data) return false;
    try { return JSON.parse(f.operator_data).role === role; } catch { return false; }
  });
  const parsed = opFlights.map(f => ({ ...f, op: JSON.parse(f.operator_data || '{}') }));
  const totalTime = opFlights.reduce((s, f) => s + (f.total_time ?? 0), 0);
  const nightTime = opFlights.reduce((s, f) => s + (f.night ?? 0), 0);
  const flightCount = opFlights.length;

  const sum = (key: string) => parsed.reduce((s, f) => s + (Number(f.op[key]) || 0), 0);
  const countChips = (key: string, val: string) => parsed.filter(f => Array.isArray(f.op[key]) && f.op[key].includes(val)).length;

  return { totalTime, nightTime, flightCount, parsed, sum, countChips };
}

const ROLE_EMOJI: Record<string, string> = {
  'crew-chief': '🎖️', swimmer: '🏊', hoist: '⚓', hems: '🏥', loadmaster: '📦',
};

function OperatorDashboard({ flights, role, formatTime: fmt }: {
  flights: Flight[]; role: SubRole; formatTime: (v: number) => string;
}) {
  const st = computeOperatorStats(flights, role);
  const emoji = ROLE_EMOJI[role] ?? '🎖️';
  const sv = useTranslation().t('yes') === 'Ja'; // quick lang check

  const StatBox = ({ label, value, color = Colors.textPrimary }: { label: string; value: string; color?: string }) => (
    <View style={s.classCell}>
      <Text style={s.classCellLabel}>{label}</Text>
      <Text style={[s.classCellValue, { color }]}>{value}</Text>
    </View>
  );

  return (
    <View style={{ gap: 10 }}>
      {/* Hero stats */}
      <View style={s.classGrid}>
        <StatBox label={sv ? 'FLYGNINGAR' : 'FLIGHTS'} value={String(st.flightCount)} />
        <StatBox label={sv ? 'TOTAL' : 'TOTAL'} value={fmt(st.totalTime)} color={Colors.primary} />
        <StatBox label={sv ? 'NATT' : 'NIGHT'} value={fmt(st.nightTime)} color={Colors.gold} />
      </View>

      {/* Role-specific stats */}
      {role === 'crew-chief' && (
        <>
          <View style={s.classGrid}>
            <StatBox label={sv ? 'SKOTT' : 'ROUNDS'} value={String(st.sum('rounds_fired'))} color={Colors.danger} />
            <StatBox label={sv ? 'BALJEFÄLL' : 'BUCKET'} value={String(st.sum('fire_bucket_drops'))} color={Colors.info} />
          </View>
          <View style={[s.card, { padding: 12, gap: 6 }]}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, fontFamily: 'Menlo' }}>
              {sv ? 'KABINPLATS SENASTE 3 MÅN' : 'CABIN POSITIONS LAST 3 MONTHS'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['left', 'rear', 'right'].map(pos => {
                const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
                const cutoff = threeMonthsAgo.toISOString().split('T')[0];
                const count = st.parsed.filter(f => f.op.seat_position === pos && f.date >= cutoff).length;
                const label = pos === 'left' ? (sv ? 'Vänster' : 'Left') : pos === 'right' ? (sv ? 'Höger' : 'Right') : (sv ? 'Bak' : 'Rear');
                return (
                  <View key={pos} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: Colors.elevated, borderRadius: 8 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800', fontFamily: 'Menlo' }}>{count}</Text>
                    <Text style={{ color: Colors.textMuted, fontSize: 10, marginTop: 2 }}>{label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </>
      )}

      {role === 'swimmer' && (
        <View style={s.classGrid}>
          <StatBox label={sv ? 'INSATSER' : 'DEPLOYS'} value={String(st.sum('deployments'))} color={Colors.info} />
          <StatBox label={sv ? 'VINSCH ↑' : 'HOIST ↑'} value={String(st.sum('hoists_up'))} />
          <StatBox label={sv ? 'RÄDDADE' : 'RESCUED'} value={String(st.sum('persons_rescued'))} color={Colors.success} />
        </View>
      )}

      {role === 'hoist' && (
        <View style={s.classGrid}>
          <StatBox label={sv ? 'VINSCH ↑' : 'HOIST ↑'} value={String(st.sum('hoists_up'))} color={Colors.primary} />
          <StatBox label={sv ? 'VINSCH ↓' : 'HOIST ↓'} value={String(st.sum('hoists_down'))} color={Colors.primary} />
        </View>
      )}

      {role === 'hems' && (
        <View style={s.classGrid}>
          <StatBox label={sv ? 'PATIENTER' : 'PATIENTS'} value={String(st.sum('patients'))} color={Colors.danger} />
          <StatBox label={sv ? 'VINSCH' : 'HOISTS'} value={String(st.sum('hoists'))} />
          <StatBox label="P1" value={String(st.parsed.filter(f => f.op.priority === 'P1').length)} color={Colors.danger} />
        </View>
      )}

      {role === 'loadmaster' && (
        <View style={s.classGrid}>
          <StatBox label={sv ? 'HÄNGLAST' : 'SLING'} value={String(st.sum('sling_ops'))} color={Colors.primary} />
          <StatBox label={sv ? 'FÄLLN.' : 'DROPS'} value={String(st.sum('airdrops'))} color={Colors.info} />
        </View>
      )}
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter();
  const mode = useAppModeStore((s) => s.mode);
  const _theme = useThemeStore((s) => s.theme); // subscribe to force re-render on theme change
  const { stats, flights, flightCount, isLoading, loadStats, loadFlights } = useFlightStore();
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const [xcMapVisible, setXcMapVisible] = useState(false);
  const [weekMapVisible, setWeekMapVisible] = useState(false);
  const [stress, setStress] = useState<StressData>({ index: 0, zone: 'low', hours14: 0, baseline14: 0, advice: '' });
  const [refreshKey, setRefreshKey] = useState(0);
  const needleAnim = useRef(new Animated.Value(0)).current;
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    loadStats();
    loadFlights();
    getStressHours().then(({ recent14, yearAvg14 }) => setStress(computeStress(recent14, yearAvg14)));
    getSetting('profile_first_name').then(v => setProfileName(v ?? ''));
  }, []);

  useEffect(() => {
    needleAnim.setValue(0);
    Animated.timing(needleAnim, {
      toValue: Math.min((stress.index / 240) * 100, 100),
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [stress.index, refreshKey]);

  const readoutAnim = useRef(new Animated.Value(0)).current;
  const [readoutPct, setReadoutPct] = useState(0);

  useEffect(() => {
    readoutAnim.setValue(0);
    Animated.timing(readoutAnim, {
      toValue: 1,
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    const listener = readoutAnim.addListener(({ value }) => setReadoutPct(value));
    return () => readoutAnim.removeListener(listener);
  }, [stats?.total_time, refreshKey]);

  const st = stats;
  const zc = zoneColor(stress.zone);

  const animTime = (v: number) => decimalToHHMM(v * readoutPct);
  const latestFlights = flights.slice(0, 3);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const name = profileName || '';
    const g = h < 12 ? t('good_morning') : h < 18 ? t('good_afternoon') : t('good_evening');
    return name ? `${g}, ${name}` : g;
  }, [profileName, t]);

  if (mode !== 'manned') return <View style={s.container} />;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setRefreshKey(k => k + 1);
        await Promise.all([
          loadStats(),
          loadFlights(),
          getStressHours().then(({ recent14, yearAvg14 }) => setStress(computeStress(recent14, yearAvg14))),
        ]);
      }} tintColor={Colors.primary} />}
    >
      {/* ── Header ── */}
      <Text style={s.hudGreeting}>{greeting}</Text>

      {/* ── Telemetry Panel ── */}
      <View style={s.telPanel}>
        {/* Top: stress gauge bar */}
        <View style={s.telGaugeHeader}>
          <Text style={s.telGaugeLabel}>WORKLOAD · 14D</Text>
          <Text style={[s.telGaugeZone, { color: zc }]}>{stress.zone.toUpperCase()}</Text>
        </View>

        {/* Gauge bar with zones */}
        <View style={s.telGaugeTrack}>
          {(() => {
            const zones = [
              { max: 40, c: Colors.info },
              { max: 70, c: Colors.primary },
              { max: 140, c: Colors.success },
              { max: 195, c: Colors.warning },
              { max: 240, c: Colors.danger },
            ];
            const activeIdx = zones.findIndex((z, i) => {
              const from = i === 0 ? 0 : zones[i - 1].max;
              return stress.index >= from && stress.index < z.max;
            });
            if (activeIdx === -1 && stress.index >= 240) {
              // in last zone
            }
            return zones.map((z, i) => {
              const from = i === 0 ? 0 : zones[i - 1].max;
              const isActive = stress.index >= from && stress.index < z.max || (i === zones.length - 1 && stress.index >= from);
              return <View key={i} style={{ flex: z.max - from, backgroundColor: z.c, opacity: isActive ? 0.75 : 0.2 }} />;
            });
          })()}
          <View style={{
            position: 'absolute', left: `${(100 / 240) * 100}%`, top: -2, bottom: -2,
            width: 1.5, backgroundColor: Colors.textPrimary, opacity: 0.4,
          }} />
          <Animated.View style={{
            position: 'absolute',
            left: needleAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
            top: -3, width: 14, height: 14, borderRadius: 7, marginLeft: -7,
            backgroundColor: zc, borderWidth: 2, borderColor: Colors.background,
            shadowColor: zc, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 4,
          }} />
        </View>

        {/* Percentage display */}
        <View style={s.telPctRow}>
          <StressRing stress={stress} size={90} animKey={refreshKey} />
          <View style={{ flex: 1, gap: 6 }}>
            {/* Readout rows */}
            {[
              { l: 'TOTAL', v: animTime(st?.total_time ?? 0), c: Colors.textPrimary },
              { l: 'YTD', v: animTime(st?.year_to_date ?? 0), c: Colors.primary },
              { l: '14D / AVG', v: `${animTime(stress.hours14)} / ${animTime(stress.baseline14)}`, c: zc },
            ].map(m => (
              <View key={m.l} style={s.telReadout}>
                <Text style={s.telReadoutLabel}>{m.l}</Text>
                <Text style={[s.telReadoutValue, { color: m.c }]}>{m.v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Advice inline */}
        <View style={[s.telAdvice, { borderLeftColor: zc, backgroundColor: zc + '10' }]}>
          <Ionicons name="pulse" size={12} color={zc} />
          <Text style={s.telAdviceText}>{stress.advice}</Text>
        </View>
      </View>

      {/* ── Stats ── */}
      {isOperator(useProfileStore.getState().profile) ? (
        <>
          <Text style={s.sectionHeader}>
            {ROLE_EMOJI[useProfileStore.getState().profile?.subRole ?? ''] ?? ''} {t(`profile_${useProfileStore.getState().profile?.subRole}` as any)}
          </Text>
          <OperatorDashboard flights={flights} role={useProfileStore.getState().profile!.subRole} formatTime={formatTime} />
        </>
      ) : (
        <>
          <Text style={s.sectionHeader}>Class · Time Breakdown</Text>
          <View style={s.classGrid}>
            {[
              { l: 'PIC', v: formatTime(st?.total_pic ?? 0), c: Colors.textPrimary },
              { l: 'CO', v: formatTime(st?.total_co_pilot ?? 0), c: Colors.textPrimary },
              { l: 'IFR', v: formatTime(st?.total_ifr ?? 0), c: Colors.info },
              { l: 'NIGHT', v: formatTime(st?.total_night ?? 0), c: Colors.gold },
            ].map(c => (
              <View key={c.l} style={s.classCell}>
                <Text style={s.classCellLabel}>{c.l}</Text>
                <Text style={[s.classCellValue, { color: c.c }]}>{c.v}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ── Log new flight ── */}
      <TouchableOpacity style={s.addBtn} onPress={() => router.push(isOperator(useProfileStore.getState().profile) ? '/flight/add-operator' : '/flight/add')} activeOpacity={0.85}>
        <Ionicons name="add-circle" size={18} color={Colors.textInverse} />
        <Text style={s.addBtnText}>{t('log_new_flight')}</Text>
      </TouchableOpacity>

      {/* ── Latest Ops ── */}
      <Text style={s.sectionHeader}>Latest Ops</Text>
      <View style={s.card}>
        {latestFlights.map((f, i) => (
          <LatestFlightRow key={f.id} flight={f} isLast={i === latestFlights.length - 1} onPress={() => router.push(`/flight/${f.id}`)} />
        ))}
        {latestFlights.length === 0 && (
          <Text style={{ color: Colors.textMuted, fontSize: 13, padding: 16, textAlign: 'center' }}>{t('no_flights')}</Text>
        )}
      </View>

      {/* ── Pilot-only sections ── */}
      {!isOperator(useProfileStore.getState().profile) && (
        <>
          <Text style={s.sectionHeader}>Milestones</Text>

          <TouchableOpacity
            style={s.milestoneCard}
            onPress={() => st?.best_week_start && setWeekMapVisible(true)}
            activeOpacity={0.75}
          >
            <View style={[s.milestoneIcon, { backgroundColor: Colors.gold + '22' }]}>
              <Ionicons name="trophy" size={16} color={Colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.milestoneLabel}>Best week</Text>
              <Text style={s.milestoneValue}>{formatTime(st?.best_week_hours ?? 0)}h · {st?.best_week_label || '—'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.milestoneCard}
            onPress={() => st?.longest_xc_id && setXcMapVisible(true)}
            activeOpacity={0.75}
          >
            <View style={[s.milestoneIcon, { backgroundColor: Colors.primary + '22' }]}>
              <Ionicons name="navigate" size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.milestoneLabel}>Longest XC</Text>
              <Text style={s.milestoneValue}>
                {st?.longest_xc_km ? `${st.longest_xc_km} NM · ${st.longest_xc_first_dep} → ${st.longest_xc_last_arr}` : '—'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>

          <AirportMapWidget />

          {st?.longest_xc_date && (
            <RouteMapModal visible={xcMapVisible} onClose={() => setXcMapVisible(false)} xcDate={st.longest_xc_date} hours={st.longest_xc_hours} />
          )}
          {st?.best_week_start && (
            <BestWeekMapModal visible={weekMapVisible} onClose={() => setWeekMapVisible(false)} weekStart={st.best_week_start} weekLabel={st.best_week_label} hours={st.best_week_hours} />
          )}
        </>
      )}

    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },

  hudHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  hudLabel: { fontSize: 10, fontWeight: '700', color: Colors.primary, letterSpacing: 1.6, fontFamily: 'Menlo' },
  hudGreeting: { fontSize: 24, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.8, marginBottom: 14, fontFamily: 'Georgia' },
  readyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  readyDot: { width: 6, height: 6, borderRadius: 3, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4 },
  readyText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, fontFamily: 'Menlo' },

  telPanel: {
    borderRadius: 14, overflow: 'hidden',
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.background,
    padding: 14, gap: 12, marginBottom: 10,
  },
  telGaugeHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
  },
  telGaugeLabel: {
    fontSize: 9, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, fontFamily: 'Menlo',
  },
  telGaugeZone: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, fontFamily: 'Menlo' },
  telGaugeTrack: {
    flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'visible',
    backgroundColor: Colors.separator, position: 'relative',
  },
  telPctRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  telReadout: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: 5, paddingHorizontal: 10,
    backgroundColor: Colors.background + 'CC', borderRadius: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  telReadoutLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, fontFamily: 'Menlo' },
  telReadoutValue: { fontSize: 13, fontWeight: '800', fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
  telAdvice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 8, borderRadius: 8, borderLeftWidth: 3,
  },
  telAdviceText: { flex: 1, fontSize: 11, color: Colors.textPrimary, lineHeight: 16 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, marginTop: 14, marginBottom: 10,
  },
  addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  sectionHeader: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, fontFamily: 'Menlo', marginTop: 16, marginBottom: 8,
  },

  card: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },

  classGrid: { flexDirection: 'row', gap: 6 },
  classCell: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 6,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 8, alignItems: 'center',
  },
  classCellLabel: { fontSize: 8, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, fontFamily: 'Menlo' },
  classCellValue: { fontSize: 14, fontWeight: '800', marginTop: 3, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },

  milestoneCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 8,
  },
  milestoneIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  milestoneLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, fontFamily: 'Menlo' },
  milestoneValue: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginTop: 1, letterSpacing: -0.1 },

  latestRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  latestDate: { alignItems: 'center', width: 36 },
  latestDay: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  latestMonth: { fontSize: 9, fontWeight: '600', color: Colors.textMuted, letterSpacing: 0.4 },
  latestRoute: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.1 },
  latestMeta: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  latestTime: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
});
