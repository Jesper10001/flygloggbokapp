// Flygplanstyperna i en skanning, kontrollerade mot flottan. Samma luftfartyg skrivs ofta på flera sätt i en
// pappersbok ("EC135", "EC135T1", "EC35"), och varje skrivsätt fick förut en egen typ i flottan — vilket rubbar
// Fleet, statistiken och typvalet i Log Flight. Här slås skrivsätten ihop till EN typ, och finns typen redan i
// flottan används flottans namn. Ren logik utan I/O (scripts/test-scan-types.cjs).
//
// Grunderna, säkrast först:
//  registration – samma registrering är samma luftfartyg (i skanningen, och mot flottans flygningar)
//  name         – samma namn som en typ i flottan (stora/små bokstäver, bindestreck och mellanslag spelar ingen roll)
//  type-code    – Claude läste samma ICAO-typkod för skrivsätten (EC135 och EC135T1 → EC35), eller typkoden är
//                 flottans namn
//  similar      – samma namn med ett variantsuffix ("EC135" / "EC135T2", "B206" / "B206L") när inget talar emot
//                 (olika typkoder skiljer t.ex. PA28 och PA28R åt). Visas i rapporten, där man kan hålla isär.

export type TypeVia = 'registration' | 'name' | 'type-code' | 'similar';

export interface TypeRowInput {
  written: string;          // typen som den står i boken (radens original)
  registration?: string;
}
export interface TypeDetection { as_written: string; resolved: string }
export interface FleetInfo {
  types: string[];
  regs: { registration: string; aircraft_type: string; n: number }[];
}

export interface TypeGroup {
  id: string;               // medlemmarnas nycklar, sorterade (stabilt id för val och frågor)
  members: { key: string; display: string; rows: number }[];
  designator: string | null; // Claudes ICAO-typkod, om skrivsätten är överens
  fleet: string | null;      // befintlig typ i flottan
  via: TypeVia | null;       // varför gruppen matchades mot flottan
  merged: TypeVia[];         // varför skrivsätten slogs ihop (när de är fler än ett)
  suggested: string;         // typen raderna får: flottans, annars typkoden, annars vanligaste skrivsättet
  rows: number;
}

export const typeKey = (s: string | undefined | null) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Är a och b samma typ med ett variantsuffix? Det kortare namnet (minst 3 tecken, med en siffra) inleder det
 * längre, och resten är en kort variant: högst två bokstäver och två siffror (T1, T2, P2, B3, L, L4, SP).
 */
export function isVariant(a: string, b: string): boolean {
  const x = typeKey(a), y = typeKey(b);
  if (!x || !y || x === y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 3 || !/\d/.test(short) || !long.startsWith(short)) return false;
  const rest = long.slice(short.length);
  // "EC13" + "5" är inte en variant: suffixet får inte fortsätta modellnumret.
  if (/\d$/.test(short) && /^\d/.test(rest)) return false;
  return rest.length > 0 && rest.length <= 3 && /^[A-Z]{0,2}\d{0,2}$/.test(rest);
}

const majority = (m: Map<string, number>): string | null => {
  let best: string | null = null, n = -1;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
};

