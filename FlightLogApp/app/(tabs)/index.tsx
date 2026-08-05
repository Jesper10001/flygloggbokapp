import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, Modal, Pressable, Dimensions,
  StyleSheet, RefreshControl, ActivityIndicator, Animated, Easing,
  Alert, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useFlightStore } from '../../store/flightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { Colors } from '../../constants/colors';
import { AirportMapWidget } from '../../components/AirportMapWidget';
import { GlobalMapButton } from '../../components/GlobalMapButton';
import { DashboardGlobe } from '../../components/DashboardGlobe';
import { OpenAipMapModal } from '../../components/OpenAipMapModal';
import { useTimeFormat, decimalToHHMM } from '../../hooks/useTimeFormat';
import { FONT_LED7 } from '../../components/logflight/tokens';
import { FlightShareCard } from '../../components/FlightShareCard';
import { RouteMapModal } from '../../components/RouteMapModal';
import { BestWeekMapModal } from '../../components/BestWeekMapModal';
import { BWCardCompact } from '../../components/milestones/BWCardCompact';
import { LXCardCompact } from '../../components/milestones/LXCardCompact';
import { FlightCardRow } from '../../components/logbook-page/FlightCardRow';
import { LatestFlightCard } from '../../components/logbook-page/LatestFlightCard';
import { useBestWeekDetails, useLongestXcLegs } from '../../hooks/useMilestoneDetails';
import { PremiumModal } from '../../components/PremiumModal';
import { monthShort } from '../../utils/dateLabels';
import { getStressHours, getSetting, getFlightsWithPhotos, updateFlightNight } from '../../db/flights';
import { hasPendingSync } from '../../services/photoSync';
import { useVersionStore } from '../../store/versionStore';
import { usePendingPlaceStore } from '../../store/pendingPlaceStore';
import { useNightUpdateStore } from '../../store/nightUpdateStore';
import { getDashboardSpreadPrompt, setAckedSpread, type SpreadPrompt } from '../../db/digitalBooks';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { setScanImage } from '../../store/scanStore';
import { batchPlaceNames, getAirportCoordinates } from '../../db/icao';
import { formatDate, isValidTime } from '../../utils/format';
import { computeSunWindow } from '../../utils/flightTime';

let runwayData: Record<string, number[]> = {};
try { runwayData = require('../../assets/runways.json'); } catch {}
import { useTranslation } from '../../hooks/useTranslation';
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
  if (zone === 'low') return Colors.textMuted;
  if (zone === 'light') return Colors.primary;
  if (zone === 'normal') return Colors.success;
  if (zone === 'elevated') return Colors.warning;
  if (zone === 'high') return Colors.danger;
  if (zone === 'critical') return Colors.danger;
  return Colors.primary;
}
// ── StressRing ──────────────────────────────────────────────────────────────

function StressRing({ stress, size = 120, ready = false }: { stress: StressData; size?: number; ready?: boolean }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const targetPct = Math.min(stress.index, 240) / 240;
  const color = zoneColor(stress.zone);

  // Animera ÖKNINGEN (prev → nytt index) efter en loggad flight; visa slutvärde direkt vid
  // första laddningen/reload (ingen uppräkning från 0).
  const animVal = useRef(new Animated.Value(1)).current;
  const [displayPct, setDisplayPct] = useState(targetPct);
  const [displayIndex, setDisplayIndex] = useState(stress.index);
  const prev = useRef({ pct: 0, index: 0 });
  const inited = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!inited.current) {
      inited.current = true;
      prev.current = { pct: targetPct, index: stress.index };
      setDisplayPct(targetPct); setDisplayIndex(stress.index);
      return;
    }
    if (prev.current.index === stress.index) return;
    const fp = prev.current.pct, fi = prev.current.index;
    animVal.setValue(0);
    const listener = animVal.addListener(({ value }) => {
      setDisplayPct(fp + (targetPct - fp) * value);
      setDisplayIndex(Math.round(fi + (stress.index - fi) * value));
    });
    Animated.timing(animVal, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      .start(({ finished }) => { if (finished) prev.current = { pct: targetPct, index: stress.index }; });
    return () => animVal.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stress.index, ready]);

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

