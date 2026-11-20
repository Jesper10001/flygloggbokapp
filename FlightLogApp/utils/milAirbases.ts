// Militära flygbaser med förband och flygplanstyper för Air Bases → Specific på global map och förbandskortet
// (components/UnitCard.tsx). Lagret ligger INTE i appen (2026-11-20): proxyn filtrerar det enligt användarens regler
// (inga baser i Natoländer, Schweiz, Österrike eller Ukraina utom ryska på ockuperat område, inga Natoförband
// utomlands) och spärrar vissa länder; store/osintStore.ts hämtar GET /osint/airbases och lägger det här via setLayer.
// Data byggs med scripts/build-*-airbases.mjs → scripts/build-osint-layer.mjs → proxy/data. En bas kan ha flera
// länders förband (ops). Rollerna: symbol (siluett ovanifrån, viewBox 24), bokstav och färg.
import { flagEmoji } from '../constants/continents';

export type RoleKey = 'fighter' | 'bomber' | 'attack' | 'heli' | 'transport' | 'special' | 'training';
export type BaseOp = { o: string; c: string; u: string[]; g: [RoleKey, string[]][] };
export type Dataset = 'ru' | 'eu' | 'world';
export type MilBase = { n: string; r: string; s: Dataset; c?: string; ops: BaseOp[] };
export type OsintLayer = { v: string; compiled: Record<Dataset, string>; bases: Record<string, MilBase>; fam?: Record<string, string>; desc?: Record<string, string> };

let D: Record<string, MilBase> = {};
let COMPILED: Record<Dataset, string> = { ru: '', eu: '', world: '' };
let VERSION = '';
let counts: { all: number; roles: Record<RoleKey, number> } | null = null;
let FAM: Record<string, string> = {};
let DESC: Record<string, string> = {};
let famIdx: TypeFamily[] | null = null;

/** Lägger in lagret från proxyn (eller tömmer det: null). Anropas bara av osintStore. */
export function setLayer(layer: OsintLayer | null) {
  D = layer?.bases ?? {};
  COMPILED = layer?.compiled ?? { ru: '', eu: '', world: '' };
  VERSION = layer?.v ?? '';
  FAM = layer?.fam ?? {};
  DESC = layer?.desc ?? {};
  counts = null;
  famIdx = null;
}
/** Lagrets version ('' = inget lager) — ingår i kartans filtersignatur så att kartan ritas om när det kommer. */
export function layerVersion(): string { return VERSION; }

/** När varje datamängd sammanställdes (visas i Source-rutan). */
export function compiledDate(ds: Dataset): string { return COMPILED[ds] ?? ''; }

export const ROLE_ORDER: RoleKey[] = ['fighter', 'bomber', 'attack', 'heli', 'transport', 'special', 'training'];
export const ROLES: Record<RoleKey | 'unknown', { label: string; letter: string; color: string; glyph: string }> = {
  fighter: { label: 'Fighters', letter: 'F', color: '#00C8E8', glyph: 'M12 2l1.6 6.2 7.4 5.6v2l-7.2-2.2-.4 5 2.6 2v1.4H8v-1.4l2.6-2-.4-5L3 15.8v-2l7.4-5.6z' },
  bomber: { label: 'Bombers', letter: 'B', color: '#FFB830', glyph: 'M12 1.5l1.3 6 9.2 6.3v1.9l-9.2-2.6-.3 6.4 3 1.9V23H8v-1.6l3-1.9-.3-6.4-9.2 2.6v-1.9l9.2-6.3z' },
  attack: { label: 'Attack', letter: 'A', color: '#FF6B4A', glyph: 'M11 2h2l.6 7.5 8.4 1.5v2.2l-8.4-.2-.4 6.5 3.3 1.5V23H7.5v-2l3.3-1.5-.4-6.5-8.4.2V11l8.4-1.5z' },
  heli: { label: 'Helicopters', letter: 'H', color: '#2DD4A3', glyph: 'M3 6.2l.8-.8L12 11l8.2-5.6.8.8L12.8 12l8.2 5.6-.8.8L12 13l-8.2 5.4-.8-.8L11.2 12zM12 8.4c1.3 0 2.3 1.5 2.3 3.4s-1 3.4-2.3 3.4-2.3-1.5-2.3-3.4 1-3.4 2.3-3.4zM11.4 14.6h1.2v7h-1.2z' },
  transport: { label: 'Transport', letter: 'T', color: '#7FA8C8', glyph: 'M11 1.5h2l.5 7.3 9 .7v2.3l-9-.3-.3 7.5 3.8 1V22H7v-2l3.8-1-.3-7.5-9 .3V9.5l9-.7z' },
  special: { label: 'Special missions', letter: 'S', color: '#8B7CF6', glyph: 'M11 1.5h2l.5 7.3 9 .7v2.3l-9-.3-.3 7.5 3.8 1V22H7v-2l3.8-1-.3-7.5-9 .3V9.5l9-.7zM12 12.2c2.4 0 4.2.9 4.2 2s-1.8 2-4.2 2-4.2-.9-4.2-2 1.8-2 4.2-2z' },
  training: { label: 'Training & test', letter: 'TT', color: '#D6E4F0', glyph: 'M9 2.6h6v1.2H9zM11.2 4h1.6l.5 6 6.7 1.2V13l-6.7-.3-.3 5 2.6 1.3V21H8.4v-2l2.6-1.3-.3-5-6.7.3v-1.8l6.7-1.2z' },
  // Bas utan typer i källorna (t.ex. Kubinka): neutral etikett.
  unknown: { label: 'Not listed', letter: '?', color: '#6F89A6', glyph: 'M11 1.5h2l.5 7.3 9 .7v2.3l-9-.3-.3 7.5 3.8 1V22H7v-2l3.8-1-.3-7.5-9 .3V9.5l9-.7z' },
};

