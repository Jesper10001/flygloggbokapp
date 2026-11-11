// Dela en flygning med sin second pilot (steg 1, bara pilotläget). Avsändaren skickar flygningen som en länk
// (blades://shared-flight?d=…) eller som en fil (.bladesflight); mottagaren får den i Log flight med rollerna
// omvända och sparar själv. Ren modul utan importer: allt här går att köra i Node (scripts/test-flight-share.cjs).
//
// Regler (användarens beslut 2026-11-11):
//  - Landningar, starter, tider, natt, IFR/VFR, inflygningar och rutt: samma hos mottagaren som hos avsändaren.
//  - Pilot flying skickas inte: mottagarens app fyller i den själv som för vilken ny flygning som helst.
//  - Remarks följer med, men besättningsraden ("SIC: Sam Berg") tas bort — Log flight skriver en ny med
//    avsändaren och avsändarens roll.
//  - Inkommande data är opålitlig (vem som helst kan skapa en länk): allt kontrolleras och kapas här, och
//    ingenting sparas förrän mottagaren trycker Save i Log flight.

export const SHARE_VERSION = 1;
export const SHARE_LINK_PREFIX = 'blades://shared-flight?d=';
export const SHARE_FILE_EXT = 'bladesflight';

export type OwnRole = 'pic' | 'co_pilot' | 'dual' | 'picus' | 'spic' | 'ferry_pic' | 'observer' | 'relief_crew';

/** Fälten som skickas. Tal är timmar (decimalt) eller antal, precis som i flights-tabellen. */
export interface SharedFlight {
  date: string; aircraft_type: string; registration: string;
  dep_place: string; dep_utc: string; arr_place: string; arr_utc: string;
  dep_place_raw: string; arr_place_raw: string;
  total_time: number; ifr: number; vfr: number; night: number; nvg: number;
  flight_rules: string; flight_type: string; stop_place: string;
  multi_pilot: number; single_pilot: number;
  pic: number; co_pilot: number; dual: number; picus: number; spic: number; instructor: number;
  ferry_pic: number; observer: number; relief_crew: number;
  second_pilot_role: string; extra_pilots: string;
  landings_day: number; landings_night: number; takeoffs_day: number; takeoffs_night: number;
  tng_count: number; app_2d: number; app_3d: number; holds: number; max_fl: number;
  remarks: string;
}

export interface SharedPayload {
  app: 'blades'; kind: 'flight'; v: number;
  from: { name: string; initials: string };
  f: SharedFlight;
}

const HOURS: (keyof SharedFlight)[] = ['total_time', 'ifr', 'vfr', 'night', 'nvg', 'multi_pilot', 'single_pilot',
  'pic', 'co_pilot', 'dual', 'picus', 'spic', 'instructor', 'ferry_pic', 'observer', 'relief_crew'];
const COUNTS: (keyof SharedFlight)[] = ['landings_day', 'landings_night', 'takeoffs_day', 'takeoffs_night',
  'tng_count', 'app_2d', 'app_3d', 'holds', 'max_fl'];
const TEXTS: [keyof SharedFlight, number][] = [['aircraft_type', 24], ['registration', 14], ['dep_place', 40], ['arr_place', 40],
  ['dep_place_raw', 40], ['arr_place_raw', 40], ['stop_place', 40], ['remarks', 1500]];
const RULES = ['VFR', 'IFR', 'Y', 'Z', 'Mixed'];
const TYPES = ['normal', 'hot_refuel', 'touch_and_go'];
const SP_KEYS = ['PIC', 'COP', 'FI', 'SPIC', 'PICUS'];

// ── Text ─────────────────────────────────────────────────────────────────────

/** Tar bort styrtecken (utom radbrytning i remarks) och kapar längden. */
function cleanText(v: unknown, max: number, multiline = false): string {
  if (typeof v !== 'string') return '';
  const re = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return v.replace(/\r\n?/g, '\n').replace(re, '').trim().slice(0, max);
}
function num(v: unknown, max: number, integer = false): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  const c = Math.min(n, max);
  return integer ? Math.round(c) : Math.round(c * 10000) / 10000;
}

