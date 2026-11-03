import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

// "How it works" på import- och skanningssidorna: hopfälld flik, stegen visas vid tryck.
export function HowItWorks({ steps, accent = Colors.primary }: { steps: { t: string; d: string }[]; accent?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.card}>
      <TouchableOpacity style={s.head} onPress={() => setOpen((o) => !o)} activeOpacity={0.75} hitSlop={6}
        accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={s.title}>How it works</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      {open && steps.map((step, i) => (
        <View key={step.t} style={s.row}>
          <View style={[s.bubble, { backgroundColor: accent + '1C', borderColor: accent + '33' }]}>
            <Text style={[s.num, { color: accent }]}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.stepTitle}>{step.t}</Text>
            <Text style={s.stepDesc}>{step.d}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Colors.textSecondary, fontSize: 13.5, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bubble: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginTop: 1 },
  num: { fontSize: 12, fontWeight: '800' },
  stepTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  stepDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});
