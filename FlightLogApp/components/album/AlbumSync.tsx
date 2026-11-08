// Flygalbumets synk (piloten, rutten /photo-sync): ett svep genom fotobiblioteket, sedan tidsfönstret — hur långt
// före start och efter landning en bild räknas — med antalet bilder direkt, och allt läggs till på en gång.
// Från albumet (?window=1) öppnas bara fönstret (inget nytt svep). Logiken: services/photoSync, utils/photoWindow.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Pressable, Switch, Linking, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_SERIF } from '../logbook-page/tokens';
import { AppBackground } from '../AppBackground';
import { AssetImage } from './AssetImage';
import { useFlightStore } from '../../store/flightStore';
import {
  getPhotoPermissionStatus, requestPhotoPermission, scanLibrary, loadAlbum, getPhotoWindow, setPhotoWindow, assignCovers,
  type PhotoPermission, type ScanProgress, type AlbumFlight,
} from '../../services/photoSync';
import {
  WINDOW_LABELS, WINDOW_SHORT, DEFAULT_WINDOW, inWindow, windowStats, type PhotoWindow, type WindowItem,
} from '../../utils/photoWindow';

const LIGHT = '#7FDCEF';   // med, före start / efter landning
const DIM = '#22344F';     // utanför fönstret
const fmt = (n: number) => n.toLocaleString('en-US');

