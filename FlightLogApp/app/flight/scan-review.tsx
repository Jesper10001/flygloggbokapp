import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Pressable, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Animated, Easing, Keyboard, useWindowDimensions, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors } from '../../constants/colors';
import { canUseLiquidGlass } from '../../utils/liquidGlass';
import { ocrScanPage, getActiveBookLayout, OCR_MODEL, type AircraftDetection, type PageContext } from '../../services/ocr';
import {
  getScanBatch, clearScanImage, getScanUseBookLayout, getScanTimeBasis, setScanTimeBasis, getScanFocus,
  type TimeBasis, type ScanFocus,
} from '../../store/scanStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import type { TimeFormat } from '../../store/timeFormatStore';
import { useFlightStore } from '../../store/flightStore';
import { isTokenQuotaError, openCoinShop, showMonthlyTokenLimitAlert } from '../../utils/tokenGate';
import { coinShopAvailable } from '../../services/coinPacks';
import { presentPaywall } from '../../services/purchases';
import { getAllAircraftTypes, addAircraftTypeToRegistry, updateAircraftCruiseSpeed, updateAircraftEndurance, getSetting, setSetting } from '../../db/flights';
import { lookupAircraft } from '../../services/aircraftLookup';
import { ScanReport, type CellState } from '../../components/scan/ScanReport';
import { ScanProgress, type ScanPhase } from '../../components/scan/ScanProgress';
import { FlightEditor } from '../../components/scan/FlightEditor';
import { emptyAircraftInput, type AircraftInput } from '../../components/scan/NewAircraftCard';
import { saveLearnedMapping } from '../../db/ocrLearned';
import {
  label, display, parseInput, inputValue, shapeInput, DURATION, CLOCK, PLACE, COUNT, UPPER, CHOICES, chipKey,
} from '../../services/scanFields';
import { isAvailable as visionAvailable, recognize } from '../../modules/apple-vision-ocr';
import {
  prepareFlight, findUnknownIcaos, flagUnknownIcaos, saveScanRows, saveLearnedCorrections, findDuplicateKeys, columnTotals,
  detectTimeAddition, fitsTimeAddition, distributeDifference, type ScanRow,
} from '../../services/scanImport';
import {
  buildPageGrid, cellRect, rowRect, rowBand, mappedBoxRect, unionRect, hitTest, columnFor, type PageGrid, type Rect,
} from '../../services/scanGeometry';
import {
  logbookBounds, wordsInCrop, alignGrid, textScore, orientationScore, bookAspect, completeGridFromHeaders, crossCheckCounts, measureRows, relocateColumnsByValues, type VisionBox,
} from '../../services/scanAlign';
import type { LogbookLayout } from '../../services/logbookLayout';
import type { OcrFlightResult } from '../../types/flight';

// Granskning av skannade loggbokssidor. Loggboken i helskärm (liggande) överst; Claude ringar in det den
// är osäker på, och under boken står frågan med förslag. Ett problem i taget. Man kan också trycka på
// vilket värde som helst i boken och rätta det.
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
  rect: Rect | null;
  aircraft?: { asWritten: string; resolved: string };
  group?: { key: string; members: string[]; rects: Rect[]; sims?: { rowKey: string; sg: Suggestion }[] };   // samma fråga på flera rader
  moves?: { side: 'left' | 'right'; field: string }[];   // "fel kolumn": grannkolumnerna värdet kan flyttas till
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
  base64: string;
  mediaType: 'image/jpeg' | 'image/png';
  uri: string;
  width: number;
  height: number;
  cropped: boolean;
  oriented: boolean;
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
const SIM_MARK = 'SIM';
function bookCell(d: OcrFlightResult, field: string, fmt: TimeFormat): string {
  if (field === 'total_time' && d.flight_type === 'sim') return SIM_MARK;
  return display(d, field, fmt);
}

