// "Log flight manually" (drönare) — bulk-historik. Speglar pilotens /import/manual men med
// drönar-fält: lägg in dina historiska timmar som en klumpsumma eller år för år. Varje block
// sparas som en SUMMERINGSRAD (source='summary') → räknas i drönar-totalerna (getDroneStats →
// dashboard/insights) och syns som en batch under Imported data, men listas inte som en enskild
// flygning i loggboken/tidslinjen (filtreras i droneFlightStore).
import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { insertDroneFlight } from '../../db/drones';

// Nedbrytnings-fält (överlappande timmar) — pilot-stil: eget tidsfält per operation och per kategori.
// Nycklarna matchar h_*-kolumnerna på drone_flights.
const OPS = [
  { key: 'h_vlos', label: 'VLOS' },
  { key: 'h_evlos', label: 'EVLOS' },
  { key: 'h_bvlos', label: 'BVLOS' },
] as const;
const CATS = [
  { key: 'h_a1', label: 'A1' },
  { key: 'h_a2', label: 'A2' },
  { key: 'h_a3', label: 'A3' },
  { key: 'h_specific', label: 'Specific' },
  { key: 'h_certified', label: 'Certified' },
] as const;

interface YearBlock {
  id: string;
  year: string;
  total_time: string;
  night_time: string;
  h_vlos: string; h_evlos: string; h_bvlos: string;
  h_a1: string; h_a2: string; h_a3: string; h_specific: string; h_certified: string;
  landings_day: string;
  landings_night: string;
}

function emptyBlock(year = ''): YearBlock {
  return {
    id: `${Date.now()}-${Math.random()}`, year,
    total_time: '', night_time: '',
    h_vlos: '', h_evlos: '', h_bvlos: '', h_a1: '', h_a2: '', h_a3: '', h_specific: '', h_certified: '',
    landings_day: '', landings_night: '',
  };
}

// Summan av operations- resp. kategori-fälten (nedbrytningar av totalen).
function opSum(b: YearBlock): number { return parseH(b.h_vlos) + parseH(b.h_evlos) + parseH(b.h_bvlos); }
function catSum(b: YearBlock): number { return parseH(b.h_a1) + parseH(b.h_a2) + parseH(b.h_a3) + parseH(b.h_specific) + parseH(b.h_certified); }
// Total = angiven totaltid, annars härledd ur största nedbrytningen (operation/kategori).
function blockTotal(b: YearBlock): number { return parseH(b.total_time) || Math.max(opSum(b), catSum(b)); }

function parseH(v: string): number {
  const t = (v || '').trim().replace(',', '.');
  if (!t) return 0;
  if (t.includes(':')) { const [h, m] = t.split(':').map(Number); return Math.round((h + (m || 0) / 60) * 100) / 100; }
  return parseFloat(t) || 0;
}
function blockDate(year: string): string {
  const y = parseInt(year, 10);
  if (y >= 1950 && y <= 2099) return `${y}-12-31`;
  return new Date().toISOString().slice(0, 10);
}

