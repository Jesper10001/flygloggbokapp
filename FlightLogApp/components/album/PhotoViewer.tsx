// En bild i taget ur flygalbumet: bläddra, dela med flygdata, gör till omslag, ta bort ur albumet.
import { useEffect, useState } from 'react';
import { View, Text, Image, Modal, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FlightVideo } from '../FlightVideo';
import { getAssetDisplay, type AlbumPhoto } from '../../services/photoSync';
import { phaseText, routeText } from './FlightAlbumView';
import type { Flight } from '../../types/flight';

const DANGER = '#FF8A8A';

export function PhotoViewer({ list, index, flight, coverKey, onIndex, onClose, onShare, onSetCover, onRemove }: {
  list: AlbumPhoto[]; index: number | null; flight: Flight | null; coverKey: string | null;
  onIndex: (i: number) => void; onClose: () => void;
  onShare: (p: AlbumPhoto, uri: string) => void; onSetCover: (p: AlbumPhoto) => void; onRemove: (p: AlbumPhoto) => void;
}) {
  const insets = useSafeAreaInsets();
  const p = index != null ? list[index] : null;
  const [media, setMedia] = useState<{ uri: string; isVideo: boolean } | null>(null);
  useEffect(() => {
    setMedia(null);
    if (!p) return;
    if (p.uri) { setMedia({ uri: p.uri, isVideo: p.isVideo }); return; }
    let alive = true;
    if (p.localId) getAssetDisplay(p.localId).then((d) => { if (alive && d) setMedia({ uri: d.uri, isVideo: d.isVideo }); }).catch(() => {});
    return () => { alive = false; };
  }, [p?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCover = !!p && p.key === coverKey;
  return (
    <Modal visible={!!p} animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#02060D' }}>
        <View style={[s.top, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={s.round} onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={20} color="#fff" /></TouchableOpacity>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#CFE0EE', fontVariant: ['tabular-nums'] }}>{p && index != null ? `${index + 1} of ${list.length}` : ''}</Text>
          <TouchableOpacity style={s.round} disabled={!media} onPress={() => { if (p && media) onShare(p, media.uri); }} accessibilityLabel="Share with flight insights">
            <Ionicons name="share-outline" size={19} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginVertical: 12 }}>
          {!media ? <ActivityIndicator color="#fff" />
            : media.isVideo ? <FlightVideo key={media.uri} uri={media.uri} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls autoPlay />
            : <Image source={{ uri: media.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
          {index != null && index > 0 && (
            <TouchableOpacity style={[s.nav, { left: 10 }]} onPress={() => onIndex(index - 1)} accessibilityLabel="Previous photo">
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          {index != null && index < list.length - 1 && (
            <TouchableOpacity style={[s.nav, { right: 10 }]} onPress={() => onIndex(index + 1)} accessibilityLabel="Next photo">
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 16, gap: 14 }}>
          {p && flight && (
            <View style={{ alignItems: 'center', gap: 3 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{phaseText(p)}</Text>
              <Text style={{ fontSize: 13, color: Colors.textSecondary }}>{routeText(flight)} · {flight.date}</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {!!p?.localId && (
              <TouchableOpacity style={s.btn} disabled={isCover} onPress={() => p && onSetCover(p)}>
                <Ionicons name={isCover ? 'star' : 'star-outline'} size={16} color={Colors.gold} />
                <Text style={{ fontSize: 15, fontWeight: '600', color: isCover ? Colors.gold : '#fff' }}>{isCover ? 'Cover photo' : 'Set as cover'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.btn, s.danger]} onPress={() => p && onRemove(p)}>
              <Ionicons name="trash-outline" size={16} color={DANGER} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: DANGER }}>Remove from album</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  nav: { position: 'absolute', top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(4,10,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  btn: { flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  danger: { borderColor: 'rgba(255,107,107,0.5)', backgroundColor: 'rgba(255,107,107,0.14)' },
});
