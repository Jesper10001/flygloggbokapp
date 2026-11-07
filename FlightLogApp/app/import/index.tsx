import { HowItWorks } from '../../components/HowItWorks';
import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { lookupAircraft } from '../../services/aircraftLookup';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { pickImportFile, importFromFile, generateImportSummary, type ImportResult } from '../../services/import';
import { askAiConsent, isAiConsentError } from '../../services/aiConsent';
import { estimateNightForImport, countComputable, type NightBasis, type NightEstimate } from '../../services/importNight';
import { CondBar } from '../../components/logflight/CondBar';
import { CountryFlag } from '../../components/CountryFlag';
import { insertFlight, getAircraftCruiseSpeed, updateAircraftCruiseSpeed, updateAircraftEndurance, addAircraftTypeToRegistry, deleteFlights } from '../../db/flights';
import { matchFlightsToLogbook, idsToRemove, EMPTY_MATCH, type LogbookMatch } from '../../services/logbookMatch';
import { enrichFleetInBackground } from '../../services/fleetEnrich';
import { useFleetDoneStore } from '../../components/FleetDoneModal';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { PremiumModal } from '../../components/PremiumModal';
import { BladeProgress } from '../../components/BladeProgress';
import { presentPaywall } from '../../services/purchases';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError, tokensToCoins } from '../../utils/tokenGate';
import type { OcrFlightResult } from '../../types/flight';
import { TextInput as RNTextInput } from 'react-native';
import { getAirportByIcao, addCustomAirport, addTemporaryPlace, getAirportCoordinates, calculateDistance } from '../../db/icao';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  ReportHero, AnalysisCard, SectionLabel, CheckGroup, CheckItem, EditRow, TotalsGrid, ListRow, SaveFooter, FOOTER_SPACE, periodOf,
  ReviewFlightRow, useCheckNav, datesIn, dayMonth, reviewForAi, logbookReview, ClashRow, clashOthers,
  type ReportTheme, type CheckStatus, type ReviewGroup, type ReviewFlight, type ClashChoice,
} from '../../components/import/ImportReport';

// Flygningar att se över under "Before you save" (och som AI:ns text länkar till): tider som kapades till flygtiden,
// platser som inte är kända flygplatser (ZZZZ m.fl.) och noteringar från läsningen som nämner ett datum.
// used = noteringarna som blivit en grupp (de står då inte också under "Notes on your file").
// Först jämförelsen med loggboken: krockar i tid och flygningar som redan finns (components/import/ImportReport).
const CAP_LABEL: Record<string, string> = {
  pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual', night: 'Night', ifr: 'IFR', instructor: 'Instructor', solo: 'Solo',
  cross_country: 'Cross-country', picus: 'PICUS', se_time: 'SE', me_time: 'ME',
};
const GROUP_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  clash: 'git-compare-outline', dups: 'copy-outline', capped: 'cut-outline', places: 'location-outline',
};
function buildPilotReview(flights: OcrFlightResult[], unknown: Set<string>, warnings: string[], fmt: (h: number) => string, match: LogbookMatch = EMPTY_MATCH): { groups: ReviewGroup[]; used: Set<string> } {
  const num = (v: unknown) => parseFloat(String(v ?? '')) || 0;
  const base = (f: OcrFlightResult, i: number): ReviewFlight => ({
    idx: i, date: f.date, route: `${f.dep_place || '?'} → ${f.arr_place || '?'}`,
    sub: [f.aircraft_type, f.registration, fmt(num(f.total_time))].filter(Boolean).join(' · '), detail: '',
  });
  const valuesOf = (f: OcrFlightResult) => {
    const parts = ([['PIC', 'pic'], ['Co-pilot', 'co_pilot'], ['Dual', 'dual'], ['Night', 'night'], ['IFR', 'ifr']] as const)
      .filter(([, k]) => num((f as any)[k]) > 0).map(([l, k]) => `${l} ${fmt(num((f as any)[k]))}`);
    const ld = num(f.landings_day), ln = num(f.landings_night);
    if (ld + ln > 0) parts.push(`Landings ${ld} day, ${ln} night`);
    if ((f as any).flight_type === 'sim') parts.unshift('Simulator');
    return parts.join(' · ');
  };
  const groups: ReviewGroup[] = logbookReview(match, (i) => base(flights[i], i), fmt);
  const used = new Set<string>();
  const capped = flights.map((f, i) => ({ f, i })).filter(({ f }) => (f.capped?.length ?? 0) > 0);
  if (capped.length) {
    const one = capped.length === 1;
    groups.push({
      id: 'capped', todo: true, title: 'Times cut to the flight time',
      about: `${one ? 'A time was' : 'Times were'} longer than the flight itself, so ${one ? 'it was' : 'they were'} cut to the flight time. Check against your logbook.`,
      flights: capped.map(({ f, i }) => ({ ...base(f, i), detail: f.capped!.map((c) => `${CAP_LABEL[c.field] ?? c.field} ${fmt(c.from)} → ${fmt(c.to)}`).join(' · ') })),
    });
    warnings.forEach((w) => { if (/exceeding total time/i.test(w)) used.add(w); });
  }
  const odd = flights.map((f, i) => ({ f, i, codes: [f.dep_place, f.arr_place].filter((c): c is string => !!c && unknown.has(c)) })).filter((x) => x.codes.length > 0);
  if (odd.length) {
    groups.push({
      id: 'places', todo: false, title: 'Unlisted places',
      about: "ZZZZ and codes we don't recognise are saved just as written. That's normal for off-airport landings; check that the places are right.",
      flights: odd.map(({ f, i, codes }) => ({ ...base(f, i), detail: `Not a known airport: ${[...new Set(codes)].join(', ')}` })),
    });
  }
  let k = 0;
  warnings.forEach((w) => {
    if (used.has(w)) return;
    const ds = datesIn(w);
    const hits = ds.length ? flights.map((f, i) => ({ f, i })).filter(({ f }) => ds.includes(f.date)) : [];
    if (!hits.length) return;
    used.add(w);
    groups.push({
      id: `note${++k}`, todo: true, about: w,
      title: ds.length === 1 ? `${hits.length === 1 ? 'Flight' : 'Flights'} on ${dayMonth(ds[0])}` : `Flights on ${ds.length} dates`,
      flights: hits.map(({ f, i }) => ({ ...base(f, i), detail: valuesOf(f) })),
    });
  });
  return { groups, used };
}

// Rapportens färger i pilotläget (samma rapport som drönarläget, components/import/ImportReport).
const REPORT_THEME: ReportTheme = {
  bg: Colors.background, card: Colors.card, elevated: Colors.elevated, border: Colors.cardBorder, separator: Colors.separator,
  text: Colors.textPrimary, text2: Colors.textSecondary, muted: Colors.textMuted,
  accent: Colors.primary, success: Colors.success, warning: Colors.warning, danger: Colors.danger, onAccent: Colors.textInverse,
};

// Roterande statustexter under AI-mappningen (den längsta fasen) — byts varannan sekund
const ANALYZE_STEPS = [
  'Identifying your logbook format…',
  'Mapping columns to logbook fields…',
  'Detecting date & time formats…',
  'Locating duration columns…',
  'Checking boolean flags & landings…',
  'Reviewing sample flights…',
];

// Introsidans innehåll — hur importen funkar + tillförlitlighet (i stället för app-lista)
const HOW_IT_WORKS = [
  { n: '1', t: 'Pick your export file', d: 'Export from your current logbook app and choose the file above.' },
  { n: '2', t: 'AI maps your columns', d: 'Claude identifies the format and maps dates, times, roles and landings. Only a small sample of rows is sent — every flight is parsed locally on your device.' },
  { n: '3', t: 'Review before saving', d: 'You get a full preview with statistics and an AI analysis. Nothing is saved until you approve.' },
];

const ACCEPTED_FORMATS = [
  { icon: 'document-text-outline', t: '.csv', d: 'comma, semicolon, tab or pipe separated' },
  { icon: 'grid-outline', t: '.xlsx / .xls', d: 'Excel workbooks' },
  { icon: 'document-outline', t: '.txt', d: 'plain text exports' },
];


