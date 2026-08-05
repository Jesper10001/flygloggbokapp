import { useRef, useState, useEffect, type ReactNode } from 'react';
import {
  View, Text, Image, StyleSheet, Dimensions, TouchableOpacity,
  Modal, ActivityIndicator, Animated, PanResponder, TextInput,
  Keyboard, InputAccessoryView, Platform, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { FlightVideo } from './FlightVideo';
import Svg, { Line, Circle, Path, Polyline } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { getAirportCoordinates } from '../db/icao';
import { getAircraftCruiseSpeed, getFlightNumberOfYear, getAllAircraftTypes } from '../db/flights';
import type { Flight } from '../types/flight';

let runwayData: Record<string, number[]> = {};
try { runwayData = require('../assets/runways.json'); } catch {}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const SHADOW = {} as const;

// ── Floating share-card tokens (Strava-stil overlay) ──
const GOLD = '#FFB830';
const SILVER = '#C9CFD9';
const SERIF = 'Fraunces';
const SERIF_IT = 'Fraunces-Italic';
const MONO = 'JetBrainsMono';
// Läsbarhetsskugga på varje flytande textnod (ingen panel bakom).
const FSH = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 } as const;
const LOCKUP = require('../assets/blades-lockup.png'); // tätt beskuren ljus lockup (1388×374)
const LOCKUP_AR = 1388 / 374;
const LOGO_MARK = require('../assets/logo-goldfloating.PNG'); // guld "B"-mark (1024×1536)
const LOGO_MARK_CYAN = require('../assets/logo-cyanfloating.PNG'); // cyan "B"-mark (1024×1536)
const LOGO_MARK_AR = 1024 / 1536;

// ── Kontroll-tokens (enhetlig filterdel under kortet) ──
const CTRL_ACCENT = '#2563EB';
const CTRL_TRACK = 'rgba(255,255,255,0.06)';
const CTRL_BORDER = 'rgba(255,255,255,0.12)';
const CTRL_LABEL = 'rgba(255,255,255,0.5)';

