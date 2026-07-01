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
import * as Haptics from 'expo-haptics';
import { FormField } from '../../components/FormField';
import { IcaoInput } from '../../components/IcaoInput';
import type { IcaoInputHandle } from '../../components/IcaoInput';
import { SmartTimeInput } from '../../components/SmartTimeInput';
import type { SmartTimeInputHandle } from '../../components/SmartTimeInput';
import { insertFlight, updateFlight, getFlightById, getRecentAircraftTypes, getRecentRegistrations, getRecentPlaces, getRecentRemarks, getRecentSecondPilots, getRecentSecondPilotsWithRole, getFlights, addToAircraftRegistry, addAircraftTypeToRegistry, getAircraftEndurance, getAircraftCrewType, getAircraftCategory, flagFlightsByRegistration, flagFlightsBySecondPilot, deleteRegistrationFromRegistry, getSavedCrewNames, addSavedCrewNames, deleteSavedCrewName } from '../../db/flights';
import { AircraftModal } from '../../components/AircraftModal';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { buildInstants, computeDarkWindow, instantFromDateTime, CIVIL_TWILIGHT_DEG } from '../../utils/flightTime';
import { solarAltitudeDeg } from '../../utils/sun';
import { DayNightMap } from '../../components/DayNightMap';
import { SlideToggle } from '../../components/logflight/SlideToggle';
import { CondBar } from '../../components/logflight/CondBar';
import { TolRow } from '../../components/logflight/MiniStepper';
import { FONT_LED7, FONT_LED14 } from '../../components/logflight/tokens';
import { CountryFlag } from '../../components/CountryFlag';
import { PersonPicker, type SavedPerson } from '../../components/logflight/PersonPicker';
import { computeNightHoursTimed, vertexArrivalTimes, sampleTimedRoute, type SunState } from '../../utils/dayNight';
import { TwilightBar } from '../../components/logflight/TwilightBar';
import { ApproachFlow, APP_TYPES, type ApproachVal } from '../../components/logflight/ApproachFlow';
import { SunGlobe } from '../../components/logflight/SunGlobe';
import { MaxAltBar } from '../../components/logflight/MaxAltBar';
import { useProfileStore } from '../../store/profileStore';
import { localLabel, utcToLocalHHMM, localToUtcHHMM } from '../../utils/timezone';
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
  takeoffs_day: '1',
  takeoffs_night: '0',
  app_2d: '0',
  app_3d: '0',
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

// "ESSV TnG ILS app rwy 01" / "ESSA PU/DO" / "ESGG HR 3D app rwy 09"
function serializeStop(s: RouteStop): string {
  let line = `${s.icao.toUpperCase()} ${KIND_TOKEN[s.kind]}`;
  const app = s.navaid || (s.appType ? s.appType.toUpperCase() : null);
  if (app && s.runway != null) line += ` ${app} app rwy ${rwy2(s.runway)}`;
  return line;
}

