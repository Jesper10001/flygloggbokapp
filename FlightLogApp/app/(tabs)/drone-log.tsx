import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import {
  listDrones, listBatteries, deleteDrone,
  type DroneFlight, type DroneRegistryEntry, type DroneBattery,
} from '../../db/drones';
import { categoryLabel } from '../../constants/droneCategories';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function DroneLog() {
  const router = useRouter();
  const { t } = useTranslation();
  const { flights, loadFlights } = useDroneFlightStore();
  const mode = useAppModeStore((s) => s.mode);
  const styles = makeStyles();
  const [tab, setTab] = useState<'flights' | 'drones'>('flights');
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => { loadFlights(); }, []));

  const filteredFlights = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flights;
    return flights.filter((f) =>
      (f.location ?? '').toLowerCase().includes(q) ||
      (f.drone_type ?? '').toLowerCase().includes(q) ||
      (f.registration ?? '').toLowerCase().includes(q) ||
      (f.mission_type ?? '').toLowerCase().includes(q) ||
      (f.category ?? '').toLowerCase().includes(q) ||
      (f.flight_mode ?? '').toLowerCase().includes(q) ||
      (f.remarks ?? '').toLowerCase().includes(q) ||
      (f.observer_name ?? '').toLowerCase().includes(q)
    );
  }, [flights, query]);

  const grouped = useMemo(() => {
    const groups: { key: string; title: string; totalHours: number; flights: DroneFlight[] }[] = [];
    const map = new Map<string, { title: string; totalHours: number; flights: DroneFlight[] }>();
    for (const f of filteredFlights) {
      const parts = f.date?.split('-');
      if (!parts || parts.length < 2) continue;
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (!map.has(key)) {
        map.set(key, { title: `${MONTHS[month - 1]} ${year}`, totalHours: 0, flights: [] });
      }
      const g = map.get(key)!;
      g.flights.push(f);
      g.totalHours += f.total_time ?? 0;
    }
    for (const [key, v] of map.entries()) {
      groups.push({ key, ...v, totalHours: Math.round(v.totalHours * 100) / 100 });
    }
    groups.sort((a, b) => b.key.localeCompare(a.key));
    return groups;
  }, [filteredFlights]);

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'flights' && styles.tabBtnActive]}
          onPress={() => setTab('flights')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabBtnText, tab === 'flights' && styles.tabBtnTextActive]}>{t('flights')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'drones' && styles.tabBtnActive]}
          onPress={() => setTab('drones')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabBtnText, tab === 'drones' && styles.tabBtnTextActive]}>{t('manage_drones')}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'flights' ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {flights.length > 0 && (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={15} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={t('search_drone_flights')}
                placeholderTextColor={Colors.textMuted}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {flights.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="hardware-chip-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>{t('drone_log_title')}</Text>
              <Text style={styles.emptyText}>{t('drone_log_placeholder')}</Text>
            </View>
          ) : filteredFlights.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyText}>{t('no_results')}</Text>
            </View>
          ) : (
            grouped.map((g) => (
              <View key={g.key} style={{ gap: 6 }}>
                <View style={styles.monthHeader}>
                  <Text style={styles.monthTitle}>{g.title.toUpperCase()}</Text>
                  <View style={styles.monthMeta}>
                    <Text style={styles.monthHours}>{decimalToHHMM(g.totalHours)}h</Text>
                    <Text style={styles.monthCount}>{g.flights.length} flt.</Text>
                  </View>
                </View>
                {g.flights.map((f) => (
                  <DroneFlightRow key={f.id} flight={f} onPress={() => router.push(`/drone-flight/${f.id}`)} />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        <DronesList />
      )}

      {tab === 'flights' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/drone-flight/add')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color={Colors.textInverse} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function DronesList() {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = makeStyles();
  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [batteriesByDrone, setBatteriesByDrone] = useState<Record<number, DroneBattery[]>>({});

  const load = async () => {
    const ds = await listDrones();
    setDrones(ds);
    const map: Record<number, DroneBattery[]> = {};
    for (const d of ds) map[d.id] = await listBatteries(d.id);
    setBatteriesByDrone(map);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const handleDelete = (d: DroneRegistryEntry) => {
    Alert.alert(t('delete'), `${d.model || d.registration}?`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => { await deleteDrone(d.id); await load(); } },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {drones.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="hardware-chip-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>{t('drones_empty')}</Text>
          <Text style={styles.emptyText}>{t('drones_subtitle')}</Text>
        </View>
      ) : (
        drones.map((d) => {
          const bats = batteriesByDrone[d.id] ?? [];
          return (
            <TouchableOpacity
              key={d.id}
              style={styles.droneRow}
              onPress={() => router.push({ pathname: '/settings/drones', params: { editId: String(d.id) } })}
              onLongPress={() => handleDelete(d)}
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.droneTitle}>{d.model || d.drone_type || '—'}</Text>
                <Text style={styles.droneMeta}>
                  {d.registration ? `${d.registration} · ` : ''}{d.mtow_g}g · {categoryLabel(d.category) || 'No category'}
                </Text>
                {bats.length > 0 && (
                  <Text style={styles.batteryMeta}>
                    {bats.length} {bats.length === 1 ? t('battery') : t('batteries')} · {bats.reduce((s, b) => s + b.cycle_count, 0)} {t('cycles_total')}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          );
        })
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/settings/drones')} activeOpacity={0.85}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.addBtnText}>{t('add_drone')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DroneFlightRow({ flight, onPress }: { flight: DroneFlight; onPress: () => void }) {
  const styles = makeStyles();
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.routeRow}>
        <Text style={styles.location} numberOfLines={1}>{flight.location || '—'}</Text>
        <Text style={styles.dateText}>{flight.date}</Text>
      </View>
      <Text style={styles.meta}>
        {flight.drone_type || '—'} {flight.registration ? '· ' + flight.registration : ''}{flight.mission_type ? ' · ' + flight.mission_type : ''}
      </Text>
      <View style={styles.tags}>
        <Tag label={`${decimalToHHMM(flight.total_time)}h`} color={Colors.primary} />
        <Tag label={flight.flight_mode} color={flight.flight_mode === 'BVLOS' ? Colors.gold : Colors.primaryLight} />
        {flight.category ? <Tag label={categoryLabel(flight.category)} color={Colors.textSecondary} /> : null}
        {flight.is_night ? <Tag label="Night" color={Colors.textMuted} /> : null}
        {flight.has_observer ? <Tag label="Obs" color={Colors.success} /> : null}
      </View>
    </TouchableOpacity>
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
    content: { padding: 16, gap: 12, paddingBottom: 100 },
    empty: { alignItems: 'center', gap: 10, paddingVertical: 80 },
    emptyTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
    emptyText: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },

    tabRow: {
      flexDirection: 'row',
      marginHorizontal: 16, marginTop: 12, marginBottom: 6,
      backgroundColor: Colors.elevated, borderRadius: 8,
      padding: 3, borderWidth: 0.5, borderColor: Colors.border,
    },
    tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6 },
    tabBtnActive: { backgroundColor: Colors.primary },
    tabBtnText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
    tabBtnTextActive: { color: Colors.textInverse },

    searchRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.card, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1, borderColor: Colors.border,
      marginBottom: 6,
    },
    searchInput: {
      flex: 1, color: Colors.textPrimary, fontSize: 14, paddingVertical: 4,
    },

    monthHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 4, paddingVertical: 4, marginTop: 2,
    },
    monthTitle: {
      flex: 1, color: Colors.textSecondary, fontSize: 11,
      fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    },
    monthMeta: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    monthHours: { color: Colors.primary, fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' },
    monthCount: { color: Colors.textMuted, fontSize: 11 },

    row: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 12, gap: 6,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    routeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    location: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
    dateText: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo', marginLeft: 8 },
    meta: { color: Colors.textSecondary, fontSize: 12 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
    tag: {
      paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1,
    },
    tagText: { fontSize: 11, fontWeight: '700' },

    droneRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    droneTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    droneMeta: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    batteryMeta: { color: Colors.textMuted, fontSize: 11, marginTop: 3 },

    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6,
      marginTop: 4,
    },
    addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

    fab: {
      position: 'absolute', right: 20, bottom: 28,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: Colors.primary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
  });
}
