// Filter-träd för globala kartan: kategori → undernivåer → löv (flervalsbara predikat). Bygger på
// airportmap.de:s EGEN klassning — INTE på flygplatsnamnet: type (large/medium/small/heliport/seaplane/
// altiport/balloonport) i SeedRow[8] och restriction (military = "air base", public/private/joint_use) i
// SeedRow[10]. "Properties" (banlängd/yta/lit) och closed-läget hanteras separat i GlobalMapModal.
import type { SeedRow } from '../components/GlobalAirportMap';
import { surfaceBit, type RwyInfo } from '../utils/runways';
import { getMilBase, baseRoles, ROLE_ORDER, ROLES, type RoleKey } from '../utils/milAirbases';

export type FilterNode = {
  key: string;                                        // unik nyckel (används i activeKeys-Set)
  label: string;
  match?: (r: SeedRow, rwy?: RwyInfo) => boolean;     // finns → valbart löv (kryssruta)
  children?: FilterNode[];                            // finns → nedborrningsbar
};

const rtype = (r: SeedRow) => r[8] ?? '';   // airportmap.de type-kategori
const rrestr = (r: SeedRow) => r[10] ?? ''; // airportmap.de restriction (access)
// Undertyper (SeedRow[12], kommaseparerade koder) från scripts/build-airport-subtypes.mjs — OpenStreetMap/Overture +
// namn. Helikopter: hp = helipad (upphöjd, på byggnad), os = offshore (plattform/fartyg). Flygbaser: af/nv/ar/mx.
// Flygfält: gl gliding, ul ultralight, fr farm & ranch, ap airpark, ag agricultural, lc lodge & camp, is island.
// Övrigt: sk skydiving, ic is/snö, sp spaceport, bh strandlandning.
export const subCodes = (r: SeedRow): string[] => (r[12] ? String(r[12]).split(',') : []);
const hasSub = (r: SeedRow, c: string) => !!r[12] && subCodes(r).includes(c);
const AIRFIELD_SUBS = ['gl', 'ul', 'fr', 'ap', 'ag', 'lc', 'is'];
const MIL_SUBS = ['af', 'nv', 'ar'];

