// Kameraåkningen i Best week- och Longest XC-kartorna (designvyns "Map replay v3"). Här finns klockan som driver
// uppspelningen, Apple-kartans kamera (lutning och vridning, satt med setCamera i varje steg) och lagren ovanpå:
// flygplatser som en kod under punkten, ringar som pulserar vid landning, ljuspunkter, farkosten med glöd och skugga,
// dimma mot horisonten och glaspanelen. MapKit använder kamerans lutning och vridning bara när pitchEnabled och
// rotateEnabled är på, så kartorna har dem på hela tiden.

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { View, Text, Animated, Easing, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Ellipse } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { AircraftIcon, toLatLng, MAP_CYAN, type GeoPt } from './MilestoneMap';

const MONO = 'JetBrainsMono';
export const REPLAY_BG = '#0C1722';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, e: number) => a + (b - a) * e;
export const ease = (e: number) => { const x = clamp(e, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const angLerp = (a: number, b: number, e: number) => { const d = ((((b - a) % 360) + 540) % 360) - 180; return a + d * e; };

// Kameran som MapKit ser den: punkten den tittar på, höjd i meter, vridning (kurs uppåt) och lutning.
export interface GeoCam { lat: number; lon: number; alt: number; heading: number; pitch: number }

// Mellan två kameror: höjden glider logaritmiskt och tar ett skutt uppåt på vägen, som en flygning dit.
export function blendCam(a: GeoCam, b: GeoCam, e: number, bump = false): GeoCam {
  let alt = Math.exp(lerp(Math.log(a.alt), Math.log(b.alt), e));
  if (bump) alt *= 1 + 0.32 * Math.sin(Math.PI * e);
  return { lat: lerp(a.lat, b.lat, e), lon: lerp(a.lon, b.lon, e), alt, heading: angLerp(a.heading, b.heading, e), pitch: lerp(a.pitch, b.pitch, e) };
}

// En punkt ett antal meter bort i en viss kurs.
export function offsetPt(p: GeoPt, bearing: number, meters: number): GeoPt {
  const d = meters / 111320, b = (bearing * Math.PI) / 180;
  return { lat: p.lat + Math.cos(b) * d, lon: p.lon + (Math.sin(b) * d) / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)) };
}

// Kameran snett bakom farkosten: den tittar en bit framför, så farkosten hamnar strax under mitten.
export function chaseCam(pos: GeoPt, heading: number, alt: number, pitch: number): GeoCam {
  const c = offsetPt(pos, heading, alt * 0.15);
  return { lat: c.lat, lon: c.lon, alt, heading, pitch };
}

// Hur stort ett område är, i km, för att skala kamerans höjd mot översikten (skärmen är högre än bred).
export function spanKm(pts: GeoPt[]): number {
  if (!pts.length) return 10;
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const latKm = (Math.max(...lats) - Math.min(...lats)) * 111.32;
  const lonKm = (Math.max(...lons) - Math.min(...lons)) * 111.32 * Math.cos((mid * Math.PI) / 180);
  return Math.max(latKm / 1.25, lonKm, 12);
}

export const toCamera = (c: GeoCam) => ({ center: { latitude: c.lat, longitude: c.lon }, altitude: c.alt, heading: c.heading, pitch: c.pitch });

// Översikten: kartan ramas in kring punkterna, och kameran MapKit valde läses av och blir uppspelningens start och slut.
export function useOverview(mapRef: RefObject<MapView | null>, pts: GeoPt[], padding: { top: number; right: number; bottom: number; left: number }) {
  const [ov, setOv] = useState<GeoCam | null>(null);
  const ready = useRef(false);
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  const key = pts.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('|');
  const measure = useCallback(() => {
    const list = ptsRef.current;
    if (!ready.current || !list.length || !mapRef.current) return;
    mapRef.current.fitToCoordinates(list.map(toLatLng), { edgePadding: padding, animated: false });
    setTimeout(() => {
      const fallback = () => {
        const lat = list.reduce((s, p) => s + p.lat, 0) / list.length, lon = list.reduce((s, p) => s + p.lon, 0) / list.length;
        setOv({ lat, lon, alt: spanKm(list) * 2600, heading: 0, pitch: 0 });
      };
      if (!mapRef.current) return;
      mapRef.current.getCamera().then((c) => {
        if (c?.center && c.altitude) setOv({ lat: c.center.latitude, lon: c.center.longitude, alt: c.altitude, heading: 0, pitch: 0 });
        else fallback();
      }).catch(fallback);
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { measure(); }, [measure]);
  const onMapReady = useCallback(() => { ready.current = true; measure(); }, [measure]);
  return { ov, onMapReady };
}

// Klockan: t i sekunder, ungefär 30 steg i sekunden (det räcker och skonar kartan). Stannar vid slutet.
export function useReplay(total: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const cur = useRef(0), raf = useRef<number | null>(null), totalRef = useRef(total);
  totalRef.current = total;
  const halt = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
  }, []);
  const play = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    if (cur.current >= totalRef.current - 0.01) cur.current = 0;
    setPlaying(true);
    setT(cur.current);
    let last: number | null = null, lastSet = 0;
    const step = (ts: number) => {
      if (last == null) { last = ts; lastSet = ts; }
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      cur.current = Math.min(totalRef.current, cur.current + dt);
      const end = cur.current >= totalRef.current;
      if (end || ts - lastSet >= 30) { lastSet = ts; setT(cur.current); }
      if (end) { raf.current = null; setPlaying(false); return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);
  const seek = useCallback((v: number) => { cur.current = clamp(v, 0, totalRef.current); setT(cur.current); }, []);
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);
  return { t, playing, play, halt, seek };
}

// Flygplats: koden i en liten etikett strax under punkten (vyn är symmetrisk kring koordinaten, utan centerOffset).
export function StopMarker({ p, code, visited }: { p: GeoPt; code: string; visited: boolean }) {
  return (
    <Marker coordinate={toLatLng(p)} zIndex={4} tracksViewChanges={false}>
      <View pointerEvents="none" style={{ width: 52, height: 80 }}>
        <View style={[k.stop, { borderColor: visited ? 'rgba(0,200,232,0.75)' : '#33475C' }]}>
          <Text numberOfLines={1} style={[k.stopText, { color: visited ? '#FFFFFF' : '#8FA3B8' }]}>{code}</Text>
        </View>
      </View>
    </Marker>
  );
}

// Två ringar som växer och tonar bort där farkosten landade. Monteras när landningen sker.
export function RippleMarker({ p }: { p: GeoPt }) {
  const a = useRef(new Animated.Value(0)).current, b = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = (v: Animated.Value, delay: number) =>
      Animated.sequence([Animated.delay(delay), Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true })]);
    Animated.parallel([run(a, 0), run(b, 300)]).start();
  }, [a, b]);
  const ring = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.12, 1] }) }],
  });
  return (
    <Marker coordinate={toLatLng(p)} zIndex={3} tracksViewChanges={false}>
      <View pointerEvents="none" style={{ width: 110, height: 110 }}>
        <Animated.View style={[k.ring, ring(a)]} />
        <Animated.View style={[k.ring, ring(b)]} />
      </View>
    </Marker>
  );
}

