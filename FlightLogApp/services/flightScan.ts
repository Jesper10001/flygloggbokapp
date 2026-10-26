// ACARS/Instrument scan (pilotläget): läser flygdata ur en bild — främst ACARS-/AOC-sidan "FLT LOG" på
// MCDU:n (OUT/OFF/ON/IN, BLOCK/FLIGHT, FOB, flightnummer, ORIG-DEST), men även instrument-/EFB-sidor och
// spårningsappar. Claude läser bara av; datum utan år/månad, tider (sekunder kapas), block-/flygtid och
// bränsle normaliseras lokalt. Token-styrt (anroparen kollar hasTokenQuota).
import { callAnthropicJson } from './anthropicClient';
import { prepareScanImage } from './scanImage';

export interface FlightScanFuel { unit: string; out?: number; on?: number; in?: number; used?: number; refuel?: number }
export interface FlightScanResult {
  date: string;            // YYYY-MM-DD ('' = syns inte)
  dateInferred: boolean;   // år/månad saknades på sidan (ACARS "09AUG", "/23") → härlett till senast passerade
  flight_no: string;
  dep_place: string;
  arr_place: string;
  out_utc: string;         // OUT = off blocks (HH:MM)
  off_utc: string;         // OFF = takeoff
  on_utc: string;          // ON  = landing
  in_utc: string;          // IN  = on blocks
  block_h: number;         // blocktid (OUT→IN / aircraft time), 0 = okänd
  flight_h: number;        // flygtid (OFF→ON / airborne), 0 = okänd
  aircraft_type: string;
  registration: string;
  max_fl: string;
  landings: number;        // 0 = okänt
  flight_rules: string;    // 'VFR' | 'IFR' | ''
  fuel: FlightScanFuel | null;
}

const systemPrompt = (today: string) => `You extract flight data from images of aircraft displays — above all ACARS / AOC "FLT LOG" pages on the MCDU (OUT/OFF/ON/IN times after a flight), but also cockpit instruments, helicopter flight-data pages, EFB screens and flight-tracking app screenshots. Today's date is ${today}.

Return ONLY a raw JSON object (no markdown) with the fields you can clearly read — omit the rest:
- date: "YYYY-MM-DD" — ONLY when a full date including the year is visible (e.g. "15-05-24" day-month-year → "2024-05-15").
- date_day, date_month: numbers — when only part of the date is visible. ACARS "09AUG" → date_day 9, date_month 8. "AD4619/23" under FLT ID/DATE → date_day 23 (no month).
- flight_no: flight number or callsign, e.g. "AFR66SQ", "AD4619", "792F" (drop trailing dashes).
- dep_place, arr_place: 4-letter ICAO codes (ORIG-DEST, DEPT/DEST, e.g. "GMME-LFPG").
- out_utc, off_utc, on_utc, in_utc: "HH:MM" — OUT (off blocks), OFF (takeoff), ON (landing), IN (on blocks). Drop seconds: "05:02:40" → "05:02". Omit an event without a time (e.g. "IN -"). On engine pages use STARTING / SHUTDOWN TIME as out_utc / in_utc.
- block_time: "HH:MM" — BLOCK time (OUT→IN), or AIRCRAFT TIME / engine-on to engine-off / Hobbs on other pages.
- flight_time: "HH:MM" — FLIGHT time (OFF→ON, airborne). Decimal hours such as "1.3" are fine if that is what is shown.
- fuel_unit: "t", "kg" or "lb" ("7T800" means 7.8 t; a "FOB (T)" header means tonnes).
- fob_out, fob_on, fob_in: fuel on board at OUT, ON and IN (numbers in fuel_unit) — each only from its own row; omit fob_in when the IN row is empty. fuel_used: FUEL CONS / FUEL USED. refuel: REFUEL.
- aircraft_type (ICAO designator) and registration — only if shown.
- landings_day: number of landings on this flight — e.g. the value in a LANDING row (THIS FLIGHT column).
- max_fl: number (flight level, no FL prefix). flight_rules: "VFR" or "IFR".

Rules:
- Use values for THIS flight, never cumulative totals (e.g. a CUMUL DATA column). In photos a value column can look shifted against its labels — match values to labels by counting rows from the top of the list.
- On ACARS pages a clock time on the "--TIMES--" line or next to "<RETURN" is the CURRENT time, not a flight time — ignore it. PRINT, SENSORS and page numbers ("1/5") are menu items.
- Never guess — only return what you can clearly read.`;

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// "05:02:40" / "5:02" / "0502" → "05:02" (sekunder kapas — samma som ACARS egen block-/flygtid).
function clock(v: unknown): string {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[:.h]?(\d{2})(?:[:.]\d{2})?$/);
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? `${pad2(h)}:${pad2(mi)}` : '';
}
// Varaktighet: "02:46" → 2.7667 h, "1.3" → 1.3 h.
function duration(v: unknown): number {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,3})[:h](\d{2})/);
  if (m) return +m[1] + Math.min(59, +m[2]) / 60;
  return num(s.replace(',', '.'));
}
// Tid mellan två klockslag (över midnatt).
function between(a: string, b: string): number {
  if (!a || !b) return 0;
  const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number);
  let mins = bh * 60 + bm - (ah * 60 + am);
  if (mins <= 0) mins += 1440;
  return mins / 60;
}
// Datum: helt datum vinner; annars dag (+ ev. månad) → senast passerade sådant datum (aldrig i framtiden).
function inferDate(full: unknown, dayV: unknown, monthV: unknown): { date: string; inferred: boolean } {
  const f = String(full ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(new Date(f).getTime())) return { date: f, inferred: false };
  const day = Math.trunc(num(dayV)), month = Math.trunc(num(monthV));
  if (day < 1 || day > 31 || month > 12) return { date: '', inferred: false };
  const now = new Date();
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // i morgon (tidszoner)
  let d: Date;
  if (month) {
    d = new Date(now.getFullYear(), month - 1, day);
    if (d > limit) d = new Date(now.getFullYear() - 1, month - 1, day);
  } else {
    d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d > limit) d = new Date(now.getFullYear(), now.getMonth() - 1, day);
  }
  if (d.getDate() !== day) return { date: '', inferred: false }; // t.ex. 31 i en kort månad
  return { date: isoOf(d), inferred: true };
}
const icao = (v: unknown) => { const s = String(v ?? '').trim().toUpperCase(); return /^[A-Z0-9]{4}$/.test(s) ? s : ''; };

