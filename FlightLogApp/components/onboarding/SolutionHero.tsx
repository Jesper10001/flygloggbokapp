// Bilden överst på onboardingens lösningssida: en lutad panel i två halvor med en lysande linje i mitten.
// Vänster halva är det man har i dag (pappersbokens sida, exportfilen, det man skriver, drönarappens flyglista),
// höger halva är samma flygningar i Blades, med det Blades lägger till som gröna etiketter.
// Raderna är exempel och säger ingenting om användarens egna flygningar.

import { useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation, useReducedMotion } from 'react-native-reanimated';

export type HeroKind = 'paper' | 'file' | 'type' | 'drone';
export type DroneKind = 'hobby' | 'commercial' | 'military';

const CYAN = '#00C8E8';
const GREEN = '#19E6A5';
const MONO = 'JetBrainsMono';
const ROW_H = 26;
const HEAD_H = 30;
const HEIGHT = HEAD_H + 7 * ROW_H + 38;

const FLIGHTS: [string, string, string, string, string][] = [
  // dag, från, till, tid, det Blades lägger till
  ['12', 'ESSA', 'ESGG', '0:55', 'NIGHT 0:30'],
  ['12', 'ESGG', 'ESSA', '1:00', '213 NM'],
  ['14', 'ESSA', 'ENGM', '1:05', '1 LDG'],
  ['14', 'ENGM', 'ESSA', '1:10', 'NIGHT 1:10'],
  ['17', 'ESSA', 'EKCH', '1:15', 'IFR'],
  ['17', 'EKCH', 'ESSA', '1:10', '2 LDG'],
  ['19', 'ESSA', 'ESMS', '1:05', '283 NM'],
];
const DRONE: [string, string, string][] = [
  ['12 Mar 09:14', '18', '1.2 km'],
  ['12 Mar 09:41', '22', '2.0 km'],
  ['12 Mar 10:20', '16', '0.9 km'],
  ['14 Mar 13:02', '25', '3.4 km'],
  ['14 Mar 13:40', '21', '2.8 km'],
  ['17 Mar 08:55', '19', '1.1 km'],
  ['17 Mar 09:30', '24', '2.2 km'],
];
// Etiketterna i drönarloggboken följer den sortens flygning man valt: Open (A1–A3), Open och Specific, eller
// NATO-klasserna för militära piloter (constants/droneCategories.ts).
const DRONE_TAGS: Record<DroneKind, string[]> = {
  hobby: ['VLOS · A1', 'VLOS · A1', 'VLOS · A1', 'VLOS · A3', 'VLOS · A3', 'VLOS · A2', 'VLOS · A2'],
  commercial: ['VLOS · A2', 'VLOS · A2', 'VLOS · A2', 'BVLOS · SPEC', 'BVLOS · SPEC', 'VLOS · A1', 'VLOS · A1'],
  military: ['VLOS · CLASS I', 'VLOS · CLASS I', 'VLOS · CLASS I', 'BVLOS · CLASS II', 'BVLOS · CLASS II', 'BVLOS · CLASS III', 'BVLOS · CLASS III'],
};

const A11Y: Record<HeroKind, string> = {
  paper: 'A handwritten logbook page on the left, the same flights typed into Blades on the right',
  file: 'An export file on the left, the same flights in Blades on the right with night, distance and landings added',
  type: 'What you type on the left, the flight in Blades on the right with night, distance and landings added',
  drone: 'The flight list from a drone app on the left, the same flights in your logbook on the right with sight mode and category or class',
};

