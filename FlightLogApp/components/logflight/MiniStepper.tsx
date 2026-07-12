// Kompakt inline-räknare för Take-off/Approach/Landning-tabellen (exakt designen):
// [etikett] … − värde +. Allt på en rad i en låg pill.
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

export function MiniStepper({ label, value, onChange, tint, danger }: {
  label: string; value: number; onChange: (v: number) => void; tint?: string; danger?: boolean;
}) {
  const valColor = danger ? Colors.danger : (value ? Colors.textPrimary : Colors.textMuted);
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: danger ? Colors.danger : Colors.border, borderRadius: 9, height: 38, paddingHorizontal: 2 }}>
      <Text style={{ paddingLeft: 6, fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, color: Colors.textMuted }}>{label}</Text>
      <TouchableOpacity onPress={() => onChange(Math.max(0, value - 1))} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.6}
        style={{ width: 34, height: '100%', marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="remove" size={22} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Text style={{ minWidth: 16, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 16, fontWeight: '800', color: valColor }}>{value}</Text>
      <TouchableOpacity onPress={() => onChange(value + 1)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.6}
        style={{ width: 34, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="add" size={22} color={danger ? Colors.danger : (tint || Colors.primary)} />
      </TouchableOpacity>
    </View>
  );
}

// Rad i TOL-tabellen: 70px-etikett + två MiniSteppers, topp-linje (utom första).
export function TolRow({ label, a, b, first, danger }: {
  label: string; first?: boolean; danger?: boolean;
  a: { label: string; value: number; onChange: (v: number) => void };
  b: { label: string; value: number; onChange: (v: number) => void };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: first ? 0 : 1, borderTopColor: Colors.border }}>
      <Text style={{ width: 70, fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: danger ? Colors.danger : Colors.textSecondary }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
        <MiniStepper label={a.label} value={a.value} onChange={a.onChange} danger={danger} />
        <MiniStepper label={b.label} value={b.value} onChange={b.onChange} danger={danger} />
      </View>
    </View>
  );
}
