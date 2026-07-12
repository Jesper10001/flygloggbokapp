import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image,
  TouchableOpacity, Dimensions, ActivityIndicator,
  Modal, Pressable,
} from 'react-native';
import { FlightVideo } from '../../components/FlightVideo';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFlightsWithPhotos } from '../../db/flights';
import { batchPlaceNames } from '../../db/icao';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { formatDate } from '../../utils/format';
import type { Flight } from '../../types/flight';

const { width, height } = Dimensions.get('window');
const GAP = 3;
const COLS = 3;
const TILE = (width - GAP * (COLS + 1)) / COLS;

export default function AlbumScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { formatTime } = useTimeFormat();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Flight | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  useEffect(() => {
    getFlightsWithPhotos().then(f => {
      setFlights(f);
      const icaos = f.flatMap(fl => [fl.dep_place, fl.arr_place].filter(Boolean));
      if (icaos.length) batchPlaceNames(icaos).then(setPlaceNames);

      // Generate thumbnails for videos
      const videos = f.filter(fl => fl.media_type === 'video' && fl.photo_uri);
      for (const fl of videos) {
        VideoThumbnails.getThumbnailAsync(fl.photo_uri, { time: 0 })
          .then(({ uri }) => setThumbnails(prev => ({ ...prev, [fl.id]: uri })))
          .catch(() => {});
      }

      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (flights.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="images-outline" size={48} color={Colors.textMuted} />
        <Text style={styles.emptyText}>{t('no_photos')}</Text>
      </View>
    );
  }

  const dep = selected ? (placeNames[selected.dep_place?.toUpperCase()] ?? selected.dep_place) : '';
  const arr = selected ? (placeNames[selected.arr_place?.toUpperCase()] ?? selected.arr_place) : '';

  return (
    <View style={styles.container}>
      <FlatList
        data={flights}
        keyExtractor={f => String(f.id)}
        numColumns={COLS}
        contentContainerStyle={{ padding: GAP }}
        renderItem={({ item }) => {
          const d = placeNames[item.dep_place?.toUpperCase()] ?? item.dep_place;
          const a = placeNames[item.arr_place?.toUpperCase()] ?? item.arr_place;
          const thumbUri = item.media_type === 'video'
            ? (thumbnails[item.id] ?? item.photo_uri)
            : item.photo_uri;
          return (
            <TouchableOpacity
              style={styles.tile}
              onPress={() => setSelected(item)}
              activeOpacity={0.85}
            >
              <Image source={{ uri: thumbUri }} style={styles.image} />
              {item.media_type === 'video' && (
                <View style={styles.videoIndicator}>
                  <Ionicons name="play-circle" size={24} color="rgba(255,255,255,0.9)" />
                </View>
              )}
              <View style={styles.overlay}>
                <Text style={styles.route} numberOfLines={1}>{d} → {a}</Text>
                <Text style={styles.date}>{formatDate(item.date)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {selected && (
            selected.media_type === 'video' ? (
              <FlightVideo uri={selected.photo_uri} style={{ width, height }} contentFit="contain" loop autoPlay nativeControls />
            ) : (
              <Image
                source={{ uri: selected.photo_uri }}
                style={{ width, height }}
                resizeMode="contain"
              />
            )
          )}

          {/* Top bar */}
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12,
            backgroundColor: 'rgba(0,0,0,0.5)',
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <TouchableOpacity onPress={() => setSelected(null)} hitSlop={12}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{dep} → {arr}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                {selected ? formatDate(selected.date) : ''} · {selected ? `${formatTime(selected.total_time)}h` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => { setSelected(null); router.push(`/flight/detail/${selected?.id}`); }}
              hitSlop={12}
            >
              <Ionicons name="open-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, gap: 12 },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
  tile: {
    width: TILE, height: TILE,
    margin: GAP / 2,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: Colors.elevated,
  },
  image: { width: '100%', height: '100%' },
  videoIndicator: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 4, paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  route: { color: '#fff', fontSize: 9, fontWeight: '700' },
  date: { color: 'rgba(255,255,255,0.7)', fontSize: 8 },
});
