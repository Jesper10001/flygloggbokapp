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
  hideHere?: boolean;
  onTemporaryPlaceSelect?: (icao: string) => void;
  onConfirm?: (icao: string) => void;
  onFocus?: () => void;
  inputFontFamily?: string; // override mono (t.ex. LED 14-seg) för ICAO-koden
  design?: boolean; // Log Flight-design: större ICAO-text, flygplatsnamn under, 3 snabbval
  // Off-airport "halvsparade" platser: när onPendingPlace finns skjuts DB-persistensen
  // upp tills flighten sparats. pendingPlaces används för namn/status-uppslag under tiden.
  pendingPlaces?: { icao: string; name: string }[];
  onPendingPlace?: (p: { icao: string; name: string }) => void;
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
      alignItems: 'center', justifyContent: 'center',
      padding: 4, marginLeft: 4,
    },

    // Statisk zIndex (INTE dynamisk) så att hela komponenten ligger över syskonen, t.ex.
    // tidsrutan. Att toggla zIndex när listan visas får iOS att om-ordna vyerna och
    // TextInputen tappar fokus (tangentbordet stängs) — därför alltid satt.
    rootRaised: { zIndex: 30 },
    // Positioneringskontext för den flytande listan.
    inputAnchor: { position: 'relative' },
    dropdown: {
      // Flyter ovanpå rutorna under istället för att trycka ner dem. Ingen egen zIndex —
      // den ligger sist i flödet (ritas överst ändå) och root sköter stackningen mot syskon.
      position: 'absolute', top: '100%', left: 0, right: 0,
      backgroundColor: Colors.elevated, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.border,
      marginTop: 4, elevation: 20, overflow: 'hidden',
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
  { label, value, onChangeText, error, placeholder, recentPlaces = [], allowHere = false, hideHere = false, onTemporaryPlaceSelect, onConfirm, onFocus, inputFontFamily, design = false, pendingPlaces = [], onPendingPlace },
  outerRef,
) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [inputText, setInputText] = useState(value);
  const [resolvedName, setResolvedName] = useState('');
  const [suggestions, setSuggestions] = useState<IcaoAirport[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dismissed, setDismissed] = useState(false); // efter ett val: dölj listan tills man skriver igen
  const inputRef = useRef<TextInput>(null);
  const searchSeq = useRef(0); // ogiltigförklarar stale sök-resultat (async-race vid val)
  useImperativeHandle(outerRef, () => ({ focus: () => inputRef.current?.focus() }), []);

  // Place status for confirmation icon color
  const [placeStatus, setPlaceStatus] = useState<'known' | 'temp-located' | 'temp-unlocated' | null>(null);

  // "Här"-modal state
  const [hereLoading, setHereLoading] = useState(false);
  const [hereModal, setHereModal] = useState(false);
  const [hereName, setHereName] = useState('');
  const [hereCoords, setHereCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<IcaoAirport[]>([]);
  // ZZZZ: ort-/stadsförslag via geokodning (Apple-geokodaren) → located temp-plats utan kartplacering.
  const [placeSuggestions, setPlaceSuggestions] = useState<{ name: string; lat: number; lon: number }[]>([]);

  // Vilken kod som visas i listan: skriver man en IATA-kod (prefixmatchar iata) → visa IATA, annars ICAO.
  const displayCode = (a: IcaoAirport) => {
    const q = inputText.trim().toUpperCase();
    return q && a.iata && a.iata.toUpperCase().startsWith(q) ? a.iata : a.icao;
  };

  useEffect(() => {
    searchSeq.current++; // en value-ändring (t.ex. efter val) ogiltigförklarar stale sökresultat
    setSuggestions([]);
    setShowDropdown(false);
    if (value.length >= 2) {
      // Halvsparad (pending) off-airport-plats: visa namn + temp-status utan DB-uppslag.
      const pend = pendingPlaces.find((p) => p.icao === value);
      if (pend) {
        setPlaceStatus('temp-unlocated');
        setInputText(pend.name);
        setResolvedName('Temporary site');
        return;
      }
      getAirportByIcao(value).then(a => {
        if (!a) {
          setPlaceStatus(/^[A-Z]{4}$/.test(value) ? 'known' : null);
          setInputText(value);
          setResolvedName('');
          return;
        }
        if (a.temporary) {
          setPlaceStatus(a.lat && a.lon && (a.lat !== 0 || a.lon !== 0) ? 'temp-located' : 'temp-unlocated');
          setInputText(a.name && a.name !== a.icao ? a.name : value);
          setResolvedName('Temporary site');
        } else {
          setPlaceStatus('known');
          setInputText(value);
          setResolvedName(a.name || '');
        }
      });
    } else {
      setPlaceStatus(null);
      setInputText(value);
      setResolvedName('');
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // ZZZZ: geokoda den skrivna texten (debouncat) → ort-/stadsförslag med koordinater. Inga flygplatser.
  useEffect(() => {
    const q = inputText.trim();
    if (!allowHere || placeStatus || q.length < 3 || q.toUpperCase() === 'ZZZZ') { setPlaceSuggestions([]); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const results = await Location.geocodeAsync(q);
        const labeled = await Promise.all(results.slice(0, 4).map(async (r) => {
          let name = q;
          try {
            const [g] = await Location.reverseGeocodeAsync({ latitude: r.latitude, longitude: r.longitude });
            name = g?.city || g?.district || g?.subregion || g?.name || q;
          } catch {}
          return { name, lat: r.latitude, lon: r.longitude };
        }));
        const seen = new Set<string>();
        const dedup = labeled.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
        if (!cancelled) setPlaceSuggestions(dedup);
      } catch { if (!cancelled) setPlaceSuggestions([]); }
    }, 700);
    return () => { cancelled = true; clearTimeout(id); };
  }, [inputText, allowHere, placeStatus]);

  const handleChangeText = (text: string) => {
    const display = allowHere ? text : text.toUpperCase();
    setInputText(display);
    setDismissed(false); // användaren skriver → tillåt förslag igen
    if (!display) {
      onChangeText('');
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    // Airport-läget: sökningen matchar ICAO + IATA direkt; flygplatsnamn först från 5 tecken (de fyra
    // första reserverade för koder). Off-airport: namnsök alltid (för egna sparade temp-platser).
    const seq = ++searchSeq.current;
    searchAirports(display, allowHere ? 1 : 5).then((results) => {
      if (seq !== searchSeq.current) return; // nyare sökning eller ett val har skett → ignorera stale resultat
      const filtered = allowHere ? results.filter((r) => (r as any).temporary === 1) : results;
      setSuggestions(filtered); // alltid lista — användaren väljer själv (inget auto-val)
      setShowDropdown(filtered.length > 0);
    });
  };

  const commitTempName = async (name: string) => {
    searchSeq.current++;
    setDismissed(true);
    const trimmed = name.trim();
    if (!trimmed) return;
    // Literal "ZZZZ" → ren platshållare, ingen plats sparas (koordinater anges ev. i remarks).
    if (trimmed.toUpperCase() === 'ZZZZ') {
      onChangeText('ZZZZ'); setInputText('ZZZZ'); setSuggestions([]); setShowDropdown(false); onConfirm?.('ZZZZ');
      return;
    }
    // Redan sparad plats (DB)?
    const existing = await getTempPlaceByName(trimmed);
    if (existing) {
      onChangeText(existing.icao);
      setInputText(existing.name || trimmed);
      setSuggestions([]);
      setShowDropdown(false);
      onConfirm?.(existing.icao);
      return;
    }
    // Redan "halvsparad" (pending) plats med samma namn? Återanvänd — skapa ingen dubblett.
    const pend = pendingPlaces.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (pend) {
      onChangeText(pend.icao);
      setInputText(pend.name);
      setSuggestions([]);
      setShowDropdown(false);
      onConfirm?.(pend.icao);
      return;
    }
    const icao = await generateTemporaryIcao(trimmed);
    if (onPendingPlace) {
      // Skjut upp persistensen till flighten sparats (halvsparad) — förälder håller listan.
      onPendingPlace({ icao, name: trimmed });
    } else {
      await addTemporaryPlace(icao, trimmed, 0, 0);
    }
    onChangeText(icao);
    setInputText(trimmed);
    setSuggestions([]);
    setShowDropdown(false);
    onConfirm?.(icao);
  };

  const handleBlur = () => {
    if (allowHere && inputText.trim() && !placeStatus) {
      commitTempName(inputText);
      return;
    }
    // Airport-läge: dölj förslagslistan när fältet lämnas (fördröjt så ett förslagstryck hinner
    // registreras först) — annars kan listan ligga kvar över tidsrutan.
    setTimeout(() => setShowDropdown(false), 150);
  };

  const select = (airport: IcaoAirport) => {
    searchSeq.current++; // ogiltigförklara ev. pågående sökning så listan inte åter-dyker upp
    setDismissed(true);
    onChangeText(airport.icao); // lagra alltid kanonisk ICAO-ident
    setInputText(airport.temporary ? airport.name : airport.icao);
    setSuggestions([]);
    setPlaceSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.blur();
    onConfirm?.(airport.icao);
  };

  const selectRecent = (icao: string) => {
    searchSeq.current++;
    setDismissed(true);
    onChangeText(icao);
    setInputText(icao);
    setSuggestions([]);
    setPlaceSuggestions([]);
    setShowDropdown(false);
    onConfirm?.(icao);
  };

  // Välj ett geokodat ortförslag → located temp-plats (koordinater direkt, ingen kartplacering behövs).
  const selectPlace = async (p: { name: string; lat: number; lon: number }) => {
    searchSeq.current++;
    setDismissed(true);
    const name = p.name.slice(0, 30);
    const icao = await generateTemporaryIcao(name);
    await addTemporaryPlace(icao, name, p.lat, p.lon);
    onChangeText(icao);
    setInputText(name);
    setSuggestions([]);
    setPlaceSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.blur();
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
        Alert.alert(t('permission_required'), 'Location permission required');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lon } = pos.coords;

      if (allowHere) {
        let suggested = '';
        try {
          const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
          const raw = geo?.city || geo?.district || geo?.subregion || geo?.region || '';
          suggested = raw.replace(/[^\p{L}\s]/gu, '').trim().slice(0, 30);
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
      Alert.alert('Error', e.message);
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
    // Skapa ny off-airport-plats (ZZZZ)
    const nameClean = hereName.trim().slice(0, 30) || 'TEMP';
    const icao = await generateTemporaryIcao(nameClean);
    await addTemporaryPlace(icao, nameClean, hereCoords.lat, hereCoords.lon);
    setHereModal(false);
    onChangeText(icao);
    onConfirm?.(icao);
    setInputText(icao);
  };

  const isConfirmed = value.length >= 2 && placeStatus !== null;
  // Off-airport-namn: dynamisk textstorlek så hela namnet ryms upp till 12 tecken;
  // längre namn krymps inte mer (samma storlek som vid 12 tecken).
  const nameOver = Math.max(0, Math.min(inputText.length, 12) - 4);
  const nameFontSize = 19 - nameOver * 0.75; // 19 (≤4 tecken) → 13 (≥12 tecken)
  const pendingName = (icao: string) => pendingPlaces.find((p) => p.icao === icao)?.name;
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
    <View style={styles.rootRaised}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={styles.inputAnchor}>
      <View style={[styles.inputWrapper, error ? styles.inputError : null]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, inputFontFamily ? { fontFamily: inputFontFamily } : null, design ? { fontSize: 19, letterSpacing: 2, fontWeight: '700' } : null, allowHere ? { fontSize: nameFontSize, letterSpacing: 0.5 } : null]}
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
        {!inputText && !hideHere && (
          <TouchableOpacity
            style={styles.hereBtn}
            onPress={handleHere}
            disabled={hereLoading}
            hitSlop={8}
            activeOpacity={0.75}
          >
            {hereLoading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Ionicons name="location" size={18} color={Colors.primary} />
            }
          </TouchableOpacity>
        )}
      </View>
      {(showDropdown || placeSuggestions.length > 0) && !dismissed && (
        <View style={styles.dropdown}>
          {placeSuggestions.map((p, idx) => (
            <View key={`pl-${idx}`}>
              {idx > 0 && <View style={styles.sep} />}
              <TouchableOpacity style={styles.suggestion} onPress={() => selectPlace(p)}>
                <Ionicons name="location" size={16} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestionName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.suggestionCountry}>Place · located</Text>
                </View>
                <Ionicons name="checkmark-circle" size={15} color={Colors.success} />
              </TouchableOpacity>
            </View>
          ))}
          {suggestions.slice(0, 8).map((item, idx) => {
            const isTemp = (item as any).temporary === 1;
            const isLocated = isTemp && item.lat !== 0 && item.lon !== 0;
            return (
              <View key={item.icao}>
                {(idx > 0 || placeSuggestions.length > 0) && <View style={styles.sep} />}
                <TouchableOpacity style={styles.suggestion} onPress={() => select(item)}>
                  {isTemp ? (
                    // Off-airport: bara namnet + grön checkmark (ingen pin, ingen "saved place")
                    <>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                      </View>
                      <Ionicons name={isLocated ? 'checkmark-circle' : 'alert-circle'} size={16} color={isLocated ? Colors.success : Colors.warning} />
                    </>
                  ) : (
                    <>
                      <Text style={[styles.suggestionIcao, inputFontFamily ? { fontFamily: inputFontFamily } : null]}>{displayCode(item)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.suggestionCountry}>{item.country}</Text>
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
      </View>
      {/* Flygplatsnamn under ICAO-rutan (designen) — krymper vid behov, aldrig utanför sektionen */}
      {design && resolvedName ? (
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: 4, textAlign: 'center', color: Colors.textSecondary, fontSize: 10 }}>
          {resolvedName}
        </Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {design ? (
        !inputText && modeFiltered.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
            {modeFiltered.slice(0, 3).map((place) => {
              const sel = (value || '').toUpperCase() === place.icao.toUpperCase();
              const label = place.temporary ? (pendingName(place.icao) || recentNames[place.icao] || place.icao) : place.icao;
              return (
                <TouchableOpacity
                  key={place.icao}
                  onPress={() => selectRecent(place.icao)}
                  activeOpacity={0.75}
                  style={{ flex: 1, minWidth: 0, paddingVertical: 5, borderRadius: 7, alignItems: 'center',
                    backgroundColor: sel ? Colors.primary : Colors.elevated, borderWidth: 1, borderColor: sel ? Colors.primary : Colors.border }}
                >
                  <Text numberOfLines={1} style={{ fontFamily: 'JetBrainsMono', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: sel ? Colors.textInverse : Colors.textSecondary }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )
      ) : (!inputText && filteredRecent.length > 0 && (
        <View style={[styles.recentRow, { marginTop: 6, marginBottom: 0 }]}>
          {filteredRecent.slice(0, 2).map((place, idx) => {
            const isFirst = idx === 0;
            const displayName = place.temporary
              ? (pendingName(place.icao) || (recentNames[place.icao] && recentNames[place.icao] !== place.icao ? recentNames[place.icao] : place.icao))
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
      ))}

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
                <Text style={styles.nearbySectionLabel}>Nearest airports</Text>
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
                    <Text style={styles.nearbySectionLabel}>Saved place within 3 km</Text>
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
                    <Text style={styles.nearbySectionLabel}>Or save new place</Text>
                  </View>
                )}

                <TextInput
                  style={styles.nameInput}
                  value={hereName}
                  onChangeText={v => setHereName(v.slice(0, 30))}
                  placeholder={t('name_max10_ph')}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={30}
                  autoFocus={nearbyPlaces.length === 0}
                />
                <Text style={styles.nameHint}>{hereName.length}/30 characters</Text>

                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => confirmHere()}
                  activeOpacity={0.8}
                >
                  <Ionicons name="navigate-circle-outline" size={16} color="#fff" />
                  <Text style={styles.confirmBtnText}>Save & select</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setHereModal(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
});

