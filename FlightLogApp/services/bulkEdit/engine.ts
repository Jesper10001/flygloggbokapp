// Ändra många flygningar på en gång (app/bulk-edit.tsx): motorn. Ren kod utan databas och gränssnitt,
// så att den kan testas i Node (scripts/test-bulk-edit.cjs).
//
// planBulkEdit(läge, flygningar, ändring) ger en PLAN: vilka fält som ändras på vilka flygningar (från → till),
// vilka flygningar som lämnas och varför, och totalerna före och efter. Ingenting skrivs här; planen visas
// för användaren och sparas sedan av db/bulkEdits.ts (med ångra).
//
// Regler som gäller alla ändringar:
//  - Summeringsrader och "Blades previous experience" rörs aldrig (de är inga flygningar).
//  - Pilotläget: simulatorpass rörs inte (deras tid är inte flygtid).
//  - En tid blir aldrig större än tiden den är en del av (NVG ≤ natt ≤ flygtid).
//  - Fält som hänger ihop ändras tillsammans, på samma sätt som Log flight gör (roll → tidskolumnerna,
//    flygregler → IFR/VFR-tid, siktläge → uppdelningen).

export type BulkMode = 'pilot' | 'drone';
export type BulkRow = { id: number } & Record<string, any>;
export type BulkValue = number | string;
export interface FieldChange { from: BulkValue; to: BulkValue }
export interface PlannedChange { id: number; fields: Record<string, FieldChange> }
export interface SkippedRow { id: number; reason: string }
export interface FieldTotal { field: string; label: string; before: number; after: number; int: boolean }
export interface BulkPlan {
  changes: PlannedChange[];
  skipped: SkippedRow[];     // lämnas: ändringen passar inte flygningen
  unchanged: number;         // har redan värdet
  totals: FieldTotal[];      // tidsfälten som ändras, summerade över ALLA flygningar i läget
}

export type BulkOp =
  | { kind: 'fill'; field: string; of: string; pct: number }      // field = of × pct / 100 (pct 0 = ta bort)
  | { kind: 'role'; role: string }                                // egen roll
  | { kind: 'crew'; multi: boolean }                              // pilotläget: single- eller multi-pilot
  | { kind: 'rules'; rules: 'VFR' | 'IFR' }                       // pilotläget: flygregler
  | { kind: 'set'; field: string; value: string }                 // drönarläget: kategori, siktläge, uppdrag; pilotläget: typ, registrering
  | { kind: 'night'; values: Record<number, number> }             // pilotläget: nattid räknad ur rutt och tider
  | { kind: 'codes'; values: Record<number, { dep?: string; arr?: string }> }   // pilotläget: flygplatskoderna som visas (ICAO eller IATA)
  | { kind: 'bump'; what: 'takeoffs' | 'landings'; delta: 1 | -1 }               // pilotläget: en start eller landning mer eller mindre
  | { kind: 'remarks'; add?: string; remove?: string }                          // pilotläget: lägg till eller ta bort text i remarks
  | { kind: 'delete' };                                                         // pilotläget: radera flygningarna (går att ångra)

/** Markören för en raderad flygning i planen (db/bulkEdits.ts sparar hela raden så att den kan läggas tillbaka). */
export const DELETED_FIELD = '__deleted';

// ── Fälten ──────────────────────────────────────────────────────────────────

/** Kolumnerna som får skrivas (db/bulkEdits.ts släpper inte igenom något annat). */
export const BULK_COLUMNS: Record<BulkMode, readonly string[]> = {
  pilot: ['nvg', 'night', 'cross_country', 'pilot_flying', 'pic', 'co_pilot', 'dual', 'picus', 'spic', 'ferry_pic', 'observer',
    'relief_crew', 'instructor', 'examiner', 'safety_pilot', 'multi_pilot', 'single_pilot', 'flight_rules', 'ifr', 'vfr',
    'aircraft_type', 'registration', 'dep_place_raw', 'arr_place_raw', 'takeoffs_day', 'takeoffs_night', 'landings_day', 'landings_night',
    'remarks'],
  drone: ['night_time', 'is_night', 'category', 'flight_mode', 'h_vlos', 'h_evlos', 'h_bvlos', 'operation_type',
    'pilot_role', 'co_pilot_fpv', 'dual', 'instructor'],
};
const TEXT_FIELDS = new Set(['flight_rules', 'category', 'flight_mode', 'operation_type', 'pilot_role',
  'aircraft_type', 'registration', 'dep_place_raw', 'arr_place_raw', 'remarks', DELETED_FIELD]);
