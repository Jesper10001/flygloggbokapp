// Kompakt inline-räknare för Take-off/Approach/Landning-tabellen (exakt designen):
// [etikett] … − värde +. Allt på en rad i en låg pill.
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

export function MiniStepper({ label, value, onChange, tint }: {
  label: string; value: number; onChange: (v: number) => void; tint?: string;
}) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, height: 34, paddingHorizontal: 2 }}>
      <Text style={{ paddingLeft: 6, fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, color: Colors.textMuted }}>{label}</Text>
      <TouchableOpacity onPress={() => onChange(Math.max(0, value - 1))} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} activeOpacity={0.7}
        style={{ width: 24, height: '100%', marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="remove" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Text style={{ minWidth: 14, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 15, fontWeight: '800', color: value ? Colors.textPrimary : Colors.textMuted }}>{value}</Text>
      <TouchableOpacity onPress={() => onChange(value + 1)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} activeOpacity={0.7}
        style={{ width: 24, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="add" size={14} color={tint || Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

// Rad i TOL-tabellen: 70px-etikett + två MiniSteppers, topp-linje (utom första).
export function TolRow({ label, a, b, first }: {
  label: string; first?: boolean;
  a: { label: string; value: number; onChange: (v: number) => void };
  b: { label: string; value: number; onChange: (v: number) => void };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: first ? 0 : 1, borderTopColor: Colors.border }}>
      <Text style={{ width: 70, fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.textSecondary }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
        <MiniStepper label={a.label} value={a.value} onChange={a.onChange} />
        <MiniStepper label={b.label} value={b.value} onChange={b.onChange} />
      </View>
    </View>
  );
}
