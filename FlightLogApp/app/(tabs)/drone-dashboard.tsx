// Drönar-dashboard — VISUELL TVILLING till manned (app/(tabs)/index.tsx). Samma
// sektioner i samma ordning: stressindikator (workload-telemetripanel) →
// Latest flight-karusell → log-flight-rad (scan · B-logga · fysisk bok) → fotokarusell
// → glob (heatmap + ripples). Navy via DR (= NavyColors) + användarens accent.
// Fonter = manned dashboard: Georgia (serif) · Menlo (mono) · DSEG7 (LED).

import { useCallback, useRef, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions,
  Dimensions, Alert, Animated, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { DR, accentSoft, accentLine } from '../../constants/droneTheme';
import { Colors } from '../../constants/colors'; // stress-panelen använder EXAKT manned-tokens (paritet)
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { getDroneStressHours, type DroneFlight } from '../../db/drones';
import { decimalToHHMM, decimalToMMSS } from '../../hooks/useTimeFormat';
import { useTranslation } from '../../hooks/useTranslation';
import { FONT_LED7, ledGlow } from '../../components/logflight/tokens';
import { categoryLabel } from '../../constants/droneCategories';
import { DroneDashboardGlobe } from '../../components/DroneDashboardGlobe';
import { GlobalMapModal } from '../../components/GlobalMapModal';
import { AirportQuickSearch } from '../../components/AirportQuickSearch';
import { AirportPickerModal } from '../../components/AirportPickerModal';
import { Marquee } from '../../components/Marquee';
import { fetchDecodedWxNear, type DecodedWx, type WxStatus } from '../../services/weather';

const SERIF = 'Georgia';
const MONO = 'Menlo';
const WX_STATUS_COLOR: Record<WxStatus, string> = { fresh: Colors.success, aging: Colors.warning, stale: Colors.danger };

// ── Stress-helpers (klon av manned) ─────────────────────────────────────────
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
// Zonfärger = EXAKT manned (Colors), inte DR/accent → identisk stress-panel.
function zoneColor(zone: StressZone): string {
  if (zone === 'low') return Colors.textMuted;
  if (zone === 'light') return Colors.primary;
  if (zone === 'normal') return Colors.success;
  if (zone === 'elevated') return Colors.warning;
  return Colors.danger; // high / critical
}

function StressRing({ stress, size = 110 }: { stress: StressData; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(stress.index, 240) / 240;
  const color = zoneColor(stress.zone);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.separator} strokeWidth={6} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={6} fill="none"
          strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`} strokeDashoffset={circ * 0.25}
          strokeLinecap="round" rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      <Text style={{ fontSize: size > 100 ? 26 : 20, fontWeight: '900', color, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] }}>{stress.index}%</Text>
      <Text style={{ fontSize: 8, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, marginTop: 2 }}>{stress.zone.toUpperCase()}</Text>
    </View>
  );
}

function relDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const days = Math.round((now.setHours(0, 0, 0, 0) - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function DroneDashboardScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, stats, loadFlights, loadStats } = useDroneFlightStore();
  const [stress, setStress] = useState<StressData>(computeStress(0, 0));
  const [globeGrabbed, setGlobeGrabbed] = useState(false); // pausa scroll medan globen snurras (= manned)
  const [globeMenuOpen, setGlobeMenuOpen] = useState(false); // enkel-tap → kart-val-meny (= manned)
  const [globalMapOpen, setGlobalMapOpen] = useState(false);
  const globeMenuAnim = useRef(new Animated.Value(0)).current;
  const kbShift = useRef(new Animated.Value(0)).current; // temporär uppflytt när flygplatssökrutan fokuseras
  const [wx, setWx] = useState<DecodedWx | null>(null);   // METAR/TAF för närmaste station från positionen
  const [wxLoading, setWxLoading] = useState(false);
  const [wxPickerOpen, setWxPickerOpen] = useState(false);

  // Drönare flyger inte mellan flygplatser → hämta väder för NÄRMASTE station från nuvarande position.
  const loadWeatherNear = useCallback(async () => {
    setWxLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setWx(null); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setWx(await fetchDecodedWxNear(p.coords.latitude, p.coords.longitude));
    } catch { setWx(null); } finally { setWxLoading(false); }
  }, []);
  useEffect(() => {
    Animated.timing(globeMenuAnim, { toValue: globeMenuOpen ? 1 : 0, duration: globeMenuOpen ? 240 : 160, useNativeDriver: true }).start();
  }, [globeMenuOpen, globeMenuAnim]);

  useFocusEffect(useCallback(() => {
    loadAccent();
    loadFlights();
    loadStats();
    getDroneStressHours().then((h) => setStress(computeStress(h.recent14, h.yearAvg14))).catch(() => {});
    return () => setWx(null); // göm vädret när man lämnar dashboarden (= manned)
  }, [loadAccent, loadFlights, loadStats]));

  const recent = flights.slice(0, 5);
  const zc = zoneColor(stress.zone);

  // ── Tom-läge ──
  if ((stats?.total_flights ?? flights.length) === 0) {
    return (
      <View style={[s.screen, s.center]}>
        <View style={[s.iconCircle, { backgroundColor: accentSoft(accent), borderColor: accentLine(accent) }]}>
          <Ionicons name="hardware-chip-outline" size={30} color={accent} />
        </View>
        <Text style={s.emptyTitle}>{t('no_flights') ?? 'No drone flights yet'}</Text>
        <TouchableOpacity style={[s.cta, { backgroundColor: accent }]} onPress={() => router.push('/drone-flight/add')} activeOpacity={0.85}>
          <Ionicons name="add" size={18} color={DR.inkOnAccent} />
          <Text style={[s.ctaText, { color: DR.inkOnAccent }]}>{t('log_new_flight') ?? 'Log flight'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Zon-färger = EXAKT manned (index.tsx), inte DR/accent.
  const zones = [
    { max: 29, c: '#6B7280' }, { max: 69, c: Colors.primary }, { max: 130, c: Colors.success },
    { max: 169, c: Colors.warning }, { max: 200, c: Colors.danger },
  ];
  const needlePct = Math.min(stress.index, 200) / 200;

  return (
    <View style={{ flex: 1, backgroundColor: DR.background }}>
    <Animated.View style={{ flex: 1, transform: [{ translateY: kbShift }] }}>
    <ScrollView style={s.screen} contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12 }} scrollEnabled={!globeGrabbed} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} tintColor="transparent" onRefresh={async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); // tydlig vibration när pull triggar (= manned)
        await loadWeatherNear();
      }} />}>
      {/* ── 1. Stressindikator (workload-telemetripanel, klon av manned) ── */}
      <View style={s.telPanel}>
        {/* Väder-ticker (närmaste station från positionen) ovanför WORKLOAD — bara när hämtat. */}
        {wx && (
          <TouchableOpacity activeOpacity={0.7} style={s.wxTap} onPress={() => setWxPickerOpen(true)}>
            <View style={{ flex: 1 }}>
              <View style={s.wxLine}>
                <Text style={[s.wxLabel, { color: wx.metarStatus ? WX_STATUS_COLOR[wx.metarStatus] : Colors.textMuted }]} numberOfLines={1}>METAR {wx.metarStation ?? '—'}</Text>
                <Marquee
                  text={wx.metarStation ? [wx.metarTimeZ, wx.metarText || 'no data'].filter(Boolean).join('   ·   ') : 'not available'}
                  textStyle={s.wxScroll} containerStyle={s.wxScrollWrap} speed={55}
                />
              </View>
              <View style={s.wxLine}>
                <Text style={[s.wxLabel, { color: wx.tafStatus ? WX_STATUS_COLOR[wx.tafStatus] : Colors.textMuted }]} numberOfLines={1}>TAF {wx.tafStation ?? '—'}</Text>
                <Marquee
                  text={wx.tafStation ? (wx.tafText || 'no data') : 'not available'}
                  textStyle={s.wxScroll} containerStyle={s.wxScrollWrap} speed={55}
                />
              </View>
            </View>
            <Ionicons name="search" size={15} color={Colors.textMuted} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        <View style={s.telGaugeHeader}>
          <Text style={s.telGaugeLabel}>WORKLOAD · 14D</Text>
          {!wx && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {wxLoading ? (
                <><ActivityIndicator size="small" color={accent} /><Text style={s.wxFetchHint}>Fetching weather…</Text></>
              ) : (
                <><Text style={s.wxFetchHint}>Fetch WX</Text><Ionicons name="arrow-down" size={13} color={Colors.textMuted} /></>
              )}
            </View>
          )}
          <Text style={[s.telGaugeZone, { color: zc }]}>{stress.zone.toUpperCase()}</Text>
        </View>
        {/* Zon-bar med nål */}
        <View style={s.telGaugeTrack}>
          {zones.map((z, i) => {
            const from = i === 0 ? 0 : zones[i - 1].max;
            const isActive = (stress.index >= from && stress.index < z.max) || (i === zones.length - 1 && stress.index >= from);
            return <View key={i} style={{ flex: z.max - from, backgroundColor: z.c, opacity: isActive ? 0.75 : 0.08, borderRadius: isActive ? 5 : 0 }} />;
          })}
          <View style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1.5, backgroundColor: Colors.textPrimary, opacity: 0.4 }} />
          <View style={{ position: 'absolute', left: `${needlePct * 100}%`, top: -3, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: zc, borderWidth: 2, borderColor: Colors.background, shadowColor: zc, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 4 }} />
        </View>
        {/* Ring + readouts */}
        <View style={s.telPctRow}>
          <StressRing stress={stress} size={110} />
          <View style={{ flex: 1, gap: 6 }}>
            {[
              { l: 'TOTAL', v: decimalToHHMM(stats?.total_time ?? 0), c: Colors.gold },
              { l: 'YTD', v: decimalToHHMM(stats?.year_to_date ?? 0), c: Colors.primary },
              { l: '14D / AVG', v: `${decimalToHHMM(stress.hours14)} / ${decimalToHHMM(stress.baseline14)}`, c: zc },
            ].map((m) => (
              <View key={m.l} style={s.telReadout}>
                <Text style={s.telReadoutLabel}>{m.l}</Text>
                <Text style={[s.telReadoutValue, { color: m.c }]}>{m.v}</Text>
              </View>
            ))}
          </View>
        </View>
        {/* Advice */}
        <View style={[s.telAdvice, { borderLeftColor: zc, backgroundColor: zc + '10' }]}>
          <Ionicons name="pulse" size={12} color={zc} />
          <Text style={s.telAdviceText}>{stress.advice}</Text>
        </View>
      </View>

      {/* ── 2. Latest flight-karusell ── */}
      {recent.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={width - 24} decelerationRate="fast">
            {recent.map((f, idx) => (
              <View key={f.id} style={{ width: width - 24 }}>
                <DroneLatestFlightCard flight={f} accent={accent} showLabel={idx === 0} onPress={() => router.push(`/drone-flight/${f.id}`)} />
              </View>
            ))}
          </ScrollView>
          {recent.length > 1 && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 2 }}>
              {recent.map((_, i) => <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: i === 0 ? accent : DR.border }} />)}
            </View>
          )}
        </View>
      )}

      {/* ── 3. Log-flight-rad: scan · B-logga · fysisk bok (= manned) ── */}
      <View style={s.logRow}>
        <TouchableOpacity style={[s.sideBtn, { borderColor: accentLine(accent) }]} activeOpacity={0.85}
          onPress={() => Alert.alert('Instrument scan', 'Coming soon — scan your controller/app screen to auto-fill a flight.')}>
          <Ionicons name="scan-outline" size={22} color={accent} />
        </TouchableOpacity>
        <TouchableOpacity style={s.addBtn} onPress={() => router.push('/drone-flight/add')} activeOpacity={0.9}>
          <LinearGradient colors={[accent + '22', DR.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <Ionicons name="add-circle" size={18} color={accent} />
          <Text style={[s.addBtnText, { color: accent }]}>{t('log_new_flight') ?? 'Log flight'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.sideBtn, { borderColor: accentLine(accent) }]} onPress={() => router.push('/drone-logbook?recent=1')} activeOpacity={0.85}>
          <Ionicons name="book" size={22} color={accent} />
        </TouchableOpacity>
      </View>

      {/* ── 4. Fotokarusell ── */}
      <View style={{ marginTop: 16 }}>
        <DronePhotoCarousel accent={accent} />
      </View>

      {/* ── 5. Glob (heatmap + ripples, drönar-GPS) + kart-val-meny (= manned) ── */}
      <View style={{ marginTop: 8, marginHorizontal: -12, alignItems: 'center' }}>
        <View style={{ width: '100%', alignItems: 'center' }}>
          <DroneDashboardGlobe onGrab={setGlobeGrabbed} onTap={() => setGlobeMenuOpen((v) => !v)} />
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
              <TouchableOpacity onPress={() => setGlobeMenuOpen(false)} activeOpacity={0.85} hitSlop={10}
                style={{ alignSelf: 'flex-start', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,11,22,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }}>
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
              <MapMenuButton accent={accent} icon="navigate" title="Visited sites" sub="Where you've flown"
                onPress={() => { setGlobeMenuOpen(false); router.push('/drone-map'); }} />
              <MapMenuButton accent={accent} icon="globe" title="Global map" sub="All the worlds airports & airfields"
                onPress={() => { setGlobeMenuOpen(false); setGlobalMapOpen(true); }} />
              <AirportQuickSearch accent={accent} onPick={() => setGlobeMenuOpen(false)}
                onFocusShift={(dy) => Animated.timing(kbShift, { toValue: -dy, duration: 260, useNativeDriver: true }).start()} />
            </View>
          </Animated.View>
        </View>
      </View>

      {/* Återanvända kartor (identiska med manned) */}
      <GlobalMapModal visible={globalMapOpen} onClose={() => setGlobalMapOpen(false)} />
      <AirportPickerModal visible={wxPickerOpen} onClose={() => setWxPickerOpen(false)} initialIcao={wx?.metarStation ?? wx?.tafStation ?? null} />
    </ScrollView>
    </Animated.View>
    </View>
  );
}

// Kart-val-knapp i globmenyn (= manned AirportMapWidget/GlobalMapButton-pill, DR-accent).
function MapMenuButton({ accent, icon, title, sub, onPress }: { accent: string; icon: any; title: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}
      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(6,11,22,0.85)', borderWidth: 1, borderColor: accent + '66' }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: accent + '22' }}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: accent, fontSize: 14, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '500', marginTop: 1 }}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
    </TouchableOpacity>
  );
}

// Latest flight-hero — klon av LatestFlightCard med drönar-data.
function DroneLatestFlightCard({ flight: f, accent, showLabel, onPress }: {
  flight: DroneFlight; accent: string; showLabel: boolean; onPress: () => void;
}) {
  const d = new Date((f.date || '') + 'T00:00:00');
  const dateLabel = isNaN(d.getTime()) ? '' :
    `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  const strip: [string, string][] = [
    ['Category', f.category ? categoryLabel(f.category) : '—'],
    ['Drone', f.registration || f.drone_type || '—'],
    ['Mode', f.flight_mode || 'VLOS'],
    ['Mission', f.mission_type || '—'],
    ['Night', f.is_night ? 'Yes' : 'No'],
  ];
  return (
    <View style={{ paddingHorizontal: 2, paddingBottom: 4 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '55' }}>
        <LinearGradient colors={[accent + '22', DR.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: '100%', position: 'absolute' }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
          {showLabel && <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase', color: accent }}>Latest flight</Text>}
          <View style={{ flex: 1, height: 1, backgroundColor: accent + '33' }} />
          <Text style={{ fontFamily: MONO, fontSize: 10, color: DR.text3 }}>{dateLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 6 }}>
          <Text style={{ fontFamily: SERIF, fontSize: 20, fontWeight: '600', color: DR.text }} numberOfLines={1}>{f.mission_type || 'Flight'}</Text>
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: MONO, fontSize: 17, fontWeight: '700', color: DR.text }}>{decimalToMMSS(f.total_time || 0)}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 9, color: DR.muted }}>FLIGHT TIME</Text>
          </View>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: DR.text3, paddingHorizontal: 14, paddingBottom: 10 }}>
          {(f.registration || f.drone_type || '—')} · {f.location || '—'}
        </Text>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: accent + '33' }}>
          {strip.map(([k, v], i) => (
            <View key={k} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderLeftWidth: i ? 1 : 0, borderLeftColor: accent + '22', alignItems: 'center' }}>
              <Text style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.warning }}>{k}</Text>
              <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: DR.text, marginTop: 3 }}>{v}</Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Fotokarusell — klon av manned FlightPhotoCarousel-struktur. Drönar-flygningar lagrar
