// Global flygplatskarta med level-of-detail-klustring (Apple Maps via
// react-native-maps). Zoomnivån (region.latitudeDelta) avgör vad som visas:
//   utzoomad   → en FLAGG-pin per LAND med antal
//   inzoomad   → enskilda blå PLUPPAR (viewport-filtrerat)
//   mer inzoom → pluppar + ICAO-etikett
//
// 34k flygplatser kan inte renderas samtidigt — därför aggregat + viewport-cap.

import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { Colors } from '../constants/colors';
import { flagEmoji } from '../constants/continents';

export type SeedRow = [string, string, string, string, number, number]; // icao,name,country,region,lat,lon

const INITIAL: Region = { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };
// Markör-tak sätts per nivå nedan: pluppar = lätta native-nålar (tål många),
// ICAO-etiketter = egna vyer (tunga) → bara få på närmsta zoomen.

// initialRegion: ramar in en specifik vy (t.ex. en pilots besökta flygplatser i
// Wrapped). interactive=false låser gesterna (svep i Wrapped-storyn ska bläddra,
// inte panorera kartan).
export function GlobalAirportMap({ airports, initialRegion, interactive = true }: { airports: SeedRow[]; initialRegion?: Region; interactive?: boolean }) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(initialRegion ?? INITIAL);

  // Aggregat per land (centroid + antal) — beräknas en gång.
  const byCountry = useMemo(() => {
    const ctry = new Map<string, { latSum: number; lonSum: number; count: number }>();
    for (const a of airports) {
      const lat = a[4], lon = a[5];
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const cc = (a[2] || '').toUpperCase();
      const c = ctry.get(cc) ?? { latSum: 0, lonSum: 0, count: 0 };
      c.latSum += lat; c.lonSum += lon; c.count++; ctry.set(cc, c);
    }
    return [...ctry.entries()].map(([cc, v]) => ({ cc, lat: v.latSum / v.count, lon: v.lonSum / v.count, count: v.count }));
  }, [airports]);

  const delta = region.latitudeDelta;
  // Klustra länder längre in (delta>3.5) så pluppar bara dyker upp när vyn är
  // liten nog att hålla få markörer → undviker Apple Maps-krasch.
  const level: 'country' | 'dots' | 'labels' =
    delta > 3.5 ? 'country' : delta > 0.8 ? 'dots' : 'labels';

  // Viewport-filtrerade enskilda flygplatser (bara på plupp-nivåerna).
  const dots = useMemo(() => {
    if (level !== 'dots' && level !== 'labels') return [];
    const latMin = region.latitude - region.latitudeDelta / 2 - 0.1;
    const latMax = region.latitude + region.latitudeDelta / 2 + 0.1;
    const lonMin = region.longitude - region.longitudeDelta / 2 - 0.1;
    const lonMax = region.longitude + region.longitudeDelta / 2 + 0.1;
    const out: SeedRow[] = [];
    const cap = level === 'labels' ? 70 : 350; // egna vyer (labels) hålls få; native-nålar tål fler
    for (const a of airports) {
      if (a[4] >= latMin && a[4] <= latMax && a[5] >= lonMin && a[5] <= lonMax) {
        out.push(a);
        if (out.length >= cap) break;
      }
    }
    return out;
  }, [airports, level, region]);

  const zoomTo = (lat: number, lon: number, d: number) =>
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lon, latitudeDelta: d, longitudeDelta: d }, 450);

  return (
    <MapView
      ref={mapRef}
      style={{ flex: 1 }}
      initialRegion={initialRegion ?? INITIAL}
      onRegionChangeComplete={setRegion}
      userInterfaceStyle="dark"
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={false}
      pitchEnabled={false}
      showsPointsOfInterest={false}
      showsCompass={false}
      toolbarEnabled={false}
    >
      {level === 'country' && byCountry.map((c) => (
        <Marker
          key={`ctry-${c.cc}`}
          coordinate={{ latitude: c.lat, longitude: c.lon }}
          onPress={() => zoomTo(c.lat, c.lon, 3.5)}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={s.flagPin}>
            <Text style={s.flagEmoji}>{flagEmoji(c.cc)}</Text>
            <Text style={s.flagCount}>{c.count}</Text>
          </View>
        </Marker>
      ))}

      {/* Pluppar = lätta native-nålar (tål hundratals utan att krascha). Tap → ICAO+namn. */}
      {level === 'dots' && dots.map((a) => (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          pinColor="#3b82f6"
          title={a[0]}
          description={a[1]}
        />
      ))}

      {/* Närmsta zoomen: nål + alltid synlig ICAO-etikett (egna vyer, hålls få via cap). */}
      {level === 'labels' && dots.map((a) => (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          title={a[0]}
          description={a[1]}
        >
          <View style={s.dotLabelWrap}>
            <View style={s.dot} />
            <View style={s.labelChip}><Text style={s.labelText}>{a[0]}</Text></View>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const s = StyleSheet.create({
  flagPin: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 13,
    borderWidth: 1, borderColor: Colors.primary,
    paddingLeft: 4, paddingRight: 8, paddingVertical: 3,
  },
  flagEmoji: { fontSize: 16 },
  flagCount: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  dot: {
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#4f7cff', borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  dotLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  labelChip: {
    backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1.5, borderWidth: 0.5, borderColor: Colors.border,
  },
  labelText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontFamily: 'Menlo' },
});
