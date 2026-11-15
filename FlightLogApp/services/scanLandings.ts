// Landningar där Claude och Apple Vision läser olika (crossCheckCounts i scanAlign.ts). Ingen av dem vet svaret
// säkert: Claude läser handskriften bäst, Vision vet exakt var på sidan ett tal står. Appen avgör själv i den här
// ordningen och frågar användaren bara när inget av det räcker:
//   1. Sidans summor ("Total this page"): den enda kombination av läsningar som går ihop med summorna vinner.
//   2. Nattid: en nattlandning kräver nattid på raden, och en flygning helt i mörker landar i mörker.
//   3. Läget: står samma tal i grannkolumnen (dag ↔ natt) och Vision träffar landningskolumnerna rätt på andra
//      rader på uppslaget, avgör Visions läge vilken kolumn talet står i.
//   4. En andra titt (scanSecondLook.ts): Claude läser bara de omtvistade cellerna i små utsnitt. Två av tre
//      läsningar som är överens vinner.
// Filen är ren logik (inga RN-importer) så att den går att testa i Node: scripts/test-scan-landings.cjs.

export interface LandingPair { day: number; night: number }

/** En rad där läsningarna skiljer sig: Claudes version och den Vision ger. */
export interface LandingCandidate {
  rowIndex: number;
  kind: 'value' | 'move';     // value = olika tal i samma cell, move = samma tal i olika kolumn (dag ↔ natt)
  claude: LandingPair;
  vision: LandingPair;
  nightTime: number;          // radens nattid (timmar)
  totalTime: number;          // radens flygtid (timmar)
}

export type LandingWhy = 'totals' | 'night_time' | 'position' | 'second_look';

export interface LandingDecision { rowIndex: number; pick: 'claude' | 'vision'; why: LandingWhy }

const num = (v: unknown) => parseFloat(String(v ?? '0').replace(',', '.')) || 0;

/**
 * Bygger en kandidat per rad ur crossCheckCounts-träffarna. checks kan ha både dag och natt för samma rad.
 * Står Visions tal redan i grannkolumnen (och Claude läste inget i cellen) är det samma handskrift sedd i två
 * kolumner: Visions version flyttar talet i stället för att räkna det två gånger.
 */
export function landingCandidates(
  checks: { rowIndex: number; field: string; vision: string; read: string }[],
  rows: { rowIndex: number; data: Record<string, any> }[],
): LandingCandidate[] {
  const out: LandingCandidate[] = [];
  const byRow = new Map<number, typeof checks>();
  for (const c of checks) byRow.set(c.rowIndex, [...(byRow.get(c.rowIndex) ?? []), c]);
  for (const [rowIndex, list] of byRow) {
    const row = rows.find((r) => r.rowIndex === rowIndex);
    if (!row) continue;
    const claude: LandingPair = { day: Math.round(num(row.data.landings_day)), night: Math.round(num(row.data.landings_night)) };
    const vision: LandingPair = { ...claude };
    let kind: LandingCandidate['kind'] = 'value';
    for (const c of list) {
      const key = c.field === 'landings_day' ? 'day' : 'night';
      const other = key === 'day' ? 'night' : 'day';
      const v = Math.round(num(c.vision));
      if (claude[other] > 0 && claude[other] === v && !(num(c.read) > 0)) { vision[key] = v; vision[other] = 0; kind = 'move'; }
      else vision[key] = v;
    }
    if (vision.day === claude.day && vision.night === claude.night) continue;
    out.push({ rowIndex, kind, claude, vision, nightTime: num(row.data.night), totalTime: num(row.data.total_time) });
  }
  return out.sort((a, b) => a.rowIndex - b.rowIndex);
}

/**
 * Steg 1–3. base = sidans summor av Claudes läsning (alla rader på sidan), printed = sidans "Total this page".
 * agreeing = rader på uppslaget där Vision och Claude läser samma landningar (bevis för att rutnätet ligger rätt).
 * Returnerar besluten; kandidater utan beslut går vidare till den andra titten.
 */