const INT_FIELDS = new Set(['is_night']);   // ja/nej
const COUNT_FIELDS = new Set(['takeoffs_day', 'takeoffs_night', 'landings_day', 'landings_night']);   // antal
export const isTextField = (f: string) => TEXT_FIELDS.has(f);
export const isCountField = (f: string) => COUNT_FIELDS.has(f);

export const FIELD_LABEL: Record<string, string> = {
  nvg: 'NVG', night: 'Night', cross_country: 'Cross-country', pilot_flying: 'Pilot flying', total_time: 'Flight time',
  pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual', picus: 'PICUS', spic: 'SPIC', ferry_pic: 'Ferry PIC', observer: 'Observer',
  relief_crew: 'Relief crew', instructor: 'Instructor', examiner: 'Examiner', safety_pilot: 'Safety pilot',
  multi_pilot: 'Multi-pilot', single_pilot: 'Single-pilot', flight_rules: 'Flight rules', ifr: 'IFR', vfr: 'VFR',
  night_time: 'Night', is_night: 'Night flight', category: 'Category', flight_mode: 'Sight mode',
  h_vlos: 'VLOS', h_evlos: 'EVLOS', h_bvlos: 'BVLOS', operation_type: 'Operation', pilot_role: 'Role', co_pilot_fpv: 'Co-pilot',
  aircraft_type: 'Type', registration: 'Registration', dep_place_raw: 'Departure', arr_place_raw: 'Arrival', remarks: 'Remarks',
  takeoffs_day: 'Take-offs day', takeoffs_night: 'Take-offs night', landings_day: 'Landings day', landings_night: 'Landings night',
  [DELETED_FIELD]: 'Flight',
};

// Pilotläget: rollens tidskolumn får flygtiden, de andra rollkolumnerna nollas (som Log flight).
export const PILOT_ROLES: { key: string; label: string }[] = [
  { key: 'pic', label: 'PIC' }, { key: 'co_pilot', label: 'Co-pilot (SIC)' }, { key: 'dual', label: 'Dual' },
  { key: 'picus', label: 'PICUS' }, { key: 'spic', label: 'SPIC' },
];
const PILOT_ROLE_COLS = ['pic', 'co_pilot', 'dual', 'picus', 'spic', 'ferry_pic', 'observer', 'relief_crew'];
const INSTRUCTOR_ROLES = new Set(['pic', 'picus', 'spic', 'ferry_pic']);

// Drönarläget: rollens tidshink (constants/droneRoles.ts droneRoleColumn; PIC har ingen egen hink).
export const DRONE_ROLES: { key: string; label: string }[] = [
  { key: 'pic', label: 'PIC' }, { key: 'sic', label: 'Co-pilot (SIC)' }, { key: 'dual', label: 'Student (dual)' },
  { key: 'instructor', label: 'Instructor' }, { key: 'observer', label: 'Observer' }, { key: 'payload', label: 'Payload operator' },
];
const DRONE_ROLE_COL: Record<string, 'co_pilot_fpv' | 'dual' | 'instructor' | ''> = {
  pic: '', rpic: '', examiner: '', sic: 'co_pilot_fpv', safety_pilot: 'co_pilot_fpv', dual: 'dual', instructor: 'instructor',
  observer: '', payload: '', mission_commander: '',
};

// Pilotläget: ändringarna är ordnade som kolumnerna i loggboken (app/bulk-edit.tsx visar dem som ett rutnät).
export const PILOT_COLUMNS: { key: string; title: string; sub: string; icon: string }[] = [
  { key: 'aircraft', title: 'Aircraft', sub: 'Type, registration', icon: 'airplane-outline' },
  { key: 'route', title: 'Route', sub: 'ICAO or IATA codes', icon: 'location-outline' },
  { key: 'crew', title: 'Single · multi pilot', sub: 'How the hours count', icon: 'people-outline' },
  { key: 'nvg', title: 'NVG', sub: 'Goggle time', icon: 'moon-outline' },
  { key: 'function', title: 'Pilot function', sub: 'Role, pilot flying', icon: 'id-card-outline' },
  { key: 'conditions', title: 'Conditions', sub: 'IFR, night, cross-country', icon: 'cloudy-night-outline' },
  { key: 'landings', title: 'Landings', sub: 'Take-offs, landings', icon: 'trending-down-outline' },
  { key: 'remarks', title: 'Remarks', sub: 'Add or remove text', icon: 'reorder-three-outline' },
  { key: 'cleanup', title: 'Clean up', sub: 'Duplicates, delete', icon: 'trash-outline' },
];

