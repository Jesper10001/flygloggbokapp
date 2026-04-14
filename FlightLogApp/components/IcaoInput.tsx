import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { searchAirports, getNearbyTemporaryPlaces, generateTemporaryIcao, addTemporaryPlace } from '../db/icao';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import type { IcaoAirport } from '../types/flight';

export type RecentPlace = { icao: string; temporary: boolean };

interface Props {
  label: string;
  value: string;
  onChangeText: (icao: string) => void;
  error?: string;
  placeholder?: string;
  recentPlaces?: RecentPlace[];
  allowHere?: boolean;
  onTemporaryPlaceSelect?: (icao: string) => void;
}

function makeStyles() {
  return StyleSheet.create({
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
    recentChipGold: { backgroundColor: Colors.gold + '22', borderColor: Colors.gold + '88' },
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

    hereBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: Colors.primary + '18',
      borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5,
      borderWidth: 1, borderColor: Colors.primary + '44',
      marginLeft: 6,
    },
    hereBtnText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },

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

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 24, paddingBottom: 44, gap: 12,
      borderWidth: 1, borderColor: Colors.border,
    },
    modalHandle: {
      width: 40, height: 4, backgroundColor: Colors.border,
      borderRadius: 2, alignSelf: 'center', marginBottom: 4,
    },
    modalTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800' },

    nearbySection: { gap: 8 },
    nearbySectionLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    nearbyRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.elevated, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    nearbyName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    nearbyIcao: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo' },
    divider: { height: 1, backgroundColor: Colors.separator, marginVertical: 4 },

    nameInput: {
      backgroundColor: Colors.elevated, borderRadius: 10, padding: 14,
      color: Colors.textPrimary, fontSize: 16, fontWeight: '600',
      borderWidth: 1, borderColor: Colors.border,
    },
    nameHint: { color: Colors.textMuted, fontSize: 11, textAlign: 'right', marginTop: -4 },
    confirmBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    },
    confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    cancelBtn: { alignItems: 'center', paddingVertical: 10 },
    cancelBtnText: { color: Colors.textSecondary, fontSize: 14 },
  });
}

