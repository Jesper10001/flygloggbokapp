// Dag/natt-karta för en flygning ovanpå den riktiga kartan (Apple Maps via
// react-native-maps, mörkt tema). Visar: rutten färgad efter solhöjd (dag/skymning/
// natt) längs vägen, en mörk natt-overlay (terminator) som flyttas med ett tidsreglage,
// flygplanets position och subsolar-punkten (solen). Astronomin i utils/dayNight.ts.
//
// Lägen:
//   <DayNightMap flight={flight} />                              — eget kort + rubrik (flygdetaljvyn)
//   <DayNightMap embedded points={[...]} date depUtc arrUtc />   — bara kartan (inbäddad i formulär)

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Image } from 'react-native';
import MapView, { Marker, Polyline, Polygon, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { getAirportCoordinates } from '../db/icao';
import { buildInstants } from '../utils/flightTime';
import { nightRings, sampleTimedRoute, positionAtMs, vertexArrivalTimes, classifySun, destPointDeg, type SunState } from '../utils/dayNight';
import type { Flight } from '../types/flight';

const MONO = 'JetBrainsMono';
const STATE_COLORS: Record<SunState, string> = { day: '#F5C84B', dusk: '#F2914A', night: '#7FC4FF', dawn: '#F291C8' };
const C_DEP = '#43E0A0';
const C_STOP = '#C9D2DE';
const C_PLANE = '#3FE0FF';
// Markör: etikett ovanför, cirkel i mitten, osynlig spacer under (= etikettens höjd).
// Symmetrin gör att cirkeln ligger i markörens CENTRUM → standard-ankaret {0.5,0.5}
// placerar cirkeln exakt på flygplatsen, så rutt-strecket dras mellan cirklarna.
const MARK_DOT = 12, MARK_GAP = 3, MARK_LABEL_H = 16;
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtUTC = (ms: number) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
const normLon = (lon: number) => ((lon % 360) + 540) % 360 - 180;

export interface DayNightMapProps {
  flight?: Flight;
  points?: { lat: number; lon: number; label?: string; dwellMin?: number }[];
  date?: string;
  depUtc?: string;
  arrUtc?: string;
  flightType?: string;
  embedded?: boolean;
  /** Out-and-back-radie (NM) runt EN plats (dep = arr) → ritas som cirkel = flygenvelop. */
  circleNM?: number;
  /** Cirkelns centrum (flygplatsen) — annars används första punkten. */
  circleCenter?: { lat: number; lon: number };
  /** Valt väderstreck (bäring 0–315°) i cirkeln; highlightas. */
  selectedBearing?: number | null;
  /** Callback när man klickar en väderstreck-sektor i cirkeln. */
  onPickBearing?: (bearing: number) => void;
  /** Farkost-glyf som "flyger" rutten (nosen mot färdriktningen). Samma bild som dep/arr-connectorn. */
  vehicle?: 'heli' | 'plane';
}

const COMPASS: [string, number][] = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
const RAD = Math.PI / 180;
// Initial bäring A→B (grader, 0 = norr) för att rotera farkosten mot färdriktningen.
function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = aLat * RAD, p2 = bLat * RAD, dl = (bLon - aLon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
// Samma bilder som dep/arr-connectorn; nosen pekar UPP (norr) vid 0° → rotera med bäringen.
const VEHICLE_IMG = { heli: require('../assets/Pilot-helicopter.PNG'), plane: require('../assets/Pilot-fixedwing.PNG') };

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

  // Cirkelns centrum (flygplatsen) + öst/väst-radie i grader → för cirkel + väderstreck-sektorer.
  const cCenter = props.circleCenter ?? (legs[0] ? { lat: legs[0].lat, lon: legs[0].lon } : null);
  const rDeg = circleNM / 60;
  const showSectors = circleNM > 0 && !!cCenter && !!onPickBearing;
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

  // region som ramar in rutten (unwrappad longitud för korrekt centrering över datumlinjen)
  const region = useMemo<Region | null>(() => {
    if (!route.length) return null;
    let off = 0, umin = Infinity, umax = -Infinity, latmin = Infinity, latmax = -Infinity;
    for (let i = 0; i < route.length; i++) {
      if (i > 0) { const d = route[i].lon - route[i - 1].lon; if (d > 180) off -= 360; else if (d < -180) off += 360; }
      const u = route[i].lon + off;
      umin = Math.min(umin, u); umax = Math.max(umax, u);
      latmin = Math.min(latmin, route[i].lat); latmax = Math.max(latmax, route[i].lat);
    }
    const latC = (latmin + latmax) / 2;
    let latD = Math.max(2, Math.min(150, (latmax - latmin) * 1.25 + 3));
    let lonD = Math.max(2, Math.min(330, (umax - umin) * 1.25 + 4));
    // Rama in out-and-back-cirkeln (radie NM → grader) med marginal.
    if (circleNM > 0) {
      const rDeg = circleNM / 60;
      const cosl = Math.max(0.2, Math.cos(latC * Math.PI / 180));
      latD = Math.min(150, Math.max(latD, rDeg * 2.6));
      lonD = Math.min(330, Math.max(lonD, (rDeg * 2.6) / cosl));
    }
    return { latitude: latC, longitude: normLon((umin + umax) / 2), latitudeDelta: latD, longitudeDelta: lonD };
  }, [route, circleNM]);

  // färgade rutt-segment per soltillstånd (bryt vid datumlinje)
  const runs = useMemo(() => {
    const out: { color: string; coordinates: { latitude: number; longitude: number }[] }[] = [];
    let cur: { color: string; coordinates: { latitude: number; longitude: number }[] } | null = null;
    for (let i = 0; i < route.length; i++) {
      const broke = i > 0 && Math.abs(route[i].lon - route[i - 1].lon) > 180;
      const color = STATE_COLORS[route[i].state];
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
  // om hela overlay-lagret varje animationssteg, vilket får rutten att blinka. Plan/tumme
  // rör sig fortfarande mjukt (de använder scrubMs).
  const shadowMs = depMs + Math.round(frac * 20) / 20 * dur;

  // natt-overlay: räknas inom ett fönster runt rutten (robust, undviker globala jätte-polygoner)
  // Stort skugg-fönster runt rutten (klamrat till giltiga intervall) — täcker en stor del
  // av kartan. OK perf-mässigt eftersom skuggan bara uppdateras i ~20 steg.
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
  // Färdriktning = bäringen på det ben figuren är på just nu (glitchfritt vid vändpunkten).
  const planeHeading = useMemo(() => {
    if (legs.length < 2 || dur <= 0) return 0;
    const vt = vertexArrivalTimes(legs, depMs, arrMs);
    let seg = 0;
    for (let i = 0; i < legs.length - 1; i++) if (scrubMs >= vt[i]) seg = i;
    const a = legs[seg], b = legs[seg + 1];
    if (a.lat === b.lat && a.lon === b.lon) return 0;
    return bearingDeg(a.lat, a.lon, b.lat, b.lon);
  }, [legs, depMs, arrMs, scrubMs, dur]);

  // Tidslinjens färg (day/dusk/night) över TID — inkl. dwell vid stopp. Oberoende av frac.
  const timeSegs = useMemo(() => {
    if (!times || legs.length < 1 || dur <= 0) return [] as { state: SunState; n: number }[];
    const N = 60; const states: SunState[] = [];
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N;
      const p = positionAtMs(legs, dur, t * dur);
      states.push(classifySun(new Date(depMs + t * dur), p.lat, p.lon));
    }
    const segs: { state: SunState; n: number }[] = [];
    for (const s of states) { const last = segs[segs.length - 1]; if (last && last.state === s) last.n++; else segs.push({ state: s, n: 1 }); }
    return segs;
  }, [legs, depMs, arrMs, dur, times]);
  // Stoppens tidsfraktion (touchdown) längs tidslinjen.
  const stopFracs = useMemo(() => {
    if (!times || legs.length < 3 || dur <= 0) return [] as number[];
    const t = vertexArrivalTimes(legs, depMs, arrMs);
    const out: number[] = [];
    for (let i = 1; i < legs.length - 1; i++) out.push((t[i] - depMs) / dur);
    return out;
  }, [legs, depMs, arrMs, dur, times]);

  // Spela upp rutten en gång när kartan blir synlig (fälls ner) — pausar sen vid slutet.
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

  const hasData = !!times && legs.length >= 1 && !!region;
  const planeState: SunState = hasData ? classifySun(new Date(scrubMs), plane.lat, plane.lon) : 'day';
  const stateLabel = (s: SunState) => s === 'day' ? t('dn_day') : s === 'dusk' ? t('dn_dusk') : s === 'dawn' ? t('dn_dawn') : t('dn_night');
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (frac >= 0.999) setFrac(0);
    setPlaying(true);
  };

  const body = !hasData ? (
    <Text style={[st.hint, { color: Colors.textMuted }]}>{t('dn_no_route')}</Text>
  ) : (
    <>
      <View style={{ height: 240, borderRadius: 10, overflow: 'hidden' }}>
        <MapView
          style={{ flex: 1 }}
          initialRegion={region!}
          userInterfaceStyle="dark"
          rotateEnabled={false}
          pitchEnabled={false}
          showsPointsOfInterest={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {twilightPolys.map((coordinates, i) => (
            <Polygon key={'tw' + i} coordinates={coordinates} fillColor="rgba(6,11,22,0.42)" strokeColor="transparent" strokeWidth={0} zIndex={1} />
          ))}
          {nightPolys.map((coordinates, i) => (
            <Polygon key={'n' + i} coordinates={coordinates} fillColor="rgba(6,11,22,0.62)" strokeColor="transparent" strokeWidth={0} zIndex={2} />
          ))}
          {/* Väderstreck-sektorer (klickbara) = flygenvelopen (radie = flygtid × marschfart / 2 NM).
              Välj hållet du flög → figuren flyger ut till kanten och hem. */}
          {showSectors ? COMPASS.map(([, b]) => {
            const sel = selectedBearing === b;
            return (
              <Polygon key={'sec' + b} coordinates={sectorCoords(b)} tappable onPress={() => onPickBearing!(b)}
                fillColor={sel ? 'rgba(63,224,255,0.26)' : 'rgba(63,224,255,0.05)'}
                strokeColor={sel ? C_PLANE : 'rgba(63,224,255,0.30)'} strokeWidth={sel ? 1.4 : 0.6} zIndex={2} />
            );
          }) : null}
          {showSectors ? COMPASS.map(([lbl, b]) => {
            const p = destPointDeg(cCenter!.lat, cCenter!.lon, b, rDeg * 0.72);
            const sel = selectedBearing === b;
            return (
              <Marker key={'secl' + b} coordinate={{ latitude: p.lat, longitude: normLon(p.lon) }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={5} onPress={() => onPickBearing!(b)}>
                <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '800', color: sel ? C_PLANE : '#9FB4C8' }}>{lbl}</Text>
              </Marker>
            );
          }) : null}
          {runs.map((r, i) => (
            <Polyline key={'r' + i} coordinates={r.coordinates} strokeColor={r.color} strokeWidth={3} zIndex={3} />
          ))}
          {markers.map((m, i) => {
            const combined = m.dep && m.arr;
            const fill = combined ? Colors.gold : m.dep ? C_DEP : m.arr ? Colors.gold : C_STOP;
            return (
              <Marker key={'m' + i} coordinate={{ latitude: m.lat, longitude: m.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={m.icao} zIndex={5}>
                <View style={{ alignItems: 'center' }}>
                  <View style={s.labelChip}><Text style={s.labelText}>{m.icao}</Text></View>
                  <View style={[s.dot, { backgroundColor: fill, borderColor: combined ? C_DEP : '#FFFFFF' }]} />
                  <View style={s.markerSpacer} />
                </View>
              </Marker>
            );
          })}
          {sub ? (
            <Marker coordinate={{ latitude: sub.lat, longitude: normLon(sub.lon) }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={4}>
              <Text style={{ fontSize: 20 }}>☀️</Text>
            </Marker>
          ) : null}
          {/* Farkosten "flyger" rutten; nosen roteras mot färdriktningen via bild-transform.
              key inkluderar bäringen (avrundad) → ny snapshot tas när riktningen ändras (vändpunkten),
              annars är den fryst för prestanda medan positionen uppdateras nativt. */}
          <Marker key={`${props.vehicle ?? 'plane'}-${Math.round(planeHeading / 3)}`} coordinate={{ latitude: plane.lat, longitude: plane.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={6}>
            <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Image source={VEHICLE_IMG[props.vehicle ?? 'plane']} style={{ width: 30, height: 30, tintColor: C_PLANE, transform: [{ rotate: `${planeHeading}deg` }] }} resizeMode="contain" />
            </View>
          </Marker>
        </MapView>
      </View>

      {dur > 0 ? (
        <View style={st.scrubRow}>
          <TouchableOpacity onPress={togglePlay} hitSlop={10} style={[st.playBtn, { borderColor: Colors.gold, backgroundColor: Colors.gold + '18' }]} activeOpacity={0.7}>
            <Ionicons name={playing ? 'pause' : (frac >= 0.999 ? 'refresh' : 'play')} size={13} color={Colors.gold} />
          </TouchableOpacity>
          <Text style={[st.timeLbl, { color: Colors.textSecondary }]}>{fmtUTC(depMs)}</Text>
          <View
            style={{ flex: 1, height: 28, justifyContent: 'center' }}
            onLayout={(e) => { const w = e.nativeEvent.layout.width; trackWRef.current = w; setTrackW(w); }}
            {...pan.panHandlers}
          >
            <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', backgroundColor: Colors.border }}>
              {timeSegs.map((s, i) => <View key={i} style={{ flex: s.n, backgroundColor: STATE_COLORS[s.state] }} />)}
            </View>
            {stopFracs.map((f, i) => (
              <View key={'sm' + i} pointerEvents="none" style={{ position: 'absolute', left: f * trackW - 3.5, top: 10.5, width: 7, height: 7, borderRadius: 4, backgroundColor: '#06101F', borderWidth: 1, borderColor: '#FFFFFF' }} />
            ))}
            <View pointerEvents="none" style={{ position: 'absolute', left: frac * trackW - 7, top: 7, width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.gold, borderWidth: 2, borderColor: '#FFFFFF' }} />
          </View>
          <Text style={[st.timeLbl, { color: Colors.textSecondary }]}>{fmtUTC(arrMs)}</Text>
        </View>
      ) : null}

      <View style={st.statusRow}>
        <Text style={[st.nowTime, { color: Colors.textPrimary }]}>{fmtUTC(scrubMs)} UTC</Text>
        <View style={[st.chip, { backgroundColor: STATE_COLORS[planeState] + '22', borderColor: STATE_COLORS[planeState] }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATE_COLORS[planeState] }} />
          <Text style={[st.chipTxt, { color: STATE_COLORS[planeState] }]}>{stateLabel(planeState)}</Text>
        </View>
      </View>

      <View style={st.legend}>
        {(['day', 'dusk', 'night', 'dawn'] as SunState[]).map((sKey) => (
          <View key={sKey} style={st.legItem}>
            <View style={{ width: 9, height: 3, borderRadius: 2, backgroundColor: STATE_COLORS[sKey] }} />
            <Text style={[st.legTxt, { color: Colors.textMuted }]}>{stateLabel(sKey)}</Text>
          </View>
        ))}
      </View>
    </>
  );

  if (embedded) return <View style={{ gap: 10 }}>{body}</View>;

  return (
    <View style={[st.card, { backgroundColor: Colors.card, borderColor: Colors.cardBorder }]}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={st.head} activeOpacity={0.7}>
        <Ionicons name="sunny-outline" size={16} color={Colors.gold} />
        <Text style={[st.title, { color: Colors.textPrimary }]}>{t('dn_title')}</Text>
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
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700' },
  hint: { fontFamily: MONO, fontSize: 11 },
  scrubRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  timeLbl: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nowTime: { fontFamily: MONO, fontSize: 13, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1 },
  chipTxt: { fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legTxt: { fontFamily: MONO, fontSize: 9, fontWeight: '700' },
});

const s = StyleSheet.create({
  dot: { width: MARK_DOT, height: MARK_DOT, borderRadius: MARK_DOT / 2, borderWidth: 1.5, marginVertical: MARK_GAP },
  markerSpacer: { height: MARK_LABEL_H },
  labelChip: { height: MARK_LABEL_H, justifyContent: 'center', backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 5, paddingHorizontal: 5, borderWidth: 0.5, borderColor: Colors.border },
  labelText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontFamily: 'Menlo' },
  planeDiamond: { width: 13, height: 13, backgroundColor: C_PLANE, borderWidth: 1.5, borderColor: '#06101F', transform: [{ rotate: '45deg' }] },
});