function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 40, gap: 12 },

    title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
    subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

    hero: { gap: 4, marginBottom: 2 },
    uploadCard: {
      alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 18,
      borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary + '80',
      backgroundColor: Colors.primary + '0D',
    },
    uploadIconWrap: {
      width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '33',
    },
    uploadTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 2 },
    uploadSub: { color: Colors.textSecondary, fontSize: 12.5, textAlign: 'center', lineHeight: 17 },
    // Introsidans info-kort (How it works / formats / trust)
    infoCard: {
      backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder,
      padding: 14, gap: 12,
    },
    infoTitle: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    bulletTerm: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
    bulletDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17 },

    // AI-analys-kortet (fritextsammanfattning efter importanalysen)
    aiCard: {
      backgroundColor: Colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.primary + '33',
      padding: 14,
      gap: 10,
    },
    aiCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    aiCardTitle: { color: Colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    // Nattid-uppskattnings-kort (överst i förhandsvisningen)
    nightCard: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '55', padding: 14, gap: 10, marginBottom: 12 },
    nightHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    nightTitle: { color: Colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    nightSub: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
    nightToggle: { flexDirection: 'row', gap: 8 },
    nightBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
    nightBtnOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
    nightBtnTxt: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
    nightBtnTxtOn: { color: Colors.primary },
    nightResult: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
    nightExpandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    nightExpandTxt: { color: Colors.primary, fontSize: 12.5, fontWeight: '700' },
    skipItem: { gap: 5 },
    skipMeta: { color: Colors.textMuted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
    nightApply: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 10, backgroundColor: Colors.primary },
    nightApplyTxt: { color: Colors.textInverse, fontSize: 14, fontWeight: '800' },
    nightNote: { color: Colors.textMuted, fontSize: 11, lineHeight: 15 },
    nightCardDone: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.success + '18', borderRadius: 12, borderWidth: 1, borderColor: Colors.success + '55', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
    nightDoneTxt: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 },
    aiCardText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
    aiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    aiLoadingText: { color: Colors.textMuted, fontSize: 13, fontStyle: 'italic' },
    aiReadMore: { color: Colors.primary, fontSize: 12, fontWeight: '700', marginTop: -2 },
    tokenUsedText: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo', marginTop: 3 },
    chooseOtherBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 6 },
    chooseOtherText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },

    freeNotice: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.success + '18', borderRadius: 8,
      padding: 12, borderWidth: 1, borderColor: Colors.success + '44',
    },
    freeNoticeText: { color: Colors.success, fontSize: 13, fontWeight: '600' },

    section: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1,
      marginTop: 8, marginBottom: 4,
    },

    pickBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 12,
      paddingVertical: 15, gap: 8,
    },
    pickBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

    resultHeader: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    resultInfo: { flex: 1 },
    resultFormat: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    resultFile: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    resultStats: { flexDirection: 'row', gap: 8 },
    statPill: { alignItems: 'center' },
    statValue: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
    statLabel: { color: Colors.textMuted, fontSize: 9, textTransform: 'uppercase' },

    warningBox: {
      backgroundColor: Colors.warning + '18', borderRadius: 10, padding: 12,
      gap: 6, borderWidth: 1, borderColor: Colors.warning + '44',
    },
    warningRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    warningText: { color: Colors.warning, fontSize: 12, flex: 1 },

    summaryCard: {
      flexDirection: 'row', backgroundColor: Colors.card, borderRadius: 12,
      borderWidth: 1, borderColor: Colors.cardBorder,
      overflow: 'hidden',
    },
    summaryItem: { flex: 1, alignItems: 'center', paddingVertical: 16 },
    summaryValue: { color: Colors.primary, fontSize: 28, fontWeight: '800' },
    summaryLabel: { color: Colors.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
    summarySep: { width: 1, backgroundColor: Colors.separator, marginVertical: 12 },

    previewRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 8, padding: 10,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    previewRowFlagged: { borderColor: Colors.warning + '66' },
    previewRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    previewDate: { color: Colors.textSecondary, fontSize: 12 },
    previewChip: { color: Colors.primary, fontSize: 11, fontWeight: '700', fontFamily: 'Menlo' },
    moreText: { color: Colors.textMuted, fontSize: 12, textAlign: 'center' },

    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15, gap: 8, marginTop: 8,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
    hint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },

    instructionRow: {
      flexDirection: 'row', backgroundColor: Colors.card,
      borderRadius: 8, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    instructionApp: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', width: 110 },
    instructionSteps: { color: Colors.textSecondary, fontSize: 12, flex: 1 },

    speedSection: {
      backgroundColor: Colors.gold + '14',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.gold + '55', gap: 8,
    },
    speedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    speedTitle: { color: Colors.gold, fontSize: 12, fontWeight: '700' },
    speedSubtitle: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
    speedRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.card, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1, borderColor: Colors.border,
    },
    speedColHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
    speedType: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
    speedInput: {
      width: 72, color: Colors.textPrimary, fontSize: 15, fontWeight: '700',
      fontFamily: 'Menlo', textAlign: 'center',
      backgroundColor: Colors.elevated, borderRadius: 6,
      paddingHorizontal: 6, paddingVertical: 6,
      borderWidth: 1, borderColor: Colors.border,
    },
    speedInputDone: { borderColor: Colors.success + '66', backgroundColor: Colors.success + '12' },
    fieldLabel: { color: Colors.textSecondary, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8 },
    fieldInput: { width: '100%', paddingVertical: 9 },
    speedUnit: { color: Colors.textMuted, fontSize: 12, fontWeight: '600', width: 24 },

    exceedSection: {
      backgroundColor: Colors.warning + '12',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.warning + '55', gap: 8,
    },
    exceedTitle: { color: Colors.warning, fontSize: 12, fontWeight: '700' },
    exceedRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 8,
      padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 8,
    },
    exceedInfo: { flex: 1 },
    exceedRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
    exceedMeta: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
    exceedToggle: { flexDirection: 'row', gap: 4 },
    exceedBtn: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
      borderWidth: 1, borderColor: Colors.border,
      backgroundColor: Colors.elevated,
    },
    exceedBtnSim: { backgroundColor: Colors.danger + '22', borderColor: Colors.danger + '88' },
    exceedBtnHot: { backgroundColor: Colors.success + '22', borderColor: Colors.success + '88' },
    exceedBtnText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
    exceedBtnTextActive: { color: Colors.textPrimary, fontWeight: '700' },

    typeBlock: { gap: 6 },
    crewRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
    crewBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
    },
    crewBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
    crewBtnLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
    timeColSection: {
      backgroundColor: Colors.primary + '10',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.primary + '44', gap: 4,
    },
    timeColBtn: {
      flexGrow: 1, minWidth: 90, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10,
      borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
    },
    timeColBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
    timeColBtnLabel: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '700' },
    timeColBtnLabelActive: { color: Colors.primary },
    timeColBtnSub: { color: Colors.textMuted, fontSize: 9.5, marginTop: 1, maxWidth: 120 },
    crewBtnLabelActive: { color: Colors.primary },
    crewBtnSub: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },

    // Misstänkta sträckor
    suspiciousSection: {
      backgroundColor: Colors.warning + '12',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.warning + '55', gap: 8,
    },
    suspiciousTitle: { color: Colors.warning, fontSize: 12, fontWeight: '700' },
    suspiciousRow: {
      backgroundColor: Colors.card, borderRadius: 8,
      padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 8,
    },
    suspiciousInfo: { gap: 2 },
    suspiciousRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
    suspiciousMeta: { color: Colors.textSecondary, fontSize: 11 },
    suspiciousToggle: { flexDirection: 'row', gap: 6 },
    suspiciousBtn: {
      flex: 1, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6,
      borderWidth: 1, borderColor: Colors.border,
      backgroundColor: Colors.elevated, alignItems: 'center',
    },
    suspiciousBtnActive: { backgroundColor: Colors.textMuted + 'CC', borderColor: Colors.textMuted },
    suspiciousBtnRefuel: { backgroundColor: Colors.success + '22', borderColor: Colors.success + '88' },
    suspiciousBtnText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600', textAlign: 'center' },
    suspiciousBtnTextActive: { color: Colors.textInverse, fontWeight: '700' },

    // Okända flygplatser
    unknownSection: {
      backgroundColor: Colors.danger + '10',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.danger + '44', gap: 8,
    },
    unknownTitle: { color: Colors.danger, fontSize: 12, fontWeight: '700' },
    unknownRow: {
      backgroundColor: Colors.card, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    },
    unknownHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    },
    unknownIcao: {
      color: Colors.textPrimary, fontSize: 14, fontWeight: '800',
      fontFamily: 'Menlo', letterSpacing: 1,
    },
    unknownDecisionLabel: { color: Colors.success, fontSize: 11, fontWeight: '600', marginTop: 2 },
    unknownDecisionTemporary: { color: Colors.textMuted },
    unknownBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: Colors.separator },
    tempBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.elevated, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 1, borderColor: Colors.border,
    },
    tempBtnActive: { backgroundColor: Colors.textMuted, borderColor: Colors.textMuted },
    tempBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', flex: 1 },
    tempBtnTextActive: { color: Colors.textInverse },
    unknownForm: { gap: 6 },
    unknownFormLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 4 },
    unknownInput: {
      backgroundColor: Colors.elevated, borderRadius: 8, padding: 10,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14,
    },
  });
}

