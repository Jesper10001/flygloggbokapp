import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { searchAirports, getNearbyTemporaryPlaces, getNearbyAirports, generateTemporaryIcao, addTemporaryPlace, getAirportByIcao, getTempPlaceByName, batchPlaceNames } from '../db/icao';
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
  onConfirm?: (icao: string) => void;
  onFocus?: () => void;
}

export type IcaoInputHandle = { focus: () => void };

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
    recentChipOrange: { backgroundColor: Colors.warning + '22', borderColor: Colors.warning + '88' },
    recentChipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    recentChipTextGold: { color: Colors.gold },
    recentChipTextOrange: { color: Colors.warning },

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

export const IcaoInput = forwardRef<IcaoInputHandle, Props>(function IcaoInput(
  { label, value, onChangeText, error, placeholder, recentPlaces = [], allowHere = false, onTemporaryPlaceSelect, onConfirm, onFocus },
  outerRef,
) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [inputText, setInputText] = useState(value);
  const [suggestions, setSuggestions] = useState<IcaoAirport[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(outerRef, () => ({ focus: () => inputRef.current?.focus() }), []);

  // Place status for confirmation icon color
  const [placeStatus, setPlaceStatus] = useState<'known' | 'temp-located' | 'temp-unlocated' | null>(null);

  // "Här"-modal state
  const [hereLoading, setHereLoading] = useState(false);
  const [hereModal, setHereModal] = useState(false);
  const [hereName, setHereName] = useState('');
  const [hereCoords, setHereCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<IcaoAirport[]>([]);

  useEffect(() => {
    setSuggestions([]);
    setShowDropdown(false);
    if (value.length >= 2) {
      getAirportByIcao(value).then(a => {
        if (!a) {
          setPlaceStatus(/^[A-Z]{4}$/.test(value) ? 'known' : null);
          setInputText(value);
          return;
        }
        if (a.temporary) {
          setPlaceStatus(a.lat && a.lon && (a.lat !== 0 || a.lon !== 0) ? 'temp-located' : 'temp-unlocated');
          setInputText(a.name && a.name !== a.icao ? a.name : value);
        } else {
          setPlaceStatus('known');
          setInputText(value);
        }
      });
    } else {
      setPlaceStatus(null);
      setInputText(value);
    }
  }, [value]);

  const handleChangeText = (text: string) => {
    const display = allowHere ? text : text.toUpperCase();
    setInputText(display);
    if (!display) {
      onChangeText('');
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    searchAirports(display).then((results) => {
      const filtered = allowHere ? results.filter(r => (r as any).temporary === 1) : results;
      setSuggestions(filtered);
      setShowDropdown(filtered.length > 0);
    });
  };

  const commitTempName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = await getTempPlaceByName(trimmed);
    if (existing) {
      onChangeText(existing.icao);
      setInputText(existing.name || trimmed);
      setSuggestions([]);
      setShowDropdown(false);
      onConfirm?.(existing.icao);
      return;
    }
    const icao = await generateTemporaryIcao(trimmed);
    await addTemporaryPlace(icao, trimmed, 0, 0);
    onChangeText(icao);
    setInputText(trimmed);
    setSuggestions([]);
    setShowDropdown(false);
    onConfirm?.(icao);
  };

  const handleBlur = () => {
    if (allowHere && inputText.trim() && !placeStatus) {
      commitTempName(inputText);
    }
  };

  const select = (airport: IcaoAirport) => {
    onChangeText(airport.icao);
    setInputText(airport.temporary ? airport.name : airport.icao);
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.blur();
    onConfirm?.(airport.icao);
  };

  const selectRecent = (icao: string) => {
    onChangeText(icao);
    setInputText(icao);
    setSuggestions([]);
    setShowDropdown(false);
    onConfirm?.(icao);
  };

  // Nearby ICAO airports (for ICAO mode "Här")
  const [nearbyIcaoAirports, setNearbyIcaoAirports] = useState<IcaoAirport[]>([]);

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

      if (allowHere) {
        let suggested = '';
        try {
          const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
          const raw = geo?.city || geo?.district || geo?.subregion || geo?.region || '';
          suggested = raw.replace(/[^\p{L}\s]/gu, '').trim().slice(0, 10);
        } catch {}
        const nearby = await getNearbyTemporaryPlaces(lat, lon, 3);
        setHereCoords({ lat, lon });
        setHereName(suggested);
        setNearbyPlaces(nearby);
        setNearbyIcaoAirports([]);
        setHereModal(true);
      } else {
        const nearby = await getNearbyAirports(lat, lon, 5);
        setHereCoords({ lat, lon });
        setNearbyIcaoAirports(nearby);
        setNearbyPlaces([]);
        setHereModal(true);
      }
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
      onConfirm?.(existingIcao);
      return;
    }
    // Skapa ny tillfällig plats
    const nameClean = hereName.trim().slice(0, 10) || 'TEMP';
    const icao = await generateTemporaryIcao(nameClean);
    await addTemporaryPlace(icao, nameClean, hereCoords.lat, hereCoords.lon);
    setHereModal(false);
    onChangeText(icao);
    onConfirm?.(icao);
    setInputText(icao);
  };

  const isConfirmed = value.length >= 2 && placeStatus !== null;
  // Resolve temp place names for recent chips
  const [recentNames, setRecentNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const tempIcaos = recentPlaces.filter(p => p.temporary).map(p => p.icao);
    if (tempIcaos.length > 0) batchPlaceNames(tempIcaos).then(setRecentNames);
  }, [recentPlaces]);

  const modeFiltered = allowHere
    ? recentPlaces.filter(p => p.temporary)
    : recentPlaces.filter(p => !p.temporary);
  const filteredRecent = (
    inputText
      ? modeFiltered.filter((p) => p.icao.startsWith(inputText.toUpperCase()) && p.icao !== inputText.toUpperCase())
      : modeFiltered.slice(0, 2)
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
          onFocus={onFocus}
          onBlur={handleBlur}
          onSubmitEditing={() => {
            if (allowHere && inputText.trim() && !placeStatus) {
              commitTempName(inputText);
            }
          }}
          placeholder={placeholder ?? (allowHere ? t('search_place') : t('icao_placeholder'))}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize={allowHere ? 'words' : 'characters'}
          autoCorrect={false}
          returnKeyType={allowHere ? 'done' : 'default'}
        />
        {isConfirmed && (
          <Ionicons
            name={error ? 'close-circle' : 'checkmark-circle'}
            size={18}
            color={error ? Colors.danger : placeStatus === 'temp-unlocated' ? Colors.warning : Colors.success}
            style={styles.icon}
          />
        )}
        {inputText.length > 0 && !isConfirmed && (
          <TouchableOpacity onPress={() => { onChangeText(''); setInputText(''); }} hitSlop={8}>
            <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} style={styles.icon} />
          </TouchableOpacity>
        )}
        {!inputText && (
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
          {filteredRecent.slice(0, 2).map((place, idx) => {
            const isFirst = idx === 0;
            const displayName = place.temporary
              ? (recentNames[place.icao] && recentNames[place.icao] !== place.icao ? recentNames[place.icao] : place.icao)
              : place.icao;
            const chipHighlight = isFirst
              ? (place.temporary ? styles.recentChipOrange : styles.recentChipGold)
              : undefined;
            const textHighlight = isFirst
              ? (place.temporary ? styles.recentChipTextOrange : styles.recentChipTextGold)
              : undefined;
            return (
              <TouchableOpacity
                key={place.icao}
                style={[styles.recentChip, chipHighlight]}
                onPress={() => selectRecent(place.icao)}
              >
                {isFirst && !place.temporary && <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />}
                {place.temporary && (
                  <Ionicons name="location" size={10} color={isFirst ? Colors.warning : Colors.primary} style={{ marginRight: 3 }} />
                )}
                <Text style={[styles.recentChipText, textHighlight]}>{displayName}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {showDropdown && (
        <View style={styles.dropdown}>
          {suggestions.slice(0, 8).map((item, idx) => {
            const isTemp = (item as any).temporary === 1;
            const isLocated = isTemp && item.lat !== 0 && item.lon !== 0;
            return (
              <View key={item.icao}>
                {idx > 0 && <View style={styles.sep} />}
                <TouchableOpacity style={styles.suggestion} onPress={() => select(item)}>
                  {isTemp ? (
                    <Ionicons name="location" size={16} color={isLocated ? Colors.success : Colors.warning} style={{ width: 48, textAlign: 'center' }} />
                  ) : (
                    <Text style={styles.suggestionIcao}>{item.icao}</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.suggestionCountry}>{isTemp ? (isLocated ? 'Sparad plats' : 'Ej placerad') : item.country}</Text>
                  </View>
                  {isTemp && (
                    <Ionicons name={isLocated ? 'checkmark-circle' : 'alert-circle'} size={16} color={isLocated ? Colors.success : Colors.warning} />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* ── "Här"-modal ── */}
      <Modal visible={hereModal} transparent animationType="slide" onRequestClose={() => setHereModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('here')}</Text>

            {/* ICAO mode — show nearby airports */}
            {nearbyIcaoAirports.length > 0 && (
              <View style={styles.nearbySection}>
                <Text style={styles.nearbySectionLabel}>Närmaste flygplatser</Text>
                {nearbyIcaoAirports.map(p => (
                  <TouchableOpacity
                    key={p.icao}
                    style={styles.nearbyRow}
                    onPress={() => {
                      setHereModal(false);
                      onChangeText(p.icao);
                      setInputText(p.icao);
                      onConfirm?.(p.icao);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.nearbyIcao, { fontWeight: '800', fontSize: 14, color: Colors.primary }]}>{p.icao}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nearbyName}>{p.name}</Text>
                      <Text style={styles.nearbyIcao}>{p.country}</Text>
                    </View>
                    <Ionicons name="arrow-forward-circle" size={20} color={Colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Temp mode — nearby saved places + create new */}
            {allowHere && (
              <>
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
              </>
            )}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setHereModal(false)}>
              <Text style={styles.cancelBtnText}>Avbryt</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
});

