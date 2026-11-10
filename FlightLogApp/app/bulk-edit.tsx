// Edit many flights: välj många flygningar, välj en ändring, se före och efter, spara, ångra.
// Öppnas från loggbokens lista (components/bulk/BulkEditEntry) i pilot- och drönarläget (?mode=pilot|drone).
//
//  1. Välj flygningar: sök, filter (villkor, typ, år), "Select all". Överst förslagen ("Check your data":
//     saker i loggboken som ser fel ut, med flygningarna och ändringen redan valda) och de senaste ändringarna
//     med Undo.
//  2. Välj ändring: fyll i en tid, byt ett värde eller räkna om nattiden.
//  3. Förhandsvisning: hur många som ändras, totalerna före och efter, vilka som lämnas och varför, och
//     flygningarna med från → till. Inget sparas före det här steget.
//  4. Klart: med Undo.
// Reglerna (vad som får ändras, vad som hänger ihop) ligger i services/bulkEdit/engine.ts; sparandet och
// ångra i db/bulkEdits.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { FONT_SERIF, FONT_MONO } from '../components/logbook-page/tokens';
import { getFlights, getSetting, setSetting } from '../db/flights';
import { getDroneFlights } from '../db/drones';
import { applyBulkEdit, undoBulkEdit, listBulkEdits, type BulkEditEntry } from '../db/bulkEdits';
import { useFlightStore } from '../store/flightStore';
import { useDroneFlightStore } from '../store/droneFlightStore';
import { useTimeFormatStore } from '../store/timeFormatStore';
import { formatTimeValue } from '../hooks/useTimeFormat';
import { CIVIL_CATEGORIES } from '../constants/droneCategories';
import { recalcNight } from '../services/bulkEdit/night';
import {
  planBulkEdit, protectedReason, nightOf, suggestionsFor, skippedByReason, isTextField, FIELD_LABEL, PILOT_ROLES, DRONE_ROLES,
  type BulkMode, type BulkOp, type BulkPlan, type BulkRow, type BulkSuggestion,
} from '../services/bulkEdit/engine';
import type { Flight } from '../types/flight';

