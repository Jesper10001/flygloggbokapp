// Foto-synk-wizard: begär behörighet → synkar (progress) → sammanfattning → guidad
// granskning EN flygning i taget (äldst först). Allt lokalt; endast referensen sparas.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Modal, ActivityIndicator, Dimensions, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlightVideo } from '../components/FlightVideo';
import type * as MediaLibrary from 'expo-media-library';
import { Colors } from '../constants/colors';
import { useFlightStore } from '../store/flightStore';
import { setFlightPhotoLocalId } from '../db/flights';
import { syncPhotos, requestPhotoPermission, getPhotoPermissionStatus, getAssetDisplayUri, type FlightMatch, type PhotoPermission } from '../services/photoSync';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}
function fmtDur(sec: number): string {
  const s = Math.round(sec || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function PhotoSyncScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loadFlights = useFlightStore((s) => s.loadFlights);
  const [phase, setPhase] = useState<'perm' | 'syncing' | 'summary' | 'review' | 'done'>('syncing');
  const [perm, setPerm] = useState<PhotoPermission>('undetermined');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [matches, setMatches] = useState<FlightMatch[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [preview, setPreview] = useState<MediaLibrary.Asset | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const run = useCallback(async () => {
    let p = await getPhotoPermissionStatus();
    if (p === 'undetermined') p = await requestPhotoPermission();
    setPerm(p);
    if (p === 'denied' || p === 'unavailable') { setPhase('perm'); return; }
    setPhase('syncing');
    try {
      const { matches } = await syncPhotos((done, total) => setProgress({ done, total }));
      setMatches(matches);
      setPhase('summary');
    } catch {
      setPhase('perm');
    }
  }, []);
  useEffect(() => { run(); }, [run]);

  const cur = matches[index];
  const W = Dimensions.get('window').width;
  const thumb = Math.floor((W - 32 - 16) / 3); // 3 kolumner, 16px padding + 8px gaps

  // Förladda nästa flights bilder medan användaren granskar aktuell.
  useEffect(() => {
    const next = matches[index + 1];
    if (next) next.assets.slice(0, 9).forEach((a) => { Image.prefetch(a.uri).catch(() => {}); });
  }, [index, matches]);

  const openPreview = async (a: MediaLibrary.Asset) => {
    setPreview(a);
    // Bild: ph:// funkar i <Image> → visa direkt. Video: vänta på spelbar file:// (kopieras).
    setPreviewUri(a.mediaType === 'video' ? null : a.uri);
    const uri = await getAssetDisplayUri(a.id);
    if (uri) setPreviewUri(uri);
  };

  const advance = () => {
    if (index + 1 < matches.length) { setIndex(index + 1); setSelectedId(null); }
    else { loadFlights(); setPhase('done'); }
  };
  const saveNext = async () => {
    if (cur && selectedId) {
      const asset = cur.assets.find((a) => a.id === selectedId);
      await setFlightPhotoLocalId(cur.flight.id, selectedId, asset?.mediaType === 'video' ? 'video' : 'image');
      setSavedCount((c) => c + 1);
    }
    advance();
  };

  // ── Behörighet nekad / native-modul saknas ──
  if (phase === 'perm') {
    const unavailable = perm === 'unavailable';
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: insets.top + 40, gap: 16 }}>
        <Ionicons name={unavailable ? 'cloud-download-outline' : 'images-outline'} size={44} color={Colors.textMuted} />
        <Text style={{ color: Colors.textPrimary, fontSize: 20, fontWeight: '800' }}>{unavailable ? 'Update required' : 'Photo access needed'}</Text>
        <Text style={{ color: Colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          {unavailable
            ? 'Photo sync needs the latest app version. Update the app, then try again.'
            : 'To match photos and videos to your flights, allow photo library access. Everything stays on your device — nothing is uploaded.'}
        </Text>
        {!unavailable && (
          <TouchableOpacity onPress={() => Linking.openSettings()} style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>Open Settings</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '600' }}>{unavailable ? 'Close' : 'Cancel'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Synkar (progress) ──
  if (phase === 'syncing') {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 18 }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '700' }}>Matching photos to flights…</Text>
        <View style={{ width: '80%', height: 6, borderRadius: 3, backgroundColor: Colors.elevated, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: Colors.primary }} />
        </View>
        <Text style={{ color: Colors.textMuted, fontSize: 12, fontFamily: 'Menlo' }}>{progress.done} / {progress.total} flights</Text>
        {perm === 'limited' && <Text style={{ color: Colors.warning, fontSize: 11.5, textAlign: 'center' }}>Limited access — only your selected photos are searched.</Text>}
      </View>
    );
  }

  // ── Sammanfattning ──
  if (phase === 'summary') {
    const n = matches.length;
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Ionicons name={n ? 'checkmark-circle' : 'images-outline'} size={52} color={n ? Colors.success : Colors.textMuted} />
        <Text style={{ color: Colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>
          {n ? `${n} flight${n === 1 ? '' : 's'} got photo suggestions` : 'No new photo suggestions'}
        </Text>
        {n > 0 ? (
          <TouchableOpacity onPress={() => { setIndex(0); setSelectedId(null); setPhase('review'); }} style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}>
            <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>Review now</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 12 }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '600' }}>{n ? 'Later' : 'Done'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Klar ──
  if (phase === 'done') {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Ionicons name="checkmark-circle" size={52} color={Colors.success} />
        <Text style={{ color: Colors.textPrimary, fontSize: 20, fontWeight: '800' }}>{savedCount} photo{savedCount === 1 ? '' : 's'} linked</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}>
          <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Granskning (wizard, en flight i taget) ──
  const f = cur.flight;
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top + 8 }}>
      {/* Header: progress + stäng */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 12 }}>
        <Text style={{ flex: 1, color: Colors.textMuted, fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' }}>Flight {index + 1} of {matches.length}</Text>
        <TouchableOpacity onPress={() => { loadFlights(); router.back(); }} hitSlop={10}><Ionicons name="close" size={24} color={Colors.textSecondary} /></TouchableOpacity>
      </View>

      {/* Flightinfo */}
      <View style={{ marginHorizontal: 16, marginBottom: 10, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800', fontFamily: 'Menlo' }}>{f.dep_place || '?'} → {f.arr_place || '?'}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: Colors.textMuted, fontSize: 12, fontFamily: 'Menlo' }}>{f.dep_utc}–{f.arr_utc}z</Text>
        </View>
        <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 3 }}>{fmtDate(f.date)}{f.registration ? ` · ${f.registration}` : ''}</Text>
      </View>

      {/* Galleri */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {cur.assets.map((a) => {
            const sel = selectedId === a.id;
            const isVideo = a.mediaType === 'video';
            return (
              <TouchableOpacity key={a.id} activeOpacity={0.85} onPress={() => openPreview(a)}
                style={{ width: thumb, height: thumb, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: sel ? Colors.primary : 'transparent', backgroundColor: Colors.elevated }}>
                <Image source={{ uri: a.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                {isVideo && (
                  <View style={{ position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                    <Ionicons name="videocam" size={10} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', fontFamily: 'Menlo' }}>{fmtDur(a.duration)}</Text>
                  </View>
                )}
                {sel && (
                  <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: Colors.primary, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="checkmark" size={13} color={Colors.textInverse} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Knappar */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.separator }}>
        <TouchableOpacity onPress={advance} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '700' }}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={saveNext} disabled={!selectedId} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: selectedId ? Colors.primary : Colors.elevated, opacity: selectedId ? 1 : 0.6 }}>
          <Text style={{ color: selectedId ? Colors.textInverse : Colors.textMuted, fontSize: 15, fontWeight: '700' }}>Save & next</Text>
        </TouchableOpacity>
      </View>

      {/* Fullskärmsförhandsvisning */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' }}>
          {preview && !previewUri && <ActivityIndicator size="large" color="#fff" />}
          {preview && previewUri && (preview.mediaType === 'video' ? (
            <FlightVideo uri={previewUri} style={{ width: '100%', height: '70%' }} contentFit="contain" nativeControls autoPlay />
          ) : (
            <Image source={{ uri: previewUri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
          ))}
          <View style={{ position: 'absolute', top: insets.top + 8, right: 14 }}>
            <TouchableOpacity onPress={() => setPreview(null)} hitSlop={10} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={{ position: 'absolute', bottom: insets.bottom + 24, left: 24, right: 24 }}>
            <TouchableOpacity
              onPress={() => { if (preview) setSelectedId(preview.id); setPreview(null); }}
              style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
              <Text style={{ color: Colors.textInverse, fontSize: 16, fontWeight: '700' }}>Use this {preview?.mediaType === 'video' ? 'video' : 'photo'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
