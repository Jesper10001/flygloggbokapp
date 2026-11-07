// Jämför flygningar som ska sparas (CSV-import, skanning) med loggboken innan Save. Används av importrapporterna
// (pilot och drönare) och skanningsrapporten.
//  - Dubbletter: samma flygning finns redan. Pilot: samma datum och rutt, och tiderna inom 10 min (eller samma tider
//    förskjutna med platsens UTC-avvikelse = skrivna i lokal tid); utan tider samma totaltid inom 6 min. Drönare:
//    samma datum, starttid inom 10 min och samma flygtid; utan starttid samma flygtid och plats.
//    Varje flygning i loggboken paras ihop med högst en ny (bäst matchning först), så tre varv i filen mot två i
//    loggboken ger ett nytt. withinFile: en rad som står två gånger i filen (samma tider) är också en dubblett.
//  - Krockar: flygningar som överlappar i tid med en annan flygning i loggboken, oavsett rutt.
// Jämförelsen görs mot loggboken som den ser ut före sparningen, så likadana flygningar i samma import sparas alla.

import { getDatabase } from '../db/database';
import { getAirportByIcao } from '../db/icao';
import { PREV_EXP_REMARK } from '../db/backfill';
import { localOffsetMinutes } from '../utils/timezone';

export interface LoggedFlight {
  id: number;
  date: string;
  route: string;      // "ESSA → ESGG" (drönare: platsen eller drönaren)
  times: string;      // "08:10–09:25" ('' = utan tider)
  total: number;      // timmar
  what: string;       // typ och registrering
  source: string;     // 'scanned' | 'imported' | 'logged by hand'
}
export interface DupHit { logged: LoggedFlight | null; fileRow?: number; zone?: number }   // zone = timmar isär (lokal tid mot UTC)
export interface ClashHit { logged: LoggedFlight; minutes: number }
export interface LogbookMatch {
  dups: Map<number, DupHit>;          // index i importen → samma flygning
  clashes: Map<number, ClashHit[]>;   // index → flygningar i loggboken som överlappar i tid
  times: Map<number, string>;         // index → importens tider ("08:10–09:05", UTC som de sparas)
}
export const EMPTY_MATCH: LogbookMatch = { dups: new Map(), clashes: new Map(), times: new Map() };

const DUP_MIN = 10;          // tider inom så många minuter = samma flygning
const DUP_TOTAL_H = 0.1;     // utan tider: totaltid inom 6 min
const CLASH_MIN = 5;         // överlapp kortare än så räknas inte (avrundade tider vid snabba vändor)
const DRONE_CLASH_MIN = 2;

const minOf = (t?: string | null) => {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};
const dayOf = (d?: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000) : null);
const isoOf = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);
const hhmm = (min: number) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const SOURCE: Record<string, string> = { ocr: 'scanned', import: 'imported', manual: 'logged by hand', scanner: 'scanned' };
const sourceOf = (s?: string | null) => SOURCE[s ?? ''] ?? 'in your logbook';
const norm = (s?: string | null) => String(s ?? '').trim().toUpperCase();

type Span = { start: number; end: number };
// Avgång → landning i minuter sedan 1970 (landning före avgång = över midnatt). Orimliga pass räknas inte.
function spanOf(day: number | null, dep?: string | null, arr?: string | null): Span | null {
  const a = minOf(dep), b = minOf(arr);
  if (day == null || a == null || b == null) return null;
  const dur = (b - a + 1440) % 1440;
  if (dur === 0 || dur > 20 * 60) return null;
  return { start: day * 1440 + a, end: day * 1440 + a + dur };
}
const overlap = (x: Span, y: Span) => Math.min(x.end, y.end) - Math.max(x.start, y.start);
const timesOf = (s: Span | null) => (s ? `${hhmm(s.start)}–${hhmm(s.end)}` : '');

type Pair = { i: number; j: number; score: number; zone?: number };
// Bästa matchningarna först; varje flygning i loggboken och i importen används högst en gång.
function assign(pairs: Pair[]): Map<number, Pair> {
  const out = new Map<number, Pair>();
  const taken = new Set<number>();
  for (const p of [...pairs].sort((a, b) => a.score - b.score)) {
    if (out.has(p.i) || taken.has(p.j)) continue;
    out.set(p.i, p);
    taken.add(p.j);
  }
  return out;
}

// ── Pilot ─────────────────────────────────────────────────────────────────────
export interface IncomingFlight { date: string; dep_place?: string; arr_place?: string; dep_utc?: string; arr_utc?: string; total_time?: string | number }

