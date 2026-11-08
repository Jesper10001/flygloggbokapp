// Flygalbumet (piloten): ett kort per flygning, grupperat per månad, eller alla bilder i ett rutnät. Bilderna kommer
// från foto-synken (services/photoSync: ett svep genom biblioteket; tidsfönstret väljer vad som visas) och den bild
// som lagts till för hand. Tryck på en flygning → FlightAlbumView (bilderna per fas, markera och ta bort); en bild →
// PhotoViewer. share=1 (dashboardens Share): en bild öppnar delningskortet direkt. toast: beskedet efter synken.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_SERIF } from '../../components/logbook-page/tokens';
import { AppBackground } from '../../components/AppBackground';
import { AssetImage } from '../../components/album/AssetImage';
import { FlightAlbumView, routeText } from '../../components/album/FlightAlbumView';
import { PhotoViewer } from '../../components/album/PhotoViewer';
import { FlightShareCard } from '../../components/FlightShareCard';
import { batchPlaceNames } from '../../db/icao';
import { setFlightPhotoLocalId } from '../../db/flights';
import { setFlightPhotosRemoved, setFlightManualPhoto } from '../../db/flightPhotos';
import { useFlightStore } from '../../store/flightStore';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  loadAlbum, visiblePhotos, coverOf, getPhotoWindow, getAssetDisplay, type AlbumFlight, type AlbumPhoto,
} from '../../services/photoSync';
import { DEFAULT_WINDOW, windowLabel, type PhotoWindow } from '../../utils/photoWindow';
import type { Flight } from '../../types/flight';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const monthLabel = (date: string) => {
  const [y, m] = (date || '').split('-').map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}`.toUpperCase() : 'UNDATED';
};

type Shown = { af: AlbumFlight; vis: AlbumPhoto[]; cover: AlbumPhoto | null };
type Row =
  | { type: 'month'; key: string; label: string; sub: string }
  | { type: 'flight'; key: string; item: Shown }
  | { type: 'tiles'; key: string; items: { item: Shown; p: AlbumPhoto }[] };

export default function AlbumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { formatTime } = useTimeFormat();
  const params = useLocalSearchParams<{ share?: string; toast?: string }>();
  const shareMode = params.share === '1';
  const [album, setAlbum] = useState<AlbumFlight[] | null>(null);
  const [w, setW] = useState<PhotoWindow>(DEFAULT_WINDOW);
  const [view, setView] = useState<'flights' | 'photos'>(shareMode ? 'photos' : 'flights');
  const [openId, setOpenId] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ flightId: number; index: number } | null>(null);
  const [share, setShare] = useState<{ flight: Flight; uri: string } | null>(null);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ id: number; text: string; undo?: () => void } | null>(null);

  const reload = useCallback(async () => {
    const [a, ww] = await Promise.all([loadAlbum().catch(() => [] as AlbumFlight[]), getPhotoWindow()]);
    setAlbum(a);
    setW(ww);
    const icaos = a.flatMap((x) => [x.flight.dep_place, x.flight.arr_place]).filter(Boolean);
    if (icaos.length) batchPlaceNames(icaos).then(setPlaceNames).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const showToast = useCallback((text: string, undo?: () => void) => {
    const id = Date.now();
    setToast({ id, text, undo });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 4500);
  }, []);
  useEffect(() => { if (params.toast) showToast(String(params.toast)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown: Shown[] = useMemo(() => (album ?? []).map((af) => {
    const vis = visiblePhotos(af, w);
    return { af, vis, cover: coverOf(af, vis) };
  }).filter((x) => x.vis.length > 0), [album, w]);
  const totalPhotos = shown.reduce((n, x) => n + x.vis.length, 0);
  const place = (icao: string) => placeNames[(icao || '').toUpperCase()] ?? icao;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const byMonth = new Map<string, Shown[]>();
    const order: string[] = [];
    for (const x of shown) {
      const k = monthLabel(x.af.flight.date);
      if (!byMonth.has(k)) { byMonth.set(k, []); order.push(k); }
      byMonth.get(k)!.push(x);
    }
    for (const k of order) {
      const list = byMonth.get(k)!;
      const n = list.reduce((s, x) => s + x.vis.length, 0);
      out.push({ type: 'month', key: `m${k}`, label: k, sub: `${plural(list.length, 'flight', 'flights')} · ${plural(n, 'photo', 'photos')}` });
      if (view === 'flights') {
        for (const x of list) out.push({ type: 'flight', key: `f${x.af.flight.id}`, item: x });
      } else {
        const all = list.flatMap((x) => x.vis.map((p) => ({ item: x, p })));
        for (let i = 0; i < all.length; i += 3) out.push({ type: 'tiles', key: `t${k}${i}`, items: all.slice(i, i + 3) });
      }
    }
    return out;
  }, [shown, view]);

  const open = shown.find((x) => x.af.flight.id === openId) ?? null;
  const viewerItem = viewer ? shown.find((x) => x.af.flight.id === viewer.flightId) ?? null : null;

  // ── Ändringar ─────────────────────────────────────────────────────────────
  const afterChange = async () => { await reload(); useFlightStore.getState().loadFlights?.(); };

  const removePhotos = async (x: Shown, ps: AlbumPhoto[]) => {
    const f = x.af.flight;
    const rowIds = ps.map((p) => p.rowId).filter((id): id is number => id != null);
    const manual = ps.find((p) => p.uri);
    const prevCover = f.photo_local_id ?? null;
    const prevManual = { uri: f.photo_uri, type: (f.media_type === 'video' ? 'video' : 'image') as 'image' | 'video' };
    await setFlightPhotosRemoved(rowIds, true);
    // Omslaget togs bort → nästa bild i luften (eller första) blir omslag.
    const coverRemoved = !!prevCover && ps.some((p) => p.localId === prevCover);
    let nextCover: AlbumPhoto | null = null;
    if (coverRemoved) {
      const rest = x.vis.filter((p) => p.localId && !ps.includes(p));
      nextCover = rest.find((p) => p.phase === 'air') ?? rest[0] ?? null;
      await setFlightPhotoLocalId(f.id, nextCover?.localId ?? null, f.photo_uri && !manual ? undefined : nextCover?.isVideo ? 'video' : 'image');
    }
    if (manual) {
      const coverIsVideo = nextCover ? nextCover.isVideo : x.vis.find((p) => p.localId === prevCover)?.isVideo;
      await setFlightManualPhoto(f.id, '', coverIsVideo ? 'video' : 'image');
    }
    await afterChange();
    const n = ps.length;
    showToast(manual && n === 1 ? 'Photo removed from this flight.' : `${plural(n, 'photo', 'photos')} removed from this flight. Still in Photos.`, async () => {
      setToast(null);
      await setFlightPhotosRemoved(rowIds, false);
      if (manual) await setFlightManualPhoto(f.id, prevManual.uri, prevManual.type);
      if (coverRemoved) {
        await setFlightPhotoLocalId(f.id, prevCover, f.photo_uri ? undefined : x.vis.find((p) => p.localId === prevCover)?.isVideo ? 'video' : 'image');
      }
      await afterChange();
    });
  };

  const setCover = async (x: Shown, p: AlbumPhoto) => {
    if (!p.localId) return;
    await setFlightPhotoLocalId(x.af.flight.id, p.localId, x.af.flight.photo_uri ? undefined : p.isVideo ? 'video' : 'image');
    await afterChange();
    showToast('Cover photo changed.');
  };

  const openPhoto = async (x: Shown, p: AlbumPhoto) => {
    if (shareMode) {
      const uri = p.uri ?? (p.localId ? (await getAssetDisplay(p.localId))?.uri : null);
      if (uri) setShare({ flight: x.af.flight, uri });
      return;
    }
    setViewer({ flightId: x.af.flight.id, index: Math.max(0, x.vis.indexOf(p)) });
  };

  // ── Rader ─────────────────────────────────────────────────────────────────
  const tile = (width - 40 - 4) / 3;
  const renderRow = ({ item: r }: { item: Row }) => {
    if (r.type === 'month') {
      return (
        <View style={s.monthRow}>
          <Text style={s.eyebrow}>{r.label}</Text>
          <Text style={{ fontSize: 12.5, color: Colors.textSecondary }}>{r.sub}</Text>
        </View>
      );
    }
    if (r.type === 'tiles') {
      return (
        <View style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>
          {r.items.map(({ item, p }) => (
            <TouchableOpacity key={p.key} activeOpacity={0.85} onPress={() => openPhoto(item, p)} style={{ width: tile, height: tile, backgroundColor: Colors.card }}
              accessibilityLabel={`${routeText(item.af.flight)}, photo`}>
              <AssetImage localId={p.localId} uri={p.uri} isVideo={p.isVideo} style={{ width: tile, height: tile }} />
              {p.isVideo && <View style={s.vid}><Ionicons name="play" size={9} color="#fff" /></View>}
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    const { af, vis, cover } = r.item;
    const f = af.flight;
    const others = vis.filter((p) => p !== cover);
    const more = vis.length - 3;
    const H = vis.length === 1 ? 190 : 204;
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => setOpenId(f.id)} style={s.card}
        accessibilityLabel={`Open ${routeText(f)}, ${f.date}, ${plural(vis.length, 'photo', 'photos')}`}>
        <View style={{ flexDirection: 'row', gap: 2, height: H }}>
          {cover && <AssetImage localId={cover.localId} uri={cover.uri} isVideo={cover.isVideo} style={{ flex: 2, height: H }} />}
          {others.length > 0 && (
            <View style={{ flex: 1, gap: 2 }}>
              <AssetImage localId={others[0].localId} uri={others[0].uri} isVideo={others[0].isVideo} style={{ flex: 1, width: '100%' }} />
              {others[1] && (
                <View style={{ flex: 1 }}>
                  <AssetImage localId={others[1].localId} uri={others[1].uri} isVideo={others[1].isVideo} style={StyleSheet.absoluteFill as any} />
                  {more > 0 && <View style={s.more}><Text style={{ fontSize: 20, fontWeight: '700', color: '#fff' }}>+{more}</Text></View>}
                </View>
              )}
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.textPrimary }} numberOfLines={1}>{routeText(f)}</Text>
            <Text style={{ fontSize: 13, color: Colors.textSecondary }} numberOfLines={1}>{[f.date, f.aircraft_type, f.registration].filter(Boolean).join(' · ')}</Text>
          </View>
          <Ionicons name="images-outline" size={15} color="#CFE0EE" />
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#CFE0EE', fontVariant: ['tabular-nums'] }}>{vis.length}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={{ gap: 14, paddingBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={s.title}>Flight album</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={s.round} onPress={() => router.push('/photo-sync' as any)} accessibilityLabel="Sync new photos">
            <Ionicons name="sync" size={19} color="#CFE0EE" />
          </TouchableOpacity>
          <TouchableOpacity style={s.round} onPress={() => router.back()} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color="#CFE0EE" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: -6 }}>
        <Text style={{ fontSize: 14, color: '#CFE0EE', fontVariant: ['tabular-nums'] }}>{plural(totalPhotos, 'photo', 'photos')} · {plural(shown.length, 'flight', 'flights')}</Text>
        <TouchableOpacity style={s.windowChip} onPress={() => router.push('/photo-sync?window=1' as any)} accessibilityLabel={`Change which photos count: ${windowLabel(w)}`}>
          <Ionicons name="options-outline" size={15} color={Colors.primary} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.primary }}>{windowLabel(w)}</Text>
        </TouchableOpacity>
      </View>
      {shareMode && (
        <View style={s.shareBanner}>
          <Ionicons name="share-outline" size={15} color={Colors.primary} />
          <Text style={{ flex: 1, color: Colors.primary, fontSize: 12.5, fontWeight: '700' }}>Pick a photo to share</Text>
        </View>
      )}
      <View style={s.segment}>
        {(['flights', 'photos'] as const).map((v) => (
          <TouchableOpacity key={v} onPress={() => setView(v)} accessibilityRole="button" accessibilityState={{ selected: view === v }}
            style={[s.segBtn, view === v && { backgroundColor: 'rgba(0,200,232,0.18)' }]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: view === v ? '#fff' : Colors.textSecondary }}>{v === 'flights' ? 'Flights' : 'All photos'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  let body;
  if (!album) {
    body = <ActivityIndicator color={Colors.primary} style={{ marginTop: insets.top + 120 }} />;
  } else if (open) {
    body = (
      <FlightAlbumView af={open.af} vis={open.vis} cover={open.cover}
        depName={place(open.af.flight.dep_place)} arrName={place(open.af.flight.arr_place)}
        onBack={() => setOpenId(null)} onOpen={(p) => openPhoto(open, p)}
        onRemove={(ps) => removePhotos(open, ps)} onSetCover={(p) => setCover(open, p)} />
    );
  } else if (!shown.length) {
    body = (
      <View style={{ flex: 1, paddingTop: insets.top + 8, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.title}>Flight album</Text>
          <TouchableOpacity style={s.round} onPress={() => router.back()} accessibilityLabel="Close"><Ionicons name="close" size={20} color="#CFE0EE" /></TouchableOpacity>
        </View>
        <View style={{ height: 250, marginTop: 22 }}>
          <Image source={require('../../assets/sample-photos/sample1.jpg')} style={[s.fan, { left: 4, top: 34, width: 180, height: 126, transform: [{ rotate: '-8deg' }] }]} />
          <Image source={require('../../assets/sample-photos/sample3.jpg')} style={[s.fan, { right: 4, top: 16, width: 172, height: 120, transform: [{ rotate: '7deg' }] }]} />
          <Image source={require('../../assets/sample-photos/samplealbum.jpg')} style={[s.fan, { left: 56, top: 88, width: 214, height: 150, transform: [{ rotate: '-1.5deg' }] }]} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '700', color: Colors.textPrimary, marginTop: 22 }}>Your flights, in pictures</Text>
        <Text style={{ fontSize: 15, lineHeight: 22, color: '#CFE0EE', marginTop: 10 }}>
          Blades reads when each photo in your library was taken and puts it with the flight it belongs to. Your photos stay in Photos. Nothing is copied or uploaded.
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={s.primary} onPress={() => router.push('/photo-sync' as any)} activeOpacity={0.85}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: Colors.textInverse }}>Sync from Photos</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        initialNumToRender={8}
        windowSize={7}
      />
    );
  }

  const viewerList = viewerItem?.vis ?? [];
  return (
    <View style={s.root}>
      <AppBackground />
      {body}

      {toast && (
        <View style={[s.toast, { bottom: insets.bottom + 20 }]}>
          <Ionicons name="checkmark" size={18} color={Colors.primary} />
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: '#fff' }}>{toast.text}</Text>
          {toast.undo && (
            <TouchableOpacity onPress={toast.undo} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.primary }}>Undo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <PhotoViewer
        list={viewerList}
        index={viewer && viewerItem && viewer.index < viewerList.length ? viewer.index : null}
        flight={viewerItem?.af.flight ?? null}
        coverKey={viewerItem?.cover?.key ?? null}
        onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
        onClose={() => setViewer(null)}
        onShare={(p, uri) => {
          const fl = viewerItem?.af.flight;
          setViewer(null);
          if (fl) setTimeout(() => setShare({ flight: fl, uri }), 320); // fullskärmen hinner stängas först (iOS)
        }}
        onSetCover={(p) => { if (viewerItem) setCover(viewerItem, p); }}
        onRemove={(p) => {
          if (!viewerItem || !viewer) return;
          const left = viewerList.length - 1;
          setViewer(left > 0 ? { ...viewer, index: Math.min(viewer.index, left - 1) } : null);
          removePhotos(viewerItem, [p]);
        }}
      />

      {share && (
        <FlightShareCard
          flight={{ ...share.flight, photo_uri: share.uri }}
          depName={place(share.flight.dep_place)}
          arrName={place(share.flight.arr_place)}
          visible={!!share}
          onClose={() => setShare(null)}
          formatTime={formatTime}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  title: { fontFamily: FONT_SERIF, fontSize: 30, fontWeight: '600', color: Colors.textPrimary },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2.2, color: Colors.textSecondary },
  monthRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 18, paddingBottom: 10 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(15,30,58,0.78)', alignItems: 'center', justifyContent: 'center' },
  windowChip: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 12, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,200,232,0.45)', backgroundColor: 'rgba(0,200,232,0.08)' },
  shareBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '44' },
  segment: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: Colors.cardBorder },
  segBtn: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden', backgroundColor: 'rgba(15,30,58,0.78)', marginBottom: 10 },
  more: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,10,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  vid: { position: 'absolute', top: 5, right: 5, padding: 3, borderRadius: 7, backgroundColor: 'rgba(4,10,20,0.6)' },
  fan: { position: 'absolute', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  primary: { height: 54, borderRadius: 16, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, borderRadius: 14, backgroundColor: '#132B4D', borderWidth: 1, borderColor: '#24507E' },
});
