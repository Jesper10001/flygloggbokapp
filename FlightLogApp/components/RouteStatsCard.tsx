// Rutten från min position till en flygplats (Fly to på Global map och Find airport), i flygplatskortets stil
// (AirportInfoCard): rubrikrad "FROM YOUR POSITION" med farkosten som val till höger, och en remsa med
// guldetiketter: DISTANCE · COURSE ⇄ (magnetisk/sann) · TIME · FUEL ⇄ (L/kg/gal). Bara visning; beräkningen
// och växlarna ligger hos föräldern (AirportNavPanel, AirportQuickSearch).
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const MONO = 'JetBrainsMono';
const GOLD = '#FFB830';
const MUTED = '#8FB0CC';
const fmtQty = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

export function RouteStatsCard({ accent, locState, hasPos, distanceNm, course, ete, fuel, aircraft, onToggleCourse, onToggleFuel, onPickAircraft, trueNote }: {
  accent: string;
  locState: 'idle' | 'loading' | 'denied' | 'ready';
  hasPos: boolean;
  distanceNm: number | null;
  course: { v: number; s: string } | null;
  ete: string | null;
  fuel: { v: number; u: string } | null;
  aircraft: string | null;          // farkosten beräkningen bygger på (null = ingen tid/bränsle)
  onToggleCourse: () => void;
  onToggleFuel: () => void;
  onPickAircraft: () => void;
  trueNote: boolean;                // kompassen saknas → sann kurs, med förklaring
}) {
  const line = accent + '33';
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '55' }}>
      <LinearGradient colors={['rgba(18,48,74,0.97)', 'rgba(15,30,58,0.97)']} locations={[0, 0.55]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {locState === 'denied' ? (
        <Text style={s.hint}>Enable location access to see distance & course from your position.</Text>
      ) : !hasPos || distanceNm == null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
          <ActivityIndicator color={accent} />
          <Text style={[s.hint, { padding: 0 }]}>Getting your position…</Text>
        </View>
      ) : (
        <>
          {/* Rubrikrad */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 12, paddingTop: 10, paddingBottom: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6, color: accent }}>FROM YOUR POSITION</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: line }} />
            {aircraft && (
              <TouchableOpacity onPress={onPickAircraft} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} activeOpacity={0.7}
                accessibilityRole="button" accessibilityLabel={`Calculated for ${aircraft}. Change aircraft`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 9, borderRadius: 11, borderWidth: 1, borderColor: accent + '73', backgroundColor: accent + '1A' }}>
                <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: accent }} numberOfLines={1}>{aircraft}</Text>
                <Ionicons name="chevron-down" size={11} color={accent} />
              </TouchableOpacity>
            )}
          </View>
          {/* Remsan */}
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: line }}>
            <Cell label="DISTANCE" value={fmtQty(distanceNm)} unit=" NM" first line={line} />
            {course && (
              <Cell label="COURSE" swap onPress={onToggleCourse} value={String(Math.round(course.v) % 360).padStart(3, '0')} unit={`°${course.s}`} color={accent} line={line}
                a11y={`Course ${Math.round(course.v) % 360} degrees ${course.s === 'M' ? 'magnetic' : 'true'}. Tap to switch`} />
            )}
            {ete && <Cell label="TIME" value={ete} unit=" h" line={line} />}
            {fuel && (
              <Cell label="FUEL" swap onPress={onToggleFuel} value={fmtQty(fuel.v)} unit={` ${fuel.u}`} line={line} a11y={`Fuel ${fmtQty(fuel.v)} ${fuel.u}. Tap to change unit`} />
            )}
          </View>
          {trueNote && (
            <Text style={{ fontSize: 10.5, lineHeight: 14, color: MUTED, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: line }}>
              Magnetic course needs the compass — showing true (°T). Move the device in a figure-8 to calibrate.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

function Cell({ label, value, unit, color = '#FFFFFF', first = false, swap = false, onPress, line, a11y }: {
  label: string; value: string; unit: string; color?: string; first?: boolean; swap?: boolean; onPress?: () => void; line: string; a11y?: string;
}) {
  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: GOLD }}>{label}</Text>
        {swap && <Ionicons name="swap-horizontal" size={9} color={MUTED} />}
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontFamily: MONO, fontSize: 17, fontWeight: '800', color, marginTop: 4, fontVariant: ['tabular-nums'] }}>
        {value}<Text style={{ fontSize: 10, fontWeight: '700', color: MUTED }}>{unit}</Text>
      </Text>
    </>
  );
  const style = [{ flex: 1, minWidth: 0, paddingVertical: 9, paddingHorizontal: 10 }, !first && { borderLeftWidth: 1, borderLeftColor: line }];
  return onPress
    ? <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={style} accessibilityRole="button" accessibilityLabel={a11y}>{body}</TouchableOpacity>
    : <View style={style}>{body}</View>;
}

const s = StyleSheet.create({
  hint: { color: MUTED, fontSize: 12.5, fontWeight: '600', lineHeight: 18, padding: 14 },
});