// Slå ihop sol-fönstrets segment till binär dag/natt (skymning räknas som dag).
type DNSeg = { startFrac: number; endFrac: number; night: boolean };
function toDayNight(segs: { startFrac: number; endFrac: number; kind: 'day' | 'twilight' | 'night' }[]): DNSeg[] {
  const out: DNSeg[] = [];
  for (const s of segs) {
    const night = s.kind === 'night';
    const last = out[out.length - 1];
    if (last && last.night === night) last.endFrac = s.endFrac;
    else out.push({ startFrac: s.startFrac, endFrac: s.endFrac, night });
  }
  return out;
}

function LatestFlightRow({ flight, onPress, isLast, placeNames, onPhotoPress }: { flight: Flight; onPress: () => void; isLast?: boolean; placeNames?: Record<string, string>; onPhotoPress?: (f: Flight) => void }) {
  const ls = makeDashStyles();
  const { formatTime } = useTimeFormat();
  const f = flight;
  const day = f.date?.split('-')[2] ?? '??';
  const mIdx = parseInt(f.date?.split('-')[1] ?? '0') - 1;
  const depName = placeNames?.[f.dep_place?.toUpperCase()] ?? f.dep_place;
  const arrName = placeNames?.[f.arr_place?.toUpperCase()] ?? f.arr_place;

  // Dag/natt-färgning av rutt-strecket (cyan = dag, guld = natt) längs storcirkeln.
  const [sunSegs, setSunSegs] = useState<DNSeg[] | null>(null);
  useEffect(() => {
    let alive = true;
    const dep = f.dep_place?.toUpperCase();
    const arr = f.arr_place?.toUpperCase();
    if (!dep || !arr || !f.date || !f.dep_utc || !f.arr_utc || !isValidTime(f.dep_utc) || !isValidTime(f.arr_utc)) {
      setSunSegs(null); return;
    }
    getAirportCoordinates([dep, arr]).then((rows) => {
      if (!alive) return;
      const a = rows.find(r => r.icao === dep);
      const b = rows.find(r => r.icao === arr);
      if (!a || !b) { setSunSegs(null); return; }
      const win = computeSunWindow([{ depLat: a.lat, depLon: a.lon, arrLat: b.lat, arrLon: b.lon, depUtc: f.dep_utc, arrUtc: f.arr_utc }], f.date);
      setSunSegs(win ? toDayNight(win.segments) : null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [f.id, f.dep_place, f.arr_place, f.dep_utc, f.arr_utc, f.date]);

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
          <View style={{ width: 60, height: 4, borderRadius: 2, flexDirection: 'row', overflow: 'hidden', backgroundColor: Colors.separator }}>
            {sunSegs && sunSegs.length > 0 ? (
              sunSegs.map((seg, i) => (
                <View key={i} style={{ width: `${(seg.endFrac - seg.startFrac) * 100}%`, height: 4, backgroundColor: seg.night ? Colors.gold : Colors.primary }} />
              ))
            ) : (
              <View style={{ width: '100%', height: 4, backgroundColor: Colors.primary }} />
            )}
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
    <TouchableOpacity style={{ width: cardW, height: 140, borderRadius: 14, overflow: 'hidden' }} onPress={onPress} activeOpacity={0.9} disabled={!onPress}>
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

// Actions-sida (sida 2 i karusellen): tre snabbknappar. Sync gråas ut när inget finns att synka.
function CarouselActions({ cardW, canSync, hasPhoto, onAlbum, onSync, onShare }: {
  cardW: number; canSync: boolean; hasPhoto: boolean;
  onAlbum: () => void; onSync: () => void; onShare: () => void;
}) {
  const tiles: { key: string; icon: any; color: string; label: string; sub?: string; disabled: boolean; onPress: () => void }[] = [
    { key: 'album', icon: 'images-outline', color: Colors.gold, label: 'Flight album', disabled: false, onPress: onAlbum },
    { key: 'sync', icon: 'sync-outline', color: Colors.primary, label: 'Sync album', sub: canSync ? undefined : 'Up to date', disabled: !canSync, onPress: onSync },
    { key: 'share', icon: 'share-outline', color: Colors.info, label: 'Share', sub: hasPhoto ? undefined : 'No photos', disabled: !hasPhoto, onPress: onShare },
  ];
  return (
    <View style={{ width: cardW, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row' }}>
      {tiles.map((tile, i) => (
        <TouchableOpacity
          key={tile.key}
          disabled={tile.disabled}
          activeOpacity={0.85}
          onPress={tile.onPress}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 4, borderLeftWidth: i ? 1 : 0, borderLeftColor: Colors.border, opacity: tile.disabled ? 0.38 : 1 }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tile.color + '1A', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={tile.icon} size={21} color={tile.color} />
          </View>
          <Text style={{ color: Colors.textPrimary, fontSize: 11.5, fontWeight: '700', textAlign: 'center' }}>{tile.label}</Text>
          {tile.sub ? <Text style={{ color: Colors.textMuted, fontSize: 8.5, fontWeight: '700', marginTop: -4 }}>{tile.sub}</Text> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

function FlightPhotoCarousel({ placeNames, onPress }: { placeNames: Record<string, string>; onPress: (f: Flight) => void }) {
  const router = useRouter();
  const { formatTime } = useTimeFormat();
  const { flightCount } = useFlightStore();
  const [photos, setPhotos] = useState<Flight[]>([]);
  const [canSync, setCanSync] = useState(false);
  const [page, setPage] = useState(0);
  const screenW = Dimensions.get('window').width;
  const GAP = 12;
  // Full innehållsbredd (= "Visited airports" + "Global map" tillsammans): skärmbredd minus
  // dashboardens content-padding (12px per sida). SIDE_PAD = 0 → sidorna ligger kant-i-kant
  // med korten nedanför (parenten ger redan 12px), ingen peek.
  const CARD_W = screenW - 24;
  const SNAP = CARD_W + GAP;
  const SIDE_PAD = 0;

  const reload = useCallback(() => {
    getFlightsWithPhotos().then(f => setPhotos(f.filter(x => x.photo_uri).slice(0, 30))); // bara uppladdade bilder
    hasPendingSync().then(setCanSync).catch(() => setCanSync(false));
  }, []);
  useEffect(() => { reload(); }, [flightCount, reload]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const hasFlight = photos.length > 0;
  const latest = photos[0]; // karusellen visar bara den senast sparade bilden
  const [samplePreview, setSamplePreview] = useState<typeof SAMPLE_CARDS[0] | null>(null);

  return (
    <View>
      {/* Sida 1: senaste bilden · Sida 2 (svep vänster): album/sync/share */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: SIDE_PAD }}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / SNAP))}
      >
        <View style={{ width: CARD_W }}>
          {hasFlight ? (
            <PhotoCard
              imageSource={{ uri: latest.photo_uri }}
              dep={placeNames[latest.dep_place?.toUpperCase()] ?? latest.dep_place}
              arr={placeNames[latest.arr_place?.toUpperCase()] ?? latest.arr_place}
              meta={`${formatDate(latest.date)} · ${latest.aircraft_type} · ${formatTime(latest.total_time)}h`}
              cardW={CARD_W}
              onPress={() => onPress(latest)}
              mediaType={latest.media_type === 'video' ? 'video' : 'image'}
            />
          ) : (
            <PhotoCard
              imageSource={SAMPLE_CARDS[0].image}
              dep={SAMPLE_CARDS[0].dep} arr={SAMPLE_CARDS[0].arr}
              meta={`${SAMPLE_CARDS[0].date} · ${SAMPLE_CARDS[0].ac} · ${SAMPLE_CARDS[0].time}`}
              cardW={CARD_W}
              onPress={() => setSamplePreview(SAMPLE_CARDS[0])}
            />
          )}
        </View>
        <View style={{ width: GAP }} />
        <View style={{ width: CARD_W }}>
          <CarouselActions
            cardW={CARD_W}
            canSync={canSync}
            hasPhoto={hasFlight}
            onAlbum={() => router.push('/settings/album' as any)}
            onSync={() => router.push('/photo-sync' as any)}
            onShare={() => router.push('/settings/album?share=1' as any)}
          />
        </View>
      </ScrollView>

      {/* Sidindikator (2 sidor) */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {[0, 1].map((i) => (
          <View key={i} style={{ width: page === i ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: page === i ? Colors.primary : Colors.border }} />
        ))}
      </View>

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

function LogFlightButton({ onPress, label, style }: { onPress: () => void; label: string; style?: any }) {
  const s = makeDashStyles();
  return (
    <TouchableOpacity style={[s.addBtn, style]} onPress={onPress} activeOpacity={0.9}>
      {/* Samma bakgrund som latest flight-korten: subtil gradient (accent → surface) */}
      <LinearGradient colors={[Colors.primary + '22', Colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Ionicons name="add-circle" size={18} color={Colors.primary} />
      <Text style={s.addBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Milestone card footer formatters
function hoursToHM(dec: number): string {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function lxDateShort(iso: string | undefined, language: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${String(d).padStart(2, '0')} ${monthShort(language, m - 1)} ${y}`;
}

// Latest flight-karusell: svep vänster för att bläddra genom de senaste 5 flygningarna
// (samma svep-känsla som fotokarusellen). Sida 1 = senaste (rubrik "Latest flight");
// följande kort saknar rubrik → strecket löper hela vägen till vänster i stället.
function LatestFlightCarousel({ flights, accent, placeNames, onPress, onAddPhoto }: {
  flights: Flight[]; accent: string; placeNames: Record<string, string>;
  onPress: (flight: Flight) => void; onAddPhoto?: (flight: Flight) => void;
}) {
  const W = Dimensions.get('window').width;
  const [page, setPage] = useState(0);
  const recent = flights.slice(0, 5); // de senaste 5 flygningarna

  return (
    <View style={{ marginHorizontal: -12, marginTop: -6 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={W}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
      >
        {recent.map((f, i) => (
          <View key={f.id} style={{ width: W }}>
            <LatestFlightCard
              flight={f}
              accent={accent}
              placeNames={placeNames}
              onPress={() => onPress(f)}
              onAddPhoto={onAddPhoto}
              showLabel={i === 0}
            />
          </View>
        ))}
      </ScrollView>
      {recent.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 2 }}>
          {recent.map((_, i) => (
            <View key={i} style={{ width: page === i ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: page === i ? accent : Colors.border }} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function DashboardScreen() {
  const s = makeDashStyles();
  const router = useRouter();
  const pendingCodes = usePendingPlaceStore((st) => st.codes); // okända dep/arr-koder → "add place"-notiser
  const removePendingCode = usePendingPlaceStore((st) => st.remove);
  const nightUpdates = useNightUpdateStore((st) => st.items); // föreslagna natt-uppdateringar efter placerad plats
  const removeNightUpdate = useNightUpdateStore((st) => st.remove);
  const mode = useAppModeStore((st) => st.mode);
  const _theme = useThemeStore((st) => st.theme); // subscribe to force re-render on theme change
  const { stats, flights, flightCount, isLoading, loadStats, loadFlights, tier, isPremium } = useFlightStore();
  const { t, language } = useTranslation();
  const [milestonePremium, setMilestonePremium] = useState<string | null>(null);
  const { formatTime } = useTimeFormat();
  const [stress, setStress] = useState<StressData>({ index: 0, zone: 'low', hours14: 0, baseline14: 0, advice: '' });
  const [stressReady, setStressReady] = useState(false);  // sant efter första stress-beräkningen
  const [refreshKey, setRefreshKey] = useState(0);
  const [globeGrabbed, setGlobeGrabbed] = useState(false); // pausar sid-scroll medan globen snurras
  const [globeMenuOpen, setGlobeMenuOpen] = useState(false); // enkel-tryck på globen → val-meny
  const globeMenuAnim = useRef(new Animated.Value(0)).current; // 0=dold, 1=synlig → mjuk fade/slide av alla tre knappar samtidigt
  // Globe-menyn: fade + liten slide in/ut (alla tre knappar samtidigt) vid enkel-tryck på globen.
  useEffect(() => {
    Animated.timing(globeMenuAnim, {
      toValue: globeMenuOpen ? 1 : 0,
      duration: globeMenuOpen ? 240 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [globeMenuOpen, globeMenuAnim]);
  const [openAipVisible, setOpenAipVisible] = useState(false); // OpenAIP-overlay-kartan
  const needleAnim = useRef(new Animated.Value(0)).current;
  const [profileName, setProfileName] = useState('');
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [photoPreview, setPhotoPreview] = useState<Flight | null>(null);
  const [showLatestOps, setShowLatestOps] = useState(false);
  const [xcMapVisible, setXcMapVisible] = useState(false);
  const [weekMapVisible, setWeekMapVisible] = useState(false);
  const { updateAvailable, news, storeUrl, check: checkVersion } = useVersionStore();
  const [spreadPrompt, setSpreadPrompt] = useState<SpreadPrompt | null>(null);
  const loadPrompt = useCallback(() => {
    getDashboardSpreadPrompt().then(setSpreadPrompt).catch(() => setSpreadPrompt(null));
  }, []);

  useEffect(() => {
    loadStats();
    loadFlights();
    getStressHours().then(({ recent14, yearAvg14 }) => { setStress(computeStress(recent14, yearAvg14)); setStressReady(true); });
    getSetting('profile_first_name').then(v => setProfileName(v ?? ''));
    checkVersion();
    loadPrompt();
  }, []);

  useFocusEffect(useCallback(() => {
    loadStats();
    loadFlights();
    getStressHours().then(({ recent14, yearAvg14 }) => { setStress(computeStress(recent14, yearAvg14)); setStressReady(true); });
    loadPrompt();
  }, [loadStats, loadFlights, loadPrompt]));

  useEffect(() => {
    needleAnim.setValue(0);
    Animated.timing(needleAnim, {
      toValue: Math.min((stress.index / 200) * 100, 100),
      duration: 1400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [stress.index, refreshKey]);

  // Stress-readouten animerar ÖKNINGEN efter en loggad flight (prev → nytt värde), inte
  // från 0. Vid mount/reload visas slutvärdet direkt (ingen uppräkning från start).
  const readoutAnim = useRef(new Animated.Value(1)).current;
  const [readoutPct, setReadoutPct] = useState(1);
  const badgeOpacity = useRef(new Animated.Value(0)).current; // "+ h:mm"-badgens opacitet
  const [deltaTotal, setDeltaTotal] = useState(0);            // tillagd totaltid (h) för badgen
  const prevReadout = useRef({ total: 0, ytd: 0, hours14: 0, baseline14: 0 });
  const readoutInited = useRef(false);

  useEffect(() => {
    const target = {
      total: stats?.total_time ?? 0,
      ytd: stats?.year_to_date ?? 0,
      hours14: stress.hours14,
      baseline14: stress.baseline14,
    };
    if (!readoutInited.current) {
      if (!stats || !stressReady) return; // vänta tills BÅDE stats och stress laddats
      readoutInited.current = true;
      prevReadout.current = target;       // första laddningen → slutvärde direkt
      setReadoutPct(1);
      return;
    }
    const p = prevReadout.current;
    if (target.total === p.total && target.ytd === p.ytd && target.hours14 === p.hours14 && target.baseline14 === p.baseline14) return;
    const delta = target.total - p.total;
    readoutAnim.setValue(0);            // värdena kvar på prev tills uppräkningen börjar
    const listener = readoutAnim.addListener(({ value }) => setReadoutPct(value));
    const countUp = Animated.timing(readoutAnim, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    if (delta > 0.0001) {
      // Steg 1: visa "+ h:mm" till vänster om totalen i två sekunder (värden kvar på prev).
      // Steg 2: räkna upp alla värden samtidigt som badgen tonar bort i samma takt.
      setDeltaTotal(delta);
      badgeOpacity.setValue(1);
      Animated.sequence([
        Animated.delay(2000),
        Animated.parallel([
          countUp,
          Animated.timing(badgeOpacity, { toValue: 0, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        ]),
      ]).start(({ finished }) => { if (finished) prevReadout.current = target; });
    } else {
      // Ingen ökning (t.ex. redigering/radering) → räkna om direkt, ingen badge.
      badgeOpacity.setValue(0);
      countUp.start(({ finished }) => { if (finished) prevReadout.current = target; });
    }
    return () => readoutAnim.removeListener(listener);
  }, [stats?.total_time, stats?.year_to_date, stress.hours14, stress.baseline14, stressReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = stats;
  const zc = zoneColor(stress.zone);

  // ── Milestone cards (side-by-side compact) ──
  // Best Week is wider — it holds more data (7-day breakdown) than Longest XC.
  const milestoneTotalW = Dimensions.get('window').width - 24 - 10;
  const lxCardW = Math.round(milestoneTotalW * 0.44);
  const bwCardW = milestoneTotalW - lxCardW;
  const bestWeek = useBestWeekDetails(st?.best_week_start || undefined);
  const xcLegs = useLongestXcLegs(st?.longest_xc_date || undefined);

  // Interpolerar från föregående värde till nytt (prev + delta·pct) → visar ökningen.
  const animTime = (target: number, prev: number) => decimalToHHMM(prev + (target - prev) * readoutPct);
  const pr = prevReadout.current;
  const latestFlights = flights.slice(0, 5);

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

  // Snabb logbook-scan: välj kamera/album → en bild → OCR-granskning.
  const runLogbookScan = async (fromCamera: boolean) => {
    try {
      let result;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert(t('permission_required'), t('camera_permission')); return; }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.85 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.85 });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      const info = await ImageManipulator.manipulateAsync(uri, [], {});
      const actions: ImageManipulator.Action[] = [];
      if (info.height > info.width) actions.push({ rotate: 90 });
      actions.push({ resize: { width: 2000 } });
      const out = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!out.base64) return;
      setScanImage(out.base64, 'image/jpeg');
      router.push('/flight/review');
    } catch (e: any) {
      Alert.alert(t('error'), e?.message ?? 'Failed');
    }
  };
  const quickLogbookScan = useCallback(() => {
    if (!isPremium && tier !== 'max') { setMilestonePremium(t('import_scan_title')); return; }
    Alert.alert(t('logbook_scan'), t('scan_source_prompt'), [
      { text: t('camera'), onPress: () => runLogbookScan(true) },
      { text: t('photo_library'), onPress: () => runLogbookScan(false) },
      { text: t('cancel'), style: 'cancel' },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium, tier, t]);

  const greetingStyle = useMemo(() => ({
    ...s.hudGreeting,
    color: tier === 'max' ? Colors.silver : (tier === 'premium' ? Colors.gold : Colors.textPrimary),
  }), [tier]);

  if (mode !== 'manned') return <View style={s.container} />;

  return (<>
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      scrollEnabled={!globeGrabbed}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setRefreshKey(k => k + 1);
        loadPrompt();
        await Promise.all([
          loadStats(),
          loadFlights(),
          getStressHours().then(({ recent14, yearAvg14 }) => { setStress(computeStress(recent14, yearAvg14)); setStressReady(true); }),
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
              { text: 'App Store', onPress: () => Linking.openURL(storeUrl) },
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

      {/* Notisen ersatt: bok-ikonen i snabbknapparna nedan blir guldfärgad när ett
          uppslag väntar på transkribering (spreadPrompt). */}

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
          <StressRing stress={stress} size={110} ready={stressReady} />
          <View style={{ flex: 1, gap: 6 }}>
            {/* Readout rows */}
            {[
              // Alla värden animerar ökningen (prev → nytt) efter en loggad flight.
              { l: 'TOTAL', parts: [animTime(st?.total_time ?? 0, pr.total)], c: Colors.gold },
              { l: 'YTD', parts: [animTime(st?.year_to_date ?? 0, pr.ytd)], c: Colors.primary },
              { l: '14D / AVG', parts: [animTime(stress.hours14, pr.hours14), animTime(stress.baseline14, pr.baseline14)], c: zc },
            ].map(m => (
              <View key={m.l} style={s.telReadout}>
                <Text style={s.telReadoutLabel}>{m.l}</Text>
                {/* Värde till höger; på TOTAL-raden en "+ h:mm"-badge till vänster om totalen */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  {m.l === 'TOTAL' && deltaTotal > 0.0001 && (
                    <Animated.Text style={[s.telReadoutDelta, { opacity: badgeOpacity }]}>+ {decimalToHHMM(deltaTotal)}</Animated.Text>
                  )}
                  {/* Timmar i LED (H:MM); ev. separator i Menlo så "/" renderar korrekt */}
                  <Text style={[s.telReadoutValue, { color: m.c }]}>
                    {m.parts.map((p, i) => (
                      <Text key={i}>{i > 0 ? <Text style={s.telReadoutSep}> / </Text> : null}{p}</Text>
                    ))}
                  </Text>
                </View>
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

      {/* ── Latest flight (svep vänster → senaste 5 flygningarna) ── */}
      {flights[0] && (
        <LatestFlightCarousel
          flights={flights}
          accent={Colors.primary}
          placeNames={placeNames}
          onPress={(f) => router.push(`/flight/detail/${f.id}`)}
          onAddPhoto={(fl) => router.push(`/flight/add?editId=${fl.id}&addPhoto=1` as any)}
        />
      )}

      {/* ── Okänd-plats-notiser: en per okänd dep/arr-kod från senaste sparade flighter ── */}
      {pendingCodes.map((code) => (
        <View key={code} style={s.unknownCard}>
          <Ionicons name="help-circle" size={20} color={Colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={s.unknownTitle}>{code} does not exist in local database.</Text>
            <Text style={s.unknownSub}>Add place and name?</Text>
          </View>
          <TouchableOpacity
            onPress={() => { removePendingCode(code); router.push(`/settings/airport?addCode=${encodeURIComponent(code)}` as any); }}
            hitSlop={8}
            style={[s.unknownBtn, { backgroundColor: Colors.success + '22', borderColor: Colors.success + '66' }]}
          >
            <Ionicons name="checkmark" size={18} color={Colors.success} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => removePendingCode(code)}
            hitSlop={8}
            style={[s.unknownBtn, { backgroundColor: Colors.danger + '18', borderColor: Colors.danger + '55' }]}
          >
            <Ionicons name="close" size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      ))}

      {/* ── Natt-uppdaterings-notiser: auto-natt ändrades när en plats fick koordinater ── */}
      {nightUpdates.map((u) => (
        <View key={u.flightId} style={[s.unknownCard, { borderColor: Colors.info + '55', backgroundColor: Colors.info + '12' }]}>
          <Ionicons name="moon" size={18} color={Colors.info} />
          <View style={{ flex: 1 }}>
            <Text style={s.unknownTitle}>Update night time for {u.label}</Text>
            <Text style={s.unknownSub}>to {decimalToHHMM(u.newNight)}?</Text>
          </View>
          <TouchableOpacity
            onPress={async () => { await updateFlightNight(u.flightId, u.newNight); removeNightUpdate(u.flightId); loadFlights(); loadStats(); }}
            hitSlop={8}
            style={[s.unknownBtn, { backgroundColor: Colors.success + '22', borderColor: Colors.success + '66' }]}
          >
            <Ionicons name="checkmark" size={18} color={Colors.success} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => removeNightUpdate(u.flightId)}
            hitSlop={8}
            style={[s.unknownBtn, { backgroundColor: Colors.danger + '18', borderColor: Colors.danger + '55' }]}
          >
            <Ionicons name="close" size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      ))}

      {/* ── Log new flight — photolog vänster + fysisk loggbok höger ── */}
      <View style={s.logRow}>
        <TouchableOpacity style={s.sideBtn} onPress={() => router.push('/flight/add?aiImport=1')} activeOpacity={0.85}>
          <Ionicons name="scan-outline" size={22} color={Colors.primary} />
        </TouchableOpacity>
        <LogFlightButton style={{ flex: 1, marginTop: 0, marginBottom: 0 }} onPress={() => router.push('/flight/add')} label={t('log_new_flight')} />
        <TouchableOpacity
          style={s.sideBtn}
          onPress={async () => {
            if (spreadPrompt) { await setAckedSpread(spreadPrompt.bookId, spreadPrompt.spreadNumber); setSpreadPrompt(null); }
            router.push('/logbook?recent=1');
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="book" size={22} color={spreadPrompt ? Colors.gold : Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* ── Pilot / drone sections ── */}
      {(
        <>
          {/* Flight media first — most relevant day to day. Högre zIndex än globen så att globen,
              när den förstoras/bleeder uppåt, hamnar BAKOM bildkarusellen (inte ovanpå). */}
          <View style={{ marginTop: 16, zIndex: 2 }}>
            <FlightPhotoCarousel placeNames={placeNames} onPress={setPhotoPreview} />
          </View>

          {/* Milestones (Best Week + Longest XC) flyttade till insights botten (MilestonesSection) */}

          {/* Globe-sektion: snurrbar 3D-glob. Enkel-tryck fäller ut tre kart-val; läget cyklas auto.
              Lägre zIndex än bildkarusellen → globen bleeder UPP bakom karusellen, inte framför. */}
          <View style={{ marginTop: 8, marginHorizontal: -12, alignItems: 'center', zIndex: 1 }}>
            <View style={{ width: '100%', alignItems: 'center' }}>
              <DashboardGlobe onGrab={setGlobeGrabbed} onTap={() => setGlobeMenuOpen((v) => !v)} />
              {/* Val-meny (enkel-tryck): tre rektangulära kort, centrerade över globen.
                  Alltid monterad men fadar/glider in/ut samtidigt via globeMenuAnim. */}
              <Animated.View
                pointerEvents={globeMenuOpen ? 'auto' : 'none'}
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: globeMenuAnim,
                  transform: [{ translateY: globeMenuAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
                }}
              >
                  <View style={{ width: '82%', maxWidth: 320, gap: 10 }}>
                    {/* Stäng-knapp (överst till vänster om korten) */}
                    <TouchableOpacity
                      onPress={() => setGlobeMenuOpen(false)}
                      activeOpacity={0.85}
                      hitSlop={10}
                      style={{ alignSelf: 'flex-start', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,11,22,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}
                    >
                      <Ionicons name="close" size={18} color="#fff" />
                    </TouchableOpacity>
                    <AirportMapWidget asButton />
                    <GlobalMapButton asButton />
                    <TouchableOpacity
                      onPress={() => { setOpenAipVisible(true); setGlobeMenuOpen(false); }}
                      activeOpacity={0.85}
                      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(6,11,22,0.85)', borderWidth: 1, borderColor: Colors.primary + '66' }}
                    >
                      <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '22' }}>
                        <Ionicons name="layers-outline" size={18} color={Colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: Colors.primary, fontSize: 14, fontWeight: '800' }}>OpenAIP</Text>
                        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '500', marginTop: 1 }}>Airspaces & airfields overlay</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
                    </TouchableOpacity>
                  </View>
              </Animated.View>
            </View>
          </View>
          <OpenAipMapModal visible={openAipVisible} onClose={() => setOpenAipVisible(false)} />

          {st?.longest_xc_date && (
            <RouteMapModal visible={xcMapVisible} onClose={() => setXcMapVisible(false)} xcDate={st.longest_xc_date} hours={st.longest_xc_hours} />
          )}
          {st?.best_week_start && (
            <BestWeekMapModal visible={weekMapVisible} onClose={() => setWeekMapVisible(false)} weekStart={st.best_week_start} weekLabel={st.best_week_label} hours={st.best_week_hours} />
          )}
          <PremiumModal visible={!!milestonePremium} onClose={() => setMilestonePremium(null)} feature={milestonePremium ?? undefined} />
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
  telReadoutValue: { fontSize: 16, fontWeight: '800', fontFamily: FONT_LED7 },
  telReadoutDelta: { fontSize: 16, fontWeight: '800', fontFamily: FONT_LED7, color: Colors.textPrimary },
  telReadoutSep: { fontFamily: 'Menlo', fontWeight: '800', fontSize: 14 },
  telAdvice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 8, borderRadius: 8, borderLeftWidth: 3,
  },
  telAdviceText: { flex: 1, fontSize: 11, color: Colors.textPrimary, lineHeight: 16 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 16, marginTop: 16, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.primary + '55', overflow: 'hidden',
  },
  addBtnText: { color: Colors.primary, fontSize: 16, fontWeight: '800' },
  physBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 14, paddingVertical: 16, marginTop: 4, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.primary + '55',
  },
  physBtnText: { color: Colors.primary, fontSize: 16, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 6 },
  actionBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: 14, paddingVertical: 12, minHeight: 60,
    borderWidth: 1, borderColor: Colors.primary + '55',
  },
  actionBtnText: { color: Colors.primary, fontSize: 11, fontWeight: '700' },
  // Log-flight-rad: photolog (vänster) · Log flight (mitten, flex) · fysisk loggbok (höger).
  logRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 16, marginBottom: 0 },
  unknownCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    backgroundColor: Colors.warning + '14', borderWidth: 1, borderColor: Colors.warning + '55',
  },
  unknownTitle: { color: Colors.textPrimary, fontSize: 12.5, fontWeight: '700' },
  unknownSub: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 1 },
  unknownBtn: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sideBtn: {
    width: 54, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.primary + '55',
  },

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

  milestoneRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
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
