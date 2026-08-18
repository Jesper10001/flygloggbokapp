// OpenAIP vektor-luftrum: hämtar polygon-geometri (GeoJSON) on-demand per kartvy från core-API:t
// och exponerar den som ritbara react-native-maps-polygoner. Ersätter den gamla raster-tile-overlayn
// (en färdig bild gick inte att toggla/styla/söka i). Nyckeln (samma som tiles) skickas som header.
//
// OBS: OpenAIP-data är CC BY-NC-SA (icke-kommersiell) → kräver licensklarhet före release.
// bbox-anrop är begränsade till max 5° bredd/höjd → vi hämtar bara när kartan är tillräckligt inzoomad.

export const OPENAIP_KEY = process.env.EXPO_PUBLIC_OPENAIP_API_KEY ?? '';
const BASE = 'https://api.core.openaip.net/api';
const HEADERS = { 'x-openaip-api-key': OPENAIP_KEY };

export type LatLng = { latitude: number; longitude: number };
type Limit = { value: number; unit: number; referenceDatum: number };

export type Airspace = {
  id: string;
  name: string;
  type: number;
  country?: string;
  lower?: Limit;
  upper?: Limit;
  coordinates: LatLng[];      // yttre ring
  holes: LatLng[][];          // ev. inre ringar (hål)
};

// ── Kategorier (grupperar OpenAIP:s ~25 typkoder till hanterbara lager i UI:t) ──
// Färgerna är fasta (fungerar som legend) men valda i Blades-anda. FIR/UIR (10/11) exkluderas helt
// eftersom de är landsstora och meningslösa som overlay.
//
// showAtSpan = största kartvidd (grader lat/lon) där kategorin ritas. Mindre span = mer inzoomad.
// Detta ger progressiv detaljnivå (LOD): stora/viktiga områden (R/P/D) syns tidigt, småzoner (ATZ,
// Other) först när man zoomat in. Samma mekanism hindrar kraschen vid utzoomning: inget ritas när
// span > 5° (API:ts bbox-gräns), så kartan är tom på globen även om gammal data ligger kvar i state.
export type AirspaceCategory = { key: string; label: string; color: string; types: number[]; defaultOn: boolean; showAtSpan: number };

export const AIRSPACE_CATEGORIES: AirspaceCategory[] = [
  { key: 'restricted', label: 'Restricted (R)', color: '#FF4D6A', types: [1], defaultOn: true, showAtSpan: 5.0 },
  { key: 'danger', label: 'Danger (D)', color: '#FFB830', types: [2], defaultOn: true, showAtSpan: 5.0 },
  { key: 'prohibited', label: 'Prohibited (P)', color: '#E01040', types: [3], defaultOn: true, showAtSpan: 5.0 },
  { key: 'ctr', label: 'CTR', color: '#3B82F6', types: [4], defaultOn: true, showAtSpan: 2.5 },
  { key: 'tma', label: 'TMA', color: '#A855F7', types: [7], defaultOn: true, showAtSpan: 2.5 },
  { key: 'military', label: 'TRA / TSA / Gliding', color: '#EC4899', types: [8, 9, 21], defaultOn: true, showAtSpan: 1.2 },
  { key: 'mz', label: 'TMZ / RMZ', color: '#14B8A6', types: [5, 6], defaultOn: true, showAtSpan: 1.2 },
  { key: 'tiz', label: 'TIZ / TIA', color: '#34D399', types: [23, 24], defaultOn: true, showAtSpan: 1.2 },
  { key: 'atz', label: 'ATZ / MATZ / HTZ', color: '#60A5FA', types: [13, 14, 20], defaultOn: true, showAtSpan: 0.5 },
  { key: 'other', label: 'Other', color: '#94A3B8', types: [0, 12, 15, 16, 17, 18, 19, 22, 25, 26], defaultOn: false, showAtSpan: 0.5 },
];

const TYPE_TO_COLOR = new Map<number, string>();
const TYPE_TO_CATEGORY = new Map<number, string>();
const TYPE_TO_SPAN = new Map<number, number>();
const TYPE_TO_PRIORITY = new Map<number, number>();
AIRSPACE_CATEGORIES.forEach((c, i) => {
  for (const t of c.types) {
    TYPE_TO_COLOR.set(t, c.color);
    TYPE_TO_CATEGORY.set(t, c.key);
    TYPE_TO_SPAN.set(t, c.showAtSpan);
    TYPE_TO_PRIORITY.set(t, i); // lägre index = viktigare (överlever kapning först)
  }
});

