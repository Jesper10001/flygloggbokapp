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
import { searchFlights, getAllAircraftTypes, updateAircraftType, deleteAircraftType, addAircraftTypeToRegistry } from '../../db/flights';
import type { AircraftRegistryEntry } from '../../db/flights';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { AircraftModal } from '../../components/AircraftModal';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormat, formatTimeValue } from '../../hooks/useTimeFormat';
import { Image as RNImage } from 'react-native';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { getActiveBook, getSpreadsForBook, addBook, isBookFull, type LogbookBook, type SpreadInfo } from '../../db/logbookBooks';
import {
  getAllScanSummaries, deleteScanSummary, updateScanSummaryNames,
  type ScanSummary,
} from '../../db/scanSummaries';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { LOGBOOK_TEMPLATES } from '../../constants/logbookTemplates';

// ─── Types & helpers ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_ABBREV_SV = [
  'jan', 'feb', 'mar', 'apr', 'maj', 'jun',
  'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

type MonthSection = {
  key: string;
  year: number;
  month: number;
  title: string;
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

// ─── Crew type helpers ──────────────────────────────────────────────────────

function SpecBadges({ crewType, engineType }: { crewType: string; engineType: string }) {
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

// ─── FlightRow (new design) ─────────────────────────────────────────────────

function FlightRow({ flight, onPress, isLast }: {
  flight: Flight; onPress: () => void; isLast?: boolean;
}) {
  const { formatTime } = useTimeFormat();
  const f = flight;
  const day = f.date?.split('-')[2] ?? '??';
  const monthIdx = parseInt(f.date?.split('-')[1] ?? '0') - 1;
  const monthAbbr = MONTH_ABBREV_SV[monthIdx] ?? '???';
  const srcIcon: keyof typeof Ionicons.glyphMap =
    f.source === 'ocr' ? 'camera' : f.source === 'import' ? 'cloud-upload-outline' : 'pencil';
  const isFlagged = f.status === 'flagged';
  const needsReview = (f as any).needs_review === 1 || (f as any).needs_review === true;

  return (
    <TouchableOpacity
      style={[styles.flightRow, !isLast && styles.flightRowBorder]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Date chip */}
      <View style={styles.dateChip}>
        <Text style={styles.dateChipDay}>{day}</Text>
        <Text style={styles.dateChipMonth}>{monthAbbr}</Text>
      </View>

      {/* Center */}
      <View style={styles.flightCenter}>
        <View style={styles.flightRouteRow}>
          <Text style={styles.flightRoute}>{f.dep_place}</Text>
          <Ionicons name="arrow-forward" size={11} color={Colors.textMuted} />
          <Text style={styles.flightRoute}>{f.arr_place}</Text>
          {(isFlagged || needsReview) && (
            <Text style={{ fontSize: 13, marginLeft: 2 }}>⚠️</Text>
          )}
        </View>
        <View style={styles.flightMetaRow}>
          <Ionicons name={srcIcon} size={10} color={Colors.textMuted} />
          <Text style={styles.flightMeta}>
            {f.aircraft_type} · {f.registration}
          </Text>
          {f.ifr > 0 && <Text style={styles.badgeIfr}>IFR</Text>}
          {f.night > 0 && <Text style={styles.badgeNight}>{(f.nvg ?? 0) > 0 ? 'NVG' : 'NIGHT'}</Text>}
        </View>
      </View>

      {/* Right */}
      <View style={styles.flightRight}>
        <Text style={styles.flightTime}>{formatTime(f.total_time)}</Text>
        <Text style={styles.flightDepUtc}>{f.dep_utc ?? ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── AirframesView ──────────────────────────────────────────────────────────

function AirframesView() {
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
      t('delete_aircraft_confirm'),
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
          onSave={async (type, speedKts, endH, crewType, category, engineType) => {
            await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType);
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
            <SpecBadges crewType={entry.crew_type} engineType={entry.engine_type} />
          </View>

          <View style={styles.airframeRight}>
            {entry.top_registration ? (
              <View style={styles.topRegBlock}>
                <Text style={styles.topRegText}>{entry.top_registration}</Text>
                {entry.top_registration_hours > 0 && (
                  <Text style={styles.topRegHours}>{entry.top_registration_hours}h</Text>
                )}
              </View>
            ) : null}
            <Text style={styles.totalHours}>{entry.total_hours > 0 ? `${entry.total_hours}h` : '\u2014'}</Text>
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
        onSave={async (type, speedKts, endH, crewType, category, engineType) => {
          await updateAircraftType(type, speedKts, endH, crewType, category, engineType);
          setEditing(null);
          reload();
        }}
      />
      <AircraftModal
        visible={adding}
        onClose={() => setAdding(false)}
        onSave={async (type, speedKts, endH, crewType, category, engineType) => {
          await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType);
          setAdding(false);
          reload();
        }}
      />
    </ScrollView>
  );
}

// ─── Logbook summary accordion data rows ────────────────────────────────────

const getSummaryRows = (t: (k: any) => string) => [
  { label: t('total_flight_time'), field: 'total_time' as const, isTime: true },
  { label: 'PIC',                  field: 'pic'        as const, isTime: true },
  { label: t('co_pilot'),          field: 'co_pilot'   as const, isTime: true },
  { label: 'IFR',                  field: 'ifr'        as const, isTime: true },
  { label: t('night'),             field: 'night'      as const, isTime: true },
  { label: `${t('landings')} ${t('day').toLowerCase()}`,   field: 'landings_day'   as const, isTime: false },
  { label: `${t('landings')} ${t('night').toLowerCase()}`, field: 'landings_night' as const, isTime: false },
];

// ─── TranscribeView ────────────────────────────────────────────────────────

function TranscribeView() {
  const router = useRouter();
  const { t } = useTranslation();
  const { timeFormat } = useTimeFormatStore();
  const { flights: allFlights } = useFlightStore();
  const [book, setBook] = useState<LogbookBook | null>(null);
  const [spreads, setSpreads] = useState<SpreadInfo[]>([]);
  const [summaries, setSummaries] = useState<ScanSummary[]>([]);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());
  const [helpModal, setHelpModal] = useState<'transkribera' | 'summering' | null>(null);
  const [summaryStep, setSummaryStep] = useState<0 | 1>(0);

  // Onboarding wizard state
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2>(0);
  const [spreadPhoto, setSpreadPhoto] = useState<string | null>(null);
  const [bookName, setBookName] = useState('');
  const [lastPage, setLastPage] = useState('');
  const [lastRow, setLastRow] = useState('');
  const [endPage, setEndPage] = useState('');
  const [endRow, setEndRow] = useState('');
  const [saving, setSaving] = useState(false);

  const tpl = LOGBOOK_TEMPLATES[0];

  const load = useCallback(async () => {
    const b = await getActiveBook();
    setBook(b);
    if (b) setSpreads(await getSpreadsForBook(b));
    else setSpreads([]);
    setSummaries(await getAllScanSummaries());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const currentSpread = spreads.find((s) => s.is_current);
  const badge = currentSpread ? currentSpread.flights.length : 0;
  const rowsPerSpread = book?.rows_per_spread ?? 0;
  const ready = book && currentSpread && badge >= rowsPerSpread;

  const toggleBook = (bk: string) =>
    setExpandedBooks(prev => { const n = new Set(prev); n.has(bk) ? n.delete(bk) : n.add(bk); return n; });
  const togglePage = (id: number) =>
    setExpandedPages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const booksList = Array.from(new Set(summaries.map(s => s.book_name || t('summary_unknown_book'))));

  const takeSpreadPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('permission_required'), t('camera_permission'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const uri = result.assets[0].uri;
    const dir = `${FileSystem.documentDirectory}logbook_photos/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const filename = `spread_template_${Date.now()}.jpg`;
    const dest = `${dir}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    setSpreadPhoto(dest);
    setWizardStep(2);
  };

  const pickSpreadPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const uri = result.assets[0].uri;
    const dir = `${FileSystem.documentDirectory}logbook_photos/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const filename = `spread_template_${Date.now()}.jpg`;
    const dest = `${dir}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    setSpreadPhoto(dest);
    setWizardStep(2);
  };

  const finishWizard = async () => {
    const name = bookName.trim() || 'Min loggbok';
    const pageNum = parseInt(lastPage, 10) || 1;
    const startingPage = Math.max(1, pageNum - (pageNum % 2 === 0 ? 1 : 0));
    const ep = parseInt(endPage, 10) || 0;
    const er = parseInt(endRow, 10) || 0;

    setSaving(true);
    try {
      await addBook(name, tpl.id, startingPage, tpl.rows_per_spread, ep > 0 ? ep : undefined, er > 0 ? er : undefined);
      setWizardStep(0);
      setSpreadPhoto(null);
      setBookName('');
      setLastPage('');
      setLastRow('');
      setEndPage('');
      setEndRow('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Transkribera ── */}
      <View>
        <View style={tvStyles.sectionHeader}>
          <Ionicons name="create-outline" size={18} color={Colors.primary} />
          <Text style={tvStyles.sectionTitle}>{t('help_transcribe_title')}</Text>
          {ready && (
            <View style={tvStyles.readyBadge}>
              <Text style={tvStyles.readyBadgeText}>{t('ready')}</Text>
            </View>
          )}
          <TouchableOpacity onPress={() => setHelpModal('transkribera')} hitSlop={10}>
            <Ionicons name="help-circle-outline" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={tvStyles.card}>
          {!book ? (
            <View style={tvStyles.wizardContainer}>
              {wizardStep === 0 && (
                <View style={tvStyles.wizardStep}>
                  <View style={tvStyles.wizardIconCircle}>
                    <Ionicons name="book-outline" size={32} color={Colors.primary} />
                  </View>
                  <Text style={tvStyles.wizardTitle}>{t('wizard_add_logbook')}</Text>
                  <Text style={tvStyles.wizardDesc}>
                    {t('wizard_add_logbook_desc')}
                  </Text>
                  <TouchableOpacity
                    style={tvStyles.wizardPrimaryBtn}
                    onPress={() => {
                      if (allFlights.length === 0) {
                        Alert.alert(
                          t('wizard_no_flights_title'),
                          t('wizard_no_flights_warning'),
                        );
                      } else {
                        Alert.alert(
                          t('wizard_confirm_flights_title'),
                          t('wizard_confirm_flights_body'),
                          [
                            { text: t('no'), style: 'cancel' },
                            { text: t('yes'), onPress: () => setWizardStep(1) },
                          ],
                        );
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
                    <Text style={tvStyles.wizardPrimaryBtnText}>{t('wizard_get_started')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {wizardStep === 1 && (
                <View style={tvStyles.wizardStep}>
                  <Text style={tvStyles.wizardStepLabel}>{t('wizard_step_1_of_2')}</Text>
                  <Text style={tvStyles.wizardTitle}>{t('wizard_photo_title')}</Text>
                  <Text style={tvStyles.wizardDesc}>
                    {t('wizard_photo_desc')}
                  </Text>
                  <View style={tvStyles.wizardPhotoHints}>
                    <View style={tvStyles.wizardHintRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={tvStyles.wizardHintText}>{t('wizard_photo_hint_full')}</Text>
                    </View>
                    <View style={tvStyles.wizardHintRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={tvStyles.wizardHintText}>{t('wizard_photo_hint_headers')}</Text>
                    </View>
                    <View style={tvStyles.wizardHintRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={tvStyles.wizardHintText}>{t('wizard_photo_hint_shadows')}</Text>
                    </View>
                  </View>

                  {spreadPhoto && (
                    <RNImage
                      source={{ uri: spreadPhoto }}
                      style={tvStyles.wizardPreview}
                      resizeMode="cover"
                    />
                  )}

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={tvStyles.wizardSecondaryBtn}
                      onPress={pickSpreadPhoto}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="images-outline" size={16} color={Colors.primary} />
                      <Text style={tvStyles.wizardSecondaryBtnText}>{t('wizard_pick_image')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={tvStyles.wizardPrimaryBtn}
                      onPress={takeSpreadPhoto}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="camera" size={16} color={Colors.textInverse} />
                      <Text style={tvStyles.wizardPrimaryBtnText}>{t('wizard_take_photo')}</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity onPress={() => setWizardStep(2)} activeOpacity={0.7}>
                    <Text style={tvStyles.wizardSkipText}>{t('wizard_skip_photo')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setWizardStep(0)} activeOpacity={0.7}>
                    <Text style={[tvStyles.wizardSkipText, { marginTop: 2 }]}>{t('wizard_back')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {wizardStep === 2 && (
                <View style={tvStyles.wizardStep}>
                  <Text style={tvStyles.wizardStepLabel}>{t('wizard_step_2_of_2')}</Text>
                  <Text style={tvStyles.wizardTitle}>{t('wizard_position_title')}</Text>
                  <Text style={tvStyles.wizardDesc}>
                    {t('wizard_position_desc')}
                  </Text>

                  <View style={tvStyles.wizardFields}>
                    <View style={tvStyles.wizardFieldGroup}>
                      <Text style={tvStyles.wizardFieldLabel}>{t('wizard_book_name')}</Text>
                      <TextInput
                        style={tvStyles.wizardInput}
                        value={bookName}
                        onChangeText={setBookName}
                        placeholder={t('wizard_book_name_placeholder')}
                        placeholderTextColor={Colors.textMuted}
                        autoCapitalize="words"
                      />
                    </View>

                    <Text style={tvStyles.wizardSubheading}>{t('wizard_current_position')}</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={[tvStyles.wizardFieldGroup, { flex: 1 }]}>
                        <Text style={tvStyles.wizardFieldLabel}>{t('wizard_page_number')}</Text>
                        <TextInput
                          style={tvStyles.wizardInput}
                          value={lastPage}
                          onChangeText={(v) => setLastPage(v.replace(/\D/g, ''))}
                          placeholder={t('wizard_page_placeholder')}
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={tvStyles.wizardFieldHint}>{t('wizard_page_hint')}</Text>
                      </View>
                      <View style={[tvStyles.wizardFieldGroup, { flex: 1 }]}>
                        <Text style={tvStyles.wizardFieldLabel}>{t('wizard_row')}</Text>
                        <TextInput
                          style={tvStyles.wizardInput}
                          value={lastRow}
                          onChangeText={(v) => setLastRow(v.replace(/\D/g, ''))}
                          placeholder={t('wizard_row_placeholder')}
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={tvStyles.wizardFieldHint}>{t('wizard_row_hint')}</Text>
                      </View>
                    </View>

                    <View style={tvStyles.wizardDivider} />

                    <Text style={tvStyles.wizardSubheading}>{t('wizard_last_page_title')}</Text>
                    <Text style={tvStyles.wizardDesc}>
                      {t('wizard_last_page_desc')}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={[tvStyles.wizardFieldGroup, { flex: 1 }]}>
                        <Text style={tvStyles.wizardFieldLabel}>{t('wizard_end_page')}</Text>
                        <TextInput
                          style={tvStyles.wizardInput}
                          value={endPage}
                          onChangeText={(v) => setEndPage(v.replace(/\D/g, ''))}
                          placeholder={t('wizard_end_page_placeholder')}
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="number-pad"
                        />
                      </View>
                      <View style={[tvStyles.wizardFieldGroup, { flex: 1 }]}>
                        <Text style={tvStyles.wizardFieldLabel}>{t('wizard_end_row')}</Text>
                        <TextInput
                          style={tvStyles.wizardInput}
                          value={endRow}
                          onChangeText={(v) => setEndRow(v.replace(/\D/g, ''))}
                          placeholder={t('wizard_end_page_placeholder')}
                          placeholderTextColor={Colors.textMuted}
                          keyboardType="number-pad"
                        />
                        <Text style={tvStyles.wizardFieldHint}>{t('wizard_end_row_hint').replace('{n}', String(tpl.rows_per_spread))}</Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[tvStyles.wizardPrimaryBtn, saving && { opacity: 0.5 }]}
                    onPress={finishWizard}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={Colors.textInverse} />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={16} color={Colors.textInverse} />
                        <Text style={tvStyles.wizardPrimaryBtnText}>{t('wizard_create_book')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setWizardStep(1)} activeOpacity={0.7}>
                    <Text style={tvStyles.wizardSkipText}>{t('wizard_back')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            <>
              <View style={tvStyles.bookHeader}>
                <Text style={tvStyles.bookName}>{book.name}</Text>
                <Text style={tvStyles.bookMeta}>
                  {spreads.length} {t('spreads_available')}
                </Text>
              </View>
              {spreads.map((s) => (
                <TouchableOpacity
                  key={s.spread_number}
                  style={[
                    tvStyles.spreadRow,
                    s.is_current && { backgroundColor: Colors.primary + '0E' },
                  ]}
                  onPress={() => router.push(`/transcribe?spread=${s.spread_number}` as any)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={s.is_current ? 'create-outline' : 'checkmark-circle'}
                    size={18}
                    color={s.is_current ? Colors.primary : Colors.success}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={tvStyles.spreadTitle}>
                      {t('page')} {s.page_left}–{s.page_right}
                    </Text>
                    <Text style={tvStyles.spreadMeta}>
                      {s.is_current ? t('transcribe_current') : t('transcribe_past')}
                      {' · '}{s.flights.length}/{book.rows_per_spread} {t('flights').toLowerCase()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
              {isBookFull(book) && (
                <View style={tvStyles.bookFullBanner}>
                  <Ionicons name="checkmark-done-circle" size={20} color={Colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={tvStyles.bookFullTitle}>{t('book_full_title')}</Text>
                    <Text style={tvStyles.bookFullDesc}>
                      {t('book_full_desc').replace('{name}', book.name)}
                    </Text>
                  </View>
                </View>
              )}
              <TouchableOpacity
                style={tvStyles.manageLink}
                onPress={() => router.push('/settings/logbook-books')}
                activeOpacity={0.7}
              >
                <Text style={{ color: Colors.textMuted, fontSize: 12 }}>{t('manage_books')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* ── Summering ── */}
      <View>
        <View style={tvStyles.sectionHeader}>
          <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
          <Text style={tvStyles.sectionTitle}>{t('summary_section_title')}</Text>
          {summaries.length > 0 && (
            <Text style={tvStyles.countBadge}>{t('summary_pages_count').replace('{n}', String(summaries.length))}</Text>
          )}
          <TouchableOpacity onPress={() => setHelpModal('summering')} hitSlop={10}>
            <Ionicons name="help-circle-outline" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={tvStyles.card}>
          {summaries.length === 0 ? (
            <View style={tvStyles.wizardContainer}>
              {summaryStep === 0 && (
                <View style={tvStyles.wizardStep}>
                  <View style={tvStyles.wizardIconCircle}>
                    <Ionicons name="calculator-outline" size={32} color={Colors.primary} />
                  </View>
                  <Text style={tvStyles.wizardTitle}>{t('summary_wizard_title')}</Text>
                  <Text style={tvStyles.wizardDesc}>
                    {t('summary_wizard_desc')}
                  </Text>
                  <TouchableOpacity
                    style={tvStyles.wizardPrimaryBtn}
                    onPress={() => setSummaryStep(1)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
                    <Text style={tvStyles.wizardPrimaryBtnText}>{t('wizard_get_started')}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {summaryStep === 1 && (
                <View style={tvStyles.wizardStep}>
                  <Text style={tvStyles.wizardTitle}>{t('summary_wizard_title')}</Text>
                  <View style={tvStyles.wizardPhotoHints}>
                    <View style={tvStyles.wizardHintRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={tvStyles.wizardHintText}>{t('summary_hint_photo')}</Text>
                    </View>
                    <View style={tvStyles.wizardHintRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={tvStyles.wizardHintText}>{t('summary_hint_ai')}</Text>
                    </View>
                    <View style={tvStyles.wizardHintRow}>
                      <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                      <Text style={tvStyles.wizardHintText}>{t('summary_hint_saved')}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                    <TouchableOpacity
                      style={tvStyles.wizardSecondaryBtn}
                      onPress={() => router.push('/(tabs)/scan?summarize=library' as any)}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="images-outline" size={16} color={Colors.primary} />
                      <Text style={tvStyles.wizardSecondaryBtnText}>{t('summary_pick_image')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={tvStyles.wizardPrimaryBtn}
                      onPress={() => router.push('/(tabs)/scan?summarize=camera' as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="camera" size={16} color={Colors.textInverse} />
                      <Text style={tvStyles.wizardPrimaryBtnText}>{t('summary_take_photo')}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setSummaryStep(0)} activeOpacity={0.7}>
                    <Text style={tvStyles.wizardSkipText}>{t('wizard_back')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            <>
              {booksList.map(bk => {
            const pages = summaries.filter(s => (s.book_name || t('summary_unknown_book')) === bk);
            const bookOpen = expandedBooks.has(bk);
            return (
              <View key={bk}>
                <TouchableOpacity
                  style={tvStyles.bookGroupHeader}
                  onPress={() => toggleBook(bk)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={bookOpen ? 'chevron-down' : 'chevron-forward'}
                    size={14} color={Colors.textMuted} style={{ marginRight: 6 }}
                  />
                  <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>{bk}</Text>
                  <Text style={{ color: Colors.textMuted, fontSize: 12 }}>{t('summary_pages_label').replace('{n}', String(pages.length))}</Text>
                </TouchableOpacity>

                {bookOpen && pages.map(page => {
                  const pageOpen = expandedPages.has(page.id);
                  const td = page.total_to_date;
                  return (
                    <View key={page.id}>
                      <TouchableOpacity
                        style={tvStyles.pageRow}
                        onPress={() => togglePage(page.id)}
                        activeOpacity={0.75}
                      >
                        <Ionicons
                          name={pageOpen ? 'chevron-down' : 'chevron-forward'}
                          size={13} color={Colors.textMuted} style={{ marginRight: 6 }}
                        />
                        <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                          {page.page_name || t('summary_unknown_page')}
                        </Text>
                        <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{page.created_at.slice(0, 10)}</Text>
                        <TouchableOpacity
                          hitSlop={8}
                          style={{ marginLeft: 10 }}
                          onPress={() => Alert.alert(t('summary_delete_title'), t('summary_delete_body').replace('{name}', page.page_name || ''), [
                            { text: t('cancel'), style: 'cancel' },
                            { text: t('delete'), style: 'destructive', onPress: async () => {
                              await deleteScanSummary(page.id);
                              load();
                            }},
                          ])}
                        >
                          <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                        </TouchableOpacity>
                      </TouchableOpacity>

                      {pageOpen && (
                        <View style={tvStyles.pageDetails}>
                          {getSummaryRows(t).filter(r => (td as any)[r.field]).map(r => (
                            <View key={r.field} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: Colors.textMuted, fontSize: 13 }}>{r.label}</Text>
                              <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo', fontVariant: ['tabular-nums'] }}>
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
            </>
          )}
        </View>
      </View>

      {/* ── Hjälp-modal ── */}
      <Modal visible={helpModal !== null} transparent animationType="fade" onRequestClose={() => setHelpModal(null)}>
        <Pressable style={tvStyles.helpModalBackdrop} onPress={() => setHelpModal(null)}>
          <Pressable style={tvStyles.helpModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={tvStyles.helpModalHeader}>
              <Ionicons
                name={helpModal === 'transkribera' ? 'create-outline' : 'calculator-outline'}
                size={20} color={Colors.primary}
              />
              <Text style={tvStyles.helpModalTitle}>
                {helpModal === 'transkribera' ? t('help_transcribe_title') : t('help_summary_title')}
              </Text>
              <TouchableOpacity onPress={() => setHelpModal(null)} hitSlop={10} style={{ marginLeft: 'auto' }}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {helpModal === 'transkribera' ? (
              <View style={tvStyles.helpModalBody}>
                <View style={tvStyles.helpModalStep}>
                  <Text style={tvStyles.helpNum}>1</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_transcribe_step1')}
                  </Text>
                </View>
                <View style={tvStyles.helpModalStep}>
                  <Text style={tvStyles.helpNum}>2</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_transcribe_step2')}
                  </Text>
                </View>
                <View style={tvStyles.helpModalStep}>
                  <Text style={tvStyles.helpNum}>3</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_transcribe_step3')}
                  </Text>
                </View>
                <View style={[tvStyles.helpModalStep, { borderBottomWidth: 0 }]}>
                  <Text style={tvStyles.helpNum}>4</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_transcribe_step4')}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={tvStyles.helpModalBody}>
                <View style={tvStyles.helpModalStep}>
                  <Text style={tvStyles.helpNum}>1</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_summary_step1')}
                  </Text>
                </View>
                <View style={tvStyles.helpModalStep}>
                  <Text style={tvStyles.helpNum}>2</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_summary_step2')}
                  </Text>
                </View>
                <View style={tvStyles.helpModalStep}>
                  <Text style={tvStyles.helpNum}>3</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_summary_step3')}
                  </Text>
                </View>
                <View style={[tvStyles.helpModalStep, { borderBottomWidth: 0 }]}>
                  <Text style={tvStyles.helpNum}>4</Text>
                  <Text style={tvStyles.helpModalText}>
                    {t('help_summary_step4')}
                  </Text>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const tvStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
    flex: 1,
  },
  readyBadge: {
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  readyBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  countBadge: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  emptyAction: {
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyActionTitle: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  emptyActionHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  bookHeader: {
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.separator,
  },
  bookName: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  bookMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  spreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.separator,
  },
  spreadTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  spreadMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  manageLink: {
    padding: 12,
    alignItems: 'center',
  },
  bookGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingLeft: 14,
    borderTopWidth: 0.5,
    borderTopColor: Colors.separator,
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingLeft: 28,
    borderTopWidth: 0.5,
    borderTopColor: Colors.separator,
  },
  pageDetails: {
    paddingHorizontal: 16,
    paddingLeft: 56,
    paddingVertical: 10,
    backgroundColor: Colors.card,
    gap: 8,
    borderTopWidth: 0.5,
    borderTopColor: Colors.separator,
  },
  // Wizard
  wizardContainer: {
    padding: 0,
  },
  wizardStep: {
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  wizardStepLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  wizardIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  wizardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  wizardDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  wizardPhotoHints: {
    alignSelf: 'stretch',
    backgroundColor: Colors.elevated,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 4,
  },
  wizardHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wizardHintText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  wizardPreview: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: Colors.elevated,
    marginTop: 4,
  },
  wizardPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignSelf: 'stretch',
    marginTop: 4,
  },
  wizardPrimaryBtnText: {
    color: Colors.textInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  wizardSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.elevated,
    borderRadius: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  wizardSecondaryBtnText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  wizardSkipText: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 6,
  },
  wizardWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.gold + '14',
    borderRadius: 10,
    padding: 14,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: Colors.gold + '33',
  },
  wizardWarningText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  wizardInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.primary + '0E',
    borderRadius: 10,
    padding: 14,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: Colors.primary + '22',
  },
  wizardInfoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  wizardSubheading: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  wizardDivider: {
    height: 1,
    backgroundColor: Colors.separator,
    alignSelf: 'stretch',
    marginVertical: 4,
  },
  bookFullBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: Colors.success + '0E',
    borderTopWidth: 0.5,
    borderTopColor: Colors.separator,
  },
  bookFullTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  bookFullDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  wizardFields: {
    alignSelf: 'stretch',
    gap: 12,
    marginTop: 4,
  },
  wizardFieldGroup: {
    gap: 4,
  },
  wizardFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  wizardInput: {
    backgroundColor: Colors.elevated,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  wizardFieldHint: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  helpNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary + '1A',
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 22,
    overflow: 'hidden',
  },
  helpModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  helpModalSheet: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    width: '100%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  helpModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.separator,
  },
  helpModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  helpModalBody: {
    padding: 16,
    gap: 0,
  },
  helpModalStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.separator,
  },
  helpModalText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});

// ─── Main screen ────────────────────────────────────────────────────────────

export default function LogScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const mode = useAppModeStore((s) => s.mode);
  const { flights, isLoading, loadFlights, loadStats } = useFlightStore();
  const [tab, setTab] = useState<'loggbok' | 'transkribering' | 'farkoster'>('loggbok');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Flight[]>([]);
  const [tree, setTree] = useState<YearGroup[]>([]);

  // Expanded state
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [openMonthKey, setOpenMonthKey] = useState<string>('');

  useFocusEffect(useCallback(() => {
    loadFlights();
  }, []));

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
      {/* ── Tab header ── */}
      <View style={styles.tabRow}>
        <TouchableOpacity onPress={() => setTab('loggbok')} activeOpacity={0.7}>
          <Text style={[styles.tabTextPrimary, tab === 'loggbok' && styles.tabTextPrimaryActive]}>{t('tab_logbook_label')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('farkoster')} activeOpacity={0.7}>
          <Text style={[styles.tabTextSecondary, tab === 'farkoster' && styles.tabTextSecondaryActive]}>{t('tab_airframes')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('transkribering')} activeOpacity={0.7}>
          <Text style={[styles.tabTextSecondary, tab === 'transkribering' && styles.tabTextSecondaryActive]}>{t('tab_transcription')}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'farkoster' ? <AirframesView /> : tab === 'transkribering' ? <TranscribeView /> : (
        <>
          {/* ── Search field ── */}
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
            /* Search results */
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
                    flight={item}
                    isLast={index === searchResults.length - 1}
                    onPress={() => router.push(`/flight/${item.id}`)}
                  />
                )}
                contentContainerStyle={styles.listContent}
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
            /* Main accordion view */
            <ScrollView
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
            >
              {/* ── Year groups ── */}
              {tree.map((yg) => {
                const yearOpen = expandedYears.has(yg.year);
                const flightCount = yg.months.reduce((s, m) => s + m.count, 0);
                return (
                  <View key={yg.year}>
                    {/* Year header */}
                    <TouchableOpacity style={styles.yearHeader} onPress={() => toggleYear(yg.year)} activeOpacity={0.7}>
                      <View style={styles.yearHeaderLeft}>
                        <Ionicons
                          name={yearOpen ? 'chevron-down' : 'chevron-forward'}
                          size={14} color={Colors.textMuted} style={{ marginRight: 6 }}
                        />
                        <Text style={styles.yearTitle}>{yg.year}</Text>
                      </View>
                      <View style={styles.yearHeaderRight}>
                        <Text style={styles.yearHours}>{formatTime(yg.totalHours)}h</Text>
                        <Text style={styles.yearCount}>{flightCount} {t('flights').toLowerCase()}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Months inside expanded year */}
                    {yearOpen && yg.months.map((sec) => {
                      const monthOpen = openMonthKey === sec.key;
                      return (
                        <View key={sec.key}>
                          {/* Month header */}
                          <TouchableOpacity
                            style={styles.monthHeader}
                            onPress={() => toggleMonth(sec.key)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.monthTitle}>
                              {sec.title.charAt(0).toUpperCase() + sec.title.slice(1)}
                            </Text>
                            <Text style={styles.monthMeta}>
                              {formatTime(sec.totalHours)}h · {sec.count} {t('flights').toLowerCase()}
                            </Text>
                          </TouchableOpacity>

                          {/* Flight card */}
                          {monthOpen && (
                            <View style={styles.monthCard}>
                              {sec.flights.map((flight, idx) => (
                                <FlightRow
                                  key={flight.id}
                                  flight={flight}
                                  isLast={idx === sec.flights.length - 1}
                                  onPress={() => router.push(`/flight/${flight.id}`)}
                                />
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      )}

      {/* FAB */}
      {tab === 'loggbok' && (
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

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Tab header
  tabRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabTextPrimary: {
    fontSize: 26,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: -0.5,
  },
  tabTextPrimaryActive: {
    color: Colors.gold,
    fontWeight: '800',
  },
  tabTextSecondary: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  tabTextSecondaryActive: {
    color: Colors.gold,
    fontWeight: '700',
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 0.5,
    borderColor: Colors.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 15,
    paddingVertical: 10,
  },

  // Year header
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: Colors.background,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
  },
  yearHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  yearTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  yearHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  yearHours: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    fontFamily: 'Menlo',
    fontVariant: ['tabular-nums'],
  },
  yearCount: {
    fontSize: 12,
    color: Colors.textMuted,
  },

  // Month header
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingLeft: 36,
    paddingVertical: 10,
    backgroundColor: Colors.elevated,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.separator,
  },
  monthTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  monthMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },

  // Month card (wraps all FlightRows)
  monthCard: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },

  // FlightRow
  flightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  flightRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.separator,
  },
  dateChip: {
    width: 44,
    alignItems: 'center',
    flexShrink: 0,
  },
  dateChipDay: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
  },
  dateChipMonth: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  flightCenter: {
    flex: 1,
    minWidth: 0,
  },
  flightRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  flightRoute: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  flightMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  flightMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  badgeIfr: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.info,
  },
  badgeNight: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.gold,
  },
  flightRight: {
    alignItems: 'flex-end',
  },
  flightTime: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontFamily: 'Menlo',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  flightDepUtc: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },

  // Empty states
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },

  listContent: { paddingBottom: 96 },

  // FAB
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

  // Airframes
  airframesList: { padding: 12, paddingBottom: 40, gap: 8 },
  addAircraftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
  },
  addAircraftBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  airframeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  airframeLeft: { flex: 1, gap: 4 },
  airframeTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  airframeMeta: { flexDirection: 'row', gap: 8 },
  airframeMetaText: { color: Colors.textSecondary, fontSize: 12 },
  airframeRight: { alignItems: 'flex-end', gap: 4 },
  totalHours: { color: Colors.primary, fontSize: 20, fontWeight: '800' },
  topRegBlock: { alignItems: 'flex-end' },
  topRegText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  topRegHours: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },
  airframeActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  airframeType: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'Menlo',
  },

  // Badges
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: Colors.elevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: { color: Colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  badgeHeli: { backgroundColor: Colors.gold + '22', borderColor: Colors.gold + '66' },
  badgeHeliText: { color: Colors.gold },

  specRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  specDotGreen: { width: 7, height: 7, borderRadius: 2, backgroundColor: Colors.success },
  specDotRed: { width: 7, height: 7, borderRadius: 2, backgroundColor: Colors.danger },

  crewBadge: {
    backgroundColor: Colors.primary + '22',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 0.5,
    borderColor: Colors.primary + '66',
  },
  crewBadgeText: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
});
