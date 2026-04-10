import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { searchAirports } from '../db/icao';
import { Colors } from '../constants/colors';
import type { IcaoAirport } from '../types/flight';

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  placeholder?: string;
  recentPlaces?: string[];
}

export function IcaoInput({ label, value, onChangeText, error, placeholder, recentPlaces = [] }: Props) {
  const [suggestions, setSuggestions] = useState<IcaoAirport[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (value.length === 0 && recentPlaces.length > 0) {
      // Visa senaste platser som chips
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    if (value.length >= 1) {
      searchAirports(value).then((results) => {
        setSuggestions(results);
        setShowDropdown(results.length > 0);
      });
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  }, [value]);

  const select = (icao: string) => {
    onChangeText(icao);
    setShowDropdown(false);
    inputRef.current?.blur();
  };

  // Filtrera och deduplicera recent places
  const filteredRecent = [...new Set(
    value
      ? recentPlaces.filter((p) => p.startsWith(value.toUpperCase()) && p !== value.toUpperCase())
      : recentPlaces.slice(0, 6)
  )].filter(Boolean);

  return (
    <View>
      <Text style={styles.label}>{label}</Text>

      {/* Senaste platser som chips om fältet är tomt */}
      {!value && filteredRecent.length > 0 && (
        <View style={styles.recentRow}>
          {filteredRecent.slice(0, 5).map((place, idx) => {
            const isRecent = idx === 0;
            return (
              <TouchableOpacity
                key={place}
                style={[styles.recentChip, isRecent && styles.recentChipGold]}
                onPress={() => select(place)}
              >
                {isRecent && <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />}
                <Text style={[styles.recentChipText, isRecent && styles.recentChipTextGold]}>{place}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={(t) => onChangeText(t.toUpperCase().slice(0, 4))}
          placeholder={placeholder ?? 'ESSA'}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="characters"
          maxLength={4}
        />
        {value.length === 4 && (
          <Ionicons
            name={error ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color={error ? Colors.danger : Colors.success}
            style={styles.icon}
          />
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {showDropdown && (
        <View style={styles.dropdown}>
          {suggestions.slice(0, 8).map((item, idx) => (
            <View key={item.icao}>
              {idx > 0 && <View style={styles.sep} />}
              <TouchableOpacity style={styles.suggestion} onPress={() => select(item.icao)}>
                <Text style={styles.suggestionIcao}>{item.icao}</Text>
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {item.name}, {item.country}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: Colors.textSecondary, fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  recentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  recentChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.elevated,
    borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  recentChipGold: {
    backgroundColor: Colors.gold + '22',
    borderColor: Colors.gold + '88',
  },
  recentChipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  recentChipTextGold: { color: Colors.gold },

  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12,
  },
  inputError: { borderColor: Colors.danger },
  input: {
    flex: 1, color: Colors.textPrimary, fontSize: 16,
    fontWeight: '700', letterSpacing: 2, paddingVertical: 12,
  },
  icon: { marginLeft: 8 },
  errorText: { color: Colors.danger, fontSize: 11, marginTop: 4 },

  dropdown: {
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    marginTop: 4, maxHeight: 220, zIndex: 100, overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  suggestionIcao: {
    color: Colors.textPrimary, fontSize: 14, fontWeight: '700',
    letterSpacing: 1, width: 48,
  },
  suggestionName: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  sep: { height: 1, backgroundColor: Colors.separator },
});
