import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Image, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFlightById, deleteFlight } from '../../db/flights';
import { batchPlaceNames } from '../../db/icao';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { formatDate } from '../../utils/format';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { FlightShareCard } from '../../components/FlightShareCard';
import type { Flight } from '../../types/flight';

export default function FlightDetailScreen() {
  const styles = makeStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { loadFlights, loadStats } = useFlightStore();
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const insets = useSafeAreaInsets();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [showShareCard, setShowShareCard] = useState(false);

  useEffect(() => {
    if (id) {
      getFlightById(Number(id)).then((f) => {
        if (f) {
          setFlight(f);
          const codes = [f.dep_place, f.arr_place].filter(Boolean);
          if (codes.length) batchPlaceNames(codes).then(setPlaceNames);
        }
      });
    }
  }, [id]);

  const handleDelete = () => {
    Alert.alert(t('delete'), t('are_you_sure'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          await deleteFlight(Number(id));
          await Promise.all([loadFlights(), loadStats()]);
          router.back();
        },
      },
    ]);
  };

  if (!flight) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: 16, paddingVertical: 8 }} hitSlop={12}>
        <Ionicons name="close" size={24} color={Colors.textSecondary} />
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <View style={styles.routeRow}>
              <Text style={styles.icao}>{placeNames[flight.dep_place] ?? flight.dep_place}</Text>
              <Ionicons name="arrow-forward" size={16} color={Colors.textMuted} />
              <Text style={styles.icao}>{placeNames[flight.arr_place] ?? flight.arr_place}</Text>
            </View>
            <Text style={styles.meta}>{formatDate(flight.date)} · {flight.aircraft_type} {flight.registration}</Text>
          </View>
          <View style={styles.headerActions}>
            {flight.photo_uri ? (
              <TouchableOpacity style={styles.iconBtn} onPress={() => setShowShareCard(true)}>
                <Ionicons name="share-outline" size={18} color={Colors.primary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.push(`/flight/add?editId=${id}`)}>
              <Ionicons name="pencil" size={18} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {(
          <>
            <View style={styles.detailGrid}>
              <Detail label={t('date')} value={formatDate(flight.date)} />
              <Detail label={t('aircraft_type')} value={flight.aircraft_type} />
              <Detail label={t('registration')} value={flight.registration} />
              <Detail label={t('departure_utc')} value={flight.dep_utc} />
              <Detail label={t('arrival_utc')} value={flight.arr_utc} />
              <Detail label={t('total_flight_time')} value={`${formatTime(flight.total_time)}h`} highlight />
              <Detail label={t('pic')} value={`${formatTime(flight.pic)}h`} />
              <Detail label={t('co_pilot')} value={`${formatTime(flight.co_pilot)}h`} />
              <Detail label={t('dual')} value={`${formatTime(flight.dual)}h`} />
              {(flight.instructor ?? 0) > 0 && <Detail label={t('instructor')} value={`${formatTime(flight.instructor ?? 0)}h`} />}
              {(flight.multi_pilot ?? 0) > 0 && <Detail label={t('multi_pilot')} value={`${formatTime(flight.multi_pilot ?? 0)}h`} />}
              {(flight.single_pilot ?? 0) > 0 && <Detail label={t('single_pilot')} value={`${formatTime(flight.single_pilot ?? 0)}h`} />}
              <Detail label={t('ifr')} value={`${formatTime(flight.ifr)}h`} />
              <Detail label={t('night')} value={`${formatTime(flight.night)}h`} />
              {(flight.nvg ?? 0) > 0 && <Detail label="NVG" value={`${formatTime(flight.nvg ?? 0)}h`} />}
              <Detail label={t('day_landings')} value={String(flight.landings_day)} />
              <Detail label={t('night_landings')} value={String(flight.landings_night)} />
              {flight.flight_type && flight.flight_type !== 'normal' && (
                <Detail
                  label={t('flight_type_label')}
                  value={flight.flight_type === 'sim' ? t('ffs_sim') : t('hot_refuel')}
                  highlight={flight.flight_type === 'sim'}
                />
              )}
              {flight.second_pilot && (flight.multi_pilot ?? 0) > 0 ? (
                <Detail label={t('second_pilot_label')} value={flight.second_pilot} />
              ) : null}
              {(() => {
                const cm = flight.remarks?.match(/\[(.+?)\]/);
                return cm ? <Detail label={t('crew_chief_label')} value={cm[1]} /> : null;
              })()}
            </View>
            {flight.remarks ? (
              <View style={styles.remarksCard}>
                <Text style={styles.remarksLabel}>{t('remarks')}</Text>
                <Text style={styles.remarksText}>{flight.remarks.replace(/\s*\[.+?\]\s*/g, '').trim() || flight.remarks}</Text>
              </View>
            ) : null}

            {flight.photo_uri ? (
              <View style={{ borderRadius: 12, overflow: 'hidden' }}>
                <Image source={{ uri: flight.photo_uri }} style={{ width: '100%', height: 220, borderRadius: 12 }} resizeMode="cover" />
              </View>
            ) : null}

            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              <Text style={styles.deleteBtnText}>{t('delete')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {flight && (
        <FlightShareCard
          flight={flight}
          depName={placeNames[flight.dep_place] ?? flight.dep_place}
          arrName={placeNames[flight.arr_place] ?? flight.arr_place}
          visible={showShareCard}
          onClose={() => setShowShareCard(false)}
          formatTime={formatTime}
        />
      )}
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 40, gap: 10 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      backgroundColor: Colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
    },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    icao: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
    meta: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
    headerActions: { flexDirection: 'row', gap: 8 },
    iconBtn: {
      width: 36, height: 36,
      borderRadius: 8,
      backgroundColor: Colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },

    section: {
      color: Colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginTop: 12,
      marginBottom: 2,
    },
    row2: { flexDirection: 'row', gap: 10 },
    dateFieldLabel: {
      color: Colors.textSecondary, fontSize: 12, fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
    },
    dateBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: Colors.card, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: 12, paddingVertical: 12,
    },
    dateBtnText: {
      color: Colors.textPrimary, fontSize: 16, fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    errorInline: { color: Colors.danger, fontSize: 11, marginTop: 4 },
    modalBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
    datePickerSheet: {
      backgroundColor: Colors.card,
      paddingBottom: 24, paddingTop: 8,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    datePickerDone: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingVertical: 10 },
    datePickerDoneText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
    row3: { flexDirection: 'row', gap: 10 },

    detailGrid: {
      backgroundColor: Colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
      overflow: 'hidden',
    },
    detail: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: Colors.separator,
    },
    detailLabel: { color: Colors.textSecondary, fontSize: 14 },
    detailValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },

    remarksCard: {
      backgroundColor: Colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
    },
    remarksLabel: { color: Colors.textSecondary, fontSize: 12, marginBottom: 6 },
    remarksText: { color: Colors.textPrimary, fontSize: 14, lineHeight: 20 },

    flightTypeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    flightTypeBtn: {
      flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    flightTypeBtnActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
    flightTypeBtnText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
    flightTypeBtnTextActive: { color: Colors.primary, fontWeight: '700' },

    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15,
      marginTop: 20, gap: 8,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },

    deleteBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: Colors.danger + '66',
      borderRadius: 12, paddingVertical: 15,
      marginTop: 24, gap: 8,
      backgroundColor: Colors.danger + '12',
    },
    deleteBtnText: { color: Colors.danger, fontSize: 17, fontWeight: '700' },
  });
}

function Detail({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const styles = makeStyles();
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && { color: Colors.primaryLight }]}>{value}</Text>
    </View>
  );
}
