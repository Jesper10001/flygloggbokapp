// "Export logbook pages": välj hur många av de senaste uppslagen som exporteras som PDF (Settings, pilot och
// drönare). Samma stil som appens övriga popup-rutor (GlassDialog); valt alternativ markeras i lägets accentfärg.
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { GlassDialog, DialogIcon } from './GlassDialog';
import { Colors } from '../constants/colors';

export type PagesChoice = number | 'whole' | 'custom';

export function ExportPagesDialog(p: {
  visible: boolean;
  onClose: () => void;
  choice: PagesChoice;
  onChoice: (c: PagesChoice) => void;
  custom: string;
  onCustom: (v: string) => void;
  total: number;
  onExport: () => void;
  accent?: string;
  text: { title: string; choose: string; whole: string; customPages: string; of: string; note?: string; exportBtn: string };
}) {
  const accent = p.accent ?? Colors.primary;
  const Choice = ({ value, label, big }: { value: PagesChoice; label: string; big?: boolean }) => {
    const on = p.choice === value;
    return (
      <TouchableOpacity onPress={() => p.onChoice(value)} activeOpacity={0.8} accessibilityRole="radio" accessibilityState={{ selected: on }}
        style={[s.choice, !big && { flex: 1 }, on && { borderColor: accent + 'AA', backgroundColor: accent + '24' }]}>
        <Text style={[s.choiceTxt, big && { fontSize: 15 }, on && { color: accent }]}>{label}</Text>
      </TouchableOpacity>
    );
  };
  return (
    <GlassDialog
      visible={p.visible}
      onClose={p.onClose}
      icon={<DialogIcon name="document-text-outline" color={accent} />}
      eyebrow="Export"
      title={p.text.title}
      body={p.text.choose}
      primary={{ label: p.text.exportBtn, onPress: p.onExport }}
      secondary={{ label: 'Cancel', onPress: p.onClose }}
    >
      <View style={s.options}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[3, 5, 10].map((n) => <Choice key={n} value={n} label={String(n)} />)}
        </View>
        <Choice value="whole" label={p.text.whole} big />
        <Choice value="custom" label={p.text.customPages} big />
        {p.choice === 'custom' && (
          <View style={s.customRow}>
            <TextInput
              value={p.custom}
              onChangeText={(v) => p.onCustom(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              placeholder={String(p.total)}
              placeholderTextColor={Colors.textMuted}
              style={s.input}
            />
            <Text style={s.of}>{p.text.of} {p.total}</Text>
          </View>
        )}
        {p.text.note ? <Text style={s.note}>{p.text.note}</Text> : null}
      </View>
    </GlassDialog>
  );
}

const s = StyleSheet.create({
  options: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  choice: {
    height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  choiceTxt: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 4 },
  input: {
    width: 96, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)', color: Colors.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center',
  },
  of: { color: Colors.textSecondary, fontSize: 13 },
  note: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 4 },
});