// ── Hjälpare ────────────────────────────────────────────────────────────────

const num = (v: any): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number): number => Math.round(n * 100) / 100;
const str = (v: any): string => (v === null || v === undefined ? '' : String(v));
const same = (field: string, a: BulkValue, b: BulkValue): boolean => (TEXT_FIELDS.has(field) ? str(a) === str(b) : Math.abs(num(a) - num(b)) < 0.005);
const count = (v: any): number => Math.max(0, Math.round(num(v)));
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Flygtiden för en rad (båda lägena har total_time). */
const total = (r: BulkRow) => num(r.total_time);

/** Rader som aldrig får ändras, med skälet (null = får ändras). */
export function protectedReason(mode: BulkMode, r: BulkRow): string | null {
  if (mode === 'pilot') {
    if (r.flight_type === 'summary' || r.remarks === '[BACKFILL]' || r.remarks === 'Blades previous experience') return 'Summary row';
    if (r.flight_type === 'sim') return 'Simulator session';
    return null;
  }
  return r.source === 'summary' ? 'Summary row' : null;
}

/** Nattiden för en rad. Drönarläget: äldre flygningar har bara nattflaggan (då hela flygtiden). */
export function nightOf(mode: BulkMode, r: BulkRow): number {
  if (mode === 'pilot') return num(r.night);
  const nt = num(r.night_time);
  return nt > 0 ? nt : num(r.is_night) ? total(r) : 0;
}

// ── Planen ──────────────────────────────────────────────────────────────────

type Target = Record<string, BulkValue> | { skip: string };

