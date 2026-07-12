// "Your matrix" — ritar det största möjliga höljet (convex hull) mellan besökta
// flygplatser: en fylld cyan-figur vars hörn är de yttersta flygplatserna. Flygplatser
// inuti höljet blir inga hörn (ökar inte arean). Kräver minst 3 flygplatser. Apple Maps,
// samma markörstil som "Visited airports". Inkapslad area visas nere till vänster.
import { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import MapView, { Marker, Polygon, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { getVisitedAirportIcaos } from '../db/flights';
import { getAirportCoordinates } from '../db/icao';
import { useFlightStore } from '../store/flightStore';

type Pt = { icao: string; name: string; lat: number; lon: number };

// Convex hull (Andrew's monotone chain). Kollinjära punkter (<= 0) tas bort → bara
// äkta hörn behålls, så en flygplats på en kant eller inuti höljet ger inget nytt hörn.
function convexHull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return [...pts];
  const p = [...pts].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const lower: Pt[] = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [...pts];
}

// Sfärisk polygonarea (km²) — tar hänsyn till jordens krökning för stora höljen.
function sphericalAreaKm2(hull: Pt[]): number {
  if (hull.length < 3) return 0;
  const R = 6371.0088; // km
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    total += (b.lon * rad - a.lon * rad) * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
  }
  return Math.abs(total * R * R / 2);
}

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function formatArea(km2: number): string {
  if (km2 <= 0) return '—';
  if (km2 >= 1_000_000) return `${(km2 / 1_000_000).toFixed(2)} M km²`;
  if (km2 >= 1) return `${group(Math.round(km2))} km²`;
  return `${group(Math.round(km2 * 1_000_000))} m²`;
}