export function AlbumSync() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const fromAlbum = useLocalSearchParams<{ window?: string }>().window === '1';
  const [phase, setPhase] = useState<'checking' | 'perm' | 'reading' | 'window'>('checking');
  const [perm, setPerm] = useState<PhotoPermission>('undetermined');
  const [prog, setProg] = useState<ScanProgress>({ read: 0, total: null, flights: 0, fraction: 0 });
  const [album, setAlbum] = useState<AlbumFlight[]>([]);
  const [w, setW] = useState<PhotoWindow>(DEFAULT_WINDOW);
  const [added, setAdded] = useState(0);
  const [saving, setSaving] = useState(false);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);

  useEffect(() => {
    (async () => {
      setW(await getPhotoWindow());
      let p = await getPhotoPermissionStatus();
      if (p === 'undetermined' && !fromAlbum) p = await requestPhotoPermission();
      setPerm(p);
      if (fromAlbum) { setAlbum(await loadAlbum()); setPhase('window'); return; }
      if (p !== 'full' && p !== 'limited') { setPhase('perm'); return; }
      setPhase('reading');
      try {
        const r = await scanLibrary(setProg, () => stop.current);
        if (stop.current) return;
        setAdded(r.added);
        setAlbum(await loadAlbum());
        setPhase('window');
      } catch {
        setPhase('perm');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bilderna ur biblioteket (inte de som lagts till för hand) med var de ligger i förhållande till flygningen.
  const items: WindowItem[] = useMemo(() => album.flatMap((af) => af.photos.filter((p) => p.localId).map((p) => ({
    flightId: af.flight.id, phase: p.phase, rel: p.rel, frac: p.frac, isVideo: p.isVideo,
  }))), [album]);
  const stats = useMemo(() => windowStats(items, w), [items, w]);
  const nearFlights = useMemo(() => new Set(items.map((i) => i.flightId)).size, [items]);
  // Tre flygningar som visar vad fönstret gör: de senaste med bilder både i och runt flygningen.
  const samples = useMemo(() => {
    const synced = album.map((af) => ({ af, ph: af.photos.filter((p) => p.localId) })).filter((x) => x.ph.length >= 3);
    const around = synced.filter((x) => x.ph.some((p) => p.phase === 'before' || p.phase === 'after'));
    return (around.length >= 3 ? around : synced).slice(0, 3);
  }, [album]);

  const apply = async () => {
    if (saving) return;
    if (!fromAlbum && stats.photos === 0) { router.back(); return; }
    setSaving(true);
    await setPhotoWindow(w);
    await assignCovers(w).catch(() => {});
    useFlightStore.getState().loadFlights?.();
    if (fromAlbum) { router.back(); return; }
    const first = added > 0 && added >= items.length;
    const toast = first
      ? `${fmt(stats.photos)} photos added to ${fmt(stats.flights)} flights.`
      : added > 0 ? `${fmt(added)} new photos found.` : 'No new photos found.';
    router.replace({ pathname: '/settings/album', params: { toast } } as any);
  };

  if (phase === 'checking') {
    return <View style={s.root}><AppBackground /><ActivityIndicator color={Colors.primary} style={{ marginTop: insets.top + 120 }} /></View>;
  }

  if (phase === 'perm') {
    return (
      <View style={[s.root, { paddingTop: insets.top + 40, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }]}>
        <AppBackground />
        <Text style={s.title}>Flight album</Text>
        <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
          <Ionicons name="images-outline" size={40} color={Colors.primary} />
          <Text style={s.h2}>{perm === 'unavailable' ? 'Photos are not available' : 'Blades needs your photos'}</Text>
          <Text style={s.body}>
            {perm === 'unavailable'
              ? 'This version of the app can’t read your photo library. It comes with the next app build.'
              : 'To find the photos from your flights, allow Blades to see your photo library in Settings. Only when each photo was taken is read, and nothing is uploaded.'}
          </Text>
        </View>
        {perm !== 'unavailable' && (
          <TouchableOpacity style={s.primary} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
            <Text style={s.primaryText}>Open Settings</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.link} onPress={() => router.back()}><Text style={s.linkText}>Close</Text></TouchableOpacity>
      </View>
    );
  }

  if (phase === 'reading') {
    return (
      <View style={[s.root, { paddingTop: insets.top + 40, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }]}>
        <AppBackground />
        <Text style={s.title}>Flight album</Text>
        <View style={{ flex: 1, justifyContent: 'center', gap: 18 }}>
          <View style={{ gap: 4 }}>
            <Text style={s.bigCount}>{fmt(prog.read)}</Text>
            <Text style={s.body}>photos read</Text>
          </View>
          <View style={s.track}><View style={[s.fill, { width: `${Math.round(Math.max(0.03, prog.fraction) * 100)}%` }]} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="airplane-outline" size={18} color={Colors.primary} />
            <Text style={{ color: Colors.textPrimary, fontSize: 15 }}>
              <Text style={{ fontWeight: '700' }}>{fmt(prog.flights)}</Text> flights have photos nearby
            </Text>
          </View>
          <Text style={s.note}>
            One pass through your library. Blades only reads when each photo was taken, never the photo itself.
            {perm === 'limited' ? ' You’ve given Blades some of your photos, so only those are read.' : ''}
          </Text>
        </View>
        <TouchableOpacity style={s.link} onPress={() => { stop.current = true; router.back(); }}><Text style={s.linkText}>Cancel</Text></TouchableOpacity>
      </View>
    );
  }

  // ── Fönstret ──
  const TW = width - 48 - 34;                 // tidslinjens bredd i kortet
  const u = TW / 306;                         // en enhet i tidslinjens rutnät (stapel 19, steg 22)
  const all = [...stats.bars.before, ...stats.bars.air, ...stats.bars.after];
  const maxBar = Math.max(1, ...all);
  const barH = (n: number) => (n ? Math.max(4, Math.round((n / maxBar) * 64)) : 2);
  const bx = w.before === 0 ? 110 * u : Math.max(1, ((5 - w.before) * 22 - 1.5) * u);
  const ax = w.after === 0 ? 196 * u : Math.min(TW - 1, (199 + w.after * 22 - 1.5) * u);
  const tag = (x: number) => Math.max(0, Math.min(TW - 50, x - 25));
  const setBefore = (i: number) => setW((cur) => ({ ...cur, before: cur.before === i + 1 ? i : i + 1 }));
  const setAfter = (i: number) => setW((cur) => ({ ...cur, after: cur.after === i + 1 ? i : i + 1 }));
  const label = fromAlbum ? 'Update album' : stats.photos ? `Add ${fmt(stats.photos)} photos` : 'Close';

  return (
    <View style={s.root}>
      <AppBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingHorizontal: 24, paddingBottom: insets.bottom + 120, gap: 18 }}>
        <View style={{ gap: 8 }}>
          {fromAlbum
            ? <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ alignSelf: 'flex-start' }}><Text style={s.linkText}>Cancel</Text></TouchableOpacity>
            : <Text style={s.eyebrow}>{`PHOTOS FOUND NEAR ${fmt(nearFlights)} FLIGHTS`}</Text>}
          <Text style={[s.title, { fontSize: 27, lineHeight: 32 }]}>Which photos belong to a flight?</Text>
          <Text style={s.body}>Photos taken in the air always count. Choose how long before take-off and after landing a photo can be.</Text>
        </View>

        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ gap: 3 }}>
              <Text style={s.bigNum}>{fmt(stats.photos)}</Text>
              <Text style={s.soft}>photos in <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>{fmt(stats.flights)}</Text> flights</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: Colors.textSecondary, fontVariant: ['tabular-nums'] }}>{fmt(stats.left)}</Text>
              <Text style={{ fontSize: 12, color: Colors.textSecondary }}>left out</Text>
            </View>
          </View>

          {/* Tidslinjen: staplar = bilder per intervall. Ljusa är med, mörka utanför. Tryck på en stapel flyttar kanten. */}
          <View style={{ width: TW, height: 122 }}>
            <View pointerEvents="none" style={{ position: 'absolute', top: 24, bottom: 20, left: bx, width: Math.max(0, ax - bx), backgroundColor: 'rgba(0,200,232,0.07)', borderRadius: 6 }} />
            <View pointerEvents="none" style={{ position: 'absolute', top: 24, bottom: 20, left: 110 * u, width: 86 * u, borderLeftWidth: 1, borderRightWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(0,200,232,0.6)' }} />
            {[4, 3, 2, 1, 0].map((idx, k) => (
              <Pressable key={`b${idx}`} onPress={() => setBefore(idx)} accessibilityRole="button"
                accessibilityLabel={`Include photos up to ${WINDOW_LABELS[idx + 1]} before take-off`}
                style={{ position: 'absolute', left: k * 22 * u, bottom: 20, width: 19 * u, height: 78, justifyContent: 'flex-end' }}>
                <View style={{ height: barH(stats.bars.before[idx]), borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: idx < w.before ? LIGHT : DIM }} />
              </Pressable>
            ))}
            {stats.bars.air.map((n, j) => (
              <View key={`a${j}`} pointerEvents="none" style={{ position: 'absolute', left: (114 + j * 13.5) * u, bottom: 20, width: 10 * u, height: barH(n), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: Colors.primary }} />
            ))}
            {[0, 1, 2, 3, 4].map((idx, k) => (
              <Pressable key={`r${idx}`} onPress={() => setAfter(idx)} accessibilityRole="button"
                accessibilityLabel={`Include photos up to ${WINDOW_LABELS[idx + 1]} after landing`}
                style={{ position: 'absolute', left: (199 + k * 22) * u, bottom: 20, width: 19 * u, height: 78, justifyContent: 'flex-end' }}>
                <View style={{ height: barH(stats.bars.after[idx]), borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: idx < w.after ? LIGHT : DIM }} />
              </Pressable>
            ))}
            <View pointerEvents="none" style={[s.handle, { left: bx - 1 }]} />
            <View pointerEvents="none" style={[s.handle, { left: ax - 1 }]} />
            <View pointerEvents="none" style={[s.tag, { left: tag(bx) }]}><Text style={s.tagText}>{WINDOW_SHORT[w.before]}</Text></View>
            <View pointerEvents="none" style={[s.tag, { left: tag(ax) }]}><Text style={s.tagText}>{WINDOW_SHORT[w.after]}</Text></View>
            <Text style={[s.axis, { left: 0 }]}>3 h</Text>
            <Text style={[s.axis, s.axisMid, { left: 110 * u - 30 }]}>Take-off</Text>
            <Text style={[s.axis, s.axisMid, { left: 196 * u - 30 }]}>Landing</Text>
            <Text style={[s.axis, { right: 0 }]}>3 h</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[[stats.before, 'Before take-off', LIGHT], [stats.air, 'In the air', Colors.primary], [stats.after, 'After landing', LIGHT]].map(([n, l, c]) => (
              <View key={l as string} style={{ flex: 1, gap: 2, paddingTop: 8, borderTopWidth: 2, borderTopColor: c as string }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] }}>{fmt(n as number)}</Text>
                <Text style={{ fontSize: 11.5, color: Colors.textSecondary }}>{l as string}</Text>
              </View>
            ))}
          </View>
        </View>

        <Chips title="BEFORE TAKE-OFF" value={w.before === 0 ? 'Nothing before take-off' : `Up to ${WINDOW_LABELS[w.before]} before`}
          current={w.before} onPick={(i) => setW((cur) => ({ ...cur, before: i }))} />
        <Chips title="AFTER LANDING" value={w.after === 0 ? 'Nothing after landing' : `Up to ${WINDOW_LABELS[w.after]} after`}
          current={w.after} onPick={(i) => setW((cur) => ({ ...cur, after: i }))} />

        <View style={[s.card, { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>Include videos</Text>
            <Text style={{ fontSize: 12.5, color: Colors.textSecondary }}>{fmt(stats.videos)} videos near your flights</Text>
          </View>
          <Switch value={w.videos} onValueChange={(v) => setW((cur) => ({ ...cur, videos: v }))} trackColor={{ true: Colors.primary, false: '#2A3D58' }} />
        </View>

        {samples.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={s.eyebrow}>ON YOUR FLIGHTS</Text>
            {samples.map(({ af, ph }) => {
              const n = ph.filter((p) => inWindow(p, w)).length;
              const f = af.flight;
              return (
                <View key={f.id} style={s.sample}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}>{f.dep_place === f.arr_place ? `${f.dep_place} · local` : `${f.dep_place} → ${f.arr_place}`}</Text>
                    <Text style={{ fontSize: 13, color: '#CFE0EE', fontVariant: ['tabular-nums'] }}>{n} of {ph.length} photos</Text>
                  </View>
                  <Text style={{ fontSize: 12.5, color: Colors.textSecondary }}>{f.date} · {f.aircraft_type}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {ph.slice(0, 16).map((p) => (
                      <View key={p.key} style={{ opacity: inWindow(p, w) ? 1 : 0.22 }}>
                        <AssetImage localId={p.localId} isVideo={p.isVideo} style={{ width: 34, height: 34, borderRadius: 7 }} />
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
            <Text style={s.note}>Faded photos fall outside the window. You can change the window any time from the album.</Text>
          </View>
        )}
        {items.length === 0 && (
          <View style={s.card}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.textPrimary }}>No photos near your flights</Text>
            <Text style={s.body}>Blades looked up to 3 hours before take-off and after landing for every flight with times.</Text>
          </View>
        )}
      </ScrollView>
      <LinearGradient colors={['rgba(6,12,24,0)', 'rgba(6,12,24,0.92)']} locations={[0, 0.34]} style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={[s.primary, saving && { opacity: 0.6 }]} onPress={apply} activeOpacity={0.85} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={s.primaryText}>{label}</Text>}
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

function Chips({ title, value, current, onPick }: { title: string; value: string; current: number; onPick: (i: number) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <Text style={s.eyebrow}>{title}</Text>
        <Text style={{ fontSize: 13, color: '#CFE0EE' }}>{value}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {WINDOW_LABELS.map((l, i) => {
          const on = i === current;
          return (
            <TouchableOpacity key={l} onPress={() => onPick(i)} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[s.chip, on && { backgroundColor: Colors.primary, borderColor: Colors.primary }]}>
              <Text style={{ fontSize: 12.5, fontWeight: on ? '800' : '600', color: on ? Colors.textInverse : '#CFE0EE' }}>{l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  title: { fontFamily: FONT_SERIF, fontSize: 30, fontWeight: '600', color: Colors.textPrimary },
  h2: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  body: { fontSize: 14.5, lineHeight: 21, color: '#CFE0EE' },
  soft: { fontSize: 14, color: '#CFE0EE' },
  note: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2.2, color: Colors.textSecondary },
  bigCount: { fontSize: 52, lineHeight: 56, fontWeight: '800', letterSpacing: -1.5, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  bigNum: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: '#1A2D45', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: Colors.primary },
  card: { backgroundColor: 'rgba(15,30,58,0.78)', borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 18, padding: 16, gap: 14 },
  sample: { padding: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(15,30,58,0.6)', gap: 2 },
  chip: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  handle: { position: 'absolute', top: 20, bottom: 16, width: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },
  tag: { position: 'absolute', top: 0, width: 50, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  tagText: { fontSize: 11, fontWeight: '800', color: Colors.textInverse },
  axis: { position: 'absolute', bottom: 0, fontSize: 11, color: Colors.textSecondary },
  axisMid: { width: 60, textAlign: 'center', fontWeight: '600', color: '#CFE0EE' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 22, paddingHorizontal: 24 },
  primary: { height: 54, borderRadius: 16, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '800', color: Colors.textInverse },
  link: { height: 46, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
});
