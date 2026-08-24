// Geografisk klustring av ALLA flygplatser (~81k) för Global map. Bygger ett Supercluster-index EN
// gång (lat/lon från seeden) och svarar sedan snabbt på "ge klustren för denna vy + zoom". Klustren
// delas automatiskt när man zoomar in → till slut enskilda flygplatser. Ersätter (pausar) land/region-
// drillen i klustringsläget; den gamla koden lämnas orörd.
import Supercluster from 'supercluster';
import type { SeedRow } from '../components/GlobalAirportMap';
import type { Region } from 'react-native-maps';

export type AirportProps = { icao: string; row: SeedRow };
type Index = Supercluster<AirportProps, { point_count: number }>;

// Bygg ett klusterindex från en GIVEN uppsättning flygplatser → RESPEKTERAR kartans filter (klustren
// speglar exakt de flygplatser som filtret släpper igenom). Cachar det SENAST byggda indexet per
// signatur (= filtersignaturen/mapKey), så att om-öppning eller återgång till samma filter är direkt
// utan ombyggnad. Lat = SeedRow[4], lon = SeedRow[5]. Synkron (~0,8s för ~70k) → anropa via
// InteractionManager.runAfterInteractions så JS-tråden inte fryser vid öppning.
let cacheSig: string | null = null;
let cacheIdx: Index | null = null;
export function clusterIndexFor(airports: SeedRow[], signature: string): Index {
  if (cacheSig === signature && cacheIdx) return cacheIdx;
  const points: GeoJSON.Feature<GeoJSON.Point, AirportProps>[] = [];
  for (const a of airports) {
    const lat = a[4], lon = a[5];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { icao: a[0], row: a } });
  }
  const index: Index = new Supercluster<AirportProps, { point_count: number }>({
    radius: 100,  // klusterradie i px — stor → FÄRRE/större kluster (fler flygplatser per plupp) → mindre kraschrisk
    maxZoom: 10,  // slutar klustra över zoom 10 → enskilda flygplatser. Lågt tak = ~4× snabbare bygge
                  // (färre trädnivåer). Verifierat: täta områden (London/LA/NYC) expanderar ändå fullt
                  // vid appens högsta zoom (~13) → inga kluster fastnar.
    minZoom: 0,
  });
  index.load(points);
  cacheSig = signature; cacheIdx = index;
  return index;
}

// Kartvy → supercluster-zoom (web-mercator). Bredare vy (större longitudeDelta) = lägre zoom.
export function regionToZoom(region: Region): number {
  const lonDelta = Math.max(1e-6, Math.abs(region.longitudeDelta));
  return Math.round(Math.log2(360 / lonDelta));
}

// Kartvy → bbox [väst, syd, öst, nord] för getClusters.
export function regionToBbox(region: Region): [number, number, number, number] {
  const lonHalf = Math.abs(region.longitudeDelta) / 2;
  const latHalf = Math.abs(region.latitudeDelta) / 2;
  return [region.longitude - lonHalf, region.latitude - latHalf, region.longitude + lonHalf, region.latitude + latHalf];
}