// Klockslag ± timmar (över midnatt).
const shiftClock = (t: string, h: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return '';
  const x = (((Number(m[1]) * 60 + Number(m[2]) + Math.round(h * 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

// Användarens fokus (startsidan) avgör vilka frågor som är värda att ställa:
//  exact    – allt Claude är osäker på
//  balanced – kärndata (datum, typ, registrering, platser), simulator och nya typer; osäkra siffror bara när
//             kolumnen inte går ihop med sidans summa
//  totals   – kolumner som inte går ihop, och osäkra siffror i just de kolumnerna
// En siffra i en kolumn som saknar summa att jämföra med frågas alltid om.
const CORE_FIELDS = new Set(['date', 'aircraft_type', 'registration', 'dep_place', 'arr_place', 'sim_category', 'other_time_role']);
function worthAsking(i: Issue, focus: ScanFocus, colOk: Map<string, boolean>): boolean {
  if (focus === 'exact' || i.kind === 'column') return true;
  if (i.kind === 'value' || i.kind === 'choice') {
    if (i.field === 'sim') return true;   // flygning eller simulator avgör vilken summa tiden hamnar i
    if (DURATION.has(i.field) || COUNT.has(i.field)) return colOk.get(`${i.page}|${i.field}`) !== true;
    return focus === 'balanced' && CORE_FIELDS.has(i.field);
  }
  if (i.kind === 'aircraft') return focus === 'balanced';
  return false;                           // tider som inte går ihop, anmärkningar, "kolla raden"
}

// addition: bokens tillägg på flygtiden — bekräftat (accepted) eller upptäckt i raderna (candidate).
function deriveIssues(
  rows: ScanRow[], pages: PageState[], known: Set<string>, expanded: Set<string>,
  addition: { accepted: number | null; candidate: { hours: number; rows: number } | null },
  focus: ScanFocus = 'exact',
): Issue[] {
  const out: Issue[] = [];
  const add = addition.accepted;
  for (const row of rows) {
    if (row.skip) continue;
    const grid = pages[row.page]?.grid ?? null;
    const d = row.data;
    const cell = (f: string) => (grid ? cellRect(grid, row.rowIndex, f) : null);
    const whole = grid ? rowRect(grid, row.rowIndex) : null;
    let rowHasIssue = false;

    for (const fi of d.field_issues ?? []) {
      if (fi.field === 'remarks' && d.remarks_suggestion) continue;
      if ((fi.field === 'dep_utc' || fi.field === 'arr_utc') && d.time_mismatch) continue;
      rowHasIssue = true;
      const choice = !!CHOICES[fi.field];
      const suggestions: Suggestion[] = [];
      if (fi.field === 'sim' && fi.from && fi.suggested_value) suggestions.push({ label: 'Yes, simulator session', field: 'sim', value: fi.suggested_value, toSim: fi.from });
      else if (DURATION.has(fi.field) && /sim|fstd|synthetic/i.test(fi.reason) && d.flight_type !== 'sim') {
        const v = String((d as any)[fi.field] ?? '');
        if ((parseFloat(v) || 0) > 0) suggestions.push({ label: 'It is simulator time', field: 'sim', value: v, toSim: fi.field });
      }
      else if (fi.suggested_value && !choice) suggestions.push({ label: fi.suggested_value, field: fi.field, value: fi.suggested_value });
      if (fi.field === 'dep_place' || fi.field === 'arr_place') suggestions.push({ label: 'Off-airport (ZZZZ)', field: fi.field, value: 'ZZZZ' });
      out.push({
        id: `${row.key}:f:${fi.field}`, kind: choice ? 'choice' : 'value', page: row.page, rowKey: row.key,
        field: fi.field, title: label(fi.field), reason: fi.reason, confidence: fi.confidence || undefined,
        // Cellen först: den är justerad mot Visions ord. Claudes egen ruta bara när fältet saknar kolumn.
        suggestions, rect: cell(fi.field) ?? mappedBoxRect(fi.box, grid) ?? whole,
        moves: choice ? undefined : neighbourColumns(grid, fi.field),
      });
    }

    // Med bokens bekräftade tillägg (t.ex. +0.2 h) stämmer raden → ingen fråga.
    const addFits = add != null && !!d.time_mismatch && fitsTimeAddition(d, add);
    if (d.time_mismatch && !addFits) {
      rowHasIssue = true;
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
      rowHasIssue = true;
      const rs = d.remarks_suggestion;
      out.push({
        id: `${row.key}:remark`, kind: 'remark', page: row.page, rowKey: row.key, field: 'remarks',
        title: 'Something in the remarks',
        reason: `"${rs.original_text}" looks like the ${label(rs.field).toLowerCase()}: ${rs.value}. Move it there?`,
        confidence: rs.confidence,
        suggestions: [{ label: 'Yes, move it', field: rs.field, value: rs.value }],
        rect: cell('remarks') ?? whole,
      });
    }

    // Raden var bara flaggad för tiden, som nu stämmer med bokens tillägg.
    const timeReview = addFits && /time|arriv|depart|block|total|\d:\d\d/i.test(d.review_reason || 'time');
    if (d.needs_review && !rowHasIssue && !timeReview) {
      out.push({
        id: `${row.key}:row`, kind: 'row', page: row.page, rowKey: row.key, field: '',
        title: 'Check this row', reason: d.review_reason || 'Claude was unsure about this row.',
        suggestions: [], rect: whole,
      });
    }
  }

  // Nya flygplanstyper (finns inte i registret) → bekräfta där typen först står.
  pages.forEach((p, pageIdx) => {
    for (const det of p.detections) {
      if (known.has(det.resolved.toUpperCase())) continue;
      const aw = det.as_written.toUpperCase();
      const pageRows = rows.filter((r) => r.page === pageIdx && !r.skip);
      const target = pageRows.find((r) => r.rowIndex === det.first_row && (r.original.aircraft_type || '').toUpperCase() === aw)
        ?? pageRows.find((r) => (r.original.aircraft_type || '').toUpperCase() === aw);
      if (!target) continue;
      const similar = [...known].filter((k) => k !== det.resolved.toUpperCase() && (k.startsWith(aw.slice(0, 2)) || aw.includes(k))).slice(0, 3);
      const count = rows.filter((r) => (r.original.aircraft_type || '').toUpperCase() === aw).length;
      out.push({
        id: `ac:${pageIdx}:${aw}`, kind: 'aircraft', page: pageIdx, rowKey: target.key, field: 'aircraft_type',
        title: 'New aircraft type',
        reason: `Written as "${det.as_written}"${count > 1 ? ` on ${count} rows` : ''}. Claude thinks it's ${det.resolved}. Your answer applies to every row with the same entry.`,
        confidence: det.confidence || undefined,
        suggestions: [det.resolved, ...similar].filter(Boolean).map((t) => ({ label: t, field: 'aircraft_type', value: t })),
        rect: p.grid ? cellRect(p.grid, target.rowIndex, 'aircraft_type') ?? rowRect(p.grid, target.rowIndex) : null,
        aircraft: { asWritten: aw, resolved: det.resolved },
      });
    }
  });

  // Kolumner vars radsumma inte stämmer med sidans "Total this page" → hela kolumnen ringas in.
  pages.forEach((p, pageIdx) => {
    if (p.status !== 'done' || !p.grid) return;
    for (const c of columnTotals(rows, pageIdx, p.totals?.by_field)) {
      if (c.ok) continue;
      const col = columnFor(p.grid, c.field);
      const first = rows.find((r) => r.page === pageIdx && !r.skip);
      if (!first) continue;
      const count = c.field.startsWith('landings');
      const fmt = (n: number) => (count ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
      out.push({
        id: `col:${pageIdx}:${c.field}`, kind: 'column', page: pageIdx, rowKey: first.key, field: c.field,
        title: `${label(c.field)} doesn't add up`,
        reason: `The rows add up to ${fmt(c.sum)}, but the page total says ${fmt(c.printed)}. One of the values in the column is probably misread — tap it to change it.`,
        suggestions: [],
        rect: col ? { x: col.left, y: p.grid.tableTop, w: col.right - col.left, h: p.grid.tableBottom - p.grid.tableTop } : null,
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

  // Samma fråga på många rader (t.ex. "1.2+0.2" i varje rad) → en fråga för alla. Nyckeln är fält +
  // förklaring utan siffror. Användaren kan välja att gå igenom dem en i taget (expanded).
  const buckets = new Map<string, Issue[]>();
  for (const i of out) {
    if ((i.kind !== 'value' && i.kind !== 'choice') || !i.reason) continue;
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

  return out.filter((i) => !grouped.has(i.id) && !hidden.has(i.id)).sort((a, b) => Number(b.kind === 'addition') - Number(a.kind === 'addition')
    || a.page - b.page
    || (rowOf.get(a.rowKey)?.rowIndex ?? 0) - (rowOf.get(b.rowKey)?.rowIndex ?? 0)
    || (a.rect?.x ?? 0) - (b.rect?.x ?? 0));
}

const contains = (r: Rect, x: number, y: number, pad = 0) =>
  x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

type Selection = { kind: 'issue'; id: string } | { kind: 'cell'; rowKey: string; field: string } | null;

// Letar upp boken i fotot med Apple Vision och beskär till den. Bilden prövas också vriden 90° och 270°,
// och den vridning där Vision läser mest text vinner (en bok på tvären blir rättvänd). Returnerar
// orden i den slutliga bildens koordinater, eller null om Vision inte finns i bygget.
async function findLogbook(page: PageState): Promise<{ base64: string; width: number; height: number; words: VisionBox[] } | null> {
  if (!visionAvailable()) return null;
  const tmp = `${FileSystem.cacheDirectory}scan_find_${Date.now()}.jpg`;
  type Cand = { deg: number; uri: string; width: number; height: number; base64: string; words: VisionBox[] };
  try {
    await FileSystem.writeAsStringAsync(tmp, page.base64, { encoding: FileSystem.EncodingType.Base64 });
    const cands: Cand[] = [];
    const tryRotation = async (deg: number) => {
      if (deg === 0) {
        cands.push({ deg, uri: tmp, width: page.width, height: page.height, base64: page.base64, words: await recognize(page.base64).catch(() => []) });
        return;
      }
      const r = await ImageManipulator.manipulateAsync(tmp, [{ rotate: deg }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (r.base64) cands.push({ deg, uri: r.uri, width: r.width, height: r.height, base64: r.base64, words: await recognize(r.base64).catch(() => []) });
    };
    await tryRotation(0);
    // Ett uppslag är liggande. Står boken på högkant (t.ex. iPhones dokumentskanner, som lämnar bilden
    // stående) prövas 90° och 270°; ligger den men ser upp och ner ut prövas 180°. Vilken som vinner avgörs av
    // orientationScore (ord på rad, rubriker ovanför summorna) — inte av textmängden, som Vision läser lika
    // bra på högkant. Blades kamera och "Frame the logbook" vet redan hur boken ligger (oriented).
    const landscape = (c: Cand) => bookAspect(c.words, c.width, c.height) >= 1;
    const score = (c: Cand) => orientationScore(c.words, c.width, c.height) + (landscape(c) ? 3 : 0) + textScore(c.words) / 1e5;
    if (!page.oriented) {
      const c0 = cands[0];
      if (!landscape(c0)) { await tryRotation(90); await tryRotation(270); }
      else if (orientationScore(c0.words, c0.width, c0.height) < 0) await tryRotation(180);
    }
    const best = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
    console.log(`[SCAN] Vridning: ${cands.map((c) => `${c.deg}°=${score(c).toFixed(1)}`).join(' ')} → ${best.deg}°`);

    let b = page.cropped ? null : logbookBounds(best.words);
    if (b && (b.w < 0.3 || b.h < 0.12)) b = null;                 // orimligt smal → behåll hela bilden
    if (!b || (b.w > 0.92 && b.h > 0.92)) return { base64: best.base64, width: best.width, height: best.height, words: best.words };
    const crop = {
      originX: Math.round(b.x * best.width), originY: Math.round(b.y * best.height),
      width: Math.round(b.w * best.width), height: Math.round(b.h * best.height),
    };
    const out = await ImageManipulator.manipulateAsync(best.uri, [{ crop }], { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    if (!out.base64) return null;
    return { base64: out.base64, width: out.width, height: out.height, words: wordsInCrop(best.words, b) };
  } catch {
    return null;
  } finally {
    FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  }
}

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
  const [saving, setSaving] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [airportHits, setAirportHits] = useState<{ icao: string; name: string }[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<'review' | 'report'>('review');
  const [editorKey, setEditorKey] = useState<string | null>(null);
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
  const focus = useRef<ScanFocus>(getScanFocus()).current;
  // Justering mot sidans summa: kolumnfrågan som justeras och de valda raderna (radnycklar).
  const [adjust, setAdjust] = useState<{ issueId: string; keys: string[] } | null>(null);
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [aircraft, setAircraft] = useState<Record<string, AircraftInput>>({});
  const [acLoading, setAcLoading] = useState<Set<string>>(new Set());
  const [acFailed, setAcFailed] = useState<Set<string>>(new Set());
  const lookedUp = useRef<Set<string>>(new Set());
  const savingRef = useRef(false);

  const pagesRef = useRef<PageState[]>([]);
  const layoutRef = useRef<LogbookLayout | null>(null);
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
    if (p) readPage(p.i, p.ctx, true);
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

  const readPage = useCallback(async (i: number, ctx: PageContext | undefined, chain: boolean) => {
    let page = pagesRef.current[i];
    if (!page) return;
    let next = ctx;
    try {
      patchPage(i, { status: 'finding', error: undefined });
      const tStart = Date.now();
      const found = await findLogbook(page);
      const tFound = Date.now();
      const words: VisionBox[] = found?.words ?? [];
      if (found && found.base64 !== page.base64) {
        patchPage(i, { base64: found.base64, uri: `data:image/jpeg;base64,${found.base64}`, width: found.width, height: found.height, mediaType: 'image/jpeg', cropped: true });
        page = pagesRef.current[i];
      }

      patchPage(i, { status: 'reading' });
      const timeAddition = additionRef.current ?? (await learnedAddition.current) ?? undefined;
      const readWith = (model: string) => ocrScanPage(page.base64, page.mediaType, fmtRef.current, ctx,
        { useBookLayout: getScanUseBookLayout(), timeAddition, focus, model });
      const result: PageRead = await readWith(OCR_MODEL);
      const tRead = Date.now();
      const unknown = await findUnknownIcaos(result.flights);
      unknown.forEach((c) => unknownIcaos.current.add(c));
      let grid = result.grid ?? (layoutRef.current ? buildPageGrid(undefined, layoutRef.current, null) : null);
      console.log(`[SCAN] Rutnät från skannern: ${result.grid ? `${result.grid.source}, ${result.grid.columns.length} kolumner, tabell ${Math.round(result.grid.tableTop * 100)}–${Math.round(result.grid.tableBottom * 100)} %` : 'INGET'}${!result.grid && grid ? ' → mallens bredder' : ''}`);

      const autoType = new Map<string, string>();
      for (const det of result.aircraftDetections) {
        if (knownRef.current.has(det.resolved.toUpperCase()) || focus === 'totals') autoType.set(det.as_written.toUpperCase(), det.resolved.toUpperCase());
      }

      const newRows: ScanRow[] = result.flights.map((f, idx) => {
        let data = flagUnknownIcaos(prepareFlight(f), unknown);
        const mapped = autoType.get((data.aircraft_type || '').toUpperCase());
        if (mapped) data = { ...data, aircraft_type: mapped };
        let rowIndex = f.row_index ?? 0;
        if (!rowIndex && grid && typeof f.row_y_pct === 'number') {
          rowIndex = Math.floor((f.row_y_pct / 100 - grid.tableTop) / ((grid.tableBottom - grid.tableTop) / grid.rowsPerPage)) + 1;
        }
        if (!rowIndex || rowIndex < 1) rowIndex = idx + 1;
        return { key: `${i}:${rowIndex}:${idx}`, page: i, rowIndex, data, original: { ...f }, skip: false };
      });

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
        // Varje rads läge mäts mot Visions ord (sidan buktar ofta, så raderna är inte jämnt fördelade).
        grid = measureRows(grid, newRows.map((r) => ({
          rowIndex: r.rowIndex,
          values: Object.fromEntries(['date', 'registration', 'aircraft_type', 'dep_place', 'arr_place', 'dep_utc', 'arr_utc', 'second_pilot',
            'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'landings_day', 'landings_night']
            .map((key) => [key, String((r.original as any)[key] ?? '')])),
        })), words);
        console.log(`[SCAN] Rader uppmätta mot Vision: vänster ${grid.rowCenters?.left?.length ?? 0}, höger ${grid.rowCenters?.right?.length ?? 0}`);
        // Talfält vars värden står i en annan kolumn än rutnätet säger (t.ex. simulatortid i en handskriven
        // "Simulator time" i stället för den tryckta "Synthetic training session") kopplas om dit.
        const relocated = relocateColumnsByValues(grid, newRows.map((r) => ({
          rowIndex: r.rowIndex,
          values: Object.fromEntries(['total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'sim', 'multi_pilot', 'single_pilot', 'nvg', 'flight_type']
            .map((key) => [key, String((r.data as any)[key] ?? '')])),
        })), words);
        grid = relocated.grid;
        if (relocated.moved.length) console.log(`[SCAN] Kolumner omkopplade efter var värdena står: ${relocated.moved.join(', ')}`);

        // Landningar: jämför med vad Vision läser i samma cell. Olika → en fråga med Visions tal som förslag.
        const checks = crossCheckCounts(grid, newRows.map((r) => ({
          rowIndex: r.rowIndex,
          read: { landings_day: r.data.landings_day, landings_night: r.data.landings_night },
        })), words);
        // Claude jämför först mot sig själv: går landningskolumnerna ihop med sidans summor ("Total this page")
        // stämmer Claudes läsning, och Visions avvikelse beror på att rutnätet ligger snett → ingen fråga.
        const sums = columnTotals(newRows, i, result.pageTotals?.by_field);
        const sumOf = (f: string) => newRows.reduce((acc, r) => acc + (Number((r.data as any)[f]) || 0), 0);
        const dayCheck = sums.find((c) => c.field === 'landings_day');
        const nightCheck = sums.find((c) => c.field === 'landings_night');
        const landingsConfirmed = dayCheck?.ok === true && (nightCheck ? nightCheck.ok : sumOf('landings_night') === 0);
        let asked = 0;
        if (!landingsConfirmed) for (const c of checks) {
          const row = newRows.find((r) => r.rowIndex === c.rowIndex);
          if (!row) continue;
          const issues = [...(row.data.field_issues ?? [])];
          const existing = issues.find((x) => x.field === c.field);
          // Står Visions tal redan i grannkolumnen (dag ↔ natt) på samma rad är det samma handskrift sedd i
          // två kolumner. Frågan blir då vilken kolumn talet står i — inget förslag som skulle räkna det två gånger.
          const sibling = c.field === 'landings_day' ? 'landings_night' : 'landings_day';
          const sibVal = Number((row.data as any)[sibling]) || 0;
          const sameAsSibling = sibVal > 0 && sibVal === Number(c.vision) && !(Number(c.read) > 0);
          const reason = sameAsSibling
            ? `Claude read ${sibVal} as ${label(sibling).toLowerCase()}, but on the page it seems to stand under ${label(c.field).toLowerCase()}. Which column is it in?`
            : `Claude read ${c.read && c.read !== '0' ? c.read : 'nothing'}, but the page seems to say ${c.vision}.`;
          if (existing) { if (!existing.suggested_value && !sameAsSibling) existing.suggested_value = c.vision; }
          else issues.push({ field: c.field, reason, confidence: 0.5, ...(sameAsSibling ? {} : { suggested_value: c.vision }) });
          row.data = { ...row.data, field_issues: issues, needs_review: true };
          asked++;
        }
        if (checks.length) console.log(`[SCAN] Landningar som skiljer sig från Vision: ${checks.length}${landingsConfirmed ? ' — summorna stämmer med Claudes läsning, ingen fråga' : `, ${asked} frågor`}`);
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
        console.log(`[SCAN] ⏱ Uppslag ${i + 1}: ${sec(Date.now() - tStart)} s totalt (hitta boken ${sec(tFound - tStart)} s · Claude ${sec(tRead - tFound)} s · efterarbete ${sec(Date.now() - tRead)} s) · ${newRows.length} rader · fokus ${focus}`);
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
    if (chain && i + 1 < pagesRef.current.length) readPage(i + 1, next, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const batch = getScanBatch();
      clearScanImage();
      if (batch.length === 0) { setFatal('There are no photos to read. Go back and scan again.'); return; }
      const sized = await Promise.all(batch.map(async (img) => {
        const uri = `data:${img.mediaType};base64,${img.base64}`;
        let { width, height } = img;
        if (!width || !height) {
          const sz = await new Promise<{ w: number; h: number }>((res) =>
            Image.getSize(uri, (w, h) => res({ w, h }), () => res({ w: 2000, h: 1300 })));
          width = sz.w; height = sz.h;
        }
        return {
          base64: img.base64, mediaType: img.mediaType, uri, width: width!, height: height!, cropped: !!img.cropped, oriented: !!img.oriented,
          status: 'waiting' as const, grid: null, pageNumbers: { left: null, right: null }, detections: [], totals: null,
        };
      }));
      pagesRef.current = sized;
      setPages(sized);
      const [types, layout] = await Promise.all([
        getAllAircraftTypes().catch(() => []),
        getScanUseBookLayout() ? getActiveBookLayout() : Promise.resolve(null),
      ]);
      knownRef.current = new Set(types.map((t: any) => String(t.aircraft_type ?? '').toUpperCase()).filter(Boolean));
      setKnown(knownRef.current);
      layoutRef.current = layout;
      readPage(0, undefined, true);
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
  useEffect(() => {
    if (readingPhase || overlay !== 'visible') return;
    setOverlay('finishing');
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(overlayOpacity, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(panelEnter, { toValue: 1, duration: 620, delay: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setOverlay('hidden'));
    }, 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingPhase]);

  const additionCandidate = useMemo(() => detectTimeAddition(rows), [rows]);
  const issues = useMemo(() => deriveIssues(rows, pages, known, expanded, { accepted: addition, candidate: additionCandidate }, focus),
    [rows, pages, known, expanded, addition, additionCandidate, focus]);
  const isDone = (i: Issue) => !!resolved[i.id] || (!!i.group && i.group.members.every((m) => resolved[m]));
  const openIssues = issues.filter((i) => !isDone(i));
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
    return [...m.entries()].map(([type, e]) => ({ type, registrations: [...e.regs], rows: e.rows }));
  }, [rows, known]);

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
    setAdjust(null);
    Keyboard.dismiss();
    setTyping(false);
    setAirportHits([]);
    setSelection(sel);
    if (!sel) { zoomTo(null); return; }
    const row = rowByKey.get(sel.kind === 'issue' ? issues.find((i) => i.id === sel.id)?.rowKey ?? '' : sel.rowKey);
    const field = sel.kind === 'issue' ? issues.find((i) => i.id === sel.id)?.field ?? '' : sel.field;
    setDraft(row && field ? inputValue(row.data, field, fmtRef.current) : '');
    const go = () => zoomTo(rectFor(sel));
    if (row && row.page !== activePage) { setActivePage(row.page); setTimeout(go, 80); } else go();
  };

  useEffect(() => {
    if (!selection) return;
    zoomTo(rectFor(selection), typing ? kbHeight : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbHeight, typing]);

  // ── Ändringar ──────────────────────────────────────────────────────────────

  const setField = (rowKey: string, field: string, value: string) => {
    touched.current = true;
    setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, data: { ...r.data, [field]: value } } : r)));
  };

  const nextOpen = (afterId?: string, justResolved?: string) => {
    const open = issues.filter((i) => !isDone(i) && i.id !== justResolved);
    if (open.length === 0) return null;
    const idx = afterId ? issues.findIndex((i) => i.id === afterId) : -1;
    return open.find((i) => issues.indexOf(i) > idx) ?? open[0];
  };

  const resolve = (id: string, how: 'ok' | 'changed') => {
    touched.current = true;
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

  // Justera flygningar mot sidans summa. Förval: rader där Claude var osäker på just det fältet.
  const startAdjust = (issue: Issue) => {
    const keys = issues.filter((i) => i.kind === 'value' && i.page === issue.page && i.field === issue.field && !isDone(i)).map((i) => i.rowKey);
    setAdjust({ issueId: issue.id, keys: [...new Set(keys)] });
  };
  const toggleAdjustRow = (key: string, field: string) => {
    const r = rowByKey.get(key);
    if (!r || (field === 'total_time' && r.data.flight_type === 'sim')) return;   // simulatorpass räknas inte i total tid
    Haptics.selectionAsync().catch(() => {});
    setAdjust((a) => (a ? { ...a, keys: a.keys.includes(key) ? a.keys.filter((k) => k !== key) : [...a.keys, key] } : a));
  };
  const applyAdjust = (issue: Issue, field: string, printed: number, values: Map<string, number>) => {
    touched.current = true;
    setRows((prev) => prev.map((r) => {
      const nv = values.get(r.key);
      if (nv == null) return r;
      const from = r.adjusted?.find((a) => a.field === field)?.from ?? String((r.data as any)[field] ?? '0');
      return {
        ...r,
        data: { ...r.data, [field]: String(nv) },
        adjusted: [...(r.adjusted ?? []).filter((a) => a.field !== field), { field, from, to: String(nv), printed }],
      };
    }));
    setAdjust(null);
    resolve(issue.id, 'changed');
  };

  const applyAircraft = (issue: Issue, type: string) => {
    const aw = issue.aircraft!.asWritten;
    touched.current = true;
    setRows((prev) => prev.map((r) => ((r.original.aircraft_type || '').toUpperCase() === aw
      ? { ...r, data: { ...r.data, aircraft_type: type.toUpperCase() } } : r)));
  };

  // Simulatorpass: tiden flyttas till simulator, total tid = simulatortid (som parsern gör), inga landningar,
  // och en fråga om simulatortyp läggs till.
  const toSimulator = (items: { rowKey: string; sg: Suggestion }[]) => {
    const by = new Map(items.map((x) => [x.rowKey, x.sg]));
    touched.current = true;
    setRows((prev) => prev.map((r) => {
      const sg = by.get(r.key);
      if (!sg) return r;
      return { ...r, data: {
        ...r.data, flight_type: 'sim', sim: sg.value, total_time: sg.value, ...(sg.toSim !== 'total_time' ? { [sg.toSim!]: '0' } : {}), landings_day: '0', landings_night: '0',
        field_issues: [...(r.data.field_issues ?? []).filter((i) => i.field !== 'sim_category'),
          { field: 'sim_category', reason: 'Which kind of simulator (FFS, FTD, FNPT…)?', confidence: 0.5 }],
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

  const applySuggestion = (issue: Issue, sg: Suggestion) => {
    const row = rowByKey.get(issue.rowKey);
    if (!row) return;
    if (issue.kind === 'aircraft') applyAircraft(issue, sg.value);
    else if (issue.kind === 'remark') {
      const rs = row.data.remarks_suggestion!;
      const cleaned = (row.data.remarks ?? '').replace(rs.original_text, '').replace(/\s{2,}/g, ' ').trim();
      touched.current = true;
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, data: { ...r.data, [rs.field]: rs.value, remarks: cleaned } } : r)));
      if (rs.field === 'second_pilot') saveLearnedMapping('second_pilot', rs.original_text, rs.value).catch(() => {});
    } else if (sg.toSim) toSimulator([{ rowKey: row.key, sg }]);
    else if (issue.kind === 'choice') setField(row.key, sg.field, chipKey(sg.value));
    else setField(row.key, sg.field, sg.value);
    resolve(issue.id, 'changed');
  };

  // "Looks right": Claudes läsning stämmer. För en ny flygplanstyp betyder det Claudes tolkning.
  const confirm = () => {
    if (!selectedIssue) { select(null); return; }
    if (selectedIssue.kind === 'aircraft') { applySuggestion(selectedIssue, { label: '', field: 'aircraft_type', value: selectedIssue.aircraft!.resolved }); return; }
    resolve(selectedIssue.id, 'ok');
  };

  const save = () => {
    if (!selectedRow || !selField) return;
    const value = parseInput(selField, draft, fmtRef.current);
    if (value == null) {
      Alert.alert('Check the value', selField === 'date' ? 'Write the date as YYYY-MM-DD.'
        : CLOCK.has(selField) ? 'Write the time as HH:MM.' : `That doesn't look like a valid ${label(selField).toLowerCase()}.`);
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
      setDuplicates(await findDuplicateKeys(rows).catch(() => new Set<string>()));
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
      const toSave = rows.map((r) => (duplicates.has(r.key) ? { ...r, skip: true } : r));
      await saveLearnedCorrections(toSave);
      const sum = await saveScanRows(toSave, { unknownIcaos: unknownIcaos.current, pageNumbers: pages.map((p) => p.pageNumbers), timeBasis });
      await Promise.all([loadFlights(), loadStats()]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const dups = duplicates.size + sum.duplicates;
      const parts = [`${sum.saved} ${sum.saved === 1 ? 'flight' : 'flights'} saved.`];
      if (sum.skipped - duplicates.size > 0) parts.push(`${sum.skipped - duplicates.size} left out.`);
      if (dups) parts.push(`${dups} already in your logbook.`);
      if (sum.adjusted) parts.push(`${sum.adjusted} adjusted to match the page totals — marked in your logbook so you can check them against the paper book.`);
      if (newTypes.length) parts.push(`${newTypes.length} new aircraft added to your fleet.`);
      if (sum.bookName) parts.push(`Linked to ${sum.bookName}, pages ${sum.pageLabel}.`);
      Alert.alert('Saved', parts.join(' '), [{ text: 'OK', onPress: () => router.dismissAll() }]);
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
      : i.rowKey === rowKey && (i.field === field || (i.kind === 'mismatch' && (field === 'dep_utc' || field === 'arr_utc')))));
    if (open) return 'open';
    const now = String((r.data as any)[field] ?? ''), was = String((r.original as any)[field] ?? '');
    if (DURATION.has(field)) return Math.abs((parseFloat(now) || 0) - (parseFloat(was) || 0)) > 0.001 ? 'changed' : null;
    return now !== was ? 'changed' : null;
  };

  const close = () => {
    if (!touched.current) { router.back(); return; }
    Alert.alert('Discard this scan?', 'Your corrections will be lost.', [
      { text: 'Keep checking', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
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
  // Justering: sidans summa är facit och ändras aldrig. Skillnaden fördelas på de rader användaren valt (hela
  // tiondelar, eller hela landningar), och raderna markeras med var i boken avvikelsen finns.
  const adjusting = !!(adjust && selectedIssue?.kind === 'column' && adjust.issueId === selectedIssue.id && readField && readCheck);
  const adjDiff = readCheck ? Math.round((readCheck.printed - readCheck.sum) * 100) / 100 : 0;
  const adjNew = new Map<string, number>();
  if (adjusting && readField) {
    const deltas = distributeDifference(adjust!.keys.length, adjDiff, COUNT.has(readField) ? 1 : 0.1);
    adjust!.keys.forEach((key, i) => {
      const cur = parseFloat(String((rowByKey.get(key)?.data as any)?.[readField] ?? '0')) || 0;
      adjNew.set(key, Math.round((cur + deltas[i]) * 100) / 100);
    });
  }
  const adjValid = adjusting && adjNew.size > 0 && [...adjNew.values()].every((v) => v >= 0);
  const isCount = !!readField && COUNT.has(readField);
  const fmtDiff = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${isCount ? Math.abs(Math.round(n)) : Math.abs(n).toFixed(1)}${isCount ? '' : ' h'}`;
  const position = selectedIssue && !isDone(selectedIssue) ? openIssues.findIndex((i) => i.id === selectedIssue.id) + 1 : 0;

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
            <Text style={s.compactLabel} numberOfLines={1}>{label(selField)} · row {selectedRow.rowIndex}</Text>
            <View style={s.compactRow}>
            <ValueInput inputRef={inputRef} field={selField} value={draft} onChange={onDraft} onSubmit={save} timeFormat={timeFormat}
              onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} autoFocus />
            <TouchableOpacity onPress={() => { setDraft(inputValue(selectedRow.data, selField, timeFormat)); Keyboard.dismiss(); }} hitSlop={8}>
              <Text style={s.compactCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.saveBtn} onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
            </View>
          </Glass>
        </View>
  ) : null;

  const allFailed = pages.length > 0 && pages.every((pg) => pg.status === 'error');
  const curIdx = Math.max(0, pages.findIndex((pg) => pg.status === 'finding' || pg.status === 'reading' || pg.status === 'waiting'));
  const scanPhase: ScanPhase = overlay === 'finishing' ? 'done' : allFailed ? 'error'
    : pages[curIdx]?.status === 'reading' ? 'reading' : 'finding';
  const progressLayer = overlay !== 'hidden' ? (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]} pointerEvents={overlay === 'finishing' ? 'none' : 'auto'}>
      <ScanProgress
        phase={scanPhase}
        spread={curIdx + 1}
        spreads={pages.length || 1}
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

  if (stage === 'report') {
    return (
      <View style={s.root}>
        <ScanReport
          rows={rows}
          columnChecks={pages.flatMap((pg, idx) => columnTotals(rows, idx, pg.totals?.by_field))}
          spreads={pages.length}
          pageLabels={pages.map((pg) => (pg.pageNumbers.left ? `p. ${pg.pageNumbers.left}–${pg.pageNumbers.right ?? pg.pageNumbers.left + 1}` : null))}
          timeFormat={timeFormat}
          cellState={cellState}
          duplicates={duplicates}
          openCount={openIssues.length}
          newTypes={newTypes}
          aircraft={aircraft}
          aircraftLoading={acLoading}
          aircraftFailed={acFailed}
          saving={saving}
          timeBasis={timeBasis}
          onTimeBasis={chooseTimeBasis}
          insets={insets}
          onAircraftChange={(type, v) => setAircraft((a) => ({ ...a, [type]: v }))}
          onOpenFlight={(rowKey) => setEditorKey(rowKey)}
          onToggleSkip={(rowKey) => { touched.current = true; setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, skip: !r.skip } : r))); }}
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
            onToggleSkip={() => { touched.current = true; setRows((prev) => prev.map((r) => (r.key === editorKey ? { ...r, skip: !r.skip } : r))); }}
            onClose={() => setEditorKey(null)}
          />
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

            {readField && page.grid && (() => {
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
                  {pageRows.map((r) => {
                    const nv = adjNew.get(r.key);
                    const text = nv != null
                      ? `${bookCell(r.data, readField, timeFormat) || '0'}→${display({ ...r.data, [readField]: String(nv) } as OcrFlightResult, readField, timeFormat) || '0'}`
                      : bookCell(r.data, readField, timeFormat) || '–';
                    return pill(`rp-${r.key}`, rowBand(grid, r.rowIndex, cx), text,
                      nv != null || r.key === selKey ? s.readPillOn : null,
                      adjusting ? () => toggleAdjustRow(r.key, readField) : () => select({ kind: 'cell', rowKey: r.key, field: readField }), nv != null);
                  })}
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
      {!typing && pages.length > 1 && (
        <View style={[s.pillRow, { top: insets.top + 54, left: insets.left + 12, right: insets.right + 12 }]}>
            <View style={s.pagePills}>
              {pages.map((p, i) => {
                const open = issues.filter((x) => x.page === i && !isDone(x)).length;
                return (
                  <TouchableOpacity key={i} onPress={() => { setActivePage(i); select(null); }}
                    style={[s.pagePill, i === activePage && s.pagePillActive]} accessibilityLabel={`Spread ${i + 1}`}>
                    <Text style={[s.pagePillText, i === activePage && s.pagePillTextActive]}>{i + 1}</Text>
                    {(p.status === 'reading' || p.status === 'finding' || p.status === 'waiting') && <ActivityIndicator size="small" color={Colors.textSecondary} style={{ transform: [{ scale: 0.6 }] }} />}
                    {p.status === 'error' && <Ionicons name="alert-circle" size={13} color={Colors.danger} />}
                    {p.status === 'done' && open > 0 && <View style={s.pillBadge}><Text style={s.pillBadgeText}>{open}</Text></View>}
                  </TouchableOpacity>
                );
              })}
            </View>
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
                const m = id.split(':f:');
                const r = rowByKey.get(m[0]);
                return { id, row: r?.rowIndex ?? 0, value: r ? display(r.data, selectedIssue.field, timeFormat) : '', done: !!resolved[id] };
              }) : undefined}
              onExpand={(startAt) => selectedIssue && expandGroup(selectedIssue, startAt)}
              onGroupSim={() => selectedIssue && applyGroupSim(selectedIssue)}
              onGroupChoice={(v) => selectedIssue && applyGroupChoice(selectedIssue, v)}
              onAcceptAddition={() => selectedIssue && acceptAddition(selectedIssue)}
              movable={movableValue(selectedIssue, selectedRow)}
              adjust={selectedIssue?.kind === 'column' && readCheck && readField ? {
                active: adjusting, count: adjust?.keys.length ?? 0, diff: fmtDiff(adjDiff),
                printed: isCount ? String(Math.round(readCheck.printed)) : String(readCheck.printed),
                valid: adjValid,
                onStart: () => startAdjust(selectedIssue),
                onApply: () => { if (adjValid) applyAdjust(selectedIssue, readField, readCheck.printed, adjNew); },
                onCancel: () => setAdjust(null),
              } : undefined}
              onMove={(to) => selectedIssue && moveToColumn(selectedIssue, to)}
              position={position}
              openCount={openIssues.length}
              draft={draft}
              timeFormat={timeFormat}
              onEdit={() => setTyping(true)}
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
    </View>
  );
}

// ── Frågepanelen under boken ─────────────────────────────────────────────────

function QuestionPanel(p: {
  issue: Issue | null; field: string; row: ScanRow; done?: 'ok' | 'changed'; position: number; openCount: number;
  groupValues?: { id: string; row: number; value: string; done: boolean }[]; onExpand: (startAt?: string) => void; onGroupSim: () => void;
  onAcceptAddition: () => void;
  onGroupChoice: (value: string) => void;
  movable: string; onMove: (to: string) => void;
  adjust?: { active: boolean; count: number; diff: string; printed: string; valid: boolean; onStart: () => void; onApply: () => void; onCancel: () => void };
  draft: string; timeFormat: TimeFormat;
  onEdit: () => void; onSave: () => void; onConfirm: () => void;
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
    : issue.kind === 'value'
      ? `Claude read ${current ? `"${current}"` : 'nothing'}${issue.confidence ? ` but is only ${Math.round(issue.confidence * 100)} % sure` : ''}. ${issue.reason}`
      : issue.reason;

  return (
    <View style={s.q}>
      <View style={s.qLeft}>
        <View style={s.qHead}>
          <Text style={s.eyebrow}>
            {p.position ? `PROBLEM ${p.position} OF ${p.openCount}` : done ? 'CHECKED' : 'EDIT'} · {issue?.kind === 'column' ? 'WHOLE COLUMN'
              : issue?.kind === 'addition' ? `${issue.group?.members.length ?? 0} ROWS` : `ROW ${row.rowIndex}`}
          </Text>
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
          issue.suggestions.map((sg) => (
            <TouchableOpacity key={sg.field} style={s.option} onPress={() => p.onSuggestion(sg)}>
              <Text style={s.optionText} numberOfLines={2}>{sg.label}</Text>
              <Text style={s.optionSub} numberOfLines={2}>{label(sg.field)} becomes {sg.value}</Text>
            </TouchableOpacity>
          ))
        ) : issue?.kind === 'remark' ? (
          <>
            <TouchableOpacity style={s.btnPrimary} onPress={() => p.onSuggestion(issue.suggestions[0])}><Text style={s.btnPrimaryText}>Yes, move it</Text></TouchableOpacity>
            <TouchableOpacity style={s.btnSecondary} onPress={p.onConfirm}><Text style={s.btnSecondaryText}>No, keep it</Text></TouchableOpacity>
          </>
        ) : issue?.kind === 'column' && p.adjust?.active ? (
          <>
            <Text style={s.qHint}>
              Tap the flight{p.adjust.count === 1 ? '' : 's'} that {p.adjust.count === 1 ? 'is' : 'are'} wrong. The difference ({p.adjust.diff}) is split between them, and they're marked so you can check them in your paper logbook.
            </Text>
            <View style={s.answerRow}>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }, !p.adjust.valid && { opacity: 0.4 }]} disabled={!p.adjust.valid} onPress={p.adjust.onApply}>
                <Text style={s.btnPrimaryText}>{p.adjust.count ? `Adjust ${p.adjust.count} flight${p.adjust.count === 1 ? '' : 's'}` : 'Choose flights'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnSecondary} onPress={p.adjust.onCancel}><Text style={s.btnSecondaryText}>Cancel</Text></TouchableOpacity>
            </View>
          </>
        ) : issue?.kind === 'column' ? (
          <>
            {!done && p.adjust && (
              <TouchableOpacity style={s.btnPrimary} onPress={p.adjust.onStart}>
                <Text style={s.btnPrimaryText}>Adjust flights to match {p.adjust.printed}</Text>
              </TouchableOpacity>
            )}
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
              {issue && !done && (
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
  return (
    <View style={s.q}>
      <View style={s.qLeft}>
        <Text style={s.qTitle}>
          {p.flights === 1 ? 'Claude read 1 flight' : `Claude read ${p.flights} flights`}
          {p.open > 0 ? `, ${p.open} ${p.open === 1 ? 'thing needs' : 'things need'} a look` : '. Everything is checked'}
        </Text>
        <Text style={s.qText}>
          {p.open > 0 ? 'The yellow marks show where Claude is unsure. You go through them one at a time.' : 'Tap any value on the page if you want to change it.'}
          {p.busy ? ' The next spread is still being read.' : ''}
        </Text>
      </View>
      <View style={s.overviewBtns}>
        {p.open > 0 ? (
          <TouchableOpacity style={s.btnWarn} onPress={p.onStart}>
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
  skipLink: { color: Colors.dangerLight, fontSize: 13, fontWeight: '600' },

  answerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueBox: {
    flex: 1, height: 48, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  valueText: { flex: 1, color: '#fff', fontSize: 22, fontFamily: MONO, fontWeight: '600' },
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