const STOP_RE = /^([A-Z]{2,4})\s+(TnG|LA|PU\/DO|PU|DO|HR)(?:\s+(2D|3D|VOR|NDB|LOC|DME|LNAV|ILS|GLS|GBAS|PAR|RNAV)\s+app\s+rwy\s+(\d{2,3}))?\s*$/i;
// Kompakt approach-rad i remarks (designens ApproachFlow): "ESSA ILS 27" / "ESGG VOR 03L".
// Skiljd från STOP_RE (som har "app rwy") så route-stoppen inte rörs.
const APPROACH_LINE_RE = /^([A-Z]{3,4})\s+(ILS|RNAV|GLS|VOR|NDB|LOC)(?:\s+(\d{1,2}[LCR]?))?$/i;
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

    errorInline: { color: Colors.danger, fontSize: 11, marginTop: 2 },

    placeBlock: {
      backgroundColor: Colors.card, borderRadius: 16, padding: 14, paddingTop: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
      zIndex: 10, // så ICAO-autocomplete kan flyta över sektionerna under
    },
    // Designens två ben-paneler: svag cyan-yta som blöder ut till kortets kant.
    legRow: { flexDirection: 'row', alignItems: 'stretch', marginHorizontal: -14 },
    legPanelLeft: {
      flex: 1, gap: 8, backgroundColor: Colors.primary + '0D',
      borderTopWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderColor: Colors.separator,
      borderTopRightRadius: 12, borderBottomRightRadius: 12, padding: 12, paddingBottom: 11,
    },
    legPanelRight: {
      flex: 1, gap: 8, backgroundColor: Colors.primary + '0D',
      borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: Colors.separator,
      borderTopLeftRadius: 12, borderBottomLeftRadius: 12, padding: 12, paddingBottom: 11,
    },
    placeColHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 2 },
    placeColHeaderText: { color: Colors.textPrimary, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },

    // Designens tap-ruta för aircraft type / registration (chevron → sparade + lägg till).
    pickBox: {
      flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 11,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    },
    pickBoxValue: { flex: 1, fontFamily: 'JetBrainsMono', fontSize: 16, fontWeight: '800', letterSpacing: 1, color: Colors.textPrimary },
    pickBoxTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: '100%' },
    pickBoxDivider: { width: 1, height: 20, backgroundColor: Colors.border, marginHorizontal: 6 },

    // Namn-förslagslista (andre pilot / cabin crew) — inline under namn-rutan (skjuter ner innehåll).
    nameSuggest: {
      marginTop: 4,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden',
    },
    nameSuggestItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9 },
    nameSuggestSep: { borderTopWidth: 0.5, borderTopColor: Colors.separator },
    nameSuggestText: { flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },

    // Dropdownflik (aircraft type / registration) — flyter attached under rutan.
    ddFlyout: {
      position: 'absolute', top: '100%', marginTop: 4, zIndex: 50, elevation: 8,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 8,
      shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
    },
    ddEmpty: { fontFamily: 'JetBrainsMono', fontSize: 10, color: Colors.textMuted, paddingVertical: 4 },
    ddChip: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
    ddChipActive: { backgroundColor: Colors.primary + '24', borderColor: Colors.primary },
    ddChipText: { fontFamily: 'JetBrainsMono', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: Colors.textSecondary },
    ddChipTextActive: { color: Colors.primary },
    ddCell: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 7, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
    ddCellText: { fontFamily: 'JetBrainsMono', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3, color: Colors.textSecondary },

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
      flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 10, borderRadius: 10,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    roleBtnActive: {
      backgroundColor: Colors.primary + '24', borderColor: Colors.primary,
    },
    roleBtnDisabled: { opacity: 0.35 },
    roleBtnText: {
      color: Colors.textSecondary, fontSize: 10.5, fontWeight: '700',
      fontFamily: 'JetBrainsMono', letterSpacing: 0.3,
    },
    roleBtnTextActive: { color: Colors.primary },
    specialRoleBtn: {
      flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      backgroundColor: Colors.elevated, borderRadius: 10,
      paddingHorizontal: 6, paddingVertical: 10,
      borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border,
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
  // Lås skärm-scroll medan man drar i en bar (slider) → fingret kan glida upp/ner utan att sidan rör sig.
  const [scrollLocked, setScrollLocked] = useState(false);

  type PrimaryRole = 'pic' | 'co_pilot' | 'dual' | 'picus' | 'spic' | 'ferry_pic' | 'observer' | 'relief_crew';
  const [role, setRole] = useState<PrimaryRole>('pic');
  const [fi, setFi] = useState(false);
  const [examinerOverlay, setExaminerOverlay] = useState(false);
  const [safetyPilotOverlay, setSafetyPilotOverlay] = useState(false);
  const [showSpecialRole, setShowSpecialRole] = useState(false);
  const [depCustom, setDepCustom] = useState(false);
  const [arrCustom, setArrCustom] = useState(false);
  // Inline nedfällda staplar för aircraft type / registration (ersätter de gamla pop up-modalerna).
  const [typeOpen, setTypeOpen] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  // Någon PersonPicker-dropdown (andre pilot/extra pilot/cabin crew) är öppen → lyft kortet.
  const [personOpen, setPersonOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // Log Flight-redesign: Quicklog (essentials) ↔ Full (alla sektioner). Default Full.
  const [logFull, setLogFull] = useState(true);

  const [lastFlight, setLastFlight] = useState<Flight | null>(null);
  const [recentTypes, setRecentTypes] = useState<string[]>([]);
  const [recentRegs, setRecentRegs] = useState<string[]>([]);
  const [recentPilotsRoles, setRecentPilotsRoles] = useState<SavedPerson[]>([]);
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
  // Designens ApproachFlow: per ICAO {dim,app,rwy}. Synkas in i remarks som "ESSA ILS 27".
  const [approaches, setApproaches] = useState<Record<string, ApproachVal>>({});
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
  // Route-info (total/distans/fart/glob/dagsbar/stops) visas först när dep+arr (plats+tid) är
  // ifyllda — och förblir sedan synlig (uppdateras, försvinner inte) även om man ändrar ett värde.
  const routeComplete = !!depLatLon && !!arrLatLon && isValidTime(form.dep_utc) && isValidTime(form.arr_utc);
  const [routeRevealed, setRouteRevealed] = useState(false);
  useEffect(() => { if (routeComplete) setRouteRevealed(true); }, [routeComplete]);

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

  // Skymnings-segment längs rutten (samma sol-modell som "Sun route"-kartan) → TwilightBar.
  const twilightSegs = useMemo(() => {
    if (routeLegs.length < 2 || !form.date || !isValidTime(form.dep_utc) || !isValidTime(form.arr_utc)) return [];
    const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
    if (!inst) return [];
    const depMs = inst.dep.getTime(), arrMs = inst.arr.getTime();
    const totalMs = arrMs - depMs;
    if (!(totalMs > 0)) return [];
    const pts = sampleTimedRoute(routeLegs, depMs, arrMs, 120);
    if (!pts.length) return [];
    const stateColor = (k: SunState) => k === 'day' ? Colors.success : k === 'night' ? Colors.info : Colors.gold;
    const runs: { k: SunState; ms: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const tPrev = i === 0 ? pts[0].timeMs : (pts[i - 1].timeMs + pts[i].timeMs) / 2;
      const tNext = i === pts.length - 1 ? pts[i].timeMs : (pts[i].timeMs + pts[i + 1].timeMs) / 2;
      const w = Math.max(0, tNext - tPrev);
      const st = pts[i].state;
      if (runs.length && runs[runs.length - 1].k === st) runs[runs.length - 1].ms += w;
      else runs.push({ k: st, ms: w });
    }
    return runs.map((r) => ({ k: r.k, f: (r.ms / totalMs) * 100, c: stateColor(r.k) }));
  }, [routeLegs, form.date, form.dep_utc, form.arr_utc]);

  // Connector-glyf: flygplan vs helikopter — baserat på SENAST flugna modell, annars
  // onboarding-valet (helikopter/fixed wing). Oberoende av aktuell aircraft_type.
  // Connector-glyf: helikopter vs flygplan från farkostens LAGRADE kategori (anges när man
  // lägger till farkosten via smart search/manuellt). Källa: aktuell typ → senast flugna →
  // onboarding-val (om ingen typ/kategori finns).
  const profileSubRole = useProfileStore((s) => s.profile?.subRole);
  const [glyphIsHeli, setGlyphIsHeli] = useState(false);
  useEffect(() => {
    const src = (form.aircraft_type || '').trim() || lastFlight?.aircraft_type || '';
    if (!src) { setGlyphIsHeli(profileSubRole === 'rotary'); return; }
    let alive = true;
    getAircraftCategory(src)
      .then((cat) => { if (alive) setGlyphIsHeli(cat === 'helicopter' ? true : cat === 'airplane' ? false : profileSubRole === 'rotary'); })
      .catch(() => { if (alive) setGlyphIsHeli(profileSubRole === 'rotary'); });
    return () => { alive = false; };
  }, [form.aircraft_type, lastFlight, profileSubRole]);

  // ApproachFlow: ICAO:n att välja approach för = ankomst + ev. route-stopp (ej avgång).
  const approachIcaos = useMemo(() => {
    const out: string[] = [];
    for (const s of routeStops) { const ic = s.icao.trim().toUpperCase(); if (ic.length >= 3 && !out.includes(ic)) out.push(ic); }
    const arr = (form.arr_place || '').trim().toUpperCase();
    if (arr.length >= 3 && !out.includes(arr)) out.push(arr);
    return out;
  }, [routeStops, form.arr_place]);
  const runwaysFor = useCallback((icao: string) => {
    const hs = (runwayData as Record<string, number[]>)[(icao || '').toUpperCase()] || [];
    const out: string[] = [];
    for (const h of hs) {
      const a = rwy2(h), b = rwy2((h + 180) % 360);
      if (!out.includes(a)) out.push(a);
      if (!out.includes(b)) out.push(b);
    }
    return out;
  }, []);
  // Synka valda approaches in i remarks som kompakta rader (designens "in remarks").
  // Rör bara APPROACH_LINE_RE-rader → fri text och route-stoppen (STOP_RE) lämnas orörda.
  useEffect(() => {
    const lines = approachIcaos
      .map((ic) => approaches[ic])
      .map((v, i) => (v && v.app) ? `${approachIcaos[i]} ${v.app}${v.rwy ? ` ${v.rwy}` : ''}` : null)
      .filter(Boolean) as string[];
    setForm((prev) => {
      const kept = (prev.remarks || '').split('\n').filter((ln) => ln.trim() !== '' && !APPROACH_LINE_RE.test(ln.trim()));
      const merged = [...kept, ...lines].join('\n');
      if (merged === (prev.remarks || '')) return prev;
      return { ...prev, remarks: merged };
    });
  }, [approaches, approachIcaos]);

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

      // Parse kompakta approach-rader → ApproachFlow-state (designens flow visar dem igen)
      const parsedApp: Record<string, ApproachVal> = {};
      (f.remarks || '').split('\n').forEach((ln) => {
        const m = APPROACH_LINE_RE.exec(ln.trim());
        if (m) {
          const app = m[2].toUpperCase();
          parsedApp[m[1].toUpperCase()] = { dim: APP_TYPES['2d'].includes(app) ? '2d' : '3d', app, rwy: m[3] };
        }
      });
      if (Object.keys(parsedApp).length > 0) setApproaches(parsedApp);

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
        takeoffs_day: String(f.takeoffs_day ?? 0),
        takeoffs_night: String(f.takeoffs_night ?? 0),
        app_2d: String(f.app_2d ?? 0),
        app_3d: String(f.app_3d ?? 0),
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
      getRecentSecondPilotsWithRole().then(setRecentPilotsRoles).catch(() => {});
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

  // Lägg till ny registrering (från "+"-knappen i registration-stapeln).
  const promptAddRegistration = useCallback(() => {
    if (!form.aircraft_type) { Alert.alert(t('select_aircraft_type_first'), t('enter_aircraft_type_before_reg')); return; }
    Alert.prompt(
      t('new_registration'),
      `${t('add_registration_for')} ${form.aircraft_type}`,
      async (reg) => {
        const r = reg?.trim().toUpperCase();
        if (!r) return;
        await addToAircraftRegistry(form.aircraft_type, r);
        setRecentRegs(await getRecentRegistrations(form.aircraft_type));
        set('registration', r);
      },
      'plain-text', '',
    );
  }, [form.aircraft_type, t]);

  // "+" i namn-rutan → skriv in ett nytt namn (blir valt; sparas i historiken när flygningen loggas).
  const promptAddPersonName = (title: string, onName: (n: string) => void) => {
    Alert.prompt(title, '', (v) => { const n = (v || '').trim(); if (n) onName(n); }, 'plain-text', '');
  };

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

  // Alla individer för vald typ, i fallande ordning (senast flugna först)
  // Filtrera på påbörjad inmatning om registrering redan är ifylld
  const filteredRegs = form.registration
    ? recentRegs.filter((r) => r.startsWith(form.registration.toUpperCase()))
    : recentRegs;

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

      {/* Quicklog ↔ Full + Real ↔ Sim (Log Flight-redesign) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
        <SlideToggle
          sans
          options={[{ value: 'quick', label: 'Quicklog' }, { value: 'full', label: 'Full' }]}
          value={logFull ? 'full' : 'quick'}
          onChange={(v) => setLogFull(v === 'full')}
        />
        <View style={{ flex: 1 }} />
        <SlideToggle
          sans
          options={[{ value: 'real', label: 'Real flight' }, { value: 'sim', label: 'Sim' }]}
          value={form.flight_type === 'sim' ? 'sim' : 'real'}
          onChange={(v) => {
            if (v === 'sim') { set('flight_type', 'sim'); if (!form.sim_category) set('sim_category', 'FFS'); }
            else { set('flight_type', 'normal'); set('sim_category', ''); }
          }}
          activeColor={form.flight_type === 'sim' ? Colors.gold : Colors.primary}
        />
      </View>

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        scrollEnabled={!scrollLocked}
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


        {/* ── Route ── (ingen rubrik/pil; sol-rutten nås ENBART via globen i kortet) */}
        <View style={{ marginTop: 10 }} />

        {/* Departure (vänster) / Arrival (höger) — två sektioner sida vid sida.
            Varje sektion: rubrik → ICAO/ZZZZ (off-airport) → fritext-plats → tidsruta (UTC/lokal). */}
        <View style={styles.placeBlock} onLayout={(e) => { routeBlockY.current = e.nativeEvent.layout.y; }}>
          {/* Sim-typväljare högst upp i route-kortet (designen) — endast i Sim-läge */}
          {form.flight_type === 'sim' && (
            <View style={{ marginBottom: 12 }}>
              <Text style={[styles.cardFieldLabel, { marginBottom: 6 }]}>{t('simulator_type')}</Text>
              <View style={styles.simCatRow}>
                {(['FFS','FTD','FNPT_II','FNPT_I','BITD','CPT_PPT','CBT'] as const).map((cat) => {
                  const active = form.sim_category === cat;
                  return (
                    <TouchableOpacity key={cat} style={[styles.simCatBtn, active && styles.simCatBtnActive]} onPress={() => set('sim_category', cat)} activeOpacity={0.75}>
                      <Text style={[styles.simCatText, active && styles.simCatTextActive]}>{cat.replace(/_/g, '/')}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {(form.sim_category === 'CPT_PPT' || form.sim_category === 'CBT') && (
                <View style={[styles.remarksWarning, { marginTop: 7 }]}>
                  <Ionicons name="warning" size={14} color={Colors.warning} />
                  <Text style={styles.remarksWarningText}>{t('sim_no_credit_warning')}</Text>
                </View>
              )}
            </View>
          )}
          <View style={styles.legRow}>
            {/* ── DEPARTURE ── */}
            <View style={styles.legPanelLeft}>
              <View style={styles.placeColHeader}>
                <Text style={styles.placeColHeaderText}>{t('departure')}</Text>
              </View>
              <SlideToggle
                block
                sans
                options={[{ value: 'icao', label: t('icao_label') }, { value: 'temp', label: 'ZZZZ' }]}
                value={depCustom ? 'temp' : 'icao'}
                onChange={(v) => { setDepCustom(v === 'temp'); set('dep_place', ''); }}
              />
              <IcaoInput
                ref={depIcaoRef}
                label=""
                inputFontFamily={FONT_LED14}
                design
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
                  inputFontFamily={FONT_LED7}
                  compactRight
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
                    <Pressable onPress={toggleTimeMode} hitSlop={10} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: FONT_LED14, fontSize: 15, fontWeight: '700', color: timeMode === 'utc' ? Colors.primary : Colors.gold }}>
                        {timeMode === 'utc' ? 'Z' : 'L'}
                      </Text>
                    </Pressable>
                  }
                />
                {isValidTime(form.dep_utc) && (() => {
                  const below = timeMode === 'utc'
                    ? localLabel(instantFromDateTime(form.date, form.dep_utc) ?? new Date(0), depLatLon?.country, depLatLon?.region, depLatLon?.lon)
                    : `${form.dep_utc} UTC`;
                  return below ? <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '700', color: Colors.textMuted, marginTop: 3, paddingLeft: 2 }}>{below}</Text> : null;
                })()}
              </View>
            </View>

            {/* Connector — landsflaggor (dep→arr) + streckad linje + nedåtriktad farkost-glyf.
                Glyf = senast flugna modell (annars onboarding-val), oberoende av aktuell typ. */}
            <View style={{ width: 38, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 }}>
              <CountryFlag code={depLatLon?.country} height={15} />
              <View style={{ flex: 1, minHeight: 12, width: 0, borderLeftWidth: 2, borderColor: Colors.primary + '80', borderStyle: 'dashed' }} />
              <Image
                source={glyphIsHeli ? require('../../assets/Pilot-helicopter.PNG') : require('../../assets/Pilot-fixedwing.PNG')}
                style={{ width: 48, height: 48, transform: [{ rotate: '180deg' }], tintColor: Colors.primary }}
                resizeMode="contain"
              />
              <View style={{ flex: 1, minHeight: 12, width: 0, borderLeftWidth: 2, borderColor: Colors.primary + '80', borderStyle: 'dashed' }} />
              <CountryFlag code={arrLatLon?.country} height={15} />
            </View>

            {/* ── ARRIVAL ── */}
            <View style={styles.legPanelRight}>
              <View style={styles.placeColHeader}>
                <Text style={styles.placeColHeaderText}>{t('arrival')}</Text>
              </View>
              <SlideToggle
                block
                sans
                options={[{ value: 'icao', label: t('icao_label') }, { value: 'temp', label: 'ZZZZ' }]}
                value={arrCustom ? 'temp' : 'icao'}
                onChange={(v) => { setArrCustom(v === 'temp'); set('arr_place', ''); }}
              />
              <IcaoInput
                ref={arrIcaoRef}
                label=""
                inputFontFamily={FONT_LED14}
                design
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
                  inputFontFamily={FONT_LED7}
                  compactRight
                  value={timeMode === 'utc' ? form.arr_utc : arrLocalBuf}
                  onChangeText={timeMode === 'utc' ? (v) => set('arr_utc', v) : onArrLocalChange}
                  error={errors.arr_utc}
                  showNowBtn={false}
                  rightAdornment={
                    <Pressable onPress={toggleTimeMode} hitSlop={10} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: FONT_LED14, fontSize: 15, fontWeight: '700', color: timeMode === 'utc' ? Colors.primary : Colors.gold }}>
                        {timeMode === 'utc' ? 'Z' : 'L'}
                      </Text>
                    </Pressable>
                  }
                />
                {isValidTime(form.arr_utc) && (() => {
                  const below = timeMode === 'utc'
                    ? localLabel(instantFromDateTime(form.date, form.arr_utc) ?? new Date(0), arrLatLon?.country, arrLatLon?.region, arrLatLon?.lon)
                    : `${form.arr_utc} UTC`;
                  return below ? <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '700', color: Colors.textMuted, marginTop: 3, paddingLeft: 2 }}>{below}</Text> : null;
                })()}
              </View>
            </View>
          </View>

          {/* Route-info visas först när allt är ifyllt; sedan uppdateras den bara (försvinner ej). */}
          {routeRevealed && (<>
          {/* ── Total flygtid (hero) + distans + sol-glob — designens route-card ── */}
          {(() => {
            const isNightFlight = (parseFloat(form.night) || 0) > 0;
            const distNm = (depLatLon && arrLatLon) ? (() => {
              const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
              const dLat = toRad(arrLatLon.lat - depLatLon.lat), dLon = toRad(arrLatLon.lon - depLatLon.lon);
              const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(depLatLon.lat)) * Math.cos(toRad(arrLatLon.lat)) * Math.sin(dLon / 2) ** 2;
              return Math.round((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1.852);
            })() : null;
            return (
              <View style={{ position: 'relative', marginTop: 12, minHeight: 70, alignItems: 'center', justifyContent: 'center' }}>
                {/* distans + medelfart till vänster (vit LED), synkat med globen till höger */}
                {form.flight_type !== 'sim' && distNm != null && (() => {
                  const totalH = parseFloat(form.total_time) || 0;
                  const spd = totalH > 0 ? Math.round(distNm / totalH) : null;
                  return (
                    <View style={{ position: 'absolute', left: 0, top: 4, gap: 9 }}>
                      <View>
                        <Text style={{ fontFamily: FONT_LED14, fontWeight: '800', fontSize: 20, color: '#FFFFFF' }}>
                          {distNm}<Text style={{ fontSize: 9, color: Colors.primary, fontFamily: 'JetBrainsMono' }}>{' '}NM</Text>
                        </Text>
                        <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 7.5, fontWeight: '800', letterSpacing: 1.4, color: Colors.textMuted, textTransform: 'uppercase', marginTop: 2 }}>{t('distance')}</Text>
                      </View>
                      {spd != null && (
                        <View>
                          <Text style={{ fontFamily: FONT_LED14, fontWeight: '800', fontSize: 20, color: '#FFFFFF' }}>
                            {spd}<Text style={{ fontSize: 9, color: Colors.primary, fontFamily: 'JetBrainsMono' }}>{' '}Knots</Text>
                          </Text>
                          <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 7.5, fontWeight: '800', letterSpacing: 1.4, color: Colors.textMuted, textTransform: 'uppercase', marginTop: 2 }}>{t('avg_speed')}</Text>
                        </View>
                      )}
                    </View>
                  );
                })()}
                {/* center: total flygtid (guld, redigerbar) */}
                <View style={{ alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: Colors.primary + '88', backgroundColor: Colors.gold + '0D' }}>
                  {editingTotalTime ? (
                    <TextInput
                      style={{ fontFamily: FONT_LED7, fontSize: 28, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', minWidth: 130, padding: 0 }}
                      value={totalTimeEditValue}
                      onChangeText={setTotalTimeEditValue}
                      onBlur={() => {
                        let decimal = 0;
                        if (totalTimeEditValue.includes(':')) {
                          const [h, m] = totalTimeEditValue.split(':');
                          const hh = parseInt((h || '0').replace(/\D/g, '') || '0', 10) || 0;
                          const mm = Math.min(59, parseInt((m || '0').replace(/\D/g, '') || '0', 10) || 0);
                          decimal = hh + mm / 60;
                        } else {
                          decimal = parseFloat(totalTimeEditValue) || 0;
                        }
                        if (decimal > 0) set('total_time', String(decimal.toFixed(2)));
                        setEditingTotalTime(false);
                      }}
                      onFocus={() => setTotalTimeEditValue(form.total_time ? decimalToHHMM(parseFloat(form.total_time)) : '')}
                      placeholder="0:00"
                      keyboardType="numbers-and-punctuation"
                      placeholderTextColor={Colors.textMuted}
                      autoFocus
                    />
                  ) : (
                    <TouchableOpacity onPress={() => setEditingTotalTime(true)} activeOpacity={0.7}>
                      <Text style={{ fontFamily: FONT_LED7, fontSize: 28, fontWeight: '800', color: form.total_time ? '#FFFFFF' : Colors.textMuted }}>
                        {form.total_time ? decimalToHHMM(parseFloat(form.total_time)) : '--:--'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <Text style={{ marginTop: 5, fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: '#FFFFFF', textTransform: 'uppercase' }}>{t('total_flight_time')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isNightFlight ? Colors.info : Colors.gold }} />
                    <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: '#FFFFFF', textTransform: 'uppercase' }}>{isNightFlight ? t('night_flight') : t('day_flight')} flight</Text>
                  </View>
                  {errors.total_time && <Text style={styles.errorInline}>{errors.total_time}</Text>}
                </View>
                {/* höger: designens digitala sol-glob → öppnar sun route (enda vägen dit) */}
                {form.flight_type !== 'sim' && routeReady && (() => {
                  const totalH = parseFloat(form.total_time) || 0;
                  const nightH = parseFloat(form.night) || 0;
                  const lit = totalH > 0 ? Math.max(0, Math.min(1, 1 - nightH / totalH)) : 1;
                  return (
                    <TouchableOpacity onPress={() => setSunRouteOpen(true)} activeOpacity={0.8} style={{ position: 'absolute', right: 0, top: 0, alignItems: 'center', gap: 3 }}>
                      <SunGlobe size={60} lit={lit} />
                      <Text style={{ flexDirection: 'row', fontFamily: 'JetBrainsMono', fontSize: 7.5, fontWeight: '700', letterSpacing: 0.4, color: Colors.textMuted, textTransform: 'uppercase' }}>{t('sun_route')}</Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>
            );
          })()}

          {/* ── Dag/skymning/natt/gryning längs rutten (sol-route-data) — designens TwilightBar ── */}
          {form.flight_type !== 'sim' && twilightSegs.length > 0 && (() => {
            const totalH = parseFloat(form.total_time) || 0;
            const nvgPct = totalH > 0 ? Math.min(100, ((parseFloat(form.nvg ?? '0') || 0) / totalH) * 100) : 0;
            const nightLabel = (parseFloat(form.night) || 0) > 0 ? decimalToHHMM(parseFloat(form.night)) : undefined;
            return (
              <View style={{ marginTop: 13 }}>
                <TwilightBar segs={twilightSegs} nightLabel={nightLabel} nvgPct={nvgPct} />
              </View>
            );
          })()}
          {/* Stops / via — inbakad i nedre kanten: chip på streckad skiljelinje, expanderar kortet */}
          {logFull && form.flight_type !== 'sim' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1, marginHorizontal: -14, paddingHorizontal: 12 }}>
              <View style={{ flex: 1, borderTopWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' }} />
              <TouchableOpacity
                onPress={() => { set('flight_type', form.flight_type === 'touch_and_go' ? 'normal' : 'touch_and_go'); }}
                activeOpacity={0.75}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 8,
                  backgroundColor: Colors.card, borderWidth: 1, borderColor: form.flight_type === 'touch_and_go' ? Colors.primary : Colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}
              >
                <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: form.flight_type === 'touch_and_go' ? Colors.primary : Colors.textSecondary }}>{t('stops_via')}</Text>
                {routeStops.length > 0 && (
                  <View style={{ backgroundColor: Colors.primary, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '800', color: Colors.textInverse }}>{routeStops.length}</Text>
                  </View>
                )}
                <Ionicons name={form.flight_type === 'touch_and_go' ? 'chevron-up' : 'chevron-down'} size={13} color={Colors.textSecondary} />
              </TouchableOpacity>
              <View style={{ flex: 1, borderTopWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' }} />
            </View>
          )}
          {form.flight_type === 'touch_and_go' && (
          <View style={{ marginTop: 12 }}>
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
          </>)}
        </View>

        {/* ── Sun route (dag/natt) i modal — designens route-vy, öppnas av ROUTE-rubriken ── */}
        <Modal visible={sunRouteOpen && routeReady} transparent animationType="slide" onRequestClose={() => setSunRouteOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' }} onPress={() => setSunRouteOpen(false)}>
            <Pressable style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: Colors.border, paddingTop: 10, paddingBottom: 28, paddingHorizontal: 14 }} onPress={(e) => e.stopPropagation()}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontFamily: 'Fraunces', fontSize: 17, fontWeight: '600', color: Colors.textPrimary }}>Sun route</Text>
                <TouchableOpacity onPress={() => setSunRouteOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <DayNightMap embedded points={routeLegs} date={form.date} depUtc={form.dep_utc} arrUtc={form.arr_utc} flightType={form.flight_type} />
            </Pressable>
          </Pressable>
        </Modal>



        {/* hot refuel ingår nu i Route-stoppen ovan */}

        {/* ── Flight rules (VFR / Y·Z / IFR) — visas först när rutt+tider är ifyllda (som route-info) ── */}
        {routeRevealed && (
        <View style={{ paddingHorizontal: 4, marginTop: 2, marginBottom: 14 }}>
          {(() => {
            const ruleVal = (form.flight_rules === 'Z' || form.flight_rules === 'Mixed') ? 'Y' : (form.flight_rules ?? 'VFR');
            // Quicklog: bara VFR/IFR (designen) · Full: VFR/Y·Z/IFR. Y/Z visas som IFR i quicklog.
            const qVal = ruleVal === 'Y' ? 'IFR' : ruleVal;
            const options = logFull
              ? [{ value: 'VFR', label: 'VFR' }, { value: 'Y', label: 'Y/Z' }, { value: 'IFR', label: 'IFR' }]
              : [{ value: 'VFR', label: 'VFR' }, { value: 'IFR', label: 'IFR' }];
            return (
              <SlideToggle
                block
                sans
                size="md"
                options={options}
                value={logFull ? ruleVal : qVal}
                onChange={(v) => {
                  set('flight_rules', v);
                  // Knapp → barer: VFR/IFR fyller helt, Y/Z delar 50/50 (om inte redan mixad).
                  const tot = parseFloat(form.total_time) || 0;
                  if (v === 'VFR') { set('vfr', tot.toFixed(2)); set('ifr', '0'); }
                  else if (v === 'IFR') { set('ifr', tot.toFixed(2)); set('vfr', '0'); }
                  else {
                    const ifrNow = parseFloat(form.ifr ?? '0') || 0, vfrNow = parseFloat(form.vfr ?? '0') || 0;
                    if (ifrNow <= 0 || vfrNow <= 0) { set('ifr', (tot / 2).toFixed(2)); set('vfr', (tot / 2).toFixed(2)); }
                  }
                  setRawTime((r) => { const n = { ...r }; delete n.ifr; delete n.vfr; return n; });
                }}
                activeColor={ruleVal === 'VFR' ? Colors.success : ruleVal === 'IFR' ? Colors.primary : Colors.gold}
              />
            );
          })()}
        </View>
        )}

        {/* ── Conditions (VFR/IFR/Night/NVG) — visas först när rutt+tider är ifyllda + Full ── */}
        {routeRevealed && logFull && (
          <View style={{ marginTop: 2, marginBottom: 6 }}>
          {(() => {
            const total = parseFloat(form.total_time) || 0;
            const pct = (v: string) => {
              const n = parseFloat(v) || 0;
              return total > 0 ? Math.round((n / total) * 100) : 0;
            };
            const cap = (n: number) => Math.min(Math.max(0, n), total || n);
            // Barerna äger värdet; knapparna (VFR/Y·Z/IFR) härleds av barerna. EN setForm per
            // drag-steg (ingen haptik/raw-churn per move) → mjuk, icke-laggig dragning.
            const setPct = (key: 'ifr' | 'vfr' | 'night' | 'nvg', p: number) => {
              const val = (total * p / 100);
              if (key === 'ifr' || key === 'vfr') {
                const ifrV = key === 'ifr' ? val : Math.max(0, total - val);
                const vfrV = Math.max(0, total - ifrV);
                const eps = 0.01;
                const rules = ifrV >= total - eps ? 'IFR' : (ifrV <= eps ? 'VFR' : 'Y');
                setForm((prev) => ({ ...prev, ifr: ifrV.toFixed(2), vfr: vfrV.toFixed(2), flight_rules: rules }));
              } else {
                setForm((prev) => ({ ...prev, [key]: val.toFixed(2) }));
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
              }
              // NVG är fristående — påverkar inte night.
            };
            const onHhmmBlur = (key: 'ifr' | 'vfr' | 'night' | 'nvg') => {
              setRawTime((r) => { const n = { ...r }; delete n[key]; return n; });
            };
            const valueFor = (key: 'ifr' | 'vfr' | 'night' | 'nvg', decimal: string) =>
              rawTime[key] !== undefined ? rawTime[key]! : formatForInput(decimal);
            // NVG-fönster i % (sol < −0.30° längs rutten) → röd fyllning förbi fönstret (design).
            const nvgWindowPct = (() => {
              if (!depLatLon || !arrLatLon || !form.date || total <= 0) return 100;
              const inst = buildInstants(form.date, form.dep_utc, form.arr_utc, 0);
              if (!inst) return 100;
              const dw = computeDarkWindow({ depLat: depLatLon.lat, depLon: depLatLon.lon, arrLat: arrLatLon.lat, arrLon: arrLatLon.lon, dep: inst.dep, arr: inst.arr, altitudeDeg: -0.30 });
              return Math.min(100, (dw.minutes / 60 / total) * 100);
            })();
            const lock = () => setScrollLocked(true);
            const unlock = () => setScrollLocked(false);
            const vfrCond = <CondBar key="vfr" label="VFR" pct={pct(form.vfr ?? '0')} onPct={(p) => setPct('vfr', p)} tint={Colors.success} totalMin={total * 60} onGrab={lock} onRelease={unlock} />;
            const ifrCond = <CondBar key="ifr" label="IFR" pct={pct(form.ifr)} onPct={(p) => setPct('ifr', p)} tint={Colors.primary} totalMin={total * 60} onGrab={lock} onRelease={unlock} />;
            // NVG synlig endast om flighten berörde skymning→gryning (annars meningslöst).
            const touchedTwilight = twilightSegs.some((s) => s.k !== 'day');
            return (
              <>
                {/* VFR + IFR alltid synliga; barerna och knapparna (VFR/Y·Z/IFR) är länkade. */}
                {vfrCond}{ifrCond}

                {/* Natt — manuell dragbar som åsidosätter auto-skymningen (route-kortets TwilightBar).
                    Real: 'auto'-pill tills man drar; reset-knappen dyker upp på samma plats. */}
                <CondBar
                  label={t('night')}
                  autoLabel={(!nightManual && form.flight_type !== 'sim') ? 'auto' : undefined}
                  onReset={(nightManual && form.flight_type !== 'sim' && depLatLon && arrLatLon) ? () => setNightManual(false) : undefined}
                  pct={pct(form.night)} onPct={(p) => { setNightManual(true); setPct('night', p); }} tint={Colors.info} totalMin={total * 60}
                  onGrab={lock} onRelease={unlock} />

                {(() => {
                  // NVG syns om flighten berörde skymning→gryning ELLER om man manuellt satt nattid
                  // (t.ex. dagflygning där man ändå loggar natt). Röd varning bara vid verkligt mörkerfönster.
                  const nightSet = (parseFloat(form.night) || 0) > 0;
                  const showNvg = form.flight_type === 'sim' ? nightSet : (touchedTwilight || nightSet);
                  if (!showNvg) return null;
                  const useWarn = form.flight_type !== 'sim' && touchedTwilight;
                  return (
                    <CondBar label="NVG" pct={pct(form.nvg ?? '0')} onPct={(p) => setPct('nvg', p)} tint="#9B8CFF" totalMin={total * 60}
                      warnAbove={useWarn ? nvgWindowPct : undefined}
                      notches={useWarn && nvgWindowPct < 100 ? [nvgWindowPct] : undefined}
                      onGrab={lock} onRelease={unlock} />
                  );
                })()}
              </>
            );
          })()}
          </View>
        )}

        {/* ── Aircraft & crew (designens kort) ── */}
        <View style={[styles.card, { gap: 12, marginBottom: 12 }, (typeOpen || regOpen || personOpen) ? { zIndex: 20 } : null]}>
          {/* Aircraft type + Registration — dropdownflikar (chevron öppnar), "+" i rutan lägger till nytt */}
          <View style={{ position: 'relative', zIndex: (typeOpen || regOpen) ? 30 : undefined }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1.1 }}>
                <Text style={styles.cardFieldLabel}>{t('aircraft_type')}</Text>
                <View style={styles.pickBox}>
                  <TouchableOpacity style={styles.pickBoxTap} onPress={() => { setRegOpen(false); setTypeOpen((o) => !o); }} activeOpacity={0.7}>
                    <Text style={[styles.pickBoxValue, !form.aircraft_type && { color: Colors.textMuted }]} numberOfLines={1}>{form.aircraft_type || 'C172'}</Text>
                    <Ionicons name={typeOpen ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <View style={styles.pickBoxDivider} />
                  <TouchableOpacity onPress={() => { setTypeOpen(false); setShowAircraftModal(true); }} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.7}>
                    <Ionicons name="add" size={18} color={Colors.primary} />
                  </TouchableOpacity>
                </View>
                {errors.aircraft_type ? <Text style={styles.errorInline}>{errors.aircraft_type}</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardFieldLabel}>{t('registration')}</Text>
                <View style={styles.pickBox}>
                  <TouchableOpacity style={styles.pickBoxTap} onPress={() => { if (!form.aircraft_type) { Alert.alert(t('select_aircraft_type_first'), t('enter_aircraft_type_before_reg')); return; } setTypeOpen(false); setRegOpen((o) => !o); }} activeOpacity={0.7}>
                    <Text style={[styles.pickBoxValue, !form.registration && { color: Colors.textMuted }]} numberOfLines={1}>{form.registration || 'SE-KXY'}</Text>
                    <Ionicons name={regOpen ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <View style={styles.pickBoxDivider} />
                  <TouchableOpacity onPress={() => { setRegOpen(false); promptAddRegistration(); }} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.7}>
                    <Ionicons name="add" size={18} color={Colors.primary} />
                  </TouchableOpacity>
                </View>
                {errors.registration ? <Text style={styles.errorInline}>{errors.registration}</Text> : null}
              </View>
            </View>

            {/* Dropdownflik: aircraft type — vertikala kolumner som byggs på åt höger */}
            {typeOpen && (
              <View style={[styles.ddFlyout, { left: 0, width: '55%' }]}>
                {recentTypes.length === 0 ? (
                  <Text style={styles.ddEmpty}>{t('no_saved_aircraft_types')}</Text>
                ) : (() => {
                  const ROWS = 8;
                  const cols: string[][] = [];
                  for (let i = 0; i < recentTypes.length; i += ROWS) cols.push(recentTypes.slice(i, i + ROWS));
                  return (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {cols.map((col, ci) => (
                        <View key={ci} style={{ flex: 1, gap: 6 }}>
                          {col.map((tp) => {
                            const active = form.aircraft_type === tp;
                            return (
                              <TouchableOpacity key={tp} style={[styles.ddChip, active && styles.ddChipActive]} onPress={() => { onTypeSelect(tp); setTypeOpen(false); }} activeOpacity={0.75}>
                                <Text numberOfLines={1} style={[styles.ddChipText, active && styles.ddChipTextActive]}>{tp}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  );
                })()}
              </View>
            )}

            {/* Dropdownflik: registration — vertikala kolumner, alfabetisk + numerisk ordning (KILO10 före KILO22) */}
            {regOpen && (
              <View style={[styles.ddFlyout, { left: 0, right: 0 }]}>
                {recentRegs.length === 0 ? (
                  <Text style={styles.ddEmpty}>{t('no_saved_registrations')}</Text>
                ) : (() => {
                  const sorted = [...recentRegs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
                  const ROWS = 8;
                  const cols: string[][] = [];
                  for (let i = 0; i < sorted.length; i += ROWS) cols.push(sorted.slice(i, i + ROWS));
                  return (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {cols.map((col, ci) => (
                        <View key={ci} style={{ flex: 1, gap: 4 }}>
                          {col.map((rg) => {
                            const active = form.registration === rg;
                            return (
                              <TouchableOpacity key={rg} style={[styles.ddCell, active && styles.ddChipActive]} onPress={() => { set('registration', rg); setRegOpen(false); }} activeOpacity={0.75}>
                                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.ddCellText, active && styles.ddChipTextActive]}>{rg}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  );
                })()}
              </View>
            )}
          </View>

          {/* Your role */}
          <View style={{ marginBottom: 4 }}>
              <Text style={styles.cardFieldLabel}>{t('your_role')}</Text>
              <View style={styles.roleGrid}>
                {/* Designens 3×2-rutnät: PIC · CO-PILOT · INSTRUCTOR / DUAL · PICUS · Special */}
                <View style={styles.roleRow}>
                  <TouchableOpacity
                    style={[styles.roleBtn, role === 'pic' && styles.roleBtnActive, (role === 'dual' || role === 'picus') && styles.roleBtnDisabled]}
                    disabled={role === 'dual' || role === 'picus'}
                    onPress={() => handleRoleChange('pic')}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleBtnText, role === 'pic' && styles.roleBtnTextActive]}>PIC</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.roleBtn, role === 'co_pilot' && styles.roleBtnActive, (role === 'dual' || role === 'picus') && styles.roleBtnDisabled]}
                    disabled={role === 'dual' || role === 'picus'}
                    onPress={() => handleRoleChange('co_pilot')}
                    activeOpacity={0.75}
                  >
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, role === 'co_pilot' && styles.roleBtnTextActive]}>CO-PILOT</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.roleBtn, fi && role === 'pic' && styles.roleBtnActive, role !== 'pic' && styles.roleBtnDisabled]}
                    disabled={role !== 'pic'}
                    onPress={toggleFi}
                    activeOpacity={0.75}
                  >
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, fi && role === 'pic' && styles.roleBtnTextActive]}>INSTRUCTOR</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.roleRow}>
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
                  {(() => {
                    const specialActive = ['spic', 'ferry_pic', 'observer', 'relief_crew'].includes(role) || examinerOverlay || safetyPilotOverlay;
                    return (
                      <TouchableOpacity
                        style={[styles.specialRoleBtn, specialActive && styles.roleBtnActive]}
                        onPress={() => setShowSpecialRole(true)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.roleBtnText, specialActive && styles.roleBtnTextActive]}>OTHER</Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>
              </View>
          </View>

          {/* Second pilot + fler piloter ombord — samma stil som aircraft type/registration */}
          <View>
            <Text style={styles.colFieldLabel}>{t('second_pilot_label')}</Text>
            <View style={{ gap: 6 }}>
              <PersonPicker
                name={form.second_pilot ?? ''}
                roleKey={form.second_pilot_role ?? ''}
                roleOptions={SP_ROLES}
                saved={recentPilotsRoles}
                placeholder={t('second_pilot_ph')}
                onPick={(n, r) => { set('second_pilot', n); if (r) selectSecondPilotRole(r); }}
                onChangeRole={(k) => selectSecondPilotRole(k)}
                onAddNew={() => promptAddPersonName(t('second_pilot_label'), (n) => set('second_pilot', n))}
                onAddMore={addExtraPilot}
                onToggle={setPersonOpen}
              />
              {extraPilots.map((p) => (
                <PersonPicker
                  key={p.id}
                  name={p.name}
                  roleKey={p.role}
                  roleOptions={SP_ROLES}
                  saved={recentPilotsRoles}
                  placeholder={t('second_pilot_ph')}
                  onPick={(n, r) => { updateExtraPilot(p.id, 'name', n); if (r) selectExtraPilotRole(p.id, r); }}
                  onChangeRole={(k) => selectExtraPilotRole(p.id, k)}
                  onAddNew={() => promptAddPersonName(t('second_pilot_label'), (n) => updateExtraPilot(p.id, 'name', n))}
                  onRemove={() => removeExtraPilot(p.id)}
                  onToggle={setPersonOpen}
                />
              ))}
            </View>
          </View>

          <View>
            <Text style={styles.colFieldLabel}>{t('crew_chief_label')}</Text>
            <View style={{ gap: 6 }}>
              {crewMembers.map((member, idx) => {
                const isLast = idx === crewMembers.length - 1;
                return (
                  <PersonPicker
                    key={member.id}
                    name={member.name}
                    roleKey={member.role}
                    roleOptions={CREW_ROLES}
                    saved={savedCrewNames.map((n) => ({ name: n }))}
                    placeholder={t('crew_name_ph')}
                    onPick={(n) => updateCrewMember(member.id, 'name', n)}
                    onChangeRole={(k) => updateCrewMember(member.id, 'role', k)}
                    onAddNew={() => promptAddPersonName(t('crew_chief_label'), (n) => { updateCrewMember(member.id, 'name', n); addSavedCrewNames([n]).then(() => getSavedCrewNames().then(setSavedCrewNames)).catch(() => {}); })}
                    onAddMore={isLast ? addCrewMember : undefined}
                    onRemove={isLast ? undefined : () => removeCrewMember(member.id)}
                    onToggle={setPersonOpen}
                  />
                );
              })}
            </View>
          </View>
        </View>

        {/* Take-offs · Approaches · Landings — Full: redigerbart · Quicklog: auto */}
        {!logFull ? (
          <View style={{ paddingHorizontal: 4, marginTop: 4, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="airplane" size={14} color={Colors.success} />
            <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>
              Auto · 1 take-off · 1 landing{(parseFloat(form.night) || 0) > 0 ? ' · night' : ' · day'}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 4, marginTop: 4, marginBottom: 14 }}>
          <TolRow first label="Take-offs"
            a={{ label: t('day'), value: parseInt(form.takeoffs_day ?? '0', 10) || 0, onChange: (n) => set('takeoffs_day', String(n)) }}
            b={{ label: t('night'), value: parseInt(form.takeoffs_night ?? '0', 10) || 0, onChange: (n) => set('takeoffs_night', String(n)) }} />
          {(form.flight_rules === 'IFR' || form.flight_rules === 'Y' || form.flight_rules === 'Z') && (
            <TolRow label="Approaches"
              a={{ label: '2D', value: parseInt(form.app_2d ?? '0', 10) || 0, onChange: (n) => set('app_2d', String(n)) }}
              b={{ label: '3D', value: parseInt(form.app_3d ?? '0', 10) || 0, onChange: (n) => set('app_3d', String(n)) }} />
          )}
          <TolRow label="Landings"
            a={{ label: t('day'), value: parseInt(form.landings_day ?? '0', 10) || 0, onChange: (n) => { setLandingsManual(true); set('landings_day', String(n)); } }}
            b={{ label: t('night'), value: parseInt(form.landings_night ?? '0', 10) || 0, onChange: (n) => { setLandingsManual(true); set('landings_night', String(n)); } }} />
        </View>
        )}
        {logFull && (form.flight_rules === 'IFR' || form.flight_rules === 'Y' || form.flight_rules === 'Z') && (
        <View style={styles.card}>
          {/* Max altitude — designens barometer (fot). Lagras som flygnivå (FL = fot/100). */}
          <MaxAltBar
            valueFt={(parseInt(form.max_fl ?? '', 10) || 0) * 100}
            onChangeFt={(ft) => set('max_fl', ft > 0 ? String(Math.round(ft / 100)) : '')}
            onGrab={() => setScrollLocked(true)}
            onRelease={() => setScrollLocked(false)}
          />
        </View>
        )}

        {/* ── Remarks · Approach · Media (endast Full) ── */}
        {logFull && (<>
        {/* Training approaches — designens ApproachFlow (per ICAO: 2D/3D → typ → rwy → remarks) */}
        {form.flight_type !== 'sim' && (
          <View style={{ marginBottom: 10 }}>
            <Text style={[styles.cardFieldLabel, { marginBottom: 6 }]}>{t('training_approaches')}</Text>
            <ApproachFlow
              icaos={approachIcaos}
              value={approaches}
              onChange={setApproaches}
              ifr={form.flight_rules === 'IFR' || form.flight_rules === 'Y' || form.flight_rules === 'Z'}
              runwaysFor={runwaysFor}
            />
          </View>
        )}
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
        </>)}

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
              onPress={() => { setReviewPromptCount(0); setShowPilotModal(false); router.push('/(tabs)/log' as any); }}
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
