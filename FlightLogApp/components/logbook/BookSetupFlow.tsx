// Loggbokens uppsättning i pilotläget, en fråga per skärm. Tre lägen:
//
// FÖRSTA BOKEN (inga böcker finns):
//  1. Vilken loggbok (mallarna som kort med kolumnerna i miniatyr; ögat visar en sida med egna flygningar)
//  2. Var den senaste flygningen står i pappersboken: sida + rad (tryck på raden). Inte inskriven än → välj
//     en tidigare flygning; de nyare blir "Write next". Bokens storlek (rader, första/sista sida) är hopfälld.
//  3. Tidigare loggböcker: bara när flygningarna före raden inte får plats i boken → fler böcker av samma
//     sort (ankar-styrda, services/logbook/books.ts) eller äldre timmar som Brought forward.
//  4. Totalerna mot pappersbokens Total to date. Skiljer något skriver man in pappersbokens siffra och väljer
//     "Use … from your paper book". När boken skapas justeras Backfill missing hours med skillnaden (plus eller
//     minus), så att statistiken och boken visar pappersbokens siffra. Kolumner som Backfill inte har gäller
//     bara den här boken (opening_balance-override).
//  5. Uppslaget som det kommer att se ut (riktiga sidan, svep till högersidan) och en sammanfattning.
//
// EN BOK TILL (böcker finns, `books`): samma skärmar, men först frågan om den nya boken ser ut som den förra
// (ja → samma mall, storlek och kolumnval; nej → välj mall) och om man har skrivit i den än. Har man det anger
// man sidan + raden för den senaste flygningen; boken börjar så många rader före den, och flygningarna före
// står kvar i böckerna före (ankaret, services/logbook/books.ts). Tom bok → den tar vid där den förra blev full.
//
// ÄNDRA EN BOK (`edit`): en översikt (namn, uppslaget som det ser ut, en rad per inställning med Change) i
// stället för steg. Change öppnar samma skärm som i uppsättningen; Done går tillbaka till översikten och
// Save changes sparar allt på en gång.
//
// Lämnar man flödet (Imported data, egen loggbok) sparas läget och flödet öppnas igen på samma steg.
//
// DRÖNARLÄGET (`kind="drone"`): samma flöde med drönarflygningarna som rader (droneToFlightRow) och böcker av
// sorten 'drone'. Det finns en layout (Remote Pilot Logbook), så frågorna om layout hoppas över och en bok till
// får förra bokens storlek. Drönarens Backfill missing hours räknas i statistiken men inte i boken: pappersbokens
// siffror sparas därför alltid i boken, och Backfill justeras dessutom för fälten den har (DRONE_BF_KEY).

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
import { LOGBOOK_TEMPLATES, getTemplate, withCustomCols, type LogbookTemplate, type LogbookColumn } from '../../constants/logbookTemplates';
import { getCustomTemplates } from '../../db/customTemplates';
import { getScannedTemplateId } from '../../services/logbook/bookFromScan';
import { useLogbookSetupStore } from '../../store/logbookSetupStore';
import { useFlightStore } from '../../store/flightStore';
import { numericColumns, sortFlightsChrono, buildBookSpreads, computeBroughtForward, type ColumnTotals, type LogbookSpread } from '../../services/logbook/paginate';
import { assignFlightsToBooks, resolveOpeningBalance, anchorRowIndex, isBookRow } from '../../services/logbook/books';
import { planBooks } from '../../services/logbook/setupPlan';
import { createDigitalBook, updateDigitalBook, deleteDigitalBook, listDigitalBooks, type DigitalBook, type BookKind } from '../../db/digitalBooks';
import { getDroneBackfill, setDroneBackfill, type DroneBackfillValues } from '../../db/droneBackfill';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { getBackfill, setBackfill, PREV_EXP_REMARK, type BackfillValues } from '../../db/backfill';
import { parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import { SpreadWebView } from './SpreadWebView';
import type { Flight } from '../../types/flight';

type Variant = 'first' | 'another' | 'edit';
type Step = 'intro' | 'same' | 'layout' | 'started' | 'latest' | 'earlier' | 'totals' | 'ready';
type Sheet = 'preview' | 'flights' | 'backfill' | null;

// Läget när man lämnar flödet (Imported data, egen loggbok); återställs när det öppnas igen.
interface Draft {
  variant: Variant; editId: number; name: string; same: boolean | null; started: boolean | null; posTouched: boolean;
  step: Step; templateId: string; rows: number; firstPage: string; lastPage: string;
  anchorEdited: boolean; page: string; row: number; back: number;
  earlierChoice: 'books' | 'bf' | null; earlierFirst: string; earlierLast: string;
  totalsMode: 'ask' | 'diff'; paper: Record<string, string>; overrides: Record<string, number>;
}
let draft: Draft | null = null;

// Bokens kolumn → fältet i Backfill missing hours (db/backfill). Saknas = rättas i Backfill-verktyget.
const BF_KEY: Record<string, keyof BackfillValues> = {
  tt_total: 'total', total_time: 'total', pic: 'pic', co_pilot: 'co_pilot', dual: 'dual', instructor: 'instructor',
  ifr: 'ifr', night: 'night', multi_pilot: 'multi_pilot', cross_country: 'cross_country',
  landings_day: 'landings_day', landings_night: 'landings_night', fstd: 'sim',
  sp_se: 'se_time', sp_me: 'me_time',
};

// Drönarbokens kolumn → fältet i drönarens Backfill missing hours (db/droneBackfill; bara statistiken).
const DRONE_BF_KEY: Record<string, keyof DroneBackfillValues> = { total_time: 'total_time', vlos: 'vlos', bvlos: 'bvlos', night: 'night' };
const DRONE_TEMPLATES = LOGBOOK_TEMPLATES.filter((t) => t.id.includes('drone'));

const DESC: Record<string, string> = {
  'sv-drone-logbook': 'Remote pilot layout for RPAS, UAS and UAV',
  'easa-pilot-logbook': 'EASA layout for private and student pilots',
  'easa-professional-pilot': 'Multi-pilot, single- and multi-engine time',
  'easa-amc1-fcl050': 'The layout in the EASA rules',
  'faa-61-51': 'US layout with cross-country and instrument',
};

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}` : d || '');
const longDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${dayMon(d)} ${d.slice(0, 4)}` : d || '');
const pilotRoute = (f: Flight) => `${(f.dep_place || '?').toUpperCase()} → ${(f.arr_place || '?').toUpperCase()}`;
const tap = () => { Haptics.selectionAsync().catch(() => {}); };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const parseObj = <T,>(raw: string | undefined | null): Record<string, T> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

