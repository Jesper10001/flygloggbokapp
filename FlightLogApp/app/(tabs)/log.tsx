import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useFlightStore } from '../../store/flightStore';
import { searchFlights, getAllAircraftTypes, updateAircraftType, deleteAircraftType } from '../../db/flights';
import type { AircraftRegistryEntry } from '../../db/flights';
import { Colors } from '../../constants/colors';
import { formatDate, formatHours } from '../../utils/format';
import type { Flight } from '../../types/flight';
import { AircraftModal } from '../../components/AircraftModal';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
];

type MonthSection = {
  key: string;       // "2025-04"
  year: number;
  month: number;
  title: string;     // "April 2025"
  totalHours: number;
  count: number;
  flights: Flight[];
};

type YearGroup = {
  year: number;
  totalHours: number;
  months: MonthSection[];
};

function buildTree(flights: Flight[]): YearGroup[] {
  const monthMap = new Map<string, MonthSection>();
  for (const flight of flights) {
    const parts = flight.date?.split('-');
    if (!parts || parts.length < 2) continue;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    if (isNaN(year) || isNaN(month)) continue;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!monthMap.has(key)) {
      monthMap.set(key, { key, year, month, title: `${MONTH_NAMES[month - 1]} ${year}`, totalHours: 0, count: 0, flights: [] });
    }
    const sec = monthMap.get(key)!;
    sec.flights.push(flight);
    sec.totalHours = Math.round((sec.totalHours + (flight.total_time ?? 0)) * 100) / 100;
    sec.count += 1;
  }

  const yearMap = new Map<number, YearGroup>();
  for (const sec of monthMap.values()) {
    if (!yearMap.has(sec.year)) yearMap.set(sec.year, { year: sec.year, totalHours: 0, months: [] });
    const yg = yearMap.get(sec.year)!;
    yg.months.push(sec);
    yg.totalHours = Math.round((yg.totalHours + sec.totalHours) * 100) / 100;
  }

  return Array.from(yearMap.values())
    .sort((a, b) => b.year - a.year)
    .map((yg) => ({ ...yg, months: yg.months.sort((a, b) => b.month - a.month) }));
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function FlightRow({ flight, onPress, onDelete, index }: {
  flight: Flight; onPress: () => void; onDelete: () => void; index: number;
}) {
  const isFlagged = flight.status === 'flagged';
  const isEven = index % 2 === 0;
  return (
    <TouchableOpacity
      style={[styles.row, isEven ? styles.rowEven : styles.rowOdd, isFlagged && styles.rowFlagged]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.rowLeft}>
        <View style={styles.routeRow}>
          <Text style={styles.icao}>{flight.dep_place}</Text>
          <Ionicons name="arrow-forward" size={11} color={Colors.textMuted} />
          <Text style={styles.icao}>{flight.arr_place}</Text>
          {isFlagged && (
            <View style={styles.flagBadge}><Text style={styles.flagBadgeText}>FLAGGAD</Text></View>
          )}
        </View>
        <Text style={styles.meta}>{formatDate(flight.date)} · {flight.aircraft_type} {flight.registration}</Text>
        <View style={styles.tags}>
          <Tag label={`${formatHours(flight.total_time)}h`} color={Colors.primary} />
          {flight.pic > 0 && <Tag label={`PIC ${formatHours(flight.pic)}h`} color={Colors.success} />}
          {flight.ifr > 0 && <Tag label={`IFR ${formatHours(flight.ifr)}h`} color={Colors.primaryLight} />}
          {flight.night > 0 && <Tag label={`Natt ${formatHours(flight.night)}h`} color={Colors.textMuted} />}
        </View>
      </View>
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} hitSlop={8}>
        <Ionicons name="trash-outline" size={17} color={Colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function Tag({ label, color }: { label: string; color?: string }) {
  return (
    <View style={[styles.tag, color ? { borderColor: color + '44' } : null]}>
      <Text style={[styles.tagText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

// ─── Crew type helpers ────────────────────────────────────────────────────────

const CREW_LABELS: Record<string, string> = {
  sp: 'SP', mp: 'MP', sp_only: 'Enbart SP', mp_only: 'Enbart MP',
};

function CrewBadges({ crewType }: { crewType: string }) {
  if (!crewType) return <Text style={styles.airframeUnknown}>–</Text>;
  const parts = crewType.split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {parts.map((p) => (
        <View key={p} style={styles.crewBadge}>
          <Text style={styles.crewBadgeText}>{CREW_LABELS[p] ?? p}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Saved airframes view ────────────────────────────────────────────────────

function AirframesView() {
  const [airframes, setAirframes] = useState<AircraftRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AircraftRegistryEntry | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAirframes(await getAllAircraftTypes());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const handleDelete = (entry: AircraftRegistryEntry) => {
    Alert.alert(
      `Ta bort ${entry.aircraft_type}?`,
      'Registrerade individer och fartygsdata tas bort.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Ta bort', style: 'destructive',
          onPress: async () => {
            await deleteAircraftType(entry.aircraft_type);
            reload();
          },
        },
      ]
    );
  };

  if (loading) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />;

  if (airframes.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="airplane-outline" size={48} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Inga sparade fartyg</Text>
        <Text style={styles.emptyText}>Lägg till ett luftfartyg när du loggar en flygning (+).</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.airframesList}>
      {airframes.map((entry) => (
        <TouchableOpacity
          key={entry.aircraft_type}
          style={styles.airframeRow}
          onPress={() => setEditing(entry)}
          activeOpacity={0.75}
        >
          <View style={styles.airframeLeft}>
            <Text style={styles.airframeType}>{entry.aircraft_type}</Text>
            <View style={styles.airframeMeta}>
              {entry.cruise_speed_kts > 0 && (
                <Text style={styles.airframeMetaText}>{entry.cruise_speed_kts} kts</Text>
              )}
              {entry.endurance_h > 0 && (
                <Text style={styles.airframeMetaText}>{entry.endurance_h}h</Text>
              )}
              {entry.reg_count > 0 && (
                <Text style={styles.airframeMetaText}>{entry.reg_count} individ{entry.reg_count !== 1 ? 'er' : ''}</Text>
              )}
            </View>
            <CrewBadges crewType={entry.crew_type} />
          </View>
          <View style={styles.airframeActions}>
            <TouchableOpacity onPress={() => handleDelete(entry)} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </View>
        </TouchableOpacity>
      ))}

      <AircraftModal
        visible={!!editing}
        editMode
        initialType={editing?.aircraft_type}
        initialSpeedKts={editing?.cruise_speed_kts}
        initialEnduranceH={editing?.endurance_h}
        initialCrewType={editing?.crew_type}
        onClose={() => setEditing(null)}
        onSave={async (type, speedKts, endH, crewType) => {
          await updateAircraftType(type, speedKts, endH, crewType);
          setEditing(null);
          reload();
        }}
      />
    </ScrollView>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LogScreen() {
  const router = useRouter();
  const { flights, isLoading, loadFlights, removeFlight } = useFlightStore();
  const [tab, setTab] = useState<'flights' | 'airframes'>('flights');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Flight[]>([]);
  const [tree, setTree] = useState<YearGroup[]>([]);

  const nowKey = currentMonthKey();
  const nowYear = new Date().getFullYear();

  // Expanded state: which years show their months, which month shows flights
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([nowYear]));
  const [openMonthKey, setOpenMonthKey] = useState<string>(nowKey);

  useFocusEffect(useCallback(() => { loadFlights(); }, []));

  useEffect(() => {
    if (!query.trim()) setTree(buildTree(flights));
  }, [flights, query]);

  useEffect(() => {
    if (!query.trim()) return;
    searchFlights(query).then(setSearchResults);
  }, [query]);

  const handleDelete = (id: number, route: string) => {
    Alert.alert('Ta bort flygning', `Ta bort ${route}?`, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Ta bort', style: 'destructive', onPress: () => removeFlight(id) },
    ]);
  };

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  };

  const toggleMonth = (key: string) => {
    setOpenMonthKey((prev) => (prev === key ? '' : key));
  };

  const isSearching = query.trim().length > 0;

  return (
    <View style={styles.container}>
      {/* Segment: Flygningar | Saved airframes */}
      <View style={styles.segmentBar}>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'flights' && styles.segmentBtnActive]}
          onPress={() => setTab('flights')}
          activeOpacity={0.7}
        >
          <Text style={[styles.segmentText, tab === 'flights' && styles.segmentTextActive]}>Flygningar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'airframes' && styles.segmentBtnActive]}
          onPress={() => setTab('airframes')}
          activeOpacity={0.7}
        >
          <Text style={[styles.segmentText, tab === 'airframes' && styles.segmentTextActive]}>Saved airframes</Text>
        </TouchableOpacity>
      </View>

      {tab === 'airframes' ? <AirframesView /> : (<>

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

      {isLoading && flights.length === 0 ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : isSearching ? (
        /* Sökvy */
        searchResults.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Inga träffar</Text>
            <Text style={styles.emptyText}>Inga flygningar matchar sökningen.</Text>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item, index }) => (
              <FlightRow
                flight={item} index={index}
                onPress={() => router.push(`/flight/${item.id}`)}
                onDelete={() => handleDelete(item.id, `${item.dep_place}→${item.arr_place}`)}
              />
            )}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )
      ) : tree.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="airplane-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Inga flygningar</Text>
          <Text style={styles.emptyText}>Tryck på + för att logga din första flygning.</Text>
        </View>
      ) : (
        /* Accordion-vy */
        <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          {tree.map((yg) => {
            const yearOpen = expandedYears.has(yg.year);
            return (
              <View key={yg.year}>
                {/* Årsrad */}
                <TouchableOpacity style={styles.yearHeader} onPress={() => toggleYear(yg.year)} activeOpacity={0.75}>
                  <Ionicons
                    name={yearOpen ? 'chevron-down' : 'chevron-forward'}
                    size={16} color={Colors.textMuted} style={{ marginRight: 6 }}
                  />
                  <Text style={styles.yearTitle}>{yg.year}</Text>
                  <View style={styles.yearMeta}>
                    <Text style={styles.yearHours}>{formatHours(yg.totalHours)}h</Text>
                    <Text style={styles.yearCount}>{yg.months.reduce((s, m) => s + m.count, 0)} flygn.</Text>
                  </View>
                </TouchableOpacity>

                {/* Månader under detta år */}
                {yearOpen && yg.months.map((sec) => {
                  const monthOpen = openMonthKey === sec.key;
                  const isCurrent = sec.key === nowKey;
                  return (
                    <View key={sec.key}>
                      {/* Månadsrad */}
                      <TouchableOpacity
                        style={[styles.monthHeader, isCurrent && styles.monthHeaderCurrent]}
                        onPress={() => toggleMonth(sec.key)}
                        activeOpacity={0.75}
                      >
                        <Ionicons
                          name={monthOpen ? 'chevron-down' : 'chevron-forward'}
                          size={14}
                          color={isCurrent ? Colors.primary : Colors.textMuted}
                          style={{ marginRight: 6, marginLeft: 22 }}
                        />
                        <Text style={[styles.monthTitle, isCurrent && styles.monthTitleCurrent]}>
                          {sec.title.toUpperCase()}
                        </Text>
                        <View style={styles.monthMeta}>
                          <Text style={[styles.monthHours, isCurrent && { color: Colors.primary }]}>
                            {formatHours(sec.totalHours)}h
                          </Text>
                          <Text style={styles.monthCount}>{sec.count} flygn.</Text>
                        </View>
                      </TouchableOpacity>

                      {/* Flygningar i månaden */}
                      {monthOpen && sec.flights.map((flight, index) => (
                        <FlightRow
                          key={flight.id}
                          flight={flight}
                          index={index}
                          onPress={() => router.push(`/flight/${flight.id}`)}
                          onDelete={() => handleDelete(flight.id, `${flight.dep_place}→${flight.arr_place}`)}
                        />
                      ))}
                      {monthOpen && <View style={styles.monthBottom} />}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}

      </>)}

      {/* FAB — only in flights tab */}
      {tab === 'flights' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/flight/add')}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color={Colors.textInverse} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, margin: 12, marginBottom: 4,
    borderRadius: 8, paddingHorizontal: 12,
    borderWidth: 0.5, borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 15, paddingVertical: 10 },

  listContent: { paddingBottom: 96 },
  separator: { height: 1, backgroundColor: Colors.separator },

  // Årsrad
  yearHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.background,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  yearTitle: {
    flex: 1, color: Colors.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 0.5,
  },
  yearMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  yearHours: { color: Colors.primary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
  yearCount: { color: Colors.textMuted, fontSize: 12 },

  // Månadsrad
  monthHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.elevated,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  monthHeaderCurrent: {
    backgroundColor: Colors.primary + '12',
  },
  monthTitle: {
    flex: 1, color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1,
  },
  monthTitleCurrent: { color: Colors.primary },
  monthMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthHours: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' },
  monthCount: { color: Colors.textMuted, fontSize: 11 },
  monthBottom: { height: 4, backgroundColor: Colors.elevated },

  // Flygningsrad
  row: { padding: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-start' },
  rowEven: { backgroundColor: Colors.card },
  rowOdd: { backgroundColor: Colors.elevated },
  rowFlagged: { backgroundColor: Colors.danger + '18' },
  flagBadge: {
    backgroundColor: Colors.danger + '22', borderRadius: 3,
    paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 0.5, borderColor: Colors.danger + '88',
  },
  flagBadgeText: { color: Colors.danger, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  rowLeft: { flex: 1, gap: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icao: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', letterSpacing: 1, fontFamily: 'Menlo' },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 0.5, borderColor: Colors.border,
    borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2,
  },
  tagText: { color: Colors.textMuted, fontSize: 10, fontWeight: '600', fontFamily: 'Menlo' },
  deleteBtn: { padding: 4, marginLeft: 8 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },

  // Segment control
  segmentBar: {
    flexDirection: 'row', margin: 12, marginBottom: 4,
    backgroundColor: Colors.elevated, borderRadius: 8, padding: 3,
    borderWidth: 0.5, borderColor: Colors.border,
  },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6 },
  segmentBtnActive: { backgroundColor: Colors.primary },
  segmentText: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: Colors.textInverse, fontWeight: '700' },

  // Saved airframes
  airframesList: { padding: 12, paddingBottom: 40, gap: 8 },
  airframeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 10,
  },
  airframeLeft: { flex: 1, gap: 4 },
  airframeType: {
    color: Colors.textPrimary, fontSize: 17, fontWeight: '800',
    letterSpacing: 0.5, fontFamily: 'Menlo',
  },
  airframeMeta: { flexDirection: 'row', gap: 8 },
  airframeMetaText: { color: Colors.textSecondary, fontSize: 12 },
  airframeActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  airframeUnknown: { color: Colors.textMuted, fontSize: 12 },

  crewBadge: {
    backgroundColor: Colors.primary + '22', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 0.5, borderColor: Colors.primary + '66',
  },
  crewBadgeText: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
});
