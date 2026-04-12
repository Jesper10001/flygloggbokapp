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
  value: string;          // alltid 4-bokstavs ICAO (eller tomt)
  onChangeText: (icao: string) => void;
  error?: string;
  placeholder?: string;
  recentPlaces?: string[];
}

export function IcaoInput({ label, value, onChangeText, error, placeholder, recentPlaces = [] }: Props) {
  const [inputText, setInputText] = useState(value);   // vad som visas i fältet
  const [suggestions, setSuggestions] = useState<IcaoAirport[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Synka visad text när värdet ändras utifrån (t.ex. swap eller formulärreset)
  useEffect(() => {
    setInputText(value);
    setSuggestions([]);
    setShowDropdown(false);
  }, [value]);

  const handleChangeText = (t: string) => {
    const upper = t.toUpperCase();
    setInputText(upper);

    if (!upper) {
      onChangeText('');
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    // Sök om 1+ tecken — matchar ICAO-kod ELLER namn
    searchAirports(upper).then((results) => {
      setSuggestions(results);
      setShowDropdown(results.length > 0);
    });
  };

  const select = (airport: IcaoAirport) => {
    onChangeText(airport.icao);
    setInputText(airport.icao);
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.blur();
  };

  const selectRecent = (icao: string) => {
    onChangeText(icao);
    setInputText(icao);
    setSuggestions([]);
    setShowDropdown(false);
  };

  const isConfirmed = value.length === 4 && inputText === value;

  // Filtrera och deduplicera recent places
  const filteredRecent = [...new Set(
    inputText
      ? recentPlaces.filter((p) => p.startsWith(inputText) && p !== inputText)
      : recentPlaces.slice(0, 6)
  )].filter(Boolean);

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {/* Senaste platser som chips om fältet är tomt */}
      {!inputText && filteredRecent.length > 0 && (
        <View style={styles.recentRow}>
          {filteredRecent.slice(0, 5).map((place, idx) => {
            const isRecent = idx === 0;
            return (
              <TouchableOpacity
                key={place}
                style={[styles.recentChip, isRecent && styles.recentChipGold]}
                onPress={() => selectRecent(place)}
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
          value={inputText}
          onChangeText={handleChangeText}
          placeholder={placeholder ?? 'ESSA eller Linköping'}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {isConfirmed && (
          <Ionicons
            name={error ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color={error ? Colors.danger : Colors.success}
            style={styles.icon}
          />
        )}
        {inputText.length > 0 && !isConfirmed && (
          <TouchableOpacity onPress={() => { onChangeText(''); setInputText(''); }} hitSlop={8}>
            <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} style={styles.icon} />
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {showDropdown && (
        <View style={styles.dropdown}>
          {suggestions.slice(0, 8).map((item, idx) => (
            <View key={item.icao}>
              {idx > 0 && <View style={styles.sep} />}
              <TouchableOpacity style={styles.suggestion} onPress={() => select(item)}>
                <Text style={styles.suggestionIcao}>{item.icao}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.suggestionCountry}>{item.country}</Text>
                </View>
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
    fontWeight: '700', letterSpacing: 1, paddingVertical: 12,
  },
  icon: { marginLeft: 8 },
  errorText: { color: Colors.danger, fontSize: 11, marginTop: 4 },

  dropdown: {
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    marginTop: 4, zIndex: 100, overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10, gap: 10,
  },
  suggestionIcao: {
    color: Colors.primary, fontSize: 14, fontWeight: '800',
    letterSpacing: 1, fontFamily: 'Menlo', width: 48,
  },
  suggestionName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  suggestionCountry: { color: Colors.textMuted, fontSize: 11 },
  sep: { height: 1, backgroundColor: Colors.separator },
});
