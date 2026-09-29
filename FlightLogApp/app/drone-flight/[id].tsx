// Drönar-flight-detalj — VISUELL TVILLING till pilotens FlightDetailView (app/flight/detail/[id].tsx):
// samma header (rutt/plats + total + badges), grupperade sektionskort och remarks — men DR-tema,
// användarens drönar-accent och drönar-relevanta fält. Nås via flightcards (dashboard, loggbok m.m.).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { FlightVideo } from '../../components/FlightVideo';
import { getAssetDisplay } from '../../services/photoSync';
import { getDroneFlightById, deleteDroneFlight, type DroneFlight } from '../../db/drones';
import { categoryLabel } from '../../constants/droneCategories';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { FONT_SERIF, FONT_MONO, NIGHT_BADGE } from '../../components/logbook-page/tokens';
import { parseDate } from '../../components/logbook-page/flightDisplay';

const DASH = '—';

export default function DroneFlightDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useDroneAccentStore((s) => s.color);
  const { formatTime } = useTimeFormat();
  const { loadFlights, loadStats } = useDroneFlightStore();
  const [flight, setFlight] = useState<DroneFlight | null>(null);
  // Synkad media (photo_local_id) → upplöst visnings-uri (foto-synk kopplar via bibliotekets referens).
  const [syncedMedia, setSyncedMedia] = useState<{ uri: string; isVideo: boolean } | null>(null);

  // Ladda om vid fokus så detaljvyn visar färska värden efter redigering.
  useFocusEffect(useCallback(() => {
    if (id) getDroneFlightById(Number(id)).then(setFlight);
  }, [id]));

  // Lös upp synkad biblioteks-media till en visningsbar uri (bara när ingen direkt photo_uri finns).
  useEffect(() => {
    let alive = true;
    if (flight && !flight.photo_uri && flight.photo_local_id) {
      getAssetDisplay(flight.photo_local_id).then((d) => { if (alive && d) setSyncedMedia({ uri: d.uri, isVideo: d.isVideo }); }).catch(() => {});
    } else {
      setSyncedMedia(null);
    }
    return () => { alive = false; };
  }, [flight?.photo_uri, flight?.photo_local_id]);

  const handleDelete = () => {
    if (!flight) return;
    Alert.alert('Delete flight', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteDroneFlight(flight.id);
        await Promise.all([loadFlights(), loadStats()]);
        router.back();
      } },
    ]);
  };
  const openEditor = () => router.push({ pathname: '/drone-flight/add', params: { id: String(flight!.id) } });

  if (!flight) return <View style={{ flex: 1, backgroundColor: DR.background }}><ActivityIndicator color={accent} style={{ marginTop: 80 }} /></View>;

  const f = flight;
  // Visnings-media: direkt photo_uri först, annars synkad biblioteks-media (photo_local_id).
  const mediaUri = f.photo_uri || syncedMedia?.uri || '';
  const mediaIsVideo = f.photo_uri ? f.media_type === 'video' : (syncedMedia?.isVideo ?? false);
  const dur = formatTime(f.total_time);
  const time = (n: number, on: boolean) => (on && n > 0 ? formatTime(n) : DASH);
  const d = parseDate(f.date);
  const dateLong = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  const sections: { title: string; rows: [string, string][] }[] = [
    { title: 'Drone', rows: [
      ['Model', f.drone_type || DASH],
      ['Registration', f.registration || DASH],
      ['Category', categoryLabel(f.category) || DASH],
    ]},
    { title: 'Mission', rows: [
      ['Mission type', f.mission_type || DASH],
      ['Type', f.operation_type === 'COM' ? 'Commercial' : f.operation_type === 'PRI' ? 'Private' : DASH],
      ['Flight mode', f.flight_mode || DASH],
      ['Flight rules', f.flight_rules || DASH],
    ]},
    { title: 'Flight time', rows: [
      ['Total', time(f.total_time, true)],
      ['Night', time(f.night_time, f.night_time > 0)],
      ['VFR', time(f.vfr, f.vfr > 0)],
      ['IFR', time(f.ifr, f.ifr > 0)],
      ['FPV / 2nd pilot', time(f.co_pilot_fpv, f.co_pilot_fpv > 0)],
      ['Dual', time(f.dual, f.dual > 0)],
      ['Instructor', time(f.instructor, f.instructor > 0)],
    ]},
    { title: 'Conditions', rows: [
      ['Night flight', f.is_night ? 'Yes' : DASH],
      ['Max altitude', f.max_altitude_m > 0 ? `${f.max_altitude_m} m` : DASH],
      ['Wind', f.wind_ms > 0 ? `${f.wind_ms} m/s` : DASH],
      ['Observer', f.has_observer ? (f.observer_name || 'Yes') : DASH],
    ]},
    { title: 'Takeoff & landing', rows: [
      ['Takeoff time', f.takeoff_time || DASH],
      ['Location', (f.lat || f.lon) ? `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}` : DASH],
      ['Landing point', f.landing_location || DASH],
    ]},
    { title: 'Landings', rows: [
      ['Day', String(f.landings_day ?? 0)],
      ['Night', String(f.landings_night ?? 0)],
    ]},
  ];

  // Visa bara fält med data (dölj tomma rader + hela tomma sektioner) → kompakt vy (= pilotläget).
  const hasData = (v: string) => { const t = (v ?? '').trim(); return t !== '' && t !== DASH && t !== '0'; };
  const visibleSections = sections
    .map((s) => ({ ...s, rows: s.rows.filter(([, v]) => hasData(v)) }))
    .filter((s) => s.rows.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: DR.background }}>
      {/* header (= pilotläget) */}
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}
            style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={18} color={DR.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', color: DR.text }}>{f.location || 'Drone flight'}</Text>
              {f.flight_mode === 'BVLOS' ? <DetailBadge color={DR.warning} label="BVLOS" /> : null}
              {f.is_night ? <DetailBadge color={NIGHT_BADGE} label="NGT" /> : null}
            </View>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: DR.muted, letterSpacing: 0.4, marginTop: 1 }}>{dateLong}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: '700', color: accent }}>{dur}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: DR.muted, letterSpacing: 1 }}>TOTAL</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 30 }}>
        {visibleSections.map((s) => (
          <View key={s.title} style={{ marginBottom: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: accent, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4 }}>{s.title}</Text>
            {s.rows.map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: DR.separator }}>
                <Text style={{ fontSize: 13, color: DR.text2 }}>{k}</Text>
                <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: v === DASH ? DR.muted : DR.text }}>{v}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Remarks (= pilotläget) */}
        {f.remarks?.trim() ? (
          <View style={{ marginBottom: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: accent, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4 }}>Remarks</Text>
            <View style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: DR.separator }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 13, lineHeight: 19, color: DR.text }}>{f.remarks.trim()}</Text>
            </View>
          </View>
        ) : null}

        {/* Bild/video för flygningen — visning (media läggs till/ändras i Log Flight-editorn, = pilotläget). */}
        {mediaUri ? (
          <View style={{ marginBottom: 12, borderRadius: 14, overflow: 'hidden' }}>
            {mediaIsVideo ? (
              <FlightVideo uri={mediaUri} style={{ width: '100%', height: 220 }} contentFit="cover" loop muted autoPlay />
            ) : (
              <Image source={{ uri: mediaUri }} style={{ width: '100%', height: 220 }} resizeMode="cover" />
            )}
          </View>
        ) : null}

        <TouchableOpacity onPress={openEditor} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: accent, backgroundColor: accent + '18', marginBottom: 10 }}>
          <Ionicons name="create-outline" size={16} color={accent} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: accent }}>Open full editor</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1.5, borderColor: DR.danger + '66', backgroundColor: DR.danger + '12', marginTop: 20 }}>
          <Ionicons name="trash-outline" size={16} color={DR.danger} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: DR.danger }}>Delete flight</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function DetailBadge({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ backgroundColor: color + '1F', borderColor: color + '55', borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color }}>{label}</Text>
    </View>
  );
}
