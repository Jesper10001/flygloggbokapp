// Rättelser i pappersboken efter en skanning. Användaren har sagt att en "Total this page" i boken är
// felräknad (flygningarna stämmer). Då blir också sidans "Total to date" fel, och på varje följande sida
// "Brought forward" och "Total to date" i samma kolumn. Guiden (components/scan/PaperFixGuide) listar allt på
// en gång, uppslag för uppslag, så att alla handändringar görs samlat.
//
// Regel (användarens): ändra ingenting i pappersboken förrän HELA boken är skannad, fram till sidan man skriver
// på nu. En ändring mitt i boken ändrar varje summa efter den. Därför sparas skanningarna och rättelserna över
// flera skanningar (PaperLedger, services/paperLedger.ts), och guiden visar ändringarna först när täckningen är
// komplett — innan dess vad som saknas.

export interface PaperFix {
  page: number;      // uppslaget i skanningen (0-baserat)
  field: string;
  from: number;      // summan som står i boken
  to: number;        // radernas summa
}

export interface PaperSpread {
  pageNumbers: { left: number | null; right: number | null };
  totals: { brought_forward: number | null; total_this_page: number | null; total_to_date: number | null } | null;   // Total time
  open?: boolean;      // sidan man skriver på nu: inga summor längst ner än, bara Brought forward
}

export interface PaperFixLine {
  row: 'Brought forward' | 'Total this page' | 'Total to date';
  field: string;
  from: number | null;   // null: värdet lästes inte → bara ändringen visas
  to: number | null;
  delta: number;
}