// ── base64url över UTF-8 (Hermes saknar inte btoa, men den klarar inte å/ä/ö utan omvägar) ──

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function utf8String(b: number[]): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    let cp = c;
    if (c >= 0xf0) { cp = ((c & 7) << 18) | ((b[++i] & 63) << 12) | ((b[++i] & 63) << 6) | (b[++i] & 63); }
    else if (c >= 0xe0) { cp = ((c & 15) << 12) | ((b[++i] & 63) << 6) | (b[++i] & 63); }
    else if (c >= 0xc0) { cp = ((c & 31) << 6) | (b[++i] & 63); }
    if (!Number.isFinite(cp)) continue;
    if (cp >= 0x10000) { cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
    else s += String.fromCharCode(cp);
  }
  return s;
}
export function toBase64Url(s: string): string {
  const b = utf8Bytes(s);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64[n & 63];
  }
  return out;
}
export function fromBase64Url(s: string): string | null {
  const t = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(t)) return null;
  const b: number[] = [];
  for (let i = 0; i < t.length; i += 4) {
    const q = [0, 1, 2, 3].map((k) => (i + k < t.length ? B64.indexOf(t[i + k]) : -1));
    const n = (Math.max(q[0], 0) << 18) | (Math.max(q[1], 0) << 12) | (Math.max(q[2], 0) << 6) | Math.max(q[3], 0);
    b.push((n >> 16) & 255);
    if (q[2] >= 0) b.push((n >> 8) & 255);
    if (q[3] >= 0) b.push(n & 255);
  }
  return utf8String(b);
}

// ── Avsändaren ───────────────────────────────────────────────────────────────

/** Besättningsraden i remarks ("SIC: Sam Berg, FI: A. Berg"): varje post börjar med en pilotroll. */
const PILOT_ENTRY = /^(?:PIC|SIC|FI|SPIC|PICUS): /;
export function stripPilotLines(remarks: string): string {
  return (remarks || '').split('\n').filter((ln) => {
    const parts = ln.trim().split(', ').map((p) => p.trim()).filter(Boolean);
    return !(parts.length > 0 && parts.every((p) => PILOT_ENTRY.test(p)));
  }).join('\n').trim();
}

/** Går flygningen att dela? Simulatorpass och summarader (Backfill) delas inte. */
export function canShareFlight(f: { flight_type?: string | null; total_time?: number | null }): boolean {
  const t = f.flight_type ?? 'normal';
  return TYPES.includes(t) && (Number(f.total_time) || 0) > 0;
}

export function buildSharePayload(flight: Record<string, any>, sender: { name: string; initials: string }): SharedPayload {
  return sanitizePayload({ app: 'blades', kind: 'flight', v: SHARE_VERSION, from: sender, f: flight }) as SharedPayload;
}

/** Kompakt form för länken: nollor och tomma fält tas bort (läggs tillbaka av sanitizePayload). */
export function encodePayload(p: SharedPayload): string {
  const f: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.f)) if (v !== 0 && v !== '') f[k] = v;
  return toBase64Url(JSON.stringify({ app: p.app, kind: p.kind, v: p.v, from: p.from, f }));
}
export function toShareLink(p: SharedPayload): string { return SHARE_LINK_PREFIX + encodePayload(p); }
export function toShareFileText(p: SharedPayload): string { return JSON.stringify(p, null, 2); }
export function shareFileName(p: SharedPayload): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9-]/g, '');
  return `Blades flight ${safe(p.f.dep_place_raw || p.f.dep_place) || 'DEP'}-${safe(p.f.arr_place_raw || p.f.arr_place) || 'ARR'} ${p.f.date}.${SHARE_FILE_EXT}`;
}

const SHARE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * En rad som säger vilken flygning det är: "Blades flight ESSA → ESGG, 29 Oct 2026, from Sam Berg". Skickas som
 * text tillsammans med länken, så att den står överst i delningsrutan och i meddelandet hos mottagaren (själva
 * länken är bara en lång teckenrad).
 */
export function shareTitle(p: SharedPayload): string {
  const dep = (p.f.dep_place_raw || p.f.dep_place || '').trim() || 'DEP';
  const arr = (p.f.arr_place_raw || p.f.arr_place || '').trim() || 'ARR';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.f.date || '');
  const month = m ? SHARE_MONTHS[Number(m[2]) - 1] : undefined;
  const date = m && month ? `${Number(m[3])} ${month} ${m[1]}` : (p.f.date || '');
  const from = (p.from?.name || '').trim();
  return `Blades flight ${dep} → ${arr}${date ? `, ${date}` : ''}${from ? `, from ${from}` : ''}`;
}

// ── Mottagaren: läs och kontrollera ──────────────────────────────────────────

