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
import { clockValue } from '../utils/format';
import { matchFlightsToLogbook, type DupHit, type ClashHit } from './logbookMatch';
import { autoPilotFlying } from '../utils/pilotFlying';

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
  fromRemarks?: boolean;  // second pilot hämtad ur anmärkningen automatiskt (rubriken säger "name of PIC")
  // Användaren tog bort second pilot (texten var ingen person): texten är tillbaka i anmärkningen och hämtas inte
  // igen. Det som behövs för att ångra.
  crewRemoved?: { name: string; role: string; remarks: string };
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

// Handskrivna siffror som lätt läses som en annan, de mest troliga först (3 och 8 förväxlas oftast).
const LOOKALIKE: Record<string, string> = {
  '0': '689', '1': '74', '2': '7', '3': '85', '4': '91', '5': '36', '6': '05', '7': '12', '8': '306', '9': '470',
};

/**
 * Giltiga klockslag en siffra från en läsning som inte är ett (0780 → 07:30, 07:00, 07:50), högst tre. Först de
 * som går ihop med total tid och radens andra klockslag (med ett tillägg på upp till 0.5 h, som i helikopterböcker).
 */
function clockAlternatives(digits: string, field: 'dep_utc' | 'arr_utc', other: string | null, totalH: number): string[] {
  const out: string[] = [];
  for (let pos = 0; pos < digits.length; pos++) {
    for (const d of LOOKALIKE[digits[pos]] ?? '') {
      const v = clockValue(digits.slice(0, pos) + d + digits.slice(pos + 1));
      if (v && !out.includes(v)) out.push(v);
    }
  }
  const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const gap = (v: string) => {
    if (!other || !(totalH > 0)) return Infinity;
    const [dep, arr] = field === 'dep_utc' ? [v, other] : [other, v];
    const diff = totalH * 60 - ((min(arr) - min(dep) + 1440) % 1440);   // minuter som total tid är längre än blocktiden
    return diff >= -6 && diff <= 36 ? Math.abs(diff) : Infinity;
  };
  return out.map((v, i) => ({ v, i, g: gap(v) })).sort((a, b) => a.g - b.g || a.i - b.i).slice(0, 3).map((x) => x.v);
}

