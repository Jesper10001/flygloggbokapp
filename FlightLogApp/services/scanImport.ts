// Efterbehandling och sparande av skannade loggboksrader. Flyttat ur app/flight/review.tsx så att
// granskningsvyn (app/flight/scan-review.tsx) kan använda samma regler: aritmetik i tidsfält, "other
// time"-roll, simulatortyp, tidskonflikter, okända ICAO-koder, dubblettkoll, tillfälliga platser,
// flygplansregistret, koppling till pappersboken och inlärda rättelser.

import type { OcrFlightResult, IcaoAirport } from '../types/flight';
import { localToUtcHHMM, localOffsetMinutes } from '../utils/timezone';
import { getDatabase } from '../db/database';
import { insertFlight, addToAircraftRegistry } from '../db/flights';
import { getActiveBook } from '../db/logbookBooks';
import { getAirportByIcao, addTemporaryPlace, isOffAirportCode } from '../db/icao';
import { saveLearnedMapping } from '../db/ocrLearned';
import { reconcileBlockTime } from '../utils/flightTime';

export interface ScanRow {
  key: string;            // stabilt id: `${page}:${rowIndex}`
  page: number;           // vilket uppslag (0-baserat)
  rowIndex: number;       // tryckt radposition på uppslaget, 1 = översta
  data: OcrFlightResult;
  original: OcrFlightResult;
  skip: boolean;
  // Värden som användaren justerat så att kolumnen går ihop med sidans "Total this page" (boken är facit för
  // totalerna). Flygningen markeras när den sparas, med var i boken avvikelsen finns.
  adjusted?: { field: string; from: string; to: string; printed: number }[];
}

/**
 * Fördelar en skillnad (sidans summa − radernas) på valda rader i hela steg (0,1 h för tid, 1 för antal):
 * så jämnt som möjligt, och resten på de första raderna. Summan av delarna är exakt skillnaden.
 */
export function distributeDifference(count: number, diff: number, step: number): number[] {
  if (count <= 0) return [];
  const units = Math.round(diff / step);
  const base = Math.trunc(units / count);
  const rest = units - base * count;
  return Array.from({ length: count }, (_, i) => Math.round((base + (i < Math.abs(rest) ? Math.sign(rest) : 0)) * step * 100) / 100);
}

type Issue = NonNullable<OcrFlightResult['field_issues']>[number];

const TIME_FIELDS = [
  'total_time', 'pic', 'co_pilot', 'dual', 'ifr', 'night',
  'instructor', 'picus', 'spic', 'nvg', 'multi_pilot', 'single_pilot',
] as const;

