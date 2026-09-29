// "Import CSV" (drönare) — speglar pilotens import-UI men drönaranpassad: Hero + upload-dropzone
// med progress → AI-kolumnmappning → analysis summary (AI) → "inside data"-summering + "Drone data"
// (inline-editor per modell, AI sätter airframe/vikt/klass) → import (source='import') + registrering
// + berikning. Layouten motsvarar pilotens Import (samma summering + Aircraft data-sektion).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useToastStore } from '../../components/Toast';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { lookupDrone } from '../../services/droneLookup';
import { hasTokenQuota } from '../../utils/tokenGate';
import { CIVIL_CATEGORIES, MILITARY_TOP_LEVEL, categoryFromCClass } from '../../constants/droneCategories';
import {
  pickAndImportDroneCsv, saveDroneImport, generateDroneImportSummary, registerAndEnrichImportedDrones,
  type DroneImportResult, type ParsedDroneRow,
} from '../../services/droneImport';

const HOW_IT_WORKS = [
  { n: '1', t: 'Export & choose file', d: 'Export your drone log as CSV — including a file exported from this app — and choose it above.' },
  { n: '2', t: 'AI maps your columns', d: 'Claude identifies the format and maps date, drone, category, mode, flight time and night. Only a small sample of rows is sent — every flight is parsed locally on your device.' },
  { n: '3', t: 'Review before saving', d: 'You get a full preview with statistics and an AI analysis. Nothing is saved until you approve.' },
];
const ACCEPTED_FORMATS = [
  { icon: 'document-text-outline', t: '.csv', d: 'comma, semicolon, tab or pipe separated' },
  { icon: 'document-outline', t: '.txt', d: 'plain-text exports' },
];
const ANALYZE_STEPS = ['Identifying your log format…', 'Mapping the columns…', 'Detecting date & time formats…'];

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
  const [lookingModel, setLookingModel] = useState<string | null>(null);
  const [openLocations, setOpenLocations] = useState(false);
  const [openDrones, setOpenDrones] = useState(false);

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
      byMode[r.flight_mode] = (byMode[r.flight_mode] || 0) + r.total_time;
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

  const lookupModel = async (model: string) => {
    if (!hasTokenQuota()) { show?.('Out of Blade-coins for look-ups'); return; }
    setLookingModel(model);
    try {
      const r = await lookupDrone(model);
      if (r.needs_manual || !r.model) { show?.('Could not identify that drone'); return; }
      const af = toAirframe(r.drone_type);
      const guessed = categoryFromCClass(r.c_class);
      setInfo(model, { ...(af ? { airframe: af } : {}), ...(r.mtow_g > 0 ? { mtow_g: r.mtow_g } : {}), ...(guessed ? { cls: guessed } : {}) });
    } catch { show?.('Look-up failed'); }
    finally { setLookingModel(null); }
  };

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
    setImporting(true); setImportError(null); setResult(null); setAiSummary(''); setDroneData({});
    setProgress({ current: 0, total: 3 });
    const rot = setInterval(() => setStepIdx((i) => i + 1), 2000);
    try {
      const r = await pickAndImportDroneCsv((current, total) => setProgress({ current, total }));
      clearInterval(rot);
      if (!r) { setImporting(false); return; }
      setFileName(r.fileName); setResult(r.result); setImporting(false);
      fetchSummary(r.result, r.fileName);
    } catch (e: any) {
      clearInterval(rot);
      setImporting(false);
      const msg = e?.message ?? 'Import failed.';
      setImportError(msg);
      fetchSummary(null, fileName || 'file', msg);
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
      await Promise.all([loadFlights(), loadStats()]);
      registerAndEnrichImportedDrones(rowsToSave, infoByModel).then(() => loadFlights()).catch(() => {});
      show?.(`Imported ${n} ${n === 1 ? 'flight' : 'flights'}`);
      router.replace('/drone-import/history');
    } catch (e: any) {
      setSaving(false);
      setImportError(e?.message ?? 'Could not save the flights.');
    }
  };

  const uploadTitle = importing
    ? (progress.current === 0 ? 'Reading file…'
      : progress.current === 1 ? ANALYZE_STEPS[stepIdx % ANALYZE_STEPS.length]
      : progress.current === 2 ? 'Parsing rows…' : 'Done!')
    : 'Choose file';

  const timeRows: [string, number][] = stats ? [
    ['Total', stats.hours], ['VLOS', stats.byMode.VLOS], ['EVLOS', stats.byMode.EVLOS], ['BVLOS', stats.byMode.BVLOS],
    ['Night', stats.tf.night], ['IFR', stats.tf.ifr], ['Co-pilot / FPV', stats.tf.fpv], ['Dual', stats.tf.dual], ['Instructor', stats.tf.instr],
  ] : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: DR.background }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{ gap: 4, marginBottom: 2 }}>
        <Text style={s.title}>Import drone log</Text>
        <Text style={s.subtitle}>Bring your flights in from a CSV file.</Text>
      </View>

      {/* Upload-dropzone */}
      {!result && (
        <TouchableOpacity style={[s.uploadCard, importing && { opacity: 0.85 }]} onPress={pick} disabled={importing} activeOpacity={0.9}>
          <View style={[s.uploadIconWrap, { backgroundColor: accent + '18' }]}>
            {importing ? <ActivityIndicator color={accent} size="large" /> : <Ionicons name="cloud-upload-outline" size={32} color={accent} />}
          </View>
          <Text style={s.uploadTitle}>{uploadTitle}</Text>
          {!importing && <Text style={s.uploadSub}>CSV or text export — from any drone-log app</Text>}
        </TouchableOpacity>
      )}

      {/* Intro — visas före filval */}
      {!importing && !result && !importError && (
        <>
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>How it works</Text>
            {HOW_IT_WORKS.map((step) => (
              <View key={step.n} style={s.stepRow}>
                <View style={[s.stepBubble, { backgroundColor: accent + '22' }]}><Text style={[s.stepNum, { color: accent }]}>{step.n}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.stepTitle}>{step.t}</Text>
                  <Text style={s.stepDesc}>{step.d}</Text>
                </View>
              </View>
            ))}
          </View>
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

      {/* Importfel */}
      {importError && !result && !importing && (
        <View style={[s.infoCard, { borderColor: DR.danger + '55' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="alert-circle" size={16} color={DR.danger} />
            <Text style={{ color: DR.danger, fontSize: 14, fontWeight: '800' }}>Import failed</Text>
          </View>
          {summaryLoading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={DR.danger} /><Text style={{ color: DR.text2, fontSize: 12 }}>Analyzing…</Text>
            </View>
          ) : <AnalysisList text={aiSummary || importError} accent={accent} />}
          <TouchableOpacity onPress={pick} activeOpacity={0.85} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: accent + '55' }}>
            <Ionicons name="swap-horizontal-outline" size={16} color={accent} /><Text style={{ color: accent, fontWeight: '800', fontSize: 13 }}>Try another file</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Förhandsvisning */}
      {result && (
        <>
          <TouchableOpacity onPress={pick} disabled={saving} activeOpacity={0.85}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: accent + '55', backgroundColor: accent + '18' }}>
            <Ionicons name="swap-horizontal-outline" size={17} color={accent} />
            <Text style={{ color: accent, fontSize: 14, fontWeight: '800' }}>Choose a different file</Text>
          </TouchableOpacity>

          {/* AI-analys */}
          <View style={s.infoCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sparkles-outline" size={15} color={accent} />
              <Text style={s.infoTitle}>Import analysis</Text>
            </View>
            {summaryLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={accent} /><Text style={{ color: DR.text2, fontSize: 12 }}>Analyzing imported data…</Text>
              </View>
            ) : aiSummary ? <AnalysisList text={aiSummary} accent={accent} /> : (
              <Text style={{ color: DR.muted, fontSize: 12.5 }}>Detected {result.detectedFormat} · {result.mappedRows}/{result.totalRows} rows mapped.</Text>
            )}
          </View>

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
                const looking = lookingModel === d.model;
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
                      <TouchableOpacity onPress={() => lookupModel(d.model)} disabled={looking} activeOpacity={0.75} style={[s.aiBtn, { borderColor: accent + '88', backgroundColor: accent + '1F' }]}>
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
            <TouchableOpacity onPress={doImport} disabled={saving} activeOpacity={0.85}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 15, backgroundColor: accent, opacity: saving ? 0.6 : 1 }}>
              {saving ? <ActivityIndicator color={DR.inkOnAccent} /> : <Ionicons name="cloud-upload-outline" size={18} color={DR.inkOnAccent} />}
              <Text style={{ color: DR.inkOnAccent, fontSize: 15, fontWeight: '800' }}>{saving ? 'Importing…' : `Import ${rows.length} ${rows.length === 1 ? 'flight' : 'flights'}`}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

function AnalysisList({ text, accent }: { text: string; accent: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
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
  uploadCard: { alignItems: 'center', gap: 10, paddingVertical: 30, paddingHorizontal: 16, backgroundColor: DR.surface, borderRadius: 16, borderWidth: 1.5, borderColor: DR.border, borderStyle: 'dashed' },
  uploadIconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  uploadTitle: { color: DR.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  uploadSub: { color: DR.muted, fontSize: 12.5, textAlign: 'center' },
  infoCard: { backgroundColor: DR.surface, borderRadius: 14, borderWidth: 1, borderColor: DR.border, padding: 14, gap: 12 },
  infoTitle: { color: DR.text, fontSize: 15, fontWeight: '800' },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepBubble: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepNum: { fontSize: 13, fontWeight: '800' },
  stepTitle: { color: DR.text, fontSize: 13.5, fontWeight: '700' },
  stepDesc: { color: DR.text2, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletTerm: { color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo', width: 78 },
  bulletDesc: { color: DR.text2, fontSize: 12.5 },
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
