import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { insertFlight, updateFlight, getFlightById, getRecentAircraftTypes, getRecentRegistrations, getRecentPlaces, getRecentRemarks, getRecentSecondPilots, getFlights, addToAircraftRegistry, addAircraftTypeToRegistry, getAircraftEndurance, getAircraftCrewType, flagFlightsByRegistration, flagFlightsBySecondPilot, deleteRegistrationFromRegistry, getSavedCrewNames, addSavedCrewNames, deleteSavedCrewName } from '../../db/flights';
import { AircraftModal } from '../../components/AircraftModal';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { buildInstants, computeDarkWindow, instantFromDateTime, CIVIL_TWILIGHT_DEG } from '../../utils/flightTime';
import { solarAltitudeDeg, sunTimesUTC } from '../../utils/sun';
import { DayNightMap } from '../../components/DayNightMap';
import { computeNightHoursTimed, vertexArrivalTimes } from '../../utils/dayNight';
import { localLabel, tzAbbr, utcToLocalHHMM, localToUtcHHMM } from '../../utils/timezone';
import { getAirportTzInfo, getNearbyAirports } from '../../db/icao';
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
  second_pilot_role: '',
  extra_pilots: '',
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

// ── Touch & Go Multi-Stop Helpers ────────────────────────────────────────────

// ── Route-stopp (enad modell): Touch & go/low approach · Hot refuel · Pickup/dropoff ──
type StopKind = 'tng' | 'lowapp' | 'pickup' | 'dropoff' | 'refuel';
type RouteStop = { id: string; icao: string; kind: StopKind; appType: '2d' | '3d' | null; runway: number | null; navaid: string | null };

const KIND_TOKEN: Record<StopKind, string> = { tng: 'TnG', lowapp: 'LA', pickup: 'PU', dropoff: 'DO', refuel: 'HR' };
const KIND_LABEL: Record<StopKind, string> = { tng: 'Touch & go', lowapp: 'Low approach', pickup: 'Pickup', dropoff: 'Drop off', refuel: 'Hot refuel' };
const KIND_DWELL: Record<StopKind, number> = { tng: 10, lowapp: 10, pickup: 10, dropoff: 10, refuel: 20 };
const KIND_ORDER: StopKind[] = ['tng', 'lowapp', 'pickup', 'dropoff', 'refuel'];
const APP_2D = ['VOR', 'NDB', 'LOC', 'DME', 'LNAV'];
const APP_3D = ['ILS', 'GLS', 'GBAS', 'PAR', 'RNAV'];
const rwy2 = (heading: number) => Math.round(heading / 10).toString().padStart(2, '0');

function appTypeForToken(token: string): '2d' | '3d' | null {
  const u = token.toUpperCase();
  if (u === '2D' || APP_2D.includes(u)) return '2d';
  if (u === '3D' || APP_3D.includes(u)) return '3d';
  return null;
}

// Behålls för ankomst-approach-sektionen (byter 2D/3D → ILS/VOR osv. på arr-raden).
function replaceApproachTypeForStop(remarks: string, icao: string, newType: string): string {
  const regex = new RegExp(`(^${icao.toUpperCase()}\\s+)(?:2D|3D)( app rwy \\d{2,3})`, 'im');
  return remarks.replace(regex, `$1${newType}$2`);
}

// "ESSV TnG ILS app rwy 01" / "ESSA PU/DO" / "ESGG HR 3D app rwy 09"
function serializeStop(s: RouteStop): string {
  let line = `${s.icao.toUpperCase()} ${KIND_TOKEN[s.kind]}`;
  const app = s.navaid || (s.appType ? s.appType.toUpperCase() : null);
  if (app && s.runway != null) line += ` ${app} app rwy ${rwy2(s.runway)}`;
  return line;
}

const STOP_RE = /^([A-Z]{2,4})\s+(TnG|LA|PU\/DO|PU|DO|HR)(?:\s+(2D|3D|VOR|NDB|LOC|DME|LNAV|ILS|GLS|GBAS|PAR|RNAV)\s+app\s+rwy\s+(\d{2,3}))?\s*$/i;
const kindFromToken = (t: string): StopKind => {
  const u = t.toUpperCase();
  if (u === 'TNG') return 'tng';
  if (u === 'LA') return 'lowapp';
  if (u === 'HR') return 'refuel';
  if (u === 'DO') return 'dropoff';
  return 'pickup'; // PU eller legacy PU/DO
};
const isStopLine = (line: string) => STOP_RE.test(line.trim());

function parseRouteStops(remarks: string): RouteStop[] {
  const out: RouteStop[] = [];
  for (const line of (remarks || '').split('\n')) {
    const m = line.trim().match(STOP_RE);
    if (!m) continue;
    const appTok = m[3] || null;
    const isNavaid = appTok ? !['2D', '3D'].includes(appTok.toUpperCase()) : false;
    out.push({
      id: `${m[1]}_${out.length}`,
      icao: m[1].toUpperCase(),
      kind: kindFromToken(m[2]),
      appType: appTok ? appTypeForToken(appTok) : null,
      runway: m[4] ? parseInt(m[4], 10) * 10 : null,
      navaid: isNavaid ? appTok!.toUpperCase() : null,
    });
  }
  return out;
}