function targetFor(mode: BulkMode, r: BulkRow, op: BulkOp): Target {
  const tt = total(r);
  if (op.kind === 'fill') {
    const base = op.of === 'night' || op.of === 'night_time' ? nightOf(mode, r) : num(r[op.of]);
    if (op.pct > 0 && base <= 0) return { skip: op.of === 'total_time' ? 'No flight time' : `No ${FIELD_LABEL[op.of]?.toLowerCase() ?? op.of} time` };
    const v = r2(Math.max(0, Math.min(base, (base * op.pct) / 100)));
    if (mode === 'pilot' && op.field === 'nvg') {
      // NVG flygs inte under IFR (Log flight nollar NVG på en IFR-flygning).
      if (v > 0 && str(r.flight_rules).toUpperCase() === 'IFR') return { skip: 'IFR flight' };
      return { nvg: v };
    }
    if (mode === 'pilot' && op.field === 'night') {
      const out: Record<string, BulkValue> = { night: v };
      if (num(r.nvg) > v + 0.005) out.nvg = v;   // NVG kan inte vara mer än natten
      return out;
    }
    if (mode === 'drone' && op.field === 'night_time') return { night_time: v, is_night: v > 0 ? 1 : 0 };
    return { [op.field]: v };
  }
  if (op.kind === 'night') {
    const raw = op.values[r.id];
    if (raw === undefined || raw === null || !Number.isFinite(raw)) return { skip: 'No position or times' };
    const v = r2(Math.max(0, Math.min(tt, raw)));
    const out: Record<string, BulkValue> = { night: v };
    if (num(r.nvg) > v + 0.005) out.nvg = v;
    return out;
  }
  if (op.kind === 'codes') {
    const v = op.values[r.id];
    const out: Record<string, BulkValue> = {};
    if (v?.dep) out.dep_place_raw = v.dep;
    if (v?.arr) out.arr_place_raw = v.arr;
    return Object.keys(out).length ? out : { skip: 'No code for these airports' };
  }
  if (op.kind === 'bump') {
    const dayKey = `${op.what}_day`, nightKey = `${op.what}_night`;
    const day = count(r[dayKey]), night = count(r[nightKey]);
    if (op.delta > 0) {
      // Räknaren som redan används får en till; är båda noll avgör flygningen (hela flygningen i mörker → natt).
      const toNight = day === 0 && (night > 0 || (tt > 0 && num(r.night) >= tt - 0.005));
      return toNight ? { [nightKey]: night + 1 } : { [dayKey]: day + 1 };
    }
    if (day > 0) return { [dayKey]: day - 1 };
    if (night > 0) return { [nightKey]: night - 1 };
    return { skip: op.what === 'takeoffs' ? 'No take-off to remove' : 'No landing to remove' };
  }
  if (op.kind === 'remarks') {
    const cur = str(r.remarks);
    if (op.add !== undefined) {
      const text = op.add.trim();
      if (!text) return { skip: 'No text' };
      if (cur.split('\n').some((ln) => ln.trim().toLowerCase() === text.toLowerCase())) return { skip: 'Already in the remarks' };
      return { remarks: cur.trim() ? `${cur.replace(/\s+$/, '')}\n${text}` : text };
    }
    const text = (op.remove ?? '').trim();
    if (!text) return { skip: 'No text' };
    const re = new RegExp(escapeRe(text), 'gi');
    if (!re.test(cur)) return { skip: 'Text not in the remarks' };
    // Texten bort; rader som blir tomma försvinner, dubbla mellanslag och lösa skiljetecken i kanten städas.
    const next = cur.replace(re, '').split('\n').map((ln) => ln.replace(/ {2,}/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '')).filter((ln) => ln !== '').join('\n');
    return { remarks: next };
  }
  if (op.kind === 'set' && mode === 'pilot') {
    const value = str(op.value).trim().toUpperCase();
    if (!value) return { skip: 'No value' };
    return { [op.field]: value };
  }
  if (tt <= 0 && op.kind !== 'set') return { skip: 'No flight time' };
  if (op.kind === 'role' && mode === 'pilot') {
    const out: Record<string, BulkValue> = {};
    for (const c of PILOT_ROLE_COLS) out[c] = c === op.role ? tt : 0;
    // Påbyggnadsrollerna finns bara ihop med vissa roller (som i Log flight).
    out.instructor = num(r.instructor) > 0 && INSTRUCTOR_ROLES.has(op.role) ? tt : 0;
    out.examiner = num(r.examiner) > 0 && op.role === 'pic' ? tt : 0;
    out.safety_pilot = num(r.safety_pilot) > 0 && op.role === 'co_pilot' ? tt : 0;
    return out;
  }
  if (op.kind === 'role') {
    const col = DRONE_ROLE_COL[op.role] ?? '';
    return { pilot_role: op.role, co_pilot_fpv: col === 'co_pilot_fpv' ? tt : 0, dual: col === 'dual' ? tt : 0, instructor: col === 'instructor' ? tt : 0 };
  }
  if (op.kind === 'crew') return { multi_pilot: op.multi ? tt : 0, single_pilot: op.multi ? 0 : tt };
  if (op.kind === 'rules') {
    const out: Record<string, BulkValue> = { flight_rules: op.rules, ifr: op.rules === 'IFR' ? tt : 0, vfr: op.rules === 'VFR' ? tt : 0 };
    if (op.rules === 'IFR' && num(r.nvg) > 0) out.nvg = 0;
    return out;
  }
  if (op.kind !== 'set') return { skip: 'Not for this logbook' };
  // set (drönarläget)
  if (op.field === 'flight_mode') return { flight_mode: op.value, h_vlos: 0, h_evlos: 0, h_bvlos: 0 };   // ett rent läge: ingen uppdelning
  return { [op.field]: op.value };
}

