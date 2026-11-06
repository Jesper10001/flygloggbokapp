// Best week i helskärm på Apple-kartan, uppspelad som en film i kapitel (designvyns "Map replay v3"). Veckans titel
// tonar in över översikten, sedan dag för dag: dagens namn glider in och kameran följer varje resa för sig, mitt i bild,
// på en höjd efter resans längd (som Longest XC), så en kort och en lång resa samma dag båda går att följa. Mellan
// resorna glider kameran över till nästa. Dagar med bara lokala flygningar zoomar in på basen, vilodagar blinkar förbi.
// Till sist drar kameran sig upp till hela veckan, ljuspunkter löper längs alla resor och sammanfattningen kommer upp.
// Ett tryck på en dag hoppar dit. Medan kartan är öppen väntar appens popup-rutor (useMapScreenStore), annars kan
// skärmen låsa sig.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline, Circle as MapCircle, type LatLng } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useBestWeekFull } from '../../hooks/useMilestoneDetails';
import { useMapScreenStore } from '../../store/mapScreenStore';
import { getAircraftCategory } from '../../db/flights';
import { alongArc, regionFor, toLatLng, nmBetween, MAP_CYAN, type GeoPt } from '../../components/milestones/MilestoneMap';
import {
  useReplay, useOverview, blendCam, chaseCam, toCamera, ease, clamp, lerp, gcPath,
  StopMarker, labelsOnRoute, RippleMarker, GlowDot, ReplayAircraft, ReplayShade, Glass, TitleCard, MapControls, useSatellitePref, useScreenAngle,
  REPLAY_BG, type GeoCam,
} from '../../components/milestones/ReplayKit';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Kapitlens tider i sekunder: titeln, dagens inledning, glidningen mellan två resor, en lokal dag, en vilodag, slutet.
const INTRO = 2.6, DAY_IN = 1.6, GAP = 1.2, DAY_OUT = 0.6, LOCAL = 2.4, REST = 0.8, FINALE = 4.2, PITCH = 52, ZOOM_STEP = 0.7;
// Samma anpassning efter avstånd som Longest XC: tiden växer med roten ur avståndet (veckans resor högst 70 s
// tillsammans), kamerans höjd följer resans längd och lutningen minskar på långa resor. Lokala dagar ses från 28 km.
const MIN_TRIP = 3.5, MAX_TRIPS = 70, LOCAL_ALT = 28000;
const tripSecFor = (nm: number) => clamp(4 + 1.8 * Math.sqrt(nm / 50), 4.5, 11);
const altFor = (nm: number) => clamp(nm * 1852 * 0.38, 15000, 2500000);
const pitchFor = (nm: number) => lerp(PITCH, 36, clamp((nm - 100) / 900, 0, 1));

