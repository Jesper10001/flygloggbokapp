// Filter-träd för globala kartan: kategori → undernivåer → löv (flervalsbara predikat). Bygger på
// airportmap.de:s EGEN klassning — INTE på flygplatsnamnet: type (large/medium/small/heliport/seaplane/
// altiport/balloonport) i SeedRow[8] och restriction (military = "air base", public/private/joint_use) i
// SeedRow[10]. "Properties" (banlängd/yta/lit) och closed-läget hanteras separat i GlobalMapModal.
import type { SeedRow } from '../components/GlobalAirportMap';
import { type RwyInfo } from '../utils/runways';

export type FilterNode = {
  key: string;                                        // unik nyckel (används i activeKeys-Set)
  label: string;
  match?: (r: SeedRow, rwy?: RwyInfo) => boolean;     // finns → valbart löv (kryssruta)
  children?: FilterNode[];                            // finns → nedborrningsbar
};

const rtype = (r: SeedRow) => r[8] ?? '';   // airportmap.de type-kategori
const rrestr = (r: SeedRow) => r[10] ?? ''; // airportmap.de restriction (access)

// airportmap.de-kategorier: large+medium = "Airports", small = "Airfields", military = "Air Bases".
// (closed hanteras EJ här — det är ett separat läge; standardvyn döljer closed.)
export const FILTER_TREE: FilterNode[] = [
  {
    key: 'airports', label: 'Airports',
    children: [
      { key: 't:large', label: 'Large', match: (r) => rtype(r) === 'large' },
      { key: 't:medium', label: 'Medium', match: (r) => rtype(r) === 'medium' },
    ],
  },
  { key: 't:small', label: 'Airfields', match: (r) => rtype(r) === 'small' },
  { key: 't:heliport', label: 'Heliports', match: (r) => rtype(r) === 'heliport' },
  { key: 't:seaplane', label: 'Seaplane Bases', match: (r) => rtype(r) === 'seaplane' },
  { key: 'r:military', label: 'Air Bases', match: (r) => rrestr(r) === 'military' },
  { key: 't:altiport', label: 'Altiports', match: (r) => rtype(r) === 'altiport' },
  { key: 't:balloonport', label: 'Balloonports', match: (r) => rtype(r) === 'balloonport' },
  {
    key: 'access', label: 'Access',
    children: [
      { key: 'r:public', label: 'Public', match: (r) => rrestr(r) === 'public' },
      { key: 'r:private', label: 'Private', match: (r) => rrestr(r) === 'private' },
      { key: 'r:joint', label: 'Joint Use', match: (r) => rrestr(r) === 'joint_use' },
    ],
  },
];

// ── Löv-index (key → löv med predikat) ───────────────────────────────────────
export type FilterLeaf = { key: string; label: string; match: (r: SeedRow, rwy?: RwyInfo) => boolean };
const LEAVES = new Map<string, FilterLeaf>();
(function flatten(nodes: FilterNode[]) {
  for (const n of nodes) {
    if (n.match) LEAVES.set(n.key, { key: n.key, label: n.label, match: n.match });
    if (n.children) flatten(n.children);
  }
})(FILTER_TREE);

/** Aktiva lövs predikat (i valfri ordning). */
export function leavesFor(activeKeys: Set<string>): FilterLeaf[] {
  const out: FilterLeaf[] = [];
  for (const k of activeKeys) { const l = LEAVES.get(k); if (l) out.push(l); }
  return out;
}

/** Etikett för antals-visning: exakt ETT aktivt lager → dess plural (ex "Airfields"), annars "Airports". */
export function filterCountLabel(activeKeys: Set<string>): string {
  const leaves = leavesFor(activeKeys);
  if (leaves.length !== 1) return 'Airports';
  const special: Record<string, string> = {
    Large: 'Large Airports', Medium: 'Medium Airports',
    Public: 'Public Airports', Private: 'Private Airports', 'Joint Use': 'Joint-Use Airports',
  };
  const l = leaves[0].label;
  return special[l] ?? (l.endsWith('s') ? l : `${l}s`);
}

/** Antal aktiva löv under en nod (för att visa gren-räknare i filter-boxen). */
export function activeCountUnder(node: FilterNode, activeKeys: Set<string>): number {
  let n = 0;
  const walk = (x: FilterNode) => { if (x.match && activeKeys.has(x.key)) n++; x.children?.forEach(walk); };
  walk(node);
  return n;
}

/** Behöver banindexet slås upp för dessa lager? (ytlöv) */
export function keysNeedRunway(activeKeys: Set<string>): boolean {
  for (const k of activeKeys) if (k.includes(':asphalt') || k.includes(':grass') || k.includes(':unknown')) return true;
  return false;
}

// ── Properties (AND-refinering) ──────────────────────────────────────────────
export type MapProps = { minLenM: number | null; maxLenM: number | null; surface: 'asphalt' | 'grass' | null; lit: boolean; minAltFt: number | null; maxAltFt: number | null };
export const EMPTY_PROPS: MapProps = { minLenM: null, maxLenM: null, surface: null, lit: false, minAltFt: null, maxAltFt: null };

export function propsActive(p: MapProps): boolean {
  return p.minLenM != null || p.maxLenM != null || p.surface != null || p.lit || p.minAltFt != null || p.maxAltFt != null;
}

/** Uppfyller en flygplats (via dess banindex) de aktiva Properties? Utan bandata → faller bort. */
export function matchProps(rwy: RwyInfo | undefined, p: MapProps): boolean {
  if (!rwy || !rwy.hasData) return false;
  if (p.minLenM != null && rwy.maxLenM < p.minLenM) return false;
  if (p.maxLenM != null && rwy.maxLenM > p.maxLenM) return false;
  if (p.surface === 'asphalt' && !rwy.hasHard) return false;
  if (p.surface === 'grass' && !rwy.hasGrass) return false;
  if (p.lit && !rwy.anyLit) return false;
  return true;
}
