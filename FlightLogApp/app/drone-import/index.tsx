// "Import CSV" (drönare) — samma utseende och flöde som pilotens Import: Hero + upload-dropzone → filval →
// laddskärmen med Blade-myntet (BladeProgress) under AI-kolumnmappningen → resultatrad (format, fil, coins,
// rader) + kollapsbar AI-analys → "inside data"-summering + "Drone data" (inline-editor per modell, AI sätter
// airframe/vikt/klass) → Save all (source='import') + registrering + berikning.
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
function toAirframe(t: string): Airframe | '' {
  if (t === 'multirotor') return 'multirotor';
  if (t === 'helicopter') return 'helicopter';
  if (t === 'fixedwing' || t === 'vtol') return 'fixedwing';
  return '';
}

function renderBold(text: string, accent: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <Text key={i} style={{ fontWeight: '800', color: accent }}>{p.slice(2, -2)}</Text>
      : <Text key={i}>{p}</Text>);
}

export default function DroneImportCsvScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const { formatTime } = useTimeFormat();
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
  const [openLocations, setOpenLocations] = useState(false);
  const [openDrones, setOpenDrones] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false); // kollapsad AI-analys som standard (= piloten)

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
    const hours = rows.reduce((s, r) => s + r.total_time, 0);
    const byMode = { VLOS: 0, EVLOS: 0, BVLOS: 0 } as Record<string, number>;
    const tf = { night: 0, ifr: 0, fpv: 0, dual: 0, instr: 0 };
    let night = 0;
    const locations = new Set<string>();
    const dates: string[] = [];
    for (const r of rows) {
      if (r.h_vlos + r.h_evlos + r.h_bvlos > 0) { byMode.VLOS += r.h_vlos; byMode.EVLOS += r.h_evlos; byMode.BVLOS += r.h_bvlos; }
      else byMode[r.flight_mode] = (byMode[r.flight_mode] || 0) + r.total_time;
      tf.night += r.night_time; tf.ifr += r.ifr; tf.fpv += r.co_pilot_fpv; tf.dual += r.dual; tf.instr += r.instructor;
      if (r.is_night) night++;
      if (r.location) locations.add(r.location);
      if (r.date) dates.push(r.date);
    }
    dates.sort();
    return { hours, byMode, tf, night, locations: [...locations], dateRange: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '' };
  }, [rows]);

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

  const fetchSummary = async (r: DroneImportResult | null, fname: string, error?: string) => {
    setSummaryLoading(true);
    try {
      const txt = await generateDroneImportSummary({
        fileName: fname,
        detectedFormat: r?.detectedFormat,
        totalRows: r?.totalRows,
        parsedFlights: r?.mappedRows,
        totalHours: r ? Math.round(r.rows.reduce((s, x) => s + x.total_time, 0) * 10) / 10 : undefined,
        drones: r ? [...new Set(r.rows.map((x) => x.drone_type).filter(Boolean))] : undefined,
        categories: r ? [...new Set(r.rows.map((x) => x.category).filter(Boolean))] : undefined,
        warnings: r?.warnings,
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
    setImporting(true); setImportError(null); setResult(null); setAiSummary(''); setDroneData({}); setSummaryExpanded(false);
    lookedUpRef.current = new Set(); setLookingModels(new Set());
    setProgress({ current: 0, total: 3 });
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    startedAt.current = Date.now();
    overlayFade.setValue(1);
    setOverlay('busy');
    try {
      const r = await importDroneFromFile(file.uri, (current, total) => setProgress({ current, total }));
      setResult(r); setImporting(false);
      finishOverlay();
      fetchSummary(r, file.name);
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
      const rowsToSave: ParsedDroneRow[] = rows.map((r) => {
        const info = droneData[r.drone_type];
        return info?.cls ? { ...r, category: info.cls } : r;
      });
      const infoByModel: Record<string, { airframe?: string; mtow_g?: number; category?: string }> = {};
      for (const [model, info] of Object.entries(droneData)) infoByModel[model] = { airframe: info.airframe || '', mtow_g: info.mtow_g || 0, category: info.cls || '' };

      const n = await saveDroneImport(rowsToSave);
      await registerImportedDrones(rowsToSave, infoByModel); // registrera flottan FÖRE navigering (syns direkt)
      await Promise.all([loadFlights(), loadStats()]);
      show?.(`Imported ${n} ${n === 1 ? 'flight' : 'flights'}`);
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
    ['Night', stats.tf.night], ['IFR', stats.tf.ifr], ['Co-pilot / FPV', stats.tf.fpv], ['Dual', stats.tf.dual], ['Instructor', stats.tf.instr],
  ] : [];

  const stage = progress.current;
  const flightsFound = rows.length;
  const analysisCount = aiSummary.split('\n').filter((l) => l.trim()).length;
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

  return (
    <>
    <ScrollView style={{ flex: 1, backgroundColor: DR.background }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{ gap: 4, marginBottom: 2 }}>
        <Text style={s.title}>Import drone log</Text>
        <Text style={s.subtitle}>Upload an export file from your drone-log app. Claude identifies the format and maps the columns for you.</Text>
      </View>

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

      {/* Importfel — inline-kort med AI-förklaring (i stället för Alert) */}
      {importError && !result && !importing && (
        <View style={[s.aiCard, { borderColor: DR.danger + '55' }]}>
          <View style={s.aiCardHeader}>
            <Ionicons name="alert-circle" size={15} color={DR.danger} />
            <Text style={[s.aiCardTitle, { color: DR.danger }]}>Import failed</Text>
          </View>
          {summaryLoading ? (
            <View style={s.aiLoadingRow}>
              <ActivityIndicator size="small" color={DR.danger} />
              <Text style={s.aiLoadingText}>Analyzing imported data…</Text>
            </View>
          ) : <AnalysisList text={aiSummary || importError} accent={accent} />}
        </View>
      )}

      {/* Förhandsvisning */}
      {result && (
        <>
          <View style={s.resultHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.resultFormat}>{result.detectedFormat}</Text>
              <Text style={s.resultFile} numberOfLines={1}>{fileName}</Text>
              {result.tokensUsed > 0 && (
                <Text style={s.tokenUsedText}>{tokensToCoins(result.tokensUsed).toLocaleString('en-US')} Blade-coins used for import</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <StatPill label="Rows" value={String(result.totalRows)} />
              <StatPill label="Mapped" value={String(result.mappedRows)} color={DR.success} />
            </View>
          </View>

          {/* AI-analys — kollapsbar fritextsammanfattning (2 rader syns, tryck för allt) */}
          <TouchableOpacity style={[s.aiCard, { borderColor: accent + '33' }]} onPress={() => setSummaryExpanded((v) => !v)} activeOpacity={0.8}
            disabled={summaryLoading || !aiSummary || analysisCount <= 2}>
            <View style={s.aiCardHeader}>
              <Ionicons name="sparkles" size={14} color={accent} />
              <Text style={[s.aiCardTitle, { color: accent }]}>Import analysis</Text>
              {!summaryLoading && !!aiSummary && analysisCount > 2 && (
                <Ionicons name={summaryExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={DR.muted} style={{ marginLeft: 'auto' }} />
              )}
            </View>
            {summaryLoading ? (
              <View style={s.aiLoadingRow}>
                <ActivityIndicator size="small" color={accent} />
                <Text style={s.aiLoadingText}>Analyzing imported data…</Text>
              </View>
            ) : aiSummary ? (
              <>
                <AnalysisList text={aiSummary} accent={accent} max={summaryExpanded ? undefined : 2} />
                {!summaryExpanded && analysisCount > 2 && <Text style={[s.aiReadMore, { color: accent }]}>Read more</Text>}
              </>
            ) : (
              <Text style={s.aiLoadingText}>Detected {result.detectedFormat} · {result.mappedRows}/{result.totalRows} rows mapped.</Text>
            )}
          </TouchableOpacity>

          {/* Vad filen innehåller — samma presentation som pilotens Import ("inside data") */}
          {stats && (
            <View style={{ backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: accent + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="document-attach-outline" size={18} color={accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: DR.text, fontSize: 14, fontWeight: '700' }}>{rows.length} {rows.length === 1 ? 'flight' : 'flights'} · {formatTime(stats.hours)}</Text>
                  {!!stats.dateRange && <Text style={{ color: DR.muted, fontSize: 11.5, marginTop: 2 }}>{stats.dateRange}</Text>}
                </View>
              </View>

              {/* Kategoriserad tid (bara > 0 utom Total) */}
              <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
                {timeRows.filter(([label, v]) => label === 'Total' || v > 0).map(([label, v]) => (
                  <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ color: DR.text2, fontSize: 13 }}>{label}</Text>
                    <Text style={{ color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{formatTime(v)}</Text>
                  </View>
                ))}
              </View>

              {/* Locations — expanderbar */}
              <TouchableOpacity onPress={() => setOpenLocations((v) => !v)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: DR.separator }}>
                <Ionicons name="location-outline" size={15} color={accent} />
                <Text style={{ flex: 1, color: DR.text2, fontSize: 13 }}>Locations</Text>
                <Text style={{ color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{stats.locations.length}</Text>
                <Ionicons name={openLocations ? 'chevron-up' : 'chevron-down'} size={15} color={DR.muted} />
              </TouchableOpacity>
              {openLocations && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {stats.locations.length === 0 ? <Text style={{ color: DR.muted, fontSize: 12 }}>None</Text>
                    : stats.locations.map((p) => (
                      <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="location" size={13} color={DR.muted} />
                        <Text numberOfLines={1} style={{ flex: 1, color: DR.text, fontSize: 13 }}>{p}</Text>
                      </View>
                    ))}
                </View>
              )}

              {/* Drones — expanderbar */}
              <TouchableOpacity onPress={() => setOpenDrones((v) => !v)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: DR.separator }}>
                <Ionicons name="hardware-chip-outline" size={15} color={accent} />
                <Text style={{ flex: 1, color: DR.text2, fontSize: 13 }}>Drones</Text>
                <Text style={{ color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{droneModels.length}</Text>
                <Ionicons name={openDrones ? 'chevron-up' : 'chevron-down'} size={15} color={DR.muted} />
              </TouchableOpacity>
              {openDrones && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {droneModels.length === 0 ? <Text style={{ color: DR.muted, fontSize: 12 }}>None</Text>
                    : droneModels.map((d) => (
                      <View key={d.model} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="hardware-chip" size={13} color={DR.muted} />
                        <Text style={{ flex: 1, color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{d.model}</Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          )}

          {/* Drone data — inline-editor per modell (motsvarar pilotens "Aircraft data"). */}
          {droneModels.length > 0 && (
            <View style={s.dataSection}>
              <View style={s.dataHeader}>
                <Ionicons name="hardware-chip-outline" size={14} color={DR.warning} />
                <Text style={s.dataTitle}>Drone data</Text>
              </View>
              <Text style={s.dataSubtitle}>Airframe fills the multi/single/fixed columns in your logbook. Use look-up to let AI set airframe, weight and class. You can edit this later under Manage drones.</Text>
              {droneModels.map((d) => {
                const info = droneData[d.model] ?? { airframe: '', cls: d.defaultCat, mtow_g: 0 };
                const looking = lookingModels.has(d.model);
                return (
                  <View key={d.model} style={s.dataCard}>
                    {/* Modell + vikt + smart search */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={s.dataModel} numberOfLines={1}>{d.model}</Text>
                      <TextInput
                        style={s.weightInput}
                        value={info.mtow_g ? String(info.mtow_g) : ''}
                        onChangeText={(v) => setInfo(d.model, { mtow_g: parseInt(v.replace(/\D/g, ''), 10) || 0 })}
                        keyboardType="number-pad" placeholder="g" placeholderTextColor={DR.muted}
                      />
                      <TouchableOpacity onPress={() => lookupModel(d.model, true)} disabled={looking} activeOpacity={0.75} style={[s.aiBtn, { borderColor: accent + '88', backgroundColor: accent + '1F' }]}>
                        {looking ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="sparkles" size={13} color={accent} />}
                        <Text style={[s.aiBtnText, { color: accent }]}>{looking ? '…' : 'Look up'}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={s.dataMeta}>{d.count} {d.count === 1 ? 'flight' : 'flights'}{d.regs.length ? ` · ${d.regs.join(', ')}` : ''}</Text>

                    {/* Airframe (AI kan sätta) */}
                    <View style={s.tgRow}>
                      {AIRFRAMES.map(([key, lbl]) => {
                        const active = info.airframe === key;
                        return (
                          <TouchableOpacity key={key} style={[s.tgBtn, { flex: 1 }, active && { borderColor: accent, backgroundColor: accent + '22' }]}
                            onPress={() => setInfo(d.model, { airframe: active ? '' : key })} activeOpacity={0.7}>
                            <Text numberOfLines={1} adjustsFontSizeToFit style={[s.tgLabel, active && { color: accent }]}>{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Klass */}
                    <View style={[s.tgRow, { flexWrap: 'wrap' }]}>
                      {CLASS_OPTS.map((c) => {
                        const active = info.cls === c;
                        return (
                          <TouchableOpacity key={c} style={[s.tgChip, active && { borderColor: accent, backgroundColor: accent + '22' }]}
                            onPress={() => setInfo(d.model, { cls: active ? '' : c })} activeOpacity={0.7}>
                            <Text style={[s.tgLabel, active && { color: accent }]}>{c}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {result.warnings.map((w, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Ionicons name="warning-outline" size={14} color={DR.warning} style={{ marginTop: 1 }} />
              <Text style={{ color: DR.warning, fontSize: 12, flex: 1, lineHeight: 17 }}>{w}</Text>
            </View>
          ))}

          {rows.length > 0 && (
            <TouchableOpacity onPress={doImport} disabled={saving} activeOpacity={0.8}
              style={[s.saveBtn, { backgroundColor: accent }, saving && { opacity: 0.6 }]}>
              {saving ? <ActivityIndicator color={DR.inkOnAccent} /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={DR.inkOnAccent} />
                  <Text style={[s.saveBtnText, { color: DR.inkOnAccent }]}>Save all ({rows.length})</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <Text style={s.hint}>All imported data is saved with source "import" and can be reviewed under Imported data.</Text>

          {/* Byt fil — uploadkortet är dolt när en analys visas, så ge en väg tillbaka */}
          <TouchableOpacity style={s.chooseOtherBtn} onPress={pick} disabled={importing || saving} activeOpacity={0.7}>
            <Ionicons name="swap-horizontal-outline" size={15} color={DR.text2} />
            <Text style={s.chooseOtherText}>Choose a different file</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
    {progressLayer}
    </>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[s.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function AnalysisList({ text, accent, max }: { text: string; accent: string; max?: number }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, max);
  return (
    <View style={{ gap: 6 }}>
      {lines.map((line, i) => {
        const body = line.replace(/^-\s*/, '');
        const isFix = /^fix:/i.test(body);
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Ionicons name={isFix ? 'construct-outline' : 'ellipse'} size={isFix ? 13 : 6} color={isFix ? accent : DR.muted} style={{ marginTop: isFix ? 2 : 6 }} />
            <Text style={{ color: DR.text2, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{renderBold(body, accent)}</Text>
          </View>
        );
      })}
    </View>
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
  chooseOtherBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, marginTop: 2 },
  chooseOtherText: { color: DR.text2, fontSize: 13, fontWeight: '600' },
  // Drone data-sektionen (motsvarar pilotens gyllene "Aircraft data")
  dataSection: { backgroundColor: DR.warning + '14', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: DR.warning + '55', gap: 10 },
  dataHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dataTitle: { color: DR.warning, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  dataSubtitle: { color: DR.text2, fontSize: 11, lineHeight: 16 },
  dataCard: { backgroundColor: DR.surface, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: DR.border, gap: 8 },
  dataModel: { flex: 1, color: DR.text, fontSize: 14, fontWeight: '800' },
  dataMeta: { color: DR.muted, fontSize: 11 },
  weightInput: { width: 74, color: DR.text, fontSize: 14, fontWeight: '700', fontFamily: 'Menlo', textAlign: 'center', backgroundColor: DR.elevated, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 6, borderWidth: 1, borderColor: DR.border },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#22D3EE88', backgroundColor: '#22D3EE1F' },
  aiBtnText: { fontSize: 12, fontWeight: '800', color: '#67E8F9' },
  tgRow: { flexDirection: 'row', gap: 6 },
  tgBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
  tgChip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
  tgLabel: { color: DR.text2, fontSize: 12, fontWeight: '700' },
});
