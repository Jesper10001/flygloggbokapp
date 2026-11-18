// Sun route: dag/natt för en flygning ovanpå den riktiga kartan (Apple Maps via react-native-maps, mörkt
// tema). Överst en mening om vad solen gör (utils/sunTimeline), sedan kartan med rutten färgad efter
// solhöjden, mörkret (terminatorn) som flyttas med tidslinjen och farkosten, därunder tidslinjen med
// solnedgång/natt utmärkta och sist vad som hamnar i loggboken. Astronomin i utils/dayNight.ts.
//
// Samma plats (dep = arr) med en flygenvelop (circleNM) och onPickBearing: kartan ligger still och en
// kompass ovanpå väljer hållet man flög (Local = runt flygplatsen).
//
// Lägen:
//   <DayNightMap flight={flight} />                              — eget kort + rubrik (flygningens översikt)
//   <DayNightMap embedded points={[...]} date depUtc arrUtc />   — bara innehållet (Sun route-panelen i Log Flight)

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder } from 'react-native';
import MapView, { Marker, Polyline, Polygon, type Region } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { getAirportCoordinates } from '../db/icao';
import { buildInstants } from '../utils/flightTime';
import { nightRings, sampleTimedRoute, positionAtMs, vertexArrivalTimes, classifySun, destPointDeg, type SunState } from '../utils/dayNight';
import { solarAltitudeDeg, subsolarPoint } from '../utils/sun';
import { SUN, buildSunTimeline, sunStory, phaseOf, fmtMin, fmtUtc } from '../utils/sunTimeline';
import { SunBar, SunEventRow } from './sun/SunStrip';
import type { Flight } from '../types/flight';

const MONO = 'JetBrainsMono';
const ROUTE_COLORS: Record<SunState, string> = { day: SUN.day, dusk: SUN.twilight, dawn: SUN.twilight, night: SUN.nightOnMap };
const PHASE_COLOR = { day: SUN.day, twilight: SUN.twilight, night: SUN.nightText } as const;
const C_PLANE = '#3FE0FF';
const MARK_LABEL_H = 16;
const normLon = (lon: number) => ((lon % 360) + 540) % 360 - 180;

export interface DayNightMapProps {
  flight?: Flight;
  points?: { lat: number; lon: number; label?: string; dwellMin?: number }[];
  date?: string;
  depUtc?: string;
  arrUtc?: string;
  flightType?: string;
  embedded?: boolean;
  /** Out-and-back-radie (NM) runt EN plats (dep = arr) → kompassens ring = flygenvelopen. */
  circleNM?: number;
  /** Ringens centrum (flygplatsen) — annars används första punkten. */
  circleCenter?: { lat: number; lon: number };
  /** Valt väderstreck (bäring 0–315°); null = Local (runt flygplatsen). */
  selectedBearing?: number | null;
  /** Visar kompassen: väderstreck eller null (Local). */
  onPickBearing?: (bearing: number | null) => void;
  /** Farkost-glyf (oanvänd i kartan just nu, romben ritas). */
  vehicle?: 'heli' | 'plane';
  /** Det som loggas: natt (h), nattlandningar, total (h). Utelämnas → hämtas ur flight. */
  logged?: { night: number; nightLdg: number; total: number };
  /** Loggad natt (h, avrundad som loggningen) runt flygplatsen och per väderstreck → skillnaden i kompassen. */
  bearingNight?: { local: number; byBearing: Record<number, number> };
  /** Kompassens förklaring av ringen. */
  circleInfo?: { cruiseKts: number; totalH: number; aircraft: string };
  /** Visar "Change the numbers in Full." (Log Flight). */
  editHint?: boolean;
  /** Meningen överst och "In your logbook". Standard: bara i Log Flight-panelen (embedded), inte i en sparad flygnings översikt. */
  summary?: boolean;
}

