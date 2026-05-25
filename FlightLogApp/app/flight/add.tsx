import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
  TextInput, Modal, Pressable, Image, useWindowDimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { callAnthropicJson } from '../../services/anthropicClient';
import { useScanQuotaStore } from '../../store/scanQuotaStore';
import { PremiumModal } from '../../components/PremiumModal';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { FormField } from '../../components/FormField';
import { IcaoInput } from '../../components/IcaoInput';
import type { IcaoInputHandle } from '../../components/IcaoInput';
import { SmartTimeInput } from '../../components/SmartTimeInput';
import type { SmartTimeInputHandle } from '../../components/SmartTimeInput';
import { insertFlight, updateFlight, getFlightById, getRecentAircraftTypes, getRecentRegistrations, getRecentPlaces, getRecentRemarks, getRecentSecondPilots, getFlights, addToAircraftRegistry, addAircraftTypeToRegistry, getAircraftEndurance, getAircraftCrewType, flagFlightsByRegistration, flagFlightsBySecondPilot, deleteRegistrationFromRegistry } from '../../db/flights';
import { AircraftModal } from '../../components/AircraftModal';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { validateFlightForm } from '../../utils/validation';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { decimalToHHMM, hhmmToDecimal } from '../../hooks/useTimeFormat';
import type { Flight, FlightFormData, ValidationIssue } from '../../types/flight';
import runwayData from '../../assets/runways.json';

const today = new Date().toISOString().split('T')[0];

const EMPTY: FlightFormData = {
  date: today,
  aircraft_type: '',
  registration: '',
  dep_place: '',
  dep_utc: '',
  arr_place: '',
  arr_utc: '',
  total_time: '',
  ifr: '0',
  night: '0',
  pic: '',
  co_pilot: '0',
  dual: '0',
  landings_day: '1',
  landings_night: '0',
  remarks: '',
  flight_type: 'normal',
  stop_place: '',
  flight_rules: 'VFR',
  second_pilot: '',
  nvg: '0',
  tng_count: '0',
  multi_pilot: '0',
  single_pilot: '0',
  instructor: '0',
  picus: '0',
  spic: '0',
  examiner: '0',
  safety_pilot: '0',
  observer: '0',
  ferry_pic: '0',
  relief_crew: '0',
  sim_category: '',
  vfr: '0',
  max_fl: '',
  media_type: 'image',
};

// ── Styles ──────────────────────────────────────────────────────────────────

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    customHeader: {
      paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 30 : 8, paddingBottom: 10,
      backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
      justifyContent: 'flex-end', alignItems: 'center', position: 'relative',
    },
    headerClose: {
      position: 'absolute', left: 16, bottom: 10,
    },
    headerDate: {
      fontSize: 22, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.6,
      textTransform: 'capitalize', fontFamily: 'Georgia',
    },
    content: { padding: 16, paddingBottom: 40, gap: 8 },

    freeNotice: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.card, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1, borderColor: Colors.gold + '44',
    },
    freeNoticeText: { color: Colors.textSecondary, fontSize: 12 },

    warningBox: {
      flexDirection: 'row', gap: 8,
      backgroundColor: Colors.warning + '18',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.warning + '55',
    },
    warningText: { color: Colors.warning, fontSize: 12, lineHeight: 18 },

    lastFlightBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.primary + '14',
      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 1, borderColor: Colors.primary + '33',
    },
    lastFlightText: { flex: 1, color: Colors.textSecondary, fontSize: 13 },
    lastFlightBold: { color: Colors.textPrimary, fontWeight: '700' },

    section: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1,
      marginTop: 10, marginBottom: 2,
    },

    yesterdayBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      marginTop: 5, paddingHorizontal: 2,
    },
    yesterdayText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },

    chipsRow: { marginTop: 4, marginBottom: 2 },
    chip: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.elevated, borderRadius: 20,
      paddingHorizontal: 12, paddingVertical: 5,
      marginRight: 6, borderWidth: 1, borderColor: Colors.border,
    },
    chipRecent: {
      backgroundColor: Colors.gold + '22',
      borderColor: Colors.gold + '88',
    },
    chipAdd: {
      borderColor: Colors.primary + '66',
      backgroundColor: Colors.primary + '14',
      paddingHorizontal: 10,
    },
    chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
    chipRecentText: { color: Colors.gold, fontWeight: '700' },

    row2: { flexDirection: 'row', gap: 10 },
    row3: { flexDirection: 'row', gap: 10 },

    card: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 14,
      borderWidth: 0.5, borderColor: Colors.border, gap: 6,
    },
    cardFieldLabel: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1, marginTop: 2, marginBottom: 4,
    },

    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    autoBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: Colors.primary + '20',
      borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
      borderWidth: 0.5, borderColor: Colors.primary + '55',
    },
    autoBadgeText: { color: Colors.primary, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },

    totalTimeRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    totalTimeDisplay: {
      flexDirection: 'row', alignItems: 'baseline', gap: 8,
      paddingVertical: 8,
    },
    totalTimeValue: {
      fontSize: 52, fontWeight: '900', fontFamily: 'Menlo',
      fontVariant: ['tabular-nums'],
    },
    totalTimeValueFilled: { color: Colors.gold },
    totalTimeValueEmpty: { color: Colors.textMuted },
    errorInline: { color: Colors.danger, fontSize: 11, marginTop: 2 },

    placeBlock: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    placeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    placeLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

    locSegment: {
      flexDirection: 'row',
      backgroundColor: Colors.elevated,
      borderRadius: 6, padding: 2,
      borderWidth: 0.5, borderColor: Colors.border,
    },
    locSegmentBtn: {
      flex: 1,
      paddingHorizontal: 6, paddingVertical: 5,
      borderRadius: 5, alignItems: 'center',
    },
    locSegmentBtnActive: { backgroundColor: Colors.primary },
    locSegmentText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
    locSegmentTextActive: { color: Colors.textInverse },

    stopPlaceBlock: {
      backgroundColor: Colors.elevated,
      borderRadius: 10,
      padding: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: Colors.primary + '44',
    },
    stopPlaceLabel: {
      color: Colors.primary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },

    flightTypePicker: {
      flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 4,
    },
    flightTypeChip: {
      flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    flightTypeChipActive: {
      backgroundColor: Colors.primary, borderColor: Colors.primary,
    },
    flightTypeChipText: {
      color: Colors.textMuted, fontSize: 11, fontWeight: '700',
    },
    flightTypeChipTextActive: {
      color: '#fff',
    },

    segmentRow: {
      flexDirection: 'row', backgroundColor: Colors.elevated,
      borderRadius: 8, padding: 3,
      borderWidth: 1, borderColor: Colors.border,
    },
    segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6 },
    segmentBtnActive: { backgroundColor: Colors.primary },
    segmentText: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
    segmentTextActive: { color: Colors.textInverse },

    counterGrid: { flexDirection: 'row', alignItems: 'center' },
    counterDivider: { width: 1, height: 50, backgroundColor: Colors.separator, marginHorizontal: 8 },
    counterWrap: { flex: 1, alignItems: 'center', gap: 8 },
    counterLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
    counterRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    counterBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: Colors.elevated,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: Colors.border,
    },
    counterBtnDisabled: { opacity: 0.4 },
    counterValue: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', minWidth: 30, textAlign: 'center' },

    extrasToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: 6, paddingHorizontal: 2,
    },
    extrasToggleText: { color: Colors.textMuted, fontSize: 13 },

    tngToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    tngToggleText: { color: Colors.textMuted, fontSize: 13, fontWeight: '500' },

    nvgInput: {
      backgroundColor: Colors.elevated, borderRadius: 8, padding: 10,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14, textAlign: 'center',
    },
    sliderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    sliderInput: {
      flex: 1,
    },
    sliderTrack: {
      width: 200,
      flexShrink: 0,
      position: 'relative',
    },
    sliderDots: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      marginTop: -4,
    },
    sliderDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: Colors.border,
    },
    sliderDotActive: {
      backgroundColor: Colors.primary,
    },

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
    datePickerSheet: {
      backgroundColor: Colors.card,
      paddingBottom: 24, paddingTop: 8,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    datePickerDone: {
      alignSelf: 'flex-end',
      paddingHorizontal: 20, paddingVertical: 10,
    },
    datePickerDoneText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },

    regRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
    },
    regDropdownBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: Colors.elevated, borderRadius: 20,
      paddingHorizontal: 10, paddingVertical: 5,
      borderWidth: 1, borderColor: Colors.border,
    },
    regDropdownText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
    regDropdownDisabled: { opacity: 0.4 },

    modalBackdrop: {
      flex: 1, backgroundColor: '#000A',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: Colors.card,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      paddingTop: 8, paddingBottom: 24,
      maxHeight: '70%',
    },
    modalHandle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: Colors.border,
      alignSelf: 'center', marginBottom: 8,
    },
    modalTitle: {
      color: Colors.textPrimary, fontSize: 15, fontWeight: '700',
      paddingHorizontal: 20, paddingVertical: 8,
    },
    modalItem: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 20, paddingVertical: 14,
      borderTopWidth: 0.5, borderTopColor: Colors.separator,
    },
    modalItemText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
    modalItemSub: { color: Colors.textMuted, fontSize: 11 },
    modalEmpty: {
      color: Colors.textMuted, fontSize: 13, textAlign: 'center',
      paddingVertical: 24, paddingHorizontal: 20,
    },
    modalAddItem: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 20, paddingVertical: 14,
      borderTopWidth: 0.5, borderTopColor: Colors.separator,
    },
    modalAddText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },

    roleGrid: {
      gap: 4,
    },
    roleRow: {
      flexDirection: 'row', gap: 4,
    },
    roleBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 7,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    roleBtnActive: {
      backgroundColor: Colors.primary, borderColor: Colors.primary,
    },
    roleBtnDisabled: { opacity: 0.35 },
    roleBtnText: {
      color: Colors.textMuted, fontSize: 12, fontWeight: '700',
    },
    roleBtnTextActive: { color: Colors.textInverse },
    specialRoleBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: Colors.elevated, borderRadius: 7,
      paddingHorizontal: 8, paddingVertical: 6,
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    specialRoleBtnText: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      flex: 1, textAlign: 'center',
    },
    specialRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 20, paddingVertical: 14,
      borderTopWidth: 0.5, borderTopColor: Colors.separator,
    },
    specialRowActive: { backgroundColor: Colors.primary + '14' },
    specialLabel: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1 },
    specialHint: { color: Colors.textMuted, fontSize: 11 },
    specialDisabled: { opacity: 0.4 },

    simCatRow: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6,
    },
    simCatBtn: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    simCatBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    simCatText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
    simCatTextActive: { color: Colors.textInverse },

    pilotModeRow: {
      flexDirection: 'row',
      flex: 1,
      backgroundColor: Colors.elevated,
      borderRadius: 7, padding: 2,
      borderWidth: 0.5, borderColor: Colors.border,
    },
    pilotModeBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 5,
    },
    pilotModeBtnActive: { backgroundColor: Colors.primary },
    pilotModeBtnDisabled: { opacity: 0.35 },
    pilotModeText: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },
    pilotModeTextActive: { color: Colors.textInverse },

    remarksWarning: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.warning + '18',
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
      borderWidth: 1, borderColor: Colors.warning + '55',
      marginTop: 4,
    },
    remarksWarningText: { color: Colors.warning, fontSize: 12, flex: 1, lineHeight: 16 },

    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 12,
      paddingVertical: 15, marginTop: 12, gap: 8,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },
  });
}

// ── Hjälpkomponenter ────────────────────────────────────────────────────────

function ValidationWarnings({ issues }: { issues: ValidationIssue[] }) {
  const styles = makeStyles();
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!warnings.length) return null;
  return (
    <View style={styles.warningBox}>
      <Ionicons name="warning" size={16} color={Colors.warning} />
      <View style={{ flex: 1 }}>
        {warnings.map((w, i) => (
          <Text key={i} style={styles.warningText}>{w.message}</Text>
        ))}
      </View>
    </View>
  );
}