/** Klientens egna kontroller ovanpå skannerns: returnerar en bearbetad kopia av raden. */
export function prepareFlight(f: OcrFlightResult): OcrFlightResult {
  const data: OcrFlightResult = { ...f, field_issues: [...(f.field_issues ?? [])] };
  const issues = data.field_issues as Issue[];
  const flag = (reason: string) => { data.needs_review = true; data.review_reason = data.review_reason || reason; };

  // Klockslag som inte finns (07:80, 27:30) blir aldrig ett värde: cellen töms och frågan erbjuder giltiga tider
  // en siffra bort. Giltiga skrivs som HH:MM ("730" → "07:30"), så att tids-avstämningen kan läsa dem.
  const clocks = { dep_utc: clockValue(data.dep_utc ?? ''), arr_utc: clockValue(data.arr_utc ?? '') };
  const total = parseFloat(String(data.total_time ?? '').replace(',', '.')) || 0;
  for (const field of ['dep_utc', 'arr_utc'] as const) {
    const raw = String(data[field] ?? '').trim();
    if (!raw) continue;
    if (clocks[field]) { data[field] = clocks[field]!; continue; }
    const m = raw.match(/^(\d{1,2})[:.]?(\d{2})$/);
    const shown = m ? `${m[1].padStart(2, '0')}:${m[2]}` : raw;
    const why = !m ? "that isn't a time" : Number(m[2]) > 59 ? 'minutes only go up to 59' : 'hours only go up to 23';
    const options = m ? clockAlternatives(m[1].padStart(2, '0') + m[2], field, field === 'dep_utc' ? clocks.arr_utc : clocks.dep_utc, total) : [];
    data[field] = '';
    for (let i = issues.length - 1; i >= 0; i--) if (issues[i].field === field) issues.splice(i, 1);
    issues.push({
      field, confidence: 0, read_as: shown, options,
      reason: `Claude read "${shown}", but ${why}. ${options.length ? 'Choose the time in your logbook, or type it.' : 'Type the time in your logbook.'}`,
    });
    flag('Not a valid time');
  }
  // Claudes egna förslag och tidskonflikt: bara riktiga klockslag.
  for (const i of issues) {
    if ((i.field === 'dep_utc' || i.field === 'arr_utc') && i.suggested_value) i.suggested_value = clockValue(i.suggested_value) ?? undefined;
  }
  const tm = data.time_mismatch;
  if (tm && (!data.dep_utc || !data.arr_utc || !clockValue(tm.read_dep) || !clockValue(tm.read_arr))) data.time_mismatch = undefined;
  else if (tm) data.time_mismatch = { ...tm, computed_dep_if_arr_correct: clockValue(tm.computed_dep_if_arr_correct) ?? '', computed_arr_if_dep_correct: clockValue(tm.computed_arr_if_dep_correct) ?? '' };

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
    // PIC + Co-pilot + Dual = total på varje flygning. Går det inte ihop har en kolumn oftast glidit en rad
    // (högersidan läst mot fel rad på vänstersidan) — då är just funktionstiden osäker.
    const fnOf = (f: string) => parseFloat(String((data as any)[f] ?? '0')) || 0;
    const fn = fnOf('pic') + fnOf('co_pilot') + fnOf('dual');
    const instr = fnOf('instructor');
    const off = (x: number) => Math.abs(total - x) > 0.05;
    if (total > 0 && fn > 0 && off(fn) && off(fn + instr) && !(instr > 0 && !off(instr))) {
      const field = (['dual', 'pic', 'co_pilot'] as const).reduce((a, b) => (fnOf(b) > fnOf(a) ? b : a));
      if (!issues.some((i) => i.field === field)) {
        issues.push({ field, reason: `PIC + Co-pilot + Dual is ${Math.round(fn * 10) / 10} h, but the total is ${total} h.`, confidence: 0.5 });
        flag('Function time does not match total');
      }
    }
  }

  // Initialer, namn och PICUS/SPIC/NVG i anmärkningen → förslag (förut Claudes remarks_suggestion, som var en
  // tredjedel av svaret). Samma regler som prompten hade; granskningen frågar en gång för hela boken.
  if (!data.remarks_suggestion && data.remarks) {
    const sg = suggestFromRemarks(data.remarks, !!data.second_pilot);
    if (sg) data.remarks_suggestion = sg;
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
      issues.push({ field, reason: `${code} isn't in the airport database — probably misread. Choose the right airport, or keep ${code} as written.`, confidence: 0.3 });
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

/** Skannade rader mot loggboken (services/logbookMatch), per radnyckel: rader som redan finns och rader som krockar
 *  i tid med en flygning i loggboken. Tider i lokal tid räknas om till UTC först, som när de sparas. */
export interface ScanMatch { dups: Record<string, DupHit>; clashes: Record<string, ClashHit[]>; times: Record<string, string> }
export const EMPTY_SCAN_MATCH: ScanMatch = { dups: {}, clashes: {}, times: {} };
export async function matchScanRows(rows: ScanRow[], timeBasis: 'utc' | 'local' = 'utc'): Promise<ScanMatch> {
  const data = await Promise.all(rows.map(async (r) => {
    const d: OcrFlightResult = { ...r.data };
    if (timeBasis === 'local') await localTimesToUtc(d).catch(() => {});
    return d;
  }));
  const m = await matchFlightsToLogbook(data);
  const out: ScanMatch = { dups: {}, clashes: {}, times: {} };
  for (const [i, d] of m.dups) out.dups[rows[i].key] = d;
  for (const [i, c] of m.clashes) out.clashes[rows[i].key] = c;
  for (const [i, t] of m.times) out.times[rows[i].key] = t;
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
    // En "sidsumma" som är orimligt mycket större än raderna är nästan alltid "Total to date" eller
    // "Brought forward" som lästs som "Total this page" — ingen jämförelse (och ingen fråga om att justera).
    const isCount = COUNT_FIELDS.has(field);
    if (value > sum * 3 && value - sum > (isCount ? 30 : 15)) continue;
    const tol = COUNT_FIELDS.has(field) ? 0.5 : 0.05;
    out.push({ page, field, sum: Math.round(sum * 100) / 100, printed: value, ok: Math.abs(sum - value) < tol });
  }
  return out;
}

// ── Felräknad sidsumma i pappersboken ───────────────────────────────────────
// Ibland är det inte Claude som läst fel, utan "Total this page" som räknats fel i pappersboken. Tecken på
// det: varje flygning stämmer med sina blocktider, eller sidans övriga summor går ihop med raderna. Då väljer
// användaren mellan att rätta summan (följdsummorna i boken listas i en guide efteråt, scanPaperFixes.ts)
// och att behålla den — då föreslår Blades vilka flygningar som justeras (suggestAdjustRows).

const FUNCTION_FIELDS = ['pic', 'co_pilot', 'dual', 'instructor'];
const CONDITION_FIELDS = ['ifr', 'night', 'multi_pilot', 'single_pilot', 'nvg', 'picus', 'spic'];
const numOf = (v: unknown) => parseFloat(String(v ?? '0').replace(',', '.')) || 0;

