import { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

interface Props {
  label: string;
  value: string;           // alltid MM:SS
  onChangeText: (mmss: string) => void;
  onBlur?: () => void;
  error?: string;
  inputAccessoryViewID?: string;
}

// MM:SS duration input — samma look & feel som SmartTimeInput
// Användaren skriver 4 siffror och det formateras auto till MM:SS.
// Ex: "1530" → "15:30" (15 min 30 s). Max 99:59.
export function DroneDurationInput({ label, value, onChangeText, onBlur, error, inputAccessoryViewID }: Props) {
  const styles = makeStyles();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const valid = /^\d{1,2}:[0-5]\d$/.test(value) && value !== '00:00' && value !== '0:00';

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) {
      onChangeText('');
    } else if (digits.length <= 2) {
      onChangeText(digits);
    } else {
      onChangeText(`${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}`);
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {valid && !error && <Ionicons name="checkmark-circle" size={12} color={Colors.success} />}
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
        onBlur={() => { setFocused(false); onBlur?.(); }}
        placeholder="MM:SS"
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        maxLength={5}
        returnKeyType="done"
        inputAccessoryViewID={inputAccessoryViewID}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    wrapper: { flex: 1 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
    label: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1,
    },
    input: {
      backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 18, fontWeight: '700',
      fontFamily: 'Menlo', letterSpacing: 1,
      paddingHorizontal: 12, paddingVertical: 12, textAlign: 'center',
    },
    inputFocused: { borderColor: Colors.primary, borderWidth: 1 },
    inputError:  { borderColor: Colors.danger, borderWidth: 1 },
    inputValid:  { borderColor: Colors.success + '88' },
    errorText:   { color: Colors.danger, fontSize: 11, marginTop: 4 },
  });
}