export function planBulkEdit(mode: BulkMode, allRows: BulkRow[], selectedIds: Iterable<number>, op: BulkOp): BulkPlan {
  const allowed = new Set(BULK_COLUMNS[mode]);
  const picked = new Set(selectedIds);
  const changes: PlannedChange[] = [];
  const skipped: SkippedRow[] = [];
  let unchanged = 0;
  for (const r of allRows) {
    if (!picked.has(r.id)) continue;
    const guard = protectedReason(mode, r);
    if (guard) { skipped.push({ id: r.id, reason: guard }); continue; }
    if (op.kind === 'delete') { changes.push({ id: r.id, fields: { [DELETED_FIELD]: { from: 'In your logbook', to: 'Deleted' } } }); continue; }
    const t = targetFor(mode, r, op);
    if ('skip' in t && typeof (t as any).skip === 'string') { skipped.push({ id: r.id, reason: (t as { skip: string }).skip }); continue; }
    const fields: Record<string, FieldChange> = {};
    for (const [field, to] of Object.entries(t as Record<string, BulkValue>)) {
      if (!allowed.has(field)) continue;
      const from: BulkValue = TEXT_FIELDS.has(field) ? str(r[field]) : INT_FIELDS.has(field) ? (num(r[field]) ? 1 : 0) : COUNT_FIELDS.has(field) ? count(r[field]) : r2(num(r[field]));
      if (!same(field, from, to)) fields[field] = { from, to };
    }
    if (Object.keys(fields).length) changes.push({ id: r.id, fields });
    else unchanged++;
  }
  // Totalerna före och efter för tidsfälten som ändras, över alla flygningar (som statistiken räknar).
  const touched = new Set<string>();
  for (const c of changes) for (const f of Object.keys(c.fields)) if (!TEXT_FIELDS.has(f) && !INT_FIELDS.has(f)) touched.add(f);
  const delta: Record<string, number> = {};
  for (const c of changes) for (const [f, ch] of Object.entries(c.fields)) if (touched.has(f)) delta[f] = (delta[f] ?? 0) + num(ch.to) - num(ch.from);
  const totals: FieldTotal[] = [...touched].map((field) => {
    let before = 0;
    for (const r of allRows) before += num(r[field]);
    return { field, label: FIELD_LABEL[field] ?? field, before: r2(before), after: r2(before + (delta[field] ?? 0)), int: COUNT_FIELDS.has(field) };
  });
  if (op.kind === 'delete' && changes.length) {
    // Radering: flygtiden och antalet flygningar före och efter (simulatorpass och summeringsrader räknas inte).
    const gone = new Set(changes.map((c) => c.id));
    const real = allRows.filter((r) => !protectedReason(mode, r));
    const hours = (rows: BulkRow[]) => r2(rows.reduce((a, r) => a + total(r), 0));
    totals.push({ field: 'total_time', label: 'Flight time', before: hours(real), after: hours(real.filter((r) => !gone.has(r.id))), int: false });
    totals.push({ field: 'flights', label: 'Flights', before: real.length, after: real.length - gone.size, int: true });
  }
  return { changes, skipped, unchanged, totals };
}

/** Flygningarna som de blir med planen (för test och för att visa resultatet). */
export function applyPlan(rows: BulkRow[], plan: BulkPlan): BulkRow[] {
  const byId = new Map(plan.changes.map((c) => [c.id, c]));
  return rows.filter((r) => !byId.get(r.id)?.fields[DELETED_FIELD]).map((r) => {
    const c = byId.get(r.id);
    if (!c) return r;
    const next = { ...r };
    for (const [f, ch] of Object.entries(c.fields)) next[f] = ch.to;
    return next;
  });
}

/** Skälen till att flygningar lämnas, grupperade ("12 IFR flights"). */
export function skippedByReason(skipped: SkippedRow[]): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

// ── Förslagen ("Check your data") ───────────────────────────────────────────

