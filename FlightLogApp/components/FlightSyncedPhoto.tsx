// Visar en flygnings synkade bild/video (photo_local_id) och låter piloten byta/välja
// från samma galleri-vy (fönstersökning för just denna flygning). Endast referensen sparas.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, Modal, ScrollView, ActivityIndicator, Dimensions, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlightVideo } from './FlightVideo';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type * as MediaLibrary from 'expo-media-library';
import { Colors } from '../constants/colors';
import { setFlightPhotoLocalId } from '../db/flights';
import { getAssetDisplay, getFlightPhotoCandidates, getPhotoPermissionStatus, requestPhotoPermission, isPhotoSyncAvailable } from '../services/photoSync';
import type { Flight } from '../types/flight';

const fmtDur = (s: number) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, '0')}`;

export function FlightSyncedPhoto({ flight, accent = Colors.primary, onChanged }: { flight: Flight; accent?: string; onChanged?: () => void }) {
  const [uri, setUri] = useState<string | null | undefined>(undefined); // undefined=laddar, null=ingen/raderad
  const [isVideo, setIsVideo] = useState(false);
  const [videoThumb, setVideoThumb] = useState<string | null>(null); // frame-thumbnail för video
  const [full, setFull] = useState(false);
  const [picking, setPicking] = useState(false);
  const [cands, setCands] = useState<MediaLibrary.Asset[] | null>(null);

  const resolve = useCallback(async () => {
    if (!flight.photo_local_id) { setUri(null); return; }
    const d = await getAssetDisplay(flight.photo_local_id);
    if (!d) { setUri(null); return; }
    setUri(d.uri); setIsVideo(d.isVideo); setVideoThumb(null);
    if (d.isVideo) VideoThumbnails.getThumbnailAsync(d.uri, { time: 0 }).then(({ uri }) => setVideoThumb(uri)).catch(() => {});
  }, [flight.photo_local_id]);
  useEffect(() => { resolve(); }, [resolve]);

  const openPicker = async () => {
    let perm = await getPhotoPermissionStatus();
    if (perm === 'undetermined') perm = await requestPhotoPermission();
    if (perm === 'denied') { Linking.openSettings(); return; }
    setPicking(true); setCands(null);
    setCands(await getFlightPhotoCandidates(flight));
  };
  const choose = async (a: MediaLibrary.Asset) => {
    await setFlightPhotoLocalId(flight.id, a.id, a.mediaType === 'video' ? 'video' : 'image');
    setPicking(false);
    onChanged?.();
    resolve();
  };
  const clear = async () => { await setFlightPhotoLocalId(flight.id, null); onChanged?.(); setUri(null); };

  // Native-modulen saknas i denna build → dölj hela funktionen (kraschar inte).
  if (!isPhotoSyncAvailable()) return null;

  const hasLink = !!flight.photo_local_id;
  const deleted = hasLink && uri === null;
  const W = Dimensions.get('window').width;
  const thumb = Math.floor((W - 32 - 16) / 3);

  const pickerModal = (
    <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
      <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: 54 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 12 }}>
          <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 16, fontWeight: '800' }}>Choose a photo</Text>
          <TouchableOpacity onPress={() => setPicking(false)} hitSlop={10}><Ionicons name="close" size={24} color={Colors.textSecondary} /></TouchableOpacity>
        </View>
        {cands === null ? (
          <View style={{ paddingVertical: 40 }}><ActivityIndicator color={Colors.primary} /></View>
        ) : cands.length === 0 ? (
          <Text style={{ color: Colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30 }}>No photos found around this flight's time.</Text>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {cands.map((a) => (
                <TouchableOpacity key={a.id} activeOpacity={0.85} onPress={() => choose(a)}
                  style={{ width: thumb, height: thumb, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.elevated }}>
                  <Image source={{ uri: a.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  {a.mediaType === 'video' && (
                    <View style={{ position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Ionicons name="videocam" size={10} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', fontFamily: 'Menlo' }}>{fmtDur(a.duration)}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );

  // Ingen koppling → liten "hitta foton"-knapp.
  if (!hasLink) {
    return (
      <>
        <TouchableOpacity onPress={openPicker} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 13, borderWidth: 1, borderColor: accent + '55', backgroundColor: accent + '12', marginBottom: 12 }}>
          <Ionicons name="images-outline" size={16} color={accent} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: accent }}>Find photos for this flight</Text>
        </TouchableOpacity>
        {pickerModal}
      </>
    );
  }

  return (
    <>
      {deleted ? (
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated, padding: 20, alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ionicons name="image-outline" size={28} color={Colors.textMuted} />
          <Text style={{ color: Colors.textMuted, fontSize: 13, textAlign: 'center' }}>This photo is no longer available</Text>
          <TouchableOpacity onPress={openPicker}><Text style={{ color: accent, fontSize: 13, fontWeight: '700' }}>Choose another</Text></TouchableOpacity>
        </View>
      ) : uri === undefined ? (
        <View style={{ height: 220, borderRadius: 14, backgroundColor: Colors.elevated, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <View style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => setFull(true)}>
            {isVideo
              ? (videoThumb
                  ? <Image source={{ uri: videoThumb }} style={{ width: '100%', height: 220 }} resizeMode="cover" />
                  : <View style={{ width: '100%', height: 220, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="videocam" size={26} color="rgba(255,255,255,0.5)" /></View>)
              : <Image source={{ uri: uri! }} style={{ width: '100%', height: 220 }} resizeMode="cover" />}
            {isVideo && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="play" size={26} color="#fff" />
                </View>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {!deleted && (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <TouchableOpacity onPress={openPicker} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: Colors.border }}>
            <Ionicons name="swap-horizontal" size={15} color={Colors.textSecondary} />
            <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '700' }}>Change photo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clear} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: Colors.border }}>
            <Ionicons name="close" size={15} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Fullskärm */}
      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' }}>
          {uri && (isVideo
            ? <FlightVideo uri={uri} style={{ width: '100%', height: '75%' }} contentFit="contain" nativeControls autoPlay />
            : <Image source={{ uri }} style={{ width: '100%', height: '85%' }} resizeMode="contain" />)}
          <TouchableOpacity onPress={() => setFull(false)} hitSlop={10} style={{ position: 'absolute', top: 50, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>

      {pickerModal}
    </>
  );
}