const COMPASS: [string, number, string][] = [['N', 0, 'North'], ['NE', 45, 'North-east'], ['E', 90, 'East'], ['SE', 135, 'South-east'], ['S', 180, 'South'], ['SW', 225, 'South-west'], ['W', 270, 'West'], ['NW', 315, 'North-west']];
const RAD = Math.PI / 180;
const PAD = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE']; // knappsatsens ordning (C = Local i mitten)
function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = aLat * RAD, p2 = bLat * RAD, dl = (bLon - aLon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
const MAP_H = 220, COMPASS_MAP_H = 230;
// Kompassens karta visar ringen över RING_SPAN av sin höjd: latitudeDelta = radien × RING_SPAN och en liten
// longitudeDelta, så att höjden styr inzoomningen och ringen alltid har radien höjd / RING_SPAN på skärmen.
const RING_SPAN = 2.6;

function DayNightMapBase(props: DayNightMapProps) {
  const { t } = useTranslation();
  const { embedded } = props;
  const dateStr = props.date ?? props.flight?.date ?? '';
  const depUtc = props.depUtc ?? props.flight?.dep_utc ?? '';
  const arrUtc = props.arrUtc ?? props.flight?.arr_utc ?? '';
  const flightType = props.flightType ?? props.flight?.flight_type;
  const circleNM = props.circleNM ?? 0;
  const onPickBearing = props.onPickBearing;
  const selectedBearing = props.selectedBearing ?? null;
  const placeCodes = props.flight
    ? ([props.flight.dep_place, props.flight.stop_place, props.flight.arr_place].filter(Boolean) as string[])
    : [];
  const codeKey = placeCodes.join('|');
  const hasPoints = !!props.points;

  const [coords, setCoords] = useState<Record<string, { lat: number; lon: number }>>({});
  const [frac, setFrac] = useState(0);
  const [open, setOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const playedRef = useRef(false);
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const [mapW, setMapW] = useState(0);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { setPlaying(false); const w = trackWRef.current; if (w > 0) setFrac(Math.max(0, Math.min(1, e.nativeEvent.locationX / w))); },
    onPanResponderMove: (e) => { const w = trackWRef.current; if (w > 0) setFrac(Math.max(0, Math.min(1, e.nativeEvent.locationX / w))); },
  })).current;

  useEffect(() => {
    if (hasPoints || !codeKey) return;
    getAirportCoordinates([...new Set(codeKey.split('|'))]).then((rows) => {
      const m: Record<string, { lat: number; lon: number }> = {};
      for (const r of rows) if (r.lat != null && r.lon != null) m[r.icao] = { lat: r.lat, lon: r.lon };
      setCoords(m);
    }).catch(() => {});
  }, [codeKey, hasPoints]);

  const stopDwell = flightType === 'touch_and_go' ? 10 : flightType === 'hot_refuel' ? 20 : 0;
  const legs = useMemo(() => {
    if (props.points) {
      return props.points
        .filter((p) => p && isFinite(p.lat) && isFinite(p.lon))
        .map((p, i) => ({ lat: p.lat, lon: p.lon, icao: p.label || String(i), dwellMin: p.dwellMin || 0 }))
        .filter((p, i, a) => i === 0 || (p.dwellMin || 0) > 0 || p.lat !== a[i - 1].lat || p.lon !== a[i - 1].lon);
    }
    const codes = codeKey ? codeKey.split('|') : [];
    const seq: { lat: number; lon: number; icao: string; dwellMin: number }[] = [];
    codes.forEach((c, idx) => { const p = coords[c]; if (p) seq.push({ ...p, icao: c, dwellMin: (idx > 0 && idx < codes.length - 1) ? stopDwell : 0 }); });
    return seq.filter((p, i) => i === 0 || p.icao !== seq[i - 1].icao);
  }, [props.points, coords, codeKey, stopDwell]);

  // Kompassen: ringens centrum (flygplatsen) och radie i grader.
  const cCenter = props.circleCenter ?? (legs[0] ? { lat: legs[0].lat, lon: legs[0].lon } : null);
  const rDeg = circleNM / 60;
  const compass = circleNM > 0 && !!cCenter && !!onPickBearing;
  const ringCoords = useMemo(() => {
    if (!compass) return [];
    const out: { latitude: number; longitude: number }[] = [];
    for (let a = 0; a < 360; a += 5) { const p = destPointDeg(cCenter!.lat, cCenter!.lon, a, rDeg); out.push({ latitude: p.lat, longitude: normLon(p.lon) }); }
    return out;
  }, [compass, cCenter?.lat, cCenter?.lon, rDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  const localCoords = useMemo(() => {
    if (!compass) return [];
    const out: { latitude: number; longitude: number }[] = [];
    for (let a = 0; a < 360; a += 10) { const p = destPointDeg(cCenter!.lat, cCenter!.lon, a, rDeg * 0.34); out.push({ latitude: p.lat, longitude: normLon(p.lon) }); }
    return out;
  }, [compass, cCenter?.lat, cCenter?.lon, rDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectorCoords = (bearing: number) => {
    const pts = [{ latitude: cCenter!.lat, longitude: normLon(cCenter!.lon) }];
    for (let a = bearing - 22.5; a <= bearing + 22.5 + 0.001; a += 7.5) {
      const p = destPointDeg(cCenter!.lat, cCenter!.lon, a, rDeg);
      pts.push({ latitude: p.lat, longitude: normLon(p.lon) });
    }
    return pts;
  };

  const times = useMemo(() => buildInstants(dateStr, depUtc, arrUtc, 0), [dateStr, depUtc, arrUtc]);
  const depMs = times ? times.dep.getTime() : 0;
  const arrMs = times ? times.arr.getTime() : 0;
  const dur = arrMs - depMs;

  const route = useMemo(() => (times && legs.length >= 1) ? sampleTimedRoute(legs, depMs, arrMs, 100) : [], [legs, depMs, arrMs, times]);
  const tl = useMemo(() => (times && legs.length >= 1) ? buildSunTimeline(legs, depMs, arrMs) : null, [legs, depMs, arrMs, times]);

  // region som ramar in rutten (unwrappad longitud för korrekt centrering över datumlinjen)
  const region = useMemo<Region | null>(() => {
    if (compass) return { latitude: cCenter!.lat, longitude: normLon(cCenter!.lon), latitudeDelta: Math.min(150, rDeg * RING_SPAN), longitudeDelta: 0.0005 };
    if (!route.length) return null;
    let off = 0, umin = Infinity, umax = -Infinity, latmin = Infinity, latmax = -Infinity;
    for (let i = 0; i < route.length; i++) {
      if (i > 0) { const d = route[i].lon - route[i - 1].lon; if (d > 180) off -= 360; else if (d < -180) off += 360; }
      const u = route[i].lon + off;
      umin = Math.min(umin, u); umax = Math.max(umax, u);
      latmin = Math.min(latmin, route[i].lat); latmax = Math.max(latmax, route[i].lat);
    }
    const latC = (latmin + latmax) / 2;
    const latD = Math.max(2, Math.min(150, (latmax - latmin) * 1.25 + 3));
    const lonD = Math.max(2, Math.min(330, (umax - umin) * 1.25 + 4));
    return { latitude: latC, longitude: normLon((umin + umax) / 2), latitudeDelta: latD, longitudeDelta: lonD };
  }, [route, compass, cCenter?.lat, cCenter?.lon, rDeg]); // eslint-disable-line react-hooks/exhaustive-deps

  // färgade rutt-segment per soltillstånd (bryt vid datumlinje)
  const runs = useMemo(() => {
    const out: { color: string; coordinates: { latitude: number; longitude: number }[] }[] = [];
    let cur: { color: string; coordinates: { latitude: number; longitude: number }[] } | null = null;
    for (let i = 0; i < route.length; i++) {
      const broke = i > 0 && Math.abs(route[i].lon - route[i - 1].lon) > 180;
      const color = ROUTE_COLORS[route[i].state];
      if (broke) cur = null;
      if (!cur || cur.color !== color) {
        cur = { color, coordinates: [] };
        if (!broke && i > 0) cur.coordinates.push({ latitude: route[i - 1].lat, longitude: route[i - 1].lon });
        out.push(cur);
      }
      cur.coordinates.push({ latitude: route[i].lat, longitude: route[i].lon });
    }
    return out.filter((r) => r.coordinates.length >= 2);
  }, [route]);

  const markers = useMemo(() => {
    const map = new Map<string, { lat: number; lon: number; icao: string; dep: boolean; arr: boolean }>();
    legs.forEach((p, i) => {
      const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      const m = map.get(key) ?? { lat: p.lat, lon: p.lon, icao: p.icao, dep: false, arr: false };
      if (i === 0) m.dep = true; if (i === legs.length - 1) m.arr = true;
      map.set(key, m);
    });
    // Släng vändpunkter utan riktig etikett (t.ex. out-and-back-kantens index "1").
    return [...map.values()].filter((m) => m.dep || m.arr || !/^\d+$/.test(m.icao));
  }, [legs]);

  const scrubMs = depMs + frac * dur;
  // Skuggan (polygonerna) uppdateras bara i ~20 steg över flyget — annars ritar Apple Maps
  // om hela overlay-lagret varje animationssteg, vilket får rutten att blinka.
  const shadowMs = depMs + Math.round(frac * 20) / 20 * dur;
  const nb = useMemo(() => region ? {
    lonMin: Math.max(-180, region.longitude - region.longitudeDelta / 2 - 85),
    lonMax: Math.min(180, region.longitude + region.longitudeDelta / 2 + 85),
    latMin: Math.max(-90, region.latitude - region.latitudeDelta / 2 - 60),
    latMax: Math.min(90, region.latitude + region.latitudeDelta / 2 + 60),
  } : { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 }, [region]);
  // Två-tons-skugga: ljusare skymning (sol < −0.833°) + mörkare natt (sol < −6°).
  const twilight = useMemo(() => times ? nightRings(new Date(shadowMs), -0.833, 2, 2, nb) : null, [shadowMs, times, nb]);
  const night = useMemo(() => times ? nightRings(new Date(shadowMs), -6, 2, 2, nb) : null, [shadowMs, times, nb]);
  const twilightPolys = useMemo(() => twilight ? twilight.rings.map((r) => r.map((p) => ({ latitude: p.lat, longitude: normLon(p.lon) }))) : [], [twilight]);
  const nightPolys = useMemo(() => night ? night.rings.map((r) => r.map((p) => ({ latitude: p.lat, longitude: normLon(p.lon) }))) : [], [night]);
  const sub = night?.sub ?? twilight?.sub ?? null;
  const plane = useMemo(() => positionAtMs(legs, dur, frac * dur), [legs, dur, frac]);
  // Stoppens tidsfraktion (touchdown) längs tidslinjen.
  const stopFracs = useMemo(() => {
    if (!times || legs.length < 3 || dur <= 0) return [] as number[];
    const vt = vertexArrivalTimes(legs, depMs, arrMs);
    const out: number[] = [];
    for (let i = 1; i < legs.length - 1; i++) out.push((vt[i] - depMs) / dur);
    return out;
  }, [legs, depMs, arrMs, dur, times]);

  // Solnedgångens riktning från flygplatsen (kompassen): bäringen mot subsolar-punkten vid solnedgången.
  const sunsetBearing = useMemo(() => {
    if (!compass || !tl) return null;
    const ev = tl.events.find((e) => e.kind === 'sunset') ?? tl.events.find((e) => e.kind === 'sunrise');
    const s = subsolarPoint(new Date(ev ? ev.ms : (depMs + arrMs) / 2));
    return { b: bearingDeg(cCenter!.lat, cCenter!.lon, s.lat, s.lon), label: ev?.kind === 'sunrise' ? 'SUNRISE' : 'SUNSET' };
  }, [compass, tl, depMs, arrMs, cCenter?.lat, cCenter?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spela upp rutten en gång när kartan blir synlig — pausar sen vid slutet.
  const visible = !!times && legs.length >= 1 && !!region && (embedded || open);
  useEffect(() => {
    if (!visible) { playedRef.current = false; return; }
    if (!playedRef.current && dur > 0) { playedRef.current = true; setFrac(0); setPlaying(true); }
  }, [visible, dur]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFrac((f) => { const nf = f + 0.008; if (nf >= 1) { setPlaying(false); return 1; } return nf; });
    }, 80); // ~10 s spelning så natt-skuggan hinner med
    return () => clearInterval(id);
  }, [playing]);

  if (flightType === 'sim') return null;

  const hasData = !!times && legs.length >= 1 && !!region && !!tl;
  const phase = hasData ? phaseOf(classifySun(new Date(scrubMs), plane.lat, plane.lon)) : 'day';
  const alt = hasData ? solarAltitudeDeg(new Date(scrubMs), plane.lat, plane.lon) : 0;
  const altDeg = Math.round(Math.abs(alt));
  const sunText = altDeg === 0 ? 'Sun on horizon' : `Sun ${altDeg}° ${alt > 0 ? 'above' : 'below'}`;
  const arrLabel = props.flight?.arr_place || (legs.length ? legs[legs.length - 1].icao : '');
  const summary = props.summary ?? !!embedded;
  const story = tl && summary ? sunStory(tl, /^\d+$/.test(arrLabel) ? '' : arrLabel) : null;
  const logged = !summary ? null : props.logged ?? (props.flight ? {
    night: props.flight.night ?? 0, nightLdg: props.flight.landings_night ?? 0, total: props.flight.total_time ?? 0,
  } : null);
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (frac >= 0.999) setFrac(0);
    setPlaying(true);
  };

  // Kompassens skillnad mot Local (loggad natt, avrundad som loggningen).
  const dirName = selectedBearing == null ? null : COMPASS.find(([, b]) => b === selectedBearing)?.[2] ?? null;
  let deltaText: string | null = null;
  if (compass && props.bearingNight) {
    const local = props.bearingNight.local;
    const cur = selectedBearing == null ? local : (props.bearingNight.byBearing[selectedBearing] ?? local);
    const d = Math.round((cur - local) * 60);
    deltaText = selectedBearing == null
      ? `Local: night ${fmtMin(local * 60)}.`
      : `${dirName}: night ${fmtMin(cur * 60)}, ${d === 0 ? 'same as local' : `${Math.abs(d)} min ${d > 0 ? 'more' : 'less'} than local`}.`;
  }

  const mapH = compass ? COMPASS_MAP_H : MAP_H;
  const ringPx = mapH / RING_SPAN;
  const cx = mapW / 2, cy = mapH / 2;

  const storyIcon = story?.icon === 'moon' ? 'weather-night' : story?.icon === 'sunrise' ? 'weather-sunset-up' : story?.icon === 'sunset' ? 'weather-sunset-down' : 'weather-sunny';
  const storyColor = story?.icon === 'moon' ? SUN.nightText : SUN.day;

  const body = !hasData ? (
    <Text style={[st.hint, { color: Colors.textSecondary }]}>{t('dn_no_route')}</Text>
  ) : (
    <>
      {story ? (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={[st.storyIcon, { backgroundColor: storyColor + '26' }]}>
            <MaterialCommunityIcons name={storyIcon as any} size={19} color={storyColor} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={st.storyTitle}>{story.title}</Text>
            <Text style={st.storySub}>{story.sub}</Text>
          </View>
        </View>
      ) : null}

      {compass ? (
        <View style={{ gap: 3 }}>
          <Text style={st.promptTitle}>Which way did you fly?</Text>
          <Text style={st.storySub}>You took off and landed at {legs[0]?.icao ?? 'the same place'}, so Blades can't see the route. Pick the direction you mostly flew.</Text>
        </View>
      ) : null}

      <View style={{ height: mapH, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border }}
        onLayout={(e) => setMapW(e.nativeEvent.layout.width)}>
        <MapView
          style={{ flex: 1 }}
          initialRegion={region!}
          userInterfaceStyle="dark"
          rotateEnabled={false}
          pitchEnabled={false}
          scrollEnabled={!compass}
          zoomEnabled={!compass}
          showsPointsOfInterests={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {twilightPolys.map((coordinates, i) => (
            <Polygon key={'tw' + i} coordinates={coordinates} fillColor="rgba(6,11,22,0.42)" strokeColor="transparent" strokeWidth={0} zIndex={1} />
          ))}
          {nightPolys.map((coordinates, i) => (
            <Polygon key={'n' + i} coordinates={coordinates} fillColor="rgba(6,11,22,0.62)" strokeColor="transparent" strokeWidth={0} zIndex={2} />
          ))}
          {/* Kompassens ring = flygenvelopen; det valda hållet markeras som en sektor. */}
          {compass ? (
            <Polygon key="ring" coordinates={ringCoords} fillColor="rgba(10,22,40,0.28)" strokeColor="rgba(0,200,232,0.55)" strokeWidth={1.2} zIndex={2} />
          ) : null}
          {/* Vald riktning = sektor; Local = liten cirkel runt fältet. Båda ligger alltid kvar och tänds/släcks med
              färgen, så att inga kartlager monteras om när man byter val. */}
          {compass ? (
            <Polygon key="sec" coordinates={sectorCoords(selectedBearing ?? 0)} fillColor={selectedBearing != null ? 'rgba(0,200,232,0.18)' : 'rgba(0,0,0,0)'}
              strokeColor={selectedBearing != null ? Colors.primary : 'rgba(0,0,0,0)'} strokeWidth={1.4} zIndex={2} />
          ) : null}
          {compass ? (
            <Polygon key="local" coordinates={localCoords} fillColor={selectedBearing == null ? 'rgba(0,200,232,0.18)' : 'rgba(0,0,0,0)'}
              strokeColor={selectedBearing == null ? Colors.primary : 'rgba(0,0,0,0)'} strokeWidth={1.4} zIndex={2} />
          ) : null}
          {runs.map((r, i) => (
            <Polyline key={'r' + i} coordinates={r.coordinates} strokeColor={r.color} strokeWidth={3.5} zIndex={3} />
          ))}
          {!compass && markers.map((m, i) => (
            /* Bara ICAO-rutan — centrerad på koordinaten så rutt-strecket går rakt genom rutan. */
            <Marker key={'ml' + i} coordinate={{ latitude: m.lat, longitude: m.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={m.icao} zIndex={5}>
              <View style={s.labelChip}><Text style={s.labelText}>{m.icao}</Text></View>
            </Marker>
          ))}
          {sub && !compass ? (
            <Marker coordinate={{ latitude: sub.lat, longitude: normLon(sub.lon) }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={4}>
              <Ionicons name="sunny" size={20} color={SUN.day} />
            </Marker>
          ) : null}
          {/* Romben flyttas nativt (stabil key, ingen omritning). */}
          <Marker key="plane" coordinate={{ latitude: plane.lat, longitude: plane.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={6}>
            <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
              <View style={s.planeDiamond} />
            </View>
          </Marker>
        </MapView>

        {/* Läget just nu (överst) — Apple-loggan och Legal nere till vänster lämnas fria. */}
        <View pointerEvents="none" style={[st.mapChip, { left: 10 }]}>
          <Text style={st.mapChipTime}>{fmtUtc(scrubMs)} UTC</Text>
          <Text style={[st.phaseTag, { color: PHASE_COLOR[phase], borderColor: PHASE_COLOR[phase] }]}>{phase.toUpperCase()}</Text>
        </View>
        {!compass ? (
          <View pointerEvents="none" style={[st.mapChip, { right: 10 }]}>
            <Ionicons name="sunny-outline" size={12} color={SUN.day} />
            <Text style={st.mapChipText}>{sunText}</Text>
          </View>
        ) : null}

        {compass && mapW > 0 ? (
          <>
            {sunsetBearing ? (
              <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', width: 60, left: cx + (ringPx + 20) * Math.sin(sunsetBearing.b * RAD) - 30, top: cy - (ringPx + 20) * Math.cos(sunsetBearing.b * RAD) - 14 }}>
                <MaterialCommunityIcons name={sunsetBearing.label === 'SUNRISE' ? 'weather-sunset-up' : 'weather-sunset-down'} size={16} color={SUN.day} />
                <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '800', color: SUN.day }}>{sunsetBearing.label}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {/* Riktningen väljs i en knappsats 3×3 som ser ut som en kompass (design A, 2026-11-18) — kartan är ren. */}
      {compass ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Main direction" style={st.pad}>
          {PAD.map((k) => {
            const c = k === 'C' ? null : COMPASS.find(([lbl]) => lbl === k)!;
            const b = c ? c[1] : null;
            const on = selectedBearing === b;
            return (
              <TouchableOpacity key={k} onPress={() => onPickBearing!(b)} activeOpacity={0.8}
                accessibilityRole="radio" accessibilityLabel={c ? c[2] : `Local, around ${legs[0]?.icao ?? 'the field'}`} accessibilityState={{ checked: on }}
                style={[st.padBtn, !c && st.padLocal, on && st.padOn]}>
                {c ? (
                  <Ionicons name="arrow-up" size={13} color={on ? '#04121F' : '#C9D6E8'} style={{ transform: [{ rotate: `${b}deg` }] }} />
                ) : (
                  <Ionicons name="locate" size={14} color={on ? '#04121F' : '#8BE3F7'} />
                )}
                <Text style={[st.padTxt, !c && { color: '#8BE3F7' }, on && { color: '#04121F' }]}>{c ? k : 'Local'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {compass ? (
        <View style={{ gap: 4, marginTop: -4 }}>
          {props.circleInfo ? (
            <Text style={st.footnote}>
              Ring = {Math.round(circleNM)} NM: half of {fmtMin(props.circleInfo.totalH * 60)} at {Math.round(props.circleInfo.cruiseKts)} kt{props.circleInfo.aircraft ? ` (${props.circleInfo.aircraft})` : ''}, out and back.
            </Text>
          ) : null}
          {deltaText ? <Text style={[st.footnote, { color: Colors.textPrimary }]}>{deltaText}</Text> : null}
        </View>
      ) : null}

      {dur > 0 ? (
        <View style={st.scrubRow}>
          <TouchableOpacity onPress={togglePlay} style={st.playBtn} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play the flight'}>
            <Ionicons name={playing ? 'pause' : (frac >= 0.999 ? 'refresh' : 'play')} size={15} color={SUN.day} />
          </TouchableOpacity>
          <View style={{ flex: 1, height: 58 }}>
            <SunEventRow tl={tl!} words />
            <View
              style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 32, justifyContent: 'center' }}
              onLayout={(e) => { const w = e.nativeEvent.layout.width; trackWRef.current = w; setTrackW(w); }}
              {...pan.panHandlers}
            >
              <SunBar tl={tl!} height={14} />
              <View pointerEvents="none" style={{ position: 'absolute', left: frac * trackW, right: 0, top: 9, height: 14, borderTopRightRadius: 7, borderBottomRightRadius: 7, backgroundColor: 'rgba(15,30,58,0.55)' }} />
              {stopFracs.map((f, i) => (
                <View key={'sm' + i} pointerEvents="none" style={{ position: 'absolute', left: f * trackW - 3.5, top: 12.5, width: 7, height: 7, borderRadius: 4, backgroundColor: '#06101F', borderWidth: 1, borderColor: '#FFFFFF' }} />
              ))}
              <View pointerEvents="none" style={[st.thumb, { left: frac * trackW - 12, borderColor: PHASE_COLOR[phase] }]} />
            </View>
            <Text style={[st.endTime, { left: 0 }]}>T/O {fmtUtc(depMs)}</Text>
            <Text style={[st.endTime, { right: 0 }]}>LDG {fmtUtc(arrMs)}</Text>
          </View>
        </View>
      ) : null}

      {logged ? (
        <View style={{ gap: 8 }}>
          <Text style={st.section}>IN YOUR LOGBOOK</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={[st.tile, st.tileNight]}>
              <Text style={[st.tileLbl, { color: SUN.nightText }]}>NIGHT</Text>
              <Text style={st.tileVal}>{fmtMin(logged.night * 60)}</Text>
            </View>
            <View style={[st.tile, st.tileNight]}>
              <Text style={[st.tileLbl, { color: SUN.nightText }]}>NIGHT LDG</Text>
              <Text style={st.tileVal}>{logged.nightLdg}</Text>
            </View>
            <View style={st.tile}>
              <Text style={[st.tileLbl, { color: SUN.day }]}>DAY</Text>
              <Text style={st.tileVal}>{fmtMin(Math.max(0, logged.total - logged.night) * 60)}</Text>
            </View>
          </View>
          <Text style={st.footnote}>
            {props.editHint ? 'Filled in for you. ' : ''}Night starts when the sun is 6° below the horizon, so twilight counts as day.{props.editHint ? ' Change the numbers in Full.' : ''}
          </Text>
        </View>
      ) : null}
    </>
  );

  if (embedded) return <View style={{ gap: 14 }}>{body}</View>;

  return (
    <View style={[st.card, { backgroundColor: Colors.card, borderColor: Colors.cardBorder }]}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={st.head} activeOpacity={0.7}>
        <Ionicons name="sunny-outline" size={16} color={SUN.day} />
        <Text style={[st.title, { color: Colors.textPrimary }]}>{t('sun_route')}</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      {open && body}
    </View>
  );
}

// Memoiserad: kartan renderas bara om när rutt-relaterade props ändras (inte när man
// skriver i andra fält) → undviker onödig omritning/överbelastning.
export const DayNightMap = memo(DayNightMapBase);

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700' },
  hint: { fontFamily: MONO, fontSize: 11 },
  storyIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  storyTitle: { fontSize: 16.5, fontWeight: '600', lineHeight: 21, color: Colors.textPrimary },
  storySub: { fontSize: 13, lineHeight: 18, color: Colors.textSecondary },
  promptTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  mapChip: { position: 'absolute', top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9, backgroundColor: 'rgba(6,12,26,0.85)', borderWidth: 1, borderColor: Colors.border },
  mapChipTime: { fontFamily: MONO, fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  mapChipText: { fontSize: 11, color: '#D6E6F3' },
  phaseTag: { fontFamily: MONO, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, paddingVertical: 1, paddingHorizontal: 5, borderRadius: 5, borderWidth: 1, overflow: 'hidden' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 6, borderRadius: 18, backgroundColor: '#0A1324', borderWidth: 1, borderColor: Colors.border },
  padBtn: { width: '31.6%', flexGrow: 1, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#13223D', borderWidth: 1, borderColor: '#1E3150' },
  padLocal: { borderColor: '#2A6F86' },
  padOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  padTxt: { fontSize: 14, fontWeight: '700', color: '#C9D6E8' },
  scrubRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: SUN.day, backgroundColor: SUN.day + '1A', alignItems: 'center', justifyContent: 'center' },
  thumb: { position: 'absolute', top: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 3, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  endTime: { position: 'absolute', bottom: 0, fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: Colors.textSecondary },
  section: { fontFamily: MONO, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, color: Colors.textSecondary },
  tile: { flex: 1, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 12, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, gap: 4 },
  tileNight: { backgroundColor: 'rgba(108,140,255,0.12)', borderColor: 'rgba(169,190,255,0.28)' },
  tileLbl: { fontFamily: MONO, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8 },
  tileVal: { fontFamily: MONO, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  footnote: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
});

const s = StyleSheet.create({
  labelChip: { height: MARK_LABEL_H, justifyContent: 'center', backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 5, paddingHorizontal: 5, borderWidth: 0.5, borderColor: Colors.border },
  labelText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontFamily: 'Menlo' },
  planeDiamond: { width: 13, height: 13, backgroundColor: C_PLANE, borderWidth: 1.5, borderColor: '#06101F', transform: [{ rotate: '45deg' }] },
});
