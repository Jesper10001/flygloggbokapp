import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  onPressAdd?: () => void;
}

function makeStyles() {
  return StyleSheet.create({
    wrapper: { marginBottom: 4 },
    label: {
      color: Colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 6,
    },
    input: {
      backgroundColor: Colors.card,
      borderRadius: 8,
      borderWidth: 0.5,
      borderColor: Colors.border,
      color: Colors.textPrimary,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    inputFocused: {
      borderColor: Colors.primary,
      borderWidth: 1,
    },
    inputError: { borderColor: Colors.danger, borderWidth: 1 },
    errorText: { color: Colors.danger, fontSize: 11, marginTop: 4 },
    hintText: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },
    addBtn: {
      position: 'absolute' as const,
      right: 8,
      top: 0,
      bottom: 0,
      justifyContent: 'center' as const,
    },
  });
}

export function FormField({ label, error, hint, onPressAdd, style, ...rest }: Props) {
  const styles = makeStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ position: 'relative' }}>
        <TextInput
          style={[
            styles.input,
            onPressAdd && { paddingRight: 40 },
            focused && styles.inputFocused,
            error ? styles.inputError : null,
            style,
          ]}
          placeholderTextColor={Colors.textMuted}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          {...rest}
        />
        {onPressAdd && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={onPressAdd}
            hitSlop={8}
          >
            <Ionicons name="add-circle" size={22} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}
