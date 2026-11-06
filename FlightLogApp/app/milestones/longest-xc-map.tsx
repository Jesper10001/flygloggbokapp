// Longest XC i helskärm på Apple-kartan, uppspelad som en kameraåkning (designvyns "Map replay v3"). Dagens titel
// tonar in över hela rutten, kameran dyker ner till avgången och följer farkosten snett bakifrån (lutad och vriden i
// färdriktningen), svänger vid varje mellanlandning, och drar sig till sist upp till hela rutten där ljuspunkter löper
// längs linjen och sammanfattningen kommer upp. Uppspelningen börjar när kartan öppnas. Tidslinjen går att dra i, och
// i paus går kartan att flytta. Medan kartan är öppen väntar appens popup-rutor (useMapScreenStore), annars kan
// skärmen låsa sig.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useLongestXcFull } from '../../hooks/useMilestoneDetails';
import { useMapScreenStore } from '../../store/mapScreenStore';
import { toLatLng, regionFor, MAP_CYAN, type GeoPt } from '../../components/milestones/MilestoneMap';
import {
  useReplay, useOverview, blendCam, chaseCam, toCamera, ease, clamp, lerp, angLerp, gcPoint, gcPath, gcCourse,
  StopMarker, labelsOnRoute, RippleMarker, GlowDot, ReplayAircraft, ReplayShade, Glass, TitleCard, MapControls, useSatellitePref, useScreenAngle, REPLAY_BG, type GeoCam,
} from '../../components/milestones/ReplayKit';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const clockMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const hm = (min: number) => { const m = Math.round(min); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

// Uppspelningens tider i sekunder: titeln, benen, en stund på marken mellan dem, sammanfattningen.
const INTRO = 3.0, GROUND = 2.4, REVEAL = 4.2, PITCH = 52, ZOOM_STEP = 0.7;
// Uppspelningen anpassas efter avståndet, så den känns lika lugn för en helikopterdag och en lång kommersiell flygning:
// - tiden per ben växer med roten ur avståndet (ett kort ben ~7 s, ett långt ~14 s), hela flygningen högst 45 s;
// - kamerans höjd följer benets längd, så en stor del av benet syns och farkosten rör sig lugnt över bilden;
// - lutningen minskar på långa ben (52° → 36°), så man ser marken och inte mest horisont.
const MIN_LEG = 5.5, MAX_FLY = 45;
const legSecFor = (nm: number) => clamp(5 + 2.2 * Math.sqrt(nm / 50), MIN_LEG, 14);
const legAltFor = (nm: number) => clamp(nm * 1852 * 0.38, 15000, 2500000);
const legPitchFor = (nm: number) => lerp(PITCH, 36, clamp((nm - 100) / 900, 0, 1));

interface PLeg {
  from: string; to: string; a: GeoPt; b: GeoPt; start: number; end: number; nm: number;
  brg0: number; brg1: number;             // kursen vid start och landning (storcirkeln)
  alt: number; pitch: number; t0: number; t1: number;
}

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

  // Benen med klockslag (för TIME och GS). Saknas eller krockar klockslagen läggs benen efter varandra med sin flygtid.
  const plan = useMemo(() => {
    const ok = d.flightLegs.filter((l) => l.a && l.b);
    let legs: PLeg[] = [];
    let clocks = ok.length > 0;
    let prevEnd = -Infinity;
    const mk = (l: typeof ok[number], start: number, end: number): PLeg => ({
      from: l.from, to: l.to, a: l.a!, b: l.b!, start, end, nm: l.nm,
      brg0: gcCourse(l.a!, l.b!, 0), brg1: gcCourse(l.a!, l.b!, 1),
      alt: legAltFor(l.nm), pitch: legPitchFor(l.nm), t0: 0, t1: 0,
    });
    for (const l of ok) {
      const s0 = clockMin(l.off), e0 = clockMin(l.on);
      if (s0 == null || e0 == null) { clocks = false; break; }
      let start = s0, end = e0;
      while (start < prevEnd) start += 1440;
      while (end <= start) end += 1440;
      legs.push(mk(l, start, end));
      prevEnd = end;
    }
    if (!clocks) {
      let t = 0;
      legs = ok.map((l) => {
        const dur = Math.max(10, Math.round(l.hours * 60));
        const leg = mk(l, t, t + dur);
        t += dur;
        return leg;
      });
    }
    const air = Math.max(1, legs.reduce((s, l) => s + l.end - l.start, 0));
    const secs = legs.map((l) => legSecFor(l.nm)), sum = secs.reduce((a, b) => a + b, 0), k = sum > MAX_FLY ? MAX_FLY / sum : 1;
    let t = INTRO;
    legs.forEach((l, i) => { l.t0 = t; l.t1 = t + Math.max(MIN_LEG, secs[i] * k); t = l.t1 + (i < legs.length - 1 ? GROUND : 0); });
    const flyEnd = legs.length ? t : 0;
    return { legs, clocks, air, flyEnd, total: legs.length ? flyEnd + REVEAL : 0, nm: legs.reduce((s, l) => s + l.nm, 0) };
  }, [d.flightLegs]);
  const { legs, flyEnd } = plan;
  const n = legs.length;

  const mapRef = useRef<MapView>(null);
  const pts = legs.flatMap((l) => [l.a, l.b]);
  const { ov, onMapReady } = useOverview(mapRef, pts, { top: insets.top + 110, right: 60, bottom: 200, left: 60 });
  const { t, playing, play, halt, seek } = useReplay(plan.total);

  // Uppspelningen börjar av sig själv när översikten är mätt.
  const started = useRef(false);
  useEffect(() => {
    if (ov && n && !started.current) { started.current = true; play(); }
  }, [ov, n, play]);

  // Var farkosten är vid tiden t: före start, på ett ben, på marken mellan två, eller framme.
  const S = useMemo(() => {
    if (!n) return null;
    const first = legs[0];
    if (t <= first.t0) return { i: 0, f: 0, lin: 0, ground: true, pre: true, g: null as number | null, pos: first.a, camH: first.brg0, alt: first.alt, pitch: first.pitch };
    for (let i = 0; i < n; i++) {
      const l = legs[i];
      if (t <= l.t1) {
        const lin = (t - l.t0) / (l.t1 - l.t0), f = lin * 0.85 + ease(lin) * 0.15;
        return { i, f, lin, ground: false, pre: false, g: null as number | null, pos: gcPoint(l.a, l.b, f), camH: gcCourse(l.a, l.b, f), alt: l.alt, pitch: l.pitch };
      }
      const next = legs[i + 1];
      if (next && t < next.t0) {
        const g = (t - l.t1) / (next.t0 - l.t1), e = ease(g);
        return {
          i, f: 1, lin: 1, ground: true, pre: false, g, pos: l.b, camH: angLerp(l.brg1, next.brg0, e),
          alt: lerp(l.alt, next.alt, e) * (1 - 0.12 * Math.sin(Math.PI * g)), pitch: lerp(l.pitch, next.pitch, e),
        };
      }
    }
    const last = legs[n - 1];
    return { i: n - 1, f: 1, lin: 1, ground: true, pre: false, g: null as number | null, pos: last.b, camH: last.brg1, alt: last.alt, pitch: last.pitch };
  }, [t, legs, n]);

  // Zoomen är en faktor på kamerans höjd (1 = som uppspelningen är tänkt). Knapparna ändrar den när som helst, och
  // nyper man i paus följer den nya zoomen med när uppspelningen fortsätter.
  const [zoomK, setZoomK] = useState(1);
  const [satellite, toggleSatellite] = useSatellitePref();

  // Kameran är en funktion av t, så den följer med både uppspelning och dragning i tidslinjen.
  const cam = useMemo<GeoCam | null>(() => {
    if (!ov || !S || !n) return null;
    let c: GeoCam;
    // Helikoptern hålls mitt i bild (lead 0), ovanför den låga panelen.
    if (t < INTRO) c = blendCam(ov, chaseCam(legs[0].a, legs[0].brg0, legs[0].alt, legs[0].pitch, 0), ease((t - 0.9) / (INTRO - 0.9)), true);
    else if (t <= flyEnd) c = chaseCam(S.pos, S.camH, S.alt, S.pitch, 0);
    else {
      const end = legs[n - 1];
      c = blendCam(chaseCam(end.b, end.brg1, end.alt, end.pitch, 0), ov, ease((t - flyEnd) / 2.6), true);
    }
    return { ...c, alt: c.alt * zoomK };
  }, [ov, S, t, legs, n, flyEnd, zoomK]);
  const [regionTick, setRegionTick] = useState(0);
  const camMode = useRef<'set' | 'animate' | 'skip'>('set');
  useEffect(() => {
    if (!cam) return;
    const mode = camMode.current;
    camMode.current = 'set';
    if (mode === 'skip') return;
    if (mode === 'animate') mapRef.current?.animateCamera(toCamera(cam), { duration: 300 });
    else mapRef.current?.setCamera(toCamera(cam));
  }, [cam]);
  const control = (fn: () => void) => fn();
  // I paus glider kameran till den nya zoomen; under uppspelningen tar nästa steg den.
  const zoomBy = (f: number) => {
    const next = clamp(zoomK * f, 0.25, 4);
    if (Math.abs(next - zoomK) < 1e-3) return;
    if (!playing) camMode.current = 'animate';
    setZoomK(next);
  };
  const onRegionDone = () => {
    mapRef.current?.getCamera().then((c) => {
      setRegionTick((v) => v + 1);
      if (playing || !cam || !c.altitude || Math.abs(c.altitude / cam.alt - 1) <= 0.02) return;
      const next = clamp((c.altitude / cam.alt) * zoomK, 0.25, 4);
      if (Math.abs(next - zoomK) < 1e-3) return;
      camMode.current = 'skip';
      setZoomK(next);
    }).catch(() => {});
  };

  // Linjerna ritas om åtta gånger i sekunden, inte varje steg (Apple-kartan flimrar annars).
  const step = Math.floor(t * 8);
  const lines = useMemo(() => {
    if (!S) return { flown: [] as GeoPt[][], future: [] as GeoPt[][], head: [] as GeoPt[] };
    const flown: GeoPt[][] = [], future: GeoPt[][] = [];
    let head: GeoPt[] = [];
    legs.forEach((l, j) => {
      if (j < S.i || (j === S.i && S.f >= 1)) flown.push(gcPath(l.a, l.b, 0, 1, l.nm));
      else if (j === S.i) {
        if (S.f > 0) flown.push(gcPath(l.a, l.b, 0, S.f, l.nm * S.f));
        future.push(gcPath(l.a, l.b, S.f, 1, l.nm * (1 - S.f)));
      } else future.push(gcPath(l.a, l.b, 0, 1, l.nm));
    });
    if (!S.ground) {
      // Den ljusa spetsen är en fast del av bilden, inte av benet: längre på långa ben där kameran är högre.
      const l = legs[S.i], hl = Math.min(S.f, Math.max(14, l.nm * 0.04) / Math.max(1, l.nm));
      head = Array.from({ length: 7 }, (_, k) => gcPoint(l.a, l.b, S.f - hl + (hl * k) / 6));
    }
    return { flown, future, head };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, legs]);
  const headColors = lines.head.map((_, k) => `rgba(230,251,255,${(k / 6).toFixed(2)})`);

  // Avslutningen: tre ljuspunkter löper längs hela rutten när kameran har dragit sig upp.
  const glow: GeoPt[] = [];
  const r = (t - flyEnd - 2.0) / 2.0;
  if (n && r > 0 && r < 1.2) {
    const total = plan.nm || 1;
    for (const off of [0, 0.1, 0.2]) {
      const want = (r - off) * total;
      if (want < 0 || want > total) continue;
      let acc = 0;
      for (const l of legs) {
        if (acc + l.nm >= want) { glow.push(gcPoint(l.a, l.b, (want - acc) / Math.max(1, l.nm))); break; }
        acc += l.nm;
      }
    }
  }

  const codes = n ? [legs[0].from, ...legs.map((l) => l.to)] : [];
  const stops = codes.map((k, i) => ({ k, p: i === 0 ? legs[0].a : legs[i - 1].b, at: i === 0 ? 0 : legs[i - 1].t1 }))
    .filter((x, i, arr) => arr.findIndex((y) => y.k === x.k) === i);
  const L = S ? legs[S.i] : null, next = S ? legs[S.i + 1] : undefined;
  const flownNm = S ? legs.reduce((s, l, j) => s + (j < S.i ? l.nm : j === S.i ? l.nm * S.f : 0), 0) : 0;
  const clockM = !S || !L ? 0 : S.pre ? legs[0].start : !S.ground ? lerp(L.start, L.end, S.f) : next && S.g != null ? lerp(L.end, next.start, S.g) : legs[n - 1].end;
  const status = !S || !L ? 'No route on the map' : S.pre ? `READY · ${legs[0].from}`
    : !S.ground ? `LEG ${S.i + 1} OF ${n} · ${L.from} → ${L.to}`
    : next && S.g != null ? `ON GROUND · ${L.to} · ${Math.round(next.start - L.end)} MIN`
    : `LANDED · ${legs[n - 1].to}`;
  // Nosen pekar dit farkosten flyger på skärmen, mätt på kartan (åtta gånger i sekunden och när man flyttat kartan).
  const acAngle = useScreenAngle(mapRef, S ? S.pos : null, S ? S.camH : 0, Math.max(2000, (cam?.alt ?? 20000) * 0.04), `${step}-${regionTick}`);
  const lift = S && !S.ground ? (4 + 12 * ((cam?.pitch ?? 0) / PITCH)) * Math.pow(Math.sin(Math.PI * clamp(S.lin, 0, 1)), 0.35) + 2 : 2;
  const rv = clamp((t - flyEnd - 1.4) / 0.7, 0, 1);
  // Svagare dimma än förut, så satellitbilden syns mot horisonten.
  const fog = ((cam?.pitch ?? 0) / PITCH) * 0.6;
  const title = `${Math.round(d.distanceNm || plan.nm)} NM · ${d.dateShort}${d.aircraftType ? ` · ${d.aircraftType}` : ''}`;

  // Tidslinjen går att dra i (den täcker flygningen, inte titeln och sammanfattningen).
  const [trackW, setTrackW] = useState(1);
  const trackRef = useRef({ w: 1, a: 0, b: 1 });
  trackRef.current = { w: trackW, a: INTRO, b: flyEnd || 1 };
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const haltRef = useRef(halt);
  haltRef.current = halt;
  const toT = (x: number) => { const s = trackRef.current; return s.a + clamp(x / s.w, 0, 1) * (s.b - s.a); };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { haltRef.current(); seekRef.current(toT(e.nativeEvent.locationX)); },
    onPanResponderMove: (e) => { seekRef.current(toT(e.nativeEvent.locationX)); },
  })).current;
  const span = Math.max(0.01, flyEnd - INTRO), knob = clamp((t - INTRO) / span, 0, 1);

  return (
    <View style={{ flex: 1, backgroundColor: REPLAY_BG }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={regionFor(pts)}
        onMapReady={onMapReady}
        mapType={satellite ? 'hybrid' : 'mutedStandard'}
        userInterfaceStyle="dark"
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsCompass={false}
        showsTraffic={false}
        toolbarEnabled={false}
        scrollEnabled={!playing}
        zoomEnabled={!playing}
        rotateEnabled
        pitchEnabled
        onRegionChangeComplete={onRegionDone}
      >
        {lines.future.map((seg, i) => (
          <Polyline key={`f${i}`} coordinates={seg.map(toLatLng)} strokeColor="rgba(0,200,232,0.4)" strokeWidth={1.8} lineDashPattern={[6, 7]} />
        ))}
        {lines.flown.map((seg, i) => (
          <Polyline key={`g${i}`} coordinates={seg.map(toLatLng)} strokeColor="rgba(0,200,232,0.18)" strokeWidth={11} lineCap="round" lineJoin="round" />
        ))}
        {lines.flown.map((seg, i) => (
          <Polyline key={`c${i}`} coordinates={seg.map(toLatLng)} strokeColor={MAP_CYAN} strokeWidth={3} lineCap="round" lineJoin="round" />
        ))}
        {lines.head.length > 1 ? <Polyline coordinates={lines.head.map(toLatLng)} strokeColors={headColors} strokeWidth={2.8} lineCap="round" /> : null}
        {stops.map((x) => <StopMarker key={x.k} p={x.p} code={x.k} visited={t >= x.at} onRoute={labelsOnRoute(cam, ov)} />)}
        {legs.map((l, j) => (t >= l.t1 && t - l.t1 < 1.5 ? <RippleMarker key={`r${j}`} p={l.b} /> : null))}
        {glow.map((p, i) => <GlowDot key={`d${i}`} p={p} />)}
        {S && rv < 1 ? <ReplayAircraft p={S.pos} heli={d.heli} heading={acAngle} spinning={playing && !S.ground} lift={lift} /> : null}
      </MapView>
      <ReplayShade fog={fog} fadeH={210} />
      <TitleCard t={t} top={insets.top + 190} cap={sub ? 'CROSS-COUNTRY' : 'LONGEST CROSS-COUNTRY'}
        title={n ? `${legs[0].from} → ${legs[n - 1].to}` : ''} sub={title} />

      <MapControls top={insets.top + 64} satellite={satellite} onToggle={toggleSatellite}
        onZoomIn={() => zoomBy(ZOOM_STEP)} onZoomOut={() => zoomBy(1 / ZOOM_STEP)} />

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close the map">
          <Glass style={s.close}><Ionicons name="close" size={18} color={Colors.textPrimary} /></Glass>
        </Pressable>
        <Glass style={[s.titlePill, { opacity: clamp((t - 2.2) / 0.6, 0, 1) }]}>
          <Text numberOfLines={1} style={s.titleText}>{codes.join(' → ')}</Text>
          <Text numberOfLines={1} style={s.titleSub}>{title}</Text>
        </Glass>
      </View>

      <Glass style={[s.panel, { bottom: insets.bottom + 8, height: 124 + 66 * rv }]}>
        <View pointerEvents={rv > 0.5 ? 'none' : 'auto'} style={[s.panelIn, { opacity: 1 - rv }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => control(() => (playing ? halt() : play()))} disabled={!n} style={[s.play, !n && { opacity: 0.4 }]}
              accessibilityLabel={playing ? 'Pause the replay' : 'Replay the day'}>
              <Ionicons name={playing ? 'pause' : 'play'} size={16} color={Colors.textInverse} />
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
              <Text style={s.big}>{Math.round(flownNm)}</Text>
              <Text numberOfLines={1} style={s.unit}>/ {Math.round(plan.nm)} NM</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1 }}>
              <Text style={s.cap}>TIME</Text>
              <Text style={s.val}>{plan.clocks ? `${clock(clockM)}Z` : clock(clockM)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1, minWidth: 50 }}>
              <Text style={s.cap}>GS</Text>
              <Text style={s.val}>{S && L && !S.ground ? `${Math.round(L.nm / Math.max(1 / 60, (L.end - L.start) / 60))} kt` : S?.pre ? '—' : '0 kt'}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Text numberOfLines={1} style={s.status}>{status}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {legs.map((l, j) => {
                const now = !!S && !S.ground && j === S.i, done = t >= l.t1;
                return <View key={`dot${j}`} style={{ width: now ? 14 : 5, height: 5, borderRadius: 2.5, backgroundColor: done || now ? MAP_CYAN : '#2A3B50', opacity: done && !now ? 0.8 : 1 }} />;
              })}
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <View style={s.track} onLayout={(e) => setTrackW(Math.max(1, e.nativeEvent.layout.width))} {...pan.panHandlers}
              accessible accessibilityRole="adjustable" accessibilityLabel="Replay the day"
              accessibilityValue={{ text: plan.clocks ? `${clock(clockM)} UTC` : clock(clockM) }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => { halt(); seekRef.current(t + (e.nativeEvent.actionName === 'increment' ? 1 : -1) * span / 20); }}>
              <View pointerEvents="none" style={s.trackBase} />
              {legs.map((l, j) => (
                <View key={`seg${j}`} pointerEvents="none" style={[s.seg, { left: `${((l.t0 - INTRO) / span) * 100}%`, width: `${((l.t1 - l.t0) / span) * 100}%` }]}>
                  <View style={{ height: '100%', width: `${clamp((t - l.t0) / (l.t1 - l.t0), 0, 1) * 100}%`, backgroundColor: MAP_CYAN }} />
                </View>
              ))}
              <View pointerEvents="none" style={[s.knob, { left: knob * trackW - 8 }]} />
            </View>
            <View style={{ height: 11 }}>
              {stops.map((x, i) => {
                const p = i === 0 ? 0 : clamp((x.at - INTRO) / span, 0, 1), lastOne = i === stops.length - 1;
                return (
                  <Text key={`tick${x.k}`} style={[s.tick, { color: t >= x.at ? '#DCE4EE' : '#5D6C7D', textAlign: i === 0 ? 'left' : lastOne ? 'right' : 'center' },
                    i === 0 ? { left: 0 } : lastOne ? { right: 0 } : { left: p * trackW - 17 }]}>{x.k}</Text>
                );
              })}
            </View>
          </View>
        </View>

        <View pointerEvents={rv > 0.5 ? 'auto' : 'none'} style={[s.panelIn, { opacity: rv, transform: [{ translateY: (1 - rv) * 12 }] }]}>
          <Text style={[s.cap, { color: MAP_CYAN, letterSpacing: 2 }]}>{sub ? 'CROSS-COUNTRY' : 'YOUR LONGEST CROSS-COUNTRY'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={s.huge}>{Math.round(d.distanceNm || plan.nm)}</Text>
            <Text style={[s.unit, { fontSize: 13 }]}>NM</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[[String(n), n === 1 ? 'leg' : 'legs'], [hm(plan.air), 'airborne'], [n ? hm(legs[n - 1].end - legs[0].start) : '—', 'on the day']].map(([v, lbl]) => (
              <View key={lbl} style={s.fact}>
                <Text numberOfLines={1} style={s.factVal}>{v}</Text>
                <Text numberOfLines={1} style={s.factLbl}>{lbl}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={() => control(play)} style={s.replay} accessibilityRole="button">
            <Ionicons name="refresh" size={13} color={MAP_CYAN} />
            <Text style={s.replayText}>Replay the day</Text>
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  titlePill: { flex: 1, minHeight: 44, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 22, justifyContent: 'center', gap: 1 },
  titleText: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: Colors.textPrimary },
  titleSub: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
  panel: { position: 'absolute', left: 12, right: 12 },
  panelIn: { position: 'absolute', left: 14, right: 14, top: 12, bottom: 10, justifyContent: 'space-between' },
  cap: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.4, color: '#6E7D8F' },
  big: { fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: MAP_CYAN, lineHeight: 30 },
  huge: { fontFamily: SERIF, fontSize: 46, fontWeight: '600', color: Colors.textPrimary, lineHeight: 48, letterSpacing: -1 },
  unit: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: '#A7B3C2' },
  val: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  status: { flexShrink: 1, fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, color: '#DCE4EE' },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: MAP_CYAN, alignItems: 'center', justifyContent: 'center' },
  track: { height: 18, justifyContent: 'center' },
  trackBase: { position: 'absolute', left: 0, right: 0, top: 8.5, height: 1, backgroundColor: '#2A3B50' },
  seg: { position: 'absolute', top: 5, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#22364C' },
  knob: { position: 'absolute', top: 1, width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: MAP_CYAN },
  tick: { position: 'absolute', top: 0, width: 34, fontFamily: MONO, fontSize: 8, fontWeight: '700' },
  fact: { flex: 1, gap: 2, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  factVal: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  factLbl: { fontFamily: MONO, fontSize: 9, color: '#A7B3C2' },
  replay: { alignSelf: 'flex-start', minHeight: 34, paddingLeft: 11, paddingRight: 14, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,200,232,0.5)', backgroundColor: 'rgba(0,200,232,0.1)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  replayText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: Colors.textPrimary },
});
