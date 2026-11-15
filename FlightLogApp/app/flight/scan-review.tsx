import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Pressable, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Animated, Easing, Keyboard, useWindowDimensions, Platform, Dimensions, AppState,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors } from '../../constants/colors';
import { canUseLiquidGlass } from '../../utils/liquidGlass';
import { ocrScanPage, getActiveBookLayout, OCR_MODEL, type AircraftDetection, type PageContext } from '../../services/ocr';
import {
  getScanBatch, clearScanImage, getScanUseBookLayout, getScanTimeBasis, setScanTimeBasis, getScanFocus, setScanFocus, takeScanBookSession, getScanFromOnboarding, setScanFromOnboarding,
  type TimeBasis, type ScanFocus, type ScanBookSession,
} from '../../store/scanStore';
import { useScanBookStore } from '../../store/scanBookStore';
import { loadScanFormat, saveScanFormat, formatToLayout, type ScanFormat } from '../../services/scanFormat';
import { applyValueRules, undoValueRule, noteAnswer, ruleFor, ruleClassOf, upper, type ValueRule, type RuleStash } from '../../services/scanValueRules';
import { resolveNames, nameKey } from '../../services/scanNames';
import { checkRegistrations, type RegCheck } from '../../services/scanRegistrations';
import { prepareSpread, mediaTypeOf } from '../../services/scanPrepare';
import { resolveScanTypes, typeKey, isVariant, maybeSameType, type TypeGroup, type FleetInfo } from '../../services/scanTypes';
import { distinctVariants, familyName } from '../../services/aircraftFamily';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { formatTimeValue } from '../../hooks/useTimeFormat';
import type { TimeFormat } from '../../store/timeFormatStore';
import { useFlightStore } from '../../store/flightStore';
import { isTokenQuotaError, openCoinShop, showMonthlyTokenLimitAlert, scanReach } from '../../utils/tokenGate';
import { requestScanPass } from '../../services/scanPass';
import { landingCandidates, decideLandings, decideBySecondLook, landingQuestion } from '../../services/scanLandings';
import { secondLookLandings } from '../../services/scanSecondLook';
import { HAND_FIELDS, digitSwaps, recordCorrection, activePairs, handwritingHint, handwritingSweep, emptyProfile, type HandwritingProfile, type HandFix, type HandSuggestion } from '../../services/scanHandwriting';
import { coinShopAvailable } from '../../services/coinPacks';
import { presentPaywall } from '../../services/purchases';
import { getAllAircraftTypes, getFleetRegistrationTypes, getSecondPilotCounts, addAircraftTypeToRegistry, updateAircraftCruiseSpeed, updateAircraftEndurance, getSetting, setSetting, deleteFlights } from '../../db/flights';
import type { ClashChoice } from '../../components/import/ImportReport';
import { lookupAircraft } from '../../services/aircraftLookup';
import { ScanReport, type CellState } from '../../components/scan/ScanReport';
import { ScanProgress, type ScanPhase } from '../../components/scan/ScanProgress';
import { FlightEditor } from '../../components/scan/FlightEditor';
import { LogbookCrossRef } from '../../components/scan/LogbookCrossRef';
import { ScanReportSimple, type SimpleIssue } from '../../components/scan/ScanReportSimple';
import { saveScannedTemplate } from '../../services/logbook/bookFromScan';
import { similarAirports } from '../../services/placeSuggest';
import { enrichFleetInBackground } from '../../services/fleetEnrich';
import { useFleetDoneStore } from '../../components/FleetDoneModal';
import { emptyAircraftInput, type AircraftInput } from '../../components/scan/NewAircraftCard';
import { saveLearnedMapping } from '../../db/ocrLearned';
import {
  label, display, parseInput, inputValue, shapeInput, DURATION, CLOCK, PLACE, COUNT, UPPER, CHOICES, chipKey,
} from '../../services/scanFields';
import {
  prepareFlight, findUnknownIcaos, flagUnknownIcaos, saveScanRows, saveLearnedCorrections, matchScanRows, EMPTY_SCAN_MATCH, type ScanMatch, columnTotals,
  detectTimeAddition, fitsTimeAddition, checkRowSequence, checkLandingPairs, reconcileSimColumn, typicalRowsPerPage, reconcileAddition,
  rowsMatchBlockTimes, pageTotalsPointAt, findExtraRow, headerNamesPilot, applyPilotNamesFromRemarks, screenSecondPilots, withoutRemarks, type ScanRow,
} from '../../services/scanImport';
import { mergeScan, ledgerStatus, type PaperFix, type LedgerSpread } from '../../services/scanPaperFixes';
import { loadLedger, saveLedger } from '../../services/paperLedger';
import { PaperFixGuide } from '../../components/scan/PaperFixGuide';
import { GlassDialog, DialogIcon, dialogStyles } from '../../components/GlassDialog';
import { FocusDialog, type FocusEstimate } from '../../components/scan/FocusDialog';
import {
  buildPageGrid, cellRect, rowRect, rowBand, mappedBoxRect, unionRect, hitTest, columnFor, type PageGrid, type Rect,
} from '../../services/scanGeometry';
import {
  alignGrid, chooseBookGrid, type BookColumns, type AlignRow, completeGridFromHeaders, untangleColumns, crossCheckCounts, measureRows, relocateColumnsByValues, reconcileSimSpill, pageTotalsByVision, columnMovePlan, landingAgreement, type ColumnMove, type VisionBox,
} from '../../services/scanAlign';
import type { LogbookLayout } from '../../services/logbookLayout';
import type { OcrFlightResult } from '../../types/flight';

// Granskning av skannade loggbokssidor. Loggboken i helskärm (liggande) överst; Claude ringar in det den
// är osäker på, och under boken står frågan med förslag. Ett problem i taget. Man kan också trycka på
// vilket värde som helst i boken och rätta det.
//
// Två sätt att granska:
//  - frågorna (som ovan, stående): Claude ställer en fråga i taget
//  - helskärm (liggande, knappen till vänster om ögat): bara boken. Ögat (på från början) lägger det appen har
//    läst över sidan, färgat efter hur säker läsningen är (svart = säker, gul = osäker, röd = mycket osäker),
//    och sidans summor. Ett tryck på en cell visar vad appen tror är rätt och låter en ändra, med samma regler
//    som frågorna; den valda cellens läsning släcks så att handstilen syns, och rutan visar ett utsnitt av den.
//
// Före läsningen letar Apple Vision (on-device) upp boken i fotot och bilden beskärs till den. Efter
// läsningen matchas Claudes värden mot Visions ord, så att ringarna hamnar exakt (services/scanAlign.ts).

// Felet för ett uppslag som inte lästs för att Blade-coinsen tog slut (fotot finns kvar).
const OUT_OF_COINS = 'OUT_OF_COINS';

const PANEL_H = 296;       // frågepanelen under boken (stående)
const COMPACT_H = 92;      // redigeringsraden ovanför tangentbordet (etikett + fält)
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ── Granskningspunkter ───────────────────────────────────────────────────────

type IssueKind = 'value' | 'choice' | 'mismatch' | 'remark' | 'aircraft' | 'row' | 'group' | 'column' | 'addition';
interface Suggestion { label: string; field: string; value: string; toSim?: string }   // toSim = fältet tiden flyttas från
interface Issue {
  id: string;
  kind: IssueKind;
  page: number;
  rowKey: string;
  field: string;
  title: string;
  reason: string;
  confidence?: number;
  suggestions: Suggestion[];
  readAs?: string;   // Claude läste något som inte kan vara ett värde (klockslaget 07:80); cellen är tömd
  rect: Rect | null;
  aircraft?: { asWritten: string; resolved: string };
  group?: { key: string; members: string[]; rects: Rect[]; sims?: { rowKey: string; sg: Suggestion }[]; remarks?: boolean };   // samma fråga på flera rader
  alsoRows?: string[];   // "New registration": alla rader med samma läsning (frågan står på den första)
  moves?: { side: 'left' | 'right'; field: string }[];   // "fel kolumn": grannkolumnerna värdet kan flyttas till
  // radsumma mot sidans summa; cells = cellfrågorna som ställs före kolumnens (se sumCell)
  column?: { sum: number; printed: number; miscounted: boolean; extraRow?: { key: string; rowIndex: number }; move?: ColumnMove; cells?: string[] };
  // Cellen står i en kolumn vars summa inte går ihop. 'explains' = ett rimligt värde i just den här cellen får
  // kolumnen att gå ihop (frågas först i kolumnen); 'suspect' = Claude var osäker på cellen.
  sumCell?: 'explains' | 'suspect';
}

// Grannkolumnerna (vänster/höger) till ett tal i boken, av samma slag (tid ↔ tid, antal ↔ antal). Från
// rutnätet när det finns, annars dag ↔ natt för landningar. Kolumnerna står tätt, så Claude (eller rutnätet)
// tar lätt fel på en.
const SIBLINGS: Record<string, { side: 'left' | 'right'; field: string }[]> = {
  landings_day: [{ side: 'right', field: 'landings_night' }],
  landings_night: [{ side: 'left', field: 'landings_day' }],
};
function neighbourColumns(grid: PageGrid | null, field: string): { side: 'left' | 'right'; field: string }[] {
  const kind = DURATION.has(field) ? DURATION : COUNT.has(field) ? COUNT : null;
  if (!kind) return [];
  const cols = (grid?.columns ?? []).filter((c) => c.field).slice().sort((a, b) => a.left - b.left);
  const idx = cols.findIndex((c) => c.field === field);
  if (idx < 0) return SIBLINGS[field] ?? [];
  const out: { side: 'left' | 'right'; field: string }[] = [];
  const l = cols[idx - 1], r = cols[idx + 1];
  if (l?.field && kind.has(l.field) && l.field !== field) out.push({ side: 'left', field: l.field });
  if (r?.field && kind.has(r.field) && r.field !== field) out.push({ side: 'right', field: r.field });
  return out;
}

type PageStatus = 'waiting' | 'finding' | 'reading' | 'done' | 'error';
interface PageState {
  mediaType: 'image/jpeg' | 'image/png';
  uri: string;            // bilden som fil (file://) — läses som base64 först när Claude ska läsa den
  width: number;
  height: number;
  cropped: boolean;
  oriented: boolean;
  prepared: boolean;      // redan förberedd (locate letar inte upp boken igen)
  wordsUri?: string;      // förberedd i "Scan your whole logbook": Visions ord, Claudes sparade läsning och
  readUri?: string;       // sidnumren uppslaget bör ha
  expected?: { left: number; right: number | null };
  status: PageStatus;
  error?: string;
  grid: PageGrid | null;
  pageNumbers: { left: number | null; right: number | null };
  detections: AircraftDetection[];
  totals: { brought_forward: number | null; total_this_page: number | null; total_to_date: number | null; by_field?: Record<string, number> } | null;
}

type PageRead = Awaited<ReturnType<typeof ocrScanPage>>;