// Grupperna på global map (knappraden). Varje grupp har ett "All"-löv (key = gruppens all-nyckel) och undertyper.
// Inom typgrupperna gäller ELLER (union); Access är en egen dimension och smalnar av (OCH) — se matchLeaves.
export type FilterGroup = { key: string; label: string; all: FilterNode; subs: FilterNode[]; info: string };
export const FILTER_GROUPS: FilterGroup[] = [
  {
    key: 'airports', label: 'Airports',
    all: { key: 'g:airports', label: 'All', match: (r) => rtype(r) === 'large' || rtype(r) === 'medium' },
    subs: [
      { key: 't:large', label: 'Large', match: (r) => rtype(r) === 'large' },
      { key: 't:medium', label: 'Medium', match: (r) => rtype(r) === 'medium' },
    ],
    info: 'Large: major airports with scheduled airline service and millions of passengers a year. Medium: regional airports with scheduled flights or busy general aviation. Sorted by traffic and role (OurAirports), not by runway length.',
  },
  {
    key: 'airbases', label: 'Air Bases',
    all: { key: 'r:military', label: 'All', match: (r) => rrestr(r) === 'military' || rrestr(r) === 'joint_use' },
    subs: [
      { key: 'mil:af', label: 'Air Force', match: (r) => rrestr(r) === 'military' && hasSub(r, 'af') },
      { key: 'mil:nv', label: 'Navy & Marines', match: (r) => rrestr(r) === 'military' && hasSub(r, 'nv') },
      { key: 'mil:ar', label: 'Army', match: (r) => rrestr(r) === 'military' && hasSub(r, 'ar') },
      { key: 'mil:x', label: 'Other military', match: (r) => rrestr(r) === 'military' && !MIL_SUBS.some((c) => hasSub(r, c)) },
      { key: 'mil:heli', label: 'Military heliports', match: (r) => rrestr(r) === 'military' && rtype(r) === 'heliport' },
      { key: 'mil:joint', label: 'Joint use', match: (r) => rrestr(r) === 'joint_use' },
    ],
    info: 'Military airfields, by the service that runs them (from the name and OpenStreetMap); bases we cannot place are under Other military. Joint use airports are shared by airlines and the military.',
  },
  {
    key: 'airfields', label: 'Airfields',
    all: { key: 't:small', label: 'All', match: (r) => rtype(r) === 'small' },
    subs: [
      { key: 'sm:ga', label: 'General aviation', match: (r) => rtype(r) === 'small' && !AIRFIELD_SUBS.some((c) => hasSub(r, c)) },
      { key: 'sm:gl', label: 'Gliding', match: (r) => hasSub(r, 'gl') },
      { key: 'sm:ul', label: 'Ultralight', match: (r) => hasSub(r, 'ul') },
      { key: 'sm:fr', label: 'Farm & ranch strips', match: (r) => hasSub(r, 'fr') },
      { key: 'sm:ap', label: 'Airparks', match: (r) => hasSub(r, 'ap') },
      { key: 'sm:ag', label: 'Agricultural', match: (r) => hasSub(r, 'ag') },
      { key: 'sm:lc', label: 'Lodges & camps', match: (r) => hasSub(r, 'lc') },
      { key: 'sm:is', label: 'Island strips', match: (r) => hasSub(r, 'is') },
    ],
    info: 'Small airfields and strips, by what they are used for (from the name and OpenStreetMap). Airparks are fly-in communities where homes have taxiway access. Lodges & camps and island strips go by the name.',
  },
  {
    key: 'heli', label: 'Helicopter',
    all: { key: 't:heliport', label: 'All', match: (r) => rtype(r) === 'heliport' },
    subs: [
      { key: 'h:port', label: 'Heliports', match: (r) => rtype(r) === 'heliport' && !hasSub(r, 'hp') && !hasSub(r, 'os') },
      { key: 'h:pad', label: 'Helipads', match: (r) => rtype(r) === 'heliport' && hasSub(r, 'hp') },
      { key: 'h:off', label: 'Offshore', match: (r) => rtype(r) === 'heliport' && hasSub(r, 'os') },
    ],
    info: 'Helipads are raised pads on buildings, such as hospital roofs. Offshore are helidecks on platforms and ships. Heliports are everything else.',
  },
  {
    key: 'other', label: 'Other',
    all: { key: 'g:other', label: 'All', match: (r) => ['seaplane', 'altiport', 'balloonport'].includes(rtype(r)) || hasSub(r, 'sk') || hasSub(r, 'ic') || hasSub(r, 'sp') || hasSub(r, 'bh') },
    subs: [
      { key: 't:seaplane', label: 'Seaplane bases', match: (r) => rtype(r) === 'seaplane' },
      { key: 't:altiport', label: 'Altiports', match: (r) => rtype(r) === 'altiport' },
      { key: 't:balloonport', label: 'Balloonports', match: (r) => rtype(r) === 'balloonport' },
      { key: 'o:sk', label: 'Skydiving', match: (r) => hasSub(r, 'sk') },
      { key: 'o:ic', label: 'Ice & snow', match: (r) => hasSub(r, 'ic') },
      { key: 'o:sp', label: 'Spaceports', match: (r) => hasSub(r, 'sp') },
      { key: 'o:bh', label: 'Beach landings', match: (r) => hasSub(r, 'bh') },
    ],
    info: 'Seaplane bases land on water, altiports are steep mountain strips, balloonports are launch sites. Ice & snow are runways on ice, snow or glaciers; beach landings are sand strips on the shore.',
  },
];

// Air Bases → Specific: militära flygbaser per roll (OSINT-lagret från proxyn, utils/milAirbases; antalen = milCounts()). Egen sida i Air Bases-panelen; ELLER mot de
// andra typvalen som vanligt. När något här är valt ritas baserna med rollsymboler och förbandskortet ersätter
// flygplatskortet (GlobalMapModal).
export type SpecificNode = FilterNode & { role: RoleKey | null };
export const SPECIFIC_NODES: SpecificNode[] = [
  { key: 'rb:all', label: 'All', role: null, match: (r) => !!getMilBase(r[0]) },
  ...ROLE_ORDER.map((role) => ({ key: `rb:${role}`, label: ROLES[role].label, role,
    match: (r: SeedRow) => !!baseRoles(r[0])?.includes(role) })),
];
export const isSpecificKey = (k: string) => k.startsWith('rb:');

// Access (egen dimension, OCH mot typvalet).
export const ACCESS_NODES: FilterNode[] = [
  { key: 'r:public', label: 'Public', match: (r) => rrestr(r) === 'public' },
  { key: 'r:private', label: 'Private', match: (r) => rrestr(r) === 'private' },
  { key: 'r:joint', label: 'Joint Use', match: (r) => rrestr(r) === 'joint_use' },
];

