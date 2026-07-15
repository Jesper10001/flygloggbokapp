// En flygningsrad i listan: datumchip · DEP→ARR + IFR/Night-badges · roll · typ/reg · block-tid + off/on-block UTC.
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { FONT_SERIF, FONT_MONO, NIGHT_BADGE } from './tokens';
import { roleLabel, isPicFlight, arrUtc, dayOfMonth, weekdayShort } from './flightDisplay';

function Badge({ color, label, icon }: { color: string; label?: string; icon?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: color + '1F', borderColor: color + '55', borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
      {icon ? <Ionicons name="moon" size={9} color={color} /> : null}
      {label ? <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color }}>{label}</Text> : null}
    </View>
  );
}

export function FlightCardRow({ flight: f, accent, onPress, first }: { flight: Flight; accent: string; onPress: () => void; first?: boolean }) {
  const { formatTime } = useTimeFormat();
  const role = roleLabel(f);
  const roleColor = isPicFlight(f) ? accent : Colors.textSecondary;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: Colors.separator }}>
      {/* datumchip */}
      <View style={{ width: 34, alignItems: 'center' }}>
        <Text style={{ fontFamily: FONT_SERIF, fontSize: 20, fontWeight: '600', color: Colors.textPrimary, lineHeight: 22 }}>{dayOfMonth(f.date)}</Text>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.7, color: Colors.textMuted, textTransform: 'uppercase', marginTop: 2 }}>{weekdayShort(f.date)}</Text>
      </View>
      {/* main */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.3 }}>{f.dep_place} → {f.arr_place}</Text>
          {f.ifr > 0 ? <Badge color={accent} label="IFR" /> : null}
          {f.night > 0 ? <Badge color={NIGHT_BADGE} icon /> : null}
          {(f.photo_local_id || f.photo_uri) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.textMuted + '1F', borderColor: Colors.textMuted + '55', borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
              <Ionicons name="image" size={9} color={Colors.textMuted} />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted, marginTop: 3 }}>
          <Text style={{ color: roleColor, fontWeight: '700' }}>{role}</Text> · {f.aircraft_type}{f.registration ? ` ${f.registration}` : ''}
        </Text>
      </View>
      {/* block-tid + UTC */}
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>{formatTime(f.total_time)}</Text>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted, marginTop: 2 }}>
          {f.dep_utc || '—'} <Text style={{ color: Colors.textMuted }}>·</Text> {arrUtc(f) || '—'}z
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}
