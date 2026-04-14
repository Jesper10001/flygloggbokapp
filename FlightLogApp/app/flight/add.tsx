import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
  TextInput, Modal, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FormField } from '../../components/FormField';
import { IcaoInput } from '../../components/IcaoInput';
import { SmartTimeInput } from '../../components/SmartTimeInput';
import { insertFlight, getRecentAircraftTypes, getRecentRegistrations, getRecentPlaces, getRecentRemarks, getFlights, addToAircraftRegistry, addAircraftTypeToRegistry } from '../../db/flights';
import { AircraftModal } from '../../components/AircraftModal';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { validateFlightForm } from '../../utils/validation';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { decimalToHHMM, hhmmToDecimal } from '../../hooks/useTimeFormat';
import type { Flight, FlightFormData, ValidationIssue } from '../../types/flight';

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
};

// ── Styles ──────────────────────────────────────────────────────────────────

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
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
      fontSize: 32, fontWeight: '800', fontFamily: 'Menlo',
      fontVariant: ['tabular-nums'],
    },
    totalTimeValueFilled: { color: Colors.primary },
    totalTimeValueEmpty: { color: Colors.textMuted },
    totalTimeHhmm: {
      color: Colors.textMuted, fontSize: 14, fontFamily: 'Menlo',
      fontVariant: ['tabular-nums'],
    },
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
    nvgPreset: {
      backgroundColor: Colors.elevated, borderRadius: 8,
      paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: Colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    nvgPresetText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

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
          onPress={() => onChange(String(Math.max(min, n - 1)))}
          disabled={n <= min}
        >
          <Ionicons name="remove" size={18} color={n <= min ? Colors.textMuted : Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.counterValue}>{n}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(String(n + 1))}>
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
  const { canAddFlight, loadFlights, loadStats, flightCount, isPremium } = useFlightStore();
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
  const [lastTemplate, setLastTemplate] = useState<string>('');
  const [showAircraftModal, setShowAircraftModal] = useState(false);

  useEffect(() => {
    Promise.all([
      getRecentAircraftTypes(),
      getRecentPlaces(),
      getFlights(1),
      getRecentRemarks(20),
    ]).then(([types, places, flights, remarks]) => {
      setRecentTypes(types);
      setRecentPlaces(places);
      setRecentRemarks(remarks);
      const last = flights[0] ?? null;
      if (last) {
        setLastFlight(last);
        // Hämta registreringar bara för senaste flygets typ
        getRecentRegistrations(last.aircraft_type).then(setRecentRegs);
      }
    });
  }, []);

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
    if (!type) { setRecentRegs([]); return; }
    let cancelled = false;
    getRecentRegistrations(type).then((regs) => {
      if (!cancelled) setRecentRegs(regs);
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
        const multiCrewRole: PrimaryRole[] = ['co_pilot','relief_crew'];
        const hasSecondPilot = !!(next.second_pilot && next.second_pilot.trim());
        const isMulti = multiCrewRole.includes(role) || hasSecondPilot;
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
        distribute(next.total_time || '0');
      }

      const syncRules = (tt: string, rules: string | undefined) => {
        if (rules === 'IFR') { next.ifr = tt; next.vfr = '0'; }
        else if (rules === 'VFR') { next.ifr = '0'; next.vfr = tt; }
        // Mixed: lämna värdena som de är (användaren fyller i manuellt)
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
        else if (val === 'Mixed') {
          // Behåll befintliga värden om de summerar rimligt, annars nollställ så användaren matar in
          const total = parseFloat(tt) || 0;
          const sum = (parseFloat(next.ifr) || 0) + (parseFloat(next.vfr) || 0);
          if (sum <= 0 || sum > total + 0.05) { next.ifr = '0'; next.vfr = '0'; }
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
    const multiCrewRole: PrimaryRole[] = ['co_pilot','relief_crew'];
    setForm((prev) => {
      const hasSecondPilot = !!(prev.second_pilot && prev.second_pilot.trim());
      const isMulti = multiCrewRole.includes(r) || hasSecondPilot;
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

  const save = async () => {
    if (!canAddFlight()) {
      Alert.alert(
        t('limit_reached'),
        `${t('limit_reached_message')} ${FREE_TIER_LIMIT} ${t('flights')}.`,
        [
          { text: t('close'), style: 'cancel' },
          { text: t('upgrade'), onPress: () => router.push('/(tabs)/settings') },
        ]
      );
      return;
    }
    const issues = validateFlightForm(form);
    const hardErrors = issues.filter((i) => i.severity === 'error');
    if (hardErrors.length > 0) {
      const newErrors: Partial<Record<keyof FlightFormData, string>> = {};
      for (const e of hardErrors) newErrors[e.field as keyof FlightFormData] = e.message;
      setErrors(newErrors);
      return;
    }
    setWarnings(issues.filter((i) => i.severity === 'warning'));
    setSaving(true);
    try {
      await insertFlight(form, { source: 'manual' });
      await Promise.all([loadFlights(), loadStats()]);
      router.back();
    } catch {
      Alert.alert(t('error'), t('error_save'));
    } finally {
      setSaving(false);
    }
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
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >

        {!isPremium && (
          <View style={styles.freeNotice}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.gold} />
            <Text style={styles.freeNoticeText}>{flightCount}/{FREE_TIER_LIMIT} {t('flights')}</Text>
          </View>
        )}

        <ValidationWarnings issues={warnings} />

        {/* ── Snabbfyll från senaste flygning ── */}
        {lastFlight && (
          <TouchableOpacity style={styles.lastFlightBar} onPress={fillLastAircraft} activeOpacity={0.7}>
            <Ionicons name="flash" size={14} color={Colors.primary} />
            <Text style={styles.lastFlightText}>
              {t('same_aircraft')} <Text style={styles.lastFlightBold}>{lastFlight.aircraft_type} · {lastFlight.registration}</Text>
            </Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* ── Basic info ── */}
        <Text style={styles.section}>{t('basic_info')}</Text>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateFieldLabel}>{t('date')}</Text>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dateBtnText}>{form.date || '—'}</Text>
              <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
            </TouchableOpacity>
            {errors.date ? (
              <Text style={styles.errorInline}>{errors.date}</Text>
            ) : null}
            {form.date === today && (
              <TouchableOpacity
                style={styles.yesterdayBtn}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  set('date', d.toISOString().split('T')[0]);
                }}
              >
                <Ionicons name="arrow-back" size={11} color={Colors.primary} />
                <Text style={styles.yesterdayText}>{t('yesterday')}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ flex: 1.4 }}>
            <FormField
              label={t('aircraft_type')}
              value={form.aircraft_type}
              onChangeText={(v) => set('aircraft_type', v.toUpperCase())}
              error={errors.aircraft_type}
              placeholder="C172"
              autoCapitalize="characters"
            />
            <View style={styles.regRow}>
              {mostRecentType && (
                <TouchableOpacity
                  style={[styles.chip, styles.chipRecent]}
                  onPress={() => onTypeSelect(mostRecentType)}
                >
                  <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipText, styles.chipRecentText]}>{mostRecentType}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.regDropdownBtn}
                onPress={() => setShowTypeModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="bookmark" size={12} color={Colors.textSecondary} />
                <Ionicons name="chevron-down" size={12} color={Colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, styles.chipAdd]}
                onPress={() => setShowAircraftModal(true)}
              >
                <Ionicons name="add" size={13} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormField
              label={t('registration')}
              value={form.registration}
              onChangeText={(v) => set('registration', v.toUpperCase())}
              error={errors.registration}
              placeholder="SE-KXY"
              autoCapitalize="characters"
            />
            <View style={styles.regRow}>
              {mostRecentReg && (
                <TouchableOpacity
                  style={[styles.chip, styles.chipRecent]}
                  onPress={() => set('registration', mostRecentReg)}
                >
                  <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipText, styles.chipRecentText]}>{mostRecentReg}</Text>
                </TouchableOpacity>
              )}
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
              <TouchableOpacity
                style={[styles.chip, styles.chipAdd]}
                onPress={() => {
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
              >
                <Ionicons name="add" size={13} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flex: 1.4 }}>
            <FormField
              label={t('second_pilot_label')}
              value={form.second_pilot ?? ''}
              onChangeText={(v) => set('second_pilot', v)}
              placeholder={t('second_pilot_ph')}
            />
          </View>
        </View>

        {/* ── Route ── */}
        <Text style={styles.section}>{t('route_utc')}</Text>

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
            <View style={{ flex: 1 }}>
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
                  label=""
                  value={form.dep_place}
                  onChangeText={(v) => set('dep_place', v)}
                  error={errors.dep_place}
                  recentPlaces={top2places}
                  allowHere={depCustom}
                  onTemporaryPlaceSelect={(icao) => {
                    setDepCustom(true);
                    set('dep_place', icao);
                  }}
                />
              ) : (
                <IcaoInput
                  label=""
                  value={form.arr_place}
                  onChangeText={(v) => set('arr_place', v)}
                  error={errors.arr_place}
                  recentPlaces={top2places}
                  allowHere={arrCustom}
                  onTemporaryPlaceSelect={(icao) => {
                    setArrCustom(true);
                    set('arr_place', icao);
                  }}
                />
              )}
            </View>
            {activePlace === 'dep' ? (
              <SmartTimeInput
                label=""
                value={form.dep_utc}
                onChangeText={(v) => set('dep_utc', v)}
                error={errors.dep_utc}
                showNowBtn={false}
                onSubmitEditing={() => {
                  if (form.dep_place.trim() && isValidTime(form.dep_utc)) {
                    setActivePlace('arr');
                  }
                }}
              />
            ) : (
              <SmartTimeInput
                label=""
                value={form.arr_utc}
                onChangeText={(v) => set('arr_utc', v)}
                error={errors.arr_utc}
                showNowBtn={false}
              />
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
          <View style={styles.simCatRow}>
            {(['FFS','FTD','FNPT_II','FNPT_I','BITD'] as const).map((cat) => {
              const active = form.sim_category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.simCatBtn, active && styles.simCatBtnActive]}
                  onPress={() => set('sim_category', cat)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.simCatText, active && styles.simCatTextActive]}>
                    {cat.replace('_', ' ')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Stop place for touch & go / hot refuel */}
        {(form.flight_type === 'touch_and_go' || form.flight_type === 'hot_refuel') && (
          <View style={styles.stopPlaceBlock}>
            <Text style={styles.stopPlaceLabel}>
              {form.flight_type === 'touch_and_go'
                ? `${t('touch_and_go')} — ${t('hot_refuel_not_destination')}`
                : `${t('hot_refuel')} — ${t('hot_refuel_not_destination')}`}
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
              <View style={styles.totalTimeDisplay}>
                <Text style={[
                  styles.totalTimeValue,
                  form.total_time ? styles.totalTimeValueFilled : styles.totalTimeValueEmpty,
                ]}>
                  {form.total_time ? formatTime(parseFloat(form.total_time)) : '—'}
                </Text>
                {form.total_time ? (
                  <Text style={styles.totalTimeHhmm}>
                    {decimalToHHMM(parseFloat(form.total_time))}
                  </Text>
                ) : null}
              </View>
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

          <Text style={[styles.cardFieldLabel, { marginTop: 0, marginBottom: 2 }]}>{t('flight_rules')}</Text>
          <SegmentControl
            options={[{ label: 'VFR', value: 'VFR' }, { label: 'IFR', value: 'IFR' }, { label: 'Mixed', value: 'Mixed' }]}
            value={form.flight_rules ?? 'VFR'}
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
          {(() => {
            const total = parseFloat(form.total_time) || 0;
            const pct = (v: string) => {
              const n = parseFloat(v) || 0;
              return total > 0 ? Math.round((n / total) * 100) : 0;
            };
            const setPct = (key: 'ifr' | 'vfr' | 'night' | 'nvg', p: number) => {
              set(key, String((total * p / 100).toFixed(2)));
            };
            const formatForInput = (decimal: string) => {
              const n = parseFloat(decimal);
              if (!n || isNaN(n)) return '';
              return decimalToHHMM(n);
            };
            const onHhmmChange = (key: 'ifr' | 'vfr' | 'night' | 'nvg', raw: string) => {
              const digits = raw.replace(/\D/g, '').slice(0, 4);
              let hhmm = '';
              if (digits.length === 0) hhmm = '';
              else if (digits.length <= 2) hhmm = digits;
              else hhmm = `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`;
              if (!hhmm || !hhmm.includes(':')) {
                set(key, hhmm === '' ? '0' : String(parseInt(hhmm, 10)));
                return;
              }
              const decimal = hhmmToDecimal(hhmm);
              set(key, String(decimal));
            };
            const mixed = form.flight_rules === 'Mixed';
            return (
              <>
                <Text style={styles.cardFieldLabel}>IFR ({pct(form.ifr)}%)</Text>
                <View style={[styles.row2, !mixed && { opacity: 0.5 }]}>
                  <TextInput
                    style={[styles.nvgInput, { flex: 1 }]}
                    value={formatForInput(form.ifr)}
                    onChangeText={(v) => onHhmmChange('ifr', v)}
                    placeholder="0:00"
                    keyboardType="numbers-and-punctuation"
                    placeholderTextColor={Colors.textMuted}
                    editable={mixed}
                  />
                  <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('ifr', 50)} disabled={!mixed}>
                    <Text style={styles.nvgPresetText}>50%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('ifr', 100)} disabled={!mixed}>
                    <Text style={styles.nvgPresetText}>100%</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.cardFieldLabel}>VFR ({pct(form.vfr ?? '0')}%)</Text>
                <View style={[styles.row2, !mixed && { opacity: 0.5 }]}>
                  <TextInput
                    style={[styles.nvgInput, { flex: 1 }]}
                    value={formatForInput(form.vfr ?? '0')}
                    onChangeText={(v) => onHhmmChange('vfr', v)}
                    placeholder="0:00"
                    keyboardType="numbers-and-punctuation"
                    placeholderTextColor={Colors.textMuted}
                    editable={mixed}
                  />
                  <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('vfr', 50)} disabled={!mixed}>
                    <Text style={styles.nvgPresetText}>50%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('vfr', 100)} disabled={!mixed}>
                    <Text style={styles.nvgPresetText}>100%</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.cardFieldLabel}>{t('night')} ({pct(form.night)}%)</Text>
                <View style={styles.row2}>
                  <TextInput
                    style={[styles.nvgInput, { flex: 1 }]}
                    value={formatForInput(form.night)}
                    onChangeText={(v) => onHhmmChange('night', v)}
                    placeholder="0:00"
                    keyboardType="numbers-and-punctuation"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('night', 50)}>
                    <Text style={styles.nvgPresetText}>50%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('night', 100)}>
                    <Text style={styles.nvgPresetText}>100%</Text>
                  </TouchableOpacity>
                </View>

                {(() => {
                  const nvgEnabled = form.flight_rules !== 'IFR';
                  return (
                    <>
                      <Text style={styles.cardFieldLabel}>NVG ({pct(form.nvg ?? '0')}%)</Text>
                      <View style={[styles.row2, !nvgEnabled && { opacity: 0.5 }]}>
                        <TextInput
                          style={[styles.nvgInput, { flex: 1 }]}
                          value={formatForInput(form.nvg ?? '0')}
                          onChangeText={(v) => onHhmmChange('nvg', v)}
                          placeholder="0:00"
                          keyboardType="numbers-and-punctuation"
                          placeholderTextColor={Colors.textMuted}
                          editable={nvgEnabled}
                        />
                        <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('nvg', 50)} disabled={!nvgEnabled}>
                          <Text style={styles.nvgPresetText}>50%</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.nvgPreset} onPress={() => setPct('nvg', 100)} disabled={!nvgEnabled}>
                          <Text style={styles.nvgPresetText}>100%</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  );
                })()}
              </>
            );
          })()}
        </View>

        {/* ── Remarks ── */}
        <FormField
          label={t('remarks')}
          value={form.remarks}
          onChangeText={(v) => set('remarks', v)}
          placeholder="Optional free text…"
          multiline
          numberOfLines={2}
          style={{ minHeight: 60, textAlignVertical: 'top' }}
        />
        {role === 'picus' && (
          <View style={styles.remarksWarning}>
            <Ionicons name="warning" size={14} color={Colors.warning} />
            <Text style={styles.remarksWarningText}>{t('picus_requires_instructor')}</Text>
          </View>
        )}
        {(() => {
          const q = form.remarks.trim().toLowerCase();
          const matches = (q && q.length > 1
            ? recentRemarks.filter((r) => r.toLowerCase().includes(q) && r !== form.remarks)
            : recentRemarks
          ).slice(0, 3);
          if (matches.length === 0) return null;
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
              {matches.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, styles.chipRecent]}
                  onPress={() => set('remarks', r)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={10} color={Colors.gold} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipText, styles.chipRecentText]} numberOfLines={1}>{r}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })()}

        {/* ── Spara ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
              <Text style={styles.saveBtnText}>{t('save')}</Text>
            </>
          )}
        </TouchableOpacity>

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
                display="spinner"
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
                recentTypes.map((type, idx) => (
                  <TouchableOpacity
                    key={type}
                    style={styles.modalItem}
                    onPress={() => {
                      onTypeSelect(type);
                      setShowTypeModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    {idx === 0 && <Ionicons name="star" size={12} color={Colors.gold} />}
                    <Text style={styles.modalItemText}>{type}</Text>
                    {idx === 0 && <Text style={styles.modalItemSub}>{t('most_recent')}</Text>}
                  </TouchableOpacity>
                ))
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
            <ScrollView keyboardShouldPersistTaps="handled">
              {recentRegs.length === 0 ? (
                <Text style={styles.modalEmpty}>{t('no_saved_registrations')}</Text>
              ) : (
                recentRegs.map((r, idx) => (
                  <TouchableOpacity
                    key={r}
                    style={styles.modalItem}
                    onPress={() => {
                      set('registration', r);
                      setShowRegModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    {idx === 0 && <Ionicons name="star" size={12} color={Colors.gold} />}
                    <Text style={styles.modalItemText}>{r}</Text>
                    {idx === 0 && <Text style={styles.modalItemSub}>{t('most_recent')}</Text>}
                  </TouchableOpacity>
                ))
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
    </KeyboardAvoidingView>
  );
}
