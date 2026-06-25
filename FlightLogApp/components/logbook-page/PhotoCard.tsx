// Foto-galerikort: 16:10-förhandsvisning med flygningens egen bild + rutt/datum/typ/block över gradient.
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { FONT_MONO } from './tokens';
import { parseDate } from './flightDisplay';

export function PhotoCard({ flight: f, accent, onPress }: { flight: Flight; accent: string; onPress: () => void }) {
  const { formatTime } = useTimeFormat();
  const hasPhoto = !!f.photo_uri && f.media_type !== 'video';
  const d = parseDate(f.date);
  const dateLabel = `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}
      style={{ marginHorizontal: 12, marginTop: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card }}>
      <View style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: Colors.elevated }}>
        {hasPhoto ? (
          <Image source={{ uri: f.photo_uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[accent + '33', Colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />
        )}
        <LinearGradient colors={['transparent', 'rgba(6,11,22,0.82)']} locations={[0.45, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }} />
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: 0.6, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }}>{f.dep_place} → {f.arr_place}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: 'rgba(255,255,255,0.82)', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }}>{dateLabel} · {f.aircraft_type}{f.registration ? ` ${f.registration}` : ''}</Text>
          </View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }}>{formatTime(f.total_time)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
