import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { TimeFormat } from '../../store/timeFormatStore';
import type { ScanRow } from '../../services/scanImport';
import { inputValue, parseInput, shapeInput, display, DURATION, CLOCK, COUNT, PLACE, UPPER, SIM_TYPES, chipKey } from '../../services/scanFields';
import type { OcrFlightResult } from '../../types/flight';
import { FONT_SERIF, FONT_MONO, NIGHT_BADGE, SIM_BADGE } from '../logbook-page/tokens';
import { getAirportByIcao } from '../../db/icao';
import { DayNightMap } from '../DayNightMap';

// En skannad flygning i Scan report, som loggbokens flygsida (app/flight/detail): rubrik med rutt, datum och
// tid, och avsnitten Aircraft, Crew, Departure, Arrival, Pilot function time, Operational condition,
// Simulator, Landings, Remarks samt kartan med dag och natt. Ogranskade värden har gul botten. "Edit" gör
// värdena redigerbara direkt på sidan (alla rader, även tomma, plus Flight/Simulator, simulatortyp och den
// andra pilotens roll). Ändringar sparas i raden; inget sparas i loggboken förrän "Save" i rapporten.
// Fotosök och "Open full editor" finns inte här.

const DASH = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Den andra pilotens roll (samma nycklar som Log Flight; COP visas som SIC).
const ROLES: { key: string; label: string }[] = [
  { key: 'PIC', label: 'PIC' }, { key: 'COP', label: 'SIC' }, { key: 'FI', label: 'Instructor' }, { key: 'SPIC', label: 'SPIC' }, { key: 'PICUS', label: 'PICUS' },
];

type Row = { label: string; field: string; text?: string };