type Step = 'pick' | 'change' | 'preview' | 'done';
interface Choice { id: string; label: string }
interface Action { key: string; group: string; title: string; sub: string; icon: keyof typeof Ionicons.glyphMap; choices: Choice[] }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}` : d || '');
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const tap = () => { Haptics.selectionAsync().catch(() => {}); };
const num = (v: any) => Number(v) || 0;
const SHARES: Choice[] = [{ id: '100', label: 'All of it' }, { id: '75', label: '75%' }, { id: '50', label: '50%' }, { id: '25', label: '25%' }, { id: '0', label: 'Remove it' }];
const WHOLE: Choice[] = [{ id: '100', label: 'The whole flight' }, { id: '0', label: 'Remove it' }];
const DRONE_OPERATION: Record<string, string> = { PRI: 'Private', COM: 'Commercial' };

function actionsFor(mode: BulkMode, rows: BulkRow[]): Action[] {
  if (mode === 'pilot') {
    return [
      { key: 'nvg', group: 'Fill in a time', title: 'NVG time', sub: 'How much of each flight’s night time was with goggles', icon: 'moon-outline', choices: SHARES },
      { key: 'night', group: 'Fill in a time', title: 'Night time', sub: 'How much of each flight was at night', icon: 'cloudy-night-outline', choices: SHARES },
      { key: 'cross_country', group: 'Fill in a time', title: 'Cross-country time', sub: 'Count these flights as cross-country', icon: 'navigate-outline', choices: WHOLE },
      { key: 'pilot_flying', group: 'Fill in a time', title: 'Pilot flying time', sub: 'Count these flights as pilot flying', icon: 'hand-left-outline', choices: WHOLE },
      { key: 'role', group: 'Change a value', title: 'My role', sub: 'The whole flight time goes to the role you pick', icon: 'person-outline', choices: PILOT_ROLES.map((r) => ({ id: r.key, label: r.label })) },
      { key: 'crew', group: 'Change a value', title: 'Single-pilot or multi-pilot', sub: 'Which kind of operation these flights were', icon: 'people-outline', choices: [{ id: 'single', label: 'Single-pilot' }, { id: 'multi', label: 'Multi-pilot' }] },
      { key: 'rules', group: 'Change a value', title: 'Flight rules', sub: 'The whole flight under one set of rules', icon: 'shapes-outline', choices: [{ id: 'VFR', label: 'VFR' }, { id: 'IFR', label: 'IFR' }] },
      { key: 'nightcalc', group: 'Recalculate', title: 'Night time from route and times', sub: 'Blades works out when it was dark along each route', icon: 'calculator-outline', choices: [] },
    ];
  }
  // Kategorier som redan finns i loggboken (t.ex. NATO-klasser) går också att välja.
  const used = [...new Set(rows.map((r) => String(r.category || '').trim()).filter(Boolean))].filter((c) => !(CIVIL_CATEGORIES as readonly string[]).includes(c));
  return [
    { key: 'night', group: 'Fill in a time', title: 'Night time', sub: 'How much of each flight was at night', icon: 'cloudy-night-outline', choices: SHARES },
    { key: 'category', group: 'Change a value', title: 'Category', sub: 'The category these flights were flown in', icon: 'pricetag-outline', choices: [...CIVIL_CATEGORIES, ...used].map((c) => ({ id: c, label: c })) },
    { key: 'flight_mode', group: 'Change a value', title: 'Sight mode', sub: 'The whole flight in one mode', icon: 'eye-outline', choices: ['VLOS', 'EVLOS', 'BVLOS'].map((c) => ({ id: c, label: c })) },
    { key: 'operation', group: 'Change a value', title: 'Private or commercial', sub: 'The Type column in your logbook', icon: 'briefcase-outline', choices: Object.entries(DRONE_OPERATION).map(([id, label]) => ({ id, label })) },
    { key: 'role', group: 'Change a value', title: 'My role', sub: 'The whole flight time goes to the role you pick', icon: 'person-outline', choices: DRONE_ROLES.map((r) => ({ id: r.key, label: r.label })) },
  ];
}

/** Ändringen för motorn och en kort beskrivning (sparas som ändringens namn). */
function buildOp(mode: BulkMode, key: string | null, choice: string | null, nightValues: Record<number, number> | null): { op: BulkOp; label: string } | null {
  if (!key) return null;
  if (key === 'nightcalc') return nightValues ? { op: { kind: 'night', values: nightValues }, label: 'Night time recalculated' } : null;
  if (!choice) return null;
  const share = (field: string, of: string, name: string, base: string) => {
    const pct = Number(choice);
    return { op: { kind: 'fill', field, of, pct } as BulkOp, label: pct === 0 ? `${name} removed` : pct === 100 ? `${name} = ${base}` : `${name} = ${pct}% of ${base}` };
  };
  if (mode === 'pilot') {
    if (key === 'nvg') return share('nvg', 'night', 'NVG time', 'night time');
    if (key === 'night') return share('night', 'total_time', 'Night time', 'flight time');
    if (key === 'cross_country') return share('cross_country', 'total_time', 'Cross-country time', 'flight time');
    if (key === 'pilot_flying') return share('pilot_flying', 'total_time', 'Pilot flying time', 'flight time');
    if (key === 'role') return { op: { kind: 'role', role: choice }, label: `Role → ${PILOT_ROLES.find((r) => r.key === choice)?.label ?? choice}` };
    if (key === 'crew') return { op: { kind: 'crew', multi: choice === 'multi' }, label: choice === 'multi' ? 'Multi-pilot' : 'Single-pilot' };
    if (key === 'rules') return { op: { kind: 'rules', rules: choice === 'IFR' ? 'IFR' : 'VFR' }, label: `Flight rules → ${choice}` };
    return null;
  }
  if (key === 'night') return share('night_time', 'total_time', 'Night time', 'flight time');
  if (key === 'category') return { op: { kind: 'set', field: 'category', value: choice }, label: `Category → ${choice}` };
  if (key === 'flight_mode') return { op: { kind: 'set', field: 'flight_mode', value: choice }, label: `Sight mode → ${choice}` };
  if (key === 'operation') return { op: { kind: 'set', field: 'operation_type', value: choice }, label: DRONE_OPERATION[choice] ?? choice };
  if (key === 'role') return { op: { kind: 'role', role: choice }, label: `Role → ${DRONE_ROLES.find((r) => r.key === choice)?.label ?? choice}` };
  return null;
}

/** Förslagets färdiga ändring → valet på ändringsskärmen. */
function choiceFromSuggestion(s: BulkSuggestion): { key: string; choice: string | null } {
  if (s.op?.kind === 'fill') return { key: s.op.field === 'night_time' ? 'night' : s.op.field, choice: String(s.op.pct) };
  return { key: s.ask ?? '', choice: null };
}

export default function BulkEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: BulkMode = params.mode === 'drone' ? 'drone' : 'pilot';
  const timeFormat = useTimeFormatStore((s) => s.timeFormat);
  const hours = (v: number) => (timeFormat === 'hhmm' ? formatTimeValue(v, 'hhmm') : (Math.round(v * 10) / 10).toFixed(1));

  const [rows, setRows] = useState<BulkRow[] | null>(null);   // flygningarna som går att välja
  const [everything, setEverything] = useState<BulkRow[]>([]);   // alla rader, även summeringsrader (för totalerna)
  const [recent, setRecent] = useState<BulkEditEntry[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('pick');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [conds, setConds] = useState<string[]>([]);
  const [type, setType] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [nightValues, setNightValues] = useState<Record<number, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<{ editId: number; count: number; label: string; plan: BulkPlan; undone?: string } | null>(null);
  const [armed, setArmed] = useState(0);   // ändringen vars Undo väntar på ett andra tryck
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
  const dismissKey = `bulk_dismissed_${mode}`;

  const load = useCallback(async () => {
    const all: BulkRow[] = mode === 'pilot' ? await getFlights(100000) : await getDroneFlights(100000);
    setEverything(all);
    setRows(all.filter((r) => !protectedReason(mode, r)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id));
    setRecent(await listBulkEdits(mode));
  }, [mode]);
  useEffect(() => {
    load().catch(() => setRows([]));
    getSetting(dismissKey).then((raw) => { try { setDismissed(raw ? JSON.parse(raw) : []); } catch { setDismissed([]); } }).catch(() => {});
  }, [load, dismissKey]);
  // Statistiken, listan och boken läser om flygningarna efter en ändring.
  const refreshStores = async () => {
    if (mode === 'pilot') { const st = useFlightStore.getState(); await st.loadFlights(); st.loadStats().catch(() => {}); }
    else { const st = useDroneFlightStore.getState(); await st.loadFlights(); st.loadStats().catch(() => {}); }
  };

  const all = rows ?? [];
  const actions = useMemo(() => actionsFor(mode, all), [mode, all]);
  const suggestions = useMemo(() => suggestionsFor(mode, all).filter((s) => !dismissed.includes(s.id)), [mode, all, dismissed]);

  // ── Filter ──
  const typeOf = (r: BulkRow) => String((mode === 'pilot' ? r.aircraft_type : r.drone_type) || '').trim();
  const condList: [string, string, (r: BulkRow) => boolean][] = mode === 'pilot'
    ? [
      ['night', 'Night', (r) => num(r.night) > 0],
      ['nonvg', 'No NVG', (r) => num(r.nvg) <= 0],
      ['ifr', 'IFR', (r) => num(r.ifr) > 0],
      ['pic', 'PIC', (r) => num(r.pic) > 0],
      ['sic', 'Co-pilot', (r) => num(r.co_pilot) > 0],
      ['dual', 'Dual', (r) => num(r.dual) > 0],
      ['import', 'Imported', (r) => r.source === 'import'],
      ['ocr', 'Scanned', (r) => r.source === 'ocr'],
    ]
    : [
      ['night', 'Night', (r) => nightOf('drone', r) > 0],
      ['vlos', 'VLOS', (r) => r.flight_mode === 'VLOS'],
      ['bvlos', 'BVLOS', (r) => r.flight_mode === 'BVLOS'],
      ['nocat', 'No category', (r) => !String(r.category || '').trim()],
      ['import', 'Imported', (r) => r.source === 'import'],
    ];
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) { const t = typeOf(r); if (t) m.set(t, (m.get(t) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, mode]);
  const years = useMemo(() => [...new Set(all.map((r) => String(r.date || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse(), [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tests = condList.filter(([k]) => conds.includes(k)).map(([, , fn]) => fn);
    return all.filter((r) => {
      if (type && typeOf(r) !== type) return false;
      if (year && String(r.date || '').slice(0, 4) !== year) return false;
      for (const t of tests) if (!t(r)) return false;
      if (q) {
        const hay = (mode === 'pilot'
          ? `${r.dep_place} ${r.arr_place} ${r.dep_place_raw || ''} ${r.arr_place_raw || ''} ${r.aircraft_type} ${r.registration} ${r.date}`
          : `${r.location} ${r.drone_type} ${r.registration} ${r.mission_type} ${r.category} ${r.date}`).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, conds, type, year, mode]);
  const shownSelected = useMemo(() => filtered.reduce((a, r) => a + (selected.has(r.id) ? 1 : 0), 0), [filtered, selected]);
  const allShown = filtered.length > 0 && shownSelected === filtered.length;
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => {
    tap();
    setSelected((s) => { const n = new Set(s); for (const r of filtered) { if (allShown) n.delete(r.id); else n.add(r.id); } return n; });
  };

  // ── Ändringen och planen ──
  const built = useMemo(() => buildOp(mode, actionKey, choice, nightValues), [mode, actionKey, choice, nightValues]);
  const plan = useMemo<BulkPlan | null>(() => (built && step === 'preview' ? planBulkEdit(mode, everything, selected, built.op) : null), [built, step, mode, everything, selected]);
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const rowTitle = (r?: BulkRow) => (!r ? '' : mode === 'pilot'
    ? `${String(r.dep_place_raw || r.dep_place || '?').toUpperCase()} → ${String(r.arr_place_raw || r.arr_place || '?').toUpperCase()}`
    : String(r.location || 'No location'));
  const rowSub = (r: BulkRow) => [typeOf(r), r.registration].filter(Boolean).join(' · ');
  const show = (field: string, v: number | string) => (isTextField(field)
    ? (field === 'operation_type' ? (DRONE_OPERATION[String(v)] ?? (v || 'none')) : field === 'pilot_role' ? (DRONE_ROLES.find((x) => x.key === v)?.label ?? (v || 'none')) : String(v || 'none'))
    : field === 'is_night' ? (num(v) ? 'yes' : 'no') : hours(num(v)));

  const go = (s: Step) => { setError(''); setShowAll(false); setStep(s); };
  const pickAction = (key: string) => { tap(); setActionKey(key); setChoice(null); setNightValues(null); };
  const toPreview = async () => {
    if (actionKey === 'nightcalc') {   // räknas om varje gång: urvalet kan ha ändrats
      setBusy(true);
      try { setNightValues(await recalcNight(all.filter((r) => selected.has(r.id)) as unknown as Flight[])); }
      catch { setError('Could not work out the night time. Try again.'); setBusy(false); return; }
      setBusy(false);
    }
    go('preview');
  };
  const review = (s: BulkSuggestion) => {
    tap();
    const c = choiceFromSuggestion(s);
    setSelected(new Set(s.ids));
    setActionKey(c.key); setChoice(c.choice); setNightValues(null);
    go(c.choice ? 'preview' : 'change');
  };
  const dismiss = (s: BulkSuggestion) => {
    const next = [...dismissed, s.id];
    setDismissed(next);
    setSetting(dismissKey, JSON.stringify(next)).catch(() => {});
  };
  const apply = async () => {
    if (!plan || !built || !plan.changes.length || busy) return;
    setBusy(true); setError('');
    try {
      const editId = await applyBulkEdit(mode, built.label, plan);
      await load();
      await refreshStores();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setResult({ editId, count: plan.changes.length, label: built.label, plan });
      setStep('done');
    } catch (e: any) {
      setError(`Nothing was changed. ${e?.message ?? 'Try again.'}`);
    } finally { setBusy(false); }
  };
  const undo = async (editId: number, fromDone: boolean) => {
    if (busy) return;
    if (armed !== editId) {
      setArmed(editId);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(0), 4000);
      return;
    }
    setArmed(0); setBusy(true); setError('');
    try {
      const r = await undoBulkEdit(editId);
      await load();
      await refreshStores();
      const msg = `${plural(r.flights, 'flight')} ${r.flights === 1 ? 'is' : 'are'} back as ${r.flights === 1 ? 'it was' : 'they were'}.${r.kept ? ` ${plural(r.kept, 'value')} you changed afterwards ${r.kept === 1 ? 'was' : 'were'} left alone.` : ''}`;
      if (fromDone) setResult((x) => (x ? { ...x, undone: msg } : x));
      else setError(msg);
    } catch (e: any) {
      setError(`Could not undo. ${e?.message ?? 'Try again.'}`);
    } finally { setBusy(false); }
  };
  const startOver = () => { setActionKey(null); setChoice(null); setNightValues(null); setResult(null); go('pick'); };

  // ── Topp och botten ──
  const steps: Step[] = ['pick', 'change', 'preview'];
  const stepIdx = steps.indexOf(step);
  const TITLES: Record<Step, string> = { pick: 'Choose flights', change: 'Choose the change', preview: 'Check before you save', done: 'Done' };
  const back = () => { if (step === 'change') go('pick'); else if (step === 'preview') go(actionKey && actions.some((a) => a.key === actionKey) ? 'change' : 'pick'); else router.back(); };
  const nSel = selected.size;
  let cta: { label: string; onPress: () => void; disabled: boolean };
  if (step === 'pick') cta = { label: nSel ? `Choose what to change · ${nSel.toLocaleString('en-US')}` : 'Select flights first', onPress: () => go('change'), disabled: !nSel };
  else if (step === 'change') cta = { label: built || actionKey === 'nightcalc' ? 'See what changes' : 'Choose a change', onPress: toPreview, disabled: busy || !(built || actionKey === 'nightcalc') };
  else if (step === 'preview') cta = { label: plan?.changes.length ? `Change ${plural(plan.changes.length, 'flight')}` : 'Nothing to change', onPress: apply, disabled: busy || !plan?.changes.length };
  else cta = { label: 'Done', onPress: () => router.back(), disabled: busy };

  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={() => { tap(); onPress(); }} activeOpacity={0.8} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  const pickHeader = (
    <View style={{ gap: 16, paddingBottom: 6 }}>
      {suggestions.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={s.eyebrow}>CHECK YOUR DATA</Text>
          {suggestions.map((sg) => (
            <View key={sg.id} style={s.card}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={s.sgIcon}><Ionicons name={sg.icon as any} size={18} color={Colors.warning} /></View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.cardTitle}>{sg.title}</Text>
                  <Text style={s.cardSub}>{sg.body}</Text>
                </View>
              </View>
              <View style={s.sgActions}>
                <TouchableOpacity onPress={() => dismiss(sg)} hitSlop={8} accessibilityRole="button"><Text style={s.linkMuted}>{sg.dismissLabel}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => review(sg)} style={s.smallBtn} accessibilityRole="button"><Text style={s.smallBtnText}>Review</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
      {recent.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={s.eyebrow}>RECENT CHANGES</Text>
          <View style={s.card0}>
            {recent.map((e, i) => (
              <View key={e.id} style={[s.recentRow, i > 0 && s.sep]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{e.label}</Text>
                  <Text style={s.cardSub}>{plural(e.flight_count, 'flight')} · {shortDate(String(e.created_at || '').slice(0, 10))}</Text>
                </View>
                <TouchableOpacity onPress={() => undo(e.id, false)} disabled={busy} hitSlop={8} accessibilityRole="button">
                  <Text style={[s.link, armed === e.id && { color: Colors.warning }]}>{armed === e.id ? 'Tap again to undo' : 'Undo'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      )}
      {!!error && <Text style={s.note}>{error}</Text>}
      <View style={{ gap: 10 }}>
        <Text style={s.eyebrow}>FLIGHTS</Text>
        <View style={s.search}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={mode === 'pilot' ? 'Search airport, aircraft, date…' : 'Search site, drone, date…'} placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters" autoCorrect={false} style={s.searchInput} accessibilityLabel="Search flights" />
          {query ? <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close" size={15} color={Colors.textMuted} /></TouchableOpacity> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {condList.map(([k, label]) => chip(k, label, conds.includes(k), () => setConds((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))))}
        </ScrollView>
        {types.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {types.map((t) => chip(`t-${t}`, t, type === t, () => setType(type === t ? null : t)))}
          </ScrollView>
        )}
        {years.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {years.map((y) => chip(`y-${y}`, y, year === y, () => setYear(year === y ? null : y)))}
          </ScrollView>
        )}
      </View>
      <TouchableOpacity onPress={toggleAll} disabled={!filtered.length} activeOpacity={0.8} style={s.allRow} accessibilityRole="checkbox" accessibilityState={{ checked: allShown }}>
        <Check on={allShown} />
        <Text style={s.allText}>{allShown ? `All ${filtered.length.toLocaleString('en-US')} selected` : `Select all ${filtered.length.toLocaleString('en-US')}`}</Text>
        <Text style={s.mono}>{nSel.toLocaleString('en-US')} of {all.length.toLocaleString('en-US')}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top + 6 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.top}>
        <View style={s.topRow}>
          {step !== 'done' ? (
            <TouchableOpacity onPress={back} style={s.backBtn} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={Colors.primary} />
            </TouchableOpacity>
          ) : <View style={{ width: 40 }} />}
          <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <Text style={s.topTitle}>Edit many flights</Text>
            <Text style={s.topStep}>{stepIdx >= 0 ? `STEP ${stepIdx + 1} OF 3 · ${TITLES[step].toUpperCase()}` : 'DONE'}</Text>
          </View>
          <TouchableOpacity onPress={() => router.back()} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {stepIdx >= 0 && (
          <View style={s.progress}>
            {steps.map((x, i) => <View key={x} style={[s.progressSeg, { backgroundColor: i <= stepIdx ? Colors.primary : Colors.cardBorder }]} />)}
          </View>
        )}
      </View>

      {rows === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={Colors.primary} /></View>
      ) : step === 'pick' ? (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.id)}
          ListHeaderComponent={pickHeader}
          ListEmptyComponent={<Text style={[s.cardSub, { textAlign: 'center', paddingVertical: 30 }]}>{all.length ? 'No flights match these filters.' : 'There are no flights to edit yet.'}</Text>}
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14} maxToRenderPerBatch={20} windowSize={9}
          extraData={selected}
          renderItem={({ item: r }) => {
            const on = selected.has(r.id);
            const night = nightOf(mode, r);
            return (
              <TouchableOpacity onPress={() => toggle(r.id)} activeOpacity={0.75} style={[s.row, on && s.rowOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                accessibilityLabel={`${shortDate(r.date)} ${rowTitle(r)}`}>
                <Check on={on} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{rowTitle(r)}</Text>
                  <Text style={s.rowSub} numberOfLines={1}>{[shortDate(r.date), rowSub(r)].filter(Boolean).join(' · ')}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={s.rowHours}>{hours(num(r.total_time))}</Text>
                  <Text style={s.rowTags} numberOfLines={1}>
                    {mode === 'pilot'
                      ? [night > 0 && `N ${hours(night)}`, num(r.nvg) > 0 && `NVG ${hours(num(r.nvg))}`].filter(Boolean).join(' · ')
                      : [r.category, r.flight_mode, night > 0 && `N ${hours(night)}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* ═══ 2 · Välj ändring ═══ */}
          {step === 'change' && (
            <View style={{ gap: 18 }}>
              <Head title={`What should change on ${plural(nSel, 'flight')}?`} lead="Pick one change. You see every flight before and after on the next step, and nothing is saved until then." />
              {[...new Set(actions.map((a) => a.group))].map((group) => (
                <View key={group} style={{ gap: 10 }}>
                  <Text style={s.eyebrow}>{group.toUpperCase()}</Text>
                  {actions.filter((a) => a.group === group).map((a) => {
                    const on = actionKey === a.key;
                    return (
                      <View key={a.key} style={[s.card0, on && s.cardOn]}>
                        <TouchableOpacity onPress={() => pickAction(a.key)} activeOpacity={0.8} style={s.actionRow} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                          <View style={s.actionIcon}><Ionicons name={a.icon} size={18} color={Colors.primary} /></View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={s.cardTitle}>{a.title}</Text>
                            <Text style={s.cardSub}>{a.sub}</Text>
                          </View>
                          <Radio on={on} />
                        </TouchableOpacity>
                        {on && a.choices.length > 0 && (
                          <View style={s.choices} accessibilityRole="radiogroup">
                            {a.choices.map((c) => chip(`${a.key}-${c.id}`, c.label, choice === c.id, () => setChoice(c.id)))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
              {!!error && <Text style={s.note}>{error}</Text>}
            </View>
          )}

          {/* ═══ 3 · Före och efter ═══ */}
          {step === 'preview' && plan && built && (
            <View style={{ gap: 18 }}>
              <Head title={plan.changes.length ? `${plural(plan.changes.length, 'flight')} will change` : 'Nothing to change'}
                lead={plan.changes.length ? `${built.label}. Nothing is saved until you tap the button below, and you can undo it afterwards.` : 'None of the flights you selected need this change. Go back to pick other flights or another change.'} />
              {plan.totals.length > 0 && (
                <View style={s.card0}>
                  <View style={s.totHead}><Text style={[s.eyebrow, { color: Colors.primary, flex: 1 }]}>TOTAL IN YOUR LOGBOOK</Text><Text style={s.eyebrow}>BEFORE → AFTER</Text></View>
                  {plan.totals.map((t, i) => (
                    <View key={t.field} style={[s.totRow, i > 0 && s.sep]}>
                      <Text style={[s.cardTitle, { flex: 1 }]}>{t.label}</Text>
                      <Text style={s.totBefore}>{hours(t.before)}</Text>
                      <Ionicons name="arrow-forward" size={13} color={Colors.textMuted} />
                      <Text style={s.totAfter}>{hours(t.after)}</Text>
                    </View>
                  ))}
                </View>
              )}
              {(plan.skipped.length > 0 || plan.unchanged > 0) && (
                <View style={s.card}>
                  <Text style={s.cardTitle}>{plural(plan.skipped.length + plan.unchanged, 'flight')} left as {plan.skipped.length + plan.unchanged === 1 ? 'it is' : 'they are'}</Text>
                  <View style={{ gap: 4, marginTop: 6 }}>
                    {plan.unchanged > 0 && <Text style={s.cardSub}>{plan.unchanged.toLocaleString('en-US')} · Already {plan.unchanged === 1 ? 'has' : 'have'} this value</Text>}
                    {skippedByReason(plan.skipped).map((g) => <Text key={g.reason} style={s.cardSub}>{g.count.toLocaleString('en-US')} · {g.reason}</Text>)}
                  </View>
                </View>
              )}
              {plan.changes.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={s.eyebrow}>EVERY FLIGHT THAT CHANGES</Text>
                  <View style={s.card0}>
                    {(showAll ? plan.changes.slice(0, 400) : plan.changes.slice(0, 25)).map((c, i) => {
                      const r = byId.get(c.id);
                      return (
                        <View key={c.id} style={[s.chRow, i > 0 && s.sep]}>
                          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                            <Text style={s.rowTitle} numberOfLines={1}>{rowTitle(r)}</Text>
                            <Text style={s.rowSub} numberOfLines={1}>{shortDate(r?.date)}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 2 }}>
                            {Object.entries(c.fields).filter(([f]) => f !== 'is_night').slice(0, 4).map(([f, ch]) => (
                              <Text key={f} style={s.chField}>{FIELD_LABEL[f] ?? f} <Text style={s.chFrom}>{show(f, ch.from)}</Text> → <Text style={s.chTo}>{show(f, ch.to)}</Text></Text>
                            ))}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  {plan.changes.length > 25 && !showAll && (
                    <TouchableOpacity onPress={() => setShowAll(true)} style={{ alignSelf: 'center', padding: 6 }} accessibilityRole="button">
                      <Text style={s.link}>Show {plural(Math.min(400, plan.changes.length) - 25, 'more flight')}</Text>
                    </TouchableOpacity>
                  )}
                  {showAll && plan.changes.length > 400 && <Text style={[s.cardSub, { textAlign: 'center' }]}>And {plural(plan.changes.length - 400, 'more flight')} with the same change.</Text>}
                </View>
              )}
              {!!error && <Text style={s.note}>{error}</Text>}
            </View>
          )}

          {/* ═══ 4 · Klart ═══ */}
          {step === 'done' && result && (
            <View style={{ gap: 20, paddingTop: 12 }}>
              <View style={[s.doneIcon, result.undone ? { backgroundColor: Colors.card, borderColor: Colors.cardBorder } : null]}>
                <Ionicons name={result.undone ? 'arrow-undo' : 'checkmark'} size={30} color={result.undone ? Colors.textSecondary : Colors.success} />
              </View>
              <Head title={result.undone ? 'Change undone' : `${plural(result.count, 'flight')} updated`}
                lead={result.undone ?? `${result.label}. Your statistics and your digital logbook use the new values.`} />
              {!result.undone && result.plan.totals.length > 0 && (
                <View style={s.card0}>
                  {result.plan.totals.map((t, i) => (
                    <View key={t.field} style={[s.totRow, i > 0 && s.sep]}>
                      <Text style={[s.cardTitle, { flex: 1 }]}>{t.label}</Text>
                      <Text style={s.totBefore}>{hours(t.before)}</Text>
                      <Ionicons name="arrow-forward" size={13} color={Colors.textMuted} />
                      <Text style={s.totAfter}>{hours(t.after)}</Text>
                    </View>
                  ))}
                </View>
              )}
              {!!error && <Text style={s.note}>{error}</Text>}
              <View style={{ gap: 4, alignItems: 'center' }}>
                <TouchableOpacity onPress={startOver} style={s.cta2} accessibilityRole="button"><Text style={s.cta2Text}>Change something else</Text></TouchableOpacity>
                {!result.undone && result.editId > 0 && (
                  <TouchableOpacity onPress={() => undo(result.editId, true)} disabled={busy} style={s.cta2} accessibilityRole="button">
                    <Text style={[s.cta2Text, { color: armed === result.editId ? Colors.warning : Colors.textSecondary }]}>{armed === result.editId ? 'Tap again to undo' : 'Undo this change'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      <View style={[s.foot, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[s.cta, cta.disabled && s.ctaOff]} onPress={cta.onPress} disabled={cta.disabled} activeOpacity={0.85} accessibilityRole="button">
          {busy ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={[s.ctaText, cta.disabled && { color: Colors.textSecondary }]}>{cta.label}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Head({ title, lead }: { title: string; lead: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.h1} accessibilityRole="header">{title}</Text>
      <Text style={s.lead}>{lead}</Text>
    </View>
  );
}
function Check({ on }: { on: boolean }) {
  return (
    <View style={[s.check, on && s.checkOn]}>
      {on && <Ionicons name="checkmark" size={15} color={Colors.textInverse} />}
    </View>
  );
}
function Radio({ on }: { on: boolean }) {
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? Colors.primary : '#3A5F85', alignItems: 'center', justifyContent: 'center' }}>
      {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary }} />}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  top: { borderBottomWidth: 1, borderBottomColor: '#13263F' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  closeBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: Colors.textPrimary, fontSize: 15.5, fontWeight: '700' },
  topStep: { fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#6B8DB0' },
  progress: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, paddingBottom: 12 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2 },
  body: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 28 },

  h1: { fontFamily: FONT_SERIF, fontSize: 27, lineHeight: 32, fontWeight: '600', color: Colors.textPrimary },
  lead: { fontSize: 14.5, lineHeight: 21, color: '#A9C3DB' },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#6B8DB0' },
  mono: { fontFamily: FONT_MONO, fontSize: 11.5, color: '#8FB0CC' },
  note: { fontSize: 13, lineHeight: 18, color: Colors.warning },
  link: { color: Colors.primary, fontSize: 13.5, fontWeight: '700' },
  linkMuted: { color: '#8FB0CC', fontSize: 13, fontWeight: '600' },

  card: { borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14 },
  card0: { borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  cardOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '14' },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: Colors.textPrimary },
  cardSub: { fontSize: 12.5, lineHeight: 17, color: '#8FB0CC' },
  sep: { borderTopWidth: 1, borderTopColor: '#16304D' },
  sgIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.warning + '1F', borderWidth: 1, borderColor: Colors.warning + '59', alignItems: 'center', justifyContent: 'center' },
  sgActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.cardBorder },
  smallBtn: { height: 36, paddingHorizontal: 18, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '800' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },

  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 11, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 14, padding: 0 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 999, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  chipText: { fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: '#A9C3DB' },
  chipTextOn: { color: Colors.textInverse },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#0D1B33', borderWidth: 1, borderColor: Colors.cardBorder },
  allText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: Colors.textPrimary },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#3A5F85', alignItems: 'center', justifyContent: 'center' },
  checkOn: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 6, borderRadius: 12, borderWidth: 1, borderColor: '#16304D', backgroundColor: Colors.card },
  rowOn: { borderColor: Colors.primary + '99', backgroundColor: Colors.primary + '14' },
  rowTitle: { fontFamily: FONT_MONO, fontSize: 13.5, fontWeight: '700', letterSpacing: 0.3, color: Colors.textPrimary },
  rowSub: { fontSize: 12, color: '#8FB0CC' },
  rowHours: { fontFamily: FONT_MONO, fontSize: 13.5, fontWeight: '700', color: Colors.textPrimary },
  rowTags: { fontFamily: FONT_MONO, fontSize: 10.5, color: '#8FB0CC' },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  actionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '1A', alignItems: 'center', justifyContent: 'center' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },

  totHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, backgroundColor: '#0D1B33' },
  totRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  totBefore: { fontFamily: FONT_MONO, fontSize: 14, color: '#8FB0CC' },
  totAfter: { fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: Colors.textPrimary, minWidth: 56, textAlign: 'right' },
  chRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  chField: { fontFamily: FONT_MONO, fontSize: 11.5, color: '#8FB0CC' },
  chFrom: { color: '#8FB0CC' },
  chTo: { color: Colors.textPrimary, fontWeight: '700' },
  doneIcon: { width: 64, height: 64, borderRadius: 18, backgroundColor: Colors.success + '1A', borderWidth: 1, borderColor: Colors.success + '59', alignItems: 'center', justifyContent: 'center' },

  foot: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#13263F', backgroundColor: Colors.background },
  cta: { height: 52, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: '#16304D' },
  ctaText: { color: Colors.textInverse, fontSize: 16.5, fontWeight: '800' },
  cta2: { height: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  cta2Text: { color: Colors.primary, fontSize: 14.5, fontWeight: '700' },
});
