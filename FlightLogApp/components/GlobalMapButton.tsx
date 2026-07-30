// Kompakt dashboard-knapp: liten (utzoomad) Apple-kartbild över kontinenten man landat mest på,
// med små flagg-symboler + TOTALA antalet flygplatser per land (alla som finns, ej bara besökta).
// Öppnar globala kartan.
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { flagEmoji } from '../constants/continents';
import { getAirportLandingCounts } from '../db/flights';
import { getSeedAirports } from '../db/icao';
import { topContinentThumb, type ThumbRegion } from '../utils/thumbRegion';
import { GlobalMapModal } from './GlobalMapModal';

type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?, string?];
// Hela globen (utzoomat) → satelliteFlyover renderar 3D-jordklotet.
const WORLD: ThumbRegion = { latitude: 20, longitude: 10, latitudeDelta: 150, longitudeDelta: 150 };

// asButton: liten pill-knapp (öppnar samma modal) — används i globens övre högra hörn på dashboarden.
export function GlobalMapButton({ asButton = false }: { asButton?: boolean } = {}) {
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

      // En flagga per LAND med TOTALA antalet (icke-closed) flygplatser — ALLA länder på globen.
      const byCountry = new Map<string, { lat: number; lon: number; n: number }>();
      for (const r of seed) {
        if (r[8] === 'closed' || !isFinite(r[4]) || !isFinite(r[5]) || (r[4] === 0 && r[5] === 0)) continue;
        const e = byCountry.get(r[2]) ?? { lat: 0, lon: 0, n: 0 };
        e.lat += r[4]; e.lon += r[5]; e.n++; byCountry.set(r[2], e);
      }
      const fl = [...byCountry.entries()]
        .map(([cc, e]) => ({ cc, lat: e.lat / e.n, lon: e.lon / e.n, count: e.n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 250);

      if (contRows.length) {
        // Rotera globen så din mest besökta kontinent är mitt i bild — men behåll full utzoomning
        // (hela jordklotet syns).
        setRegion({ latitude: vReg.latitude, longitude: vReg.longitude, latitudeDelta: 150, longitudeDelta: 150 });
      }
      setFlags(fl);
    })();
  }, []);

  // Liten pill-knapp (globens övre högra hörn på dashboarden) — öppnar samma modal.
  if (asButton) {
    return (
      <>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          activeOpacity={0.85}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(6,11,22,0.72)', borderWidth: 1, borderColor: Colors.primary + '66' }}
        >
          <Ionicons name="globe" size={14} color={Colors.primary} />
          <Text style={{ color: Colors.primary, fontSize: 12, fontWeight: '700' }}>Global map</Text>
        </TouchableOpacity>
        <GlobalMapModal visible={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <View style={styles.card}>
        <MapView
          style={StyleSheet.absoluteFill}
          camera={{ center: { latitude: region.latitude, longitude: region.longitude }, pitch: 0, heading: 0, zoom: 0, altitude: 55_000_000 }}
          mapType="satelliteFlyover"
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
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(15,22,38,0.85)',
  },
  labelTxt: { color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  flagPin: {
    flexDirection: 'row', alignItems: 'center', gap: 1,
    backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 3,
    borderWidth: 0.4, borderColor: Colors.primary, paddingHorizontal: 1.5, paddingVertical: 0.5,
  },
  flagEmoji: { fontSize: 4 },
  flagCount: { color: '#fff', fontSize: 3.5, fontWeight: '800' },
});