// remarks = fri text (behålls) + route-stoppen i ordning
function applyStopsToRemarks(remarks: string, stops: RouteStop[]): string {
  const free = (remarks || '').split('\n').filter((l) => l.trim().length > 0 && !isStopLine(l));
  const lines = stops.filter((s) => s.icao.trim().length >= 2).map(serializeStop);
  return [...free, ...lines].join('\n');
}

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
      backgroundColor: Colors.card, borderRadius: 12, padding: 14, paddingTop: 8,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
      zIndex: 10, // så ICAO-autocomplete kan flyta över sektionerna under
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

    placeColHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 6 },
    placeColHeaderText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
    placeColDivider: { width: 1, backgroundColor: Colors.separator, marginHorizontal: 8 },

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

    // Etikett som matchar FormField:s label (så cabin crew / second pilot ligger i linje
    // med registration / aircraft type).
    colFieldLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
    // Roll-väljare ([roll][namn] vågrätt) — delas av second pilot och cabin crew.
    roleSelectBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
      backgroundColor: Colors.card, borderRadius: 8,
      borderWidth: 0.5, borderColor: Colors.border,
      paddingHorizontal: 6, paddingVertical: 12, minWidth: 44,
    },
    roleSelectBtnActive: { borderColor: Colors.primary },
    roleSelectText: { fontSize: 11, fontWeight: '700' },
    // Dropdown som flyter ovanpå övriga rutor (trycker inte ner dem).
    rolePickerFloat: { position: 'absolute', top: 46, left: 0, right: 0, marginTop: 0, zIndex: 30, elevation: 30 },
    roleNameInput: {
      flex: 1, backgroundColor: Colors.card, borderRadius: 8,
      borderWidth: 0.5, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 16,
      paddingHorizontal: 10, paddingVertical: 12,
    },
    rolePickerDropdown: {
      backgroundColor: Colors.surface, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginTop: 4,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
    },
    rolePickerItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.separator },

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
  type CrewMember = { id: string; role: string; name: string };
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([{ id: '1', role: '', name: '' }]);
  const [spRolePickerOpen, setSpRolePickerOpen] = useState(false);
  const [savedCrewNames, setSavedCrewNames] = useState<string[]>([]);
  const [showCrewNameModal, setShowCrewNameModal] = useState(false);
  // Extra piloter ombord (3:e, 4:e …) — roll + namn, sparas som JSON i extra_pilots-kolumnen.
  const [extraPilots, setExtraPilots] = useState<{ id: string; role: string; name: string }[]>([]);
  const [activeExtraPilotPicker, setActiveExtraPilotPicker] = useState<string | null>(null);
  const [activeCrewPicker, setActiveCrewPicker] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<'2d' | '3d' | null>(null);
  const [selectedRunway, setSelectedRunway] = useState<number | null>(null);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [draft, setDraft] = useState<{ icao: string; kind: StopKind | null; appType: '2d' | '3d' | null; runway: number | null; navaid: string | null }>({ icao: '', kind: null, appType: null, runway: null, navaid: null });
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [reviewPromptCount, setReviewPromptCount] = useState(0);
  const [showPremiumGate, setShowPremiumGate] = useState(false);
  const [editingTotalTime, setEditingTotalTime] = useState(false);
  const [totalTimeEditValue, setTotalTimeEditValue] = useState('');
  // Koordinater för dep/arr (natt-uträkning + lokal tid-hint) och om natt är manuellt satt.
  const [depLatLon, setDepLatLon] = useState<{ lat: number; lon: number; country: string; region: string } | null>(null);
  const [arrLatLon, setArrLatLon] = useState<{ lat: number; lon: number; country: string; region: string } | null>(null);
  const [nightManual, setNightManual] = useState(isEdit);
  const [sunRouteOpen, setSunRouteOpen] = useState(false);
  const sunPoints = useMemo(() => (
    [
      depLatLon && { lat: depLatLon.lat, lon: depLatLon.lon, label: form.dep_place },
      arrLatLon && { lat: arrLatLon.lat, lon: arrLatLon.lon, label: form.arr_place },
    ].filter(Boolean) as { lat: number; lon: number; label: string }[]
  ), [depLatLon, arrLatLon, form.dep_place, form.arr_place]);
  // dep + arr (med koordinater) och giltiga tider ifyllda → ROUTE-pilen + guld visas
  const routeReady = sunPoints.length >= 2 && !!form.date && isValidTime(form.dep_utc) && isValidTime(form.arr_utc);

  // Waypoints (T&G / hot refuel) → koordinater + dwell, för kartan och night-uträkningen.
  // Waypoints: T&G-platser (10 min) + hot refuel (30 min) — BÅDA samtidigt, oberoende av
  // vald flygtyp, så de ligger kvar på rutten när man byter ruta (datan behålls tills man
  // väljer normal/sim). hotRefuelIcao är separat så T&G-synken inte skriver över den.
  const stopIcaos = useMemo(() => routeStops.map((s) => s.icao.trim().toUpperCase()).filter((c) => c.length >= 3), [routeStops]);
  const wpKey = stopIcaos.join('|');
  const [wpCoords, setWpCoords] = useState<Record<string, { lat: number; lon: number }>>({});
  useEffect(() => {
    const codes = wpKey ? [...new Set(wpKey.split('|'))] : [];
    if (!codes.length) { setWpCoords({}); return; }
    let alive = true;
    getAirportTzInfo(codes).then((rows) => {
      if (!alive) return;
      const m: Record<string, { lat: number; lon: number }> = {};
      for (const r of rows) if (r.lat != null && r.lon != null) m[r.icao] = { lat: r.lat, lon: r.lon };
      setWpCoords(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [wpKey]);
  const routeLegs = useMemo(() => {
    const out: { lat: number; lon: number; label: string; dwellMin: number; kind?: StopKind }[] = [];
    if (depLatLon) out.push({ lat: depLatLon.lat, lon: depLatLon.lon, label: form.dep_place, dwellMin: 0 });
    for (const s of routeStops) {
      const ic = s.icao.trim().toUpperCase();
      const p = wpCoords[ic];
      if (ic.length >= 3 && p) out.push({ lat: p.lat, lon: p.lon, label: ic, dwellMin: KIND_DWELL[s.kind], kind: s.kind });
    }
    if (arrLatLon) out.push({ lat: arrLatLon.lat, lon: arrLatLon.lon, label: form.arr_place, dwellMin: 0 });
    return out;
  }, [depLatLon, arrLatLon, wpCoords, routeStops, form.dep_place, form.arr_place]);
  const [landingsManual, setLandingsManual] = useState(isEdit);
  // Tidsinmatningsläge: lokal tid (default) eller UTC. Lagrad tid är alltid UTC.
  const [timeMode, setTimeMode] = useState<'local' | 'utc'>('utc');
  const [depLocalBuf, setDepLocalBuf] = useState('');
  const [arrLocalBuf, setArrLocalBuf] = useState('');
  const selectedLang = useLanguageStore?.getState?.()?.language ?? 'en';

  useEffect(() => {
    if (!editId) return;
    getFlightById(Number(editId)).then(f => {
      if (!f) return;

      // Parse T&G stops from remarks
      const parsedStops = parseRouteStops(f.remarks || '');
      if (parsedStops.length > 0) setRouteStops(parsedStops);

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
        stop_place: f.stop_place ?? '',
        flight_rules: f.flight_rules ?? 'VFR',
        second_pilot: f.second_pilot ?? '',
        second_pilot_role: f.second_pilot_role ?? '',
        extra_pilots: f.extra_pilots ?? '',
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
      if (f.extra_pilots) {
        try {
          const arr = JSON.parse(f.extra_pilots);
          if (Array.isArray(arr)) setExtraPilots(arr.map((p: any, i: number) => ({ id: `e${i}`, role: String(p?.role ?? ''), name: String(p?.name ?? '') })));
        } catch {}
      }
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

  // Slå upp koordinater för dep/arr (för natt-uträkning + lokal tid-hint).
  useEffect(() => {
    let alive = true;
    const dep = form.dep_place.trim().toUpperCase();
    const arr = form.arr_place.trim().toUpperCase();
    const resolve = async (code: string) => {
      if (!code || code.length < 2) return null;
      const rows = await getAirportTzInfo([code]);
      const row = rows.find((r) => r.icao === code) ?? rows[0];
      if (!row) return null;
      let country = row.country;
      let region = row.region;
      // Off-airport-platser saknar ofta land/region → ta tidszon från närmaste flygplats.
      if (!country && row.lat != null && row.lon != null) {
        const near = await getNearbyAirports(row.lat, row.lon, 1).catch(() => []);
        if (near[0]) { country = near[0].country; region = near[0].region; }
      }
      return { lat: row.lat, lon: row.lon, country: country || '', region: region || '' };
    };
    (async () => {
      const [d, a] = await Promise.all([resolve(dep), resolve(arr)]);
      if (!alive) return;
      setDepLatLon(d);
      setArrLatLon(a);
    })().catch(() => {});
    return () => { alive = false; };
  }, [form.dep_place, form.arr_place]);

  // Auto-beräkna natt-tid (borgerlig skymning −6°, samplad längs storcirkeln).
  // Hoppas över vid redigering/efter manuell ändring (nightManual) och utan koordinater.
  useEffect(() => {
    if (nightManual) return;
    const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
    if (!inst || routeLegs.length < 2) return;
    // Dwell-medveten night-tid: T&G (10 min) / hot refuel (30 min) räknas in där de sker.
    const n = computeNightHoursTimed(routeLegs, inst.dep.getTime(), inst.arr.getTime());
    setForm((prev) => (prev.night === String(n) ? prev : { ...prev, night: String(n) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dep_utc, form.arr_utc, form.date, routeLegs, nightManual]);

  // Mörkerlandning: landningen räknas som natt om solen vid ANKOMSTEN står under
  // −6° (civil skymning), dvs själva landningsskedet var i mörker. Auto, men
  // respekterar manuell ändring av landnings-räknarna (T&G hanteras manuellt).
  useEffect(() => {
    if (landingsManual || form.flight_type === 'touch_and_go' || !arrLatLon) return;
    const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
    if (!inst) return;
    const dark = solarAltitudeDeg(inst.arr, arrLatLon.lat, arrLatLon.lon) < CIVIL_TWILIGHT_DEG;
    const day = parseInt(form.landings_day) || 0;
    const night = parseInt(form.landings_night) || 0;
    const totalL = day + night;
    if (totalL <= 0) return;
    if (dark && day > 0) { set('landings_day', '0'); set('landings_night', String(totalL)); }
    else if (!dark && night > 0) { set('landings_night', '0'); set('landings_day', String(totalL)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dep_utc, form.arr_utc, form.date, arrLatLon, landingsManual, form.flight_type]);

  // Route: varje stopp UTOM low approach = en landning (TnG/PU/DO/Hot refuel), klassad
  // dag/natt efter solhöjden vid stoppet när flygplanet är där, plus destinationens landning.
  useEffect(() => {
    if (landingsManual || form.flight_type !== 'touch_and_go') return;
    if (!depLatLon || !arrLatLon) return;
    const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
    if (!inst || routeLegs.length < 2) return;
    const depMs = inst.dep.getTime(), arrMs = inst.arr.getTime();
    const times = vertexArrivalTimes(routeLegs, depMs, arrMs);
    let dayL = 0, nightL = 0;
    for (let i = 1; i < routeLegs.length - 1; i++) {
      if (routeLegs[i].kind === 'lowapp') continue;
      const dark = solarAltitudeDeg(new Date(times[i]), routeLegs[i].lat, routeLegs[i].lon) < CIVIL_TWILIGHT_DEG;
      if (dark) nightL++; else dayL++;
    }
    const arrLeg = routeLegs[routeLegs.length - 1];
    if (solarAltitudeDeg(new Date(arrMs), arrLeg.lat, arrLeg.lon) < CIVIL_TWILIGHT_DEG) nightL++; else dayL++;
    set('landings_day', String(dayL));
    set('landings_night', String(nightL));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLegs, form.dep_utc, form.arr_utc, form.date, landingsManual, form.flight_type]);

  // Lokal-läge: fyll lokalbuffern från lagrad UTC när den är tom (AI-import/redigering).
  useEffect(() => {
    if (timeMode !== 'local') return;
    if (!depLocalBuf && depLatLon && isValidTime(form.dep_utc)) {
      const inst = instantFromDateTime(form.date, form.dep_utc);
      const l = inst ? utcToLocalHHMM(inst, depLatLon.country, depLatLon.region, depLatLon.lon) : null;
      if (l) setDepLocalBuf(l);
    }
    if (!arrLocalBuf && arrLatLon && isValidTime(form.arr_utc)) {
      const inst = instantFromDateTime(form.date, form.arr_utc);
      const l = inst ? utcToLocalHHMM(inst, arrLatLon.country, arrLatLon.region, arrLatLon.lon) : null;
      if (l) setArrLocalBuf(l);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeMode, depLatLon, arrLatLon, form.dep_utc, form.arr_utc, form.date]);

  // Lokal-läge: när tidszon (flygplats) eller datum ändras → räkna om UTC från lokalbuffern.
  useEffect(() => {
    if (timeMode !== 'local') return;
    if (depLocalBuf && depLatLon && isValidTime(depLocalBuf)) {
      const u = localToUtcHHMM(form.date, depLocalBuf, depLatLon.country, depLatLon.region, depLatLon.lon);
      if (u && u !== form.dep_utc) set('dep_utc', u);
    }
    if (arrLocalBuf && arrLatLon && isValidTime(arrLocalBuf)) {
      const u = localToUtcHHMM(form.date, arrLocalBuf, arrLatLon.country, arrLatLon.region, arrLatLon.lon);
      if (u && u !== form.arr_utc) set('arr_utc', u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depLatLon, arrLatLon, form.date, timeMode]);

  const toggleTimeMode = () => {
    setTimeMode((m) => {
      if (m === 'local') return 'utc';
      const di = isValidTime(form.dep_utc) ? instantFromDateTime(form.date, form.dep_utc) : null;
      const ai = isValidTime(form.arr_utc) ? instantFromDateTime(form.date, form.arr_utc) : null;
      setDepLocalBuf(di && depLatLon ? (utcToLocalHHMM(di, depLatLon.country, depLatLon.region, depLatLon.lon) ?? '') : '');
      setArrLocalBuf(ai && arrLatLon ? (utcToLocalHHMM(ai, arrLatLon.country, arrLatLon.region, arrLatLon.lon) ?? '') : '');
      return 'local';
    });
  };

  const onDepLocalChange = (v: string) => {
    setDepLocalBuf(v);
    const u = depLatLon ? localToUtcHHMM(form.date, v, depLatLon.country, depLatLon.region, depLatLon.lon) : (isValidTime(v) ? v : '');
    set('dep_utc', u ?? '');
  };
  const onArrLocalChange = (v: string) => {
    setArrLocalBuf(v);
    const u = arrLatLon ? localToUtcHHMM(form.date, v, arrLatLon.country, arrLatLon.region, arrLatLon.lon) : (isValidTime(v) ? v : '');
    set('arr_utc', u ?? '');
  };

  const CREW_ROLES = [
    { key: 'Crew chief', label: selectedLang === 'sv' ? 'Uppdragsspecialist' : 'Crew chief', short: 'CC' },
    { key: 'Rescue swimmer', label: selectedLang === 'sv' ? 'Ytbärgare' : 'Rescue swimmer', short: 'RS' },
    { key: 'Winch operator', label: selectedLang === 'sv' ? 'Vinschoperatör' : 'Winch operator', short: 'WO' },
    { key: 'HEMS operator', label: selectedLang === 'sv' ? 'HEMS-operatör' : 'HEMS operator', short: 'HEMS' },
    { key: 'Loadmaster', label: selectedLang === 'sv' ? 'Lastmästare' : 'Loadmaster', short: 'LM' },
  ];

  // Roller för medpiloten man flyger med. COP visas förkortat i rutan, "Copilot" i listan.
  const SP_ROLES = [
    { key: 'PIC', short: 'PIC', label: 'PIC' },
    { key: 'COP', short: 'COP', label: selectedLang === 'sv' ? 'Andrepilot (Copilot)' : 'Copilot' },
    { key: 'FI', short: 'FI', label: 'FI' },
    { key: 'SPIC', short: 'SPIC', label: 'SPIC' },
    { key: 'PICUS', short: 'PICUS', label: 'PICUS' },
  ];

  const updateCrewMember = (id: string, field: 'role' | 'name', value: string) => {
    setCrewMembers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };
  const addCrewMember = () => {
    setCrewMembers(prev => [...prev, { id: String(Date.now()), role: '', name: '' }]);
  };
  // Fyll i sparat kabinnamn: sätt på första tomma raden, annars lägg till ny rad.
  const applyCrewName = (name: string) => {
    setCrewMembers((prev) => {
      const idx = prev.findIndex((m) => !m.name.trim());
      if (idx >= 0) return prev.map((m, i) => (i === idx ? { ...m, name } : m));
      return [...prev, { id: String(Date.now()), role: '', name }];
    });
  };

  // Extra piloter (3:e, 4:e …)
  const addExtraPilot = () => setExtraPilots((prev) => [...prev, { id: String(Date.now()), role: '', name: '' }]);
  const removeExtraPilot = (id: string) => setExtraPilots((prev) => prev.filter((p) => p.id !== id));
  const updateExtraPilot = (id: string, field: 'role' | 'name', value: string) =>
    setExtraPilots((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  // "second", "third", … för knappetiketten (nästa pilot = extraPilots.length + 3).
  const ordinalPilot = (n: number) => ['', '', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][n] ?? `${n}th`;
  const removeCrewMember = (id: string) => {
    setCrewMembers(prev => prev.length > 1 ? prev.filter(m => m.id !== id) : prev);
  };
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

  // Sparade kabinpersonalsnamn (cabin crew väljs ur listan och fylls på vid spara)
  useEffect(() => { getSavedCrewNames().then(setSavedCrewNames); }, []);

  // Egna roller som innebär multi-pilot-operation.
  const MP_ROLES: PrimaryRole[] = ['co_pilot', 'picus', 'relief_crew', 'spic'];

  // SP/MP avgörs automatiskt (ingen knapp): MP om farkosten är MP-only, om en second pilot
  // är ifylld, eller om egen roll innebär multi-pilot. SP om farkosten är SP-only eller inget av ovan.
  useEffect(() => {
    let target: 'single' | 'multi';
    if (mpSupported && !spSupported) target = 'multi';
    else if (spSupported && !mpSupported) target = 'single';
    else if ((form.second_pilot ?? '').trim() || extraPilots.some((p) => p.name.trim())) target = 'multi';
    else target = MP_ROLES.includes(role) ? 'multi' : 'single';
    setPilotMode((m) => (m === target ? m : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spSupported, mpSupported, form.second_pilot, role, extraPilots]);

  // Det måste finnas en PIC om en medpilot är angiven (second pilot eller extra pilot).
  // Saknas PIC → den namngivna medpiloten blir PIC. Undantag: du ensam som co-pilot utan
  // namngiven medpilot kräver ingen PIC (då anges aldrig vem PIC är).
  useEffect(() => {
    const namedSecond = (form.second_pilot ?? '').trim() !== '';
    const hasOther = namedSecond || extraPilots.some((p) => p.name.trim() !== '');
    const anyPic = role === 'pic' || form.second_pilot_role === 'PIC' || extraPilots.some((p) => p.role === 'PIC');
    if (hasOther && !anyPic) {
      // Defaulta endast en medpilot som saknar vald roll → PIC (skriver inte över FI/COP/SPIC).
      if (namedSecond && (form.second_pilot_role ?? '') === '') set('second_pilot_role', 'PIC');
      else {
        const firstUnroled = extraPilots.find((p) => p.name.trim() !== '' && !p.role);
        if (firstUnroled) updateExtraPilot(firstUnroled.id, 'role', 'PIC');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, form.second_pilot, form.second_pilot_role, extraPilots]);

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
      // pilotMode sätts automatiskt av effekten ovan (spSupported/mpSupported i deps).
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
      second_pilot_role: lastFlight.second_pilot_role ?? '',
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

  const applyStops = (stops: RouteStop[]) => {
    setRouteStops(stops);
    set('stop_place', stops[0]?.icao ?? '');
    set('remarks', applyStopsToRemarks(form.remarks, stops));
  };
  const addRouteStop = () => {
    const ic = draft.icao.trim().toUpperCase();
    if (ic.length < 2 || !draft.kind) return;
    const stop: RouteStop = { id: Date.now().toString(), icao: ic, kind: draft.kind, appType: draft.appType, runway: draft.runway, navaid: draft.navaid };
    applyStops([...routeStops, stop]);
    if (stop.navaid || (stop.appType && stop.runway != null)) set('flight_rules', 'IFR');
    setDraft({ icao: '', kind: null, appType: null, runway: null, navaid: null });
  };
  const removeRouteStop = (index: number) => applyStops(routeStops.filter((_, i) => i !== index));
  const moveRouteStop = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= routeStops.length) return;
    const next = [...routeStops];
    [next[index], next[j]] = [next[j], next[index]];
    applyStops(next);
  };

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

      // (SP/MP sätts automatiskt av effekten som lyssnar på form.second_pilot.)

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
    // Bara en PIC: blir du PIC demoteras andra pilot-PIC till Co-pilot.
    if (newRole === 'pic') {
      if (form.second_pilot_role === 'PIC') set('second_pilot_role', 'COP');
      setExtraPilots((prev) => prev.map((p) => (p.role === 'PIC' ? { ...p, role: 'COP' } : p)));
    }
  };

  // Rollval för second pilot / extra pilot med PIC-exklusivitet (max en PIC totalt).
  const selectSecondPilotRole = (key: string) => {
    set('second_pilot_role', key);
    if (key === 'PIC') {
      if (role === 'pic') handleRoleChange('co_pilot');
      setExtraPilots((prev) => prev.map((p) => (p.role === 'PIC' ? { ...p, role: 'COP' } : p)));
    }
  };
  const selectExtraPilotRole = (id: string, key: string) => {
    updateExtraPilot(id, 'role', key);
    if (key === 'PIC') {
      if (role === 'pic') handleRoleChange('co_pilot');
      if (form.second_pilot_role === 'PIC') set('second_pilot_role', 'COP');
      setExtraPilots((prev) => prev.map((p) => (p.id !== id && p.role === 'PIC' ? { ...p, role: 'COP' } : p)));
    }
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
          const sizeInMB = (fileInfo.exists ? fileInfo.size : 0) / (1024 * 1024);
          if (sizeInMB > 50) {
            Alert.alert(
              'Video too large',
              `Maximum file size is 50 MB (your video is ${sizeInMB.toFixed(1)} MB).`
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
      Alert.alert('Quota reached', 'You have used all your AI imports this month.');
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
            'Which time?',
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
      Alert.alert('AI Import', e.message || 'Could not read the image');
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

      const extraPilotsClean = extraPilots.filter((p) => p.role || p.name.trim()).map((p) => ({ role: p.role, name: p.name.trim() }));
      const extraPilotsJson = extraPilotsClean.length ? JSON.stringify(extraPilotsClean) : '';
      const finalData = { ...form, ...(overrides ?? {}), remarks: finalRemarks, photo_uri: savedPhotoUri, media_type: mediaType, extra_pilots: extraPilotsJson };

      if (isEdit) {
        await updateFlight(Number(editId), finalData);
      } else {
        await insertFlight(finalData, { source: 'manual' });
      }
      // Spara kabinpersonalsnamn till listan (second pilot härleds från flights-tabellen).
      await addSavedCrewNames(crewMembers.map((m) => m.name));
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
        'You have not entered a departure or arrival place. Save anyway?',
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


        {/* Row 1: Aircraft type + Second pilot */}
        <View style={[styles.row2, (spRolePickerOpen || activeExtraPilotPicker) ? { zIndex: 20 } : null]}>
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
          <View style={{ flex: 1, zIndex: (spRolePickerOpen || activeExtraPilotPicker) ? 20 : 0 }}>
            <Text style={styles.colFieldLabel}>{t('second_pilot_label')}</Text>
            {/* Roll på medpiloten man flyger med (PIC/COP/FI/SPIC/PICUS) + namn, vågrätt */}
            <View style={{ position: 'relative', zIndex: 20 }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TouchableOpacity
                  style={[styles.roleSelectBtn, form.second_pilot_role ? styles.roleSelectBtnActive : null]}
                  onPress={() => setSpRolePickerOpen((o) => !o)}
                  activeOpacity={0.75}
                >
                  {form.second_pilot_role ? (
                    <Text style={[styles.roleSelectText, { color: Colors.primary }]} numberOfLines={1}>
                      {SP_ROLES.find((r) => r.key === form.second_pilot_role)?.short ?? form.second_pilot_role}
                    </Text>
                  ) : (
                    <Ionicons name="person-outline" size={14} color={Colors.textMuted} />
                  )}
                  <Ionicons name="chevron-down" size={10} color={Colors.textMuted} />
                </TouchableOpacity>
                <TextInput
                  style={styles.roleNameInput}
                  value={form.second_pilot ?? ''}
                  onChangeText={(v) => set('second_pilot', v)}
                  placeholder={t('second_pilot_ph')}
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              {spRolePickerOpen && (
                <View style={[styles.rolePickerDropdown, styles.rolePickerFloat]}>
                  {[{ key: '', label: `— ${t('clear')}` }, ...SP_ROLES].map((opt) => (
                    <TouchableOpacity
                      key={opt.key || 'clear'}
                      style={[styles.rolePickerItem, form.second_pilot_role === opt.key && { backgroundColor: Colors.primary + '14' }]}
                      onPress={() => { selectSecondPilotRole(opt.key); setSpRolePickerOpen(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: form.second_pilot_role === opt.key ? Colors.primary : Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            {/* Extra piloter ombord (3:e, 4:e …) — samma roll+namn-rad som second pilot */}
            {extraPilots.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', gap: 4, marginTop: 6, position: 'relative', zIndex: activeExtraPilotPicker === p.id ? 20 : 0 }}>
                <TouchableOpacity
                  style={[styles.roleSelectBtn, p.role ? styles.roleSelectBtnActive : null]}
                  onPress={() => setActiveExtraPilotPicker((cur) => (cur === p.id ? null : p.id))}
                  activeOpacity={0.75}
                >
                  {p.role ? (
                    <Text style={[styles.roleSelectText, { color: Colors.primary }]} numberOfLines={1}>
                      {SP_ROLES.find((r) => r.key === p.role)?.short ?? p.role}
                    </Text>
                  ) : (
                    <Ionicons name="person-outline" size={14} color={Colors.textMuted} />
                  )}
                  <Ionicons name="chevron-down" size={10} color={Colors.textMuted} />
                </TouchableOpacity>
                <TextInput
                  style={styles.roleNameInput}
                  value={p.name}
                  onChangeText={(v) => updateExtraPilot(p.id, 'name', v)}
                  placeholder={t('second_pilot_ph')}
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity onPress={() => removeExtraPilot(p.id)} style={{ justifyContent: 'center' }}>
                  <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
                </TouchableOpacity>
                {activeExtraPilotPicker === p.id && (
                  <View style={[styles.rolePickerDropdown, styles.rolePickerFloat]}>
                    {[{ key: '', label: `— ${t('clear')}` }, ...SP_ROLES].map((opt) => (
                      <TouchableOpacity
                        key={opt.key || 'clear'}
                        style={[styles.rolePickerItem, p.role === opt.key && { backgroundColor: Colors.primary + '14' }]}
                        onPress={() => { selectExtraPilotRole(p.id, opt.key); setActiveExtraPilotPicker(null); }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: p.role === opt.key ? Colors.primary : Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <View style={[styles.regRow, { marginTop: 8 }]}>
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
              {/* + lägg till nästa pilot ombord (3:e, 4:e …). SP/MP avgörs automatiskt. */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
                onPress={addExtraPilot}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={14} color={Colors.primary} />
                <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '600' }}>
                  {`Add ${ordinalPilot(extraPilots.length + 3)} pilot`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Row 2: Registration + Cabin crew (side by side) */}
        <View style={[styles.row2, activeCrewPicker ? { zIndex: 20 } : null]}>
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
          <View style={{ flex: 1 }}>
            <Text style={styles.colFieldLabel}>{t('crew_chief_label')}</Text>
            {crewMembers.map((member, idx) => (
              <View key={member.id} style={{ gap: 4, marginTop: idx === 0 ? 0 : 8, position: 'relative', zIndex: activeCrewPicker === member.id ? 20 : 0 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity
                    style={[styles.roleSelectBtn, member.role ? styles.roleSelectBtnActive : null]}
                    onPress={() => setActiveCrewPicker(activeCrewPicker === member.id ? null : member.id)}
                    activeOpacity={0.75}
                  >
                    {member.role ? (
                      <Text style={[styles.roleSelectText, { color: Colors.primary }]} numberOfLines={1}>
                        {CREW_ROLES.find(r => r.key === member.role)?.short ?? member.role}
                      </Text>
                    ) : (
                      <Ionicons name="person-outline" size={14} color={Colors.textMuted} />
                    )}
                    <Ionicons name="chevron-down" size={10} color={Colors.textMuted} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.roleNameInput}
                    value={member.name}
                    onChangeText={(v) => updateCrewMember(member.id, 'name', v)}
                    placeholder={t('crew_name_ph')}
                    placeholderTextColor={Colors.textMuted}
                  />
                  {crewMembers.length > 1 && (
                    <TouchableOpacity onPress={() => removeCrewMember(member.id)} style={{ justifyContent: 'center' }}>
                      <Ionicons name="close-circle" size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
                {activeCrewPicker === member.id && (
                  <View style={[styles.rolePickerDropdown, styles.rolePickerFloat]}>
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
            {/* Bokmärke (sparade kabinnamn) + lägg till besättning till höger */}
            <View style={[styles.regRow, { marginTop: 8 }]}>
              <TouchableOpacity
                style={[styles.regDropdownBtn, savedCrewNames.length === 0 && styles.regDropdownDisabled]}
                onPress={() => { if (savedCrewNames.length === 0) return; setShowCrewNameModal(true); }}
                activeOpacity={savedCrewNames.length === 0 ? 1 : 0.7}
              >
                <Ionicons name="bookmark" size={12} color={savedCrewNames.length === 0 ? Colors.textMuted : Colors.textSecondary} />
                <Ionicons name="chevron-down" size={12} color={savedCrewNames.length === 0 ? Colors.textMuted : Colors.textSecondary} />
              </TouchableOpacity>
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
        </View>

        {/* ── Route ── (pil fäller ner dag/natt-kartan; pil + guld endast när dep/arr + tider ifyllda) */}
        <TouchableOpacity
          onPress={() => { if (routeReady) setSunRouteOpen((o) => !o); }}
          onLayout={(e) => { routeBlockY.current = e.nativeEvent.layout.y; }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 2 }}
          activeOpacity={routeReady ? 0.7 : 1}
        >
          <Text style={[styles.section, { marginTop: 0, marginBottom: 0 }, routeReady && { color: Colors.gold }]}>{t('route_utc')}</Text>
          {routeReady && <Ionicons name={sunRouteOpen ? 'chevron-up' : 'chevron-down'} size={13} color={Colors.gold} />}
        </TouchableOpacity>

        {/* Departure (vänster) / Arrival (höger) — två sektioner sida vid sida.
            Varje sektion: rubrik → ICAO/ZZZZ (off-airport) → fritext-plats → tidsruta (UTC/lokal). */}
        <View style={styles.placeBlock}>
          <View style={{ flexDirection: 'row' }}>
            {/* ── DEPARTURE ── */}
            <View style={{ flex: 1 }}>
              <View style={styles.placeColHeader}>
                <Text style={styles.placeColHeaderText}>{t('departure')}</Text>
              </View>
              <View style={[styles.locSegment, { marginBottom: 6 }]}>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, !depCustom && styles.locSegmentBtnActive]}
                  onPress={() => { setDepCustom(false); set('dep_place', ''); }}
                >
                  <Text style={[styles.locSegmentText, !depCustom && styles.locSegmentTextActive]}>{t('icao_label')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, depCustom && styles.locSegmentBtnActive]}
                  onPress={() => { setDepCustom(true); set('dep_place', ''); }}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.locSegmentText, depCustom && styles.locSegmentTextActive]}>{t('temporary_label')}</Text>
                </TouchableOpacity>
              </View>
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
                    if (form.arr_place.trim()) setTimeout(() => arrTimeRef.current?.focus(), 120);
                    else setTimeout(() => arrIcaoRef.current?.focus(), 120);
                  } else {
                    setTimeout(() => depTimeRef.current?.focus(), 80);
                  }
                }}
                onConfirm={() => {
                  if (form.dep_utc && isValidTime(form.dep_utc)) {
                    if (form.arr_place.trim()) setTimeout(() => arrTimeRef.current?.focus(), 120);
                    else setTimeout(() => arrIcaoRef.current?.focus(), 120);
                  } else {
                    setTimeout(() => depTimeRef.current?.focus(), 80);
                  }
                }}
              />
              <View style={{ marginTop: 6 }}>
                <SmartTimeInput
                  ref={depTimeRef}
                  label=""
                  align="left"
                  value={timeMode === 'utc' ? form.dep_utc : depLocalBuf}
                  onChangeText={(v) => {
                    if (timeMode === 'utc') set('dep_utc', v); else onDepLocalChange(v);
                    // Auto-avancera när dep-tiden är komplett (HH:MM): om arr-platsen redan är
                    // ifylld (t.ex. reverse latest flight) → hoppa direkt till arr-tid, annars arr ICAO.
                    if (isValidTime(v)) {
                      if (form.arr_place.trim()) setTimeout(() => arrTimeRef.current?.focus(), 120);
                      else setTimeout(() => arrIcaoRef.current?.focus(), 120);
                    }
                  }}
                  error={errors.dep_utc}
                  showNowBtn={false}
                  onSubmitEditing={() => {
                    if (form.dep_place.trim() && isValidTime(form.dep_utc)) {
                      if (form.arr_place.trim()) setTimeout(() => arrTimeRef.current?.focus(), 120);
                      else setTimeout(() => arrIcaoRef.current?.focus(), 120);
                    }
                  }}
                  rightAdornment={
                    <View style={{ alignItems: 'flex-end', gap: 1 }}>
                      <Pressable
                        onPress={toggleTimeMode}
                        hitSlop={10}
                        style={({ pressed }) => ({
                          backgroundColor: Colors.gold + (pressed ? '38' : '22'),
                          borderColor: Colors.gold + '7A', borderWidth: 1, borderRadius: 6,
                          paddingHorizontal: 6, paddingVertical: 2,
                        })}
                      >
                        <Text style={{ fontSize: 10.5, fontWeight: '800', color: Colors.gold, fontFamily: 'JetBrainsMono', letterSpacing: 0.5 }}>
                          {timeMode === 'utc' ? 'UTC' : (tzAbbr(instantFromDateTime(form.date, '12:00') ?? new Date(0), depLatLon?.country, depLatLon?.region, depLatLon?.lon) ?? 'LT')}
                        </Text>
                      </Pressable>
                      {(() => {
                        if (!isValidTime(form.dep_utc)) return null;
                        const below = timeMode === 'utc'
                          ? localLabel(instantFromDateTime(form.date, form.dep_utc) ?? new Date(0), depLatLon?.country, depLatLon?.region, depLatLon?.lon)
                          : `${form.dep_utc} UTC`;
                        return below ? <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.gold, fontFamily: 'JetBrainsMono' }}>{below}</Text> : null;
                      })()}
                    </View>
                  }
                />
              </View>
            </View>

            <View style={styles.placeColDivider} />

            {/* ── ARRIVAL ── */}
            <View style={{ flex: 1 }}>
              <View style={styles.placeColHeader}>
                <Text style={styles.placeColHeaderText}>{t('arrival')}</Text>
              </View>
              <View style={[styles.locSegment, { marginBottom: 6 }]}>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, !arrCustom && styles.locSegmentBtnActive]}
                  onPress={() => { setArrCustom(false); set('arr_place', ''); }}
                >
                  <Text style={[styles.locSegmentText, !arrCustom && styles.locSegmentTextActive]}>{t('icao_label')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locSegmentBtn, arrCustom && styles.locSegmentBtnActive]}
                  onPress={() => { setArrCustom(true); set('arr_place', ''); }}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.locSegmentText, arrCustom && styles.locSegmentTextActive]}>{t('temporary_label')}</Text>
                </TouchableOpacity>
              </View>
              <IcaoInput
                ref={arrIcaoRef}
                label=""
                value={form.arr_place}
                onChangeText={(v) => set('arr_place', v)}
                error={errors.arr_place}
                recentPlaces={top2places}
                allowHere={arrCustom}
                onFocus={() => {
                  const target = Math.max(0, routeBlockY.current - 8);
                  requestAnimationFrame(() => {
                    scrollViewRef.current?.scrollTo({ y: target, animated: true });
                  });
                  setTimeout(() => {
                    scrollViewRef.current?.scrollTo({ y: target, animated: true });
                  }, 320);
                }}
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
              <View style={{ marginTop: 6 }}>
                <SmartTimeInput
                  ref={arrTimeRef}
                  label=""
                  align="left"
                  value={timeMode === 'utc' ? form.arr_utc : arrLocalBuf}
                  onChangeText={timeMode === 'utc' ? (v) => set('arr_utc', v) : onArrLocalChange}
                  error={errors.arr_utc}
                  showNowBtn={false}
                  rightAdornment={
                    <View style={{ alignItems: 'flex-end', gap: 1 }}>
                      <Pressable
                        onPress={toggleTimeMode}
                        hitSlop={10}
                        style={({ pressed }) => ({
                          backgroundColor: Colors.gold + (pressed ? '38' : '22'),
                          borderColor: Colors.gold + '7A', borderWidth: 1, borderRadius: 6,
                          paddingHorizontal: 6, paddingVertical: 2,
                        })}
                      >
                        <Text style={{ fontSize: 10.5, fontWeight: '800', color: Colors.gold, fontFamily: 'JetBrainsMono', letterSpacing: 0.5 }}>
                          {timeMode === 'utc' ? 'UTC' : (tzAbbr(instantFromDateTime(form.date, '12:00') ?? new Date(0), arrLatLon?.country, arrLatLon?.region, arrLatLon?.lon) ?? 'LT')}
                        </Text>
                      </Pressable>
                      {(() => {
                        if (!isValidTime(form.arr_utc)) return null;
                        const below = timeMode === 'utc'
                          ? localLabel(instantFromDateTime(form.date, form.arr_utc) ?? new Date(0), arrLatLon?.country, arrLatLon?.region, arrLatLon?.lon)
                          : `${form.arr_utc} UTC`;
                        return below ? <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.gold, fontFamily: 'JetBrainsMono' }}>{below}</Text> : null;
                      })()}
                    </View>
                  }
                />
              </View>
            </View>
          </View>
        </View>

        {/* ── Route-karta (dag/natt) — togglas av ROUTE-rubriken ovanför rutan ── */}
        {sunRouteOpen && routeReady && (
          <View style={styles.card}>
            <DayNightMap embedded points={routeLegs} date={form.date} depUtc={form.dep_utc} arrUtc={form.arr_utc} flightType={form.flight_type} />
          </View>
        )}

        {/* Flight type */}
        <View style={styles.flightTypePicker}>
          {(['normal', 'touch_and_go', 'sim'] as const).map((ft) => {
            const labels: Record<string, string> = {
              normal: t('normal'),
              touch_and_go: t('dn_route'),
              sim: t('ffs_sim'),
            };
            const active = (form.flight_type ?? 'normal') === ft;
            // Route behåller sina stopp även när man väljer normal/sim; chippen guldmarkeras
            // då för att visa att det finns sparade stopp (tas bort via ✕ i Route-listan).
            const hasStops = ft === 'touch_and_go' && routeStops.length > 0;
            return (
              <TouchableOpacity
                key={ft}
                style={[styles.flightTypeChip, active && styles.flightTypeChipActive, hasStops && !active && { borderColor: Colors.gold, backgroundColor: Colors.gold + '1A' }]}
                onPress={() => {
                  set('flight_type', ft);
                  if (ft === 'sim' && !form.sim_category) set('sim_category', 'FFS');
                  if (ft !== 'sim') set('sim_category', '');
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.flightTypeChipText, active && styles.flightTypeChipTextActive, hasStops && !active && { color: Colors.gold }]}>
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
        {/* ── Route stops: Touch & go/low approach · Hot refuel · Pickup/dropoff ── */}
        {form.flight_type === 'touch_and_go' && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {/* Vänster: väljare */}
              <View style={{ width: '46%', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setKindMenuOpen(true)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 }}
                >
                  <Text style={{ flex: 1, color: draft.kind ? Colors.textPrimary : Colors.textMuted, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>{draft.kind ? KIND_LABEL[draft.kind] : 'Choose type'}</Text>
                  <Ionicons name="chevron-down" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>

                <IcaoInput
                  label=""
                  value={draft.icao}
                  onChangeText={(v) => setDraft((d) => ({ ...d, icao: v }))}
                  hideHere
                  placeholder="ICAO"
                />

                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['2d', '3d'] as const).map((a) => {
                    const on = draft.appType === a;
                    return (
                      <TouchableOpacity key={a} onPress={() => setDraft((d) => ({ ...d, appType: on ? null : a, runway: null, navaid: null }))} activeOpacity={0.75}
                        style={{ flex: 1, alignItems: 'center', backgroundColor: on ? Colors.primary : Colors.elevated, borderWidth: 1, borderColor: on ? Colors.primary : Colors.border, borderRadius: 6, paddingVertical: 6 }}>
                        <Text style={{ color: on ? Colors.textInverse : Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>{a.toUpperCase()} APP</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {draft.appType && draft.icao.trim().length >= 3 && (() => {
                  const rws = (runwayData as Record<string, number[]>)[draft.icao.trim().toUpperCase()] || [];
                  const all = rws.flatMap((h) => [h, (h + 180) % 360]);
                  if (!all.length) return null;
                  return (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {all.map((h) => {
                        const on = draft.runway === h;
                        return (
                          <TouchableOpacity key={h} onPress={() => setDraft((d) => ({ ...d, runway: h }))} activeOpacity={0.75}
                            style={{ backgroundColor: on ? Colors.primary : Colors.elevated, borderWidth: 1, borderColor: on ? Colors.primary : Colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }}>
                            <Text style={{ color: on ? Colors.textInverse : Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>{rwy2(h)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })()}

                {draft.appType && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {(draft.appType === '2d' ? APP_2D : APP_3D).map((n) => {
                      const on = draft.navaid === n;
                      return (
                        <TouchableOpacity key={n} onPress={() => setDraft((d) => ({ ...d, navaid: on ? null : n }))} activeOpacity={0.75}
                          style={{ backgroundColor: on ? Colors.primary : Colors.elevated, borderWidth: 1, borderColor: on ? Colors.primary : Colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 }}>
                          <Text style={{ color: on ? Colors.textInverse : Colors.textPrimary, fontSize: 10, fontWeight: '700' }}>{n}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {(() => {
                  const canAdd = draft.icao.trim().length >= 2 && !!draft.kind;
                  return (
                    <TouchableOpacity onPress={addRouteStop} disabled={!canAdd} activeOpacity={0.8}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, paddingVertical: 9, marginTop: 2, backgroundColor: !canAdd ? Colors.elevated : Colors.primary + '22', borderWidth: 1, borderColor: !canAdd ? Colors.border : Colors.primary }}>
                      <Ionicons name="add" size={16} color={!canAdd ? Colors.textMuted : Colors.primary} />
                      <Text style={{ color: !canAdd ? Colors.textMuted : Colors.primary, fontSize: 12, fontWeight: '700' }}>Add</Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>

              {/* Höger: lista (DEP låst överst, stoppen omflyttbara, ARR låst nederst) */}
              <View style={{ flex: 1, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.elevated, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 7, opacity: 0.85 }}>
                  <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>{(form.dep_place || '—').toUpperCase()}</Text>
                  <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700' }}>DEP</Text>
                </View>

                {routeStops.map((s, i) => (
                  <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingLeft: 8, paddingRight: 2, paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>{s.icao} <Text style={{ color: Colors.primary, fontSize: 10 }}>{KIND_TOKEN[s.kind]}</Text></Text>
                      {(s.navaid || s.appType) && s.runway != null && (
                        <Text style={{ color: Colors.textMuted, fontSize: 9, fontFamily: 'JetBrainsMono' }}>{s.navaid || s.appType?.toUpperCase()} rwy {rwy2(s.runway)}</Text>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => moveRouteStop(i, -1)} disabled={i === 0} hitSlop={6} style={{ padding: 3, opacity: i === 0 ? 0.3 : 1 }}><Ionicons name="chevron-up" size={15} color={Colors.textSecondary} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => moveRouteStop(i, 1)} disabled={i === routeStops.length - 1} hitSlop={6} style={{ padding: 3, opacity: i === routeStops.length - 1 ? 0.3 : 1 }}><Ionicons name="chevron-down" size={15} color={Colors.textSecondary} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => removeRouteStop(i)} hitSlop={6} style={{ padding: 3 }}><Ionicons name="close" size={15} color={Colors.textMuted} /></TouchableOpacity>
                  </View>
                ))}

                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.elevated, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 7, opacity: 0.85 }}>
                  <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>{(form.arr_place || '—').toUpperCase()}</Text>
                  <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700' }}>ARR</Text>
                </View>
              </View>
            </View>

            <Modal visible={kindMenuOpen} transparent animationType="fade" onRequestClose={() => setKindMenuOpen(false)}>
              <Pressable style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: 28 }} onPress={() => setKindMenuOpen(false)}>
                <View style={{ backgroundColor: Colors.card, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border }}>
                  {KIND_ORDER.map((k, i) => (
                    <TouchableOpacity key={k} onPress={() => { setDraft((d) => ({ ...d, kind: k })); setKindMenuOpen(false); }} activeOpacity={0.7}
                      style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < KIND_ORDER.length - 1 ? 1 : 0, borderBottomColor: Colors.separator, backgroundColor: draft.kind === k ? Colors.primary + '18' : 'transparent' }}>
                      <Text style={{ color: draft.kind === k ? Colors.primary : Colors.textPrimary, fontSize: 14, fontWeight: draft.kind === k ? '800' : '600' }}>{KIND_LABEL[k]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Pressable>
            </Modal>
          </View>
        )}

        {/* hot refuel ingår nu i Route-stoppen ovan */}

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
            <Counter label={t('day')} value={form.landings_day} onChange={(v) => { setLandingsManual(true); set('landings_day', v); }} />
            <View style={styles.counterDivider} />
            <Counter label={t('night')} value={form.landings_night} onChange={(v) => { setLandingsManual(true); set('landings_night', v); }} />
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
                // Destinationens approach-val (oberoende av route-stoppen).
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
                            set('remarks', form.remarks ? `${form.remarks}\n${newLine}` : newLine);
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
                            if (firstOpposite == null) return;
                            setSelectedRunway(firstOpposite);
                            const newLine = `${form.arr_place?.toUpperCase()} ${selectedApp?.toUpperCase()} app rwy ${Math.round(firstOpposite / 10).toString().padStart(2, '0')}`;
                            set('remarks', form.remarks ? `${form.remarks}\n${newLine}` : newLine);
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
                          <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>Back</Text>
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
                          backgroundColor: selectedRunway === oppositeHeading ? Colors.primary : Colors.elevated,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: selectedRunway === oppositeHeading ? Colors.primary : Colors.border,
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
              }
              // NVG är fristående — påverkar inte night.
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
              }
              // NVG är fristående — påverkar inte night.
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

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.cardFieldLabel}>{t('night')} ({pct(form.night)}%)</Text>
                  <View style={{ flex: 1 }} />
                  {(() => {
                    // Mörker-intervall LÄNGS RUTTEN under flygningen (sol < −6°, samma sampling som night-värdet).
                    // Finns inget mörker under flyget men night är överstyrd → visa dagens mörkerfönster
                    // (avgångsregionen) i RÖTT så man ser när mörkret faktiskt infaller. Guld = auto.
                    if (!depLatLon || !arrLatLon || !form.date) return null;
                    const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
                    if (!inst) return null;
                    const [Y, Mo, Da] = form.date.split('-').map(Number);
                    if (!Y || !Mo || !Da) return null;
                    const zone = timeMode === 'utc' ? 'UTC' : (tzAbbr(inst.dep, depLatLon.country, depLatLon.region, depLatLon.lon) ?? 'LT');
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const fmtClock = (d: Date) => timeMode === 'utc' ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
                      : (utcToLocalHHMM(d, depLatLon!.country, depLatLon!.region, depLatLon!.lon) ?? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);
                    const fmt = (hhmm: string) => timeMode === 'utc' ? hhmm
                      : (utcToLocalHHMM(instantFromDateTime(form.date, hhmm) ?? new Date(0), depLatLon!.country, depLatLon!.region, depLatLon!.lon) ?? hhmm);
                    const dw = computeDarkWindow({
                      depLat: depLatLon.lat, depLon: depLatLon.lon, arrLat: arrLatLon.lat, arrLon: arrLatLon.lon,
                      dep: inst.dep, arr: inst.arr, altitudeDeg: CIVIL_TWILIGHT_DEG,
                    });
                    let txt: string; let red = nightManual;
                    if (dw.minutes > 0 && dw.start && dw.end) {
                      txt = `${t('civ_twilight')} ${fmtClock(dw.start)}–${fmtClock(dw.end)} ${zone}`;
                    } else if (nightManual) {
                      const day = sunTimesUTC(new Date(Date.UTC(Y, Mo - 1, Da, 12, 0)), depLatLon.lat, depLatLon.lon, CIVIL_TWILIGHT_DEG);
                      if (day.sunset && day.sunrise) txt = `${t('civ_twilight')} ${fmt(day.sunset)}–${fmt(day.sunrise)} ${zone}`;
                      else {
                        const noonUtc = new Date(Date.UTC(Y, Mo - 1, Da, 12, 0) - Math.round((depLatLon.lon / 15) * 3600000));
                        txt = solarAltitudeDeg(noonUtc, depLatLon.lat, depLatLon.lon) < CIVIL_TWILIGHT_DEG ? t('polar_dark') : t('polar_light');
                      }
                      red = true;
                    } else return null;
                    return (
                      <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right', color: red ? Colors.danger : Colors.gold, fontSize: 11, fontFamily: 'JetBrainsMono', letterSpacing: 0.3 }}>
                        {txt}
                      </Text>
                    );
                  })()}
                  {nightManual && depLatLon && arrLatLon && (
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setNightManual(false); setRawTime((r) => { const n = { ...r }; delete n.night; return n; }); }}
                      hitSlop={8}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: Colors.gold + '7A', backgroundColor: Colors.gold + '22' }}
                    >
                      <Ionicons name="refresh" size={11} color={Colors.gold} />
                      <Text style={{ fontSize: 10, fontWeight: '800', color: Colors.gold, fontFamily: 'JetBrainsMono' }}>{t('reset')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.sliderRow}>
                  <TextInput
                    style={[styles.nvgInput, styles.sliderInput]}
                    value={valueFor('night', form.night)}
                    onChangeText={(v) => { setNightManual(true); onHhmmChange('night', v); }}
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
                      onValueChange={(v) => { setNightManual(true); setPct('night', v); }}
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.cardFieldLabel}>NVG ({pct(form.nvg ?? '0')}%)</Text>
                      <View style={{ flex: 1 }} />
                      {(() => {
                        // Röd varning om NVG-tiden överstiger tiden solen är vid/under horisonten längs
                        // rutten (sol-centrum < −0.30°). Finns inget sådant fönster under flyget (mitt på
                        // dagen) → visa dagens fönster (avgångsregionen) så man ser när mörkret infaller.
                        // Reset sätter NVG till rätt värde (max möjliga = ruttens fönster, 0 mitt på dagen).
                        const nvgN = parseFloat(form.nvg ?? '0') || 0;
                        if (nvgN <= 0 || !depLatLon || !arrLatLon || !form.date) return null;
                        const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
                        if (!inst) return null;
                        const [Y, Mo, Da] = form.date.split('-').map(Number);
                        if (!Y || !Mo || !Da) return null;
                        const dw = computeDarkWindow({
                          depLat: depLatLon.lat, depLon: depLatLon.lon, arrLat: arrLatLon.lat, arrLon: arrLatLon.lon,
                          dep: inst.dep, arr: inst.arr, altitudeDeg: -0.30,
                        });
                        const windowH = dw.minutes / 60;
                        if (nvgN <= windowH + 0.02) return null; // ryms i fönstret → ingen varning
                        const zone = timeMode === 'utc' ? 'UTC' : (tzAbbr(inst.dep, depLatLon.country, depLatLon.region, depLatLon.lon) ?? 'LT');
                        const pad = (n: number) => String(n).padStart(2, '0');
                        const fmtClock = (d: Date) => timeMode === 'utc' ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
                          : (utcToLocalHHMM(d, depLatLon!.country, depLatLon!.region, depLatLon!.lon) ?? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);
                        const fmt = (hhmm: string) => timeMode === 'utc' ? hhmm
                          : (utcToLocalHHMM(instantFromDateTime(form.date, hhmm) ?? new Date(0), depLatLon!.country, depLatLon!.region, depLatLon!.lon) ?? hhmm);
                        let txt: string;
                        if (dw.start && dw.end) {
                          txt = `${t('sunset_lbl')} ${fmtClock(dw.start)} · ${t('dawn_lbl')} ${fmtClock(dw.end)} ${zone}`;
                        } else {
                          const day = sunTimesUTC(new Date(Date.UTC(Y, Mo - 1, Da, 12, 0)), depLatLon.lat, depLatLon.lon, -0.30);
                          if (day.sunset && day.sunrise) txt = `${t('sunset_lbl')} ${fmt(day.sunset)} · ${t('dawn_lbl')} ${fmt(day.sunrise)} ${zone}`;
                          else txt = t('polar_light');
                        }
                        return (
                          <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right', color: Colors.danger, fontSize: 11, fontFamily: 'JetBrainsMono', letterSpacing: 0.3 }}>
                            {txt}
                          </Text>
                        );
                      })()}
                    </View>
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
        <FormField
          label={t('remarks')}
          value={form.remarks}
          onChangeText={(v) => set('remarks', v)}
          placeholder={t('remarks_ph')}
          multiline
          numberOfLines={2}
          maxLength={50}
          style={{ minHeight: 60, textAlignVertical: 'top' }}
        />
        {role === 'picus' && (
          <View style={styles.remarksWarning}>
            <Ionicons name="warning" size={14} color={Colors.warning} />
            <Text style={styles.remarksWarningText}>{t('picus_requires_instructor')}</Text>
          </View>
        )}

        {/* (stoppens approach-/navaid-val sker nu i Route-väljaren ovan) */}

        {/* Approach type quick selection — Arrival section */}
        {(() => {
          if (!selectedApp || !selectedRunway) return null;

          return (() => {
            const approachTypes = selectedApp === '2d'
              ? ['VOR', 'NDB', 'LOC', 'DME', 'LNAV']
              : ['GBAS', 'GLS', 'ILS', 'PAR', 'RNAV'];

            const arrLineRegex = new RegExp(`^${form.arr_place?.toUpperCase()}\\s+(.*)$`, 'im');
            const arrLine = arrLineRegex.exec(form.remarks)?.[0] || '';
            const hasApproachType = approachTypes.some(type => arrLine.includes(type));
            const hasDesignator = /rwy \d{2,3}[LCR]/i.test(arrLine);

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
                          const updated = replaceApproachTypeForStop(form.remarks, form.arr_place || '', type);
                          // Om replaceApproachTypeForStop inte gjorde någon ändring (ingen befintlig rad), lägg till ny rad
                          if (updated === form.remarks && form.arr_place) {
                            const newLine = `${form.arr_place.toUpperCase()} ${type} app`;
                            set('remarks', form.remarks ? `${form.remarks}\n${newLine}` : newLine);
                          } else {
                            set('remarks', updated);
                          }
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText]} numberOfLines={1}>{type}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {hasApproachType && hasDesignator && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '700', minWidth: 44 }}>
                    {form.arr_place?.toUpperCase()}:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
                    <TouchableOpacity
                      style={[styles.chip, styles.chipAdd]}
                      onPress={() => {
                        const currentRemarks = form.remarks;
                        const arrPlacePattern = `${form.arr_place?.toUpperCase()}.*?rwy`;
                        const regex = new RegExp(arrPlacePattern, 'i');

                        if (regex.test(currentRemarks)) {
                          // Redan finns runway-info, ersätt den
                          const replaceRegex = new RegExp(`${form.arr_place?.toUpperCase()}.*?rwy \\d{2,3}[LCR]?`, 'i');
                          const newRemarks = currentRemarks.replace(replaceRegex, (match) => match.replace(/rwy \d{2,3}[LCR]?/i, `rwy ${Math.round(selectedRunway / 10).toString().padStart(2, '0')}`));
                          set('remarks', newRemarks);
                        } else {
                          // Ingen runway-info än, lägg till den
                          const newLine = `${form.arr_place?.toUpperCase()} ${selectedApp?.toUpperCase()} app rwy ${Math.round(selectedRunway / 10).toString().padStart(2, '0')}`;
                          set('remarks', currentRemarks && form.flight_type === 'touch_and_go' ? `${currentRemarks}\n${newLine}` : (currentRemarks ? `${currentRemarks}\n${newLine}` : newLine));
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText]} numberOfLines={1}>{Math.round(selectedRunway / 10).toString().padStart(2, '0')}</Text>
                    </TouchableOpacity>
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

        {/* Generiska remarks-förslag borttagna på begäran — endast approach-hjälpen (ovan) kvar. */}

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
                <Text style={{ color: Colors.textMuted, fontSize: 13, fontWeight: '600' }}>Image</Text>
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
          const sumN = (parseFloat(form.ifr) || 0) + (parseFloat(form.vfr ?? '') || 0);
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
                <Text style={styles.datePickerDoneText}>{t('done') ?? 'Done'}</Text>
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

      {/* Sparade kabinpersonalsnamn — välj namn (fyller tom rad / lägger till ny). */}
      <Modal
        visible={showCrewNameModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCrewNameModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowCrewNameModal(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('saved_crew_names')}</Text>
            <Text style={{ color: Colors.textMuted, fontSize: 10, marginBottom: 8 }}>Hold to remove</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {savedCrewNames.length === 0 ? (
                <Text style={styles.modalEmpty}>{t('no_saved_crew')}</Text>
              ) : (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {[0, 1, 2].map((col) => (
                    <View key={col} style={{ flex: 1 }}>
                      {savedCrewNames.filter((_, i) => i % 3 === col).map((n) => (
                        <TouchableOpacity
                          key={n}
                          style={[styles.modalItem, { paddingVertical: 10 }]}
                          onPress={() => { applyCrewName(n); setShowCrewNameModal(false); }}
                          onLongPress={() => {
                            Alert.alert(n, 'Remove this name?', [
                              { text: t('cancel'), style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: async () => { await deleteSavedCrewName(n); setSavedCrewNames(await getSavedCrewNames()); } },
                            ]);
                          }}
                          delayLongPress={600}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.modalItemText, { fontSize: 13 }]}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </View>
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

    </KeyboardAvoidingView>
  );
}