export function resolveScanTypes(
  rows: TypeRowInput[], detections: TypeDetection[], fleet: FleetInfo, separate: Set<string> = new Set(),
): { groups: TypeGroup[]; groupOf: Map<string, TypeGroup> } {
  // Skrivsätten i skanningen (nyckel = typeKey) med visningsnamn, antal rader och registreringar.
  const members = new Map<string, { display: Map<string, number>; rows: number; regs: Set<string> }>();
  for (const r of rows) {
    const key = typeKey(r.written);
    if (!key) continue;
    const m = members.get(key) ?? { display: new Map(), rows: 0, regs: new Set<string>() };
    const shown = String(r.written).toUpperCase().trim();
    m.display.set(shown, (m.display.get(shown) ?? 0) + 1);
    m.rows++;
    const reg = typeKey(r.registration);
    if (reg) m.regs.add(reg);
    members.set(key, m);
  }
  // Claudes typkod per skrivsätt (flest läsningar vinner).
  const codeVotes = new Map<string, Map<string, number>>();
  for (const d of detections) {
    const k = typeKey(d.as_written), c = typeKey(d.resolved);
    if (!k || !c) continue;
    const v = codeVotes.get(k) ?? new Map<string, number>();
    v.set(c, (v.get(c) ?? 0) + 1);
    codeVotes.set(k, v);
  }
  const codeOf = (k: string) => {
    const v = codeVotes.get(k);
    // Ett skrivsätt som redan är en typkod (t.ex. "EC35" efter fokus "totals") är sin egen kod.
    return v ? majority(v) : null;
  };
  const fleetByKey = new Map(fleet.types.map((t) => [typeKey(t), t.toUpperCase()] as const));
  // Flottans typ per registrering (flest flygningar).
  const regVotes = new Map<string, Map<string, number>>();
  for (const r of fleet.regs) {
    const reg = typeKey(r.registration), t = String(r.aircraft_type).toUpperCase();
    if (!reg || !t) continue;
    const v = regVotes.get(reg) ?? new Map<string, number>();
    v.set(t, (v.get(t) ?? 0) + Math.max(1, r.n));
    regVotes.set(reg, v);
  }

  // Ihopslagning (union-find) av skrivsätten i skanningen.
  const keys = [...members.keys()];
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => { let p = parent.get(k)!; while (p !== parent.get(p)) p = parent.get(p)!; parent.set(k, p); return p; };
  const why = new Map<string, Set<TypeVia>>();
  const union = (a: string, b: string, via: TypeVia) => {
    if (separate.has(a) || separate.has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    parent.set(rb, ra);
    const s = why.get(ra) ?? new Set<TypeVia>();
    for (const x of why.get(rb) ?? []) s.add(x);
    s.add(via);
    why.set(ra, s);
  };
  // Samma registrering i skanningen.
  const byReg = new Map<string, string[]>();
  for (const k of keys) for (const reg of members.get(k)!.regs) byReg.set(reg, [...(byReg.get(reg) ?? []), k]);
  for (const ks of byReg.values()) for (let i = 1; i < ks.length; i++) union(ks[0], ks[i], 'registration');
  // Samma typkod.
  const byCode = new Map<string, string[]>();
  for (const k of keys) { const c = codeOf(k); if (c) byCode.set(c, [...(byCode.get(c) ?? []), k]); }
  for (const [code, ks] of byCode) {
    for (let i = 1; i < ks.length; i++) union(ks[0], ks[i], 'type-code');
    // Ett skrivsätt som ÄR typkoden (t.ex. "EC35") hör till samma grupp.
    if (members.has(code)) union(ks[0], code, 'type-code');
  }
  // Variantsuffix mellan skrivsätten, om typkoderna inte säger emot.
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j];
    const ca = codeOf(a), cb = codeOf(b);
    if (ca && cb && ca !== cb) continue;
    if (isVariant(a, b)) union(a, b, 'similar');
  }

  // Grupperna och deras typ i flottan.
  const roots = new Map<string, string[]>();
  for (const k of keys) roots.set(find(k), [...(roots.get(find(k)) ?? []), k]);
  const groups: TypeGroup[] = [];
  const groupOf = new Map<string, TypeGroup>();
  for (const [root, ks] of roots) {
    const ms = ks.map((k) => {
      const m = members.get(k)!;
      return { key: k, display: majority(m.display) ?? k, rows: m.rows };
    }).sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));
    const rowsTotal = ms.reduce((s, m) => s + m.rows, 0);
    const codes = new Map<string, number>();
    for (const m of ms) { const c = codeOf(m.key); if (c) codes.set(c, (codes.get(c) ?? 0) + m.rows); }
    const designator = codes.size === 1 ? [...codes.keys()][0] : codes.size > 1 ? majority(codes) : null;
    const sep = ks.some((k) => separate.has(k));

    let fleetType: string | null = null, via: TypeVia | null = null;
    // 1. Registreringarna finns i flottan.
    const regTypes = new Map<string, number>();
    for (const k of ks) for (const reg of members.get(k)!.regs) {
      const v = regVotes.get(reg);
      const t = v ? majority(v) : null;
      if (t) regTypes.set(t, (regTypes.get(t) ?? 0) + 1);
    }
    if (regTypes.size && !sep) { fleetType = majority(regTypes); via = 'registration'; }
    // 2. Samma namn som i flottan.
    if (!fleetType) { const hit = ms.find((m) => fleetByKey.has(m.key)); if (hit) { fleetType = fleetByKey.get(hit.key)!; via = 'name'; } }
    // 3. Typkoden är flottans namn.
    if (!fleetType && designator && fleetByKey.has(designator) && !sep) { fleetType = fleetByKey.get(designator)!; via = 'type-code'; }
    // 4. Ett variantsuffix av en typ i flottan (längst gemensamt namn vinner).
    if (!fleetType && !sep) {
      let best: string | null = null;
      for (const m of ms) for (const [fk, ft] of fleetByKey) {
        if (!isVariant(m.key, fk)) continue;
        // Säger typkoderna emot (flottans namn lästes som en annan typkod i skanningen), hålls de isär.
        const fc = codeOfFleet(fk, codeVotes);
        if (designator && fc && fc !== designator) continue;
        if (!best || fk.length > typeKey(best).length) best = ft;
      }
      if (best) { fleetType = best; via = 'similar'; }
    }
    const g: TypeGroup = {
      id: [...ks].sort().join('|'),
      members: ms,
      designator,
      fleet: fleetType,
      via,
      merged: ks.length > 1 ? [...(why.get(root) ?? [])] : [],
      // Isärhållna skrivsätt behåller sitt namn (annars blev EC135 och EC135T1 båda EC35 igen).
      suggested: fleetType ?? (sep ? ms[0].display : designator ?? ms[0].display),
      rows: rowsTotal,
    };
    groups.push(g);
    for (const k of ks) groupOf.set(k, g);
  }
  groups.sort((a, b) => b.rows - a.rows);
  return { groups, groupOf };
}

// Flottans namn som Claude läst som typkod i den här skanningen (t.ex. flottans "B206" skrivet "B206" → "B06").
function codeOfFleet(fleetKey: string, codeVotes: Map<string, Map<string, number>>): string | null {
  const v = codeVotes.get(fleetKey);
  return v ? majority(v) : null;
}

/** Varför en grupp matchades mot flottan, för rapporten. */
export function viaText(via: TypeVia): string {
  switch (via) {
    case 'registration': return 'same registration';
    case 'name': return 'same name';
    case 'type-code': return 'same type code';
    case 'similar': return 'similar name';
  }
}
