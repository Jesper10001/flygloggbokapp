import { useState, useMemo, useEffect, useRef } from 'react';
import { lookupAircraft } from '../../services/aircraftLookup';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pickImportFile, importFromFile, generateImportSummary, type ImportResult } from '../../services/import';
import { estimateNightForImport, countComputable, type NightBasis, type NightEstimate } from '../../services/importNight';
import { CondBar } from '../../components/logflight/CondBar';
import { CountryFlag } from '../../components/CountryFlag';
import { insertFlight, getAircraftCruiseSpeed, updateAircraftCruiseSpeed, updateAircraftEndurance, addAircraftTypeToRegistry, flightExists } from '../../db/flights';
import { enrichFleetInBackground } from '../../services/fleetEnrich';
import { useFlightStore } from '../../store/flightStore';
import { shouldOpenWrapped, markWrappedUnlocked } from '../../store/wrappedStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { PremiumModal } from '../../components/PremiumModal';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../../utils/tokenGate';
import type { OcrFlightResult } from '../../types/flight';
import { TextInput as RNTextInput } from 'react-native';
import { getAirportByIcao, addCustomAirport, addTemporaryPlace, getAirportCoordinates, calculateDistance } from '../../db/icao';

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
    stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    stepBubble: {
      width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary + '1C', borderWidth: 1, borderColor: Colors.primary + '33', marginTop: 1,
    },
    stepNum: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
    stepTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
    stepDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
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
    chooseOtherBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, marginTop: 2 },
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
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');
  const [totalTimeCol, setTotalTimeCol] = useState(''); // vald varaktighetskolumn (Block/Air/Flight) → total_time
  // AI-sammanfattning av importen (fritext) — laddas asynkront efter analysen, även vid fel
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false); // kollapsad förhandsvisning som standard
  const [importError, setImportError] = useState<string | null>(null);
  // Nattid-uppskattning (när filen saknar night-fält) — fråga om tider är UTC/local + räkna ut.
  const [nightBasis, setNightBasis] = useState<NightBasis | null>(null);
  const [nightEst, setNightEst] = useState<NightEstimate | null>(null);
  const [nightApplied, setNightApplied] = useState(false);
  const [manualNight, setManualNight] = useState<Record<number, number>>({}); // skippade flygningar: nattid (h) per index
  const [skippedExpanded, setSkippedExpanded] = useState(false);
  const [scrollOn, setScrollOn] = useState(true); // lås scroll medan man drar en night-bar
  // Expanderbara sektioner i förhandsvisningen (samma mönster som Imported data-sidan)
  const [openAirports, setOpenAirports] = useState(false);
  const [openAircraft, setOpenAircraft] = useState(false);
  const [openPilots, setOpenPilots] = useState(false);
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
      if (isPremium || isMax) { showMonthlyTokenLimitAlert(); } else { setShowPremiumModal(true); }
      return;
    }
    const file = await pickImportFile();
    if (!file) return;

    setFileName(file.name);
    setImporting(true);
    setResult(null);
    setNightBasis(null); setNightEst(null); setNightApplied(false); setManualNight({}); setSkippedExpanded(false);
    setProgress({ current: 0, total: 0 });
    setUnknownAirports([]);
    setAirportCoords({});
    setDbTypeData({});
    setFlightExplanations({});
    setAiSummary(null);
    setSummaryLoading(false);
    setSummaryExpanded(false);
    setImportError(null);
    setOpenAirports(false);
    setOpenAircraft(false);
    setOpenPilots(false);
    setAirportMeta({});

    try {
      const res = await importFromFile(file.uri, (current, total) => setProgress({ current, total }));
      setResult(res);
      setTotalTimeCol(res.totalTimeColumn || ''); // vilken tidskolumn som används som total_time

      // AI-sammanfattning (fritext) — asynkront, blockerar inte förhandsvisningen
      setSummaryLoading(true);
      const sumDates = res.flights.map((f) => f.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
      generateImportSummary({
        fileName: file.name,
        detectedFormat: res.detectedFormat,
        totalRows: res.totalRows,
        parsedFlights: res.flights.length,
        totalHours: Math.round(res.flights.reduce((s, f) => s + (parseFloat(f.total_time) || 0), 0) * 10) / 10,
        dateRange: sumDates.length ? `${sumDates[0]} – ${sumDates[sumDates.length - 1]}` : undefined,
        aircraft: [...new Set(res.flights.map((f) => f.aircraft_type).filter(Boolean))],
        airports: [...new Set(res.flights.flatMap((f) => [f.dep_place, f.arr_place]).filter(Boolean))].slice(0, 40) as string[],
        pilots: [...new Set(res.flights.map((f) => f.second_pilot).filter(Boolean))] as string[],
        timeCandidates: res.timeCandidates,
        totalTimeColumn: res.totalTimeColumn,
        warnings: res.warnings,
      })
        .then((s) => setAiSummary(s))
        .catch(() => setAiSummary(''))
        .finally(() => setSummaryLoading(false));

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
    } catch (e: any) {
      if (isTokenQuotaError(e)) {
        // Race: tokens tog slut mellan gate-kollen och själva anropet — samma gate som ovan.
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremiumModal(true);
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
    let skipped = 0; // dubbletter som redan finns i loggboken
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
      for (let i = 0; i < result.flights.length; i++) {
        const f = result.flights[i];
        const ft = flightTypes[i] ?? 'normal';
        const simCat = ft === 'sim' ? (simCategories[i] ?? 'FFS') : '';
        const explanation = flightExplanations[i];
        const remarksNote =
          explanation === 'temporary' ? '[Off-airport (ZZZZ)]' :
          explanation === 'refuel'    ? '[En-route refuel]' : '';
        const remarks = [f.remarks, remarksNote].filter(Boolean).join(' ');
        // Dubblettkontroll: hoppa över flighter som redan finns (samma datum + rutt + tider) →
        // en om-import av samma fil skapar inga dubbletter.
        if (await flightExists(f.date, f.dep_place, f.arr_place, f.dep_utc, f.arr_utc)) { skipped++; continue; }
        await insertFlight({ ...f, remarks, flight_type: ft, sim_category: simCat as any }, { source: 'import' });
        saved++;
      }
      await Promise.all([loadFlights(), loadStats()]);
      // Hämta resterande Fleet-data (spec + bilder) i BAKGRUNDEN för de importerade typerna → korten
      // är kompletta när användaren öppnar Fleet-sidan. Tyst + token-gated (blockerar inte importen).
      enrichFleetInBackground();
      // Dubblett-notis (om några hoppades över) läggs till i bekräftelsen.
      const dupNote = skipped > 0 ? `\n\n${skipped} duplicate${skipped === 1 ? '' : 's'} skipped (already in logbook).` : '';
      // Importen klar → lås upp Wrapped + notis (bemannad pilot), annars vanlig bekräftelse.
      if (await shouldOpenWrapped()) {
        await markWrappedUnlocked();
        const sv = t('yes') === 'Ja';
        Alert.alert(
          t('done_exclamation'),
          (sv ? `${saved} ${t('flights_imported')}\n\nDin Wrapped är redo — utforska den i Inställningar.`
              : `${saved} ${t('flights_imported')}\n\nYour Wrapped is ready — explore it in Settings.`) + dupNote,
          [{ text: 'OK', onPress: finishNav }],
        );
      } else {
        Alert.alert(t('done_exclamation'), `${saved} ${t('flights_imported')}${dupNote}`, [
          { text: 'OK', onPress: finishNav },
        ]);
      }
    } catch (e: any) {
      Alert.alert(t('save_error'), e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Sammanställning för "vad filen innehåller"-kortet (samma presentation som Imported data)
  const insideData = useMemo(() => {
    if (!result) return null;
    const CATS: { key: string; label: string }[] = [
      { key: 'total_time', label: 'Total' },
      { key: 'pic', label: 'PIC' },
      { key: 'co_pilot', label: 'Co-pilot' },
      { key: 'dual', label: 'Dual' },
      { key: 'instructor', label: 'Instructor' },
      { key: 'ifr', label: 'IFR' },
      { key: 'night', label: 'Night' },
    ];
    const cats: Record<string, number> = {};
    for (const f of result.flights) {
      for (const c of CATS) cats[c.key] = (cats[c.key] || 0) + (parseFloat((f as any)[c.key]) || 0);
    }
    const icaos = [...new Set(result.flights.flatMap((f) => [f.dep_place, f.arr_place]).filter(Boolean))] as string[];
    const aircraft = [...new Set(result.flights.map((f) => (f.aircraft_type || '').trim()).filter(Boolean))];
    const pilots = [...new Set(result.flights.map((f) => (f.second_pilot || '').trim()).filter(Boolean))];
    const dates = result.flights.map((f) => f.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
    return { CATS, cats, icaos, aircraft, pilots, dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '' };
  }, [result]);

  // Expandera flygplatslistan → resolva namn + land för koder som saknas (samma som Imported data)
  const toggleAirportsPreview = () => {
    setOpenAirports((prev) => {
      const next = !prev;
      if (next && insideData) {
        const missing = insideData.icaos.filter((ic) => !airportMeta[ic]);
        if (missing.length) {
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
        }
      }
      return next;
    });
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

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      scrollEnabled={scrollOn}
    >
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.title}>{t('import_logbook')}</Text>
        <Text style={styles.subtitle}>{t('import_logbook_sub')}</Text>
      </View>

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
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>How it works</Text>
            {HOW_IT_WORKS.map((s) => (
              <View key={s.n} style={styles.stepRow}>
                <View style={styles.stepBubble}><Text style={styles.stepNum}>{s.n}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{s.t}</Text>
                  <Text style={styles.stepDesc}>{s.d}</Text>
                </View>
              </View>
            ))}
          </View>

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

      {/* Importfel — inline-kort med AI-förklaring (i stället för Alert) */}
      {importError && !result && !importing && (
        <View style={[styles.aiCard, { borderColor: Colors.danger + '55' }]}>
          <View style={styles.aiCardHeader}>
            <Ionicons name="alert-circle" size={15} color={Colors.danger} />
            <Text style={[styles.aiCardTitle, { color: Colors.danger }]}>Import failed</Text>
          </View>
          {summaryLoading ? (
            <View style={styles.aiLoadingRow}>
              <ActivityIndicator size="small" color={Colors.danger} />
              <Text style={styles.aiLoadingText}>Analyzing imported data…</Text>
            </View>
          ) : (
            <Text style={styles.aiCardText}>{aiSummary || importError}</Text>
          )}
        </View>
      )}

      {/* Förhandsvisning */}
      {result && (
        <>
          {/* Nattid saknas i filen → erbjud uträkning ur rutter + tider (överst, ovanför Import analysis) */}
          {showNightCard && !nightApplied && (
            <View style={styles.nightCard}>
              <View style={styles.nightHeader}>
                <Ionicons name="moon" size={15} color={Colors.primary} />
                <Text style={styles.nightTitle}>Add night time?</Text>
              </View>
              <Text style={styles.nightSub}>
                Your file has no night hours. We can estimate them from your routes & times for {nightComputable} flight{nightComputable === 1 ? '' : 's'}. How did you log the times?
              </Text>
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
                    Estimated {nightEst.totalNight} h night across {nightEst.nightFlights} flight{nightEst.nightFlights === 1 ? '' : 's'}
                    {nightEst.skipped > 0 ? `  ·  ${nightEst.skipped} skipped (missing coords/time)` : ''}
                  </Text>

                  {/* Skippade flygningar → sätt nattid manuellt med en night-bar (som i Log Flight). */}
                  {skippedFlights.length > 0 && (
                    <>
                      <TouchableOpacity onPress={() => setSkippedExpanded((v) => !v)} activeOpacity={0.7} style={styles.nightExpandRow}>
                        <Ionicons name={skippedExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.primary} />
                        <Text style={styles.nightExpandTxt}>Set night manually for {skippedFlights.length} skipped flight{skippedFlights.length === 1 ? '' : 's'}</Text>
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
                                  onPct={(p) => setManualNight((prev) => ({ ...prev, [i]: Math.round((p / 100) * tot * 100) / 100 }))}
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
                    <Text style={styles.nightApplyTxt}>Add to import  ·  {totalNightIncl} h night</Text>
                  </TouchableOpacity>
                  <Text style={styles.nightNote}>
                    Estimated from the sun's position along each route.{nightBasis === 'local' ? ' Local times are converted via longitude — treat as approximate near dawn/dusk.' : ''}
                  </Text>
                </>
              )}
            </View>
          )}
          {nightApplied && (
            <View style={styles.nightCardDone}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.nightDoneTxt}>Night time added — {totalNightIncl} h across {(nightEst?.nightFlights ?? 0) + Object.values(manualNight).filter((v) => v > 0).length} flights.</Text>
            </View>
          )}

          <View style={styles.resultHeader}>
            <View style={styles.resultInfo}>
              <Text style={styles.resultFormat}>{result.detectedFormat}</Text>
              <Text style={styles.resultFile} numberOfLines={1}>{fileName}</Text>
              {result.tokensUsed > 0 && (
                <Text style={styles.tokenUsedText}>{result.tokensUsed.toLocaleString('en-US')} tokens used for import</Text>
              )}
            </View>
            <View style={styles.resultStats}>
              <StatPill label="Rows" value={String(result.totalRows)} />
              <StatPill label="Mapped" value={String(result.mappedRows)} color={Colors.success} />
            </View>
          </View>

          {/* AI-analys — kollapsbar fritextsammanfattning (2 rader syns, tryck för allt) */}
          <TouchableOpacity
            style={styles.aiCard}
            onPress={() => setSummaryExpanded((v) => !v)}
            activeOpacity={0.8}
            disabled={summaryLoading || aiSummary === null}
          >
            <View style={styles.aiCardHeader}>
              <Ionicons name="sparkles" size={14} color={Colors.primary} />
              <Text style={styles.aiCardTitle}>Import analysis</Text>
              {!summaryLoading && aiSummary !== null && (
                <Ionicons
                  name={summaryExpanded ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={Colors.textMuted}
                  style={{ marginLeft: 'auto' }}
                />
              )}
            </View>
            {summaryLoading || aiSummary === null ? (
              <View style={styles.aiLoadingRow}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.aiLoadingText}>Analyzing imported data…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.aiCardText} numberOfLines={summaryExpanded ? undefined : 2}>
                  {aiSummary || 'Analysis unavailable — the data below is still ready to import.'}
                </Text>
                {!summaryExpanded && (
                  <Text style={styles.aiReadMore}>Read more</Text>
                )}
              </>
            )}
          </TouchableOpacity>

          {/* Vad filen innehåller — samma presentation som Settings → Imported data */}
          {insideData && (
            <View style={{ backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="document-attach-outline" size={18} color={Colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>
                    {result.flights.length} {result.flights.length === 1 ? 'flight' : 'flights'} · {(insideData.cats.total_time || 0).toFixed(1)} h
                  </Text>
                  {!!insideData.dateRange && (
                    <Text style={{ color: Colors.textMuted, fontSize: 11.5, marginTop: 2 }}>{insideData.dateRange}</Text>
                  )}
                </View>
              </View>

              {/* Kategoriserad tid (bara > 0 utom Total) */}
              <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
                {insideData.CATS.filter((c) => c.key === 'total_time' || (insideData.cats[c.key] || 0) > 0).map((c) => (
                  <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>{c.label}</Text>
                    <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{(insideData.cats[c.key] || 0).toFixed(1)} h</Text>
                  </View>
                ))}
              </View>

              {/* Flygplatser — expanderbar med flaggor */}
              <TouchableOpacity onPress={toggleAirportsPreview} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Ionicons name="location-outline" size={15} color={Colors.primary} />
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>Airports</Text>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{insideData.icaos.length}</Text>
                <Ionicons name={openAirports ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
              </TouchableOpacity>
              {openAirports && (() => {
                const resolved = insideData.icaos.every((ic) => airportMeta[ic]);
                if (!resolved) return (
                  <View style={{ paddingVertical: 16 }}><ActivityIndicator color={Colors.primary} /></View>
                );
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
                  <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                    {known.map(row)}
                    {unknown.length > 0 && (
                      <>
                        {known.length > 0 && <View style={{ height: 1, backgroundColor: Colors.separator, marginVertical: 2 }} />}
                        <Text style={{ color: Colors.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Off-airport & unknown</Text>
                        {unknown.map(row)}
                      </>
                    )}
                  </View>
                );
              })()}

              {/* Flygfarkoster — expanderbar */}
              <TouchableOpacity onPress={() => setOpenAircraft((v) => !v)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Ionicons name="airplane-outline" size={15} color={Colors.primary} />
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>Aircraft</Text>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{insideData.aircraft.length}</Text>
                <Ionicons name={openAircraft ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
              </TouchableOpacity>
              {openAircraft && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {insideData.aircraft.length === 0
                    ? <Text style={{ color: Colors.textMuted, fontSize: 12 }}>None</Text>
                    : insideData.aircraft.map((a) => (
                      <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="airplane" size={13} color={Colors.textMuted} />
                        <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{a}</Text>
                      </View>
                    ))}
                </View>
              )}

              {/* Second pilots — expanderbar */}
              <TouchableOpacity onPress={() => setOpenPilots((v) => !v)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Ionicons name="people-outline" size={15} color={Colors.primary} />
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>Second pilots</Text>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{insideData.pilots.length}</Text>
                <Ionicons name={openPilots ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
              </TouchableOpacity>
              {openPilots && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {insideData.pilots.length === 0
                    ? <Text style={{ color: Colors.textMuted, fontSize: 12 }}>None</Text>
                    : insideData.pilots.map((p) => (
                      <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="person" size={13} color={Colors.textMuted} />
                        <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13 }}>{p}</Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          )}

          {/* Tidskolumn-väljare — visas bara om filen har flera varaktighetskolumner (Block/Air/Flight) */}
          {result.timeCandidates.length > 1 && (
            <View style={styles.timeColSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="time-outline" size={14} color={Colors.primary} />
                <Text style={[styles.speedTitle, { color: Colors.primary }]}>Which time goes in the logbook?</Text>
              </View>
              <Text style={styles.speedSubtitle}>Your file has more than one flight-time column. Pick the one to use as total time.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {result.timeCandidates.map((c) => {
                  const active = totalTimeCol === c.column;
                  return (
                    <TouchableOpacity
                      key={c.column}
                      style={[styles.timeColBtn, active && styles.timeColBtnActive]}
                      onPress={() => applyTimeColumn(c.column)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.timeColBtnLabel, active && styles.timeColBtnLabelActive]}>{c.label}</Text>
                      <Text style={styles.timeColBtnSub} numberOfLines={1}>{c.column}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}


          {/* Marschfart + uthållighet för nya/ofullständiga fartygstyper */}
          {typesNeedingData.length > 0 && (
            <View style={styles.speedSection}>
              <View style={[styles.speedHeader, { flexDirection: 'row', alignItems: 'center' }]}>
                <Ionicons name="speedometer-outline" size={14} color={Colors.gold} />
                <Text style={styles.speedTitle}>{t('aircraft_data')}</Text>
                <View style={{
                  marginLeft: 'auto',
                }}>
                </View>
              </View>
              <Text style={styles.speedSubtitle}>{t('aircraft_data_sub')} {t('aircraft_data_edit_later')}</Text>
              <View style={styles.speedColHeader}>
                <Text style={[styles.speedType, { color: Colors.textMuted, fontSize: 10 }]}>TYPE</Text>
                <Text style={[styles.speedUnit, { color: Colors.textMuted, fontSize: 10, width: 80, textAlign: 'center' }]}>SPEED (kts)</Text>
                <Text style={[styles.speedUnit, { color: Colors.textMuted, fontSize: 10, width: 80, textAlign: 'center' }]}>ENDUR. (h)</Text>
              </View>
              {typesNeedingData.map(({ type, hasSpeed, hasEndurance }) => {
                const crewSet = crewTypeInputs[type] ?? new Set<string>();
                const ai = aiFilledByType[type] ?? new Set<string>();
                const aiStyle = { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' } as const;
                const aiBtn = { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' } as const;
                const loading = aiLoadingTypes.has(type);
                const failed = aiFailedTypes.has(type);
                return (
                  <View key={type} style={styles.typeBlock}>
                    <View style={styles.speedRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                        <Text style={styles.speedType}>{type}</Text>
                        {loading && <ActivityIndicator size="small" color={Colors.primary} />}
                        {failed && <Ionicons name="alert-circle" size={14} color={Colors.textMuted} />}
                      </View>
                      <RNTextInput
                        style={[
                          styles.speedInput,
                          hasSpeed && styles.speedInputDone,
                          ai.has('speed') && aiStyle,
                        ]}
                        placeholder={hasSpeed ? '✓' : '110'}
                        placeholderTextColor={hasSpeed ? Colors.success : Colors.textMuted}
                        keyboardType="number-pad"
                        value={speedInputs[type] ?? ''}
                        onChangeText={(v) => { setSpeedInputs((prev) => ({ ...prev, [type]: v })); clearAiFlag(type, 'speed'); }}
                        maxLength={4}
                        editable={!hasSpeed}
                      />
                      <RNTextInput
                        style={[
                          styles.speedInput,
                          hasEndurance && styles.speedInputDone,
                          ai.has('endurance') && aiStyle,
                        ]}
                        placeholder={hasEndurance ? '✓' : '3.0'}
                        placeholderTextColor={hasEndurance ? Colors.success : Colors.textMuted}
                        keyboardType="decimal-pad"
                        value={enduranceInputs[type] ?? ''}
                        onChangeText={(v) => { setEnduranceInputs((prev) => ({ ...prev, [type]: v })); clearAiFlag(type, 'endurance'); }}
                        maxLength={4}
                        editable={!hasEndurance}
                      />
                    </View>
                    <View style={styles.crewRow}>
                      {(['sp', 'mp'] as const).map((key) => {
                        const active = crewSet.has(key);
                        const aiActive = ai.has('crew') && active;
                        const label = key === 'sp' ? 'SP' : 'MP';
                        const sub = key === 'sp' ? 'Single pilot' : 'Multi-pilot';
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.crewBtn, active && styles.crewBtnActive, aiActive && aiBtn]}
                            onPress={() => { toggleCrewForType(type, key); clearAiFlag(type, 'crew'); }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{label}</Text>
                            <Text style={styles.crewBtnSub}>{sub}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {(['se', 'me'] as const).map((key) => {
                        const active = engineInputs[type] === key;
                        const aiActive = ai.has('engine') && active;
                        const label = key === 'se' ? 'SE' : 'ME';
                        const sub = key === 'se' ? 'Single engine' : 'Multi engine';
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.crewBtn, active && styles.crewBtnActive, aiActive && aiBtn]}
                            onPress={() => { setEngineInputs(prev => ({ ...prev, [type]: active ? '' : key })); clearAiFlag(type, 'engine'); }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{label}</Text>
                            <Text style={styles.crewBtnSub}>{sub}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.crewRow}>
                      {(['airplane', 'helicopter'] as const).map((cat) => {
                        const active = categoryInputs[type] === cat;
                        const aiActive = ai.has('category') && active;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[styles.crewBtn, { flex: 1 }, active && styles.crewBtnActive, aiActive && aiBtn]}
                            onPress={() => { setCategoryInputs(prev => ({ ...prev, [type]: active ? '' : cat })); clearAiFlag(type, 'category'); }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>
                              {cat === 'airplane' ? t('airplane') : t('helicopter')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Misstänkta flygningar — avstånd > 1.5× räckvidd */}
          {suspiciousFlights.length > 0 && (
            <View style={styles.suspiciousSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.suspiciousTitle}>Suspicious legs ({suspiciousFlights.length})</Text>
              </View>
              <Text style={styles.speedSubtitle}>
                Distance exceeds 1.5× the range. Provide an explanation or import anyway.
              </Text>
              {suspiciousFlights.map(({ idx, f, distNm, rangeNm }) => {
                const current = flightExplanations[idx];
                return (
                  <View key={idx} style={styles.suspiciousRow}>
                    <View style={styles.suspiciousInfo}>
                      <Text style={styles.suspiciousRoute}>{f.dep_place || '?'}→{f.arr_place || '?'}</Text>
                      <Text style={styles.suspiciousMeta}>
                        {f.date} · {f.aircraft_type} · {distNm} nm · range {rangeNm} nm
                      </Text>
                    </View>
                    <View style={styles.suspiciousToggle}>
                      <TouchableOpacity
                        style={[styles.suspiciousBtn, current === 'temporary' && styles.suspiciousBtnActive]}
                        onPress={() => setFlightExplanations(p => ({ ...p, [idx]: p[idx] === 'temporary' ? undefined as any : 'temporary' }))}
                      >
                        <Text style={[styles.suspiciousBtnText, current === 'temporary' && styles.suspiciousBtnTextActive]}>
                          Off-airport
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.suspiciousBtn, current === 'refuel' && styles.suspiciousBtnRefuel]}
                        onPress={() => setFlightExplanations(p => ({ ...p, [idx]: p[idx] === 'refuel' ? undefined as any : 'refuel' }))}
                      >
                        <Text style={[styles.suspiciousBtnText, current === 'refuel' && styles.suspiciousBtnTextActive]}>
                          En-route refuel
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Flygningar som överstiger uthållighet — kategorisera som sim eller hot refuel */}
          {exceedingFlights.length > 0 && (
            <View style={styles.exceedSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.exceedTitle}>Longer than endurance — what is it?</Text>
              </View>
              <Text style={styles.speedSubtitle}>
                Sim sessions are excluded from statistics and map. Hot refuel counts as a normal flight.
              </Text>
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
                        <TouchableOpacity
                          style={[styles.exceedBtn, current === 'sim' && styles.exceedBtnSim]}
                          onPress={() => setFlightTypes((p) => ({ ...p, [idx]: 'sim' }))}
                        >
                          <Text style={[styles.exceedBtnText, current === 'sim' && styles.exceedBtnTextActive]}>Sim</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.exceedBtn, current === 'hot_refuel' && styles.exceedBtnHot]}
                          onPress={() => setFlightTypes((p) => ({ ...p, [idx]: 'hot_refuel' }))}
                        >
                          <Text style={[styles.exceedBtnText, current === 'hot_refuel' && styles.exceedBtnTextActive]}>Hot refuel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {current === 'sim' && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginLeft: 12 }}>
                        {(['FFS','FTD','FNPT_II','FNPT_I','BITD','CPT_PPT','CBT'] as const).map((cat) => {
                          const active = (simCategories[idx] ?? 'FFS') === cat;
                          return (
                            <TouchableOpacity
                              key={cat}
                              style={[styles.exceedBtn, active && styles.exceedBtnSim]}
                              onPress={() => setSimCategories((p) => ({ ...p, [idx]: cat }))}
                            >
                              <Text style={[styles.exceedBtnText, active && styles.exceedBtnTextActive]}>
                                {cat.replace(/_/g, '/')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Spara-knapp */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={saveAll}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
                <Text style={styles.saveBtnText}>{t('save_all')} ({result.flights.length})</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            All imported data is saved with source "import" and can be reviewed in the audit log.
          </Text>

          {/* Byt fil — uploadkortet är dolt när en analys visas, så ge en väg tillbaka */}
          <TouchableOpacity
            style={styles.chooseOtherBtn}
            onPress={handlePick}
            disabled={importing || saving}
            activeOpacity={0.7}
          >
            <Ionicons name="swap-horizontal-outline" size={15} color={Colors.textSecondary} />
            <Text style={styles.chooseOtherText}>Choose a different file</Text>
          </TouchableOpacity>
        </>
      )}

    </ScrollView>
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

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = makeStyles();
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
