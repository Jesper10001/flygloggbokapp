// Drönar-fotoalbum — rutnät över drönarflygningar med media (direkt photo_uri eller synkad
// photo_local_id), grupperat per år/månad. Tryck på en ruta → flygningens detaljsida. Drönar-
// motsvarigheten till pilotens flight album (grid-läge; ingen karta).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DR } from '../constants/droneTheme';
import { useDroneAccentStore } from '../store/droneAccentStore';
import { getDroneFlights, type DroneFlight } from '../db/drones';
import { getAssetDisplay } from '../services/photoSync';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GAP = 3;

type Media = { uri: string; isVideo: boolean };

export default function DroneAlbumScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const [flights, setFlights] = useState<DroneFlight[]>([]);
  const [media, setMedia] = useState<Record<number, Media>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);

  useFocusEffect(useCallback(() => {
    loadAccent();
    getDroneFlights(100000).then(async (all) => {
      const withMedia = all.filter((f) => f.photo_uri || f.photo_local_id);
      setFlights(withMedia);
      // Direkt photo_uri först.
      const m: Record<number, Media> = {};
      for (const f of withMedia) if (f.photo_uri) m[f.id] = { uri: f.photo_uri, isVideo: f.media_type === 'video' };
      setMedia({ ...m });
      setLoading(false);
      // Synkade referenser upplöses i bakgrunden.
      for (const f of withMedia) {
        if (!f.photo_uri && f.photo_local_id) {
          const d = await getAssetDisplay(f.photo_local_id);
          if (d) setMedia((prev) => ({ ...prev, [f.id]: { uri: d.uri, isVideo: d.isVideo } }));
        }
      }
    }).catch(() => setLoading(false));
  }, [loadAccent]));

  const groups = useMemo(() => {
    const sorted = [...flights].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const byY = new Map<number, Map<number, DroneFlight[]>>();
    for (const f of sorted) {
      const [y, m] = (f.date || '').split('-').map(Number);
      if (!y || !m) continue;
      if (!byY.has(y)) byY.set(y, new Map());
      const mm = byY.get(y)!;
      if (!mm.has(m)) mm.set(m, []);
      mm.get(m)!.push(f);
    }
    return [...byY.entries()].sort((a, b) => b[0] - a[0]).map(([year, mm]) => ({
      year, months: [...mm.entries()].sort((a, b) => b[0] - a[0]).map(([month, fl]) => ({ month, flights: fl })),
    }));
  }, [flights]);

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={DR.text} />
        </TouchableOpacity>
        <Text style={s.title}>Flight album</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={accent} /></View>
      ) : flights.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="images-outline" size={44} color={DR.muted} />
          <Text style={s.emptyText}>No flight photos yet</Text>
          <Text style={s.emptyHint}>Add a photo on a flight, or sync your library to match photos to flights.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
          {groups.map((yg) => (
            <View key={yg.year}>
              <Text style={s.yearHeader}>{yg.year}</Text>
              {yg.months.map((mg) => (
                <View key={mg.month} style={{ marginBottom: 4 }}>
                  <Text style={s.monthHeader}>{MONTHS[mg.month - 1]}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GAP }}>
                    {mg.flights.map((f) => <Tile key={f.id} media={media[f.id]} onPress={() => router.push(`/drone-flight/${f.id}`)} />)}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Tile({ media, onPress }: { media?: Media; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={s.tile}>
      {media && !media.isVideo ? (
        <Image source={{ uri: media.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <View style={[s.tile, { backgroundColor: DR.elevated, alignItems: 'center', justifyContent: 'center', margin: 0 }]}>
          <Ionicons name={media?.isVideo ? 'videocam' : 'image-outline'} size={20} color={DR.muted} />
        </View>
      )}
      {media?.isVideo && <View style={{ position: 'absolute', top: 4, right: 4 }}><Ionicons name="play-circle" size={18} color="rgba(255,255,255,0.9)" /></View>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DR.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator },
  title: { fontSize: 18, fontWeight: '800', color: DR.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  emptyText: { color: DR.text, fontSize: 15, fontWeight: '700' },
  emptyHint: { color: DR.text3, fontSize: 12.5, textAlign: 'center' },
  yearHeader: { color: DR.text, fontSize: 20, fontWeight: '800', paddingHorizontal: 14, paddingTop: 16, paddingBottom: 4 },
  monthHeader: { color: DR.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 14, paddingVertical: 6 },
  tile: { width: '32.6%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: DR.elevated },
});
