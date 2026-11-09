// Flygplansfamiljer: varianter av samma grundmodell (EC135T1 och EC135T2, A109E och A109LUH, AS350B2 och AS350B3)
// är egna typer i flottan, med egna specifikationer och timmar, men hör till en gemensam familj (EC135, A109,
// AS350) med en gemensam total och typbehörighet. Ren logik utan I/O (scripts/test-aircraft-family.cjs).
//
//  distinctVariants – två olika varianter av samma modell: samma modellnummer, olika suffix (T1/T2, LUH/E, B2/B3).
//                     Slås ALDRIG ihop av sig själv; skanningen och Add aircraft frågar.
//  sameFamily       – distinctVariants, eller samma typ med eller utan suffix (EC135 och EC135T1, PA28 och PA28R).

import { typeKey, maybeSameType } from './scanTypes';

// Modellnamnet fram till slutet av det första sifferavsnittet: "EC135T" → "EC135", "AS350B" → "AS350".
function modelOf(prefix: string): string | null {
  const m = /^[A-Z]*\d+/.exec(prefix);
  return m ? m[0] : null;
}

// Gemensam början av två nycklar.
function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/**
 * Grundmodellen två skrivsätt delar, om de hör till samma familj: "EC135" för EC135T1/EC135T2 och EC135/EC135T1.
 * Modellnumret måste vara helt i båda (B737 och B738 delar inte "B73"), minst tre tecken med en siffra.
 */
export function familyBase(a: string, b: string): string | null {
  const x = typeKey(a), y = typeKey(b);
  if (!x || !y) return null;
  const base = modelOf(commonPrefix(x, y));
  if (!base || base.length < 3) return null;
  // Modellnumret får inte fortsätta i någon av dem (H125/H145 → "H1" fortsätter → olika modeller).
  if (/^\d/.test(x.slice(base.length)) || /^\d/.test(y.slice(base.length))) return null;
  const sx = x.slice(base.length), sy = y.slice(base.length);
  if (sx.length > 4 || sy.length > 4 || !/^[A-Z0-9]*$/.test(sx + sy)) return null;
  return base;
}

/** Två olika varianter av samma modell (båda har ett eget suffix efter modellnumret, och suffixen skiljer sig). */
export function distinctVariants(a: string, b: string): boolean {
  const x = typeKey(a), y = typeKey(b);
  if (!x || !y || x === y) return false;
  const base = familyBase(x, y);
  if (!base) return false;
  const sx = x.slice(base.length), sy = y.slice(base.length);
  return sx.length > 0 && sy.length > 0 && sx !== sy;
}

/** Hör två typer till samma familj? Olika varianter, eller samma typ med eller utan suffix. */
export function sameFamily(a: string, b: string): boolean {
  const x = typeKey(a), y = typeKey(b);
  if (!x || !y || x === y) return false;
  return distinctVariants(x, y) || (maybeSameType(x, y) && !!familyBase(x, y));
}

/** Familjens namn för flera typer: deras gemensamma grundmodell. */
export function familyName(types: string[]): string | null {
  const keys = types.map(typeKey).filter(Boolean);
  if (keys.length < 2) return null;
  let base: string | null = keys[0];
  for (const k of keys.slice(1)) {
    base = base ? familyBase(base, k) : null;
    if (!base) return null;
  }
  return base;
}

export interface FamilyEntry { aircraft_type: string; family?: string | null; family_locked?: number | null }

/**
 * Familjerna i flottan: typer som hör ihop (sameFamily) och inte är markerade som egen typ grupperas, och får
 * gruppens grundmodell som familj. En typ som blivit ensam i sin familj tappar den. Returnerar bara ändringar.
 */
export function computeFamilies(entries: FamilyEntry[]): Map<string, string> {
  const free = entries.filter((e) => !e.family_locked);
  const parent = new Map(free.map((e) => [e.aircraft_type, e.aircraft_type]));
  const find = (k: string): string => { let p = parent.get(k)!; while (p !== parent.get(p)) p = parent.get(p)!; parent.set(k, p); return p; };
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i].aircraft_type, b = free[j].aircraft_type;
      if (sameFamily(a, b)) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); }
    }
  }
  const groups = new Map<string, string[]>();
  for (const e of free) groups.set(find(e.aircraft_type), [...(groups.get(find(e.aircraft_type)) ?? []), e.aircraft_type]);
  const want = new Map<string, string>();
  for (const members of groups.values()) {
    const name = members.length > 1 ? familyName(members) : null;
    for (const t of members) want.set(t, name ?? '');
  }
  const out = new Map<string, string>();
  for (const e of free) {
    const w = want.get(e.aircraft_type) ?? '';
    if ((e.family ?? '') !== w) out.set(e.aircraft_type, w);
  }
  return out;
}
