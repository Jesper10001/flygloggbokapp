// Registreringar i en skanning mot flottan (Fleet). En felläst registrering blir annars ett nytt luftfartyg i
// Fleet (KIL083 bredvid KIL033, KILO31 bredvid KIL031), så en registrering som användaren inte har sedan
// tidigare godtas inte utan att användaren har sett den:
//  - granskningen frågar en gång per ny läsning (app/flight/scan-review.tsx, "New registration"), och svaret
//    gäller alla rader med samma läsning
//  - rapporten listar skanningens registreringar, de nya först, med en flygning som exempel
// Ren logik utan I/O (scripts/test-scan-registrations.cjs).
import { looksAlike } from './flightShare';

export interface RegRow { key: string; page: number; rowIndex: number; registration: string }
export interface FleetReg { registration: string; n: number }
export interface RegCheck {
  reg: string;            // läsningen, versaler
  rows: string[];         // radnycklar med läsningen, i bokens ordning
  isNew: boolean;         // finns inte i flottan
  confirmed: boolean;     // användaren har redan svarat om den i den här boken
  twin: string | null;    // samma tecken skrivna på ett annat sätt (O/0, I/1, bindestreck) i flottan eller skanningen;
                          // för en registrering i flottan: tvillingen i flottan som har fler flygningar
  similar: string[];      // högst tre förslag: tvillingen först, sedan flottans liknande, sedan skanningens
  ask: boolean;           // granskningen ska fråga
}

const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
// O och 0, I och 1 läses lätt fel i handstil; bindestreck och mellanslag skrivs olika.
const loose = (s: string) => up(s).replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');

/**
 * Går igenom skanningens registreringar. confirmed = läsningar som användaren redan har svarat om (reglerna
 * från tidigare svar: både "är rätt" och det den rättades till).
 * En ny registrering frågas om när användaren redan har en flotta att jämföra med, eller när den liknar en
 * registrering som finns i flottan eller står på fler rader i skanningen (då är den troligen felläst).
 * En registrering som redan finns i flottan frågas om när flottan har en tvilling med fler flygningar (KIL031
 * bredvid KILO31): då kom den ena troligen in genom en tidigare felläsning.
 */
export function checkRegistrations(rows: RegRow[], fleet: FleetReg[], confirmed: Set<string> = new Set()): RegCheck[] {
  const inScan = new Map<string, RegRow[]>();
  for (const r of [...rows].sort((a, b) => a.page - b.page || a.rowIndex - b.rowIndex)) {
    const reg = up(r.registration);
    if (!reg) continue;
    const list = inScan.get(reg);
    if (list) list.push(r); else inScan.set(reg, [r]);
  }
  const fleetN = new Map<string, number>();
  for (const f of fleet) { const reg = up(f.registration); if (reg) fleetN.set(reg, (fleetN.get(reg) ?? 0) + (f.n || 0)); }

  const out: RegCheck[] = [];
  for (const [reg, list] of inScan) {
    const isNew = !fleetN.has(reg);
    const done = confirmed.has(reg);
    // Liknande: i flottan (alla), i skanningen (de som står på fler rader än den här läsningen).
    const fromFleet = [...fleetN.entries()].filter(([k]) => k !== reg && looksAlike(k, reg)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const fromScan = [...inScan.entries()].filter(([k, l]) => k !== reg && !fleetN.has(k) && l.length > list.length && looksAlike(k, reg))
      .sort((a, b) => b[1].length - a[1].length).map(([k]) => k);
    const twin = [...fromFleet, ...fromScan].find((k) => loose(k) === loose(reg)) ?? null;
    const similar = [...new Set([...(twin ? [twin] : []), ...fromFleet, ...fromScan])].slice(0, 3);
    const suspicious = fromFleet.length > 0 || fromScan.length > 0;
    if (isNew) {
      out.push({ reg, rows: list.map((r) => r.key), isNew, confirmed: done, twin, similar, ask: !done && (suspicious || fleetN.size > 0) });
      continue;
    }
    const own = fleetN.get(reg) ?? 0;
    const stronger = [...fleetN.entries()].filter(([k, n]) => k !== reg && n > own && loose(k) === loose(reg)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({ reg, rows: list.map((r) => r.key), isNew, confirmed: done, twin: stronger, similar: stronger ? [stronger] : [], ask: !done && !!stronger });
  }
  // De nya först, flest rader först.
  return out.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.rows.length - a.rows.length || a.reg.localeCompare(b.reg));
}