export default function DroneManualExperienceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const { loadFlights, loadStats } = useDroneFlightStore();
  const [mode, setMode] = useState<'lump' | 'yearly'>('lump');
  const [blocks, setBlocks] = useState<YearBlock[]>([emptyBlock('')]);
  const [saving, setSaving] = useState(false);

  const update = (id: string, patch: Partial<YearBlock>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const addYear = () => setBlocks((bs) => [...bs, emptyBlock('')]);
  const removeYear = (id: string) => setBlocks((bs) => (bs.length > 1 ? bs.filter((b) => b.id !== id) : bs));

  const saveAll = async () => {
    const active = blocks.filter((b) => blockTotal(b) > 0);
    if (active.length === 0) { Alert.alert('Nothing to save', 'Enter total time or a per-type breakdown for at least one entry.'); return; }
    if (mode === 'yearly') {
      for (const b of active) {
        const y = parseInt(b.year, 10);
        if (!(y >= 1950 && y <= 2099)) { Alert.alert('Invalid year', 'Enter a year between 1950 and 2099 for each entry.'); return; }
      }
    }
    setSaving(true);
    try {
      for (const b of active) {
        const night = parseH(b.night_time);
        // Summary-rad: neutrala etiketter (category/flight_mode = '') så etikett-summan bidrar 0;
        // tid per operation/kategori ligger i h_*-kolumnerna. Natten i h_night (inte is_night) så bara
        // den angivna nattandelen räknas, inte hela totalen.
        await insertDroneFlight({
          date: blockDate(mode === 'yearly' ? b.year : ''),
          drone_id: null,
          location: '',
          mission_type: '',
          category: '',
          flight_mode: '',
          total_time: String(blockTotal(b)),
          max_altitude_m: '',
          is_night: false,
          night_time: String(night),
          has_observer: false,
          observer_name: '',
          landings_day: b.landings_day,
          landings_night: b.landings_night,
          remarks: mode === 'yearly' ? `Experience summary ${b.year}` : 'Experience summary',
          source: 'summary',
          h_vlos: String(parseH(b.h_vlos)),
          h_evlos: String(parseH(b.h_evlos)),
          h_bvlos: String(parseH(b.h_bvlos)),
          h_a1: String(parseH(b.h_a1)),
          h_a2: String(parseH(b.h_a2)),
          h_a3: String(parseH(b.h_a3)),
          h_specific: String(parseH(b.h_specific)),
          h_certified: String(parseH(b.h_certified)),
          h_night: String(night),
        });
      }
      await Promise.all([loadFlights(), loadStats()]);
      router.back();
    } catch (e: any) {
      setSaving(false);
      Alert.alert('Error', e?.message ?? 'Could not save');
    }
  };

  const numField = (value: string, onChangeText: (v: string) => void, placeholder: string) => (
    <TextInput
      style={s.input} value={value} onChangeText={onChangeText}
      keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={DR.muted}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: DR.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
          <Text style={s.subtitle}>
            Bring in drone hours you flew before using the app. Add them as one lump sum or year by year — they count toward your totals without cluttering your logbook. Split the hours by operation and category if you like; those breakdowns are optional and overlap the total.
          </Text>

          {/* Läge: klumpsumma / år för år */}
          <View style={s.modeRow}>
            <TouchableOpacity style={[s.modeBtn, mode === 'lump' && { backgroundColor: accent }]} onPress={() => { setMode('lump'); setBlocks([emptyBlock('')]); }} activeOpacity={0.85}>
              <Ionicons name="layers-outline" size={14} color={mode === 'lump' ? DR.inkOnAccent : DR.text2} />
              <Text style={[s.modeText, mode === 'lump' && { color: DR.inkOnAccent }]}>Lump sum</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modeBtn, mode === 'yearly' && { backgroundColor: accent }]} onPress={() => { setMode('yearly'); setBlocks([emptyBlock('')]); }} activeOpacity={0.85}>
              <Ionicons name="calendar-outline" size={14} color={mode === 'yearly' ? DR.inkOnAccent : DR.text2} />
              <Text style={[s.modeText, mode === 'yearly' && { color: DR.inkOnAccent }]}>Year by year</Text>
            </TouchableOpacity>
          </View>

          {blocks.map((b) => (
            <View key={b.id} style={s.block}>
              <View style={s.blockHeader}>
                {mode === 'yearly' ? (
                  <TextInput
                    style={s.yearInput} value={b.year} onChangeText={(v) => update(b.id, { year: v.replace(/\D/g, '').slice(0, 4) })}
                    keyboardType="number-pad" placeholder="Year (e.g. 2019)" placeholderTextColor={DR.muted} maxLength={4}
                  />
                ) : (
                  <Text style={[s.yearInput, { color: DR.text }]}>Total experience</Text>
                )}
                {mode === 'yearly' && blocks.length > 1 && (
                  <TouchableOpacity onPress={() => removeYear(b.id)} hitSlop={8}><Ionicons name="close-circle" size={20} color={DR.danger} /></TouchableOpacity>
                )}
              </View>

              {/* Total + natt (totalen är master; nedbrytningarna nedan är valfria och överlappar den) */}
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>Total time (h)</Text>
                {numField(b.total_time, (v) => update(b.id, { total_time: v }), '0.0')}
              </View>
              <View style={[s.fieldRow, { borderBottomWidth: 0 }]}>
                <Text style={s.fieldLabel}>Night time (h)</Text>
                {numField(b.night_time, (v) => update(b.id, { night_time: v }), '0.0')}
              </View>

              {/* Tid per operation — överlappande nedbrytning (valfri) */}
              <Text style={s.groupLabel}>Hours by operation</Text>
              {OPS.map((o, i) => (
                <View key={o.key} style={[s.fieldRow, i === OPS.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={s.fieldLabel}>{o.label}</Text>
                  {numField(b[o.key], (v) => update(b.id, { [o.key]: v } as Partial<YearBlock>), '0.0')}
                </View>
              ))}

              {/* Tid per kategori — överlappande nedbrytning (valfri) */}
              <Text style={s.groupLabel}>Hours by category</Text>
              {CATS.map((c, i) => (
                <View key={c.key} style={[s.fieldRow, i === CATS.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={s.fieldLabel}>{c.label}</Text>
                  {numField(b[c.key], (v) => update(b.id, { [c.key]: v } as Partial<YearBlock>), '0.0')}
                </View>
              ))}

              {/* Landningar */}
              <Text style={s.groupLabel}>Landings</Text>
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>Day</Text>
                <TextInput style={s.input} value={b.landings_day} onChangeText={(v) => update(b.id, { landings_day: v.replace(/\D/g, '') })} keyboardType="number-pad" placeholder="0" placeholderTextColor={DR.muted} />
              </View>
              <View style={[s.fieldRow, { borderBottomWidth: 0 }]}>
                <Text style={s.fieldLabel}>Night</Text>
                <TextInput style={s.input} value={b.landings_night} onChangeText={(v) => update(b.id, { landings_night: v.replace(/\D/g, '') })} keyboardType="number-pad" placeholder="0" placeholderTextColor={DR.muted} />
              </View>
            </View>
          ))}

          {mode === 'yearly' && (
            <TouchableOpacity style={[s.addYearBtn, { backgroundColor: accent + '18', borderColor: accent + '55' }]} onPress={addYear} activeOpacity={0.85}>
              <Ionicons name="add" size={16} color={accent} />
              <Text style={[s.addYearText, { color: accent }]}>Add another year</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[s.saveBtn, { backgroundColor: accent }, saving && { opacity: 0.6 }]} onPress={saveAll} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color={DR.inkOnAccent} /> : <Ionicons name="checkmark-circle" size={18} color={DR.inkOnAccent} />}
            <Text style={[s.saveTxt, { color: DR.inkOnAccent }]}>{saving ? 'Saving…' : 'Save experience'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  subtitle: { color: DR.text2, fontSize: 13.5, lineHeight: 20 },
  modeRow: { flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 10, borderWidth: 1, borderColor: DR.border, padding: 3 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8 },
  modeText: { color: DR.text2, fontSize: 13, fontWeight: '700' },
  addYearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: 10, borderWidth: 1 },
  addYearText: { fontSize: 14, fontWeight: '700' },
  block: { backgroundColor: DR.surface, borderRadius: 14, borderWidth: 1, borderColor: DR.border, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: DR.elevated, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: DR.separator },
  yearInput: { flex: 1, color: DR.text, fontSize: 16, fontWeight: '800', fontFamily: 'Menlo' },
  groupLabel: { color: DR.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
  chipTxt: { color: DR.text2, fontSize: 13, fontWeight: '700' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: DR.separator },
  fieldLabel: { color: DR.text2, fontSize: 13, flex: 1 },
  input: { color: DR.text, fontSize: 14, fontWeight: '600', fontFamily: 'Menlo', textAlign: 'right', minWidth: 80, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: DR.elevated, borderRadius: 8, borderWidth: 1, borderColor: DR.border },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 15, marginTop: 4 },
  saveTxt: { fontSize: 15, fontWeight: '800' },
});
