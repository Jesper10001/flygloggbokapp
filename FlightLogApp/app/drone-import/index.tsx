// "Import CSV" (drönare) — samma utseende och flöde som pilotens Import: Hero + upload-dropzone → filval →
// laddskärmen med Blade-myntet (BladeProgress) under AI-kolumnmappningen → importrapporten (components/import/
// ImportReport, samma som pilotens): sammanfattning, AI:ns "What we found", "Before you save" med Drone details
// (AI sätter airframe/vikt/klass, rättas per modell) och "In this file" → Save (source='import') + registrering + berikning.
import { HowItWorks } from '../../components/HowItWorks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, TextInput, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useToastStore } from '../../components/Toast';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { lookupDrone } from '../../services/droneLookup';
import { askAiConsent, isAiConsentError } from '../../services/aiConsent';
import { hasTokenQuota, tokensToCoins } from '../../utils/tokenGate';
import { BladeProgress } from '../../components/BladeProgress';
import { pickImportFile } from '../../services/import';
import { CIVIL_CATEGORIES, MILITARY_TOP_LEVEL, categoryFromCClass } from '../../constants/droneCategories';
import {
  importDroneFromFile, saveDroneImport, generateDroneImportSummary, registerImportedDrones, enrichImportedDroneModels,
  type DroneImportResult, type ParsedDroneRow,
} from '../../services/droneImport';
import { useFleetDoneStore } from '../../components/FleetDoneModal';
import { deleteDroneFlight } from '../../db/drones';
import { matchDroneFlightsToLogbook, idsToRemove, EMPTY_MATCH, type LogbookMatch } from '../../services/logbookMatch';
import {
  ReportHero, AnalysisCard, SectionLabel, CheckGroup, CheckItem, EditRow, TotalsGrid, ListRow, SaveFooter, FOOTER_SPACE, periodOf,
  ReviewFlightRow, useCheckNav, datesIn, dayMonth, reviewForAi, logbookReview, ClashRow, clashOthers,
  type ReportTheme, type CheckStatus, type ReviewGroup, type ReviewFlight, type ClashChoice,
} from '../../components/import/ImportReport';

const HOW_IT_WORKS = [
  { n: '1', t: 'Export & choose file', d: 'Export your drone log as CSV — including a file exported from this app — and choose it above.' },
  { n: '2', t: 'AI maps your columns', d: 'Claude identifies the format and maps date, drone, category, mode, flight time and night. Only a small sample of rows is sent — every flight is parsed locally on your device.' },
  { n: '3', t: 'Review before saving', d: 'You get a full preview with statistics and an AI analysis. Nothing is saved until you approve.' },
];
const ACCEPTED_FORMATS = [
  { icon: 'document-text-outline', t: '.csv', d: 'comma, semicolon, tab or pipe separated' },
  { icon: 'document-outline', t: '.txt', d: 'plain-text exports' },
];
const ANALYZE_STEPS = ['Identifying your log format…', 'Mapping the columns…', 'Detecting date & time formats…', 'Matching drones and categories…'];

const AIRFRAMES: [Airframe, string][] = [['multirotor', 'Multirotor'], ['helicopter', 'Single-rotor'], ['fixedwing', 'Fixed-wing']];
const CLASS_OPTS = [...CIVIL_CATEGORIES, ...MILITARY_TOP_LEVEL] as string[];

type Airframe = 'multirotor' | 'helicopter' | 'fixedwing';
type DroneInfo = { airframe: Airframe | ''; cls: string; mtow_g: number };

// Stabil tom referens → undviker att `rows`/`droneModels` byter identitet varje render (loop-skydd).
const EMPTY_ROWS: ParsedDroneRow[] = [];

