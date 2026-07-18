// Filter-träd för globala kartan: kategori → undernivåer → löv (flervalsbara predikat). Ersätter
// det gamla enkelval-typfiltret. Löv matchar på flygplatsnamnet (r[1]); ytlöven (Fields → Asphalt/
// Grass/Unknown) och "Properties" slår även upp banindexet (getRunwayIndex). Air Base delas i
// Naval/Air Force/RAF/Army/Other; Fields (Airfield/Airstrip/Aerodrome/Airpark) delas per yta.
import type { SeedRow } from '../components/GlobalAirportMap';
import { type RwyInfo } from '../utils/runways';

export type FilterNode = {
  key: string;                                        // unik nyckel (används i activeKeys-Set)
  label: string;
  match?: (r: SeedRow, rwy?: RwyInfo) => boolean;     // finns → valbart löv (kryssruta)
  children?: FilterNode[];                            // finns → nedborrningsbar
};

// ── Namn-regexar (samma som gamla AIRPORT_TYPES) ─────────────────────────────
const RE = {
  seaplane: /sea ?plane|float ?plane|water aerodrome|hydroba/i,
  heliport: /heliport/i,
  hospital: /hospital|medical|clinic/i,
  helipad: /helipad|helicopter|helibase/i,
  airfield: /airfield|air field/i,
  airstrip: /airstrip|air strip|landing strip/i,
  aerodrome: /aerodrome/i,
  airpark: /airpark|air park/i,
  glider: /glider|gliding|segelflug/i,
  ultralight: /ultralight|microlight/i,
  balloon: /balloon/i,
  farm: /ranch|farm(?!ington)/i,
  // Air Base-undertyper
  naval: /naval air|marine corps air|\bMCAS\b|naval station/i,
  airforce: /air ?force|\bAFB\b/i,
  raf: /\bRAF\b|royal air force/i,
  army: /army (air)?field|\bAAF\b|army air/i,
  airbase: /air ?base|\bAFB\b|\bRAF\b|naval air|air force|military|\bMCAS\b|army air/i, // paraply
};

// Air Base "Other" = allt inom paraplyet som inte är Naval/Air Force/RAF/Army.
const abOther = (r: SeedRow) =>
  RE.airbase.test(r[1]) && !RE.naval.test(r[1]) && !RE.airforce.test(r[1]) && !RE.raf.test(r[1]) && !RE.army.test(r[1]);

export const FILTER_TREE: FilterNode[] = [
  {
    key: 'airbase', label: 'Air Base',
    children: [
      { key: 'ab:naval', label: 'Naval', match: (r) => RE.naval.test(r[1]) },
      { key: 'ab:airforce', label: 'Air Force', match: (r) => RE.airforce.test(r[1]) },
      { key: 'ab:raf', label: 'RAF', match: (r) => RE.raf.test(r[1]) },
      { key: 'ab:army', label: 'Army', match: (r) => RE.army.test(r[1]) },
      { key: 'ab:other', label: 'Other', match: abOther },
    ],
  },
  {
    key: 'helicopter', label: 'Helicopter',
    children: [
      { key: 'heli:heliport', label: 'Heliport', match: (r) => RE.heliport.test(r[1]) },
      { key: 'heli:hospital', label: 'Hospital', match: (r) => RE.hospital.test(r[1]) },
      { key: 'heli:helipad', label: 'Helipad', match: (r) => RE.helipad.test(r[1]) },
    ],
  },
  {
    // Ytan (asphalt/grass) väljs via Properties (minst en registrerad hård/gräs-bana), inte här.
    key: 'fields', label: 'Fields',
    children: [
      { key: 'field:airfield', label: 'Airfield', match: (r) => RE.airfield.test(r[1]) },
      { key: 'field:airstrip', label: 'Airstrip', match: (r) => RE.airstrip.test(r[1]) },
      { key: 'field:aerodrome', label: 'Aerodrome', match: (r) => RE.aerodrome.test(r[1]) },
      { key: 'field:airpark', label: 'Airpark', match: (r) => RE.airpark.test(r[1]) },
    ],
  },
  {
    key: 'other', label: 'Other',
    children: [
      { key: 'other:glider', label: 'Glider', match: (r) => RE.glider.test(r[1]) },
      { key: 'other:ultralight', label: 'Ultralight', match: (r) => RE.ultralight.test(r[1]) },
      { key: 'other:balloon', label: 'Balloon', match: (r) => RE.balloon.test(r[1]) },
      { key: 'other:farm', label: 'Farm/Ranch', match: (r) => RE.farm.test(r[1]) },
      { key: 'other:seaplane', label: 'Seaplane', match: (r) => RE.seaplane.test(r[1]) },
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
    Naval: 'Naval Bases', 'Air Force': 'Air Force Bases', RAF: 'RAF Bases',
    Army: 'Army Bases', Other: 'Air Bases', 'Farm/Ranch': 'Farm/Ranch Fields',
  };
  const label = leaves[0].label;
  return special[label] ?? `${label}s`;
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
export type MapProps = { minLenM: number | null; maxLenM: number | null; surface: 'asphalt' | 'grass' | null; lit: boolean };
export const EMPTY_PROPS: MapProps = { minLenM: null, maxLenM: null, surface: null, lit: false };

export function propsActive(p: MapProps): boolean {
  return p.minLenM != null || p.maxLenM != null || p.surface != null || p.lit;
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