export async function matchFlightsToLogbook(flights: IncomingFlight[], opts: { withinFile?: boolean } = {}): Promise<LogbookMatch> {
  const days = flights.map((f) => dayOf(f.date));
  const valid = days.filter((d): d is number => d != null);
  const res: LogbookMatch = { dups: new Map(), clashes: new Map(), times: new Map() };
  if (!valid.length) return res;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: number; date: string; dep_place: string; arr_place: string; dep_utc: string; arr_utc: string;
    total_time: number; aircraft_type: string; registration: string; source: string;
  }>(
    `SELECT id, date, dep_place, arr_place, dep_utc, arr_utc, total_time, aircraft_type, registration, source FROM flights
     WHERE date BETWEEN ? AND ? AND COALESCE(remarks, '') NOT IN (?, '[BACKFILL]')`,
    [isoOf(Math.min(...valid) - 1), isoOf(Math.max(...valid) + 1), PREV_EXP_REMARK],
  );
  const logged = rows.map((r) => {
    const day = dayOf(r.date);
    const span = spanOf(day, r.dep_utc, r.arr_utc);
    const info: LoggedFlight = {
      id: r.id, date: r.date, route: `${r.dep_place || '?'} → ${r.arr_place || '?'}`, times: timesOf(span),
      total: Number(r.total_time) || 0, what: [r.aircraft_type, r.registration].filter(Boolean).join(' '), source: sourceOf(r.source),
    };
    return { day, span, dep: norm(r.dep_place), arr: norm(r.arr_place), info };
  });
  const byDay = new Map<number, number[]>();
  logged.forEach((l, j) => { if (l.day != null) byDay.set(l.day, [...(byDay.get(l.day) ?? []), j]); });
  const near = (day: number) => [...(byDay.get(day - 1) ?? []), ...(byDay.get(day) ?? []), ...(byDay.get(day + 1) ?? [])];

  // Platsens UTC-avvikelse (minuter) den dagen, för tider skrivna i lokal tid.
  const offsets = new Map<string, number | null>();
  const offsetAt = async (code: string, date: string) => {
    const k = `${code}|${date}`;
    if (!offsets.has(k)) {
      const a = /^[A-Z]{4}$/.test(code) ? await getAirportByIcao(code).catch(() => null) : null;
      offsets.set(k, a ? localOffsetMinutes(new Date(`${date}T12:00:00Z`), a.country, a.region, a.lon) : null);
    }
    return offsets.get(k) ?? null;
  };

  const inc = flights.map((f, i) => {
    const span = spanOf(days[i], f.dep_utc, f.arr_utc);
    if (span) res.times.set(i, timesOf(span));
    return { day: days[i], span, dep: norm(f.dep_place), arr: norm(f.arr_place), total: parseFloat(String(f.total_time ?? '')) || 0 };
  });

  const pairs: Pair[] = [];
  for (let i = 0; i < inc.length; i++) {
    const a = inc[i];
    if (a.day == null) continue;
    for (const j of near(a.day)) {
      const l = logged[j];
      if (l.dep !== a.dep || l.arr !== a.arr) continue;
      if (a.span && l.span) {
        const ds = Math.abs(a.span.start - l.span.start), de = Math.abs(a.span.end - l.span.end);
        if (ds <= DUP_MIN && de <= DUP_MIN) { pairs.push({ i, j, score: ds + de }); continue; }
        // Samma pass, men det ena i lokal tid och det andra i UTC: lika långt och förskjutet med platsens avvikelse.
        const len = Math.abs((a.span.end - a.span.start) - (l.span.end - l.span.start));
        const off = await offsetAt(a.dep, flights[i].date);
        if (off && len <= 6 && Math.abs(Math.abs(l.span.start - a.span.start) - Math.abs(off)) <= 5) {
          pairs.push({ i, j, score: 50 + len, zone: Math.round((l.span.start - a.span.start) / 60) });
        }
      } else if (l.day === a.day && Math.abs(a.total - l.info.total) <= DUP_TOTAL_H) {
        pairs.push({ i, j, score: 100 + Math.abs(a.total - l.info.total) * 60 });
      }
    }
  }
  for (const [i, p] of assign(pairs)) res.dups.set(i, { logged: logged[p.j].info, zone: p.zone });

  // Samma rad två gånger i filen (samma datum, rutt och tider).
  if (opts.withinFile) {
    const seen = new Map<string, number>();
    inc.forEach((a, i) => {
      if (!a.span || res.dups.has(i)) return;
      const k = `${a.dep}|${a.arr}|${a.span.start}|${a.span.end}`;
      const first = seen.get(k);
      if (first != null) res.dups.set(i, { logged: null, fileRow: first });
      else seen.set(k, i);
    });
  }

  // Krockar: överlapp i tid med en flygning i loggboken som inte redan är samma som en flygning i importen
  // (då är det två flygningar i filen som krockar, och att ta bort den i loggboken skulle tappa båda).
  const matched = new Set([...res.dups.values()].map((d) => d.logged?.id).filter((x): x is number => x != null));
  inc.forEach((a, i) => {
    if (!a.span || a.day == null || res.dups.has(i)) return;
    const hits: ClashHit[] = [];
    for (const j of near(a.day)) {
      const l = logged[j];
      if (!l.span || matched.has(l.info.id)) continue;
      const m = overlap(a.span, l.span);
      if (m >= CLASH_MIN) hits.push({ logged: l.info, minutes: m });
    }
    if (hits.length) res.clashes.set(i, hits);
  });
  return res;
}

