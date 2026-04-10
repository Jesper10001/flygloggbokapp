import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useFlightStore } from '../../store/flightStore';
import { searchFlights } from '../../db/flights';
import { Colors } from '../../constants/colors';
import { formatDate, formatHours } from '../../utils/format';
import type { Flight } from '../../types/flight';

function FlightRow({ flight, onPress, onDelete }: {
  flight: Flight;
  onPress: () => void;
  onDelete: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <View style={styles.routeRow}>
          <Text style={styles.icao}>{flight.dep_place}</Text>
          <Ionicons name="arrow-forward" size={12} color={Colors.textMuted} />
          <Text style={styles.icao}>{flight.arr_place}</Text>
        </View>
        <Text style={styles.meta}>
          {formatDate(flight.date)} · {flight.aircraft_type} {flight.registration}
        </Text>
        <View style={styles.tags}>
          <Tag label={`${formatHours(flight.total_time)}h`} icon="time-outline" />
          {flight.ifr > 0 && <Tag label={`IFR ${formatHours(flight.ifr)}h`} color={Colors.primaryLight} />}
          {flight.night > 0 && <Tag label={`Natt ${formatHours(flight.night)}h`} color={Colors.textMuted} />}
          {flight.pic > 0 && <Tag label={`PIC ${formatHours(flight.pic)}h`} color={Colors.accent} />}
        </View>
      </View>
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <Ionicons name="trash-outline" size={18} color={Colors.danger} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function Tag({ label, icon, color }: { label: string; icon?: string; color?: string }) {
  return (
    <View style={[styles.tag, color ? { borderColor: color + '44' } : null]}>
      {icon ? <Ionicons name={icon as any} size={10} color={color ?? Colors.textMuted} /> : null}
      <Text style={[styles.tagText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

export default function LogScreen() {
  const router = useRouter();
  const { flights, isLoading, loadFlights, removeFlight } = useFlightStore();
  const [query, setQuery] = useState('');
  const [filtered, setFiltered] = useState<Flight[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadFlights();
    }, [])
  );

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(flights);
      return;
    }
    const doSearch = async () => {
      const results = await searchFlights(query);
      setFiltered(results);
    };
    doSearch();
  }, [query, flights]);

  const handleDelete = (id: number, route: string) => {
    Alert.alert(
      'Ta bort flygning',
      `Ta bort ${route}?`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Ta bort',
          style: 'destructive',
          onPress: () => removeFlight(id),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Sökfält */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Sök ICAO, typ, registration..."
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
          clearButtonMode="while-editing"
        />
      </View>

      {isLoading && filtered.length === 0 ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="airplane-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Inga flygningar</Text>
          <Text style={styles.emptyText}>
            {query ? 'Inga träffar för sökningen.' : 'Tryck på "Logga ny flygning" för att börja.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <FlightRow
              flight={item}
              onPress={() => router.push(`/flight/${item.id}`)}
              onDelete={() => handleDelete(item.id, `${item.dep_place}→${item.arr_place}`)}
            />
          )}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/flight/add')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={Colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    margin: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 15,
    paddingVertical: 10,
  },

  row: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  rowLeft: { flex: 1, gap: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icao: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },
  deleteBtn: { padding: 4, marginLeft: 8 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
