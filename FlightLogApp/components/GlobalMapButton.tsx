// Kompakt dashboard-knapp: liten (utzoomad) Apple-kartbild över kontinenten man landat mest på,
// med små flagg-symboler + TOTALA antalet flygplatser per land (alla som finns, ej bara besökta).
// Öppnar globala kartan.
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Colors } from '../constants/colors';
import { flagEmoji, continentForCountry } from '../constants/continents';
import { getAirportLandingCounts } from '../db/flights';
import { getSeedAirports } from '../db/icao';
import { topContinentThumb, type ThumbRegion } from '../utils/thumbRegion';
import { GlobalMapModal } from './GlobalMapModal';

type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?];
const WORLD: ThumbRegion = { latitude: 25, longitude: 5, latitudeDelta: 130, longitudeDelta: 130 };

export function GlobalMapButton() {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<ThumbRegion>(WORLD);
  const [flags, setFlags] = useState<{ cc: string; lat: number; lon: number; count: number }[]>([]);

  useEffect(() => {
    (async () => {
      const seed = (await getSeedAirports()) as SeedRow[];
      if (!seed.length) return;

      // Kontinent + region utifrån DINA besökta flygplatser (så vyn hamnar där du varit, t.ex.
      // Västeuropa — inte skevt österut mot Ryssland som annars ligger i Europa-listan).
      const counts = await getAirportLandingCounts();
      const byIcao = new Map(seed.map((r) => [r[0], r] as const));
      const visitedRows = Object.keys(counts).map((ic) => byIcao.get(ic)).filter(Boolean) as SeedRow[];
      const { region: vReg, rows: contRows } = topContinentThumb(visitedRows);
      const topCont = contRows.length ? continentForCountry(contRows[0][2]) : null;

      // TOTALA antalet flygplatser per land (alla i seed) i den kontinenten.
      const byCountry = new Map<string, { lat: number; lon: number; n: number }>();
      for (const r of seed) {
        if (!isFinite(r[4]) || !isFinite(r[5]) || (r[4] === 0 && r[5] === 0)) continue;
        if (topCont && (continentForCountry(r[2]) ?? '??') !== topCont) continue;
        const e = byCountry.get(r[2]) ?? { lat: 0, lon: 0, n: 0 };
        e.lat += r[4]; e.lon += r[5]; e.n++; byCountry.set(r[2], e);
      }
      const fl = [...byCountry.entries()]
        .map(([cc, e]) => ({ cc, lat: e.lat / e.n, lon: e.lon / e.n, count: e.n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 16);

      if (contRows.length) {
        // Centrera på besökta platser, lite mer utzoomat.
        setRegion({
          latitude: vReg.latitude, longitude: vReg.longitude,
          latitudeDelta: Math.min(110, vReg.latitudeDelta * 1.4),
          longitudeDelta: Math.min(150, vReg.longitudeDelta * 1.4),
        });
      }
      setFlags(fl);
    })();
  }, []);

  return (
    <>
      <View style={styles.card}>
        <MapView
          style={StyleSheet.absoluteFill}
          region={region}
          pointerEvents="none"
          scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
          userInterfaceStyle="dark"
          showsPointsOfInterest={false} showsCompass={false} toolbarEnabled={false}
        >
          {flags.map((f) => (
            <Marker key={f.cc} coordinate={{ latitude: f.lat, longitude: f.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.flagPin}>
                <Text style={styles.flagEmoji}>{flagEmoji(f.cc)}</Text>
                <Text style={styles.flagCount}>{f.count}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
        <View style={styles.label}><Text style={styles.labelTxt}>Global map</Text></View>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setOpen(true)} activeOpacity={0.85} />
      </View>
      <GlobalMapModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1, height: 168, backgroundColor: Colors.card,
    borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.cardBorder,
  },
  label: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(15,22,38,0.72)',
  },
  labelTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  flagPin: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 5,
    borderWidth: 0.5, borderColor: Colors.primary, paddingHorizontal: 3, paddingVertical: 1,
  },
  flagEmoji: { fontSize: 8 },
  flagCount: { color: '#fff', fontSize: 6.5, fontWeight: '800' },
});