// ── Löv-index (key → löv med predikat) ───────────────────────────────────────
export type FilterLeaf = { key: string; label: string; access: boolean; match: (r: SeedRow, rwy?: RwyInfo) => boolean };
const LEAVES = new Map<string, FilterLeaf>();
for (const g of FILTER_GROUPS) {
  LEAVES.set(g.all.key, { key: g.all.key, label: g.label, access: false, match: g.all.match! });
  for (const n of g.subs) LEAVES.set(n.key, { key: n.key, label: n.label, access: false, match: n.match! });
}
for (const n of ACCESS_NODES) LEAVES.set(n.key, { key: n.key, label: n.label, access: true, match: n.match! });
for (const n of SPECIFIC_NODES) LEAVES.set(n.key, { key: n.key, label: n.role ? `${n.label} bases` : 'Military air bases', access: false, match: n.match! });

/** Aktiva lövs predikat (i valfri ordning). */
export function leavesFor(activeKeys: Set<string>): FilterLeaf[] {
  const out: FilterLeaf[] = [];
  for (const k of activeKeys) { const l = LEAVES.get(k); if (l) out.push(l); }
  return out;
}

/** Släpper filtret igenom flygplatsen? Typlöven = ELLER, Access = ELLER inom sig och OCH mot typerna. Inga löv = allt. */
export function matchLeaves(leaves: FilterLeaf[], r: SeedRow, rwy?: RwyInfo): boolean {
  let anyType = false, typeOk = false, anyAcc = false, accOk = false;
  for (const l of leaves) {
    if (l.access) { anyAcc = true; if (!accOk && l.match(r, rwy)) accOk = true; }
    else { anyType = true; if (!typeOk && l.match(r, rwy)) typeOk = true; }
  }
  return (!anyType || typeOk) && (!anyAcc || accOk);
}

/** Etikett för antals-visning: exakt ETT aktivt typlöv → dess plural (ex "Airfields"), annars "Airports". */
export function filterCountLabel(activeKeys: Set<string>): string {
  const all = leavesFor(activeKeys);
  const leaves = all.filter((l) => !l.access);
  if (!leaves.length && all.length === 1) return ({ Public: 'Public Airports', Private: 'Private Airports', 'Joint Use': 'Joint-Use Airports' } as Record<string, string>)[all[0].label] ?? 'Airports';
  if (leaves.length !== 1) return 'Airports';
  const special: Record<string, string> = {
    Large: 'Large Airports', Medium: 'Medium Airports', Helicopter: 'Helicopter sites', Other: 'Sites',
    'Air Force': 'Air Force bases', 'Navy & Marines': 'Navy bases', Army: 'Army airfields', 'Other military': 'Air Bases',
    'General aviation': 'Airfields', Gliding: 'Gliding sites', Ultralight: 'Ultralight fields', 'Farm & ranch strips': 'Farm strips',
    Agricultural: 'Ag strips', Skydiving: 'Skydiving fields', 'Ice & snow': 'Ice & snow runways', 'Military heliports': 'Military heliports',
    'Joint use': 'Joint-use airports', 'Military air bases': 'Military air bases', 'Lodges & camps': 'Lodge & camp strips', 'Island strips': 'Island strips', 'Beach landings': 'Beach strips',
  };
  const l = leaves[0].label;
  return special[l] ?? (l.endsWith('s') ? l : `${l}s`);
}

/** Behöver banindexet slås upp för dessa lager? (ytlöv) */
export function keysNeedRunway(activeKeys: Set<string>): boolean {
  for (const k of activeKeys) if (k.includes(':asphalt') || k.includes(':grass') || k.includes(':unknown')) return true;
  return false;
}

// ── Properties (AND-refinering) ──────────────────────────────────────────────
// surface: valda ytor (flerval, SURFACE_FILTERS i utils/runways); tom = alla.
export type MapProps = { minLenM: number | null; maxLenM: number | null; surface: string[]; minAltFt: number | null; maxAltFt: number | null };
export const EMPTY_PROPS: MapProps = { minLenM: null, maxLenM: null, surface: [], minAltFt: null, maxAltFt: null };

export function propsActive(p: MapProps): boolean {
  return p.minLenM != null || p.maxLenM != null || p.surface.length > 0 || p.minAltFt != null || p.maxAltFt != null;
}

/** Uppfyller en flygplats (via dess banindex) de aktiva Properties? Utan bandata → faller bort. */
export function matchProps(rwy: RwyInfo | undefined, p: MapProps): boolean {
  if (!rwy || !rwy.hasData) return false;
  if (p.minLenM != null && rwy.maxLenM < p.minLenM) return false;
  if (p.maxLenM != null && rwy.maxLenM > p.maxLenM) return false;
  // Någon öppen bana med någon av de valda ytorna.
  if (p.surface.length && !(rwy.surfaces & p.surface.reduce((m, s) => m | surfaceBit(s), 0))) return false;
  return true;
}