export function SolutionHero({ kind, drone = 'commercial' }: { kind: HeroKind; drone?: DroneKind }) {
  const { width } = useWindowDimensions();
  const W = width + 28;
  const half = W / 2;
  const reduced = useReducedMotion();
  const glow = useSharedValue(0.75);
  useEffect(() => {
    if (reduced) return;
    glow.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(glow);
  }, [glow, reduced]);
  const beam = useAnimatedStyle(() => ({ opacity: glow.value }));

  const tag = (t: string) => <Text style={s.tag}>{t}</Text>;
  const left = kind === 'paper' ? (
    <View style={[s.half, { width: half, backgroundColor: '#EFE7D3' }]}>
      <Text style={[s.head, { color: '#6C6350' }]}>DATE · FROM · TO · TIME</Text>
      {FLIGHTS.map((f, i) => (
        <View key={i} style={[s.row, { borderBottomColor: '#B9AE93' }]}>
          <Text style={s.hand} numberOfLines={1}>{f[0]}/3   {f[1]}   {f[2]}   {f[3]}</Text>
        </View>
      ))}
    </View>
  ) : kind === 'drone' ? (
    <View style={[s.half, { width: half, backgroundColor: '#1C1F26' }]}>
      <Text style={[s.head, { color: '#C8CDD6', fontFamily: undefined, letterSpacing: 0, fontSize: 10.5 }]}>Flight records</Text>
      {DRONE.map((f, i) => (
        <View key={i} style={[s.row, { borderBottomColor: '#2E333D' }]}>
          <Text style={{ fontSize: 10, color: '#E3E6EB' }} numberOfLines={1}>{f[0]}   <Text style={{ color: '#9AA3B2' }}>{f[1]} min   {f[2]}</Text></Text>
        </View>
      ))}
    </View>
  ) : (
    <View style={[s.half, { width: half, backgroundColor: '#F1F4F8', paddingLeft: 0 }]}>
      <Text style={[s.head, { color: '#3B4B60', backgroundColor: '#DCE3EC', paddingLeft: 18, letterSpacing: kind === 'type' ? 1.4 : 0 }]}>
        {kind === 'type' ? 'WHAT YOU TYPE' : 'logbook_export.csv'}
      </Text>
      {FLIGHTS.map((f, i) => (
        <View key={i} style={[s.row, { borderBottomColor: '#CBD5E1', paddingLeft: 18 }]}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, color: '#26364C' }} numberOfLines={1}>
            {kind === 'type' ? `${f[1]}  ${f[2]}  ${f[3]}` : `2026-03-${f[0]},${f[1]},${f[2]},${f[3]}`}
          </Text>
        </View>
      ))}
    </View>
  );
  const right = (
    <View style={[s.half, { width: half, backgroundColor: '#0B1A33', paddingLeft: 14 }]}>
      <Text style={[s.head, { color: '#33D4ED' }]}>{kind === 'drone' ? 'YOUR LOGBOOK' : 'IN BLADES'}</Text>
      {kind === 'drone' ? DRONE.map((f, i) => (
        <View key={i} style={[s.row, s.rowR]}>
          <Text style={s.dig} numberOfLines={1}>{f[0].slice(0, 6)} 0:{f[1]}</Text>{tag(DRONE_TAGS[drone][i])}
        </View>
      )) : FLIGHTS.map((f, i) => (
        <View key={i} style={[s.row, s.rowR]}>
          <Text style={s.dig} numberOfLines={1}>{kind === 'paper' ? `${f[0]} MAR ${f[1]} ${f[2]} ${f[3]}` : `${f[1]} ${f[2]} ${f[3]}`}</Text>
          {kind === 'paper' ? null : tag(f[4])}
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ height: HEIGHT + 34, marginHorizontal: -36, alignItems: 'center', justifyContent: 'center' }}
      accessible accessibilityRole="image" accessibilityLabel={A11Y[kind]}>
      <View style={[s.panel, { width: W, height: HEIGHT }]}>
        <View style={s.clip}>{left}{right}</View>
      </View>
      <Animated.View pointerEvents="none" style={[s.beam, { height: HEIGHT + 44 }, beam]} />
    </View>
  );
}

const s = StyleSheet.create({
  panel: { transform: [{ rotate: '-4deg' }], borderRadius: 10, shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 26, shadowOffset: { width: 0, height: 18 } },
  clip: { flex: 1, flexDirection: 'row', borderRadius: 10, overflow: 'hidden' },
  half: { paddingLeft: 26 },
  head: { height: HEAD_H, lineHeight: HEAD_H, fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1.3 },
  row: { height: ROW_H, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' },
  rowR: { borderBottomColor: 'rgba(0,200,232,0.2)', gap: 5 },
  // Handstilen: appens kursiva serif i bläckblått (ingen egen handstilsfont följer med appen).
  hand: { fontFamily: 'Fraunces-Italic', fontSize: 13.5, color: '#22324A' },
  dig: { fontFamily: MONO, fontSize: 10, fontWeight: '500', color: '#DFF6FB' },
  tag: { fontFamily: MONO, fontSize: 8, fontWeight: '700', color: '#06231A', backgroundColor: GREEN, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1.5, overflow: 'hidden' },
  beam: { position: 'absolute', width: 3, borderRadius: 2, backgroundColor: CYAN, transform: [{ rotate: '-4deg' }], shadowColor: CYAN, shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
});
