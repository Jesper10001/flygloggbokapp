import { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Colors } from '../constants/colors';

const CREW_OPTS = [
  { key: 'sp',      label: 'SP',        sub: 'Singelpilot' },
  { key: 'mp',      label: 'MP',        sub: 'Multipilot' },
  { key: 'sp_only', label: 'Enbart SP', sub: '' },
  { key: 'mp_only', label: 'Enbart MP', sub: '' },
] as const;

type CrewKey = 'sp' | 'mp' | 'sp_only' | 'mp_only';

function parseCrewType(raw: string): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function serializeCrewType(set: Set<string>): string {
  return set.size === 0 ? '' : [...set].sort().join(',');
}

type Props = {
  visible: boolean;
  editMode?: boolean;
  initialType?: string;
  initialSpeedKts?: number;
  initialEnduranceH?: number;
  initialCrewType?: string;
  onSave: (type: string, speedKts: number, enduranceH: number, crewType: string) => Promise<void>;
  onClose: () => void;
};

export function AircraftModal({
  visible, editMode, initialType, initialSpeedKts, initialEnduranceH, initialCrewType, onSave, onClose,
}: Props) {
  const [type, setType] = useState(initialType ?? '');
  const [speed, setSpeed] = useState('');
  const [endurance, setEndurance] = useState('');
  const [crewTypes, setCrewTypes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setType(initialType ?? '');
      setSpeed(initialSpeedKts && initialSpeedKts > 0 ? String(initialSpeedKts) : '');
      setEndurance(initialEnduranceH && initialEnduranceH > 0 ? String(initialEnduranceH) : '');
      setCrewTypes(parseCrewType(initialCrewType ?? ''));
    }
  }, [visible, initialType, initialSpeedKts, initialEnduranceH, initialCrewType]);

  const toggleCrew = (key: CrewKey) => {
    setCrewTypes((prev) => {
      const next = new Set(prev);
      if (key === 'sp_only' || key === 'mp_only') {
        if (next.has(key)) next.clear();
        else { next.clear(); next.add(key); }
      } else {
        next.delete('sp_only'); next.delete('mp_only');
        if (next.has(key)) next.delete(key); else next.add(key);
      }
      return next;
    });
  };

  const handleSave = async () => {
    const t = type.trim().toUpperCase();
    if (!t) return;
    setSaving(true);
    try {
      await onSave(t, parseInt(speed) || 0, parseFloat(endurance.replace(',', '.')) || 0, serializeCrewType(crewTypes));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{editMode ? 'Redigera farkost' : 'Nytt luftfartyg'}</Text>

          <Text style={styles.label}>Fartygstyp</Text>
          <TextInput
            style={[styles.input, editMode && styles.inputReadOnly]}
            value={type}
            onChangeText={(v) => { if (!editMode) setType(v.toUpperCase()); }}
            placeholder="C172"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            editable={!editMode}
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Marschfart (kts)</Text>
              <TextInput
                style={styles.input}
                value={speed}
                onChangeText={setSpeed}
                placeholder="110"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Uthållighet (h)</Text>
              <TextInput
                style={styles.input}
                value={endurance}
                onChangeText={setEndurance}
                placeholder="3.0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <Text style={styles.label}>Besättningstyp</Text>
          <View style={styles.crewRow}>
            {CREW_OPTS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.crewBtn, crewTypes.has(opt.key) && styles.crewBtnActive]}
                onPress={() => toggleCrew(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.crewBtnLabel, crewTypes.has(opt.key) && styles.crewBtnLabelActive]}>
                  {opt.label}
                </Text>
                {opt.sub ? <Text style={styles.crewBtnSub}>{opt.sub}</Text> : null}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Avbryt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (!type.trim() || saving) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving || !type.trim()}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Spara</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropTouch: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, gap: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 4,
  },
  title: {
    color: Colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 4,
  },
  label: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.elevated, borderRadius: 8, padding: 11,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 15, fontWeight: '600',
  },
  inputReadOnly: {
    opacity: 0.6,
  },
  row: { flexDirection: 'row', gap: 10 },

  crewRow: { flexDirection: 'row', gap: 6 },
  crewBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  crewBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  crewBtnLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  crewBtnLabelActive: { color: Colors.primary },
  crewBtnSub: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 2, alignItems: 'center', paddingVertical: 13, borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
});
