// Ny FlightDetail (design-handoff): loggboksfält grupperade för snabb avläsning.
// Edit uppe till höger öppnar editorn (/flight/add?editId=).
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { FlightVideo } from '../../../components/FlightVideo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../../constants/colors';
import type { Flight } from '../../../types/flight';
import { getFlightById, deleteFlight, getScanAdjustments, verifyFlight } from '../../../db/flights';
import { label as fieldLabel } from '../../../services/scanFields';
import { batchPlaceNames, getAirportByIcao } from '../../../db/icao';
import { useFlightStore } from '../../../store/flightStore';
import { useTimeFormat } from '../../../hooks/useTimeFormat';
import { DayNightMap } from '../../../components/DayNightMap';
import { FlightSyncedPhoto } from '../../../components/FlightSyncedPhoto';
import { FONT_SERIF, FONT_MONO, NIGHT_BADGE } from '../../../components/logbook-page/tokens';
import { arrUtc, parseDate } from '../../../components/logbook-page/flightDisplay';
import { placeCode } from '../../../utils/format';
import { isCabinLine } from '../../../utils/remarksManaged';
import { useAppVariantStore } from '../../../store/appVariantStore';

const DASH = '—';

// Ordbryt ett långt flygplatsnamn så ingen rad överstiger max tecken (default 30).
function wrapName(text: string, max = 30): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