// ── Drönare ───────────────────────────────────────────────────────────────────
export interface IncomingDroneFlight { date: string; takeoff_time?: string; total_time: number; location?: string; lat?: number; lon?: number }

export async function matchDroneFlightsToLogbook(flights: IncomingDroneFlight[], opts: { withinFile?: boolean } = {}): Promise<LogbookMatch> {
  const days = flights.map((f) => dayOf(f.date));
  const valid = days.filter((d): d is number => d != null);
  const res: LogbookMatch = { dups: new Map(), clashes: new Map(), times: new Map() };
  if (!valid.length) return res;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: number; date: string; takeoff_time: string; total_time: number; location: string; lat: number; lon: number;
    drone_type: string; registration: string; source: string;
  }>(
    `SELECT id, date, takeoff_time, total_time, location, lat, lon, drone_type, registration, source FROM drone_flights
     WHERE date BETWEEN ? AND ? AND COALESCE(source, '') != 'summary'`,
    [isoOf(Math.min(...valid) - 1), isoOf(Math.max(...valid) + 1)],
  );
  const spanD = (day: number | null, t?: string | null, h?: number) => {
    const a = minOf(t), len = Math.round((h ?? 0) * 60);
    return day == null || a == null || len <= 0 ? null : { start: day * 1440 + a, end: day * 1440 + a + len };
  };
  const samePlace = (a: { loc: string; lat: number; lon: number }, b: { loc: string; lat: number; lon: number }) =>
    (a.lat && b.lat ? Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.02 : false) || a.loc === b.loc;
  const logged = rows.map((r) => {
    const day = dayOf(r.date);
    const span = spanD(day, r.takeoff_time, Number(r.total_time) || 0);
    const info: LoggedFlight = {
      id: r.id, date: r.date, route: r.location || r.drone_type || 'Flight', times: timesOf(span),
      total: Number(r.total_time) || 0, what: [r.drone_type, r.registration].filter(Boolean).join(' '), source: sourceOf(r.source),
    };
    return { day, span, place: { loc: norm(r.location), lat: r.lat || 0, lon: r.lon || 0 }, info };
  });
  const byDay = new Map<number, number[]>();
  logged.forEach((l, j) => { if (l.day != null) byDay.set(l.day, [...(byDay.get(l.day) ?? []), j]); });
  const near = (day: number) => [...(byDay.get(day - 1) ?? []), ...(byDay.get(day) ?? []), ...(byDay.get(day + 1) ?? [])];

  const inc = flights.map((f, i) => {
    const span = spanD(days[i], f.takeoff_time, f.total_time);
    if (span) res.times.set(i, timesOf(span));
    return { day: days[i], span, total: f.total_time || 0, place: { loc: norm(f.location), lat: f.lat || 0, lon: f.lon || 0 } };
  });

  const pairs: Pair[] = [];
  inc.forEach((a, i) => {
    if (a.day == null) return;
    for (const j of byDay.get(a.day) ?? []) {
      const l = logged[j];
      const dt = Math.abs(a.total - l.info.total) * 60;
      if (a.span && l.span) {
        const ds = Math.abs(a.span.start - l.span.start);
        if (ds <= DUP_MIN && dt <= 2) pairs.push({ i, j, score: ds + dt });
      } else if (dt <= 1 && samePlace(a.place, l.place)) {
        pairs.push({ i, j, score: 100 + dt });
      }
    }
  });
  for (const [i, p] of assign(pairs)) res.dups.set(i, { logged: logged[p.j].info });

  if (opts.withinFile) {
    const seen = new Map<string, number>();
    inc.forEach((a, i) => {
      if (!a.span || res.dups.has(i)) return;
      const k = `${a.span.start}|${a.span.end}|${a.place.loc}`;
      const first = seen.get(k);
      if (first != null) res.dups.set(i, { logged: null, fileRow: first });
      else seen.set(k, i);
    });
  }

  const matched = new Set([...res.dups.values()].map((d) => d.logged?.id).filter((x): x is number => x != null));
  inc.forEach((a, i) => {
    if (!a.span || a.day == null || res.dups.has(i)) return;
    const hits: ClashHit[] = [];
    for (const j of near(a.day)) {
      const l = logged[j];
      if (!l.span || matched.has(l.info.id)) continue;
      const m = overlap(a.span, l.span);
      if (m >= DRONE_CLASH_MIN) hits.push({ logged: l.info, minutes: m });
    }
    if (hits.length) res.clashes.set(i, hits);
  });
  return res;
}

// Flygningarna i loggboken som ska tas bort: krockar där användaren valt att behålla den nya (och den nya sparas).
export function idsToRemove(match: LogbookMatch, keepNew: Iterable<number>, leftOut: (i: number) => boolean): number[] {
  const ids = new Set<number>();
  for (const i of keepNew) {
    if (leftOut(i)) continue;
    for (const c of match.clashes.get(i) ?? []) ids.add(c.logged.id);
  }
  return [...ids];
}