export function colorForType(type: number): string { return TYPE_TO_COLOR.get(type) ?? '#94A3B8'; }
export function categoryForType(type: number): string { return TYPE_TO_CATEGORY.get(type) ?? 'other'; }
// Största kartvidd (grader) där typen ska ritas — hjärtat i den progressiva detaljnivån.
export function showAtSpanForType(type: number): number { return TYPE_TO_SPAN.get(type) ?? 0.5; }
// Prioritet vid polygon-kapning (lägre = viktigare, ritas hellre än småzoner).
export function priorityForType(type: number): number { return TYPE_TO_PRIORITY.get(type) ?? 99; }

// FIR/UIR ritas aldrig (landsstora boxar).
const EXCLUDED_TYPES = new Set([10, 11]);

// ── Höjdgräns → läsbar text ──────────────────────────────────────────────────
// unit: 1=ft, 6=FL, 0=m. referenceDatum: 0=GND, 1=MSL, 2=STD.
export function formatLimit(l?: Limit): string {
  if (!l) return '—';
  if (l.unit === 6) return l.value >= 600 ? 'UNL' : `FL${l.value}`;
  if (l.referenceDatum === 0) return l.value === 0 ? 'GND' : `${l.value} ft AGL`;
  const suffix = l.unit === 0 ? ' m' : ' ft';
  return `${l.value}${suffix} MSL`;
}

// ── GeoJSON → Airspace ────────────────────────────────────────────────────────
function toLatLng(ring: number[][]): LatLng[] {
  return ring.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}

function parse(item: any): Airspace | null {
  const g = item?.geometry;
  if (!g || g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !g.coordinates.length) return null;
  const rings: number[][][] = g.coordinates;
  // Degenererad yttre ring (< 3 punkter) → hoppa över; MapKit kan krascha på tomma/linje-polygoner.
  if (!Array.isArray(rings[0]) || rings[0].length < 3) return null;
  return {
    id: item._id,
    name: item.name ?? '',
    type: item.type,
    country: item.country,
    lower: item.lowerLimit,
    upper: item.upperLimit,
    coordinates: toLatLng(rings[0]),
    holes: rings.slice(1).map(toLatLng),
  };
}

async function apiGet(path: string): Promise<any[]> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`OpenAIP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.items) ? json.items : [];
}

// ── bbox-hämtning (per kartvy) med enkel cache på avrundad box ────────────────
export type Bbox = { lonMin: number; latMin: number; lonMax: number; latMax: number };
export const MAX_BBOX_DEG = 5; // API-gräns

const bboxCache = new Map<string, Airspace[]>();

export async function fetchAirspacesInBbox(b: Bbox): Promise<Airspace[]> {
  // Avrunda till 0.1° → små pan/zoom återanvänder cachen.
  const r = (n: number) => Math.round(n * 10) / 10;
  const key = `${r(b.lonMin)},${r(b.latMin)},${r(b.lonMax)},${r(b.latMax)}`;
  const cached = bboxCache.get(key);
  if (cached) return cached;
  const items = await apiGet(`/airspaces?bbox=${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}&limit=1000`);
  const list = items.map(parse).filter((a): a is Airspace => !!a && !EXCLUDED_TYPES.has(a.type));
  bboxCache.set(key, list);
  return list;
}

// ── R-områden per land (för sök) — API:ts search-param fungerar inte, så vi hämtar
// landets R-områden (få, paginerat) och söker klient-sida. Cachas per land. ──────
const rAreaCache = new Map<string, Airspace[]>();

export async function fetchRestrictedForCountry(country: string): Promise<Airspace[]> {
  const cc = country.toUpperCase();
  const hit = rAreaCache.get(cc);
  if (hit) return hit;
  const all: Airspace[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${BASE}/airspaces?type=1&country=${cc}&limit=100&page=${page}`, { headers: HEADERS });
    if (!res.ok) break;
    const json = await res.json();
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    for (const it of items) { const a = parse(it); if (a) all.push(a); }
    if (!json?.nextPage || items.length === 0) break;
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  rAreaCache.set(cc, all);
  return all;
}

// Region-mitten (lat/lon-bounds för att animera kartan till ett valt luftrum).
export function boundsOf(coords: LatLng[]): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const c of coords) {
    minLat = Math.min(minLat, c.latitude); maxLat = Math.max(maxLat, c.latitude);
    minLon = Math.min(minLon, c.longitude); maxLon = Math.max(maxLon, c.longitude);
  }
  const latDelta = Math.max((maxLat - minLat) * 1.6, 0.15);
  const lonDelta = Math.max((maxLon - minLon) * 1.6, 0.15);
  return { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2, latitudeDelta: latDelta, longitudeDelta: lonDelta };
}
