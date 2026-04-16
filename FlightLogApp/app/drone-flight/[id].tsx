import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { getDroneFlightById, deleteDroneFlight, type DroneFlight } from '../../db/drones';
import { categoryLabel } from '../../constants/droneCategories';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { decimalToHHMM } from '../../hooks/useTimeFormat';

export default function DroneFlightDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { loadFlights, loadStats } = useDroneFlightStore();
  const [flight, setFlight] = useState<DroneFlight | null>(null);
  const styles = makeStyles();

  useEffect(() => {
    if (id) getDroneFlightById(Number(id)).then(setFlight);
  }, [id]);

  const handleDelete = () => {
    if (!flight) return;
    Alert.alert(t('delete'), `${flight.date} · ${flight.location}?`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteDroneFlight(flight.id);
          await Promise.all([loadFlights(), loadStats()]);
          router.back();
        },
      },
    ]);
  };

  if (!flight) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: Colors.textMuted }}>—</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroLocation}>{flight.location || '—'}</Text>
        <Text style={styles.heroDate}>{flight.date}</Text>
        <View style={styles.heroTags}>
          <Tag label={`${decimalToHHMM(flight.total_time)}h`} color={Colors.primary} />
          <Tag
            label={flight.flight_mode}
            color={flight.flight_mode === 'BVLOS' ? Colors.gold : Colors.primaryLight}
          />
          {flight.category ? <Tag label={categoryLabel(flight.category)} color={Colors.textSecondary} /> : null}
          {flight.is_night ? <Tag label="Night" color={Colors.textMuted} /> : null}
        </View>
      </View>

      <View style={styles.card}>
        <Detail label={t('drone')} value={`${flight.drone_type || '—'}${flight.registration ? ' · ' + flight.registration : ''}`} />
        <Detail label={t('mission_type')} value={flight.mission_type || '—'} />
        <Detail label={t('drone_category')} value={categoryLabel(flight.category) || '—'} />
        <Detail label={t('flight_mode_label')} value={flight.flight_mode} />
        <Detail label={t('total_flight_time')} value={`${decimalToHHMM(flight.total_time)}h`} />
        {flight.max_altitude_m > 0 && <Detail label={t('max_altitude')} value={`${flight.max_altitude_m} m`} />}
        <Detail label={t('night_flight')} value={flight.is_night ? t('yes') : t('no')} />
        {flight.has_observer && flight.observer_name ? (
          <Detail label={t('observer')} value={flight.observer_name} />
        ) : null}
        {flight.battery_id ? (
          <Detail
            label={t('battery')}
            value={`${flight.battery_start_cycles} ${t('cycles_at_start')}`}
          />
        ) : null}
        {flight.lat !== 0 || flight.lon !== 0 ? (
          <Detail
            label={t('location')}
            value={`${flight.lat.toFixed(4)}, ${flight.lon.toFixed(4)}`}
            mono
          />
        ) : null}
      </View>

      {flight.remarks ? (
        <View style={styles.remarksCard}>
          <Text style={styles.remarksLabel}>{t('remarks')}</Text>
          <Text style={styles.remarksText}>{flight.remarks}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.editBtn}
        onPress={() => router.push({ pathname: '/drone-flight/add', params: { id: String(flight.id) } })}
        activeOpacity={0.85}
      >
        <Ionicons name="create-outline" size={16} color={Colors.primary} />
        <Text style={styles.editBtnText}>{t('edit')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.85}>
        <Ionicons name="trash-outline" size={16} color={Colors.danger} />
        <Text style={styles.deleteBtnText}>{t('delete')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const styles = makeStyles();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  const styles = makeStyles();
  return (
    <View style={[styles.tag, { borderColor: color + '66', backgroundColor: color + '14' }]}>
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 60, gap: 12 },
    hero: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 18,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 6,
    },
    heroLocation: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800' },
    heroDate: { color: Colors.textSecondary, fontSize: 13, fontFamily: 'Menlo' },
    heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },

    card: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    detailRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
    },
    detailLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
    detailValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
    mono: { fontFamily: 'Menlo' },

    remarksCard: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    remarksLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
    remarksText: { color: Colors.textPrimary, fontSize: 14, lineHeight: 20 },

    tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
    tagText: { fontSize: 11, fontWeight: '700' },

    editBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: 13, borderRadius: 10,
      backgroundColor: Colors.primary + '18',
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    editBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
    deleteBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: 13, borderRadius: 10,
      backgroundColor: Colors.danger + '18',
      borderWidth: 1, borderColor: Colors.danger + '44',
    },
    deleteBtnText: { color: Colors.danger, fontSize: 14, fontWeight: '700' },
  });
}
