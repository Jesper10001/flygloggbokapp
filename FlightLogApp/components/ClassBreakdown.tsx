// Klass-/tidsfördelning per flygtyp. Delas mellan vyer; `variant='large'` ger
// större typsnitt och mer luft (för Insikter-sidan). Äger sin egen modal-state
// för "add missing hours" (NVG/Dual/Instruktör).

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { useFlightStore } from '../store/flightStore';
import { MissingNvgModal } from './MissingNvgModal';
import { MissingDualModal } from './MissingDualModal';
import { MissingInstructorModal } from './MissingInstructorModal';

export function ClassBreakdown({ variant = 'compact' }: { variant?: 'compact' | 'large' }) {
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const st = useFlightStore((s) => s.stats);
  const [showNvg, setShowNvg] = useState(false);
  const [showDual, setShowDual] = useState(false);
  const [showInstr, setShowInstr] = useState(false);
  const large = variant === 'large';

  const rows: { l: string; v: string; add?: 'dual' | 'instructor' | 'nvg' }[] = [
    { l: 'PIC', v: formatTime(st?.total_pic ?? 0) },
    { l: 'CO-PILOT', v: formatTime(st?.total_co_pilot ?? 0) },
    { l: 'IFR', v: formatTime(st?.total_ifr ?? 0) },
    { l: 'NIGHT', v: formatTime(st?.total_night ?? 0) },
    { l: 'DUAL', v: formatTime(st?.total_dual ?? 0), add: 'dual' },
    { l: 'INSTR', v: formatTime(st?.total_instructor ?? 0), add: 'instructor' },
    { l: 'NVG', v: formatTime(st?.total_nvg ?? 0), add: 'nvg' },
    { l: 'MULTI-PILOT', v: formatTime(st?.total_multi_pilot ?? 0) },
    { l: 'DAY LD', v: String(st?.total_landings_day ?? 0) },
    { l: 'NIGHT LD', v: String(st?.total_landings_night ?? 0) },
  ];

  return (
    <View>
      <View style={styles.card}>
        {rows.map((c, i) => (
          <View key={c.l} style={[styles.row, large && styles.rowLarge, { borderBottomWidth: i < rows.length - 1 ? 1 : 0 }]}>
            <Text style={[styles.label, large && styles.labelLarge]}>{c.l}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: large ? 10 : 6 }}>
              {c.add && (
                <TouchableOpacity
                  onPress={() => { if (c.add === 'dual') setShowDual(true); else if (c.add === 'instructor') setShowInstr(true); else setShowNvg(true); }}
                  hitSlop={8}
                >
                  <Ionicons name="add-circle-outline" size={large ? 20 : 16} color={Colors.primary} />
                </TouchableOpacity>
              )}
              <Text style={[styles.value, large && styles.valueLarge]}>{c.v}</Text>
            </View>
          </View>
        ))}
      </View>

      <MissingNvgModal visible={showNvg} onClose={() => setShowNvg(false)} />
      <MissingDualModal visible={showDual} onClose={() => setShowDual(false)} />
      <MissingInstructorModal visible={showInstr} onClose={() => setShowInstr(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.4, fontFamily: 'Menlo', marginBottom: 10,
  },
  headerLarge: {
    fontSize: 20, fontWeight: '700', color: Colors.textPrimary,
    letterSpacing: 0, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    textTransform: 'none', marginBottom: 14,
  },
  card: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomColor: Colors.separator },
  rowLarge: { paddingVertical: 8, paddingHorizontal: 18 },
  label: { color: Colors.textSecondary, fontSize: 13 },
  labelLarge: { fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: 0.3 },
  value: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  valueLarge: { fontSize: 17, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