// En ljuspunkt som löper längs en linje (avslutningen).
export function GlowDot({ p }: { p: GeoPt }) {
  return (
    <Marker coordinate={toLatLng(p)} zIndex={5} tracksViewChanges={false}>
      <View pointerEvents="none" style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <View style={k.dot} />
      </View>
    </Marker>
  );
}

// Farkosten med cyan glöd under sig och en skugga som glider ut när den är i luften (lift 0 = på marken).
export function ReplayAircraft({ p, heli, heading, spinning, lift }: { p: GeoPt; heli: boolean; heading: number; spinning: boolean; lift: number }) {
  return (
    <Marker coordinate={toLatLng(p)} anchor={{ x: 0.5, y: 0.5 }} zIndex={10}>
      <View pointerEvents="none" style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={84} height={84} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="acGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={MAP_CYAN} stopOpacity={0.34} />
              <Stop offset="1" stopColor={MAP_CYAN} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="acShadow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#000" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#000" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={42} cy={42} r={34} fill="url(#acGlow)" />
          <Ellipse cx={42 + lift * 0.45} cy={44 + lift} rx={14} ry={6.5} fill="url(#acShadow)" />
        </Svg>
        <AircraftIcon heli={heli} heading={heading} spinning={spinning} />
      </View>
    </Marker>
  );
}

// Dimma mot horisonten när kartan lutar, och mörkret bakom panelen.
export function ReplayShade({ fog }: { fog: number }) {
  return (
    <>
      <View pointerEvents="none" style={[k.fog, { opacity: fog }]}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.08" stopColor={REPLAY_BG} stopOpacity={1} />
              <Stop offset="0.45" stopColor={REPLAY_BG} stopOpacity={0.6} />
              <Stop offset="1" stopColor={REPLAY_BG} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#fog)" />
        </Svg>
      </View>
      <View pointerEvents="none" style={k.fade}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={REPLAY_BG} stopOpacity={0} />
              <Stop offset="0.52" stopColor={REPLAY_BG} stopOpacity={0.82} />
              <Stop offset="1" stopColor={REPLAY_BG} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
        </Svg>
      </View>
    </>
  );
}

export function Glass({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return (
    <View style={[k.glass, style]}>
      <BlurView tint="systemThinMaterialDark" intensity={60} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(13,24,38,0.55)' }]} />
      {children}
    </View>
  );
}

// Titeln som tonar in över översikten innan kameran dyker ner.
export function TitleCard({ t, cap, title, sub, top }: { t: number; cap: string; title: string; sub: string; top: number }) {
  const o = clamp(t < 0.2 ? 0 : t < 0.6 ? (t - 0.2) / 0.4 : t < 1.5 ? 1 : 1 - (t - 1.5) / 0.6, 0, 1);
  if (o <= 0) return null;
  return (
    <View pointerEvents="none" style={[k.title, { top, opacity: o, transform: [{ translateY: (1 - o) * 10 }] }]}>
      <Text style={k.titleCap}>{cap}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={k.titleBig}>{title}</Text>
      <Text numberOfLines={1} style={k.titleSub}>{sub}</Text>
    </View>
  );
}

const k = StyleSheet.create({
  stop: { position: 'absolute', left: 4, top: 60, width: 44, height: 18, borderRadius: 6, borderWidth: 1, backgroundColor: 'rgba(10,20,32,0.86)', alignItems: 'center', justifyContent: 'center' },
  stopText: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4 },
  ring: { position: 'absolute', left: 0, top: 0, width: 110, height: 110, borderRadius: 55, borderWidth: 2, borderColor: MAP_CYAN, backgroundColor: 'rgba(0,200,232,0.10)' },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#E6FBFF', shadowColor: MAP_CYAN, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  fog: { position: 'absolute', left: 0, right: 0, top: 0, height: '48%' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 340 },
  glass: { overflow: 'hidden', borderRadius: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  title: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 8 },
  titleCap: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 2.4, color: MAP_CYAN },
  titleBig: { fontFamily: 'Fraunces', fontSize: 36, fontWeight: '600', color: '#FFFFFF', textShadowColor: '#000', textShadowRadius: 8 },
  titleSub: { fontFamily: MONO, fontSize: 11, color: '#A7B3C2' },
});
