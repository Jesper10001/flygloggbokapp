// Apple-kartan (standard, mörkt läge) för Best week och Longest XC: en stillastående förhandsbild i korten och på
// sidorna, och samma lager i helskärmskartorna. Här finns också geometrin (region, avstånd, kurs) och
// markörerna: flygplatser, basen med en streckad ring och farkosten som rör sig vid uppspelningen. Allt i cyan.

import { useEffect, useRef, type ReactNode } from 'react';
import { View, Text, Animated, Easing, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

const MONO = 'JetBrainsMono';
export const MAP_CYAN = '#00C8E8';
export const MAP_CYAN_DIM = 'rgba(0,200,232,0.35)';
export const MAP_WATER = '#1B2733';

export interface GeoPt { lat: number; lon: number }
export interface LatLng { latitude: number; longitude: number }

export const toLatLng = (p: GeoPt): LatLng => ({ latitude: p.lat, longitude: p.lon });

export function nmBetween(a: GeoPt, b: GeoPt): number {
  const R = 3440.065, t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Kurs i grader medurs från norr, för att vrida farkosten på en karta med norr uppåt.
export function headingDeg(a: GeoPt, b: GeoPt): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return (Math.atan2((b.lon - a.lon) * k, b.lat - a.lat) * 180) / Math.PI;
}

export function lerpPt(a: GeoPt, b: GeoPt, f: number): GeoPt {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

// Regionen som ramar in punkterna med marginal; minst ungefär 60 km så att en enda flygplats inte blir inzoomad.
export function regionFor(points: GeoPt[], pad = 1.7): Region | undefined {
  if (!points.length) return undefined;
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2, k = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  return {
    latitude: midLat,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * pad, 0.55),
    longitudeDelta: Math.max((maxLon - minLon) * pad, 0.55 / k),
  };
}

// Förhandsbilden: kartan går inte att flytta eller zooma, ett tryck går till kortet eller sidan runt den. Den dämpade
// kartstilen (som i uppspelningen) och kanter som tonar ut i bakgrunden `fade` gör att rutten är det man ser.
export function StaticMap({ region, style, children, fade }: { region?: Region; style?: StyleProp<ViewStyle>; children?: ReactNode; fade?: string }) {
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: MAP_WATER }, style]} pointerEvents="none">
      {region ? (
        <MapView
          style={StyleSheet.absoluteFill}
          region={region}
          mapType="mutedStandard"
          userInterfaceStyle="dark"
          showsPointsOfInterests={false}
          showsBuildings={false}
          showsCompass={false}
          showsScale={false}
          showsTraffic={false}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          {children}
        </MapView>
      ) : null}
      {fade ? (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="mapFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={fade} stopOpacity={0.6} />
              <Stop offset="0.3" stopColor={fade} stopOpacity={0} />
              <Stop offset="0.75" stopColor={fade} stopOpacity={0} />
              <Stop offset="1" stopColor={fade} stopOpacity={0.3} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#mapFade)" />
        </Svg>
      ) : null}
    </View>
  );
}

// En linje med glöd, som i uppspelningen: en bred genomskinlig linje under en smal. dim = tonad (andra dagar).
export function GlowLine({ coords, width = 2.2, dim = false }: { coords: LatLng[]; width?: number; dim?: boolean }) {
  return (
    <>
      <Polyline coordinates={coords} strokeColor={dim ? 'rgba(0,200,232,0.07)' : 'rgba(0,200,232,0.2)'} strokeWidth={width * 4} lineCap="round" lineJoin="round" />
      <Polyline coordinates={coords} strokeColor={dim ? MAP_CYAN_DIM : MAP_CYAN} strokeWidth={width} lineCap="round" lineJoin="round" />
    </>
  );
}

// Flygplats: bara ICAO-koden, strax till höger om punkten där linjen börjar eller slutar. Vyn är symmetrisk kring
// koordinaten (en lika bred tom yta till vänster), så den hamnar rätt utan centerOffset.
const LABEL_W = 52;
export function AirportMarker({ p, icao }: { p: GeoPt; icao: string }) {
  return (
    <Marker coordinate={toLatLng(p)} tracksViewChanges={false} zIndex={4}>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: LABEL_W * 2 }}>
        <View style={{ width: LABEL_W }} />
        <Text numberOfLines={1} style={m.icao}>{icao}</Text>
      </View>
    </Marker>
  );
}

// Basen: en streckad cyan ring och en etikett under. Lika hög tom yta ovanför ringen som etiketten under, så att
// ringens mitt ligger på koordinaten utan centerOffset.
export function HomeMarker({ p, label, size = 34 }: { p: GeoPt; label?: string; size?: number }) {
  const labelH = label ? 18 : 0;
  return (
    <Marker coordinate={toLatLng(p)} tracksViewChanges={false} zIndex={5}>
      <View style={{ alignItems: 'center', width: label ? 220 : size }}>
        {label ? <View style={{ height: labelH }} /> : null}
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[m.ring, { width: size, height: size, borderRadius: size / 2 }]} />
          <View style={m.home} />
        </View>
        {label ? <Text numberOfLines={1} style={m.homeLabel}>{label}</Text> : null}
      </View>
    </Marker>
  );
}

