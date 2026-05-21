import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, Modal, Pressable, Dimensions, FlatList,
  StyleSheet, RefreshControl, ActivityIndicator, Animated, Easing,
  Alert, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useFlightStore } from '../../store/flightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { Colors } from '../../constants/colors';
import { AirportMapWidget } from '../../components/AirportMapWidget';
import { useTimeFormat, decimalToHHMM } from '../../hooks/useTimeFormat';
import { FlightShareCard } from '../../components/FlightShareCard';
import { MissingNvgModal } from '../../components/MissingNvgModal';
import { MissingDualModal } from '../../components/MissingDualModal';
import { MissingInstructorModal } from '../../components/MissingInstructorModal';
import { RouteMapModal } from '../../components/RouteMapModal';
import { BestWeekMapModal } from '../../components/BestWeekMapModal';
import { getStressHours, getSetting, getFlightsWithPhotos } from '../../db/flights';
import { useVersionStore } from '../../store/versionStore';
import { batchPlaceNames } from '../../db/icao';
import { formatDate } from '../../utils/format';

let runwayData: Record<string, number[]> = {};
try { runwayData = require('../../assets/runways.json'); } catch {}
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
    index <= 29 ? 'low' : index <= 69 ? 'light' : index <= 130 ? 'normal'
    : index <= 169 ? 'elevated' : index <= 200 ? 'high' : 'critical';
  const adviceMap: Record<StressZone, string> = {
    low: 'Low activity. Consider a refresher if returning to ops.',
    light: 'Below average activity. Ideal time to refresh skills and techniques.',
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

function LatestFlightRow({ flight, onPress, isLast, placeNames, onPhotoPress }: { flight: Flight; onPress: () => void; isLast?: boolean; placeNames?: Record<string, string>; onPhotoPress?: (f: Flight) => void }) {
  const ls = makeDashStyles();
  const { formatTime } = useTimeFormat();
  const f = flight;
  const day = f.date?.split('-')[2] ?? '??';
  const mIdx = parseInt(f.date?.split('-')[1] ?? '0') - 1;
  const depName = placeNames?.[f.dep_place?.toUpperCase()] ?? f.dep_place;
  const arrName = placeNames?.[f.arr_place?.toUpperCase()] ?? f.arr_place;

  // Build flight condition segments
  const total = f.total_time || 0.01;
  const ifrH = f.ifr || 0;
  const nightH = f.night || 0;
  const nvgH = f.nvg || 0;
  const vfrH = Math.max(total - ifrH - nightH, 0);
  const segments: { color: string; pct: number; label: string }[] = [];
  if (vfrH > 0) segments.push({ color: Colors.primary, pct: (vfrH / total) * 100, label: 'VFR' });
  if (ifrH > 0) segments.push({ color: Colors.info, pct: (ifrH / total) * 100, label: 'IFR' });
  if (nightH > 0) segments.push({ color: '#1A2235', pct: (nightH / total) * 100, label: 'Night' });
  if (nvgH > 0) segments.push({ color: Colors.success, pct: (nvgH / total) * 100, label: 'NVG' });
  if (segments.length === 0) segments.push({ color: Colors.primary, pct: 100, label: 'VFR' });

  return (
    <TouchableOpacity
      style={[ls.latestRow, !isLast && { borderBottomWidth: 0.5, borderBottomColor: Colors.separator }]}
      onPress={onPress} activeOpacity={0.7}
    >
      <View style={ls.latestDate}>
        <Text style={ls.latestDay}>{day}</Text>
        <Text style={ls.latestMonth}>{MONTH_ABBR[mIdx] ?? ''}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 10, gap: 4 }}>
        {/* Route bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.textPrimary }} numberOfLines={1}>{depName}</Text>
          <View style={{ width: 40, height: 4, borderRadius: 2, flexDirection: 'row', overflow: 'hidden', backgroundColor: Colors.separator }}>
            {segments.map((seg, i) => (
              <View key={i} style={{ width: `${seg.pct}%`, height: 4, backgroundColor: seg.color }} />
            ))}
          </View>
          <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.textPrimary }} numberOfLines={1}>{arrName}</Text>
        </View>
        {/* Meta */}
        <Text style={ls.latestMeta}>{f.registration}</Text>
      </View>
      <Text style={ls.latestTime}>{formatTime(f.total_time)}</Text>
      {f.photo_uri ? (
        <TouchableOpacity
          style={{ width: 24, height: 24, borderRadius: 5, overflow: 'hidden', marginLeft: 6 }}
          onPress={() => onPhotoPress?.(f)}
          activeOpacity={0.8}
        >
          <Image source={{ uri: f.photo_uri }} style={{ width: 24, height: 24 }} resizeMode="cover" />
        </TouchableOpacity>
      ) : null}
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
  const s = makeDashStyles();
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

function MiniRunways({ icao, size = 20 }: { icao: string; size?: number }) {
  const headings = runwayData[icao];
  if (!headings || headings.length === 0) return null;
  const groups: { heading: number; offset: number }[] = [];
  const used = new Set<number>();
  for (let i = 0; i < headings.length; i++) {
    if (used.has(i)) continue;
    const parallel: number[] = [i];
    for (let j = i + 1; j < headings.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(headings[i] - headings[j]);
      if (Math.min(diff, 360 - diff) < 30) { parallel.push(j); used.add(j); }
    }
    used.add(i);
    const avg = headings[parallel[0]];
    for (let k = 0; k < parallel.length; k++) {
      groups.push({ heading: avg, offset: (k - (parallel.length - 1) / 2) * 3 });
    }
  }
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {groups.map((g, i) => {
        const rad = (g.heading - 90) * Math.PI / 180;
        return (
          <View key={i} style={{
            position: 'absolute', width: 1.5, height: size * 0.76,
            backgroundColor: '#D4A84B', borderRadius: 1,
            transform: [{ translateX: -Math.sin(rad) * g.offset }, { translateY: Math.cos(rad) * g.offset }, { rotate: `${g.heading}deg` }],
          }} />
        );
      })}
    </View>
  );
}

