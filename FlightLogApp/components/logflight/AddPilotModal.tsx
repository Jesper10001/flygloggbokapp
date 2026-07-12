// Lägg till ny andre pilot. Val mellan Name (För-/efternamn → visas "J. Johansson")
// och Callsign (visas helt). Name-läget har två separata rutor: First name + Last name.
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

export function AddPilotModal({ visible, title, onClose, onSave }: {
  visible: boolean; title: string; onClose: () => void; onSave: (name: string) => void;
}) {
  const [mode, setMode] = useState<'name' | 'callsign'>('name');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [callsign, setCallsign] = useState('');

  const reset = () => { setMode('name'); setFirst(''); setLast(''); setCallsign(''); };
  const close = () => { reset(); onClose(); };
  const save = () => {
    let out = '';
    if (mode === 'callsign') out = callsign.trim();
    else {
      // Lagra FULLSTÄNDIGT namn (export orörd); visningen förkortar till "J. Johansson".
      const f = first.trim(), l = last.trim();
      out = f && l ? `${cap(f)} ${cap(l)}` : (l ? cap(l) : cap(f));
    }
    if (!out) return;
    reset();
    onSave(out);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <TouchableOpacity activeOpacity={1} onPress={close} style={s.backdrop}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={s.card}>
          <Text style={s.title}>{title}</Text>

          {/* Name | Callsign */}
          <View style={s.seg}>
            {(['name', 'callsign'] as const).map((m) => (
              <TouchableOpacity key={m} onPress={() => setMode(m)} activeOpacity={0.8}
                style={[s.segBtn, mode === m && { backgroundColor: Colors.primary }]}>
                <Text style={{ color: mode === m ? Colors.textInverse : Colors.textSecondary, fontSize: 13, fontWeight: '700' }}>{m === 'name' ? 'Name' : 'Callsign'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'name' ? (
            <View style={{ gap: 8 }}>
              <TextInput style={s.input} value={first} onChangeText={setFirst} placeholder="First name" placeholderTextColor={Colors.textMuted} autoCapitalize="words" />
              <TextInput style={s.input} value={last} onChangeText={setLast} placeholder="Last name" placeholderTextColor={Colors.textMuted} autoCapitalize="words" />
            </View>
          ) : (
            <TextInput style={s.input} value={callsign} onChangeText={setCallsign} placeholder="Callsign" placeholderTextColor={Colors.textMuted} autoCapitalize="characters" />
          )}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={close} style={[s.btn, { borderWidth: 1, borderColor: Colors.border }]}>
              <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[s.btn, { backgroundColor: Colors.primary }]}>
              <Text style={{ color: Colors.textInverse, fontSize: 14, fontWeight: '700' }}>Add</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, padding: 18, gap: 14 },
  title: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
  seg: { flexDirection: 'row', backgroundColor: Colors.elevated, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: Colors.border },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  input: { backgroundColor: Colors.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: 15, borderWidth: 1, borderColor: Colors.border },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
});
