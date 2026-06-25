// Återanvändbar popup för att lägga till/redigera en type/class rating med utgångsdatum.
// EASA: type ratings gäller 12 mån, klass-ratings (SEP/MEP) upp till 24 mån.
// Används av Fleet-korten (per modell) och Certificates-sidan (pilotens ratings).
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_SERIF, FONT_MONO } from './tokens';

function addMonths(d: Date, m: number): Date {
  const n = new Date(d); n.setMonth(n.getMonth() + m); return n;
}
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function RatingModal({ visible, title, initialName, initialExpiry, accent, onSave, onClose }: {
  visible: boolean;
  title?: string;
  initialName: string;
  initialExpiry: string; // '' eller YYYY-MM-DD
  accent: string;
  onSave: (name: string, expiryISO: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState<Date>(() => (initialExpiry ? new Date(initialExpiry + 'T00:00:00') : addMonths(new Date(), 12)));
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setDate(initialExpiry ? new Date(initialExpiry + 'T00:00:00') : addMonths(new Date(), 12));
      setShowPicker(Platform.OS === 'ios');
    }
  }, [visible, initialName, initialExpiry]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim(), toISO(date)); } finally { setSaving(false); }
  };

  const QUICK: [string, number][] = [['12 mo', 12], ['24 mo', 24]];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderTopColor: Colors.border, padding: 18, paddingBottom: 30 }}>
          <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 14 }} />
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 20, fontWeight: '600', color: Colors.textPrimary, marginBottom: 4 }}>{title || 'Type rating'}</Text>
          <Text style={{ fontSize: 12, color: Colors.textMuted, marginBottom: 14 }}>Type ratings are valid 12 months; class ratings (SEP/MEP) up to 24 months.</Text>

          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, marginBottom: 6 }}>RATING</Text>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. A320 · SEP (land) · IR(A)" placeholderTextColor={Colors.textMuted}
            style={{ backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: Colors.textPrimary, fontSize: 15, marginBottom: 16 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted, flex: 1 }}>VALID UNTIL</Text>
            {QUICK.map(([label, m]) => (
              <TouchableOpacity key={label} onPress={() => setDate(addMonths(new Date(), m))} activeOpacity={0.7}
                style={{ marginLeft: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', color: accent }}>+{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {Platform.OS === 'android' && (
            <TouchableOpacity onPress={() => setShowPicker(true)} activeOpacity={0.7}
              style={{ backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8 }}>
              <Text style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '600' }}>{fmt(date)}</Text>
            </TouchableOpacity>
          )}
          {showPicker && (
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <DateTimePicker value={date} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'}
                themeVariant="dark" onChange={(_e, d) => { if (Platform.OS === 'android') setShowPicker(false); if (d) setDate(d); }} />
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={onClose} activeOpacity={0.8} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} disabled={saving || !name.trim()} activeOpacity={0.85}
              style={{ flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: accent, alignItems: 'center', opacity: !name.trim() ? 0.5 : 1 }}>
              <Text style={{ color: Colors.background, fontSize: 14, fontWeight: '700' }}>Save rating</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