// inga foton ännu → visar platshållar-kort + sida 2 (drönar-media kommer). Samma chrome.
function DronePhotoCarousel({ accent }: { accent: string }) {
  const [page, setPage] = useState(0);
  const screenW = Dimensions.get('window').width;
  const GAP = 12;
  const CARD_W = screenW - 24;
  const SNAP = CARD_W + GAP;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={SNAP} decelerationRate="fast"
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / SNAP))}>
        <View style={{ width: CARD_W }}>
          <View style={{ width: CARD_W, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Ionicons name="images-outline" size={30} color={accent} />
            <Text style={{ fontFamily: SERIF, fontSize: 15, color: DR.text }}>Flight media</Text>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: DR.muted }}>ATTACH PHOTOS — COMING SOON</Text>
          </View>
        </View>
        <View style={{ width: GAP }} />
        <View style={{ width: CARD_W }}>
          <View style={{ width: CARD_W, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, flexDirection: 'row' }}>
            {[
              { icon: 'images-outline', label: 'Album' },
              { icon: 'sync-outline', label: 'Photo sync' },
              { icon: 'share-social-outline', label: 'Share card' },
            ].map((a, i) => (
              <View key={a.label} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, borderLeftWidth: i ? 1 : 0, borderLeftColor: DR.separator }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={a.icon as any} size={21} color={accent} />
                </View>
                <Text style={{ color: DR.text, fontSize: 11.5, fontWeight: '700' }}>{a.label}</Text>
                <Text style={{ color: DR.muted, fontSize: 8.5, fontWeight: '700' }}>SOON</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {[0, 1].map((i) => <View key={i} style={{ width: page === i ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: page === i ? accent : DR.border }} />)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  iconCircle: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyTitle: { color: DR.text, fontSize: 18, fontWeight: '800' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 22 },
  ctaText: { fontSize: 15, fontWeight: '800' },


  // Telemetripanel = EXAKT manned telPanel (index.tsx): fonter/färger/borders identiska.
  telPanel: { borderRadius: 16, overflow: 'hidden', backgroundColor: Colors.background, borderWidth: 0, padding: 4, gap: 14, marginBottom: 14 },
  telGaugeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 20 },
  telGaugeLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1.2, fontFamily: 'Menlo' },
  telGaugeZone: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, fontFamily: 'Menlo' },
  // Väder-ticker (närmaste station) — samma stil som manned dashboard.
  wxTap: { flexDirection: 'row', alignItems: 'center' },
  wxFetchHint: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5, color: Colors.textSecondary, fontFamily: 'ChakraPetch-SemiBold' },
  wxLine: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 21 },
  wxLabel: { width: 96, fontSize: 14, lineHeight: 21, fontFamily: 'ChakraPetch-SemiBold', letterSpacing: 0.3 },
  wxScrollWrap: { flex: 1, height: 21 },
  wxScroll: { fontSize: 14, lineHeight: 21, fontFamily: 'ChakraPetch-SemiBold', color: Colors.textPrimary },
  telGaugeTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'visible', backgroundColor: Colors.separator, position: 'relative' },
  telPctRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  telReadout: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 5, paddingHorizontal: 10, backgroundColor: Colors.background + 'CC', borderRadius: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  telReadoutLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, fontFamily: 'Menlo' },
  telReadoutValue: { fontSize: 16, fontWeight: '800', fontFamily: FONT_LED7 },
  telAdvice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 8, borderRadius: 8, borderLeftWidth: 3 },
  telAdviceText: { flex: 1, fontSize: 11, color: Colors.textPrimary, lineHeight: 16 },

  logRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 16 },
  sideBtn: { width: 54, alignItems: 'center', justifyContent: 'center', backgroundColor: DR.surface, borderRadius: 14, borderWidth: 1, borderColor: DR.border },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: DR.border, overflow: 'hidden' },
  addBtnText: { fontSize: 15, fontWeight: '800' },
});