// Det som står i bokens cell. Ett simulatorpass sparas med passets längd som total tid (appens modell), men i
// boken står tiden i simulatorkolumnen och "Total time of flight" är tom — visas som SIM där.
// Nya flödet (2026-11-13): efter skanningen direkt till Scan report (ScanReportSimple) — ingen handpåläggning
// (frågepanelen) först. Det osäkra visas på flygningarnas kort och i uppslagen i helskärm. false = det gamla
// flödet med granskningen och den gamla rapporten, som finns kvar orört.
const SKIP_REVIEW = true;
// Fälten i Edit flight (FlightEditor) som kan vara osäkra → röda där (nya flödet läser samma läge som boken).
const EDITOR_FIELDS = ['date', 'aircraft_type', 'registration', 'multi_pilot', 'single_pilot', 'second_pilot', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc',
  'sim', 'sim_category', 'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'nvg', 'landings_day', 'landings_night', 'remarks'];

const SIM_MARK = 'SIM';
function bookCell(d: OcrFlightResult, field: string, fmt: TimeFormat): string {
  if (field === 'total_time' && d.flight_type === 'sim') return SIM_MARK;
  return display(d, field, fmt);
}

// Vem man flög med, ur anmärkningen: samma roller som Log Flight (nyckeln COP = SIC), här utskrivna helt.
const CREW_ROLES = [
  { key: 'PIC', label: 'Pilot in command' },
  { key: 'COP', label: 'Second in command' },
  { key: 'FI', label: 'Flight instructor' },
  { key: 'SPIC', label: 'Student pilot in command' },
  { key: 'PICUS', label: 'PIC under supervision' },
];
const BY_FLIGHT = 'by_flight';   // gruppfrågan: PIC eller SIC per flygning
const ownPic = (d: OcrFlightResult) => (parseFloat(String(d.pic ?? '0')) || 0) > 0;
// Utan egen PIC-tid var den andra piloten PIC; med egen PIC-tid kan den andra inte vara PIC → SIC.
const defaultCrewRole = (d: OcrFlightResult) => (ownPic(d) ? 'COP' : 'PIC');
const crewRoleFor = (d: OcrFlightResult, role: string) => (role === BY_FLIGHT ? defaultCrewRole(d) : role === 'PIC' && ownPic(d) ? 'COP' : role);

// Anmärkningen utan det som flyttats till ett annat fält ("SZ, NDB" − "SZ" → "NDB").
const withoutSuggestion = (remarks: string | undefined, moved: string) =>
  (remarks ?? '').replace(moved, '').replace(/^[\s,;:/.-]+/, '').replace(/\s{2,}/g, ' ').trim();

// Klockslag ± timmar (över midnatt).
const shiftClock = (t: string, h: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return '';
  const x = (((Number(m[1]) * 60 + Number(m[2]) + Math.round(h * 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

// Användarens fokus (valet innan granskningen, FocusDialog) avgör vilka frågor som är värda att ställa:
//  exact    – allt Claude är osäker på
//  balanced – kärndata (datum, typ, registrering, platser), simulator och nya typer; osäkra siffror bara när
//             kolumnen inte går ihop med sidans summa
//  totals   – kolumner som inte går ihop, och osäkra siffror i just de kolumnerna
// En siffra i en kolumn som saknar summa att jämföra med frågas alltid om.
const CORE_FIELDS = new Set(['date', 'aircraft_type', 'registration', 'dep_place', 'arr_place', 'sim_category', 'other_time_role']);
function worthAsking(i: Issue, focus: ScanFocus, colOk: Map<string, boolean>): boolean {
  if (focus === 'exact' || i.kind === 'column' || i.readAs) return true;   // en omöjlig läsning är alltid fel
  if (i.kind === 'value' || i.kind === 'choice') {
    if (i.field === 'sim') return true;   // flygning eller simulator avgör vilken summa tiden hamnar i
    if (i.field === 'registration') return true;   // en felläst registrering blir ett nytt luftfartyg i Fleet
    if (DURATION.has(i.field) || COUNT.has(i.field)) return colOk.get(`${i.page}|${i.field}`) !== true;
    return focus === 'balanced' && CORE_FIELDS.has(i.field);
  }
  if (i.kind === 'aircraft') return focus === 'balanced';
  return false;                           // tider som inte går ihop, anmärkningar, "kolla raden"
}

// Uppskattningen i "What matters most to you?" (FocusDialog). Tid: sekunder per fråga efter slag, plus
// en stund i rapporten. Träffsäkerhet ur benchmarken (16 uppslag mot facit, 2026-11-01): ~1 % av värdena
// är fel utan att någon fråga pekar på dem, och ungefär var fjärde fråga gäller ett verkligt fel — det
// man inte får frågor om blir kvar. Värden per rad: de 15 som benchmarken jämför.
const QUESTION_SECONDS: Record<IssueKind, number> = { value: 6, choice: 6, mismatch: 10, remark: 8, aircraft: 15, row: 10, group: 12, column: 25, addition: 8 };
const REPORT_SECONDS = 20;
const SILENT_ERROR_RATE = 0.0099;
const ERROR_PER_QUESTION = 0.24;
const VALUES_PER_ROW = 15;

// addition: bokens tillägg på flygtiden — bekräftat (accepted) eller upptäckt i raderna (candidate).
function deriveIssues(
  rows: ScanRow[], pages: PageState[], known: Set<string>, expanded: Set<string>,
  addition: { accepted: number | null; candidate: { hours: number; rows: number } | null },
  focus: ScanFocus = 'exact',
  placeAlts: Record<string, string[]> = {},
  realRows: Set<string> = new Set(),   // kolumnfrågor där den misstänkta dubbelraden är en riktig flygning
  typeGroups: TypeGroup[] = [],        // flygplanstyperna, ihopslagna och kontrollerade mot flottan
  typeChoice: Record<string, string> = {},
  wordsOf: (page: number) => VisionBox[] = () => [],   // Visions ord per uppslag (för värden i grannkolumnen)
  inLogbook: Set<string> = new Set(),  // rader som redan finns i loggboken (lämnas utanför): inga frågor om dem
  regChecks: RegCheck[] = [],          // skanningens registreringar mot flottan (services/scanRegistrations.ts)
): Issue[] {
  const out: Issue[] = [];
  const add = addition.accepted;
  for (const row of rows) {
    if (row.skip || inLogbook.has(row.key)) continue;
    const grid = pages[row.page]?.grid ?? null;
    const d = row.data;
    const cell = (f: string) => (grid ? cellRect(grid, row.rowIndex, f) : null);
    const whole = grid ? rowRect(grid, row.rowIndex) : null;

    // Den skrivna totaltiden bekräftas av en annan tidskolumn på raden (t.ex. Dual eller Night = total): då har
    // Claude läst handstilen rätt, och att avgång/ankomst ger en annan tid (blocktid, rotorn igång) är ingen fråga.
    const nOf = (f: string) => parseFloat(String((d as any)[f] ?? '').replace(',', '.')) || 0;
    const totalW = nOf('total_time');
    const corroborated = d.flight_type !== 'sim' && totalW > 0
      && ['pic', 'co_pilot', 'dual', 'instructor', 'night', 'ifr', 'multi_pilot', 'single_pilot'].some((f) => Math.abs(nOf(f) - totalW) < 0.05);
    const TIMES_REASON = /time|dep|arr|block|clock|duration|suggest|add up|match/i;
    const seenFields = new Set<string>();
    for (const raw of d.field_issues ?? []) {
      // Simulatorpass: tiden står i simulatorkolumnen (total_time är tom i boken), men appen sparar den även som
      // total_time. En osäker total_time på ett simulatorpass frågas därför som simulatortid, med cellen där
      // värdet står — när rutnätet har en simulatorkolumn.
      const fi = d.flight_type === 'sim' && raw.field === 'total_time' && grid && columnFor(grid, 'sim') ? { ...raw, field: 'sim' } : raw;
      if (seenFields.has(fi.field)) continue;
      seenFields.add(fi.field);
      if (fi.field === 'remarks' && d.remarks_suggestion) continue;
      if (fi.field === 'sim_category') continue;   // simulatortyp frågas inte (FFS som standard)
      if ((fi.field === 'dep_utc' || fi.field === 'arr_utc') && d.time_mismatch) continue;
      // Lägre osäkerhetsgräns: Claude flaggar allt under 0.85; bara under 0.7 blir en fråga, om inte Claude läst
      // något annat (read_as) eller föreslår ett annat värde. Appens egna kontroller har låg confidence och följer med.
      const curVal = String((d as any)[fi.field] ?? '').trim().toUpperCase();
      const otherSuggestion = !!fi.suggested_value && String(fi.suggested_value).trim().toUpperCase() !== curVal;
      if ((fi.confidence ?? 0) >= 0.7 && !fi.read_as && !otherSuggestion) continue;
      // Bekräftad totaltid: inga frågor om tiden eller klockslagen bara för att avgång/ankomst ger en annan tid.
      if (corroborated && !fi.read_as && TIMES_REASON.test(fi.reason || '')
        && (CLOCK.has(fi.field) || (DURATION.has(fi.field) && Math.abs(nOf(fi.field) - totalW) < 0.05))) continue;
      const choice = !!CHOICES[fi.field];
      const suggestions: Suggestion[] = [];
      if (fi.field === 'sim' && fi.from && fi.suggested_value) suggestions.push({ label: 'Yes, simulator session', field: 'sim', value: fi.suggested_value, toSim: fi.from });
      else if (DURATION.has(fi.field) && /sim|fstd|synthetic/i.test(fi.reason) && d.flight_type !== 'sim') {
        const v = String((d as any)[fi.field] ?? '');
        if ((parseFloat(v) || 0) > 0) suggestions.push({ label: 'It is simulator time', field: 'sim', value: v, toSim: fi.field });
      }
      else if (fi.suggested_value && !choice) suggestions.push({ label: fi.suggested_value, field: fi.field, value: fi.suggested_value });
      for (const v of fi.options ?? []) if (!suggestions.some((x) => x.value === v)) suggestions.push({ label: v, field: fi.field, value: v });
      if (fi.field === 'dep_place' || fi.field === 'arr_place') {
        // Liknande flygplatser (en förväxlingsbar bokstav, t.ex. ETNB → ETHB), högst fyra, och ZZZZ sist.
        const cur = String((d as any)[fi.field] ?? '').toUpperCase();
        for (const alt of placeAlts[cur] ?? []) {
          if (alt !== cur && !suggestions.some((x) => x.value.toUpperCase() === alt)) suggestions.push({ label: alt, field: fi.field, value: alt });
        }
        suggestions.splice(4);
        suggestions.push({ label: 'ZZZZ', field: fi.field, value: 'ZZZZ' });
      }
      out.push({
        id: `${row.key}:f:${fi.field}`, kind: choice ? 'choice' : 'value', page: row.page, rowKey: row.key,
        field: fi.field, title: label(fi.field), reason: fi.reason, confidence: fi.confidence || undefined, readAs: fi.read_as,
        // Cellen först: den är justerad mot Visions ord. Claudes egen ruta bara när fältet saknar kolumn.
        suggestions, rect: cell(fi.field) ?? mappedBoxRect(fi.box, grid) ?? whole,
        moves: choice ? undefined : neighbourColumns(grid, fi.field),
      });
    }

    // Med bokens bekräftade tillägg (t.ex. +0.2 h) stämmer raden → ingen fråga.
    const addFits = add != null && !!d.time_mismatch && fitsTimeAddition(d, add);
    if (d.time_mismatch && !addFits && !corroborated) {
      const tm = d.time_mismatch;
      // Med tillägget ska avgång → ankomst vara total minus tillägget.
      const air = add != null ? Math.round(Math.max(0, tm.anchor_total_h - add) * 10) / 10 : tm.anchor_total_h;
      const arrIf = add != null ? shiftClock(tm.read_dep, air) : tm.computed_arr_if_dep_correct;
      const depIf = add != null ? shiftClock(tm.read_arr, -air) : tm.computed_dep_if_arr_correct;
      out.push({
        id: `${row.key}:mismatch`, kind: 'mismatch', page: row.page, rowKey: row.key, field: 'dep_utc',
        title: "Times don't add up",
        reason: `The flight time is ${tm.anchor_total_h} h${add != null ? ` (${air} h + ${add} h)` : ''}, but departure ${tm.read_dep} and arrival ${tm.read_arr} don't match it. Which one is right?`,
        suggestions: [
          { label: `Departure ${tm.read_dep} is right`, field: 'arr_utc', value: arrIf },
          { label: `Arrival ${tm.read_arr} is right`, field: 'dep_utc', value: depIf },
        ].filter((s) => s.value),
        rect: unionRect([cell('dep_utc'), cell('arr_utc')]) ?? whole,
      });
    }

    if (d.remarks_suggestion) {
      const rs = d.remarks_suggestion;
      out.push({
        id: `${row.key}:remark`, kind: 'remark', page: row.page, rowKey: row.key, field: 'remarks',
        title: 'Something in the remarks',
        reason: rs.field === 'second_pilot'
          ? rs.confidence < 0.6
            ? `"${rs.original_text}" looks like the name of the pilot you flew with, but Claude isn't sure of the reading. Check it, choose their role and save.`
            : `"${rs.original_text}" in the remarks looks like who you flew with. Choose their role and save.`
          : `"${rs.original_text}" looks like the ${label(rs.field).toLowerCase()}: ${rs.value}. Move it there?`,
        confidence: rs.confidence,
        suggestions: [{ label: 'Yes, move it', field: rs.field, value: rs.value }],
        rect: cell('remarks') ?? whole,
      });
    }

    // Ingen fråga om "hela raden": utan ett bestämt fält kan användaren inte göra något med den (och
    // Claude skrev ibland om fotot, t.ex. "rows slightly offset in photo"). Varje osäkerhet ska vara ett fält.
  }

  // Nya flygplanstyper (finns inte i flottan) → en fråga per typ, där den först står. Skrivsätt som är samma
  // luftfartyg ("EC135", "EC135T1", "EC35") är redan ihopslagna, så svaret gäller alla deras rader.
  for (const g of typeGroups) {
    if (g.fleet || known.has(g.suggested)) continue;
    const keys = new Set(g.members.map((m) => m.key));
    const target = rows
      .filter((r) => !r.skip && keys.has(typeKey(r.original.aircraft_type || r.data.aircraft_type)))
      .sort((a, b) => a.page - b.page || a.rowIndex - b.rowIndex)[0];
    if (!target) continue;
    const p = pages[target.page];
    const written = g.members.map((m) => m.display);
    const similar = [...known].filter((k) => g.members.some((m) => isVariant(k, m.key) || (k.startsWith(m.key.slice(0, 2)) && k !== m.key))).slice(0, 3);
    const chosen = g.members.map((m) => typeChoice[m.key]).find(Boolean);
    const code = g.designator ? ` Claude thinks it's ${g.designator}.` : '';
    out.push({
      id: `ac:${g.id}`, kind: 'aircraft', page: target.page, rowKey: target.key, field: 'aircraft_type',
      title: 'New aircraft type',
      reason: written.length > 1
        ? `Written as ${written.slice(0, -1).join(', ')} and ${written[written.length - 1]} on ${g.rows} rows — one aircraft.${code} Your answer applies to all of them.`
        : `Written as "${written[0]}"${g.rows > 1 ? ` on ${g.rows} rows` : ''}.${code} Your answer applies to every row with the same entry.`,
      confidence: undefined,
      suggestions: [...new Set([g.suggested, ...written, ...(g.designator ? [g.designator] : []), ...similar])]
        .map((t) => ({ label: t, field: 'aircraft_type', value: t })),
      rect: p?.grid ? cellRect(p.grid, target.rowIndex, 'aircraft_type') ?? rowRect(p.grid, target.rowIndex) : null,
      aircraft: { asWritten: g.id, resolved: chosen ?? g.suggested },
    });
  }

  // Nya registreringar (finns inte i flottan) och registreringar med en vanligare tvilling i flottan (KIL031
  // bredvid KILO31) → en fråga per läsning, där den först står. Svaret gäller alla
  // rader med samma läsning (en regel direkt, se learnAnswer). Claudes egna frågor om samma celler går upp i
  // den här, och deras förslag följer med.
  const everyRow = new Map(rows.map((r) => [r.key, r]));
  for (const c of regChecks) {
    if (!c.ask) continue;
    const first = everyRow.get(c.rows[0]);
    if (!first) continue;
    const grid = pages[first.page]?.grid ?? null;
    const own = new Set(c.rows.map((k) => `${k}:f:registration`));
    const fromClaude: string[] = [];
    for (let k = out.length - 1; k >= 0; k--) {
      if (!own.has(out[k].id)) continue;
      for (const sg of out[k].suggestions) if (sg.field === 'registration') fromClaude.push(upper(sg.value));
      out.splice(k, 1);
    }
    const options = [...new Set([...c.similar, ...fromClaude])].filter((v) => v && v !== c.reg).slice(0, 4);
    const n = c.rows.length;
    out.push({
      id: `reg:${c.reg}`, kind: 'value', page: first.page, rowKey: first.key, field: 'registration',
      title: c.isNew ? 'New registration' : 'Check the registration',
      reason: c.isNew
        ? `${c.reg} isn't in your Fleet${n > 1 ? ` and stands on ${n} rows` : ''}.${c.twin ? ` It looks like ${c.twin} written another way.` : ''} Check it against the page.${n > 1 ? ` Your answer applies to every row with ${c.reg}.` : ''}`
        : `${c.reg} and ${c.twin} are both in your Fleet and look like one aircraft written two ways. Which one is on the page?${n > 1 ? ` Your answer applies to every row with ${c.reg}.` : ''}`,
      suggestions: options.map((v) => ({ label: v, field: 'registration', value: v })),
      rect: grid ? cellRect(grid, first.rowIndex, 'registration') ?? rowRect(grid, first.rowIndex) : null,
      alsoRows: c.rows,
    });
  }

  // Kolumner vars radsumma inte stämmer med sidans "Total this page" → hela kolumnen ringas in. Pekar allt på
  // att det är summan i pappersboken som räknats fel (flygningarna stämmer med blocktiderna, eller sidans
  // övriga summor går ihop med raderna) och Claude inte var osäker i kolumnen, sägs det rakt ut.
  pages.forEach((p, pageIdx) => {
    if (p.status !== 'done' || !p.grid) return;
    const totals = columnTotals(rows, pageIdx, p.totals?.by_field);
    // Värden lästa i grannkolumnen: en kolumn har exakt så mycket för mycket som grannen saknar (t.ex. Dual som
    // egentligen står under Co-pilot). Vision avgör vilka rader; båda kolumnernas frågor erbjuder flytten först.
    const moves: ColumnMove[] = [];
    for (const c of totals) {
      if (c.ok || c.sum <= c.printed) continue;
      for (const n of neighbourColumns(p.grid, c.field)) {
        const plan = columnMovePlan(rows.filter((r) => r.page === pageIdx), p.totals?.by_field, p.grid, wordsOf(pageIdx), c.field, n.field, n.side);
        if (plan) { moves.push(plan); break; }
      }
    }
    for (const c of totals) {
      if (c.ok) continue;
      const col = columnFor(p.grid, c.field);
      const first = rows.find((r) => r.page === pageIdx && !r.skip);
      if (!first) continue;
      const count = c.field.startsWith('landings');
      const fmt = (n: number) => (count ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
      const diff = Math.round((c.printed - c.sum) * 100) / 100;
      const move = moves.find((m) => m.from === c.field || m.to === c.field);
      // En rad som lästs två gånger går före allt annat (den räknas men syns knappt).
      const extra = move || realRows.has(`col:${pageIdx}:${c.field}`) ? null : findExtraRow(rows, pageIdx, c.field, diff, p.grid.rowsPerPage);
      const tooMany = rows.filter((r) => r.page === pageIdx && !r.skip).length > p.grid.rowsPerPage;
      const uncertain = out.some((i) => (i.kind === 'value' || i.kind === 'group') && i.page === pageIdx && i.field === c.field);
      const blocks = c.field === 'total_time' && diff < 0 && rowsMatchBlockTimes(rows, pageIdx);
      const miscounted = !move && !extra && !tooMany && !uncertain && (blocks || pageTotalsPointAt(rows, pageIdx, c.field, p.totals?.by_field));
      const off = `${fmt(Math.abs(diff))}${count ? (Math.abs(diff) === 1 ? ' landing' : ' landings') : ' h'} ${diff < 0 ? 'short' : 'over'}`;
      const n = move?.keys.length ?? 0;
      const where = move?.evidence === 'vision' ? `on the page ${n === 1 ? 'it stands' : 'they stand'} under ${label(move.to)}` : `${n === 1 ? 'it probably belongs' : 'they probably belong'} under ${label(move?.to ?? '')}`;
      // Cellerna före kolumnen: en summa som inte går ihop beror nästan alltid på en eller ett par fellästa celler,
      // och det är dem användaren kan kontrollera mot boken. Varje cell Claude var osäker på i kolumnen frågas
      // för sig (även på rader som redan finns i loggboken, de räknas i summan), med värdet som får kolumnen att
      // gå ihop som förslag. Har kolumnen för mycket och exakt en rad har just det talet frågas den cellen också.
      const cells: string[] = [];
      if (!move && !extra && !miscounted) {
        const tol = count ? 0.5 : 0.05;
        const inSum = rows.filter((r) => r.page === pageIdx && !r.skip && !(c.field === 'total_time' && r.data.flight_type === 'sim'));
        const num = (r: ScanRow) => parseFloat(String((r.data as any)[c.field] ?? '')) || 0;
        const sumText = `The column adds up to ${fmt(c.sum)}, but the page total says ${fmt(c.printed)}.`;
        const sentence = (t: string) => { const x = (t || '').trim(); return !x ? '' : /[.!?]$/.test(x) ? `${x} ` : `${x}. `; };
        const mark = (issue: Issue, r: ScanRow) => {
          const fix = Math.round((num(r) + diff) * (count ? 1 : 10)) / (count ? 1 : 10);
          const fixOk = fix >= 0 && Math.abs(fix - num(r)) >= tol;
          const own = issue.suggestions.filter((x) => x.field === c.field && !x.toSim);
          const same = (x: Suggestion) => Math.abs((parseFloat(x.value) || 0) - fix) < tol;
          issue.sumCell = fixOk && (fix === 0 || own.some(same)) ? 'explains' : 'suspect';
          if (fixOk) {
            issue.suggestions = [{ label: fix === 0 ? 'Empty' : fmt(fix), field: c.field, value: fmt(fix) }, ...issue.suggestions.filter((x) => !(x.field === c.field && !x.toSim && same(x)))];
            issue.reason = `${sentence(issue.reason)}${sumText} ${fix === 0 ? 'With this cell empty' : `With ${fmt(fix)} here`} it adds up.`;
          } else issue.reason = `${sentence(issue.reason)}${sumText}`;
          cells.push(issue.id);
        };
        for (const r of inSum) {
          const id = `${r.key}:f:${c.field}`;
          const existing = out.find((i) => i.id === id);
          let issue = existing?.kind === 'value' ? existing : undefined;
          // Ingen fråga än (raden finns redan i loggboken och får annars inga frågor) → cellen frågas ändå.
          const fi = !existing ? (r.data.field_issues ?? []).find((x) => x.field === c.field) : undefined;
          if (fi) {
            issue = {
              id, kind: 'value', page: pageIdx, rowKey: r.key, field: c.field, title: label(c.field), reason: fi.reason,
              confidence: fi.confidence || undefined, readAs: fi.read_as,
              suggestions: [...new Set([fi.suggested_value, ...(fi.options ?? [])].filter((v): v is string => !!v))].map((v) => ({ label: v, field: c.field, value: v })),
              rect: cellRect(p.grid!, r.rowIndex, c.field) ?? rowRect(p.grid!, r.rowIndex), moves: neighbourColumns(p.grid, c.field),
            };
            out.push(issue);
          }
          if (issue) mark(issue, r);
        }
        if (diff < 0) {
          const surplus = inSum.filter((r) => num(r) > 0 && Math.abs(num(r) + diff) < tol);
          const r = surplus.length === 1 ? surplus[0] : null;
          const id = r ? `${r.key}:f:${c.field}` : '';
          if (r && !out.some((i) => i.id === id)) {
            out.push({
              id, kind: 'value', page: pageIdx, rowKey: r.key, field: c.field, title: label(c.field), sumCell: 'explains',
              reason: `${sumText} That is exactly the ${fmt(num(r))} on this row too much. Is this cell empty on the page, or does the ${fmt(num(r))} stand in another column?`,
              suggestions: [{ label: 'Empty', field: c.field, value: '0' }],
              rect: cellRect(p.grid, r.rowIndex, c.field) ?? rowRect(p.grid, r.rowIndex), moves: neighbourColumns(p.grid, c.field),
            });
            cells.push(id);
          }
        }
      }
      const pad = 0.008;
      const moveRect = move?.boxes.length ? unionRect(move.boxes.map((b) => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }))) : null;
      out.push({
        id: `col:${pageIdx}:${c.field}`, kind: 'column', page: pageIdx, rowKey: first.key, field: c.field,
        title: extra ? `Row ${extra.rowIndex} may be read twice` : miscounted ? 'Page total looks miscounted' : `${label(c.field)} doesn't add up`,
        reason: move
          ? move.from === c.field
            ? `The rows add up to ${fmt(c.sum)}, but the page total says ${fmt(c.printed)} — and ${label(move.to)} is short by exactly ${fmt(move.amount)}. Claude read ${n} ${n === 1 ? 'time' : 'times'} as ${label(c.field)}, but ${where}.`
            : `The rows add up to ${fmt(c.sum)}, but the page total says ${fmt(c.printed)} — exactly what ${label(move.from)} has too much. Claude read ${n} ${n === 1 ? 'time' : 'times'} as ${label(move.from)}, but ${where}.`
          : extra
          ? `The rows add up to ${fmt(c.sum)} — exactly ${fmt(-diff)} more than the page total (${fmt(c.printed)}). Row ${extra.rowIndex} looks like a copy of the row next to it, so Claude probably read it twice.`
          : miscounted
            ? `${blocks ? 'Every flight matches its block time' : 'Your other page totals agree with the flights'}, and the rows add up to ${fmt(c.sum)} — but the page total says ${fmt(c.printed)}, ${off}. Most likely a counting slip in your paper logbook.`
            : `The rows add up to ${fmt(c.sum)}, but the page total says ${fmt(c.printed)}. One of the values in the column is probably misread. Compare Claude's readings next to the rows with the page and tap the one that's wrong.`,
        suggestions: [],
        // Flytten markerar talen där Vision ser dem (rutnätet kan ligga snett), annars hela kolumnen.
        rect: extra ? rowRect(p.grid, extra.rowIndex)
          : moveRect ?? (col ? { x: col.left, y: p.grid.tableTop, w: col.right - col.left, h: p.grid.tableBottom - p.grid.tableTop } : null),
        column: { sum: c.sum, printed: c.printed, miscounted, extraRow: extra ? { key: extra.key, rowIndex: extra.rowIndex } : undefined, move, cells },
      });
    }
  });

  // Bara frågor som är viktiga för användaren (fokus). Kolumnernas summakoll avgör om en osäker siffra spelar roll.
  if (focus !== 'exact') {
    const colOk = new Map<string, boolean>();
    pages.forEach((p, pageIdx) => {
      if (p.status === 'done') for (const c of columnTotals(rows, pageIdx, p.totals?.by_field)) colOk.set(`${pageIdx}|${c.field}`, c.ok);
    });
    const keep = out.filter((i) => worthAsking(i, focus, colOk));
    out.length = 0;
    out.push(...keep);
  }

  // Samma tillägg på flera rader (t.ex. +0.2 h för helikopter: lyft → landning plus uppstart och avstängning)
  // → en fråga om bokens regel i stället för "Times don't add up" på varje rad.
  const rowOf = new Map(rows.map((r) => [r.key, r]));
  const hidden = new Set<string>();
  const cand = add == null && !expanded.has('addition') ? addition.candidate : null;
  if (cand) {
    pages.forEach((p, pageIdx) => {
      const members = out.filter((i) => i.kind === 'mismatch' && i.page === pageIdx && fitsTimeAddition(rowOf.get(i.rowKey)!.data, cand.hours));
      if (members.length < 2) return;
      members.forEach((m) => hidden.add(m.id));
      const rects = members.map((m) => {
        const r = rowOf.get(m.rowKey)!;
        return unionRect([m.rect, p.grid ? cellRect(p.grid, r.rowIndex, 'total_time') : null]);
      });
      const h = cand.hours;
      out.push({
        id: `add:${pageIdx}`, kind: 'addition', page: pageIdx, rowKey: members[0].rowKey, field: 'total_time',
        title: `Total time is ${h} h more than the times`,
        reason: `On ${members.length} rows the total is departure → arrival + ${h} h. Helicopter flight time runs from rotor start to rotor stop, so many logbooks add ${h} h to lift-off and landing times. Does this book?`,
        suggestions: [{ label: '', field: 'total_time', value: String(h) }], rect: unionRect(rects),
        group: { key: 'addition', members: members.map((m) => m.id), rects: rects.filter((r): r is Rect => !!r) },
      });
    });
  }

  // Initialer först i anmärkningen på många rader (instruktörens/andrepilotens signatur) → EN fråga för hela
  // skanningen i stället för en per rad (99 frågor i en helikopterbok på 16 uppslag).
  const REMARK_KEY = 'remark|second_pilot';
  const remarkMembers = expanded.has(REMARK_KEY) ? [] : out.filter((i) => i.kind === 'remark' && rowOf.get(i.rowKey)?.data.remarks_suggestion?.field === 'second_pilot');
  const groupedRemarks = new Set<string>();
  if (remarkMembers.length >= 2) {
    remarkMembers.forEach((m) => groupedRemarks.add(m.id));
    const first = remarkMembers[0];
    const names = [...new Set(remarkMembers.map((m) => rowOf.get(m.rowKey)?.data.remarks_suggestion?.value).filter(Boolean))];
    out.push({
      id: `grp:${REMARK_KEY}`, kind: 'group', page: first.page, rowKey: first.rowKey, field: 'second_pilot',
      title: `Second pilot on ${remarkMembers.length} rows`,
      reason: remarkMembers.every((m) => (rowOf.get(m.rowKey)?.data.remarks_suggestion?.confidence ?? 1) < 0.6)
        ? `Claude isn't sure how to read these names in the remarks (${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}). Check them, choose their role and save.`
        : `The remarks start with initials (${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}), which look like who you flew with. Choose their role and save them on all ${remarkMembers.length} flights.`,
      suggestions: [], rect: first.rect,
      group: { key: REMARK_KEY, members: remarkMembers.map((m) => m.id), rects: first.rect ? [first.rect] : [], remarks: true },
    });
  }

  // Samma fråga på många rader (t.ex. "1.2+0.2" i varje rad) → en fråga för alla. Nyckeln är fält +
  // förklaring utan siffror. Användaren kan välja att gå igenom dem en i taget (expanded).
  const buckets = new Map<string, Issue[]>();
  for (const i of out) {
    if ((i.kind !== 'value' && i.kind !== 'choice') || !i.reason) continue;
    if (i.id.startsWith('reg:')) continue;   // en fråga per ny registrering, aldrig ihopslagna
    if (i.sumCell) continue;                 // celler i en kolumn som inte går ihop frågas var för sig
    // Val (t.ex. simulatortyp) grupperas på fältet; värden på fält + förklaring.
    const key = i.kind === 'choice' ? `${i.page}|${i.field}|choice` : `${i.page}|${i.field}|${i.reason.toLowerCase().replace(/[^a-zåäö]+/g, ' ').trim()}`;
    if (expanded.has(key)) continue;
    const list = buckets.get(key) ?? [];
    list.push(i);
    buckets.set(key, list);
  }
  const grouped = new Set<string>();
  for (const [key, members] of buckets) {
    if (members.length < (members[0].kind === 'choice' ? 2 : 3)) continue;
    members.forEach((m) => grouped.add(m.id));
    const first = members[0];
    const sims = members.map((m) => ({ rowKey: m.rowKey, sg: m.suggestions.find((x) => x.toSim) }));
    const allSim = sims.every((x) => x.sg);
    out.push({
      id: `grp:${key}`, kind: 'group', page: first.page, rowKey: first.rowKey, field: first.field,
      title: `${label(first.field)} on ${members.length} rows`,
      reason: first.kind === 'choice' ? `${first.reason} The answer applies to all ${members.length} rows.` : `Claude flagged the same thing on ${members.length} rows: "${first.reason}"`,
      suggestions: [], rect: unionRect(members.map((m) => m.rect)),
      group: { key, members: members.map((m) => m.id), rects: members.map((m) => m.rect).filter((r): r is Rect => !!r),
        sims: allSim ? sims.map((x) => ({ rowKey: x.rowKey, sg: x.sg! })) : undefined },
    });
  }

  // Ordningen: kolumn för kolumn från vänster, uppifrån och ned, så att man inte hoppar mellan bokens vänster-
  // och högersida. Kolumnens summa sist i kolumnen: den går ofta ihop när cellerna ovanför är rättade (en
  // överstruken siffra, fel kolumn), och då behövs ingen justering. Bokens tilläggsregel och en dubbelläst rad
  // först, de påverkar hela uppslaget.
  const rank = (i: Issue) => (i.kind === 'addition' ? 0 : i.column?.extraRow ? 1 : 2);
  const colX = (i: Issue) => {
    const grid = pages[i.page]?.grid;
    const col = grid ? columnFor(grid, i.field) : null;
    return col ? col.left : i.rect?.x ?? Number.MAX_SAFE_INTEGER;
  };
  // Cellen som ensam förklarar skillnaden mot sidans summa först i sin kolumn: den är den troligaste felläsningen.
  const rowY = (i: Issue) => (i.kind === 'column' ? Number.MAX_SAFE_INTEGER : i.sumCell === 'explains' ? -1 : rowOf.get(i.rowKey)?.rowIndex ?? 0);
  const ids = new Set(out.map((i) => i.id));
  for (const i of out) if (i.column?.cells) i.column.cells = i.column.cells.filter((id) => ids.has(id));
  return out.filter((i) => !grouped.has(i.id) && !hidden.has(i.id) && !groupedRemarks.has(i.id)).sort((a, b) => Number(b.kind === 'addition') - Number(a.kind === 'addition')
    || a.page - b.page
    || rank(a) - rank(b)
    || colX(a) - colX(b)
    || rowY(a) - rowY(b)
    || (a.rect?.x ?? 0) - (b.rect?.x ?? 0));
}

const contains = (r: Rect, x: number, y: number, pad = 0) =>
  x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

type Selection = { kind: 'issue'; id: string } | { kind: 'cell'; rowKey: string; field: string } | null;

// ── Skärmen ──────────────────────────────────────────────────────────────────

export default function ScanReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { timeFormat } = useTimeFormatStore();
  const { loadFlights, loadStats } = useFlightStore();

  const [pages, setPages] = useState<PageState[]>([]);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [resolved, setResolved] = useState<Record<string, 'ok' | 'changed'>>({});
  const [activePage, setActivePage] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showReadings, setShowReadings] = useState(false);
  // Helskärmsläget (liggande): off → entering (skärmen vrids) → on → leaving (vrids tillbaka) → off.
  const [full, setFull] = useState<'off' | 'entering' | 'on' | 'leaving'>('off');
  const [fsCell, setFsCell] = useState<{ rowKey: string; field: string } | null>(null);
  const [fsDraft, setFsDraft] = useState('');
  const [fsError, setFsError] = useState('');
  const [fsLate, setFsLate] = useState(false);
  const fsInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (full === 'entering') {
      // Låset upprepas tills skärmen ligger ned (ett enda anrop kan nekas medan något annat håller på att stängas).
      const lock = () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {}); };
      lock();
      let n = 0;
      const iv = setInterval(() => {
        const d = Dimensions.get('window');
        if (d.width > d.height || ++n > 12) { clearInterval(iv); return; }
        lock();
      }, 250);
      const late = setTimeout(() => setFsLate(true), 2500);
      return () => { clearInterval(iv); clearTimeout(late); };
    }
    if (full === 'leaving') {
      // Stående först, sedan tillbaka till frågorna: annars ritas den stående granskningen i liggande format.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      const t0 = Date.now();
      const iv = setInterval(() => {
        const d = Dimensions.get('window'), ms = Date.now() - t0;
        if ((d.height > d.width && ms >= 230) || ms >= 1200) { clearInterval(iv); setFull('off'); }
      }, 40);
      return () => clearInterval(iv);
    }
    setFsLate(false);
    return undefined;
  }, [full]);
  useEffect(() => { if (full === 'entering' && W > H) setFull('on'); }, [full, W, H]);
  // Vrids telefonen upp medan helskärmsläget är på ska bilden ligga kvar: låset sätts om tills skärmen ligger
  // ned igen (iOS släpper ibland igenom vridningen trots låset). Detsamma när appen kommer tillbaka från bakgrunden.
  const [fsUpright, setFsUpright] = useState(false);
  useEffect(() => {
    if (full !== 'on' || W > H) return undefined;
    const lock = () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {}); };
    lock();
    let n = 0;
    const iv = setInterval(() => { if (++n > 12) { clearInterval(iv); return; } lock(); }, 250);
    const late = setTimeout(() => setFsUpright(true), 1800);
    return () => { clearInterval(iv); clearTimeout(late); setFsUpright(false); };
  }, [full, W, H]);
  useEffect(() => {
    if (full !== 'on') return undefined;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    });
    return () => sub.remove();
  }, [full]);
  const [saving, setSaving] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  // Flottans registreringar med typ, isärhållna skrivsätt ("Keep separate") och valt namn per skrivsätt.
  const [fleetRegs, setFleetRegs] = useState<FleetInfo['regs']>([]);
  const [typeSeparate, setTypeSeparate] = useState<Set<string>>(new Set());
  const [typeChoice, setTypeChoice] = useState<Record<string, string>>({});
  const typeEdited = useRef(new Set<string>());   // rader där användaren själv ändrat typen
  const [typeSpread, setTypeSpread] = useState<{ from: string; to: string; keys: string[] } | null>(null);
  const [typesKept, setTypesKept] = useState<Set<string>>(new Set());   // par som användaren sagt är olika flygplan
  // Andrepiloterna: namnen som redan finns, isärhållna namn, och rader användaren själv ändrat.
  const [knownNames, setKnownNames] = useState<{ name: string; n: number }[]>([]);
  const knownKeysRef = useRef<Set<string>>(new Set());   // namnkontrollen: namn som redan finns godtas alltid
  const [nameSeparate, setNameSeparate] = useState<Set<string>>(new Set());
  const crewEdited = useRef(new Set<string>());
  const nameWritten = useRef(new Map<string, string>());   // namnet som det lästes, per rad
  // Svar som lärs under skanningen (services/scanValueRules.ts): samma svar tre gånger gäller resten av boken.
  const rulesRef = useRef<ValueRule[]>([]);
  const [rules, setRules] = useState<ValueRule[]>([]);
  const ruleStash = useRef(new Map<string, RuleStash>());
  const ruleAnswers = useRef(new Map<string, Set<string>>());
  const [learnNote, setLearnNote] = useState<{ text: string; rule?: ValueRule; hand?: string } | null>(null);
  // Handstilsprofilen (services/scanHandwriting.ts): förväxlade siffror, lärda av rättningarna, sparade per loggbok.
  const handRef = useRef<HandwritingProfile>(emptyProfile());
  const handKey = useRef('scan_handwriting');
  const handTouched = useRef(new Set<string>());   // celler ("rowKey|field") användaren själv ändrat: rörs aldrig
  const handCounted = useRef(new Set<string>());   // celler vars rättning redan räknats (en gång per cell)
  const handBlocked = useRef(new Set<string>());   // förväxlingar som ångrats under skanningen
  const handFixes = useRef<HandFix[]>([]);          // det profilen rättat, för Undo
  const [handLearned, setHandLearned] = useState<{ pair: string; fixed: number; suggested: number }[]>([]);
  const learnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bokens kolumner: mallen från uppslaget som stämmer bäst med bilden, och det som behövs för att pröva om
  // redan lästa uppslag när en bättre mall kommer (scanAlign.chooseBookGrid).
  const bookGridRef = useRef<BookColumns | null>(null);
  const pageInputs = useRef(new Map<number, { rows: AlignRow[]; words: VisionBox[]; score: number }>());
  const [airportHits, setAirportHits] = useState<{ icao: string; name: string }[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<'review' | 'report'>('review');
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [remarkRoles, setRemarkRoles] = useState<Record<string, string>>({});
  // Förslag på liknande flygplatser per osäker platskod, och hur ofta koderna förekommer i skanningen.
  const [placeAlts, setPlaceAlts] = useState<Record<string, string[]>>({});
  const placeCounts = useRef(new Map<string, number>());   // vald roll per anmärkningsfråga
  const [crossRefPage, setCrossRefPage] = useState<number | null>(null);   // uppslaget som loggbok (rapporten)
  const [crossRefRow, setCrossRefRow] = useState<string | null>(null);     // ögat på ett flight card: börja i den flygningen
  const [timeBasis, setTimeBasisState] = useState<TimeBasis>(getScanTimeBasis());
  useEffect(() => {
    getSetting('scan_time_basis').then((v) => { if (v === 'utc' || v === 'local') { setTimeBasisState(v); setScanTimeBasis(v); } }).catch(() => {});
  }, []);
  const chooseTimeBasis = (b: TimeBasis) => { setTimeBasisState(b); setScanTimeBasis(b); setSetting('scan_time_basis', b).catch(() => {}); };
  // Bokens tillägg på flygtiden (t.ex. +0.2 h): sparat från tidigare skanningar eller bekräftat nu.
  const [addition, setAddition] = useState<number | null>(null);
  const additionRef = useRef<number | null>(null);
  const learnedAddition = useRef<Promise<number | null> | null>(null);
  if (!learnedAddition.current) {
    learnedAddition.current = getSetting('scan_time_addition')
      .then((v) => { const n = parseFloat(v ?? ''); return n > 0 && n <= 0.5 ? n : null; })
      .catch(() => null);
  }
  useEffect(() => {
    learnedAddition.current?.then((n) => { if (n && additionRef.current == null) { additionRef.current = n; setAddition(n); } });
  }, []);
  // Fokus väljs när första uppslaget är läst (FocusDialog), inte före skanningen: Claude läser alltid lika
  // noggrant (med fokus i instruktionen blev läsningen sämre, t.ex. registreringar 69 % i "totals"), och
  // valet avgör bara vilka frågor som ställs. null = inte valt än (alla frågor räknas).
  // 2026-11-13 (användarens beslut): "Every flight, exactly" gäller alltid och rutan visas inte längre;
  // FocusDialog och de andra lägena ligger kvar i koden men nås inte.
  const [focus, setFocus] = useState<ScanFocus | null>('exact');
  const [focusPick, setFocusPick] = useState<ScanFocus>(getScanFocus());   // förval: förra valet
  const [choosingFocus, setChoosingFocus] = useState(false);
  const focusRef = useRef<ScanFocus>('exact');
  // Fältet som tangentbordet redigerar när det inte är frågans eget (t.ex. ankomsttiden i "Times don't add up").
  const [editTarget, setEditTarget] = useState<string | null>(null);
  // Kolumnfrågor där användaren sagt att summan i pappersboken är felräknad (Correct my total) → guiden efter Save.
  const [paperFixed, setPaperFixed] = useState<Set<string>>(new Set());
  const [paperGuide, setPaperGuide] = useState(false);
  const [totalsAlert, setTotalsAlert] = useState(false);     // "Page totals don't add up" innan man börjar
  const totalsAlertShown = useRef(false);
  const pilotNamesRef = useRef(false);                        // remarks-rubriken: "name of PIC" (applyPilotNamesFromRemarks)
  const [correctInfo, setCorrectInfo] = useState(false);     // info-knappen under "Correct my total"
  // Kolumnfrågor där användaren sagt att den misstänkta dubbelraden är en riktig flygning.
  const [realRows, setRealRows] = useState<Set<string>>(new Set());
  // Jämförelsen med loggboken (matchScanRows): rader som redan finns och rader som krockar i tid. Raderna som finns
  // lämnas utanför (duplicates) tills man tar med dem ("Include"); de får inga frågor. keepNew = krockar där den
  // skannade flygningen behålls och loggbokens tas bort vid Save. Räknas om när datum, rutt eller tider ändras.
  const [scanMatch, setScanMatch] = useState<ScanMatch>(EMPTY_SCAN_MATCH);
  const [dupIncluded, setDupIncluded] = useState<Set<string>>(new Set());
  const [keepNew, setKeepNew] = useState<Set<string>>(new Set());
  const duplicates = useMemo(() => new Set(Object.keys(scanMatch.dups).filter((k) => !dupIncluded.has(k))), [scanMatch, dupIncluded]);
  const matchSig = rows.map((r) => [r.key, r.data.date, r.data.dep_place, r.data.arr_place, r.data.dep_utc, r.data.arr_utc, r.data.total_time].join('|')).join(';') + timeBasis;
  useEffect(() => {
    if (!rows.length) return;
    let live = true;
    const t = setTimeout(() => { matchScanRows(rows, timeBasis).then((m) => { if (live) setScanMatch(m); }).catch(() => {}); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [matchSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const [aircraft, setAircraft] = useState<Record<string, AircraftInput>>({});
  // Flottans farthastighet och uthållighet per typ (versaler), och det användaren ändrat i rapporten.
  const [fleetSpecs, setFleetSpecs] = useState<Record<string, { speed: string; endurance: string }>>({});
  const [specEdits, setSpecEdits] = useState<Record<string, { speed?: string; endurance?: string }>>({});
  const [acLoading, setAcLoading] = useState<Set<string>>(new Set());
  const [acFailed, setAcFailed] = useState<Set<string>>(new Set());
  const lookedUp = useRef<Set<string>>(new Set());
  const savingRef = useRef(false);

  const pagesRef = useRef<PageState[]>([]);
  const layoutRef = useRef<LogbookLayout | null>(null);
  // "Scan your whole logbook": omgången (vilka foton, bokens format) och formatet självt.
  const bookRef = useRef<ScanBookSession | null>(null);
  const bookFormatRef = useRef<ScanFormat | null>(null);
  // Granskningen är stängd: kedjan av läsningar slutar (förut fortsatte den i bakgrunden och drog coins för
  // uppslag som ingen skulle granska). Ett anrop som redan skickats blir klart; i en hel bok sparas det.
  const closedRef = useRef(false);
  useEffect(() => () => { closedRef.current = true; }, []);
  // Bilder som granskningen själv skrivit till cachen (kamerans foton, förberedda bilder) → raderas när den stängs.
  const tempFiles = useRef(new Set<string>());
  // Uppslagsraden överst: rullas så att uppslaget som visas syns.
  const pillScroll = useRef<ScrollView>(null);
  const pillX = useRef<Record<number, number>>({});
  useEffect(() => { pillScroll.current?.scrollTo({ x: Math.max(0, (pillX.current[activePage] ?? 0) - 60), animated: true }); }, [activePage]);
  useEffect(() => () => { tempFiles.current.forEach((f) => { FileSystem.deleteAsync(f, { idempotent: true }).catch(() => {}); }); }, []);
  const knownRef = useRef<Set<string>>(new Set());
  const unknownIcaos = useRef<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const touched = useRef(false);
  const fmtRef = useRef(timeFormat);
  fmtRef.current = timeFormat;

  // Stående igen när skärmen stängs (direkt, och en gång till när övergången är klar).
  useEffect(() => () => {
    const portrait = () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
    portrait();
    setTimeout(portrait, 700);
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Slut på Blade coins mitt i en skanning: var läsningen stannade, och köpbladet (Premium) som fortsätter
  // därifrån när köpta coins kommit fram. En gratisanvändare får se Premium.
  const pausedAt = useRef<{ i: number; ctx: PageContext | undefined } | null>(null);
  const resumeScan = () => {
    const p = pausedAt.current;
    pausedAt.current = null;
    if (!p) return;
    passForSpreads(pagesRef.current.length - p.i);
    readPage(p.i, p.ctx, true);
  };
  // Skanningspasset (services/scanPass.ts): uppslagen som saldot räckte till när läsningen började läses klart även
  // om de kostar lite mer än uppskattat. Fler än saldot räcker till ges inget pass för (en hel boks omgång kan ha
  // fler); de läses så länge det finns coins, som förut. Svaret behövs inte innan läsningen börjar: passet behövs
  // först när coinsen tar slut, och det första uppslaget tar en halv minut.
  const passForSpreads = (n: number) => {
    const reach = scanReach();
    const want = reach == null ? n : Math.min(n, reach);
    if (want > 0) requestScanPass(want).then((g) => console.log(`[SCAN] Skanningspass: ${g} av ${want} uppslag`)).catch(() => {});
  };
  const isPaying = () => { const st = useFlightStore.getState(); return st.isPremium || st.isMax; };
  const getCoins = () => {
    if (!isPaying()) { presentPaywall('Logbook scan'); return; }
    if (!coinShopAvailable()) { showMonthlyTokenLimitAlert(); return; }
    const done = pagesRef.current.filter((p) => p.status === 'done').length;
    const left = pagesRef.current.length - done;
    openCoinShop({
      reason: 'scan',
      note: `${done ? `${done} spread${done === 1 ? ' is' : 's are'} read and kept. ` : 'Your photos are kept. '}Get more coins to read ${left === 1 ? 'the last spread' : `the remaining ${left} spreads`} — the scan continues where it stopped.`,
      onDone: resumeScan,
    });
  };
  const onOutOfCoins = useRef<() => void>(() => {});
  onOutOfCoins.current = () => { if (isPaying() && coinShopAvailable()) getCoins(); };

  const patchPage = (i: number, patch: Partial<PageState>) => {
    pagesRef.current = pagesRef.current.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setPages(pagesRef.current);
  };

  // ── Läsning: hitta boken → Claude läser → ringarna justeras mot Visions ord ──

  // Boken letas upp (vrids, rätas, beskärs) i alla foton direkt efter varandra, på enheten, medan Claude
  // läser det första (services/scanPrepare). Läsningsskärmen bockar av foto för foto. Varje foto letas upp en
  // gång (även vid retry). Foton från "Scan your whole logbook" är redan förberedda: bara orden läses in.
  const located = useRef(new Map<number, Promise<{ words: VisionBox[] } | null>>());
  const [locatedCount, setLocatedCount] = useState(0);
  const locate = (i: number) => {
    let job = located.current.get(i);
    if (!job) {
      job = (async () => {
        const pg = pagesRef.current[i];
        if (pg.prepared) {
          const words: VisionBox[] = pg.wordsUri
            ? await FileSystem.readAsStringAsync(pg.wordsUri).then((t) => JSON.parse(t)).catch(() => [])
            : [];
          setLocatedCount((n) => n + 1);
          return { words };
        }
        const out = await prepareSpread({ uri: pg.uri, width: pg.width, height: pg.height, cropped: pg.cropped, oriented: pg.oriented }).catch(() => null);
        if (out && out.uri !== pg.uri) {
          tempFiles.current.add(out.uri);
          patchPage(i, { uri: out.uri, width: out.width, height: out.height, mediaType: mediaTypeOf(out.uri), cropped: pg.cropped || out.found, prepared: true });
        } else if (out) patchPage(i, { prepared: true });
        setLocatedCount((n) => n + 1);
        return out ? { words: out.words } : null;
      })();
      located.current.set(i, job);
    }
    return job;
  };

  const readPage = useCallback(async (i: number, ctx: PageContext | undefined, chain: boolean) => {
    let page = pagesRef.current[i];
    if (!page || closedRef.current) return;
    let next = ctx;
    try {
      patchPage(i, { status: 'finding', error: undefined });
      const tStart = Date.now();
      const found = await locate(i);
      const tFound = Date.now();
      const words: VisionBox[] = found?.words ?? [];
      page = pagesRef.current[i];

      patchPage(i, { status: 'reading' });
      const timeAddition = additionRef.current ?? (await learnedAddition.current) ?? undefined;
      // Redan läst i en tidigare öppning av samma omgång ("Scan your whole logbook"): läsningen är sparad och
      // kostar inga nya coins.
      const cached: PageRead | null = page.readUri
        ? await FileSystem.readAsStringAsync(page.readUri).then((t) => JSON.parse(t)).catch(() => null)
        : null;
      // Granskningen stängdes medan boken letades upp: inget nytt anrop (det skulle kosta coins i onödan).
      if (closedRef.current && !cached) return;
      let result: PageRead;
      if (cached) {
        result = cached;
        console.log(`[SCAN] Uppslag ${i + 1}: Claudes sparade läsning används (${result.flights.length} rader)`);
      } else {
        // Bilden läses från filen först nu och släpps efter anropet (ingen base64 i minnet mellan läsningarna).
        const base64 = await FileSystem.readAsStringAsync(page.uri, { encoding: FileSystem.EncodingType.Base64 }).catch(() => '');
        if (!base64) throw new Error("Couldn't open the photo. Choose it again from your library.");
        // En omgång ur en hel bok: bokens format (läst från första uppslaget) är kolumnlistan, och bokens eget
        // tidsformat styr tolkningen.
        result = await ocrScanPage(base64, page.mediaType, bookFormatRef.current?.timeFormat ?? fmtRef.current, ctx,
          { useBookLayout: getScanUseBookLayout(), ...(bookFormatRef.current ? { layout: layoutRef.current } : {}), timeAddition, model: OCR_MODEL, wholeSpread: true, handwriting: handwritingHint(handRef.current) || undefined });
        if (page.readUri) FileSystem.writeAsStringAsync(page.readUri, JSON.stringify(result)).catch(() => {});
      }
      // Sidnumren lästes inte: de sidnummer uppslaget bör ha enligt bokens sidspann.
      if (result.pageNumbers.left == null && page.expected) result = { ...result, pageNumbers: { ...page.expected } };
      const tRead = Date.now();
      const unknown = await findUnknownIcaos(result.flights);
      unknown.forEach((c) => unknownIcaos.current.add(c));
      let grid = result.grid ?? (layoutRef.current ? buildPageGrid(undefined, layoutRef.current, null) : null);
      console.log(`[SCAN] Rutnät från skannern: ${result.grid ? `${result.grid.source}, ${result.grid.columns.length} kolumner, tabell ${Math.round(result.grid.tableTop * 100)}–${Math.round(result.grid.tableBottom * 100)} %` : 'INGET'}${!result.grid && grid ? ' → mallens bredder' : ''}`);

      // Flygplanstyperna kontrolleras mot flottan och slås ihop för hela skanningen (services/scanTypes.ts,
      // effekten "Flygplanstyperna" nedan) — inte här, per uppslag.
      // Inget ur anmärkningen (remarks) tas med. Second pilot bara ur en egen namnkolumn utanför anmärkningen.
      const nameColumn = !!(result.grid?.columns.some((c) => c.field === 'second_pilot') || layoutRef.current?.columns.some((c) => c.field === 'second_pilot'));
      const newRows: ScanRow[] = result.flights.map((raw, idx) => {
        const f = withoutRemarks(raw, nameColumn);
        const data = flagUnknownIcaos(prepareFlight(f), unknown);
        let rowIndex = f.row_index ?? 0;
        if (!rowIndex && grid && typeof f.row_y_pct === 'number') {
          rowIndex = Math.floor((f.row_y_pct / 100 - grid.tableTop) / ((grid.tableBottom - grid.tableTop) / grid.rowsPerPage)) + 1;
        }
        if (!rowIndex || rowIndex < 1) rowIndex = idx + 1;
        return { key: `${i}:${rowIndex}:${idx}`, page: i, rowIndex, data, original: { ...f }, skip: false };
      });
      // Det användaren redan svarat tre gånger (t.ex. ETNB → ETHB) frågas inte igen.
      const learned = applyValueRules(newRows, rulesRef.current, ruleStash.current);
      learned.forEach((r, k) => { newRows[k] = r; });
      // Datum som går bakåt eller krockar med raden ovanför, och fler rader än sidan har (en rad läst två gånger).
      // Radantalet tas från bokens tidigare uppslag när de är överens (samma bok, samma tryck).
      const rowsPrinted = typicalRowsPerPage(pagesRef.current.filter((_, k) => k !== i).map((p) => p.grid?.rowsPerPage ?? 0), grid?.rowsPerPage);
      checkRowSequence(newRows, rowsPrinted);
      // Simulatortid i fel kolumn ("Other type of flight time") när sidans simulatorsumma bekräftar det.
      reconcileSimColumn(newRows, i, result.pageTotals?.by_field);
      // Bokens tillägg (+0.2 h) som stod i cellen men lästes utan: läggs till när sidans summa bekräftar det.
      const added = reconcileAddition(newRows, i, result.pageTotals?.by_field, timeAddition);
      if (added) console.log(`[SCAN] Tillägget ${timeAddition} h lagt till på ${added} celler (sidans summa bekräftar)`);
      // Samma tal under Day och Night när bara ena kolumnen går ihop med sidans summa → troligen överstruket.
      checkLandingPairs(newRows, i, result.pageTotals?.by_field);
      // Säger anmärkningens rubrik att pilotens namn står där ("name of PIC") sätts second pilot automatiskt:
      // SIC om flygningen har egen PIC-tid, annars PIC. Gäller hela skanningen (samma bok), även uppslag som
      // redan lästs. Osäkra läsningar frågas som förut.
      // (Namn ur anmärkningen läses inte längre in: skanningen tar inte med något ur remarks, 2026-11-15.)
      // Namnkontrollen på det Claude läst i namnkolumnen: inga namn → till anmärkningen, "SELF" → bort.
      const screened = screenSecondPilots(newRows, knownKeysRef.current);
      if (screened.moved.length || screened.self) console.log(`[SCAN] Namnkontroll: ${screened.moved.length} borttagna (inga namn)${screened.moved.length ? ` (${screened.moved.join(', ')})` : ''}, ${screened.self} SELF borttagna`);
      // Osäkra eller okända platskoder → liknande flygplatser som förslag (i bakgrunden, ingen AI).
      for (const r of newRows) for (const f of ['dep_place', 'arr_place'] as const) {
        const c = String(r.data[f] ?? '').toUpperCase();
        if (c) placeCounts.current.set(c, (placeCounts.current.get(c) ?? 0) + 1);
      }
      const unsure = new Set(newRows.flatMap((r) => (r.data.field_issues ?? [])
        .filter((x) => x.field === 'dep_place' || x.field === 'arr_place')
        .map((x) => String((r.data as any)[x.field] ?? '').toUpperCase())).filter(Boolean));
      for (const code of unsure) {
        similarAirports(code, placeCounts.current).then((alts) => {
          if (alts.length) setPlaceAlts((m) => (m[code] ? m : { ...m, [code]: alts }));
        }).catch(() => {});
      }

      // Ringarna exakt: Claudes värden matchas mot orden Vision hittade i samma bild.
      if (grid && words.length > 0) {
        const aligned = alignGrid(grid, newRows.map((r) => ({
          rowIndex: r.rowIndex,
          values: Object.fromEntries(['date', 'registration', 'aircraft_type', 'dep_place', 'arr_place', 'dep_utc', 'arr_utc', 'second_pilot']
            .map((key) => [key, String((r.original as any)[key] ?? '')])),
        })), words);
        console.log(`[SCAN] Rutnät justerat mot Vision: ${aligned.matchesY} rader, ${aligned.matchesX} kolumner`);
        // Kolumner Claude inte angav (ofta högersidan) läggs till från de tryckta rubrikerna — efter
        // rättningen, eftersom de redan har Visions exakta koordinater.
        const before = aligned.grid.columns.length;
        grid = completeGridFromHeaders(aligned.grid, words);
        if (grid.columns.length > before) console.log(`[SCAN] ${grid.columns.length - before} kolumner tillagda från rubrikerna`);
        // En kolumn som skannern lagt över flera andra (oftast datumet) får sin egen plats bredvid dem.
        const tidy = untangleColumns(grid, words);
        if (tidy !== grid) { console.log('[SCAN] En kolumn låg över flera andra och har lagts på sin egen plats'); grid = tidy; }
        // Varje rads läge mäts mot Visions ord (sidan buktar ofta, så raderna är inte jämnt fördelade).
        grid = measureRows(grid, newRows.map((r) => ({
          rowIndex: r.rowIndex,
          values: Object.fromEntries(['date', 'registration', 'aircraft_type', 'dep_place', 'arr_place', 'dep_utc', 'arr_utc', 'second_pilot',
            'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'landings_day', 'landings_night', 'remarks']
            .map((key) => [key, String((r.original as any)[key] ?? '')])),
        })), words);
        console.log(`[SCAN] Rader uppmätta mot Vision: vänster ${grid.rowCenters?.left?.length ?? 0}, höger ${grid.rowCenters?.right?.length ?? 0} · lutning ${grid.rowSlopes?.left?.slope?.toFixed(3) ?? '–'} / ${grid.rowSlopes?.right?.slope?.toFixed(3) ?? '–'}`);
        // Talfält vars värden står i en annan kolumn än rutnätet säger (t.ex. simulatortid i en handskriven
        // "Simulator time" i stället för den tryckta "Synthetic training session") kopplas om dit.
        const relocated = relocateColumnsByValues(grid, newRows.map((r) => ({
          rowIndex: r.rowIndex,
          values: Object.fromEntries(['total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'multi_pilot', 'single_pilot', 'nvg', 'flight_type']
            .map((key) => [key, String((r.data as any)[key] ?? '')])),
        })), words);
        grid = relocated.grid;
        if (relocated.moved.length) console.log(`[SCAN] Kolumner omkopplade efter var värdena står: ${relocated.moved.join(', ')}`);
        // Samma tryck på varje uppslag: det rutnät som stämmer bäst med bilden vinner, och det bästa hittills blir
        // bokens mall. Blir mallen bättre prövas redan lästa uppslag om, så att de också får rätt kolumner.
        const SCORE_FIELDS = ['aircraft_type', 'registration', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'landings_day', 'landings_night'];
        const scoreRows: AlignRow[] = newRows.map((r) => ({
          rowIndex: r.rowIndex,
          values: Object.fromEntries(SCORE_FIELDS.filter((f) => !(f === 'total_time' && r.data.flight_type === 'sim'))
            .map((f) => [f, String((r.data as any)[f] ?? '')]).filter(([, v]) => v !== '')),
        }));
        const choice = chooseBookGrid(grid, scoreRows, words, bookGridRef.current);
        grid = untangleColumns(choice.grid, words);
        console.log(`[SCAN] Kolumner uppslag ${i + 1}: ${Object.entries(choice.scores).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')} → ${choice.source}`);
        pageInputs.current.set(i, { rows: scoreRows, words, score: choice.score });
        // Vision läser handskrift ojämnt, så nivån är låg; varje uppslag väljer ändå det som stämmer bäst.
        if (choice.score >= 0.2 && choice.score > (bookGridRef.current?.score ?? -1)) {
          const book: BookColumns = { columns: grid.columns, spine: grid.spine ?? 0.5, score: choice.score };
          bookGridRef.current = book;
          pageInputs.current.forEach((input, k) => {
            const pg = pagesRef.current[k];
            if (k === i || !pg?.grid) return;
            const again = chooseBookGrid(pg.grid, input.rows, input.words, book);
            if (again.source === 'own') return;
            console.log(`[SCAN] Uppslag ${k + 1} fick bokens kolumner (${input.score.toFixed(2)} → ${again.score.toFixed(2)})`);
            pageInputs.current.set(k, { ...input, score: again.score });
            patchPage(k, { grid: untangleColumns(again.grid, input.words) });
          });
        }

        // Simulatorpass lästa som flygtid (och simulatortid kopierad till Dual, IFR …): Vision och sidans summor avgör.
        const spilled = reconcileSimSpill(newRows, result.pageTotals?.by_field, grid, words);
        if (spilled.length) console.log(`[SCAN] Simulatorpass rättade efter Vision och sidans summor: ${spilled.length} rader`);
        // "Total this page" som lästs fel: Vision läser radernas summa i kolumnens summaruta.
        const visionTotals = pageTotalsByVision(newRows, result.pageTotals?.by_field, grid, words);
        if (Object.keys(visionTotals).length) {
          console.log(`[SCAN] Sidans summor rättade efter Vision: ${Object.entries(visionTotals).map(([f, v]) => `${f} ${result.pageTotals?.by_field?.[f]} → ${v}`).join(', ')}`);
          result = { ...result, pageTotals: { ...result.pageTotals, by_field: { ...(result.pageTotals?.by_field ?? {}), ...visionTotals } } };
        }

        // Landningar: Claude och Vision läser olika i samma cell. Appen avgör själv (services/scanLandings.ts):
        // sidans summor, nattiden, Visions läge och till sist en andra titt på cellerna. Bara det som inget av
        // det avgör blir en fråga, med båda läsningarna som val.
        const landingRead = newRows.map((r) => ({
          rowIndex: r.rowIndex,
          read: { landings_day: r.data.landings_day, landings_night: r.data.landings_night },
        }));
        const checks = crossCheckCounts(grid, landingRead, words);
        const cands = landingCandidates(checks, newRows);
        if (cands.length) {
          const sums = columnTotals(newRows, i, result.pageTotals?.by_field);
          const sumOf = (f: string) => newRows.reduce((acc, r) => acc + (Number((r.data as any)[f]) || 0), 0);
          const printedOf = (f: string) => sums.find((c) => c.field === f)?.printed;
          const agreeing = landingAgreement(grid, landingRead, words);
          const decisions = decideLandings(cands, { day: sumOf('landings_day'), night: sumOf('landings_night') },
            { day: printedOf('landings_day'), night: printedOf('landings_night') }, agreeing);
          const open = cands.filter((c) => !decisions.some((d) => d.rowIndex === c.rowIndex));
          if (open.length) {
            const seen = await secondLookLandings({ uri: pagesRef.current[i]?.uri ?? page.uri }, grid, open.map((c) => c.rowIndex));
            for (const c of open) { const d = decideBySecondLook(c, seen?.get(c.rowIndex)); if (d) decisions.push(d); }
          }
          for (const c of cands) {
            const row = newRows.find((r) => r.rowIndex === c.rowIndex);
            if (!row) continue;
            const d = decisions.find((x) => x.rowIndex === c.rowIndex);
            const landingIssue = (x: { field: string }) => x.field === 'landings_day' || x.field === 'landings_night';
            if (d) {
              const p = d.pick === 'vision' ? c.vision : c.claude;
              const issues = (row.data.field_issues ?? []).filter((x) => !landingIssue(x));
              row.data = { ...row.data, landings_day: String(p.day), landings_night: String(p.night), field_issues: issues };
              continue;
            }
            const q = landingQuestion(c);
            const from = c.kind === 'move' ? (q.field === 'landings_day' ? 'landings_night' : 'landings_day') : undefined;
            const issues = (row.data.field_issues ?? []).filter((x) => !landingIssue(x));
            issues.push({ field: q.field, reason: q.reason, confidence: 0.5, options: q.options.length ? q.options : [String(Math.max(c.claude.day, c.claude.night))], ...(from ? { from } : {}) });
            row.data = { ...row.data, field_issues: issues, needs_review: true };
          }
          const by = (w: string) => decisions.filter((d) => d.why === w).length;
          console.log(`[SCAN] Landningar där Claude och Vision skiljer sig: ${cands.length} rader · summorna ${by('totals')} · nattid ${by('night_time')} · läget ${by('position')} (${agreeing} rader överens) · andra titten ${by('second_look')} · frågor ${cands.length - decisions.length} · Vision vann ${decisions.filter((d) => d.pick === 'vision').length}`);
        }
      } else if (grid) {
        grid = untangleColumns(grid);
      }

      // Handstilsprofilen på det nya uppslaget: rättar bara det blocktiden eller sidans summa bekräftar.
      const handPairs = activePairs(handRef.current, handBlocked.current);
      if (handPairs.length) {
        const printed = { [i]: Object.fromEntries(columnTotals(newRows, i, result.pageTotals?.by_field).map((c) => [c.field, c.printed])) };
        const res = handwritingSweep(newRows, handPairs, printed, handTouched.current, timeAddition ?? 0);
        applyHand(newRows, res);
        if (res.fixes.length || res.suggestions.length) console.log(`[SCAN] Handstilen på uppslag ${i + 1}: ${res.fixes.length} rättade (${res.fixes.map((f) => `${f.from}→${f.to} ${f.why}`).join(', ')}), ${res.suggestions.length} förslag`);
      }

      if (__DEV__) {
        // Varje läst rad (det appen fick, efter reglerna), för att jämföra skanningar cell för cell.
        const DUMP = ['date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time',
          'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'landings_day', 'landings_night', 'flight_type', 'remarks'];
        for (const row of [...newRows].sort((a, b) => a.rowIndex - b.rowIndex)) {
          const cells = DUMP.map((f) => [f, String((row.data as any)[f] ?? '')] as const)
            .filter(([f, v]) => v !== '' && v !== '0' && !(f === 'flight_type' && v === 'normal'))
            .map(([f, v]) => `${f}=${v}`);
          const qs = (row.data.field_issues ?? []).map((x) => x.field);
          console.log(`[SCAN] 📋 R${row.rowIndex} ${cells.join(' ')}${qs.length ? ` · frågor: ${qs.join(',')}` : ''}`);
        }
        const sec = (ms: number) => (ms / 1000).toFixed(1);
        console.log(`[SCAN] ⏱ Uppslag ${i + 1}: ${sec(Date.now() - tStart)} s totalt (hitta boken ${sec(tFound - tStart)} s · Claude ${sec(tRead - tFound)} s · efterarbete ${sec(Date.now() - tRead)} s) · ${newRows.length} rader · fokus ${focusRef.current}`);
      }
      setRows((prev) => [...prev.filter((r) => r.page !== i), ...newRows]);
      patchPage(i, { status: 'done', grid, pageNumbers: result.pageNumbers, detections: result.aircraftDetections, totals: result.pageTotals });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const last = result.flights[result.flights.length - 1];
      if (last) {
        next = {
          last_date: last.date, last_aircraft_type: last.aircraft_type, last_registration: last.registration,
          last_dep_place: last.dep_place, last_arr_place: last.arr_place, page_number: i + 1,
        };
      }
    } catch (e: any) {
      if (isTokenQuotaError(e)) {
        // Coinsen tog slut: fotona finns kvar. Kedjan stannar här och fortsätter när det finns coins igen.
        patchPage(i, { status: 'error', error: OUT_OF_COINS });
        pausedAt.current = { i, ctx };
        onOutOfCoins.current();
        return;
      }
      patchPage(i, { status: 'error', error: e?.message ?? 'Could not read this spread.' });
    }
    if (chain && !closedRef.current && i + 1 < pagesRef.current.length) readPage(i + 1, next, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const batch = getScanBatch();
      clearScanImage();
      const book = takeScanBookSession();
      bookRef.current = book;
      if (batch.length === 0) { setFatal('There are no photos to read. Go back and scan again.'); return; }
      const stamp = Date.now();
      const sized: PageState[] = await Promise.all(batch.map(async (img, i) => {
        // Bilderna hålls som filer: kamerans (base64) skrivs till cachen, bibliotekets foton visas från
        // väljarens fil tills locate förberett dem, och en hel boks foton är redan förberedda.
        let uri = img.prepared?.uri ?? img.sourceUri ?? '';
        if (!uri && img.base64) {
          uri = `${FileSystem.cacheDirectory}scan_page_${stamp}_${i}.${img.mediaType === 'image/png' ? 'png' : 'jpg'}`;
          await FileSystem.writeAsStringAsync(uri, img.base64, { encoding: FileSystem.EncodingType.Base64 });
          tempFiles.current.add(uri);
        }
        let { width, height } = img;
        if (!width || !height) {
          const sz = await new Promise<{ w: number; h: number }>((res) =>
            Image.getSize(uri, (w, h) => res({ w, h }), () => res({ w: 2000, h: 1300 })));
          width = sz.w; height = sz.h;
        }
        return {
          mediaType: img.prepared ? 'image/jpeg' : img.mediaType, uri, width: width!, height: height!,
          cropped: !!img.cropped, oriented: !!img.oriented, prepared: !!img.prepared,
          wordsUri: img.prepared?.wordsUri, readUri: img.prepared?.readUri, expected: img.prepared?.expected,
          status: 'waiting' as const, grid: null, pageNumbers: { left: null, right: null }, detections: [], totals: null,
        };
      }));
      pagesRef.current = sized;
      setPages(sized);
      // En omgång ur en hel bok: bokens format (id:t följer med omgången) i stället för den digitala bokens mall.
      const format = book ? await loadScanFormat(book.formatId) : null;
      bookFormatRef.current = format;
      if (format) bookGridRef.current = format.template ?? { columns: format.columns.map((c) => ({ field: c.field, label: c.label, left: c.left, right: c.right })), spine: format.spine, score: -1 };
      getSecondPilotCounts().then((list) => { knownKeysRef.current = new Set(list.map((x) => nameKey(x.name))); setKnownNames(list); }).catch(() => {});
      handKey.current = format ? `scan_handwriting:${format.id}` : 'scan_handwriting';
      try {
        const hp = JSON.parse((await getSetting(handKey.current)) || 'null');
        if (hp && hp.v === 1 && hp.pairs && typeof hp.pairs === 'object') handRef.current = hp;
      } catch { /* ingen profil */ }
      try {
        const saved = JSON.parse((await getSetting('scan_value_rules')) || '[]');
        if (Array.isArray(saved)) { rulesRef.current = saved; setRules(saved); }
      } catch { /* inga sparade regler */ }
      getFleetRegistrationTypes().then(setFleetRegs).catch(() => {});
      const [types, layout] = await Promise.all([
        getAllAircraftTypes().catch(() => []),
        format ? Promise.resolve(formatToLayout(format)) : getScanUseBookLayout() ? getActiveBookLayout() : Promise.resolve(null),
      ]);
      knownRef.current = new Set(types.map((t: any) => String(t.aircraft_type ?? '').toUpperCase()).filter(Boolean));
      setKnown(knownRef.current);
      setFleetSpecs(Object.fromEntries(types.map((t: any) => [String(t.aircraft_type ?? '').toUpperCase(), {
        speed: Number(t.cruise_speed_kts) > 0 ? String(t.cruise_speed_kts) : '',
        endurance: Number(t.endurance_h) > 0 ? String(t.endurance_h) : '',
      }])));
      layoutRef.current = layout;
      // Formatet vet redan om anmärkningens rubrik säger att pilotens namn står där.
      if (format?.remarksPilotNames) pilotNamesRef.current = true;
      if (format) console.log(`[SCAN] Omgång ur hel bok: format ${format.id}, ${sized.length} uppslag${book?.ctx ? `, fortsätter efter ${book.ctx.last_date}` : ''}`);
      passForSpreads(sized.length);
      readPage(0, book?.ctx, true);
      for (let i = 0; i < sized.length && !closedRef.current; i++) await locate(i);   // resten letas upp medan första läses
    })();
  }, [readPage]);   // readPage är stabil → körs en gång

  // ── Härledda data ──────────────────────────────────────────────────────────

  // Hela granskningen är stående: läsningen, frågorna och rapporten. Bara kameran är liggande. Låset sätts
  // ändå här, eftersom man kommer direkt från den liggande kameran.
  const readingPhase = !pages.some((p) => p.status === 'done');
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Läsningsskärmen ligger som ett lager ovanpå granskningen. När första uppslaget är läst visar den
  // resultatet en kort stund, tonar sedan bort medan frågepanelen glider upp underifrån.
  const [overlay, setOverlay] = useState<'visible' | 'finishing' | 'hidden'>('visible');
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const panelEnter = useRef(new Animated.Value(0)).current;
  const startedAt = useRef(Date.now()).current;
  // Innan granskningen börjar: "What matters most to you?" (FocusDialog) med uppskattad tid och träffsäkerhet.
  useEffect(() => {
    if (SKIP_REVIEW) return;   // nya flödet: läsningsskärmen står kvar tills allt är läst (se autoReport nedan)
    if (readingPhase || overlay !== 'visible') return;
    if (!focus) { setChoosingFocus(true); return; }
    setOverlay('finishing');
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(overlayOpacity, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(panelEnter, { toValue: 1, duration: 620, delay: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setOverlay('hidden'));
    }, 350);   // resultatet har redan synts bakom valet
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingPhase, focus]);

  const additionCandidate = useMemo(() => detectTimeAddition(rows), [rows]);
  // ── Flygplanstyperna: kontrollerade mot flottan och ihopslagna för hela skanningen (services/scanTypes.ts) ──
  // Samma luftfartyg skrivet på flera sätt ("EC135", "EC135T1", "EC35") blir EN typ, och finns typen i flottan
  // (samma registrering, samma namn, samma typkod eller ett variantsuffix) får raderna flottans namn. Raderna
  // uppdateras här; en typ som användaren ändrat på en enskild rad lämnas.
  const typeRes = useMemo(() => resolveScanTypes(
    rows.filter((r) => !r.skip).map((r) => ({ written: r.original.aircraft_type || r.data.aircraft_type || '', registration: r.data.registration })),
    pages.flatMap((p) => p.detections),
    { types: [...known], regs: fleetRegs },
    typeSeparate,
  ), [rows, pages, known, fleetRegs, typeSeparate]);
  const typeFor = (g: TypeGroup) => g.members.map((m) => typeChoice[m.key]).find(Boolean) ?? g.suggested;
  useEffect(() => {
    const want = (r: ScanRow) => {
      if (typeEdited.current.has(r.key)) return null;
      const g = typeRes.groupOf.get(typeKey(r.original.aircraft_type || r.data.aircraft_type));
      return g ? typeFor(g) : null;
    };
    const differs = (r: ScanRow) => { const t = want(r); return t != null && (r.data.aircraft_type || '').toUpperCase() !== t; };
    if (!rows.some(differs)) return;
    setRows((prev) => prev.map((r) => (differs(r) ? { ...r, data: { ...r.data, aircraft_type: want(r)! } } : r)));
    const merged = typeRes.groups.filter((g) => g.members.length > 1 || g.fleet);
    if (merged.length) console.log(`[SCAN] Typer: ${merged.map((g) => `${g.members.map((m) => m.display).join('/')} → ${typeFor(g)}${g.fleet ? ` (flottan, ${g.via})` : ''}`).join(' · ')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeRes, typeChoice]);
  // Andrepiloterna, på samma sätt (services/scanNames.ts): WOLFF, Wolff och WOFF blir ett namn, det mest använda.
  const nameRes = useMemo(() => resolveNames(
    rows.filter((r) => !r.skip && r.data.second_pilot && !crewEdited.current.has(r.key)).map((r) => nameWritten.current.get(r.key) ?? r.data.second_pilot!),
    knownNames, nameSeparate,
  ), [rows, knownNames, nameSeparate]);
  useEffect(() => {
    const want = (r: ScanRow) => {
      if (!r.data.second_pilot || crewEdited.current.has(r.key)) return null;
      const written = nameWritten.current.get(r.key) ?? r.data.second_pilot;
      const name = nameRes.nameOf(written);
      return name !== r.data.second_pilot ? { written, name } : null;
    };
    if (!rows.some((r) => want(r))) return;
    setRows((prev) => prev.map((r) => {
      const w = want(r);
      if (!w) return r;
      nameWritten.current.set(r.key, w.written);
      return { ...r, data: { ...r.data, second_pilot: w.name } };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameRes]);
  const nameMatches = nameRes.groups.filter((g) => g.spellings.length > 0)
    .map((g) => ({ id: g.id, to: g.name, from: g.spellings, rows: g.rows, similar: g.similar }));
  const keepNamesSeparate = (id: string) => {
    touched.current = true;
    setNameSeparate((st) => new Set([...st, ...id.split('|')]));
  };
  // Second pilot som inte var en person: tas bort (skanningen sparar inget i anmärkningen).
  const removeCrew = (rowKey: string) => {
    touched.current = true;
    crewEdited.current.add(rowKey);
    nameWritten.current.delete(rowKey);
    setRows((prev) => prev.map((r) => {
      const name = r.data.second_pilot;
      if (r.key !== rowKey || !name) return r;
      const current = r.data.remarks ?? '';
      return {
        ...r,
        crewRemoved: { name, role: r.data.second_pilot_role ?? '', remarks: current },
        data: { ...r.data, second_pilot: '', second_pilot_role: '' },
      };
    }));
  };
  const restoreCrew = (rowKey: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.key !== rowKey || !r.crewRemoved) return r;
      const { name, role, remarks } = r.crewRemoved;
      const { crewRemoved: _gone, ...rest } = r;
      return { ...rest, data: { ...r.data, second_pilot: name, second_pilot_role: role, remarks } };
    }));
  };
  // Rapporten: "Keep separate" och namnet på en ny typ.
  const keepTypesSeparate = (groupId: string) => {
    const g = typeRes.groups.find((x) => x.id === groupId);
    if (!g) return;
    touched.current = true;
    setTypeChoice((c) => { const n = { ...c }; for (const m of g.members) delete n[m.key]; return n; });
    setTypeSeparate((st) => new Set([...st, ...g.members.map((m) => m.key)]));
  };
  const nameType = (groupId: string, name: string) => {
    const g = typeRes.groups.find((x) => x.id === groupId);
    if (!g || !name.trim()) return;
    touched.current = true;
    setTypeChoice((c) => ({ ...c, ...Object.fromEntries(g.members.map((m) => [m.key, name.trim().toUpperCase()])) }));
  };

  // Visions ord per uppslag, sparade när uppslaget lästes (pageInputs fylls innan raderna sätts).
  const wordsOf = (page: number) => pageInputs.current.get(page)?.words ?? [];
  // Skanningens registreringar mot flottan: nya läsningar frågas om en gång var och listas i rapporten.
  // Besvarade = reglerna för registreringar (både läsningen och det den rättades till).
  const regChecks = useMemo(() => checkRegistrations(
    rows.filter((r) => !r.skip && !duplicates.has(r.key) && r.data.flight_type !== 'sim')
      .map((r) => ({ key: r.key, page: r.page, rowIndex: r.rowIndex, registration: r.data.registration ?? '' })),
    fleetRegs,
    new Set(rules.filter((r) => r.cls === 'registration').flatMap((r) => [r.from, r.to])),
  ), [rows, duplicates, fleetRegs, rules]);
  const issues = useMemo(() => deriveIssues(rows, pages, known, expanded, { accepted: addition, candidate: additionCandidate }, focus ?? 'exact', placeAlts, realRows, typeRes.groups, typeChoice, wordsOf, duplicates, regChecks),
    [rows, pages, known, expanded, addition, additionCandidate, focus, placeAlts, realRows, typeRes, typeChoice, duplicates, regChecks]);
  const isDone = (i: Issue) => !!resolved[i.id] || (!!i.group && i.group.members.every((m) => resolved[m]));

  // Innan man börjar med frågorna: går några sidsummor inte ihop sägs det en gång, och att Blades guidar genom
  // ändringarna i pappersboken efteråt om rättningarna här inte löser det. Uppslag som läses senare räknas när
  // de kommer (rutan visas ändå bara en gång).
  const columnProblems = issues.filter((i) => i.kind === 'column' && !isDone(i));
  useEffect(() => {
    if (totalsAlertShown.current || overlay !== 'hidden' || typing || columnProblems.length === 0) return;
    totalsAlertShown.current = true;
    setTotalsAlert(true);
  }, [overlay, typing, columnProblems.length]);
  const openIssues = issues.filter((i) => !isDone(i));

  // Uppskattning per val medan "What matters most to you?" visas: frågorna valet ställer i de lästa
  // uppslagen, uppräknat till alla uppslag i skanningen (tiden). Träffsäkerheten är en andel och räknas på
  // de lästa uppslagen (se konstanterna vid deriveIssues).
  const focusEstimates = useMemo((): Record<ScanFocus, FocusEstimate> | null => {
    if (!choosingFocus) return null;
    const done = pages.filter((p) => p.status === 'done').length;
    if (!done) return null;
    const factor = Math.max(done, pages.filter((p) => p.status !== 'error').length) / done;
    const values = rows.filter((r) => !r.skip && pages[r.page]?.status === 'done').length * VALUES_PER_ROW;
    const derive = (f: ScanFocus) => deriveIssues(rows, pages, known, expanded, { accepted: addition, candidate: additionCandidate }, f, placeAlts, realRows, typeRes.groups, typeChoice, wordsOf, duplicates, regChecks);
    const size = (i: Issue) => (i.kind === 'column' ? 0 : i.group ? i.group.members.length : 1);
    const exact = derive('exact');
    const exactSize = exact.reduce((n, i) => n + size(i), 0);
    const out = {} as Record<ScanFocus, FocusEstimate>;
    for (const f of ['exact', 'balanced', 'totals'] as ScanFocus[]) {
      const list = f === 'exact' ? exact : derive(f);
      const seconds = REPORT_SECONDS + factor * list.reduce((n, i) => n + (QUESTION_SECONDS[i.kind] ?? 8), 0);
      const unasked = Math.max(0, exactSize - list.reduce((n, i) => n + size(i), 0));
      const wrong = SILENT_ERROR_RATE * values + ERROR_PER_QUESTION * unasked;
      out[f] = { seconds, accuracy: values > 0 ? Math.max(0, 1 - wrong / values) : null };
    }
    return out;
  }, [choosingFocus, rows, pages, known, expanded, addition, additionCandidate, placeAlts, realRows]);

  const startChecking = () => {
    const f = focusPick;
    focusRef.current = f;
    setScanFocus(f);
    setSetting('scan_focus', f).catch(() => {});
    // Bara summorna: nya flygplanstyper frågas inte om → Claudes tolkning gäller (redan lästa uppslag; nästa
    // uppslag får den direkt vid läsningen).
    if (f === 'totals') {
      const map = new Map(pagesRef.current.flatMap((pg) => pg.detections.map((d) => [d.as_written.toUpperCase(), d.resolved.toUpperCase()] as [string, string])));
      if (map.size) setRows((prev) => prev.map((r) => {
        const t = map.get((r.data.aircraft_type || '').toUpperCase());
        return t ? { ...r, data: { ...r.data, aircraft_type: t } } : r;
      }));
    }
    setChoosingFocus(false);
    setFocus(f);
  };
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  // Typer som inte finns i flottan än → "New aircraft" i rapporten.
  const newTypes = useMemo(() => {
    const m = new Map<string, { regs: Set<string>; rows: number }>();
    for (const r of rows) {
      if (r.skip) continue;
      const t = (r.data.aircraft_type || '').toUpperCase().trim();
      if (!t || known.has(t)) continue;
      const e = m.get(t) ?? { regs: new Set<string>(), rows: 0 };
      e.rows++;
      if (r.data.registration) e.regs.add(r.data.registration.toUpperCase());
      m.set(t, e);
    }
    // Skrivsätten som slagits ihop till typen ("Also written as …" i rapporten).
    return [...m.entries()].map(([type, e]) => {
      const g = typeRes.groups.find((x) => typeFor(x) === type);
      const aka = g ? g.members.map((x) => x.display).filter((d) => d !== type) : [];
      return { type, registrations: [...e.regs], rows: e.rows, aka, groupId: g?.id, designator: g?.designator ?? undefined };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, known, typeRes, typeChoice]);
  // Nya typer som ser ut att vara samma luftfartyg (samma typkod, eller ett variantsuffix: A109 och A109LUH), och
  // nya typer som ser ut som en i flottan. Rapporten föreslår att slå ihop dem innan de blir två flygplan.
  const similarTypes = useMemo(() => {
    const pair = (a: string, b: string) => [typeKey(a), typeKey(b)].sort().join('|');
    const alike = maybeSameType;
    const rowsOf = new Map(newTypes.map((n) => [n.type, n.rows]));
    const out: { a: string; b: string; aRows: number; bRows: number; fleet: boolean }[] = [];
    for (let i = 0; i < newTypes.length; i++) {
      for (let j = i + 1; j < newTypes.length; j++) {
        const a = newTypes[i].type, b = newTypes[j].type;
        if (alike(a, b) && !typesKept.has(pair(a, b))) out.push({ a, b, aRows: rowsOf.get(a) ?? 0, bRows: rowsOf.get(b) ?? 0, fleet: false });
      }
      for (const k of known) {
        const a = newTypes[i].type;
        if (alike(a, k) && !typesKept.has(pair(a, k))) out.push({ a, b: k, aRows: rowsOf.get(a) ?? 0, bRows: 0, fleet: true });
      }
    }
    return out;
  }, [newTypes, known, typesKept]);
  const keepTypes = (a: string, b: string) => setTypesKept((st) => new Set([...st, [typeKey(a), typeKey(b)].sort().join('|')]));
  // Olika varianter av samma modell: två nya (EC135T1 och EC135T2), eller en ny och en i flottan (EC135T2 när
  // flottan har EC135T1). Hålls isär som standard; rapporten frågar om de ska slås ihop.
  const variantPairs = useMemo(() => {
    const pair = (a: string, b: string) => [typeKey(a), typeKey(b)].sort().join('|');
    const rowsOf = new Map(newTypes.map((n) => [n.type, n.rows]));
    const out: { a: string; b: string; aRows: number; bRows: number; fleet: boolean; family: string; code: string | null }[] = [];
    for (let i = 0; i < newTypes.length; i++) {
      const a = newTypes[i].type;
      for (let j = i + 1; j < newTypes.length; j++) {
        const b = newTypes[j].type;
        if (!distinctVariants(a, b) || typesKept.has(pair(a, b))) continue;
        const code = newTypes[i].designator && newTypes[i].designator === newTypes[j].designator ? newTypes[i].designator! : null;
        out.push({ a, b, aRows: rowsOf.get(a) ?? 0, bRows: rowsOf.get(b) ?? 0, fleet: false, family: familyName([a, b]) ?? a, code });
      }
      const g = typeRes.groups.find((x) => typeFor(x) === a);
      const fleetPeer = g?.familyFleet ?? [...known].find((k) => distinctVariants(a, k)) ?? null;
      if (fleetPeer && !typesKept.has(pair(a, fleetPeer))) {
        out.push({ a, b: fleetPeer, aRows: rowsOf.get(a) ?? 0, bRows: 0, fleet: true, family: familyName([a, fleetPeer]) ?? fleetPeer, code: newTypes[i].designator ?? null });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTypes, known, typesKept, typeRes, typeChoice]);

  // Skrivsätt som fått flottans typ (rapporten: "Matched to your fleet", med "Keep separate").
  const fleetMatches = useMemo(() => typeRes.groups
    .filter((g) => g.fleet && g.via && typeChoice[g.members[0].key] == null)
    .map((g) => ({ id: g.id, to: g.fleet!, via: g.via!, rows: g.rows, from: g.members.map((m) => m.display).filter((d) => typeKey(d) !== typeKey(g.fleet)) }))
    .filter((x) => x.from.length > 0), [typeRes, typeChoice]);

  useEffect(() => {
    if (stage !== 'report') return;
    for (const { type } of newTypes) {
      if (lookedUp.current.has(type)) continue;
      lookedUp.current.add(type);
      setAircraft((a) => (a[type] ? a : { ...a, [type]: emptyAircraftInput() }));
      setAcLoading((st) => new Set(st).add(type));
      const timeout = new Promise<null>((res) => setTimeout(() => res(null), 12000));
      Promise.race([lookupAircraft(type, { background: true }), timeout])
        .then((r: any) => {
          if (!r || r.needs_manual || !r.aircraft_type) { setAcFailed((st) => new Set(st).add(type)); return; }
          setAircraft((a) => {
            const cur = a[type] ?? emptyAircraftInput();
            const next = { ...cur };
            const ai: string[] = [];
            if (!cur.speed && r.cruise_speed_kts > 0) { next.speed = String(r.cruise_speed_kts); ai.push('speed'); }
            if (!cur.endurance && r.endurance_h > 0) { next.endurance = String(r.endurance_h); ai.push('endurance'); }
            const crew = String(r.crew_type ?? '').split(',').filter((c) => c === 'sp' || c === 'mp');
            if (!cur.crew.length && crew.length) { next.crew = crew; ai.push('crew'); }
            if (!cur.engine && r.engine_type) { next.engine = r.engine_type; ai.push('engine'); }
            if (!cur.category && r.category) { next.category = r.category; ai.push('category'); }
            return { ...a, [type]: { ...next, ai: [...cur.ai, ...ai] } };
          });
        })
        .catch(() => setAcFailed((st) => new Set(st).add(type)))
        .finally(() => setAcLoading((st) => { const n = new Set(st); n.delete(type); return n; }));
    }
  }, [stage, newTypes]);
  const page = pages[activePage];
  const busy = pages.some((p) => p.status !== 'done' && p.status !== 'error');
  const importCount = rows.filter((r) => !r.skip).length;

  const selectedIssue = selection?.kind === 'issue' ? issues.find((i) => i.id === selection.id) ?? null : null;
  const selectedRow = selection ? rowByKey.get(selection.kind === 'issue' ? selectedIssue?.rowKey ?? '' : selection.rowKey) ?? null : null;
  const selField = selectedIssue ? selectedIssue.field : selection?.kind === 'cell' ? selection.field : '';

  // Boken ryms mellan topraden och frågepanelen.
  const imgTop = insets.top + 56 + (pages.length > 1 ? 42 : 0);
  const imgBottom = H - insets.bottom - PANEL_H - 10;
  const fit = useMemo(() => {
    if (!page) return { x: 0, y: imgTop, w: W, h: imgBottom - imgTop };
    const availW = W - insets.left - insets.right - 16, availH = Math.max(80, imgBottom - imgTop);
    const sc = Math.min(availW / page.width, availH / page.height);
    const w = page.width * sc, h = page.height * sc;
    return { x: (W - w) / 2, y: imgTop + (availH - h) / 2, w, h };
  }, [page, W, imgTop, imgBottom, insets.left, insets.right]);

  // ── Zoom ───────────────────────────────────────────────────────────────────

  const zoomTo = useCallback((rect: Rect | null, kb = 0) => {
    const sv: any = scrollRef.current;
    if (!sv?.scrollResponderZoomTo) return;
    if (!rect) { sv.scrollResponderZoomTo({ x: 0, y: 0, width: W, height: H, animated: true }); return; }
    const visTop = kb > 0 ? insets.top + 8 : imgTop;
    const visBottom = kb > 0 ? H - kb - COMPACT_H - 10 : imgBottom;
    const visH = Math.max(60, visBottom - visTop);
    const ringW = rect.w * fit.w, ringH = rect.h * fit.h;
    // Ringen tar ungefär en tredjedel av höjden, med raderna runt omkring synliga.
    let sc = Math.min(visH * 0.32 / Math.max(ringH, 1), W * 0.6 / Math.max(ringW, 1), 4.5);
    sc = Math.max(1, sc);
    const cx = fit.x + (rect.x + rect.w / 2) * fit.w;
    const cy = fit.y + (rect.y + rect.h / 2) * fit.h;
    sv.scrollResponderZoomTo({
      x: cx - (W / 2) / sc, y: cy - (visTop + visH / 2) / sc, width: W / sc, height: H / sc, animated: true,
    });
  }, [W, H, fit, insets.top, imgTop, imgBottom]);

  const rectFor = useCallback((sel: Selection): Rect | null => {
    if (!sel) return null;
    if (sel.kind === 'issue') return issues.find((i) => i.id === sel.id)?.rect ?? null;
    const row = rowByKey.get(sel.rowKey);
    const grid = row ? pages[row.page]?.grid : null;
    if (!row || !grid) return null;
    return cellRect(grid, row.rowIndex, sel.field) ?? rowRect(grid, row.rowIndex);
  }, [issues, rowByKey, pages]);

  const select = (sel: Selection) => {
    setEditTarget(null);
    Keyboard.dismiss();
    setTyping(false);
    setAirportHits([]);
    setSelection(sel);
    if (!sel) { zoomTo(null); return; }
    const row = rowByKey.get(sel.kind === 'issue' ? issues.find((i) => i.id === sel.id)?.rowKey ?? '' : sel.rowKey);
    const field = sel.kind === 'issue' ? issues.find((i) => i.id === sel.id)?.field ?? '' : sel.field;
    const rs = sel.kind === 'issue' && issues.find((i) => i.id === sel.id)?.kind === 'remark' ? row?.data.remarks_suggestion : undefined;
    setDraft(rs ? rs.value : row && field ? inputValue(row.data, field, fmtRef.current) : '');
    const go = () => zoomTo(rectFor(sel));
    if (row && row.page !== activePage) { setActivePage(row.page); setTimeout(go, 80); } else go();
  };

  useEffect(() => {
    if (!selection) return;
    zoomTo(rectFor(selection), typing ? kbHeight : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbHeight, typing]);
  // Kolumnfrågan man hamnade på finns inte längre (summan gick ihop när cellen rättades) → vidare till nästa
  // öppna fråga efter den man just svarade på.
  const lastAnswered = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selection?.kind !== 'issue' || !selection.id.startsWith('col:') || issues.some((i) => i.id === selection.id)) return;
    const n = nextOpen(lastAnswered.current);
    select(n ? { kind: 'issue', id: n.id } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, selection]);

  // ── Ändringar ──────────────────────────────────────────────────────────────

  // Samma typ på andra rader: ändrar man typen på EN rad frågar appen om skanningens övriga rader med samma typ ska
  // få den nya också, så att en rättelse inte blir två olika flygplan i flottan ("A109" och "A109LUH").
  const offerTypeSpread = (rowKey: string, from: string, to: string) => {
    const f = typeKey(from), t = typeKey(to);
    if (!f || !t || f === t) return;
    const keys = rows.filter((r) => !r.skip && r.key !== rowKey && typeKey(r.data.aircraft_type) === f).map((r) => r.key);
    if (keys.length) setTypeSpread({ from: from.toUpperCase().trim(), to: to.toUpperCase().trim(), keys });
  };
  // Byter typen på raderna (de räknas sedan som ändrade av användaren, så ihopslagningen ändrar dem inte tillbaka).
  // keepOrig: en annan variant slås ihop ("Merge into one") → den gamla typen sparas så att det går att ångra i Fleet.
  const retype = (keys: string[], to: string, keepOrig = false) => {
    if (!keys.length) return;
    touched.current = true;
    for (const k of keys) typeEdited.current.add(k);
    const set = new Set(keys);
    setRows((prev) => prev.map((r) => (set.has(r.key)
      ? { ...r, data: { ...r.data, aircraft_type: to, ...(keepOrig ? { aircraft_type_orig: r.data.aircraft_type_orig || r.data.aircraft_type || '' } : {}) } }
      : r)));
    for (const k of keys) resolveFields(k, ['aircraft_type']);
  };
  const keysOfType = (t: string) => rows.filter((r) => !r.skip && typeKey(r.data.aircraft_type) === typeKey(t)).map((r) => r.key);
  const mergeTypes = (from: string, to: string) => retype(keysOfType(from), to.toUpperCase().trim());
  const mergeVariant = (from: string, to: string) => retype(keysOfType(from), to.toUpperCase().trim(), true);

  const setField = (rowKey: string, field: string, value: string) => {
    touched.current = true;
    if (field === 'aircraft_type' && (rows.find((r) => r.key === rowKey)?.data.aircraft_type || '').toUpperCase() !== value.toUpperCase()) {
      typeEdited.current.add(rowKey);
      offerTypeSpread(rowKey, rows.find((r) => r.key === rowKey)?.data.aircraft_type || '', value);
    }
    if (field === 'second_pilot') { crewEdited.current.add(rowKey); nameWritten.current.delete(rowKey); }
    const before = rows.find((r) => r.key === rowKey);
    if (before && upper((before.data as any)[field]) !== upper(value)) learnAnswer(field, rowKey, (before.data as any)[field], value);
    handTouched.current.add(`${rowKey}|${field}`);
    if (before) noteHandwriting(before, field, value);
    setRows((prev) => prev.map((r) => {
      if (r.key !== rowKey) return r;
      // Simulatorpass: passets längd är både simulatortid och total tid (appens modell) — håll dem lika.
      const sync = r.data.flight_type === 'sim' && (field === 'sim' || field === 'total_time') ? { sim: value, total_time: value } : {};
      // Landningar flyttade dag ↔ natt (frågan "day or night?", from = kolumnen Claude lade dem i): samma tal i
      // grannkolumnen töms, så att landningarna inte räknas två gånger.
      const moved = (r.data.field_issues ?? []).find((x) => x.field === field && (x.from === 'landings_day' || x.from === 'landings_night'));
      const unmove = moved && Number(value) > 0 && Number((r.data as any)[moved.from!]) === Number(value) ? { [moved.from!]: '0' } : {};
      return { ...r, data: { ...r.data, [field]: value, ...sync, ...unmove } };
    }));
  };

  // Samma svar tre gånger → regel för resten av boken. Frågorna försvinner, och raden visas ett tag med "Undo".
  const showLearned = (text: string, rule?: ValueRule, hand?: string) => {
    setLearnNote({ text, rule, hand });
    if (learnTimer.current) clearTimeout(learnTimer.current);
    learnTimer.current = setTimeout(() => setLearnNote(null), 7000);
  };
  // Handstilsprofilen: lägger rättningar och förslag på raderna (muterar, för rader som inte är satta än).
  const applyHand = (list: ScanRow[], res: { fixes: HandFix[]; suggestions: HandSuggestion[] }) => {
    for (const f of res.fixes) {
      const r = list.find((x) => x.key === f.rowKey);
      if (!r || String((r.data as any)[f.field] ?? '') !== f.from) continue;
      r.data = { ...r.data, [f.field]: f.to };
      handFixes.current.push(f);
    }
    for (const g of res.suggestions) {
      const r = list.find((x) => x.key === g.rowKey);
      if (!r || (r.data.field_issues ?? []).some((x) => x.field === g.field)) continue;
      r.data = { ...r.data, needs_review: true, field_issues: [...(r.data.field_issues ?? []), { field: g.field, reason: g.reason, confidence: 0.5, suggested_value: g.value, hand: g.pair }] };
    }
    if (res.fixes.length || res.suggestions.length) {
      setHandLearned((prev) => {
        const next = [...prev];
        for (const pair of new Set([...res.fixes.map((f) => f.pair), ...res.suggestions.map((g) => g.pair)])) {
          const k = next.findIndex((x) => x.pair === pair);
          const add = { fixed: res.fixes.filter((f) => f.pair === pair).length, suggested: res.suggestions.filter((g) => g.pair === pair).length };
          if (k < 0) next.push({ pair, ...add }); else next[k] = { pair, fixed: next[k].fixed + add.fixed, suggested: next[k].suggested + add.suggested };
        }
        return next;
      });
    }
  };
  // En rättning av Claudes egen läsning (inte av en tidigare rättning), en gång per cell, lärs in i profilen.
  // Börjar en förväxling gälla gås hela skanningen igenom.
  const noteHandwriting = (row: ScanRow, field: string, value: string) => {
    const cell = `${row.key}|${field}`;
    const was = String((row.data as any)[field] ?? '');
    const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
    if (!HAND_FIELDS.has(field) || handCounted.current.has(cell) || !dig(was) || dig(was) !== dig((row.original as any)?.[field])) return;
    const swaps = digitSwaps(was, value);
    if (!swaps.length) return;
    handCounted.current.add(cell);
    const beforePairs = new Set(activePairs(handRef.current, handBlocked.current).map((x) => `${x.read}>${x.actual}`));
    handRef.current = recordCorrection(handRef.current, swaps);
    setSetting(handKey.current, JSON.stringify(handRef.current)).catch(() => {});
    const fresh = activePairs(handRef.current, handBlocked.current).filter((x) => !beforePairs.has(`${x.read}>${x.actual}`));
    if (!fresh.length) return;
    const list = rows.map((r) => (r.key === row.key ? { ...r, data: { ...r.data, [field]: value } } : { ...r }));
    const printed: Record<number, Record<string, number>> = {};
    pagesRef.current.forEach((_, idx) => { printed[idx] = Object.fromEntries(columnTotals(list, idx, pagesRef.current[idx]?.totals?.by_field).map((c) => [c.field, c.printed])); });
    const res = handwritingSweep(list, fresh, printed, handTouched.current, additionRef.current ?? 0);
    const changed = new Map<string, ScanRow>();
    const work = list.filter((r) => res.fixes.some((f) => f.rowKey === r.key) || res.suggestions.some((g) => g.rowKey === r.key));
    applyHand(work, res);
    work.forEach((r) => changed.set(r.key, r));
    if (changed.size) setRows((prev) => prev.map((r) => {
      const c = changed.get(r.key);
      if (!c) return r;
      // Bara cellerna profilen rörde; resten av raden kan ha ändrats sedan.
      const patch: Record<string, any> = {};
      for (const f of res.fixes) if (f.rowKey === r.key && String((r.data as any)[f.field] ?? '') === f.from) patch[f.field] = f.to;
      const extra = (c.data.field_issues ?? []).filter((x) => x.hand && !(r.data.field_issues ?? []).some((y) => y.field === x.field));
      return { ...r, data: { ...r.data, ...patch, ...(extra.length ? { needs_review: true, field_issues: [...(r.data.field_issues ?? []), ...extra] } : {}) } };
    }));
    const p = fresh[0];
    const n = res.fixes.length, m = res.suggestions.length;
    console.log(`[SCAN] Handstilen: ${fresh.map((x) => `${x.read}>${x.actual}`).join(', ')} gäller nu · ${n} rättade · ${m} förslag`);
    showLearned(`Your ${p.actual}s can look like ${p.read}s.${n ? ` Fixed ${n} ${n === 1 ? 'cell' : 'cells'} your totals confirm.` : ''}${m ? ` ${m} more to check.` : ''}`, undefined, `${p.read}>${p.actual}`);
  };
  // Ångra: rättningarna läggs tillbaka (där cellen inte ändrats sedan), förslagen tas bort och förväxlingen nollas.
  const undoHand = (pair: string) => {
    const fixes = handFixes.current.filter((f) => f.pair === pair);
    handFixes.current = handFixes.current.filter((f) => f.pair !== pair);
    handBlocked.current.add(pair);
    handRef.current = { ...handRef.current, pairs: { ...handRef.current.pairs, [pair]: 0 } };
    setSetting(handKey.current, JSON.stringify(handRef.current)).catch(() => {});
    setRows((prev) => prev.map((r) => {
      const mine = fixes.filter((f) => f.rowKey === r.key && String((r.data as any)[f.field] ?? '') === f.to);
      const hasHand = (r.data.field_issues ?? []).some((x) => x.hand === pair);
      if (!mine.length && !hasHand) return r;
      return { ...r, data: { ...r.data, ...Object.fromEntries(mine.map((f) => [f.field, f.from])), field_issues: (r.data.field_issues ?? []).filter((x) => x.hand !== pair) } };
    }));
    setHandLearned((prev) => prev.filter((x) => x.pair !== pair));
    setLearnNote(null);
  };
  const saveRules = (next: ValueRule[]) => {
    rulesRef.current = next;
    setRules(next);
    setSetting('scan_value_rules', JSON.stringify(next)).catch(() => {});
  };
  // En registrering som inte finns i flottan, eller som granskningen frågar om: ett svar räcker och gäller
  // direkt alla rader med samma läsning (annars först efter LEARN_AFTER lika svar).
  const isNewReading = (field: string, v: unknown) => field === 'registration' && !!upper(v)
    && (!fleetRegs.some((f) => upper(f.registration) === upper(v)) || regChecks.some((c) => c.reg === upper(v) && c.ask));
  const learnAnswer = (field: string, rowKey: string, from: unknown, to: unknown) => {
    const direct: ValueRule | null = isNewReading(field, from) && upper(to) && !rulesRef.current.some((r) => r.cls === 'registration' && r.from === upper(from))
      ? { cls: 'registration', from: upper(from), to: upper(to) } : null;
    const rule = direct ?? noteAnswer(ruleAnswers.current, rulesRef.current, field, rowKey, from, to);
    if (!rule) return;
    saveRules([...rulesRef.current, rule]);
    const n = rows.filter((r) => r.key !== rowKey && (ruleFor([rule], 'dep_place', r.data.dep_place) || ruleFor([rule], 'arr_place', r.data.arr_place) || ruleFor([rule], 'registration', r.data.registration))).length;
    setRows((prev) => applyValueRules(prev, [rule], ruleStash.current));
    console.log(`[SCAN] Lärt: ${rule.from} → ${rule.to} (${n} rader till)`);
    showLearned(rule.from === rule.to ? `${rule.from} is right. Won't ask again.` : `${rule.from} is now ${rule.to}${n ? ` on ${n} more ${n === 1 ? 'row' : 'rows'}` : ''}.`, rule);
  };
  const undoRule = (rule: ValueRule) => {
    saveRules(rulesRef.current.filter((r) => !(r.cls === rule.cls && r.from === rule.from)));
    ruleAnswers.current.delete(`${rule.cls}|${rule.from}|${rule.to}`);
    setRows((prev) => undoValueRule(prev, rule, ruleStash.current));
    setLearnNote(null);
  };
  // Rapporten: byt en registrering på alla rader som har den (eller bekräfta den: to = from). Sparas som en
  // regel, så att den står under "Learned from your answers" och kan ångras där.
  const changeRegistration = (fromRaw: string, toRaw: string) => {
    const from = upper(fromRaw), to = upper(toRaw);
    if (!from || !to) return;
    touched.current = true;
    const rule: ValueRule = { cls: 'registration', from, to };
    saveRules([...rulesRef.current.filter((r) => !(r.cls === 'registration' && r.from === from)), rule]);
    setRows((prev) => applyValueRules(prev, [rule], ruleStash.current));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  // Frågor som en regel just tog bort (raderna här är från före uppdateringen).
  const coveredByRule = (i: Issue) => !!rowByKey.get(i.rowKey) && !!ruleFor(rulesRef.current, i.field, (rowByKey.get(i.rowKey)!.data as any)[i.field]);

  const nextOpen = (afterId?: string, justResolved?: string | string[]) => {
    const skip = new Set([justResolved ?? []].flat());
    const open = issues.filter((i) => !isDone(i) && !skip.has(i.id) && !coveredByRule(i));
    if (open.length === 0) return null;
    const idx = afterId ? issues.findIndex((i) => i.id === afterId) : -1;
    return open.find((i) => issues.indexOf(i) > idx) ?? open[0];
  };

  const resolve = (id: string, how: 'ok' | 'changed') => {
    touched.current = true;
    lastAnswered.current = id;
    const members = issues.find((i) => i.id === id)?.group?.members ?? [];
    setResolved((r) => ({ ...r, [id]: how, ...Object.fromEntries(members.map((m) => [m, how])) }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const n = nextOpen(id, id);
    select(n ? { kind: 'issue', id: n.id } : null);
  };

  const expandGroup = (issue: Issue, startAt?: string) => {
    if (!issue.group) return;
    const key = issue.group.key;
    const first = startAt ?? issue.group.members.find((m) => !resolved[m]) ?? issue.group.members[0];
    setExpanded((e) => new Set([...e, key]));
    const row = rowByKey.get(first.split(':f:')[0]);
    setDraft(row ? inputValue(row.data, issue.field, fmtRef.current) : '');
    setTyping(false);
    // Medlemmarna finns som egna punkter först efter omräkningen → välj i nästa tick.
    setTimeout(() => setSelection({ kind: 'issue', id: first }), 0);
    const rect = issue.group.rects[Math.max(0, issue.group.members.indexOf(first))];
    if (rect) zoomTo(rect);
  };

  // "Ja": tillägget gäller alla rader som stämmer med det och sparas till nästa skanning (Claude får regeln).
  // "Nej": frågan delas upp i en fråga per rad (expandGroup).
  const acceptAddition = (issue: Issue) => {
    const h = parseFloat(issue.suggestions[0]?.value ?? '');
    if (!(h > 0)) return;
    const idx = issues.indexOf(issue);
    const open = issues.filter((i) => !isDone(i) && i.kind !== 'addition'
      && !(i.kind === 'mismatch' && fitsTimeAddition(rowByKey.get(i.rowKey)!.data, h)));
    const n = open.find((i) => issues.indexOf(i) > idx) ?? open[0] ?? null;
    touched.current = true;
    additionRef.current = h;
    setAddition(h);
    setSetting('scan_time_addition', String(h)).catch(() => {});
    // Redan lästa uppslag: tillägget som stod i cellerna men lästes utan läggs till där sidans summa bekräftar.
    setRows((prev) => {
      const copy = prev.map((r) => ({ ...r }));
      pagesRef.current.forEach((pg, idx) => reconcileAddition(copy, idx, pg.totals?.by_field, h));
      return copy;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    select(n ? { kind: 'issue', id: n.id } : null);
  };

  // "Fel kolumn": talet hör till grannkolumnen. Det flyttas dit (ersätter det som stod där) och fältet blir 0.
  // Står inget tal i fältet används förslaget (t.ex. det Vision läste).
  const movableValue = (issue: Issue | null, row: ScanRow | null): string => {
    if (!issue || !row) return '';
    const cur = String((row.data as any)[issue.field] ?? '');
    if (parseFloat(cur) > 0) return cur;
    return issue.suggestions.find((x) => x.field === issue.field && parseFloat(x.value) > 0)?.value ?? '';
  };
  const moveToColumn = (issue: Issue, to: string) => {
    const row = rowByKey.get(issue.rowKey);
    const v = movableValue(issue, row ?? null);
    if (!row || !v) return;
    touched.current = true;
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, data: { ...r.data, [to]: v, [issue.field]: '0' } } : r)));
    resolve(issue.id, 'changed');
  };
  // "Move N flights to Co-pilot": värdena flyttas till grannkolumnen på raderna Vision pekade ut. Båda
  // kolumnerna går då ihop, så båda frågorna är klara.
  const moveColumnRows = (issue: Issue) => {
    const mv = issue.column?.move;
    if (!mv) return;
    touched.current = true;
    const keys = new Set(mv.keys);
    setRows((prev) => prev.map((r) => (keys.has(r.key)
      ? { ...r, data: { ...r.data, [mv.to]: String((r.data as any)[mv.from] ?? ''), [mv.from]: '0' } } : r)));
    const both = [`col:${issue.page}:${mv.from}`, `col:${issue.page}:${mv.to}`];
    setResolved((r) => ({ ...r, ...Object.fromEntries(both.map((id) => [id, 'changed' as const])) }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const n = nextOpen(issue.id, both);
    select(n ? { kind: 'issue', id: n.id } : null);
  };

  // "Correct my total": flygningarna stämmer, summan i pappersboken är fel. Rättelsen (och följdsummorna)
  // listas i guiden efter Save.
  const correctPaperTotal = (issue: Issue) => {
    setPaperFixed((f) => new Set([...f, issue.id]));
    resolve(issue.id, 'ok');
  };
  // "Skip row N": dubbelraden lämnas utanför, kolumnen går ihop och frågan försvinner.
  const skipExtraRow = (issue: Issue) => {
    const key = issue.column?.extraRow?.key;
    if (!key) return;
    touched.current = true;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, skip: true } : r)));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const n = nextOpen(issue.id, issue.id);
    select(n ? { kind: 'issue', id: n.id } : null);
  };


  // Svaret på "New aircraft type" gäller alla skrivsätt i typen (asWritten = gruppens id).
  const applyAircraft = (issue: Issue, type: string) => nameType(issue.aircraft!.asWritten, type);

  // Simulatorpass: tiden flyttas till simulator, total tid = simulatortid (som parsern gör), och en fråga om
  // simulatortyp läggs till. Landningar som står på raden behålls (simulatorlandningar räknas för recency).
  const toSimulator = (items: { rowKey: string; sg: Suggestion }[]) => {
    const by = new Map(items.map((x) => [x.rowKey, x.sg]));
    touched.current = true;
    setRows((prev) => prev.map((r) => {
      const sg = by.get(r.key);
      if (!sg) return r;
      return { ...r, data: {
        ...r.data, flight_type: 'sim', sim: sg.value, total_time: sg.value, ...(sg.toSim !== 'total_time' ? { [sg.toSim!]: '0' } : {}),
        // Simulatortyp: FFS om ingen är vald (ingen fråga om typen).
        sim_category: r.data.sim_category || ('FFS' as const),
        field_issues: (r.data.field_issues ?? []).filter((i) => i.field !== 'sim_category'),
      } };
    }));
  };

  const applyGroupChoice = (issue: Issue, value: string) => {
    if (!issue.group) return;
    const keys = new Set(issue.group.members.map((m) => m.split(':f:')[0]));
    touched.current = true;
    setRows((prev) => prev.map((r) => (keys.has(r.key) ? { ...r, data: { ...r.data, [issue.field]: chipKey(value) } } : r)));
    resolve(issue.id, 'changed');
  };

  const applyGroupSim = (issue: Issue) => {
    if (!issue.group?.sims) return;
    toSimulator(issue.group.sims);
    resolve(issue.id, 'changed');
  };

  // Initialerna i anmärkningen → Second pilot på alla rader i gruppen (en fråga för hela skanningen).
  const applyGroupRemarks = (issue: Issue) => {
    if (!issue.group?.remarks) return;
    const keys = new Set(issue.group.members.map((id) => id.replace(/:remark$/, '')));
    touched.current = true;
    setRows((prev) => prev.map((r) => {
      const rs = r.data.remarks_suggestion;
      if (!keys.has(r.key) || !rs) return r;
      const role = crewRoleFor(r.data, remarkRoles[issue.id] ?? BY_FLIGHT);
      return { ...r, data: { ...r.data, [rs.field]: rs.value, second_pilot_role: role, remarks: withoutSuggestion(r.data.remarks, rs.original_text) } };
    }));
    resolve(issue.id, 'changed');
  };

  const applySuggestion = (issue: Issue, sg: Suggestion) => {
    const row = rowByKey.get(issue.rowKey);
    if (!row) return;
    if (issue.kind === 'aircraft') applyAircraft(issue, sg.value);
    else if (issue.kind === 'remark') {
      const rs = row.data.remarks_suggestion!;
      const cleaned = withoutSuggestion(row.data.remarks, rs.original_text);
      touched.current = true;
      // sg.value = Claudes förslag, eller det användaren rättat det till (t.ex. JEV → JEN).
      const value = sg.value || rs.value;
      // Second pilot sparas med vald roll (förval: PIC utan egen PIC-tid, annars SIC).
      const role = rs.field === 'second_pilot' ? crewRoleFor(row.data, remarkRoles[issue.id] ?? defaultCrewRole(row.data)) : undefined;
      setRows((prev) => prev.map((r) => (r.key === row.key
        ? { ...r, data: { ...r.data, [rs.field]: value, remarks: cleaned, ...(role ? { second_pilot_role: role } : {}) } } : r)));
      if (rs.field === 'second_pilot') saveLearnedMapping('second_pilot', rs.original_text, value).catch(() => {});
    } else if (sg.toSim) toSimulator([{ rowKey: row.key, sg }]);
    else if (issue.kind === 'choice') setField(row.key, sg.field, chipKey(sg.value));
    else setField(row.key, sg.field, sg.value);
    resolve(issue.id, 'changed');
  };

  // "Looks right": Claudes läsning stämmer. För en ny flygplanstyp betyder det Claudes tolkning.
  const confirm = () => {
    if (!selectedIssue) { select(null); return; }
    if (selectedIssue.kind === 'aircraft') { applySuggestion(selectedIssue, { label: '', field: 'aircraft_type', value: selectedIssue.aircraft!.resolved }); return; }
    if (ruleClassOf(selectedIssue.field)) {
      const keys = selectedIssue.group ? selectedIssue.group.members.map((m) => m.split(':f:')[0]) : [selectedIssue.rowKey];
      for (const k of keys) { const v = (rowByKey.get(k)?.data as any)?.[selectedIssue.field]; learnAnswer(selectedIssue.field, k, v, v); }
    }
    resolve(selectedIssue.id, 'ok');
  };

  const save = () => {
    if (!selectedRow || !selField) return;
    if (editTarget) {
      const value = parseInput(editTarget, draft, fmtRef.current);
      if (value == null) {
        Alert.alert('Check the value', CLOCK.has(editTarget) ? 'Write the time as HH:MM, with hours 00–23 and minutes 00–59.' : `That doesn't look like a valid ${label(editTarget).toLowerCase()}.`);
        return;
      }
      setField(selectedRow.key, editTarget, value);
      setEditTarget(null);
      Keyboard.dismiss(); setTyping(false);
      if (selectedIssue) resolve(selectedIssue.id, 'changed');
      return;
    }
    const rs = selectedIssue?.kind === 'remark' ? selectedRow.data.remarks_suggestion : undefined;
    if (rs && selectedIssue) {
      const value = parseInput(rs.field, draft, fmtRef.current);
      if (!value) { Alert.alert('Check the value', `Write the ${label(rs.field).toLowerCase()}.`); return; }
      Keyboard.dismiss(); setTyping(false);
      // Second pilot: namnet står kvar i rutan; "Save" sparar det med vald roll. Övrigt flyttas direkt.
      if (rs.field === 'second_pilot') { setDraft(value); return; }
      applySuggestion(selectedIssue, { label: value, field: rs.field, value });
      return;
    }
    const value = parseInput(selField, draft, fmtRef.current);
    if (value == null) {
      Alert.alert('Check the value', selField === 'date' ? 'Write the date as YYYY-MM-DD.'
        : CLOCK.has(selField) ? 'Write the time as HH:MM, with hours 00–23 and minutes 00–59.' : `That doesn't look like a valid ${label(selField).toLowerCase()}.`);
      return;
    }
    if (stage === 'report') {
      setField(selectedRow.key, selField, value);
      const cellId = `${selectedRow.key}:f:${selField}`;
      setResolved((r) => {
        const next = { ...r };
        for (const i of issues) {
          if (i.group?.members.includes(cellId)) next[cellId] = 'changed';
          else if (i.rowKey === selectedRow.key && i.field === selField) next[i.id] = 'changed';
        }
        return next;
      });
      Keyboard.dismiss(); setTyping(false); setSelection(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return;
    }
    if (selectedIssue?.kind === 'aircraft') { applySuggestion(selectedIssue, { label: value, field: 'aircraft_type', value }); return; }
    setField(selectedRow.key, selField, value);
    const issue = selectedIssue ?? issues.find((i) => i.rowKey === selectedRow.key && i.field === selField && !resolved[i.id]);
    if (issue) resolve(issue.id, 'changed');
    else { Keyboard.dismiss(); setTyping(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
  };

  const onDraft = async (text: string) => {
    const t = shapeInput(selField, text);
    setDraft(t);
    if (PLACE.has(selField) && t.length >= 2 && t.length <= 4) {
      try {
        const { searchAirports } = require('../../db/icao');
        const hits = await searchAirports(t, 4);
        setAirportHits(hits.slice(0, 4).map((h: any) => ({ icao: h.icao, name: h.name })));
      } catch { setAirportHits([]); }
    } else setAirportHits([]);
  };

  const toggleSkip = (rowKey: string) => {
    touched.current = true;
    const wasSkipped = rowByKey.get(rowKey)?.skip;
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, skip: !r.skip } : r)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!wasSkipped) {
      const from = issues.findIndex((x) => x.rowKey === rowKey);
      const n = issues.find((i, idx) => !resolved[i.id] && i.rowKey !== rowKey && idx > from) ?? issues.find((i) => !resolved[i.id] && i.rowKey !== rowKey);
      select(n ? { kind: 'issue', id: n.id } : null);
    }
  };

  // ── Tryck i boken ──────────────────────────────────────────────────────────

  const onImagePress = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!page || page.status !== 'done') return;
    const x = e.nativeEvent.locationX / fit.w, y = e.nativeEvent.locationY / fit.h;
    const hitIssue = issues.filter((i) => i.page === activePage && i.kind !== 'column' && (i.group
      ? i.group.rects.some((r) => contains(r, x, y, 0.004))
      : i.rect && contains(i.rect, x, y, 0.004)))
      .sort((a, b) => (a.group ? 1 : (a.rect!.w * a.rect!.h)) - (b.group ? 1 : (b.rect!.w * b.rect!.h)))[0];
    if (hitIssue) { select({ kind: 'issue', id: hitIssue.id }); return; }
    const hit = page.grid ? hitTest(page.grid, x, y) : null;
    const row = hit ? rows.find((r) => r.page === activePage && r.rowIndex === hit.rowIndex) : null;
    if (!hit?.field || !row) { select(null); return; }
    select({ kind: 'cell', rowKey: row.key, field: hit.field });
  };

  // ── Import / stäng ─────────────────────────────────────────────────────────

  // Efter frågorna: rapporten med alla flygningar. Inget sparas förrän "Save" där.
  const openReport = () => {
    if (rows.length === 0) return;
    if (busy) { Alert.alert('Still reading', 'Wait until every spread has been read.'); return; }
    const go = async () => {
      Keyboard.dismiss(); setTyping(false); setSelection(null);
      setScanMatch(await matchScanRows(rows, timeBasis).catch(() => scanMatch));
      setStage('report');
    };
    if (openIssues.length > 0) {
      Alert.alert(
        openIssues.length === 1 ? '1 thing not checked' : `${openIssues.length} things not checked`,
        "You can still change them in the scan report, where they're marked yellow.",
        [
          { text: 'Check them', style: 'cancel', onPress: () => select({ kind: 'issue', id: openIssues[0].id }) },
          { text: 'See report', onPress: go },
        ],
      );
      return;
    }
    go();
  };

  // Bokens tryckta rader per uppslag: samma bok har lika många på varje uppslag.
  const rowsPerPageOf = (pg: number) => typicalRowsPerPage(pages.map((p) => p.grid?.rowsPerPage ?? 0), pages[pg]?.grid?.rowsPerPage) ?? 12;

  // Rättelserna i pappersboken: bara kolumner som fortfarande inte går ihop (ändrade användaren en avläsning
  // efteråt så att summan stämmer, behövs ingen rättelse).
  const paperFixes: PaperFix[] = [...paperFixed].flatMap((id) => {
    const [, pg, field] = id.split(':');
    const page = Number(pg);
    const c = columnTotals(rows, page, pages[page]?.totals?.by_field).find((x) => x.field === field);
    return c && !c.ok ? [{ page, field, from: c.printed, to: c.sum }] : [];
  });

  // Efter Save: tillbaka till dashboarden, eller till "Scan your whole logbook" när det var en omgång ur en hel bok.
  const leave = () => {
    if (bookRef.current) { router.back(); return; }
    // Från onboardingen ligger den kvar under i stacken: till dashboarden, som efter en CSV-import.
    if (getScanFromOnboarding()) { setScanFromOnboarding(false); router.replace('/(tabs)'); return; }
    router.dismissAll();
  };

  // Rapporten: en rad som redan finns i loggboken tas med ("Include") eller lämnas utanför igen; övriga hoppas över.
  const reportToggle = (rowKey: string) => {
    touched.current = true;
    if (scanMatch.dups[rowKey] && !rowByKey.get(rowKey)?.skip) {
      setDupIncluded((p) => { const n = new Set(p); if (n.has(rowKey)) n.delete(rowKey); else n.add(rowKey); return n; });
      return;
    }
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, skip: !r.skip } : r)));
  };
  // Krock med loggboken: behåll båda, den skannade (loggbokens tas bort vid Save) eller loggbokens (raden hoppas över).
  const clashChoice = (rowKey: string): ClashChoice => (rowByKey.get(rowKey)?.skip ? 'logbook' : keepNew.has(rowKey) ? 'new' : 'both');
  const chooseClash = (rowKey: string, c: ClashChoice) => {
    touched.current = true;
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, skip: c === 'logbook' } : r)));
    setKeepNew((p) => { const n = new Set(p); if (c === 'new') n.add(rowKey); else n.delete(rowKey); return n; });
  };
  const removeIds = [...new Set([...keepNew].filter((k) => rowByKey.get(k) && !rowByKey.get(k)!.skip)
    .flatMap((k) => (scanMatch.clashes[k] ?? []).map((c) => c.logged.id)))];

  // Rapportens modeller: farthastighet (kt) och uthållighet (h), redigerbara direkt. Nya typer använder
  // uppgifterna som hämtas (aircraft), flottans typer det som finns sparat plus det som ändrats.
  const modelSpecs = useMemo(() => {
    const out: Record<string, { speed: string; endurance: string; loading?: boolean }> = {};
    for (const r of rows) {
      const t = String(r.data.aircraft_type || '').toUpperCase().trim();
      if (!t || out[t]) continue;
      const a = aircraft[t];
      out[t] = a ? { speed: a.speed, endurance: a.endurance, loading: acLoading.has(t) }
        : { speed: specEdits[t]?.speed ?? fleetSpecs[t]?.speed ?? '', endurance: specEdits[t]?.endurance ?? fleetSpecs[t]?.endurance ?? '' };
    }
    return out;
  }, [rows, aircraft, acLoading, fleetSpecs, specEdits]);
  const setModelSpec = (type: string, field: 'speed' | 'endurance', raw: string) => {
    const value = field === 'speed' ? raw.replace(/[^0-9]/g, '').slice(0, 4) : raw.replace(',', '.').replace(/[^0-9.]/g, '').slice(0, 5);
    touched.current = true;
    if (aircraft[type]) setAircraft((a) => ({ ...a, [type]: { ...a[type], [field]: value, ai: a[type].ai.filter((x) => x !== field) } }));
    else setSpecEdits((e) => ({ ...e, [type]: { ...e[type], [field]: value } }));
  };

  const saveReport = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Nya flygplanstyper med uppgifterna från rapporten (som CSV-importen).
      for (const { type } of newTypes) {
        const a = aircraft[type] ?? emptyAircraftInput();
        const speed = parseInt(a.speed, 10) || 0, endurance = parseFloat(a.endurance) || 0;
        await addAircraftTypeToRegistry(type, speed, endurance, [...a.crew].sort().join(','), a.category, a.engine);
        if (speed > 0) await updateAircraftCruiseSpeed(type, speed);
        if (endurance > 0) await updateAircraftEndurance(type, endurance);
      }
      // Flottans typer där farthastighet eller uthållighet ändrats i rapporten.
      for (const [type, e] of Object.entries(specEdits)) {
        if (newTypes.some((n) => n.type === type)) continue;
        const speed = parseInt(e.speed ?? '', 10) || 0, endurance = parseFloat(e.endurance ?? '') || 0;
        if (e.speed != null && speed > 0) await updateAircraftCruiseSpeed(type, speed);
        if (e.endurance != null && endurance > 0) await updateAircraftEndurance(type, endurance);
      }
      // Krockar där den skannade flygningen behålls: loggbokens flygning tas bort först.
      const removed = removeIds;
      if (removed.length) await deleteFlights(removed);
      const toSave = rows.map((r) => (duplicates.has(r.key) ? { ...r, skip: true } : r));
      await saveLearnedCorrections(toSave);
      const inLogbook = Object.fromEntries([...duplicates].map((k) => [k, scanMatch.dups[k]?.logged?.id ?? 0]).filter(([, id]) => id));
      const sum = await saveScanRows(toSave, { unknownIcaos: unknownIcaos.current, pageNumbers: pages.map((p) => p.pageNumbers), timeBasis, inLogbook });
      // Bokens format blir mallen "Scanned logbook", förvald när man skapar sin digitala loggbok. Från uppslaget
      // med flest lästa rader (tydligast rutnät).
      try {
        const best = pages.map((p, idx) => ({ idx, n: rows.filter((r) => r.page === idx && !r.skip).length, grid: p.grid }))
          .filter((x) => x.grid && x.n > 0).sort((a, b) => b.n - a.n)[0];
        if (best) {
          const id = await saveScannedTemplate({ rows: toSave.filter((r) => r.page === best.idx), grid: best.grid, rowsPerPage: rowsPerPageOf(best.idx) });
          if (id) console.log(`[SCAN] Bokens format sparat som mall ${id} (uppslag ${best.idx + 1})`);
        }
      } catch (e) { console.warn('[SCAN] Kunde inte spara bokens format:', e); }
      await Promise.all([loadFlights(), loadStats()]);
      // En omgång ur en hel bok: de lästa uppslagen markeras som sparade (bilderna raderas), och sista flygningen
      // följer med till nästa omgång. Uppslag som inte gick att läsa blir kvar och hamnar i en senare omgång.
      const book = bookRef.current;
      let bookLeft: number | null = null;
      if (book) {
        const kept = toSave.filter((r) => !r.skip).sort((a, b) => a.page - b.page || a.rowIndex - b.rowIndex);
        const last = kept[kept.length - 1]?.data;
        const doneIds = book.photoIds.filter((_, idx) => pages[idx]?.status === 'done');
        await useScanBookStore.getState().sessionSaved(doneIds, sum.saved, last ? {
          last_date: last.date, last_aircraft_type: last.aircraft_type, last_registration: last.registration,
          last_dep_place: last.dep_place, last_arr_place: last.arr_place, page_number: (pages[kept[kept.length - 1].page]?.pageNumbers.left ?? undefined) as number | undefined,
        } : undefined);
        bookLeft = useScanBookStore.getState().project?.photos.filter((ph) => ph.savedIn == null).length ?? 0;
        // Nästa del börjar med kolumnerna som stämde bäst här.
        if (bookFormatRef.current && bookGridRef.current && bookGridRef.current.score >= 0) {
          saveScanFormat({ ...bookFormatRef.current, template: bookGridRef.current }).catch(() => {});
        }
      }
      // Nya flygplanstyper: hela Fleet-datan (spec + bild) hämtas i bakgrunden, som efter CSV-importen.
      // Popupen "Fleet updated" visas när det är klart (global, skärmen har då oftast stängts).
      const fetchTypes = newTypes.map((n) => n.type);
      if (fetchTypes.length) {
        enrichFleetInBackground(fetchTypes).then((res) => {
          if (res.enriched > 0 || res.stoppedForQuota) useFleetDoneStore.getState().show(res, undefined, 'scan');
        }).catch(() => {});
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const parts = [`${sum.saved} ${sum.saved === 1 ? 'flight' : 'flights'} saved.`];
      if (sum.skipped > 0) parts.push(`${sum.skipped} left out.`);
      if (sum.duplicates) parts.push(`${sum.duplicates} already in your logbook.`);
      if (removed.length) parts.push(`${removed.length} overlapping ${removed.length === 1 ? 'flight' : 'flights'} removed from your logbook.`);
      if (sum.adjusted) parts.push(`${sum.adjusted} adjusted to match the page totals — marked in your logbook so you can check them against the paper book.`);
      if (newTypes.length) parts.push(`${newTypes.length} new aircraft added to your fleet. Their specs and photos are fetched in the background.`);
      if (sum.bookName) parts.push(`Linked to ${sum.bookName}, pages ${sum.pageLabel}.`);
      if (bookLeft != null) parts.push(bookLeft ? `${bookLeft === 1 ? 'One spread is' : `${bookLeft} spreads are`} left in your logbook scan.` : 'Every spread in your logbook scan is saved.');
      // Felräknade summor i pappersboken: guiden med alla handändringar visas innan skanningen stängs.
      // Pappersbokens lista: varje skannat uppslag (för täckningen) och de felräknade summorna. Guiden visar
      // ändringarna först när hela boken är skannad fram till sidan man skriver på (scanPaperFixes.ts).
      let ledgerNote: { added: number; unplaced: number; ready: boolean } | null = null;
      try {
        const stored = await loadLedger();
        const wasReady = ledgerStatus(stored).ready;
        // En hel bok: sidspannet användaren angav är bokens första och sista uppslag.
        const range = bookRef.current?.ledger;
        const before = range ? { ...stored, start: range.start ?? stored.start, latest: range.latest ?? stored.latest } : stored;
        const scanned: (LedgerSpread | null)[] = pages.map((pg, idx) => {
          if (pg.status !== 'done' || pg.pageNumbers.left == null) return null;
          // Sidan man skriver på nu: inte full och utan summor längst ner.
          const totalled = pg.totals?.total_this_page != null || Object.keys(pg.totals?.by_field ?? {}).length > 0;
          return {
            left: pg.pageNumbers.left, right: pg.pageNumbers.right,
            bf: pg.totals?.brought_forward ?? null, tp: pg.totals?.total_this_page ?? null, td: pg.totals?.total_to_date ?? null,
            full: totalled || rows.filter((r) => r.page === idx).length >= rowsPerPageOf(idx),
          };
        });
        const { ledger, added, unplaced } = mergeScan(before, scanned, paperFixes);
        await saveLedger(ledger);
        const ready = ledgerStatus(ledger).ready;
        if (added || unplaced || (ready && !wasReady)) ledgerNote = { added, unplaced, ready };
      } catch (e) { console.warn('[SCAN] Kunde inte spara pappersbokens lista:', e); }
      if (ledgerNote) {
        const n = ledgerNote.added;
        if (ledgerNote.ready) parts.push("Your logbook is now scanned all the way to the page you're writing on — next you'll see every change to make in your paper logbook.");
        else if (n) parts.push(`Blades noted ${n === 1 ? 'a miscounted page total' : `${n} miscounted page totals`} in your paper logbook. Wait with any changes until it's scanned all the way to the page you're writing on — next you'll see what's missing.`);
        if (ledgerNote.unplaced) parts.push(`${ledgerNote.unplaced === 1 ? 'One miscounted total' : `${ledgerNote.unplaced} miscounted totals`} couldn't be added to the list, because the page number wasn't read. Scan that spread again with the page number in the photo.`);
        const show = ledgerNote.ready || n > 0;
        Alert.alert('Saved', parts.join(' '), [{ text: show ? (ledgerNote.ready ? 'Show the changes' : 'Show the list') : 'OK', onPress: () => (show ? setPaperGuide(true) : leave()) }]);
        return;
      }
      Alert.alert('Saved', parts.join(' '), [{ text: 'OK', onPress: leave }]);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? 'Try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // Den utökade editorn i rapporten: ändringar markerar frågor på samma fält som besvarade.
  const resolveFields = (rowKey: string, fields: string[]) => {
    setResolved((r) => {
      const next = { ...r };
      for (const i of issues) {
        for (const field of fields) {
          const cellId = `${rowKey}:f:${field}`;
          if (i.group?.members.includes(cellId)) next[cellId] = 'changed';
          else if (i.rowKey === rowKey && (i.field === field || (i.kind === 'mismatch' && (field === 'dep_utc' || field === 'arr_utc')))) next[i.id] = 'changed';
        }
      }
      return next;
    });
  };
  const editField = (rowKey: string, field: string, value: string) => {
    setField(rowKey, field, value);
    resolveFields(rowKey, [field]);
  };
  const patchRow = (rowKey: string, patch: Partial<OcrFlightResult>) => {
    touched.current = true;
    if ('aircraft_type' in patch) {
      typeEdited.current.add(rowKey);
      offerTypeSpread(rowKey, rows.find((r) => r.key === rowKey)?.data.aircraft_type || '', patch.aircraft_type || '');
    }
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, data: { ...r.data, ...patch } } : r)));
    resolveFields(rowKey, [...Object.keys(patch), 'sim']);
  };
  const openFieldsFor = (rowKey: string) => new Set(openIssues.flatMap((i) => {
    if (i.group) return i.group.members.filter((m) => m.startsWith(`${rowKey}:f:`) && !resolved[m]).map((m) => m.split(':f:')[1]);
    if (i.rowKey !== rowKey) return [];
    return i.kind === 'mismatch' ? ['dep_utc', 'arr_utc'] : [i.field];
  }));

  // Rapportens celler: gul = inte granskad, blå = ändrad av användaren.
  const cellState = (rowKey: string, field: string): CellState => {
    const r = rowByKey.get(rowKey);
    if (!r) return null;
    const cellId = `${rowKey}:f:${field}`;
    const open = openIssues.some((i) => (i.group
      ? i.group.members.includes(cellId) && !resolved[cellId]
      : (i.rowKey === rowKey || !!i.alsoRows?.includes(rowKey)) && (i.field === field || (i.kind === 'mismatch' && (field === 'dep_utc' || field === 'arr_utc')))));
    if (open) return 'open';
    const now = String((r.data as any)[field] ?? ''), was = String((r.original as any)[field] ?? '');
    if (DURATION.has(field)) return Math.abs((parseFloat(now) || 0) - (parseFloat(was) || 0)) > 0.001 ? 'changed' : null;
    return now !== was ? 'changed' : null;
  };

  // Nya flödet: när varje uppslag är läst (eller inte gick att läsa) → direkt till rapporten.
  const autoReport = useRef(false);
  useEffect(() => {
    if (!SKIP_REVIEW || autoReport.current || busy || stage === 'report') return;
    if (!pages.some((pg) => pg.status === 'done') || rows.length === 0) return;
    autoReport.current = true;
    (async () => {
      setScanMatch(await matchScanRows(rows, timeBasis).catch(() => EMPTY_SCAN_MATCH));
      setStage('report');
      setOverlay('hidden');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pages, rows.length, stage]);

  // Snabbsvaren i nya rapporten: ett av Claudes förslag, eller "Looks right" (som confirm, för en given fråga).
  const answerIssue = (id: string, chip: number | null) => {
    const issue = issues.find((x) => x.id === id);
    if (!issue) return;
    if (chip != null) { const sg = issue.suggestions[chip]; if (sg) applySuggestion(issue, sg); return; }
    if (issue.kind === 'aircraft' && issue.aircraft) { applySuggestion(issue, { label: '', field: 'aircraft_type', value: issue.aircraft.resolved }); return; }
    if (ruleClassOf(issue.field)) {
      const keys = issue.group ? issue.group.members.map((m) => m.split(':f:')[0]) : [issue.rowKey];
      for (const k of keys) { const v = (rowByKey.get(k)?.data as any)?.[issue.field]; learnAnswer(issue.field, k, v, v); }
    }
    resolve(issue.id, 'ok');
  };
  const simpleIssues: SimpleIssue[] = openIssues.map((i) => {
    const groupRows = i.group ? new Set(i.group.members.map((m) => m.split(':f:')[0])).size : 1;
    return {
      id: i.id, rowKey: i.rowKey,
      rowKeys: [...new Set([i.rowKey, ...(i.alsoRows ?? []), ...(i.group ? i.group.members.filter((m) => !resolved[m]).map((m) => m.split(':f:')[0]) : [])])],
      fields: i.kind === 'mismatch' ? ['dep_utc', 'arr_utc', 'total_time'] : [i.field],
      // Rubriken är oftast bara kolumnens namn (står redan på kortet); annars först, före skälet.
      text: i.reason && i.title !== label(i.field) ? `${i.title.replace(/\.$/, '')}. ${i.reason}` : (i.reason || i.title),
      severity: i.readAs || i.kind === 'mismatch' || i.kind === 'column' || i.sumCell === 'explains' ? 'wrong' : 'check',
      chips: i.suggestions.map((sg) => sg.label).filter(Boolean),
      also: Math.max(groupRows - 1, i.alsoRows?.length ?? 0),
    };
  });
  const issueForCell = (rowKey: string, field: string) => {
    const i = openIssues.find((x) => (x.rowKey === rowKey || !!x.alsoRows?.includes(rowKey) || !!x.group?.members.includes(`${rowKey}:f:${field}`))
      && (x.field === field || (x.kind === 'mismatch' && CLOCK.has(field))));
    if (!i) return null;
    // Svarsalternativ ovanför tangentbordet: frågans förslag för just den här cellen, Claudes egna alternativ och
    // för flygplatser liknande ICAO-koder (ETNB → ETHB), som i den gamla granskningen.
    return { id: i.id, reason: i.reason || i.title, options: optionsForCell(rowKey, field, i) };
  };
  const optionsForCell = (rowKey: string, field: string, i?: Issue | null) => {
    const r = rowByKey.get(rowKey);
    if (!r) return [];
    const cur = String((r.data as any)[field] ?? '').trim().toUpperCase();
    const fi = (r.data.field_issues ?? []).find((x) => x.field === field);
    const opts: (string | undefined)[] = [
      ...(i ? i.suggestions.filter((sg) => sg.field === field && !sg.toSim).map((sg) => sg.value) : []),
      ...(fi ? [fi.suggested_value, ...(fi.options ?? [])] : []),
    ];
    if (PLACE.has(field)) {
      // Platser: liknande koder (ETNB → ETHB), flygningen före/efter (man startar där man landade), radens andra
      // plats (tur och retur), skanningens vanligaste platser, och ZZZZ (utanför flygplats) sist.
      const order = rows.filter((x) => !x.skip).sort((a, b) => a.page - b.page || a.rowIndex - b.rowIndex);
      const k = order.findIndex((x) => x.key === rowKey);
      const prev = k > 0 ? order[k - 1] : null, next = k >= 0 && k < order.length - 1 ? order[k + 1] : null;
      opts.push(...(placeAlts[cur] ?? []));
      opts.push(field === 'dep_place' ? prev?.data.arr_place : next?.data.dep_place);
      opts.push(field === 'dep_place' ? r.data.arr_place : r.data.dep_place);
      opts.push(...[...placeCounts.current.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c));
    }
    const valid = (v: string) => !PLACE.has(field) || /^[A-Z0-9]{3,4}$/.test(v);
    const list = [...new Set(opts.map((v) => String(v ?? '').trim().toUpperCase()).filter((v) => v && v !== cur && v !== 'ZZZZ' && valid(v)))].slice(0, 5);
    if (PLACE.has(field) && cur !== 'ZZZZ') list.push('ZZZZ');
    // Lagrat format för tider och klockslag (versaler bara för koder).
    return PLACE.has(field) ? list : [...new Set(opts.filter((v): v is string => !!v && v.trim().toUpperCase() !== cur))].slice(0, 5);
  };
  // Ett svarsalternativ i helskärmen. Samma fråga på flera rader (t.ex. ETNB på tio rader) → samma värde på
  // alla de raderna som har samma läsning.
  const chooseCell = (rowKey: string, field: string, value: string) => {
    const cur = String((rowByKey.get(rowKey)?.data as any)?.[field] ?? '');
    const grp = openIssues.find((x) => x.group?.members.includes(`${rowKey}:f:${field}`));
    const keys = grp
      ? grp.group!.members.filter((m) => !resolved[m] && m.endsWith(`:f:${field}`)).map((m) => m.split(':f:')[0])
        .filter((k) => String((rowByKey.get(k)?.data as any)?.[field] ?? '') === cur)
      : [];
    for (const k of new Set([rowKey, ...keys])) editField(k, field, value);
  };

  // Stänga: läsningen slutar. I en hel bok är de lästa uppslagen sparade (öppnas delen igen kostar de inga
  // coins); i en vanlig skanning försvinner de, och coinsen de kostat kommer inte tillbaka.
  const close = () => {
    const read = pagesRef.current.filter((p) => p.status === 'done').length;
    const busy = pagesRef.current.some((p) => p.status === 'reading' || p.status === 'finding' || p.status === 'waiting');
    const exit = () => { closedRef.current = true; router.back(); };
    if (bookRef.current) {
      if (!touched.current) { exit(); return; }
      Alert.alert('Leave this part?', `Your corrections will be lost. The spreads read so far are kept — opening this part again doesn't read them again or cost coins.${busy ? ' Reading stops when you leave.' : ''}`, [
        { text: 'Keep checking', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: exit },
      ]);
      return;
    }
    if (!touched.current && !read && !busy) { exit(); return; }
    Alert.alert('Discard this scan?', [
      touched.current ? 'Your corrections will be lost.' : '',
      read ? `The ${read === 1 ? 'spread' : `${read} spreads`} read so far ${read === 1 ? 'is' : 'are'} lost, and the coins ${read === 1 ? 'it' : 'they'} used aren't returned.` : '',
      busy ? 'Reading stops when you leave.' : '',
    ].filter(Boolean).join(' '), [
      { text: 'Keep checking', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: exit },
    ]);
  };

  // ── Rendering ──────────────────────────────────────────────────────────────

  if (fatal) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.fatalText}>{fatal}</Text>
        <TouchableOpacity style={s.btnSecondary} onPress={() => router.back()}><Text style={s.btnSecondaryText}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  const pageIssues = issues.filter((i) => i.page === activePage);
  const pageRows = rows.filter((r) => r.page === activePage);
  const focusRect = selection ? rectFor(selection) : null;
  const k = 1 / Math.max(1, zoom);   // linjer och ringar behåller sin tjocklek när man zoomar
  // Claudes avläsningar i kolumnen man arbetar med (tal) visas till vänster om varje rad, så att man ser direkt
  // var det blivit fel utan att trycka på varje cell. Längst ner radernas summa mot sidans. Ett tryck öppnar cellen.
  const readField = !showReadings && page?.grid && selField && (DURATION.has(selField) || COUNT.has(selField))
    && (selectedIssue ? selectedIssue.kind === 'column' || selectedIssue.kind === 'value' : selection?.kind === 'cell') ? selField : null;
  const readCheck = readField ? columnTotals(rows, activePage, page?.totals?.by_field).find((c) => c.field === readField) : undefined;
  const isCount = !!readField && COUNT.has(readField);
  // Kolumnfrågan kommer efter kolumnens celler. Öppnas den ändå medan en av dem är obesvarad pekar den dit först.
  const culprit = selectedIssue?.kind === 'column'
    ? (selectedIssue.column?.cells ?? []).map((id) => issues.find((i) => i.id === id)).find((i): i is Issue => !!i && !isDone(i)) ?? null
    : null;
  const position = selectedIssue && !isDone(selectedIssue) ? openIssues.findIndex((i) => i.id === selectedIssue.id) + 1 : 0;

  // En anmärkningsfråga redigerar förslagets fält (t.ex. Second pilot), inte själva anmärkningen.
  const remarkSg = selectedIssue?.kind === 'remark' ? selectedRow?.data.remarks_suggestion : undefined;
  const kbField = editTarget ?? (remarkSg ? remarkSg.field : selField);
  const compactBar = typing && selectedRow ? (
        <View style={[s.compactWrap, { bottom: kbHeight + 6, left: insets.left + 12, right: insets.right + 12 }]}>
          {airportHits.length > 0 && (
            <View style={s.hits}>
              {airportHits.map((h) => (
                <TouchableOpacity key={h.icao} style={s.hit} onPress={() => { setDraft(h.icao); setAirportHits([]); }}>
                  <Text style={s.hitCode}>{h.icao}</Text>
                  <Text style={s.hitName} numberOfLines={1}>{h.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Glass style={s.compact}>
            <Text style={s.compactLabel} numberOfLines={1}>{label(kbField)} · row {selectedRow.rowIndex}</Text>
            <View style={s.compactRow}>
            <ValueInput inputRef={inputRef} field={kbField} value={draft} onChange={onDraft} onSubmit={save} timeFormat={timeFormat}
              onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} autoFocus />
            <TouchableOpacity onPress={() => { setDraft(remarkSg && !editTarget ? remarkSg.value : inputValue(selectedRow.data, kbField, timeFormat)); setEditTarget(null); Keyboard.dismiss(); }} hitSlop={8}>
              <Text style={s.compactCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.saveBtn} onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
            </View>
          </Glass>
        </View>
  ) : null;

  const allFailed = pages.length > 0 && pages.every((pg) => pg.status === 'error');
  const curIdx = Math.max(0, pages.findIndex((pg) => pg.status === 'finding' || pg.status === 'reading' || pg.status === 'waiting'));
  const scanPhase: ScanPhase = overlay === 'finishing' || choosingFocus ? 'done' : allFailed ? 'error'
    : pages[curIdx]?.status === 'reading' ? 'reading' : 'finding';
  const progressLayer = overlay !== 'hidden' ? (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]} pointerEvents={overlay === 'finishing' ? 'none' : 'auto'}>
      <ScanProgress
        phase={scanPhase}
        spread={curIdx + 1}
        spreads={pages.length || 1}
        located={locatedCount}
        summary={{ flights: rows.length, open: openIssues.length }}
        error={pages[0]?.error}
        startedAt={startedAt}
        onClose={close}
        onRetry={() => readPage(0, undefined, true)}
        outOfCoins={pages[0]?.error === OUT_OF_COINS}
        coinsLabel={isPaying() ? 'Get more coins' : 'See Premium'}
        onGetCoins={getCoins}
      />
    </Animated.View>
  ) : null;

  if (stage === 'report' && SKIP_REVIEW) {
    return (
      <View style={s.root}>
        <ScanReportSimple
          rows={rows}
          pageNumbers={pages.map((pg) => pg.pageNumbers)}
          timeFormat={timeFormat}
          insets={insets}
          issues={simpleIssues}
          duplicates={duplicates}
          clashes={Object.fromEntries(Object.entries(scanMatch.clashes).map(([k, v]) => [k, v.length]))}
          clashChoice={clashChoice}
          onClash={chooseClash}
          newRegs={new Set(regChecks.filter((c) => c.isNew).map((c) => c.reg.toUpperCase()))}
          newTypes={new Set(rows.filter((r) => !r.skip && r.data.flight_type !== 'sim').map((r) => String(r.data.aircraft_type || '—').toUpperCase()).filter((t) => !known.has(t)))}
          onRenameType={(from, to) => {
            const keys = rows.filter((r) => !r.skip && String(r.data.aircraft_type || '—').toUpperCase() === from).map((r) => r.key);
            retype(keys, to);
            keys.forEach((k) => resolveFields(k, ['aircraft_type']));
          }}
          saving={saving}
          onInspect={(rowKey) => { const r = rowByKey.get(rowKey); if (r) { setCrossRefRow(rowKey); setCrossRefPage(r.page); } }}
          onEdit={(rowKey) => setEditorKey(rowKey)}
          onToggleSkip={reportToggle}
          onPresentLogbook={() => { setCrossRefRow(null); setCrossRefPage(Math.max(0, pages.findIndex((_, idx) => rows.some((r) => r.page === idx)))); }}
          onCrewRole={(keys, role) => keys.forEach((k) => editField(k, 'second_pilot_role', role))}
          onCrewName={(keys, name) => keys.forEach((k) => editField(k, 'second_pilot', name))}
          onRemoveCrew={removeCrew}
          onRestoreCrew={restoreCrew}
          onBack={close}
          onSave={saveReport}
          handwriting={handLearned}
          onUndoHandwriting={undoHand}
          specs={modelSpecs}
          onSpec={setModelSpec}
        />
        {editorKey && (
          <FlightEditor
            row={rowByKey.get(editorKey) ?? null}
            timeFormat={timeFormat}
            openFields={new Set(EDITOR_FIELDS.filter((f) => cellState(editorKey, f) === 'open'))}
            onChange={(field, value) => editField(editorKey, field, value)}
            onPatch={(patch) => patchRow(editorKey, patch)}
            onToggleSkip={() => reportToggle(editorKey)}
            onClose={() => setEditorKey(null)}
            startEditing
          />
        )}
        {crossRefPage != null && pages[crossRefPage] && (
          <LogbookCrossRef
            spreads={pages.map((pg, idx) => ({ page: idx, rows: rows.filter((r) => r.page === idx), grid: pg.grid, pageNumbers: pg.pageNumbers }))
              .filter((sp) => sp.rows.length > 0)}
            initialPage={crossRefPage}
            rowsPerPage={rowsPerPageOf(crossRefPage)}
            timeFormat={timeFormat}
            initialRowKey={crossRefRow ?? undefined}
            onClose={() => { setCrossRefPage(null); setCrossRefRow(null); }}
            editing={{
              cellState,
              issueFor: issueForCell,
              photo: (pg) => (pages[pg] ? { uri: pages[pg].uri, width: pages[pg].width, height: pages[pg].height } : null),
              onSave: (rowKey, field, value) => editField(rowKey, field, value),
              onLooksRight: (id) => answerIssue(id, null),
              onChoose: chooseCell,
              optionsFor: (rowKey, field) => optionsForCell(rowKey, field, null),
            }}
          />
        )}
        {paperGuide && <PaperFixGuide visible timeFormat={timeFormat} onClose={() => { setPaperGuide(false); leave(); }} />}
      </View>
    );
  }

  if (stage === 'report') {
    return (
      <View style={s.root}>
        <ScanReport
          rows={rows}
          columnChecks={pages.flatMap((pg, idx) => columnTotals(rows, idx, pg.totals?.by_field))}
          spreads={pages.length}
          pageLabels={pages.map((pg) => (pg.pageNumbers.left
            ? (pg.pageNumbers.right === pg.pageNumbers.left ? `p. ${pg.pageNumbers.left}` : `p. ${pg.pageNumbers.left}–${pg.pageNumbers.right ?? pg.pageNumbers.left + 1}`)
            : null))}
          pageNumbers={pages.map((pg) => pg.pageNumbers)}
          timeFormat={timeFormat}
          cellState={cellState}
          duplicates={duplicates}
          logbook={scanMatch}
          clashChoice={clashChoice}
          onClash={chooseClash}
          removeCount={removeIds.length}
          openCount={openIssues.length}
          newTypes={newTypes}
          similarTypes={similarTypes}
          onMergeTypes={mergeTypes}
          onKeepTypes={keepTypes}
          variantPairs={variantPairs}
          onMergeVariant={mergeVariant}
          fleetMatches={fleetMatches}
          onRemoveCrew={removeCrew}
          onRestoreCrew={restoreCrew}
          nameMatches={nameMatches}
          onKeepNamesSeparate={keepNamesSeparate}
          registrations={regChecks.map((c) => {
            const ex = rowByKey.get(c.rows[0]);
            const pg = ex ? pages[ex.page]?.pageNumbers : null;
            const where = pg?.left ? `p. ${pg.left}${pg.right && pg.right !== pg.left ? `–${pg.right}` : ''}` : ex ? `spread ${ex.page + 1}` : '';
            return {
              reg: c.reg, rows: c.rows.length, isNew: c.isNew, confirmed: c.confirmed, similar: c.similar,
              example: ex ? { rowKey: ex.key, text: [ex.data.date, [ex.data.dep_place, ex.data.arr_place].filter(Boolean).join(' → '), where].filter(Boolean).join(' · ') } : null,
            };
          })}
          onChangeRegistration={changeRegistration}
          learned={rules.map((r) => ({ rule: r, rows: [...ruleStash.current.values()].filter((x) => x.rule.cls === r.cls && x.rule.from === r.from).length })).filter((x) => x.rows > 0)}
          onUndoRule={undoRule}
          onKeepSeparate={keepTypesSeparate}
          onNameType={nameType}
          aircraft={aircraft}
          aircraftLoading={acLoading}
          aircraftFailed={acFailed}
          saving={saving}
          timeBasis={timeBasis}
          onTimeBasis={chooseTimeBasis}
          insets={insets}
          onAircraftChange={(type, v) => setAircraft((a) => ({ ...a, [type]: v }))}
          onOpenFlight={(rowKey) => setEditorKey(rowKey)}
          onEditField={editField}
          onToggleSkip={reportToggle}
          onPresentLogbook={setCrossRefPage}
          paperFixes={paperFixes}
          onBack={() => { setStage('review'); setSelection(null); setZoom(1); }}
          onSave={saveReport}
        />
        {editorKey && (
          <FlightEditor
            row={rowByKey.get(editorKey) ?? null}
            timeFormat={timeFormat}
            openFields={openFieldsFor(editorKey)}
            onChange={(field, value) => editField(editorKey, field, value)}
            onPatch={(patch) => patchRow(editorKey, patch)}
            onToggleSkip={() => reportToggle(editorKey)}
            onClose={() => setEditorKey(null)}
          />
        )}
        {crossRefPage != null && pages[crossRefPage] && (
          <LogbookCrossRef
            spreads={pages.map((pg, idx) => ({ page: idx, rows: rows.filter((r) => r.page === idx), grid: pg.grid, pageNumbers: pg.pageNumbers }))
              .filter((sp) => sp.rows.length > 0)}
            initialPage={crossRefPage}
            rowsPerPage={rowsPerPageOf(crossRefPage)}
            timeFormat={timeFormat}
            onClose={() => setCrossRefPage(null)}
          />
        )}
        {paperGuide && <PaperFixGuide visible timeFormat={timeFormat} onClose={() => { setPaperGuide(false); leave(); }} />}
      </View>
    );
  }

  // ── Det appen har läst, lagt över sidan (ögat) ──
  // Sidans summor: "Total this page" per kolumn står på raden under sista flygningen; Brought forward och Total
  // to date (flygtid) står på olika ställen i olika böcker och visas därför som en rad text.
  const fmtTotal = (f: string, v: number) => (COUNT.has(f) ? String(Math.round(v)) : formatTimeValue(v, timeFormat));
  const totalsLine = page?.totals
    ? [['Brought forward', page.totals.brought_forward], ['Total this page', page.totals.total_this_page], ['Total to date', page.totals.total_to_date]]
      .filter(([, v]) => v != null).map(([k, v]) => `${k} ${formatTimeValue(v as number, timeFormat)}`).join('  ·  ')
    : '';
  const totalNodes = (box: { w: number; h: number }, coded: boolean) => {
    if (!page?.grid || !page.totals?.by_field) return null;
    const grid = page.grid;
    const checks = coded ? columnTotals(rows, activePage, page.totals.by_field) : [];
    return grid.columns.filter((c) => c.field && page.totals!.by_field![c.field!] != null).map((c) => {
      const cr = cellRect(grid, grid.rowsPerPage + 1, c.field!);
      if (!cr) return null;
      const off = coded && checks.some((x) => x.field === c.field && !x.ok);   // raderna går inte ihop med summan
      const fs = Math.max(5, Math.min(11, cr.h * box.h * 0.6));
      return (
        <View key={`tot-${c.field}-${c.left}`} style={[s.reading, s.readingTotal, off && s.readingUnsure, place(cr, box)]}>
          <Text numberOfLines={1} style={[s.readingText, { fontSize: fs }, off && { color: '#141414' }]}>{fmtTotal(c.field!, page.totals!.by_field![c.field!])}</Text>
        </View>
      );
    });
  };

  // ── Helskärmsläget ──
  // Hur säker läsningen av en cell är: 0 = säker, 1 = osäker, 2 = mycket osäker. Allt Claude flaggat räknas,
  // även det som valt fokus inte ställer frågor om; en cell man har svarat om eller ändrat är säker.
  const issuesAt = (rowKey: string, field: string) => openIssues.filter((i) => i.kind !== 'column' && i.kind !== 'addition' && (i.group
    ? i.group.members.includes(`${rowKey}:f:${field}`)
    : (i.rowKey === rowKey || !!i.alsoRows?.includes(rowKey)) && (i.field === field || (i.kind === 'mismatch' && (field === 'dep_utc' || field === 'arr_utc')))));
  const cellLevel = (r: ScanRow, field: string): 0 | 1 | 2 => {
    if (resolved[`${r.key}:f:${field}`]) return 0;
    let lvl = 0;
    const bump = (conf?: number, hard?: boolean) => { lvl = Math.max(lvl, hard || (conf != null && conf > 0 && conf < 0.5) ? 2 : 1); };
    for (const fi of r.data.field_issues ?? []) {
      if (fi.field === field || (r.data.flight_type === 'sim' && fi.field === 'total_time' && field === 'sim')) bump(fi.confidence, !!fi.read_as);
    }
    for (const i of issuesAt(r.key, field)) bump(i.confidence, !!i.readAs);
    return lvl as 0 | 1 | 2;
  };
  // Cellen är besvarad: dess frågor räknas som klara (som när man rättar i rapporten).
  const markCell = (rowKey: string, field: string, how: 'ok' | 'changed') => {
    const cellId = `${rowKey}:f:${field}`;
    touched.current = true;
    setResolved((r) => {
      const next = { ...r, [cellId]: how };
      for (const i of issues) {
        if (i.group) continue;
        if ((i.rowKey === rowKey || i.alsoRows?.includes(rowKey)) && (i.field === field || (i.kind === 'mismatch' && (field === 'dep_utc' || field === 'arr_utc')))) next[i.id] = how;
      }
      return next;
    });
  };
  const closeFsCell = () => { Keyboard.dismiss(); setFsCell(null); setFsError(''); };
  const fsApply = (rowKey: string, field: string, value: string) => {
    const ac = field === 'aircraft_type' ? issuesAt(rowKey, field).find((i) => i.kind === 'aircraft') : undefined;
    if (ac) applySuggestion(ac, { label: value, field, value });   // ny typ: svaret gäller alla rader med samma skrivsätt
    else setField(rowKey, field, value);
    markCell(rowKey, field, 'changed');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    closeFsCell();
  };
  const fsSave = () => {
    if (!fsCell) return;
    const value = parseInput(fsCell.field, fsDraft, fmtRef.current);
    if (value == null) {
      setFsError(fsCell.field === 'date' ? 'Write the date as YYYY-MM-DD.'
        : CLOCK.has(fsCell.field) ? 'Write the time as HH:MM.' : `That doesn't look like a valid ${label(fsCell.field).toLowerCase()}.`);
      return;
    }
    fsApply(fsCell.rowKey, fsCell.field, value);
  };
  const fsConfirm = () => {
    if (!fsCell) return;
    const v = (rowByKey.get(fsCell.rowKey)?.data as any)?.[fsCell.field];
    if (ruleClassOf(fsCell.field)) learnAnswer(fsCell.field, fsCell.rowKey, v, v);
    markCell(fsCell.rowKey, fsCell.field, 'ok');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    closeFsCell();
  };

  if (full !== 'off') {
    const landscape = W > H;
    const ready = full === 'on' && landscape;
    const padL = Math.max(insets.left, 8), padR = Math.max(insets.right, 8);
    const availW = W - padL - padR, availH = H - 8;
    const sc = page ? Math.min(availW / page.width, availH / page.height) : 1;
    const fw = page ? page.width * sc : 0, fh = page ? page.height * sc : 0;
    const box = { x: padL + (availW - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    const LEVEL = [s.readingSure, s.readingUnsure, s.readingBad];
    // Hur säker läsningen är per nivå, i procent. Osäkra celler: medelvärdet av Claudes egen säkerhet för
    // uppslagets celler på den nivån (utan sådana celler: nivåns gränser). Celler Claude inte flaggat har ingen
    // egen siffra; där gäller benchmarken (ungefär 1 % av värdena är fel utan att någon fråga pekar på dem).
    const confs: [number[], number[]] = [[], []];
    for (const r of pageRows) {
      if (r.skip) continue;
      for (const fi of r.data.field_issues ?? []) {
        const cf = Number(fi.confidence);
        if (!(cf > 0 && cf <= 1) || resolved[`${r.key}:f:${fi.field}`]) continue;
        confs[cf < 0.5 ? 1 : 0].push(cf);
      }
    }
    const mean = (xs: number[]) => (xs.length ? `${Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100)}%` : null);
    const levels = [
      ['Positive', `${Math.round((1 - SILENT_ERROR_RATE) * 100)}%`, s.readingSure, '#fff'],
      ['Uncertain', mean(confs[0]) ?? '50–90%', s.readingUnsure, '#141414'],
      ['Very unsure', mean(confs[1]) ?? 'under 50%', s.readingBad, '#fff'],
    ] as const;
    const onFsPress = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      if (!page?.grid) return;
      const hit = hitTest(page.grid, e.nativeEvent.locationX / box.w, e.nativeEvent.locationY / box.h);
      const row = hit ? rows.find((r) => r.page === activePage && r.rowIndex === hit.rowIndex) : null;
      if (!hit?.field || !row || row.skip) { closeFsCell(); return; }
      Haptics.selectionAsync().catch(() => {});
      setFsCell({ rowKey: row.key, field: hit.field });
      setFsDraft(inputValue(row.data, hit.field, fmtRef.current));
      setFsError('');
    };
    const cellRow = fsCell ? rowByKey.get(fsCell.rowKey) ?? null : null;
    const cellIssues = fsCell ? issuesAt(fsCell.rowKey, fsCell.field) : [];
    const lvl = fsCell && cellRow ? cellLevel(cellRow, fsCell.field) : 0;
    const raw = fsCell && cellRow ? (cellRow.data.field_issues ?? []).filter((fi) => fi.field === fsCell.field) : [];
    const why = cellIssues[0]?.reason ?? raw[0]?.reason ?? '';
    // Det appen tror är rätt: frågornas förslag och Claudes egna alternativ för cellen.
    const options = fsCell ? [...new Set([
      ...cellIssues.flatMap((i) => i.suggestions.filter((sg) => !sg.toSim && sg.field === fsCell.field).map((sg) => sg.value)),
      ...raw.flatMap((fi) => [fi.suggested_value, ...(fi.options ?? [])]),
    ].filter((v): v is string => !!v))].slice(0, 5) : [];
    const choices = fsCell ? CHOICES[fsCell.field] : undefined;
    const cardW = Math.min(560, W - padL - padR - 120);
    // Utsnitt av cellen ur fotot (med lite av grannarna), så att handstilen syns även när rutan eller
    // tangentbordet ligger över cellen på sidan.
    const LOUPE_W = 150, LOUPE_H = 40;
    const loupe = (() => {
      if (!fsCell || !cellRow || !page?.grid) return null;
      const cr = cellRect(page.grid, cellRow.rowIndex, fsCell.field);
      if (!cr || !(cr.w > 0 && cr.h > 0)) return null;
      const k = Math.min(30 / (cr.h * page.height), (LOUPE_W - 14) / (cr.w * page.width));
      return {
        w: page.width * k, h: page.height * k,
        left: LOUPE_W / 2 - (cr.x + cr.w / 2) * page.width * k,
        top: LOUPE_H / 2 - (cr.y + cr.h / 2) * page.height * k,
      };
    })();
    return (
      <View style={[s.root, { backgroundColor: '#05080F' }]}>
        {ready && page?.status === 'done' && (
          <ScrollView style={StyleSheet.absoluteFill} contentContainerStyle={{ width: W, height: H }} maximumZoomScale={6} minimumZoomScale={1}
            bouncesZoom showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Pressable onPress={onFsPress} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>
              <Image source={{ uri: page.uri }} style={{ width: box.w, height: box.h }} resizeMode="stretch" />
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {showReadings && page.grid && pageRows.filter((r) => !r.skip).map((r) =>
                  page.grid!.columns.filter((c) => c.field).map((c) => {
                    // Den valda cellen är släckt: där ska handstilen i boken synas.
                    if (fsCell && fsCell.rowKey === r.key && fsCell.field === c.field) return null;
                    const v = bookCell(r.data, c.field!, timeFormat);
                    const level = cellLevel(r, c.field!);
                    if (!v && level === 0) return null;
                    const cr = cellRect(page.grid!, r.rowIndex, c.field!)!;
                    const fs = Math.max(6, Math.min(12, cr.h * box.h * 0.62));
                    return (
                      <View key={`fr-${r.key}-${c.field}-${c.left}`} style={[s.reading, LEVEL[level], place(cr, box)]}>
                        <Text numberOfLines={1} style={[s.readingText, { fontSize: fs }, level === 1 && { color: '#141414' }]}>{v || '?'}</Text>
                      </View>
                    );
                  }))}
                {showReadings && totalNodes(box, true)}
                {fsCell && cellRow && page.grid && (() => {
                  const cr = cellRect(page.grid!, cellRow.rowIndex, fsCell.field);
                  return cr ? <View style={[place(cr, box, 3), s.ring, { borderRadius: 5, borderWidth: 2.5 }]} /> : null;
                })()}
              </View>
            </Pressable>
          </ScrollView>
        )}
        {ready && page?.status !== 'done' && (
          <View style={s.fsCenter}><Text style={s.fsHint}>This spread hasn{'’'}t been read yet.</Text></View>
        )}
        {!ready && (
          <View style={s.fsCenter}>
            {(full === 'entering' && fsLate) || fsUpright ? (
              <>
                <Ionicons name="phone-landscape-outline" size={32} color="#B4C9DD" />
                <Text style={s.fsHint}>Turn your phone sideways</Text>
              </>
            ) : full === 'on' ? null : <ActivityIndicator color={Colors.primary} />}
          </View>
        )}

        {/* Knappar: tillbaka till frågorna, uppslag, ögat */}
        {full !== 'leaving' && (
          <>
            <TouchableOpacity style={[s.fsBtn, { left: padL + 4, top: landscape ? 10 : insets.top + 6 }]} onPress={() => { closeFsCell(); setFull('leaving'); }}
              accessibilityRole="button" accessibilityLabel="Leave full screen">
              <Ionicons name="contract-outline" size={20} color="#fff" />
            </TouchableOpacity>
            {ready && (
              <View style={[s.fsRight, { right: padR + 4, top: 10 }]}>
                {pages.length > 1 && (
                  <>
                    <TouchableOpacity style={[s.fsBtn, s.fsBtnInline, activePage === 0 && { opacity: 0.4 }]} disabled={activePage === 0}
                      onPress={() => { closeFsCell(); setActivePage(activePage - 1); }} accessibilityRole="button" accessibilityLabel="Previous spread">
                      <Ionicons name="chevron-back" size={20} color="#fff" />
                    </TouchableOpacity>
                    <Text style={s.fsPageText}>{activePage + 1}/{pages.length}</Text>
                    <TouchableOpacity style={[s.fsBtn, s.fsBtnInline, activePage >= pages.length - 1 && { opacity: 0.4 }]} disabled={activePage >= pages.length - 1}
                      onPress={() => { closeFsCell(); setActivePage(activePage + 1); }} accessibilityRole="button" accessibilityLabel="Next spread">
                      <Ionicons name="chevron-forward" size={20} color="#fff" />
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={[s.fsBtn, s.fsBtnInline, showReadings && s.toggleOn]} onPress={() => setShowReadings((v) => !v)}
                  accessibilityRole="switch" accessibilityState={{ checked: showReadings }} accessibilityLabel="Show what the app read in every cell">
                  <Ionicons name={showReadings ? 'eye' : 'eye-outline'} size={20} color={showReadings ? Colors.primary : '#fff'} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* Förklaringen till färgerna överst, med hur säker läsningen är på varje nivå; sidans summor nederst */}
        {ready && showReadings && !fsCell && (
          <View pointerEvents="none" style={s.fsLevels}>
            <View style={s.fsLevelsRow}>
              {levels.map(([t, pct, st2, col]) => (
                <View key={t} style={[s.fsLevel, st2]} accessible accessibilityLabel={`${t}: ${pct} sure`}>
                  <Text style={[s.fsLevelText, { color: col }]}>{t}</Text>
                  <Text style={[s.fsLevelPct, { color: col }]}>{pct}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {ready && showReadings && !fsCell && totalsLine ? (
          <View pointerEvents="none" style={[s.fsLegend, { left: padL + 4, bottom: Math.max(insets.bottom, 6) + 2 }]}>
            <Text style={[s.fsTotals, { marginLeft: 0 }]} numberOfLines={1}>{totalsLine}</Text>
          </View>
        ) : null}

        {/* Ett svar som gällde fler rader (t.ex. en registrering): vad som ändrades, med Undo. */}
        {ready && learnNote && !fsCell && (
          <View style={[s.learnBar, { bottom: Math.max(insets.bottom, 6) + 2, right: padR + 4, width: Math.min(380, W * 0.5) }]}>
            <Ionicons name="sparkles" size={15} color={Colors.primary} />
            <Text style={s.learnText} numberOfLines={2}>{learnNote.text}</Text>
            <TouchableOpacity onPress={() => (learnNote.rule ? undoRule(learnNote.rule) : learnNote.hand ? undoHand(learnNote.hand) : setLearnNote(null))} hitSlop={10} accessibilityRole="button">
              <Text style={s.learnUndo}>Undo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Cellen man tryckt på: vad appen läste, varför den är osäker, vad den tror är rätt, och ändra. */}
        {ready && fsCell && cellRow && (
          <View style={[s.fsCard, { width: cardW, left: (W - cardW) / 2, top: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.fsCardTitle} numberOfLines={1}>{label(fsCell.field)}</Text>
              {lvl > 0 && <View style={[s.fsChip, lvl === 2 ? s.readingBad : s.readingUnsure]}><Text style={[s.fsChipText, { color: lvl === 2 ? '#fff' : '#141414' }]}>{lvl === 2 ? 'Very unsure' : 'Uncertain'}</Text></View>}
              <Text style={s.fsCardCtx} numberOfLines={1}>{[cellRow.data.date, [cellRow.data.dep_place, cellRow.data.arr_place].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')}</Text>
              <TouchableOpacity onPress={closeFsCell} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={20} color="#B4C9DD" /></TouchableOpacity>
            </View>
            {why ? <Text style={s.fsCardWhy} numberOfLines={2}>{why}</Text> : null}
            {choices ? (
              <View style={s.fsRow}>
                {choices.map((opt) => {
                  const on = chipKey(opt) === String((cellRow.data as any)[fsCell.field] ?? '');
                  return (
                    <TouchableOpacity key={opt} style={[s.option, on && { borderColor: Colors.primary }]} onPress={() => fsApply(fsCell.rowKey, fsCell.field, chipKey(opt))} accessibilityRole="button">
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <>
                {options.length > 0 && (
                  <View style={s.fsRow}>
                    <Text style={s.fsCardCtx}>Probably:</Text>
                    {options.map((v) => (
                      <TouchableOpacity key={v} style={s.suggestion} onPress={() => fsApply(fsCell.rowKey, fsCell.field, v)} accessibilityRole="button" accessibilityLabel={`Use ${v}`}>
                        <Text style={s.suggestionText}>{v}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {loupe && page && (
                    <View style={s.fsLoupe} accessible accessibilityLabel="The cell as it is written in your logbook">
                      <Image source={{ uri: page.uri }} resizeMode="stretch"
                        style={{ position: 'absolute', left: loupe.left, top: loupe.top, width: loupe.w, height: loupe.h }} />
                    </View>
                  )}
                  <View style={s.fsInputWrap}>
                    <ValueInput inputRef={fsInputRef} field={fsCell.field} value={fsDraft} timeFormat={timeFormat}
                      onChange={(t) => { setFsDraft(shapeInput(fsCell.field, t)); setFsError(''); }} onSubmit={fsSave} onFocus={() => {}} />
                  </View>
                  <TouchableOpacity style={[s.btnPrimary, { minHeight: 40 }]} onPress={fsSave} accessibilityRole="button"><Text style={s.btnPrimaryText}>Save</Text></TouchableOpacity>
                  {lvl > 0 && (
                    <TouchableOpacity style={s.fsGhost} onPress={fsConfirm} accessibilityRole="button"><Text style={s.fsGhostText}>Looks right</Text></TouchableOpacity>
                  )}
                </View>
              </>
            )}
            {fsError ? <Text style={[s.fsCardWhy, { color: Colors.warning }]}>{fsError}</Text> : null}
          </View>
        )}
      </View>
    );
  }

  const topStatus = page?.status === 'finding' ? 'Finding the logbook…'
    : page?.status === 'reading' ? (pages.length > 1 ? `Reading spread ${activePage + 1} of ${pages.length}…` : 'Reading…')
      : position ? `Problem ${position} of ${openIssues.length}`
        : openIssues.length > 0 ? `${openIssues.length} to check` : busy ? 'Reading the next spread…' : 'All checked';

  return (
    <View style={s.root}>
      <ScrollView
        ref={scrollRef}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ width: W, height: H }}
        maximumZoomScale={6}
        minimumZoomScale={1}
        bouncesZoom
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const z = Math.round(((e.nativeEvent as any).zoomScale ?? 1) * 10) / 10;
          if (Math.abs(z - zoom) >= 0.2) setZoom(z);
        }}
      >
        {page && page.status === 'done' && (
          <Pressable onPress={onImagePress} style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fit.h }}>
            <FadeIn><Image source={{ uri: page.uri }} style={{ width: fit.w, height: fit.h }} resizeMode="stretch" /></FadeIn>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {/* Spotlight: allt utom det man jobbar med tonas ned */}
              {focusRect && <Spotlight rect={focusRect} fit={fit} />}

              {showReadings && page.grid && pageRows.filter((r) => !r.skip).map((r) =>
                page.grid!.columns.filter((c) => c.field).map((c) => {
                  const v = bookCell(r.data, c.field!, timeFormat);
                  if (!v) return null;
                  const cr = cellRect(page.grid!, r.rowIndex, c.field!)!;
                  const fs = Math.max(5, Math.min(11, cr.h * fit.h * 0.6));
                  return (
                    <View key={`rd-${r.key}-${c.field}-${c.left}`} style={[s.reading, place(cr, fit)]}>
                      <Text numberOfLines={1} style={[s.readingText, { fontSize: fs }]}>{v}</Text>
                    </View>
                  );
                }))}

              {/* Sidans summor som appen läste dem: "Total this page" per kolumn, och flygtidens tre summor under bilden. */}
              {showReadings && totalNodes(fit, false)}
              {showReadings && totalsLine ? (
                <View style={{ position: 'absolute', left: 0, right: 0, top: fit.h + 8, alignItems: 'center' }}>
                  <Text style={s.totalsLine} numberOfLines={1} adjustsFontSizeToFit>{totalsLine}</Text>
                </View>
              ) : null}

              {page.status === 'done' && page.grid && pageRows.filter((r) => r.skip).map((r) => (
                <View key={`skip-${r.key}`} style={[s.skipBand, place(rowRect(page.grid!, r.rowIndex), fit)]}>
                  <Text style={s.skipText}>SKIPPED</Text>
                </View>
              ))}

              {/* Grått = väntar på sin tur, grönt = klart. Det som frågas om nu ritas gult nedan. */}
              {page.status === 'done' && pageIssues.flatMap((i) => {
                if (selectedIssue?.id === i.id) return [];
                const parts = i.group
                  ? i.group.rects.map((r, n) => ({ id: `${i.id}#${n}`, r, done: !!resolved[i.group!.members[n]] || !!resolved[i.id] }))
                  : i.rect ? [{ id: i.id, r: i.rect, done: isDone(i) }] : [];
                return parts.map((p) => (
                  <View key={p.id} style={[place(p.r, fit, 2 * k), {
                    borderRadius: 4 * k, borderWidth: (p.done ? 1.2 : 1) * k,
                    borderColor: p.done ? Colors.success : 'rgba(96,106,122,0.85)',
                  }]} />
                ));
              })}

              {selectedIssue?.group
                ? selectedIssue.group.rects.map((r, n) => (
                  <View key={`ring-${n}`} style={[place(r, fit, 3 * k), s.ring, { borderRadius: 6 * k, borderWidth: 2.5 * k }]} />
                ))
                : focusRect && (
                  <View style={[place(focusRect, fit, 4 * k), s.ring, { borderRadius: 8 * k, borderWidth: 3 * k }]} />
                )}
            </View>

            {/* Avläsningarna står till vänster om rutnätets kolumn. Vid en flytt mellan kolumner ligger rutnätet ofta
                snett, så de skulle täcka talen frågan handlar om → dolda då. */}
            {readField && page.grid && !(selectedIssue?.kind === 'column' && selectedIssue.column?.move) && (() => {
              const grid = page.grid;
              const col = columnFor(grid, readField);
              if (!col) return null;
              const cx = (col.left + col.right) / 2;
              const gap = 3 * k;
              // Lika stor som bokens cell (höjd och bredd), så att det syns exakt vilken rad varje avläsning hör till.
              const cellW = (col.right - col.left) * fit.w;
              const pill = (key: string, band: { y: number; h: number }, text: string, style: any, onPress?: () => void, wide = false) => {
                const hPx = band.h * fit.h * 0.84;
                return (
                  <TouchableOpacity key={key} disabled={!onPress} onPress={onPress}
                    style={[s.readPill, style, {
                      right: fit.w - col.left * fit.w + gap, top: (band.y + band.h / 2) * fit.h - hPx / 2,
                      height: hPx, maxWidth: cellW * (wide ? 1.8 : 1), paddingHorizontal: hPx * 0.18, borderRadius: hPx * 0.22,
                    }]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={[s.readPillText, { fontSize: hPx * 0.68 }, text === SIM_MARK && s.readPillSim,
                      style === s.readPillOn && { color: Colors.textInverse },
                      style === s.readPillOk && { color: Colors.success },
                      style === s.readPillBad && { color: Colors.warning }]}>{text}</Text>
                  </TouchableOpacity>
                );
              };
              const selKey = selection?.kind === 'cell' ? selection.rowKey : selectedIssue?.kind === 'value' ? selectedIssue.rowKey : null;
              return (
                <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                  {pageRows.map((r) => pill(`rp-${r.key}`, rowBand(grid, r.rowIndex, cx), bookCell(r.data, readField, timeFormat) || '–',
                    r.key === selKey ? s.readPillOn : null, () => select({ kind: 'cell', rowKey: r.key, field: readField })))}
                  {readCheck && pill('rp-sum', rowBand(grid, grid.rowsPerPage + 1, cx),
                    `Σ ${readField.startsWith('landings') ? Math.round(readCheck.sum) : Math.round(readCheck.sum * 10) / 10}`,
                    readCheck.ok ? s.readPillOk : s.readPillBad, undefined, true)}
                </View>
              );
            })()}
          </Pressable>
        )}
      </ScrollView>

      {page && (page.status === 'finding' || page.status === 'reading' || page.status === 'waiting') && (
        <View pointerEvents="none" style={[s.scanAnimWrap, { top: imgTop, height: imgBottom - imgTop }]}>
          <ScanningAnimation />
        </View>
      )}

      {/* Topprad */}
      {!typing && (
        <View style={[s.topBar, { top: insets.top + 6, left: insets.left + 12, right: insets.right + 12 }]}>
          <IconButton icon="close" onPress={close} label="Close" />
          <Glass style={s.statusPill}>
            {(page?.status === 'reading' || page?.status === 'finding') && <ActivityIndicator size="small" color={Colors.primary} />}
            <Text style={s.statusText} numberOfLines={1}>{topStatus}</Text>
          </Glass>
          {page?.status === 'done' && page.grid && (
            <TouchableOpacity style={s.toggle} onPress={() => { Keyboard.dismiss(); setSelection(null); setFsCell(null); setShowReadings(true); setFull('entering'); }}
              accessibilityRole="button" accessibilityLabel="Check in full screen">
              <Ionicons name="expand-outline" size={19} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.toggle, showReadings && s.toggleOn]} onPress={() => setShowReadings((v) => !v)}
            accessibilityRole="switch" accessibilityState={{ checked: showReadings }} accessibilityLabel="Show what Claude read in every cell">
            <Ionicons name={showReadings ? 'eye' : 'eye-outline'} size={19} color={showReadings ? Colors.primary : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.importBtn, (importCount === 0 || busy) && { opacity: 0.45 }]} onPress={openReport} accessibilityLabel="Scan report">
            <Text style={s.importText}>Report</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textInverse} />
          </TouchableOpacity>
        </View>
      )}
      {/* Något lärdes av svaren: raderna rättades och frågorna försvann. */}
      {learnNote && !typing && (
        <View style={[s.learnBar, { top: insets.top + (pages.length > 1 ? 100 : 54), left: insets.left + 12, right: insets.right + 12 }]}>
          <Ionicons name="sparkles" size={15} color={Colors.primary} />
          <Text style={s.learnText} numberOfLines={2}>{learnNote.text}</Text>
          <TouchableOpacity onPress={() => (learnNote.rule ? undoRule(learnNote.rule) : learnNote.hand ? undoHand(learnNote.hand) : setLearnNote(null))} hitSlop={10} accessibilityRole="button">
            <Text style={s.learnUndo}>Undo</Text>
          </TouchableOpacity>
        </View>
      )}
      {!typing && pages.length > 1 && (
        <View style={[s.pillRow, { top: insets.top + 54, left: insets.left + 12, right: insets.right + 12 }]}>
            {/* Upp till tio uppslag: raden rullar i sidled och följer uppslaget som visas. */}
            <ScrollView ref={pillScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pagePills}>
              {pages.map((p, i) => {
                const open = issues.filter((x) => x.page === i && !isDone(x)).length;
                return (
                  <TouchableOpacity key={i} onPress={() => { setActivePage(i); select(null); }}
                    onLayout={(e) => { pillX.current[i] = e.nativeEvent.layout.x; }}
                    style={[s.pagePill, i === activePage && s.pagePillActive]} accessibilityLabel={`Spread ${i + 1}`}>
                    <Text style={[s.pagePillText, i === activePage && s.pagePillTextActive]}>{i + 1}</Text>
                    {(p.status === 'reading' || p.status === 'finding' || p.status === 'waiting') && <ActivityIndicator size="small" color={Colors.textSecondary} style={{ transform: [{ scale: 0.6 }] }} />}
                    {p.status === 'error' && <Ionicons name="alert-circle" size={13} color={Colors.danger} />}
                    {p.status === 'done' && open > 0 && <View style={s.pillBadge}><Text style={s.pillBadgeText}>{open}</Text></View>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
        </View>
      )}

      {/* Under boken: frågan, eller översikten */}
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, {
        opacity: panelEnter,
        transform: [{ translateY: panelEnter.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }],
      }]}>
      {compactBar ?? (
        <Glass dim={0.5} style={[s.panel, { height: PANEL_H, bottom: insets.bottom + 6, left: insets.left + 12, right: insets.right + 12 }]}>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {selection && selectedRow ? (
            <QuestionPanel
              issue={selectedIssue}
              field={selField}
              row={selectedRow}
              done={selectedIssue ? (isDone(selectedIssue) ? (resolved[selectedIssue.id] ?? 'ok') : undefined) : undefined}
              groupValues={selectedIssue?.group ? selectedIssue.group.members.map((id) => {
                const r = rowByKey.get(id.includes(':f:') ? id.split(':f:')[0] : id.replace(/:remark$/, ''));
                const value = !r ? '' : selectedIssue.group?.remarks ? r.data.remarks_suggestion?.value ?? '' : display(r.data, selectedIssue.field, timeFormat);
                return { id, row: r?.rowIndex ?? 0, value, done: !!resolved[id] };
              }) : undefined}
              onGroupRemarks={() => selectedIssue && applyGroupRemarks(selectedIssue)}
              crewRole={selectedIssue ? remarkRoles[selectedIssue.id] ?? (selectedIssue.kind === 'group' ? BY_FLIGHT : defaultCrewRole(selectedRow.data)) : undefined}
              crewRoleOptions={selectedIssue?.kind === 'group'
                ? [{ key: BY_FLIGHT, label: 'By flight: PIC or SIC', disabled: false }, ...CREW_ROLES.map((r) => ({ ...r, disabled: false }))]
                : CREW_ROLES.map((r) => ({ ...r, disabled: r.key === 'PIC' && ownPic(selectedRow.data) }))}
              onCrewRole={(k) => selectedIssue && setRemarkRoles((m) => ({ ...m, [selectedIssue.id]: k }))}
              onExpand={(startAt) => selectedIssue && expandGroup(selectedIssue, startAt)}
              onGroupSim={() => selectedIssue && applyGroupSim(selectedIssue)}
              onGroupChoice={(v) => selectedIssue && applyGroupChoice(selectedIssue, v)}
              onAcceptAddition={() => selectedIssue && acceptAddition(selectedIssue)}
              movable={movableValue(selectedIssue, selectedRow)}
              adjust={selectedIssue?.kind === 'column' && readCheck && readField ? {
                sum: isCount ? String(Math.round(readCheck.sum)) : String(Math.round(readCheck.sum * 10) / 10),
                miscounted: !!selectedIssue.column?.miscounted,
                extraRow: selectedIssue.column?.extraRow?.rowIndex,
                culpritRow: culprit ? rowByKey.get(culprit.rowKey)?.rowIndex : undefined,
                move: selectedIssue.column?.move ? (() => {
                  const mv = selectedIssue.column.move;
                  const n = mv.keys.length;
                  const what = `${n} flight${n === 1 ? '' : 's'}`;
                  return {
                    label: selectedIssue.field === mv.from ? `Move ${what} to ${label(mv.to)}` : `Move ${what} from ${label(mv.from)}`,
                    hint: `Then both ${label(mv.from)} and ${label(mv.to)} add up. Nothing to fix on paper.`,
                    onPress: () => moveColumnRows(selectedIssue),
                  };
                })() : undefined,
                onCulprit: () => { if (culprit) select({ kind: 'issue', id: culprit.id }); },
                onSkipExtra: () => skipExtraRow(selectedIssue),
                onRealRow: () => setRealRows((r) => new Set([...r, selectedIssue.id])),
                onCorrect: () => correctPaperTotal(selectedIssue),
                onCorrectInfo: () => setCorrectInfo(true),
              } : undefined}
              onMove={(to) => selectedIssue && moveToColumn(selectedIssue, to)}
              position={position}
              openCount={openIssues.length}
              draft={draft}
              timeFormat={timeFormat}
              onEdit={() => setTyping(true)}
              onEditField={(field) => { if (!selectedRow) return; setEditTarget(field); setDraft(inputValue(selectedRow.data, field, timeFormat)); setTyping(true); }}
              onSave={save}
              onConfirm={confirm}
              onSuggestion={(sg) => selectedIssue && applySuggestion(selectedIssue, sg)}
              onSkipRow={() => toggleSkip(selectedRow.key)}
              onPrev={() => {
                const idx = selectedIssue ? openIssues.findIndex((i) => i.id === selectedIssue.id) : 0;
                const p = openIssues[(idx - 1 + openIssues.length) % openIssues.length];
                if (p) select({ kind: 'issue', id: p.id });
              }}
              onNext={() => { const n = nextOpen(selectedIssue?.id, selectedIssue?.id); select(n ? { kind: 'issue', id: n.id } : null); }}
              onClose={() => select(null)}
            />
          ) : (
            <Overview
              page={page}
              pagesCount={pages.length}
              activePage={activePage}
              flights={importCount}
              pageLabel={page?.pageNumbers.left ? `p. ${page.pageNumbers.left}–${page.pageNumbers.right ?? page.pageNumbers.left + 1}` : null}
              hours={formatTimeValue(rows.filter((r) => r.page === activePage && !r.skip && r.data.flight_type !== 'sim')
                .reduce((acc, r) => acc + (parseFloat(r.data.total_time) || 0), 0), timeFormat)}
              totals={(() => { const c = columnTotals(rows, activePage, page?.totals?.by_field); return { ok: c.filter((x) => x.ok).length, checked: c.length }; })()}
              open={openIssues.length}
              busy={busy}
              onStart={() => { const n = nextOpen(); if (n) select({ kind: 'issue', id: n.id }); }}
              onImport={openReport}
              onRetry={() => readPage(activePage, undefined, false)}
              onGetCoins={getCoins}
              coinsLabel={isPaying() ? 'Get more coins' : 'See Premium'}
            />
          )}
          </ScrollView>
        </Glass>
      )}
      </Animated.View>
      {progressLayer}

      <FocusDialog
        visible={choosingFocus}
        value={focusPick}
        estimates={focusEstimates}
        spreads={pages.length}
        stillReading={pages.some((p) => p.status === 'waiting' || p.status === 'finding' || p.status === 'reading')}
        onChange={setFocusPick}
        onStart={startChecking}
      />

      <GlassDialog
        visible={!!typeSpread}
        onClose={() => setTypeSpread(null)}
        icon={<DialogIcon name="airplane-outline" />}
        eyebrow="AIRCRAFT TYPE"
        title={typeSpread ? `Use ${typeSpread.to} on all ${typeSpread.keys.length + 1} flights?` : ''}
        body={typeSpread ? `${typeSpread.keys.length === 1 ? '1 other flight' : `${typeSpread.keys.length} other flights`} in this scan ${typeSpread.keys.length === 1 ? 'says' : 'say'} ${typeSpread.from}. Change ${typeSpread.keys.length === 1 ? 'it' : 'them'} to ${typeSpread.to} too, so they end up as one aircraft in your fleet.` : ''}
        primary={{ label: typeSpread ? `Change all ${typeSpread.keys.length + 1}` : 'Change all', onPress: () => { if (typeSpread) retype(typeSpread.keys, typeSpread.to); setTypeSpread(null); } }}
        secondary={{ label: 'Only this flight', onPress: () => setTypeSpread(null) }}
      />

      <GlassDialog
        visible={totalsAlert}
        onClose={() => setTotalsAlert(false)}
        icon={<DialogIcon name="calculator-outline" color={Colors.warning} />}
        eyebrow="PAGE TOTALS"
        title={columnProblems.length === 1 ? "A page total doesn't add up" : `${columnProblems.length} page totals don't add up`}
        body={"Blades added up your flights and compared them with the totals in your logbook. Go through the problems first — usually it's a misread value you fix with a tap.\n\nIf a total in your paper logbook itself turns out to be miscounted, Blades guides you through every change afterwards. Don't change anything in your paper logbook before that."}
        align="left"
        primary={{ label: 'Got it', onPress: () => setTotalsAlert(false) }}
      >
        {columnProblems.slice(0, 4).map((i) => {
          const pn = pages[i.page]?.pageNumbers;
          const where = pn?.left ? `p. ${pn.left}–${pn.right ?? pn.left + 1}` : `Spread ${i.page + 1}`;
          return (
            <View key={i.id} style={dialogStyles.row}>
              <Text style={dialogStyles.rowTitle}>{where} · {label(i.field)}</Text>
              {i.column && <Text style={dialogStyles.rowMeta}>Flights {Math.round(i.column.sum * 10) / 10} · page total {i.column.printed}</Text>}
            </View>
          );
        })}
      </GlassDialog>

      <GlassDialog
        visible={correctInfo}
        onClose={() => setCorrectInfo(false)}
        icon={<DialogIcon name="book-outline" />}
        eyebrow="CORRECT MY TOTAL"
        title="A guide for your paper logbook"
        body={"Your flights are saved as written, and Blades notes that this page total is miscounted.\n\nAfterwards you get a guide with every change to make in your paper logbook: this page total, and every Brought forward and Total to date after it.\n\nWait with the changes until your whole logbook is scanned, up to the page you're writing on now — a change in the middle changes every total after it. Blades keeps the list until then."}
        align="left"
        primary={{ label: 'Got it', onPress: () => setCorrectInfo(false) }}
      />
    </View>
  );
}

// ── Frågepanelen under boken ─────────────────────────────────────────────────

// Rutan för vem man flög med: rollen till vänster (tryck → lista, som i Log Flight men utskriven) och namnet till
// höger (penna → rätta). PIC går inte att välja när man själv har PIC-tid på flygningen.
function CrewRoleBox({ role, options, onRole, name, onEditName }: {
  role?: string; options: { key: string; label: string; disabled: boolean }[]; onRole?: (k: string) => void;
  name: string; onEditName?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === role) ?? options[0];
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      <View style={[s.valueBox, { flex: 0 }]}>
        <TouchableOpacity onPress={() => setOpen((o) => !o)} style={s.roleBtn} accessibilityRole="button" accessibilityLabel={`Role: ${current?.label ?? ''}`}>
          <Text style={s.roleBtnText} numberOfLines={1}>{current?.label ?? 'Role'}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={onEditName} disabled={!onEditName}
          accessibilityLabel={onEditName ? 'Change the name' : undefined}>
          <Text style={[s.valueText, { fontSize: 20, flex: 1 }]} numberOfLines={1}>{name}</Text>
          {onEditName ? <Ionicons name="pencil" size={15} color={Colors.textSecondary} /> : null}
        </TouchableOpacity>
      </View>
      {open && (
        <View style={s.roleList}>
          {options.map((o) => (
            <TouchableOpacity key={o.key} disabled={o.disabled} onPress={() => { onRole?.(o.key); setOpen(false); }}
              style={[s.roleOpt, o.disabled && { opacity: 0.35 }]} accessibilityState={{ selected: o.key === current?.key, disabled: o.disabled }}>
              <Text style={[s.roleOptText, o.key === current?.key && { color: Colors.primary }]}>{o.label}</Text>
              {o.disabled ? <Text style={s.roleOptNote}>You were PIC</Text> : o.key === current?.key ? <Ionicons name="checkmark" size={16} color={Colors.primary} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function QuestionPanel(p: {
  issue: Issue | null; field: string; row: ScanRow; done?: 'ok' | 'changed'; position: number; openCount: number;
  groupValues?: { id: string; row: number; value: string; done: boolean }[]; onExpand: (startAt?: string) => void; onGroupSim: () => void;
  onGroupRemarks: () => void;
  crewRole?: string;
  crewRoleOptions?: { key: string; label: string; disabled: boolean }[];
  onCrewRole?: (key: string) => void;
  onAcceptAddition: () => void;
  onGroupChoice: (value: string) => void;
  movable: string; onMove: (to: string) => void;
  adjust?: {
    sum: string; miscounted: boolean;
    extraRow?: number; onSkipExtra: () => void; onRealRow: () => void; onCorrectInfo: () => void;
    culpritRow?: number; onCulprit: () => void;
    move?: { label: string; hint: string; onPress: () => void };
    onCorrect: () => void;
  };
  draft: string; timeFormat: TimeFormat;
  onEdit: () => void; onEditField: (field: string) => void; onSave: () => void; onConfirm: () => void;
  onSuggestion: (s: Suggestion) => void; onSkipRow: () => void; onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const { issue, field, row, done, timeFormat } = p;
  const d = row.data;
  const current = display(d, field, timeFormat);
  const ctx = [d.date, [d.dep_place, d.arr_place].filter(Boolean).join(' → '), d.registration].filter(Boolean).join(' · ');
  const raw = String((d as any)[field] ?? '');
  const suggestions = (issue?.suggestions ?? []).filter((sg) =>
    !(issue?.kind === 'aircraft' && sg.value === issue.aircraft?.resolved)
    && sg.value !== raw && sg.value !== current
    && !(DURATION.has(field) && Math.abs(parseFloat(sg.value) - parseFloat(raw)) < 0.001));

  const question = !issue
    ? `Claude read ${current ? `"${current}"` : 'nothing'} here. Tap the value to change it.`
    : issue.kind === 'value' && !issue.readAs
      ? `Claude read ${current ? `"${current}"` : 'nothing'}${issue.confidence ? ` but is only ${Math.round(issue.confidence * 100)} % sure` : ''}. ${issue.reason}`
      : issue.reason;

  return (
    <View style={s.q}>
      <View style={s.qLeft}>
        <View style={s.qHead}>
          <Text style={s.eyebrow}>{p.position ? `PROBLEM ${p.position} OF ${p.openCount}` : done ? 'CHECKED' : 'EDIT'}</Text>
          <View style={{ flex: 1 }} />
          {p.openCount > 1 && (
            <>
              <TouchableOpacity style={s.navBtn} onPress={p.onPrev} hitSlop={4} accessibilityLabel="Previous problem"><Ionicons name="chevron-back" size={22} color="#fff" /></TouchableOpacity>
              <TouchableOpacity style={s.navBtn} onPress={p.onNext} hitSlop={4} accessibilityLabel="Next problem"><Ionicons name="chevron-forward" size={22} color="#fff" /></TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={s.navBtn} onPress={p.onClose} hitSlop={4} accessibilityLabel="Show the whole page"><Ionicons name="contract-outline" size={20} color="#fff" /></TouchableOpacity>
        </View>
        <Text style={s.qTitle} numberOfLines={1}>{issue ? issue.title : label(field)}</Text>
        {/* Vilken cell det gäller: rad och kolumn i boken */}
        <View style={s.cellRef}>
          <Ionicons name="grid-outline" size={12} color={Colors.primary} />
          <Text style={s.cellRefText} numberOfLines={1}>
            {!issue ? `Row ${row.rowIndex} · ${label(field)}`
              : issue.kind === 'column' ? `Whole column · ${label(issue.field)}`
              : issue.kind === 'addition' || issue.kind === 'group' ? `${issue.group?.members.length ?? 0} rows · ${label(issue.field)}`
              : issue.kind === 'mismatch' ? `Row ${row.rowIndex} · Departure and arrival time`
              : `Row ${row.rowIndex} · ${label(issue.field)}`}
          </Text>
        </View>
        <Text style={s.qText} numberOfLines={5}>{question}</Text>
      </View>

      <View style={s.qRight}>
        {issue?.kind === 'group' && CHOICES[issue.field] ? (
          <>
            {/* Samma val på flera rader (t.ex. simulatortyp): ett tryck gäller alla. */}
            {!done && (
              <View style={s.chips}>
                {CHOICES[issue.field].map((opt) => (
                  <TouchableOpacity key={opt} style={s.chip} onPress={() => p.onGroupChoice(opt)}>
                    <Text style={s.chipText}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity style={s.btnSecondary} onPress={() => p.onExpand()}>
              <Text style={s.btnSecondaryText}>One by one</Text>
            </TouchableOpacity>
          </>
        ) : issue?.kind === 'group' && issue.group?.remarks ? (
          <>
            {/* Initialerna på alla rader: flytta alla, gå igenom dem en i taget, eller låt dem stå kvar. */}
            <View style={s.chips}>
              {[...new Set((p.groupValues ?? []).map((g) => g.value).filter(Boolean))].slice(0, 8).map((v) => (
                <View key={v} style={s.groupChip}><Text style={s.groupChipValue}>{v}</Text></View>
              ))}
            </View>
            {!done && <CrewRoleBox role={p.crewRole} options={p.crewRoleOptions ?? []} onRole={p.onCrewRole} name={`${(p.groupValues ?? []).length} flights`} />}
            {!done && (
              <View style={s.answerRow}>
                <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={p.onGroupRemarks}>
                  <Text style={s.btnPrimaryText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={p.onConfirm}>
                  <Text style={s.btnSecondaryText}>Ignore</Text>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity onPress={() => p.onExpand()} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 4 }}>
              <Text style={s.textLink}>One by one</Text>
            </TouchableOpacity>
          </>
        ) : issue?.kind === 'group' ? (
          <>
            <View style={s.chips}>
              {(p.groupValues ?? []).slice(0, 10).map((g) => (
                <TouchableOpacity key={g.id} style={[s.groupChip, g.done && { borderColor: Colors.success }]} onPress={() => p.onExpand(g.id)}>
                  <Text style={s.groupChipRow}>R{g.row}</Text>
                  <Text style={s.groupChipValue}>{g.value || '–'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!done && issue.group?.sims && (
              <TouchableOpacity style={s.btnPrimary} onPress={p.onGroupSim}>
                <Text style={s.btnPrimaryText}>Simulator session for all {issue.group.sims.length}</Text>
              </TouchableOpacity>
            )}
            <View style={s.answerRow}>
              {!done && (
                <TouchableOpacity style={[s.okBtn, { flex: 1, justifyContent: 'center' }]} onPress={p.onConfirm}>
                  <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
                  <Text style={s.saveText}>Looks right for all {(p.groupValues ?? []).length}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.btnSecondary, { flex: done ? 1 : 0 }]} onPress={() => p.onExpand()}>
                <Text style={s.btnSecondaryText}>One by one</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : issue?.kind === 'addition' ? (
          <>
            {!done && (
              <TouchableOpacity style={s.btnPrimary} onPress={p.onAcceptAddition}>
                <Text style={s.btnPrimaryText}>Yes, this book adds {issue.suggestions[0]?.value} h</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.btnSecondary} onPress={() => p.onExpand()}>
              <Text style={s.btnSecondaryText}>No, check each row</Text>
            </TouchableOpacity>
            <Text style={s.qHint}>Blades remembers a yes for your next scans.</Text>
          </>
        ) : issue?.kind === 'mismatch' ? (
          <>
            {issue.suggestions.map((sg) => (
              <TouchableOpacity key={sg.field} style={s.option} onPress={() => p.onSuggestion(sg)}>
                <Text style={s.optionText} numberOfLines={2}>{sg.label}</Text>
                <Text style={s.optionSub} numberOfLines={2}>{label(sg.field)} becomes {sg.value}</Text>
              </TouchableOpacity>
            ))}
            {/* Eller rätta tiderna själv */}
            <View style={s.answerRow}>
              {(['dep_utc', 'arr_utc'] as const).map((f) => (
                <TouchableOpacity key={f} style={[s.valueBox, { height: 44 }]} onPress={() => p.onEditField(f)} accessibilityLabel={`Change ${label(f)}`}>
                  <Text style={s.remarkField}>{f === 'dep_utc' ? 'Dep' : 'Arr'}</Text>
                  <Text style={[s.valueText, { fontSize: 17 }]} numberOfLines={1}>{display(d, f, p.timeFormat) || '—'}</Text>
                  <Ionicons name="pencil" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : issue?.kind === 'remark' && issue.suggestions[0]?.field === 'second_pilot' ? (
          <>
            {/* Vem man flög med: rollen (tryck för att byta, som i Log Flight) och namnet (penna för att rätta, t.ex. JEV → JEN). */}
            <CrewRoleBox
              role={p.crewRole} options={p.crewRoleOptions ?? []} onRole={p.onCrewRole}
              name={p.draft || issue.suggestions[0]?.value} onEditName={p.onEdit}
            />
            <View style={s.answerRow}>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={() => p.onSuggestion({ ...issue.suggestions[0], value: p.draft || issue.suggestions[0].value })}>
                <Text style={s.btnPrimaryText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={p.onConfirm}><Text style={s.btnSecondaryText}>Ignore</Text></TouchableOpacity>
            </View>
          </>
        ) : issue?.kind === 'remark' ? (
          <>
            {/* PICUS/SPIC/NVG-tid i anmärkningen: går att rätta innan den flyttas. */}
            <TouchableOpacity style={s.valueBox} onPress={p.onEdit} accessibilityLabel={`Change ${label(issue.suggestions[0]?.field ?? '')}`}>
              <Text style={s.remarkField}>{label(issue.suggestions[0]?.field ?? '')}</Text>
              <Text style={[s.valueText, { fontSize: 20 }]} numberOfLines={1}>{p.draft || issue.suggestions[0]?.value}</Text>
              <Ionicons name="pencil" size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <View style={s.answerRow}>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={() => p.onSuggestion({ ...issue.suggestions[0], value: p.draft || issue.suggestions[0].value })}>
                <Text style={s.btnPrimaryText}>Move it</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={p.onConfirm}><Text style={s.btnSecondaryText}>Ignore</Text></TouchableOpacity>
            </View>
          </>
        ) : issue?.kind === 'column' && p.adjust?.extraRow != null && !done ? (
          <>
            <View style={s.answerRow}>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={p.adjust.onSkipExtra}>
                <Text style={s.btnPrimaryText}>Skip row {p.adjust.extraRow}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={p.adjust.onRealRow}>
                <Text style={s.btnSecondaryText}>It's a real flight</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.qHint}>The copy is left out of the import. Nothing changes in your paper logbook.</Text>
          </>
        ) : issue?.kind === 'column' && p.adjust ? (
          // Cellerna först: är en av kolumnens celler obesvarad pekar frågan dit. Annars rättar man den cell som är
          // fel (avläsningarna står bredvid raderna), eller säger att summan i pappersboken är felräknad: då står
          // flygningarna kvar och guiden efter Save listar alla följdändringar. Appen ändrar aldrig flera
          // flygningar på en gissning för att få summan att gå ihop.
          <>
            {!done && (() => {
              const correct = (primary: boolean) => (
                <View key="correct" style={s.colOption}>
                  <TouchableOpacity style={primary ? s.btnPrimary : s.btnSecondary} onPress={p.adjust!.onCorrect}>
                    <Text style={primary ? s.btnPrimaryText : s.btnSecondaryText}>Correct my total to {p.adjust!.sum}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.infoLink} onPress={p.adjust!.onCorrectInfo} hitSlop={6} accessibilityRole="button">
                    <Ionicons name="information-circle-outline" size={15} color={Colors.primary} />
                    <Text style={s.infoLinkText}>Flights stay as written. What happens to my paper logbook?</Text>
                  </TouchableOpacity>
                </View>
              );
              // Värdena står i grannkolumnen → flytten först (exakt), rättelsen av summan som andrahandsval.
              if (p.adjust!.move) return [(
                <View key="move" style={s.colOption}>
                  <TouchableOpacity style={s.btnPrimary} onPress={p.adjust!.move.onPress}>
                    <Text style={s.btnPrimaryText}>{p.adjust!.move.label}</Text>
                  </TouchableOpacity>
                  <Text style={s.optionHint}>{p.adjust!.move.hint}</Text>
                </View>
              ), correct(false)];
              if (p.adjust!.culpritRow != null) return [(
                <View key="culprit" style={s.colOption}>
                  <TouchableOpacity style={s.btnPrimary} onPress={p.adjust!.onCulprit}>
                    <Text style={s.btnPrimaryText}>Check row {p.adjust!.culpritRow} first</Text>
                  </TouchableOpacity>
                  <Text style={s.optionHint}>That cell is the most likely misreading in this column.</Text>
                </View>
              ), correct(false)];
              return [correct(p.adjust!.miscounted)];
            })()}
            {!done && !p.adjust.miscounted && !p.adjust.move && p.adjust.culpritRow == null && <Text style={s.qHint}>Tap one of Claude's readings next to the rows to fix a misread value.</Text>}
          </>
        ) : issue?.kind === 'column' ? (
          <>
            {!done && <TouchableOpacity style={s.btnSecondary} onPress={p.onConfirm}><Text style={s.btnSecondaryText}>Keep the readings</Text></TouchableOpacity>}
            <Text style={s.qHint}>Your page total stays as written. Claude's readings are next to each row; tap one to fix a misread value.</Text>
          </>
        ) : issue?.kind === 'row' ? (
          <>
            <TouchableOpacity style={s.btnPrimary} onPress={p.onConfirm}><Text style={s.btnPrimaryText}>Row looks right</Text></TouchableOpacity>
            <Text style={s.qHint}>Or tap a value on the row to change it.</Text>
          </>
        ) : CHOICES[field] ? (
          <View style={s.chips}>
            {CHOICES[field].map((opt) => {
              const active = String((d as any)[field] ?? '').toLowerCase() === chipKey(opt);
              return (
                <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]}
                  onPress={() => (issue ? p.onSuggestion({ label: opt, field, value: opt }) : undefined)}>
                  <Text style={[s.chipText, active && s.chipTextActive]}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <>
            <View style={s.answerRow}>
              {/* Värdet ser ut som ett fält; ett tryck öppnar tangentbordet i raden ovanför det. */}
              <TouchableOpacity style={s.valueBox} onPress={p.onEdit} accessibilityLabel={`Change ${label(field)}`}>
                <Text style={[s.valueText, !current && { color: Colors.textMuted }]} numberOfLines={1}>{current || 'Empty'}</Text>
                <Ionicons name="pencil" size={15} color={Colors.textSecondary} />
              </TouchableOpacity>
              {/* En omöjlig läsning (07:80) går inte att godkänna: välj en giltig tid, skriv den, eller lämna tomt. */}
              {issue && !done && issue.readAs && !current ? (
                <TouchableOpacity style={[s.btnSecondary, { height: 48 }]} onPress={p.onConfirm}>
                  <Text style={s.btnSecondaryText}>Leave empty</Text>
                </TouchableOpacity>
              ) : issue && !done && (
                <TouchableOpacity style={s.okBtn} onPress={p.onConfirm} accessibilityLabel="Looks right">
                  <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
                  <Text style={s.saveText}>{issue.kind === 'aircraft' ? `Use ${issue.aircraft?.resolved}` : 'Looks right'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {issue && !done && suggestions.length > 0 && (
              <View style={s.chips}>
                <Text style={s.suggestLabel}>OR</Text>
                {suggestions.map((sg) => (
                  <TouchableOpacity key={`${sg.field}-${sg.value}`} style={s.suggestion} onPress={() => p.onSuggestion(sg)}>
                    <Text style={s.suggestionText}>{sg.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {/* Fel kolumn: talet står i kolumnen bredvid. */}
            {issue && !done && p.movable && (issue.moves?.length ?? 0) > 0 && (
              <View style={s.chips}>
                <Text style={s.suggestLabel}>WRONG COLUMN?</Text>
                {issue.moves!.map((m) => (
                  <TouchableOpacity key={m.field} style={s.moveBtn} onPress={() => p.onMove(m.field)}
                    accessibilityLabel={`Move ${p.movable} to ${label(m.field)}`}>
                    {m.side === 'left' && <Ionicons name="arrow-back" size={14} color="#fff" />}
                    <Text style={s.moveText}>{p.movable} to {label(m.field)}</Text>
                    {m.side === 'right' && <Ionicons name="arrow-forward" size={14} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      <View style={s.qFoot}>
        <Text style={s.qCtx} numberOfLines={1}>{issue?.kind === 'column' || issue?.kind === 'addition' ? '' : ctx}</Text>
        {issue?.kind !== 'column' && issue?.kind !== 'addition' && <TouchableOpacity onPress={p.onSkipRow} hitSlop={8}><Text style={s.skipLink}>Skip row</Text></TouchableOpacity>}
      </View>
    </View>
  );
}

function ValueInput({ inputRef, field, value, onChange, onSubmit, onFocus, onBlur, timeFormat, autoFocus }: {
  inputRef: RefObject<TextInput | null>; field: string; value: string; onChange: (t: string) => void;
  onSubmit: () => void; onFocus: () => void; onBlur?: () => void; timeFormat: TimeFormat; autoFocus?: boolean;
}) {
  return (
    <TextInput
      ref={inputRef}
      style={s.input}
      value={value}
      onChangeText={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      autoFocus={autoFocus}
      selectTextOnFocus
      returnKeyType="done"
      onSubmitEditing={onSubmit}
      autoCapitalize={PLACE.has(field) || UPPER.has(field) ? 'characters' : 'sentences'}
      autoCorrect={false}
      keyboardType={DURATION.has(field) ? (timeFormat === 'hhmm' ? 'numbers-and-punctuation' : 'decimal-pad')
        : CLOCK.has(field) || COUNT.has(field) ? 'number-pad' : field === 'date' ? 'numbers-and-punctuation' : 'default'}
      placeholder={field === 'date' ? 'YYYY-MM-DD' : CLOCK.has(field) ? 'HH:MM' : DURATION.has(field) ? (timeFormat === 'hhmm' ? 'H:MM' : '0.0') : 'Empty'}
      placeholderTextColor={Colors.textMuted}
    />
  );
}

function Overview(p: {
  page?: PageState; pagesCount: number; activePage: number; flights: number; open: number; busy: boolean;
  pageLabel: string | null; hours: string; totals: { ok: number; checked: number };
  onStart: () => void; onImport: () => void; onRetry: () => void; onGetCoins: () => void; coinsLabel: string;
}) {
  const st = p.page?.status;
  if (st === 'error' && p.page?.error === OUT_OF_COINS) {
    return (
      <View style={s.q}>
        <View style={s.qLeft}>
          <Text style={[s.eyebrow, { color: Colors.gold }]}>OUT OF BLADE COINS</Text>
          <Text style={s.qText} numberOfLines={3}>This spread isn't read yet. The photo is kept — get more coins and the scan continues here.</Text>
        </View>
        <View style={[s.qRight, { justifyContent: 'center' }]}>
          <TouchableOpacity style={[s.btnPrimary, { backgroundColor: Colors.gold }]} onPress={p.onGetCoins}><Text style={s.btnPrimaryText}>{p.coinsLabel}</Text></TouchableOpacity>
          <TouchableOpacity style={s.btnSecondary} onPress={p.onRetry}><Text style={s.btnSecondaryText}>Try again</Text></TouchableOpacity>
        </View>
      </View>
    );
  }
  if (st === 'error') {
    return (
      <View style={s.q}>
        <View style={s.qLeft}>
          <Text style={[s.eyebrow, { color: Colors.dangerLight }]}>COULDN'T READ THIS SPREAD</Text>
          <Text style={s.qText} numberOfLines={3}>{p.page?.error}</Text>
        </View>
        <View style={[s.qRight, { justifyContent: 'center' }]}>
          <TouchableOpacity style={s.btnPrimary} onPress={p.onRetry}><Text style={s.btnPrimaryText}>Try again</Text></TouchableOpacity>
        </View>
      </View>
    );
  }
  if (st !== 'done') {
    return (
      <View style={s.q}>
        <View style={s.qLeft}>
          <Text style={s.qTitle}>{p.pagesCount > 1 ? `Reading spread ${p.activePage + 1} of ${p.pagesCount}` : 'Reading your logbook'}</Text>
          <Text style={s.qText}>This usually takes 20–40 seconds. You'll feel a tap when it's done.</Text>
        </View>
        <ReadingSteps status={st ?? 'waiting'} />
      </View>
    );
  }
  // Läsningen klar: samma uppbyggnad som laddskärmen och rapporten — etikett, rubrik, tre mätvärden, en knapp.
  const totalsTone = p.totals.checked ? (p.totals.ok === p.totals.checked ? Colors.success : Colors.warning) : '#fff';
  return (
    <View style={s.q}>
      <View style={s.qLeft}>
        <Text style={s.ovEyebrow}>
          {p.pagesCount > 1 ? `SPREAD ${p.activePage + 1} OF ${p.pagesCount}` : 'SCAN READY'}{p.pageLabel ? ` · ${p.pageLabel.toUpperCase()}` : ''}
        </Text>
        <Text style={s.ovTitle}>
          {p.open > 0 ? `${p.open} ${p.open === 1 ? 'thing' : 'things'} to check` : 'Everything looks right'}
        </Text>
        <Text style={s.qText}>
          {p.open > 0
            ? 'Each one is marked on the page. Go through them one at a time, then review the flights and save.'
            : 'Review the flights in the scan report and save. Tap any value on the page to change it.'}
          {p.busy ? ' The next spread is still being read.' : ''}
        </Text>
      </View>
      <View style={s.ovStats}>
        <View style={s.ovStat}><Text style={s.ovValue}>{p.flights}</Text><Text style={s.ovLabel}>{p.flights === 1 ? 'flight' : 'flights'}</Text></View>
        <View style={s.ovDivider} />
        <View style={s.ovStat}><Text style={s.ovValue}>{p.hours}</Text><Text style={s.ovLabel}>flight time</Text></View>
        <View style={s.ovDivider} />
        <View style={s.ovStat}>
          <Text style={[s.ovValue, { color: totalsTone }]}>{p.totals.checked ? `${p.totals.ok}/${p.totals.checked}` : '–'}</Text>
          {/* Kolumner med en skriven "Total this page" vars rader summerar till den (t.ex. 3 av 4). */}
          <Text style={s.ovLabel}>totals match</Text>
        </View>
      </View>
      <View style={s.overviewBtns}>
        {p.open > 0 ? (
          <TouchableOpacity style={s.btnPrimary} onPress={p.onStart}>
            <Text style={s.btnPrimaryText}>Start checking</Text>
            <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[s.btnPrimary, p.busy && { opacity: 0.5 }]} onPress={p.onImport}>
            <Text style={s.btnPrimaryText}>See scan report</Text>
            <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Tonar ned allt i bokens ram utom rektangeln.
function Spotlight({ rect, fit }: { rect: Rect; fit: { w: number; h: number } }) {
  const x = rect.x * fit.w, y = rect.y * fit.h, w = rect.w * fit.w, h = rect.h * fit.h;
  const pad = 6;
  const dim = 'rgba(3,8,16,0.55)';
  return (
    <>
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, height: Math.max(0, y - pad), backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: 0, top: y + h + pad, right: 0, bottom: 0, backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: 0, top: Math.max(0, y - pad), width: Math.max(0, x - pad), height: h + pad * 2, backgroundColor: dim }} />
      <View style={{ position: 'absolute', left: x + w + pad, top: Math.max(0, y - pad), right: 0, height: h + pad * 2, backgroundColor: dim }} />
    </>
  );
}

function ReadingSteps({ status }: { status: PageStatus }) {
  const steps: [string, boolean, boolean][] = [
    ['Finding the logbook in the photo', status !== 'finding' && status !== 'waiting', status === 'finding' || status === 'waiting'],
    ['Claude reads every row', false, status === 'reading'],
    ['Marking what needs a check', false, false],
  ];
  return (
    <View style={s.steps}>
      {steps.map(([text, done, active]) => (
        <View key={text} style={s.step}>
          {done ? <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
            : active ? <ActivityIndicator size="small" color={Colors.primary} />
              : <View style={s.stepDot} />}
          <Text style={[s.stepText, (done || active) && { color: '#fff' }]}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

// En stiliserad loggbok med ett svep, medan Claude läser. Fotot visas först när det är klart.
function ScanningAnimation() {
  const t = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [t, pulse]);
  const W = 240, H = 140;
  const page = (side: 'l' | 'r') => (
    <View style={[s.animPage, side === 'l' ? { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 } : { borderTopRightRadius: 10, borderBottomRightRadius: 10 }]}>
      {Array.from({ length: 7 }).map((_, i) => <View key={`h${i}`} style={[s.animRowLine, { top: 22 + i * 16 }]} />)}
      {[0.22, 0.45, 0.7].map((x) => <View key={`v${x}`} style={[s.animColLine, { left: `${x * 100}%` }]} />)}
    </View>
  );
  return (
    <Animated.View style={{ width: W, height: H, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }}>
      <View style={s.animBook}>{page('l')}{page('r')}</View>
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: 10 }]}>
        <Animated.View style={[s.sweep, { transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-24, H] }) }] }]} />
      </View>
    </Animated.View>
  );
}

function FadeIn({ children }: { children: ReactNode }) {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(o, { toValue: 1, duration: 450, useNativeDriver: true }).start(); }, [o]);
  return <Animated.View style={{ opacity: o }}>{children}</Animated.View>;
}

// dim: extra mörk ton ovanpå glaset (frågepanelen ska inte vara helt genomskinlig).
function Glass({ style, children, dim }: { style?: any; children?: ReactNode; dim?: number }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const radius = flat.borderRadius ?? 16;
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      {canUseLiquidGlass() ? (() => {
        const { GlassView } = require('expo-glass-effect');
        return (
          <>
            <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(10,22,40,0.6)" style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
            {dim ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(8,16,30,${dim})` }]} /> : null}
          </>
        );
      })() : (
        <>
          <BlurView pointerEvents="none" tint="systemThickMaterialDark" intensity={90} style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(12,26,48,${Math.max(0.62, dim ?? 0)})` }]} />
        </>
      )}
      {children}
    </View>
  );
}

function IconButton({ icon, onPress, label: a11y }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityLabel={a11y} hitSlop={6}>
      <Glass style={s.iconBtn}><Ionicons name={icon} size={20} color="#fff" /></Glass>
    </TouchableOpacity>
  );
}

function place(r: Rect, fit: { w: number; h: number }, pad = 0) {
  return {
    position: 'absolute' as const,
    left: r.x * fit.w - pad, top: r.y * fit.h - pad,
    width: r.w * fit.w + pad * 2, height: r.h * fit.h + pad * 2,
  };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05090f' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  fatalText: { color: Colors.textPrimary, fontSize: 16, textAlign: 'center' },

  reading: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,12,24,0.75)', borderRadius: 2 },
  readingText: { color: '#fff', fontFamily: MONO, fontWeight: '600' },
  readingTotal: { borderWidth: 1, borderColor: 'rgba(0,200,232,0.8)' },
  readingSure: { backgroundColor: 'rgba(5,12,24,0.82)' },
  readingUnsure: { backgroundColor: '#FFC83D' },
  readingBad: { backgroundColor: '#E5484D' },
  totalsLine: { color: '#DCE9F5', fontFamily: MONO, fontSize: 11, fontWeight: '600', backgroundColor: 'rgba(5,12,24,0.75)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  // Helskärmsläget
  fsCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#0A1628' },
  fsHint: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fsBtn: { position: 'absolute', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,22,40,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  fsBtnInline: { position: 'relative' },
  fsRight: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 },
  fsPageText: { color: '#fff', fontFamily: MONO, fontSize: 13, fontWeight: '700', backgroundColor: 'rgba(10,22,40,0.82)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  fsLegend: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(10,22,40,0.82)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 },
  fsChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  fsLevels: { position: 'absolute', left: 0, right: 0, top: 10, height: 44, alignItems: 'center', justifyContent: 'center' },
  fsLevelsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(10,22,40,0.82)', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  fsLevel: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
  fsLevelText: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  fsLevelPct: { fontFamily: MONO, fontSize: 13, fontWeight: '800' },
  fsChipText: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  fsTotals: { color: '#DCE9F5', fontFamily: MONO, fontSize: 10.5, fontWeight: '600', marginLeft: 6 },
  fsCard: { position: 'absolute', gap: 8, padding: 12, borderRadius: 16, backgroundColor: 'rgba(10,22,40,0.96)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.35)' },
  fsCardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  fsCardCtx: { flex: 1, color: '#9DB6CC', fontFamily: MONO, fontSize: 11 },
  fsCardWhy: { color: '#C3D4E3', fontSize: 12.5, lineHeight: 17 },
  fsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  fsInputWrap: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(127,168,200,0.4)', backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 10, justifyContent: 'center' },
  fsLoupe: { width: 150, height: 40, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,200,61,0.9)', backgroundColor: '#000' },
  fsGhost: { minHeight: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  fsGhostText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  readPill: {
    position: 'absolute', justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(5,14,28,0.88)', borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.primary,
  },
  readPillText: { color: Colors.primary, fontFamily: MONO, fontWeight: '700' },
  readPillSim: { color: Colors.textMuted, fontWeight: '800', letterSpacing: 0.5 },
  readPillOn: { backgroundColor: Colors.warning, borderColor: Colors.warning },
  readPillOk: { borderColor: Colors.success, backgroundColor: 'rgba(0,60,40,0.9)' },
  readPillBad: { borderColor: Colors.warning, backgroundColor: 'rgba(70,45,0,0.92)' },
  skipBand: { backgroundColor: 'rgba(5,9,15,0.66)', alignItems: 'center', justifyContent: 'center' },
  skipText: { color: 'rgba(255,255,255,0.8)', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  ring: {
    borderColor: Colors.warning, backgroundColor: 'rgba(255,184,48,0.12)',
    shadowColor: Colors.warning, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  scanAnimWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  animBook: { flex: 1, flexDirection: 'row', gap: 4 },
  animPage: { flex: 1, borderWidth: 1.5, borderColor: 'rgba(0,200,232,0.55)', backgroundColor: 'rgba(0,200,232,0.05)', overflow: 'hidden' },
  animRowLine: { position: 'absolute', left: 8, right: 8, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,200,232,0.4)' },
  animColLine: { position: 'absolute', top: 14, bottom: 14, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,200,232,0.3)' },
  steps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  stepText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  sweep: {
    position: 'absolute', left: 0, right: 0, height: 24,
    backgroundColor: 'rgba(0,200,232,0.22)', borderBottomWidth: 2, borderBottomColor: Colors.primary,
  },

  topBar: { position: 'absolute', height: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  learnBar: { position: 'absolute', zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#0F2A40', borderWidth: 1, borderColor: Colors.primary + '55' },
  learnText: { flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  learnUndo: { color: Colors.primary, fontSize: 13, fontWeight: '800' },
  pagePills: { flexDirection: 'row', gap: 6 },
  pillRow: { position: 'absolute', flexDirection: 'row', gap: 6 },
  pagePill: {
    height: 32, minWidth: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 4, backgroundColor: 'rgba(10,22,40,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  pagePillActive: { borderColor: Colors.primary },
  pagePillText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pagePillTextActive: { color: '#fff' },
  pillBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: Colors.warning, alignItems: 'center', justifyContent: 'center' },
  pillBadgeText: { color: Colors.textInverse, fontSize: 10, fontWeight: '800' },
  statusPill: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  toggle: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,22,40,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  toggleOn: { borderColor: Colors.primary, backgroundColor: 'rgba(0,200,232,0.16)' },
  toggleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  importBtn: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  importText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  panel: { position: 'absolute', borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  q: { flexGrow: 1, gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  qLeft: { gap: 4 },
  qRight: { gap: 8 },
  qHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  eyebrow: { color: Colors.warning, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  qTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  qText: { color: 'rgba(255,255,255,0.86)', fontSize: 13, lineHeight: 18 },
  qFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 'auto' },
  qCtx: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  qHint: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  colOption: { gap: 5 },
  optionHint: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16, paddingHorizontal: 4 },
  infoLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
  infoLinkText: { flex: 1, color: Colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  skipLink: { color: Colors.dangerLight, fontSize: 13, fontWeight: '600' },

  answerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueBox: {
    flex: 1, height: 48, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  valueText: { flex: 1, color: '#fff', fontSize: 22, fontFamily: MONO, fontWeight: '600' },
  remarkField: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  roleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '58%', paddingVertical: 4, paddingRight: 10, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(255,255,255,0.18)' },
  roleBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  roleList: { borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  roleOpt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  roleOptText: { color: Colors.textPrimary, fontSize: 14.5, fontWeight: '600' },
  roleOptNote: { color: Colors.textMuted, fontSize: 11.5, fontWeight: '600' },
  textLink: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  cellRef: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  cellRefText: { color: Colors.primary, fontSize: 12.5, fontWeight: '700' },
  input: { flex: 1, height: 40, color: '#fff', fontSize: 18, fontFamily: MONO, fontWeight: '600' },
  saveBtn: { height: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  groupChip: {
    flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,184,48,0.6)', backgroundColor: 'rgba(0,0,0,0.25)',
  },
  groupChipRow: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },
  groupChipValue: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: MONO },
  okBtn: { height: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: Colors.success, flexDirection: 'row', gap: 6, alignItems: 'center' },
  saveText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: Colors.textInverse },
  suggestLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginRight: 2 },
  suggestion: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(0,232,160,0.14)', borderWidth: 1, borderColor: Colors.success + '88' },
  suggestionText: { color: Colors.success, fontSize: 14, fontWeight: '700', fontFamily: MONO },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: 'rgba(0,200,232,0.14)', borderWidth: 1, borderColor: Colors.primary + '88',
  },
  moveText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  option: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  optionText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  optionSub: { color: Colors.textSecondary, fontSize: 12 },

  overviewBtns: { marginTop: 'auto' },
  ovEyebrow: { color: Colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, fontFamily: MONO },
  ovTitle: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginTop: 2 },
  ovStats: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  ovStat: { flex: 1, alignItems: 'center', gap: 1 },
  ovDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.14)' },
  ovValue: { color: '#fff', fontSize: 19, fontWeight: '800', fontFamily: MONO, fontVariant: ['tabular-nums'] },
  ovLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  btnPrimary: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, flexDirection: 'row', gap: 6 },
  btnPrimaryText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  btnWarn: { minHeight: 46, borderRadius: 12, backgroundColor: Colors.warning, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, flexDirection: 'row', gap: 8 },
  btnSecondary: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnSecondaryText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },

  compactWrap: { position: 'absolute', gap: 6 },
  hits: { flexDirection: 'row', gap: 6 },
  hit: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(10,22,40,0.92)', maxWidth: 180 },
  hitCode: { color: Colors.primary, fontSize: 13, fontWeight: '700', fontFamily: MONO },
  hitName: { color: Colors.textSecondary, fontSize: 10 },
  compact: { borderRadius: 16, paddingLeft: 14, paddingRight: 8, paddingVertical: 10, gap: 4 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  compactCancel: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600', paddingHorizontal: 6 },
});