const SAMPLE_CARDS = [
  { id: 's1', image: require('../../assets/sample-photos/sample1.jpg'), dep: 'ESSA', arr: 'ESGG', date: '2026.03.14', ac: 'AS350', time: '1:24' },
  { id: 's3', image: require('../../assets/sample-photos/sample3.jpg'), dep: 'LOWI', arr: 'LSZH', date: '2026.01.22', ac: 'EC135', time: '0:48' },
];

function PhotoCard({ imageSource, dep, arr, meta, cardW, onPress, mediaType = 'image' }: {
  imageSource: any; dep: string; arr: string; meta: string; cardW: number; onPress?: () => void; mediaType?: 'image' | 'video';
}) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);

  useEffect(() => {
    if (mediaType === 'video' && imageSource?.uri) {
      (async () => {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(imageSource.uri, { time: 0 });
          setThumbnailUri(uri);
        } catch (err) {
          console.warn('Failed to generate thumbnail:', err);
        }
      })();
    }
  }, [mediaType, imageSource?.uri]);

  const displaySource = mediaType === 'video' && thumbnailUri ? { uri: thumbnailUri } : imageSource;

  return (
    <TouchableOpacity style={{ width: cardW, height: cardW * 0.65, borderRadius: 14, overflow: 'hidden' }} onPress={onPress} activeOpacity={0.9} disabled={!onPress}>
      <Image source={displaySource} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      {mediaType === 'video' && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={24} color="#000" />
          </View>
        </View>
      )}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <View style={{ alignItems: 'center' }}>
            <MiniRunways icao={dep} size={18} />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', fontFamily: 'Georgia', letterSpacing: 0.5 }}>{dep}</Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.5)' }} />
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' }} />
            <Ionicons name="airplane" size={10} color="rgba(255,255,255,0.7)" />
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' }} />
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.5)' }} />
          </View>
          <View style={{ alignItems: 'center' }}>
            <MiniRunways icao={arr} size={18} />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', fontFamily: 'Georgia', letterSpacing: 0.5 }}>{arr}</Text>
          </View>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontFamily: 'Georgia' }}>{meta}</Text>
        <Text style={{ color: Colors.gold + 'aa', fontSize: 7, fontWeight: '900', letterSpacing: 2, fontFamily: 'Georgia', marginTop: 4 }}>BLADES</Text>
      </View>
    </TouchableOpacity>
  );
}

