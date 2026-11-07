// Guidad uppsättning av den första digitala loggboken (pilotläget). Ersätter formuläret i BookSetupSheet när
// boken skapas: en fråga per skärm.
//  1. Vilken loggbok (mallarna som kort med kolumnerna i miniatyr; ögat visar en sida med egna flygningar)
//  2. Var den senaste flygningen står i pappersboken: sida + rad (tryck på raden). Inte inskriven än → välj
//     en tidigare flygning; de nyare blir "Write next". Bokens storlek (rader, första/sista sida) är hopfälld.
//  3. Tidigare loggböcker: bara när flygningarna före raden inte får plats i boken → fler böcker av samma
//     sort (ankar-styrda, services/logbook/books.ts) eller äldre timmar som Brought forward.
//  4. Totalerna mot pappersbokens Total to date. Skiljer något: Blades har för lite → Backfill missing hours
//     direkt här; för mycket → Imported data (dubbletter); eller pappersbokens siffra för den här boken
//     (opening_balance-override).
//  5. Uppslaget som det kommer att se ut (riktiga sidan, svep till högersidan) och en sammanfattning.
// Lämnar man flödet (Imported data, egen loggbok) sparas läget och flödet öppnas igen på samma steg.
// Redigering, fler böcker och drönarläget använder fortfarande BookSetupSheet.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert, useWindowDimensions, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { FONT_SERIF, FONT_MONO } from '../logbook-page/tokens';
import { LOGBOOK_TEMPLATES, getTemplate, type LogbookTemplate, type LogbookColumn } from '../../constants/logbookTemplates';
import { getCustomTemplates } from '../../db/customTemplates';
import { getScannedTemplateId } from '../../services/logbook/bookFromScan';
import { useLogbookSetupStore } from '../../store/logbookSetupStore';
import { useFlightStore } from '../../store/flightStore';
import { numericColumns, sortFlightsChrono, buildBookSpreads, computeBroughtForward, type ColumnTotals, type LogbookSpread } from '../../services/logbook/paginate';
import { assignFlightsToBooks, resolveOpeningBalance } from '../../services/logbook/books';
import { planBooks } from '../../services/logbook/setupPlan';
import { createDigitalBook, listDigitalBooks, type DigitalBook } from '../../db/digitalBooks';
import { getBackfill, setBackfill, PREV_EXP_REMARK, type BackfillValues } from '../../db/backfill';
import { parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import { SpreadWebView } from './SpreadWebView';
import type { Flight } from '../../types/flight';

type Step = 'intro' | 'layout' | 'latest' | 'earlier' | 'totals' | 'ready';
type Sheet = 'preview' | 'flights' | 'backfill' | null;

// Läget när man lämnar flödet (Imported data, egen loggbok); återställs när det öppnas igen.
interface Draft {
  step: Step; templateId: string; rows: number; firstPage: string; lastPage: string;
  anchorEdited: boolean; page: string; row: number; back: number;
  earlierChoice: 'books' | 'bf' | null; earlierLast: string;
  totalsMode: 'ask' | 'diff'; paper: Record<string, string>; overrides: Record<string, number>;
}
let draft: Draft | null = null;

// Bokens kolumn → fältet i Backfill missing hours (db/backfill). Saknas = rättas i Backfill-verktyget.
const BF_KEY: Record<string, keyof BackfillValues> = {
  tt_total: 'total', total_time: 'total', pic: 'pic', co_pilot: 'co_pilot', dual: 'dual', instructor: 'instructor',
  ifr: 'ifr', night: 'night', multi_pilot: 'multi_pilot', cross_country: 'cross_country',
  landings_day: 'landings_day', landings_night: 'landings_night', fstd: 'sim',
};

const DESC: Record<string, string> = {
  'easa-pilot-logbook': 'EASA layout for private and student pilots',
  'easa-professional-pilot': 'Multi-pilot, single- and multi-engine time',
  'easa-amc1-fcl050': 'The layout in the EASA rules',
  'faa-61-51': 'US layout with cross-country and instrument',
};

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}` : d || '');
const longDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${dayMon(d)} ${d.slice(0, 4)}` : d || '');
const route = (f: Flight) => `${(f.dep_place || '?').toUpperCase()} → ${(f.arr_place || '?').toUpperCase()}`;
const isBookRow = (f: Flight) => (f as any).flight_type !== 'summary' && (f as any).remarks !== '[BACKFILL]';
const tap = () => { Haptics.selectionAsync().catch(() => {}); };