function hhmm(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function dayParts(iso: string): { name: string; date: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return { name: DOW_LONG[dt.getDay()], date: `${dt.getDate()} ${MONTH_LONG[dt.getMonth()]}` };
}

// path: resan i raka sträck längs storcirkeln, som i Longest XC.
interface Trip { key: string; day: number; from: string; to: string; path: LatLng[]; nm: number; type: string; t0: number; t1: number; alt: number; pitch: number }
interface Chapter { day: number; kind: 'fly' | 'local' | 'rest'; t0: number; t1: number }
// Kameran som en följd av avsnitt: stå still, glida mellan två kameror, eller följa en resa.
type Seg = { t0: number; t1: number } & ({ kind: 'hold'; c: GeoCam } | { kind: 'blend'; a: GeoCam; b: GeoCam } | { kind: 'chase'; trip: Trip });

const fracOf = (x: Trip, t: number) => { const lin = clamp((t - x.t0) / (x.t1 - x.t0), 0, 1); return lin * 0.85 + ease(lin) * 0.15; };
const tripCam = (x: Trip, f: number): GeoCam => { const p = alongArc(x.path, f); return chaseCam(p.p, p.heading, x.alt, x.pitch, 0); };

export default function BestWeekMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ week?: string; label?: string; hours?: string }>();
  const d = useBestWeekFull(params.week, params.label ?? '', parseFloat(params.hours ?? '') || 0);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    useMapScreenStore.setState({ open: true });
    return () => { useMapScreenStore.setState({ open: false }); };
  }, []);

  const coords = d.geo?.coords ?? {};
  const home = d.geo?.home && coords[d.geo.home] ? d.geo.home : null;

  // Resorna (inte lokala flygningar) och kapitlen, en per dag, med sina tider.
  const plan = useMemo(() => {
    const trips: Trip[] = [];
    d.days.forEach((day, i) => {
      for (const f of day.flights) {
        if (f.local || !coords[f.dep] || !coords[f.arr]) continue;
        const nm = nmBetween(coords[f.dep], coords[f.arr]);
        trips.push({ key: `${f.id}`, day: i, from: f.dep, to: f.arr, path: gcPath(coords[f.dep], coords[f.arr], 0, 1, nm).map(toLatLng), nm, type: f.aircraftType, t0: 0, t1: 0, alt: altFor(nm), pitch: pitchFor(nm) });
      }
    });
    const secs = trips.map((x) => tripSecFor(x.nm)), sum = secs.reduce((a, b) => a + b, 0), k = sum > MAX_TRIPS ? MAX_TRIPS / sum : 1;
    const chapters: Chapter[] = [];
    let t = INTRO, ti = 0;
    d.days.forEach((day, i) => {
      const t0 = t, list = trips.filter((x) => x.day === i);
      if (list.length) {
        t += DAY_IN;
        list.forEach((x, j) => {
          const sec = Math.max(MIN_TRIP, secs[ti++] * k);
          x.t0 = t; x.t1 = t + sec;
          t = x.t1 + (j < list.length - 1 ? GAP : DAY_OUT);
        });
        chapters.push({ day: i, kind: 'fly', t0, t1: t });
      } else if (day.hours > 0) { t += LOCAL; chapters.push({ day: i, kind: 'local', t0, t1: t }); }
      else { t += REST; chapters.push({ day: i, kind: 'rest', t0, t1: t }); }
    });
    return { trips, chapters, fin: t, total: d.days.length ? t + FINALE : 0 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.days, d.geo]);
  const { trips, chapters, fin } = plan;
  const totalNm = trips.reduce((s, x) => s + x.nm, 0);
  const weekH = d.days.reduce((s, x) => s + x.hours, 0);

  // Helikopter eller plan per farkosttyp, ur flottan.
  const [heliTypes, setHeliTypes] = useState<Record<string, boolean>>({});
  const typeKey = [...new Set(trips.map((x) => x.type).filter(Boolean))].sort().join('|');
  useEffect(() => {
    let alive = true;
    const types = typeKey ? typeKey.split('|') : [];
    Promise.all(types.map(async (x) => [x, (await getAircraftCategory(x).catch(() => '')) === 'helicopter'] as const))
      .then((rows) => { if (alive) setHeliTypes(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [typeKey]);

  const airports = [...new Set(trips.flatMap((x) => [x.from, x.to]).concat(home ? [home] : []))];
  const pts: GeoPt[] = airports.length ? airports.map((k) => coords[k]) : Object.values(coords);
  const { ov, onMapReady } = useOverview(mapRef, pts, { top: insets.top + 110, right: 60, bottom: 200, left: 50 });
  const { t, playing, play, halt, seek } = useReplay(plan.total);
  const started = useRef(false);
  useEffect(() => {
    if (ov && chapters.length && !started.current) { started.current = true; play(); }
  }, [ov, chapters.length, play]);

  // Kamerans avsnitt för hela veckan.
  const segs = useMemo<Seg[] | null>(() => {
    if (!ov) return null;
    const base = home ? coords[home] : pts[0];
    const out: Seg[] = [{ kind: 'hold', t0: 0, t1: INTRO, c: ov }];
    let prev: GeoCam = ov;
    for (const ch of chapters) {
      if (ch.kind === 'fly') {
        const list = trips.filter((x) => x.day === ch.day);
        out.push({ kind: 'blend', t0: ch.t0, t1: ch.t0 + DAY_IN, a: prev, b: tripCam(list[0], 0) });
        list.forEach((x, j) => {
          out.push({ kind: 'chase', t0: x.t0, t1: x.t1, trip: x });
          const end = tripCam(x, 1), nextT = j < list.length - 1 ? list[j + 1].t0 : ch.t1;
          out.push(j < list.length - 1 ? { kind: 'blend', t0: x.t1, t1: nextT, a: end, b: tripCam(list[j + 1], 0) } : { kind: 'hold', t0: x.t1, t1: nextT, c: end });
          prev = end;
        });
      } else if (ch.kind === 'local' && base) {
        const c: GeoCam = { lat: base.lat, lon: base.lon, alt: LOCAL_ALT, heading: 0, pitch: 30 };
        out.push({ kind: 'blend', t0: ch.t0, t1: ch.t0 + 1.0, a: prev, b: c });
        out.push({ kind: 'hold', t0: ch.t0 + 1.0, t1: ch.t1, c });
        prev = c;
      } else out.push({ kind: 'hold', t0: ch.t0, t1: ch.t1, c: prev });
    }
    out.push({ kind: 'blend', t0: fin, t1: fin + 2.2, a: prev, b: ov });
    out.push({ kind: 'hold', t0: fin + 2.2, t1: Infinity, c: ov });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, plan]);

  // Zoomen är en faktor på kamerans höjd, som i Longest XC.
  const [zoomK, setZoomK] = useState(1);
  const [satellite, toggleSatellite] = useSatellitePref();
  const cam = useMemo<GeoCam | null>(() => {
    if (!segs) return null;
    const sg = segs.find((x) => t >= x.t0 && t < x.t1) ?? segs[segs.length - 1];
    const c = sg.kind === 'hold' ? sg.c
      : sg.kind === 'blend' ? blendCam(sg.a, sg.b, ease((t - sg.t0) / Math.max(0.01, sg.t1 - sg.t0)), true)
      : tripCam(sg.trip, fracOf(sg.trip, t));
    return { ...c, alt: c.alt * zoomK };
  }, [segs, t, zoomK]);
  const camMode = useRef<'set' | 'animate' | 'skip'>('set');
  useEffect(() => {
    if (!cam) return;
    const mode = camMode.current;
    camMode.current = 'set';
    if (mode === 'skip') return;
    if (mode === 'animate') mapRef.current?.animateCamera(toCamera(cam), { duration: 300 });
    else mapRef.current?.setCamera(toCamera(cam));
  }, [cam]);
  const zoomBy = (f: number) => {
    const next = clamp(zoomK * f, 0.25, 4);
    if (Math.abs(next - zoomK) < 1e-3) return;
    if (!playing) camMode.current = 'animate';
    setZoomK(next);
  };
  const [regionTick, setRegionTick] = useState(0);
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

  const chIdx = chapters.findIndex((c) => t >= c.t0 && t < c.t1);
  const ch = chIdx >= 0 ? chapters[chIdx] : null;
  const done = t >= fin;
  const active = trips.find((x) => t >= x.t0 && t < x.t1) ?? null;
  const af = active ? fracOf(active, t) : 0;

  // Linjerna ritas om åtta gånger i sekunden, inte varje steg (Apple-kartan flimrar annars).
  const step = Math.floor(t * 8);
  const lines = useMemo(() => {
    const bright: LatLng[][] = [], dim: LatLng[][] = [], next: LatLng[][] = [];
    let head: LatLng[] = [];
    for (const x of trips) {
      if (done) { bright.push(x.path); continue; }
      if (t >= x.t1) (ch && x.day === ch.day ? bright : dim).push(x.path);
      else if (x === active) {
        const n = x.path.length - 1, cut = Math.min(n, Math.floor(af * n) + 1);
        const tip = alongArc(x.path, af).p;
        bright.push([...x.path.slice(0, cut), toLatLng(tip)]);
        next.push([toLatLng(tip), ...x.path.slice(cut)]);
        const hl = Math.min(af, Math.max(10, x.nm * 0.04) / Math.max(1, x.nm), 0.3);
        head = Array.from({ length: 7 }, (_, k) => toLatLng(alongArc(x.path, af - hl + (hl * k) / 6).p));
      } else if (ch && x.day === ch.day) next.push(x.path);
    }
    return { bright, dim, next, head };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, trips]);
  const headColors = lines.head.map((_, k) => `rgba(230,251,255,${(k / 6).toFixed(2)})`);

  // Flygplatser som syns: basen, de man varit på, och dagens nästa mål (gråa).
  const seen: Record<string, 1 | 2> = {};
  if (home) seen[home] = 2;
  for (const x of trips) {
    if (done || t >= x.t0) seen[x.from] = 2;
    if (done || t >= x.t1) seen[x.to] = 2;
    else if (ch && x.day === ch.day && !seen[x.to]) seen[x.to] = 1;
  }

  // Farkosten under en flygdag: på resan, på marken där den senaste resan landade, eller vid dagens första avgång.
  const dayTrips = ch && ch.kind === 'fly' ? trips.filter((x) => x.day === ch.day) : [];
  const lastDone = [...dayTrips].reverse().find((x) => t >= x.t1) ?? null;
  const plane = active ? alongArc(active.path, af)
    : lastDone ? alongArc(lastDone.path, 1)
    : dayTrips.length && t >= ch!.t0 + DAY_IN * 0.5 ? alongArc(dayTrips[0].path, 0) : null;
  const planeType = (active ?? lastDone ?? dayTrips[0])?.type ?? '';
  const acAngle = useScreenAngle(mapRef, plane ? plane.p : null, plane ? plane.heading : 0, Math.max(2000, (cam?.alt ?? 20000) * 0.04), `${step}-${regionTick}`);
  const lift = active ? (4 + 12 * ((cam?.pitch ?? 0) / PITCH)) * Math.pow(Math.sin(Math.PI * clamp((t - active.t0) / (active.t1 - active.t0), 0, 1)), 0.35) + 2 : 2;
  const pulses = done && t > fin + 1.6 ? trips.map((x, k) => alongArc(x.path, ((t - fin) * 0.4 + k * 0.137) % 1).p) : [];

  const nmSoFar = done ? totalNm : trips.reduce((s, x) => s + (t >= x.t1 ? x.nm : x === active ? x.nm * af : 0), 0);
  const hSoFar = done ? weekH : chapters.reduce((s, c) => s + (t >= c.t1 ? d.days[c.day].hours : t >= c.t0 ? d.days[c.day].hours * ((t - c.t0) / (c.t1 - c.t0)) : 0), 0);
  const tripsDone = trips.filter((x) => done || t >= x.t1).length;
  const maxDay = Math.max(0.1, ...d.days.map((x) => x.hours));
  const busiest = d.days.reduce<typeof d.days[number] | null>((b, x) => (!b || x.hours > b.hours ? x : b), null);
  const rv = clamp((t - fin - 1.4) / 0.7, 0, 1);
  const fog = ((cam?.pitch ?? 0) / PITCH) * 0.6;
  const weekTitle = (params.label ?? '').replace('W', 'Week ');

  let dayCard: { o: number; name: string; sub: string } | null = null;
  if (ch) {
    const day = d.days[ch.day], dp = dayParts(day.iso), span = ch.t1 - ch.t0, k = t - ch.t0;
    const ldg = day.flights.filter((f) => f.local).reduce((s, f) => s + (f.landings || 0), 0);
    // Under en flygdag tonar namnet bort när första resan börjat, så kartan syns.
    const hold = ch.kind === 'fly' ? Math.min(span, DAY_IN + 1.2) : span;
    dayCard = {
      o: clamp(Math.min(k / 0.3, (hold - k) / 0.4), 0, 1), name: dp.name,
      sub: `${dp.date} · ${ch.kind === 'fly' ? `${[dayTrips[0].from, ...dayTrips.map((x) => x.to)].join(' → ')} · ${hhmm(day.hours)}`
        : ch.kind === 'local' ? `Local flights · ${hhmm(day.hours)}${ldg ? ` · ${ldg} ${ldg === 1 ? 'landing' : 'landings'}` : ''}` : 'Rest day'}`,
    };
  }

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
        {home ? <MapCircle center={toLatLng(coords[home])} radius={18520} strokeColor="rgba(0,200,232,0.45)" strokeWidth={1.2} fillColor="rgba(0,200,232,0.04)" lineDashPattern={[3, 4]} /> : null}
        {lines.dim.map((c, i) => <Polyline key={`d${i}`} coordinates={c} strokeColor="rgba(0,200,232,0.32)" strokeWidth={1.8} lineCap="round" />)}
        {lines.next.map((c, i) => <Polyline key={`n${i}`} coordinates={c} strokeColor="rgba(0,200,232,0.32)" strokeWidth={1.6} lineDashPattern={[5, 7]} />)}
        {lines.bright.map((c, i) => <Polyline key={`g${i}`} coordinates={c} strokeColor="rgba(0,200,232,0.18)" strokeWidth={11} lineCap="round" lineJoin="round" />)}
        {lines.bright.map((c, i) => <Polyline key={`b${i}`} coordinates={c} strokeColor={MAP_CYAN} strokeWidth={2.8} lineCap="round" lineJoin="round" />)}
        {lines.head.length > 1 ? <Polyline coordinates={lines.head} strokeColors={headColors} strokeWidth={2.6} lineCap="round" /> : null}
        {airports.filter((k) => seen[k]).map((k) => <StopMarker key={k} p={coords[k]} code={k} visited={seen[k] === 2} onRoute={labelsOnRoute(cam, ov)} />)}
        {trips.map((x) => (t >= x.t1 && t - x.t1 < 1.5 ? <RippleMarker key={`r${x.key}`} p={coords[x.to]} /> : null))}
        {ch && ch.kind === 'local' && home && t >= ch.t0 + 0.9 ? <RippleMarker key={`l${ch.day}`} p={coords[home]} /> : null}
        {pulses.map((p, i) => <GlowDot key={`p${i}`} p={p} />)}
        {plane && rv < 1 ? (
          <ReplayAircraft p={plane.p} heli={!!heliTypes[planeType]} heading={acAngle} spinning={playing && !!active} lift={lift} />
        ) : null}
      </MapView>
      <ReplayShade fog={fog} fadeH={200} />
      <TitleCard t={t} top={insets.top + 180} cap="YOUR BEST WEEK" title={`${hhmm(weekH)} h`} sub={`${weekTitle} · ${d.rangeLabel}`} />
      {dayCard && dayCard.o > 0 ? (
        <View pointerEvents="none" style={[s.dayCard, { top: insets.top + 64, opacity: dayCard.o, transform: [{ translateY: (1 - dayCard.o) * -8 }] }]}>
          <Text style={s.dayName}>{dayCard.name}</Text>
          <Text numberOfLines={1} style={s.daySub}>{dayCard.sub}</Text>
        </View>
      ) : null}

      <MapControls top={insets.top + 64} satellite={satellite} onToggle={toggleSatellite}
        onZoomIn={() => zoomBy(ZOOM_STEP)} onZoomOut={() => zoomBy(1 / ZOOM_STEP)} />

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close the map">
          <Glass style={s.close}><Ionicons name="close" size={18} color={Colors.textPrimary} /></Glass>
        </Pressable>
        <Glass style={[s.titlePill, { opacity: dayCard && dayCard.o > 0 ? 0 : clamp((t - 1.8) / 0.5, 0, 1) }]}>
          <Text style={s.titleText}>{weekTitle}</Text>
          <Text style={s.titleSub}>{d.rangeLabel}</Text>
        </Glass>
      </View>

      <Glass style={[s.panel, { bottom: insets.bottom + 8, height: 112 + 74 * rv }]}>
        <View pointerEvents={rv > 0.5 ? 'none' : 'auto'} style={[s.panelIn, { opacity: 1 - rv }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => (playing ? halt() : play())} disabled={!chapters.length} style={[s.play, !chapters.length && { opacity: 0.4 }]}
              accessibilityLabel={playing ? 'Pause the replay' : 'Replay the week'}>
              <Ionicons name={playing ? 'pause' : 'play'} size={16} color={Colors.textInverse} />
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
              <Text style={s.big}>{Math.round(nmSoFar)}</Text>
              <Text style={s.unit}>NM</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1 }}>
              <Text style={s.cap}>HOURS</Text>
              <Text style={s.val}>{hhmm(hSoFar)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1, minWidth: 48 }}>
              <Text style={s.cap}>TRIPS</Text>
              <Text style={s.val}>{tripsDone} / {trips.length}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {d.days.map((x, i) => {
              const c = chapters[i], on = chIdx === i, past = done || (!!c && t >= c.t1), rest = x.hours <= 0;
              const dp = dayParts(x.iso);
              return (
                <Pressable key={x.iso} onPress={() => { if (c) seek(c.t0); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${dp.name} ${dp.date}, ${rest ? 'no flying' : `${hhmm(x.hours)} hours`}. Jump to this day`}
                  style={[s.chip, { borderColor: on ? MAP_CYAN : 'rgba(255,255,255,0.08)', backgroundColor: on ? 'rgba(0,200,232,0.14)' : 'transparent' }]}>
                  <Text style={[s.chipDow, { color: on ? MAP_CYAN : past && !rest ? Colors.textPrimary : '#5D6C7D' }]}>{x.dow.charAt(0)}</Text>
                  <View style={{ width: 14, borderRadius: 1.5, height: rest ? 2 : Math.max(3, (x.hours / maxDay) * 10), backgroundColor: rest ? '#2A3B50' : past || on ? MAP_CYAN : '#1F4A66' }} />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View pointerEvents={rv > 0.5 ? 'auto' : 'none'} style={[s.panelIn, { opacity: rv, transform: [{ translateY: (1 - rv) * 12 }] }]}>
          <Text style={[s.cap, { color: MAP_CYAN, letterSpacing: 2 }]}>{weekTitle.toUpperCase()} IN THE AIR</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={s.huge}>{Math.round(totalNm)}</Text>
            <Text style={[s.unit, { fontSize: 13 }]}>NM</Text>
            {busiest && busiest.hours > 0 ? <Text numberOfLines={1} style={[s.factLbl, { marginLeft: 'auto', fontSize: 10 }]}>Busiest: {dayParts(busiest.iso).name} {hhmm(busiest.hours)}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[[`${hhmm(weekH)} h`, 'in the air'], [String(trips.length), trips.length === 1 ? 'trip' : 'trips'], [String(airports.length), airports.length === 1 ? 'airport' : 'airports']].map(([v, lbl]) => (
              <View key={lbl} style={s.fact}>
                <Text numberOfLines={1} style={s.factVal}>{v}</Text>
                <Text numberOfLines={1} style={s.factLbl}>{lbl}</Text>
              </View>
            ))}
          </View>
          <Pressable onPress={play} style={s.replay} accessibilityRole="button">
            <Ionicons name="refresh" size={13} color={MAP_CYAN} />
            <Text style={s.replayText}>Replay the week</Text>
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  titlePill: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 22, justifyContent: 'center', gap: 1 },
  titleText: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: Colors.textPrimary },
  titleSub: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
  dayCard: { position: 'absolute', left: 20, right: 70, alignItems: 'center', gap: 4 },
  dayName: { fontFamily: SERIF, fontSize: 28, fontWeight: '600', color: Colors.textPrimary, textShadowColor: '#000', textShadowRadius: 8 },
  daySub: { fontFamily: MONO, fontSize: 10.5, color: '#A7B3C2', textShadowColor: '#000', textShadowRadius: 6 },
  panel: { position: 'absolute', left: 12, right: 12 },
  panelIn: { position: 'absolute', left: 14, right: 14, top: 12, bottom: 10, justifyContent: 'space-between' },
  cap: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.4, color: '#6E7D8F' },
  big: { fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: MAP_CYAN, lineHeight: 30 },
  huge: { fontFamily: SERIF, fontSize: 44, fontWeight: '600', color: Colors.textPrimary, lineHeight: 46, letterSpacing: -1 },
  unit: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: '#A7B3C2' },
  val: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: MAP_CYAN, alignItems: 'center', justifyContent: 'center' },
  chip: { flex: 1, height: 38, paddingVertical: 5, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'space-between' },
  chipDow: { fontFamily: MONO, fontSize: 9, fontWeight: '700' },
  fact: { flex: 1, gap: 2, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  factVal: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  factLbl: { fontFamily: MONO, fontSize: 9, color: '#A7B3C2' },
  replay: { alignSelf: 'flex-start', minHeight: 34, paddingLeft: 11, paddingRight: 14, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,200,232,0.5)', backgroundColor: 'rgba(0,200,232,0.1)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  replayText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: Colors.textPrimary },
});
