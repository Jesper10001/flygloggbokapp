// Liten rund kartbild på vädersidan: mörk standardkarta (kartläge, inte satellit) över flygplatsen, banorna ur
// runway-geo.json (samma data som Global map) ritade tjockt utan mått och bannummer, och vindpilen ovanpå.
// Inramningen räknas så att alla banor precis får plats i cirkeln. Kartan går inte att röra (pointerEvents none).
// Saknas bangeometri visas bara en kompass med vindpilen.
import { useMemo } from 'react';
import { View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import Svg, { Circle, G, Path } from 'react-native-svg';
import type { RunwayGeo } from '../../constants/runwayGeo';
import { Colors } from '../../constants/colors';

const FAV = '#67E8F9';   // banor vinden gynnar (samma cyan som kart-snippeten)
const RWY = '#DCE6F0';

export function WxRunwayMap({ runways, favored, windDir, size = 150 }: {
  runways: RunwayGeo[]; favored: number[]; windDir: number | null; size?: number;
}) {
  const region = useMemo(() => {
    if (!runways.length) return null;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const r of runways) for (const p of [r.le, r.he]) {
      minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat); minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon);
    }
    const lat = (minLa + maxLa) / 2, lon = (minLo + maxLo) / 2;
    const k = Math.cos((lat * Math.PI) / 180);
    // Största avståndet från mitten till en banände (meter) → cirkelns radie med lite luft.
    let rad = 300;
    for (const r of runways) for (const p of [r.le, r.he]) {
      rad = Math.max(rad, Math.hypot((p.lon - lon) * k * 111320, (p.lat - lat) * 111320));
    }
    const latDelta = (2 * rad * 1.12) / 111320;
    return { latitude: lat, longitude: lon, latitudeDelta: latDelta, longitudeDelta: latDelta / k };
  }, [runways]);

  const half = size / 2;
  return (
    <View pointerEvents="none" style={{ width: size, height: size, borderRadius: half, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: '#15263D' }}>
      {region ? (
        <MapView
          style={{ width: size, height: size }}
          initialRegion={region}
          region={region}
          mapType="mutedStandard"
          userInterfaceStyle="dark"
          scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
          showsPointsOfInterests={false}
          showsBuildings={false}
          showsCompass={false}
          showsScale={false}
          toolbarEnabled={false}
        >
          {runways.map((r, i) => (
            <Polyline key={i}
              coordinates={[{ latitude: r.le.lat, longitude: r.le.lon }, { latitude: r.he.lat, longitude: r.he.lon }]}
              strokeColor={favored.includes(i) ? FAV : RWY} strokeWidth={5.5} lineCap="butt" />
          ))}
        </MapView>
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 300 300" style={{ position: 'absolute', left: 0, top: 0 }}>
        <Circle cx={150} cy={150} r={146} fill="none" stroke="#0A1628" strokeOpacity={0.55} strokeWidth={10} />
        {!region ? <Circle cx={150} cy={150} r={88} fill="none" stroke={Colors.separator} strokeWidth={2} /> : null}
        <Path d="M150 6 v14" stroke={Colors.textSecondary} strokeWidth={3} strokeLinecap="round" />
        {windDir != null ? (
          <G rotation={windDir} origin="150, 150">
            <Path d="M150 16 L150 92" stroke="#0A1628" strokeWidth={13} strokeLinecap="round" />
            <Path d="M136 78 L150 100 L164 78" fill="none" stroke="#0A1628" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M150 16 L150 92" stroke={Colors.primary} strokeWidth={7} strokeLinecap="round" />
            <Path d="M136 78 L150 100 L164 78" fill="none" stroke={Colors.primary} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
