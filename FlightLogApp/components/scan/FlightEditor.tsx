import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors } from '../../constants/colors';
import type { TimeFormat } from '../../store/timeFormatStore';
import type { ScanRow } from '../../services/scanImport';
import { label, inputValue, parseInput, shapeInput, DURATION, CLOCK, COUNT, PLACE, UPPER, SIM_TYPES, chipKey } from '../../services/scanFields';
import type { OcrFlightResult } from '../../types/flight';

// Utökad editor för en skannad flygning i rapporten: alla fält, och om det är en flygning eller ett
// simulatorpass (med simulatortyp). Ändringar sparas i raden direkt; inget sparas i loggboken förrän "Save".

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const GROUPS: { title: string; fields: string[]; sim?: boolean }[] = [
  { title: 'Flight', fields: ['date', 'aircraft_type', 'registration'] },
  { title: 'Route', fields: ['dep_place', 'dep_utc', 'arr_place', 'arr_utc'] },
  { title: 'Time', fields: ['total_time', 'sim', 'pic', 'co_pilot', 'dual', 'instructor', 'multi_pilot', 'single_pilot', 'ifr', 'night'] },
  { title: 'Landings', fields: ['landings_day', 'landings_night'] },
  { title: 'Crew and remarks', fields: ['second_pilot', 'remarks'] },
];
const SHORT_LABEL: Record<string, string> = { dep_utc: 'Off (time)', arr_utc: 'On (time)', total_time: 'Total flight time', sim: 'Simulator time' };

export function FlightEditor({ row, timeFormat, openFields, onChange, onPatch, onToggleSkip, onClose }: {
  row: ScanRow | null;
  timeFormat: TimeFormat;
  openFields: Set<string>;
  onChange: (field: string, value: string) => void;
  onPatch: (patch: Partial<OcrFlightResult>) => void;
  onToggleSkip: () => void;
  onClose: () => void;
}) {
  if (!row) return null;
  const d = row.data;
  const isSim = d.flight_type === 'sim';

  // Flygning ↔ simulatorpass. Simulatorpass: tiden står som simulatortid (och total = simulatortid, som
  // parsern gör), funktionstider och landningar nollas.
  const setType = (sim: boolean) => {
    if (sim === isSim) return;
    if (sim) {
      const t = [d.sim, d.total_time, d.dual, d.pic, d.co_pilot, d.instructor].map((x) => parseFloat(String(x ?? '0')) || 0).find((x) => x > 0) ?? 0;
      onPatch({ flight_type: 'sim', sim: String(t), total_time: String(t), dual: '0', pic: '0', co_pilot: '0', instructor: '0', landings_day: '0', landings_night: '0' });
    } else {
      onPatch({ flight_type: 'normal', total_time: d.total_time && d.total_time !== '0' ? d.total_time : String(d.sim ?? '0'), sim: '0', sim_category: undefined });
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <View style={{ width: 70 }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.title}>Edit flight</Text>
            <Text style={s.sub}>Row {row.rowIndex}{d.date ? ` · ${d.date}` : ''}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 70, alignItems: 'flex-end' }}>
            <Text style={s.done}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Text style={s.cardTitle}>Type of entry</Text>
            <View style={s.segment}>
              {([[false, 'Flight'], [true, 'Simulator']] as const).map(([sim, text]) => (
                <TouchableOpacity key={text} style={[s.segBtn, isSim === sim && s.segBtnOn]} onPress={() => setType(sim)}
                  accessibilityRole="radio" accessibilityState={{ selected: isSim === sim }}>
                  <Text style={[s.segText, isSim === sim && s.segTextOn]}>{text}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {isSim && (
              <View style={s.chips}>
                {SIM_TYPES.map((opt) => {
                  const active = String(d.sim_category ?? '').toLowerCase() === chipKey(opt);
                  return (
                    <TouchableOpacity key={opt} style={[s.chip, active && s.chipOn, openFields.has('sim_category') && !d.sim_category && s.chipOpen]}
                      onPress={() => onChange('sim_category', chipKey(opt))}>
                      <Text style={[s.chipText, active && s.chipTextOn]}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {GROUPS.map((g) => {
            const fields = g.fields.filter((f) => (f === 'sim' ? isSim : true));
            return (
              <View key={g.title} style={s.card}>
                <Text style={s.cardTitle}>{g.title}</Text>
                <View style={s.grid}>
                  {fields.map((f) => (
                    <Field key={f} field={f} data={d} timeFormat={timeFormat} open={openFields.has(f)}
                      wide={f === 'remarks' || f === 'second_pilot'} onCommit={(v) => onChange(f, v)} />
                  ))}
                </View>
              </View>
            );
          })}

          <TouchableOpacity style={s.skip} onPress={() => { onToggleSkip(); onClose(); }}>
            <Text style={s.skipText}>{row.skip ? 'Include this flight' : 'Leave this flight out'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Ett fält: texten redigeras lokalt och tolkas när fältet lämnas (fel värde → röd ram, inget sparas).
function Field({ field, data, timeFormat, open, wide, onCommit }: {
  field: string; data: OcrFlightResult; timeFormat: TimeFormat; open: boolean; wide?: boolean; onCommit: (v: string) => void;
}) {
  const initial = inputValue(data, field, timeFormat);
  const [text, setText] = useState(initial);
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(initial); setBad(false); }, [initial]);

  const commit = () => {
    if (text === initial) { setBad(false); return; }
    const v = parseInput(field, text, timeFormat);
    if (v == null) { setBad(true); return; }
    setBad(false);
    onCommit(v);
  };
  return (
    <View style={[s.field, wide && s.fieldWide]}>
      <Text style={s.fieldLabel}>{SHORT_LABEL[field] ?? label(field)}</Text>
      <TextInput
        style={[s.input, open && s.inputOpen, bad && s.inputBad]}
        value={text}
        onChangeText={(t) => setText(shapeInput(field, t))}
        onEndEditing={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        autoCapitalize={PLACE.has(field) || UPPER.has(field) ? 'characters' : 'sentences'}
        autoCorrect={false}
        multiline={field === 'remarks'}
        keyboardType={DURATION.has(field) ? (timeFormat === 'hhmm' ? 'numbers-and-punctuation' : 'decimal-pad')
          : CLOCK.has(field) || COUNT.has(field) ? 'number-pad' : field === 'date' ? 'numbers-and-punctuation' : 'default'}
        placeholder={field === 'date' ? 'YYYY-MM-DD' : CLOCK.has(field) ? 'HH:MM' : DURATION.has(field) ? (timeFormat === 'hhmm' ? 'H:MM' : '0.0') : '—'}
        placeholderTextColor={Colors.textMuted}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  sub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  done: { color: Colors.primary, fontSize: 16, fontWeight: '700' },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  card: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 10 },
  cardTitle: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  segBtnOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  segText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
  segTextOn: { color: Colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  chipOpen: { borderColor: Colors.warning + 'aa' },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: Colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { width: '47%', gap: 4 },
  fieldWide: { width: '100%' },
  fieldLabel: { color: Colors.textSecondary, fontSize: 11.5, fontWeight: '600' },
  input: {
    minHeight: 42, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, color: Colors.textPrimary, fontSize: 15, fontFamily: MONO,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  inputOpen: { borderColor: Colors.warning, backgroundColor: Colors.warning + '14' },
  inputBad: { borderColor: Colors.danger },
  skip: { alignItems: 'center', paddingVertical: 14 },
  skipText: { color: Colors.dangerLight, fontSize: 14, fontWeight: '600' },
});