// Återanvändbar flight-detaljvy. Route-skärmen nedan är en tunn wrapper; kan även visas i en
// overlay-modal (t.ex. ovanpå kartan) via onBack (stäng overlay) och valfri onEdit.
export function FlightDetailView({ id, onBack, onEdit }: { id: number; onBack: () => void; onEdit?: (flightId: number) => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = Colors.primary;
  const essential = useAppVariantStore((st) => st.variant) === 'essential';
  const { formatTime } = useTimeFormat();
  const { loadFlights, loadStats } = useFlightStore();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // Riktiga flygplatsnamn (icao_airports.name) för dep/arr — ICAO följt av namn (fallback: bara ICAO).
  const [full, setFull] = useState<{ dep: string; arr: string }>({ dep: '', arr: '' });
  // Värden som justerades vid skanningen så att kolumnen gick ihop med sidans summa i pappersboken.
  const [adjustments, setAdjustments] = useState<{ field_name: string; old_value: string; new_value: string; reason: string }[]>([]);
  const markChecked = async () => {
    await verifyFlight(id);
    setFlight(await getFlightById(id));
    setAdjustments([]);
  };

  const handleDelete = () => {
    Alert.alert('Delete flight', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteFlight(id);
        await Promise.all([loadFlights(), loadStats()]);
        onBack();
      } },
    ]);
  };
  const openEditor = () => (onEdit ? onEdit(id) : router.push(`/flight/add?editId=${id}`));

  useEffect(() => {
    if (!id) return;
    getFlightById(id).then((f) => {
      setFlight(f);
      if (f?.status === 'flagged') getScanAdjustments(id).then(setAdjustments).catch(() => {});
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
  // Cabin crew ligger som en ren "roll: namn, …"-rad i remarks (innehållsmatchad).
  const cabinLine = (f.remarks || '').split('\n').map((l) => l.trim()).find((l) => isCabinLine(l));
  if (cabinLine) {
    for (const entry of cabinLine.split(', ')) {
      const s = entry.trim();
      if (!s) continue;
      const ci = s.indexOf(': ');
      if (ci >= 0) crew.push([s.slice(0, ci).trim(), s.slice(ci + 2).trim()]);
      else crew.push(['Crew', s]);
    }
  }
  const notes = (f.remarks || '').trim(); // hela remarks (inkl. auto-rader: approach, piloter, cabin, Max FL)

  const sections: { title: string; rows: [string, string][] }[] = [
    { title: 'Aircraft', rows: [
      ['Type', f.aircraft_type || DASH],
      ['Registration', f.registration || DASH],
      ['Engine', f.me_time > 0 ? 'Multi-engine' : f.se_time > 0 ? 'Single-engine' : DASH],
      ['Operation', f.multi_pilot > 0 ? 'Multi-pilot' : f.single_pilot > 0 ? 'Single-pilot' : DASH],
    ]},
    ...(crew.length > 0 ? [{ title: 'Crew', rows: crew }] : []),
    { title: 'Departure', rows: [['Place', `${placeCode(f.dep_place, f.dep_place_raw)}${full.dep ? ` · ${wrapName(full.dep)}` : ''}`], ['Time (UTC)', (f.dep_utc || DASH) + (f.dep_utc ? 'z' : '')]] },
    { title: 'Arrival', rows: [['Place', `${placeCode(f.arr_place, f.arr_place_raw)}${full.arr ? ` · ${wrapName(full.arr)}` : ''}`], ['Time (UTC)', (arrUtc(f) || DASH) + (arrUtc(f) ? 'z' : '')]] },
    { title: 'Pilot function time', rows: [
      ['PIC', time(f.pic, true)], ['Co-pilot', time(f.co_pilot, true)], ['Dual', time(f.dual, true)], ['Instructor', time(f.instructor, true)],
    ]},
    { title: 'Operational condition', rows: [
      ['IFR', time(f.ifr, f.ifr > 0)], ['Night', time(f.night, f.night > 0)], ['NVG', time(f.nvg, f.nvg > 0)],
    ]},
    { title: 'Landings', rows: [['Day', String(f.landings_day ?? 0)], ['Night', String(f.landings_night ?? 0)]] },
  ];

  // Visa bara fält som har data (dölj tomma rader), och dölj hela sektioner utan data → kompakt vy.
  const hasData = (v: string) => { const t = (v ?? '').trim(); return t !== '' && t !== DASH && t !== '0'; };
  const visibleSections = sections
    .map((s) => ({ ...s, rows: s.rows.filter(([, v]) => hasData(v)) }))
    .filter((s) => s.rows.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* header */}
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={onBack} activeOpacity={0.7}
            style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ flexShrink: 1, fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', color: Colors.textPrimary }}>{placeCode(f.dep_place, f.dep_place_raw)} → {placeCode(f.arr_place, f.arr_place_raw)}</Text>
              {f.ifr > 0 ? <DetailBadge color={accent} label="IFR" /> : null}
              {f.night > 0 ? <DetailBadge color={NIGHT_BADGE} label="NGT" /> : null}
            </View>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: Colors.textMuted, letterSpacing: 0.4, marginTop: 1 }}>{dateLong}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: '700', color: accent }}>{dur}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: Colors.textMuted, letterSpacing: 1 }}>TOTAL</Text>
          </View>
          <TouchableOpacity onPress={openEditor} activeOpacity={0.7} hitSlop={6} accessibilityRole="button" accessibilityLabel="Edit flight"
            style={{ height: 34, paddingHorizontal: 13, borderRadius: 9, justifyContent: 'center', backgroundColor: accent + '18', borderWidth: 1, borderColor: accent + '88' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: accent }}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 30 }}>
        {/* Justerad vid skanningen: kolumnen gick inte ihop med sidans summa i pappersboken, och flygningen
            ändrades så att den gör det. Syns tills piloten kontrollerat den mot boken. */}
        {f.status === 'flagged' && adjustments.length > 0 && (
          <View style={{ marginBottom: 12, borderRadius: 14, borderWidth: 1, borderColor: Colors.warning + '88', backgroundColor: Colors.warning + '14', padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="alert-circle" size={18} color={Colors.warning} />
              <Text style={{ flex: 1, color: Colors.warning, fontSize: 14, fontWeight: '800' }}>Adjusted to match your paper logbook</Text>
            </View>
            {adjustments.map((a, i) => (
              <View key={i} style={{ gap: 2 }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>
                  {fieldLabel(a.field_name)}: {a.old_value} → {a.new_value}
                </Text>
                <Text style={{ fontSize: 12.5, lineHeight: 17, color: Colors.textSecondary }}>{a.reason}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 12.5, lineHeight: 17, color: Colors.textSecondary }}>
              Check this flight against your paper logbook. Editing the flight also marks it as checked.
            </Text>
            <TouchableOpacity onPress={markChecked} activeOpacity={0.8}
              style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.warning }}>
              <Text style={{ color: Colors.textInverse, fontSize: 14, fontWeight: '700' }}>Mark as checked</Text>
            </TouchableOpacity>
          </View>
        )}

        {visibleSections.map((s) => (
          <View key={s.title} style={{ marginBottom: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: accent, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4 }}>{s.title}</Text>
            {s.rows.map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Text style={{ fontSize: 13, color: Colors.textSecondary }}>{k}</Text>
                <Text style={{ flexShrink: 1, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: v === DASH ? Colors.textMuted : Colors.textPrimary }}>{v}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Remarks — hela texten inkl. auto-rader (approach, piloter, cabin, Max FL) så allt kan föras
            in i den fysiska loggboken */}
        <View style={{ marginBottom: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: accent, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4 }}>Remarks</Text>
          <View style={{ paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: Colors.separator }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 13, lineHeight: 19, color: notes ? Colors.textPrimary : Colors.textMuted }}>{notes || DASH}</Text>
          </View>
        </View>

        {/* Sun route (inte i Blades Essential) */}
        {!essential && (
          <View style={{ marginBottom: 12 }}>
            <DayNightMap flight={f} />
          </View>
        )}

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
        <FlightSyncedPhoto flight={f} accent={accent} onChanged={() => getFlightById(id).then(setFlight)} />

        <TouchableOpacity onPress={handleDelete} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.danger + '66', backgroundColor: Colors.danger + '12', marginTop: 20 }}>
          <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.danger }}>Delete flight</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// Route-skärm: /flight/detail/[id] → tunn wrapper runt FlightDetailView.
export default function FlightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  if (!id) return null;
  return <FlightDetailView id={Number(id)} onBack={() => router.back()} />;
}

function DetailBadge({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ backgroundColor: color + '1F', borderColor: color + '55', borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color }}>{label}</Text>
    </View>
  );
}