export function decideLandings(
  cands: LandingCandidate[],
  base: LandingPair,
  printed: { day?: number; night?: number },
  agreeing: number,
): LandingDecision[] {
  const decided = new Map<number, LandingDecision>();

  // 1. Summorna. Varje kombination prövas (högst 2^10); bara en kombination som ensam går ihop avgör.
  const hasDay = typeof printed.day === 'number', hasNight = typeof printed.night === 'number';
  if ((hasDay || hasNight) && cands.length > 0 && cands.length <= 10) {
    const fits = (mask: number) => {
      let d = base.day, n = base.night;
      cands.forEach((c, k) => { if (mask & (1 << k)) { d += c.vision.day - c.claude.day; n += c.vision.night - c.claude.night; } });
      return (!hasDay || Math.abs(d - (printed.day as number)) < 0.5) && (!hasNight || Math.abs(n - (printed.night as number)) < 0.5);
    };
    // Kolumner utan tryckt summa begränsar inget: ändrar en kandidat bara en sådan kolumn kan summorna inte avgöra den.
    const testable = cands.map((c) => (hasDay && c.vision.day !== c.claude.day) || (hasNight && c.vision.night !== c.claude.night));
    const matches: number[] = [];
    for (let mask = 0; mask < 1 << cands.length; mask++) if (fits(mask)) matches.push(mask);
    const unique = matches.length === 1 ? matches[0] : matches.includes(0) && hasDay && (hasNight || base.night === 0) ? 0 : null;
    if (unique != null) cands.forEach((c, k) => {
      if (testable[k]) decided.set(c.rowIndex, { rowIndex: c.rowIndex, pick: unique & (1 << k) ? 'vision' : 'claude', why: 'totals' });
    });
  }

  for (const c of cands) {
    if (decided.has(c.rowIndex)) continue;
    // 2. Nattid. Ingen nattid → inga nattlandningar. Hela flygningen i mörker → landningen är en nattlandning.
    const noNight = !(c.nightTime > 0);
    const allNight = c.nightTime > 0 && c.totalTime > 0 && c.nightTime >= c.totalTime - 0.05;
    const ok = (p: LandingPair) => (noNight ? p.night === 0 : allNight ? p.day === 0 : true);
    if (ok(c.claude) !== ok(c.vision)) {
      decided.set(c.rowIndex, { rowIndex: c.rowIndex, pick: ok(c.claude) ? 'claude' : 'vision', why: 'night_time' });
      continue;
    }
    // 3. Läget: samma tal, olika kolumn, och Vision träffar landningskolumnerna på minst två andra rader.
    if (c.kind === 'move' && agreeing >= 2) decided.set(c.rowIndex, { rowIndex: c.rowIndex, pick: 'vision', why: 'position' });
  }
  return [...decided.values()];
}

/** Steg 4: den andra tittens svar. Överens med Claude eller Vision → den vinner; annars inget beslut. */
export function decideBySecondLook(c: LandingCandidate, seen: { day: number | null; night: number | null; sure: boolean } | undefined): LandingDecision | null {
  if (!seen || !seen.sure) return null;
  const p: LandingPair = { day: seen.day ?? 0, night: seen.night ?? 0 };
  if (p.day === c.vision.day && p.night === c.vision.night) return { rowIndex: c.rowIndex, pick: 'vision', why: 'second_look' };
  if (p.day === c.claude.day && p.night === c.claude.night) return { rowIndex: c.rowIndex, pick: 'claude', why: 'second_look' };
  return null;
}

/** Frågan när inget avgjorde: ärlig om att två läsningar skiljer sig, med båda som val. */
export function landingQuestion(c: LandingCandidate): { field: 'landings_day' | 'landings_night'; reason: string; options: string[] } {
  if (c.kind === 'move') {
    const n = Math.max(c.claude.day, c.claude.night);
    const field = c.vision.day > 0 ? 'landings_day' : 'landings_night';
    const there = field === 'landings_day' ? 'day' : 'night', here = field === 'landings_day' ? 'night' : 'day';
    return { field, reason: `Are the ${n} landings day or night? Tap ${n} for ${there}, or Looks right to keep them as ${here}.`, options: [] };
  }
  const field = c.vision.day !== c.claude.day ? 'landings_day' : 'landings_night';
  const key = field === 'landings_day' ? 'day' : 'night';
  const a = String(c.claude[key]), b = String(c.vision[key]);
  return { field, reason: `The readings differ: ${a} or ${b}?`, options: [a, b] };
}