/** Läser bilden → normaliserad flygdata. Kastar vid AI-/nätverksfel. */
export async function scanFlightImage(uri: string): Promise<FlightScanResult> {
  const base64 = await prepareScanImage(uri);
  const p = await callAnthropicJson<Record<string, any>>({
    system: systemPrompt(isoOf(new Date())),
    maxTokens: 1000,
    temperature: 0,
    timeoutMs: 60000,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
      { type: 'text', text: 'Extract all flight data you can read from this image.' },
    ],
  });

  const out_utc = clock(p?.out_utc), off_utc = clock(p?.off_utc), on_utc = clock(p?.on_utc), in_utc = clock(p?.in_utc);
  // Saknas BLOCK/FLIGHT på sidan → räkna fram ur OUT/IN resp. OFF/ON.
  const block_h = duration(p?.block_time ?? p?.aircraft_time) || between(out_utc, in_utc);
  const flight_h = duration(p?.flight_time) || between(off_utc, on_utc);
  const { date, inferred } = inferDate(p?.date, p?.date_day, p?.date_month);

  const unit = String(p?.fuel_unit ?? '').toLowerCase();
  const fOut = num(p?.fob_out), fOn = num(p?.fob_on), fIn = num(p?.fob_in);
  const fEnd = fIn || fOn; // sista kända FOB (IN, annars vid landning)
  const used = num(p?.fuel_used) || (fOut && fEnd && fOut > fEnd ? Math.round((fOut - fEnd) * 100) / 100 : 0);
  const refuel = num(p?.refuel);
  const fuel = fOut || fEnd || used || refuel
    ? { unit: ['t', 'kg', 'lb'].includes(unit) ? unit : '', ...(fOut ? { out: fOut } : {}), ...(fIn ? { in: fIn } : fOn ? { on: fOn } : {}), ...(used ? { used } : {}), ...(refuel ? { refuel } : {}) }
    : null;

  const rules = String(p?.flight_rules ?? '').toUpperCase();
  return {
    date,
    dateInferred: inferred,
    flight_no: String(p?.flight_no ?? '').trim().replace(/-+$/, '').toUpperCase(),
    dep_place: icao(p?.dep_place),
    arr_place: icao(p?.arr_place),
    out_utc, off_utc, on_utc, in_utc,
    block_h: Math.round(block_h * 10000) / 10000,
    flight_h: Math.round(flight_h * 10000) / 10000,
    aircraft_type: String(p?.aircraft_type ?? '').trim().toUpperCase(),
    registration: String(p?.registration ?? '').trim().toUpperCase(),
    max_fl: num(p?.max_fl) ? String(Math.round(num(p?.max_fl))) : '',
    // Landningar: avläst antal, annars 1 när både start (OFF) och landning (ON) syns.
    landings: Math.trunc(num(p?.landings_day)) || (off_utc && on_utc ? 1 : 0),
    flight_rules: rules === 'VFR' || rules === 'IFR' ? rules : '',
    fuel,
  };
}

/** Bränsleraden till remarks: "Fuel 7.8 → 2.1 t, used 5.7 t, refuel 5.26 t". */
export function fuelRemark(f: FlightScanFuel): string {
  const u = f.unit ? ` ${f.unit}` : '';
  const parts: string[] = [];
  if (f.out != null && f.in != null) parts.push(`${f.out} → ${f.in}${u}`);
  else if (f.out != null && f.on != null) parts.push(`${f.out} → ${f.on}${u} at landing`);
  else if (f.out != null) parts.push(`${f.out}${u} at off blocks`);
  if (f.used != null) parts.push(`used ${f.used}${u}${f.in == null && f.on != null ? ' to landing' : ''}`);
  if (f.refuel != null) parts.push(`refuel ${f.refuel}${u}`);
  return parts.length ? `Fuel ${parts.join(', ')}` : '';
}