export function IcaoInput({ label, value, onChangeText, error, placeholder, recentPlaces = [], allowHere = false, onTemporaryPlaceSelect }: Props) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [inputText, setInputText] = useState(value);
  const [suggestions, setSuggestions] = useState<IcaoAirport[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // "Här"-modal state
  const [hereLoading, setHereLoading] = useState(false);
  const [hereModal, setHereModal] = useState(false);
  const [hereName, setHereName] = useState('');
  const [hereCoords, setHereCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<IcaoAirport[]>([]);

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

  // ── "Här"-knapp ─────────────────────────────────────────────────────────
  const handleHere = async () => {
    setHereLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permission_required'), 'Platstillstånd krävs');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lon } = pos.coords;

      // Reverse geocode — föreslå ortsnamn
      let suggested = '';
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        const raw = geo?.city || geo?.district || geo?.subregion || geo?.region || '';
        // Max 10 tecken, behåll alla unicode-bokstäver och mellanslag
        suggested = raw.replace(/[^\p{L}\s]/gu, '').trim().slice(0, 10);
      } catch { /* ignorera om reverse geocode misslyckas */ }

      // Sök efter sparade platser inom 3 km
      const nearby = await getNearbyTemporaryPlaces(lat, lon, 3);

      setHereCoords({ lat, lon });
      setHereName(suggested);
      setNearbyPlaces(nearby);
      setHereModal(true);
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    } finally {
      setHereLoading(false);
    }
  };

  const confirmHere = async (existingIcao?: string) => {
    if (!hereCoords) return;
    if (existingIcao) {
      // Välj befintlig sparad plats
      setHereModal(false);
      onChangeText(existingIcao);
      setInputText(existingIcao);
      return;
    }
    // Skapa ny tillfällig plats
    const nameClean = hereName.trim().slice(0, 10) || 'TEMP';
    const icao = await generateTemporaryIcao(nameClean);
    await addTemporaryPlace(icao, nameClean, hereCoords.lat, hereCoords.lon);
    setHereModal(false);
    onChangeText(icao);
    setInputText(icao);
  };

  const isConfirmed = value.length === 4 && inputText === value;
  // Top 3 unika senaste platser. Filtrera på läget:
  //  - ICAO-läget (!allowHere): dölj tillfälliga, så "bara 2 visas" om en av topp-3 är tillfällig.
  //  - Temporary-läget (allowHere): visa endast tillfälliga.
  const top3 = recentPlaces.slice(0, 3);
  const filteredRecent = (
    inputText
      ? recentPlaces.filter((p) => p.icao.startsWith(inputText) && p.icao !== inputText)
      : top3.filter((p) => (allowHere ? p.temporary : !p.temporary))
  );

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={handleChangeText}
          placeholder={placeholder ?? t('icao_placeholder')}
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
        {allowHere && !inputText && (
          <TouchableOpacity
            style={styles.hereBtn}
            onPress={handleHere}
            disabled={hereLoading}
            hitSlop={8}
            activeOpacity={0.75}
          >
            {hereLoading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <>
                  <Ionicons name="location" size={13} color={Colors.primary} />
                  <Text style={styles.hereBtnText}>{t('here')}</Text>
                </>
            }
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!inputText && filteredRecent.length > 0 && (
        <View style={[styles.recentRow, { marginTop: 6, marginBottom: 0 }]}>
          {filteredRecent.slice(0, 3).map((place, idx) => {
            const isRecent = idx === 0;
            return (
              <TouchableOpacity
                key={place.icao}
                style={[styles.recentChip, isRecent && styles.recentChipGold]}
                onPress={() => {
                  if (place.temporary && onTemporaryPlaceSelect) {
                    onTemporaryPlaceSelect(place.icao);
                  } else {
                    selectRecent(place.icao);
                  }
                }}
              >
                {isRecent && <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />}
                {place.temporary && (
                  <Ionicons name="navigate-circle-outline" size={10} color={Colors.primary} style={{ marginRight: 3 }} />
                )}
                <Text style={[styles.recentChipText, isRecent && styles.recentChipTextGold]}>{place.icao}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

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
                {(item as any).temporary === 1 && (
                  <Ionicons name="navigate-circle-outline" size={13} color={Colors.textMuted} />
                )}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ── "Här"-modal ── */}
      <Modal visible={hereModal} transparent animationType="slide" onRequestClose={() => setHereModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('here')}</Text>

            {/* Befintliga platser inom 3 km */}
            {nearbyPlaces.length > 0 && (
              <View style={styles.nearbySection}>
                <Text style={styles.nearbySectionLabel}>Sparad plats inom 3 km</Text>
                {nearbyPlaces.map(p => (
                  <TouchableOpacity
                    key={p.icao}
                    style={styles.nearbyRow}
                    onPress={() => confirmHere(p.icao)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="navigate-circle-outline" size={16} color={Colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nearbyName}>{p.name}</Text>
                      <Text style={styles.nearbyIcao}>{p.icao}</Text>
                    </View>
                    <Ionicons name="arrow-forward-circle" size={20} color={Colors.primary} />
                  </TouchableOpacity>
                ))}
                <View style={styles.divider} />
                <Text style={styles.nearbySectionLabel}>Eller spara ny plats</Text>
              </View>
            )}

            {/* Namnfält */}
            <TextInput
              style={styles.nameInput}
              value={hereName}
              onChangeText={v => setHereName(v.slice(0, 10))}
              placeholder="Namn (max 10 tecken)"
              placeholderTextColor={Colors.textMuted}
              maxLength={10}
              autoFocus={nearbyPlaces.length === 0}
            />
            <Text style={styles.nameHint}>{hereName.length}/10 tecken</Text>

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={() => confirmHere()}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate-circle-outline" size={16} color="#fff" />
              <Text style={styles.confirmBtnText}>Spara & välj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setHereModal(false)}>
              <Text style={styles.cancelBtnText}>Avbryt</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

