// Samma registrering skriven på två sätt: en gång med nolla och en gång med bokstaven O (KIL026 och KILO26).
// De två ser likadana ut men blir två luftfartyg i Fleet och två rader i listan i Log flight. Det händer lätt
// när en loggbok skannas eller en fil importeras. Här avgörs vilken stavning som gäller:
//  1. `prefer` (stavningarna som redan finns i loggboken, vid import): finns bara en av tvillingarna där vinner den.
//  2. Annars stavningen som flest registreringar i flottan har på samma plats (KILO21, KILO23 … talar för
//     KILO26). En felläst stavning har alltid en rätt tvilling, men de rätta har också registreringar utan
//     tvilling, så den rätta stavningen har flest.
//  3. Sedan flest flygningar med den stavningen, sedan flest flygningar på registreringen själv, sedan O.
// Ren logik utan I/O (scripts/test-registration-twins.cjs). Sparandet: db/registrationTwins.ts.

export interface RegCount { registration: string; n: number }

const up = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** Lika för två registreringar som bara skiljer på O och nolla. */
export const ozKey = (reg: string) => up(reg).replace(/O/g, '0');

/** Registreringen i `known` som är samma som `reg` så när som på O och nolla (inte reg själv). */
export function twinOf(reg: string, known: Iterable<string>): string | null {
  const r = up(reg), key = ozKey(reg);
  if (!r) return null;
  for (const k of known) { const u = up(k); if (u && u !== r && ozKey(u) === key) return u; }
  return null;
}

/**
 * Vilka registreringar som ska byta stavning: från → till. regs = alla registreringar med antal flygningar
 * (samma registrering får förekomma flera gånger, antalen läggs ihop; 0 = finns bara i registret).
 */
export function twinMerges(regs: RegCount[], prefer?: Set<string>): Map<string, string> {
  const count = new Map<string, number>();
  for (const r of regs) { const reg = up(r.registration); if (reg) count.set(reg, (count.get(reg) ?? 0) + (r.n || 0)); }
  const groups = new Map<string, string[]>();
  for (const reg of count.keys()) { const k = ozKey(reg); const g = groups.get(k); if (g) g.push(reg); else groups.set(k, [reg]); }
  const preferUp = prefer ? new Set([...prefer].map(up)) : null;

  const out = new Map<string, string>();
  for (const variants of groups.values()) {
    if (variants.length < 2) continue;
    // Platserna där tvillingarna skiljer sig (där står O i den ena och 0 i den andra).
    const len = variants[0].length;
    const diff: number[] = [];
    for (let i = 0; i < len; i++) if (variants.some((v) => v[i] !== variants[0][i])) diff.push(i);
    // Syskonen: registreringar i flottan med samma början och samma tecken på de platserna.
    const score = (v: string) => {
      const head = v.slice(0, diff[0]);
      let siblings = 0, flights = 0;
      for (const [reg, n] of count) {
        if (reg.length !== len || !reg.startsWith(head) || diff.some((i) => reg[i] !== v[i])) continue;
        siblings++; flights += n;
      }
      return [siblings, flights, count.get(v) ?? 0, v.split('O').length - 1];
    };
    const inLogbook = preferUp ? variants.filter((v) => preferUp.has(v)) : [];
    const candidates = inLogbook.length ? inLogbook : variants;
    const scored = candidates.map((v) => ({ v, s: score(v) }));
    scored.sort((a, b) => b.s[0] - a.s[0] || b.s[1] - a.s[1] || b.s[2] - a.s[2] || b.s[3] - a.s[3] || (a.v < b.v ? -1 : 1));
    const winner = scored[0].v;
    for (const v of variants) if (v !== winner) out.set(v, winner);
  }
  return out;
}
