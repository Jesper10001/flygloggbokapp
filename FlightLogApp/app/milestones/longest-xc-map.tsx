// Longest XC i helskärm på Apple-kartan, där dagen spelas upp: farkosten (helikopter eller plan efter flottans
// kategori) flyger längs rutten medan man spelar upp eller drar i tidslinjen. Den flugna sträckan ritas i cyan.
// Kartan går att flytta och zooma men inte vrida, så att nosen alltid pekar rätt. Medan kartan är öppen väntar appens
// popup-rutor (useMapScreenStore), annars kan skärmen låsa sig.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useLongestXcFull } from '../../hooks/useMilestoneDetails';
import { useMapScreenStore } from '../../store/mapScreenStore';
import {
  AirportMarker, LegLabel, AircraftIcon, regionFor, toLatLng, lerpPt, headingDeg, MAP_CYAN, MAP_WATER, type GeoPt,
} from '../../components/milestones/MilestoneMap';
import { MONO } from '../../components/milestones/MilestoneUI';

const clockMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

interface TLeg { from: string; to: string; a: GeoPt; b: GeoPt; start: number; end: number; nm: number }

export default function LongestXcMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stats = useFlightStore(s => s.stats);
  const params = useLocalSearchParams<{ date?: string; nm?: string; hours?: string; from?: string; to?: string }>();
  const sub = !!params.date;
  const d = useLongestXcFull(sub ? {
    date: params.date, km: Number(params.nm) || 0, hours: parseFloat(params.hours ?? '') || 0,
    flightId: null, firstDep: params.from, lastArr: params.to,
  } : {
    date: stats?.longest_xc_date || undefined, km: stats?.longest_xc_km ?? 0, hours: stats?.longest_xc_hours ?? 0,
    flightId: stats?.longest_xc_id ?? null, firstDep: stats?.longest_xc_first_dep, lastArr: stats?.longest_xc_last_arr,
  });

  useEffect(() => {
    useMapScreenStore.setState({ open: true });
    return () => { useMapScreenStore.setState({ open: false }); };
  }, []);

  // Tidslinjen i minuter. Saknas eller krockar klockslagen läggs benen efter varandra med sin flygtid.
  const tl = useMemo(() => {
    const ok = d.flightLegs.filter((l) => l.a && l.b);
    let legs: TLeg[] = [];
    let valid = ok.length > 0;
    let prevEnd = -Infinity;
    for (const l of ok) {
      const s0 = clockMin(l.off), e0 = clockMin(l.on);
      if (s0 == null || e0 == null) { valid = false; break; }
      let start = s0, end = e0;
      while (start < prevEnd) start += 1440;
      while (end <= start) end += 1440;
      legs.push({ from: l.from, to: l.to, a: l.a!, b: l.b!, start, end, nm: l.nm });
      prevEnd = end;
    }
    if (!valid) {
      let t = 0;
      legs = ok.map((l) => {
        const dur = Math.max(10, Math.round(l.hours * 60));
        const leg = { from: l.from, to: l.to, a: l.a!, b: l.b!, start: t, end: t + dur, nm: l.nm };
        t += dur;
        return leg;
      });
    }
    const t0 = legs[0]?.start ?? 0, span = Math.max(1, (legs[legs.length - 1]?.end ?? 1) - t0);
    return { legs, t0, span, total: legs.reduce((s, l) => s + l.nm, 0), clocks: valid };
  }, [d.flightLegs]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tRef = useRef(0);
  tRef.current = t;
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setPlaying(false); };
  const play = () => {
    stop();
    const start = tRef.current >= tl.span ? 0 : tRef.current;
    setT(start);
    setPlaying(true);
    let now = start;
    // Hela dagen spelas upp på ungefär åtta sekunder.
    timer.current = setInterval(() => {
      now = Math.min(tl.span, now + tl.span / 200);
      setT(now);
      if (now >= tl.span) stop();
    }, 40);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Tidslinjen går att dra i.
  const [trackW, setTrackW] = useState(1);
  const trackRef = useRef({ w: 1, span: 1 });
  trackRef.current = { w: trackW, span: tl.span };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { stop(); setT(Math.max(0, Math.min(1, e.nativeEvent.locationX / trackRef.current.w)) * trackRef.current.span); },
    onPanResponderMove: (e) => { setT(Math.max(0, Math.min(1, e.nativeEvent.locationX / trackRef.current.w)) * trackRef.current.span); },
  })).current;

  // Var farkosten är vid tiden t: på ett ben, eller på marken mellan två.
  const now = tl.t0 + t;
  let cur = 0, frac = 0, onGround = false;
  for (let i = 0; i < tl.legs.length; i++) {
    const l = tl.legs[i];
    if (now < l.start) { cur = Math.max(0, i - 1); frac = i ? 1 : 0; onGround = true; break; }
    if (now <= l.end) { cur = i; frac = (now - l.start) / (l.end - l.start); onGround = false; break; }
    cur = i; frac = 1; onGround = i !== tl.legs.length - 1;
  }
  const leg = tl.legs[cur];
  const pos = leg ? lerpPt(leg.a, leg.b, frac) : null;
  const flown = tl.legs.reduce((s, l, j) => s + (j < cur ? l.nm : j === cur ? l.nm * frac : 0), 0);

  // Den flugna sträckan ritas om några gånger i sekunden, inte varje bildruta (Apple-kartan flimrar annars).
  const step = Math.max(1, Math.round((t / tl.span) * 60));
  const done = useMemo(() => {
    if (!leg || t <= 0) return [];
    const pts = [toLatLng(tl.legs[0].a)];
    tl.legs.forEach((l, j) => {
      if (j < cur) pts.push(toLatLng(l.b));
      else if (j === cur) pts.push(toLatLng(lerpPt(l.a, l.b, frac)));
    });
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, tl]);

  const mapRef = useRef<MapView>(null);
  const pts = tl.legs.flatMap((l) => [l.a, l.b]);
  const fit = () => {
    if (!pts.length) return;
    mapRef.current?.fitToCoordinates(pts.map(toLatLng), { edgePadding: { top: insets.top + 110, right: 60, bottom: 240, left: 60 }, animated: false });
  };
  const codes = tl.legs.length ? [tl.legs[0].from, ...tl.legs.map((l) => l.to)] : [];
  const stops = codes.map((k, i) => ({ k, p: i === 0 ? tl.legs[0].a : tl.legs[i - 1].b, end: i === 0 || i === codes.length - 1 }))
    .filter((x, i, arr) => arr.findIndex((y) => y.k === x.k) === i);
  const landed = t >= tl.span, ready = t <= 0;
  const statusHead = ready ? 'READY' : landed ? 'LANDED' : onGround ? 'ON GROUND' : `LEG ${cur + 1} OF ${tl.legs.length}`;
  const statusText = !leg ? '' : ready ? leg.from : landed ? tl.legs[tl.legs.length - 1].to : onGround ? leg.to : `${leg.from}→${leg.to}`;

  return (
    <View style={{ flex: 1, backgroundColor: MAP_WATER }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={regionFor(pts)}
        onMapReady={fit}
        mapType="standard"
        userInterfaceStyle="dark"
        showsPointsOfInterests={false}
        showsCompass={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {tl.legs.map((l, i) => (
          <Polyline key={`all${i}`} coordinates={[toLatLng(l.a), toLatLng(l.b)]} strokeColor="rgba(0,200,232,0.45)" strokeWidth={2} lineDashPattern={[6, 6]} />
        ))}
        {done.length > 1 ? <Polyline coordinates={done} strokeColor={MAP_CYAN} strokeWidth={3.2} lineCap="round" lineJoin="round" /> : null}
        {tl.legs.map((l, i) => (
          <LegLabel key={`nm${i}`} p={lerpPt(l.a, l.b, 0.5)} text={`${Math.round(l.nm)} NM`} />
        ))}
        {stops.map((x) => <AirportMarker key={x.k} p={x.p} icao={x.k} />)}
        {pos && leg ? (
          <Marker coordinate={toLatLng(pos)} anchor={{ x: 0.5, y: 0.5 }} zIndex={10}>
            <AircraftIcon heli={d.heli} heading={headingDeg(leg.a, leg.b)} spinning={playing} />
          </Marker>
        ) : null}
      </MapView>

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={s.close} accessibilityLabel="Close the map">
          <Ionicons name="close" size={18} color={Colors.textPrimary} />
        </Pressable>
        <View style={s.titlePill}>
          <Text numberOfLines={1} style={s.titleText}>{codes.join(' → ')}</Text>
          <Text style={s.titleSub}>{Math.round(d.distanceNm || tl.total)} NM · {d.dateShort}{d.aircraftType ? ` · ${d.aircraftType}` : ''}</Text>
        </View>
      </View>

      <View style={[s.panel, { paddingBottom: insets.bottom + 18 }]}>
        <View style={{ flexDirection: 'row' }}>
          <View style={s.read}><Text style={s.cap}>TIME</Text><Text style={s.val}>{tl.clocks ? `${clock(now)}Z` : clock(t)}</Text></View>
          <View style={s.read}><Text style={s.cap}>FLOWN</Text><Text style={[s.val, { color: MAP_CYAN }]}>{Math.round(flown)} NM</Text></View>
          <View style={[s.read, { alignItems: 'flex-end' }]}><Text style={s.cap}>{statusHead}</Text><Text style={s.val}>{statusText}</Text></View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => (playing ? stop() : play())} style={s.play} accessibilityLabel={playing ? 'Pause the replay' : 'Replay the day'}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={Colors.textInverse} />
          </Pressable>
          <View style={s.track} onLayout={(e) => setTrackW(Math.max(1, e.nativeEvent.layout.width))} {...pan.panHandlers}
            accessible accessibilityRole="adjustable" accessibilityLabel="Replay the day" accessibilityValue={{ text: tl.clocks ? `${clock(now)} UTC` : clock(t) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => { stop(); setT((v) => Math.max(0, Math.min(tl.span, v + (e.nativeEvent.actionName === 'increment' ? 1 : -1) * tl.span / 20))); }}>
            <View pointerEvents="none" style={s.trackBase} />
            {tl.legs.map((l, j) => {
              const doneFrac = j < cur ? 1 : j === cur ? frac : 0;
              return (
                <View key={`seg${j}`} pointerEvents="none" style={[s.seg, { left: `${((l.start - tl.t0) / tl.span) * 100}%`, width: `${((l.end - l.start) / tl.span) * 100}%` }]}>
                  <View style={{ height: '100%', width: `${doneFrac * 100}%`, backgroundColor: MAP_CYAN }} />
                </View>
              );
            })}
            <View pointerEvents="none" style={[s.knob, { left: (t / tl.span) * trackW - 12 }]} />
          </View>
        </View>
        {tl.legs.length ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -8 }}>
            <Text style={s.edge}>{tl.clocks ? `${clock(tl.t0)}Z ` : ''}{tl.legs[0].from}</Text>
            <Text style={s.edge}>{tl.legs[tl.legs.length - 1].to}{tl.clocks ? ` ${clock(tl.t0 + tl.span)}Z` : ''}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(18,26,36,0.85)', borderWidth: 1, borderColor: '#3A3F46', alignItems: 'center', justifyContent: 'center' },
  titlePill: { flexShrink: 1, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(18,26,36,0.85)', borderWidth: 1, borderColor: '#3A3F46', justifyContent: 'center', gap: 1 },
  titleText: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: Colors.textPrimary },
  titleSub: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 16, paddingHorizontal: 20, gap: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: 'rgba(10,22,40,0.95)', borderTopWidth: 1, borderColor: Colors.cardBorder },
  read: { flex: 1, gap: 3 },
  cap: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, color: Colors.textSecondary },
  val: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  play: { width: 48, height: 48, borderRadius: 24, backgroundColor: MAP_CYAN, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 48, justifyContent: 'center' },
  trackBase: { position: 'absolute', left: 0, right: 0, top: 23.5, height: 1, backgroundColor: '#2A4E70' },
  seg: { position: 'absolute', top: 19, height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: '#2A4E70' },
  knob: { position: 'absolute', top: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 4, borderColor: MAP_CYAN },
  edge: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
});
