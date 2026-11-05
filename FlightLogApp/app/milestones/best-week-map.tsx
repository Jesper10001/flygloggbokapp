// Best week i helskärm på Apple-kartan, uppspelad som en film i kapitel (designvyns "Map replay v3"). Veckans titel
// tonar in över översikten, sedan dag för dag: dagens namn glider in, kameran flyger till dagens flygplatser (lutad,
// lätt vriden) och resorna flygs en i taget med glöd och en ljus spets, med en ring som pulserar vid varje landning.
// Dagar med bara lokala flygningar pulserar runt basen och vilodagar blinkar förbi. Till sist drar kameran sig upp
// till hela veckan, ljuspunkter löper längs alla bågar och sammanfattningen kommer upp. Ett tryck på en dag hoppar
// dit. Medan kartan är öppen väntar appens popup-rutor (useMapScreenStore), annars kan skärmen låsa sig.

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
import { arcCoords, alongArc, regionFor, toLatLng, nmBetween, headingDeg, MAP_CYAN, type GeoPt } from '../../components/milestones/MilestoneMap';
import {
  useReplay, useOverview, blendCam, offsetPt, spanKm, toCamera, ease, clamp,
  StopMarker, RippleMarker, GlowDot, ReplayAircraft, ReplayShade, Glass, TitleCard, REPLAY_BG, type GeoCam,
} from '../../components/milestones/ReplayKit';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Kapitlens tider i sekunder.
const INTRO = 2.3, DAY_IN = 1.0, TRIP = 1.55, GAP = 0.3, LOCAL = 1.4, REST = 0.55, FINALE = 3.8, PITCH = 40;

