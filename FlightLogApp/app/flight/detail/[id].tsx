// Ny FlightDetail (design-handoff): loggboksfält grupperade för snabb avläsning.
// Länkar till full-editorn (/flight/[id]) och till boken.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { FlightVideo } from '../../../components/FlightVideo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../../constants/colors';
import type { Flight } from '../../../types/flight';
import { getFlightById, deleteFlight } from '../../../db/flights';
import { batchPlaceNames, getAirportByIcao } from '../../../db/icao';
import { useFlightStore } from '../../../store/flightStore';
import { useTimeFormat } from '../../../hooks/useTimeFormat';
import { DayNightMap } from '../../../components/DayNightMap';
import { FlightSyncedPhoto } from '../../../components/FlightSyncedPhoto';
import { FONT_SERIF, FONT_MONO, NIGHT_BADGE } from '../../../components/logbook-page/tokens';
import { arrUtc, parseDate } from '../../../components/logbook-page/flightDisplay';

const DASH = '—';

export default function FlightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = Colors.primary;
  const { formatTime } = useTimeFormat();
  const { loadFlights, loadStats } = useFlightStore();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // Riktiga flygplatsnamn (icao_airports.name) för dep/arr — ICAO följt av namn (fallback: bara ICAO).
  const [full, setFull] = useState<{ dep: string; arr: string }>({ dep: '', arr: '' });

  const handleDelete = () => {
    Alert.alert('Delete flight', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteFlight(Number(id));
        await Promise.all([loadFlights(), loadStats()]);
        router.back();
      } },
    ]);
  };

  useEffect(() => {
    if (!id) return;
    getFlightById(Number(id)).then((f) => {
      setFlight(f);
      if (f) {
        batchPlaceNames([f.dep_place, f.arr_place].filter(Boolean)).then(setNames);
        Promise.all([getAirportByIcao(f.dep_place), getAirportByIcao(f.arr_place)]).then(([dp, ar]) => {
          setFull({
            dep: dp?.name && dp.name !== f.dep_place ? dp.name : '',
            arr: ar?.name && ar.name !== f.arr_place ? ar.name : '',
          });
        }).catch(() => {});
      }
    });
  }, [id]);

  if (!flight) return <View style={{ flex: 1, backgroundColor: Colors.background }}><ActivityIndicator color={accent} style={{ marginTop: 80 }} /></View>;

  const f = flight;
  const dur = formatTime(f.total_time);
  const time = (n: number, on: boolean) => (on && n > 0 ? formatTime(n) : DASH);
  const city = (icao: string) => names[icao] || icao;
  const d = parseDate(f.date);
  const dateLong = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  // Besättning: second pilot (roll → namn) först, sen ev. extra piloter, sen cabin crew
  // (lagrad i remarks som "[roll: namn, …]"). Roll i vänster kolumn, namn i höger.
  const crew: [string, string][] = [];
  if (f.second_pilot?.trim()) crew.push([f.second_pilot_role?.trim() || 'Second pilot', f.second_pilot.trim()]);
  try {
    const xp = f.extra_pilots ? JSON.parse(f.extra_pilots) : [];
    if (Array.isArray(xp)) for (const p of xp) {
      if (p?.name && String(p.name).trim()) crew.push([String(p.role || 'Pilot').trim(), String(p.name).trim()]);
    }
  } catch {}
  const cabinMatch = f.remarks?.match(/\[([^\]]*)\]/);
  if (cabinMatch) {
    for (const entry of cabinMatch[1].split(',')) {
      const s = entry.trim();
      if (!s) continue;
      const ci = s.indexOf(':');
      if (ci >= 0) crew.push([s.slice(0, ci).trim(), s.slice(ci + 1).trim()]);
      else crew.push(['Crew', s]);
    }
  }

  const sections: { title: string; rows: [string, string][] }[] = [
    { title: 'Aircraft', rows: [
      ['Type', f.aircraft_type || DASH],
      ['Registration', f.registration || DASH],
      ['Engine', f.me_time > 0 ? 'Multi-engine' : f.se_time > 0 ? 'Single-engine' : DASH],
      ['Operation', f.multi_pilot > 0 ? 'Multi-pilot' : f.single_pilot > 0 ? 'Single-pilot' : DASH],
    ]},
    ...(crew.length > 0 ? [{ title: 'Crew', rows: crew }] : []),
    { title: 'Departure', rows: [['Place', `${f.dep_place}${full.dep ? ` · ${full.dep}` : ''}`], ['Time (UTC)', (f.dep_utc || DASH) + (f.dep_utc ? 'z' : '')]] },
    { title: 'Arrival', rows: [['Place', `${f.arr_place}${full.arr ? ` · ${full.arr}` : ''}`], ['Time (UTC)', (arrUtc(f) || DASH) + (arrUtc(f) ? 'z' : '')]] },
    { title: 'Pilot function time', rows: [
      ['PIC', time(f.pic, true)], ['Co-pilot', time(f.co_pilot, true)], ['Dual', time(f.dual, true)], ['Instructor', time(f.instructor, true)],
    ]},
    { title: 'Operational condition', rows: [
      ['IFR', time(f.ifr, f.ifr > 0)], ['Night', time(f.night, f.night > 0)], ['NVG', time(f.nvg, f.nvg > 0)],
    ]},
    { title: 'Landings', rows: [['Day', String(f.landings_day ?? 0)], ['Night', String(f.landings_night ?? 0)]] },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* header */}
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}
            style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', color: Colors.textPrimary }}>{f.dep_place} → {f.arr_place}</Text>
              {f.ifr > 0 ? <DetailBadge color={accent} label="IFR" /> : null}
              {f.night > 0 ? <DetailBadge color={NIGHT_BADGE} label="NGT" /> : null}
            </View>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: Colors.textMuted, letterSpacing: 0.4, marginTop: 1 }}>{dateLong}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: '700', color: accent }}>{dur}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: Colors.textMuted, letterSpacing: 1 }}>TOTAL</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 30 }}>
        {sections.map((s) => (
          <View key={s.title} style={{ marginBottom: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: accent, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4 }}>{s.title}</Text>
            {s.rows.map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Text style={{ fontSize: 13, color: Colors.textSecondary }}>{k}</Text>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: v === DASH ? Colors.textMuted : Colors.textPrimary }}>{v}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Sun route */}
        <View style={{ marginBottom: 12 }}>
          <DayNightMap flight={f} />
        </View>

        {/* Uppladdad bild/video */}
        {f.photo_uri ? (
          <View style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
            {f.media_type === 'video' ? (
              <FlightVideo uri={f.photo_uri} style={{ width: '100%', height: 220 }} contentFit="cover" loop muted autoPlay />
            ) : (
              <Image source={{ uri: f.photo_uri }} style={{ width: '100%', height: 220 }} resizeMode="cover" />
            )}
          </View>
        ) : null}

        {/* Synkad bild/video från fotobiblioteket (photo_local_id) + byt/välj */}
        <FlightSyncedPhoto flight={f} accent={accent} onChanged={() => getFlightById(Number(id)).then(setFlight)} />

        <TouchableOpacity onPress={() => router.push(`/flight/add?editId=${f.id}`)} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: accent, backgroundColor: accent + '18', marginBottom: 10 }}>
          <Ionicons name="create-outline" size={16} color={accent} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: accent }}>Open full editor</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/logbook')} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface }}>
          <Ionicons name="book-outline" size={16} color={Colors.textSecondary} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textSecondary }}>See this row in the book</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleDelete} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.danger + '66', backgroundColor: Colors.danger + '12', marginTop: 20 }}>
          <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.danger }}>Delete flight</Text>
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