export interface PaperFixStep {
  key: string;
  label: string;         // "p. 78–79" eller "Spread 2"
  lines: PaperFixLine[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Uppslag för uppslag (i bokens ordning): det som ska ändras, och vad som gäller sidorna efter skanningen. */
export function paperFixSteps(fixes: PaperFix[], spreads: PaperSpread[]): { steps: PaperFixStep[]; after: { field: string; delta: number }[]; lastLabel: string | null } {
  if (!fixes.length) return { steps: [], after: [], lastLabel: null };
  const labelOf = (i: number) => {
    const pn = spreads[i]?.pageNumbers;
    return pn?.left ? pagesLabel(pn.left, pn.right) : `Spread ${i + 1}`;
  };
  // Bokens ordning: tryckta sidnummer när de finns, annars skanningens.
  const order = spreads.map((_, i) => i).sort((a, b) => {
    const pa = spreads[a]?.pageNumbers.left, pb = spreads[b]?.pageNumbers.left;
    return pa != null && pb != null ? pa - pb : a - b;
  });
  const first = Math.min(...fixes.map((f) => order.indexOf(f.page)));
  const carry = new Map<string, number>();     // fel som förs vidare från tidigare uppslag, per kolumn
  const steps: PaperFixStep[] = [];
  let lastLabel: string | null = null;
  for (const [pos, i] of order.entries()) {
    lastLabel = labelOf(i);
    if (pos < first) continue;
    const lines: PaperFixLine[] = [];
    const tt = spreads[i]?.totals;
    for (const [field, d] of carry) {
      if (Math.abs(d) < 0.01) continue;
      const bf = field === 'total_time' ? tt?.brought_forward ?? null : null;
      lines.push({ row: 'Brought forward', field, from: bf, to: bf != null ? round(bf + d) : null, delta: d });
    }
    for (const f of fixes.filter((x) => x.page === i)) {
      lines.push({ row: 'Total this page', field: f.field, from: f.from, to: f.to, delta: round(f.to - f.from) });
      carry.set(f.field, round((carry.get(f.field) ?? 0) + f.to - f.from));
    }
    for (const [field, d] of carry) {
      if (Math.abs(d) < 0.01 || spreads[i]?.open) continue;
      const td = field === 'total_time' ? tt?.total_to_date ?? null : null;
      lines.push({ row: 'Total to date', field, from: td, to: td != null ? round(td + d) : null, delta: d });
    }
    // Total time: står Brought forward, Total this page och Total to date på sidan räknas rätt "Total to date"
    // fram. Har användaren redan räknat den rätt (trots fel sidsumma) behöver den inte ändras, och felet förs
    // inte vidare. Andra utfall (t.ex. en felläst siffra) → modellen ovan gäller.
    const tdLine = lines.find((l) => l.row === 'Total to date' && l.field === 'total_time');
    const fixTT = fixes.find((x) => x.page === i && x.field === 'total_time');
    const tp = fixTT ? fixTT.to : tt?.total_this_page ?? null;
    if (tdLine && tt?.brought_forward != null && tt.total_to_date != null && tp != null) {
      const carryIn = lines.find((l) => l.row === 'Brought forward' && l.field === 'total_time')?.delta ?? 0;
      const real = round(tt.brought_forward + carryIn + tp - tt.total_to_date);
      if (Math.abs(real) < 0.01) {
        lines.splice(lines.indexOf(tdLine), 1);
        carry.set('total_time', 0);
      }
    }
    if (lines.length) steps.push({ key: String(spreads[i]?.pageNumbers.left ?? `s${i}`), label: labelOf(i), lines });
  }
  const after = [...carry].filter(([, d]) => Math.abs(d) >= 0.01).map(([field, delta]) => ({ field, delta }));
  return { steps, after, lastLabel };
}

/** "p. 78–79" (sidor numrerade var för sig) eller "p. 25" (uppslaget har ett nummer). */
export function pagesLabel(left: number, right: number | null): string {
  return right == null ? `p. ${left}–${left + 1}` : right === left ? `p. ${left}` : `p. ${left}–${right}`;
}

// ── Listan över skanningar och rättelser ─────────────────────────────────────

export interface LedgerSpread {
  left: number;
  right: number | null;
  bf: number | null;      // Total time: Brought forward, Total this page, Total to date som de står i boken
  tp: number | null;
  td: number | null;
  full: boolean;          // alla tryckta rader ifyllda (annars är det sidan man skriver på nu)
}
export interface LedgerFix { left: number; field: string; from: number; to: number }
export interface PaperLedger {
  spreads: LedgerSpread[];
  fixes: LedgerFix[];
  latest: number | null;  // användaren har sagt att uppslaget (vänster sida) är det hen skriver på nu
  start: number | null;   // användaren har sagt att uppslaget är bokens första
  ticked: string[];       // avbockade rader i guiden
}
export const emptyLedger = (): PaperLedger => ({ spreads: [], fixes: [], latest: null, start: null, ticked: [] });

/**
 * Lägger till en skanning. Ett uppslag som skannas igen ersätter det gamla, med dess rättelser och bockar.
 * `spreads` per uppslag i skanningen (null = sidnumret lästes inte). Rättelser på uppslag utan sidnummer
 * kan inte placeras i boken (unplaced).
 */
export function mergeScan(l: PaperLedger, spreads: (LedgerSpread | null)[], fixes: PaperFix[]): { ledger: PaperLedger; unplaced: number; added: number } {
  const byLeft = new Map(l.spreads.map((x) => [x.left, x]));
  const rescanned = new Set<number>();
  for (const sp of spreads) if (sp) { byLeft.set(sp.left, sp); rescanned.add(sp.left); }
  const kept = l.fixes.filter((f) => !rescanned.has(f.left));
  let unplaced = 0, added = 0;
  for (const f of fixes) {
    const sp = spreads[f.page];
    if (!sp) { unplaced++; continue; }
    kept.push({ left: sp.left, field: f.field, from: f.from, to: f.to });
    added++;
  }
  const next: PaperLedger = {
    ...l,
    spreads: [...byLeft.values()].sort((a, b) => a.left - b.left),
    fixes: kept,
    ticked: [],          // nya skanningar kan ändra listan → bockarna börjar om
  };
  return { ledger: next, unplaced, added };
}

export interface LedgerStatus {
  open: number;                 // rättelser i listan
  ready: boolean;               // hela boken skannad fram till sidan man skriver på → guiden kan visas
  step: number;                 // 2 = sidorna numrerade var för sig, 1 = ett nummer per uppslag
  first: LedgerSpread | null;   // lägsta skannade uppslaget
  last: LedgerSpread | null;    // högsta skannade uppslaget
  start: number | null;         // bokens första uppslag (känt eller bekräftat)
  latest: number | null;        // uppslaget man skriver på nu (känt eller bekräftat)
  gaps: { from: number; to: number; label: string }[];   // oskannade uppslag mellan början och slutet
}

export function ledgerStatus(l: PaperLedger): LedgerStatus {
  const sp = [...l.spreads].sort((a, b) => a.left - b.left);
  const first = sp[0] ?? null, last = sp[sp.length - 1] ?? null;
  // Ett nummer per uppslag (höger = vänster) → steg 1, annars 2. Inte av avståndet mellan uppslagen: ett
  // enda feltolkat sidnummer skulle då göra varannan sida "saknad".
  const step = sp.some((x) => x.right === x.left) ? 1 : 2;
  // Början: första sidan (1–2) eller Brought forward 0, eller det användaren bekräftat.
  const autoStart = first && (first.left <= step || first.bf === 0) ? first.left : null;
  const start = first ? (l.start != null ? Math.min(l.start, first.left) : autoStart) : null;
  // Slutet: ett uppslag som inte är fullt är det man skriver på nu, eller det användaren bekräftat.
  const latest = last && (l.latest === last.left || !last.full) ? last.left : null;
  const gaps: LedgerStatus['gaps'] = [];
  if (start != null && last) {
    const have = new Set(sp.map((x) => x.left));
    let from: number | null = null, to = 0;
    const close = () => { if (from != null) gaps.push({ from, to, label: step === 1 ? (from === to ? `p. ${from}` : `p. ${from}–${to}`) : `p. ${from}–${to + 1}` }); from = null; };
    for (let p = start; p <= last.left; p += step) {
      if (have.has(p)) close();
      else { if (from == null) from = p; to = p; }
    }
    close();
  }
  const open = l.fixes.length;
  return { open, ready: open > 0 && start != null && latest != null && gaps.length === 0, step, first, last, start, latest, gaps };
}

/** Guidens rader ur listan (bokens ordning). */
export function ledgerSteps(l: PaperLedger) {
  const sp = [...l.spreads].sort((a, b) => a.left - b.left);
  const spreads: PaperSpread[] = sp.map((x) => ({ pageNumbers: { left: x.left, right: x.right }, totals: { brought_forward: x.bf, total_this_page: x.tp, total_to_date: x.td }, open: !x.full }));
  const fixes: PaperFix[] = l.fixes
    .map((f) => ({ page: sp.findIndex((x) => x.left === f.left), field: f.field, from: f.from, to: f.to }))
    .filter((f) => f.page >= 0);
  return paperFixSteps(fixes, spreads);
}
