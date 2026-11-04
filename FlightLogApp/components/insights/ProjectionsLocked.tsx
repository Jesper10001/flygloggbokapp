// Projections innan loggboken har tillräckligt med historik (60 dagar sedan första flygningen och
// 10 flygningar, se projectionUnlock). Samma kort som det upplåsta, men mål, takt och mål-listan är låsta: ett
// tryck skakar låset och visar vad som saknas i stället för att öppna något.

import { useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, PROJECTION_MIN_DAYS, PROJECTION_MIN_FLIGHTS, type ProjectionUnlock } from './insightsData';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d: Date) => `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}`;

export function ProjectionsLocked({ unlock }: { unlock: ProjectionUnlock }) {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const shake = useRef(new Animated.Value(0)).current;

  const nudge = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    shake.setValue(0);
    Animated.sequence([-7, 6, -4, 2, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 70, useNativeDriver: true }))).start();
  };

  const hours = D.journey.length ? D.journey[D.journey.length - 1].cum : 0;
  const daysOk = unlock.days >= PROJECTION_MIN_DAYS, flightsOk = unlock.flights >= PROJECTION_MIN_FLIGHTS;
  const daysLeft = Math.max(0, PROJECTION_MIN_DAYS - unlock.days), flightsLeft = Math.max(0, PROJECTION_MIN_FLIGHTS - unlock.flights);
  const dayFrac = Math.min(1, unlock.days / PROJECTION_MIN_DAYS), flightFrac = Math.min(1, unlock.flights / PROJECTION_MIN_FLIGHTS);
  const unlockLabel = unlock.unlockDate ? dayLabel(unlock.unlockDate) : '';
  const more = `${flightsLeft} more ${flightsLeft === 1 ? 'flight' : 'flights'}`;
  const headline = !daysOk ? unlockLabel : more;
  const subline = !daysOk && !flightsOk ? `at the earliest · and ${more}`
    : !daysOk ? (daysLeft === 1 ? 'Tomorrow' : `In ${daysLeft} days`)
    : 'Log them and it unlocks';

  // Ringen runt låset: hur långt båda villkoren kommit, medurs från toppen.
  const f = Math.min(0.995, (dayFrac + flightFrac) / 2);
  const ang = -Math.PI / 2 + f * 2 * Math.PI;
  const ring = f < 0.01 ? '' : `M 37 5 A 32 32 0 ${f > 0.5 ? 1 : 0} 1 ${(37 + 32 * Math.cos(ang)).toFixed(2)} ${(37 + 32 * Math.sin(ang)).toFixed(2)}`;

  const lockedTile = (label: string) => (
    <TouchableOpacity key={label} onPress={nudge} activeOpacity={1} accessibilityState={{ disabled: true }}
      accessibilityLabel={`${label}, locked until the projection unlocks`}
      style={[st.tile, { borderColor: C.border, backgroundColor: C.deep }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[st.cap, { color: C.muted }]}>{label.toUpperCase()}</Text>
        <Ionicons name="lock-closed" size={10} color={C.muted} />
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: C.border }}>{'—'}</Text>
    </TouchableOpacity>
  );

  const progressRow = (icon: 'calendar-outline' | 'airplane-outline', title: string, value: string, frac: number, done: boolean, note: string) => (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Ionicons name={done ? 'checkmark-circle' : icon} size={13} color={done ? C.text : C.text2} />
        <Text style={[st.cap, { flex: 1, color: done ? C.text : C.text2 }]}>{title}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.text }}>{value}</Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: C.elevated, overflow: 'hidden' }}>
        <View style={{ height: 4, borderRadius: 2, width: `${Math.max(3, frac * 100)}%`, backgroundColor: done ? C.quiet : C.primary }} />
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, color: C.text2 }}>{note}</Text>
    </View>
  );

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Ionicons name="trending-up" size={17} color={C.text2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: C.text }}>Projections</Text>
        <TouchableOpacity onPress={nudge} activeOpacity={1} accessibilityState={{ disabled: true }} accessibilityLabel="Kind of time, locked"
          style={[st.chip, { borderColor: C.border, backgroundColor: C.deep }]}>
          <Ionicons name="lock-closed" size={10} color={C.muted} />
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.muted }}>Total</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
        <View style={{ gap: 3 }}>
          <Text style={[st.cap, { color: C.text2 }]}>NOW</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={{ fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22, color: C.text }}>{hours < 100 ? hours.toFixed(1) : Math.round(hours)}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.primary }}>h</Text>
          </View>
        </View>
        <Ionicons name="arrow-forward" size={14} color={C.border} style={{ marginBottom: 6 }} />
        <View style={{ gap: 3 }} accessibilityLabel="No target yet">
          <Text style={[st.cap, { color: C.muted }]}>TARGET</Text>
          <Text style={{ fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22, color: C.separator }}>8888</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end', gap: 3 }}>
          <Text style={[st.cap, { color: C.muted }]}>ETA</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name="lock-closed" size={13} color={C.muted} />
            <Text style={{ fontFamily: SERIF, fontSize: 19, fontWeight: '600', color: C.muted }}>Locked</Text>
          </View>
        </View>
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: 15, color: C.text2, marginTop: -4 }}>
        Projections need {PROJECTION_MIN_DAYS} days of history and {PROJECTION_MIN_FLIGHTS} flights, so the pace is yours and not a guess from a few flights.
      </Text>

      <TouchableOpacity onPress={nudge} activeOpacity={1} accessibilityLabel={`Projection unlocks ${headline}, ${subline}`}
        style={{ height: 168, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width="100%" height="100%" viewBox="0 0 328 168" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="lockFade" cx="50%" cy="46%" r="62%">
              <Stop offset="0" stopColor={C.card} stopOpacity={0.5} />
              <Stop offset="0.72" stopColor={C.card} stopOpacity={0.94} />
            </RadialGradient>
          </Defs>
          <Path d="M 4 40 H 272 M 4 76 H 272 M 4 112 H 272" fill="none" stroke={C.separator} strokeWidth={1} />
          <Path d="M 4 146 C 60 144 96 136 130 120 C 160 106 178 94 196 84" fill="none" stroke={C.primary} strokeWidth={2.3} strokeLinecap="round" strokeDasharray="2 5" opacity={0.35} />
          <Path d="M 196 84 L 266 38" fill="none" stroke={C.soft} strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" opacity={0.28} />
          <Path d="M 4 32 H 272" fill="none" stroke={C.quiet} strokeWidth={1} strokeDasharray="4 4" opacity={0.2} />
          <Rect x={0} y={0} width={328} height={168} fill="url(#lockFade)" />
        </Svg>
        <Animated.View style={{ alignItems: 'center', gap: 8, transform: [{ translateX: shake }] }}>
          <View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={74} height={74} style={StyleSheet.absoluteFill}>
              <Circle cx={37} cy={37} r={32} fill="none" stroke={C.elevated} strokeWidth={5} />
              {ring ? <Path d={ring} fill="none" stroke={C.primary} strokeWidth={5} strokeLinecap="round" /> : null}
            </Svg>
            <Ionicons name="lock-closed-outline" size={24} color={C.text} />
          </View>
          <View style={{ alignItems: 'center', gap: 1 }}>
            <Text style={[st.cap, { color: C.text2 }]}>PROJECTION UNLOCKS</Text>
            <Text style={{ fontFamily: SERIF, fontSize: 23, fontWeight: '600', color: C.text }}>{headline}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10.5, color: C.text2 }}>{subline}</Text>
          </View>
        </Animated.View>
      </TouchableOpacity>

      <View style={{ gap: 10, paddingHorizontal: 2 }}>
        {progressRow('calendar-outline', `${PROJECTION_MIN_DAYS} DAYS OF HISTORY`, `${Math.min(unlock.days, PROJECTION_MIN_DAYS)} / ${PROJECTION_MIN_DAYS}`, dayFrac, daysOk,
          daysOk ? 'Done' : unlock.firstDate ? `First flight ${dayLabel(unlock.firstDate)} · done ${unlockLabel}` : 'Starts with your first flight')}
        {progressRow('airplane-outline', `${PROJECTION_MIN_FLIGHTS} FLIGHTS`, `${Math.min(unlock.flights, PROJECTION_MIN_FLIGHTS)} / ${PROJECTION_MIN_FLIGHTS}`, flightFrac, flightsOk,
          flightsOk ? 'Done' : `${more} to go · simulator sessions don’t count`)}
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {['Target', 'Pace', 'Goals'].map(lockedTile)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  cap: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  chip: { minHeight: 32, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tile: { flex: 1, minHeight: 40, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 5, paddingHorizontal: 9, justifyContent: 'center', gap: 2 },
});