export interface BulkSuggestion {
  id: string;
  icon: string;             // Ionicons-namn
  title: string;
  body: string;
  ids: number[];            // flygningarna det gäller
  column?: string;          // pilotläget: loggbokskolumnen förslaget hör till (PILOT_COLUMNS)
  op?: BulkOp;              // färdig ändring (annars väljer man själv)
  ask?: 'role' | 'crew' | 'category' | 'operation';   // ändringen man får välja värde för
  dismissLabel: string;
}

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export function suggestionsFor(mode: BulkMode, rows: BulkRow[]): BulkSuggestion[] {
  const real = rows.filter((r) => !protectedReason(mode, r));
  const out: BulkSuggestion[] = [];
  const add = (s: Omit<BulkSuggestion, 'ids'>, hit: (r: BulkRow) => boolean) => {
    const ids = real.filter(hit).map((r) => r.id);
    if (ids.length) out.push({ ...s, ids, title: s.title.replace('{n}', n(ids.length, 'flight')), body: s.body.replace('{it}', ids.length === 1 ? 'it' : 'them') });
  };
  if (mode === 'pilot') {
    add({ id: 'night_gt_total', column: 'conditions', icon: 'alert-circle-outline', title: '{n} with more night time than flight time', body: 'Night time can’t be longer than the flight. Set it to the flight time.', op: { kind: 'fill', field: 'night', of: 'total_time', pct: 100 }, dismissLabel: 'Leave as is' },
      (r) => num(r.night) > total(r) + 0.05 && total(r) > 0);
    add({ id: 'nvg_gt_night', column: 'nvg', icon: 'alert-circle-outline', title: '{n} with more NVG time than night time', body: 'NVG time can’t be longer than the night time. Set it to the night time.', op: { kind: 'fill', field: 'nvg', of: 'night', pct: 100 }, dismissLabel: 'Leave as is' },
      (r) => num(r.nvg) > num(r.night) + 0.05 && num(r.night) > 0);
    add({ id: 'no_role', column: 'function', icon: 'person-outline', title: '{n} with no role', body: 'No PIC, co-pilot or dual time is logged, so these hours are missing from your role totals. Pick the role you had.', ask: 'role', dismissLabel: 'Leave as is' },
      (r) => total(r) > 0 && [...PILOT_ROLE_COLS, 'instructor'].every((c) => num(r[c]) <= 0));
    add({ id: 'no_crew', column: 'crew', icon: 'people-outline', title: '{n} neither single-pilot nor multi-pilot', body: 'Blades can’t count these hours as single-pilot or multi-pilot time. Pick which {it} were.', ask: 'crew', dismissLabel: 'Leave as is' },
      (r) => total(r) > 0 && num(r.multi_pilot) <= 0 && num(r.single_pilot) <= 0);
    add({ id: 'nvg_missing', column: 'nvg', icon: 'moon-outline', title: '{n} at night with no NVG time', body: 'Did you fly {it} with goggles? Fill in NVG time for all of them at once.', op: { kind: 'fill', field: 'nvg', of: 'night', pct: 100 }, dismissLabel: 'I don’t use NVG' },
      (r) => num(r.night) > 0 && num(r.nvg) <= 0 && str(r.flight_rules).toUpperCase() !== 'IFR');
    // Samma datum, rutt, tider och flygtid som en annan flygning: den första behålls, kopiorna föreslås raderade.
    const seen = new Set<string>();
    const copies = new Set<number>();
    for (const r of [...real].sort((x, y) => x.id - y.id)) {
      if (!str(r.date) || !str(r.dep_utc) || !str(r.arr_utc)) continue;   // utan tider kan två lika flygningar vara två olika
      const key = [r.date, str(r.dep_place).toUpperCase(), str(r.arr_place).toUpperCase(), r.dep_utc, r.arr_utc, r2(total(r)), str(r.registration).toUpperCase()].join('|');
      if (seen.has(key)) copies.add(r.id); else seen.add(key);
    }
    add({ id: 'duplicates', column: 'cleanup', icon: 'copy-outline', title: '{n} logged twice', body: 'Same date, route, times and aircraft as another flight. Delete the extra copy and keep the first one.', op: { kind: 'delete' }, dismissLabel: 'They are separate flights' },
      (r) => copies.has(r.id));
  } else {
    add({ id: 'night_gt_total', icon: 'alert-circle-outline', title: '{n} with more night time than flight time', body: 'Night time can’t be longer than the flight. Set it to the flight time.', op: { kind: 'fill', field: 'night_time', of: 'total_time', pct: 100 }, dismissLabel: 'Leave as is' },
      (r) => num(r.night_time) > total(r) + 0.05 && total(r) > 0);
    add({ id: 'no_category', icon: 'pricetag-outline', title: '{n} with no category', body: 'Without a category these hours are missing from your A1, A2, A3 and Specific totals. Pick the category you flew in.', ask: 'category', dismissLabel: 'Leave as is' },
      (r) => !str(r.category).trim());
    add({ id: 'no_operation', icon: 'briefcase-outline', title: '{n} not marked private or commercial', body: 'Your logbook’s Type column is empty for {it}. Pick which {it} were.', ask: 'operation', dismissLabel: 'Leave as is' },
      (r) => !str(r.operation_type).trim() && !str(r.mission_type).trim());
  }
  return out;
}
