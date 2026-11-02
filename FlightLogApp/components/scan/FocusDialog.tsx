// "What matters most to you?" — direkt innan granskningen börjar (när första uppslaget är läst), inte före
// skanningen. Claude läser alltid lika noggrant; valet avgör bara vilka frågor man får (worthAsking i
// scan-review). Varje val visar uppskattad tid för granskningen och hur stor del av loggboken som blir rätt,
// räknat på frågorna i just den här skanningen (alla uppslag, även de som läses medan man väljer).

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import type { ScanFocus } from '../../store/scanStore';
import { GlassDialog } from '../GlassDialog';

export const FOCUS_OPTIONS: { key: ScanFocus; title: string; desc: string }[] = [
  { key: 'exact', title: 'Every flight, exactly', desc: 'Every value must match my logbook. You check everything Claude is unsure of.' },
  { key: 'balanced', title: 'Flights mostly, totals exactly', desc: 'Dates, aircraft and places right, and the totals exact. Fewer questions.' },
  { key: 'totals', title: 'Only the totals', desc: 'Only the page totals have to match. Questions only when a column doesn\'t add up.' },
];

export interface FocusEstimate { seconds: number; accuracy: number | null }

/** "under 1 min", "4 min", "1 h 10 min". */
export function formatEstTime(seconds: number): string {
  if (seconds < 60) return 'under 1 min';
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function FocusDialog(p: {
  visible: boolean;
  value: ScanFocus;
  estimates: Record<ScanFocus, FocusEstimate> | null;
  spreads: number;
  stillReading: boolean;          // några uppslag läses fortfarande → uppskattningen räknas upp från de lästa
  onChange: (f: ScanFocus) => void;
  onStart: () => void;
}) {
  return (
    <GlassDialog
      visible={p.visible}
      onClose={p.onStart}
      closeOnScrim={false}
      eyebrow="BEFORE YOU CHECK"
      title="What matters most to you?"
      body={`Claude has read your logbook. Choose how much you want to check — it decides which questions you get${p.spreads > 1 ? ` across all ${p.spreads} spreads` : ''}.`}
      align="left"
      primary={{ label: 'Start checking', onPress: p.onStart }}
    >
      <View style={s.list}>
        {FOCUS_OPTIONS.map((o) => {
          const on = p.value === o.key;
          const est = p.estimates?.[o.key];
          return (
            <TouchableOpacity key={o.key} style={[s.row, on && s.rowOn]} onPress={() => p.onChange(o.key)} activeOpacity={0.8}
              accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[s.title, on && { color: Colors.primary }]}>{o.title}</Text>
                <Text style={s.desc}>{o.desc}</Text>
                {est && (
                  <View style={s.estRow}>
                    <Text style={s.est}>Est time: <Text style={s.estValue}>{formatEstTime(est.seconds)}</Text></Text>
                    <Text style={s.est}>Est accuracy: <Text style={s.estValue}>{est.accuracy == null ? '–' : `${(est.accuracy * 100).toFixed(1)}%`}</Text></Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      {p.stillReading && <Text style={s.note}>Estimated from the spreads read so far.</Text>}
    </GlassDialog>
  );
}

const s = StyleSheet.create({
  list: { alignSelf: 'stretch', gap: 8, marginTop: 14 },
  row: {
    flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowOn: { borderWidth: 1, borderColor: Colors.primary + 'AA', backgroundColor: Colors.primary + '14' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  title: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  desc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  estRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 3 },
  est: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  estValue: { color: Colors.textPrimary, fontWeight: '800', fontVariant: ['tabular-nums'] },
  note: { color: Colors.textSecondary, fontSize: 12, marginTop: 10, alignSelf: 'stretch' },
});
