// Flight album: bilder/videor (uppladdade photo_uri ELLER synkade photo_local_id) grupperade
// per år & månad (3 per rad med info-overlay), med en kartvy (Apple-karta). På kartan är varje
// media utmarkerad; markera → mediet förstoras i mitten (video spelas upp), sträck dras till
// avgångs- och destinationsflygplatsen, övriga media döljs, och en översiktsruta visas i botten
// (tryck → flight detail).
import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image,
  TouchableOpacity, Dimensions, ActivityIndicator, Modal,
} from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { FlightVideo } from '../../components/FlightVideo';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFlightsWithPhotos } from '../../db/flights';
import { getAssetDisplay } from '../../services/photoSync';
import { FlightShareCard } from '../../components/FlightShareCard';
import { batchPlaceNames, getAirportCoordinates } from '../../db/icao';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { formatDate } from '../../utils/format';
import type { Flight } from '../../types/flight';

const { width, height } = Dimensions.get('window');
const GAP = 3;
const TILE = (width - GAP * 4) / 3; // 3 per rad
const BIG = 150;                     // förstorat media på kartan
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Media = { uri: string; isVideo: boolean; location?: { latitude: number; longitude: number } | null };
type LatLon = { lat: number; lon: number };

function fitRegion(pts: { latitude: number; longitude: number }[]): Region {
  if (!pts.length) return { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 120 };
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const p of pts) { minLa = Math.min(minLa, p.latitude); maxLa = Math.max(maxLa, p.latitude); minLo = Math.min(minLo, p.longitude); maxLo = Math.max(maxLo, p.longitude); }
  return {
    latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2,
    latitudeDelta: Math.max(1, Math.min(160, (maxLa - minLa) * 1.5 + 2)),
    longitudeDelta: Math.max(1, Math.min(330, (maxLo - minLo) * 1.5 + 2)),
  };
}

function PhotoMarker({ coordinate, thumb, isVideo, onPress }: {
  coordinate: { latitude: number; longitude: number }; thumb?: string | null; isVideo: boolean; onPress: () => void;
}) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    if (thumb) return; // ikon-fallback: sluta spåra nästa frame (annars fångas markören aldrig → osynlig)
    const id = requestAnimationFrame(() => setTracks(false));
    return () => cancelAnimationFrame(id);
  }, [thumb]);
  return (
    <Marker coordinate={coordinate} onPress={onPress} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
      <View style={{ width: 38, height: 38, borderRadius: 9, borderWidth: 2, borderColor: '#fff', overflow: 'hidden', backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
        {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" onLoad={() => setTracks(false)} />
          : <Ionicons name={isVideo ? 'videocam' : 'image'} size={16} color="rgba(255,255,255,0.6)" />}
        {isVideo && <View style={{ position: 'absolute', bottom: 1, right: 1, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 1 }}><Ionicons name="play" size={8} color="#fff" /></View>}
      </View>
    </Marker>
  );
}

type MarkerItem = { f: Flight; pos: { latitude: number; longitude: number } };

// Zoom-beroende rutnäts-klustring (à la Apple Bilder): media i samma cell slås ihop. Ju mer
// utzoomad (större delta) desto större celler → färre kluster; inzoomat → allt delas upp.
function clusterMarkers(markers: MarkerItem[], region: Region): { key: string; lat: number; lon: number; items: MarkerItem[] }[] {
  const cellLat = Math.max(region.latitudeDelta / 6, 1e-4);
  const cellLon = Math.max(region.longitudeDelta / 6, 1e-4);
  const buckets = new Map<string, MarkerItem[]>();
  for (const m of markers) {
    const key = `${Math.floor(m.pos.latitude / cellLat)}_${Math.floor(m.pos.longitude / cellLon)}`;
    const arr = buckets.get(key); if (arr) arr.push(m); else buckets.set(key, [m]);
  }
  return [...buckets.entries()].map(([key, items]) => {
    let lat = 0, lon = 0;
    for (const it of items) { lat += it.pos.latitude; lon += it.pos.longitude; }
    return { key, lat: lat / items.length, lon: lon / items.length, items };
  });
}

// Kluster-bricka: STATISK vy + tracksViewChanges={false} — exakt samma pålitliga mönster som
// GlobalAirportMap:s flagg-pins (emoji/ikon + text, ingen async-bild-i-markör, som strular på iOS).
// Tryck → zooma in (delar upp klustret).
function ClusterMarker({ coordinate, count, onPress }: {
  coordinate: { latitude: number; longitude: number }; count: number; onPress: () => void;
}) {
  return (
    <Marker coordinate={coordinate} onPress={onPress} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 15, borderWidth: 2, borderColor: '#fff', paddingLeft: 7, paddingRight: 9, paddingVertical: 5 }}>
        <Ionicons name="images" size={13} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '800' }}>{count}</Text>
      </View>
    </Marker>
  );
}