function hhmm(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function dayParts(iso: string): { name: string; date: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return { name: DOW_LONG[dt.getDay()], date: `${dt.getDate()} ${MONTH_LONG[dt.getMonth()]}` };
}
const ptOf = (c: LatLng): GeoPt => ({ lat: c.latitude, lon: c.longitude });

interface Trip { key: string; day: number; from: string; to: string; arc: LatLng[]; nm: number; type: string; t0: number; t1: number }
interface Chapter { day: number; kind: 'fly' | 'local' | 'rest'; t0: number; t1: number }

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
    const chapters: Chapter[] = [];
    let t = INTRO;
    d.days.forEach((day, i) => {
      const list = day.flights.filter((f) => !f.local && coords[f.dep] && coords[f.arr]);
      const t0 = t;
      if (list.length) {
        t += DAY_IN;
        for (const f of list) {
          trips.push({ key: `${f.id}`, day: i, from: f.dep, to: f.arr, arc: arcCoords(coords[f.dep], coords[f.arr]), nm: nmBetween(coords[f.dep], coords[f.arr]), type: f.aircraftType, t0: t, t1: t + TRIP });
          t += TRIP + GAP;
        }
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
  const { ov, onMapReady } = useOverview(mapRef, pts, { top: insets.top + 110, right: 60, bottom: 260, left: 50 });
  const { t, playing, play, halt, seek } = useReplay(plan.total);
  const started = useRef(false);
  useEffect(() => {
    if (ov && chapters.length && !started.current) { started.current = true; play(); }
  }, [ov, chapters.length, play]);

  // Kamerorna: översikten, en per dag (dagens flygplatser, lutad och lätt vriden mot dit dagen gick) och basen lokala dagar.
  const keyframes = useMemo(() => {
    if (!ov) return null;
    const allSpan = spanKm(pts);
    const base = home ? coords[home] : pts[0];
    const kf: { t: number; c: GeoCam; bump?: boolean }[] = [{ t: 0, c: ov }, { t: INTRO - 0.8, c: ov }];
    for (const ch of chapters) {
      if (ch.kind === 'rest' || !base) continue;
      let cam: GeoCam;
      if (ch.kind === 'fly') {
        const dp = trips.filter((x) => x.day === ch.day).flatMap((x) => [coords[x.from], coords[x.to]]).concat(home ? [coords[home]] : []);
        const lat = (Math.min(...dp.map((p) => p.lat)) + Math.max(...dp.map((p) => p.lat))) / 2;
        const lon = (Math.min(...dp.map((p) => p.lon)) + Math.max(...dp.map((p) => p.lon))) / 2;
        const brg = headingDeg(base, { lat, lon }), heading = clamp(((((brg % 360) + 540) % 360) - 180) * 0.2, -25, 25);
        const alt = Math.max(14000, ov.alt * (spanKm(dp) / allSpan) * 1.2);
        const c = offsetPt({ lat, lon }, heading, alt * 0.1);
        cam = { lat: c.lat, lon: c.lon, alt, heading, pitch: PITCH };
      } else {
        cam = { lat: base.lat, lon: base.lon, alt: Math.max(12000, ov.alt / 2.1), heading: 0, pitch: 30 };
      }
      kf.push({ t: ch.t0, c: kf[kf.length - 1].c });
      kf.push({ t: ch.t0 + (ch.kind === 'fly' ? DAY_IN : 0.7), c: cam, bump: true });
    }
    kf.push({ t: fin, c: kf[kf.length - 1].c });
    kf.push({ t: fin + 1.8, c: ov, bump: true });
    return kf;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, plan]);
  const cam = useMemo<GeoCam | null>(() => {
    if (!keyframes) return null;
    for (let i = 1; i < keyframes.length; i++) {
      if (t <= keyframes[i].t) {
        const a = keyframes[i - 1], b = keyframes[i];
        return blendCam(a.c, b.c, b.t > a.t ? ease((t - a.t) / (b.t - a.t)) : 1, b.bump);
      }
    }
    return keyframes[keyframes.length - 1].c;
  }, [keyframes, t]);
  useEffect(() => {
    if (cam) mapRef.current?.setCamera(toCamera(cam));
  }, [cam]);
  const [userHeading, setUserHeading] = useState<number | null>(null);

  const chIdx = chapters.findIndex((c) => t >= c.t0 && t < c.t1);
  const ch = chIdx >= 0 ? chapters[chIdx] : null;
  const done = t >= fin;
  const active = trips.find((x) => t >= x.t0 && t < x.t1) ?? null;
  const af = active ? (() => { const lin = (t - active.t0) / (active.t1 - active.t0); return lin * 0.75 + ease(lin) * 0.25; })() : 0;

  // Bågarna ritas om åtta gånger i sekunden, inte varje steg (Apple-kartan flimrar annars).
  const step = Math.floor(t * 8);
  const lines = useMemo(() => {
    const bright: LatLng[][] = [], dim: LatLng[][] = [], next: LatLng[][] = [];
    let head: LatLng[] = [];
    for (const x of trips) {
      if (done) { bright.push(x.arc); continue; }
      if (t >= x.t1) (ch && x.day === ch.day ? bright : dim).push(x.arc);
      else if (x === active) {
        const n = x.arc.length - 1, cut = Math.max(1, Math.round(af * n));
        const tip = alongArc(x.arc, af).p;
        bright.push([...x.arc.slice(0, cut), toLatLng(tip)]);
        next.push([toLatLng(tip), ...x.arc.slice(cut)]);
        const hl = Math.min(af, 10 / Math.max(1, x.nm), 0.3);
        head = Array.from({ length: 7 }, (_, k) => toLatLng(alongArc(x.arc, af - hl + (hl * k) / 6).p));
      } else if (ch && x.day === ch.day) next.push(x.arc);
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
  const plane = active ? alongArc(active.arc, af) : null;
  const lift = active ? (4 + 12 * ((cam?.pitch ?? 0) / PITCH)) * Math.pow(Math.sin(Math.PI * clamp((t - active.t0) / TRIP, 0, 1)), 0.35) + 2 : 2;
  const camH = (playing ? null : userHeading) ?? cam?.heading ?? 0;
  const pulses = done && t > fin + 1.4 ? trips.map((x, k) => alongArc(x.arc, ((t - fin) * 0.5 + k * 0.137) % 1).p) : [];

  const nmSoFar = done ? totalNm : trips.reduce((s, x) => s + (t >= x.t1 ? x.nm : x === active ? x.nm * af : 0), 0);
  const hSoFar = done ? weekH : chapters.reduce((s, c) => s + (t >= c.t1 ? d.days[c.day].hours : t >= c.t0 ? d.days[c.day].hours * ((t - c.t0) / (c.t1 - c.t0)) : 0), 0);
  const tripsDone = trips.filter((x) => done || t >= x.t1).length;
  const maxDay = Math.max(0.1, ...d.days.map((x) => x.hours));
  const busiest = d.days.reduce<typeof d.days[number] | null>((b, x) => (!b || x.hours > b.hours ? x : b), null);
  const rv = clamp((t - fin - 0.9) / 0.6, 0, 1);
  const fog = ((cam?.pitch ?? 0) / PITCH) * 0.9;
  const weekTitle = (params.label ?? '').replace('W', 'Week ');

  let dayCard: { o: number; name: string; sub: string } | null = null;
  if (ch) {
    const day = d.days[ch.day], dp = dayParts(day.iso), span = ch.t1 - ch.t0, k = t - ch.t0;
    const dayTrips = trips.filter((x) => x.day === ch.day);
    const ldg = day.flights.filter((f) => f.local).reduce((s, f) => s + (f.landings || 0), 0);
    dayCard = {
      o: clamp(Math.min(k / 0.3, (span - k) / 0.3), 0, 1), name: dp.name,
      sub: `${dp.date} · ${ch.kind === 'fly' ? `${[dayTrips[0].from, ...dayTrips.map((x) => x.to)].join(' → ')} · ${hhmm(day.hours)}`
        : ch.kind === 'local' ? `Local flights · ${hhmm(day.hours)}${ldg ? ` · ${ldg} ${ldg === 1 ? 'landing' : 'landings'}` : ''}` : 'Rest day'}`,
    };
  }
  const control = (fn: () => void) => { setUserHeading(null); fn(); };

  return (
    <View style={{ flex: 1, backgroundColor: REPLAY_BG }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={regionFor(pts)}
        onMapReady={onMapReady}
        mapType="mutedStandard"
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
        onRegionChangeComplete={() => { mapRef.current?.getCamera().then((c) => setUserHeading(c.heading ?? 0)).catch(() => {}); }}
      >
        {home ? <MapCircle center={toLatLng(coords[home])} radius={18520} strokeColor="rgba(0,200,232,0.45)" strokeWidth={1.2} fillColor="rgba(0,200,232,0.04)" lineDashPattern={[3, 4]} /> : null}
        {lines.dim.map((c, i) => <Polyline key={`d${i}`} coordinates={c} strokeColor="rgba(0,200,232,0.32)" strokeWidth={1.8} lineCap="round" />)}
        {lines.next.map((c, i) => <Polyline key={`n${i}`} coordinates={c} strokeColor="rgba(0,200,232,0.32)" strokeWidth={1.6} lineDashPattern={[5, 7]} />)}
        {lines.bright.map((c, i) => <Polyline key={`g${i}`} coordinates={c} strokeColor="rgba(0,200,232,0.18)" strokeWidth={11} lineCap="round" lineJoin="round" />)}
        {lines.bright.map((c, i) => <Polyline key={`b${i}`} coordinates={c} strokeColor={MAP_CYAN} strokeWidth={2.8} lineCap="round" lineJoin="round" />)}
        {lines.head.length > 1 ? <Polyline coordinates={lines.head} strokeColors={headColors} strokeWidth={2.6} lineCap="round" /> : null}
        {airports.filter((k) => seen[k]).map((k) => <StopMarker key={k} p={coords[k]} code={k} visited={seen[k] === 2} />)}
        {trips.map((x) => (t >= x.t1 && t - x.t1 < 1.5 ? <RippleMarker key={`r${x.key}`} p={coords[x.to]} /> : null))}
        {ch && ch.kind === 'local' && home ? <RippleMarker key={`l${ch.day}`} p={coords[home]} /> : null}
        {pulses.map((p, i) => <GlowDot key={`p${i}`} p={p} />)}
        {plane && active ? (
          <ReplayAircraft p={plane.p} heli={!!heliTypes[active.type]} heading={plane.heading - camH} spinning={playing} lift={lift} />
        ) : null}
      </MapView>
      <ReplayShade fog={fog} />
      <TitleCard t={t} top={insets.top + 180} cap="YOUR BEST WEEK" title={`${hhmm(weekH)} h`} sub={`${weekTitle} · ${d.rangeLabel}`} />
      {dayCard && dayCard.o > 0 ? (
        <View pointerEvents="none" style={[s.dayCard, { top: insets.top + 64, opacity: dayCard.o, transform: [{ translateY: (1 - dayCard.o) * -8 }] }]}>
          <Text style={s.dayName}>{dayCard.name}</Text>
          <Text numberOfLines={1} style={s.daySub}>{dayCard.sub}</Text>
        </View>
      ) : null}

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close the map">
          <Glass style={s.close}><Ionicons name="close" size={18} color={Colors.textPrimary} /></Glass>
        </Pressable>
        <Glass style={[s.titlePill, { opacity: dayCard && dayCard.o > 0 ? 0 : clamp((t - 1.8) / 0.5, 0, 1) }]}>
          <Text style={s.titleText}>{weekTitle}</Text>
          <Text style={s.titleSub}>{d.rangeLabel}</Text>
        </Glass>
      </View>

      <Glass style={[s.panel, { bottom: insets.bottom + 8 }]}>
        <View pointerEvents={rv > 0.5 ? 'none' : 'auto'} style={[s.panelIn, { opacity: 1 - rv }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.cap}>FLOWN</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={s.big}>{Math.round(nmSoFar)}</Text>
                <Text style={s.unit}>NM</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={s.cap}>HOURS</Text>
              <Text style={s.val}>{hhmm(hSoFar)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 52 }}>
              <Text style={s.cap}>TRIPS</Text>
              <Text style={s.val}>{tripsDone} / {trips.length}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => control(() => (playing ? halt() : play()))} disabled={!chapters.length} style={[s.play, !chapters.length && { opacity: 0.4 }]}
              accessibilityLabel={playing ? 'Pause the replay' : 'Replay the week'}>
              <Ionicons name={playing ? 'pause' : 'play'} size={18} color={Colors.textInverse} />
            </Pressable>
            <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
              {d.days.map((x, i) => {
                const c = chapters[i], on = chIdx === i, past = done || (!!c && t >= c.t1), rest = x.hours <= 0;
                const dp = dayParts(x.iso);
                return (
                  <Pressable key={x.iso} onPress={() => { if (c) control(() => seek(c.t0)); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={`${dp.name} ${dp.date}, ${rest ? 'no flying' : `${hhmm(x.hours)} hours`}. Jump to this day`}
                    style={[s.chip, { borderColor: on ? MAP_CYAN : 'rgba(255,255,255,0.08)', backgroundColor: on ? 'rgba(0,200,232,0.14)' : 'transparent' }]}>
                    <Text style={[s.chipDow, { color: on ? MAP_CYAN : past && !rest ? Colors.textPrimary : '#5D6C7D' }]}>{x.dow.charAt(0)}</Text>
                    <View style={{ width: '60%', borderRadius: 2, height: rest ? 2 : Math.max(3, (x.hours / maxDay) * 16), backgroundColor: rest ? '#2A3B50' : past || on ? MAP_CYAN : '#1F4A66' }} />
                  </Pressable>
                );
              })}
            </View>
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
          <Pressable onPress={() => control(play)} style={s.replay} accessibilityRole="button">
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
  dayCard: { position: 'absolute', left: 20, right: 20, alignItems: 'center', gap: 4 },
  dayName: { fontFamily: SERIF, fontSize: 28, fontWeight: '600', color: Colors.textPrimary, textShadowColor: '#000', textShadowRadius: 8 },
  daySub: { fontFamily: MONO, fontSize: 10.5, color: '#A7B3C2' },
  panel: { position: 'absolute', left: 12, right: 12, height: 196 },
  panelIn: { position: 'absolute', left: 16, right: 16, top: 15, bottom: 14, justifyContent: 'space-between' },
  cap: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.4, color: '#6E7D8F' },
  big: { fontFamily: SERIF, fontSize: 32, fontWeight: '600', color: MAP_CYAN, lineHeight: 34 },
  huge: { fontFamily: SERIF, fontSize: 44, fontWeight: '600', color: Colors.textPrimary, lineHeight: 46, letterSpacing: -1 },
  unit: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: '#A7B3C2' },
  val: { fontFamily: MONO, fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  play: { width: 46, height: 46, borderRadius: 23, backgroundColor: MAP_CYAN, alignItems: 'center', justifyContent: 'center' },
  chip: { flex: 1, minHeight: 46, paddingVertical: 6, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'space-between' },
  chipDow: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700' },
  fact: { flex: 1, gap: 2, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  factVal: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  factLbl: { fontFamily: MONO, fontSize: 9, color: '#A7B3C2' },
  replay: { alignSelf: 'flex-start', minHeight: 34, paddingLeft: 11, paddingRight: 14, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,200,232,0.5)', backgroundColor: 'rgba(0,200,232,0.1)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  replayText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: Colors.textPrimary },
});