function FlightPhotoCarousel({ placeNames, onPress, latestFlightId }: { placeNames: Record<string, string>; onPress: (f: Flight) => void; latestFlightId?: number }) {
  const router = useRouter();
  const { formatTime } = useTimeFormat();
  const { flightCount } = useFlightStore();
  const [photos, setPhotos] = useState<Flight[]>([]);
  const screenW = Dimensions.get('window').width;
  const GAP = 12;
  const CARD_W = screenW - 48;
  const SNAP = CARD_W + GAP;
  const SIDE_PAD = (screenW - CARD_W) / 2;

  useEffect(() => {
    getFlightsWithPhotos().then(f => setPhotos(f.slice(0, 30)));
  }, [flightCount]);

  useFocusEffect(useCallback(() => {
    getFlightsWithPhotos().then(f => setPhotos(f.slice(0, 30)));
  }, []));

  const hasFlight = photos.length > 0;
  const data = hasFlight ? photos : SAMPLE_CARDS;
  const [samplePreview, setSamplePreview] = useState<typeof SAMPLE_CARDS[0] | null>(null);

  return (
    <View>
      <Text style={makeDashStyles().sectionHeader}>Flight media</Text>
      <FlatList
        data={data}
        keyExtractor={(item: any) => String(item.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: SIDE_PAD }}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        renderItem={({ item }: any) => {
          if (hasFlight) {
            const f = item as Flight;
            const dep = placeNames[f.dep_place?.toUpperCase()] ?? f.dep_place;
            const arr = placeNames[f.arr_place?.toUpperCase()] ?? f.arr_place;
            return (
              <PhotoCard
                imageSource={{ uri: f.photo_uri }}
                dep={dep} arr={arr}
                meta={`${formatDate(f.date)} · ${f.aircraft_type} · ${formatTime(f.total_time)}h`}
                cardW={CARD_W}
                onPress={() => onPress(f)}
                mediaType={f.media_type === 'video' ? 'video' : 'image'}
              />
            );
          }
          const s = item;
          return (
            <PhotoCard
              imageSource={s.image}
              dep={s.dep} arr={s.arr}
              meta={`${s.date} · ${s.ac} · ${s.time}`}
              cardW={CARD_W}
              onPress={() => setSamplePreview(s)}
            />
          );
        }}
      />

      {latestFlightId && !photos.some(p => p.id === latestFlightId) && (
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 8, marginHorizontal: 40, paddingVertical: 8,
            borderRadius: 8, borderWidth: 1, borderColor: Colors.gold + '33',
            backgroundColor: Colors.gold + '08',
          }}
          onPress={() => router.push(`/flight/add?editId=${latestFlightId}&addPhoto=1` as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="camera-outline" size={14} color={Colors.gold} />
          <Text style={{ color: Colors.gold, fontSize: 11, fontWeight: '600' }}>Add picture from your latest flight</Text>
        </TouchableOpacity>
      )}

      <Modal visible={!!samplePreview} transparent animationType="fade" onRequestClose={() => setSamplePreview(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setSamplePreview(null)}>
          {samplePreview && (
            <View style={{ width: screenW * 0.92, aspectRatio: 3 / 4, borderRadius: 18, overflow: 'hidden' }}>
              <Image source={samplePreview.image} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <View style={{ alignItems: 'center' }}>
                    <MiniRunways icao={samplePreview.dep} size={24} />
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Georgia', letterSpacing: 0.5 }}>{samplePreview.dep}</Text>
                  </View>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.5)' }} />
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' }} />
                    <Ionicons name="airplane" size={12} color="rgba(255,255,255,0.7)" />
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' }} />
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.5)' }} />
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <MiniRunways icao={samplePreview.arr} size={24} />
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Georgia', letterSpacing: 0.5 }}>{samplePreview.arr}</Text>
                  </View>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'Georgia' }}>
                  {samplePreview.date} · {samplePreview.ac} · {samplePreview.time}
                </Text>
                <Text style={{ color: Colors.gold + 'aa', fontSize: 8, fontWeight: '900', letterSpacing: 2, fontFamily: 'Georgia', marginTop: 6 }}>BLADES</Text>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

function LogFlightButton({ onPress, onLongComplete, label }: { onPress: () => void; onLongComplete: () => void; label: string }) {
  const s = makeDashStyles();
  const fillAnim = useRef(new Animated.Value(0)).current;
  const [pressing, setPressing] = useState(false);
  const longFired = useRef(false);

  const handlePressIn = () => {
    setPressing(true);
    longFired.current = false;
    fillAnim.setValue(0);
    Animated.timing(fillAnim, { toValue: 1, duration: 1000, useNativeDriver: false }).start(({ finished }) => {
      if (finished) {
        longFired.current = true;
        onLongComplete();
        setPressing(false);
        fillAnim.setValue(0);
      }
    });
  };

  const handlePressOut = () => {
    if (!longFired.current) {
      fillAnim.stopAnimation();
      fillAnim.setValue(0);
      setPressing(false);
    }
  };

  const fillWidth = fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <TouchableOpacity
      style={[s.addBtn, { overflow: 'hidden' }]}
      onPress={() => { if (!longFired.current) onPress(); }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={0.95}
    >
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fillWidth, backgroundColor: Colors.gold, borderRadius: 14 }} />
      <Ionicons name={pressing ? 'scan-outline' : 'add-circle'} size={18} color={Colors.textInverse} style={{ zIndex: 1 }} />
      <Text style={[s.addBtnText, { zIndex: 1 }]}>{pressing ? 'Flight data scan' : label}</Text>
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const s = makeDashStyles();
  const router = useRouter();
  const mode = useAppModeStore((st) => st.mode);
  const _theme = useThemeStore((st) => st.theme); // subscribe to force re-render on theme change
  const { stats, flights, flightCount, isLoading, loadStats, loadFlights, tier } = useFlightStore();
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const [stress, setStress] = useState<StressData>({ index: 0, zone: 'low', hours14: 0, baseline14: 0, advice: '' });
  const [refreshKey, setRefreshKey] = useState(0);
  const needleAnim = useRef(new Animated.Value(0)).current;
  const [profileName, setProfileName] = useState('');
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [photoPreview, setPhotoPreview] = useState<Flight | null>(null);
  const [showLatestOps, setShowLatestOps] = useState(false);
  const [showClassBreakdown, setShowClassBreakdown] = useState(false);
  const [showMissingNvg, setShowMissingNvg] = useState(false);
  const [totalNvgAdded, setTotalNvgAdded] = useState(0);
  const [showMissingDual, setShowMissingDual] = useState(false);
  const [totalDualAdded, setTotalDualAdded] = useState(0);
  const [showMissingInstructor, setShowMissingInstructor] = useState(false);
  const [totalInstructorAdded, setTotalInstructorAdded] = useState(0);
  const [xcMapVisible, setXcMapVisible] = useState(false);
  const [weekMapVisible, setWeekMapVisible] = useState(false);
  const { updateAvailable, news, check: checkVersion } = useVersionStore();

  useEffect(() => {
    loadStats();
    loadFlights();
    getStressHours().then(({ recent14, yearAvg14 }) => setStress(computeStress(recent14, yearAvg14)));
    getSetting('profile_first_name').then(v => setProfileName(v ?? ''));
    checkVersion();
  }, []);

  useFocusEffect(useCallback(() => {
    loadStats();
    getStressHours().then(({ recent14, yearAvg14 }) => setStress(computeStress(recent14, yearAvg14)));
  }, [loadStats]));

  useEffect(() => {
    needleAnim.setValue(0);
    Animated.timing(needleAnim, {
      toValue: Math.min((stress.index / 200) * 100, 100),
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
  }, [stats?.total_time, stats?.year_to_date, refreshKey]);

  const st = stats;
  const zc = zoneColor(stress.zone);

  const animTime = (v: number) => decimalToHHMM(v * readoutPct);
  const latestFlights = flights.slice(0, 6);

  useEffect(() => {
    const icaos = latestFlights.flatMap(f => [f.dep_place, f.arr_place].filter(Boolean));
    if (icaos.length > 0) batchPlaceNames(icaos).then(setPlaceNames);
  }, [flights]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const name = profileName || '';
    const g = h < 12 ? t('good_morning') : h < 18 ? t('good_afternoon') : t('good_evening');
    return name ? `${g}, ${name}` : g;
  }, [profileName, t]);

  const greetingStyle = useMemo(() => ({
    ...s.hudGreeting,
    color: tier === 'max' ? Colors.silver : (tier === 'premium' ? Colors.gold : Colors.textPrimary),
  }), [tier]);

  if (mode !== 'manned') return <View style={s.container} />;

  return (<>
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
          checkVersion(),
        ]);
      }} tintColor={Colors.primary} />}
    >
      {/* ── Header ── */}
      <Text style={greetingStyle}>{greeting}</Text>

      {/* ── App news / update banner ── */}
      {updateAvailable && (
        <TouchableOpacity
          style={s.newsBanner}
          activeOpacity={0.8}
          onPress={() => {
            Alert.alert(t('update_available'), t('update_available_sub'), [
              { text: t('cancel'), style: 'cancel' },
              { text: 'App Store', onPress: () => Linking.openURL('https://apps.apple.com') },
            ]);
          }}
        >
          <Ionicons name="arrow-up-circle" size={18} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.newsBannerTitle}>{t('update_available')}</Text>
            <Text style={s.newsBannerBody}>{t('update_available_sub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
      {news && !updateAvailable && (
        <View style={[s.newsBanner, news.type === 'warning' && { borderColor: Colors.warning + '44', backgroundColor: Colors.warning + '08' }]}>
          <Ionicons name={news.type === 'warning' ? 'alert-circle' : 'information-circle'} size={18} color={news.type === 'warning' ? Colors.warning : Colors.info} />
          <View style={{ flex: 1 }}>
            <Text style={s.newsBannerTitle}>{news.title}</Text>
            <Text style={s.newsBannerBody}>{news.body}</Text>
          </View>
        </View>
      )}

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
              { max: 29, c: '#6B7280' },
              { max: 69, c: Colors.primary },
              { max: 130, c: Colors.success },
              { max: 169, c: Colors.warning },
              { max: 200, c: Colors.danger },
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
              return (
                <View
                  key={i}
                  style={{
                    flex: z.max - from,
                    backgroundColor: z.c,
                    opacity: isActive ? 0.75 : 0.08,
                    ...(isActive && {
                      borderRadius: 5,
                    }),
                  }}
                />
              );
            });
          })()}
          <View style={{
            position: 'absolute', left: `${(100 / 200) * 100}%`, top: -2, bottom: -2,
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
          <StressRing stress={stress} size={110} animKey={refreshKey} />
          <View style={{ flex: 1, gap: 6 }}>
            {/* Readout rows */}
            {[
              { l: 'TOTAL', v: animTime(st?.total_time ?? 0), c: Colors.gold },
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

      {/* ── Latest Ops ── */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 }}
        onPress={() => setShowLatestOps(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={[s.sectionHeader, { marginTop: 0, marginBottom: 0 }]} numberOfLines={1}>Latest Ops</Text>
        <Ionicons name={showLatestOps ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
      </TouchableOpacity>
      {showLatestOps && (
        <View style={s.card}>
          {latestFlights.map((f, i) => (
            <LatestFlightRow key={f.id} flight={f} isLast={i === latestFlights.length - 1} onPress={() => router.push(`/flight/${f.id}`)} placeNames={placeNames} onPhotoPress={setPhotoPreview} />
          ))}
          {latestFlights.length === 0 && (
            <Text style={{ color: Colors.textMuted, fontSize: 13, padding: 16, textAlign: 'center' }}>{t('no_flights')}</Text>
          )}
        </View>
      )}

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
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 }}
            onPress={() => setShowClassBreakdown(v => !v)}
            activeOpacity={0.7}
          >
            <Text style={[s.sectionHeader, { marginTop: 0, marginBottom: 0 }]}>Class · Time Breakdown</Text>
            <Ionicons name={showClassBreakdown ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          <View style={s.classGrid}>
            {[
              { l: 'PIC', v: formatTime(st?.total_pic ?? 0), c: Colors.textPrimary },
              { l: 'CO', v: formatTime(st?.total_co_pilot ?? 0), c: Colors.textPrimary },
              { l: 'IFR', v: formatTime(st?.total_ifr ?? 0), c: Colors.textPrimary },
              { l: 'NIGHT', v: formatTime(st?.total_night ?? 0), c: Colors.textPrimary },
            ].map(c => (
              <View key={c.l} style={s.classCell}>
                <Text style={s.classCellLabel}>{c.l}</Text>
                <Text style={[s.classCellValue, { color: c.c }]} numberOfLines={1} adjustsFontSizeToFit>{c.v}</Text>
              </View>
            ))}
          </View>
          {showClassBreakdown && (
            <View style={[s.card, { marginTop: 12 }]}>
              {[
                { l: 'DUAL', v: formatTime(st?.total_dual ?? 0), showAddBtn: true, addBtnKey: 'dual' },
                { l: 'INSTR', v: formatTime(st?.total_instructor ?? 0), showAddBtn: true, addBtnKey: 'instructor' },
                { l: 'MP', v: formatTime(st?.total_multi_pilot ?? 0) },
                { l: 'NVG', v: formatTime(st?.total_nvg ?? 0), showAddBtn: true, addBtnKey: 'nvg' },
                { l: 'DAY LD', v: String(st?.total_landings_day ?? 0) },
                { l: 'NIGHT LD', v: String(st?.total_landings_night ?? 0) },
              ].map((c: any, i) => (
                <View key={c.l} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: i < 6 ? 1 : 0, borderBottomColor: Colors.separator }}>
                  <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>{c.l}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {c.showAddBtn && (
                      <TouchableOpacity onPress={() => {
                        if (c.addBtnKey === 'dual') setShowMissingDual(true);
                        else if (c.addBtnKey === 'instructor') setShowMissingInstructor(true);
                        else setShowMissingNvg(true);
                      }} hitSlop={8}>
                        <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
                      </TouchableOpacity>
                    )}
                    <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>{c.v}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* ── Log new flight ── */}
      <LogFlightButton onPress={() => router.push(isOperator(useProfileStore.getState().profile) ? '/flight/add-operator' : '/flight/add')} onLongComplete={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); router.push('/flight/add?aiImport=1'); }} label={t('log_new_flight')} />

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


          <FlightPhotoCarousel placeNames={placeNames} onPress={setPhotoPreview} latestFlightId={flights[0]?.id} />

          <MissingNvgModal visible={showMissingNvg} onClose={() => setShowMissingNvg(false)} onTotalNvgUpdate={setTotalNvgAdded} />
          <MissingDualModal visible={showMissingDual} onClose={() => setShowMissingDual(false)} onTotalDualUpdate={setTotalDualAdded} />
          <MissingInstructorModal visible={showMissingInstructor} onClose={() => setShowMissingInstructor(false)} onTotalInstructorUpdate={setTotalInstructorAdded} />

          {st?.longest_xc_date && (
            <RouteMapModal visible={xcMapVisible} onClose={() => setXcMapVisible(false)} xcDate={st.longest_xc_date} hours={st.longest_xc_hours} />
          )}
          {st?.best_week_start && (
            <BestWeekMapModal visible={weekMapVisible} onClose={() => setWeekMapVisible(false)} weekStart={st.best_week_start} weekLabel={st.best_week_label} hours={st.best_week_hours} />
          )}
        </>
      )}


    </ScrollView>

    {photoPreview && (
      <FlightShareCard
        flight={photoPreview}
        depName={placeNames[photoPreview.dep_place?.toUpperCase()] ?? photoPreview.dep_place}
        arrName={placeNames[photoPreview.arr_place?.toUpperCase()] ?? photoPreview.arr_place}
        visible={!!photoPreview}
        onClose={() => setPhotoPreview(null)}
        formatTime={formatTime}
      />
    )}
  </>);
}

// ── Styles ───────────────────────────────────────────────────────────────────

function makeDashStyles() { return StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 32 },

  hudHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  hudLabel: { fontSize: 10, fontWeight: '700', color: Colors.primary, letterSpacing: 1.6, fontFamily: 'Menlo' },
  hudGreeting: { fontSize: 28, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.8, marginBottom: 16, fontFamily: 'Georgia' },

  newsBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.primary + '08', borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary + '33',
    padding: 12, marginBottom: 12,
  },
  newsBannerTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  newsBannerBody: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  readyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  readyDot: { width: 6, height: 6, borderRadius: 3, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4 },
  readyText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, fontFamily: 'Menlo' },

  telPanel: {
    borderRadius: 16, overflow: 'hidden',
    backgroundColor: Colors.background, borderWidth: 0,
    padding: 4, gap: 14, marginBottom: 14,
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
    flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'visible',
    backgroundColor: Colors.separator, position: 'relative',
  },
  telPctRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  telReadout: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: 5, paddingHorizontal: 10,
    backgroundColor: Colors.background + 'CC', borderRadius: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  telReadoutLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, fontFamily: 'Menlo' },
  telReadoutValue: { fontSize: 16, fontWeight: '800', fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
  telAdvice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 8, borderRadius: 8, borderLeftWidth: 3,
  },
  telAdviceText: { flex: 1, fontSize: 11, color: Colors.textPrimary, lineHeight: 16 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, marginTop: 16, marginBottom: 6,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  addBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '800' },

  sectionHeader: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.4, fontFamily: 'Menlo', marginTop: 6, marginBottom: 10,
  },

  card: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },

  classGrid: { flexDirection: 'row', gap: 8 },
  classCell: {
    flex: 1, paddingVertical: 14, paddingHorizontal: 8,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 10, alignItems: 'center',
  },
  classCellLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, fontFamily: 'Menlo' },
  classCellValue: { fontSize: 17, fontWeight: '800', marginTop: 4, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },

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
}); }