// AI:s drone_type → airframe-toggeln (vtol viks in i fixed-wing).
// Flygningar att se över under "Before you save" (och som AI:ns text länkar till), som pilotläget: tider som kapades
// till flygtiden och noteringar från läsningen som nämner ett datum. used = noteringar som blivit en grupp.
// Först jämförelsen med loggboken: krockar i tid och flygningar som redan finns.
const CAP_LABEL: Record<string, string> = { night_time: 'Night', ifr: 'IFR', co_pilot_fpv: 'FPV / 2nd pilot', dual: 'Dual', instructor: 'Instructor' };
const GROUP_ICON: Record<string, keyof typeof Ionicons.glyphMap> = { clash: 'git-compare-outline', dups: 'copy-outline', capped: 'cut-outline' };
function buildDroneReview(rows: ParsedDroneRow[], warnings: string[], fmt: (h: number) => string, match: LogbookMatch = EMPTY_MATCH): { groups: ReviewGroup[]; used: Set<string> } {
  const base = (r: ParsedDroneRow, i: number): ReviewFlight => ({
    idx: i, date: r.date, route: r.location || r.drone_type || 'Flight',
    sub: [r.drone_type, r.registration, fmt(r.total_time)].filter(Boolean).join(' · '), detail: '',
  });
  const valuesOf = (r: ParsedDroneRow) => {
    const parts = [r.category, r.flight_mode].filter(Boolean) as string[];
    ([['Night', r.night_time], ['IFR', r.ifr], ['FPV / 2nd pilot', r.co_pilot_fpv], ['Dual', r.dual]] as const)
      .forEach(([l, v]) => { if (v > 0) parts.push(`${l} ${fmt(v)}`); });
    if (r.landings_day + r.landings_night > 0) parts.push(`Landings ${r.landings_day} day, ${r.landings_night} night`);
    return parts.join(' · ');
  };
  const groups: ReviewGroup[] = logbookReview(match, (i) => base(rows[i], i), fmt, true);
  const used = new Set<string>();
  const capped = rows.map((r, i) => ({ r, i })).filter(({ r }) => (r.capped?.length ?? 0) > 0);
  if (capped.length) {
    const one = capped.length === 1;
    groups.push({
      id: 'capped', todo: true, title: 'Times cut to the flight time',
      about: `${one ? 'A time was' : 'Times were'} longer than the flight itself, so ${one ? 'it was' : 'they were'} cut to the flight time. Check against your log.`,
      flights: capped.map(({ r, i }) => ({ ...base(r, i), detail: r.capped!.map((c) => `${CAP_LABEL[c.field] ?? c.field} ${fmt(c.from)} → ${fmt(c.to)}`).join(' · ') })),
    });
    warnings.forEach((w) => { if (/exceeding total time/i.test(w)) used.add(w); });
  }
  let k = 0;
  warnings.forEach((w) => {
    if (used.has(w)) return;
    const ds = datesIn(w);
    const hits = ds.length ? rows.map((r, i) => ({ r, i })).filter(({ r }) => ds.includes(r.date)) : [];
    if (!hits.length) return;
    used.add(w);
    groups.push({
      id: `note${++k}`, todo: true, about: w,
      title: ds.length === 1 ? `${hits.length === 1 ? 'Flight' : 'Flights'} on ${dayMonth(ds[0])}` : `Flights on ${ds.length} dates`,
      flights: hits.map(({ r, i }) => ({ ...base(r, i), detail: valuesOf(r) })),
    });
  });
  return { groups, used };
}

function toAirframe(t: string): Airframe | '' {
  if (t === 'multirotor') return 'multirotor';
  if (t === 'helicopter') return 'helicopter';
  if (t === 'fixedwing' || t === 'vtol') return 'fixedwing';
  return '';
}

