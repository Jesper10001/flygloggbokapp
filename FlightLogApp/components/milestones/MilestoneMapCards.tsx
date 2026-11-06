// Korten för Best week och Longest XC längst ner i Insights: lika breda, med Apple-kartan som förhandsbild.
// Best week visar veckans resor som raka linjer och basen med en streckad ring, Longest XC dagens rutt. Allt i cyan.

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_LED7 } from '../logflight/tokens';
import type { BestWeekDetails } from '../../hooks/useMilestoneDetails';
import type { RouteLeg } from './MiniRouteMap';
import { StaticMap, GlowLine, HomeMarker, regionFor, toLatLng, MAP_CYAN } from './MilestoneMap';

const MONO = 'JetBrainsMono';

function CardShell({ dot, title, onPress, children, a11y }: { dot: string; title: string; onPress: () => void; children: React.ReactNode; a11y: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [c.card, { opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" accessibilityLabel={a11y}>
      <View style={c.head}>
        <View style={[c.dot, { backgroundColor: dot }]} />
        <Text style={c.title}>{title}</Text>
        <Ionicons name="chevron-forward" size={12} color={Colors.textSecondary} />
      </View>
      {children}
    </Pressable>
  );
}

export function BestWeekMapCard({ hoursLabel, weekLabel, details, onPress }: { hoursLabel: string; weekLabel: string; details: BestWeekDetails; onPress: () => void }) {
  const geo = details.geo;
  const coords = geo?.coords ?? {};
  const trips = details.trips.filter((t) => coords[t.from] && coords[t.to]);
  const home = geo?.home ? coords[geo.home] : undefined;
  const sub = geo?.localCount ? `${geo.localCount} local · ${geo.localLandings} landings` : `${details.sectors} sectors · ${details.airports} airports`;
  return (
    <CardShell dot={Colors.accent} title="BEST WEEK" onPress={onPress} a11y={`Best week, ${hoursLabel} hours, ${weekLabel}. Open`}>
      <StaticMap region={regionFor(Object.values(coords))} style={c.map} fade={Colors.card}>
        {trips.map((t, i) => <GlowLine key={i} coords={[toLatLng(coords[t.from]), toLatLng(coords[t.to])]} width={1.6} />)}
        {home ? <HomeMarker p={home} size={20} /> : null}
      </StaticMap>
      <View style={c.valueRow}>
        <Text style={c.led}>{hoursLabel}</Text>
        <Text style={[c.unit, { color: Colors.accent }]}>h</Text>
      </View>
      <View style={{ gap: 2, marginTop: -4 }}>
        <Text style={c.line}>{weekLabel || '—'}</Text>
        <Text numberOfLines={1} style={c.sub}>{sub}</Text>
      </View>
    </CardShell>
  );
}

export function LongestXcMapCard({ distanceNm, routeFrom, routeTo, dateShort, legs, onPress }: {
  distanceNm: number; routeFrom: string; routeTo: string; dateShort: string; legs: RouteLeg[]; onPress: () => void;
}) {
  const legCount = Math.max(0, legs.length - 1);
  return (
    <CardShell dot={MAP_CYAN} title="LONGEST XC" onPress={onPress} a11y={`Longest cross-country, ${distanceNm} nautical miles, ${routeFrom} to ${routeTo}. Open`}>
      <StaticMap region={regionFor(legs)} style={c.map} fade={Colors.card}>
        {legs.length >= 2 ? <GlowLine coords={legs.map(toLatLng)} width={2} /> : null}
      </StaticMap>
      <View style={c.valueRow}>
        <Text style={c.led}>{Math.round(distanceNm).toLocaleString('en-US')}</Text>
        <Text style={[c.unit, { color: MAP_CYAN }]}>NM</Text>
      </View>
      <View style={{ gap: 2, marginTop: -4 }}>
        <Text numberOfLines={1} style={c.line}>{routeFrom} → {routeTo}</Text>
        <Text numberOfLines={1} style={c.sub}>{dateShort}{legCount ? ` · ${legCount} ${legCount === 1 ? 'leg' : 'legs'}` : ''}</Text>
      </View>
    </CardShell>
  );
}

const c = StyleSheet.create({
  card: { flex: 1, minWidth: 0, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 16, padding: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  title: { flex: 1, fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.3, color: Colors.textSecondary },
  map: { height: 128, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  led: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22, color: Colors.textPrimary },
  unit: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  line: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
});