// En punkt längs en linje av punkter (lika tätt mellan dem) vid andelen f, med kursen där.
export function alongArc(pts: LatLng[], f: number): { p: GeoPt; heading: number } {
  const n = pts.length - 1;
  const x = Math.max(0, Math.min(1, f)) * n, i = Math.min(n - 1, Math.floor(x)), r = x - i;
  const a = { lat: pts[i].latitude, lon: pts[i].longitude }, b = { lat: pts[i + 1].latitude, lon: pts[i + 1].longitude };
  return { p: lerpPt(a, b, r), heading: headingDeg(a, b) };
}

// Avståndet på ett ben, mitt på benet.
export function LegLabel({ p, text }: { p: GeoPt; text: string }) {
  return (
    <Marker coordinate={toLatLng(p)} tracksViewChanges={false} zIndex={3}>
      <View style={m.legPill}><Text style={m.legText}>{text}</Text></View>
    </Marker>
  );
}

// Farkosten ovanifrån med nosen mot norr: planet, eller helikoptern med en rotor som snurrar under uppspelningen.
export function AircraftIcon({ heli, heading, spinning }: { heli: boolean; heading: number; spinning: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!heli || !spinning) { spin.stopAnimation(); return; }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 380, easing: Easing.linear, useNativeDriver: true }));
    spin.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [heli, spinning, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  if (!heli) {
    return (
      <View style={{ width: 26, height: 26, transform: [{ rotate: `${heading}deg` }] }}>
        <Svg width={26} height={26} viewBox="0 0 22 22">
          <Path d="M11 1.5 C11.9 1.5 12.4 2.6 12.4 4 V8.6 L20 13 V15 L12.4 12.6 V17 L14.8 18.8 V20.3 L11 19.2 L7.2 20.3 V18.8 L9.6 17 V12.6 L2 15 V13 L9.6 8.6 V4 C9.6 2.6 10.1 1.5 11 1.5 Z" fill="#FFFFFF" stroke="#06101E" strokeWidth={1} />
        </Svg>
      </View>
    );
  }
  return (
    <View style={{ width: 36, height: 36, transform: [{ rotate: `${heading}deg` }] }}>
      <Svg width={36} height={36} viewBox="0 0 32 32" style={StyleSheet.absoluteFill}>
        <Path d="M15.1 18 H16.9 V27.6 H15.1 Z" fill="#FFFFFF" stroke="#06101E" strokeWidth={0.8} />
        <Path d="M12.6 22.9 H19.4 V24.3 H12.6 Z" fill="#FFFFFF" stroke="#06101E" strokeWidth={0.8} />
        <Path d="M17.6 25.2 V30.4" fill="none" stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" />
        <Path d="M16 5.6 C18.7 5.6 20 8.8 20 12.4 C20 16.1 18.5 18.8 16 18.8 C13.5 18.8 12 16.1 12 12.4 C12 8.8 13.3 5.6 16 5.6 Z" fill="#FFFFFF" stroke="#06101E" strokeWidth={1} />
        <Path d="M16 7.3 C17.5 7.3 18.3 8.7 18.4 10.3 H13.6 C13.7 8.7 14.5 7.3 16 7.3 Z" fill="#06101E" opacity={0.55} />
      </Svg>
      {/* Rotorn snurrar kring navet (16, 12.6 i ritningens 32-rutnät). */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 36 * (12.6 / 32) - 18, width: 36, height: 36, transform: [{ rotate }] }}>
        <Svg width={36} height={36} viewBox="0 0 32 32">
          <Circle cx={16} cy={16} r={12.4} fill={spinning ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'} stroke={spinning ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.18)'} strokeWidth={0.8} />
          <Path d="M16 16 V4.2 M16 16 H27.8 M16 16 V27.8 M16 16 H4.2" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" opacity={spinning ? 0.55 : 0.95} />
          <Circle cx={16} cy={16} r={1.7} fill="#FFFFFF" stroke="#06101E" strokeWidth={0.8} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const m = StyleSheet.create({
  icao: { marginLeft: 6, fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: MAP_CYAN, textShadowColor: '#000', textShadowRadius: 3 },
  ring: { position: 'absolute', borderWidth: 1.5, borderStyle: 'dashed', borderColor: MAP_CYAN, backgroundColor: 'rgba(0,200,232,0.1)' },
  home: { width: 12, height: 12, borderRadius: 6, backgroundColor: MAP_CYAN, borderWidth: 2, borderColor: MAP_WATER },
  homeLabel: { marginTop: 4, height: 14, fontFamily: MONO, fontSize: 10, color: MAP_CYAN, textShadowColor: '#000', textShadowRadius: 3 },
  legPill: { paddingHorizontal: 7, height: 20, justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: '#3A3F46', backgroundColor: 'rgba(18,26,36,0.88)' },
  legText: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: '#9FEAF6' },
});