// Jämför-ytor (km²): Earth = total yta, kontinenter = landyta. Tap cyklar listan.
const REGIONS: { name: string; area: number }[] = [
  { name: 'Earth', area: 510_072_000 },
  { name: 'Africa', area: 30_370_000 },
  { name: 'Asia', area: 44_579_000 },
  { name: 'Europe', area: 10_180_000 },
  { name: 'North America', area: 24_709_000 },
  { name: 'South America', area: 17_840_000 },
  { name: 'Oceania', area: 8_600_000 },
  { name: 'Antarctica', area: 14_200_000 },
];
function formatPct(km2: number, regionKm2: number): string {
  const p = (km2 / regionKm2) * 100;
  if (p <= 0) return '0%';
  if (p >= 10) return `${p.toFixed(0)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p >= 0.01) return `${p.toFixed(2)}%`;
  return '<0.01%';
}

function fitRegion(pts: Pt[]): Region {
  if (!pts.length) return { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 120 };
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const p of pts) { minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat); minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon); }
  return {
    latitude: (minLa + maxLa) / 2,
    longitude: (minLo + maxLo) / 2,
    latitudeDelta: Math.max(2, Math.min(160, (maxLa - minLa) * 1.4 + 3)),
    longitudeDelta: Math.max(2, Math.min(330, (maxLo - minLo) * 1.4 + 3)),
  };
}

export function MatrixMapWidget() {
  const insets = useSafeAreaInsets();
  const [pts, setPts] = useState<Pt[]>([]);
  const [open, setOpen] = useState(false);
  const [regionIdx, setRegionIdx] = useState(0); // 0 = Earth; tap cyklar kontinenter
  // Dashboarden laddar om flights vid fokus → uppdatera matrixen när de ändras.
  const flights = useFlightStore((st) => st.flights);

  useEffect(() => {
    let alive = true;
    (async () => {
      const icaos = await getVisitedAirportIcaos();
      const coords = icaos.length ? await getAirportCoordinates(icaos) : []; // {icao,name,lat,lon}, endast med koordinater
      if (!alive) return;
      setPts(coords.filter((c) => isFinite(c.lat) && isFinite(c.lon)).map((c) => ({ icao: c.icao, name: c.name, lat: c.lat, lon: c.lon })));
    })();
    return () => { alive = false; };
  }, [flights]);

  const hull = useMemo(() => convexHull(pts), [pts]);
  const area = useMemo(() => sphericalAreaKm2(hull), [hull]);
  const ready = hull.length >= 3;
  const region = useMemo(() => fitRegion(hull.length ? hull : pts), [hull, pts]);

  return (
    <>
      <TouchableOpacity
        style={s.compactCard}
        onPress={() => ready && setOpen(true)}
        activeOpacity={ready ? 0.75 : 1}
      >
        <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shapes" size={16} color={Colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '800', color: Colors.primary, fontFamily: 'Menlo' }}>{ready ? formatArea(area) : '—'}</Text>
          <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, fontFamily: 'Menlo', marginTop: 1 }}>
            {ready ? 'YOUR MATRIX' : 'NEED 3 AIRPORTS'}
          </Text>
        </View>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <MapView
            style={{ flex: 1 }}
            initialRegion={region}
            userInterfaceStyle="dark"
            rotateEnabled={false}
            pitchEnabled={false}
            showsPointsOfInterest={false}
            showsCompass={false}
            toolbarEnabled={false}
          >
            {ready && (
              <Polygon
                coordinates={hull.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
                fillColor={Colors.primary + '2E'}   // cyan, låg opacity → man ser kartan bakom
                strokeColor={Colors.primary}
                strokeWidth={2}
              />
            )}
            {hull.map((p) => (
              // Ej klickbara: ingen title/description (callout) och ingen onPress.
              <Marker key={p.icao} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={{ alignItems: 'center' }}>
                  <View style={s.labelChip}><Text style={s.labelText}>{p.icao}</Text></View>
                  <View style={s.dot} />
                  <View style={s.dotSpacer} />
                </View>
              </Marker>
            ))}
          </MapView>

          {/* Inkapslad area + tappbar andel av Earth/kontinent — nere till vänster */}
          <View style={[s.areaBox, { bottom: insets.bottom + 16 }]}>
            <Text style={s.areaLabel}>ENCLOSED AREA</Text>
            <Text style={s.areaValue}>{formatArea(area)}</Text>
            <TouchableOpacity
              onPress={() => setRegionIdx((i) => (i + 1) % REGIONS.length)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}
            >
              <Text style={s.areaSub}>{formatPct(area, REGIONS[regionIdx].area)} of </Text>
              <Text style={[s.areaSub, { color: Colors.primary, fontWeight: '800' }]}>{REGIONS[regionIdx].name}</Text>
              <Ionicons name="swap-horizontal" size={13} color={Colors.primary} style={{ marginLeft: 5 }} />
            </TouchableOpacity>
          </View>

          {/* Stäng */}
          <TouchableOpacity style={[s.closeBtn, { top: insets.top + 10 }]} onPress={() => setOpen(false)} hitSlop={10}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  compactCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  labelChip: {
    height: 16, justifyContent: 'center', backgroundColor: 'rgba(15,22,38,0.9)',
    borderRadius: 5, paddingHorizontal: 5, borderWidth: 0.5, borderColor: Colors.border,
  },
  labelText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontFamily: 'Menlo' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4f7cff', borderWidth: 1.5, borderColor: '#FFFFFF', marginVertical: 3 }, // samma blå som Visited airports
  dotSpacer: { height: 16 },
  areaBox: {
    position: 'absolute', left: 12, backgroundColor: 'rgba(15,22,38,0.92)',
    borderRadius: 15, paddingHorizontal: 18, paddingVertical: 12, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  areaLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: 'Menlo' },
  areaValue: { color: Colors.primary, fontSize: 27, fontWeight: '800', fontFamily: 'Menlo', marginTop: 2 },
  areaSub: { color: Colors.textMuted, fontSize: 13, fontWeight: '600', fontFamily: 'Menlo', marginTop: 2 },
  closeBtn: {
    position: 'absolute', right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
});
