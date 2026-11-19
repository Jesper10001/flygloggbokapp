// Ryska flygbaser med förband och flygplanstyper (assets/ru-airbases.json, byggd av scripts/build-ru-airbases.mjs ur
// användarens fil). Används av filtret Air Bases → Specific och förbandskortet (components/UnitCard.tsx).
// Rollerna: symbol (siluett ovanifrån, viewBox 24), bokstav och färg (Blades palett; bara etikettens kant färgas).
import data from '../assets/ru-airbases.json';
import { flagEmoji } from '../constants/continents';

export type RoleKey = 'fighter' | 'bomber' | 'attack' | 'heli' | 'transport' | 'special' | 'training';
export type RuBase = { o: string; n: string; r: string; c: string; u: string[]; g: [RoleKey, string[]][] };

/** När användarens fil sammanställdes (visas i Source-rutan). */
export const RU_DATA_COMPILED = '19 November 2026';
const D = data as unknown as Record<string, RuBase>;

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

export function getRuBase(key?: string | null): RuBase | null {
  return key ? D[key] ?? null : null;
}
/** Basens roller i ordning (huvudrollen först), eller null om flygplatsen inte är en av baserna. */
export function ruBaseRoles(key?: string | null): RoleKey[] | null {
  const b = getRuBase(key);
  return b ? b.g.map((g) => g[0]) : null;
}
export const RU_BASE_COUNT = Object.keys(D).length;
export const RU_ROLE_COUNTS: Record<RoleKey, number> = (() => {
  const c = Object.fromEntries(ROLE_ORDER.map((r) => [r, 0])) as Record<RoleKey, number>;
  for (const b of Object.values(D)) for (const [r] of b.g) c[r]++;
  return c;
})();

/** Kartetiketten för en bas: förbandets flagga + rollbokstäverna, huvudrollen först ("🇷🇺 B, H"). null = ingen bas. */
export function ruBaseTag(key: string): string | null {
  const b = D[key];
  if (!b) return null;
  return `${flagEmoji(b.o || 'RU')} ${b.g.length ? b.g.map((g) => ROLES[g[0]].letter).join(', ') : '?'}`;
}