export function FlightEditor({ row, timeFormat, openFields, onChange, onPatch, onToggleSkip, onClose }: {
  row: ScanRow | null;
  timeFormat: TimeFormat;
  openFields: Set<string>;
  onChange: (field: string, value: string) => void;
  onPatch: (patch: Partial<OcrFlightResult>) => void;
  onToggleSkip: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<{ dep: string; arr: string }>({ dep: '', arr: '' });
  const dep = (row?.data.dep_place ?? '').toUpperCase(), arr = (row?.data.arr_place ?? '').toUpperCase();
  useEffect(() => {
    let alive = true;
    Promise.all([dep ? getAirportByIcao(dep).catch(() => null) : null, arr ? getAirportByIcao(arr).catch(() => null) : null])
      .then(([a, b]) => { if (alive) setNames({ dep: a?.name && a.name !== dep ? a.name : '', arr: b?.name && b.name !== arr ? b.name : '' }); });
    return () => { alive = false; };
  }, [dep, arr]);
  if (!row) return null;

  const d = row.data;
  const isSim = d.flight_type === 'sim';
  const num = (f: string) => parseFloat(String((d as any)[f] ?? '0')) || 0;
  const show = (f: string) => display(d, f, timeFormat);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '');
  const dt = validDate ? new Date(d.date + 'T12:00:00Z') : null;
  const dateLong = dt ? `${WEEKDAYS[dt.getUTCDay()]}, ${String(dt.getUTCDate()).padStart(2, '0')} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` : (d.date || 'No date');
  const roleLabel = ROLES.find((r) => r.key === d.second_pilot_role)?.label;

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

  const sections: { title: string; rows: Row[]; hide?: boolean }[] = [
    { title: 'Flight', rows: [{ label: 'Date', field: 'date' }], hide: !editing },
    { title: 'Aircraft', rows: [
      { label: 'Type', field: 'aircraft_type' },
      { label: 'Registration', field: 'registration' },
      ...(editing ? [{ label: 'Multi-pilot', field: 'multi_pilot' }, { label: 'Single-pilot', field: 'single_pilot' }]
        : [{ label: 'Operation', field: 'multi_pilot', text: num('multi_pilot') > 0 ? 'Multi-pilot' : num('single_pilot') > 0 ? 'Single-pilot' : '' }]),
    ]},
    { title: 'Crew', rows: [{ label: editing ? 'Second pilot' : roleLabel ?? 'Second pilot', field: 'second_pilot' }] },
    { title: 'Departure', rows: [
      { label: 'Place', field: 'dep_place', text: dep ? `${dep}${names.dep ? ` · ${names.dep}` : ''}` : '' },
      { label: 'Time (UTC)', field: 'dep_utc', text: d.dep_utc ? `${d.dep_utc}z` : '' },
    ]},
    { title: 'Arrival', rows: [
      { label: 'Place', field: 'arr_place', text: arr ? `${arr}${names.arr ? ` · ${names.arr}` : ''}` : '' },
      { label: 'Time (UTC)', field: 'arr_utc', text: d.arr_utc ? `${d.arr_utc}z` : '' },
    ]},
    { title: 'Simulator', rows: [{ label: 'Simulator time', field: 'sim' }], hide: !isSim },
    { title: 'Pilot function time', rows: [
      // Total tid redigeras här (visas annars i rubriken); för simulatorpass är det simulatortiden ovan.
      ...(editing && !isSim ? [{ label: 'Total flight time', field: 'total_time' }] : []),
      { label: 'PIC', field: 'pic' }, { label: 'Co-pilot', field: 'co_pilot' }, { label: 'Dual', field: 'dual' }, { label: 'Instructor', field: 'instructor' },
    ]},
    { title: 'Operational condition', rows: [{ label: 'IFR', field: 'ifr' }, { label: 'Night', field: 'night' }, { label: 'NVG', field: 'nvg' }] },
    { title: 'Landings', rows: [{ label: 'Day', field: 'landings_day' }, { label: 'Night', field: 'landings_night' }] },
  ];
  // Visning: bara rader med data (som loggbokens flygsida); redigering: alla rader.
  const hasData = (r: Row) => { const t = (r.text ?? show(r.field) ?? '').trim(); return t !== '' && t !== '0' && t !== DASH; };
  const visible = sections
    .filter((s) => !s.hide)
    .map((s) => ({ ...s, rows: editing ? s.rows : s.rows.filter(hasData) }))
    .filter((s) => s.rows.length > 0);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Rubrik som loggbokens flygsida */}
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={s.back} accessibilityLabel="Back to the scan report">
            <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.route} numberOfLines={1}>{dep || DASH} → {arr || DASH}</Text>
              {num('ifr') > 0 ? <Badge color={Colors.primary} label="IFR" /> : null}
              {num('night') > 0 ? <Badge color={NIGHT_BADGE} label="NGT" /> : null}
              {isSim ? <Badge color={SIM_BADGE} label="SIM" /> : null}
            </View>
            <Text style={s.date}>{dateLong} · row {row.rowIndex}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[s.total, openFields.has(isSim ? 'sim' : 'total_time') && s.open]}>{show(isSim ? 'sim' : 'total_time') || '0'}</Text>
            <Text style={s.totalLabel}>{isSim ? 'SIM' : 'TOTAL'}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {row.skip && (
            <View style={s.leftOut}>
              <Ionicons name="remove-circle-outline" size={16} color={Colors.textSecondary} />
              <Text style={s.leftOutText}>Left out — this flight won't be saved.</Text>
            </View>
          )}

          {/* Redigering: flygning eller simulatorpass, och simulatortyp */}
          {editing && (
            <View style={s.card}>
              <Text style={s.eyebrow}>Type of entry</Text>
              <View style={s.pad}>
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
            </View>
          )}

          {visible.map((sec) => (
            <View key={sec.title} style={s.card}>
              <Text style={s.eyebrow}>{sec.title}</Text>
              {sec.rows.map((r) => (
                <View key={r.field} style={s.row}>
                  <Text style={s.key}>{r.label}</Text>
                  {editing ? (
                    <InlineField field={r.field} data={d} timeFormat={timeFormat} open={openFields.has(r.field)} onCommit={(v) => onChange(r.field, v)} />
                  ) : (
                    <Text style={[s.value, openFields.has(r.field) && s.open]}>{r.text ?? show(r.field)}</Text>
                  )}
                </View>
              ))}
              {/* Den andra pilotens roll (redigering) */}
              {editing && sec.title === 'Crew' && (
                <View style={[s.chips, s.pad]}>
                  {ROLES.map((r) => {
                    const on = d.second_pilot_role === r.key;
                    return (
                      <TouchableOpacity key={r.key} style={[s.chip, on && s.chipOn]} onPress={() => onChange('second_pilot_role', r.key)}>
                        <Text style={[s.chipText, on && s.chipTextOn]}>{r.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ))}

          {/* Remarks */}
          <View style={s.card}>
            <Text style={s.eyebrow}>Remarks</Text>
            <View style={[s.row, { alignItems: 'flex-start' }]}>
              {editing ? (
                <InlineField field="remarks" data={d} timeFormat={timeFormat} open={openFields.has('remarks')} wide onCommit={(v) => onChange('remarks', v)} />
              ) : (
                <Text style={[s.remarks, !d.remarks && { color: Colors.textMuted }, openFields.has('remarks') && s.open]}>{d.remarks || DASH}</Text>
              )}
            </View>
          </View>

          {/* Kartan med dag och natt längs rutten (som loggbokens flygsida) */}
          {!editing && dep && arr && validDate && (
            <View style={{ marginBottom: 12 }}>
              <DayNightMap flight={{ ...(d as any), total_time: num('total_time') }} />
            </View>
          )}

          <TouchableOpacity onPress={() => setEditing((e) => !e)} activeOpacity={0.8} style={s.editBtn}>
            <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={16} color={Colors.primary} />
            <Text style={s.editText}>{editing ? 'Done editing' : 'Edit'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { onToggleSkip(); onClose(); }} activeOpacity={0.8} style={s.skipBtn}>
            <Ionicons name={row.skip ? 'add-circle-outline' : 'remove-circle-outline'} size={16} color={row.skip ? Colors.primary : Colors.dangerLight} />
            <Text style={[s.skipText, row.skip && { color: Colors.primary }]}>{row.skip ? 'Include this flight' : 'Leave this flight out'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Ett värde som redigeras direkt i raden: tolkas när fältet lämnas (fel värde → röd ram, inget sparas).
function InlineField({ field, data, timeFormat, open, wide, onCommit }: {
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
    <TextInput
      style={[s.input, wide && s.inputWide, open && s.inputOpen, bad && s.inputBad]}
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
      placeholder={field === 'date' ? 'YYYY-MM-DD' : CLOCK.has(field) ? 'HH:MM' : DURATION.has(field) ? (timeFormat === 'hhmm' ? 'H:MM' : '0.0') : DASH}
      placeholderTextColor={Colors.textMuted}
    />
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ backgroundColor: color + '1F', borderColor: color + '55', borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  back: { width: 34, height: 34, borderRadius: 9, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  route: { flexShrink: 1, fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', color: Colors.textPrimary },
  date: { fontFamily: FONT_MONO, fontSize: 9.5, color: Colors.textMuted, letterSpacing: 0.4, marginTop: 1 },
  total: { fontFamily: FONT_MONO, fontSize: 18, fontWeight: '700', color: Colors.primary, borderRadius: 4, overflow: 'hidden' },
  totalLabel: { fontFamily: FONT_MONO, fontSize: 8, color: Colors.textMuted, letterSpacing: 1 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 48 },
  leftOut: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  leftOutText: { color: Colors.textSecondary, fontSize: 13 },
  card: { marginBottom: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: Colors.primary, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4 },
  pad: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.separator },
  key: { fontSize: 13, color: Colors.textSecondary },
  value: { flexShrink: 1, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 2 },
  remarks: { flex: 1, fontFamily: FONT_MONO, fontSize: 13, lineHeight: 19, color: Colors.textPrimary, borderRadius: 4, overflow: 'hidden' },
  open: { backgroundColor: 'rgba(255,184,48,0.28)' },
  input: {
    minWidth: 120, maxWidth: '62%', textAlign: 'right', fontFamily: FONT_MONO, fontSize: 13.5, fontWeight: '700', color: Colors.textPrimary,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  inputWide: { flex: 1, maxWidth: '100%', minHeight: 70, textAlign: 'left', textAlignVertical: 'top', fontWeight: '500' },
  inputOpen: { borderColor: Colors.warning, backgroundColor: Colors.warning + '14' },
  inputBad: { borderColor: Colors.danger },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  segBtnOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  segText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
  segTextOn: { color: Colors.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  chipOpen: { borderColor: Colors.warning + 'aa' },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: Colors.primary },
  editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: Colors.primary, backgroundColor: Colors.primary + '18', marginBottom: 10 },
  editText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  skipBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.danger + '55', backgroundColor: Colors.danger + '10', marginTop: 10 },
  skipText: { fontSize: 14, fontWeight: '700', color: Colors.dangerLight },
});