export default function ImportScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { timeFormat, formatTime } = useTimeFormat();
  const T = REPORT_THEME;
  const fmtH = (h: number) => `${formatTime(h)}${timeFormat === 'decimal' ? ' h' : ''}`;
  // Kom vi hit från onboarding? Då ska en lyckad import gå DIREKT till dashboarden (inte tillbaka till onboarding).
  const { from } = useLocalSearchParams<{ from?: string }>();
  const finishNav = () => (from === 'onboarding' ? router.replace('/(tabs)') : router.back());
  const { loadFlights, loadStats, isPremium, isMax } = useFlightStore();
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  // Roterande stegtext under importen (byts varannan sekund)
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!importing) { setStepIdx(0); return; }
    const id = setInterval(() => setStepIdx((i) => i + 1), 2000);
    return () => clearInterval(id);
  }, [importing]);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Laddskärmen med Blade-myntet (samma som skanningen): visas under hela importen, stannar en stund med
  // bock när filen är läst och tonar sedan bort över förhandsvisningen.
  const [overlay, setOverlay] = useState<'hidden' | 'busy' | 'done'>('hidden');
  const overlayFade = useRef(new Animated.Value(1)).current;
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  useEffect(() => () => { if (overlayTimer.current) clearTimeout(overlayTimer.current); }, []);
  const finishOverlay = () => {
    setOverlay('done');
    overlayTimer.current = setTimeout(() => {
      Animated.timing(overlayFade, { toValue: 0, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true })
        .start(() => setOverlay('hidden'));
    }, 1100);
  };
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');
  const [totalTimeCol, setTotalTimeCol] = useState(''); // vald varaktighetskolumn (Block/Air/Flight) → total_time
  // AI-sammanfattning av importen (fritext) — laddas asynkront efter analysen, även vid fel
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Nattid-uppskattning (när filen saknar night-fält) — fråga om tider är UTC/local + räkna ut.
  const [nightBasis, setNightBasis] = useState<NightBasis | null>(null);
  const [nightEst, setNightEst] = useState<NightEstimate | null>(null);
  const [nightApplied, setNightApplied] = useState(false);
  const [manualNight, setManualNight] = useState<Record<number, number>>({}); // skippade flygningar: nattid (h) per index
  const [skippedExpanded, setSkippedExpanded] = useState(false);
  const [scrollOn, setScrollOn] = useState(true); // lås scroll medan man drar en night-bar
  const [openType, setOpenType] = useState<string | null>(null); // flygplanstypen som är utfälld i Aircraft details
  const [excluded, setExcluded] = useState<Set<number>>(new Set());  // flygningar som lämnas utanför ("Leave out")
  const toggleLeave = (i: number) => setExcluded((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  // Jämförelsen med loggboken (dubbletter + krockar) och krockarna där den nya behålls (loggbokens tas bort vid Save).
  const [match, setMatch] = useState<LogbookMatch>(EMPTY_MATCH);
  const [keepNew, setKeepNew] = useState<Set<number>>(new Set());
  const clashChoice = (i: number): ClashChoice => (excluded.has(i) ? 'logbook' : keepNew.has(i) ? 'new' : 'both');
  const chooseClash = (i: number, c: ClashChoice) => {
    setExcluded((p) => { const n = new Set(p); if (c === 'logbook') n.add(i); else n.delete(i); return n; });
    setKeepNew((p) => { const n = new Set(p); if (c === 'new') n.add(i); else n.delete(i); return n; });
  };
  const nav = useCheckNav();
  const [airportMeta, setAirportMeta] = useState<Record<string, { name: string; country: string; known: boolean }>>({});
  // Marschfart + uthållighet för fartygstyper utan registrerade värden
  const [speedInputs, setSpeedInputs] = useState<Record<string, string>>({});
  const [enduranceInputs, setEnduranceInputs] = useState<Record<string, string>>({});
  const [typesNeedingData, setTypesNeedingData] = useState<{ type: string; hasSpeed: boolean; hasEndurance: boolean }[]>([]);
  // flight_type per flygningsindex för flygningar som överstiger uthållighet: 'sim' | 'hot_refuel'
  const [flightTypes, setFlightTypes] = useState<Record<number, 'sim' | 'hot_refuel'>>({});
  // sim-kategori per index när flight_type='sim': FFS | FTD | FNPT_II | FNPT_I | BITD
  const [simCategories, setSimCategories] = useState<Record<number, 'FFS' | 'FTD' | 'FNPT_II' | 'FNPT_I' | 'BITD' | 'CPT_PPT' | 'CBT'>>({});
  // Besättningstyp per fartygstyp
  const [crewTypeInputs, setCrewTypeInputs] = useState<Record<string, Set<string>>>({});
  // Farkosttyp per typ: 'airplane' | 'helicopter' | ''
  const [categoryInputs, setCategoryInputs] = useState<Record<string, 'airplane' | 'helicopter' | ''>>({});
  // Koordinater för kända flygplatser i importen + kända typ-data från DB
  const [airportCoords, setAirportCoords] = useState<Record<string, { lat: number; lon: number }>>({});
  const [dbTypeData, setDbTypeData] = useState<Record<string, { speedKts: number; endH: number }>>({});
  // Förklaring per flygningsindex för misstänkta flygningar
  const [flightExplanations, setFlightExplanations] = useState<Record<number, 'temporary' | 'refuel'>>({});

  // Okända ICAO-koder som hittades i importfilen
  type UnknownAirport = {
    icao: string;
    decision: 'pending' | 'temporary' | 'custom';
    name: string;
    lat: string;
    lon: string;
    expanded: boolean;
  };
  const [unknownAirports, setUnknownAirports] = useState<UnknownAirport[]>([]);

  const toggleCrewForType = (aircraftType: string, key: 'sp' | 'mp') => {
    setCrewTypeInputs(prev => {
      const current = new Set(prev[aircraftType] ?? []);
      if (current.has(key)) current.delete(key); else current.add(key);
      return { ...prev, [aircraftType]: current };
    });
  };

  // Motortyp per fartygstyp: 'se' | 'me' | ''
  const [engineInputs, setEngineInputs] = useState<Record<string, 'se' | 'me' | ''>>({});
  const [aiFilledByType, setAiFilledByType] = useState<Record<string, Set<string>>>({});
  const [aiLoadingTypes, setAiLoadingTypes] = useState<Set<string>>(new Set());
  const [aiFailedTypes, setAiFailedTypes] = useState<Set<string>>(new Set());
  const lookedUpTypesRef = useRef<Set<string>>(new Set());

  // Auto-lookup via AI så fort en ny fartygstyp visas — fyller tomma fält
  useEffect(() => {
    typesNeedingData.forEach(({ type, hasSpeed, hasEndurance }) => {
      if (!type || lookedUpTypesRef.current.has(type)) return;
      lookedUpTypesRef.current.add(type);
      setAiLoadingTypes((prev) => new Set(prev).add(type));

      // Timeout på 10 sekunder för AI-lookup
      const timeoutId = setTimeout(() => {
        console.warn(`Aircraft lookup timeout for ${type}`);
        setAiLoadingTypes((prev) => {
          const n = new Set(prev); n.delete(type); return n;
        });
        setAiFailedTypes((prev) => new Set(prev).add(type));
      }, 10000);

      lookupAircraft(type)
        .then((r) => {
          clearTimeout(timeoutId);
          if (r.needs_manual || !r.aircraft_type) {
            setAiFailedTypes((prev) => new Set(prev).add(type));
            return;
          }
          const filled = new Set<string>();
          if (!hasSpeed && r.cruise_speed_kts > 0) {
            setSpeedInputs((prev) => (prev[type] ? prev : { ...prev, [type]: String(r.cruise_speed_kts) }));
            filled.add('speed');
          }
          if (!hasEndurance && r.endurance_h > 0) {
            setEnduranceInputs((prev) => (prev[type] ? prev : { ...prev, [type]: String(r.endurance_h) }));
            filled.add('endurance');
          }
          if (r.crew_type) {
            const keys = r.crew_type.split(',').filter((k) => k === 'sp' || k === 'mp');
            if (keys.length) {
              setCrewTypeInputs((prev) => (prev[type]?.size ? prev : { ...prev, [type]: new Set(keys) }));
              filled.add('crew');
            }
          }
          if (r.engine_type) {
            setEngineInputs((prev) => (prev[type] ? prev : { ...prev, [type]: r.engine_type }));
            filled.add('engine');
          }
          if (r.category) {
            setCategoryInputs((prev) => (prev[type] ? prev : { ...prev, [type]: r.category }));
            filled.add('category');
          }
          if (filled.size > 0) {
            setAiFilledByType((prev) => ({ ...prev, [type]: filled }));
          }
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          console.warn(`Aircraft lookup failed for ${type}:`, err);
          setAiFailedTypes((prev) => new Set(prev).add(type));
        })
        .finally(() => {
          setAiLoadingTypes((prev) => {
            const n = new Set(prev); n.delete(type); return n;
          });
        });
    });
  }, [typesNeedingData]);

  const clearAiFlag = (type: string, field: string) => {
    setAiFilledByType((prev) => {
      const curr = prev[type];
      if (!curr || !curr.has(field)) return prev;
      const next = new Set(curr); next.delete(field);
      return { ...prev, [type]: next };
    });
  };

  // Flygningar som överstiger angiven uthållighet — reaktivt på enduranceInputs
  const exceedingFlights = useMemo(() => {
    if (!result) return [];
    return result.flights
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => {
        if ((f as any).flight_type === 'sim') return false; // explicit sim från filen → ingen endurance-fråga
        const raw = enduranceInputs[f.aircraft_type] ?? '';
        if (raw.endsWith('.')) return false; // fortfarande inmatning, vänta
        const endH = parseFloat(raw) || 0;
        return endH > 0 && parseFloat(f.total_time) > endH;
      });
  }, [result, enduranceInputs]);

  // Flygningar vars avstånd överstiger 1.5× räckvidd (endurance × marschfart)
  const suspiciousFlights = useMemo(() => {
    if (!result || Object.keys(airportCoords).length === 0) return [];
    return result.flights
      .map((f, idx) => {
        const dep = airportCoords[f.dep_place ?? ''];
        const arr = airportCoords[f.arr_place ?? ''];
        if (!dep || !arr || f.dep_place === f.arr_place) return null;

        // Hämta fart + endurance: user-input prioriteras, annars DB-känd
        // Om fältet slutar på '.' håller användaren fortfarande på att skriva — använd 0
        const rawSpeed = speedInputs[f.aircraft_type] ?? '';
        const rawEnd = enduranceInputs[f.aircraft_type] ?? '';
        const speedKts =
          (!rawSpeed.endsWith('.') && parseInt(rawSpeed)) ||
          dbTypeData[f.aircraft_type]?.speedKts || 0;
        const endH =
          (!rawEnd.endsWith('.') && parseFloat(rawEnd)) ||
          dbTypeData[f.aircraft_type]?.endH || 0;
        if (!speedKts || !endH) return null;

        const distKm = calculateDistance(dep.lat, dep.lon, arr.lat, arr.lon);
        const distNm = distKm / 1.852;
        const rangeNm = speedKts * endH;
        if (distNm > rangeNm * 1.5) return { idx, f, distNm: Math.round(distNm), rangeNm: Math.round(rangeNm) };
        return null;
      })
      .filter((x): x is { idx: number; f: OcrFlightResult; distNm: number; rangeNm: number } => x !== null);
  }, [result, airportCoords, speedInputs, enduranceInputs, dbTypeData]);

  const handlePick = async () => {
    // Token-styrt, inte premium-låst: fri nivå får importera tills engångspotten tar slut.
    if (!hasTokenQuota()) {
      if (isPremium || isMax) { showMonthlyTokenLimitAlert(); } else { presentPaywall('CSV / Excel import'); }
      return;
    }
    // Kolumnmappningen är ett AI-anrop → samtycke innan filväljaren öppnas.
    if (!(await askAiConsent())) return;
    const file = await pickImportFile();
    if (!file) return;

    setFileName(file.name);
    setImporting(true);
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    startedAt.current = Date.now();
    overlayFade.setValue(1);
    setOverlay('busy');
    setResult(null);
    setNightBasis(null); setNightEst(null); setNightApplied(false); setManualNight({}); setSkippedExpanded(false);
    setProgress({ current: 0, total: 0 });
    setUnknownAirports([]);
    setAirportCoords({});
    setDbTypeData({});
    setFlightExplanations({});
    setAiSummary(null);
    setSummaryLoading(false);
    setImportError(null);
    setOpenType(null);
    setExcluded(new Set());
    setMatch(EMPTY_MATCH); setKeepNew(new Set());
    nav.reset();
    setAirportMeta({});

    let ok = false;
    try {
      const res = await importFromFile(file.uri, (current, total) => setProgress({ current, total }));
      setResult(res);
      setTotalTimeCol(res.totalTimeColumn || ''); // vilken tidskolumn som används som total_time

      // AI-sammanfattning (fritext) — asynkront, blockerar inte förhandsvisningen
      setSummaryLoading(true);
      // (startas efter flygplatskollen nedan: grupperna att se över behöver de okända platserna)

      // Förifyll sim-klassning från EXPLICIT sim/FSTD-fält i filen (flight_type='sim' satt i mapRow).
      // Då slipper användaren endurance-pickern för dessa — de är redan kända simulatorpass.
      const preSim: Record<number, 'sim' | 'hot_refuel'> = {};
      res.flights.forEach((f, i) => { if ((f as any).flight_type === 'sim') preSim[i] = 'sim'; });
      if (Object.keys(preSim).length > 0) setFlightTypes((p) => ({ ...preSim, ...p }));

      // Kolla vilka fartygstyper i importen som saknar marschfart eller uthållighet
      const types = [...new Set(res.flights.map((f) => f.aircraft_type).filter(Boolean))];
      const needingData: { type: string; hasSpeed: boolean; hasEndurance: boolean }[] = [];
      for (const t of types) {
        const speed = await getAircraftCruiseSpeed(t);
        // Hämta uthållighet via samma registry
        const db = await import('../../db/database').then(m => m.getDatabase());
        const row = await db.getFirstAsync<{ endurance_h: number }>(
          `SELECT MAX(endurance_h) as endurance_h FROM aircraft_registry WHERE aircraft_type=?`, [t]
        );
        const endH = row?.endurance_h ?? 0;
        if (!speed || !endH) {
          needingData.push({ type: t, hasSpeed: speed > 0, hasEndurance: endH > 0 });
        }
      }
      setTypesNeedingData(needingData);
      setSpeedInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));
      setEnduranceInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));
      setCategoryInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));
      setEngineInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));

      // Kontrollera okända ICAO-koder mot databasen
      const places = [...new Set(
        res.flights.flatMap(f => [f.dep_place, f.arr_place]).filter((p): p is string => !!p && p.trim().length > 0)
      )];
      const unknowns: UnknownAirport[] = [];
      for (const place of places) {
        const found = await getAirportByIcao(place);
        if (!found) {
          unknowns.push({ icao: place, decision: 'pending', name: '', lat: '', lon: '', expanded: false });
        }
      }
      setUnknownAirports(unknowns);

      // Mot loggboken: flygningar som redan finns lämnas utanför från början, krockar i tid visas för val.
      const m = await matchFlightsToLogbook(res.flights, { withinFile: true }).catch(() => EMPTY_MATCH);
      setMatch(m);
      setExcluded(new Set(m.dups.keys()));

      // AI-sammanfattning (fritext) — asynkront, blockerar inte förhandsvisningen
      const sumDates = res.flights.map((f) => f.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
      const fresh = res.flights.filter((_, i) => !m.dups.has(i));   // timmarna utan dem som redan finns
      generateImportSummary({
        fileName: file.name,
        detectedFormat: res.detectedFormat,
        totalRows: res.totalRows,
        parsedFlights: res.flights.length,
        totalHours: Math.round(fresh.reduce((s, f) => s + ((f as any).flight_type === 'sim' ? 0 : parseFloat(f.total_time) || 0), 0) * 10) / 10,
        simHours: Math.round(fresh.reduce((s, f) => s + ((f as any).flight_type === 'sim' ? parseFloat(f.total_time) || 0 : 0), 0) * 10) / 10,
        dateRange: sumDates.length ? `${sumDates[0]} – ${sumDates[sumDates.length - 1]}` : undefined,
        aircraft: [...new Set(res.flights.map((f) => f.aircraft_type).filter(Boolean))],
        airports: [...new Set(res.flights.flatMap((f) => [f.dep_place, f.arr_place]).filter(Boolean))].slice(0, 40) as string[],
        pilots: [...new Set(res.flights.map((f) => f.second_pilot).filter(Boolean))] as string[],
        timeCandidates: res.timeCandidates,
        totalTimeColumn: res.totalTimeColumn,
        warnings: res.warnings,
        reviewGroups: reviewForAi(buildPilotReview(res.flights, new Set(unknowns.map((u) => u.icao)), res.warnings, fmtH, m).groups),
        nightMissing: res.flights.length > 0 && res.flights.every((f) => !(parseFloat(String((f as any).night ?? '0')) > 0)),
      })
        .then((s) => setAiSummary(s))
        .catch(() => setAiSummary(''))
        .finally(() => setSummaryLoading(false));

      // Hämta koordinater för alla kända platser (för avståndsberäkning)
      const coords = await getAirportCoordinates(places);
      const coordMap: Record<string, { lat: number; lon: number }> = {};
      for (const c of coords) coordMap[c.icao] = { lat: c.lat, lon: c.lon };
      setAirportCoords(coordMap);

      // Hämta kända fart/endurance från DB för typer som INTE är i needingData
      const db2 = await import('../../db/database').then(m => m.getDatabase());
      const knownTypes = types.filter(t => !needingData.find(n => n.type === t));
      const dbData: Record<string, { speedKts: number; endH: number }> = {};
      for (const t of knownTypes) {
        const row = await db2.getFirstAsync<{ cruise_speed_kts: number; endurance_h: number }>(
          `SELECT MAX(cruise_speed_kts) as cruise_speed_kts, MAX(endurance_h) as endurance_h FROM aircraft_registry WHERE aircraft_type=?`, [t]
        );
        if (row) dbData[t] = { speedKts: row.cruise_speed_kts ?? 0, endH: row.endurance_h ?? 0 };
      }
      setDbTypeData(dbData);
      ok = true;
    } catch (e: any) {
      if (isAiConsentError(e)) { setResult(null); setFileName(''); return; } // "Not now" → tillbaka till filvalet
      if (isTokenQuotaError(e)) {
        // Race: tokens tog slut mellan gate-kollen och själva anropet — samma gate som ovan.
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else presentPaywall('CSV / Excel import');
        return;
      }
      // Trasig fil → inline-felkort med AI-förklaring i stället för en Alert
      setImportError(e.message);
      setSummaryLoading(true);
      generateImportSummary({ fileName: file.name, error: e.message })
        .then((s) => setAiSummary(s))
        .catch(() => setAiSummary(''))
        .finally(() => setSummaryLoading(false));
    } finally {
      setImporting(false);
      // Lyckad import → bock och övertoning; fel eller avbrott → felkortet/filvalet syns direkt.
      if (ok) finishOverlay(); else setOverlay('hidden');
    }
  };

  const savingRef = useRef(false);
  const saveAll = async () => {
    // Synkron spärr: hindrar att snabba dubbeltryck startar två sparningar
    // (state-baserad `disabled` hinner inte ritas om i tid → dubbla inserts).
    if (!result || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let saved = 0;
    try {
      // Spara marschfart och uthållighet för fartygstyper som saknade värden
      for (const { type } of typesNeedingData) {
        const speedKts = parseInt(speedInputs[type] ?? '0') || 0;
        const endH = parseFloat(enduranceInputs[type] ?? '0') || 0;
        const crewSet = crewTypeInputs[type] ?? new Set<string>();
        const crewType = crewSet.size === 0 ? '' : [...crewSet].sort().join(',');
        const category = categoryInputs[type] ?? '';
        const engineType = engineInputs[type] ?? '';
        await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType);
        if (speedKts > 0) await updateAircraftCruiseSpeed(type, speedKts);
        if (endH > 0) await updateAircraftEndurance(type, endH);
      }
      // Unknown airports are left unresolved and will appear in dashboard "visited airports"
      // ZZZZ codes are skipped as they are generic placeholders for off-airport places
      // Flygningar längre än uthållighet default:ar till 'sim' (= det UI:t visar förvalt) om användaren
      // inte uttryckligen valt hot refuel — annars tappades sim-tiden (sparades som 'normal' → försvann
      // ur sim-statistiken). Övriga flygningar default:ar till 'normal'.
      const exceedingIdx = new Set(exceedingFlights.map((e) => e.idx));
      // Krockar där den nya behålls: loggbokens flygning tas bort först.
      const removed = idsToRemove(match, keepNew, (i) => excluded.has(i));
      if (removed.length) await deleteFlights(removed);
      for (let i = 0; i < result.flights.length; i++) {
        if (excluded.has(i)) continue; // "Leave out" i rapporten
        const f = result.flights[i];
        const ft = flightTypes[i] ?? (exceedingIdx.has(i) ? 'sim' : 'normal');
        const simCat = ft === 'sim' ? (simCategories[i] ?? 'FFS') : '';
        const explanation = flightExplanations[i];
        const remarksNote =
          explanation === 'temporary' ? '[Off-airport (ZZZZ)]' :
          explanation === 'refuel'    ? '[En-route refuel]' : '';
        const remarks = [f.remarks, remarksNote].filter(Boolean).join(' ');
        await insertFlight({ ...f, remarks, flight_type: ft, sim_category: simCat as any }, { source: 'import' });
        saved++;
      }
      await Promise.all([loadFlights(), loadStats()]);
      // Hämta resterande Fleet-data (spec + bilder) i BAKGRUNDEN för de importerade typerna → korten
      // är kompletta när användaren öppnar Fleet-sidan. Token-gated (blockerar inte importen). När klart
      // → tappbar toast som tar en till Fleet. Global router (skärmen kan ha stängts när det blir klart).
      console.log(`[import] saveAll done: ${saved} saved, ${removed.length} removed → starting fleet enrichment`);
      enrichFleetInBackground().then((res) => {
        console.log(`[import] fleet enrichment finished → enriched=${res.enriched}/${res.total} stoppedForQuota=${res.stoppedForQuota}`);
        // Centrerad global modal (import-skärmen kan ha stängts) → knapp till Logbook-flikens Fleet-vy.
        // Visa om något berikades ELLER om vi pausade pga slut på Blade-coins (då med uppgraderings-CTA).
        if (res.enriched > 0 || res.stoppedForQuota) useFleetDoneStore.getState().show(res);
      }).catch((e) => console.log('[import] fleet enrichment rejected:', e?.message ?? e));
      // Flygningar som redan fanns (dubbletter som lämnades utanför) och borttagna krockar läggs till i bekräftelsen.
      const dupLeft = [...match.dups.keys()].filter((i) => excluded.has(i)).length;
      const dupNote = [
        dupLeft > 0 ? `${dupLeft} already in your logbook (left out).` : '',
        removed.length > 0 ? `${removed.length} overlapping ${removed.length === 1 ? 'flight' : 'flights'} removed from your logbook.` : '',
      ].filter(Boolean).map((x) => `\n\n${x}`).join('');
      // Importen klar → vanlig bekräftelse (Wrapped-funktionen borttagen).
      Alert.alert(t('done_exclamation'), `${saved} ${t('flights_imported')}${dupNote}`, [
        { text: 'OK', onPress: finishNav },
      ]);
    } catch (e: any) {
      Alert.alert(t('save_error'), e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Sammanställning för "vad filen innehåller"-kortet (samma presentation som Imported data)
  // Simulatorpassen i importen, med samma regel som saveAll: användarens val, annars sim om filen sa sim eller
  // flygningen är längre än uthålligheten (förvalt sim). Deras tid är simulatortid, inte flygtid.
  const simIdx = useMemo(() => {
    const out = new Set<number>();
    if (!result) return out;
    const exceed = new Set(exceedingFlights.map((e) => e.idx));
    result.flights.forEach((f, i) => {
      if (excluded.has(i)) return;
      const ft = flightTypes[i] ?? ((f as any).flight_type === 'sim' || exceed.has(i) ? 'sim' : 'normal');
      if (ft === 'sim') out.add(i);
    });
    return out;
  }, [result, flightTypes, exceedingFlights, excluded]);

  const insideData = useMemo(() => {
    if (!result) return null;
    const CATS: { key: string; label: string }[] = [
      { key: 'total_time', label: 'Total' },
      { key: 'sim', label: 'Sim' },
      { key: 'pic', label: 'PIC' },
      { key: 'co_pilot', label: 'Co-pilot' },
      { key: 'dual', label: 'Dual' },
      { key: 'instructor', label: 'Instructor' },
      { key: 'ifr', label: 'IFR' },
      { key: 'night', label: 'Night' },
    ];
    // Flygtid och rolltider bara för riktiga flygningar; simulatorpassens tid för sig (som skanningsrapporten).
    const cats: Record<string, number> = {};
    result.flights.forEach((f, i) => {
      if (excluded.has(i)) return;
      if (simIdx.has(i)) { cats.sim = (cats.sim || 0) + (parseFloat(f.total_time) || 0); return; }
      for (const c of CATS) if (c.key !== 'sim') cats[c.key] = (cats[c.key] || 0) + (parseFloat((f as any)[c.key]) || 0);
    });
    const icaos = [...new Set(result.flights.flatMap((f) => [f.dep_place, f.arr_place]).filter(Boolean))] as string[];
    const aircraft = [...new Set(result.flights.map((f) => (f.aircraft_type || '').trim()).filter(Boolean))];
    const pilots = [...new Set(result.flights.map((f) => (f.second_pilot || '').trim()).filter(Boolean))];
    const dates = result.flights.map((f) => f.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
    return { CATS, cats, icaos, aircraft, pilots, period: periodOf(dates), simCount: simIdx.size };
  }, [result, simIdx, excluded]);

  const review = useMemo(() => (result
    ? buildPilotReview(result.flights, new Set(unknownAirports.map((u) => u.icao)), result.warnings, fmtH, match)
    : { groups: [] as ReviewGroup[], used: new Set<string>() }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [result, unknownAirports, timeFormat, match]);
  const included = result ? result.flights.length - excluded.size : 0;
  const removeCount = useMemo(() => idsToRemove(match, keepNew, (i) => excluded.has(i)).length, [match, keepNew, excluded]);

  // Flygplatslistan öppnas → slå upp namn + land för koder som saknas (samma som Imported data)
  const resolveAirportMeta = () => {
    if (!insideData) return;
    const missing = insideData.icaos.filter((ic) => !airportMeta[ic]);
    if (!missing.length) return;
    Promise.all(missing.map((ic) => getAirportByIcao(ic))).then((rows) => {
      setAirportMeta((m) => {
        const merged = { ...m };
        missing.forEach((ic, i) => {
          const r = rows[i];
          merged[ic] = { name: r?.name || ic, country: r?.country || '', known: !!r && !r.temporary };
        });
        return merged;
      });
    }).catch(() => {});
  };

  // Byt vilken varaktighetskolumn (Block/Air/Flight) som blir loggbokens total_time — sker lokalt
  // (ingen om-läsning): varje flights total_time byts mot dess timeOptions[col].
  const applyTimeColumn = (col: string) => {
    if (!result) return;
    setTotalTimeCol(col);
    setResult({
      ...result,
      totalTimeColumn: col,
      flights: result.flights.map((f) => {
        const h = f.timeOptions?.[col];
        return h != null && h !== '' ? { ...f, total_time: h } : f;
      }),
    });
  };

  // Nattid saknas i filen (ingen flygning har night > 0) OCH går att beräkna (dep+arr-koord + tid)?
  const nightMissing = !!result && result.flights.every((f) => !(parseFloat(String((f as any).night ?? '0')) > 0));
  const nightComputable = result ? countComputable(result.flights, airportCoords) : 0;
  const showNightCard = !!result && nightMissing && nightComputable > 0;

  const chooseNightBasis = (basis: NightBasis) => {
    if (!result) return;
    setNightBasis(basis);
    setManualNight({}); // ny bas → nya skippade → nollställ manuella
    setNightEst(estimateNightForImport(result.flights, airportCoords, basis));
  };
  // Skippade flygningar (ej auto-beräkningsbara) MED flygtid → kan sättas manuellt via night-bar.
  const skippedFlights = result && nightEst
    ? result.flights.map((f, i) => ({ f, i })).filter(({ f, i }) => nightEst.perFlight[i] == null && (parseFloat(String(f.total_time ?? '')) || 0) > 0)
    : [];
  const manualNightTotal = Object.values(manualNight).reduce((s, v) => s + (v || 0), 0);
  const totalNightIncl = Math.round(((nightEst?.totalNight ?? 0) + manualNightTotal) * 10) / 10;
  const applyNight = () => {
    if (!result || !nightEst) return;
    setResult({
      ...result,
      flights: result.flights.map((f, i) => {
        const auto = nightEst.perFlight[i];
        const nv = auto != null ? auto : (manualNight[i] ?? 0); // auto för beräknade, manuellt för skippade
        return nv > 0 ? { ...f, night: String(Math.round(nv * 100) / 100) } : f;
      }),
    });
    setNightApplied(true);
  };

  const stage = progress.current;
  const flightsFound = result?.flights.length ?? 0;
  const progressLayer = overlay !== 'hidden' ? (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}>
      <BladeProgress
        status={overlay === 'done' ? 'done' : 'busy'}
        safeTop={false}
        eyebrow={overlay === 'done' ? 'IMPORT READY' : 'IMPORTING'}
        title={overlay === 'done' ? (flightsFound === 1 ? '1 flight found' : `${flightsFound} flights found`) : 'Importing your logbook'}
        body={overlay === 'done' ? 'Opening the preview…'
          : stage === 0 ? `Opening ${fileName || 'the file'}.`
            : stage === 1 ? ANALYZE_STEPS[stepIdx % ANALYZE_STEPS.length]
              : stage === 2 ? 'Reading every flight in the file.'
                : 'Checking aircraft and airports against your logbook.'}
        steps={[
          { label: 'Read the file', state: overlay === 'done' || stage > 0 ? 'done' : 'active' },
          { label: 'Match the columns', state: overlay === 'done' || stage > 1 ? 'done' : stage === 1 ? 'active' : 'todo' },
          { label: 'Read every flight', state: overlay === 'done' || stage > 2 ? 'done' : stage === 2 ? 'active' : 'todo' },
          { label: 'Check aircraft and airports', state: overlay === 'done' ? 'done' : stage === 3 ? 'active' : 'todo' },
        ]}
        progress={stage === 0 ? 0.08 : stage === 1 ? 0.7 : stage === 2 ? 0.85 : 0.95}
        progressMs={stage === 0 ? 1200 : stage === 1 ? 20000 : stage === 2 ? 2500 : 3000}
        startedAt={startedAt.current}
        footnote="Nothing is saved until you approve it."
      />
    </Animated.View>
  ) : null;

  // ── "Before you save": det man kan rätta, en rad per sak (fälls ut). Varje sak har en status som syns direkt.
  const aircraftRows = typesNeedingData.map(({ type, hasSpeed, hasEndurance }) => {
    const sp = speedInputs[type] ?? '', en = enduranceInputs[type] ?? '';
    const crew = [...(crewTypeInputs[type] ?? new Set<string>())].sort().map((k) => k.toUpperCase());
    const eng = engineInputs[type] ?? '', cat = categoryInputs[type] ?? '';
    const missing = [!hasSpeed && !sp && 'speed', !hasEndurance && !en && 'endurance', !cat && 'airplane or helicopter'].filter(Boolean) as string[];
    const parts = [
      hasSpeed ? 'speed saved' : sp ? `${sp} kts` : '', hasEndurance ? 'endurance saved' : en ? `${en} h` : '',
      ...crew, eng.toUpperCase(), cat === 'airplane' ? t('airplane') : cat === 'helicopter' ? t('helicopter') : '',
    ].filter(Boolean);
    return { type, hasSpeed, hasEndurance, missing, parts, loading: aiLoadingTypes.has(type) };
  });
  const aircraftEditor = (type: string, hasSpeed: boolean, hasEndurance: boolean) => {
    const crewSet = crewTypeInputs[type] ?? new Set<string>();
    const ai = aiFilledByType[type] ?? new Set<string>();
    const aiStyle = { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' } as const;
    const aiBtn = { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' } as const;
    return (
      <>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.fieldLabel}>CRUISE SPEED (KTS)</Text>
            <RNTextInput
              style={[styles.speedInput, styles.fieldInput, hasSpeed && styles.speedInputDone, ai.has('speed') && aiStyle]}
              placeholder={hasSpeed ? '✓ saved' : '110'} placeholderTextColor={hasSpeed ? Colors.success : Colors.textMuted}
              keyboardType="number-pad" value={speedInputs[type] ?? ''} maxLength={4} editable={!hasSpeed}
              onChangeText={(v) => { setSpeedInputs((prev) => ({ ...prev, [type]: v })); clearAiFlag(type, 'speed'); }}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.fieldLabel}>ENDURANCE (H)</Text>
            <RNTextInput
              style={[styles.speedInput, styles.fieldInput, hasEndurance && styles.speedInputDone, ai.has('endurance') && aiStyle]}
              placeholder={hasEndurance ? '✓ saved' : '3.0'} placeholderTextColor={hasEndurance ? Colors.success : Colors.textMuted}
              keyboardType="decimal-pad" value={enduranceInputs[type] ?? ''} maxLength={4} editable={!hasEndurance}
              onChangeText={(v) => { setEnduranceInputs((prev) => ({ ...prev, [type]: v })); clearAiFlag(type, 'endurance'); }}
            />
          </View>
        </View>
        <View style={styles.crewRow}>
          {(['sp', 'mp'] as const).map((key) => {
            const active = crewSet.has(key);
            return (
              <TouchableOpacity key={key} style={[styles.crewBtn, active && styles.crewBtnActive, ai.has('crew') && active && aiBtn]}
                onPress={() => { toggleCrewForType(type, key); clearAiFlag(type, 'crew'); }} activeOpacity={0.7}>
                <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{key === 'sp' ? 'SP' : 'MP'}</Text>
                <Text style={styles.crewBtnSub}>{key === 'sp' ? 'Single pilot' : 'Multi-pilot'}</Text>
              </TouchableOpacity>
            );
          })}
          {(['se', 'me'] as const).map((key) => {
            const active = engineInputs[type] === key;
            return (
              <TouchableOpacity key={key} style={[styles.crewBtn, active && styles.crewBtnActive, ai.has('engine') && active && aiBtn]}
                onPress={() => { setEngineInputs((prev) => ({ ...prev, [type]: active ? '' : key })); clearAiFlag(type, 'engine'); }} activeOpacity={0.7}>
                <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{key === 'se' ? 'SE' : 'ME'}</Text>
                <Text style={styles.crewBtnSub}>{key === 'se' ? 'Single engine' : 'Multi engine'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.crewRow}>
          {(['airplane', 'helicopter'] as const).map((cat) => {
            const active = categoryInputs[type] === cat;
            return (
              <TouchableOpacity key={cat} style={[styles.crewBtn, { flex: 1 }, active && styles.crewBtnActive, ai.has('category') && active && aiBtn]}
                onPress={() => { setCategoryInputs((prev) => ({ ...prev, [type]: active ? '' : cat })); clearAiFlag(type, 'category'); }} activeOpacity={0.7}>
                <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{cat === 'airplane' ? t('airplane') : t('helicopter')}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </>
    );
  };

  const checks: { key: string; status: CheckStatus; render: (first: boolean) => ReactNode }[] = [];
  if (result && showNightCard) {
    const flightsWithNight = (nightEst?.nightFlights ?? 0) + Object.values(manualNight).filter((v) => v > 0).length;
    checks.push({
      key: 'night', status: nightApplied ? 'done' : 'todo',
      render: (first) => (
        <CheckItem T={T} first={first} icon="moon-outline" title="Add night time" defaultOpen={!nightApplied}
          status={nightApplied ? 'done' : 'todo'} statusText={nightApplied ? 'ADDED' : 'SUGGESTED'}
          summary={nightApplied
            ? `${totalNightIncl} h night added across ${flightsWithNight} ${flightsWithNight === 1 ? 'flight' : 'flights'}.`
            : `Your file has no night hours. We can work them out from your routes and times for ${nightComputable} ${nightComputable === 1 ? 'flight' : 'flights'}.`}>
          {nightApplied ? null : (
            <>
              <Text style={styles.nightSub}>How are the times in your file written?</Text>
              <View style={styles.nightToggle}>
                {(['utc', 'local'] as const).map((b) => (
                  <TouchableOpacity key={b} onPress={() => chooseNightBasis(b)} activeOpacity={0.85}
                    style={[styles.nightBtn, nightBasis === b && styles.nightBtnOn]}>
                    <Text style={[styles.nightBtnTxt, nightBasis === b && styles.nightBtnTxtOn]}>{b === 'utc' ? 'UTC (Z)' : 'Local time'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {nightEst && (
                <>
                  <Text style={styles.nightResult}>
                    About {nightEst.totalNight} h night across {nightEst.nightFlights} flight{nightEst.nightFlights === 1 ? '' : 's'}
                    {nightEst.skipped > 0 ? `  ·  ${nightEst.skipped} without coordinates or times` : ''}
                  </Text>
                  {/* Flygningar som inte gick att räkna → nattid med en night-bar (som i Log Flight). */}
                  {skippedFlights.length > 0 && (
                    <>
                      <TouchableOpacity onPress={() => setSkippedExpanded((v) => !v)} activeOpacity={0.7} style={styles.nightExpandRow}>
                        <Ionicons name={skippedExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.primary} />
                        <Text style={styles.nightExpandTxt}>Set night yourself for {skippedFlights.length} flight{skippedFlights.length === 1 ? '' : 's'}</Text>
                      </TouchableOpacity>
                      {skippedExpanded && (
                        <View style={{ gap: 12, marginTop: 2 }}>
                          {skippedFlights.map(({ f, i }) => {
                            const tot = parseFloat(String(f.total_time ?? '')) || 0;
                            const hrs = manualNight[i] ?? 0;
                            return (
                              <View key={i} style={styles.skipItem}>
                                <Text style={styles.skipMeta} numberOfLines={2}>{f.date}  ·  {f.dep_place || '?'} {f.dep_utc || '—'} → {f.arr_place || '?'} {f.arr_utc || '—'}  ·  {tot}h</Text>
                                <CondBar
                                  label={t('night')}
                                  pct={tot > 0 ? (hrs / tot) * 100 : 0}
                                  onPct={(pc) => setManualNight((prev) => ({ ...prev, [i]: Math.round((pc / 100) * tot * 100) / 100 }))}
                                  tint={Colors.info}
                                  totalMin={tot * 60}
                                  onGrab={() => setScrollOn(false)}
                                  onRelease={() => setScrollOn(true)}
                                />
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </>
                  )}
                  <TouchableOpacity onPress={applyNight} activeOpacity={0.85} style={styles.nightApply}>
                    <Ionicons name="checkmark" size={15} color={Colors.textInverse} />
                    <Text style={styles.nightApplyTxt}>Add {totalNightIncl} h night</Text>
                  </TouchableOpacity>
                  <Text style={styles.nightNote}>
                    Worked out from the sun's position along each route.{nightBasis === 'local' ? ' Local times are converted via longitude, so treat it as approximate near dawn and dusk.' : ''}
                  </Text>
                </>
              )}
            </>
          )}
        </CheckItem>
      ),
    });
  }
  for (const g of review.groups) {
    const key = `review-${g.id}`, n = g.flights.length, status: CheckStatus = g.todo ? 'todo' : 'info';
    checks.push({
      key, status,
      render: (first) => (
        <CheckItem T={T} first={first} icon={GROUP_ICON[g.id] ?? 'search-outline'}
          title={g.title} status={status} statusText={g.todo ? `${n} TO CHECK` : `${n} ${n === 1 ? 'FLIGHT' : 'FLIGHTS'}`}
          summary={g.about} open={!!nav.open[key]} onToggle={() => nav.toggle(key)} highlight={nav.flash === key}>
          {g.flights.slice(0, 40).map((f) => (g.id === 'clash'
            ? <ClashRow key={f.idx} T={T} f={f} others={clashOthers(match, f.idx, fmtH)} choice={clashChoice(f.idx)} onChoose={(c) => chooseClash(f.idx, c)} />
            : <ReviewFlightRow key={f.idx} T={T} f={f} left={excluded.has(f.idx)} onToggleLeave={() => toggleLeave(f.idx)} />
          ))}
          {n > 40 && <Text style={{ color: T.text2, fontSize: 12.5, textAlign: 'center' }}>+ {n - 40} more {n - 40 === 1 ? 'flight' : 'flights'}</Text>}
        </CheckItem>
      ),
    });
  }
  if (aircraftRows.length > 0) {
    const looking = aircraftRows.some((r) => r.loading);
    const missing = aircraftRows.filter((r) => r.missing.length > 0).length;
    const status: CheckStatus = looking ? 'ai' : missing > 0 ? 'todo' : 'done';
    checks.push({
      key: 'aircraft', status,
      render: (first) => (
        <CheckItem T={T} first={first} icon="airplane-outline" title="Aircraft details" status={status}
          statusText={looking ? 'LOOKING UP' : missing > 0 ? `${missing} TO CHECK` : ''}
          summary={`${aircraftRows.length} new ${aircraftRows.length === 1 ? 'type' : 'types'}. Speed and endurance give distances on local flights and spot sim sessions. Change them later in Settings → Aircraft.`}>
          {aircraftRows.map((r) => (
            <EditRow key={r.type} T={T} title={r.type} loading={r.loading} open={openType === r.type}
              onPress={() => setOpenType((o) => (o === r.type ? null : r.type))}
              summary={r.missing.length ? `Missing ${r.missing.join(', ')}` : r.parts.join(' · ')}
              tag={r.missing.length ? 'MISSING' : undefined} tagColor={T.warning}>
              {aircraftEditor(r.type, r.hasSpeed, r.hasEndurance)}
            </EditRow>
          ))}
        </CheckItem>
      ),
    });
  }
  if (exceedingFlights.length > 0) {
    const n = exceedingFlights.length;
    checks.push({
      key: 'exceed', status: 'todo',
      render: (first) => (
        <CheckItem T={T} first={first} icon="hourglass-outline" title="Longer than endurance" status="todo" statusText={`${n} TO CHECK`}
          summary={`${n} ${n === 1 ? 'flight is' : 'flights are'} longer than the aircraft can stay airborne. Saved as simulator unless you pick hot refuel. Sim sessions stay out of statistics and the map.`}>
          {exceedingFlights.map(({ f, idx }) => {
            const current = flightTypes[idx] ?? 'sim';
            return (
              <View key={idx}>
                <View style={styles.exceedRow}>
                  <View style={styles.exceedInfo}>
                    <Text style={styles.exceedRoute}>{f.dep_place || '?'}→{f.arr_place || '?'}</Text>
                    <Text style={styles.exceedMeta}>{f.date} · {f.aircraft_type} · {f.total_time}h</Text>
                  </View>
                  <View style={styles.exceedToggle}>
                    <TouchableOpacity style={[styles.exceedBtn, current === 'sim' && styles.exceedBtnSim]}
                      onPress={() => setFlightTypes((pv) => ({ ...pv, [idx]: 'sim' }))}>
                      <Text style={[styles.exceedBtnText, current === 'sim' && styles.exceedBtnTextActive]}>Sim</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.exceedBtn, current === 'hot_refuel' && styles.exceedBtnHot]}
                      onPress={() => setFlightTypes((pv) => ({ ...pv, [idx]: 'hot_refuel' }))}>
                      <Text style={[styles.exceedBtnText, current === 'hot_refuel' && styles.exceedBtnTextActive]}>Hot refuel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {current === 'sim' && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginLeft: 12 }}>
                    {(['FFS', 'FTD', 'FNPT_II', 'FNPT_I', 'BITD', 'CPT_PPT', 'CBT'] as const).map((cat) => {
                      const active = (simCategories[idx] ?? 'FFS') === cat;
                      return (
                        <TouchableOpacity key={cat} style={[styles.exceedBtn, active && styles.exceedBtnSim]}
                          onPress={() => setSimCategories((pv) => ({ ...pv, [idx]: cat }))}>
                          <Text style={[styles.exceedBtnText, active && styles.exceedBtnTextActive]}>{cat.replace(/_/g, '/')}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </CheckItem>
      ),
    });
  }
  if (suspiciousFlights.length > 0) {
    const n = suspiciousFlights.length;
    const answered = suspiciousFlights.filter(({ idx }) => !!flightExplanations[idx]).length;
    checks.push({
      key: 'range', status: answered === n ? 'done' : 'info',
      render: (first) => (
        <CheckItem T={T} first={first} icon="navigate-outline" title="Longer than range" status={answered === n ? 'done' : 'info'}
          statusText={answered === n ? 'DONE' : 'OPTIONAL'}
          summary={`${n} ${n === 1 ? 'leg is' : 'legs are'} farther than the aircraft can fly on one tank. Say why, or save ${n === 1 ? 'it' : 'them'} as ${n === 1 ? 'it is' : 'they are'}.`}>
          {suspiciousFlights.map(({ idx, f, distNm, rangeNm }) => {
            const current = flightExplanations[idx];
            return (
              <View key={idx} style={styles.suspiciousRow}>
                <View style={styles.suspiciousInfo}>
                  <Text style={styles.suspiciousRoute}>{f.dep_place || '?'}→{f.arr_place || '?'}</Text>
                  <Text style={styles.suspiciousMeta}>{f.date} · {f.aircraft_type} · {distNm} nm · range {rangeNm} nm</Text>
                </View>
                <View style={styles.suspiciousToggle}>
                  <TouchableOpacity style={[styles.suspiciousBtn, current === 'temporary' && styles.suspiciousBtnActive]}
                    onPress={() => setFlightExplanations((pv) => ({ ...pv, [idx]: pv[idx] === 'temporary' ? undefined as any : 'temporary' }))}>
                    <Text style={[styles.suspiciousBtnText, current === 'temporary' && styles.suspiciousBtnTextActive]}>Off-airport</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.suspiciousBtn, current === 'refuel' && styles.suspiciousBtnRefuel]}
                    onPress={() => setFlightExplanations((pv) => ({ ...pv, [idx]: pv[idx] === 'refuel' ? undefined as any : 'refuel' }))}>
                    <Text style={[styles.suspiciousBtnText, current === 'refuel' && styles.suspiciousBtnTextActive]}>En-route refuel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </CheckItem>
      ),
    });
  }
  const notes = result ? result.warnings.filter((w) => !review.used.has(w)) : [];
  if (notes.length > 0) {
    const ws = notes;
    checks.push({
      key: 'notes', status: 'info',
      render: (first) => (
        <CheckItem T={T} first={first} icon="document-text-outline" title="Notes on your file" status="info"
          statusText={String(ws.length)} summary={`${ws.length} ${ws.length === 1 ? 'note' : 'notes'} from reading your file.`}>
          {/* Alla noteringar som punkter (summeringen ovan upprepar ingen av dem). */}
          {ws.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name="information-circle-outline" size={14} color={T.text2} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, color: T.text2, fontSize: 12.5, lineHeight: 17 }}>{w}</Text>
            </View>
          ))}
        </CheckItem>
      ),
    });
  }

  return (
    <>
    <ScrollView
      ref={nav.scrollRef}
      style={styles.container}
      contentContainerStyle={[styles.content, result && { paddingBottom: FOOTER_SPACE + insets.bottom + 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      scrollEnabled={scrollOn}
    >
      {/* Rubrik och filval — bara innan en fil är läst (rapporten har en egen sammanfattning överst) */}
      {!result && (
        <View style={styles.hero}>
          <Text style={styles.title}>{t('import_logbook')}</Text>
          <Text style={styles.subtitle}>{t('import_logbook_sub')}</Text>
        </View>
      )}

      {/* Upload-dropzone (hela kortet är tryckytan) — döljs när en analys visas */}
      {!result && (
        <TouchableOpacity
          style={[styles.uploadCard, importing && { opacity: 0.85 }]}
          onPress={handlePick}
          disabled={importing}
          activeOpacity={0.9}
        >
          <View style={styles.uploadIconWrap}>
            {importing
              ? <ActivityIndicator color={Colors.primary} size="large" />
              : <Ionicons name="cloud-upload-outline" size={32} color={Colors.primary} />}
          </View>
          <Text style={styles.uploadTitle}>
            {importing
              ? (progress.current === 0 ? t('reading_file') :
                 progress.current === 1 ? ANALYZE_STEPS[stepIdx % ANALYZE_STEPS.length] :
                 progress.current === 2 ? t('parsing_rows') :
                 t('done_exclamation'))
              : t('choose_file')}
          </Text>
          {!importing && (
            <Text style={styles.uploadSub}>CSV, Excel or text export — from any logbook app</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Hur importen funkar + tillförlitlighet — visas före filval */}
      {!importing && !result && (
        <>
          <HowItWorks steps={HOW_IT_WORKS} />

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Accepted file formats</Text>
            {ACCEPTED_FORMATS.map((f) => (
              <View key={f.t} style={styles.bulletRow}>
                <Ionicons name={f.icon as any} size={15} color={Colors.primary} />
                <Text style={styles.bulletTerm}>{f.t}</Text>
                <Text style={[styles.bulletDesc, { flex: 1 }]}>{f.d}</Text>
              </View>
            ))}
          </View>

        </>
      )}

      {/* Importfel — AI:ns förklaring i samma kort som rapportens (i stället för Alert) */}
      {importError && !result && !importing && (
        <AnalysisCard T={T} failed loading={summaryLoading} text={aiSummary || importError || 'Import failed.'} fallback={importError || 'Import failed.'} />
      )}

      {/* Rapporten före Save (components/import/ImportReport, samma som drönarläget): sammanfattningen, AI:ns
          "What we found", det man kan rätta ("Before you save", en rad per sak) och vad filen innehåller. */}
      {result && insideData && (
        <>
          <ReportHero T={T} flights={included}
            time={`${formatTime(insideData.cats.total_time || 0)}${timeFormat === 'decimal' ? ' h' : ''}`}
            sim={(insideData.cats.sim || 0) > 0 ? `${formatTime(insideData.cats.sim)}${timeFormat === 'decimal' ? ' h' : ''}` : undefined}
            period={insideData.period} fileName={fileName} format={result.detectedFormat}
            coins={result.tokensUsed > 0 ? tokensToCoins(result.tokensUsed) : 0}
            totalRows={result.totalRows} mappedRows={result.mappedRows} toCheck={checks.filter((c) => c.status === 'todo').length} />

          <AnalysisCard T={T} loading={summaryLoading} text={aiSummary}
            fallback="The summary isn't available right now. Everything below is still ready to import."
            linkIds={new Set(review.groups.map((g) => g.id))} onLink={(id) => nav.go(`review-${id}`)} />

          {checks.length > 0 && (
            <>
              <SectionLabel T={T}>BEFORE YOU SAVE</SectionLabel>
              <View onLayout={nav.onGroupLayout}>
                <CheckGroup T={T}>{checks.map((c, i) => <View key={c.key} onLayout={nav.onItemLayout(c.key)}>{c.render(i === 0)}</View>)}</CheckGroup>
              </View>
            </>
          )}

          <SectionLabel T={T}>IN THIS FILE</SectionLabel>
          <View style={{ backgroundColor: T.card, borderRadius: 14, borderWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
            <TotalsGrid T={T} items={insideData.CATS
              .filter((c) => c.key === 'total_time' || (insideData.cats[c.key] || 0) > 0)
              .map((c) => ({ label: c.label, value: formatTime(insideData.cats[c.key] || 0) }))} />

            {/* Flygplatser med flaggor; namn och land slås upp när listan öppnas */}
            <ListRow T={T} icon="location-outline" label="Airports" count={insideData.icaos.length} onOpen={resolveAirportMeta}>
              {() => {
                const resolved = insideData.icaos.every((ic) => airportMeta[ic]);
                if (!resolved) return <View style={{ paddingVertical: 12 }}><ActivityIndicator color={Colors.primary} /></View>;
                const known = insideData.icaos.filter((ic) => airportMeta[ic].known);
                const unknown = insideData.icaos.filter((ic) => !airportMeta[ic].known);
                const row = (ic: string) => {
                  const meta = airportMeta[ic];
                  return (
                    <View key={ic} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {meta.known
                        ? <CountryFlag code={meta.country} height={14} />
                        : <View style={{ width: Math.round((14 * 4) / 3), height: 14, borderRadius: 2, backgroundColor: Colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="help" size={10} color={Colors.textMuted} />
                          </View>}
                      <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo', width: 52 }}>{ic}</Text>
                      <Text numberOfLines={1} style={{ flex: 1, color: Colors.textMuted, fontSize: 12 }}>{meta.name === ic ? '' : meta.name}</Text>
                    </View>
                  );
                };
                return (
                  <>
                    {known.map(row)}
                    {unknown.length > 0 && (
                      <>
                        {known.length > 0 && <View style={{ height: 1, backgroundColor: Colors.separator, marginVertical: 2 }} />}
                        <Text style={{ color: Colors.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Off-airport & unknown</Text>
                        {unknown.map(row)}
                      </>
                    )}
                  </>
                );
              }}
            </ListRow>
            <ListRow T={T} icon="airplane-outline" label="Aircraft" count={insideData.aircraft.length}>
              {() => insideData.aircraft.map((a) => (
                <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="airplane" size={13} color={Colors.textMuted} />
                  <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{a}</Text>
                </View>
              ))}
            </ListRow>
            <ListRow T={T} icon="people-outline" label="Second pilots" count={insideData.pilots.length}>
              {() => insideData.pilots.map((n) => (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="person" size={13} color={Colors.textMuted} />
                  <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13 }}>{n}</Text>
                </View>
              ))}
            </ListRow>
          </View>

          {/* Kort notis + byt fil (uploadkortet är dolt när en analys visas, så ge en väg tillbaka) */}
          <View style={{ gap: 2, marginTop: 2 }}>
            <Text style={styles.hint}>Nothing is saved until you tap Save.</Text>
            <TouchableOpacity
              style={styles.chooseOtherBtn}
              onPress={handlePick}
              disabled={importing || saving}
              activeOpacity={0.7}
              hitSlop={10}
            >
              <Ionicons name="swap-horizontal-outline" size={15} color={Colors.textSecondary} />
              <Text style={styles.chooseOtherText}>Choose a different file</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

    </ScrollView>
    {result && (
      <SaveFooter T={T} label={`Save ${included.toLocaleString('en-US')} ${included === 1 ? 'flight' : 'flights'}${removeCount ? ` · remove ${removeCount}` : ''}`}
        saving={saving} disabled={included === 0} onPress={saveAll} bottom={insets.bottom} />
    )}
    {progressLayer}
    <PremiumModal visible={showPremiumModal} onClose={() => setShowPremiumModal(false)} feature="CSV / Excel import" />
    </>
  );
}

function FlightPreviewRow({ flight }: { flight: OcrFlightResult }) {
  const styles = makeStyles();
  const pic = parseFloat(flight.pic ?? '0') || 0;
  const ifr = parseFloat(flight.ifr ?? '0') || 0;
  const night = parseFloat(flight.night ?? '0') || 0;
  const cop = parseFloat(flight.co_pilot ?? '0') || 0;
  return (
    <View style={[styles.previewRow, flight.needs_review && styles.previewRowFlagged]}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.previewRoute}>{flight.dep_place || '?'}→{flight.arr_place || '?'}</Text>
          <Text style={styles.previewDate}>{flight.date}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Text style={styles.previewChip}>TOT {flight.total_time}h</Text>
          {pic > 0 && <Text style={[styles.previewChip, { color: Colors.success }]}>PIC {flight.pic}h</Text>}
          {cop > 0 && <Text style={[styles.previewChip, { color: Colors.primary }]}>COP {flight.co_pilot}h</Text>}
          {ifr > 0 && <Text style={[styles.previewChip, { color: Colors.primaryLight }]}>IFR {flight.ifr}h</Text>}
          {night > 0 && <Text style={[styles.previewChip, { color: Colors.textMuted }]}>NIGHT {flight.night}h</Text>}
          {flight.flight_rules === 'IFR' && ifr === 0 && (
            <Text style={[styles.previewChip, { color: Colors.warning }]}>IFR RULE</Text>
          )}
        </View>
      </View>
      {flight.needs_review && (
        <Ionicons name="warning" size={12} color={Colors.warning} />
      )}
    </View>
  );
}
