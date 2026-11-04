// Best week i helskärm på Apple-kartan: veckan spelas upp en dag i taget (knappt en sekund per dag), utan farkost som
// rör sig. Dagens resor ritas fullt, tidigare dagar svagare, och ringen runt basen växer till när dagen har lokala
// flygningar. Medan kartan är öppen väntar appens popup-rutor (useMapScreenStore), annars kan skärmen låsa sig.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useBestWeekFull } from '../../hooks/useMilestoneDetails';
import { useMapScreenStore } from '../../store/mapScreenStore';
import { AirportMarker, HomeMarker, arcCoords, regionFor, toLatLng, MAP_GOLD, MAP_WATER } from '../../components/milestones/MilestoneMap';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function hhmm(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function dayTitle(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `${DOW_LONG[dt.getDay()]} ${dt.getDate()} ${MONTH_LONG[dt.getMonth()]}`;
}

export default function BestWeekMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ week?: string; label?: string; hours?: string }>();
  const d = useBestWeekFull(params.week, params.label ?? '', parseFloat(params.hours ?? '') || 0);
  const mapRef = useRef<MapView>(null);
  const [cur, setCur] = useState<number | null>(null);   // null = hela veckan
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    useMapScreenStore.setState({ open: true });
    return () => { useMapScreenStore.setState({ open: false }); if (timer.current) clearInterval(timer.current); };
  }, []);

  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setPlaying(false); };
  const play = () => {
    stop();
    setCur(0);
    setPlaying(true);
    let day = 0;
    timer.current = setInterval(() => {
      day += 1;
      if (day > 6) { stop(); setCur(null); return; }
      setCur(day);
    }, 900);
  };

  const geo = d.geo;
  const coords = geo?.coords ?? {};
  const whole = cur === null;
  const shown = (i: number) => whole || i <= (cur as number);
  const trips = d.days.flatMap((day, i) => day.flights.filter((f) => !f.local && coords[f.dep] && coords[f.arr]).map((f) => ({ ...f, day: i })));
  const away = [...new Set(trips.flatMap((t) => [t.dep, t.arr]))].filter((k) => k !== geo?.home);
  const home = geo?.home ? coords[geo.home] : undefined;
  const pts = Object.values(coords);

  const fit = () => {
    if (!pts.length) return;
    mapRef.current?.fitToCoordinates(pts.map(toLatLng), { edgePadding: { top: insets.top + 110, right: 60, bottom: 260, left: 60 }, animated: false });
  };

  const localSoFar = d.days.flatMap((day, i) => (shown(i) ? day.flights.filter((f) => f.local && f.dep === geo?.home) : []));
  const ldgSoFar = localSoFar.reduce((s, f) => s + f.landings, 0);
  const hoursSoFar = d.days.reduce((s, day, i) => s + (shown(i) ? day.hours : 0), 0);
  const today = whole ? null : d.days[cur as number];
  const pulse = !!today?.flights.some((f) => f.local);
  const todayLocal = today?.flights.filter((f) => f.local) ?? [];
  const todayAway = (today?.flights.filter((f) => !f.local) ?? []).map((f) => f.arr).filter((k) => k !== geo?.home);
  const daySub = whole
    ? `${d.daysFlown} of 7 days in the air · press play to fly it again`
    : !today?.flights.length ? 'No flying this day'
    : [hhmm(today.hours), todayLocal.length ? `${todayLocal.length} local · ${todayLocal.reduce((s, f) => s + f.landings, 0)} landings` : '', todayAway.length ? `to ${todayAway.join(', ')}` : ''].filter(Boolean).join(' · ');
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
        {trips.filter((t) => shown(t.day)).map((t, i) => {
          const now = whole || t.day === cur;
          return (
            <Polyline key={`${t.id}-${i}`} coordinates={arcCoords(coords[t.dep], coords[t.arr])}
              strokeColor={now ? MAP_GOLD : 'rgba(255,184,48,0.4)'} strokeWidth={now ? 2.8 : 1.8} lineCap="round" />
          );
        })}
        {away.map((k) => <AirportMarker key={k} p={coords[k]} icao={k} dim={!trips.some((t) => (t.dep === k || t.arr === k) && shown(t.day))} />)}
        {home && geo?.home ? (
          <HomeMarker p={home} pulse={pulse} size={44} label={`${geo.home} · ${localSoFar.length} local · ${ldgSoFar} landings`} />
        ) : null}
      </MapView>

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={s.close} accessibilityLabel="Close the map">
          <Ionicons name="close" size={18} color={Colors.textPrimary} />
        </Pressable>
        <View style={s.titlePill}>
          <Text style={s.titleText}>{(params.label ?? '').replace('W', 'Week ')}</Text>
          <Text style={s.titleSub}>{d.rangeLabel} · {d.hoursLabel}</Text>
        </View>
      </View>

      <View style={[s.panel, { paddingBottom: insets.bottom + 18 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.dayTitle}>{today ? dayTitle(today.iso) : 'The whole week'}</Text>
            <Text style={s.daySub}>{daySub}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <Text style={s.cap}>WEEK SO FAR</Text>
            <Text style={s.soFar}>{hhmm(hoursSoFar)} / {d.hoursLabel}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => (playing ? stop() : play())} style={s.play} accessibilityLabel={playing ? 'Pause the replay' : 'Replay the week'}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={Colors.textInverse} />
          </Pressable>
          <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
            {d.days.map((day, i) => {
              const on = cur === i, done = shown(i), rest = day.hours <= 0;
              return (
                <Pressable key={day.iso} onPress={() => { stop(); setCur(i); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${dayTitle(day.iso)}, ${rest ? 'no flying' : `${hhmm(day.hours)} hours`}. Show the week up to this day`}
                  style={[s.chip, { borderColor: on ? Colors.accent : Colors.cardBorder, backgroundColor: on ? Colors.accent + '1F' : 'transparent' }]}>
                  <Text style={[s.chipDow, { color: on ? Colors.accent : done && !rest ? Colors.textPrimary : Colors.textMuted }]}>{day.dow.charAt(0)}</Text>
                  <View style={{ width: '60%', borderRadius: 2, height: rest ? 2 : Math.max(3, (day.hours / maxDay) * 16), backgroundColor: rest ? Colors.cardBorder : done ? Colors.accent : '#1F4A66' }} />
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