export function BookSetupFlow({ flights, timeFormat, pilotName, onClose, onSaved }: {
  flights: Flight[];
  timeFormat: 'decimal' | 'hhmm';
  pilotName: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const loadFlights = useFlightStore((s) => s.loadFlights);
  const [init] = useState<Draft | null>(() => { const d = draft; draft = null; return d; });
  // Tillbaka från Imported data (Backfill, dubbletter): läs om flygningarna så att totalerna stämmer direkt.
  useEffect(() => { if (init) loadFlights().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mallar (våra + egna; formatet från skanningen först och förvalt) ──
  const [custom, setCustom] = useState<LogbookTemplate[]>([]);
  const [scannedId, setScannedId] = useState<string | null>(null);
  useEffect(() => {
    getCustomTemplates().then(setCustom).catch(() => {});
    getScannedTemplateId().then(setScannedId).catch(() => {});
  }, []);
  const templates = useMemo(() => {
    const all = [...custom.filter((c) => c.id === scannedId), ...LOGBOOK_TEMPLATES, ...custom.filter((c) => c.id !== scannedId)];
    return all.filter((t) => !t.id.includes('drone') && t.id !== 'sv-easa-standard');
  }, [custom, scannedId]);

  const [step, setStep] = useState<Step>(init?.step ?? 'intro');
  const [templateId, setTemplateId] = useState(init?.templateId ?? 'easa-pilot-logbook');
  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? getTemplate(templateId), [templates, templateId]);
  const [rows, setRows] = useState(init?.rows ?? template.rows_per_spread);
  const picked = useRef(!!init);
  const chooseTemplate = (id: string) => {
    picked.current = true;
    setTemplateId(id);
    setRows((templates.find((t) => t.id === id) ?? getTemplate(id)).rows_per_spread);
  };
  useEffect(() => {
    if (picked.current || !scannedId || !custom.some((c) => c.id === scannedId)) return;
    picked.current = true;
    setTemplateId(scannedId);
    setRows((custom.find((c) => c.id === scannedId) as LogbookTemplate).rows_per_spread);
  }, [scannedId, custom]);

  const [firstPage, setFirstPage] = useState(init?.firstPage ?? '1');
  const [lastPage, setLastPage] = useState(init?.lastPage ?? '');
  const [anchorEdited, setAnchorEdited] = useState(init?.anchorEdited ?? false);
  const [page, setPage] = useState(init?.page ?? '');
  const [row, setRow] = useState(init?.row ?? 1);
  const [back, setBack] = useState(init?.back ?? 0);            // nyare flygningar som inte står i pappersboken än
  const [sizeOpen, setSizeOpen] = useState(false);
  const [earlierChoice, setEarlierChoice] = useState<'books' | 'bf' | null>(init?.earlierChoice ?? null);
  const [earlierLast, setEarlierLast] = useState(init?.earlierLast ?? '');
  const [totalsMode, setTotalsMode] = useState<'ask' | 'diff'>(init?.totalsMode ?? 'ask');
  const [paper, setPaper] = useState<Record<string, string>>(init?.paper ?? {});
  const [overrides, setOverrides] = useState<Record<string, number>>(init?.overrides ?? {});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetKey, setSheetKey] = useState('');
  const [previewId, setPreviewId] = useState(templateId);
  const [flightPick, setFlightPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  };

  // Lämna flödet (Imported data, egen loggbok): läget sparas och flödet öppnas igen när man kommer tillbaka.
  const leaveTo = (path: string) => {
    draft = { step, templateId, rows, firstPage, lastPage, anchorEdited, page: String(pageNum), row: rowNum, back, earlierChoice, earlierLast, totalsMode, paper, overrides };
    useLogbookSetupStore.getState().requestReopen();
    onClose();
    router.push(path as any);
  };

  // ── Flygningarna i boken och var den senaste står ──
  const bookFlights = useMemo(() => sortFlightsChrono(flights.filter(isBookRow)), [flights]);
  const anchorPos = Math.max(-1, bookFlights.length - 1 - back);
  const anchor = anchorPos >= 0 ? bookFlights[anchorPos] : null;
  const fp = Math.max(1, parseInt(firstPage, 10) || 1);
  const lp = parseInt(lastPage, 10) || 0;
  const rs = Math.max(4, Math.min(30, rows));
  // Förslag tills man själv ändrar: alla flygningar från första sidan.
  const suggest = useMemo(() => {
    const pos = Math.max(1, anchorPos + 1);
    return { page: fp + (Math.ceil(pos / rs) - 1) * 2, row: ((pos - 1) % rs) + 1 };
  }, [anchorPos, fp, rs]);
  const pageNum = anchorEdited ? Math.max(fp, parseInt(page, 10) || fp) : suggest.page;
  const rowNum = Math.max(1, Math.min(rs, anchorEdited ? row : suggest.row));
  const eLast = Math.max(fp + 1, parseInt(earlierLast, 10) || lp || 100);
  // Bokplanen (services/logbook/setupPlan): uppslaget, plats före flygningen, tidigare böcker.
  const { leftPage, room, earlier, books: plan } = useMemo(() => planBooks({
    bookFlightIds: bookFlights.map((f) => f.id), anchorPos, firstPage: fp, lastPage: lp, rowsPerSpread: rs,
    page: pageNum, row: rowNum, earlierChoice, earlierLastPage: eLast,
  }), [bookFlights, anchorPos, fp, lp, rs, pageNum, rowNum, earlierChoice, eLast]);
  const written = anchorPos + 1;
  const editAnchor = (p: number, r: number) => { setAnchorEdited(true); setPage(String(Math.max(fp, p))); setRow(r); };

  const steps: Step[] = ['layout', 'latest', ...(earlier > 0 ? ['earlier' as Step] : []), ...(anchor ? ['totals' as Step] : []), 'ready'];
  const stepIdx = steps.indexOf(step);
  const go = (s: Step) => { setSheet(null); setStep(s); };
  const next = () => { if (step === 'intro') return go('layout'); if (stepIdx >= 0 && stepIdx < steps.length - 1) go(steps[stepIdx + 1]); };
  const prev = () => { if (step === 'layout') return go('intro'); if (stepIdx > 0) go(steps[stepIdx - 1]); };

  // Böckerna som de skulle se ut (förhandsvisningen och den ingående balansen räknas på dem innan de skapas).
  const fakeBooks = (ob: ColumnTotals): DigitalBook[] => plan.map((b, i) => ({
    id: i + 1, name: `${ordinal(i + 1)} Logbook`, template_id: templateId, starting_page: b.startingPage, rows_per_spread: rs,
    end_page: b.endPage, end_row: 0, is_active: i === plan.length - 1 ? 1 : 0, created_at: '', kind: 'digital',
    opening_balance: i === plan.length - 1 ? JSON.stringify(ob) : '{}', custom_cols: '{}',
    anchor_flight_id: b.anchorFlightId, anchor_page: b.anchorPage, anchor_row: b.anchorRow, display_order: i, acked_spread: 0,
  }));

  // ── Totalerna fram till och med flygningen (som pappersbokens Total to date på samma uppslag) ──
  const cols = useMemo(() => numericColumns(template), [template]);
  const totals = useMemo<ColumnTotals>(() => {
    if (!anchor) return {};
    const all = sortFlightsChrono(flights.filter((f) => !((f as any).flight_type === 'sim' && (f as any).remarks === '[BACKFILL]')));
    const i = all.findIndex((f) => f.id === anchor.id);
    const nextFlight = i >= 0 ? all[i + 1] : undefined;
    return nextFlight ? computeBroughtForward(flights, template, nextFlight.id) : computeBroughtForward(flights, template, 0, undefined, { noAnchorBase: 'all' });
  }, [flights, template, anchor]);
  const isInt = (c: LogbookColumn) => c.format === 'int';
  const fmt = (c: LogbookColumn, v: number) => (isInt(c) ? String(Math.round(v)) : timeFormat === 'hhmm' ? formatTimeValue(v, 'hhmm') : (Math.round(v * 10) / 10).toFixed(1));
  const unit = (c: LogbookColumn) => (isInt(c) ? '' : timeFormat === 'decimal' ? ' h' : '');
  const parsePaper = (c: LogbookColumn, raw: string): number | null => {
    const t = raw.trim().replace(',', '.');
    if (!t) return null;
    if (isInt(c)) { const n = parseInt(t, 10); return isNaN(n) ? null : n; }
    const v = /:/.test(t) ? parseTimeInput(t, 'hhmm') : parseFloat(t);
    return v == null || isNaN(v) ? null : v;
  };
  const diffMode = totalsMode === 'diff';
  const trows = cols.map((c) => {
    const key = c.flightKey!;
    const blades = totals[key] ?? 0;
    const raw = paper[key];
    const pv = raw != null ? parsePaper(c, raw) : null;
    const tol = isInt(c) ? 0.5 : timeFormat === 'hhmm' ? 0.01 : 0.05;
    const status: 'plain' | 'untouched' | 'match' | 'short' | 'more' | 'paper' = !diffMode ? 'plain'
      : overrides[key] !== undefined ? 'paper'
      : pv == null ? 'untouched'
      : Math.abs(pv - blades) < tol ? 'match'
      : pv > blades ? 'short' : 'more';
    return { c, key, blades, pv, raw, status, diff: pv == null ? 0 : Math.abs(pv - blades) };
  });
  const unresolved = trows.filter((t) => t.status === 'short' || t.status === 'more');
  const usingPaper = trows.filter((t) => t.status === 'paper');
  const withOverrides = (auto: ColumnTotals): ColumnTotals => {
    const ob = { ...auto };
    for (const [k, v] of Object.entries(overrides)) ob[k] = (auto[k] ?? 0) + (v - (totals[k] ?? 0));
    return ob;
  };

  // Var timmarna kommer ifrån (fram till flygningen).
  const sources = useMemo(() => {
    if (!anchor) return [];
    const all = sortFlightsChrono(flights);
    const i = all.findIndex((f) => f.id === anchor.id);
    const upTo = i >= 0 ? all.slice(0, i + 1) : all;
    const acc: Record<string, { label: string; n: number; h: number; color: string; unit: string }> = {
      import: { label: 'CSV import', n: 0, h: 0, color: Colors.primary, unit: 'flight' },
      ocr: { label: 'Logbook scan', n: 0, h: 0, color: '#7B8CFF', unit: 'flight' },
      manual: { label: 'Logged in Blades', n: 0, h: 0, color: Colors.success, unit: 'flight' },
      summary: { label: 'Totals you entered', n: 0, h: 0, color: '#B98CFF', unit: 'row' },
      prev: { label: 'Previous experience', n: 0, h: 0, color: Colors.warning, unit: '' },
    };
    for (const f of upTo) {
      const k = (f as any).remarks === PREV_EXP_REMARK ? 'prev' : (f as any).flight_type === 'summary' ? 'summary'
        : (f as any).source === 'import' ? 'import' : (f as any).source === 'ocr' ? 'ocr' : 'manual';
      acc[k].n += 1; acc[k].h += Number(f.total_time) || 0;
    }
    return Object.values(acc).filter((s) => s.n > 0);
  }, [flights, anchor]);

  // ── Förhandsvisningen: uppslaget med flygningen, precis som boken ritas ──
  const readySpread = useMemo<LogbookSpread | null>(() => {
    if (step !== 'ready') return null;
    const books = fakeBooks({});
    const cur = books[books.length - 1];
    const slice = assignFlightsToBooks(books, flights).find((s) => s.book.id === cur.id);
    const auto = resolveOpeningBalance(cur, books, flights, template);
    const ob = Object.keys(overrides).length ? withOverrides(auto) : auto;
    const spreads = buildBookSpreads(slice?.flights ?? [], template, { startingPage: fp, rowsPerSpread: rs, openingBalance: ob, leadingEmptyRows: slice?.leadingEmptyRows ?? 0 });
    return (anchor && spreads.find((s) => s.flights.some((f) => f.id === anchor.id))) || spreads[spreads.length - 1] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, plan, flights, template, overrides, fp, rs, anchor]);
  const previewTpl = templates.find((t) => t.id === previewId) ?? template;
  const previewSpread = useMemo<LogbookSpread | null>(() => {
    if (sheet !== 'preview') return null;
    const cfg = { startingPage: 1, rowsPerSpread: previewTpl.rows_per_spread, openingBalance: {}, leadingEmptyRows: 0 };
    const sp = buildBookSpreads(bookFlights.length ? flights.filter(isBookRow) : [], previewTpl, cfg);
    return sp[sp.length - 1] ?? null;
  }, [sheet, previewTpl, flights, bookFlights.length]);

  // ── Skapa ──
  const create = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const existing = await listDigitalBooks('digital');
      const base = existing.length;
      const books = fakeBooks({});
      const cur = books[books.length - 1];
      const ob = Object.keys(overrides).length ? withOverrides(resolveOpeningBalance(cur, books, flights, template)) : {};
      for (let i = 0; i < plan.length; i++) {
        const b = plan[i];
        await createDigitalBook({
          name: `${ordinal(base + i + 1)} Logbook`, templateId, startingPage: b.startingPage, rowsPerSpread: rs, endPage: b.endPage,
          anchorFlightId: b.anchorFlightId, anchorPage: b.anchorPage, anchorRow: b.anchorRow,
          openingBalance: i === plan.length - 1 ? ob : {}, customCols: {},
        }, 'digital');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await onSaved();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Could not create the logbook', e?.message ?? 'Try again.');
    }
  };

  // ── Backfill missing hours direkt i flödet ──
  const sheetRow = trows.find((t) => t.key === sheetKey);
  const bfAmount = sheetRow ? `${isInt(sheetRow.c) ? Math.round(sheetRow.diff) : fmt(sheetRow.c, sheetRow.diff)}${unit(sheetRow.c)}` : '';
  const colName = (c: LogbookColumn) => (c.group ? `${c.group} · ${c.label}` : c.label);
  const applyBackfill = async () => {
    const t = sheetRow;
    const bk = t ? BF_KEY[t.key] : undefined;
    if (!t || !bk || t.diff <= 0 || busy) return;
    setBusy(true);
    try {
      const cur = await getBackfill();
      const add = isInt(t.c) ? Math.round(t.diff) : Math.round(t.diff * 100) / 100;
      await setBackfill({ ...cur, [bk]: Math.round(((Number(cur[bk]) || 0) + add) * 100) / 100 });
      await loadFlights();
      setSheet(null);
      flash(`Added ${bfAmount} as previous experience.`);
    } catch (e: any) {
      Alert.alert('Could not add the hours', e?.message ?? 'Try again.');
    } finally { setBusy(false); }
  };

  // ── Huvudknappen ──
  let cta = { label: 'Continue', onPress: next, disabled: false };
  let cta2: { label: string; onPress: () => void } | null = null;
  let footNote = '';
  if (step === 'intro') cta = { ...cta, label: 'Start' };
  if (step === 'earlier' && !earlierChoice) cta = { ...cta, label: 'Choose where they are', disabled: true };
  if (step === 'totals' && !diffMode) {
    cta = { ...cta, label: 'Yes, they all match' };
    cta2 = { label: 'Something is different', onPress: () => { tap(); setTotalsMode('diff'); } };
  }
  if (step === 'totals' && diffMode && unresolved.length) footNote = `${unresolved.length} ${unresolved.length === 1 ? 'total still differs' : 'totals still differ'}. You can go on and fix it later.`;
  if (step === 'ready') cta = { label: plan.length > 1 ? `Create ${plan.length} logbooks` : 'Create logbook', onPress: create, disabled: saving };

  const TITLES: Record<Step, string> = { intro: '', layout: 'Which logbook', latest: 'Latest flight', earlier: 'Older flights', totals: 'Totals', ready: 'Check and create' };
  const contentW = winW - 32;

  return (
    <View style={[StyleSheet.absoluteFill, s.root]}>
      {/* Topp: tillbaka, rubrik + steg, stäng, stegmätare */}
      <View style={[s.top, { paddingTop: insets.top + 6 }]}>
        <View style={s.topRow}>
          {step !== 'intro' ? (
            <TouchableOpacity onPress={prev} style={s.backBtn} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={Colors.primary} />
            </TouchableOpacity>
          ) : <View style={{ width: 40 }} />}
          <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <Text style={s.topTitle}>New logbook</Text>
            <Text style={s.topStep}>{stepIdx >= 0 ? `STEP ${stepIdx + 1} OF ${steps.length} · ${TITLES[step].toUpperCase()}` : 'BEFORE YOU START'}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close without creating a logbook">
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {stepIdx >= 0 && (
          <View style={s.progress}>
            {steps.map((x, i) => <View key={x} style={[s.progressSeg, { backgroundColor: i <= stepIdx ? Colors.primary : Colors.cardBorder }]} />)}
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
        {/* ═══ Före start ═══ */}
        {step === 'intro' && (
          <View style={{ gap: 22 }}>
            <View style={s.introIcon}><Ionicons name="book-outline" size={30} color={Colors.primary} /></View>
            <View style={{ gap: 10 }}>
              <Text style={s.h1Big}>Let’s set up your digital logbook</Text>
              <Text style={s.lead}>Blades lays out your flights page by page, exactly like your paper logbook, and works out every total for you.</Text>
            </View>
            <View style={s.noteCard}>
              <View style={s.noteIcon}><Ionicons name="book" size={17} color={Colors.warning} /></View>
              <Text style={s.noteText}>Have your paper logbook ready, open at your latest flight. It takes about a minute.</Text>
            </View>
            <View>
              <Text style={s.eyebrow}>WHAT YOU’LL DO</Text>
              {[
                ['Pick the logbook you have', 'So every page has the same columns as your paper book.'],
                ['Show where your latest flight is', 'Page and row, so the pages line up.'],
                ['Check that the totals match', 'Blades helps you fix anything that’s off.'],
              ].map(([t, b], i) => (
                <View key={t} style={s.introStep}>
                  <View style={s.introNum}><Text style={s.introNumText}>{i + 1}</Text></View>
                  <View style={{ flex: 1, gap: 2, paddingTop: 2 }}>
                    <Text style={s.introStepTitle}>{t}</Text>
                    <Text style={s.introStepBody}>{b}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ═══ 1 · Vilken loggbok ═══ */}
        {step === 'layout' && (
          <View style={{ gap: 18 }}>
            <Head title="Which logbook do you have?" lead="Pick the one with the same columns as your paper book. Tap the eye to see a page with your own flights." />
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              {templates.map((t) => {
                const on = t.id === templateId;
                const scanned = t.id === scannedId;
                return (
                  <View key={t.id} style={[s.choice, on && s.choiceOn]}>
                    <TouchableOpacity style={s.choiceMain} onPress={() => { tap(); chooseTemplate(t.id); }} activeOpacity={0.8}
                      accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t.name}>
                      <Thumb tpl={t} />
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={s.choiceTitle}>{t.name}</Text>
                          {scanned && <View style={s.badge}><Text style={s.badgeText}>FROM YOUR SCAN</Text></View>}
                        </View>
                        <Text style={s.choiceSub}>{scanned ? 'The same columns as the paper logbook you scanned' : DESC[t.id] ?? 'Your own layout'} · {t.rows_per_spread} rows</Text>
                      </View>
                      <Radio on={on} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.eyeBtn} onPress={() => { setPreviewId(t.id); setSheet('preview'); }} accessibilityRole="button" accessibilityLabel={`Preview ${t.name}`}>
                      <Ionicons name="eye-outline" size={19} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity style={s.customCard} onPress={() => leaveTo('/logbook/create-custom')} activeOpacity={0.85} accessibilityRole="button">
              <View style={s.customIcon}><Ionicons name="camera-outline" size={19} color={Colors.primary} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.customTitle}>Yours isn’t here?</Text>
                <Text style={s.choiceSub}>Take a photo of one page. Blades reads the columns and makes a matching layout.</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ═══ 2 · Var står flygningen i pappersboken ═══ */}
        {step === 'latest' && (
          <View style={{ gap: 18 }}>
            {anchor ? (
              <>
                <Head title="Where is this flight in your paper book?" lead="Blades lines up every page with your paper book from here." />
                <View style={s.card}>
                  <Text style={[s.eyebrow, { paddingBottom: 8 }]}>{back === 0 ? 'YOUR LATEST FLIGHT IN BLADES' : 'LAST FLIGHT IN YOUR PAPER BOOK'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <View style={{ width: 44, alignItems: 'center' }}>
                      <Text style={s.dateDay}>{Number(anchor.date.slice(8, 10)) || '?'}</Text>
                      <Text style={s.dateMon}>{/^\d{4}-\d{2}/.test(anchor.date) ? `${MON[Number(anchor.date.slice(5, 7)) - 1].toUpperCase()} ${anchor.date.slice(2, 4)}` : ''}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text style={s.anchorRoute} numberOfLines={1}>{route(anchor)}</Text>
                      <Text style={s.anchorSub} numberOfLines={1}>{[anchor.aircraft_type, anchor.registration, `${fmtH(anchor.total_time, timeFormat)}${timeFormat === 'decimal' ? ' h' : ''}`].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={s.cardLink} onPress={() => { setFlightPick(back); setSheet('flights'); }} accessibilityRole="button">
                    <Text style={s.cardLinkText}>{back === 0 ? 'Not in your paper book yet? Pick an earlier flight' : 'Pick another flight'}</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={{ gap: 10 }}>
                  <View style={s.labelRow}>
                    <Text style={s.label}>Page number</Text>
                    <Text style={s.labelHint}>Either side of the spread</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); editAnchor(leftPage - 2, rowNum); }} accessibilityLabel="Previous spread">
                      <Ionicons name="remove" size={22} color={Colors.primary} />
                    </TouchableOpacity>
                    <TextInput style={s.pageInput} value={anchorEdited ? page : String(pageNum)} keyboardType="number-pad" accessibilityLabel="Page number"
                      onChangeText={(v) => { setAnchorEdited(true); setRow(rowNum); setPage(v.replace(/\D/g, '')); }} selectTextOnFocus />
                    <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); editAnchor(leftPage + 2, rowNum); }} accessibilityLabel="Next spread">
                      <Ionicons name="add" size={22} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ gap: 10 }}>
                  <View style={s.labelRow}>
                    <Text style={s.label}>Which row?</Text>
                    <Text style={s.labelMono}>P. {leftPage}–{leftPage + 1}</Text>
                  </View>
                  <View style={s.rowsBox} accessibilityRole="radiogroup">
                    {Array.from({ length: rs }, (_, i) => {
                      const k = i + 1;
                      const idx = anchorPos + (k - rowNum);
                      const f = idx >= 0 && idx < bookFlights.length ? bookFlights[idx] : null;
                      const kind = k === rowNum ? 'latest' : k < rowNum ? (f ? 'earlier' : 'empty') : f ? 'write' : 'empty';
                      return (
                        <TouchableOpacity key={k} onPress={() => { tap(); editAnchor(pageNum, k); }} activeOpacity={0.75}
                          style={[s.rowBtn, kind === 'latest' && s.rowLatest, kind === 'earlier' && s.rowEarlier, kind === 'write' && s.rowWrite, kind === 'empty' && s.rowEmpty]}
                          accessibilityRole="radio" accessibilityState={{ checked: k === rowNum }}
                          accessibilityLabel={`Row ${k}${f ? `, ${longDate(f.date)} ${route(f)}` : ', empty'}`}>
                          <Text style={[s.rowNum, { color: kind === 'latest' ? Colors.primary : kind === 'write' ? Colors.warning : '#5E82A6' }]}>{k}</Text>
                          <Text style={[s.rowCell, { width: 48 }, kind === 'earlier' && s.rowDim, kind === 'write' && s.rowWriteText]}>{f ? dayMon(f.date) : ''}</Text>
                          <Text style={[s.rowCell, { flex: 1, fontWeight: '600' }, kind === 'earlier' && s.rowDim, kind === 'write' && s.rowWriteText]} numberOfLines={1}>{f ? route(f) : ''}</Text>
                          {(kind === 'latest' || kind === 'write') && (
                            <View style={[s.rowTag, { borderColor: kind === 'latest' ? Colors.primary : Colors.warning }]}>
                              <Text style={[s.rowTagText, { color: kind === 'latest' ? Colors.primary : Colors.warning }]}>{kind === 'latest' ? 'THIS FLIGHT' : 'WRITE NEXT'}</Text>
                            </View>
                          )}
                          <Text style={[s.rowCell, { width: 34, textAlign: 'right' }, kind === 'earlier' && s.rowDim, kind === 'write' && s.rowWriteText]}>{f ? fmtH(f.total_time, timeFormat) : ''}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {back > 0 && Math.min(back, rs - rowNum) > 0 && (
                    <Text style={s.warnText}>
                      {Math.min(back, rs - rowNum) === 1 ? 'The newer flight goes' : `The ${Math.min(back, rs - rowNum)} newer flights go`} in the rows marked Write next. Blades already has {back === 1 ? 'it' : 'them'}.
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <Head title="Where does your book start?" lead={`You haven’t logged any flights yet. Your first flight goes on page ${fp}, row 1.`} />
            )}
            <BookSize open={sizeOpen || !anchor} onToggle={() => setSizeOpen((o) => !o)} rows={rs} fp={firstPage} lp={lastPage}
              onRows={(n) => setRows(Math.max(4, Math.min(30, n)))} onFp={(v) => setFirstPage(v.replace(/\D/g, ''))} onLp={(v) => setLastPage(v.replace(/\D/g, ''))}
              summary={`${rs} rows per spread · pages ${fp} to ${lp || 'the end'}`} />
          </View>
        )}

        {/* ═══ 3 · Tidigare loggböcker ═══ */}
        {step === 'earlier' && (
          <View style={{ gap: 18 }}>
            <Head title={`Where are your first ${earlier.toLocaleString('en-US')} flights?`}
              lead={`Up to page ${pageNum}, row ${rowNum} there’s room for ${room.toLocaleString('en-US')} flights. Blades has ${written.toLocaleString('en-US')} up to that flight, so ${earlier.toLocaleString('en-US')} are from before this logbook.`} />
            <View style={{ gap: 8 }} accessible accessibilityLabel={`${earlier} flights before this logbook, ${room} in it`}>
              <View style={s.barRow}>
                <View style={[s.barBefore, { flex: Math.max(0.16, earlier / written) }]}><Text style={s.barText}>{earlier.toLocaleString('en-US')}</Text></View>
                <View style={[s.barThis, { flex: Math.max(0.2, room / written) }]}><Text style={[s.barText, { color: Colors.primary }]}>{room.toLocaleString('en-US')}</Text></View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.barCap}>Before · {longDate(bookFlights[0]?.date)} –</Text>
                <Text style={s.barCap}>This logbook · {longDate(bookFlights[earlier]?.date)} –</Text>
              </View>
            </View>
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              {([
                ['books', 'In earlier logbooks like this one', 'Blades makes those books too, page by page, so every page matches your paper books.'],
                ['bf', 'Only make this logbook', `The ${earlier.toLocaleString('en-US')} older flights come in as Brought forward on page ${fp}, the way your paper book starts.`],
              ] as const).map(([id, title, body]) => {
                const on = earlierChoice === id;
                return (
                  <View key={id} style={[s.choice, on && s.choiceOn, { flexDirection: 'column', alignItems: 'stretch' }]}>
                    <TouchableOpacity style={[s.choiceMain, { alignItems: 'flex-start', paddingRight: 14 }]} onPress={() => { tap(); setEarlierChoice(id); }} activeOpacity={0.8}
                      accessibilityRole="radio" accessibilityState={{ checked: on }}>
                      <Radio on={on} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={s.choiceTitle}>{title}</Text>
                        <Text style={s.choiceSub}>{body}</Text>
                      </View>
                    </TouchableOpacity>
                    {on && id === 'books' && (
                      <View style={{ paddingLeft: 48, paddingRight: 14, paddingBottom: 14, gap: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={s.smallText}>Each one has pages {fp} to</Text>
                          <TextInput style={s.smallInput} value={earlierLast || String(eLast)} onChangeText={(v) => setEarlierLast(v.replace(/\D/g, ''))}
                            keyboardType="number-pad" selectTextOnFocus accessibilityLabel="Last page of an earlier logbook" />
                        </View>
                        {plan.map((b, i) => (
                          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Ionicons name="book-outline" size={16} color={i === plan.length - 1 ? Colors.primary : Colors.textSecondary} />
                            <Text style={[s.smallText, { flex: 1, fontWeight: '700', color: Colors.textPrimary }]}>{ordinal(i + 1)} Logbook</Text>
                            <Text style={s.monoSmall}>{i === plan.length - 1 ? 'this one' : `${b.count.toLocaleString('en-US')} flights`}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ═══ 4 · Totalerna ═══ */}
        {step === 'totals' && (
          <View style={{ gap: 18 }}>
            <Head title={diffMode ? 'Which numbers are different?' : 'Do your totals match?'}
              lead={diffMode
                ? 'Tap a number that doesn’t match and type what your paper book says. Blades shows how to fix it.'
                : `Compare with the Total to date row at the bottom of page ${leftPage}–${leftPage + 1} in your paper book.`} />
            <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
              <View style={s.totHead}>
                <Text style={[s.eyebrow, { color: Colors.primary, flex: 1 }]}>TOTAL TO DATE</Text>
                <Text style={s.eyebrow}>P. {leftPage}–{leftPage + 1}</Text>
              </View>
              {trows.map((t, i) => {
                const open = diffMode && openKey === t.key;
                const warn = t.status === 'short' || t.status === 'more';
                const row = (
                  <View style={s.totRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.totLabel}>{t.c.label}</Text>
                      {!!t.c.group && <Text style={s.totGroup} numberOfLines={1}>{t.c.group}</Text>}
                    </View>
                    <Text style={[s.totValue, warn && { color: Colors.warning }]}>{fmt(t.c, t.blades)}</Text>
                    {diffMode && (
                      <View style={{ width: 22, alignItems: 'flex-end' }}>
                        <Ionicons
                          name={t.status === 'match' ? 'checkmark-circle-outline' : warn ? 'alert-circle-outline' : t.status === 'paper' ? 'bookmark-outline' : open ? 'chevron-up' : 'chevron-down'}
                          size={t.status === 'untouched' ? 16 : 19}
                          color={t.status === 'match' ? Colors.success : warn ? Colors.warning : t.status === 'paper' ? Colors.textSecondary : '#5E82A6'} />
                      </View>
                    )}
                  </View>
                );
                return (
                  <View key={t.key} style={[i > 0 && s.sep, open && { backgroundColor: '#0D1B33' }]}>
                    {diffMode ? (
                      <TouchableOpacity onPress={() => setOpenKey(open ? null : t.key)} activeOpacity={0.75} accessibilityRole="button" accessibilityState={{ expanded: open }}
                        accessibilityLabel={`${colName(t.c)} ${fmt(t.c, t.blades)}. Tap to enter what your paper book says.`}>
                        {row}
                      </TouchableOpacity>
                    ) : row}
                    {open && (
                      <View style={s.fix}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Text style={[s.smallText, { flex: 1 }]}>Your paper book says</Text>
                          <TextInput style={s.paperInput} value={t.raw ?? fmt(t.c, t.blades)} autoFocus selectTextOnFocus
                            keyboardType={isInt(t.c) ? 'number-pad' : timeFormat === 'hhmm' ? 'numbers-and-punctuation' : 'decimal-pad'}
                            onChangeText={(v) => setPaper((p) => ({ ...p, [t.key]: v }))} accessibilityLabel={`${colName(t.c)} in your paper book`} />
                        </View>
                        {t.status !== 'untouched' && (
                          <Text style={[s.fixText, { color: t.status === 'match' ? Colors.success : t.status === 'paper' ? Colors.textSecondary : Colors.warning }]}>
                            {t.status === 'short' ? `Blades is ${fmt(t.c, t.diff)}${unit(t.c)} short of your paper book.`
                              : t.status === 'more' ? `Blades has ${fmt(t.c, t.diff)}${unit(t.c)} more than your paper book.`
                              : t.status === 'paper' ? `This logbook uses ${t.raw} from your paper book. Your statistics keep ${fmt(t.c, t.blades)}.`
                              : 'Matches your paper book.'}
                          </Text>
                        )}
                        {t.status === 'short' && (BF_KEY[t.key] ? (
                          <>
                            <TouchableOpacity style={s.fixPrimary} onPress={() => { setSheetKey(t.key); setSheet('backfill'); }} activeOpacity={0.85} accessibilityRole="button">
                              <Ionicons name="add" size={18} color={Colors.textInverse} />
                              <Text style={s.fixPrimaryText}>Add {fmt(t.c, t.diff)}{unit(t.c)} as previous experience</Text>
                            </TouchableOpacity>
                            <Text style={s.fixHint}>If a whole flight is missing instead, import or scan it, and the total follows.</Text>
                          </>
                        ) : (
                          <TouchableOpacity style={s.fixSecondary} onPress={() => leaveTo('/import/history')} activeOpacity={0.85} accessibilityRole="button">
                            <Ionicons name="construct-outline" size={17} color={Colors.primary} />
                            <Text style={s.fixSecondaryText}>Open Backfill missing hours</Text>
                          </TouchableOpacity>
                        ))}
                        {t.status === 'more' && (
                          <>
                            <TouchableOpacity style={s.fixSecondary} onPress={() => leaveTo('/import/history')} activeOpacity={0.85} accessibilityRole="button">
                              <Ionicons name="search" size={17} color={Colors.primary} />
                              <Text style={s.fixSecondaryText}>Look for flights counted twice</Text>
                            </TouchableOpacity>
                            <Text style={s.fixHint}>Usually a flight imported twice, or time logged in another column. Opens Imported data.</Text>
                          </>
                        )}
                        {warn && t.pv != null && (
                          <TouchableOpacity onPress={() => setOverrides((o) => ({ ...o, [t.key]: t.pv as number }))} accessibilityRole="button" hitSlop={6}>
                            <Text style={s.fixLink}>Use {t.raw} for this logbook instead</Text>
                          </TouchableOpacity>
                        )}
                        {t.status === 'paper' && (
                          <TouchableOpacity onPress={() => setOverrides((o) => { const n = { ...o }; delete n[t.key]; return n; })} accessibilityRole="button" hitSlop={6}>
                            <Text style={[s.fixLink, { color: Colors.primary, textDecorationLine: 'none' }]}>Undo</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {sources.length > 0 && (
              <View style={s.card0}>
                <TouchableOpacity style={s.collapseHead} onPress={() => setSourcesOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: sourcesOpen }}>
                  <Text style={[s.label, { flex: 1, fontSize: 14 }]}>Where these hours come from</Text>
                  <Ionicons name={sourcesOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
                </TouchableOpacity>
                {sourcesOpen && (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
                    {sources.map((x) => (
                      <View key={x.label} style={[s.srcRow, s.sep]}>
                        <View style={[s.srcDot, { backgroundColor: x.color }]} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <Text style={s.srcLabel}>{x.label}</Text>
                          <Text style={s.srcSub}>{x.unit ? `${x.n.toLocaleString('en-US')} ${x.unit}${x.n === 1 ? '' : 's'}` : 'Backfill missing hours'}</Text>
                        </View>
                        <Text style={s.srcHours}>{x.unit ? `${fmtH(x.h, timeFormat)}${timeFormat === 'decimal' ? ' h' : ''}` : ''}</Text>
                      </View>
                    ))}
                    {back > 0 && (
                      <Text style={[s.fixHint, s.sep, { paddingTop: 8 }]}>
                        Not counted here: {back === 1 ? 'the newer flight' : `the ${back} newer flights`} that {back === 1 ? 'isn’t' : 'aren’t'} in your paper book yet.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ═══ 5 · Kontrollera och skapa ═══ */}
        {step === 'ready' && (
          <View style={{ gap: 18 }}>
            <Head title={`This is page ${leftPage}–${leftPage + 1}`} lead="It should look like the same pages in your paper book. Swipe to see the right-hand page." />
            {readySpread ? (
              <SpreadSwipe spread={readySpread} template={template} timeFormat={timeFormat} width={contentW} pilotName={pilotName} />
            ) : <ActivityIndicator color={Colors.primary} />}
            <View style={s.card0}>
              {[
                { label: 'Logbook', value: template.name, ok: true, to: 'layout' as Step },
                ...(anchor ? [{ label: 'Latest flight in your paper book', value: `Page ${pageNum}, row ${rowNum} · ${longDate(anchor.date)}, ${route(anchor)}`, ok: true, to: 'latest' as Step }] : []),
                ...(earlier > 0 ? [{
                  label: 'Older flights',
                  value: earlierChoice === 'books' ? `${plan.slice(0, -1).map((_, i) => `${ordinal(i + 1)} Logbook`).join(', ')} with ${earlier.toLocaleString('en-US')} flights`
                    : `${earlier.toLocaleString('en-US')} flights as Brought forward on page ${fp}`,
                  ok: true, to: 'earlier' as Step,
                }] : []),
                ...(anchor ? [{
                  label: 'Totals',
                  value: !diffMode ? 'All match your paper book'
                    : unresolved.length ? `${unresolved.map((t) => colName(t.c)).join(', ')} still ${unresolved.length === 1 ? 'differs' : 'differ'}. Fix it later in Settings → Imported data.`
                    : usingPaper.length ? `All match. ${usingPaper.map((t) => colName(t.c)).join(', ')} ${usingPaper.length === 1 ? 'uses' : 'use'} your paper book’s number.`
                    : 'All match your paper book',
                  ok: !unresolved.length, to: 'totals' as Step,
                }] : []),
                { label: 'Book size', value: `${rs} rows per spread · pages ${fp} to ${lp || 'the end'}`, ok: true, to: 'latest' as Step, size: true },
              ].map((x, i) => (
                <View key={x.label} style={[s.sumRow, i > 0 && s.sep]}>
                  <Ionicons name={x.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={19} color={x.ok ? Colors.success : Colors.warning} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={s.sumLabel}>{x.label}</Text>
                    <Text style={s.sumValue}>{x.value}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { if ((x as any).size) setSizeOpen(true); go(x.to); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Change ${x.label.toLowerCase()}`}>
                    <Text style={s.changeText}>Change</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Botten: huvudknappen */}
      <View style={[s.foot, { paddingBottom: insets.bottom + 12 }]}>
        {!!footNote && <Text style={s.footNote}>{footNote}</Text>}
        <TouchableOpacity style={[s.cta, cta.disabled && s.ctaOff]} onPress={cta.onPress} disabled={cta.disabled} activeOpacity={0.85} accessibilityRole="button">
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={[s.ctaText, cta.disabled && { color: Colors.textSecondary }]}>{cta.label}</Text>}
        </TouchableOpacity>
        {cta2 && (
          <TouchableOpacity style={s.cta2} onPress={cta2.onPress} accessibilityRole="button">
            <Text style={s.cta2Text}>{cta2.label}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Ark: en sida av mallen med egna flygningar */}
      {sheet === 'preview' && (
        <SheetFrame onClose={() => setSheet(null)} bottom={insets.bottom}>
          <Text style={s.sheetTitle}>{previewTpl.name}</Text>
          <Text style={s.sheetSub}>{previewTpl.rows_per_spread} rows on each spread · your own latest flights</Text>
          {previewSpread ? <SpreadSwipe spread={previewSpread} template={previewTpl} timeFormat={timeFormat} width={contentW} pilotName={pilotName} /> : null}
          <TouchableOpacity style={s.cta} onPress={() => { chooseTemplate(previewTpl.id); setSheet(null); }} accessibilityRole="button">
            <Text style={s.ctaText}>Use this logbook</Text>
          </TouchableOpacity>
        </SheetFrame>
      )}

      {/* Ark: sista flygningen som står i pappersboken */}
      {sheet === 'flights' && (
        <SheetFrame onClose={() => setSheet(null)} bottom={insets.bottom}>
          <Text style={s.sheetTitle}>Which flight did you write last?</Text>
          <Text style={s.sheetSub}>The ones after it aren’t in your paper book yet. Blades shows which rows they go in.</Text>
          <View style={{ gap: 6 }} accessibilityRole="radiogroup">
            {bookFlights.slice(-8).reverse().map((f, i) => {
              const on = i === flightPick;
              return (
                <TouchableOpacity key={f.id} style={[s.pickRow, on && s.choiceOn]} onPress={() => { tap(); setFlightPick(i); }} activeOpacity={0.8}
                  accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${longDate(f.date)} ${route(f)}`}>
                  <Text style={[s.monoSmall, { width: 56 }]}>{dayMon(f.date)}</Text>
                  <Text style={[s.anchorRoute, { flex: 1, fontSize: 13 }]} numberOfLines={1}>{route(f)}</Text>
                  <Text style={s.monoSmall}>{fmtH(f.total_time, timeFormat)}</Text>
                  <Radio on={on} small />
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={s.cta} onPress={() => { setBack(flightPick); setSheet(null); }} accessibilityRole="button">
            <Text style={s.ctaText}>Use this flight</Text>
          </TouchableOpacity>
        </SheetFrame>
      )}

      {/* Ark: lägg till saknade timmar (Backfill missing hours) */}
      {sheet === 'backfill' && sheetRow && (
        <SheetFrame onClose={() => setSheet(null)} bottom={insets.bottom}>
          <Text style={[s.eyebrow, { color: Colors.primary }]}>BACKFILL MISSING HOURS</Text>
          <Text style={s.sheetTitle}>Add missing {colName(sheetRow.c).toLowerCase()}</Text>
          <View style={s.bfBox}>
            <Text style={s.bfAmount}>+{bfAmount.trim()}</Text>
            <Text style={[s.smallText, { flex: 1 }]}>{colName(sheetRow.c)} becomes {sheetRow.raw}, the same as your paper book.</Text>
          </View>
          <Text style={s.sheetSub}>Saved as previous experience, the row called “Blades previous experience”. It counts in your statistics and in this logbook’s Brought forward. You can change it later in Settings → Imported data.</Text>
          <TouchableOpacity style={[s.cta, busy && s.ctaOff]} onPress={applyBackfill} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={s.ctaText}>Add {bfAmount.trim()}</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cta2} onPress={() => leaveTo('/import/history')} accessibilityRole="button">
            <Text style={s.cta2Text}>Add other hours in Backfill missing hours</Text>
          </TouchableOpacity>
        </SheetFrame>
      )}

      {!!toast && (
        <View style={[s.toast, { bottom: insets.bottom + 100 }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const fmtH = (v: number | string | undefined, tf: 'decimal' | 'hhmm') => {
  const n = Number(v) || 0;
  return tf === 'hhmm' ? formatTimeValue(n, 'hhmm') : (Math.round(n * 10) / 10).toFixed(1);
};

function Head({ title, lead }: { title: string; lead: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.h1} accessibilityRole="header">{title}</Text>
      <Text style={s.lead}>{lead}</Text>
    </View>
  );
}

function Radio({ on, small }: { on: boolean; small?: boolean }) {
  const d = small ? 20 : 22;
  return (
    <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: 2, borderColor: on ? Colors.primary : '#3A5F85', alignItems: 'center', justifyContent: 'center' }}>
      {on && <View style={{ width: d - 12, height: d - 12, borderRadius: (d - 12) / 2, backgroundColor: Colors.primary }} />}
    </View>
  );
}

// Mallens kolumner i miniatyr: vänster- och högersidan, kolumnbredderna som i boken.
function Thumb({ tpl }: { tpl: LogbookTemplate }) {
  const half = (cols: LogbookColumn[]) => (
    <View style={s.thumbPage}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <View key={i} style={[s.thumbLine, { top: 6 + i * 5 }]} />)}
      {cols.map((c, i) => <View key={i} style={{ flex: Math.max(1, c.width ?? 50), borderRightWidth: i < cols.length - 1 ? StyleSheet.hairlineWidth : 0, borderColor: '#8D9CAB' }} />)}
    </View>
  );
  return (
    <View style={s.thumb} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {half(tpl.left_columns)}
      {half(tpl.right_columns)}
    </View>
  );
}

// Uppslaget som det ritas i boken: vänstersidan, svep till högersidan (ingen helskärm behövs).
function SpreadSwipe({ spread, template, timeFormat, width, pilotName }: {
  spread: LogbookSpread; template: LogbookTemplate; timeFormat: 'decimal' | 'hhmm'; width: number; pilotName: string;
}) {
  const [ratioL, setRatioL] = useState(0.72);
  const [ratioR, setRatioR] = useState(0.72);
  const [pg, setPg] = useState(0);
  const ref = useRef<ScrollView>(null);
  const h = Math.max(120, width * Math.max(ratioL, ratioR));
  const goTo = (i: number) => { ref.current?.scrollTo({ x: i * width, animated: true }); setPg(i); };
  return (
    <View style={{ gap: 10 }}>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width, borderRadius: 10 }}
        onMomentumScrollEnd={(e) => setPg(Math.round(e.nativeEvent.contentOffset.x / width))}>
        <View style={{ width, height: h }}>
          <SpreadWebView spread={spread} template={template} pilotName={pilotName} timeFormat={timeFormat} width={width} signature={null} interactive={false}
            bare bgColor={Colors.background} side="left" margin={0} onAspect={(r) => { if (r > 0 && Math.abs(r - ratioL) > 0.01) setRatioL(r); }} />
        </View>
        <View style={{ width, height: h }}>
          <SpreadWebView spread={spread} template={template} pilotName={pilotName} timeFormat={timeFormat} width={width} signature={null} interactive={false}
            bare bgColor={Colors.background} side="right" margin={0} onAspect={(r) => { if (r > 0 && Math.abs(r - ratioR) > 0.01) setRatioR(r); }} />
        </View>
      </ScrollView>
      <View style={s.swipeBar}>
        <TouchableOpacity onPress={() => goTo(0)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Left page" disabled={pg === 0}>
          <Text style={[s.swipeText, pg === 0 && { color: Colors.textPrimary }]}>‹ Left page</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[0, 1].map((i) => <View key={i} style={[s.dot, i === pg && s.dotOn]} />)}
        </View>
        <TouchableOpacity onPress={() => goTo(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Right page" disabled={pg === 1}>
          <Text style={[s.swipeText, pg === 1 && { color: Colors.textPrimary }]}>Right page ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BookSize({ open, onToggle, rows, fp, lp, onRows, onFp, onLp, summary }: {
  open: boolean; onToggle: () => void; rows: number; fp: string; lp: string;
  onRows: (n: number) => void; onFp: (v: string) => void; onLp: (v: string) => void; summary: string;
}) {
  return (
    <View style={s.card0}>
      <TouchableOpacity style={s.collapseHead} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.label, { fontSize: 14 }]}>Book size</Text>
          <Text style={s.choiceSub}>{summary}</Text>
        </View>
        <Text style={s.changeText}>{open ? 'Done' : 'Change'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[s.smallText, { flex: 1, color: Colors.textPrimary }]}>Rows on one spread</Text>
            <TouchableOpacity style={s.miniStep} onPress={() => onRows(rows - 1)} accessibilityLabel="Fewer rows"><Ionicons name="remove" size={18} color={Colors.primary} /></TouchableOpacity>
            <Text style={[s.monoSmall, { width: 34, textAlign: 'center', fontSize: 16, color: Colors.textPrimary }]}>{rows}</Text>
            <TouchableOpacity style={s.miniStep} onPress={() => onRows(rows + 1)} accessibilityLabel="More rows"><Ionicons name="add" size={18} color={Colors.primary} /></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.smallText}>First page with flights</Text>
              <TextInput style={s.fieldInput} value={fp} onChangeText={onFp} keyboardType="number-pad" placeholder="1" placeholderTextColor={Colors.textMuted} accessibilityLabel="First page with flights" />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.smallText}>Last page</Text>
              <TextInput style={s.fieldInput} value={lp} onChangeText={onLp} keyboardType="number-pad" placeholder="Don’t know" placeholderTextColor={Colors.textMuted} accessibilityLabel="Last page" />
            </View>
          </View>
          <Text style={s.fixHint}>The last page is optional. With it, Blades tells you when the book is full and starts the next one.</Text>
        </View>
      )}
    </View>
  );
}

function SheetFrame({ children, onClose, bottom }: { children: ReactNode; onClose: () => void; bottom: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,8,18,0.62)', justifyContent: 'flex-end' }]}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[s.sheet, { paddingBottom: bottom + 16 }]} accessibilityViewIsModal>
        <View style={s.grabber} />
        <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

const MONO = FONT_MONO;
const s = StyleSheet.create({
  root: { backgroundColor: Colors.background },
  top: { backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: '#13263F' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  closeBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: Colors.textPrimary, fontSize: 15.5, fontWeight: '700' },
  topStep: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#6B8DB0' },
  progress: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, paddingBottom: 12 },
  progressSeg: { flex: 1, height: 3, borderRadius: 2 },
  body: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 28 },

  h1: { fontFamily: FONT_SERIF, fontSize: 27, lineHeight: 32, fontWeight: '600', color: Colors.textPrimary },
  h1Big: { fontFamily: FONT_SERIF, fontSize: 30, lineHeight: 34, fontWeight: '600', color: Colors.textPrimary },
  lead: { fontSize: 14.5, lineHeight: 21, color: '#A9C3DB' },
  eyebrow: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: '#6B8DB0' },
  label: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  labelHint: { fontSize: 12.5, color: '#8FB0CC' },
  labelMono: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: '#8FB0CC' },
  smallText: { fontSize: 13, color: '#8FB0CC' },
  monoSmall: { fontFamily: MONO, fontSize: 12, color: '#A9C3DB' },
  warnText: { fontSize: 12.5, lineHeight: 18, color: Colors.warning },

  introIcon: { width: 64, height: 64, borderRadius: 18, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '4D', alignItems: 'center', justifyContent: 'center' },
  noteCard: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  noteIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.warning + '1F', borderWidth: 1, borderColor: Colors.warning + '59', alignItems: 'center', justifyContent: 'center' },
  noteText: { flex: 1, fontSize: 14, lineHeight: 20, color: '#C9DBEC' },
  introStep: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 2 },
  introNum: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#1F4468', alignItems: 'center', justifyContent: 'center' },
  introNumText: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: Colors.primary },
  introStepTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  introStepBody: { fontSize: 13, lineHeight: 18, color: '#8FB0CC' },

  choice: { flexDirection: 'row', alignItems: 'stretch', borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card },
  choiceOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '14' },
  choiceMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 6 },
  choiceTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  choiceSub: { fontSize: 12.5, lineHeight: 17, color: '#8FB0CC' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: Colors.success + '73', backgroundColor: Colors.success + '1A' },
  badgeText: { fontFamily: MONO, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, color: Colors.success },
  eyeBtn: { width: 48, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: Colors.cardBorder },
  thumb: { width: 70, height: 48, borderRadius: 5, backgroundColor: '#E9EEF3', padding: 4, flexDirection: 'row', gap: 2 },
  thumbPage: { flex: 1, flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderColor: '#8D9CAB', overflow: 'hidden' },
  thumbLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: '#B8C5D1' },
  customCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2A5A85' },
  customIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '1A', alignItems: 'center', justifyContent: 'center' },
  customTitle: { fontSize: 14.5, fontWeight: '700', color: Colors.primary },

  card: { borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14 },
  card0: { borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  cardLink: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: Colors.cardBorder, paddingTop: 10, marginTop: 12 },
  cardLinkText: { flex: 1, color: Colors.primary, fontSize: 13.5, fontWeight: '600' },
  dateDay: { fontFamily: FONT_SERIF, fontSize: 26, lineHeight: 28, fontWeight: '600', color: Colors.textPrimary },
  dateMon: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: '#8FB0CC' },
  anchorRoute: { fontFamily: MONO, fontSize: 17, fontWeight: '700', letterSpacing: 0.4, color: Colors.textPrimary },
  anchorSub: { fontFamily: MONO, fontSize: 11.5, color: '#8FB0CC' },
  stepBtn: { width: 52, height: 52, borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  pageInput: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#1F4468', backgroundColor: '#0D1B33', color: Colors.textPrimary, textAlign: 'center', fontFamily: MONO, fontSize: 22, fontWeight: '700' },
  rowsBox: { gap: 4, padding: 8, borderRadius: 14, backgroundColor: '#0D1B33', borderWidth: 1, borderColor: Colors.cardBorder },
  rowBtn: { height: 36, borderRadius: 8, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  rowLatest: { backgroundColor: Colors.primary + '24', borderColor: Colors.primary },
  rowEarlier: { backgroundColor: Colors.card, borderColor: '#16304D' },
  rowWrite: { borderColor: Colors.warning, borderStyle: 'dashed' },
  rowEmpty: { borderColor: '#1F3A5A', borderStyle: 'dashed' },
  rowNum: { width: 18, fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  rowCell: { fontFamily: MONO, fontSize: 11.5, color: Colors.textPrimary },
  rowDim: { color: '#8FB0CC' },
  rowWriteText: { color: '#FFD27A' },
  rowTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  rowTagText: { fontFamily: MONO, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.7 },
  collapseHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  changeText: { color: Colors.primary, fontSize: 13.5, fontWeight: '600' },
  miniStep: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#0D1B33', borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  fieldInput: { height: 44, borderRadius: 10, borderWidth: 1, borderColor: '#1F4468', backgroundColor: '#0D1B33', color: Colors.textPrimary, fontFamily: MONO, fontSize: 16, paddingHorizontal: 12 },
  smallInput: { width: 72, height: 40, borderRadius: 10, borderWidth: 1, borderColor: '#1F4468', backgroundColor: '#0D1B33', color: Colors.textPrimary, fontFamily: MONO, fontSize: 15, textAlign: 'center' },

  barRow: { flexDirection: 'row', height: 30, gap: 2, borderRadius: 8, overflow: 'hidden' },
  barBefore: { backgroundColor: '#1F3A5E', justifyContent: 'center', paddingHorizontal: 8 },
  barThis: { backgroundColor: Colors.primary + '38', borderWidth: 1, borderColor: Colors.primary + '80', borderTopRightRadius: 8, borderBottomRightRadius: 8, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 8 },
  barText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: '#C9DBEC' },
  barCap: { fontSize: 11.5, color: '#8FB0CC' },

  totHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, backgroundColor: '#0D1B33' },
  totRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 46 },
  totLabel: { fontSize: 14, color: '#C9DBEC' },
  totGroup: { fontSize: 11, color: '#6B8DB0', marginTop: 1 },
  totValue: { fontFamily: MONO, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  sep: { borderTopWidth: 1, borderTopColor: '#16304D' },
  fix: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  paperInput: { width: 124, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#2A5A85', backgroundColor: Colors.background, color: Colors.textPrimary, fontFamily: MONO, fontSize: 16, fontWeight: '600', paddingHorizontal: 12, textAlign: 'right' },
  fixText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  fixPrimary: { height: 42, borderRadius: 11, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  fixPrimaryText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  fixSecondary: { height: 42, borderRadius: 11, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '73', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  fixSecondaryText: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  fixHint: { fontSize: 12, lineHeight: 17, color: '#8FB0CC' },
  fixLink: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, textDecorationLine: 'underline' },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  srcDot: { width: 8, height: 8, borderRadius: 4 },
  srcLabel: { fontSize: 13.5, fontWeight: '600', color: Colors.textPrimary },
  srcSub: { fontSize: 11.5, color: '#8FB0CC' },
  srcHours: { fontFamily: MONO, fontSize: 13, fontWeight: '600', color: Colors.textPrimary },

  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  sumLabel: { fontSize: 12, color: '#8FB0CC' },
  sumValue: { fontSize: 14, lineHeight: 19, fontWeight: '600', color: Colors.textPrimary },
  swipeBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  swipeText: { fontSize: 12.5, fontWeight: '600', color: Colors.primary },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2A4A6E' },
  dotOn: { backgroundColor: Colors.primary, width: 16 },

  foot: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#13263F', backgroundColor: Colors.background, gap: 6 },
  footNote: { fontSize: 12.5, lineHeight: 17, color: Colors.warning, textAlign: 'center', paddingHorizontal: 6, paddingBottom: 4 },
  cta: { height: 52, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: '#16304D' },
  ctaText: { color: Colors.textInverse, fontSize: 16.5, fontWeight: '800' },
  cta2: { height: 40, alignItems: 'center', justifyContent: 'center' },
  cta2Text: { color: Colors.primary, fontSize: 14.5, fontWeight: '700' },

  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: '#1F4468', paddingHorizontal: 16, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#2A4A6E', marginBottom: 12 },
  sheetTitle: { fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', color: Colors.textPrimary },
  sheetSub: { fontSize: 13, lineHeight: 19, color: '#A9C3DB', marginTop: -6 },
  pickRow: { height: 46, borderRadius: 11, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: '#0D1B33', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  bfBox: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: '#0D1B33', borderWidth: 1, borderColor: Colors.cardBorder },
  bfAmount: { fontFamily: MONO, fontSize: 28, fontWeight: '700', color: Colors.success },
  toast: { position: 'absolute', left: 16, right: 16, padding: 12, borderRadius: 12, backgroundColor: '#16304F', borderWidth: 1, borderColor: '#2A5A85' },
  toastText: { fontSize: 13, lineHeight: 18, color: Colors.textPrimary, textAlign: 'center' },
});
