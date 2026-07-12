import { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getFlightsForWeek } from '../db/flights';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { decimalToHHMM } from '../hooks/useTimeFormat';
import type { Flight } from '../types/flight';

interface Props {
  visible: boolean;
  onClose: () => void;
  weekStart: string;
  weekLabel: string;
  hours: number;
}

export function BestWeekMapModal({ visible, onClose, weekStart, weekLabel, hours }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible || !weekStart) return;
    setLoading(true);
    getFlightsForWeek(weekStart).then(f => { setFlights(f); setLoading(false); });
  }, [visible, weekStart]);

  const totalTime = flights.reduce((s, f) => s + (f.total_time ?? 0), 0);
  const totalPic = flights.reduce((s, f) => s + (f.pic ?? 0), 0);
  const totalIfr = flights.reduce((s, f) => s + (f.ifr ?? 0), 0);
  const totalNight = flights.reduce((s, f) => s + (f.night ?? 0), 0);
  const totalLdgDay = flights.reduce((s, f) => s + (f.landings_day ?? 0), 0);
  const totalLdgNight = flights.reduce((s, f) => s + (f.landings_night ?? 0), 0);
  const airports = new Set(flights.flatMap(f => [f.dep_place, f.arr_place].filter(Boolean)));
  const aircraftTypes = new Set(flights.map(f => f.aircraft_type).filter(Boolean));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Ionicons name="chevron-down" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="trophy" size={18} color={Colors.gold} />
              <Text style={s.title}>Best week</Text>
            </View>
            <Text style={s.subtitle}>{weekLabel}</Text>
          </View>
          <Text style={s.heroTime}>{decimalToHHMM(hours)}h</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={s.content}>
            {/* Stats grid */}
            <View style={s.statsGrid}>
              {[
                { l: 'FLIGHTS', v: String(flights.length) },
                { l: 'TOTAL', v: decimalToHHMM(totalTime) },
                { l: 'PIC', v: decimalToHHMM(totalPic) },
                { l: 'IFR', v: decimalToHHMM(totalIfr) },
                { l: 'NIGHT', v: decimalToHHMM(totalNight) },
                { l: 'AIRPORTS', v: String(airports.size) },
              ].map(c => (
                <View key={c.l} style={s.statCell}>
                  <Text style={s.statLabel}>{c.l}</Text>
                  <Text style={s.statValue}>{c.v}</Text>
                </View>
              ))}
            </View>

            {/* Summary row */}
            <View style={s.summaryCard}>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Landings day / night</Text>
                <Text style={s.summaryValue}>{totalLdgDay} / {totalLdgNight}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Aircraft types</Text>
                <Text style={s.summaryValue}>{[...aircraftTypes].join(', ') || '—'}</Text>
              </View>
            </View>

            {/* Flights list */}
            <Text style={s.sectionHeader}>Flights</Text>
            <View style={s.card}>
              {flights.map((f, i) => (
                <TouchableOpacity
                  key={f.id}
                  style={[s.flightRow, i < flights.length - 1 && s.flightRowBorder]}
                  onPress={() => { onClose(); setTimeout(() => router.push(`/flight/detail/${f.id}`), 300); }}
                  activeOpacity={0.7}
                >
                  <View style={s.flightDate}>
                    <Text style={s.flightDay}>{f.date?.split('-')[2] ?? ''}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.flightRoute}>{f.dep_place} → {f.arr_place}</Text>
                    <Text style={s.flightMeta}>{f.aircraft_type} · {f.registration}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.flightTime}>{decimalToHHMM(f.total_time)}</Text>
                    <Text style={s.flightUtc}>{f.dep_utc ?? ''}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  closeBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  heroTime: {
    fontSize: 24, fontWeight: '900', color: Colors.gold,
    fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
  },
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statCell: {
    width: '31%', flexGrow: 1,
    backgroundColor: Colors.card, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center',
  },
  statLabel: { fontSize: 8, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, fontFamily: 'Menlo' },
  statValue: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'Menlo', fontVariant: ['tabular-nums'], marginTop: 4 },

  summaryCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  summaryValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },

  sectionHeader: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, fontFamily: 'Menlo', marginTop: 4,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },
  flightRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  flightRowBorder: { borderBottomWidth: 0.5, borderBottomColor: Colors.separator },
  flightDate: { width: 28, alignItems: 'center' },
  flightDay: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  flightRoute: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.1 },
  flightMeta: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  flightTime: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
  flightUtc: { fontSize: 9, color: Colors.textMuted, marginTop: 1 },
});