/** Stämmer sidans flygtider med blocktiderna — samma tillägg på alla rader, bara avrundning ifrån? */
export function rowsMatchBlockTimes(rows: ScanRow[], page: number): boolean {
  const flights = rows.filter((r) => r.page === page && !r.skip && r.data.flight_type !== 'sim');
  const offs = flights.map((r) => timeAddition(r.data)).filter((x): x is number => x != null);
  if (offs.length < 3 || offs.length < flights.length * 0.8) return false;
  const med = [...offs].sort((a, b) => a - b)[Math.floor(offs.length / 2)];
  // En tiondel för mycket eller för lite på en rad (en felläsning) hamnar utanför 0.07.
  return med > -0.1 && med < 0.55 && offs.every((o) => Math.abs(o - med) <= 0.07);
}

/**
 * Pekar sidans egna summor ut kolumnens summa som felräknad? PIC + Co-pilot + Dual + Instructor ska bli Total
 * time. Går sidans tryckta summor inte ihop, men gör det när kolumnens tryckta summa byts mot radernas, är det
 * den summan i boken som är fel.
 */
export function pageTotalsPointAt(rows: ScanRow[], page: number, field: string, printed: Record<string, number> | undefined): boolean {
  if (!printed || typeof printed.total_time !== 'number') return false;
  const fns = FUNCTION_FIELDS.filter((f) => typeof printed[f] === 'number');
  if (!fns.length || (field !== 'total_time' && !fns.includes(field))) return false;
  const rowSum = rows
    .filter((r) => r.page === page && !(field === 'total_time' && r.data.flight_type === 'sim'))
    .reduce((s, r) => s + numOf((r.data as any)[field]), 0);
  const v = (f: string) => (f === field ? rowSum : printed[f]);
  const asPrinted = fns.reduce((s, f) => s + printed[f], 0);
  const withRows = fns.reduce((s, f) => s + v(f), 0);
  return Math.abs(asPrinted - printed.total_time) >= 0.05 && Math.abs(withRows - v('total_time')) < 0.05;
}

/**
 * Blades förslag när sidans summa ska stå kvar: vilka flygningar som justeras, i turordning
 * (distributeDifference ger de första den största delen). Så få flygningar som möjligt och högst 0.2 h
 * (en landning) var — osäkra avläsningar först, sedan de längsta (minst relativ ändring). Flygningar där en
 * annan kolumn som redan går ihop skulle behöva ändras med (t.ex. Dual = hela flygtiden) tas sist.
 */
export function suggestAdjustRows(
  rows: ScanRow[], page: number, field: string, diff: number,
  printed: Record<string, number> | undefined, uncertain: Set<string>,
): string[] {
  const isCount = COUNT_FIELDS.has(field);
  const step = isCount ? 1 : 0.1;
  const units = Math.abs(Math.round(diff / step));
  if (!units) return [];
  const okCols = new Set(columnTotals(rows, page, printed).filter((c) => c.ok).map((c) => c.field));
  const cands = rows.filter((r) => r.page === page && !r.skip && numOf((r.data as any)[field]) > 0
    && !(field === 'total_time' && r.data.flight_type === 'sim'));
  if (!cands.length) return [];
  const perRow = isCount ? 1 : 2;
  const pick = (k: number) => {
    const maxDelta = Math.ceil(units / k) * step;
    return cands.map((r) => ({ key: r.key, s: score(r, maxDelta) })).sort((a, b) => b.s - a.s).slice(0, k);
  };
  const k = Math.min(cands.length, Math.max(1, Math.ceil(units / perRow)));
  const first = pick(k);
  if (first.every((x) => x.s >= 0)) return first.map((x) => x.key);
  // Hellre lite mer på färre flygningar (högst 0.3 h / en landning) än att en kolumn som går ihop börjar avvika.
  const clean = pick(cands.length).filter((x) => x.s >= 0).length;
  const widest = isCount ? 1 : 3;
  if (clean > 0 && clean * widest >= units) {
    const k2 = Math.min(clean, Math.max(1, Math.ceil(units / perRow)), cands.length);
    const second = pick(Math.max(k2, Math.ceil(units / widest)));
    if (second.every((x) => x.s >= 0)) return second.map((x) => x.key);
  }
  return first.map((x) => x.key);

  function score(r: ScanRow, maxDelta: number) {
    const v = numOf((r.data as any)[field]);
    let s = v;                                                      // längre flygning → mindre relativ ändring
    if (uncertain.has(r.key)) s += 100;
    if (diff < 0 && v - maxDelta < step - 1e-9) s -= 1000;          // får inte bli 0 eller negativ
    if (field === 'total_time') {
      const tt = numOf(r.data.total_time);
      // Kolumner som följer med flygtiden men redan går ihop med sidans summa skulle börja avvika.
      const follows = (f: string) => numOf((r.data as any)[f]) > 0
        && (FUNCTION_FIELDS.includes(f) ? Math.abs(numOf((r.data as any)[f]) - tt) < 0.05 : diff < 0 && numOf((r.data as any)[f]) > tt - maxDelta + 1e-9);
      if ([...FUNCTION_FIELDS, ...CONDITION_FIELDS].some((f) => follows(f) && okCols.has(f))) s -= 50;
    } else if (diff > 0 && !isCount && numOf((r.data as any)[field]) + maxDelta > numOf(r.data.total_time) + 1e-9) {
      s -= 500;                                                     // får inte bli längre än flygtiden
    }
    return s;
  }
}

