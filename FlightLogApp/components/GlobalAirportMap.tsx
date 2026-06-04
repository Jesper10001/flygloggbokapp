// Global flygplatskarta med level-of-detail-klustring (Apple Maps via
// react-native-maps). Zoomnivån (region.latitudeDelta) avgör vad som visas:
//   utzoomad   → en bubbla per KONTINENT med antal
//   mellan     → en FLAGG-pin per LAND med antal
//   inzoomad   → enskilda blå PLUPPAR (viewport-filtrerat)
//   mer inzoom → pluppar + ICAO-etikett
//
// 34k flygplatser kan inte renderas samtidigt — därför aggregat + viewport-cap.

import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { Colors } from '../constants/colors';
import { continentForCountry, flagEmoji, type Continent } from '../constants/continents';

export type SeedRow = [string, string, string, string, number, number]; // icao,name,country,region,lat,lon

const INITIAL: Region = { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };
const MAX_DOTS = 700; // tak för enskilda pluppar i vyn (prestanda)

export function GlobalAirportMap({ airports }: { airports: SeedRow[] }) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(INITIAL);

  // Aggregat per land + kontinent (centroid + antal) — beräknas en gång.
  const { byCountry, byContinent } = useMemo(() => {
    const ctry = new Map<string, { latSum: number; lonSum: number; count: number }>();
    const cont = new Map<Continent, { latSum: number; lonSum: number; count: number }>();
    for (const a of airports) {
      const lat = a[4], lon = a[5];
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const cc = (a[2] || '').toUpperCase();
      const c = ctry.get(cc) ?? { latSum: 0, lonSum: 0, count: 0 };
      c.latSum += lat; c.lonSum += lon; c.count++; ctry.set(cc, c);
      const ct = continentForCountry(cc);
      if (ct) {
        const k = cont.get(ct) ?? { latSum: 0, lonSum: 0, count: 0 };
        k.latSum += lat; k.lonSum += lon; k.count++; cont.set(ct, k);
      }
    }
    const byCountry = [...ctry.entries()].map(([cc, v]) => ({ cc, lat: v.latSum / v.count, lon: v.lonSum / v.count, count: v.count }));
    const byContinent = [...cont.entries()].map(([name, v]) => ({ name, lat: v.latSum / v.count, lon: v.lonSum / v.count, count: v.count }));
    return { byCountry, byContinent };
  }, [airports]);

  const delta = region.latitudeDelta;
  const level: 'continent' | 'country' | 'dots' | 'labels' =
    delta > 45 ? 'continent' : delta > 5 ? 'country' : delta > 1.2 ? 'dots' : 'labels';

  // Viewport-filtrerade enskilda flygplatser (bara på plupp-nivåerna).
  const dots = useMemo(() => {
    if (level !== 'dots' && level !== 'labels') return [];
    const latMin = region.latitude - region.latitudeDelta / 2 - 0.1;
    const latMax = region.latitude + region.latitudeDelta / 2 + 0.1;
    const lonMin = region.longitude - region.longitudeDelta / 2 - 0.1;
    const lonMax = region.longitude + region.longitudeDelta / 2 + 0.1;
    const out: SeedRow[] = [];
    for (const a of airports) {
      if (a[4] >= latMin && a[4] <= latMax && a[5] >= lonMin && a[5] <= lonMax) {
        out.push(a);
        if (out.length >= MAX_DOTS) break;
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
      initialRegion={INITIAL}
      onRegionChangeComplete={setRegion}
      userInterfaceStyle="dark"
      rotateEnabled={false}
      pitchEnabled={false}
      showsPointsOfInterest={false}
      showsCompass={false}
      toolbarEnabled={false}
    >
      {level === 'continent' && byContinent.map((c) => (
        <Marker
          key={`cont-${c.name}`}
          coordinate={{ latitude: c.lat, longitude: c.lon }}
          onPress={() => zoomTo(c.lat, c.lon, 28)}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={s.contWrap}>
            <View style={s.contBubble}><Text style={s.contCount}>{c.count}</Text></View>
            <Text style={s.contName}>{c.name}</Text>
          </View>
        </Marker>
      ))}

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

      {(level === 'dots' || level === 'labels') && dots.map((a) => (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          title={a[0]}
          description={a[1]}
        >
          {level === 'labels' ? (
            <View style={s.dotLabelWrap}>
              <View style={s.dot} />
              <View style={s.labelChip}><Text style={s.labelText}>{a[0]}</Text></View>
            </View>
          ) : (
            <View style={s.dot} />
          )}
        </Marker>
      ))}
    </MapView>
  );
}

const s = StyleSheet.create({
  contWrap: { alignItems: 'center' },
  contBubble: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: Colors.primary, borderWidth: 2.5, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  contCount: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  contName: {
    color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginTop: 3,
    backgroundColor: 'rgba(15,22,38,0.85)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
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
