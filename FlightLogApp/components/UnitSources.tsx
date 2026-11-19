// Source-rutan för förbandskortet (Air Bases → Specific): var uppgifterna om de ryska baserna kommer från och när de
// sammanställdes. Lager ovanpå kartan (ingen native Modal — en Modal ovanpå kartans Modal låser Apple-kartan på iOS).
// Stängs bara med krysset. Källorna enligt användarens beskrivning av sin sammanställning (2026-11-19).
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { RU_DATA_COMPILED } from '../utils/ruAirbases';

const UNITS: [string, string][] = [
  ['Scramble.nl', 'Order of battle of the Russian Aerospace Forces: units, bases and aircraft. The main source; undated and partly older.'],
  ['Militarnyi', '“Know Your Enemy”, January 2026: European Russia, Crimea and naval aviation. Used where it differs from Scramble.'],
  ['Wikipedia', '“List of military airbases in Russia” (CC BY-SA 4.0): units per base.'],
  ['Other reporting', 'GlobalMilitary.net, Migflug.com, Janes, Aviation Week and The War Zone, for single bases.'],
];
const CODES: [string, string][] = [
  ['OurAirports', 'Codes and positions (public domain). Engels-2 from Wikipedia; Korenovsk from OurAirports keywords.'],
];

export function UnitSourcesPopup({ onClose, topInset = 0 }: { onClose: () => void; topInset?: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 80, backgroundColor: 'rgba(3,8,18,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20, paddingTop: topInset + 20 }]}>
      <View style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ flex: 1, color: '#fff', fontSize: 17, fontWeight: '800' }}>Where this comes from</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={s.close}>
            <Ionicons name="close" size={17} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 14, paddingTop: 12 }} showsVerticalScrollIndicator={false}>
          <Section title="Units and aircraft" rows={UNITS} />
          <Section title="Codes and positions" rows={CODES} />
          <View style={s.note}>
            <Text style={s.noteTitle}>Compiled {RU_DATA_COMPILED}</Text>
            <Text style={s.noteTxt}>Units move. Entries from before 2022 can be out of date, and the aircraft at Dyagilevo are inferred from the unit's role.</Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function Section({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{title.toUpperCase()}</Text>
      {rows.map(([name, what]) => (
        <View key={name} style={{ gap: 2 }}>
          <Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '700' }}>{name}</Text>
          <Text style={{ color: '#A9C3DB', fontSize: 12.5, lineHeight: 17 }}>{what}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { width: '100%', maxWidth: 380, borderRadius: 16, padding: 16, backgroundColor: 'rgba(15,30,58,0.98)', borderWidth: 1, borderColor: Colors.primary + '55' },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  label: { fontFamily: 'JetBrainsMono', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, color: '#FFB830' },
  note: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,184,48,0.08)', borderWidth: 1, borderColor: 'rgba(255,184,48,0.3)' },
  noteTitle: { color: '#FFD080', fontSize: 12.5, fontWeight: '700' },
  noteTxt: { color: '#C9D6E6', fontSize: 12, lineHeight: 17 },
});