/**
 * Följdändringar när flygtiden på en rad justeras: funktionstiden som täckte hela flygningen följer med,
 * och villkorstider (natt, IFR …) får inte bli längre än flygtiden.
 */
export function followTotalTime(data: OcrFlightResult, newTotal: number): { field: string; from: string; to: string }[] {
  const old = numOf(data.total_time);
  const out: { field: string; from: string; to: string }[] = [];
  for (const f of FUNCTION_FIELDS) {
    const v = numOf((data as any)[f]);
    if (v > 0 && Math.abs(v - old) < 0.05) out.push({ field: f, from: String((data as any)[f]), to: String(newTotal) });
  }
  for (const f of CONDITION_FIELDS) {
    const v = numOf((data as any)[f]);
    if (v > newTotal + 1e-9) out.push({ field: f, from: String((data as any)[f]), to: String(newTotal) });
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

// ── Anmärkningar: andrepilot, PICUS/SPIC/NVG ─────────────────────────────────

// Flyg- och inflygningstermer som aldrig är en andrepilots initialer.
const NOT_INITIALS = new Set([
  'ILS', 'NDB', 'VOR', 'GPS', 'RNAV', 'LOC', 'DME', 'PAR', 'GCA', 'RNP', 'LPV', 'LNAV', 'VNAV', 'RVR', 'GLS', 'SRA',
  'ASR', 'NPA', 'PA', 'APV', 'PC', 'OPC', 'LPC', 'CRM', 'IR', 'VFR', 'IFR', 'SE', 'ME', 'SP', 'MP', 'NVG', 'NVD',
  'NAV', 'SIM', 'OEI', 'AEO', 'TER', 'XC', 'PF', 'PM', 'AR', 'LL', 'LLR', 'KF', 'FF', 'ERF', 'TIS', 'TGL', 'TNG',
  'CPL', 'PPL', 'FI', 'TRI', 'TRE', 'MCC', 'SAR', 'HEMS', 'IMC', 'VMC', 'SID', 'ATC', 'EMERG', 'SOLO',
]);
const NAME_WORDS = new Set(['Check', 'Solo', 'Flight', 'Night', 'Local', 'Training', 'Navigation', 'Circuits', 'Cross', 'Country', 'Ferry', 'Test', 'Skill', 'Proficiency']);

/**
 * Förslag ur anmärkningen: initialer först i texten ("SZ, NDB" → andrepilot SZ), ett ensamt för- och
 * efternamn, eller PICUS/SPIC/NVG följt av en tid. original_text är bara det som flyttas.
 */
export function suggestFromRemarks(remarks: string, hasSecondPilot: boolean): OcrFlightResult['remarks_suggestion'] {
  const text = remarks.trim();
  const timed = /\b(PICUS|PIC\/US|P\/US|SPIC|S\/PIC|NVG|NVD|NVIS)\s*(\d+[.,]\d)\b/i.exec(text);
  if (!hasSecondPilot) {
    const first = /^([A-ZÅÄÖ]{2,3})(?=$|[\s,;:/.-])/.exec(text);
    if (first && !NOT_INITIALS.has(first[1])) {
      return { field: 'second_pilot', value: first[1], original_text: first[1], confidence: 0.7, reason: 'Initials at the start of the remarks' };
    }
    const name = /^([A-ZÅÄÖ][a-zåäöéü]+)\s+([A-ZÅÄÖ][a-zåäöéü]+(?:-[A-ZÅÄÖ][a-zåäöéü]+)?)$/.exec(text);
    if (name && !NAME_WORDS.has(name[1]) && !NAME_WORDS.has(name[2])) {
      return { field: 'second_pilot', value: text, original_text: text, confidence: 0.7, reason: 'A full name in the remarks' };
    }
  }
  if (timed) {
    const kind = timed[1].toUpperCase();
    const field = kind.startsWith('S') ? 'spic' : kind.startsWith('N') ? 'nvg' : 'picus';
    return { field, value: timed[2].replace(',', '.'), original_text: timed[0], confidence: 0.7, reason: `${kind} time in the remarks` };
  }
  return undefined;
}

// ── Andrepilot ur anmärkningen, automatiskt ─────────────────────────────────
// Säger anmärkningskolumnens tryckta rubrik att befälhavarens eller den andra pilotens namn skrivs där ("name
// of PIC or if another"), är namnet eller initialerna först i anmärkningen den piloten. Då sätts second pilot
// direkt, med roll efter flygningen: SIC om den har egen PIC-tid, annars PIC (användarens regel). Var Claude
// osäker på anmärkningen frågas raden som förut (med namnet som förslag).

/** Säger rubriktexten (Visions ord på sidan) att pilotens namn skrivs i anmärkningen? */
export function headerNamesPilot(texts: string[]): boolean {
  const all = texts.join(' ').replace(/\s+/g, ' ');
  return /name\s+of\s+(the\s+)?(p\.?\s?i\.?\s?c\b|pilot|commander|captain)/i.test(all)
    || /befälhavare(ns)?\s+namn|namn\s+på\s+befälhavare/i.test(all);
}

const DITTO = /^(?=.*[-–—"'”〃])[\s\-–—"'”〃|lI1]+$/;          // "-11-", "〃", '"' …
const NOT_NAMES = new Set(['LINE', 'BASE', 'TYPE', 'RATING', 'EXAM', 'REVALIDATION', 'RENEWAL', 'MISSION', 'SAR', 'HEMS', 'HOIST',
  'SLING', 'MOUNTAIN', 'SLOPE', 'AUTOROTATION', 'AUTOS', 'INSTRUMENT', 'SIMULATOR', 'SOLO', 'DUAL', 'CHECK', 'LOCAL', 'TRAINING',
  'NAVIGATION', 'CIRCUITS', 'FERRY', 'TEST', 'SKILL', 'PROFICIENCY', 'NIGHT', 'FLIGHT', 'CROSS', 'COUNTRY', 'APPROACH', 'APPROACHES']);

/** Namnet eller initialerna först i anmärkningen ("SVEN, IFR" → SVEN, "Anna Berg" → Anna Berg). */
function leadingName(remarks: string): string | null {
  const m = /^([A-ZÅÄÖ][A-Za-zÅÄÖåäöéü]{1,15}(?:[\s-][A-ZÅÄÖ][a-zåäöéü]+)?)(?=$|[\s,;:/.])/.exec(remarks.trim());
  if (!m) return null;
  if (/^[A-Z]{4}\s*[-–>]\s*[A-Z]{4}/.test(remarks.trim())) return null;   // en rutt ("ESKN-ESSA"), inget namn
  const first = m[1].split(/[\s-]/)[0].toUpperCase();
  if (NOT_INITIALS.has(first) || NOT_NAMES.has(first) || /^(PICUS|SPIC|NVG|NVD|NVIS)$/.test(first)) return null;
  return m[1];
}

// Resten av anmärkningen när namnet flyttats. Ett ditto-tecken ("-11-") får stå kvar som det är skrivet.
const restOfRemarks = (remarks: string, moved: string) =>
  remarks.replace(moved, '').replace(/^(?:[\s,;:/.]+|-\s+)+/, '').replace(/\s{2,}/g, ' ').trim();

/** Sätter second pilot ur anmärkningen på raderna (per uppslag, i radordning). Antal satta. */
export function applyPilotNamesFromRemarks(rows: ScanRow[]): number {
  let n = 0;
  const pages = new Map<number, ScanRow[]>();
  for (const r of rows) { const l = pages.get(r.page) ?? []; l.push(r); pages.set(r.page, l); }
  for (const list of pages.values()) {
    let prev: { name: string; rest: string } | null = null;        // för ditto ("-11-") på nästa rad
    for (const r of [...list].sort((a, b) => a.rowIndex - b.rowIndex)) {
      const d = r.data;
      if (r.skip) continue;
      if (r.crewRemoved) { prev = null; continue; }
      if (d.second_pilot) { prev = r.fromRemarks ? { name: d.second_pilot, rest: d.remarks ?? '' } : null; continue; }
      const remarks = String(d.remarks ?? '').trim();
      let name: string | null = null, rest = remarks;
      if (remarks && DITTO.test(remarks)) { if (prev) { name = prev.name; rest = prev.rest; } }
      else {
        const rs = d.remarks_suggestion;
        if (rs?.field === 'second_pilot') { name = rs.value; rest = restOfRemarks(remarks, rs.original_text); }
        else { const lead = remarks ? leadingName(remarks) : null; if (lead) { name = lead; rest = restOfRemarks(remarks, lead); } }
      }
      if (name && [d.dep_place, d.arr_place].some((p) => (p ?? '').toUpperCase() === name!.toUpperCase())) name = null;   // en plats
      if (!name) { prev = null; continue; }
      prev = { name, rest };
      const unsure = (d.field_issues ?? []).some((x) => x.field === 'remarks' || x.field === 'second_pilot');
      if (unsure) {
        // Osäker läsning → frågas, med namnet som förslag.
        if (!DITTO.test(remarks)) {
          const base = d.remarks_suggestion?.field === 'second_pilot' ? d.remarks_suggestion : { field: 'second_pilot', value: name, original_text: name };
          r.data = { ...d, remarks_suggestion: { ...base, confidence: 0.5, reason: 'Name of the PIC in the remarks, but the reading is unsure' } };
        }
        continue;
      }
      r.data = { ...d, second_pilot: name, second_pilot_role: numOf(d.pic) > 0 ? 'COP' : 'PIC', remarks: rest, remarks_suggestion: undefined } as OcrFlightResult;
      r.fromRemarks = true;
      n++;
    }
  }
  return n;
}

// ── Raderna i ordning: datum, dubbelrader ────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const sameRowScore = (a: OcrFlightResult, b: OcrFlightResult) =>
  (['date', 'registration', 'dep_utc', 'arr_utc', 'total_time', 'dual', 'pic', 'landings_day', 'landings_night'] as const)
    .filter((f) => String((a as any)[f] ?? '') !== '' && String((a as any)[f] ?? '') === String((b as any)[f] ?? '')).length;

/**
 * En rad som lästs två gånger syns knappt i granskningen (den hamnar ovanpå originalet) men räknas i summan.
 * Är kolumnen exakt en rads värde för stor och är den raden en kopia av grannen (eller delar radplats med en
 * annan), är det troligen den — inte summan i pappersboken — som är fel.
 */
export function findExtraRow(rows: ScanRow[], page: number, field: string, diff: number, rowsPerPage?: number): ScanRow | null {
  if (!(diff < 0)) return null;
  const pageRows = rows.filter((r) => r.page === page && !r.skip).sort((a, b) => a.rowIndex - b.rowIndex);
  const tooMany = !!rowsPerPage && pageRows.length > rowsPerPage;
  let best: ScanRow | null = null, bestScore = -1;
  pageRows.forEach((r, i) => {
    if (field === 'total_time' && r.data.flight_type === 'sim') return;
    if (Math.abs(numOf((r.data as any)[field]) + diff) >= 0.05) return;     // raden är precis överskottet
    const shared = pageRows.some((o) => o !== r && o.rowIndex === r.rowIndex);
    const copy = Math.max(i > 0 ? sameRowScore(pageRows[i - 1].data, r.data) : 0, i + 1 < pageRows.length ? sameRowScore(pageRows[i + 1].data, r.data) : 0);
    if (!(shared || copy >= 4 || (tooMany && copy >= 2))) return;
    const sc = (shared ? 10 : 0) + copy + (tooMany ? 2 : 0);
    if (sc >= bestScore) { best = r; bestScore = sc; }                       // lika: den senare av två kopior
  });
  return best;
}

/**
 * Kontroller över raderna på ett uppslag (kod, inte modellen): datum som går bakåt, samma datum men tidigare
 * på dagen än raden ovanför (en kolumn har glidit en rad), och fler rader än sidan har tryckta rader (en rad
 * lästes två gånger). Lägger till field_issues på datumet; "Skip row" i granskningen tar bort en dubbelrad.
 */
export function checkRowSequence(rows: ScanRow[], rowsPrinted?: number): void {
  const sorted = [...rows].filter((r) => !r.skip).sort((a, b) => a.rowIndex - b.rowIndex);
  const ask = (r: ScanRow, reason: string) => {
    const issues = r.data.field_issues ?? [];
    if (issues.some((i) => i.field === 'date')) return;
    r.data = { ...r.data, field_issues: [...issues, { field: 'date', reason, confidence: 0.5 }], needs_review: true };
  };
  // Dubbelraden först, så att den frågan vinner över datumfrågan på samma rad.
  if (rowsPrinted && sorted.length > rowsPrinted) {
    let best = -1, bestScore = -1;
    for (let i = 1; i < sorted.length; i++) {
      const sc = sameRowScore(sorted[i - 1].data, sorted[i].data);
      if (sc > bestScore) { best = i; bestScore = sc; }
    }
    if (best > 0) ask(sorted[best], `The page has ${rowsPrinted} rows but ${sorted.length} were read — this row may be read twice.`);
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].data, b = sorted[i].data;
    if (!ISO_DATE.test(a.date ?? '') || !ISO_DATE.test(b.date ?? '')) continue;
    if (b.date < a.date) { ask(sorted[i], 'Earlier than the row above — check the date.'); continue; }
    if (b.date !== a.date) continue;
    const aDep = clockMin(a.dep_utc), aArr = clockMin(a.arr_utc), bDep = clockMin(b.dep_utc);
    if (aDep == null || aArr == null || bDep == null || aArr < aDep) continue;   // över midnatt: ingen slutsats
    if (bDep + 5 < aArr) ask(sorted[i], 'Same date as the row above but earlier in the day — check the date.');
  }
}

/**
 * Bokens radantal: samma bok har lika många tryckta rader på varje uppslag. Har minst två tidigare uppslag
 * samma antal används det (Claudes egen räkning kan bli fel just på uppslaget där en rad lästs två gånger).
 */
export function typicalRowsPerPage(seen: number[], current?: number): number | undefined {
  const counts = new Map<number, number>();
  for (const n of seen) if (n > 0) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best: [number, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  return best && best[1] >= 2 ? best[0] : current;
}

/**
 * Simulatortid som hamnat i en "Other type of flight time"-kolumn (Claude blandade ihop kolumnerna): rader
 * utan total flygtid och utan funktionstid men med ett värde där. Går sidans simulatorsumma ihop när de
 * värdena räknas som simulator, är det simulatorpass — de flyttas dit (sidans summa bekräftar).
 */
export function reconcileSimColumn(rows: ScanRow[], page: number, printed: Record<string, number> | undefined): void {
  const target = printed?.sim;
  if (!(typeof target === 'number' && target > 0)) return;
  const num = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
  const pageRows = rows.filter((r) => r.page === page && !r.skip);
  const simSum = pageRows.reduce((s, r) => s + num(r.data.sim), 0);
  if (Math.abs(simSum - target) < 0.05) return;
  const cands = pageRows.flatMap((r) => {
    const d = r.data;
    if (d.flight_type === 'sim' || num(d.total_time) > 0 || ['pic', 'co_pilot', 'dual', 'instructor'].some((f) => num((d as any)[f]) > 0)) return [];
    const vals = Object.entries(d.other_times ?? {}).filter(([, v]) => v > 0);
    return vals.length === 1 ? [{ r, key: vals[0][0], value: vals[0][1] }] : [];
  });
  const extra = cands.reduce((s, c) => s + c.value, 0);
  if (!cands.length || Math.abs(simSum + extra - target) >= 0.05) return;
  for (const { r, key, value } of cands) {
    const others = { ...(r.data.other_times ?? {}) };
    delete others[key];
    const issues = (r.data.field_issues ?? []).filter((i) => i.field !== key && i.field !== 'other_flight_time');
    if (!issues.some((i) => i.field === 'sim_category')) issues.push({ field: 'sim_category', reason: 'Which kind of simulator (FFS, FTD, FNPT…)?', confidence: 0.5 });
    r.data = { ...r.data, flight_type: 'sim', sim: String(value), total_time: String(value), other_times: others, field_issues: issues, needs_review: true };
  }
}

/**
 * Bokens tillägg (t.ex. +0.2 h) skrivet i cellen ("1.2 + 0.2") men läst utan tillägget: tiden är då exakt
 * tillägget lägre än radens total. Går kolumnen ihop med sidans "Total this page" när tillägget läggs till på
 * just de raderna, läggs det till (sidans summa bekräftar). Returnerar antalet rättade celler.
 */
export function reconcileAddition(rows: ScanRow[], page: number, printed: Record<string, number> | undefined, add: number | null | undefined): number {
  if (!printed || !(typeof add === 'number' && add > 0)) return 0;
  const num = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
  let fixed = 0;
  for (const field of ['dual', 'pic', 'co_pilot', 'instructor', 'ifr', 'night']) {
    const target = printed[field];
    if (typeof target !== 'number') continue;
    const pageRows = rows.filter((r) => r.page === page && !r.skip && r.data.flight_type !== 'sim');
    const sum = pageRows.reduce((acc, r) => acc + num((r.data as any)[field]), 0);
    if (Math.abs(sum - target) < 0.05) continue;
    const short = pageRows.filter((r) => {
      const v = num((r.data as any)[field]);
      return v > 0 && Math.abs(num(r.data.total_time) - v - add) < 0.05;
    });
    if (!short.length || Math.abs(sum + short.length * add - target) >= 0.05) continue;
    for (const r of short) {
      const v = Math.round((num((r.data as any)[field]) + add) * 10) / 10;
      // Frågan "PIC + Co-pilot + Dual is …" gällde just det här och behövs inte längre.
      const issues = (r.data.field_issues ?? []).filter((x) => !(x.field === field && /^PIC \+ Co-pilot \+ Dual/.test(x.reason)));
      r.data = { ...r.data, [field]: String(v), field_issues: issues };
      fixed++;
    }
  }
  return fixed;
}

/**
 * Samma tal under Day och Night på en rad, när bara den ena kolumnen går ihop med sidans summa: talet är
 * nästan alltid skrivet i fel kolumn, överstruket och omskrivet i den andra (vanligt vid nattflygning).
 * → fråga om värdet i kolumnen som inte går ihop, med 0 som förslag.
 */
export function checkLandingPairs(rows: ScanRow[], page: number, printed: Record<string, number> | undefined): void {
  const checks = columnTotals(rows, page, printed);
  const ok = (f: string) => checks.find((c) => c.field === f)?.ok;
  const bad = ok('landings_day') === false && ok('landings_night') !== false ? 'landings_day'
    : ok('landings_night') === false && ok('landings_day') !== false ? 'landings_night' : null;
  if (!bad) return;
  const other = bad === 'landings_day' ? 'landings_night' : 'landings_day';
  for (const r of rows) {
    if (r.page !== page || r.skip) continue;
    const v = Number((r.data as any)[bad]) || 0;
    if (v <= 0 || v !== (Number((r.data as any)[other]) || 0)) continue;
    const issues = r.data.field_issues ?? [];
    if (issues.some((i) => i.field === bad)) continue;
    const where = other === 'landings_night' ? 'Night' : 'Day';
    r.data = { ...r.data, needs_review: true, field_issues: [...issues, { field: bad, reason: `The same ${v} is under ${where}. Is this one struck out?`, confidence: 0.4, suggested_value: '0' }] };
  }
}

export interface SaveSummary {
  saved: number;
  adjusted: number;       // sparade flygningar som justerats mot sidans summa (markerade)
  skipped: number;
  duplicates: number;
  bookName: string | null;
  pageLabel: string;
  ids: Record<string, number>;   // ScanRow.key → flygningens id (sparad nu eller redan i loggboken)
}

/** Sparar alla rader som inte hoppats över. Samma regler som den gamla granskningen. */
// Början på orsaken i ändringsloggen för en justering mot sidans summa (flygningens sida känner igen den).
export const SCAN_ADJUST_REASON = 'Adjusted during the logbook scan so the column matches the page total';

// inLogbook: rader som lämnas utanför för att de redan finns i loggboken → flygningens id (räknas som duplicates).
// Ingen dubblettkoll här: den görs mot loggboken före sparningen (matchScanRows), så likadana rader sparas alla.
export async function saveScanRows(
  rows: ScanRow[],
  opts: { unknownIcaos: Set<string>; pageNumbers: { left: number | null; right: number | null }[]; timeBasis?: 'utc' | 'local'; inLogbook?: Record<string, number> },
): Promise<SaveSummary> {
  let saved = 0, skipped = 0, duplicates = 0, adjusted = 0;
  const savedIds: number[] = [];
  const ids: Record<string, number> = {};   // rad → flygning (ny, eller den som redan fanns)
  const db = await getDatabase();

  for (const row of rows) {
    if (row.skip) {
      const had = opts.inLogbook?.[row.key];
      if (had) { duplicates++; ids[row.key] = had; } else skipped++;
      continue;
    }
    const d: OcrFlightResult = { ...row.data };
    if (opts.timeBasis === 'local') await localTimesToUtc(d);
    mapOtherTimes(d);
    deriveMultiPilot(d);
    autoPilotFlying(d);   // pappersböcker har ingen PF-kolumn: flygtiden om det finns en landning, annars 0
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
    if (id) { savedIds.push(id); ids[row.key] = id; }
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

  // Okända ICAO-koder som behölls blir INTE off-airport-platser (användarens regel): en kod som inte finns i
  // databasen är oftast en felläsning (ESCC för ESCF). Koden står kvar på flygningen som den skrevs, utan
  // plats och utan position, tills användaren rättar den. (opts.unknownIcaos används inte längre här.)

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
  return { saved, adjusted, skipped, duplicates, bookName: book && pageLabel ? book.name : null, pageLabel, ids };
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
