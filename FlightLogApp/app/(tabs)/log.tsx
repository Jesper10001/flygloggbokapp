import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, Alert, ActivityIndicator, ScrollView, Modal, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useFlightStore } from '../../store/flightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { searchFlights, getAllAircraftTypes, updateAircraftType, deleteAircraftType, addAircraftTypeToRegistry, getNightFlightsMissingNvg, setFlightNvg } from '../../db/flights';
import type { AircraftRegistryEntry } from '../../db/flights';
import { Colors } from '../../constants/colors';
import { formatDate } from '../../utils/format';
import type { Flight } from '../../types/flight';
import { AircraftModal } from '../../components/AircraftModal';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormat, formatTimeValue } from '../../hooks/useTimeFormat';
import { Image as RNImage } from 'react-native';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { getActiveBook, getSpreadsForBook, type LogbookBook, type SpreadInfo } from '../../db/logbookBooks';
import {
  getAllScanSummaries, deleteScanSummary, updateScanSummaryNames,
  type ScanSummary,
} from '../../db/scanSummaries';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles() {
  return StyleSheet.create({
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

    // Loggbokssummering
    summaryAccordion: {
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
      backgroundColor: Colors.elevated,
    },
    summaryAccordionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      paddingHorizontal: 14, paddingVertical: 12,
    },
    summaryAccordionTitle: {
      flex: 1, color: Colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    summaryAccordionCount: { color: Colors.textMuted, fontSize: 11, marginRight: 4 },
    summaryEmpty: { paddingHorizontal: 22, paddingVertical: 12 },
    summaryEmptyText: { color: Colors.textMuted, fontSize: 13 },
    summaryBookHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: Colors.background,
      borderTopWidth: 0.5, borderTopColor: Colors.border,
    },
    summaryBookTitle: { flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    summaryBookCount: { color: Colors.textMuted, fontSize: 11 },
    summaryPageHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 9,
      backgroundColor: Colors.elevated,
      borderTopWidth: 0.5, borderTopColor: Colors.separator,
    },
    summaryPageTitle: { flex: 1, color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
    summaryPageDate: { color: Colors.textMuted, fontSize: 11 },
    summaryPageStats: {
      paddingHorizontal: 14, paddingLeft: 56, paddingVertical: 8,
      backgroundColor: Colors.card, gap: 6,
      borderTopWidth: 0.5, borderTopColor: Colors.separator,
    },
    summaryStatRow: { flexDirection: 'row', justifyContent: 'space-between' },
    summaryStatLabel: { color: Colors.textMuted, fontSize: 12 },
    summaryStatValue: {
      color: Colors.textPrimary, fontSize: 12, fontWeight: '700',
      fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
    },

    // Äldre årtal-dropdown
    olderYearsHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: Colors.elevated,
      borderTopWidth: 0.5, borderTopColor: Colors.border,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
      marginTop: 8,
    },
    olderYearsTitle: {
      flex: 1, color: Colors.textSecondary, fontSize: 12,
      fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    },
    olderYearsCount: {
      color: Colors.textMuted, fontSize: 11, marginLeft: 8,
    },

    // NVG-hjälparen under flygningar
    nvgHelperCard: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.primary + '14',
      borderRadius: 10, padding: 12, marginTop: 12, marginBottom: 4,
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    nvgHelperTitle: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    nvgHelperSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
    nvgModalBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
    nvgModalSheet: {
      backgroundColor: Colors.card, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    nvgModalHandle: {
      width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
      alignSelf: 'center', marginBottom: 12,
    },
    nvgModalTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 4 },
    nvgModalEmpty: { color: Colors.textMuted, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
    nvgModalProgress: { color: Colors.textMuted, fontSize: 11, marginBottom: 10 },
    nvgFlightCard: {
      backgroundColor: Colors.elevated, borderRadius: 10, padding: 14,
      borderWidth: 0.5, borderColor: Colors.border, gap: 4, marginBottom: 12,
    },
    nvgFlightRoute: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
    nvgFlightMeta: { color: Colors.textSecondary, fontSize: 12 },
    nvgModalBtnRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    nvgSkipBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    nvgSkipBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
    nvgMarkBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary,
    },
    nvgMarkBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
    nvgCloseBtn: { alignItems: 'center', paddingVertical: 10 },
    nvgCloseBtnText: { color: Colors.textMuted, fontSize: 13 },

    // Flygningar-dropdown
    flightsHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      paddingHorizontal: 14, paddingVertical: 12,
      backgroundColor: Colors.elevated,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
      borderTopWidth: 0.5, borderTopColor: Colors.border,
    },
    flightsHeaderTitle: {
      flex: 1, color: Colors.textSecondary, fontSize: 12, fontWeight: '700',
      letterSpacing: 0.5, textTransform: 'uppercase',
    },
    flightsHeaderCount: { color: Colors.textMuted, fontSize: 11, marginRight: 4 },

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
    addAircraftBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6,
    },
    addAircraftBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
    airframeRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 10, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 10,
    },
    airframeLeft: { flex: 1, gap: 4 },
    airframeTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    airframeBadgeRow: { flexDirection: 'row', gap: 4 },
    badge: {
      paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    badgeText: { color: Colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
    badgeMe: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary + '66' },
    badgeMeText: { color: Colors.primary },
    badgeHeli: { backgroundColor: Colors.gold + '22', borderColor: Colors.gold + '66' },
    badgeHeliText: { color: Colors.gold },
    airframeType: {
      color: Colors.textPrimary, fontSize: 17, fontWeight: '800',
      letterSpacing: 0.5, fontFamily: 'Menlo',
    },
    airframeMeta: { flexDirection: 'row', gap: 8 },
    airframeMetaText: { color: Colors.textSecondary, fontSize: 12 },
    airframeRight: { alignItems: 'flex-end', gap: 4 },
    totalHours: { color: Colors.primary, fontSize: 20, fontWeight: '800' },
    topRegBlock: { alignItems: 'flex-end' },
    topRegText: {
      color: Colors.textSecondary, fontSize: 12, fontWeight: '700',
      textDecorationLine: 'underline',
    },
    topRegHours: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },
    airframeActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    airframeUnknown: { color: Colors.textMuted, fontSize: 12 },

    specRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    specDotGreen: { width: 7, height: 7, borderRadius: 2, backgroundColor: Colors.success },
    specDotRed: { width: 7, height: 7, borderRadius: 2, backgroundColor: Colors.danger },

    crewBadge: {
      backgroundColor: Colors.primary + '22', borderRadius: 4,
      paddingHorizontal: 6, paddingVertical: 2,
      borderWidth: 0.5, borderColor: Colors.primary + '66',
    },
    crewBadgeText: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
  });
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function FlightRow({ flight, onPress, index }: {
  flight: Flight; onPress: () => void; index: number;
}) {
  const styles = makeStyles();
  const isFlagged = flight.status === 'flagged';
  const isEven = index % 2 === 0;
  const { formatTime } = useTimeFormat();
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
            <View style={styles.flagBadge}><Text style={styles.flagBadgeText}>FLAGGED</Text></View>
          )}
        </View>
        <Text style={styles.meta}>{formatDate(flight.date)} · {flight.aircraft_type} {flight.registration}</Text>
        <View style={styles.tags}>
          <Tag label={`${formatTime(flight.total_time)}h`} color={Colors.primary} />
          {flight.pic > 0 && <Tag label={`PIC ${formatTime(flight.pic)}h`} color={Colors.success} />}
          {flight.ifr > 0 && <Tag label={`IFR ${formatTime(flight.ifr)}h`} color={Colors.primaryLight} />}
          {flight.night > 0 && <Tag label={`Night ${formatTime(flight.night)}h`} color={Colors.textMuted} />}
          {(flight.nvg ?? 0) > 0 && <Tag label={`NVG ${formatTime(flight.nvg ?? 0)}h`} color={Colors.gold} />}
          {flight.flight_type === 'hot_refuel' && <Tag label="Hot refuel" color={Colors.warning} />}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Tag({ label, color }: { label: string; color?: string }) {
  const styles = makeStyles();
  return (
    <View style={[styles.tag, color ? { borderColor: color + '44' } : null]}>
      <Text style={[styles.tagText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

// ─── Crew type helpers ────────────────────────────────────────────────────────

function SpecBadges({ crewType, engineType }: { crewType: string; engineType: string }) {
  const styles = makeStyles();
  const parts = crewType ? crewType.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const hasSP = parts.includes('sp');
  const hasMP = parts.includes('mp');
  const hasSE = engineType === 'se';
  const hasME = engineType === 'me';
  const items: { label: string }[] = [];
  if (hasSP) items.push({ label: 'SP' });
  if (hasMP) items.push({ label: 'MP' });
  if (hasSE) items.push({ label: 'SE' });
  if (hasME) items.push({ label: 'ME' });
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {items.map((item) => (
        <View key={item.label} style={styles.crewBadge}>
          <Text style={styles.crewBadgeText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Saved airframes view ────────────────────────────────────────────────────

function AirframesView() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [airframes, setAirframes] = useState<AircraftRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AircraftRegistryEntry | null>(null);
  const [adding, setAdding] = useState(false);

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
      `${t('delete')} ${entry.aircraft_type}?`,
      'Registered aircraft and type data will be removed.',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'), style: 'destructive',
          onPress: async () => {
            await deleteAircraftType(entry.aircraft_type);
            reload();
          },
        },
      ]
    );
  };

  if (loading) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />;

  if (airframes.length === 0 && !loading) {
    return (
      <View style={styles.empty}>
        <Ionicons name="airplane-outline" size={48} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>{t('no_saved_airframes')}</Text>
        <Text style={styles.emptyText}>{t('no_saved_airframes_text')}</Text>
        <TouchableOpacity style={styles.addAircraftBtn} onPress={() => setAdding(true)} activeOpacity={0.8}>
          <Ionicons name="add-circle" size={18} color={Colors.textInverse} />
          <Text style={styles.addAircraftBtnText}>{t('new_aircraft')}</Text>
        </TouchableOpacity>
        <AircraftModal
          visible={adding}
          onClose={() => setAdding(false)}
          onSave={async (type, speedKts, endH, crewType, category, engineType, imageUrl) => {
            await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType, imageUrl);
            setAdding(false);
            reload();
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.airframesList}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <TouchableOpacity style={styles.addAircraftBtn} onPress={() => setAdding(true)} activeOpacity={0.8}>
        <Ionicons name="add-circle" size={18} color={Colors.textInverse} />
        <Text style={styles.addAircraftBtnText}>{t('new_aircraft')}</Text>
      </TouchableOpacity>
      {airframes.map((entry) => (
        <TouchableOpacity
          key={entry.aircraft_type}
          style={styles.airframeRow}
          onPress={() => setEditing(entry)}
          activeOpacity={0.75}
        >
          <View style={styles.airframeLeft}>
            {/* Rad 1: Typbeteckning + HELI/FIXED W */}
            <View style={styles.airframeTypeRow}>
              <Text style={styles.airframeType}>{entry.aircraft_type}</Text>
              {entry.category === 'helicopter' && (
                <View style={[styles.badge, styles.badgeHeli]}>
                  <Text style={[styles.badgeText, styles.badgeHeliText]}>HELI</Text>
                </View>
              )}
              {entry.category === 'airplane' && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>FIXED W</Text>
                </View>
              )}
            </View>

            {/* Rad 2: Marschfart (grön) + Endurance (röd) */}
            <View style={styles.airframeMeta}>
              {entry.cruise_speed_kts > 0 && (
                <View style={styles.specRow}>
                  <View style={styles.specDotGreen} />
                  <Text style={styles.airframeMetaText}>{entry.cruise_speed_kts} KTS</Text>
                </View>
              )}
              {entry.endurance_h > 0 && (
                <View style={styles.specRow}>
                  <View style={styles.specDotRed} />
                  <Text style={styles.airframeMetaText}>{entry.endurance_h}H END.</Text>
                </View>
              )}
            </View>

            {/* Rad 3: SP/MP/SE/ME längst ner */}
            <SpecBadges crewType={entry.crew_type} engineType={entry.engine_type} />
          </View>

          {/* Bild från smart sökning */}
          {entry.image_url ? (
            <RNImage
              source={{ uri: entry.image_url }}
              style={{ width: 80, height: 55, borderRadius: 8 }}
              resizeMode="cover"
            />
          ) : null}

          <View style={styles.airframeRight}>
            {entry.top_registration ? (
              <View style={styles.topRegBlock}>
                <Text style={styles.topRegText}>{entry.top_registration}</Text>
                {entry.top_registration_hours > 0 && (
                  <Text style={styles.topRegHours}>{entry.top_registration_hours}h</Text>
                )}
              </View>
            ) : null}
            <Text style={styles.totalHours}>{entry.total_hours > 0 ? `${entry.total_hours}h` : '—'}</Text>
            <View style={styles.airframeActions}>
              {entry.flight_count === 0 && (
                <TouchableOpacity onPress={() => handleDelete(entry)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </View>
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
        initialCategory={editing?.category}
        initialEngineType={editing?.engine_type}
        onClose={() => setEditing(null)}
        onSave={async (type, speedKts, endH, crewType, category, engineType, imageUrl) => {
          await updateAircraftType(type, speedKts, endH, crewType, category, engineType);
          setEditing(null);
          reload();
        }}
      />
      <AircraftModal
        visible={adding}
        onClose={() => setAdding(false)}
        onSave={async (type, speedKts, endH, crewType, category, engineType, imageUrl) => {
          await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType, imageUrl);
          setAdding(false);
          reload();
        }}
      />
    </ScrollView>
  );
}

// ─── Logbook summary accordion ───────────────────────────────────────────────

const SUMMARY_ROWS_LOG = [
  { label: 'Total flygtid', field: 'total_time' as const, isTime: true },
  { label: 'PIC',           field: 'pic'        as const, isTime: true },
  { label: 'Co-pilot',      field: 'co_pilot'   as const, isTime: true },
  { label: 'IFR',           field: 'ifr'        as const, isTime: true },
  { label: 'Natt',          field: 'night'      as const, isTime: true },
  { label: 'Ldg dag',       field: 'landings_day'   as const, isTime: false },
  { label: 'Ldg natt',      field: 'landings_night' as const, isTime: false },
];

function TranscribeAccordion() {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = makeStyles();
  const [expanded, setExpanded] = useState(false);
  const [book, setBook] = useState<LogbookBook | null>(null);
  const [spreads, setSpreads] = useState<SpreadInfo[]>([]);

  const load = async () => {
    const b = await getActiveBook();
    setBook(b);
    if (b) setSpreads(await getSpreadsForBook(b));
    else setSpreads([]);
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const currentSpread = spreads.find((s) => s.is_current);
  const badge = currentSpread ? currentSpread.flights.length : 0;
  const rowsPerSpread = book?.rows_per_spread ?? 0;
  const ready = book && currentSpread && badge >= rowsPerSpread;

  return (
    <View style={{ marginBottom: 8 }}>
      <TouchableOpacity
        style={[styles.flightsHeader, ready && { backgroundColor: Colors.primary + '14', borderColor: Colors.primary + '88' }]}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.75}
      >
        <Ionicons name="book-outline" size={15} color={ready ? Colors.primary : Colors.textSecondary} />
        <Text style={[styles.flightsHeaderTitle, ready && { color: Colors.primary }]}>
          {t('transcribe_to_paper')}
        </Text>
        {book ? (
          ready ? (
            <View style={{ backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: Colors.textInverse, fontSize: 10, fontWeight: '800' }}>{t('ready')}</Text>
            </View>
          ) : (
            <Text style={styles.flightsHeaderCount}>{badge}/{rowsPerSpread}</Text>
          )
        ) : (
          <Text style={styles.flightsHeaderCount}>{t('no_book')}</Text>
        )}
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.textMuted} />
      </TouchableOpacity>

      {expanded && (
        <View style={{ backgroundColor: Colors.card, borderRadius: 10, borderWidth: 0.5, borderColor: Colors.cardBorder, marginTop: 4, overflow: 'hidden' }}>
          {!book ? (
            <TouchableOpacity
              style={{ padding: 14, alignItems: 'center', gap: 6 }}
              onPress={() => router.push('/settings/logbook-books')}
              activeOpacity={0.75}
            >
              <Ionicons name="add-circle" size={20} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>{t('add_logbook_book')}</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: 11, textAlign: 'center' }}>{t('transcribe_no_book_hint')}</Text>
            </TouchableOpacity>
          ) : (
            <>
              <View style={{ padding: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700' }}>{book.name}</Text>
                <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 1 }}>
                  {spreads.length} {t('spreads_available')}
                </Text>
              </View>
              {spreads.map((s) => (
                <TouchableOpacity
                  key={s.spread_number}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    padding: 12, gap: 8,
                    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
                    backgroundColor: s.is_current ? Colors.primary + '0E' : 'transparent',
                  }}
                  onPress={() => router.push(`/transcribe?spread=${s.spread_number}` as any)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={s.is_current ? 'create-outline' : 'checkmark-circle'}
                    size={16}
                    color={s.is_current ? Colors.primary : Colors.success}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                      {t('page')} {s.page_left}–{s.page_right}
                    </Text>
                    <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 1 }}>
                      {s.is_current ? t('transcribe_current') : t('transcribe_past')}
                      {' · '}{s.flights.length}/{book.rows_per_spread} {t('flights').toLowerCase()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={13} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={{ padding: 12, alignItems: 'center' }}
                onPress={() => router.push('/settings/logbook-books')}
                activeOpacity={0.7}
              >
                <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{t('manage_books')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function LogbookSummaryAccordion({
  summaries,
  onDelete,
  onRename,
}: {
  summaries: ScanSummary[];
  onDelete: (id: number) => void;
  onRename: (id: number, book: string, page: string) => void;
}) {
  const styles = makeStyles();
  const { timeFormat } = useTimeFormatStore();
  const [open, setOpen] = useState(false);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());

  const books = Array.from(new Set(summaries.map(s => s.book_name || 'Okänd bok')));

  const toggleBook = (book: string) =>
    setExpandedBooks(prev => { const n = new Set(prev); n.has(book) ? n.delete(book) : n.add(book); return n; });

  const togglePage = (id: number) =>
    setExpandedPages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <View style={styles.summaryAccordion}>
      <TouchableOpacity style={styles.summaryAccordionHeader} onPress={() => setOpen(v => !v)} activeOpacity={0.8}>
        <Ionicons name="book-outline" size={15} color={Colors.textSecondary} />
        <Text style={styles.summaryAccordionTitle}>Loggbokssummering</Text>
        <Text style={styles.summaryAccordionCount}>{summaries.length} blad</Text>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.textMuted} />
      </TouchableOpacity>

      {open && (
        <View>
          {summaries.length === 0 ? (
            <View style={styles.summaryEmpty}>
              <Text style={styles.summaryEmptyText}>Inga summerade blad ännu</Text>
            </View>
          ) : books.map(book => {
            const pages = summaries.filter(s => (s.book_name || 'Okänd bok') === book);
            const bookOpen = expandedBooks.has(book);
            return (
              <View key={book}>
                <TouchableOpacity style={styles.summaryBookHeader} onPress={() => toggleBook(book)} activeOpacity={0.75}>
                  <Ionicons
                    name={bookOpen ? 'chevron-down' : 'chevron-forward'}
                    size={13} color={Colors.textMuted} style={{ marginRight: 6, marginLeft: 22 }}
                  />
                  <Text style={styles.summaryBookTitle}>{book}</Text>
                  <Text style={styles.summaryBookCount}>{pages.length} blad</Text>
                </TouchableOpacity>

                {bookOpen && pages.map(page => {
                  const pageOpen = expandedPages.has(page.id);
                  const td = page.total_to_date;
                  return (
                    <View key={page.id}>
                      <TouchableOpacity
                        style={styles.summaryPageHeader}
                        onPress={() => togglePage(page.id)}
                        activeOpacity={0.75}
                      >
                        <Ionicons
                          name={pageOpen ? 'chevron-down' : 'chevron-forward'}
                          size={12} color={Colors.textMuted} style={{ marginRight: 6, marginLeft: 44 }}
                        />
                        <Text style={styles.summaryPageTitle}>{page.page_name || 'Okänt blad'}</Text>
                        <Text style={styles.summaryPageDate}>{page.created_at.slice(0, 10)}</Text>
                        <TouchableOpacity
                          hitSlop={8}
                          style={{ marginLeft: 10 }}
                          onPress={() => Alert.alert('Ta bort', `Ta bort "${page.page_name}"?`, [
                            { text: 'Avbryt', style: 'cancel' },
                            { text: 'Ta bort', style: 'destructive', onPress: () => onDelete(page.id) },
                          ])}
                        >
                          <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                        </TouchableOpacity>
                      </TouchableOpacity>

                      {pageOpen && (
                        <View style={styles.summaryPageStats}>
                          {SUMMARY_ROWS_LOG.filter(r => (td as any)[r.field]).map(r => (
                            <View key={r.field} style={styles.summaryStatRow}>
                              <Text style={styles.summaryStatLabel}>{r.label}</Text>
                              <Text style={styles.summaryStatValue}>
                                {r.isTime
                                  ? formatTimeValue((td as any)[r.field], timeFormat)
                                  : String((td as any)[r.field])}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LogScreen() {
  const styles = makeStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const mode = useAppModeStore((s) => s.mode);
  const { flights, isLoading, loadFlights, loadStats } = useFlightStore();
  const [tab, setTab] = useState<'flights' | 'airframes'>('flights');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Flight[]>([]);
  const [tree, setTree] = useState<YearGroup[]>([]);

  const nowKey = currentMonthKey();
  const nowYear = new Date().getFullYear();

  // Expanded state: which years show their months, which month shows flights
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([nowYear]));
  const [openMonthKey, setOpenMonthKey] = useState<string>(nowKey);
  const [flightsExpanded, setFlightsExpanded] = useState(true);
  const [oldYearsExpanded, setOldYearsExpanded] = useState(false);
  const [nvgHelperOpen, setNvgHelperOpen] = useState(false);
  const [nvgCandidates, setNvgCandidates] = useState<Flight[]>([]);
  const [nvgIdx, setNvgIdx] = useState(0);

  const openNvgHelper = async () => {
    const rows = await getNightFlightsMissingNvg();
    setNvgCandidates(rows);
    setNvgIdx(0);
    setNvgHelperOpen(true);
  };
  const markCurrentAsNvg = async () => {
    const f = nvgCandidates[nvgIdx];
    if (!f) return;
    await setFlightNvg(f.id, f.night);
    await Promise.all([loadFlights(), loadStats()]);
    const next = nvgIdx + 1;
    if (next >= nvgCandidates.length) {
      setNvgHelperOpen(false);
    } else {
      setNvgIdx(next);
    }
  };
  const skipCurrentNvg = () => {
    const next = nvgIdx + 1;
    if (next >= nvgCandidates.length) {
      setNvgHelperOpen(false);
    } else {
      setNvgIdx(next);
    }
  };
  const [summaries, setSummaries] = useState<ScanSummary[]>([]);

  const loadSummaries = useCallback(async () => {
    setSummaries(await getAllScanSummaries());
  }, []);

  useFocusEffect(useCallback(() => {
    loadFlights();
    loadSummaries();
  }, [loadSummaries]));

  useEffect(() => {
    if (!query.trim()) setTree(buildTree(flights));
  }, [flights, query]);

  useEffect(() => {
    if (!query.trim()) return;
    searchFlights(query).then(setSearchResults);
  }, [query]);

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

  if (mode !== 'manned') return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      {/* Segment: Flights | Saved airframes */}
      <View style={styles.segmentBar}>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'flights' && styles.segmentBtnActive]}
          onPress={() => setTab('flights')}
          activeOpacity={0.7}
        >
          <Text style={[styles.segmentText, tab === 'flights' && styles.segmentTextActive]}>{t('flights')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'airframes' && styles.segmentBtnActive]}
          onPress={() => setTab('airframes')}
          activeOpacity={0.7}
        >
          <Text style={[styles.segmentText, tab === 'airframes' && styles.segmentTextActive]}>{t('saved_airframes')}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'airframes' ? <AirframesView /> : (<>

      {/* Search field */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('search_placeholder')}
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
        /* Search results view */
        searchResults.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{t('no_results')}</Text>
            <Text style={styles.emptyText}>{t('no_results_text')}</Text>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item, index }) => (
              <FlightRow
                flight={item} index={index}
                onPress={() => router.push(`/flight/${item.id}`)}
              />
            )}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
          />
        )
      ) : tree.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="airplane-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>{t('no_flights')}</Text>
          <Text style={styles.emptyText}>{t('no_flights_text')}</Text>
        </View>
      ) : (
        /* Accordion-vy */
        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <LogbookSummaryAccordion
            summaries={summaries}
            onDelete={async (id) => { await deleteScanSummary(id); loadSummaries(); }}
            onRename={async (id, book, page) => { await updateScanSummaryNames(id, book, page); loadSummaries(); }}
          />

          <TranscribeAccordion />


          {/* Flygningar-dropdown */}
          <TouchableOpacity style={styles.flightsHeader} onPress={() => setFlightsExpanded(v => !v)} activeOpacity={0.75}>
            <Ionicons name="airplane-outline" size={15} color={Colors.textSecondary} />
            <Text style={styles.flightsHeaderTitle}>{t('flights')}</Text>
            <Text style={styles.flightsHeaderCount}>{flights.length} flt.</Text>
            <Ionicons name={flightsExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.textMuted} />
          </TouchableOpacity>

          {flightsExpanded && (() => {
            const currentYear = new Date().getFullYear();
            const recentYears = tree.filter((yg) => currentYear - yg.year <= 5);
            const olderYears = tree.filter((yg) => currentYear - yg.year > 5);
            const renderYear = (yg: YearGroup) => {
              const yearOpen = expandedYears.has(yg.year);
              return (
                <View key={yg.year}>
                  <TouchableOpacity style={styles.yearHeader} onPress={() => toggleYear(yg.year)} activeOpacity={0.75}>
                    <Ionicons
                      name={yearOpen ? 'chevron-down' : 'chevron-forward'}
                      size={16} color={Colors.textMuted} style={{ marginRight: 6 }}
                    />
                    <Text style={styles.yearTitle}>{yg.year}</Text>
                    <View style={styles.yearMeta}>
                      <Text style={styles.yearHours}>{formatTime(yg.totalHours)}h</Text>
                      <Text style={styles.yearCount}>{yg.months.reduce((s, m) => s + m.count, 0)} flt.</Text>
                    </View>
                  </TouchableOpacity>
                  {yearOpen && yg.months.map((sec) => {
                    const monthOpen = openMonthKey === sec.key;
                    const isCurrent = sec.key === nowKey;
                    return (
                      <View key={sec.key}>
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
                              {formatTime(sec.totalHours)}h
                            </Text>
                            <Text style={styles.monthCount}>{sec.count} flt.</Text>
                          </View>
                        </TouchableOpacity>
                        {monthOpen && sec.flights.map((flight, index) => (
                          <FlightRow
                            key={flight.id}
                            flight={flight}
                            index={index}
                            onPress={() => router.push(`/flight/${flight.id}`)}
                          />
                        ))}
                        {monthOpen && <View style={styles.monthBottom} />}
                      </View>
                    );
                  })}
                </View>
              );
            };
            return (
              <>
                {recentYears.map(renderYear)}
                {olderYears.length > 0 && (
                  <>
                    <TouchableOpacity
                      style={styles.olderYearsHeader}
                      onPress={() => setOldYearsExpanded((v) => !v)}
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name={oldYearsExpanded ? 'chevron-down' : 'chevron-forward'}
                        size={14} color={Colors.textMuted} style={{ marginRight: 6 }}
                      />
                      <Text style={styles.olderYearsTitle}>{t('older_than_5_years')}</Text>
                      <Text style={styles.olderYearsCount}>
                        {olderYears.reduce((s, y) => s + y.months.reduce((a, m) => a + m.count, 0), 0)} flt.
                      </Text>
                    </TouchableOpacity>
                    {oldYearsExpanded && olderYears.map(renderYear)}
                  </>
                )}
              </>
            );
          })()}

          {/* NVG-hjälparen — alltid synlig, oberoende av flygningar-dropdown */}
          <TouchableOpacity style={styles.nvgHelperCard} onPress={openNvgHelper} activeOpacity={0.75}>
            <Ionicons name="moon-outline" size={16} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.nvgHelperTitle}>{t('missing_nvg_title')}</Text>
              <Text style={styles.nvgHelperSub}>{t('missing_nvg_sub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>

        </ScrollView>
      )}

      </>)}

      <Modal visible={nvgHelperOpen} transparent animationType="slide" onRequestClose={() => setNvgHelperOpen(false)}>
        <Pressable style={styles.nvgModalBackdrop} onPress={() => setNvgHelperOpen(false)}>
          <Pressable style={styles.nvgModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.nvgModalHandle} />
            <Text style={styles.nvgModalTitle}>{t('missing_nvg_title')}</Text>
            {nvgCandidates.length === 0 ? (
              <Text style={styles.nvgModalEmpty}>{t('missing_nvg_none')}</Text>
            ) : (
              (() => {
                const f = nvgCandidates[nvgIdx];
                if (!f) return null;
                return (
                  <>
                    <Text style={styles.nvgModalProgress}>
                      {nvgIdx + 1} / {nvgCandidates.length}
                    </Text>
                    <View style={styles.nvgFlightCard}>
                      <Text style={styles.nvgFlightRoute}>{f.dep_place} → {f.arr_place}</Text>
                      <Text style={styles.nvgFlightMeta}>
                        {f.date} · {f.aircraft_type} {f.registration}
                      </Text>
                      <Text style={styles.nvgFlightMeta}>
                        Night: {formatTime(f.night)}h · Total: {formatTime(f.total_time)}h
                      </Text>
                    </View>
                    <View style={styles.nvgModalBtnRow}>
                      <TouchableOpacity style={styles.nvgSkipBtn} onPress={skipCurrentNvg} activeOpacity={0.8}>
                        <Text style={styles.nvgSkipBtnText}>{t('skip')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.nvgMarkBtn} onPress={markCurrentAsNvg} activeOpacity={0.8}>
                        <Ionicons name="checkmark-circle" size={16} color={Colors.textInverse} />
                        <Text style={styles.nvgMarkBtnText}>{t('mark_as_nvg')}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              })()
            )}
            <TouchableOpacity style={styles.nvgCloseBtn} onPress={() => setNvgHelperOpen(false)}>
              <Text style={styles.nvgCloseBtnText}>{t('close')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

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
