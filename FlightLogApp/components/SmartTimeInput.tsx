import { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { isValidTime } from '../utils/format';

interface Props {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string;
  showNowBtn?: boolean;
}

function getCurrentUtc(): string {
  const now = new Date();
  const h = String(now.getUTCHours()).padStart(2, '0');
  const m = String(now.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function SmartTimeInput({ label, value, onChangeText, error, showNowBtn = false }: Props) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const valid = isValidTime(value);

  const handleChange = (raw: string) => {
    // Extrahera bara siffror och bygg HH:MM
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) {
      onChangeText('');
    } else if (digits.length <= 2) {
      onChangeText(digits);
    } else {
      onChangeText(`${digits.slice(0, 2)}:${digits.slice(2)}`);
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {valid && !error && (
          <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
        )}
      </View>

      <TextInput
        ref={inputRef}
        style={[
          styles.input,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          valid && !error && styles.inputValid,
        ]}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="08:30"
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        maxLength={5}
        returnKeyType="done"
      />

      {showNowBtn && (
        <TouchableOpacity
          style={styles.nowBtn}
          onPress={() => { onChangeText(getCurrentUtc()); inputRef.current?.blur(); }}
          activeOpacity={0.7}
        >
          <Ionicons name="time-outline" size={12} color={Colors.primary} />
          <Text style={styles.nowText}>Sätt till nu (UTC)</Text>
        </TouchableOpacity>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6,
  },
  label: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: 'Menlo',
    letterSpacing: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlign: 'center',
  },
  inputFocused: { borderColor: Colors.primary, borderWidth: 1 },
  inputError:  { borderColor: Colors.danger, borderWidth: 1 },
  inputValid:  { borderColor: Colors.success + '88' },

  nowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, marginTop: 5,
    backgroundColor: Colors.primary + '14',
    borderRadius: 6, paddingVertical: 6,
    borderWidth: 0.5, borderColor: Colors.primary + '44',
  },
  nowText: { color: Colors.primary, fontSize: 11, fontWeight: '700' },

  errorText: { color: Colors.danger, fontSize: 11, marginTop: 4 },
});