// Enhetlig segmenterad väljare (lika breda segment, samma typografi överallt).
function Seg<T extends string>({ options, value, onChange }: {
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={ctrl.seg}>
      {options.map(([key, label], i) => {
        const active = value === key;
        return (
          <TouchableOpacity
            key={key}
            activeOpacity={0.8}
            onPress={() => onChange(key)}
            style={[ctrl.segItem, i > 0 && ctrl.segDivider, active && ctrl.segItemActive]}
          >
            <Text numberOfLines={1} style={[ctrl.segText, active && ctrl.segTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Etiketterad rad: liten versal etikett till vänster + kontroll till höger.
function CtrlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={ctrl.row}>
      <Text style={ctrl.rowLabel}>{label}</Text>
      <View style={ctrl.rowBody}>{children}</View>
    </View>
  );
}

// Performance-lager: centrerad Strava-stat (liten etikett över ett stort fetstilt värde).
function PerfStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[{ fontWeight: '700', fontSize: 16, color: '#fff', letterSpacing: 0.2 }, FSH]}>{label}</Text>
      <Text style={[{ fontWeight: '800', fontSize: 40, color: '#fff', letterSpacing: -1, lineHeight: 46 }, FSH]}>{value}</Text>
    </View>
  );
}

// "Klar"-bar ovanför siffertangentbordet (number-pad saknar return) — annars fastnar man.
// Varje sifferfält får ett eget id; delat id gör accessoryn opålitlig på iOS.
function KeyboardDoneBar({ id }: { id: string }) {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={id}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: '#1A2235', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.15)' }}>
        <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Text style={{ color: '#FFB830', fontSize: 15, fontWeight: '700' }}>Done</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

// Storcirkelavstånd (NM) mellan två lat/lon — för "faktiskt avstånd".
function greatCircleNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3440.065; // jordens radie i NM
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

// Stads-snapshot via dold Leaflet-WebView (OSM/CARTO/Esri) → leaflet-image ritar kartan
// till en canvas och postar tillbaka en PNG. Slipper Apple-branding; Ljus/Mörk/Satellit (hybrid).
// Centreras över STADEN (geokodas från namnet via Nominatim) — faller tillbaka på flygplatsen.
type MapStyle = 'light' | 'dark' | 'satellite';
const cityFromName = (name?: string) => (name ?? '').split(/[\/,]|\s/).filter(Boolean)[0] ?? '';

// Route-stopp ur remarks (samma rad-format som log flight: "ICAO TnG/LA/PU/DO/HR ...").
const STOP_RE_SHARE = /^([A-Z]{2,4})\s+(TnG|LA|PU\/DO|PU|DO|HR)(?:\s+\S+\s+app\s+rwy\s+\d{2,3})?\s*$/i;
function parseStopIcaos(remarks: string): string[] {
  const out: string[] = [];
  for (const line of (remarks || '').split('\n')) {
    const m = line.trim().match(STOP_RE_SHARE);
    if (m) out.push(m[1].toUpperCase());
  }
  return out;
}
function buildCitySnapHtml(lat: number, lon: number, city: string, style: MapStyle, zoom: number): string {
  const layersJs =
    style === 'satellite'
      ? `var base=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,crossOrigin:true}).addTo(map);`
      : `var base=L.tileLayer('${style === 'dark' ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png' : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'}',{subdomains:'abcd',maxZoom:19,crossOrigin:true}).addTo(map);`;
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>*{margin:0;padding:0}html,body,#map{width:220px;height:220px;background:#0a1422}</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet-image@0.4.0/leaflet-image.js"></script>
<script>
  var ZOOM=${Math.round(zoom)}, A=[${lat},${lon}], Q=${JSON.stringify(city || '')};
  var map=L.map('map',{zoomControl:false,attributionControl:false,fadeAnimation:false,zoomAnimation:false});
  ${layersJs}
  var fired=false;
  function shoot(){ if(fired)return; fired=true;
    try {
      leafletImage(map,function(err,canvas){
        if(err||!canvas){ window.ReactNativeWebView.postMessage('ERR'); return; }
        try { window.ReactNativeWebView.postMessage(canvas.toDataURL('image/png')); }
        catch(e){ window.ReactNativeWebView.postMessage('ERR'); }
      });
    } catch(e){ window.ReactNativeWebView.postMessage('ERR'); }
  }
  function dist(a,b){var R=6371,dLat=(b[0]-a[0])*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180,la1=a[0]*Math.PI/180,la2=b[0]*Math.PI/180;var h=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)*Math.sin(dLon/2);return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
  function finish(c){ map.setView(c, ZOOM); base.on('load', function(){ setTimeout(shoot,300); }); setTimeout(shoot,3500); }
  if(Q){
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(Q))
      .then(function(r){return r.json();})
      .then(function(d){ if(d&&d[0]){ var c=[parseFloat(d[0].lat),parseFloat(d[0].lon)]; if(dist(c,A)<120){ finish(c); return; } } finish(A); })
      .catch(function(){ finish(A); });
  } else { finish(A); }
</script></body></html>`;
}

interface Props {
  flight: Flight;
  depName: string;
  arrName: string;
  visible: boolean;
  onClose: () => void;
  formatTime: (n: number) => string;
}

export function FlightShareCard({ flight, depName, arrName, visible, onClose, formatTime }: Props) {
  const insets = useSafeAreaInsets();
  const viewShotRef = useRef<ViewShot>(null);
  const [sharing, setSharing] = useState(false);
  const [depCoord, setDepCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [arrCoord, setArrCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [distanceNm, setDistanceNm] = useState(0);
  const [flightNum, setFlightNum] = useState(0);
  const [isHeli, setIsHeli] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  // Route ground-layer: Apple Maps-snapshots av avgångs-/ankomststaden.
  const [depSnap, setDepSnap] = useState<string | null>(null);
  const [arrSnap, setArrSnap] = useState<string | null>(null);
  const [depCity, setDepCity] = useState('');
  const [arrCity, setArrCity] = useState('');
  const [mapStyle, setMapStyle] = useState<MapStyle>('light');
  const [mapZoom, setMapZoom] = useState(10);
  // Postcard: redigerbar text före dep och mellan dep/arr (ICAO-koderna är fasta).
  const [pcPrefix, setPcPrefix] = useState('From');
  const [pcConnector, setPcConnector] = useState('to');

  // Overlay pan + slider scale
  const panRef = useRef({ x: 0, y: 0 });
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [overlayScale, setOverlayScale] = useState(0.8);
  const [mode, setMode] = useState<'performance' | 'route' | 'postcard'>('performance');
  const [layerTheme, setLayerTheme] = useState<'light' | 'dark'>('light');
  // Manuell max alt (ft). Avstånd är alltid faktiskt (great-circle).
  const [maxAltFt, setMaxAltFt] = useState('');
  // Taxi-tid (min) som dras av från flygtiden → avg speed blir hastighet i luften.
  const [taxiMin, setTaxiMin] = useState('');
  // Performance-lager: enhetssystem (metric = km/m, imperial = mi/ft).
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric');
  const isFloating = mode === 'performance' || mode === 'route';
  const font = 'Georgia';
  const LT = {
    text: layerTheme === 'light' ? '#FFFFFF' : '#0A1628',
    muted: layerTheme === 'light' ? 'rgba(255,255,255,0.6)' : 'rgba(10,22,40,0.55)',
    dot: layerTheme === 'light' ? 'rgba(255,255,255,0.6)' : 'rgba(10,22,40,0.5)',
    line: layerTheme === 'light' ? 'rgba(255,255,255,0.4)' : 'rgba(10,22,40,0.35)',
    shadow: layerTheme === 'light'
      ? { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }
      : { textShadowColor: 'rgba(255,255,255,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  } as const;

  // Instagram-format: 'post' = 4:5 (1080×1350), 'story' = 9:16 (1080×1920).
  const [format, setFormat] = useState<'post' | 'story'>('post');
  const cardAspect = format === 'story' ? 9 / 16 : 4 / 5; // bredd/höjd
  const maxCardH = SCREEN_H * 0.6;
  const cardW = Math.min(SCREEN_W, maxCardH * cardAspect);
  const cardH = cardW / cardAspect;
  const exportW = 1080;
  const exportH = format === 'story' ? 1920 : 1350;

  const applyModeDefaults = (m: string) => {
    const defaults: Record<string, { x: number; y: number; s: number }> = {
      performance: { x: 0, y: 0, s: 1 },
      route:    { x: 0, y: 0, s: 1 },
      postcard: { x: -cardW * 0.15, y: -cardH * 0.15, s: 0.8 },
    };
    const d = defaults[m] ?? { x: 0, y: 0, s: 1 };
    panRef.current = { x: d.x, y: d.y };
    pan.setValue({ x: d.x, y: d.y });
    setOverlayScale(d.s);
  };

  useEffect(() => {
    if (visible) applyModeDefaults(mode);
  }, [visible]);

  // Förifyll max alt (ft) från max_fl och nollställ avstånds-läget när kortet öppnas.
  useEffect(() => {
    if (!visible) return;
    setMaxAltFt((flight.max_fl ?? 0) > 0 ? String(flight.max_fl * 100) : '');
    setTaxiMin('');
  }, [visible, flight.id, flight.max_fl]);

  // Nollställ kart-snapshots när flygplatserna eller kartstilen ändras → fångas om.
  useEffect(() => {
    setDepSnap(null);
    setArrSnap(null);
  }, [depCoord?.lat, depCoord?.lon, arrCoord?.lat, arrCoord?.lon, mapStyle, mapZoom]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3,
      onPanResponderGrant: () => {
        pan.setOffset(panRef.current);
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        panRef.current = { x: (pan as any).__getValue().x, y: (pan as any).__getValue().y };
      },
    })
  ).current;

  useEffect(() => {
    if (!visible) return;

    // Generera thumbnail för video och starta uppspelning
    if (flight.media_type === 'video' && flight.photo_uri) {
      (async () => {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(flight.photo_uri, { time: 0 });
          setThumbnailUri(uri);
        } catch (err) {
          console.warn('Failed to generate video thumbnail:', err);
        }
      })();
    } else {
      setThumbnailUri(null);
    }

    const codes = [flight.dep_place, flight.arr_place].filter(Boolean);
    if (codes.length) {
      getAirportCoordinates(codes).then(coords => {
        const d = coords.find(c => c.icao === flight.dep_place);
        const a = coords.find(c => c.icao === flight.arr_place);
        if (d) { setDepCoord({ lat: d.lat, lon: d.lon }); setDepCity(cityFromName(d.name)); }
        if (a) { setArrCoord({ lat: a.lat, lon: a.lon }); setArrCity(cityFromName(a.name)); }
      });
    }
    if (flight.aircraft_type && flight.total_time > 0) {
      getAircraftCruiseSpeed(flight.aircraft_type).then(kts => {
        if (kts > 0) setDistanceNm(Math.round(kts * flight.total_time));
      });
    }
    getFlightNumberOfYear(flight.id, flight.date).then(setFlightNum);
    if (flight.aircraft_type) {
      getAllAircraftTypes().then(types => {
        const entry = types.find(t => t.aircraft_type === flight.aircraft_type);
        if (entry?.category === 'helicopter') setIsHeli(true);
      });
    }
  }, [visible, flight.id, flight.date, flight.dep_place, flight.arr_place, flight.aircraft_type, flight.total_time, flight.media_type, flight.photo_uri]);

  // (Videouppspelning sköts av FlightVideo: autoPlay + loop när den monteras med modalen.)

  const handleShare = async () => {
    setSharing(true);
    try {
      // För video: dela videon direkt
      if (f.media_type === 'video' && f.photo_uri) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(f.photo_uri, { mimeType: 'video/mp4', dialogTitle: 'Share flight' });
        }
      } else {
        // För bild: fånga via ViewShot och dela som PNG
        if (!viewShotRef.current?.capture) return;
        const uri = await viewShotRef.current.capture();
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share flight' });
        }
      }
    } catch (e) {
      console.warn('Share failed', e);
    } finally {
      setSharing(false);
    }
  };

  const f = flight;
  const dateStr = f.date.replace(/-/g, '.');

  // ── Floating-stats: distance (uppskattad eller faktiskt great-circle), avg speed
  //    (= distance ÷ flygtid), max alt (manuell ft eller max_fl×100). ──
  const actualDistanceNm = depCoord && arrCoord ? greatCircleNm(depCoord, arrCoord) : 0;
  // Alltid faktiskt avstånd; faller tillbaka på uppskattning bara om koordinater saknas.
  const distance = actualDistanceNm > 0 ? actualDistanceNm : distanceNm;
  // Avg speed = avstånd ÷ tid i luften (flygtid minus taxi-tid på marken).
  const taxiHrs = (parseInt(taxiMin.replace(/\D/g, ''), 10) || 0) / 60;
  const airborneTime = Math.max(0, f.total_time - taxiHrs);
  const avgSpeedKt = airborneTime > 0 && distance > 0 ? Math.round(distance / airborneTime) : 0;
  const maxAltManual = parseInt(maxAltFt.replace(/\D/g, ''), 10);
  const maxAltVal = maxAltManual > 0 ? maxAltManual : ((f.max_fl ?? 0) > 0 ? f.max_fl * 100 : 0);

  // ── Performance-lager: distans/pace/elev i metric (km, m:ss/km, m) eller imperial (mi, m:ss/mile, ft).
  //    Pace = tid i luften ÷ distans (taxi avdraget); elev gained = max alt omräknad. ──
  const perfDistVal = units === 'metric' ? distance * 1.852 : distance * 1.150779; // NM → km / statute miles
  const perfDistUnit = units === 'metric' ? 'km' : 'mi';
  const perfElevVal = units === 'metric' ? Math.round(maxAltVal * 0.3048) : maxAltVal; // ft → m / ft
  const perfElevUnit = units === 'metric' ? 'm' : 'ft';
  const perfPaceSec = perfDistVal > 0 && airborneTime > 0 ? Math.round((airborneTime * 3600) / perfDistVal) : 0;
  const perfPaceStr = `${Math.floor(perfPaceSec / 60)}:${String(perfPaceSec % 60).padStart(2, '0')}`;
  const perfPaceUnit = units === 'metric' ? '/km' : '/mile';

  const floatDate = (() => {
    const parts = f.date.split('-');
    if (parts.length !== 3) return dateStr;
    const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][parseInt(parts[1], 10) - 1] ?? parts[1];
    return `${parseInt(parts[2], 10)} ${mon} ${parts[0]}`;
  })();
  const fmtNum = (n: number) => n.toLocaleString('en-US');

  // Snapshot-hörn efter platsernas inbördes orientering → diagonalt motsatta hörn.
  // Ex: dep nordväst om arr → dep uppe-vänster, arr nere-höger.
  const corners = (() => {
    if (!depCoord || !arrCoord) return { dep: 'tr', arr: 'bl' };
    const depTop = depCoord.lat >= arrCoord.lat;
    const depLeft = depCoord.lon <= arrCoord.lon;
    const c = (top: boolean, left: boolean) => (top ? 't' : 'b') + (left ? 'l' : 'r');
    return { dep: c(depTop, depLeft), arr: c(!depTop, !depLeft) };
  })();
  // Krockar en tile med loggan i övre vänstra hörnet → flytta loggan till övre höger.
  const brandRight = corners.dep === 'tl' || corners.arr === 'tl';
  const timeOfDay = (() => {
    const utcH = parseInt(f.dep_utc?.split(':')[0] ?? '', 10);
    if (isNaN(utcH)) return '';
    const utcOffset = depCoord ? Math.round(depCoord.lon / 15) : 0;
    const localH = ((utcH + utcOffset) % 24 + 24) % 24;
    if (localH >= 5 && localH < 8) return 'Dawn flight';
    if (localH >= 8 && localH < 12) return 'Morning flight';
    if (localH >= 12 && localH < 17) return 'Afternoon flight';
    if (localH >= 17 && localH < 20) return 'Evening flight';
    return 'Night flight';
  })();
  const hasRoute = depCoord && arrCoord && (depCoord.lat !== arrCoord.lat || depCoord.lon !== arrCoord.lon);
  const routeSvg = hasRoute ? buildRouteSvg(depCoord!, arrCoord!, depName, arrName) : null;

  // För video: visa och dela bara videon, ingen ViewShot/lager
  if (f.media_type === 'video' && f.photo_uri) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {visible && <FlightVideo uri={f.photo_uri} style={{ flex: 1 }} contentFit="cover" loop muted autoPlay nativeControls />}
          <View style={{ position: 'absolute', top: insets.top + 12, right: 16, gap: 12, zIndex: 10 }}>
            <TouchableOpacity
              onPress={handleShare}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
              disabled={sharing}
            >
              {sharing ? <ActivityIndicator color="#fff" /> : <Ionicons name="share-outline" size={20} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // För bild: använd ViewShot med lager
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000', position: 'relative' }}>
        {/* Dolda Leaflet-WebViews för route-snapshots (OSM/CARTO/Esri) — fångas en gång */}
        {mode === 'route' && depCoord && !depSnap && (
          <View style={{ position: 'absolute', width: 220, height: 220, opacity: 0, top: 0, left: 0 }} pointerEvents="none">
            <WebView
              source={{ html: buildCitySnapHtml(depCoord.lat, depCoord.lon, depCity, mapStyle, mapZoom), baseUrl: 'https://basemaps.cartocdn.com' }}
              originWhitelist={['*']} javaScriptEnabled domStorageEnabled
              style={{ flex: 1, backgroundColor: 'transparent' }}
              onMessage={(e) => { const d = e.nativeEvent.data; if (d && d.startsWith('data:')) setDepSnap(d); }}
            />
          </View>
        )}
        {mode === 'route' && arrCoord && !arrSnap && (
          <View style={{ position: 'absolute', width: 220, height: 220, opacity: 0, top: 0, left: 0 }} pointerEvents="none">
            <WebView
              source={{ html: buildCitySnapHtml(arrCoord.lat, arrCoord.lon, arrCity, mapStyle, mapZoom), baseUrl: 'https://basemaps.cartocdn.com' }}
              originWhitelist={['*']} javaScriptEnabled domStorageEnabled
              style={{ flex: 1, backgroundColor: 'transparent' }}
              onMessage={(e) => { const d = e.nativeEvent.data; if (d && d.startsWith('data:')) setArrSnap(d); }}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          {/* Kortet — fast storlek/position oavsett valt lager */}
          <View style={{ alignItems: 'center', paddingTop: insets.top + 6 }}>
          <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1, width: exportW, height: exportH }}>
            <View style={[styles.card, { width: cardW, height: cardH }]}>
              {/* Static photo/video background - använd thumbnail för video */}
              {f.photo_uri ? (
                <Image
                  source={{ uri: f.media_type === 'video' ? (thumbnailUri || f.photo_uri) : f.photo_uri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0f1728' }]} />
              )}

              {/* Route-lager (fasta snapshots/stats, ingen drag) */}
              {mode === 'route' && (
                <FloatingLayer
                  anchor="route"
                  dep={f.dep_place}
                  arr={f.arr_place}
                  date={floatDate}
                  distance={distance}
                  maxAlt={maxAltVal}
                  avgSpeed={avgSpeedKt}
                  total={formatTime(f.total_time)}
                  type={f.aircraft_type}
                  fmtNum={fmtNum}
                  depSnap={depSnap}
                  arrSnap={arrSnap}
                  tileScale={overlayScale}
                  corners={corners}
                  brandRight={brandRight}
                  mapCredit={mapStyle === 'satellite' ? '© Esri' : '© OpenStreetMap · CARTO'}
                  cardW={cardW}
                  cardH={cardH}
                />
              )}

              {/* Postcard — bara titelblocket är dragbart */}
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: overlayScale }] },
                ]}
                {...panResponder.panHandlers}
              >
                {/* Performance — centrerade stats + cyan B-mark, dragbar + storleksändras med slidern */}
                {mode === 'performance' && (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
                    <PerfStat label="Distance" value={`${fmtNum(Math.round(perfDistVal))} ${perfDistUnit}`} />
                    <PerfStat label="Pace" value={`${perfPaceStr} ${perfPaceUnit}`} />
                    <PerfStat label="Elev gained" value={`${fmtNum(perfElevVal)} ${perfElevUnit}`} />
                  </View>
                )}
                {/* Postcard — only the title block is draggable. Texten före/mellan ICAO redigeras nedan. */}
                {mode === 'postcard' && (
                  <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                    {!!pcPrefix && (
                      <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '500', fontSize: 36, color: LT.text, letterSpacing: -0.6 }, LT.shadow]}>
                        {pcPrefix}
                      </Text>
                    )}
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 52, color: LT.text, letterSpacing: -1 }, LT.shadow]}>
                      {depName}
                    </Text>
                    <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '500', fontSize: 36, color: LT.text, letterSpacing: -0.6, marginTop: 6 }, LT.shadow]}>
                      {pcConnector} {arrName}
                    </Text>
                  </View>
                )}
              </Animated.View>

              {/* Performance — fast "logged in BLADES Pilot Logbook" nere till höger (skalas/dras ej).
                  Samma struktur/format som de andra lagren (postcard). */}
              {mode === 'performance' && (
                <View style={{ position: 'absolute', right: 14, bottom: 12, alignItems: 'flex-end' }} pointerEvents="none">
                  <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 9, color: '#fff', marginBottom: 1 }, FSH]}>logged in</Text>
                  <Text style={[{ fontFamily: 'Georgia', fontWeight: '700', fontSize: 10, letterSpacing: 2.4, color: GOLD }, FSH]}>BLADES</Text>
                  <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 7, letterSpacing: 1.4, color: SILVER, marginTop: 1 }, FSH]}>Pilot Logbook</Text>
                </View>
              )}

              {/* Postcard fixed elements — outside draggable area */}
              {mode === 'postcard' && (<>
                <View style={{ position: 'absolute', left: -(cardH * 0.25) + 14, top: cardH / 2 - 7, width: cardH * 0.5, transform: [{ rotate: '-90deg' }] }} pointerEvents="none">
                  <Text style={{ fontFamily: 'Menlo', fontSize: 9, color: '#FFB830', letterSpacing: 1.8, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>
                    No. {flightNum} · {dateStr} · {timeOfDay.toLowerCase()}
                  </Text>
                </View>
                <View style={{ position: 'absolute', left: 14, right: 14, bottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }} pointerEvents="none">
                  <View>
                    <Text style={[{ fontFamily: 'Menlo', fontSize: 7, color: '#FFB830', letterSpacing: 1, marginBottom: 2 }, LT.shadow]}>FLIGHT TIME</Text>
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 14, color: LT.text, letterSpacing: -0.2 }, LT.shadow]}>
                      {formatTime(f.total_time)}h · {f.aircraft_type}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 9, color: LT.text, marginBottom: 1 }, LT.shadow]}>logged in</Text>
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '700', fontSize: 10, letterSpacing: 2.4, color: '#FFB830' }, LT.shadow]}>BLADES</Text>
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 7, letterSpacing: 1.4, color: SILVER, marginTop: 1 }, LT.shadow]}>Pilot Logbook</Text>
                  </View>
                </View>
              </>)}
            </View>
          </ViewShot>
          </View>

          {/* Kontroller — scrollbara så kortet aldrig ändrar storlek */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Lager — primär väljare, full bredd */}
          <View style={{ flexDirection: 'row', alignSelf: 'stretch', marginHorizontal: 16, marginTop: 4 }}>
            <Seg
              options={[['performance', 'Performance'], ['route', 'Route'], ['postcard', 'Postcard']] as const}
              value={mode}
              onChange={(m) => { setMode(m); applyModeDefaults(m); if (m === 'route') { setMapStyle('satellite'); setMapZoom(13); } }}
            />
          </View>

          {/* Inställningspanel — grupperade kontroller med enhetliga rader */}
          <View style={ctrl.panel}>
            <CtrlRow label="FORMAT">
              <Seg
                options={[['post', '4:5'], ['story', '9:16']] as const}
                value={format}
                onChange={setFormat}
              />
            </CtrlRow>

            <CtrlRow label="SIZE">
              <Slider
                style={{ flex: 1, height: 30 }}
                minimumValue={0.4}
                maximumValue={2}
                value={overlayScale}
                onValueChange={setOverlayScale}
                minimumTrackTintColor={CTRL_ACCENT}
                maximumTrackTintColor="rgba(255,255,255,0.15)"
                thumbTintColor="#fff"
              />
              <Text style={ctrl.rowValue}>{overlayScale.toFixed(1)}×</Text>
            </CtrlRow>

            {mode === 'performance' && (
              <CtrlRow label="UNITS">
                <Seg
                  options={[['metric', 'Metric'], ['imperial', 'Imperial']] as const}
                  value={units}
                  onChange={setUnits}
                />
              </CtrlRow>
            )}

            {mode === 'route' && (
              <CtrlRow label="ZOOM">
                <Slider
                  style={{ flex: 1, height: 30 }}
                  minimumValue={8}
                  maximumValue={13}
                  step={1}
                  value={mapZoom}
                  onValueChange={(v) => setMapZoom(Math.round(v))}
                  minimumTrackTintColor={CTRL_ACCENT}
                  maximumTrackTintColor="rgba(255,255,255,0.15)"
                  thumbTintColor="#fff"
                />
                <Text style={ctrl.rowValue}>{mapZoom}</Text>
              </CtrlRow>
            )}

            {mode === 'route' && (
              <CtrlRow label="MAP">
                <Seg
                  options={[['light', 'Light'], ['dark', 'Dark'], ['satellite', 'Satellite']] as const}
                  value={mapStyle}
                  onChange={setMapStyle}
                />
              </CtrlRow>
            )}

            {isFloating && (
              <CtrlRow label="MAX ALT">
                <View style={ctrl.inputPill}>
                  <TextInput
                    value={maxAltFt}
                    onChangeText={(v) => setMaxAltFt(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    inputAccessoryViewID="maxAltDone"
                    returnKeyType="done"
                    blurOnSubmit
                    placeholder="—"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: MONO }}
                  />
                  <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', fontFamily: MONO }}>FT</Text>
                </View>
              </CtrlRow>
            )}

            {isFloating && (
              <CtrlRow label="TAXI">
                <View style={ctrl.inputPill}>
                  <TextInput
                    value={taxiMin}
                    onChangeText={(v) => setTaxiMin(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    inputAccessoryViewID="taxiDone"
                    returnKeyType="done"
                    blurOnSubmit
                    placeholder="—"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: MONO }}
                  />
                  <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', fontFamily: MONO }}>MIN</Text>
                </View>
              </CtrlRow>
            )}
          </View>

          {/* Hjälptext */}
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, textAlign: 'center', marginTop: 10 }}>
            {mode === 'route' ? 'The slider resizes the maps' : 'Drag to move · slider resizes'}
          </Text>

          {/* Done-knappar — egen accessory per sifferfält (delat id är opålitligt på iOS). */}
          <KeyboardDoneBar id="maxAltDone" />
          <KeyboardDoneBar id="taxiDone" />

          {/* Postcard: redigera texten före/mellan flygplatserna (ICAO är fasta, max 30 tecken) */}
          {mode === 'postcard' && (
            <View style={ctrl.panel}>
              <Text style={[ctrl.rowLabel, { width: 'auto', textAlign: 'center', marginBottom: 10 }]}>POSTCARD TEXT</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
                <TextInput
                  value={pcPrefix}
                  onChangeText={(v) => setPcPrefix(v.slice(0, 30))}
                  maxLength={30}
                  placeholder="From"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  returnKeyType="done"
                  style={{ minWidth: 54, color: '#fff', fontSize: 14, fontFamily: 'Georgia', fontStyle: 'italic', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#FFB830', paddingVertical: 2, paddingHorizontal: 4 }}
                />
                <Text style={{ color: '#FFB830', fontSize: 15, fontWeight: '700', fontFamily: 'Georgia' }}>{depName}</Text>
                <TextInput
                  value={pcConnector}
                  onChangeText={(v) => setPcConnector(v.slice(0, 30))}
                  maxLength={30}
                  placeholder="to"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  returnKeyType="done"
                  style={{ minWidth: 38, color: '#fff', fontSize: 14, fontFamily: 'Georgia', fontStyle: 'italic', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#FFB830', paddingVertical: 2, paddingHorizontal: 4 }}
                />
                <Text style={{ color: '#FFB830', fontSize: 15, fontWeight: '700', fontFamily: 'Georgia' }}>{arrName}</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, textAlign: 'center', marginTop: 8 }}>Edit the text before and between the airports</Text>
            </View>
          )}
          </ScrollView>
        </View>

        {/* Actions */}
        <View style={{
          paddingBottom: insets.bottom + 16, paddingTop: 12, paddingHorizontal: 20,
          flexDirection: 'row', gap: 12, alignItems: 'center',
        }}>
          <TouchableOpacity
            style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}
            onPress={onClose}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Close</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 2, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#2563EB', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            onPress={handleShare}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Share</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function StatItem({ label, value, large, font = 'Georgia', textColor = '#fff', mutedColor = 'rgba(255,255,255,0.6)', shadow = SHADOW }: { label: string; value: string; large?: boolean; font?: string; textColor?: string; mutedColor?: string; shadow?: any }) {
  return (
    <View style={{ marginRight: 16, marginBottom: 8 }}>
      <Text style={[{ color: mutedColor, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: font }, shadow]}>
        {label}
      </Text>
      <Text style={[{
        color: textColor, fontSize: large ? 28 : 16, fontWeight: '800',
        fontFamily: font,
      }, shadow]}>
        {value}
      </Text>
    </View>
  );
}

// ── Floating share-card (Strava-stil overlay) ──────────────────────────────
function FStat({ value, unit, label, align }: { value: string; unit: string; label: string; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return (
    <View style={{ alignItems: align ?? 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[{ fontFamily: SERIF, fontWeight: '600', fontSize: 18, color: '#fff', letterSpacing: -0.5 }, FSH]}>{value}</Text>
        {!!unit && <Text style={[{ fontFamily: MONO, fontSize: 7.5, fontWeight: '700', color: GOLD }, FSH]}>{unit}</Text>}
      </View>
      <Text style={[{ fontFamily: MONO, fontWeight: '700', fontSize: 8, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)', marginTop: 3 }, FSH]}>{label}</Text>
    </View>
  );
}

function FloatingLayer({ anchor, dep, arr, date, distance, maxAlt, avgSpeed, total, type, fmtNum, depSnap, arrSnap, tileScale = 1, corners, brandRight, mapCredit, cardW, cardH }: {
  anchor: 'center' | 'route';
  dep: string; arr: string; date: string;
  distance: number; maxAlt: number; avgSpeed: number;
  total: string; type: string; fmtNum: (n: number) => string;
  depSnap?: string | null; arrSnap?: string | null;
  tileScale?: number; corners?: { dep: string; arr: string }; brandRight?: boolean;
  mapCredit?: string; cardW: number; cardH: number;
}) {
  const stats: { value: string; unit: string; label: string }[] = [];
  if (distance > 0) stats.push({ value: fmtNum(distance), unit: 'NM', label: 'Distance' });
  if (maxAlt > 0) stats.push({ value: fmtNum(maxAlt), unit: 'FT', label: 'Max alt' });
  if (avgSpeed > 0) stats.push({ value: fmtNum(avgSpeed), unit: 'KT', label: 'Avg speed' });

  const statRow = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {stats.map((s, i) => (
        <FStat key={s.label} value={s.value} unit={s.unit} label={s.label}
          align={stats.length === 1 ? 'flex-start' : i === 0 ? 'flex-start' : i === stats.length - 1 ? 'flex-end' : 'center'} />
      ))}
    </View>
  );
  // BLADES-lockup: "logged in" + BLADES (guld) + Pilot Logbook (silver, mindre).
  const brand = (
    <View style={{ alignItems: brandRight ? 'flex-end' : 'flex-start' }}>
      <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 9, color: '#fff', marginBottom: 1 }, FSH]}>logged in</Text>
      <Text style={[{ fontFamily: 'Georgia', fontWeight: '700', fontSize: 10, letterSpacing: 2.4, color: GOLD }, FSH]}>BLADES</Text>
      <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 7, letterSpacing: 1.4, color: SILVER, marginTop: 1 }, FSH]}>Pilot Logbook</Text>
    </View>
  );
  const dateText = (
    <Text style={[{ fontFamily: MONO, fontSize: 9.5, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.8 }, FSH]}>{date}</Text>
  );
  const hairline = (
    <LinearGradient colors={['rgba(255,184,48,0.8)', 'rgba(255,184,48,0.1)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 1, marginTop: 14, marginBottom: 13 }} />
  );
  const routeRow = (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
      <Text style={[{ fontFamily: SERIF, fontWeight: '600', fontSize: 34, color: '#fff', letterSpacing: -1 }, FSH]}>{dep}</Text>
      <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12h14M13 6l6 6-6 6" /></Svg>
      <Text style={[{ fontFamily: SERIF, fontWeight: '600', fontSize: 34, color: '#fff', letterSpacing: -1 }, FSH]}>{arr}</Text>
    </View>
  );

  if (anchor === 'route') {
    const size = Math.round(92 * tileScale);  // slider skalar snapshots + ICAO
    const M = 22;          // samma marginal till respektive kant
    const BOTTOM = 66;     // route-lagrets "botten" = guldlinjen
    const regionH = cardH - BOTTOM;
    const depCorner = corners?.dep ?? 'tr';
    const arrCorner = corners?.arr ?? 'bl';
    const posOf = (corner: string): any => ({
      ...(corner[0] === 't' ? { top: M } : { bottom: M }),
      ...(corner[1] === 'l' ? { left: M } : { right: M }),
    });
    const centerOf = (corner: string) => ({
      x: corner[1] === 'l' ? M + size / 2 : cardW - M - size / 2,
      y: corner[0] === 't' ? M + size / 2 : regionH - M - size / 2,
    });
    const depC = centerOf(depCorner);
    const arrC = centerOf(arrCorner);
    const cap = 7 * tileScale;
    const tileBox = (corner: string, snap: string | null | undefined, icao: string, label: string) => {
      const isTop = corner[0] === 't';
      return (
        <View style={[{ position: 'absolute', width: size, height: size }, posOf(corner)]}>
          <View style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,184,48,0.6)' }}>
            {snap
              ? <Image source={{ uri: snap }} style={{ width: size, height: size }} resizeMode="cover" />
              : <View style={{ flex: 1, backgroundColor: 'rgba(20,30,45,0.6)' }} />}
          </View>
          {/* ICAO nuddar rutan på inre sidan: topp → under, botten → ovanför. */}
          <Text style={[
            { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: SERIF, fontSize: 21 * tileScale, fontWeight: '600', letterSpacing: -0.4, color: '#fff', textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
            isTop ? { top: size + 2 } : { bottom: size + 2 },
          ]}>{icao}</Text>
          {/* Departure/Arrival relativt ICAO-texten: botten-ruta (ICAO ovanför) → nedanför-vänster
              om ICAO; topp-ruta (ICAO under) → ovanför-höger om ICAO. */}
          <Text style={[
            { position: 'absolute', fontFamily: MONO, fontSize: cap, fontWeight: '700', letterSpacing: 0.5, color: GOLD, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
            isTop ? { bottom: 3, right: 5 } : { top: 3, left: 5 },
          ]}>{label}</Text>
        </View>
      );
    };
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Tiles-region: bildens överkant ner till guldlinjen. Snapshots i diagonala hörn
            efter platsernas orientering, samma marginal M till respektive kant. */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: regionH }}>
          <Svg width={cardW} height={regionH} style={StyleSheet.absoluteFill}>
            <Line x1={depC.x} y1={depC.y} x2={arrC.x} y2={arrC.y} stroke={GOLD} strokeWidth={1.4} strokeDasharray={[4, 4.6]} opacity={0.85} />
          </Svg>
          {tileBox(depCorner, depSnap, dep, 'Departure')}
          {tileBox(arrCorner, arrSnap, arr, 'Arrival')}
        </View>
        {/* Scrims */}
        <LinearGradient colors={['transparent', 'rgba(6,11,22,0.72)']} locations={[0, 0.8]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%' }} />
        <LinearGradient colors={['rgba(6,11,22,0.5)', 'transparent']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '24%' }} />
        {/* Lockup — flyttar till övre höger om en tile ligger i övre vänstra hörnet */}
        <View style={{ position: 'absolute', top: 18, left: 20, right: 20, alignItems: brandRight ? 'flex-end' : 'flex-start' }}>{brand}</View>
        {/* Kartattribution (krav för OSM/CARTO/Esri) */}
        {mapCredit ? (
          <Text style={{ position: 'absolute', bottom: 2, right: 8, fontSize: 6.5, color: 'rgba(255,255,255,0.55)', fontFamily: MONO }}>{mapCredit}</Text>
        ) : null}
        {/* Bottom: datum på guldhårlinjen + statrad (ingen stor route-text) */}
        <View style={{ position: 'absolute', left: 20, right: 20, bottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LinearGradient colors={['rgba(255,184,48,0.8)', 'rgba(255,184,48,0.1)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, height: 1 }} />
            <Text style={[{ fontFamily: MONO, fontSize: 9.5, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.8 }, FSH]}>{date}</Text>
          </View>
          <View style={{ marginTop: 10 }}>{statRow}</View>
        </View>
      </View>
    );
  }

  // center — fasta delar (gradient/eyebrow/stats/lockup). Route-texten DEP/to/ARR
  // renderas separat i det dragbara lagret så den kan flyttas + storleksändras.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['rgba(6,11,22,0.42)', 'transparent', 'transparent', 'rgba(6,11,22,0.6)']} locations={[0, 0.3, 0.64, 1]} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', top: 18, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={[{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 3, color: GOLD }, FSH]}>FLIGHT LOG · {date}</Text>
      </View>
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 18 }}>
        {statRow}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopColor: 'rgba(255,184,48,0.4)', borderTopWidth: 1, paddingTop: 10, marginTop: 13 }}>
          {brand}
          <Text style={[{ fontFamily: MONO, fontSize: 9, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }, FSH]}>{total}h · {type}</Text>
        </View>
      </View>
    </View>
  );
}

function HeliIcon({ size = 14, color = 'rgba(255,255,255,0.8)' }: { size?: number; color?: string }) {
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* Main rotor — horizontal line */}
      <View style={{ position: 'absolute', width: s * 0.95, height: 1.5, backgroundColor: color, borderRadius: 1 }} />
      {/* Main rotor — vertical line */}
      <View style={{ position: 'absolute', width: 1.5, height: s * 0.95, backgroundColor: color, borderRadius: 1 }} />
      {/* Rotor hub */}
      <View style={{ position: 'absolute', width: s * 0.22, height: s * 0.22, borderRadius: s * 0.11, backgroundColor: color }} />
      {/* Body */}
      <View style={{ position: 'absolute', top: s * 0.38, width: s * 0.28, height: s * 0.42, borderRadius: s * 0.1, backgroundColor: color }} />
      {/* Tail boom */}
      <View style={{ position: 'absolute', top: s * 0.72, width: 1.2, height: s * 0.28, backgroundColor: color }} />
      {/* Tail rotor */}
      <View style={{ position: 'absolute', top: s * 0.92, width: s * 0.35, height: 1.2, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

export function RunwayDiagram({ icao, size = 32, color = '#FFB830' }: { icao: string; size?: number; color?: string }) {
  const headings = runwayData[icao];
  if (!headings || headings.length === 0) return null;

  const groups: { heading: number; offset: number }[] = [];
  const used = new Set<number>();

  for (let i = 0; i < headings.length; i++) {
    if (used.has(i)) continue;
    const parallel: number[] = [i];
    for (let j = i + 1; j < headings.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(headings[i] - headings[j]);
      const wrap = Math.min(diff, 360 - diff);
      if (wrap < 30) { parallel.push(j); used.add(j); }
    }
    used.add(i);
    const avg = headings[parallel[0]];
    const spacing = 3.5;
    const total = parallel.length;
    for (let k = 0; k < total; k++) {
      const off = (k - (total - 1) / 2) * spacing;
      groups.push({ heading: avg, offset: off });
    }
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {groups.map((g, i) => {
        const rad = (g.heading - 90) * Math.PI / 180;
        const perpX = -Math.sin(rad) * g.offset;
        const perpY = Math.cos(rad) * g.offset;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: 2,
              height: size * 0.76,
              backgroundColor: color,
              borderRadius: 1,
              transform: [
                { translateX: perpX },
                { translateY: perpY },
                { rotate: `${g.heading}deg` },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

function buildRouteSvg(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
  depName: string,
  arrName: string,
): string {
  const W = 300;
  const H = 200;
  const pad = 40;
  const minLat = Math.min(dep.lat, arr.lat);
  const maxLat = Math.max(dep.lat, arr.lat);
  const minLon = Math.min(dep.lon, arr.lon);
  const maxLon = Math.max(dep.lon, arr.lon);
  const latSpan = maxLat - minLat || 1;
  const lonSpan = maxLon - minLon || 1;
  const toX = (lon: number) => pad + ((lon - minLon) / lonSpan) * (W - 2 * pad);
  const toY = (lat: number) => pad + ((maxLat - lat) / latSpan) * (H - 2 * pad);
  const x1 = toX(dep.lon), y1 = toY(dep.lat);
  const x2 = toX(arr.lon), y2 = toY(arr.lat);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2 - 30;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="M${x1},${y1} Q${midX},${midY} ${x2},${y2}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-dasharray="6,4"/>
    <circle cx="${x1}" cy="${y1}" r="4" fill="#fff"/>
    <circle cx="${x2}" cy="${y2}" r="4" fill="#fff"/>
    <text x="${x1}" y="${y1 + 14}" fill="rgba(255,255,255,0.8)" font-size="10" font-family="sans-serif" text-anchor="middle">${depName}</text>
    <text x="${x2}" y="${y2 + 14}" fill="rgba(255,255,255,0.8)" font-size="10" font-family="sans-serif" text-anchor="middle">${arrName}</text>
  </svg>`;
}

const ctrl = StyleSheet.create({
  panel: {
    alignSelf: 'stretch',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 12,
  },
  rowLabel: {
    width: 64,
    color: CTRL_LABEL,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: MONO,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowValue: {
    marginLeft: 10,
    width: 38,
    color: GOLD,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    textAlign: 'right',
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: CTRL_BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  seg: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CTRL_BORDER,
    backgroundColor: CTRL_TRACK,
  },
  segItem: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemActive: { backgroundColor: CTRL_ACCENT },
  segDivider: { borderLeftWidth: 1, borderLeftColor: CTRL_BORDER },
  segText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    fontFamily: MONO,
  },
  segTextActive: { color: '#fff' },
});

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    backgroundColor: '#0f1728',
  },
  routeOverlay: {
    position: 'absolute',
    top: '12%',
    right: 12,
    opacity: 0.85,
  },
  statsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 40,
  },
  routeTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  placeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'Georgia',
  },
  routeLine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  branding: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  brandText: {
    color: '#FFB830',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    fontFamily: 'Georgia',
  },
  brandSub: {
    color: '#FFB830aa',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: 'Georgia',
  },
});
