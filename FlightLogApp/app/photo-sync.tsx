// Foto-synk-wizard: begär behörighet → synkar (progress) → sammanfattning → guidad
// granskning EN flygning i taget (äldst först). Allt lokalt; endast referensen sparas.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Modal, ActivityIndicator, Dimensions, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FlightVideo } from '../components/FlightVideo';
import type * as MediaLibrary from 'expo-media-library/legacy';
import { Colors } from '../constants/colors';
import { useFlightStore } from '../store/flightStore';
import { useDroneFlightStore } from '../store/droneFlightStore';
import { setFlightPhotoLocalId } from '../db/flights';
import { setDroneFlightPhotoLocalId } from '../db/drones';
import * as pilotSync from '../services/photoSync';
import * as droneSync from '../services/dronePhotoSync';
import type { PhotoPermission } from '../services/photoSync';
// Flygningen kan vara pilot- ELLER drönar-typ beroende på ?mode → lös typ som any för visning.
type FlightMatch = { flight: any; assets: MediaLibrary.Asset[] };

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
  const { resume, mode } = useLocalSearchParams<{ resume?: string; mode?: string }>();
  const isDrone = mode === 'drone';
  const S = isDrone ? droneSync : pilotSync; // läges-medveten synk-tjänst (samma funktionsnamn)
  const insets = useSafeAreaInsets();
  const loadPilotFlights = useFlightStore((s) => s.loadFlights);
  const loadDroneFlights = useDroneFlightStore((s) => s.loadFlights);
  const loadFlights = isDrone ? loadDroneFlights : loadPilotFlights;
  const linkPhoto = isDrone ? setDroneFlightPhotoLocalId : setFlightPhotoLocalId;
  const [phase, setPhase] = useState<'perm' | 'syncing' | 'resuming' | 'summary' | 'review' | 'done'>(resume === '1' ? 'resuming' : 'syncing');
  const [perm, setPerm] = useState<PhotoPermission>('undetermined');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [matches, setMatches] = useState<FlightMatch[]>([]);
  const [index, setIndex] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  // Historik för Undo: senaste åtgärderna (koppling/skip) i tur och ordning.
  const [history, setHistory] = useState<{ index: number; flightId: number; kind: 'link' | 'skip' }[]>([]);
  const [preview, setPreview] = useState<MediaLibrary.Asset | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // Upplösta (file://) thumbnail-uri:er för AKTUELL flights bilder → renderas i dev-bygget (ph:// blir svart).
  const [resolvedUris, setResolvedUris] = useState<Record<string, string>>({});

  const run = useCallback(async () => {
    // Återuppta: bygg om kvarvarande matchningar ur sparad session — INGEN ny scanning.
    if (resume === '1') {
      try {
        const m = await S.resumeMatches();
        if (m.length) { setMatches(m); setIndex(0); setHistory([]); setPhase('review'); return; }
      } catch { /* faller igenom till vanlig synk */ }
      await S.clearReviewSession(); // inget kvar (eller media otillgängligt) → kör vanlig synk nedan
    }
    let p = await S.getPhotoPermissionStatus();
    if (p === 'undetermined') p = await S.requestPhotoPermission();
    setPerm(p);
    // Kör synken BARA med faktisk åtkomst (full/limited). Nekad/avbruten/otillgänglig → ingen synk
    // (så last_sync ej sätts → Sync-knappen förblir tryckbar) och ingen felaktig "klar"-vy.
    if (p !== 'full' && p !== 'limited') { setPhase('perm'); return; }
    setPhase('syncing');
    try {
      const { matches } = await S.syncPhotos((done, total) => setProgress({ done, total }));
      setMatches(matches);
      setPhase('summary');
    } catch {
      setPhase('perm');
    }
  }, [resume]);
  useEffect(() => { run(); }, [run]);

  const cur = matches[index];
  const W = Dimensions.get('window').width;
  const thumb = Math.floor((W - 32 - 16) / 3); // 3 kolumner, 16px padding + 8px gaps

  // Förladda nästa flights bilder medan användaren granskar aktuell.
  useEffect(() => {
    const next = matches[index + 1];
    if (next) next.assets.slice(0, 9).forEach((a) => { Image.prefetch(a.uri).catch(() => {}); });
  }, [index, matches]);

  // Lös upp AKTUELL flights bild-uri:er till file:// (bara ph:// blir svart i dev). Bara nuvarande
  // flight (få kandidater) → snabbt. Video hoppas över (ingen frame här).
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    setResolvedUris({});
    (async () => {
      const map: Record<string, string> = {};
      for (const a of cur.assets) {
        if (a.mediaType === 'video') continue;
        try { const u = await S.getAssetDisplayUri(a.id); if (u) map[a.id] = u; } catch { /* ignore */ }
      }
      if (alive) setResolvedUris(map);
    })();
    return () => { alive = false; };
  }, [cur]);

  const openPreview = async (a: MediaLibrary.Asset) => {
    setPreview(a);
    // Bild: ph:// funkar i <Image> → visa direkt. Video: vänta på spelbar file:// (kopieras).
    setPreviewUri(a.mediaType === 'video' ? null : a.uri);
    const uri = await S.getAssetDisplayUri(a.id);
    if (uri) setPreviewUri(uri);
  };

  const advance = () => {
    if (index + 1 < matches.length) { setIndex(index + 1); }
    else { loadFlights(); S.clearReviewSession(); setPhase("done"); } // allt hanterat → rensa sessionen
  };
  // Ett tryck = koppla vald bild till flygningen och gå direkt vidare.
  const link = async (assetId: string) => {
    if (!cur) return;
    const asset = cur.assets.find((a) => a.id === assetId);
    await linkPhoto(cur.flight.id, assetId, asset?.mediaType === 'video' ? 'video' : 'image');
    setSavedCount((c) => c + 1);
    setHistory((h) => [...h, { index, flightId: cur.flight.id, kind: 'link' }]);
    advance();
  };
  // Hoppa över (persisteras → återkommer inte när man återupptar senare).
  const skip = async () => {
    if (!cur) return;
    await S.addSkippedFlightId(cur.flight.id);
    setSkippedCount((c) => c + 1);
    setHistory((h) => [...h, { index, flightId: cur.flight.id, kind: 'skip' }]);
    advance();
  };
  // Ångra senaste åtgärden och gå tillbaka till den flygningen.
  const undo = async () => {
    const last = history[history.length - 1];
    if (!last) return;
    if (last.kind === 'link') { await linkPhoto(last.flightId, null, 'image'); setSavedCount((c) => Math.max(0, c - 1)); }
    else { await S.removeSkippedFlightId(last.flightId); setSkippedCount((c) => Math.max(0, c - 1)); }
    setHistory((h) => h.slice(0, -1));
    if (phase === 'done') setPhase('review');
    setIndex(last.index);
  };

  // ── Behörighet nekad / native-modul saknas ──
  if (phase === 'perm') {
    const unavailable = perm === 'unavailable';
    const cancelled = perm === 'undetermined'; // dialogen stängdes utan att åtkomst gavs → fråga igen direkt
    const title = unavailable ? 'Update required' : cancelled ? 'Sync cancelled' : 'Photo access needed';
    const body = unavailable
      ? 'Photo sync needs the latest app version. Update the app, then try again.'
      : cancelled
        ? 'Photo sync was cancelled — full photo library access is needed to match photos and videos to your flights. Nothing is uploaded; everything stays on your device.'
        : 'To match photos and videos to your flights, allow full photo library access in Settings. Everything stays on your device — nothing is uploaded.';
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, padding: 24, paddingTop: insets.top + 40, gap: 16 }}>
        <Ionicons name={unavailable ? 'cloud-download-outline' : cancelled ? 'close-circle-outline' : 'images-outline'} size={44} color={Colors.textMuted} />
        <Text style={{ color: Colors.textPrimary, fontSize: 20, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: Colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{body}</Text>
        {unavailable ? null : cancelled ? (
          <TouchableOpacity onPress={() => run()} style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>Try again</Text>
          </TouchableOpacity>
        ) : (
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

  // ── Återupptar (ingen ny scanning — bygger bara om kvarvarande ur sparad session) ──
  if (phase === 'resuming') {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '700' }}>Resuming where you left off…</Text>
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
          <Text style={{ color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
            Tap a photo to link it and jump to the next flight. You can pause anytime and continue later.
          </Text>
        ) : null}
        {n > 0 ? (
          <TouchableOpacity onPress={() => { setIndex(0); setHistory([]); setPhase('review'); }} style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}>
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
        {skippedCount > 0 ? (
          <Text style={{ color: Colors.textSecondary, fontSize: 13, textAlign: 'center' }}>{skippedCount} skipped — these won't be suggested again.</Text>
        ) : null}
        <TouchableOpacity onPress={() => router.back()} style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40 }}>
          <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>Done</Text>
        </TouchableOpacity>
        {history.length > 0 ? (
          <TouchableOpacity onPress={undo} style={{ paddingVertical: 10 }}>
            <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '600' }}>Undo last</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // ── Granskning (ett tryck = koppla + nästa; förstoringsglas = förhandsgranska) ──
  const f = cur.flight;
  const done = savedCount + skippedCount;
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top + 8 }}>
      {/* Header: progress + stäng (stänger = pausar, återupptas nästa gång) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textMuted, fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' }}>Flight {index + 1} of {matches.length}</Text>
          <Text style={{ color: Colors.textMuted, fontSize: 10.5, marginTop: 2 }}>{savedCount} linked · {skippedCount} skipped</Text>
        </View>
        <TouchableOpacity onPress={() => { loadFlights(); router.back(); }} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Ionicons name="pause" size={15} color={Colors.textSecondary} />
          <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '700' }}>Pause</Text>
        </TouchableOpacity>
      </View>
      {/* Progressbar */}
      <View style={{ marginHorizontal: 16, height: 3, borderRadius: 2, backgroundColor: Colors.elevated, overflow: 'hidden', marginBottom: 10 }}>
        <View style={{ width: `${matches.length ? (done / matches.length) * 100 : 0}%`, height: '100%', backgroundColor: Colors.primary }} />
      </View>

      {/* Flightinfo + instruktion */}
      <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isDrone ? (
            <>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: Colors.textPrimary, fontSize: 16, fontWeight: '800', fontFamily: 'Menlo' }}>{f.location || 'Drone flight'}</Text>
              <View style={{ flex: 1 }} />
              {f.takeoff_time ? <Text style={{ color: Colors.textMuted, fontSize: 12, fontFamily: 'Menlo' }}>{f.takeoff_time}</Text> : null}
            </>
          ) : (
            <>
              <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800', fontFamily: 'Menlo' }}>{f.dep_place || '?'} → {f.arr_place || '?'}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: Colors.textMuted, fontSize: 12, fontFamily: 'Menlo' }}>{f.dep_utc}–{f.arr_utc}z</Text>
            </>
          )}
        </View>
        <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 3 }}>{fmtDate(f.date)}{f.registration ? ` · ${f.registration}` : ''}</Text>
      </View>
      <Text style={{ color: Colors.textMuted, fontSize: 11.5, marginHorizontal: 16, marginBottom: 8 }}>Tap a photo to link it and move on · tap ⤢ to preview</Text>

      {/* Galleri — ett tryck kopplar direkt och går vidare */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {cur.assets.map((a) => {
            const isVideo = a.mediaType === 'video';
            return (
              <TouchableOpacity key={a.id} activeOpacity={0.75} onPress={() => link(a.id)}
                style={{ width: thumb, height: thumb, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.elevated }}>
                <Image source={{ uri: resolvedUris[a.id] ?? a.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                {/* Förhandsgranska (fångar trycket → kopplar ej) */}
                <TouchableOpacity onPress={() => openPreview(a)} hitSlop={8}
                  style={{ position: 'absolute', top: 4, left: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="expand" size={14} color="#fff" />
                </TouchableOpacity>
                {isVideo && (
                  <View style={{ position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                    <Ionicons name="videocam" size={10} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', fontFamily: 'Menlo' }}>{fmtDur(a.duration)}</Text>
                  </View>
                )}
                <View style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: Colors.primary, borderRadius: 11, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="add" size={16} color={Colors.textInverse} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Knappar: Undo + Skip (koppling sker via tryck på bild) */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.separator }}>
        <TouchableOpacity onPress={undo} disabled={history.length === 0} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: Colors.border, opacity: history.length === 0 ? 0.4 : 1 }}>
          <Ionicons name="arrow-undo" size={16} color={Colors.textSecondary} />
          <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '700' }}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={skip} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '700' }}>Skip</Text>
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
              onPress={() => { const id = preview?.id; setPreview(null); if (id) link(id); }}
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
