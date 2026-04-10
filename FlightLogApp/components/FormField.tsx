import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Colors } from '../constants/colors';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
}

export function FormField({ label, error, hint, style, ...rest }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={Colors.textMuted}
        {...rest}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 4 },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputError: { borderColor: Colors.danger },
  errorText: { color: Colors.danger, fontSize: 11, marginTop: 4 },
  hintText: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },
});