export function getMilBase(key?: string | null): MilBase | null {
  return key ? D[key] ?? null : null;
}
/** Basens flygplan per roll, alla länders förband ihop (rollerna i den ordning de först förekommer). */
export function baseGroups(b: MilBase): [RoleKey, string[]][] {
  const out: [RoleKey, string[]][] = [];
  for (const op of b.ops) for (const [role, types] of op.g) {
    const g = out.find((x) => x[0] === role);
    if (g) types.forEach((t) => g[1].includes(t) || g[1].push(t)); else out.push([role, [...types]]);
  }
  return out;
}
/** Basens roller (huvudrollen först), eller null om flygplatsen inte är en av baserna. */
export function baseRoles(key?: string | null): RoleKey[] | null {
  const b = getMilBase(key);
  return b ? baseGroups(b).map((g) => g[0]) : null;
}
/** Förbandets land som flagga (ISO-2), annars namnet (NATO, SAC). */
export function operatorLabel(o: string): string {
  return /^[A-Z]{2}$/.test(o) ? flagEmoji(o) : o;
}
/** Antal baser totalt och per roll i det inlästa lagret. */
export function milCounts(): { all: number; roles: Record<RoleKey, number> } {
  if (counts) return counts;
  const roles = Object.fromEntries(ROLE_ORDER.map((r) => [r, 0])) as Record<RoleKey, number>;
  for (const b of Object.values(D)) for (const [r] of baseGroups(b)) roles[r]++;
  counts = { all: Object.keys(D).length, roles };
  return counts;
}

// ── Specific → Types: modellfamiljer ─────────────────────────────────────────
// Varje flygplanstyp på en bas hör till en familj ("Su-30SM2" → "Su-30", proxyns fam-tabell). Typvalet förfinar
// Specific: bara baser där någon av de valda familjerna finns.
export type TypeFamily = { role: RoleKey; name: string; desc: string; bases: number };

/** Familjen för en flygplanstyp (null = ingen, t.ex. en allmän etikett som "trainers"). */
export function typeFamily(type: string): string | null { return FAM[type] ?? null; }

/** Alla familjer per roll med antal baser, flest först (en bas räknas en gång per familj och roll). */
export function typeFamilies(): TypeFamily[] {
  if (famIdx) return famIdx;
  const m = new Map<string, TypeFamily>();
  for (const b of Object.values(D)) {
    const seen = new Set<string>();
    for (const op of b.ops) for (const [role, types] of op.g) for (const t of types) {
      const f = FAM[t];
      if (!f) continue;
      const k = `${role}|${f}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const e = m.get(k) ?? { role, name: f, desc: DESC[f] ?? '', bases: 0 };
      e.bases++;
      m.set(k, e);
    }
  }
  famIdx = [...m.values()].sort((a, b) => b.bases - a.bases || a.name.localeCompare(b.name));
  return famIdx;
}

/** Har basen någon av familjerna? */
export function baseHasFamily(key: string | null | undefined, fams: Set<string>): boolean {
  const b = getMilBase(key);
  if (!b || !fams.size) return false;
  for (const op of b.ops) for (const [, types] of op.g) for (const t of types) if (FAM[t] && fams.has(FAM[t])) return true;
  return false;
}

/** Sökförslag för Types: familjer vars namn börjar med frågan först, sedan namn som innehåller den, sedan träffar i
 *  beskrivningen; varje familj en gång (antal = unika baser). */
export function suggestFamilies(query: string, limit = 8): { name: string; desc: string; bases: number }[] {
  const q = query.trim().toLowerCase().replace(/[\s-]/g, '');
  if (!q) return [];
  const norm = (x: string) => x.toLowerCase().replace(/[\s-]/g, '');
  const by = new Map<string, { name: string; desc: string; bases: Set<string> }>();
  for (const [key, b] of Object.entries(D)) for (const op of b.ops) for (const [, types] of op.g) for (const t of types) {
    const f = FAM[t];
    if (!f) continue;
    const e = by.get(f) ?? { name: f, desc: DESC[f] ?? '', bases: new Set<string>() };
    e.bases.add(key);
    by.set(f, e);
  }
  const rank = (e: { name: string; desc: string }) => {
    const n = norm(e.name);
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    if (e.desc.toLowerCase().includes(query.trim().toLowerCase())) return 2;
    return 9;
  };
  return [...by.values()].map((e) => ({ ...e, r: rank(e) })).filter((e) => e.r < 9)
    .sort((a, b) => a.r - b.r || b.bases.size - a.bases.size || a.name.localeCompare(b.name))
    .slice(0, limit).map((e) => ({ name: e.name, desc: e.desc, bases: e.bases.size }));
}
