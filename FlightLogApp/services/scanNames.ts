// Andrepiloternas namn i en skanning, kontrollerade mot de namn som redan finns. Samma person skrivs lätt på flera
// sätt (WOLFF, Wolff) eller läses fel på en bokstav (WOFF), och varje skrivsätt blev en egen person i Log Flight.
// Här blir de ett namn: det mest använda. Ren logik utan I/O (scripts/test-scan-names.cjs).
//
//  - Samma bokstäver oavsett stora/små, mellanslag och accenter är alltid samma person.
//  - En bokstavs skillnad räknas som samma person när namnen har minst fyra bokstäver. Initialer (PU, PUA) är
//    korta och olika personer har ofta nästan samma, så de slås aldrig ihop på likhet.
//  - Två namn som båda används ofta (ESTABLISHED flygningar) är troligen två personer (Wolf, Wolff) och hålls isär.
// Likhet visas i rapporten, där de kan hållas isär.

const MIN_FUZZY = 4;
const ESTABLISHED = 5;

export const nameKey = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export interface NameGroup {
  id: string;                    // nycklarna, sorterade
  name: string;                  // namnet raderna får
  spellings: string[];           // skrivsätten i skanningen som inte redan är namnet
  keys: string[];                // nycklarna som slagits ihop på likhet
  rows: number;
  similar: boolean;              // ihopslagna på likhet, inte bara stora/små bokstäver
}

export function resolveNames(
  scanned: string[], known: { name: string; n: number }[], separate: Set<string> = new Set(),
): { groups: NameGroup[]; nameOf: (written: string) => string } {
  // Skrivsätt och användning per nyckel, från skanningen och tidigare flygningar.
  const entries = new Map<string, { spell: Map<string, number>; flown: number; rows: number }>();
  const entry = (k: string) => { let e = entries.get(k); if (!e) { e = { spell: new Map(), flown: 0, rows: 0 }; entries.set(k, e); } return e; };
  for (const { name, n } of known) {
    const k = nameKey(name);
    if (!k) continue;
    const e = entry(k);
    e.flown += n;
    e.spell.set(name.trim(), (e.spell.get(name.trim()) ?? 0) + n);
  }
  for (const raw of scanned) {
    const k = nameKey(raw), name = raw.trim();
    if (!k) continue;
    const e = entry(k);
    e.rows++;
    e.spell.set(name, (e.spell.get(name) ?? 0) + 1);
  }
  // Mest använda först: ett felläst namn ansluter sig till det etablerade.
  const keys = [...entries.keys()].sort((a, b) => (entries.get(b)!.flown + entries.get(b)!.rows) - (entries.get(a)!.flown + entries.get(a)!.rows) || a.localeCompare(b));
  const root = new Map<string, string>();
  for (const k of keys) {
    const home = separate.has(k) || k.length < MIN_FUZZY ? null : [...new Set(root.values())].find((r) => {
      if (r.length < MIN_FUZZY || separate.has(r) || !withinOneEdit(r, k)) return false;
      return !(entries.get(r)!.flown >= ESTABLISHED && entries.get(k)!.flown >= ESTABLISHED);
    });
    root.set(k, home ?? k);
  }
  const best = (r: string) => {
    let top = '', n = -1;
    for (const k of keys) if (root.get(k) === r) for (const [s, c] of entries.get(k)!.spell) if (c + (k === r ? 0.5 : 0) > n) { top = s; n = c + (k === r ? 0.5 : 0); }
    return top;
  };
  const groups: NameGroup[] = [];
  for (const r of new Set(root.values())) {
    const members = keys.filter((k) => root.get(k) === r);
    const rows = members.reduce((t, k) => t + entries.get(k)!.rows, 0);
    if (!rows) continue;
    const name = best(r);
    const spellings = [...new Set(members.filter((k) => entries.get(k)!.rows > 0).flatMap((k) => [...entries.get(k)!.spell.keys()]))].filter((s) => s !== name);
    groups.push({ id: [...members].sort().join('|'), name, spellings, keys: members.filter((k) => k !== r), rows, similar: members.length > 1 });
  }
  return { groups, nameOf: (written) => { const r = root.get(nameKey(written)); return r ? best(r) : written; } };
}