export type DecodeResult =
  | { ok: true; payload: SharedPayload }
  | { ok: false; reason: 'empty' | 'unreadable' | 'not-a-flight' | 'newer' | 'incomplete' };

function sanitizePayload(raw: any): SharedPayload | 'not-a-flight' | 'newer' | 'incomplete' {
  if (!raw || typeof raw !== 'object' || raw.app !== 'blades' || raw.kind !== 'flight') return 'not-a-flight';
  const v = Number(raw.v);
  if (!Number.isFinite(v) || v < 1) return 'not-a-flight';
  if (v > SHARE_VERSION) return 'newer';
  const s = raw.f && typeof raw.f === 'object' ? raw.f : null;
  if (!s) return 'incomplete';
  const f = {} as SharedFlight;
  const date = cleanText(s.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return 'incomplete';
  f.date = date;
  for (const [k, max] of TEXTS) (f as any)[k] = cleanText(s[k], max, k === 'remarks');
  const hhmm = (x: unknown) => { const t = cleanText(x, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : ''; };
  f.dep_utc = hhmm(s.dep_utc); f.arr_utc = hhmm(s.arr_utc);
  for (const k of HOURS) (f as any)[k] = num(s[k], 99.99);
  for (const k of COUNTS) (f as any)[k] = num(s[k], k === 'max_fl' ? 999 : 99, true);
  f.flight_rules = RULES.includes(s.flight_rules) ? s.flight_rules : (f.ifr > 0 ? 'IFR' : 'VFR');
  f.flight_type = TYPES.includes(s.flight_type) ? s.flight_type : (s.flight_type == null ? 'normal' : '');
  if (!f.flight_type) return 'incomplete';   // sim eller summarad
  f.second_pilot_role = SP_KEYS.includes(s.second_pilot_role) ? s.second_pilot_role : (s.second_pilot_role === 'SIC' ? 'COP' : '');
  // Fler piloter: lista med { role, name }, högst sex.
  let extras: { role: string; name: string }[] = [];
  try {
    const arr = typeof s.extra_pilots === 'string' && s.extra_pilots ? JSON.parse(s.extra_pilots) : s.extra_pilots;
    if (Array.isArray(arr)) {
      extras = arr.slice(0, 6).map((p: any) => ({ role: SP_KEYS.includes(p?.role) ? p.role : '', name: cleanText(p?.name, 60) })).filter((p) => p.name);
    }
  } catch { /* trasig lista → inga fler piloter */ }
  f.extra_pilots = extras.length ? JSON.stringify(extras) : '';
  if (!f.dep_place && f.dep_place_raw) f.dep_place = f.dep_place_raw;
  if (!f.arr_place && f.arr_place_raw) f.arr_place = f.arr_place_raw;
  if (f.total_time <= 0 || !f.dep_place || !f.arr_place) return 'incomplete';
  // Deltider kan aldrig vara längre än flygningen.
  for (const k of HOURS) if (k !== 'total_time' && (f as any)[k] > f.total_time + 0.01) (f as any)[k] = f.total_time;
  const from = raw.from && typeof raw.from === 'object' ? raw.from : {};
  return { app: 'blades', kind: 'flight', v, from: { name: cleanText(from.name, 60), initials: cleanText(from.initials, 6) }, f };
}

/** Tar emot en länk, bara d-värdet, eller filens JSON-text. */
export function decodeSharedFlight(input: string): DecodeResult {
  let t = (input || '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > 20000) return { ok: false, reason: 'unreadable' };
  let raw: any = null;
  if (t.startsWith('{')) {
    try { raw = JSON.parse(t); } catch { return { ok: false, reason: 'unreadable' }; }
  } else {
    const m = t.match(/[?&]d=([^&#\s]+)/);
    if (m) { try { t = decodeURIComponent(m[1]); } catch { t = m[1]; } }
    const json = fromBase64Url(t);
    if (!json) return { ok: false, reason: 'unreadable' };
    try { raw = JSON.parse(json); } catch { return { ok: false, reason: 'unreadable' }; }
  }
  const p = sanitizePayload(raw);
  if (typeof p === 'string') return { ok: false, reason: p };
  return { ok: true, payload: p };
}

// ── Mottagaren: omvända roller ───────────────────────────────────────────────

export const ROLE_LABEL: Record<OwnRole, string> = {
  pic: 'PIC', co_pilot: 'SIC', dual: 'Dual', picus: 'PICUS', spic: 'SPIC',
  ferry_pic: 'Ferry PIC', observer: 'Observer', relief_crew: 'Relief crew',
};
const SP_SHORT: Record<string, string> = { PIC: 'PIC', COP: 'SIC', FI: 'FI', SPIC: 'SPIC', PICUS: 'PICUS' };

export function senderRole(f: SharedFlight): { role: OwnRole; fi: boolean } {
  const role: OwnRole = f.pic > 0 ? 'pic' : f.co_pilot > 0 ? 'co_pilot' : f.dual > 0 ? 'dual' : f.picus > 0 ? 'picus'
    : f.spic > 0 ? 'spic' : f.ferry_pic > 0 ? 'ferry_pic' : f.observer > 0 ? 'observer' : f.relief_crew > 0 ? 'relief_crew' : 'pic';
  return { role, fi: f.instructor > 0 && ['pic', 'picus', 'spic', 'ferry_pic'].includes(role) };
}

export interface ReversedFlight {
  /** Mottagarens egen roll i Log flight. */
  role: OwnRole; fi: boolean;
  /** Avsändaren som mottagarens second pilot: rollnyckel som i Log flight (PIC/COP/FI/SPIC/PICUS eller tom). */
  secondPilotRole: string;
  /** Texter till sammanfattningen: vad avsändaren loggade och vad mottagaren får. */
  senderRoleLabel: string; receiverRoleLabel: string; senderAsSecondLabel: string; receiverAsSecondLabel: string;
  /** Remarks utan avsändarens besättningsrad. */
  remarks: string;
}

export function reverseRoles(p: SharedPayload): ReversedFlight {
  const s = senderRole(p.f);
  // Mottagarens roll: det avsändaren angav för sin second pilot. Angavs ingen roll: motsatsen till avsändarens egen.
  let role: OwnRole; let fi = false;
  switch (p.f.second_pilot_role) {
    case 'PIC': role = 'pic'; break;
    case 'COP': role = 'co_pilot'; break;
    case 'FI': role = 'pic'; fi = true; break;
    case 'SPIC': role = 'spic'; break;
    case 'PICUS': role = 'picus'; break;
    default:
      if (s.role === 'pic') role = s.fi ? 'dual' : 'co_pilot';
      else if (s.role === 'co_pilot' || s.role === 'picus') role = 'pic';
      else if (s.role === 'dual' || s.role === 'spic') { role = 'pic'; fi = true; }
      else if (s.role === 'ferry_pic') role = 'co_pilot';
      else role = 'pic';
  }
  const secondPilotRole = s.role === 'pic' ? (s.fi ? 'FI' : 'PIC') : s.role === 'co_pilot' ? 'COP' : s.role === 'picus' ? 'PICUS'
    : s.role === 'spic' ? 'SPIC' : s.role === 'ferry_pic' ? 'PIC' : '';
  const label = (r: OwnRole, isFi: boolean) => (isFi ? `${ROLE_LABEL[r]} · FI` : ROLE_LABEL[r]);
  return {
    role, fi, secondPilotRole,
    senderRoleLabel: label(s.role, s.fi),
    receiverRoleLabel: label(role, fi),
    senderAsSecondLabel: secondPilotRole ? SP_SHORT[secondPilotRole] : ROLE_LABEL[s.role],
    receiverAsSecondLabel: p.f.second_pilot_role ? SP_SHORT[p.f.second_pilot_role] : label(role, fi),
    remarks: stripPilotLines(p.f.remarks),
  };
}

/**
 * Formulärvärdena till Log flight (strängar, som FlightFormData). Rolltiderna sätts av Log flight efter
 * rollen; här nollas de. Pilot flying lämnas tom: Log flight fyller i den själv.
 */
export function toFormValues(p: SharedPayload, rev: ReversedFlight, secondPilotName: string, aircraft: { type: string; registration: string }): Record<string, string> {
  const f = p.f;
  // Samma regel som vid Edit: knappen VFR / Y·Z / IFR följer tiderna.
  let rules = f.flight_rules || 'VFR';
  let vfr = f.vfr;
  if (f.total_time > 0 && f.ifr > 0.01) {
    if (f.ifr >= f.total_time - 0.01) rules = 'IFR';
    else {
      if (rules !== 'Y' && rules !== 'Z' && rules !== 'Mixed') rules = 'Y';
      if (Math.abs(f.ifr + f.vfr - f.total_time) > 0.05) vfr = Math.round((f.total_time - f.ifr) * 100) / 100;
    }
  }
  const s = (n: number) => String(n);
  return {
    date: f.date,
    aircraft_type: aircraft.type, registration: aircraft.registration,
    dep_place: f.dep_place, dep_utc: f.dep_utc, arr_place: f.arr_place, arr_utc: f.arr_utc,
    dep_place_raw: f.dep_place_raw || f.dep_place, arr_place_raw: f.arr_place_raw || f.arr_place,
    total_time: s(f.total_time), ifr: s(f.ifr), vfr: s(vfr), night: s(f.night), nvg: s(f.nvg),
    flight_rules: rules, flight_type: f.flight_type, stop_place: f.stop_place,
    multi_pilot: s(f.multi_pilot), single_pilot: s(f.single_pilot),
    pic: '0', co_pilot: '0', dual: '0', picus: '0', spic: '0', instructor: '0', examiner: '0', safety_pilot: '0',
    observer: '0', ferry_pic: '0', relief_crew: '0',
    second_pilot: secondPilotName, second_pilot_role: rev.secondPilotRole, extra_pilots: f.extra_pilots,
    landings_day: s(f.landings_day), landings_night: s(f.landings_night),
    takeoffs_day: s(f.takeoffs_day), takeoffs_night: s(f.takeoffs_night),
    tng_count: s(f.tng_count), app_2d: s(f.app_2d), app_3d: s(f.app_3d), holds: s(f.holds),
    max_fl: f.max_fl > 0 ? s(f.max_fl) : '',
    pilot_flying: '',
    remarks: rev.remarks,
  };
}

// ── Mottagaren: flygplanet mot den egna Fleet ────────────────────────────────

export interface FleetRow { registration: string; aircraft_type: string; n: number }
export interface AircraftOption { type: string; registration: string; source: 'yours' | 'sent'; flights: number }
export type AircraftMatch = { kind: 'exact'; type: string; registration: string } | { kind: 'ask'; options: AircraftOption[] };

const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Stämmer typ och registrering exakt med något mottagaren redan har (eller har mottagaren inga flygplan alls)
 * används det direkt. Annars får mottagaren välja: sina egna närmaste, eller det avsändaren skrev.
 */
export function matchAircraft(sent: { type: string; registration: string }, fleet: FleetRow[]): AircraftMatch {
  const type = (sent.type || '').toUpperCase().trim();
  const reg = (sent.registration || '').toUpperCase().trim();
  if (fleet.length === 0) return { kind: 'exact', type, registration: reg };
  if (fleet.some((r) => r.registration === reg && r.aircraft_type === type)) return { kind: 'exact', type, registration: reg };
  const options: AircraftOption[] = [];
  const add = (o: AircraftOption) => { if (!options.some((x) => x.type === o.type && x.registration === o.registration)) options.push(o); };
  // 1. Samma registrering (även skriven annorlunda, SEJRA / SE-JRA) hos mottagaren.
  fleet.filter((r) => norm(r.registration) === norm(reg) && norm(reg) !== '')
    .sort((a, b) => b.n - a.n)
    .forEach((r) => add({ type: r.aircraft_type, registration: r.registration, source: 'yours', flights: r.n }));
  // 2. Samma typ (även skriven annorlunda, AW-139 / AW139) hos mottagaren, med avsändarens registrering.
  if (options.length === 0) {
    const byType = new Map<string, number>();
    fleet.filter((r) => norm(r.aircraft_type) === norm(type) && norm(type) !== '')
      .forEach((r) => byType.set(r.aircraft_type, (byType.get(r.aircraft_type) ?? 0) + r.n));
    [...byType.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([t, n]) => add({ type: t, registration: reg, source: t === type ? 'sent' : 'yours', flights: n }));
  }
  // 3. Som avsändaren skrev det.
  add({ type, registration: reg, source: 'sent', flights: 0 });
  return { kind: 'ask', options };
}

/** Avsändarens namn så som mottagaren redan skriver det (hela namnet eller initialerna), annars hela namnet. */
export function pickSecondPilotName(from: { name: string; initials: string }, known: string[]): string {
  const hit = (v: string) => (v ? known.find((k) => k.trim().toLowerCase() === v.trim().toLowerCase()) : undefined);
  return hit(from.name) ?? hit(from.initials) ?? from.name ?? from.initials ?? '';
}
