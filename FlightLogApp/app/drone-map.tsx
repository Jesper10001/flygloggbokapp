// Drönar-kartan — native Apple-karta med en markör per plats (GPS per flygning).
// Drönarlägets motsvarighet till manned "besökta flygplatser".

import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DR } from '../constants/droneTheme';
import { useDroneAccentStore } from '../store/droneAccentStore';
import { useDroneFlightStore } from '../store/droneFlightStore';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';

type Site = { key: string; lat: number; lon: number; name: string; count: number };

const validCoord = (lat: number, lon: number) =>
  isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0);

function computeRegion(sites: Site[]): Region {
  if (!sites.length) return { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };
  const lats = sites.map((s) => s.lat);
  const lons = sites.map((s) => s.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.06, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.06, (maxLon - minLon) * 1.5),
  };
}

export default function DroneMapScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, loadFlights } = useDroneFlightStore();

  useEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);
  useFocusEffect(useCallback(() => { loadAccent(); loadFlights(); }, [loadAccent, loadFlights]));

  const sites = useMemo<Site[]>(() => {
    const map = new Map<string, Site>();
    for (const f of flights) {
      if (!validCoord(f.lat, f.lon)) continue;
      const name = (f.location || '').trim();
      const key = name.toLowerCase() || `${f.lat.toFixed(3)},${f.lon.toFixed(3)}`;
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { key, lat: f.lat, lon: f.lon, name: name || `${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}`, count: 1 });
    }
    return [...map.values()];
  }, [flights]);

  const taggedFlights = useMemo(() => flights.filter((f) => validCoord(f.lat, f.lon)).length, [flights]);
  const region = useMemo(() => computeRegion(sites), [sites]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={DR.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Where you've flown</Text>
          <Text style={s.sub}>{sites.length} SITES · {taggedFlights} FLIGHTS</Text>
        </View>
      </View>

      {sites.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="location-outline" size={40} color={DR.muted} />
          <Text style={s.emptyText}>No GPS-tagged flights yet</Text>
          <Text style={s.emptyHint}>Use "Here" when logging a flight to drop it on the map.</Text>
        </View>
      ) : (
        <MapView style={{ flex: 1 }} initialRegion={region}>
          {sites.map((st) => (
            <Marker key={st.key} coordinate={{ latitude: st.lat, longitude: st.lon }} title={st.name} description={`${st.count} ${st.count === 1 ? 'flight' : 'flights'}`}>
              <View style={[s.pin, { backgroundColor: accent + '33', borderColor: accent }]}>
                <View style={[s.pinDot, { backgroundColor: accent }]} />
              </View>
            </Marker>
          ))}
        </MapView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator,
  },
  title: { fontFamily: SERIF, fontSize: 18, fontWeight: '500', color: DR.text },
  sub: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1, color: DR.muted, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  emptyText: { color: DR.text, fontSize: 15, fontWeight: '700' },
  emptyHint: { color: DR.text3, fontSize: 12.5, textAlign: 'center' },
  pin: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pinDot: { width: 8, height: 8, borderRadius: 4 },
});