export default function DroneImportCsvScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const { timeFormat, formatTime } = useTimeFormat();
  const { loadFlights, loadStats } = useDroneFlightStore();
  const show = useToastStore((s) => s.show);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 3 });
  const [stepIdx, setStepIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<DroneImportResult | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [droneData, setDroneData] = useState<Record<string, DroneInfo>>({}); // per-modell airframe/klass/vikt
  const [lookingModels, setLookingModels] = useState<Set<string>>(new Set()); // modeller som slås upp just nu
  const lookedUpRef = useRef<Set<string>>(new Set());                         // auto-lookup: kör en gång per modell
  const [openModel, setOpenModel] = useState<string | null>(null);     // modellen som är utfälld i Drone details
  const [excluded, setExcluded] = useState<Set<number>>(new Set());     // flygningar som lämnas utanför ("Leave out")
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
  const fmtH = (h: number) => `${formatTime(h)}${timeFormat === 'decimal' ? ' h' : ''}`;
  // Rapportens färger i drönarläget (samma rapport som pilotläget).
  const T: ReportTheme = {
    bg: DR.background, card: DR.surface, elevated: DR.elevated, border: DR.border, separator: DR.separator,
    text: DR.text, text2: DR.text2, muted: DR.muted, accent, success: DR.good, warning: DR.warning, danger: DR.danger, onAccent: DR.inkOnAccent,
  };

  // Roterande stegtext medan filen läses (byts varannan sekund).
  useEffect(() => {
    if (!importing) { setStepIdx(0); return; }
    const id = setInterval(() => setStepIdx((i) => i + 1), 2000);
    return () => clearInterval(id);
  }, [importing]);

  // Laddskärmen med Blade-myntet (= pilotens import): under hela läsningen, en stund med bock när filen är
  // läst, sedan tonar den bort över förhandsvisningen.
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

  const rows = result?.rows ?? EMPTY_ROWS;

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    const hours = rows.reduce((s, r, i) => s + (excluded.has(i) ? 0 : r.total_time), 0);
    const byMode = { VLOS: 0, EVLOS: 0, BVLOS: 0 } as Record<string, number>;
    const tf = { night: 0, ifr: 0, fpv: 0, dual: 0, instr: 0 };
    let night = 0;
    const locations = new Set<string>();
    const dates: string[] = [];
    for (const [i, r] of rows.entries()) {
      if (excluded.has(i)) continue;
      if (r.h_vlos + r.h_evlos + r.h_bvlos > 0) { byMode.VLOS += r.h_vlos; byMode.EVLOS += r.h_evlos; byMode.BVLOS += r.h_bvlos; }
      else byMode[r.flight_mode] = (byMode[r.flight_mode] || 0) + r.total_time;
      tf.night += r.night_time; tf.ifr += r.ifr; tf.fpv += r.co_pilot_fpv; tf.dual += r.dual; tf.instr += r.instructor;
      if (r.is_night) night++;
      if (r.location) locations.add(r.location);
      if (r.date) dates.push(r.date);
    }
    dates.sort();
    return { hours, byMode, tf, night, locations: [...locations], dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '' };
  }, [rows, excluded]);
  const review = useMemo(() => (result ? buildDroneReview(result.rows, result.warnings, fmtH, match) : { groups: [] as ReviewGroup[], used: new Set<string>() }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [result, timeFormat, match]);
  const included = rows.length - excluded.size;
  const removeCount = useMemo(() => idsToRemove(match, keepNew, (i) => excluded.has(i)).length, [match, keepNew, excluded]);

  // Unika modeller (för Drone data-sektionen).
  const droneModels = useMemo(() => {
    const map = new Map<string, { model: string; count: number; regs: Set<string>; catCount: Record<string, number> }>();
    for (const r of rows) {
      const m = (r.drone_type || '').trim();
      if (!m) continue;
      let e = map.get(m);
      if (!e) { e = { model: m, count: 0, regs: new Set(), catCount: {} }; map.set(m, e); }
      e.count++;
      if (r.registration) e.regs.add(r.registration);
      if (r.category) e.catCount[r.category] = (e.catCount[r.category] || 0) + 1;
    }
    return [...map.values()].map((e) => ({
      model: e.model, count: e.count, regs: [...e.regs],
      defaultCat: Object.entries(e.catCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    }));
  }, [rows]);

  // Seed per-modell-data (klass från CSV, airframe/vikt tomma tills AI/manuellt).
  useEffect(() => {
    setDroneData((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const d of droneModels) if (!next[d.model]) { next[d.model] = { airframe: '', cls: d.defaultCat, mtow_g: 0 }; changed = true; }
      return changed ? next : prev; // samma referens när inget nytt → ingen re-render (bryter loopen)
    });
  }, [droneModels]);

  const setInfo = (model: string, patch: Partial<DroneInfo>) =>
    setDroneData((p) => ({ ...p, [model]: { ...(p[model] ?? { airframe: '', cls: '', mtow_g: 0 }), ...patch } }));

  // AI-uppslag för en modell — fyller airframe/vikt/klass. Auto (manual=false): tyst, fyller bara TOMMA
  // fält, hoppar om slut på coins. Manuell (knapp): meddelar fel och skriver över även ifyllda fält.
  const lookupModel = async (model: string, manual = false) => {
    if (!manual && lookedUpRef.current.has(model)) return;
    lookedUpRef.current.add(model);
    if (!hasTokenQuota()) { if (manual) show?.('Out of Blade-coins for look-ups'); return; }
    setLookingModels((p) => new Set(p).add(model));
    try {
      const r = await lookupDrone(model);
      if (r.needs_manual || !r.model) { if (manual) show?.('Could not identify that drone'); return; }
      const af = toAirframe(r.drone_type);
      const guessed = categoryFromCClass(r.c_class);
      setDroneData((p) => {
        const cur = p[model] ?? { airframe: '' as Airframe | '', cls: '', mtow_g: 0 };
        const upd = { ...cur };
        if (af && (manual || !cur.airframe)) upd.airframe = af;
        if (r.mtow_g > 0 && (manual || !cur.mtow_g)) upd.mtow_g = r.mtow_g;
        if (guessed && (manual || !cur.cls)) upd.cls = guessed;
        return { ...p, [model]: upd };
      });
    } catch { if (manual) show?.('Look-up failed'); }
    finally { setLookingModels((p) => { const n = new Set(p); n.delete(model); return n; }); }
  };

  // Auto-uppslag så fort en ny modell dyker upp (= pilotens Aircraft data auto-fill), token-styrt.
  useEffect(() => {
    droneModels.forEach((d) => { if (!lookedUpRef.current.has(d.model)) lookupModel(d.model, false); });
  }, [droneModels]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSummary = async (r: DroneImportResult | null, fname: string, error?: string, m: LogbookMatch = EMPTY_MATCH) => {
    setSummaryLoading(true);
    try {
      const txt = await generateDroneImportSummary({
        fileName: fname,
        detectedFormat: r?.detectedFormat,
        totalRows: r?.totalRows,
        parsedFlights: r?.mappedRows,
        totalHours: r ? Math.round(r.rows.reduce((s, x, i) => s + (m.dups.has(i) ? 0 : x.total_time), 0) * 10) / 10 : undefined,
        drones: r ? [...new Set(r.rows.map((x) => x.drone_type).filter(Boolean))] : undefined,
        categories: r ? [...new Set(r.rows.map((x) => x.category).filter(Boolean))] : undefined,
        warnings: r?.warnings,
        reviewGroups: r ? reviewForAi(buildDroneReview(r.rows, r.warnings, fmtH, m).groups) : undefined,
        error,
      });
      setAiSummary(txt);
    } catch { setAiSummary(''); }
    finally { setSummaryLoading(false); }
  };

  const pick = async () => {
    // Kolumnmappningen är ett AI-anrop → samtycke innan filväljaren öppnas.
    if (!(await askAiConsent())) return;
    // Filen väljs först; laddskärmen visas bara medan en vald fil läses (inte bakom filväljaren).
    const file = await pickImportFile();
    if (!file) return;
    setFileName(file.name);
    setImporting(true); setImportError(null); setResult(null); setAiSummary(''); setDroneData({}); setOpenModel(null); setExcluded(new Set()); setMatch(EMPTY_MATCH); setKeepNew(new Set()); nav.reset();
    lookedUpRef.current = new Set(); setLookingModels(new Set());
    setProgress({ current: 0, total: 3 });
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    startedAt.current = Date.now();
    overlayFade.setValue(1);
    setOverlay('busy');
    try {
      const r = await importDroneFromFile(file.uri, (current, total) => setProgress({ current, total }));
      // Mot loggboken: flygningar som redan finns lämnas utanför från början, krockar i tid visas för val.
      const m = await matchDroneFlightsToLogbook(r.rows, { withinFile: true }).catch(() => EMPTY_MATCH);
      setMatch(m); setExcluded(new Set(m.dups.keys()));
      setResult(r); setImporting(false);
      finishOverlay();
      fetchSummary(r, file.name, undefined, m);
    } catch (e: any) {
      setImporting(false);
      setOverlay('hidden');
      if (isAiConsentError(e)) return; // "Not now" → tillbaka till filvalet
      const msg = e?.message ?? 'Import failed.';
      setImportError(msg);
      fetchSummary(null, file.name, msg);
    }
  };

  const doImport = async () => {
    if (!result || rows.length === 0) return;
    setSaving(true);
    try {
      // Applicera per-modell klass på flygningarna + bygg registrerings-info (airframe/vikt/klass).
      const rowsToSave: ParsedDroneRow[] = rows.filter((_, i) => !excluded.has(i)).map((r) => { // utan "Leave out"
        const info = droneData[r.drone_type];
        return info?.cls ? { ...r, category: info.cls } : r;
      });
      const infoByModel: Record<string, { airframe?: string; mtow_g?: number; category?: string }> = {};
      for (const [model, info] of Object.entries(droneData)) infoByModel[model] = { airframe: info.airframe || '', mtow_g: info.mtow_g || 0, category: info.cls || '' };

      // Krockar där den nya behålls: loggbokens flygning tas bort först.
      const removed = idsToRemove(match, keepNew, (i) => excluded.has(i));
      for (const id of removed) await deleteDroneFlight(id);
      const n = await saveDroneImport(rowsToSave);
      await registerImportedDrones(rowsToSave, infoByModel); // registrera flottan FÖRE navigering (syns direkt)
      await Promise.all([loadFlights(), loadStats()]);
      show?.(`Imported ${n} ${n === 1 ? 'flight' : 'flights'}${removed.length ? `, removed ${removed.length} overlapping` : ''}`);
      router.replace('/(tabs)/drone-dashboard');
      // Bakgrund: hämta bild + fulla specar → popup som meddelar + navigerar till Fleet (= pilotens flöde).
      enrichImportedDroneModels(rowsToSave)
        .then((res) => { loadFlights(); if (res.enriched > 0 || res.stoppedForQuota) useFleetDoneStore.getState().show(res, '/(tabs)/drone-log'); })
        .catch(() => {});
    } catch (e: any) {
      setSaving(false);
      setImportError(e?.message ?? 'Could not save the flights.');
    }
  };

  const uploadTitle = importing
    ? (progress.current === 0 ? 'Reading file…'
      : progress.current === 1 ? ANALYZE_STEPS[stepIdx % ANALYZE_STEPS.length]
      : progress.current === 2 ? 'Parsing rows…' : 'Done!')
    : 'Choose file to import';

  const timeRows: [string, number][] = stats ? [
    ['Total', stats.hours], ['VLOS', stats.byMode.VLOS], ['EVLOS', stats.byMode.EVLOS], ['BVLOS', stats.byMode.BVLOS],
    ['Night', stats.tf.night], ['IFR', stats.tf.ifr], ['FPV / 2nd pilot', stats.tf.fpv], ['Dual', stats.tf.dual], ['Instructor', stats.tf.instr],
  ] : [];

  const stage = progress.current;
  const flightsFound = rows.length;
  const progressLayer = overlay !== 'hidden' ? (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}>
      <BladeProgress
        status={overlay === 'done' ? 'done' : 'busy'}
        safeTop={false}
        eyebrow={overlay === 'done' ? 'IMPORT READY' : 'IMPORTING'}
        title={overlay === 'done' ? (flightsFound === 1 ? '1 flight found' : `${flightsFound} flights found`) : 'Importing your drone log'}
        body={overlay === 'done' ? 'Opening the preview…'
          : stage === 0 ? `Opening ${fileName || 'the file'}.`
            : stage === 1 ? ANALYZE_STEPS[stepIdx % ANALYZE_STEPS.length]
              : stage === 2 ? 'Reading every flight in the file.'
                : 'Checking drones and categories.'}
        steps={[
          { label: 'Read the file', state: overlay === 'done' || stage > 0 ? 'done' : 'active' },
          { label: 'Match the columns', state: overlay === 'done' || stage > 1 ? 'done' : stage === 1 ? 'active' : 'todo' },
          { label: 'Read every flight', state: overlay === 'done' || stage > 2 ? 'done' : stage === 2 ? 'active' : 'todo' },
          { label: 'Check the drones', state: overlay === 'done' ? 'done' : stage === 3 ? 'active' : 'todo' },
        ]}
        progress={stage === 0 ? 0.08 : stage === 1 ? 0.7 : stage === 2 ? 0.85 : 0.95}
        progressMs={stage === 0 ? 1200 : stage === 1 ? 20000 : stage === 2 ? 2500 : 3000}
        startedAt={startedAt.current}
        footnote="Nothing is saved until you approve it."
      />
    </Animated.View>
  ) : null;

  // ── "Before you save": det man kan rätta, en rad per sak (fälls ut), som i pilotläget.
  const afLabel = (a: Airframe | '') => AIRFRAMES.find(([k]) => k === a)?.[1] ?? '';
  const droneRows = droneModels.map((d) => {
    const info = droneData[d.model] ?? { airframe: '' as Airframe | '', cls: d.defaultCat, mtow_g: 0 };
    const missing = [!info.airframe && 'airframe', !info.cls && 'class'].filter(Boolean) as string[];
    const parts = [afLabel(info.airframe), info.mtow_g ? `${info.mtow_g} g` : '', info.cls, `${d.count} ${d.count === 1 ? 'flight' : 'flights'}`].filter(Boolean);
    return { d, info, missing, parts, looking: lookingModels.has(d.model) };
  });
  const droneEditor = (r: typeof droneRows[number]) => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.fieldLabel}>WEIGHT (G)</Text>
          <TextInput
            style={[s.weightInput, { width: '100%', paddingVertical: 9 }]}
            value={r.info.mtow_g ? String(r.info.mtow_g) : ''}
            onChangeText={(v) => setInfo(r.d.model, { mtow_g: parseInt(v.replace(/\D/g, ''), 10) || 0 })}
            keyboardType="number-pad" placeholder="g" placeholderTextColor={DR.muted}
          />
        </View>
        <TouchableOpacity onPress={() => lookupModel(r.d.model, true)} disabled={r.looking} activeOpacity={0.75}
          style={[s.aiBtn, { borderColor: accent + '88', backgroundColor: accent + '1F', paddingVertical: 10 }]}>
          {r.looking ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="sparkles" size={13} color={accent} />}
          <Text style={[s.aiBtnText, { color: accent }]}>{r.looking ? '…' : 'Look up'}</Text>
        </TouchableOpacity>
      </View>
      {r.d.regs.length > 0 && <Text style={s.dataMeta}>{r.d.regs.join(', ')}</Text>}
      {/* Airframe (AI kan sätta) */}
      <View style={s.tgRow}>
        {AIRFRAMES.map(([key, lbl]) => {
          const active = r.info.airframe === key;
          return (
            <TouchableOpacity key={key} style={[s.tgBtn, { flex: 1 }, active && { borderColor: accent, backgroundColor: accent + '22' }]}
              onPress={() => setInfo(r.d.model, { airframe: active ? '' : key })} activeOpacity={0.7}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[s.tgLabel, active && { color: accent }]}>{lbl}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {/* Klass */}
      <View style={[s.tgRow, { flexWrap: 'wrap' }]}>
        {CLASS_OPTS.map((c) => {
          const active = r.info.cls === c;
          return (
            <TouchableOpacity key={c} style={[s.tgChip, active && { borderColor: accent, backgroundColor: accent + '22' }]}
              onPress={() => setInfo(r.d.model, { cls: active ? '' : c })} activeOpacity={0.7}>
              <Text style={[s.tgLabel, active && { color: accent }]}>{c}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );

  const checks: { key: string; status: CheckStatus; render: (first: boolean) => ReactNode }[] = [];
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
  if (droneRows.length > 0) {
    const looking = droneRows.some((r) => r.looking);
    const missing = droneRows.filter((r) => r.missing.length > 0).length;
    const status: CheckStatus = looking ? 'ai' : missing > 0 ? 'todo' : 'done';
    checks.push({
      key: 'drones', status,
      render: (first) => (
        <CheckItem T={T} first={first} icon="hardware-chip-outline" title="Drone details" status={status}
          statusText={looking ? 'LOOKING UP' : missing > 0 ? `${missing} TO CHECK` : ''}
          summary={`${droneRows.length} ${droneRows.length === 1 ? 'drone' : 'drones'}. Airframe fills the multirotor, single-rotor and fixed-wing columns, and class sets the category. Change them later under Manage drones.`}>
          {droneRows.map((r) => (
            <EditRow key={r.d.model} T={T} title={r.d.model} loading={r.looking} open={openModel === r.d.model}
              onPress={() => setOpenModel((o) => (o === r.d.model ? null : r.d.model))}
              summary={r.missing.length ? `Missing ${r.missing.join(' and ')} · ${r.d.count} ${r.d.count === 1 ? 'flight' : 'flights'}` : r.parts.join(' · ')}
              tag={r.missing.length ? 'MISSING' : undefined} tagColor={T.warning}>
              {droneEditor(r)}
            </EditRow>
          ))}
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
    <ScrollView ref={nav.scrollRef} style={{ flex: 1, backgroundColor: DR.background }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (result ? FOOTER_SPACE + 16 : 40), gap: 12 }}>
      {/* Rubrik — bara innan en fil är läst (rapporten har en egen sammanfattning överst) */}
      {!result && (
        <View style={{ gap: 4, marginBottom: 2 }}>
          <Text style={s.title}>Import drone log</Text>
          <Text style={s.subtitle}>Upload an export file from your drone-log app. Claude identifies the format and maps the columns for you.</Text>
        </View>
      )}

      {/* Upload-dropzone (hela kortet är tryckytan) — döljs när en analys visas */}
      {!result && (
        <TouchableOpacity style={[s.uploadCard, { borderColor: accent + '80', backgroundColor: accent + '0D' }, importing && { opacity: 0.85 }]}
          onPress={pick} disabled={importing} activeOpacity={0.9}>
          <View style={[s.uploadIconWrap, { backgroundColor: accent + '1A', borderColor: accent + '33' }]}>
            {importing ? <ActivityIndicator color={accent} size="large" /> : <Ionicons name="cloud-upload-outline" size={32} color={accent} />}
          </View>
          <Text style={s.uploadTitle}>{uploadTitle}</Text>
          {!importing && <Text style={s.uploadSub}>CSV or text export — from any drone-log app</Text>}
        </TouchableOpacity>
      )}

      {/* Hur importen funkar + filformat — visas före filval (och kvar ovanför ett fel) */}
      {!importing && !result && (
        <>
          <HowItWorks steps={HOW_IT_WORKS} accent={accent} />
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>Accepted file formats</Text>
            {ACCEPTED_FORMATS.map((f) => (
              <View key={f.t} style={s.bulletRow}>
                <Ionicons name={f.icon as any} size={15} color={accent} />
                <Text style={s.bulletTerm}>{f.t}</Text>
                <Text style={[s.bulletDesc, { flex: 1 }]}>{f.d}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Importfel — AI:ns förklaring i samma kort som rapportens (i stället för Alert) */}
      {importError && !result && !importing && (
        <AnalysisCard T={T} failed loading={summaryLoading} text={aiSummary || importError} fallback={importError} />
      )}

      {/* Rapporten före Save (components/import/ImportReport, samma som pilotläget): sammanfattningen, AI:ns
          "What we found", det man kan rätta och vad filen innehåller. */}
      {result && (
        <>
          <ReportHero T={T} flights={included}
            time={`${formatTime(stats?.hours ?? 0)}${timeFormat === 'decimal' ? ' h' : ''}`}
            period={periodOf(rows.map((r) => r.date))} fileName={fileName} format={result.detectedFormat}
            coins={result.tokensUsed > 0 ? tokensToCoins(result.tokensUsed) : 0}
            totalRows={result.totalRows} mappedRows={result.mappedRows} toCheck={checks.filter((c) => c.status === 'todo').length} />

          <AnalysisCard T={T} loading={summaryLoading} text={summaryLoading ? null : aiSummary}
            linkIds={new Set(review.groups.map((g) => g.id))} onLink={(id) => nav.go(`review-${id}`)}
            fallback={`The summary isn't available right now. ${result.mappedRows} of ${result.totalRows} rows are ready to import.`} />

          {checks.length > 0 && (
            <>
              <SectionLabel T={T}>BEFORE YOU SAVE</SectionLabel>
              <View onLayout={nav.onGroupLayout}>
                <CheckGroup T={T}>{checks.map((c, i) => <View key={c.key} onLayout={nav.onItemLayout(c.key)}>{c.render(i === 0)}</View>)}</CheckGroup>
              </View>
            </>
          )}

          {stats && (
            <>
              <SectionLabel T={T}>IN THIS FILE</SectionLabel>
              <View style={{ backgroundColor: T.card, borderRadius: 14, borderWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
                <TotalsGrid T={T} items={timeRows.filter(([label, v]) => label === 'Total' || v > 0).map(([label, v]) => ({ label, value: formatTime(v) }))} />
                <ListRow T={T} icon="location-outline" label="Locations" count={stats.locations.length}>
                  {() => stats.locations.map((pl) => (
                    <View key={pl} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="location" size={13} color={DR.muted} />
                      <Text numberOfLines={1} style={{ flex: 1, color: DR.text, fontSize: 13 }}>{pl}</Text>
                    </View>
                  ))}
                </ListRow>
                <ListRow T={T} icon="hardware-chip-outline" label="Drones" count={droneModels.length}>
                  {() => droneModels.map((d) => (
                    <View key={d.model} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="hardware-chip" size={13} color={DR.muted} />
                      <Text style={{ flex: 1, color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{d.model}</Text>
                      <Text style={{ color: DR.text2, fontSize: 12, fontFamily: 'Menlo' }}>{d.count}</Text>
                    </View>
                  ))}
                </ListRow>
              </View>
            </>
          )}

          {/* Kort notis + byt fil (uploadkortet är dolt när en analys visas, så ge en väg tillbaka) */}
          <View style={{ gap: 2, marginTop: 2 }}>
            <Text style={s.hint}>Nothing is saved until you tap Save.</Text>
            <TouchableOpacity style={s.chooseOtherBtn} onPress={pick} disabled={importing || saving} activeOpacity={0.7} hitSlop={10}>
              <Ionicons name="swap-horizontal-outline" size={15} color={DR.text2} />
              <Text style={s.chooseOtherText}>Choose a different file</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
    {result && (
      <SaveFooter T={T} label={`Save ${included.toLocaleString('en-US')} ${included === 1 ? 'flight' : 'flights'}${removeCount ? ` · remove ${removeCount}` : ''}`}
        saving={saving} disabled={included <= 0} onPress={doImport} bottom={insets.bottom} />
    )}
    {progressLayer}
    </>
  );
}

const s = StyleSheet.create({
  title: { color: DR.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: DR.text2, fontSize: 14, lineHeight: 20 },
  uploadCard: { alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed' },
  uploadIconWrap: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  uploadTitle: { color: DR.text, fontSize: 17, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  uploadSub: { color: DR.text2, fontSize: 12.5, textAlign: 'center', lineHeight: 17 },
  infoCard: { backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border, padding: 14, gap: 12 },
  infoTitle: { color: DR.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletTerm: { color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
  bulletDesc: { color: DR.text2, fontSize: 12.5, lineHeight: 17 },
  // AI-analys-kortet (= pilotens)
  aiCard: { backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  aiCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  aiCardTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  aiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  aiLoadingText: { color: DR.muted, fontSize: 13, fontStyle: 'italic' },
  aiReadMore: { fontSize: 12, fontWeight: '700', marginTop: -2 },
  // Resultatraden (= pilotens): format, fil, coins, Rows/Mapped
  resultHeader: { backgroundColor: DR.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: DR.border, flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultFormat: { color: DR.text, fontSize: 15, fontWeight: '700' },
  resultFile: { color: DR.text2, fontSize: 12, marginTop: 2 },
  tokenUsedText: { color: DR.muted, fontSize: 11, fontFamily: 'Menlo', marginTop: 3 },
  statValue: { color: DR.text, fontSize: 16, fontWeight: '800' },
  statLabel: { color: DR.muted, fontSize: 9, textTransform: 'uppercase' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 15, gap: 8, marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: '700' },
  hint: { color: DR.muted, fontSize: 11, textAlign: 'center' },
  chooseOtherBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 6 },
  chooseOtherText: { color: DR.text2, fontSize: 13, fontWeight: '600' },
  // Drone data-sektionen (motsvarar pilotens gyllene "Aircraft data")
  dataSection: { backgroundColor: DR.warning + '14', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: DR.warning + '55', gap: 10 },
  dataHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dataTitle: { color: DR.warning, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  dataSubtitle: { color: DR.text2, fontSize: 11, lineHeight: 16 },
  dataCard: { backgroundColor: DR.surface, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: DR.border, gap: 8 },
  dataModel: { flex: 1, color: DR.text, fontSize: 14, fontWeight: '800' },
  dataMeta: { color: DR.muted, fontSize: 11 },
  fieldLabel: { color: DR.text2, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8 },
  weightInput: { width: 74, color: DR.text, fontSize: 14, fontWeight: '700', fontFamily: 'Menlo', textAlign: 'center', backgroundColor: DR.elevated, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 6, borderWidth: 1, borderColor: DR.border },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#22D3EE88', backgroundColor: '#22D3EE1F' },
  aiBtnText: { fontSize: 12, fontWeight: '800', color: '#67E8F9' },
  tgRow: { flexDirection: 'row', gap: 6 },
  tgBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
  tgChip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
  tgLabel: { color: DR.text2, fontSize: 12, fontWeight: '700' },
});