export function BookSetupFlow({ flights, timeFormat, pilotName, books: booksProp, edit, kind = 'digital', onClose, onSaved }: {
  flights: Flight[];            // bokens rader (drönarläget: droneToFlightRow)
  timeFormat: 'decimal' | 'hhmm';
  pilotName: string;
  books?: DigitalBook[];        // böckerna som redan finns (inga = första boken)
  edit?: DigitalBook | null;    // boken som ändras (Modify logbook)
  kind?: BookKind;              // 'drone' = drönarlägets böcker
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const loadFlights = useFlightStore((s) => s.loadFlights);
  const drone = kind === 'drone';
  // Drönarflygningar har en plats, inte en sträcka.
  const route = (f: Flight) => (drone ? (f.dep_place || 'No location') : pilotRoute(f));
  const bfKey = (k: string): string | undefined => (drone ? DRONE_BF_KEY[k] : BF_KEY[k]);

  // ── Läget: första boken, en bok till eller ändra en bok ──
  const existing = useMemo(() => {
    const all = [...(booksProp ?? [])];
    if (edit && !all.some((b) => b.id === edit.id)) all.push(edit);
    return all.sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
  }, [booksProp, edit]);
  const variant: Variant = edit ? 'edit' : existing.length ? 'another' : 'first';
  const prevBook = variant === 'another' ? existing[existing.length - 1] : null;
  const prevTpl = useMemo(() => (prevBook ? getTemplate(prevBook.template_id) : null), [prevBook]);

  const [init] = useState<Draft | null>(() => {
    const d = draft; draft = null;
    return d && d.variant === variant && d.editId === (edit?.id ?? 0) ? d : null;
  });
  // Tillbaka från Imported data (Backfill, dubbletter): läs om flygningarna så att totalerna stämmer direkt.
  useEffect(() => { if (init && !drone) loadFlights().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mallar (våra + egna; formatet från skanningen först och förvalt) ──
  const [custom, setCustom] = useState<LogbookTemplate[]>([]);
  const [scannedId, setScannedId] = useState<string | null>(null);
  useEffect(() => {
    getCustomTemplates().then(setCustom).catch(() => {});
    getScannedTemplateId().then(setScannedId).catch(() => {});
  }, []);
  const templates = useMemo(() => {
    if (drone) return DRONE_TEMPLATES;
    const all = [...custom.filter((c) => c.id === scannedId), ...LOGBOOK_TEMPLATES, ...custom.filter((c) => c.id !== scannedId)];
    return all.filter((t) => !t.id.includes('drone') && t.id !== 'sv-easa-standard');
  }, [custom, scannedId, drone]);
  // Finns det bara en layout (drönarläget) hoppas frågorna om layout över, och en bok till blir som den förra.
  const pickLayout = !drone || DRONE_TEMPLATES.length > 1;
  const autoSame = variant === 'another' && !pickLayout ? prevBook : null;

  // ── Flygningarna och var de står i böckerna i dag ──
  const bookFlights = useMemo(() => sortFlightsChrono(flights.filter(isBookRow)), [flights]);
  const realSlices = useMemo(() => (existing.length ? assignFlightsToBooks(existing, flights) : []), [existing, flights]);
  // Utgångsläget för sidan + raden:
  //  start/lead = var boken börjar bland flygningarna (och tomma rader överst), base = sista flygningen man kan
  //  peka ut, anchorIdx/ari = bokens sparade ankare (ändra), waiting = flygningar som inte fick plats i boken före.
  const origin = useMemo(() => {
    const at = (id?: number) => (id ? bookFlights.findIndex((f) => f.id === id) : -1);
    const last = bookFlights.length - 1;
    if (variant === 'edit' && edit) {
      const sl = realSlices.find((x) => x.book.id === edit.id);
      const own = sl?.flights ?? [];
      const anchorIdx = at(edit.anchor_flight_id);
      // En senare bok med ankar-flygning men utan sida/rad börjar med flygningen (första sidan, rad 1).
      const ari = anchorIdx >= 0 ? (anchorRowIndex(edit) ?? (existing[0]?.id === edit.id ? null : 0)) : null;
      return {
        start: Math.max(0, at(own[0]?.id)), lead: sl?.leadingEmptyRows ?? 0,
        base: Math.max(at(own[own.length - 1]?.id), ari !== null ? anchorIdx : -1),
        anchorIdx: ari !== null ? anchorIdx : -1, ari, waiting: 0,
      };
    }
    if (variant === 'another') {
      const waiting = realSlices[realSlices.length - 1]?.overflowCount ?? 0;
      return { start: bookFlights.length - waiting, lead: 0, base: last, anchorIdx: -1, ari: null as number | null, waiting };
    }
    return { start: 0, lead: 0, base: last, anchorIdx: -1, ari: null as number | null, waiting: 0 };
  }, [variant, edit, existing, realSlices, bookFlights]);
  const anchored0 = variant === 'edit' && origin.ari !== null;   // boken har redan en flygning med sida + rad

  const [step, setStep] = useState<Step>(init?.step ?? (variant === 'first' ? 'intro' : variant === 'another' ? (pickLayout ? 'same' : 'started') : 'ready'));
  const [name, setName] = useState(init?.name ?? edit?.name ?? '');
  const [same, setSame] = useState<boolean | null>(init?.same ?? (autoSame ? true : null));   // en bok till: ser ut som den förra
  const [started, setStarted] = useState<boolean | null>(init ? init.started : variant === 'another' && origin.waiting > 0 ? true : null);  // en bok till: det står flygningar i den
  const [templateId, setTemplateId] = useState(init?.templateId ?? edit?.template_id ?? autoSame?.template_id ?? (drone ? 'sv-drone-logbook' : 'easa-pilot-logbook'));
  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? getTemplate(templateId), [templates, templateId]);
  const [rows, setRows] = useState(init?.rows ?? edit?.rows_per_spread ?? autoSame?.rows_per_spread ?? template.rows_per_spread);
  const picked = useRef(!!init || variant === 'edit' || drone);
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

  const sizeFrom = edit ?? autoSame;   // ändra: boken; en bok till med en enda layout: boken före
  const [firstPage, setFirstPage] = useState(init?.firstPage ?? String(sizeFrom?.starting_page ?? 1));
  const [lastPage, setLastPage] = useState(init?.lastPage ?? (sizeFrom && sizeFrom.end_page > 0 ? String(sizeFrom.end_page) : ''));
  const [anchorEdited, setAnchorEdited] = useState(init?.anchorEdited ?? anchored0);
  const [page, setPage] = useState(init?.page ?? (anchored0 && edit ? String(edit.anchor_page > 0 ? edit.anchor_page : edit.starting_page) : ''));
  const [row, setRow] = useState(init?.row ?? (anchored0 && edit && edit.anchor_row > 0 ? edit.anchor_row : 1));
  // Flygningar efter den utpekade: nyare som inte står i pappersboken än (ny bok), eller senare i boken (ändra).
  const [back, setBack] = useState(init?.back ?? (anchored0 ? Math.max(0, origin.base - origin.anchorIdx) : 0));
  const [posTouched, setPosTouched] = useState(init?.posTouched ?? false);   // ändra: sidan, raden eller flygningen är ändrad
  const [sizeOpen, setSizeOpen] = useState(false);
  const [earlierChoice, setEarlierChoice] = useState<'books' | 'bf' | null>(init?.earlierChoice ?? null);
  const [earlierFirst, setEarlierFirst] = useState(init?.earlierFirst ?? '');   // tom = samma som den här boken
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
  const [delArmed, setDelArmed] = useState(false);
  const delTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); if (delTimer.current) clearTimeout(delTimer.current); }, []);
  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  };

  // Lämna flödet (Imported data, egen loggbok): läget sparas och flödet öppnas igen när man kommer tillbaka.
  const leaveTo = (path: string) => {
    draft = {
      variant, editId: edit?.id ?? 0, name, same, started, posTouched,
      step, templateId, rows, firstPage, lastPage, anchorEdited, page: String(pageNum), row: rowNum, back, earlierChoice, earlierFirst, earlierLast, totalsMode, paper, overrides,
    };
    useLogbookSetupStore.getState().requestReopen(edit?.id ?? 0);
    onClose();
    router.push(path as any);
  };

  // ── Flygningen man pekar ut och var den står ──
  const anchorPos = Math.max(-1, origin.base - back);
  const anchor = anchorPos >= 0 ? bookFlights[anchorPos] : null;
  // Flygningen får en sida + rad. Inte i en ny bok som man inte har skrivit i än: den tar vid efter boken före.
  const placing = !!anchor && !(variant === 'another' && started !== true);
  const fp = Math.max(1, parseInt(firstPage, 10) || 1);
  const lp = parseInt(lastPage, 10) || 0;
  const rs = Math.max(1, Math.min(60, rows));
  // Förslag tills man själv ändrar: där flygningen står i dag (första boken: alla flygningar från första sidan;
  // en bok till: flygningarna som inte fick plats i boken före, från första sidan).
  const suggest = useMemo(() => {
    const pos = Math.max(1, anchorPos + 1 - origin.start + origin.lead);
    return { page: fp + (Math.ceil(pos / rs) - 1) * 2, row: ((pos - 1) % rs) + 1 };
  }, [anchorPos, origin.start, origin.lead, fp, rs]);
  const pageNum = anchorEdited ? Math.max(fp, parseInt(page, 10) || fp) : suggest.page;
  const rowNum = Math.max(1, Math.min(rs, anchorEdited ? row : suggest.row));
  // Den inskrivna sidan för flygningen (innan den lyfts till första sidan): ligger den före bokens första sida
  // varnas det, och Continue väntar. Samma sida går bra.
  const typedPage = anchorEdited ? parseInt(page, 10) || 0 : suggest.page;
  const firstAfterLatest = placing && anchorEdited && typedPage > 0 && fp > typedPage;
  const eFirst = Math.max(1, parseInt(earlierFirst, 10) || fp);
  const eLast = Math.max(eFirst + 1, parseInt(earlierLast, 10) || lp || 100);
  // Bokplanen (services/logbook/setupPlan): uppslaget, plats före flygningen, tidigare böcker (bara första boken).
  const planned = useMemo(() => planBooks({
    bookFlightIds: bookFlights.map((f) => f.id), anchorPos, firstPage: fp, lastPage: lp, rowsPerSpread: rs,
    page: pageNum, row: rowNum, earlierChoice: variant === 'first' ? earlierChoice : null, earlierFirstPage: eFirst, earlierLastPage: eLast,
  }), [bookFlights, anchorPos, fp, lp, rs, pageNum, rowNum, earlierChoice, eFirst, eLast, variant]);
  const { leftPage, room, books: plan } = planned;
  const earlier = variant === 'first' ? planned.earlier : 0;
  const written = anchorPos + 1;
  const editAnchor = (p: number, r: number) => { setAnchorEdited(true); setPosTouched(true); setPage(String(Math.max(fp, p))); setRow(r); };

  const chooseSame = (yes: boolean) => {
    setSame(yes);
    if (!yes || !prevBook) return;
    picked.current = true;
    setTemplateId(prevBook.template_id);
    setRows(prevBook.rows_per_spread);
    setFirstPage(String(prevBook.starting_page));
    setLastPage(prevBook.end_page > 0 ? String(prevBook.end_page) : '');
  };

  const steps: Step[] = variant === 'first'
    ? [...(pickLayout ? ['layout' as Step] : []), 'latest', ...(earlier > 0 ? ['earlier' as Step] : []), ...(anchor ? ['totals' as Step] : []), 'ready']
    : variant === 'another'
      ? [...(pickLayout ? ['same' as Step] : []), ...(pickLayout && same === false ? ['layout' as Step] : []), 'started', 'latest', ...(placing ? ['totals' as Step] : []), 'ready']
      : [];   // ändra: översikten ('ready') och en skärm i taget därifrån
  const stepIdx = steps.indexOf(step);
  const go = (s: Step) => { setSheet(null); setStep(s); };
  const next = () => {
    if (variant === 'edit') return go('ready');
    if (step === 'intro') return go(steps[0]);
    if (stepIdx >= 0 && stepIdx < steps.length - 1) go(steps[stepIdx + 1]);
  };
  const prev = () => {
    if (variant === 'edit') return go('ready');
    if (stepIdx > 0) return go(steps[stepIdx - 1]);
    if (variant === 'first' && stepIdx === 0) go('intro');
  };
  const canBack = variant === 'edit' ? step !== 'ready' : variant === 'first' ? step !== 'intro' : stepIdx > 0;

  // ── Böckerna som de blir (förhandsvisningen, fördelningen och den ingående balansen räknas på dem) ──
  // Ankaret som sparas. Ändra: en bok utan sida + rad behåller sitt ankare tills man själv ändrar läget.
  const keepAnchor = variant === 'edit' && !!edit && !posTouched && !anchored0;
  const aId = keepAnchor ? edit!.anchor_flight_id : placing && anchor ? anchor.id : 0;
  const aPage = keepAnchor ? edit!.anchor_page : placing && anchor ? leftPage : 0;
  const aRow = keepAnchor ? edit!.anchor_row : placing && anchor ? rowNum : 0;
  const newName = `${ordinal(existing.length + 1)} Logbook`;
  const curId = variant === 'first' ? plan.length : variant === 'another' ? -1 : edit!.id;
  // Bokens egna val för tomma kolumner följer med när mallen är densamma.
  const customCols = useMemo<Record<string, string>>(() => {
    if (variant === 'edit' && edit) return templateId === edit.template_id ? parseObj<string>(edit.custom_cols) : {};
    if (variant === 'another' && prevBook && same) return templateId === prevBook.template_id ? parseObj<string>(prevBook.custom_cols) : {};
    return {};
  }, [variant, edit, prevBook, same, templateId]);
  const bookTpl = useMemo(() => withCustomCols(template, customCols), [template, customCols]);
  /** ob = ingående balans för boken (utan: härledd; ändra: bokens sparade). */
  const pendingBooks = (ob?: ColumnTotals): DigitalBook[] => {
    if (variant === 'first') {
      return plan.map((b, i) => ({
        id: i + 1, name: `${ordinal(i + 1)} Logbook`, template_id: templateId, starting_page: b.startingPage, rows_per_spread: rs,
        end_page: b.endPage, end_row: 0, is_active: i === plan.length - 1 ? 1 : 0, created_at: '', kind,
        opening_balance: i === plan.length - 1 ? JSON.stringify(ob ?? {}) : '{}', custom_cols: '{}',
        anchor_flight_id: b.anchorFlightId, anchor_page: b.anchorPage, anchor_row: b.anchorRow, display_order: i, acked_spread: 0,
      }));
    }
    const mine = { template_id: templateId, starting_page: fp, rows_per_spread: rs, end_page: lp, anchor_flight_id: aId, anchor_page: aPage, anchor_row: aRow };
    if (variant === 'another') {
      return [...existing, {
        id: -1, name: newName, ...mine, end_row: 0, is_active: 1, created_at: '', kind,
        opening_balance: JSON.stringify(ob ?? {}), custom_cols: JSON.stringify(customCols),
        display_order: (prevBook?.display_order ?? 0) + 1, acked_spread: 0,
      }];
    }
    return existing.map((b) => (b.id === edit!.id ? { ...b, ...mine, opening_balance: ob ? JSON.stringify(ob) : b.opening_balance } : b));
  };
  // Fördelningen med de nya inställningarna: bokens flygningar och böckerna före.
  const pend = useMemo(() => {
    const books = pendingBooks();
    const slices = assignFlightsToBooks(books, flights);
    const i = slices.findIndex((x) => x.book.id === curId);
    return { slices, i, slice: i >= 0 ? slices[i] : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, plan, existing, templateId, fp, lp, rs, aId, aPage, aRow, flights, curId]);
  const fit = useMemo(() => {
    if (variant === 'first' || !pend.slice) return { count: 0, before: 0, where: '', note: '' };
    const sl = pend.slice;
    const before = pend.slices.slice(0, pend.i);
    const prevSl = before[before.length - 1];
    let note = '';
    if (prevSl && prevSl.overCapacity > 0) {
      note = `${prevSl.book.name} then has ${plural(prevSl.overCapacity, 'more flight')} than its pages ${prevSl.book.starting_page} to ${prevSl.book.end_page} hold. Check the page and row, or the last page of ${prevSl.book.name}.`;
    } else if (sl.overCapacity > 0) {
      note = `This logbook has ${plural(sl.overCapacity, 'more flight')} than pages ${fp} to ${lp} hold. They are shown after page ${lp}.`;
    } else if (sl.overflowCount > 0) {
      note = `${plural(sl.overflowCount, 'flight')} ${sl.overflowCount === 1 ? 'doesn’t' : 'don’t'} fit before the last page, ${lp}. ${sl.overflowCount === 1 ? 'It waits' : 'They wait'} for your next logbook.`;
    }
    return {
      count: sl.flights.length,
      before: before.reduce((a, x) => a + x.flights.length, 0),
      where: before.length === 1 ? before[0].book.name : 'your earlier logbooks',
      note,
    };
  }, [variant, pend, fp, lp]);
  // Bokens uppslag med de nya inställningarna (extra = pappersbokens siffror ovanpå den ingående balansen).
  const spreadsFor = (fl: Flight[], extra?: (auto: ColumnTotals) => ColumnTotals): LogbookSpread[] => {
    const books = pendingBooks();
    const cur = books.find((b) => b.id === curId) ?? books[books.length - 1];
    const slice = assignFlightsToBooks(books, fl).find((x) => x.book.id === cur.id);
    const auto = resolveOpeningBalance(cur, books, fl, bookTpl);
    return buildBookSpreads(slice?.flights ?? [], bookTpl, { startingPage: fp, rowsPerSpread: rs, openingBalance: extra ? extra(auto) : auto, leadingEmptyRows: slice?.leadingEmptyRows ?? 0 });
  };
  const needSpreads = step === 'ready' || variant === 'edit';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const curSpreads = useMemo<LogbookSpread[]>(() => (needSpreads ? spreadsFor(flights) : []), [needSpreads, pend, bookTpl]);

  // ── Totalerna som jämförs med pappersbokens Total to date ──
  // Ny bok: fram till och med flygningen man pekat ut (det som står i pappersboken). Ändra: bokens sista
  // uppslag som det ritas, alltså efter bokens sista flygning och med bokens sparade ingående balans.
  const ownFlights = pend.slice?.flights ?? [];
  const refFlight = variant === 'edit' ? (ownFlights[ownFlights.length - 1] ?? null) : placing ? anchor : null;
  const lastSpread = curSpreads[curSpreads.length - 1];
  const totLeft = variant === 'edit' && lastSpread ? lastSpread.page_left : leftPage;
  const cols = useMemo(() => numericColumns(bookTpl), [bookTpl]);
  const totalsFor = (fl: Flight[]): ColumnTotals => {
    if (!refFlight) return {};
    if (variant === 'edit') { const sp = spreadsFor(fl); return sp[sp.length - 1]?.total_to_date ?? {}; }
    const all = sortFlightsChrono(fl.filter((f) => !((f as any).flight_type === 'sim' && (f as any).remarks === '[BACKFILL]')));
    const i = all.findIndex((f) => f.id === refFlight.id);
    const nextFlight = i >= 0 ? all[i + 1] : undefined;
    return nextFlight ? computeBroughtForward(fl, bookTpl, nextFlight.id) : computeBroughtForward(fl, bookTpl, 0, undefined, { noAnchorBase: 'all' });
  };
  const totals = useMemo<ColumnTotals>(
    () => (variant === 'edit' ? (refFlight && lastSpread ? lastSpread.total_to_date : {}) : totalsFor(flights)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, flights, bookTpl, refFlight, lastSpread],
  );
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
    if (!refFlight) return [];
    const all = sortFlightsChrono(flights);
    const i = all.findIndex((f) => f.id === refFlight.id);
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
  }, [flights, refFlight]);

  // ── Förhandsvisningen: uppslaget med flygningen, precis som boken ritas ──
  const shownSpreads = useMemo<LogbookSpread[]>(
    () => (needSpreads && Object.keys(overrides).length ? spreadsFor(flights, withOverrides) : curSpreads),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needSpreads, curSpreads, overrides, totals],
  );
  const readySpread: LogbookSpread | null = step !== 'ready' || !shownSpreads.length ? null
    : (placing && anchor && shownSpreads.find((sp) => sp.flights.some((f) => f.id === anchor.id))) || shownSpreads[shownSpreads.length - 1];
  const previewTpl = templates.find((t) => t.id === previewId) ?? template;
  const previewSpread = useMemo<LogbookSpread | null>(() => {
    if (sheet !== 'preview') return null;
    const cfg = { startingPage: 1, rowsPerSpread: previewTpl.rows_per_spread, openingBalance: {}, leadingEmptyRows: 0 };
    const sp = buildBookSpreads(bookFlights.length ? flights.filter(isBookRow) : [], previewTpl, cfg);
    return sp[sp.length - 1] ?? null;
  }, [sheet, previewTpl, flights, bookFlights.length]);

  // Justerar Backfill missing hours med skillnaderna och ger flygningarna som de är efteråt.
  const adjustBackfill = async (delta: Record<string, number>): Promise<Flight[]> => {
    if (!Object.keys(delta).length) return flights;
    const add = (cur: number | undefined, d: number) => Math.round(((Number(cur) || 0) + d) * 100) / 100;
    if (drone) {
      const cur0 = await getDroneBackfill();
      const nv = { ...cur0 };
      for (const [bk, d] of Object.entries(delta) as [keyof DroneBackfillValues, number][]) nv[bk] = add(cur0[bk], d);
      await setDroneBackfill(nv);
      useDroneFlightStore.getState().loadStats().catch(() => {});
      return flights;   // drönarens Backfill är ingen rad: bokens rader är oförändrade
    }
    const cur0 = await getBackfill();
    const nv = { ...cur0 };
    for (const [bk, d] of Object.entries(delta) as [keyof BackfillValues, number][]) nv[bk] = add(cur0[bk], d);
    await setBackfill(nv);
    await loadFlights();
    return useFlightStore.getState().flights;
  };

  // ── Skapa ──
  const create = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const existing = await listDigitalBooks(kind);
      const base = existing.length;
      // Pappersbokens siffror: kolumnerna som Backfill missing hours har justeras där med skillnaden (statistiken
      // och boken följer med); övriga gäller bara den här boken. Drönarläget: Backfill räknas inte i boken, så
      // där sparas alla i boken.
      const bfDelta: Record<string, number> = {};
      const bookOnly: Record<string, number> = {};
      for (const [k, v] of Object.entries(overrides)) {
        const bk = bfKey(k);
        if (bk) bfDelta[bk] = (bfDelta[bk] ?? 0) + (v - (totals[k] ?? 0));
        if (!bk || drone) bookOnly[k] = v;
      }
      const fl = await adjustBackfill(bfDelta);
      const books = pendingBooks();
      const cur = books.find((b) => b.id === curId) ?? books[books.length - 1];
      let ob: ColumnTotals = {};
      if (Object.keys(bookOnly).length) {
        const auto = resolveOpeningBalance(cur, books, fl, bookTpl);
        const t = totalsFor(fl);
        ob = { ...auto };
        for (const [k, v] of Object.entries(bookOnly)) ob[k] = (auto[k] ?? 0) + (v - (t[k] ?? 0));
      }
      if (variant === 'another') {
        // En bok till: en bok, med sitt ankare (eller utan: den tar vid där boken före blev full).
        await createDigitalBook({
          name: newName, templateId, startingPage: fp, rowsPerSpread: rs, endPage: lp,
          anchorFlightId: aId, anchorPage: aPage, anchorRow: aRow, openingBalance: ob, customCols,
        }, kind);
      } else for (let i = 0; i < plan.length; i++) {
        const b = plan[i];
        await createDigitalBook({
          name: `${ordinal(base + i + 1)} Logbook`, templateId, startingPage: b.startingPage, rowsPerSpread: rs, endPage: b.endPage,
          anchorFlightId: b.anchorFlightId, anchorPage: b.anchorPage, anchorRow: b.anchorRow,
          openingBalance: i === plan.length - 1 ? ob : {}, customCols: {},
        }, kind);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await onSaved();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Could not create the logbook', e?.message ?? 'Try again.');
    }
  };

  // ── Ändra: spara allt på en gång ──
  const dirty = variant === 'edit' && !!edit && (
    (name.trim() || edit.name) !== edit.name || templateId !== edit.template_id || fp !== edit.starting_page
    || lp !== Math.max(0, edit.end_page) || rs !== edit.rows_per_spread || posTouched || Object.keys(overrides).length > 0
  );
  const saveEdit = async () => {
    if (saving || !edit) return;
    setSaving(true);
    try {
      // Pappersbokens siffror: Backfill missing hours justeras med skillnaden (statistiken och böckerna följer med).
      // Kolumner som Backfill inte har, och böcker med en egen sparad ingående balans, rättas i boken.
      const stored = parseObj<number>(edit.opening_balance);
      const hasStored = Object.keys(stored).length > 0;
      const bfDelta: Record<string, number> = {};
      const bookDelta: Record<string, number> = {};
      for (const [k, v] of Object.entries(overrides)) {
        const d = v - (totals[k] ?? 0);
        const bk = bfKey(k);
        if (bk) bfDelta[bk] = (bfDelta[bk] ?? 0) + d;
        if (!bk || hasStored || drone) bookDelta[k] = d;
      }
      const fl = await adjustBackfill(bfDelta);
      let openingBalance = edit.opening_balance || '{}';
      if (Object.keys(bookDelta).length) {
        const books = pendingBooks();
        const cur = books.find((b) => b.id === edit.id) ?? edit;
        const ob: ColumnTotals = hasStored ? { ...stored } : { ...resolveOpeningBalance(cur, books, fl, bookTpl) };
        for (const [k, d] of Object.entries(bookDelta)) ob[k] = Math.round(((ob[k] ?? 0) + d) * 100) / 100;
        openingBalance = JSON.stringify(ob);
      }
      await updateDigitalBook(edit.id, {
        name: name.trim() || edit.name, template_id: templateId, starting_page: fp, rows_per_spread: rs, end_page: lp,
        anchor_flight_id: aId, anchor_page: aPage, anchor_row: aRow, opening_balance: openingBalance,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await onSaved();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Could not save the logbook', e?.message ?? 'Try again.');
    }
  };
  // Ta bort boken: två tryck (ingen ruta ovanpå flödet). Flygningarna ligger kvar.
  const removeBook = async () => {
    if (!edit || saving) return;
    if (!delArmed) {
      setDelArmed(true);
      if (delTimer.current) clearTimeout(delTimer.current);
      delTimer.current = setTimeout(() => setDelArmed(false), 4000);
      return;
    }
    setSaving(true);
    try {
      await deleteDigitalBook(edit.id);
      await onSaved();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Could not delete the logbook', e?.message ?? 'Try again.');
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
  if (variant === 'edit') cta = { ...cta, label: 'Done' };
  if (step === 'same' && same === null) cta = { ...cta, label: 'Choose one', disabled: true };
  if (step === 'started' && started === null) cta = { ...cta, label: 'Choose one', disabled: true };
  if (step === 'earlier' && !earlierChoice) cta = { ...cta, label: 'Choose where they are', disabled: true };
  if (step === 'latest' && firstAfterLatest) cta = { ...cta, label: 'Check the pages', disabled: true };
  if (step === 'totals' && !diffMode) {
    cta = { ...cta, label: 'Yes, they all match' };
    cta2 = { label: 'Something is different', onPress: () => { tap(); setTotalsMode('diff'); } };
  }
  if (step === 'totals' && diffMode && unresolved.length) footNote = `${unresolved.length} ${unresolved.length === 1 ? 'total still differs' : 'totals still differ'}. You can go on and fix it later.`;
  if (step === 'ready') {
    cta = variant === 'edit'
      ? (dirty ? { label: 'Save changes', onPress: saveEdit, disabled: saving } : { label: 'Done', onPress: onClose, disabled: saving })
      : { label: plan.length > 1 ? `Create ${plan.length} logbooks` : 'Create logbook', onPress: create, disabled: saving };
  }

  const TITLES: Record<Step, string> = {
    intro: '', same: 'Same or different', layout: 'Which logbook', started: 'Flights in it',
    latest: variant === 'edit' ? 'Page and row' : 'Latest flight', earlier: 'Older flights', totals: 'Totals', ready: 'Check and create',
  };
  // Raderna i sammanfattningen (ny bok) och översikten (ändra): en per inställning, med Change.
  const flightsText = `${plural(fit.count, 'flight')} in this logbook${fit.before ? ` · ${fit.before.toLocaleString('en-US')} in ${fit.where}` : ''}`;
  const sumRows: { label: string; value: string; ok: boolean; to?: Step; size?: boolean; action?: string }[] = [
    {
      label: 'Logbook',
      value: variant === 'another' && same && prevBook && pickLayout ? `${template.name}, the same as ${prevBook.name}` : template.name,
      ok: true, to: !pickLayout ? undefined : variant === 'another' ? 'same' : 'layout',
    },
    ...(placing && anchor ? [{
      label: variant === 'edit' ? 'Page and row' : variant === 'another' ? 'Latest flight in the new logbook' : 'Latest flight in your paper book',
      value: `Page ${pageNum}, row ${rowNum} · ${longDate(anchor.date)}, ${route(anchor)}`, ok: true, to: 'latest' as Step,
    }] : []),
    ...(variant === 'another' && !placing ? [{
      label: 'Flights in it',
      value: origin.waiting > 0 ? `Not written yet. ${plural(origin.waiting, 'flight')} from page ${fp}, row 1` : `Empty. Your next flight goes on page ${fp}, row 1`,
      ok: true, to: 'started' as Step,
    }] : []),
    ...(variant === 'edit' && !placing ? [{ label: 'Page and row', value: `No flights here yet. The first one goes on page ${fp}, row 1`, ok: true, to: 'latest' as Step }] : []),
    ...(earlier > 0 ? [{
      label: 'Older flights',
      value: earlierChoice === 'books' ? `${plan.slice(0, -1).map((_, i) => `${ordinal(i + 1)} Logbook`).join(', ')} with ${earlier.toLocaleString('en-US')} flights`
        : `${earlier.toLocaleString('en-US')} flights as Brought forward on page ${fp}`,
      ok: true, to: 'earlier' as Step,
    }] : []),
    ...(variant !== 'first' && (placing || fit.count > 0 || !!fit.note) ? [{
      label: 'Flights', value: fit.note ? `${flightsText}. ${fit.note}` : flightsText, ok: !fit.note, to: 'latest' as Step,
    }] : []),
    ...(refFlight ? [{
      label: 'Totals',
      value: !diffMode ? (variant === 'edit' ? 'Check them against your paper book' : 'All match your paper book')
        : unresolved.length ? `${unresolved.map((t) => colName(t.c)).join(', ')} still ${unresolved.length === 1 ? 'differs' : 'differ'}. Fix it later in Settings → Imported data.`
        : usingPaper.length ? `All match. ${usingPaper.map((t) => colName(t.c)).join(', ')} ${usingPaper.length === 1 ? 'uses' : 'use'} your paper book’s number.`
        : 'All match your paper book',
      ok: !unresolved.length, to: 'totals' as Step, action: variant === 'edit' && !diffMode ? 'Check' : undefined,
    }] : []),
    { label: 'Book size', value: `${rs} rows per spread · pages ${fp} to ${lp || 'the end'}`, ok: true, to: 'latest', size: true },
  ];
  const contentW = winW - 32;
  // Bokens storlek. En ny bok som inte ser ut som den förra: överst och öppen, eftersom sidorna avgör var raden hamnar.
  const sizeFirst = variant === 'another' && same === false && placing;
  const sizeCard = (
    <BookSize open={sizeOpen || !placing || sizeFirst} fixed={!placing || sizeFirst} onToggle={() => setSizeOpen((o) => !o)} rows={rs} fp={firstPage} lp={lastPage}
      onRows={(n) => setRows(Math.max(4, Math.min(30, n)))} onFp={(v) => setFirstPage(v.replace(/\D/g, ''))} onLp={(v) => setLastPage(v.replace(/\D/g, ''))}
      summary={`${rs} rows per spread · pages ${fp} to ${lp || 'the end'}`} />
  );

  return (
    <View style={[StyleSheet.absoluteFill, s.root]}>
      {/* Topp: tillbaka, rubrik + steg, stäng, stegmätare */}
      <View style={[s.top, { paddingTop: insets.top + 6 }]}>
        <View style={s.topRow}>
          {canBack ? (
            <TouchableOpacity onPress={prev} style={s.backBtn} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={Colors.primary} />
            </TouchableOpacity>
          ) : <View style={{ width: 40 }} />}
          <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <Text style={s.topTitle} numberOfLines={1}>{variant === 'edit' ? (name.trim() || edit?.name) : 'New logbook'}</Text>
            <Text style={s.topStep}>
              {variant === 'edit' ? (step === 'ready' ? 'LOGBOOK SETTINGS' : TITLES[step].toUpperCase())
                : stepIdx >= 0 ? `STEP ${stepIdx + 1} OF ${steps.length} · ${TITLES[step].toUpperCase()}` : 'BEFORE YOU START'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel={variant === 'edit' ? 'Close without saving' : 'Close without creating a logbook'}>
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
                ...(pickLayout ? [['Pick the logbook you have', 'So every page has the same columns as your paper book.']] : []),
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

        {/* ═══ En bok till · Ser den ut som den förra ═══ */}
        {step === 'same' && prevBook && prevTpl && (
          <View style={{ gap: 18 }}>
            <Head title="Does your new logbook look like the last one?"
              lead={`${prevBook.name} uses the ${prevTpl.name} layout. If the new one has the same columns, Blades sets it up the same way.`} />
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              <TouchableOpacity style={[s.choice, same === true && s.choiceOn]} onPress={() => { tap(); chooseSame(true); }} activeOpacity={0.8}
                accessibilityRole="radio" accessibilityState={{ checked: same === true }}>
                <View style={[s.choiceMain, { paddingRight: 14 }]}>
                  <Thumb tpl={prevTpl} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={s.choiceTitle}>Yes, the same logbook</Text>
                    <Text style={s.choiceSub}>{prevTpl.name} · {prevBook.rows_per_spread} rows · pages {prevBook.starting_page} to {prevBook.end_page > 0 ? prevBook.end_page : 'the end'}</Text>
                  </View>
                  <Radio on={same === true} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[s.choice, same === false && s.choiceOn]} onPress={() => { tap(); chooseSame(false); }} activeOpacity={0.8}
                accessibilityRole="radio" accessibilityState={{ checked: same === false }}>
                <View style={[s.choiceMain, { paddingRight: 14 }]}>
                  <View style={s.choiceIcon}><Ionicons name="swap-horizontal" size={20} color={Colors.primary} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={s.choiceTitle}>No, it looks different</Text>
                    <Text style={s.choiceSub}>
                      {scannedId && scannedId !== prevBook.template_id
                        ? 'Pick its layout next. The one from your latest scan is first in the list.'
                        : 'Pick its layout next, or take a photo of a page and Blades makes a matching one.'}
                    </Text>
                  </View>
                  <Radio on={same === false} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ═══ En bok till · Har man skrivit i den än ═══ */}
        {step === 'started' && prevBook && (
          <View style={{ gap: 18 }}>
            <Head title="Have you written in the new logbook yet?"
              lead={origin.waiting > 0
                ? `${plural(origin.waiting, 'flight')} didn’t fit in ${prevBook.name}. ${origin.waiting === 1 ? 'It goes' : 'They go'} in the new logbook.`
                : `${prevBook.name} is full, so your next flights go in the new one.`} />
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              {([
                [true, 'Yes, there are flights in it', 'Next you show the page and row of the latest one, so every page lines up with your paper book.'],
                [false, 'Not yet, it’s empty', origin.waiting > 0
                  ? `The ${plural(origin.waiting, 'flight')} ${origin.waiting === 1 ? 'starts' : 'start'} on the first page, row 1. Blades shows which rows to write them in.`
                  : 'Your next flight goes on the first page, row 1.'],
              ] as const).map(([val, title, body]) => {
                const on = started === val;
                return (
                  <TouchableOpacity key={String(val)} style={[s.choice, on && s.choiceOn]} onPress={() => { tap(); setStarted(val); }} activeOpacity={0.8}
                    accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <View style={[s.choiceMain, { alignItems: 'flex-start', paddingRight: 14 }]}>
                      <Radio on={on} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={s.choiceTitle}>{title}</Text>
                        <Text style={s.choiceSub}>{body}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ═══ 1 · Vilken loggbok ═══ */}
        {step === 'layout' && (
          <View style={{ gap: 18 }}>
            <Head title={variant === 'another' ? 'Which logbook is the new one?' : 'Which logbook do you have?'} lead="Pick the one with the same columns as your paper book. Tap the eye to see a page with your own flights." />
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
            {/* Egen mall (t.ex. från en skanning): ändra kolumnerna i samma editor. */}
            {!drone && template.id.startsWith('custom-') && (
              <TouchableOpacity style={[s.customCard, { borderStyle: 'solid' }]} onPress={() => leaveTo(`/logbook/create-custom?template=${encodeURIComponent(template.id)}`)} activeOpacity={0.85} accessibilityRole="button">
                <View style={s.customIcon}><Ionicons name="create-outline" size={19} color={Colors.primary} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.customTitle}>Change the columns of {template.name}</Text>
                  <Text style={s.choiceSub}>Rename, reorder or resize them until the page matches your paper book.</Text>
                </View>
              </TouchableOpacity>
            )}
            {!drone && (
              <TouchableOpacity style={s.customCard} onPress={() => leaveTo('/logbook/create-custom')} activeOpacity={0.85} accessibilityRole="button">
                <View style={s.customIcon}><Ionicons name="camera-outline" size={19} color={Colors.primary} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.customTitle}>Yours isn’t here?</Text>
                  <Text style={s.choiceSub}>Take a photo of one page. Blades reads the columns and makes a matching layout.</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ═══ 2 · Var står flygningen i pappersboken ═══ */}
        {step === 'latest' && (
          <View style={{ gap: 18 }}>
            {placing && anchor ? (
              <>
                <Head title={variant === 'another' ? 'Where is this flight in your new logbook?' : 'Where is this flight in your paper book?'}
                  lead={variant === 'edit'
                    ? 'Change the page or row if the pages here don’t line up with your paper book. Every other flight follows.'
                    : 'Blades lines up every page with your paper book from here.'} />
                {sizeFirst && sizeCard}
                <View style={s.card}>
                  <Text style={[s.eyebrow, { paddingBottom: 8 }]}>
                    {variant === 'edit' ? (back === 0 ? 'THE LAST FLIGHT IN THIS LOGBOOK' : 'A FLIGHT IN THIS LOGBOOK')
                      : back === 0 ? 'YOUR LATEST FLIGHT IN BLADES' : 'LAST FLIGHT IN YOUR PAPER BOOK'}
                  </Text>
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
                    <Text style={s.cardLinkText}>{variant !== 'edit' && back === 0 ? 'Not in your paper book yet? Pick an earlier flight' : 'Pick another flight'}</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
                  </TouchableOpacity>
                </View>

                {/* Bokens första sida med flygningar (efter inledningen) och den här flygningens sida, var för sig, med
                    samma +/− som sidnumret. Sedan bokens storlek, och sist raden. */}
                <View style={{ gap: 10 }}>
                  <View style={s.labelRow}>
                    <Text style={s.label}>First flight · page</Text>
                    <Text style={s.labelHint}>After the intro pages</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); setFirstPage(String(Math.max(1, fp - 1))); }} accessibilityLabel="Previous page">
                      <Ionicons name="remove" size={22} color={Colors.primary} />
                    </TouchableOpacity>
                    <TextInput style={[s.pageInput, firstAfterLatest && { borderColor: Colors.warning }]} value={firstPage} keyboardType="number-pad" selectTextOnFocus
                      onChangeText={(v) => setFirstPage(v.replace(/\D/g, ''))} placeholder="1" placeholderTextColor={Colors.textMuted}
                      accessibilityLabel="Page of the first flight in this logbook" />
                    <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); setFirstPage(String(fp + 1)); }} accessibilityLabel="Next page">
                      <Ionicons name="add" size={22} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ gap: 10 }}>
                  <View style={s.labelRow}>
                    <Text style={s.label}>{variant !== 'edit' && back === 0 ? 'Latest flight · page' : 'This flight · page'}</Text>
                    <Text style={s.labelHint}>Either side of the spread</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); editAnchor(leftPage - 2, rowNum); }} accessibilityLabel="Previous spread">
                      <Ionicons name="remove" size={22} color={Colors.primary} />
                    </TouchableOpacity>
                    <TextInput style={s.pageInput} value={anchorEdited ? page : String(pageNum)} keyboardType="number-pad" accessibilityLabel="Page number"
                      onChangeText={(v) => { setAnchorEdited(true); setPosTouched(true); setRow(rowNum); setPage(v.replace(/\D/g, '')); }} selectTextOnFocus />
                    <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); editAnchor(leftPage + 2, rowNum); }} accessibilityLabel="Next spread">
                      <Ionicons name="add" size={22} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                  {firstAfterLatest && (
                    <Text style={s.warnText} accessibilityLiveRegion="polite">
                      The first flight (page {fp}) can’t come after this flight (page {typedPage}). They can be on the same page.
                    </Text>
                  )}
                </View>

                {/* Bokens storlek här: bara rader per uppslag, med samma +/− (första sidan står ovanför; sista sidan
                    frågas inte i det här steget). */}
                {sizeFirst ? null : (
                  <View style={{ gap: 10 }}>
                    <View style={s.labelRow}>
                      <Text style={s.label}>Rows per spread</Text>
                      <Text style={s.labelHint}>Count the rows on one spread</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); setRows(Math.max(4, rs - 1)); }} accessibilityLabel="Fewer rows">
                        <Ionicons name="remove" size={22} color={Colors.primary} />
                      </TouchableOpacity>
                      {/* Bara +/− (4–30): att skriva "12" gick via "1", som spärren då lyfte till 4. */}
                      <View style={[s.pageInput, { justifyContent: 'center' }]} accessible accessibilityLabel={`${rs} rows per spread`}>
                        <Text style={{ color: Colors.textPrimary, fontSize: 22, fontWeight: '700', fontFamily: MONO, textAlign: 'center' }}>{rs}</Text>
                      </View>
                      <TouchableOpacity style={s.stepBtn} onPress={() => { tap(); setRows(Math.min(30, rs + 1)); }} accessibilityLabel="More rows">
                        <Ionicons name="add" size={22} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

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
                      // Ändra: flygningarna efter står redan i boken (inga "Write next").
                      const kind = k === rowNum ? 'latest' : !f ? 'empty' : k < rowNum || variant === 'edit' ? 'earlier' : 'write';
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
                  {variant !== 'edit' && back > 0 && Math.min(back, rs - rowNum) > 0 && (
                    <Text style={s.warnText}>
                      {Math.min(back, rs - rowNum) === 1 ? 'The newer flight goes' : `The ${Math.min(back, rs - rowNum)} newer flights go`} in the rows marked Write next. Blades already has {back === 1 ? 'it' : 'them'}.
                    </Text>
                  )}
                  {variant !== 'first' && (
                    <Text style={s.infoText}>
                      {plural(fit.count, 'flight')} {fit.count === 1 ? 'goes' : 'go'} in this logbook{fit.before ? `. The ${fit.before.toLocaleString('en-US')} before ${fit.count === 1 ? 'it' : 'them'} stay in ${fit.where}` : ''}.
                    </Text>
                  )}
                  {!!fit.note && <Text style={s.warnText}>{fit.note}</Text>}
                </View>
              </>
            ) : variant === 'another' ? (
              <Head title="How big is the new logbook?"
                lead={origin.waiting > 0
                  ? `The ${plural(origin.waiting, 'flight')} that didn’t fit in ${prevBook?.name} ${origin.waiting === 1 ? 'goes' : 'go'} on page ${fp}, from row 1. Check the pages and rows below.`
                  : `Your next flight goes on page ${fp}, row 1. Check the pages and rows below.`} />
            ) : (
              <Head title="Where does your book start?" lead={variant === 'edit'
                ? `There are no flights in this logbook yet. The first one goes on page ${fp}, row 1.`
                : `You haven’t logged any flights yet. Your first flight goes on page ${fp}, row 1.`} />
            )}
            {/* Utan flygning att placera: bokens storlek sist (med flygning: ovanför raderna). */}
            {!sizeFirst && !(placing && anchor) && sizeCard}
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
                        <View style={{ gap: 6 }}>
                          <Text style={s.smallText}>Pages with flights in each one</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <TextInput style={s.smallInput} value={earlierFirst || String(eFirst)} onChangeText={(v) => setEarlierFirst(v.replace(/\D/g, ''))}
                              keyboardType="number-pad" selectTextOnFocus accessibilityLabel="First page with flights in an earlier logbook" />
                            <Text style={s.smallText}>to</Text>
                            <TextInput style={s.smallInput} value={earlierLast || String(eLast)} onChangeText={(v) => setEarlierLast(v.replace(/\D/g, ''))}
                              keyboardType="number-pad" selectTextOnFocus accessibilityLabel="Last page of an earlier logbook" />
                          </View>
                          <Text style={s.fixHint}>Start on the page with the first flight, after the book’s intro pages.</Text>
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
                : variant === 'edit' && refFlight
                  ? `Compare with the Total to date row at the bottom of page ${totLeft}–${totLeft + 1} in your paper book, after ${longDate(refFlight.date)}, ${route(refFlight)}.`
                  : `Compare with the Total to date row at the bottom of page ${totLeft}–${totLeft + 1} in your paper book.`} />
            <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
              <View style={s.totHead}>
                <Text style={[s.eyebrow, { color: Colors.primary, flex: 1 }]}>TOTAL TO DATE</Text>
                <Text style={s.eyebrow}>P. {totLeft}–{totLeft + 1}</Text>
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
                              : t.status === 'paper' ? (bfKey(t.key)
                                ? `Set to ${t.raw}. When you ${variant === 'edit' ? 'save' : 'create the logbook'}, Backfill missing hours ${(overrides[t.key] ?? 0) >= t.blades ? 'adds' : 'takes off'} ${fmt(t.c, Math.abs((overrides[t.key] ?? 0) - t.blades))}${unit(t.c)}, so your statistics match your paper book too.`
                                : `This logbook uses ${t.raw} from your paper book. Your statistics keep ${fmt(t.c, t.blades)}.`)
                              : 'Matches your paper book.'}
                          </Text>
                        )}
                        {warn && t.pv != null && (
                          <>
                            <TouchableOpacity style={s.fixPrimary} onPress={() => { Haptics.selectionAsync().catch(() => {}); setOverrides((o) => ({ ...o, [t.key]: t.pv as number })); }}
                              activeOpacity={0.85} accessibilityRole="button">
                              <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
                              <Text style={s.fixPrimaryText}>Use {t.raw} from your paper book</Text>
                            </TouchableOpacity>
                            <Text style={s.fixHint}>
                              {bfKey(t.key) ? `Backfill missing hours is updated when you ${variant === 'edit' ? 'save' : 'create the logbook'}, so your statistics match too.`
                                : 'Used in this logbook. Your statistics keep the hours Blades has.'}
                            </Text>
                          </>
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

            {!drone && sources.length > 0 && (
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

        {/* ═══ 5 · Kontrollera och skapa (ny bok) · Översikten (ändra) ═══ */}
        {step === 'ready' && (
          <View style={{ gap: 18 }}>
            {variant === 'edit' ? (
              <>
                <View style={{ gap: 8 }}>
                  <Text style={s.label}>Name</Text>
                  <TextInput style={s.nameInput} value={name} onChangeText={setName} placeholder={edit?.name} placeholderTextColor={Colors.textMuted}
                    maxLength={40} returnKeyType="done" autoCorrect={false} accessibilityLabel="Logbook name" />
                </View>
                {readySpread && (
                  <View style={s.labelRow}>
                    <Text style={s.label}>Page {readySpread.page_left}–{readySpread.page_right}</Text>
                    <Text style={s.labelHint}>{dirty ? 'With your changes' : 'As it is now'}</Text>
                  </View>
                )}
              </>
            ) : placing || variant === 'first' ? (
              <Head title={`This is page ${leftPage}–${leftPage + 1}`}
                lead={`It should look like the same pages in your ${variant === 'another' ? 'new logbook' : 'paper book'}. Swipe to see the right-hand page.`} />
            ) : (
              <Head title={`Your new logbook starts on page ${fp}`}
                lead={`Brought forward carries your totals over from ${prevBook?.name}. Swipe to see the right-hand page.`} />
            )}
            {readySpread ? (
              <SpreadSwipe spread={readySpread} template={bookTpl} timeFormat={timeFormat} width={contentW} pilotName={pilotName} />
            ) : <ActivityIndicator color={Colors.primary} />}
            <View style={s.card0}>
              {sumRows.map((x, i) => (
                <View key={x.label} style={[s.sumRow, i > 0 && s.sep]}>
                  <Ionicons name={x.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={19} color={x.ok ? Colors.success : Colors.warning} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={s.sumLabel}>{x.label}</Text>
                    <Text style={s.sumValue}>{x.value}</Text>
                  </View>
                  {!!x.to && (
                    <TouchableOpacity onPress={() => { if (x.size) setSizeOpen(true); if (x.to) go(x.to); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${x.action ?? 'Change'} ${x.label.toLowerCase()}`}>
                      <Text style={s.changeText}>{x.action ?? 'Change'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
            {variant === 'edit' && existing.length > 1 && (
              <View style={{ alignItems: 'center', gap: 6, paddingTop: 2 }}>
                <TouchableOpacity onPress={removeBook} disabled={saving} hitSlop={8} accessibilityRole="button" style={[s.deleteBtn, delArmed && s.deleteBtnOn]}>
                  <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                  <Text style={s.deleteText}>{delArmed ? `Tap again to delete ${edit?.name}` : 'Delete this logbook'}</Text>
                </TouchableOpacity>
                <Text style={[s.fixHint, { textAlign: 'center' }]}>Your flights stay in Blades. They move to your other {existing.length > 2 ? 'logbooks' : 'logbook'}.</Text>
              </View>
            )}
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
          <Text style={s.sheetTitle}>{variant === 'edit' ? 'Which flight do you want to place?' : 'Which flight did you write last?'}</Text>
          <Text style={s.sheetSub}>{variant === 'edit'
            ? 'Pick one you can find in your paper book, then set its page and row.'
            : 'The ones after it aren’t in your paper book yet. Blades shows which rows they go in.'}</Text>
          <View style={{ gap: 6 }} accessibilityRole="radiogroup">
            {bookFlights.slice(Math.max(0, origin.base - 7), origin.base + 1).reverse().map((f, i) => {
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
          <TouchableOpacity style={s.cta} onPress={() => { if (flightPick !== back) setPosTouched(true); setBack(flightPick); setSheet(null); }} accessibilityRole="button">
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

function BookSize({ open, fixed, onToggle, rows, fp, lp, onRows, onFp, onLp, summary }: {
  open: boolean; fixed?: boolean; onToggle: () => void; rows: number; fp: string; lp: string;
  onRows: (n: number) => void; onFp: (v: string) => void; onLp: (v: string) => void; summary: string;
}) {
  return (
    <View style={s.card0}>
      <TouchableOpacity style={s.collapseHead} onPress={onToggle} disabled={fixed} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.label, { fontSize: 14 }]}>Book size</Text>
          <Text style={s.choiceSub}>{summary}</Text>
        </View>
        {!fixed && <Text style={s.changeText}>{open ? 'Done' : 'Change'}</Text>}
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
  infoText: { fontSize: 12.5, lineHeight: 18, color: '#A9C3DB' },
  nameInput: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: '#1F4468', backgroundColor: '#0D1B33', color: Colors.textPrimary, fontFamily: FONT_SERIF, fontSize: 20, fontWeight: '600', paddingHorizontal: 14 },
  choiceIcon: { width: 70, height: 48, borderRadius: 5, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '40', alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  deleteBtnOn: { borderColor: Colors.danger + '80', backgroundColor: Colors.danger + '1A' },
  deleteText: { fontSize: 14.5, fontWeight: '700', color: Colors.danger },

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
  fixPrimary: { height: 50, borderRadius: 13, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  fixPrimaryText: { color: Colors.textInverse, fontSize: 16, fontWeight: '800' },
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
