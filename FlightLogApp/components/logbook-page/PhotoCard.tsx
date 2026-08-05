// Foto-galerikort: 16:10-förhandsvisning med flygningens bild/video (uppladdad ELLER synkad)
// + rutt/datum/typ/block över gradient. Videor visar frame-thumbnail + play-ikon.
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { placeCode } from '../../utils/format';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { getAssetDisplay } from '../../services/photoSync';
import { FONT_MONO } from './tokens';
import { parseDate } from './flightDisplay';

export function PhotoCard({ flight: f, accent, onPress }: { flight: Flight; accent: string; onPress: () => void }) {
  const { formatTime } = useTimeFormat();
  const [thumb, setThumb] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(f.media_type === 'video');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (f.photo_uri) {
        if (f.media_type === 'video') {
          VideoThumbnails.getThumbnailAsync(f.photo_uri, { time: 0 }).then(({ uri }) => alive && setThumb(uri)).catch(() => {});
        } else { setThumb(f.photo_uri); }
      } else if (f.photo_local_id) {
        const d = await getAssetDisplay(f.photo_local_id);
        if (!alive || !d) return;
        setIsVideo(d.isVideo);
        if (d.isVideo) VideoThumbnails.getThumbnailAsync(d.uri, { time: 0 }).then(({ uri }) => alive && setThumb(uri)).catch(() => alive && setThumb(d.uri));
        else setThumb(d.uri);
      }
    })();
    return () => { alive = false; };
  }, [f.photo_uri, f.photo_local_id, f.media_type]);

  const d = parseDate(f.date);
  const dateLabel = `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}
      style={{ marginHorizontal: 12, marginTop: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card }}>
      <View style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: Colors.elevated }}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[accent + '33', Colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />
        )}
        {isVideo && (
          <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={15} color="#fff" />
          </View>
        )}
        <LinearGradient colors={['transparent', 'rgba(6,11,22,0.82)']} locations={[0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }} />
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: 0.6, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }}>{placeCode(f.dep_place, f.dep_place_raw)} → {placeCode(f.arr_place, f.arr_place_raw)}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: 'rgba(255,255,255,0.82)', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }}>{dateLabel} · {f.aircraft_type}{f.registration ? ` ${f.registration}` : ''}</Text>
          </View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }}>{formatTime(f.total_time)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