const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Klientens egna kontroller ovanpå skannerns: returnerar en bearbetad kopia av raden. */
export function prepareFlight(f: OcrFlightResult): OcrFlightResult {
  const data: OcrFlightResult = { ...f, field_issues: [...(f.field_issues ?? [])] };
  const issues = data.field_issues as Issue[];
  const flag = (reason: string) => { data.needs_review = true; data.review_reason = data.review_reason || reason; };

  // "1.2+0.4" i ett tidsfält → summan, men användaren bekräftar.
  const addPattern = /^\s*(\d+[\.,]\d+)\s*\+\s*(\d+[\.,]\d+)\s*$/;
  for (const field of TIME_FIELDS) {
    const raw = String((data as any)[field] ?? '');
    const m = raw.match(addPattern);
    if (!m) continue;
    const sum = Math.round((parseFloat(m[1].replace(',', '.')) + parseFloat(m[2].replace(',', '.'))) * 10) / 10;
    if (!Number.isFinite(sum)) continue;
    (data as any)[field] = String(sum);
    issues.push({ field, reason: `Written as "${raw}". Blades added it up to ${sum}. Is that right?`, confidence: 0.6, suggested_value: String(sum) });
    flag('Arithmetic in a time field');
  }

  // "Other type of flight time" → användaren anger vilken roll tiden avser.
  if ((parseFloat(String((data as any).other_time ?? '0')) || 0) > 0 && !issues.some((i) => i.field === 'other_time_role')) {
    issues.push({ field: 'other_time_role', reason: 'Which kind of time is this?', confidence: 0.5 });
    flag('"Other flight time" needs a type');
  }

  // "Other type of flight time"-kolumner vars rubrik betyder simulator ("Simulator time", "Sim", "FSTD" …) →
  // simulatortid. Claude lägger ibland sådana värden i other_times med rubriken i stället för i sim.
  if (data.other_times && data.other_time_labels) {
    const SIM_LABEL = /sim|fstd|ffs|fnpt|synthetic|trainer/i;
    const others = { ...data.other_times };
    for (const [key, val] of Object.entries(others)) {
      if (!(val > 0) || !SIM_LABEL.test(data.other_time_labels[key] ?? '')) continue;
      data.sim = String(val);
      data.flight_type = 'sim';
      if (!((parseFloat(data.total_time) || 0) > 0)) {
        data.total_time = String(val);   // simulatorpass: total = simulatortid (som parsern gör)
        data.landings_day = '0';
        data.landings_night = '0';
      }
      delete others[key];
      // Claudes fråga om just den kolumnen behövs inte längre.
      for (let i = issues.length - 1; i >= 0; i--) if (issues[i].field === key || issues[i].field === 'other_flight_time') issues.splice(i, 1);
    }
    data.other_times = others;
  }

  // Simulator utan typ → välj typ. Sim-tid loggas inte som vanlig flygtid.
  const stdVal = parseFloat(String((data as any).std ?? '0')) || 0;
  if ((data.flight_type === 'sim' || stdVal > 0) && !data.sim_category) {
    data.flight_type = 'sim';
    if (stdVal > 0 && (parseFloat(data.total_time) || 0) === 0) data.total_time = String(stdVal);
    if (!issues.some((i) => i.field === 'sim_category')) {
      issues.push({ field: 'sim_category', reason: 'Which kind of simulator (FFS, FTD, FNPT…)?', confidence: 0.5 });
    }
    flag('Simulator type missing');
  }

  // Samma avgångs- och landningstid men tid i luften → en av dem är fel.
  const totalH = parseFloat(data.total_time) || 0;
  if (data.dep_utc && data.arr_utc && data.dep_utc === data.arr_utc && totalH > 0 && !data.time_mismatch) {
    const [dh, dm] = data.dep_utc.split(':').map(Number);
    if (!isNaN(dh) && !isNaN(dm)) {
      const dep = dh * 60 + dm, tot = Math.round(totalH * 60);
      data.time_mismatch = {
        anchor_total_h: totalH,
        read_dep: data.dep_utc,
        read_arr: data.arr_utc,
        computed_arr_if_dep_correct: hhmm(dep + tot),
        computed_dep_if_arr_correct: hhmm(dep - tot),
      };
      flag('Departure and arrival have the same time');
    }
  }

  // Funktionstid kan aldrig vara längre än total flygtid. Saknas total tid men finns funktionstid är det
  // troligen ett simulatorpass som hamnat i fel kolumn (t.ex. "Simulator time" läst som Dual).
  if (data.flight_type !== 'sim') {
    const FN: Record<string, string> = { pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual', instructor: 'Instructor' };
    const total = parseFloat(data.total_time) || 0;
    for (const [field, name] of Object.entries(FN)) {
      const v = parseFloat(String((data as any)[field] ?? '0')) || 0;
      if (v <= 0) continue;
      if (total > 0 && v > total + 0.05 && !issues.some((i) => i.field === field)) {
        issues.push({ field, reason: `${name} (${v}) is longer than the total flight time (${total}). One of them is misread.`, confidence: 0.4 });
        flag(`${name} longer than total time`);
      } else if (total === 0 && !issues.some((i) => i.field === 'sim')) {
        issues.push({ field: 'sim', reason: `No total flight time, but ${name} ${v}. If this was a simulator session, the time belongs under simulator.`, confidence: 0.4, suggested_value: String(v), from: field });
        flag('Function time without total time');
      }
    }
    // Total tid men ingen funktionstid alls: varje flygning har PIC, Co-pilot, Dual eller Instructor, så
    // det är troligen simulatortid som lästs in i "Total time of flight".
    const anyFunction = Object.keys(FN).some((f) => (parseFloat(String((data as any)[f] ?? '0')) || 0) > 0);
    const askedSim = issues.some((i) => i.field === 'sim' || (i.field === 'total_time' && /sim|fstd|synthetic/i.test(i.reason)));
    if (total > 0 && !anyFunction && !askedSim) {
      issues.push({ field: 'sim', reason: `${total} h with no pilot function time (PIC, Co-pilot, Dual). If this was a simulator session, the time belongs under simulator.`, confidence: 0.4, suggested_value: String(total), from: 'total_time' });
      flag('Total time without function time');
    }
  }

  // VFR-tid och flygregler härleds ur total och IFR (som tidigare).
  const ifrH = parseFloat(data.ifr) || 0;
  if (totalH > 0 && (!data.vfr || parseFloat(data.vfr) === 0)) {
    data.vfr = String(Math.round(Math.max(0, totalH - ifrH) * 10) / 10);
  }
  if (!data.flight_rules || data.flight_rules === 'VFR') {
    data.flight_rules = ifrH > 0 ? (ifrH >= totalH ? 'IFR' : 'Y') : 'VFR';
  }
  return data;
}

/** ICAO-koder (exakt 4 bokstäver) som inte finns i flygplatsdatabasen. */
export async function findUnknownIcaos(flights: OcrFlightResult[]): Promise<Set<string>> {
  const unknown = new Set<string>();
  const checked = new Set<string>();
  for (const f of flights) {
    for (const code of [f.dep_place, f.arr_place].map((c) => (c ?? '').toUpperCase())) {
      if (!/^[A-Z]{4}$/.test(code) || checked.has(code) || isOffAirportCode(code)) continue;
      checked.add(code);
      if (!(await getAirportByIcao(code))) unknown.add(code);
    }
  }
  return unknown;
}

/** Lägger till granskningspunkter för okända ICAO-koder. */
export function flagUnknownIcaos(f: OcrFlightResult, unknown: Set<string>): OcrFlightResult {
  const issues = [...(f.field_issues ?? [])];
  let changed = false;
  for (const field of ['dep_place', 'arr_place'] as const) {
    const code = (f[field] ?? '').toUpperCase();
    if (code && unknown.has(code) && !issues.some((i) => i.field === field)) {
      issues.push({ field, reason: `${code} isn't a known airport. Correct it, or keep it as an off-airport place.`, confidence: 0.3 });
      changed = true;
    }
  }
  return changed ? { ...f, field_issues: issues, needs_review: true, review_reason: f.review_reason || 'Unknown airport code' } : f;
}

// "Other time"-kolumner med rubrik (NVG, Examiner …) → rätt fält.
function mapOtherTimes(d: OcrFlightResult) {
  if (!d.other_times || !d.other_time_labels) return;
  for (const [key, val] of Object.entries(d.other_times)) {
    if (!val || val <= 0) continue;
    const label = (d.other_time_labels[key] ?? '').toUpperCase();
    if (label.includes('NVG') || label.includes('NVD') || label.includes('NVIS')) d.nvg = String(val);
    else if (label.includes('EXAM')) d.examiner = String(val);
    else if (label.includes('SAFETY') || label.includes('SÄKERHET')) d.safety_pilot = String(val);
    else if (label.includes('PICUS') || label.includes('P/US')) d.picus = String(val);
    else if (label.includes('SPIC') || label.includes('S/PIC')) d.spic = String(val);
    else if (label.includes('INSTRUCTOR') || label.includes('INSTR')) d.instructor = String(val);
  }
}

// Multi-pilot härleds om det saknas (som tidigare).
function deriveMultiPilot(d: OcrFlightResult) {
  if (d.multi_pilot && parseFloat(d.multi_pilot) !== 0) return;
  const total = parseFloat(d.total_time) || 0;
  const hasSecondPilot = !!(d.second_pilot || d.remarks_suggestion?.field === 'second_pilot');
  if ((parseFloat(d.dual ?? '0') || 0) > 0) d.multi_pilot = '0';
  else if ((parseFloat(d.co_pilot ?? '0') || 0) > 0) d.multi_pilot = String(total);
  else if ((parseFloat(d.pic ?? '0') || 0) > 0 && hasSecondPilot) d.multi_pilot = String(total);
  else if ((parseFloat(d.instructor ?? '0') || 0) > 0) d.multi_pilot = String(total);
}

/** Nycklar för rader som redan finns i loggboken (samma datum, rutt och totaltid). */
export async function findDuplicateKeys(rows: ScanRow[]): Promise<Set<string>> {
  const db = await getDatabase();
  const out = new Set<string>();
  for (const r of rows) {
    const dup = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM flights WHERE date=? AND dep_place=? AND arr_place=? AND ABS(total_time - ?) < 0.05 LIMIT 1`,
      [r.data.date, r.data.dep_place, r.data.arr_place, parseFloat(r.data.total_time) || 0],
    );
    if (dup) out.add(r.key);
  }
  return out;
}

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Tider skrivna i lokal tid → UTC, per flygplats (sommartid via land/region, annars longitud). Datumet följer
 * avgången: lokal 00:30 i UTC+2 blir 22:30 UTC dagen innan. Okända platser (t.ex. ZZZZ) lämnas orörda.
 */
export async function localTimesToUtc(d: OcrFlightResult): Promise<void> {
  const airport = async (code?: string): Promise<IcaoAirport | null> =>
    code && /^[A-Z]{4}$/.test(code.toUpperCase()) ? getAirportByIcao(code).catch(() => null) : null;
  const [dep, arr] = await Promise.all([airport(d.dep_place), airport(d.arr_place)]);
  const toUtc = (a: IcaoAirport | null, t?: string) =>
    a && t && /^\d{2}:\d{2}$/.test(t) ? localToUtcHHMM(d.date, t, a.country, a.region, a.lon) : null;
  const depUtc = toUtc(dep, d.dep_utc);
  const arrUtc = toUtc(arr ?? dep, d.arr_utc);
  if (depUtc && dep) {
    const off = localOffsetMinutes(new Date(`${d.date}T${d.dep_utc}:00Z`), dep.country, dep.region, dep.lon);
    if (off != null) {
      const [h, m] = d.dep_utc.split(':').map(Number);
      const raw = h * 60 + m - off;
      if (raw < 0) d.date = shiftDate(d.date, -1);
      else if (raw >= 1440) d.date = shiftDate(d.date, 1);
    }
    d.dep_utc = depUtc;
  }
  if (arrUtc) d.arr_utc = arrUtc;
}

export interface ColumnCheck { page: number; field: string; sum: number; printed: number; ok: boolean }

const COUNT_FIELDS = new Set(['landings_day', 'landings_night', 'tng_count']);

/**
 * Jämför radernas summa per kolumn med sidans tryckta "Total this page" (per fält). Simulatorpass räknas
 * inte in i total flygtid (de står i simulatorkolumnen). Skippade rader räknas inte.
 */
export function columnTotals(rows: ScanRow[], page: number, printed: Record<string, number> | undefined): ColumnCheck[] {
  if (!printed) return [];
  // Sidans summa gäller allt som står på sidan — även rader som redan finns i loggboken eller lämnas utanför.
  const pageRows = rows.filter((r) => r.page === page);
  if (pageRows.length === 0) return [];
  const out: ColumnCheck[] = [];
  for (const [field, value] of Object.entries(printed)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const sum = pageRows.reduce((s, r) => {
      if (field === 'total_time' && r.data.flight_type === 'sim') return s;
      return s + (parseFloat(String((r.data as any)[field] ?? '0')) || 0);
    }, 0);
    // Kolumner som ingen rad har något värde i och där sidan säger 0 är ointressanta.
    if (sum === 0 && value === 0) continue;
    const tol = COUNT_FIELDS.has(field) ? 0.5 : 0.05;
    out.push({ page, field, sum: Math.round(sum * 100) / 100, printed: value, ok: Math.abs(sum - value) < tol });
  }
  return out;
}

// ── Fast tillägg på flygtiden ────────────────────────────────────────────────
// Helikopter: flygtid räknas från rotorstart till rotorstopp (EASA FCL.010). Står lyft och landning som
// avgång och ankomst i boken lägger många till en fast tid (ofta 0.2 h) för uppstart, taxi och avstängning.
// Har de flesta rader samma tillägg är det bokens regel och inte läsfel. Regeln sparas när användaren
// bekräftat den (setting `scan_time_addition`).

const clockMin = (s?: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Total tid minus (ankomst − avgång) i timmar, eller null om raden saknar tider. */
function timeAddition(data: OcrFlightResult): number | null {
  if (data.flight_type === 'sim') return null;
  const total = parseFloat(String(data.total_time ?? '').replace(',', '.')) || 0;
  const dep = clockMin(data.dep_utc), arr = clockMin(data.arr_utc);
  if (!(total > 0) || dep == null || arr == null) return null;
  const block = (arr - dep + 1440) % 1440;
  return block > 0 ? total - block / 60 : null;
}

/** Stämmer raden när tillägget räknas bort? (Samma gräns som tids-avstämningen: 6 min.) */
export function fitsTimeAddition(data: OcrFlightResult, add: number): boolean {
  const total = parseFloat(String(data.total_time ?? '').replace(',', '.')) || 0;
  if (!(total - add > 0)) return false;
  const rec = reconcileBlockTime(data.dep_utc, data.arr_utc, total - add);
  return !!rec && !rec.mismatch;
}

/** Samma tillägg (0.1–0.5 h) på minst tre rader och på minst hälften av raderna med tider. */
export function detectTimeAddition(rows: ScanRow[]): { hours: number; rows: number } | null {
  const counts = new Map<number, number>();
  let timed = 0;
  for (const r of rows) {
    const x = timeAddition(r.data);
    if (x == null) continue;
    timed++;
    const k = Math.round(x * 10) / 10;
    if (k < 0.1 || k > 0.5 || Math.abs(x - k) > 0.06) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: { hours: number; rows: number } | null = null;
  for (const [k, n] of counts) if (!best || n > best.rows) best = { hours: k, rows: n };
  return best && best.rows >= 3 && best.rows >= timed * 0.5 ? best : null;
}

export interface SaveSummary {
  saved: number;
  adjusted: number;       // sparade flygningar som justerats mot sidans summa (markerade)
  skipped: number;
  duplicates: number;
  bookName: string | null;
  pageLabel: string;
}

/** Sparar alla rader som inte hoppats över. Samma regler som den gamla granskningen. */
// Början på orsaken i ändringsloggen för en justering mot sidans summa (flygningens sida känner igen den).
export const SCAN_ADJUST_REASON = 'Adjusted during the logbook scan so the column matches the page total';

export async function saveScanRows(
  rows: ScanRow[],
  opts: { unknownIcaos: Set<string>; pageNumbers: { left: number | null; right: number | null }[]; timeBasis?: 'utc' | 'local' },
): Promise<SaveSummary> {
  let saved = 0, skipped = 0, duplicates = 0, adjusted = 0;
  const savedIds: number[] = [];
  const db = await getDatabase();

  for (const row of rows) {
    if (row.skip) { skipped++; continue; }
    const d: OcrFlightResult = { ...row.data };
    if (opts.timeBasis === 'local') await localTimesToUtc(d);
    const dup = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM flights WHERE date=? AND dep_place=? AND arr_place=? AND ABS(total_time - ?) < 0.05 LIMIT 1`,
      [d.date, d.dep_place, d.arr_place, parseFloat(d.total_time) || 0],
    );
    if (dup) { duplicates++; continue; }
    mapOtherTimes(d);
    deriveMultiPilot(d);
    // Platser som inte är ICAO-koder (namn eller ZZ…) → tillfällig plats med egen kod.
    for (const field of ['dep_place', 'arr_place'] as const) {
      const val = (d[field] ?? '').toUpperCase();
      if (!val || isOffAirportCode(val) || !(val.length > 4 || val.startsWith('ZZ'))) continue;   // ZZZZ förblir ZZZZ
      try {
        const { generateTemporaryIcao } = require('../db/icao');
        const code = val === 'ZZZZ' ? 'ZZZZ' : await generateTemporaryIcao(val);
        await addTemporaryPlace(code, val.length > 4 ? val : code);
        d[field] = code;
      } catch { /* behåll värdet */ }
    }
    const id = await insertFlight(d, { source: 'ocr', originalData: JSON.stringify(row.original) });
    if (id) savedIds.push(id);
    saved++;
    // Justerad mot sidans summa → markerad flygning + en rad i ändringsloggen per fält, med var i boken.
    if (id && row.adjusted?.length) {
      const pn = opts.pageNumbers[row.page];
      const where = pn?.left ? `logbook p. ${pn.left}–${pn.right ?? pn.left + 1}, row ${row.rowIndex}` : `scanned spread ${row.page + 1}, row ${row.rowIndex}`;
      await db.runAsync(`UPDATE flights SET status='flagged' WHERE id=?`, [id]);
      for (const a of row.adjusted) {
        await db.runAsync(
          `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason) VALUES (?, ?, ?, ?, ?)`,
          [id, a.field, a.from, a.to, `${SCAN_ADJUST_REASON} ${a.printed} (${where}).`],
        );
      }
      adjusted++;
    }
  }

  // Flygplansregistret: alla typer + registreringar som sparats.
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.skip) continue;
    const type = (row.data.aircraft_type ?? '').toUpperCase();
    const reg = (row.data.registration ?? '').toUpperCase();
    if (!type || seen.has(`${type}|${reg}`)) continue;
    seen.add(`${type}|${reg}`);
    try { await addToAircraftRegistry(type, reg); } catch { /* ignorera */ }
  }

  // Okända ICAO-koder som behölls → tillfälliga platser.
  for (const icao of opts.unknownIcaos) {
    if (isOffAirportCode(icao)) continue;
    const stillUsed = rows.some((r) => !r.skip && [r.data.dep_place, r.data.arr_place].some((p) => (p ?? '').toUpperCase() === icao));
    if (!stillUsed) continue;
    try { await addTemporaryPlace(icao, icao); } catch { /* redan tillagd */ }
  }

  // Koppla till den aktiva pappersboken via de tryckta sidnumren.
  const book = await getActiveBook();
  if (book && savedIds.length > 0) {
    const placeholders = savedIds.map(() => '?').join(',');
    for (const pn of opts.pageNumbers) {
      if (!pn.left) continue;
      const spread = Math.floor((pn.left - book.starting_page) / 2) + 1;
      if (spread <= 0) continue;
      await db.runAsync(`UPDATE flights SET book_id=?, spread_number=? WHERE id IN (${placeholders}) AND book_id=0`, [book.id, spread, ...savedIds]);
      await db.runAsync(`UPDATE logbook_books SET transcribed_spreads = MAX(transcribed_spreads, ?) WHERE id = ?`, [spread, book.id]);
    }
  }

  const pageLabel = opts.pageNumbers.filter((p) => p.left).map((p) => `${p.left}–${p.right ?? (p.left! + 1)}`).join(', ');
  return { saved, adjusted, skipped, duplicates, bookName: book && pageLabel ? book.name : null, pageLabel };
}

/** Användarens rättelser lär skannern: nästa skanning får dem som ledtrådar (db/ocrLearned). */
export async function saveLearnedCorrections(rows: ScanRow[]): Promise<void> {
  for (const row of rows) {
    if (row.skip) continue;
    const o = row.original, d = row.data;
    const pairs: [string, string | undefined, string | undefined][] = [
      ['aircraft_type', o.aircraft_type, d.aircraft_type],
      ['icao', o.dep_place, d.dep_place],
      ['icao', o.arr_place, d.arr_place],
      ['second_pilot', o.second_pilot, d.second_pilot],
    ];
    for (const field of ['total_time', 'pic', 'co_pilot', 'dual', 'ifr', 'night', 'dep_utc', 'arr_utc'] as const) {
      pairs.push(['time_correction', String(o[field] ?? ''), String(d[field] ?? '')]);
    }
    for (const [kind, from, to] of pairs) {
      if (kind === 'time_correction' && (to === '0' || !parseFloat(to ?? ''))) continue;
      if (from && to && from !== to) {
        try { await saveLearnedMapping(kind, from, to); } catch { /* inte kritiskt */ }
      }
    }
  }
}