// Stabil, memo:ad grid-ruta — undviker remount (=blink) när skärmen re-renderar under
// medieupplösningen. Re-renderar bara när dess egen thumb/isVideo ändras.
const AlbumTile = memo(function AlbumTile({ f, thumb, isVideo, onOpen }: { f: Flight; thumb?: string; isVideo: boolean; onOpen: (f: Flight) => void }) {
  return (
    <TouchableOpacity style={styles.tile} onPress={() => onOpen(f)} activeOpacity={0.85}>
      {thumb ? <Image source={{ uri: thumb }} style={styles.image} />
        : <View style={[styles.image, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }]}>{isVideo ? <Ionicons name="videocam" size={20} color="rgba(255,255,255,0.5)" /> : <ActivityIndicator size="small" color={Colors.textMuted} />}</View>}
      {isVideo && <View style={{ position: 'absolute', top: 4, right: 4 }}><Ionicons name="play-circle" size={18} color="rgba(255,255,255,0.9)" /></View>}
      {/* Info-overlay: dep→arr + datum */}
      <LinearGradient colors={['transparent', 'rgba(6,11,22,0.85)']} locations={[0.5, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', justifyContent: 'flex-end', padding: 5 }}>
        <Text numberOfLines={1} style={{ fontFamily: 'Menlo', fontSize: 10.5, fontWeight: '800', color: '#fff', letterSpacing: 0.3 }}>{f.dep_place} → {f.arr_place}</Text>
        <Text numberOfLines={1} style={{ fontFamily: 'Menlo', fontSize: 8, color: 'rgba(255,255,255,0.78)', marginTop: 1 }}>{formatDate(f.date)}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
});

export default function AlbumScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { formatTime } = useTimeFormat();
  // share=1 → "share mode": tryck på en bild öppnar delningsfönstret (performance/route/postcard)
  // i stället för fullskärmsvisning. Nås via Share-knappen i dashboardens fotokarusell.
  const { share } = useLocalSearchParams<{ share?: string }>();
  const shareMode = share === '1';
  const mapRef = useRef<MapView>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Flight | null>(null); // fullskärm
  const [shareFlight, setShareFlight] = useState<Flight | null>(null); // valt media för delning
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [media, setMedia] = useState<Record<number, Media>>({});
  const [airports, setAirports] = useState<Record<string, LatLon>>({});
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [pin, setPin] = useState<Flight | null>(null); // vald på kartan
  const [mapType, setMapType] = useState<'standard' | 'satellite' | 'hybrid'>('standard');
  const [overlayPt, setOverlayPt] = useState<{ x: number; y: number } | null>(null); // skärmpos för förstorat media
  const [region, setRegion] = useState<Region | null>(null); // aktuell region → styr klustring

  useEffect(() => {
    getFlightsWithPhotos().then(async (f) => {
      setFlights(f);
      const icaos = f.flatMap((fl) => [fl.dep_place, fl.arr_place].filter(Boolean));
      if (icaos.length) {
        batchPlaceNames(icaos).then(setPlaceNames);
        getAirportCoordinates([...new Set(icaos.map((s) => s.toUpperCase()))]).then((rows) => {
          const m: Record<string, LatLon> = {};
          for (const r of rows) m[r.icao.toUpperCase()] = { lat: r.lat, lon: r.lon };
          setAirports(m);
        });
      }
      const m: Record<number, Media> = {};
      for (const fl of f) if (fl.photo_uri) m[fl.id] = { uri: fl.photo_uri, isVideo: fl.media_type === 'video' };
      setMedia({ ...m });
      setLoading(false);
      for (const fl of f) {
        if (!fl.photo_uri && fl.photo_local_id) {
          const d = await getAssetDisplay(fl.photo_local_id);
          if (d) setMedia((prev) => ({ ...prev, [fl.id]: d }));
        }
      }
    });
  }, []);

  useEffect(() => {
    for (const [id, mm] of Object.entries(media)) {
      const fid = Number(id);
      if (mm.isVideo && !thumbnails[fid]) {
        VideoThumbnails.getThumbnailAsync(mm.uri, { time: 0 }).then(({ uri }) => setThumbnails((p) => ({ ...p, [fid]: uri }))).catch(() => {});
      }
    }
  }, [media]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumbFor = (f: Flight): string | undefined => {
    const mm = media[f.id]; if (!mm) return undefined;
    return mm.isVideo ? thumbnails[f.id] : mm.uri;
  };
  const isVideoFor = (f: Flight) => media[f.id]?.isVideo || f.media_type === 'video';
  const markerPos = (f: Flight): { latitude: number; longitude: number } | null => {
    const loc = media[f.id]?.location;
    if (loc) return { latitude: loc.latitude, longitude: loc.longitude };
    const dep = airports[f.dep_place?.toUpperCase()], arr = airports[f.arr_place?.toUpperCase()];
    if (dep && arr) return { latitude: (dep.lat + arr.lat) / 2, longitude: (dep.lon + arr.lon) / 2 };
    if (dep) return { latitude: dep.lat, longitude: dep.lon };
    if (arr) return { latitude: arr.lat, longitude: arr.lon };
    return null;
  };

  const groups = useMemo(() => {
    const sorted = [...flights].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const byY = new Map<number, Map<number, Flight[]>>();
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

  const mapMarkers = useMemo(() => flights.map((f) => ({ f, pos: markerPos(f) })).filter((x) => !!x.pos) as { f: Flight; pos: { latitude: number; longitude: number } }[], [flights, media, airports]);
  const mapRegion = useMemo(() => fitRegion(mapMarkers.map((x) => x.pos)), [mapMarkers]);
  const clusters = useMemo(() => clusterMarkers(mapMarkers, region ?? mapRegion), [mapMarkers, region, mapRegion]);

  // Välj media på kartan → centrera på mediet, zooma så dep/arr ryms (mediet hamnar i mitten).
  const selectPin = (f: Flight) => {
    setPin(f);
    const pos = markerPos(f); if (!pos) return;
    const dep = airports[f.dep_place?.toUpperCase()], arr = airports[f.arr_place?.toUpperCase()];
    let d = 0.6;
    for (const a of [dep, arr]) if (a) d = Math.max(d, Math.abs(pos.latitude - a.lat) * 2.6, Math.abs(pos.longitude - a.lon) * 2.6);
    mapRef.current?.animateToRegion({ latitude: pos.latitude, longitude: pos.longitude, latitudeDelta: d + 0.3, longitudeDelta: d + 0.3 }, 500);
  };

  // Förankra det förstorade mediet till dess geografiska punkt (följer med vid zoom/pan).
  const updateOverlay = async () => {
    if (!pin || !mapRef.current) return;
    const pos = markerPos(pin); if (!pos) return;
    try { setOverlayPt(await mapRef.current.pointForCoordinate(pos)); } catch {}
  };
  useEffect(() => { if (pin) updateOverlay(); else setOverlayPt(null); }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps
  const openTile = useCallback((f: Flight) => { if (shareMode) setShareFlight(f); else setSelected(f); }, [shareMode]);

  // Tryck på ett kluster → zooma in mot dess centrum (delar upp det).
  const zoomToCluster = (c: { lat: number; lon: number }) => {
    const r = region ?? mapRegion;
    mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lon, latitudeDelta: Math.max(r.latitudeDelta / 2.6, 0.008), longitudeDelta: Math.max(r.longitudeDelta / 2.6, 0.008) }, 350);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (flights.length === 0) return (
    <View style={styles.center}><Ionicons name="images-outline" size={48} color={Colors.textMuted} /><Text style={styles.emptyText}>{t('no_photos')}</Text></View>
  );

  const dep = pin ? airports[pin.dep_place?.toUpperCase()] : null;
  const arr = pin ? airports[pin.arr_place?.toUpperCase()] : null;
  const pinPos = pin ? markerPos(pin) : null;
  const pinMedia = pin ? media[pin.id] : null;
  const pinVid = pin ? isVideoFor(pin) : false;

  return (
    <View style={styles.container}>
      {/* Share-läge: liten instruktion högst upp */}
      {shareMode && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '44' }}>
          <Ionicons name="share-outline" size={15} color={Colors.primary} />
          <Text style={{ flex: 1, color: Colors.primary, fontSize: 12.5, fontWeight: '700' }}>Pick a photo to share</Text>
        </View>
      )}

      {/* Grid / Map-växlare — döljs i share-läge (då visas bara rutnätet) */}
      {!shareMode && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 }}>
          {(['grid', 'map'] as const).map((v) => (
            <TouchableOpacity key={v} onPress={() => { setView(v); setPin(null); }} activeOpacity={0.8}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: view === v ? Colors.primary : Colors.border, backgroundColor: view === v ? Colors.primary + '18' : Colors.surface }}>
              <Ionicons name={v === 'grid' ? 'grid' : 'map'} size={15} color={view === v ? Colors.primary : Colors.textSecondary} />
              <Text style={{ color: view === v ? Colors.primary : Colors.textSecondary, fontSize: 13, fontWeight: '700' }}>{v === 'grid' ? 'Grid' : 'Map'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {(shareMode || view === 'grid') ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {groups.map((yg) => (
            <View key={yg.year}>
              <Text style={styles.yearHeader}>{yg.year}</Text>
              {yg.months.map((mg) => (
                <View key={mg.month} style={{ marginBottom: 4 }}>
                  <Text style={styles.monthHeader}>{MONTHS[mg.month - 1]}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GAP }}>
                    {mg.flights.map((f) => <AlbumTile key={f.id} f={f} thumb={thumbFor(f)} isVideo={isVideoFor(f)} onOpen={openTile} />)}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={mapRegion} mapType={mapType} userInterfaceStyle="dark" showsPointsOfInterest={false} showsCompass={false} toolbarEnabled={false}
            rotateEnabled={mapType !== 'standard'} pitchEnabled={mapType !== 'standard'} onRegionChange={() => { if (pin) updateOverlay(); }} onRegionChangeComplete={setRegion}>
            {/* Media grupperade i kluster — döljs när en är vald */}
            {!pin && clusters.map((c) => c.items.length === 1
              ? <PhotoMarker key={c.key} coordinate={c.items[0].pos} thumb={thumbFor(c.items[0].f)} isVideo={isVideoFor(c.items[0].f)} onPress={() => selectPin(c.items[0].f)} />
              : <ClusterMarker key={c.key} coordinate={{ latitude: c.lat, longitude: c.lon }} count={c.items.length} onPress={() => zoomToCluster(c)} />
            )}
            {/* Sträck + flygplats-pins för vald media */}
            {pin && pinPos && dep && <Polyline coordinates={[pinPos, { latitude: dep.lat, longitude: dep.lon }]} strokeColor={Colors.primary} strokeWidth={2.5} />}
            {pin && pinPos && arr && <Polyline coordinates={[pinPos, { latitude: arr.lat, longitude: arr.lon }]} strokeColor={Colors.gold} strokeWidth={2.5} />}
            {pin && dep && <Marker coordinate={{ latitude: dep.lat, longitude: dep.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}><View style={styles.aptPin}><Text style={styles.aptTxt}>{pin.dep_place}</Text></View></Marker>}
            {pin && arr && <Marker coordinate={{ latitude: arr.lat, longitude: arr.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}><View style={[styles.aptPin, { borderColor: Colors.gold }]}><Text style={[styles.aptTxt, { color: Colors.gold }]}>{pin.arr_place}</Text></View></Marker>}
          </MapView>

          {/* Lager-växlare: karta → satellit → hybrid */}
          <TouchableOpacity onPress={() => setMapType((m) => m === 'standard' ? 'satellite' : m === 'satellite' ? 'hybrid' : 'standard')} activeOpacity={0.85}
            style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(6,11,22,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }}>
            <Ionicons name="layers" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{mapType === 'standard' ? 'Map' : mapType === 'satellite' ? 'Satellite' : 'Hybrid'}</Text>
          </TouchableOpacity>

          {/* Förstorat media förankrat till mediets geografiska punkt (följer med vid zoom/pan) */}
          {pin && pinMedia && overlayPt && (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setSelected(pin)}
              style={{ position: 'absolute', left: overlayPt.x - BIG / 2, top: overlayPt.y - BIG / 2, width: BIG, height: BIG, borderRadius: 14, borderWidth: 3, borderColor: '#fff', overflow: 'hidden', backgroundColor: '#000' }}>
              {pinVid ? <FlightVideo uri={pinMedia.uri} style={{ width: BIG, height: BIG }} contentFit="cover" loop muted autoPlay />
                : <Image source={{ uri: pinMedia.uri }} style={{ width: BIG, height: BIG }} resizeMode="cover" />}
              {pinVid && <View style={{ position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: 3 }}><Ionicons name="play" size={12} color="#fff" /></View>}
            </TouchableOpacity>
          )}

          {/* Översiktsruta i botten (som loggbokens rad) — tryck → flight detail, X → avmarkera */}
          {pin && (
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 14, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingLeft: 14, paddingRight: 8 }}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => { if (shareMode) setShareFlight(pin); else router.push(`/flight/detail/${pin.id}`); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={{ fontFamily: 'Menlo', fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}>{pin.dep_place} → {pin.arr_place}</Text>
                    {pin.ifr > 0 ? <Text style={styles.badge}>IFR</Text> : null}
                    {pin.night > 0 ? <Ionicons name="moon" size={11} color={Colors.info} /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: 'Menlo', fontSize: 10.5, color: Colors.textMuted, marginTop: 3 }}>{formatDate(pin.date)} · {pin.aircraft_type}{pin.registration ? ` ${pin.registration}` : ''} · {formatTime(pin.total_time)}h</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPin(null)} hitSlop={10} style={{ paddingLeft: 8, paddingVertical: 14 }}>
                <Ionicons name="close" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Fullskärm */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {selected && (() => {
            const mm = media[selected.id];
            if (!mm) return <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
            return (mm.isVideo || selected.media_type === 'video')
              ? <FlightVideo uri={mm.uri} style={{ width, height }} contentFit="contain" loop autoPlay nativeControls />
              : <Image source={{ uri: mm.uri }} style={{ width, height }} resizeMode="contain" />;
          })()}
          <View style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setSelected(null)} hitSlop={12}><Ionicons name="close" size={26} color="#fff" /></TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{selected ? `${placeNames[selected.dep_place?.toUpperCase()] ?? selected.dep_place} → ${placeNames[selected.arr_place?.toUpperCase()] ?? selected.arr_place}` : ''}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{selected ? `${formatDate(selected.date)} · ${formatTime(selected.total_time)}h` : ''}</Text>
            </View>
            <View style={{ width: 26 }} />
          </View>
        </View>
      </Modal>

      {/* Delningsfönster (performance/route/postcard) — öppnas i share-läge */}
      {shareFlight && (
        <FlightShareCard
          flight={shareFlight}
          depName={placeNames[shareFlight.dep_place?.toUpperCase()] ?? shareFlight.dep_place}
          arrName={placeNames[shareFlight.arr_place?.toUpperCase()] ?? shareFlight.arr_place}
          visible={!!shareFlight}
          onClose={() => setShareFlight(null)}
          formatTime={formatTime}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: Colors.textMuted, fontSize: 13 },
  yearHeader: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 2 },
  monthHeader: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 },
  tile: { width: TILE, height: TILE, borderRadius: 4, overflow: 'hidden', backgroundColor: Colors.elevated },
  image: { width: '100%', height: '100%' },
  aptPin: { backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary, paddingHorizontal: 7, paddingVertical: 3 },
  aptTxt: { color: Colors.primary, fontSize: 11, fontWeight: '800', fontFamily: 'Menlo' },
  badge: { fontFamily: 'Menlo', fontSize: 8.5, fontWeight: '700', color: Colors.primary, borderWidth: 1, borderColor: Colors.primary + '55', backgroundColor: Colors.primary + '1F', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
});