function Counter({ label, value, onChange, min = 0 }: {
  label: string; value: string; onChange: (v: string) => void; min?: number;
}) {
  const styles = makeStyles();
  const n = parseInt(value) || 0;
  return (
    <View style={styles.counterWrap}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterRow}>
        <TouchableOpacity
          style={[styles.counterBtn, n <= min && styles.counterBtnDisabled]}
          onPress={() => { Haptics.selectionAsync(); onChange(String(Math.max(min, n - 1))); }}
          disabled={n <= min}
        >
          <Ionicons name="remove" size={18} color={n <= min ? Colors.textMuted : Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.counterValue}>{n}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => { Haptics.selectionAsync(); onChange(String(n + 1)); }}>
          <Ionicons name="add" size={18} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SegmentControl({ options, value, onChange }: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const styles = makeStyles();
  return (
    <View style={styles.segmentRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.segmentBtn, value === opt.value && styles.segmentBtnActive]}
          onPress={() => onChange(opt.value)}
          activeOpacity={0.7}
        >
          <Text style={[styles.segmentText, value === opt.value && styles.segmentTextActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Huvudskärm ──────────────────────────────────────────────────────────────

export default function AddFlightScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { editId, aiImport, addPhoto } = useLocalSearchParams<{ editId?: string; aiImport?: string; addPhoto?: string }>();
  const isEdit = !!editId;
  const { canAddFlight, loadFlights, loadStats, flightCount, isPremium } = useFlightStore();
  const _theme = useThemeStore(s => s.theme);
  const { formatTime, parseTime, keyboardType, placeholder } = useTimeFormat();

  const [form, setForm] = useState<FlightFormData>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FlightFormData, string>>>({});
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);

  type PrimaryRole = 'pic' | 'co_pilot' | 'dual' | 'picus' | 'spic' | 'ferry_pic' | 'observer' | 'relief_crew';
  const [role, setRole] = useState<PrimaryRole>('pic');
  const [fi, setFi] = useState(false);
  const [examinerOverlay, setExaminerOverlay] = useState(false);
  const [safetyPilotOverlay, setSafetyPilotOverlay] = useState(false);
  const [showSpecialRole, setShowSpecialRole] = useState(false);
  const [depCustom, setDepCustom] = useState(false);
  const [arrCustom, setArrCustom] = useState(false);
  const [activePlace, setActivePlace] = useState<'dep' | 'arr'>('dep');
  const [showRegModal, setShowRegModal] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [lastFlight, setLastFlight] = useState<Flight | null>(null);
  const [recentTypes, setRecentTypes] = useState<string[]>([]);
  const [recentRegs, setRecentRegs] = useState<string[]>([]);
  const [recentPlaces, setRecentPlaces] = useState<{ icao: string; temporary: boolean }[]>([]);
  const [recentRemarks, setRecentRemarks] = useState<string[]>([]);
  const [recentPilots, setRecentPilots] = useState<string[]>([]);
  const [showPilotModal, setShowPilotModal] = useState(false);
  const [lastTemplate, setLastTemplate] = useState<string>('');
  const [rawTime, setRawTime] = useState<Partial<Record<'ifr' | 'vfr' | 'night' | 'nvg', string>>>({});
  const [pilotMode, setPilotMode] = useState<'single' | 'multi'>('single');
  const [milOps, setMilOps] = useState<Set<string>>(new Set());
  type CrewMember = { id: string; role: string; name: string };
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([{ id: '1', role: '', name: '' }]);
  const [activeCrewPicker, setActiveCrewPicker] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<'2d' | '3d' | null>(null);
  const [selectedRunway, setSelectedRunway] = useState<number | null>(null);
  const [selectedAppStop, setSelectedAppStop] = useState<'2d' | '3d' | null>(null);
  const [selectedRunwayStop, setSelectedRunwayStop] = useState<number | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [reviewPromptCount, setReviewPromptCount] = useState(0);
  const [showPremiumGate, setShowPremiumGate] = useState(false);
  const [editingTotalTime, setEditingTotalTime] = useState(false);
  const [totalTimeEditValue, setTotalTimeEditValue] = useState('');
  const selectedLang = useLanguageStore?.getState?.()?.language ?? 'en';

  useEffect(() => {
    if (!editId) return;
    getFlightById(Number(editId)).then(f => {
      if (!f) return;
      setForm({
        date: f.date,
        aircraft_type: f.aircraft_type,
        registration: f.registration,
        dep_place: f.dep_place,
        dep_utc: f.dep_utc,
        arr_place: f.arr_place,
        arr_utc: f.arr_utc,
        total_time: String(f.total_time),
        ifr: String(f.ifr),
        night: String(f.night),
        pic: String(f.pic),
        co_pilot: String(f.co_pilot),
        dual: String(f.dual),
        landings_day: String(f.landings_day),
        landings_night: String(f.landings_night),
        remarks: f.remarks,
        flight_type: f.flight_type ?? 'normal',
        stop_place: '',
        flight_rules: f.flight_rules ?? 'VFR',
        second_pilot: f.second_pilot ?? '',
        nvg: String(f.nvg ?? 0),
        tng_count: String(f.tng_count ?? 0),
        multi_pilot: String(f.multi_pilot ?? 0),
        single_pilot: String(f.single_pilot ?? 0),
        instructor: String(f.instructor ?? 0),
        picus: String(f.picus ?? 0),
        spic: String(f.spic ?? 0),
        examiner: String(f.examiner ?? 0),
        safety_pilot: String(f.safety_pilot ?? 0),
        observer: String(f.observer ?? 0),
        ferry_pic: String(f.ferry_pic ?? 0),
        relief_crew: String(f.relief_crew ?? 0),
        sim_category: (f.sim_category ?? '') as any,
        vfr: String(f.vfr ?? 0),
        max_fl: String(f.max_fl ?? 0) === '0' ? '' : String(f.max_fl),
        photo_uri: f.photo_uri ?? '',
      });
      if (f.photo_uri) setPhotoUri(f.photo_uri);
      if (f.media_type === 'video') setMediaType('video');
      if (f.pic > 0) setRole('pic');
      else if (f.co_pilot > 0) setRole('co_pilot');
      else if (f.dual > 0) setRole('dual');
      else if (f.picus > 0) setRole('picus');
      else if (f.spic > 0) setRole('spic');
      else if (f.ferry_pic > 0) setRole('ferry_pic');
      else if (f.observer > 0) setRole('observer');
      else if (f.relief_crew > 0) setRole('relief_crew');
      if ((f.instructor ?? 0) > 0) setFi(true);
      if ((f.examiner ?? 0) > 0) setExaminerOverlay(true);
      if ((f.safety_pilot ?? 0) > 0) setSafetyPilotOverlay(true);
    });
  }, [editId]);

  const CREW_ROLES = [
    { key: 'Crew chief', label: selectedLang === 'sv' ? 'Uppdragsspecialist' : 'Crew chief', short: 'CC' },
    { key: 'Rescue swimmer', label: selectedLang === 'sv' ? 'Ytbärgare' : 'Rescue swimmer', short: 'RS' },
    { key: 'Winch operator', label: selectedLang === 'sv' ? 'Vinschoperatör' : 'Winch operator', short: 'WO' },
    { key: 'HEMS operator', label: selectedLang === 'sv' ? 'HEMS-operatör' : 'HEMS operator', short: 'HEMS' },
    { key: 'Loadmaster', label: selectedLang === 'sv' ? 'Lastmästare' : 'Loadmaster', short: 'LM' },
  ];

  const updateCrewMember = (id: string, field: 'role' | 'name', value: string) => {
    setCrewMembers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };
  const addCrewMember = () => {
    setCrewMembers(prev => [...prev, { id: String(Date.now()), role: '', name: '' }]);
  };
  const removeCrewMember = (id: string) => {
    setCrewMembers(prev => prev.length > 1 ? prev.filter(m => m.id !== id) : prev);
  };
  const [showMilOp, setShowMilOp] = useState(false);

  const MIL_CATEGORIES: { title: string; items: { code: string; desc: string }[] }[] = [
    { title: t('mil_cat_rescue'), items: [
      { code: 'SAR', desc: t('mil_sar') },
      { code: 'CR', desc: t('mil_cr') },
      { code: 'PR', desc: t('mil_pr') },
    ]},
    { title: t('mil_cat_transport'), items: [
      { code: 'MEDEVAC', desc: t('mil_medevac') },
      { code: 'CASEVAC', desc: t('mil_casevac') },
      { code: 'MEDT', desc: t('mil_medt') },
      { code: 'AIRDROP', desc: t('mil_airdrop') },
      { code: 'SLING', desc: t('mil_sling') },
      { code: 'INFIL', desc: t('mil_infil') },
      { code: 'EXFIL', desc: t('mil_exfil') },
    ]},
    { title: t('mil_cat_refuel'), items: [
      { code: 'AAR', desc: t('mil_aar') },
      { code: 'HIFR', desc: t('mil_hifr') },
      { code: 'HOTREFUEL', desc: 'Hot refuel' },
    ]},
    { title: t('mil_cat_maritime'), items: [
      { code: 'ASW', desc: t('mil_asw') },
      { code: 'ASUW', desc: t('mil_asuw') },
      { code: 'MIO', desc: t('mil_mio') },
      { code: 'HOSTAC', desc: t('mil_hostac') },
      { code: 'VERTREP', desc: t('mil_vertrep') },
    ]},
    { title: t('mil_cat_heliops'), items: [
      { code: 'NOE', desc: t('mil_noe') },
      { code: 'CONTOUR', desc: t('mil_contour') },
      { code: 'DGO', desc: t('mil_dgo') },
      { code: 'SNIPER', desc: t('mil_sniper') },
      { code: 'HOIST', desc: t('mil_hoist') },
      { code: 'HRST', desc: t('mil_hrst') },
      { code: 'TROOPTX', desc: t('mil_trooptx') },
      { code: 'PIX', desc: t('mil_pix') },
    ]},
    { title: t('mil_cat_formation'), items: [
      { code: 'SECTION', desc: t('mil_rote') },
      { code: 'GROUP', desc: t('mil_group') },
      { code: 'MIXED', desc: t('mil_mixed') },
    ]},
  ];

  const [expandedMilCats, setExpandedMilCats] = useState<Set<string>>(new Set());

  const toggleMilOp = (op: string) => {
    Haptics.selectionAsync();
    setMilOps(prev => {
      const next = new Set(prev);
      next.has(op) ? next.delete(op) : next.add(op);
      return next;
    });
  };

  const toggleMilCat = (cat: string) => {
    setExpandedMilCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const milOpSummary = milOps.size > 0 ? Array.from(milOps).join(', ') : '';
  const scrollViewRef = useRef<ScrollView>(null);
  const routeBlockY = useRef(0);
  const depIcaoRef = useRef<IcaoInputHandle>(null);
  const arrIcaoRef = useRef<IcaoInputHandle>(null);
  const depTimeRef = useRef<SmartTimeInputHandle>(null);
  const arrTimeRef = useRef<SmartTimeInputHandle>(null);
  const [spSupported, setSpSupported] = useState(true);
  const [mpSupported, setMpSupported] = useState(true);
  const [showAircraftModal, setShowAircraftModal] = useState(false);

  useEffect(() => {
    Promise.all([
      getRecentAircraftTypes(),
      getRecentPlaces(),
      getFlights(1),
      getRecentRemarks(20),
      getRecentSecondPilots(),
    ]).then(([types, places, flights, remarks, pilots]) => {
      setRecentTypes(types);
      setRecentPlaces(places);
      setRecentRemarks(remarks);
      setRecentPilots(pilots);
      const last = flights[0] ?? null;
      if (last) {
        setLastFlight(last);
        getRecentRegistrations(last.aircraft_type).then(setRecentRegs);
        if (!isEdit) {
          setForm((prev) => ({
            ...prev,
            aircraft_type: last.aircraft_type,
            registration: last.registration,
            dep_place: last.arr_place ?? '',
            ...(last.flight_rules ? { flight_rules: last.flight_rules, ifr: '0', vfr: '0' } : {}),
          }));
        } else if (last.flight_rules) {
          setForm((prev) => ({ ...prev, flight_rules: last.flight_rules, ifr: '0', vfr: '0' }));
        }
        // Förvald roll baserat på senaste flygningen (bara för nya flygningar)
        if (!isEdit) {
          const r: PrimaryRole =
            (last.picus ?? 0) > 0 ? 'picus' :
            (last.spic ?? 0) > 0 ? 'spic' :
            (last.ferry_pic ?? 0) > 0 ? 'ferry_pic' :
            (last.observer ?? 0) > 0 ? 'observer' :
            (last.relief_crew ?? 0) > 0 ? 'relief_crew' :
            (last.dual ?? 0) > 0 ? 'dual' :
            (last.co_pilot ?? 0) > 0 ? 'co_pilot' :
            'pic';
          setRole(r);
          setFi((last.instructor ?? 0) > 0 && ['pic','picus','spic','ferry_pic'].includes(r));
          setExaminerOverlay((last.examiner ?? 0) > 0 && r === 'pic');
          setSafetyPilotOverlay((last.safety_pilot ?? 0) > 0 && r === 'co_pilot');
        }
      }
    });
  }, []);

  // Uppdatera multi_pilot/single_pilot när pilotMode ändras
  useEffect(() => {
    applyDistribution(role, fi, examinerOverlay, safetyPilotOverlay, form.total_time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilotMode]);

  // Föreslå remarks-mall baserat på roll/overlay
  useEffect(() => {
    let template = '';
    if (role === 'picus') template = 'PICUS u/s Capt. ';
    else if (role === 'dual') template = 'FI: ';
    else if (examinerOverlay && role === 'pic') template = 'TRE: ';
    // Bara skriv in mallen om remarks är tomt eller innehåller bara den förra mallen
    if (template && (form.remarks === '' || form.remarks === lastTemplate)) {
      setForm((prev) => ({ ...prev, remarks: template }));
      setLastTemplate(template);
    } else if (!template && form.remarks === lastTemplate) {
      // Rensa mallen om användaren byter tillbaka till en roll utan mall
      setForm((prev) => ({ ...prev, remarks: '' }));
      setLastTemplate('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, examinerOverlay]);

  useEffect(() => {
    const type = form.aircraft_type.trim().toUpperCase();
    if (!type) { setRecentRegs([]); setSpSupported(true); setMpSupported(true); return; }
    let cancelled = false;
    getRecentRegistrations(type).then((regs) => {
      if (!cancelled) setRecentRegs(regs);
    });
    getAircraftCrewType(type).then((ct) => {
      if (cancelled) return;
      const hasSp = !ct || ct.includes('sp');
      const hasMp = !ct || ct.includes('mp');
      setSpSupported(hasSp);
      setMpSupported(hasMp);
      // Ändra läge om det nya fartyget inte stödjer aktuellt val
      if (!hasSp && pilotMode === 'single') setPilotMode('multi');
      else if (!hasMp && pilotMode === 'multi') setPilotMode('single');
      else if (hasSp && !hasMp) setPilotMode('single');
      else if (!hasSp && hasMp) setPilotMode('multi');
    });
    return () => { cancelled = true; };
  }, [form.aircraft_type]);

  const fillLastAircraft = () => {
    if (!lastFlight) return;
    setForm((prev) => ({
      ...prev,
      aircraft_type: lastFlight.aircraft_type,
      registration: lastFlight.registration,
    }));
    getRecentRegistrations(lastFlight.aircraft_type).then(setRecentRegs);
  };

  const fillReverseRoute = () => {
    if (!lastFlight) return;
    const detectedRole: PrimaryRole =
      (lastFlight.picus ?? 0) > 0 ? 'picus' :
      (lastFlight.spic ?? 0) > 0 ? 'spic' :
      (lastFlight.ferry_pic ?? 0) > 0 ? 'ferry_pic' :
      (lastFlight.observer ?? 0) > 0 ? 'observer' :
      (lastFlight.relief_crew ?? 0) > 0 ? 'relief_crew' :
      (lastFlight.dual ?? 0) > 0 ? 'dual' :
      (lastFlight.co_pilot ?? 0) > 0 ? 'co_pilot' :
      'pic';
    setRole(detectedRole);
    setFi((lastFlight.instructor ?? 0) > 0 && ['pic','picus','spic','ferry_pic'].includes(detectedRole));
    setExaminerOverlay((lastFlight.examiner ?? 0) > 0 && detectedRole === 'pic');
    setSafetyPilotOverlay((lastFlight.safety_pilot ?? 0) > 0 && detectedRole === 'co_pilot');
    setForm((prev) => ({
      ...prev,
      aircraft_type: lastFlight.aircraft_type,
      registration: lastFlight.registration,
      second_pilot: lastFlight.second_pilot ?? '',
      dep_place: lastFlight.arr_place ?? '',
      arr_place: lastFlight.dep_place ?? '',
      flight_rules: lastFlight.flight_rules ?? prev.flight_rules,
      ifr: '0',
      vfr: '0',
    }));
    getRecentRegistrations(lastFlight.aircraft_type).then(setRecentRegs);
  };

  const onTypeSelect = useCallback(async (type: string) => {
    set('aircraft_type', type);
    const regs = await getRecentRegistrations(type);
    setRecentRegs(regs);
  }, []);

  const set = (key: keyof FlightFormData, val: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };

      const distribute = (tt: string) => {
        const instrEligible: PrimaryRole[] = ['pic','picus','spic','ferry_pic'];
        const isMulti = pilotMode === 'multi';
        next.pic = role === 'pic' ? tt : '0';
        next.co_pilot = role === 'co_pilot' ? tt : '0';
        next.dual = role === 'dual' ? tt : '0';
        next.picus = role === 'picus' ? tt : '0';
        next.spic = role === 'spic' ? tt : '0';
        next.ferry_pic = role === 'ferry_pic' ? tt : '0';
        next.observer = role === 'observer' ? tt : '0';
        next.relief_crew = role === 'relief_crew' ? tt : '0';
        next.instructor = fi && instrEligible.includes(role) ? tt : '0';
        next.examiner = examinerOverlay && role === 'pic' ? tt : '0';
        next.safety_pilot = safetyPilotOverlay && role === 'co_pilot' ? tt : '0';
        next.multi_pilot = isMulti ? tt : '0';
        next.single_pilot = isMulti ? '0' : tt;
      };

      if (key === 'second_pilot') {
        if (val && val.trim() && mpSupported && pilotMode !== 'multi') {
          setPilotMode('multi');
        }
        distribute(next.total_time || '0');
      }

      const syncRules = (tt: string, rules: string | undefined) => {
        if (rules === 'IFR') { next.ifr = tt; next.vfr = '0'; }
        else if (rules === 'VFR') { next.ifr = '0'; next.vfr = tt; }
        // Y / Z: lämna värdena som de är (användaren fyller i manuellt)
      };

      if (key === 'dep_utc' || key === 'arr_utc') {
        const dep = key === 'dep_utc' ? val : prev.dep_utc;
        const arr = key === 'arr_utc' ? val : prev.arr_utc;
        if (isValidTime(dep) && isValidTime(arr)) {
          const tt = calcFlightTime(dep, arr);
          if (tt > 0) {
            next.total_time = String(tt);
            distribute(String(tt));
            syncRules(String(tt), next.flight_rules);
          }
        }
      }

      if (key === 'total_time') {
        distribute(val);
        syncRules(val, next.flight_rules);
      }

      // När flygregler ändras: synka ifr/vfr mot total_time
      if (key === 'flight_rules') {
        const tt = next.total_time || '0';
        if (val === 'IFR') { next.ifr = tt; next.vfr = '0'; next.nvg = '0'; }
        else if (val === 'VFR') { next.ifr = '0'; next.vfr = tt; }
        else if (val === 'Y' || val === 'Z' || val === 'Mixed') {
          // Y/Z: alltid tom start — piloten måste fylla i andelen manuellt
          next.ifr = '0';
          next.vfr = '0';
        }
      }

      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const applyDistribution = (
    r: PrimaryRole,
    instr: boolean,
    exam: boolean,
    safety: boolean,
    tt: string,
  ) => {
    const instrEligible: PrimaryRole[] = ['pic','picus','spic','ferry_pic'];
    setForm((prev) => {
      const isMulti = pilotMode === 'multi';
      return {
        ...prev,
        pic: r === 'pic' ? tt : '0',
        co_pilot: r === 'co_pilot' ? tt : '0',
        dual: r === 'dual' ? tt : '0',
        picus: r === 'picus' ? tt : '0',
        spic: r === 'spic' ? tt : '0',
        ferry_pic: r === 'ferry_pic' ? tt : '0',
        observer: r === 'observer' ? tt : '0',
        relief_crew: r === 'relief_crew' ? tt : '0',
        instructor: instr && instrEligible.includes(r) ? tt : '0',
        examiner: exam && r === 'pic' ? tt : '0',
        safety_pilot: safety && r === 'co_pilot' ? tt : '0',
        multi_pilot: isMulti ? tt : '0',
        single_pilot: isMulti ? '0' : tt,
      };
    });
  };

  const handleRoleChange = (newRole: PrimaryRole) => {
    const instrEligible: PrimaryRole[] = ['pic','picus','spic','ferry_pic'];
    const nextFi = instrEligible.includes(newRole) ? fi : false;
    const nextExam = newRole === 'pic' ? examinerOverlay : false;
    const nextSafety = newRole === 'co_pilot' ? safetyPilotOverlay : false;
    setRole(newRole);
    setFi(nextFi);
    setExaminerOverlay(nextExam);
    setSafetyPilotOverlay(nextSafety);
    applyDistribution(newRole, nextFi, nextExam, nextSafety, form.total_time);
  };

  const toggleFi = () => {
    const instrEligible: PrimaryRole[] = ['pic','picus','spic','ferry_pic'];
    if (!instrEligible.includes(role)) return;
    const nextFi = !fi;
    setFi(nextFi);
    applyDistribution(role, nextFi, examinerOverlay, safetyPilotOverlay, form.total_time);
  };

  const toggleExaminer = () => {
    if (role !== 'pic') return;
    const next = !examinerOverlay;
    setExaminerOverlay(next);
    applyDistribution(role, fi, next, safetyPilotOverlay, form.total_time);
  };

  const toggleSafetyPilot = () => {
    if (role !== 'co_pilot') return;
    const next = !safetyPilotOverlay;
    setSafetyPilotOverlay(next);
    applyDistribution(role, fi, examinerOverlay, next, form.total_time);
  };

  const toggleDual = () => {
    if (role === 'dual') handleRoleChange('pic');
    else handleRoleChange('dual');
  };

  const togglePicus = () => {
    if (role === 'picus') handleRoleChange('pic');
    else handleRoleChange('picus');
  };

  const pickMedia = async (type: 'image' | 'video') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === 'video' ? ['videos'] : ['images'],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];

      // Validera videostorlek
      if (type === 'video') {
        try {
          const fileInfo = await FileSystem.getInfoAsync(asset.uri);
          const sizeInMB = (fileInfo.size ?? 0) / (1024 * 1024);
          if (sizeInMB > 50) {
            Alert.alert(
              'Videon är för stor',
              `Maximal filstorlek är 50 MB (din video är ${sizeInMB.toFixed(1)} MB).`
            );
            return;
          }
        } catch (err) {
          console.warn('Failed to check video size:', err);
        }
      }

      setMediaType(type);
      setPhotoUri(asset.uri);
    }
  };

  const [aiLoading, setAiLoading] = useState(false);

  const importFromImage = async () => {
    if (!isPremium) {
      setShowPremiumGate(true);
      return;
    }
    const { canFlightImport, consumeFlightImport } = useScanQuotaStore.getState();
    if (!canFlightImport()) {
      Alert.alert('Kvot slut', 'Du har använt alla dina AI-importer denna månad.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (result.canceled || !result.assets[0]) return;
    setAiLoading(true);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
      );
      const base64 = await FileSystem.readAsStringAsync(manipulated.uri, { encoding: FileSystem.EncodingType.Base64 });
      const mediaType = 'image/jpeg';

      const parsed = await callAnthropicJson<Record<string, any>>({
        system: `You extract flight data from cockpit instrument images, flight tracking app screenshots, or any aviation-related photo. Today's date is ${new Date().toISOString().split('T')[0]}. Return a JSON object with ONLY the fields you can confidently read. Use these field names:
- date: "YYYY-MM-DD" — If the date format is ambiguous (e.g. 11-05-26 could be 2026-05-11 or 2011-05-26), pick the interpretation closest to today's date.
- dep_place: ICAO code (4 letters)
- arr_place: ICAO code (4 letters)
- dep_utc: "HH:MM" (UTC)
- arr_utc: "HH:MM" (UTC)
- aircraft_time: decimal hours — total time engine on to engine off (block time / Hobbs)
- flight_time: decimal hours — total time airborne (takeoff to landing)
- aircraft_type: ICAO type designator
- registration: aircraft registration
- max_fl: number (flight level, no FL prefix)
- landings_day: integer
- flight_rules: "VFR" or "IFR"

Return aircraft_time AND/OR flight_time if BOTH are visible. If only one time is shown, return it as flight_time. Omit fields you cannot determine. Never guess — only return what you can clearly read from the image.

IMPORTANT: Return ONLY a raw JSON object. No markdown, no backticks, no explanation — just the JSON.`,
        userContent: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Extract all flight data you can read from this image.' },
        ],
        maxTokens: 1000,
        temperature: 0,
      });

      if (parsed) {
        const applyImport = (timeVal: string) => {
          const updates: Partial<FlightFormData> = {};
          if (parsed.date) updates.date = String(parsed.date);
          if (parsed.dep_place) updates.dep_place = String(parsed.dep_place).toUpperCase();
          if (parsed.arr_place) updates.arr_place = String(parsed.arr_place).toUpperCase();
          if (parsed.dep_utc) updates.dep_utc = String(parsed.dep_utc);
          if (parsed.arr_utc) updates.arr_utc = String(parsed.arr_utc);

          if (parsed.dep_utc && parsed.arr_utc && isValidTime(String(parsed.dep_utc)) && isValidTime(String(parsed.arr_utc))) {
            const computed = calcFlightTime(String(parsed.dep_utc), String(parsed.arr_utc));
            if (computed > 0) {
              updates.total_time = String(computed);
            } else if (timeVal) {
              updates.total_time = timeVal;
            }
          } else if (timeVal) {
            updates.total_time = timeVal;
          }
          if (parsed.aircraft_type) updates.aircraft_type = String(parsed.aircraft_type).toUpperCase();
          if (parsed.registration) updates.registration = String(parsed.registration).toUpperCase();
          if (parsed.max_fl) updates.max_fl = String(parsed.max_fl);
          if (parsed.landings_day) updates.landings_day = String(parsed.landings_day);
          if (parsed.flight_rules) updates.flight_rules = String(parsed.flight_rules).toUpperCase();
          setForm(prev => ({ ...prev, ...updates }));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        };

        await consumeFlightImport();

        const hasAircraft = parsed.aircraft_time && parsed.aircraft_time > 0;
        const hasFlight = parsed.flight_time && parsed.flight_time > 0;

        if (hasAircraft && hasFlight && String(parsed.aircraft_time) !== String(parsed.flight_time)) {
          Alert.alert(
            'Vilken tid?',
            `Aircraft time: ${parsed.aircraft_time}h\nFlight time: ${parsed.flight_time}h`,
            [
              { text: `Aircraft ${parsed.aircraft_time}h`, onPress: () => applyImport(String(parsed.aircraft_time)) },
              { text: `Flight ${parsed.flight_time}h`, onPress: () => applyImport(String(parsed.flight_time)) },
            ]
          );
        } else {
          applyImport(String(hasFlight ? parsed.flight_time : hasAircraft ? parsed.aircraft_time : ''));
        }
      }
    } catch (e: any) {
      Alert.alert('AI Import', e.message || 'Kunde inte läsa bilden');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (aiImport === '1') {
      setTimeout(() => importFromImage(), 500);
    }
    if (addPhoto === '1') {
      setTimeout(() => pickMedia('image'), 500);
    }
  }, [aiImport, addPhoto]);

  const performSave = async (overrides?: Partial<FlightFormData>) => {
    setSaving(true);
    try {
      const crewStr = crewMembers
        .filter(m => m.role || m.name)
        .map(m => [m.role, m.name].filter(Boolean).join(': '))
        .join(', ');
      const flStr = parseInt(form.max_fl ?? '') > 0 ? `Max FL${form.max_fl}` : '';
      const finalRemarks = [
        form.remarks,
        flStr,
        crewStr ? `[${crewStr}]` : '',
      ].filter(Boolean).join(' · ');

      let savedPhotoUri = photoUri ?? '';
      if (photoUri && !photoUri.startsWith(FileSystem.documentDirectory ?? '___')) {
        const folderName = mediaType === 'video' ? 'flight_videos' : 'flight_photos';
        const dir = FileSystem.documentDirectory + folderName + '/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const ext = photoUri.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg');
        const filename = `${Date.now()}.${ext}`;
        savedPhotoUri = dir + filename;
        await FileSystem.copyAsync({ from: photoUri, to: savedPhotoUri });
      }

      const finalData = { ...form, ...(overrides ?? {}), remarks: finalRemarks, photo_uri: savedPhotoUri, media_type: mediaType };

      if (isEdit) {
        await updateFlight(Number(editId), finalData);
      } else {
        await insertFlight(finalData, { source: 'manual' });
      }
      await Promise.all([loadFlights(), loadStats()]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert(t('error'), t('error_save'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const issues = validateFlightForm(form);
    const hardErrors = issues.filter((i) => i.severity === 'error');
    if (hardErrors.length > 0) {
      const newErrors: Partial<Record<keyof FlightFormData, string>> = {};
      for (const e of hardErrors) newErrors[e.field as keyof FlightFormData] = e.message;
      setErrors(newErrors);
      return;
    }
    setWarnings(issues.filter((i) => i.severity === 'warning'));

    // Kontroll: både start och landningsplats är tomma
    const hasDepPlace = form.dep_place && form.dep_place.trim().length > 0;
    const hasArrPlace = form.arr_place && form.arr_place.trim().length > 0;
    if (!hasDepPlace && !hasArrPlace) {
      Alert.alert(
        t('warning'),
        'Du har inte angett varken start- eller landningsplats. Vill du spara ändå?',
        [
          {
            text: t('cancel'),
            style: 'cancel',
            onPress: () => {
              // Fokusera på det första tomma fältet
              if (!hasDepPlace) {
                depIcaoRef.current?.focus();
              } else if (!hasArrPlace) {
                arrIcaoRef.current?.focus();
              }
            },
          },
          {
            text: t('save_anyway'),
            style: 'destructive',
            onPress: () => performSave(),
          },
        ]
      );
      return;
    }

    // Endurance-kontroll: om passets längd överstiger luftfartygets angivna uthållighet,
    // föreslå hot refuel eller låt piloten spara ändå.
    const tt = parseFloat(form.total_time) || 0;
    if (tt > 0 && form.aircraft_type && form.flight_type !== 'hot_refuel' && form.flight_type !== 'sim') {
      const endurance = await getAircraftEndurance(form.aircraft_type);
      if (endurance > 0 && tt > endurance) {
        Alert.alert(
          t('endurance_exceeded_title'),
          `${form.aircraft_type} ${t('endurance_exceeded_msg')} ${endurance.toFixed(1)}h. ${t('endurance_exceeded_hint')}`,
          [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('mark_hot_refuel'),
              onPress: () => performSave({ flight_type: 'hot_refuel' }),
            },
            {
              text: t('save_anyway'),
              style: 'destructive',
              onPress: () => performSave(),
            },
          ]
        );
        return;
      }
    }

    await performSave();
  };

  // Topp 3 senaste platserna, filtrering sker inuti IcaoInput
  const top2places = recentPlaces;

  // Senaste typen/reg som chips (max 3)
  const filteredTypes = form.aircraft_type
    ? recentTypes.filter((t) => t.startsWith(form.aircraft_type.toUpperCase())).slice(0, 3)
    : recentTypes.slice(0, 3);
  // Senaste typ (index 0 i recentTypes = senast flugna)
  const mostRecentType = recentTypes[0] ?? null;

  // Alla individer för vald typ, i fallande ordning (senast flugna först)
  // Filtrera på påbörjad inmatning om registrering redan är ifylld
  const filteredRegs = form.registration
    ? recentRegs.filter((r) => r.startsWith(form.registration.toUpperCase()))
    : recentRegs;
  const mostRecentReg = recentRegs[0] ?? null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      {/* Custom header */}
      <TouchableOpacity
        style={styles.customHeader}
        onPress={() => setShowDatePicker(true)}
        activeOpacity={0.8}
      >
        <TouchableOpacity style={styles.headerClose} onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.headerDate}>
            {(() => {
              const d = form.date ? new Date(form.date + 'T12:00:00') : new Date();
              const lang = useLanguageStore.getState().language;
              return d.toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
            })()}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
        </View>
        <TouchableOpacity
          style={{ position: 'absolute', right: 16, bottom: 10 }}
          onPress={importFromImage}
          disabled={aiLoading}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {aiLoading
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Ionicons name="scan-outline" size={22} color={Colors.primary} />
          }
        </TouchableOpacity>
      </TouchableOpacity>

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >

        <ValidationWarnings issues={warnings} />

        {/* ── Snabbfyll: omvänd rutt från senaste flygning ── */}
        {lastFlight && lastFlight.dep_place && lastFlight.arr_place && (
          <TouchableOpacity style={styles.lastFlightBar} onPress={fillReverseRoute} activeOpacity={0.7}>
            <Ionicons name="swap-horizontal" size={14} color={Colors.primary} />
            <Text style={styles.lastFlightText}>
              {t('reverse_route')}{' '}
              <Text style={styles.lastFlightBold}>
                {lastFlight.arr_place} → {lastFlight.dep_place}
              </Text>
              {lastFlight.second_pilot ? <> · <Text style={styles.lastFlightBold}>{lastFlight.second_pilot}</Text></> : null}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        )}


        {/* Row 1: Aircraft type + Registration */}
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormField
              label={t('aircraft_type')}
              value={form.aircraft_type}
              onChangeText={(v) => set('aircraft_type', v.toUpperCase())}
              error={errors.aircraft_type}
              placeholder="C172"
              autoCapitalize="characters"
              onPressAdd={() => setShowAircraftModal(true)}
            />
            <View style={styles.regRow}>
              <TouchableOpacity
                style={styles.regDropdownBtn}
                onPress={() => setShowTypeModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="bookmark" size={12} color={Colors.textSecondary} />
                <Ionicons name="chevron-down" size={12} color={Colors.textSecondary} />
              </TouchableOpacity>
              {mostRecentType && (
                <TouchableOpacity
                  style={[styles.chip, styles.chipRecent]}
                  onPress={() => onTypeSelect(mostRecentType)}
                >
                  <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipText, styles.chipRecentText]}>{mostRecentType}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <FormField
              label={t('registration')}
              value={form.registration}
              onChangeText={(v) => set('registration', v.toUpperCase())}
              error={errors.registration}
              placeholder="SE-KXY"
              autoCapitalize="characters"
              onPressAdd={() => {
                if (!form.aircraft_type) {
                  Alert.alert(t('select_aircraft_type_first'), t('enter_aircraft_type_before_reg'));
                  return;
                }
                Alert.prompt(
                  t('new_registration'),
                  `${t('add_registration_for')} ${form.aircraft_type}`,
                  async (reg) => {
                    const r = reg?.trim().toUpperCase();
                    if (!r) return;
                    await addToAircraftRegistry(form.aircraft_type, r);
                    const updated = await getRecentRegistrations(form.aircraft_type);
                    setRecentRegs(updated);
                    set('registration', r);
                  },
                  'plain-text',
                  '',
                );
              }}
            />
            <View style={styles.regRow}>
              <TouchableOpacity
                style={[styles.regDropdownBtn, !form.aircraft_type && styles.regDropdownDisabled]}
                onPress={() => {
                  if (!form.aircraft_type) {
                    Alert.alert(t('select_aircraft_type_first'), t('enter_aircraft_type_before_reg'));
                    return;
                  }
                  setShowRegModal(true);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="bookmark" size={12} color={Colors.textSecondary} />
                <Ionicons name="chevron-down" size={12} color={Colors.textSecondary} />
              </TouchableOpacity>
              {mostRecentReg && (
                <TouchableOpacity
                  style={[styles.chip, styles.chipRecent]}
                  onPress={() => set('registration', mostRecentReg)}
                >
                  <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipText, styles.chipRecentText]}>{mostRecentReg}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Row 2: Second pilot + Cabin crew (side by side) */}
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormField
              label={t('second_pilot_label')}
              value={form.second_pilot ?? ''}
              onChangeText={(v) => set('second_pilot', v)}
              placeholder={t('second_pilot_ph')}
              onPressAdd={() => {
                Alert.prompt(
                  t('add_second_pilot'),
                  '',
                  (name) => {
                    const n = name?.trim();
                    if (n) set('second_pilot', n);
                  },
                  'plain-text',
                  '',
                );
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.regDropdownBtn, recentPilots.length === 0 && styles.regDropdownDisabled]}
                onPress={() => {
                  if (recentPilots.length === 0) return;
                  setShowPilotModal(true);
                }}
                activeOpacity={recentPilots.length === 0 ? 1 : 0.7}
              >
                <Ionicons name="bookmark" size={12} color={recentPilots.length === 0 ? Colors.textMuted : Colors.textSecondary} />
                <Ionicons name="chevron-down" size={12} color={recentPilots.length === 0 ? Colors.textMuted : Colors.textSecondary} />
              </TouchableOpacity>
              <View style={styles.pilotModeRow}>
              <TouchableOpacity
                style={[
                  styles.pilotModeBtn,
                  pilotMode === 'single' && styles.pilotModeBtnActive,
                  !spSupported && styles.pilotModeBtnDisabled,
                ]}
                disabled={!spSupported}
                onPress={() => setPilotMode('single')}
                activeOpacity={0.75}
              >
                <Text style={[styles.pilotModeText, pilotMode === 'single' && styles.pilotModeTextActive]}>SP</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pilotModeBtn,
                  pilotMode === 'multi' && styles.pilotModeBtnActive,
                  !mpSupported && styles.pilotModeBtnDisabled,
                ]}
                disabled={!mpSupported}
                onPress={() => setPilotMode('multi')}
                activeOpacity={0.75}
              >
                <Text style={[styles.pilotModeText, pilotMode === 'multi' && styles.pilotModeTextActive]}>MP</Text>
              </TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardFieldLabel}>{t('crew_chief_label')}</Text>
            {crewMembers.map((member) => (
              <View key={member.id} style={{ gap: 4, marginTop: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      backgroundColor: Colors.card, borderRadius: 8,
                      borderWidth: 0.5, borderColor: member.role ? Colors.primary : Colors.border,
                      paddingHorizontal: 6, paddingVertical: 12,
                    }}
                    onPress={() => setActiveCrewPicker(activeCrewPicker === member.id ? null : member.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={{ color: member.role ? Colors.primary : Colors.textMuted, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                      {member.role ? CREW_ROLES.find(r => r.key === member.role)?.short ?? member.role : t('crew_role_select')}
                    </Text>
                    <Ionicons name="chevron-down" size={10} color={Colors.textMuted} />
                  </TouchableOpacity>
                  <TextInput
                    style={{
                      flex: 1, backgroundColor: Colors.card, borderRadius: 8,
                      borderWidth: 0.5, borderColor: Colors.border,
                      color: Colors.textPrimary, fontSize: 13,
                      paddingHorizontal: 8, paddingVertical: 12,
                    }}
                    value={member.name}
                    onChangeText={(v) => updateCrewMember(member.id, 'name', v)}
                    placeholder={t('crew_chief_ph')}
                    placeholderTextColor={Colors.textMuted}
                  />
                  {crewMembers.length > 1 && (
                    <TouchableOpacity onPress={() => removeCrewMember(member.id)} style={{ justifyContent: 'center' }}>
                      <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
                {activeCrewPicker === member.id && (
                  <View style={{
                    backgroundColor: Colors.surface, borderRadius: 10,
                    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
                  }}>
                    {[{ key: '', label: `— ${t('clear')}` }, ...CREW_ROLES].map(opt => (
                      <TouchableOpacity
                        key={opt.key}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 10,
                          borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
                          backgroundColor: member.role === opt.key ? Colors.primary + '14' : undefined,
                        }}
                        onPress={() => { updateCrewMember(member.id, 'role', opt.key); setActiveCrewPicker(null); }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: member.role === opt.key ? Colors.primary : Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
              onPress={addCrewMember}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={14} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '600' }}>{t('crew_add_more')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Route ── */}
        <Text
          style={styles.section}
          onLayout={(e) => { routeBlockY.current = e.nativeEvent.layout.y; }}
        >{t('route_utc')}</Text>

        {/* Kombinerat Departure / Arrival block */}
        <View style={styles.placeBlock}>
          <View style={[styles.row2, { alignItems: 'stretch' }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.locSegment}>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, !(activePlace === 'dep' ? depCustom : arrCustom) && styles.locSegmentBtnActive]}
                  onPress={() => {
                    if (activePlace === 'dep') { setDepCustom(false); set('dep_place', ''); }
                    else { setArrCustom(false); set('arr_place', ''); }
                  }}
                >
                  <Text style={[styles.locSegmentText, !(activePlace === 'dep' ? depCustom : arrCustom) && styles.locSegmentTextActive]}>{t('icao_label')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, (activePlace === 'dep' ? depCustom : arrCustom) && styles.locSegmentBtnActive]}
                  onPress={() => {
                    if (activePlace === 'dep') { setDepCustom(true); set('dep_place', ''); }
                    else { setArrCustom(true); set('arr_place', ''); }
                  }}
                >
                  <Text style={[styles.locSegmentText, (activePlace === 'dep' ? depCustom : arrCustom) && styles.locSegmentTextActive]}>{t('temporary_label')}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ width: 120 }}>
              <View style={styles.locSegment}>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, activePlace === 'dep' && styles.locSegmentBtnActive]}
                  onPress={() => setActivePlace('dep')}
                >
                  <Text style={[styles.locSegmentText, activePlace === 'dep' && styles.locSegmentTextActive]}>DEP</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, activePlace === 'arr' && styles.locSegmentBtnActive]}
                  onPress={() => setActivePlace('arr')}
                >
                  <Text style={[styles.locSegmentText, activePlace === 'arr' && styles.locSegmentTextActive]}>ARR</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              {activePlace === 'dep' ? (
                <IcaoInput
                  ref={depIcaoRef}
                  label=""
                  value={form.dep_place}
                  onChangeText={(v) => set('dep_place', v)}
                  error={errors.dep_place}
                  recentPlaces={top2places}
                  allowHere={depCustom}
                  onFocus={() => {
                    const target = Math.max(0, routeBlockY.current - 8);
                    // Skjut scroll efter att tangentbordet + auto-insets har justerats,
                    // annars skriver RN över målet och ingen scroll syns.
                    requestAnimationFrame(() => {
                      scrollViewRef.current?.scrollTo({ y: target, animated: true });
                    });
                    setTimeout(() => {
                      scrollViewRef.current?.scrollTo({ y: target, animated: true });
                    }, 320);
                  }}
                  onTemporaryPlaceSelect={(icao) => {
                    setDepCustom(true);
                    set('dep_place', icao);
                    if (form.dep_utc && isValidTime(form.dep_utc)) {
                      setActivePlace('arr');
                      setTimeout(() => arrIcaoRef.current?.focus(), 120);
                    } else {
                      setTimeout(() => depTimeRef.current?.focus(), 80);
                    }
                  }}
                  onConfirm={() => {
                    if (form.dep_utc && isValidTime(form.dep_utc)) {
                      setActivePlace('arr');
                      setTimeout(() => arrIcaoRef.current?.focus(), 120);
                    } else {
                      setTimeout(() => depTimeRef.current?.focus(), 80);
                    }
                  }}
                />
              ) : (
                <IcaoInput
                  ref={arrIcaoRef}
                  label=""
                  value={form.arr_place}
                  onChangeText={(v) => set('arr_place', v)}
                  error={errors.arr_place}
                  recentPlaces={top2places}
                  allowHere={arrCustom}
                  onTemporaryPlaceSelect={(icao) => {
                    setArrCustom(true);
                    set('arr_place', icao);
                    if (!form.arr_utc || !isValidTime(form.arr_utc)) {
                      setTimeout(() => arrTimeRef.current?.focus(), 80);
                    }
                  }}
                  onConfirm={() => {
                    if (!form.arr_utc || !isValidTime(form.arr_utc)) {
                      setTimeout(() => arrTimeRef.current?.focus(), 80);
                    }
                  }}
                />
              )}
            </View>
            {activePlace === 'dep' ? (
              <View style={{ width: 120 }}>
              <SmartTimeInput
                ref={depTimeRef}
                label=""
                value={form.dep_utc}
                onChangeText={(v) => set('dep_utc', v)}
                error={errors.dep_utc}
                showNowBtn={false}
                onSubmitEditing={() => {
                  if (form.dep_place.trim() && isValidTime(form.dep_utc)) {
                    setActivePlace('arr');
                    setTimeout(() => arrIcaoRef.current?.focus(), 120);
                  }
                }}
              />
              </View>
            ) : (
              <View style={{ width: 120 }}>
              <SmartTimeInput
                ref={arrTimeRef}
                label=""
                value={form.arr_utc}
                onChangeText={(v) => set('arr_utc', v)}
                error={errors.arr_utc}
                showNowBtn={false}
              />
              </View>
            )}
          </View>
        </View>

        {/* Flight type */}
        <View style={styles.flightTypePicker}>
          {(['normal', 'touch_and_go', 'hot_refuel', 'sim'] as const).map((ft) => {
            const labels: Record<string, string> = {
              normal: t('normal'),
              touch_and_go: t('touch_and_go'),
              hot_refuel: t('hot_refuel'),
              sim: t('ffs_sim'),
            };
            const active = (form.flight_type ?? 'normal') === ft;
            return (
              <TouchableOpacity
                key={ft}
                style={[styles.flightTypeChip, active && styles.flightTypeChipActive]}
                onPress={() => {
                  set('flight_type', ft);
                  if (ft === 'normal' || ft === 'sim') set('stop_place', '');
                  if (ft === 'sim' && !form.sim_category) set('sim_category', 'FFS');
                  if (ft !== 'sim') set('sim_category', '');
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.flightTypeChipText, active && styles.flightTypeChipTextActive]}>
                  {labels[ft]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {form.flight_type === 'sim' && (
          <>
            <View style={styles.simCatRow}>
              {(['FFS','FTD','FNPT_II','FNPT_I','BITD','CPT_PPT','CBT'] as const).map((cat) => {
                const active = form.sim_category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.simCatBtn, active && styles.simCatBtnActive]}
                    onPress={() => set('sim_category', cat)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.simCatText, active && styles.simCatTextActive]}>
                      {cat.replace(/_/g, '/')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {(form.sim_category === 'CPT_PPT' || form.sim_category === 'CBT') && (
              <View style={styles.remarksWarning}>
                <Ionicons name="warning" size={14} color={Colors.warning} />
                <Text style={styles.remarksWarningText}>{t('sim_no_credit_warning')}</Text>
              </View>
            )}
          </>
        )}

        {/* Stop place for touch & go */}
        {form.flight_type === 'touch_and_go' && (
          <View style={styles.stopPlaceBlock}>
            <Text style={styles.stopPlaceLabel}>
              {t('touch_and_go')} — {t('hot_refuel_not_destination')}
            </Text>
            <View>
              <IcaoInput
                label=""
                value={form.stop_place ?? ''}
                onChangeText={(v) => {
                  set('stop_place', v);
                  setSelectedAppStop(null);
                  setSelectedRunwayStop(null);
                }}
                recentPlaces={top2places}
                placeholder="ICAO"
              />
              {form.stop_place && (() => {
                const runways = (runwayData as Record<string, number[]>)[form.stop_place?.toUpperCase() || ''] || [];
                const firstRunway = runways[0];
                const firstOpposite = firstRunway !== undefined ? (firstRunway + 180) % 360 : undefined;

                return (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                    {!selectedAppStop ? (
                      <>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated, borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
                            paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
                          }}
                          onPress={() => setSelectedAppStop('2d')}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>2D APP</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated, borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
                            paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
                          }}
                          onPress={() => setSelectedAppStop('3d')}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>3D APP</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated, borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
                            paddingHorizontal: 6, paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
                          }}
                          onPress={() => setSelectedAppStop(null)}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="arrow-back" size={12} color={Colors.textPrimary} />
                        </TouchableOpacity>
                        {firstRunway !== undefined ? (
                          <>
                            <TouchableOpacity
                              style={{
                                backgroundColor: selectedRunwayStop === firstRunway ? Colors.primary : Colors.elevated,
                                borderRadius: 6, borderWidth: 1,
                                borderColor: selectedRunwayStop === firstRunway ? Colors.primary : Colors.border,
                                paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
                              }}
                              onPress={() => {
                                setSelectedRunwayStop(firstRunway);
                                const newLine = `${form.stop_place?.toUpperCase()} ${selectedAppStop?.toUpperCase()} app rwy ${Math.round(firstRunway / 10).toString().padStart(2, '0')}`;
                                set('remarks', form.remarks ? `${form.remarks}\n${newLine}` : newLine);
                              }}
                              activeOpacity={0.75}
                            >
                              <Text style={{ color: selectedRunwayStop === firstRunway ? Colors.textInverse : Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>{String(firstRunway).padStart(3, '0')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={{
                                backgroundColor: selectedRunwayStop === firstOpposite ? Colors.primary : Colors.elevated,
                                borderRadius: 6, borderWidth: 1,
                                borderColor: selectedRunwayStop === firstOpposite ? Colors.primary : Colors.border,
                                paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center', justifyContent: 'center',
                              }}
                              onPress={() => {
                                setSelectedRunwayStop(firstOpposite);
                                const newLine = `${form.stop_place?.toUpperCase()} ${selectedAppStop?.toUpperCase()} app rwy ${Math.round(firstOpposite / 10).toString().padStart(2, '0')}`;
                                set('remarks', form.remarks ? `${form.remarks}\n${newLine}` : newLine);
                              }}
                              activeOpacity={0.75}
                            >
                              <Text style={{ color: selectedRunwayStop === firstOpposite ? Colors.textInverse : Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>{String(firstOpposite).padStart(3, '0')}</Text>
                            </TouchableOpacity>
                          </>
                        ) : null}
                      </>
                    )}
                  </View>
                );
              })()}
            </View>
          </View>
        )}

        {/* Stop place for hot refuel */}
        {form.flight_type === 'hot_refuel' && (
          <View style={styles.stopPlaceBlock}>
            <Text style={styles.stopPlaceLabel}>
              {t('hot_refuel')} — {t('hot_refuel_not_destination')}
            </Text>
            <IcaoInput
              label=""
              value={form.stop_place ?? ''}
              onChangeText={(v) => set('stop_place', v)}
              recentPlaces={top2places}
              placeholder="ICAO"
            />
          </View>
        )}

        {/* ── Flight time ── */}
        <Text style={styles.section}>{t('flight_time_section')}</Text>

        <View style={styles.card}>
          {/* Total flygtid — auto från block-off/block-on */}
          <View style={styles.totalTimeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardFieldLabel}>{t('total_flight_time')}</Text>
              {editingTotalTime ? (
                <TextInput
                  style={[styles.totalTimeValue, styles.totalTimeValueFilled, { textAlign: 'center', paddingVertical: 8 }]}
                  value={totalTimeEditValue}
                  onChangeText={setTotalTimeEditValue}
                  onBlur={() => {
                    // Parsera HH:MM eller decimal när vi är klara
                    let decimal = 0;
                    if (totalTimeEditValue.includes(':')) {
                      const [h, m] = totalTimeEditValue.split(':');
                      const hh = parseInt((h || '0').replace(/\D/g, '') || '0', 10) || 0;
                      const mm = Math.min(59, parseInt((m || '0').replace(/\D/g, '') || '0', 10) || 0);
                      decimal = hh + mm / 60;
                    } else {
                      decimal = parseFloat(totalTimeEditValue) || 0;
                    }
                    if (decimal > 0) {
                      set('total_time', String(decimal.toFixed(2)));
                    }
                    setEditingTotalTime(false);
                  }}
                  onFocus={() => {
                    // När vi fokuserar på fältet, sätt det till den nuvarande tiden
                    setTotalTimeEditValue(form.total_time ? decimalToHHMM(parseFloat(form.total_time)) : '');
                  }}
                  placeholder="0:00"
                  keyboardType="numbers-and-punctuation"
                  placeholderTextColor={Colors.textMuted}
                  autoFocus
                />
              ) : (
                <TouchableOpacity
                  style={styles.totalTimeDisplay}
                  onPress={() => setEditingTotalTime(true)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.totalTimeValue,
                    form.total_time ? styles.totalTimeValueFilled : styles.totalTimeValueEmpty,
                  ]}>
                    {form.total_time ? decimalToHHMM(parseFloat(form.total_time)) : '—'}
                  </Text>
                </TouchableOpacity>
              )}
              {errors.total_time && <Text style={styles.errorInline}>{errors.total_time}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardFieldLabel}>{t('your_role')}</Text>
              <View style={styles.roleGrid}>
                <View style={styles.roleRow}>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      role === 'pic' && styles.roleBtnActive,
                      (role === 'dual' || role === 'picus') && styles.roleBtnDisabled,
                    ]}
                    disabled={role === 'dual' || role === 'picus'}
                    onPress={() => handleRoleChange('pic')}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleBtnText, role === 'pic' && styles.roleBtnTextActive]}>PIC</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      role === 'co_pilot' && styles.roleBtnActive,
                      (role === 'dual' || role === 'picus') && styles.roleBtnDisabled,
                    ]}
                    disabled={role === 'dual' || role === 'picus'}
                    onPress={() => handleRoleChange('co_pilot')}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleBtnText, role === 'co_pilot' && styles.roleBtnTextActive]}>{t('co_pilot')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.roleRow}>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      fi && role === 'pic' && styles.roleBtnActive,
                      role !== 'pic' && styles.roleBtnDisabled,
                    ]}
                    disabled={role !== 'pic'}
                    onPress={toggleFi}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleBtnText, fi && role === 'pic' && styles.roleBtnTextActive]}>FI</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.roleBtn, role === 'dual' && styles.roleBtnActive]}
                    onPress={toggleDual}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleBtnText, role === 'dual' && styles.roleBtnTextActive]}>DUAL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.roleBtn, role === 'picus' && styles.roleBtnActive]}
                    onPress={togglePicus}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleBtnText, role === 'picus' && styles.roleBtnTextActive]}>PICUS</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.specialRoleBtn}
                  onPress={() => setShowSpecialRole(true)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="options-outline" size={13} color={Colors.primary} />
                  <Text style={styles.specialRoleBtnText}>
                    {['spic','ferry_pic','observer','relief_crew'].includes(role)
                      ? t(`role_${role}` as any)
                      : examinerOverlay
                        ? t('role_examiner')
                        : safetyPilotOverlay
                          ? t('role_safety_pilot')
                          : t('special_role')}
                  </Text>
                  <Ionicons name="chevron-down" size={12} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <Text style={[styles.cardFieldLabel, { marginTop: -6, marginBottom: 2 }]}>{t('flight_rules')}</Text>
          <SegmentControl
            options={[
              { label: 'VFR', value: 'VFR' },
              { label: 'IFR', value: 'IFR' },
              { label: 'Y/Z flight', value: 'Y' },
            ]}
            value={(form.flight_rules === 'Z' || form.flight_rules === 'Mixed') ? 'Y' : (form.flight_rules ?? 'VFR')}
            onChange={(v) => set('flight_rules', v)}
          />
        </View>

        {/* ── Landings ── */}
        <Text style={styles.section}>{t('landings')}</Text>
        <View style={styles.card}>
          <View style={styles.counterGrid}>
            <Counter label={t('day')} value={form.landings_day} onChange={(v) => set('landings_day', v)} />
            <View style={styles.counterDivider} />
            <Counter label={t('night')} value={form.landings_night} onChange={(v) => set('landings_night', v)} />
          </View>
          {(form.flight_rules === 'IFR' || form.flight_rules === 'Y' || form.flight_rules === 'Z') && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -14, paddingHorizontal: 14, marginTop: 10, paddingBottom: 8, gap: 8 }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '700' }}>Max FL</Text>
              <TextInput
                style={{
                  backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                  paddingHorizontal: 10, paddingVertical: 8, color: Colors.textPrimary,
                  fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], width: 70, textAlign: 'center',
                }}
                value={form.max_fl ?? ''}
                onChangeText={(v) => set('max_fl', v.replace(/\D/g, ''))}
                placeholder="—"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                maxLength={3}
              />
              <View style={{ flex: 1 }} />
              {(() => {
                const hasArrival = form.arr_place && form.arr_place.trim();
                const runways = hasArrival ? ((runwayData as Record<string, number[]>)[form.arr_place.toUpperCase()] || []) : [];
                const firstRunway = runways[0];
                const firstOpposite = firstRunway !== undefined ? (firstRunway + 180) % 360 : undefined;

                return (
                  <>
                    {!selectedApp ? (
                      <>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                            paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
                          }}
                          onPress={() => setSelectedApp('2d')}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>2D APP</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                            paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
                          }}
                          onPress={() => setSelectedApp('3d')}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>3D APP</Text>
                        </TouchableOpacity>
                      </>
                    ) : hasArrival && firstRunway !== undefined ? (
                      <>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: Colors.border,
                            paddingHorizontal: 8,
                            paddingVertical: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 40,
                            marginLeft: -30,
                          }}
                          onPress={() => setSelectedApp(null)}
                          activeOpacity={0.75}
                        >
                          <Ionicons name="arrow-back" size={16} color={Colors.textPrimary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            backgroundColor: selectedRunway === firstRunway ? Colors.primary : Colors.elevated,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: selectedRunway === firstRunway ? Colors.primary : Colors.border,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 70,
                          }}
                          onPress={() => {
                            setSelectedRunway(firstRunway);
                            const newLine = `${form.arr_place?.toUpperCase()} ${selectedApp?.toUpperCase()} app rwy ${Math.round(firstRunway / 10).toString().padStart(2, '0')}`;
                            set('remarks', form.remarks && form.flight_type === 'touch_and_go' ? `${form.remarks}\n${newLine}` : newLine);
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: selectedRunway === firstRunway ? Colors.textInverse : Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>{String(firstRunway).padStart(3, '0')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{
                            backgroundColor: selectedRunway === firstOpposite ? Colors.primary : Colors.elevated,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: selectedRunway === firstOpposite ? Colors.primary : Colors.border,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 70,
                          }}
                          onPress={() => {
                            setSelectedRunway(firstOpposite);
                            const newLine = `${form.arr_place?.toUpperCase()} ${selectedApp?.toUpperCase()} app rwy ${Math.round(firstOpposite / 10).toString().padStart(2, '0')}`;
                            set('remarks', form.remarks && form.flight_type === 'touch_and_go' ? `${form.remarks}\n${newLine}` : newLine);
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: selectedRunway === firstOpposite ? Colors.textInverse : Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>{String(firstOpposite).padStart(3, '0')}</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={{
                            backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                            paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center',
                          }}
                          onPress={() => setSelectedApp(null)}
                          activeOpacity={0.75}
                        >
                          <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>Tillbaka</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                );
              })()}
            </View>
          )}
          {(() => {
            const runways = (runwayData as Record<string, number[]>)[form.arr_place?.toUpperCase() || ''] || [];
            if (runways.length <= 1 || !selectedApp) return null;

            return (
              <View style={{ flexDirection: 'column', marginHorizontal: -14, paddingHorizontal: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <View style={{ flexDirection: 'column', gap: 8 }}>
                    {runways.slice(1).map((heading: number) => {
                  const oppositeHeading = (heading + 180) % 360;
                  return (
                    <View key={heading} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TouchableOpacity
                        style={{
                          backgroundColor: selectedRunway === heading ? Colors.primary : Colors.elevated,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: selectedRunway === heading ? Colors.primary : Colors.border,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 70,
                        }}
                        onPress={() => {
                          setSelectedRunway(heading);
                          const newLine = `${form.arr_place?.toUpperCase()} ${selectedApp?.toUpperCase()} app rwy ${Math.round(heading / 10).toString().padStart(2, '0')}`;
                          set('remarks', form.remarks && form.flight_type === 'touch_and_go' ? `${form.remarks}\n${newLine}` : newLine);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ color: selectedRunway === heading ? Colors.textInverse : Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>{String(heading).padStart(3, '0')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{
                          backgroundColor: selectedRunway === oppositeHeading ? Colors.gold : Colors.elevated,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: selectedRunway === oppositeHeading ? Colors.gold : Colors.border,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 70,
                        }}
                        onPress={() => {
                          setSelectedRunway(oppositeHeading);
                          const newLine = `${form.arr_place?.toUpperCase()} ${selectedApp?.toUpperCase()} app rwy ${Math.round(oppositeHeading / 10).toString().padStart(2, '0')}`;
                          set('remarks', form.remarks && form.flight_type === 'touch_and_go' ? `${form.remarks}\n${newLine}` : newLine);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ color: selectedRunway === oppositeHeading ? Colors.textInverse : Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>{String(oppositeHeading).padStart(3, '0')}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
                  </View>
                </View>
              </View>
            );
          })()}
          {(() => {
            const total = parseFloat(form.total_time) || 0;
            const pct = (v: string) => {
              const n = parseFloat(v) || 0;
              return total > 0 ? Math.round((n / total) * 100) : 0;
            };
            const cap = (n: number) => Math.min(Math.max(0, n), total || n);
            const setPct = (key: 'ifr' | 'vfr' | 'night' | 'nvg', p: number) => {
              Haptics.selectionAsync();
              const val = (total * p / 100).toFixed(2);
              set(key, String(val));
              setRawTime((r) => { const n = { ...r }; delete n[key]; return n; });
              if (key === 'ifr') {
                set('vfr', String((total - parseFloat(val)).toFixed(2)));
                setRawTime((r) => { const n = { ...r }; delete n.vfr; return n; });
              } else if (key === 'vfr') {
                set('ifr', String((total - parseFloat(val)).toFixed(2)));
                setRawTime((r) => { const n = { ...r }; delete n.ifr; return n; });
              } else if (key === 'night') {
                // Om night är 100% av total_time, konvertera alla landningar till night landings
                if (p >= 99.5) {
                  const dayLandings = parseInt(form.landings_day) || 0;
                  const nightLandings = parseInt(form.landings_night) || 0;
                  const totalLandings = dayLandings + nightLandings;
                  set('landings_day', '0');
                  set('landings_night', String(totalLandings));
                }
              } else if (key === 'nvg') {
                const nvgN = parseFloat(val) || 0;
                const nightN = parseFloat(form.night) || 0;
                if (nvgN > nightN) {
                  set('night', String(nvgN.toFixed(2)));
                  setRawTime((r) => { const n = { ...r }; delete n.night; return n; });
                }
              }
            };
            const formatForInput = (decimal: string) => {
              const n = parseFloat(decimal);
              if (!n || isNaN(n)) return '';
              return decimalToHHMM(n);
            };
            const parseRaw = (raw: string): number => {
              if (raw.trim() === '') return 0;
              if (raw.includes(':')) {
                const [h, m] = raw.split(':');
                const hh = parseInt((h || '0').replace(/\D/g, '') || '0', 10) || 0;
                const mm = Math.min(59, parseInt((m || '0').replace(/\D/g, '') || '0', 10) || 0);
                return hh + mm / 60;
              }
              const d = raw.replace(/\D/g, '');
              if (d.length === 0) return 0;
              return parseInt(d, 10) || 0;
            };
            const onHhmmChange = (key: 'ifr' | 'vfr' | 'night' | 'nvg', raw: string) => {
              setRawTime((r) => ({ ...r, [key]: raw }));
              let decimal = cap(parseRaw(raw));
              set(key, String(decimal));
              if (key === 'ifr') {
                const remain = Math.max(0, total - decimal);
                set('vfr', String(remain.toFixed(2)));
                setRawTime((r) => { const n = { ...r }; delete n.vfr; return n; });
              } else if (key === 'vfr') {
                const remain = Math.max(0, total - decimal);
                set('ifr', String(remain.toFixed(2)));
                setRawTime((r) => { const n = { ...r }; delete n.ifr; return n; });
              } else if (key === 'night') {
                // Om night är 100% av total_time, konvertera alla landningar till night landings
                const pct = total > 0 ? (decimal / total) * 100 : 0;
                if (pct >= 99.5) {
                  const dayLandings = parseInt(form.landings_day) || 0;
                  const nightLandings = parseInt(form.landings_night) || 0;
                  const totalLandings = dayLandings + nightLandings;
                  set('landings_day', '0');
                  set('landings_night', String(totalLandings));
                }
              } else if (key === 'nvg') {
                const nightN = parseFloat(form.night) || 0;
                if (decimal > nightN) {
                  set('night', String(decimal.toFixed(2)));
                  setRawTime((r) => { const n = { ...r }; delete n.night; return n; });
                }
              }
            };
            const onHhmmBlur = (key: 'ifr' | 'vfr' | 'night' | 'nvg') => {
              setRawTime((r) => { const n = { ...r }; delete n[key]; return n; });
            };
            const valueFor = (key: 'ifr' | 'vfr' | 'night' | 'nvg', decimal: string) =>
              rawTime[key] !== undefined ? rawTime[key]! : formatForInput(decimal);
            const mixed = form.flight_rules === 'Y' || form.flight_rules === 'Z' || form.flight_rules === 'Mixed';
            const vfrFirst = form.flight_rules === 'Z';
            const ifrRow = (
              <View key="ifr-block">
                <Text style={styles.cardFieldLabel}>IFR ({pct(form.ifr)}%)</Text>
                <View style={styles.sliderRow}>
                  <TextInput
                    style={[styles.nvgInput, styles.sliderInput]}
                    value={valueFor('ifr', form.ifr)}
                    onChangeText={(v) => onHhmmChange('ifr', v)}
                    onBlur={() => onHhmmBlur('ifr')}
                    placeholder="0:00"
                    keyboardType="numbers-and-punctuation"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <View style={styles.sliderTrack}>
                    <Slider
                      style={{ flex: 1, height: 36 }}
                      minimumValue={0}
                      maximumValue={100}
                      step={10}
                      value={pct(form.ifr)}
                      onValueChange={(v) => setPct('ifr', v)}
                      minimumTrackTintColor={Colors.primary}
                      maximumTrackTintColor={Colors.border}
                      thumbTintColor={Colors.primary}
                    />
                    <View style={styles.sliderDots}>
                      {[0,10,20,30,40,50,60,70,80,90,100].map(d => (
                        <View key={d} style={[styles.sliderDot, pct(form.ifr) >= d && styles.sliderDotActive]} />
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            );
            const vfrRow = (
              <View key="vfr-block">
                <Text style={styles.cardFieldLabel}>VFR ({pct(form.vfr ?? '0')}%)</Text>
                <View style={styles.sliderRow}>
                  <TextInput
                    style={[styles.nvgInput, styles.sliderInput]}
                    value={valueFor('vfr', form.vfr ?? '0')}
                    onChangeText={(v) => onHhmmChange('vfr', v)}
                    onBlur={() => onHhmmBlur('vfr')}
                    placeholder="0:00"
                    keyboardType="numbers-and-punctuation"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <View style={styles.sliderTrack}>
                    <Slider
                      style={{ flex: 1, height: 36 }}
                      minimumValue={0}
                      maximumValue={100}
                      step={10}
                      value={pct(form.vfr ?? '0')}
                      onValueChange={(v) => setPct('vfr', v)}
                      minimumTrackTintColor={Colors.primary}
                      maximumTrackTintColor={Colors.border}
                      thumbTintColor={Colors.primary}
                    />
                    <View style={styles.sliderDots}>
                      {[0,10,20,30,40,50,60,70,80,90,100].map(d => (
                        <View key={d} style={[styles.sliderDot, pct(form.vfr ?? '0') >= d && styles.sliderDotActive]} />
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            );
            return (
              <>
                {mixed && (vfrFirst ? <>{vfrRow}{ifrRow}</> : <>{ifrRow}{vfrRow}</>)}

                <Text style={styles.cardFieldLabel}>{t('night')} ({pct(form.night)}%)</Text>
                <View style={styles.sliderRow}>
                  <TextInput
                    style={[styles.nvgInput, styles.sliderInput]}
                    value={valueFor('night', form.night)}
                    onChangeText={(v) => onHhmmChange('night', v)}
                    onBlur={() => onHhmmBlur('night')}
                    placeholder="0:00"
                    keyboardType="numbers-and-punctuation"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <View style={styles.sliderTrack}>
                    <Slider
                      style={{ flex: 1, height: 36 }}
                      minimumValue={0}
                      maximumValue={100}
                      step={10}
                      value={pct(form.night)}
                      onValueChange={(v) => setPct('night', v)}
                      minimumTrackTintColor={Colors.primary}
                      maximumTrackTintColor={Colors.border}
                      thumbTintColor={Colors.primary}
                    />
                    <View style={styles.sliderDots}>
                      {[0,10,20,30,40,50,60,70,80,90,100].map(d => (
                        <View key={d} style={[styles.sliderDot, pct(form.night) >= d && styles.sliderDotActive]} />
                      ))}
                    </View>
                  </View>
                </View>

                {form.flight_rules !== 'IFR' && (
                  <>
                    <Text style={styles.cardFieldLabel}>NVG ({pct(form.nvg ?? '0')}%)</Text>
                    <View style={styles.sliderRow}>
                      <TextInput
                        style={[styles.nvgInput, styles.sliderInput]}
                        value={valueFor('nvg', form.nvg ?? '0')}
                        onChangeText={(v) => onHhmmChange('nvg', v)}
                        onBlur={() => onHhmmBlur('nvg')}
                        placeholder="0:00"
                        keyboardType="numbers-and-punctuation"
                        placeholderTextColor={Colors.textMuted}
                      />
                      <View style={styles.sliderTrack}>
                        <Slider
                          style={{ flex: 1, height: 36 }}
                          minimumValue={0}
                          maximumValue={100}
                          step={10}
                          value={pct(form.nvg ?? '0')}
                          onValueChange={(v) => setPct('nvg', v)}
                          minimumTrackTintColor={Colors.primary}
                          maximumTrackTintColor={Colors.border}
                          thumbTintColor={Colors.primary}
                        />
                        <View style={styles.sliderDots}>
                          {[0,10,20,30,40,50,60,70,80,90,100].map(d => (
                            <View key={d} style={[styles.sliderDot, pct(form.nvg ?? '0') >= d && styles.sliderDotActive]} />
                          ))}
                        </View>
                      </View>
                    </View>
                  </>
                )}
              </>
            );
          })()}
        </View>

        {/* ── Remarks ── */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <FormField
              label={t('remarks')}
              value={form.remarks}
              onChangeText={(v) => set('remarks', v)}
              placeholder="Optional free text…"
              multiline
              numberOfLines={2}
              style={{ minHeight: 60, textAlignVertical: 'top' }}
            />
          </View>
          <TouchableOpacity
            style={{
              width: 78, alignSelf: 'stretch', marginTop: 23, marginBottom: 4,
              backgroundColor: milOps.size > 0 ? Colors.gold + '18' : Colors.elevated,
              borderRadius: 8, borderWidth: 1.5,
              borderColor: milOps.size > 0 ? Colors.gold : Colors.border,
              alignItems: 'center', justifyContent: 'center',
            }}
            onPress={() => setShowMilOp(true)}
            activeOpacity={0.75}
          >
            <Text style={{
              color: milOps.size > 0 ? Colors.gold : Colors.textMuted, fontSize: 12, fontWeight: '900',
              letterSpacing: 0.3, textAlign: 'center', lineHeight: 16,
            }}>
              {milOps.size > 0 ? `TACTICAL\n(${milOps.size})` : 'TACTICAL'}
            </Text>
          </TouchableOpacity>
        </View>
        {role === 'picus' && (
          <View style={styles.remarksWarning}>
            <Ionicons name="warning" size={14} color={Colors.warning} />
            <Text style={styles.remarksWarningText}>{t('picus_requires_instructor')}</Text>
          </View>
        )}

        {/* Approach type quick selection — T&G section */}
        {form.flight_type === 'touch_and_go' && selectedAppStop && selectedRunwayStop && (() => {
          const approachTypes = selectedAppStop === '2d'
            ? ['VOR', 'NDB', 'LOC', 'DME', 'LNAV']
            : ['GBAS', 'GLS', 'ILS', 'PAR', 'RNAV'];

          const hasApproachType = approachTypes.some(type => form.remarks.includes(type));
          const isTngDone = form.remarks.includes(form.stop_place?.toUpperCase() || '') && hasApproachType;

          if (isTngDone) return null;

          return (
            <>
              {!hasApproachType && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '700', minWidth: 44 }}>
                    {form.stop_place?.toUpperCase()}:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
                    {approachTypes.map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[styles.chip, styles.chipAdd]}
                        onPress={() => {
                          const currentRemarks = form.remarks;
                          const regex = /(2D|3D)\s+app/i;
                          const newRemarks = currentRemarks.replace(regex, type);
                          set('remarks', newRemarks);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText]} numberOfLines={1}>{type}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {hasApproachType && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '700', minWidth: 44 }}>
                    {form.stop_place?.toUpperCase()}:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
                    {['L', 'C', 'R'].map((position) => (
                      <TouchableOpacity
                        key={position}
                        style={[styles.chip, styles.chipAdd]}
                        onPress={() => {
                          const currentRemarks = form.remarks;
                          const stopPlacePattern = `${form.stop_place?.toUpperCase()}.*?rwy (\\d{2,3})[LCR]?`;
                          const regex = new RegExp(stopPlacePattern, 'i');
                          const newRemarks = currentRemarks.replace(regex, (match) => match.replace(/rwy \d{2,3}[LCR]?/i, `rwy ${Math.round(selectedRunwayStop / 10).toString().padStart(2, '0')}${position}`));
                          set('remarks', newRemarks);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText]} numberOfLines={1}>{Math.round(selectedRunwayStop / 10).toString().padStart(2, '0')}{position}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </>
          );
        })()}

        {/* Approach type quick selection — Arrival section */}
        {(() => {
          if (form.flight_type === 'touch_and_go') {
            const tngApproachTypes = selectedAppStop === '2d'
              ? ['VOR', 'NDB', 'LOC', 'DME', 'LNAV']
              : ['GBAS', 'GLS', 'ILS', 'PAR', 'RNAV'];
            const tngHasApproachType = tngApproachTypes.some(type => form.remarks.includes(type));
            const isTngDone = form.remarks.includes(form.stop_place?.toUpperCase() || '') && tngHasApproachType;

            if (!isTngDone || !selectedApp || !selectedRunway) return null;
          } else {
            if (!selectedApp || !selectedRunway) return null;
          }

          return (() => {
            const approachTypes = selectedApp === '2d'
              ? ['VOR', 'NDB', 'LOC', 'DME', 'LNAV']
              : ['GBAS', 'GLS', 'ILS', 'PAR', 'RNAV'];

            const hasApproachType = approachTypes.some(type => form.remarks.includes(type));

          return (
            <>
              {!hasApproachType && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '700', minWidth: 44 }}>
                    {form.arr_place?.toUpperCase()}:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
                    {approachTypes.map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[styles.chip, styles.chipAdd]}
                        onPress={() => {
                          const currentRemarks = form.remarks;
                          const regex = /(2D|3D)\s+app/i;
                          const newRemarks = currentRemarks.replace(regex, type);
                          set('remarks', newRemarks);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText]} numberOfLines={1}>{type}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {hasApproachType && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '700', minWidth: 44 }}>
                    {form.arr_place?.toUpperCase()}:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
                    {['L', 'C', 'R'].map((position) => (
                      <TouchableOpacity
                        key={position}
                        style={[styles.chip, styles.chipAdd]}
                        onPress={() => {
                          const currentRemarks = form.remarks;
                          const arrPlacePattern = `${form.arr_place?.toUpperCase()}.*?rwy (\\d{2,3})[LCR]?`;
                          const regex = new RegExp(arrPlacePattern, 'i');
                          const newRemarks = currentRemarks.replace(regex, (match) => match.replace(/rwy \d{2,3}[LCR]?/i, `rwy ${Math.round(selectedRunway / 10).toString().padStart(2, '0')}${position}`));
                          set('remarks', newRemarks);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText]} numberOfLines={1}>{Math.round(selectedRunway / 10).toString().padStart(2, '0')}{position}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </>
          );
          })();
        })()}

        {!selectedApp || !selectedRunway ? (() => {
          const suggestions: string[] = [];
          const rules = form.flight_rules;
          const hasIfrPortion = rules === 'IFR' || rules === 'Y' || rules === 'Z' || rules === 'Mixed' || (parseFloat(form.ifr) || 0) > 0;
          const hasVfrPortion = rules === 'VFR' || rules === 'Y' || rules === 'Z' || rules === 'Mixed' || (parseFloat(form.vfr) || 0) > 0;
          // Flygtyp-specifika förslag (högsta prio)
          if (form.flight_type === 'sim') suggestions.push('Exercise: ');
          if (form.flight_type === 'hot_refuel') suggestions.push('Fuel stop: ');
          if (form.flight_type === 'touch_and_go') suggestions.push('T&G: ');
          // Roll-specifika
          if (role === 'picus') suggestions.push('PICUS u/s Capt. ');
          else if (role === 'spic') suggestions.push('SPIC exercise: ');
          else if (role === 'dual') suggestions.push('FI: ');
          else if (role === 'ferry_pic') suggestions.push('Ferry: ');
          if (examinerOverlay && role === 'pic') suggestions.push('TRE: ');
          if (safetyPilotOverlay && role === 'co_pilot') suggestions.push('Under hood: ');
          // Flygregler
          if (hasIfrPortion) { suggestions.push('ILS: '); suggestions.push('MaxFL: '); }
          if (hasVfrPortion && !hasIfrPortion) suggestions.push('Route: ');
          // Natt / NVG
          if ((parseFloat(form.night) || 0) > 0) suggestions.push('Night ldg: ');
          if ((parseFloat(form.nvg) || 0) > 0) suggestions.push('NVG: ');

          const unique = [...new Set(suggestions)].slice(0, 3);
          if (unique.length === 0) return null;
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
              {unique.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, styles.chipAdd]}
                  onPress={() => set('remarks', form.remarks ? `${form.remarks.trimEnd()} · ${r}` : r)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={10} color={Colors.primary} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipText]} numberOfLines={1}>{r.trim()}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })() : null}

        {/* ── Media (Bild eller Video) ── */}
        <View style={{ marginTop: 4 }}>
          {photoUri ? (
            <View style={{ borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
              {mediaType === 'video' ? (
                <Video
                  source={{ uri: photoUri }}
                  style={{ width: '100%', height: 180 }}
                  resizeMode={ResizeMode.COVER}
                  isLooping
                  isMuted
                  shouldPlay
                />
              ) : (
                <Image source={{ uri: photoUri }} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="cover" />
              )}
              <TouchableOpacity
                style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
                }}
                onPress={() => { setPhotoUri(null); setMediaType('image'); }}
              >
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  paddingVertical: 12, borderRadius: 10,
                  backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
                }}
                onPress={() => pickMedia('image')}
                activeOpacity={0.75}
              >
                <Ionicons name="image-outline" size={16} color={Colors.textMuted} />
                <Text style={{ color: Colors.textMuted, fontSize: 13, fontWeight: '600' }}>Bild</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  paddingVertical: 12, borderRadius: 10,
                  backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
                }}
                onPress={() => pickMedia('video')}
                activeOpacity={0.75}
              >
                <Ionicons name="videocam-outline" size={16} color={Colors.textMuted} />
                <Text style={{ color: Colors.textMuted, fontSize: 13, fontWeight: '600' }}>Video</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Spara ── */}
        {(() => {
          const needsMixedSplit = form.flight_rules === 'Y' || form.flight_rules === 'Z' || form.flight_rules === 'Mixed';
          const totalN = parseFloat(form.total_time) || 0;
          const sumN = (parseFloat(form.ifr) || 0) + (parseFloat(form.vfr) || 0);
          const mixedMissing = needsMixedSplit && (totalN <= 0 || Math.abs(sumN - totalN) > 0.05);
          const disabled = saving || mixedMissing;
          return (
            <TouchableOpacity
              style={[styles.saveBtn, disabled && { opacity: 0.5 }]}
              onPress={save}
              disabled={disabled}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
                  <Text style={styles.saveBtnText}>
                    {mixedMissing ? t('mixed_split_required') : isEdit ? t('save_changes') : t('save')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })()}

      </ScrollView>

      <Modal
        visible={showSpecialRole}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSpecialRole(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowSpecialRole(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('special_role')}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {(['spic','ferry_pic','observer','relief_crew'] as const).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.specialRow, role === r && styles.specialRowActive]}
                  onPress={() => { handleRoleChange(r); setShowSpecialRole(false); }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={role === r ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={role === r ? Colors.primary : Colors.textMuted}
                  />
                  <Text style={styles.specialLabel}>{t(`role_${r}` as any)}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[
                  styles.specialRow,
                  role !== 'pic' && styles.specialDisabled,
                  examinerOverlay && styles.specialRowActive,
                ]}
                disabled={role !== 'pic'}
                onPress={toggleExaminer}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={examinerOverlay ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={examinerOverlay ? Colors.primary : Colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.specialLabel}>{t('role_examiner')}</Text>
                  <Text style={styles.specialHint}>{t('role_examiner_hint')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.specialRow,
                  role !== 'co_pilot' && styles.specialDisabled,
                  safetyPilotOverlay && styles.specialRowActive,
                ]}
                disabled={role !== 'co_pilot'}
                onPress={toggleSafetyPilot}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={safetyPilotOverlay ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={safetyPilotOverlay ? Colors.primary : Colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.specialLabel}>{t('role_safety_pilot')}</Text>
                  <Text style={styles.specialHint}>{t('role_safety_pilot_hint')}</Text>
                </View>
              </TouchableOpacity>
              {['spic','ferry_pic','observer','relief_crew'].includes(role) && (
                <TouchableOpacity
                  style={styles.specialRow}
                  onPress={() => { handleRoleChange('pic'); setShowSpecialRole(false); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle-outline" size={18} color={Colors.danger} />
                  <Text style={[styles.specialLabel, { color: Colors.danger }]}>
                    {t('reset_special_role')}
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={form.date ? new Date(form.date) : new Date()}
          mode="date"
          display="calendar"
          maximumDate={new Date()}
          onChange={(event, selectedDate) => {
            setShowDatePicker(false);
            if (event.type === 'set' && selectedDate) {
              set('date', selectedDate.toISOString().split('T')[0]);
            }
          }}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowDatePicker(false)}>
            <Pressable style={styles.datePickerSheet} onPress={(e) => e.stopPropagation()}>
              <TouchableOpacity
                style={styles.datePickerDone}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.datePickerDoneText}>{t('done') ?? 'Klar'}</Text>
              </TouchableOpacity>
              <DateTimePicker
                value={form.date ? new Date(form.date) : new Date()}
                mode="date"
                display="inline"
                maximumDate={new Date()}
                themeVariant="dark"
                onChange={(_, selectedDate) => {
                  if (selectedDate) set('date', selectedDate.toISOString().split('T')[0]);
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <Modal
        visible={showTypeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTypeModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowTypeModal(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('saved_aircraft_types')}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {recentTypes.length === 0 ? (
                <Text style={styles.modalEmpty}>{t('no_saved_aircraft_types')}</Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.modalItem}
                    onPress={() => { onTypeSelect(recentTypes[0]); setShowTypeModal(false); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="star" size={12} color={Colors.gold} />
                    <Text style={styles.modalItemText}>{recentTypes[0]}</Text>
                    <Text style={styles.modalItemSub}>{t('most_recent')}</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {[0, 1, 2].map(col => (
                      <View key={col} style={{ flex: 1 }}>
                        {recentTypes.slice(1).filter((_, i) => Math.floor(i / 9) === col).map((type) => (
                          <TouchableOpacity
                            key={type}
                            style={[styles.modalItem, { paddingVertical: 10 }]}
                            onPress={() => { onTypeSelect(type); setShowTypeModal(false); }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.modalItemText, { fontSize: 13 }]}>{type}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={styles.modalAddItem}
                onPress={() => {
                  setShowTypeModal(false);
                  setTimeout(() => setShowAircraftModal(true), 200);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle" size={18} color={Colors.primary} />
                <Text style={styles.modalAddText}>{t('add_new_aircraft_type')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showRegModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRegModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowRegModal(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {t('saved_registrations')} {form.aircraft_type ? `— ${form.aircraft_type}` : ''}
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: 10, marginBottom: 8 }}>Hold to edit or remove</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {recentRegs.length === 0 ? (
                <Text style={styles.modalEmpty}>{t('no_saved_registrations')}</Text>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.modalItem}
                    onPress={() => { set('registration', recentRegs[0]); setShowRegModal(false); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="star" size={12} color={Colors.gold} />
                    <Text style={styles.modalItemText}>{recentRegs[0]}</Text>
                    <Text style={styles.modalItemSub}>{t('most_recent')}</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {[0, 1, 2].map(col => (
                      <View key={col} style={{ flex: 1 }}>
                        {recentRegs.slice(1).filter((_, i) => Math.floor(i / 9) === col).map((r) => (
                          <TouchableOpacity
                            key={r}
                            style={[styles.modalItem, { paddingVertical: 10 }]}
                            onPress={() => { set('registration', r); setShowRegModal(false); }}
                            onLongPress={() => {
                              Alert.alert(r, 'Edit or remove this registration?', [
                                { text: t('cancel'), style: 'cancel' },
                                ...(Platform.OS === 'ios' ? [{ text: 'Edit', onPress: () => {
                                  Alert.prompt('Edit registration', '', async (newReg) => {
                                    if (!newReg?.trim()) return;
                                    const upper = newReg.trim().toUpperCase();
                                    const { getDatabase } = await import('../../db/database');
                                    const db = await getDatabase();
                                    await db.runAsync('UPDATE flights SET registration=? WHERE registration=?', [upper, r]);
                                    await db.runAsync('UPDATE aircraft_registry SET registration=? WHERE registration=?', [upper, r]);
                                    const updated = await getRecentRegistrations(form.aircraft_type);
                                    setRecentRegs(updated);
                                  }, 'plain-text', r);
                                }}] : []),
                                { text: 'Remove', style: 'destructive', onPress: async () => {
                                  const count = await flagFlightsByRegistration(r);
                                  await deleteRegistrationFromRegistry(r);
                                  const updated = await getRecentRegistrations(form.aircraft_type);
                                  setRecentRegs(updated);
                                  if (count > 0) setReviewPromptCount(count);
                                }},
                              ]);
                            }}
                            delayLongPress={600}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.modalItemText, { fontSize: 13 }]}>{r}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={styles.modalAddItem}
                onPress={() => {
                  setShowRegModal(false);
                  setTimeout(() => {
                    Alert.prompt(
                      t('new_registration'),
                      `${t('add_registration_for')} ${form.aircraft_type}`,
                      async (reg) => {
                        const r = reg?.trim().toUpperCase();
                        if (!r) return;
                        await addToAircraftRegistry(form.aircraft_type, r);
                        const updated = await getRecentRegistrations(form.aircraft_type);
                        setRecentRegs(updated);
                        set('registration', r);
                      },
                      'plain-text',
                      '',
                    );
                  }, 200);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle" size={18} color={Colors.primary} />
                <Text style={styles.modalAddText}>{t('add_new_registration')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showPilotModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPilotModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowPilotModal(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('saved_second_pilots')}</Text>
            <Text style={{ color: Colors.textMuted, fontSize: 10, marginBottom: 8 }}>Hold to edit or remove</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {recentPilots.length === 0 ? (
                <Text style={styles.modalEmpty}>{t('no_saved_pilots')}</Text>
              ) : (
                (() => {
                  const shortName = (name: string) => {
                    const parts = name.trim().split(/\s+/);
                    if (parts.length < 2) return name;
                    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
                  };
                  return (<>
                    <TouchableOpacity
                      style={styles.modalItem}
                      onPress={() => { set('second_pilot', recentPilots[0]); setShowPilotModal(false); }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="star" size={12} color={Colors.gold} />
                      <Text style={styles.modalItemText}>{shortName(recentPilots[0])}</Text>
                      <Text style={styles.modalItemSub}>{t('most_recent')}</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {[0, 1, 2].map(col => (
                        <View key={col} style={{ flex: 1 }}>
                          {recentPilots.slice(1).filter((_, i) => Math.floor(i / 9) === col).map((p) => (
                            <TouchableOpacity
                              key={p}
                              style={[styles.modalItem, { paddingVertical: 10 }]}
                              onPress={() => { set('second_pilot', p); setShowPilotModal(false); }}
                              onLongPress={() => {
                                Alert.alert(shortName(p), 'Edit or remove this pilot?', [
                                  { text: t('cancel'), style: 'cancel' },
                                  ...(Platform.OS === 'ios' ? [{ text: 'Edit', onPress: () => {
                                    Alert.prompt('Edit pilot name', '', async (newName) => {
                                      if (!newName?.trim()) return;
                                      const trimmed = newName.trim();
                                      const { getDatabase } = await import('../../db/database');
                                      const db = await getDatabase();
                                      await db.runAsync('UPDATE flights SET second_pilot=? WHERE second_pilot=?', [trimmed, p]);
                                      const updated = await getRecentSecondPilots();
                                      setRecentPilots(updated);
                                    }, 'plain-text', p);
                                  }}] : []),
                                  { text: 'Remove', style: 'destructive', onPress: async () => {
                                    const count = await flagFlightsBySecondPilot(p);
                                    const updated = await getRecentSecondPilots();
                                    setRecentPilots(updated);
                                    if (count > 0) setReviewPromptCount(count);
                                  }},
                                ]);
                              }}
                              delayLongPress={600}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.modalItemText, { fontSize: 13 }]}>{shortName(p)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ))}
                    </View>
                  </>);
                })()
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <AircraftModal
        visible={showAircraftModal}
        onClose={() => setShowAircraftModal(false)}
        onSave={async (type, speedKts, endH, crewType, category, engineType) => {
          await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType);
          const updated = await getRecentAircraftTypes();
          setRecentTypes(updated);
          onTypeSelect(type);
          setShowAircraftModal(false);
        }}
      />

      <PremiumModal visible={showPremiumGate} onClose={() => setShowPremiumGate(false)} feature="Flight data scan" />

      {/* Review prompt */}
      <Modal visible={reviewPromptCount > 0} transparent animationType="fade" onRequestClose={() => setReviewPromptCount(0)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: Colors.card, borderRadius: 16, padding: 24, marginHorizontal: 32, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder }}>
            <Ionicons name="alert-circle-outline" size={36} color={Colors.gold} />
            <Text style={{ color: Colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 12, textAlign: 'center' }}>
              Flights need review
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
              {reviewPromptCount} flight{reviewPromptCount > 1 ? 's' : ''} affected. Now or later?
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: Colors.gold, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 32, marginTop: 16 }}
              onPress={() => { setReviewPromptCount(0); setShowRegModal(false); setShowPilotModal(false); router.push('/(tabs)/log' as any); }}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#0A1628', fontSize: 15, fontWeight: '800' }}>Review</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setReviewPromptCount(0)} style={{ marginTop: 10 }}>
              <Text style={{ color: Colors.textMuted, fontSize: 13 }}>Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Military Operation modal */}
      <Modal visible={showMilOp} transparent animationType="slide" onRequestClose={() => setShowMilOp(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setShowMilOp(false)}>
          <Pressable style={{
            backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            maxHeight: '80%', paddingBottom: 32,
          }} onPress={e => e.stopPropagation()}>
            <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginTop: 10, marginBottom: 6 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
              <Text style={{ color: Colors.textPrimary, fontSize: 17, fontWeight: '800', flex: 1 }}>TACTICAL</Text>
              {milOps.size > 0 && (
                <TouchableOpacity onPress={() => setMilOps(new Set())}>
                  <Text style={{ color: Colors.danger, fontSize: 13, fontWeight: '600' }}>{t('clear')}</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', paddingHorizontal: 12 }}>
                {[0, 1].map(col => (
                  <View key={col} style={{ flex: 1, paddingHorizontal: 4 }}>
                    {MIL_CATEGORIES.filter((_, i) => i % 2 === col).map(cat => {
                      const open = expandedMilCats.has(cat.title);
                      const selectedInCat = cat.items.filter(op => milOps.has(op.code));
                      return (
                        <View key={cat.title} style={{
                          backgroundColor: Colors.elevated, borderRadius: 10,
                          borderWidth: 0.5, borderColor: Colors.border,
                          marginBottom: 8, overflow: 'hidden',
                        }}>
                          <TouchableOpacity
                            style={{
                              flexDirection: 'row', alignItems: 'center',
                              paddingHorizontal: 10, paddingVertical: 10,
                            }}
                            onPress={() => toggleMilCat(cat.title)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={Colors.textMuted} style={{ marginRight: 6 }} />
                            <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700', flex: 1 }}>{cat.title}</Text>
                            {selectedInCat.length > 0 && (
                              <View style={{
                                backgroundColor: Colors.gold + '22', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5,
                              }}>
                                <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700' }}>{selectedInCat.length}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                          {open && cat.items.map(op => {
                            const active = milOps.has(op.code);
                            return (
                              <TouchableOpacity
                                key={op.code}
                                style={{
                                  flexDirection: 'row', alignItems: 'center', gap: 6,
                                  paddingVertical: 7, paddingHorizontal: 10,
                                  borderTopWidth: 0.5, borderTopColor: Colors.separator,
                                }}
                                onPress={() => toggleMilOp(op.code)}
                                activeOpacity={0.7}
                              >
                                <Ionicons
                                  name={active ? 'checkbox' : 'square-outline'}
                                  size={16}
                                  color={active ? Colors.gold : Colors.textMuted}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text style={{
                                    color: active ? Colors.gold : Colors.textPrimary,
                                    fontSize: 11, fontWeight: '800',
                                  }}>{op.code}</Text>
                                  <Text style={{
                                    color: Colors.textMuted, fontSize: 9, lineHeight: 12,
                                  }}>{op.desc}</Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
              <View style={{ height: 16 }} />
            </ScrollView>
            {milOps.size > 0 && (
              <View style={{ paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.separator }}>
                <Text style={{ color: Colors.textMuted, fontSize: 11, marginBottom: 8 }}>
                  {Array.from(milOps).join(' / ')}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={{
                marginHorizontal: 16, paddingVertical: 14, borderRadius: 12,
                backgroundColor: Colors.primary, alignItems: 'center',
              }}
              onPress={() => {
                const codeOnlyCats = new Set([
                  t('mil_cat_rescue'), t('mil_cat_refuel'),
                  t('mil_cat_transport'), t('mil_cat_maritime'),
                ]);
                const allWithCat = MIL_CATEGORIES.flatMap(c => c.items.map(i => ({ ...i, cat: c.title })));
                const descs = Array.from(milOps).map(code => {
                  const item = allWithCat.find(i => i.code === code);
                  if (!item) return code;
                  if (codeOnlyCats.has(item.cat)) return code;
                  return item.desc.replace(/\s*\(.*?\)\s*/g, '').trim();
                });
                set('remarks', descs.join(' / '));
                setShowMilOp(false);
              }}
              activeOpacity={0.85}
            >
              <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>
                {milOps.size > 0 ? `${t('done_exclamation')} (${milOps.size})` : t('cancel')}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
