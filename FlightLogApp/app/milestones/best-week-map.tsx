// Best week i helskärm på Apple-kartan, uppspelad som Longest XC: farkosten (helikopter eller plan efter flottans
// kategori) flyger veckans resor en i taget i den ordning de flögs, och sträckan ritas i cyan. Flygningar som startar
// och landar på samma ställe visas inte här. Ett tryck på en dag visar veckan fram till den dagen. Medan kartan är
// öppen väntar appens popup-rutor (useMapScreenStore), annars kan skärmen låsa sig.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline, Marker, type LatLng } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useBestWeekFull } from '../../hooks/useMilestoneDetails';
import { useMapScreenStore } from '../../store/mapScreenStore';
import { getAircraftCategory } from '../../db/flights';
import {
  AirportMarker, AircraftIcon, arcCoords, alongArc, regionFor, toLatLng, nmBetween, MAP_CYAN, MAP_CYAN_DIM, MAP_WATER, type GeoPt,
} from '../../components/milestones/MilestoneMap';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TICK = 40, PER_TRIP = 30;   // 40 ms per steg, 30 steg per resa ≈ 1,2 sekunder
function hhmm(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function dayTitle(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `${DOW_LONG[dt.getDay()]} ${dt.getDate()} ${MONTH_LONG[dt.getMonth()]}`;
}

interface Trip { key: string; day: number; from: string; to: string; arc: LatLng[]; nm: number; type: string }

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
  const trips: Trip[] = useMemo(() => d.days.flatMap((day, i) => day.flights
    .filter((f) => !f.local && coords[f.dep] && coords[f.arr])
    .map((f) => ({ key: `${f.id}`, day: i, from: f.dep, to: f.arr, arc: arcCoords(coords[f.dep], coords[f.arr]), nm: nmBetween(coords[f.dep], coords[f.arr]), type: f.aircraftType }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [d.days, d.geo]);
  const totalNm = trips.reduce((s, t) => s + t.nm, 0);

  // Helikopter eller plan per farkosttyp, ur flottan.
  const [heliTypes, setHeliTypes] = useState<Record<string, boolean>>({});
  const typeKey = [...new Set(trips.map((t) => t.type).filter(Boolean))].sort().join('|');
  useEffect(() => {
    let alive = true;
    const types = typeKey ? typeKey.split('|') : [];
    Promise.all(types.map(async (t) => [t, (await getAircraftCategory(t).catch(() => '')) === 'helicopter'] as const))
      .then((rows) => { if (alive) setHeliTypes(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [typeKey]);

  // p = hur långt uppspelningen kommit, i resor (2,5 = halvvägs på den tredje). null = hela veckan eller en vald dag.
  const [p, setP] = useState<number | null>(null);
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pRef = useRef<number | null>(null);
  pRef.current = p;
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setPlaying(false); };
  const play = () => {
    if (!trips.length) return;
    stop();
    let now = pRef.current != null && pRef.current < trips.length ? pRef.current : 0;
    setPickedDay(null);
    setP(now);
    setPlaying(true);
    timer.current = setInterval(() => {
      now += 1 / PER_TRIP;
      if (now >= trips.length) { stop(); setP(null); return; }
      setP(now);
    }, TICK);
  };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const idx = p != null ? Math.min(trips.length - 1, Math.floor(p)) : -1;
  const frac = p != null ? p - idx : 0;
  const curTrip = idx >= 0 ? trips[idx] : null;
  const curDay = curTrip ? curTrip.day : pickedDay;
  // Den påbörjade bågen ritas om i åtta steg per resa, inte varje bildruta (Apple-kartan flimrar annars).
  const partStep = Math.floor(frac * 8);
  const partial = useMemo(() => {
    if (!curTrip) return [];
    const n = curTrip.arc.length - 1, upto = Math.max(1, Math.round((partStep / 8) * n));
    return curTrip.arc.slice(0, upto + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, partStep, trips]);
  const plane = curTrip ? alongArc(curTrip.arc, frac) : null;

  const drawn = trips.map((t, i) => {
    if (p != null) return i < idx ? 'past' : i === idx ? 'now' : 'hidden';
    if (pickedDay != null) return t.day < pickedDay ? 'past' : t.day === pickedDay ? 'bright' : 'hidden';
    return 'bright';
  });
  const nmSoFar = p != null ? trips.reduce((s, t, i) => s + (i < idx ? t.nm : i === idx ? t.nm * frac : 0), 0)
    : pickedDay != null ? trips.filter((t) => t.day <= pickedDay).reduce((s, t) => s + t.nm, 0) : totalNm;

  const airports = [...new Set(trips.flatMap((t) => [t.from, t.to]))];
  const pts: GeoPt[] = airports.length ? airports.map((k) => coords[k]) : Object.values(coords);
  const fit = () => {
    if (!pts.length) return;
    mapRef.current?.fitToCoordinates(pts.map(toLatLng), { edgePadding: { top: insets.top + 110, right: 70, bottom: 250, left: 50 }, animated: false });
  };

  const day = curDay != null ? d.days[curDay] : null;
  const dayTrips = curDay != null ? trips.filter((t) => t.day === curDay) : [];
  const daysAway = new Set(trips.map((t) => t.day)).size;
  const daySub = !trips.length ? 'No flights between airports this week'
    : !day ? `${trips.length} ${trips.length === 1 ? 'flight' : 'flights'} on ${daysAway} ${daysAway === 1 ? 'day' : 'days'} · press play to fly the week`
    : !dayTrips.length ? (day.flights.length ? 'Only local flights this day' : 'No flying this day')
    : `${hhmm(day.hours)} · ${dayTrips.map((t) => `${t.from} → ${t.to}`).join(', ')}`;
  const maxDay = Math.max(0.1, ...d.days.map((x) => x.hours));

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
        {trips.map((t, i) => drawn[i] === 'past' || drawn[i] === 'bright' ? (
          <Polyline key={t.key} coordinates={t.arc} strokeColor={drawn[i] === 'past' ? MAP_CYAN_DIM : MAP_CYAN} strokeWidth={drawn[i] === 'past' ? 1.8 : 2.8} lineCap="round" />
        ) : null)}
        {partial.length > 1 ? <Polyline coordinates={partial} strokeColor={MAP_CYAN} strokeWidth={2.8} lineCap="round" /> : null}
        {airports.map((k) => <AirportMarker key={k} p={coords[k]} icao={k} />)}
        {plane && curTrip ? (
          <Marker coordinate={toLatLng(plane.p)} zIndex={10}>
            <AircraftIcon heli={!!heliTypes[curTrip.type]} heading={plane.heading} spinning={playing} />
          </Marker>
        ) : null}
      </MapView>

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={s.close} accessibilityLabel="Close the map">
          <Ionicons name="close" size={18} color={Colors.textPrimary} />
        </Pressable>
        <View style={s.titlePill}>
          <Text style={s.titleText}>{(params.label ?? '').replace('W', 'Week ')}</Text>
          <Text style={s.titleSub}>{d.rangeLabel}</Text>
        </View>
      </View>

      <View style={[s.panel, { paddingBottom: insets.bottom + 18 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.dayTitle}>{day ? dayTitle(day.iso) : 'The whole week'}</Text>
            <Text style={s.daySub}>{daySub}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <Text style={s.cap}>FLOWN</Text>
            <Text style={s.soFar}>{Math.round(nmSoFar)} / {Math.round(totalNm)} NM</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => (playing ? stop() : play())} disabled={!trips.length} style={[s.play, !trips.length && { opacity: 0.4 }]}
            accessibilityLabel={playing ? 'Pause the replay' : 'Replay the week'}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={Colors.textInverse} />
          </Pressable>
          <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
            {d.days.map((x, i) => {
              const on = curDay === i, done = curDay == null || i <= curDay, rest = x.hours <= 0;
              return (
                <Pressable key={x.iso} onPress={() => { stop(); setP(null); setPickedDay(i); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${dayTitle(x.iso)}, ${rest ? 'no flying' : `${hhmm(x.hours)} hours`}. Show the week up to this day`}
                  style={[s.chip, { borderColor: on ? Colors.accent : Colors.cardBorder, backgroundColor: on ? Colors.accent + '1F' : 'transparent' }]}>
                  <Text style={[s.chipDow, { color: on ? Colors.accent : done && !rest ? Colors.textPrimary : Colors.textMuted }]}>{x.dow.charAt(0)}</Text>
                  <View style={{ width: '60%', borderRadius: 2, height: rest ? 2 : Math.max(3, (x.hours / maxDay) * 16), backgroundColor: rest ? Colors.cardBorder : done ? Colors.accent : '#1F4A66' }} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(18,26,36,0.85)', borderWidth: 1, borderColor: '#3A3F46', alignItems: 'center', justifyContent: 'center' },
  titlePill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(18,26,36,0.85)', borderWidth: 1, borderColor: '#3A3F46', justifyContent: 'center', gap: 1 },
  titleText: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: Colors.textPrimary },
  titleSub: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 16, paddingHorizontal: 20, gap: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: 'rgba(10,22,40,0.95)', borderTopWidth: 1, borderColor: Colors.cardBorder },
  dayTitle: { fontFamily: SERIF, fontSize: 19, fontWeight: '600', color: Colors.textPrimary },
  daySub: { fontFamily: MONO, fontSize: 10.5, color: Colors.textSecondary },
  cap: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, color: Colors.textSecondary },
  soFar: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: Colors.accent },
  play: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  chip: { flex: 1, minHeight: 48, paddingVertical: 6, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'space-between' },
  chipDow: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700' },
});
