// Lägg till plats (Manage airports): val mellan CUSTOM (riktig flygplats) och OFF-AIRPORT, samma
// look, med Apple-kartväljare i stället för att skriva koordinater manuellt. Öppnas från "+"-knappen
// eller från dashboardens "does not exist"-notis (då med koden förifylld).
//
// Custom-fält: ICAO + Name + Country. Off-airport-fält: Off-airport name + Country. Bägge placeras
// på kartan: tryck på preview → fullskärm med fast center-hårkors → panorera → "Use this location".
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { SlideToggle } from './logflight/SlideToggle';
import { addCustomAirport, addOffAirportPlace, generateTemporaryIcao } from '../db/icao';

type Mode = 'custom' | 'offairport';
const DEFAULT_REGION: Region = { latitude: 55, longitude: 12, latitudeDelta: 28, longitudeDelta: 28 };

export function AddPlaceModal({ visible, onClose, initialCode, initialMode = 'custom', onAdded }: {
  visible: boolean;
  onClose: () => void;
  initialCode?: string;
  initialMode?: Mode;
  onAdded?: (code: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [icao, setIcao] = useState('');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState(''); // ISO-landskod från reverse-geocoding av kartpunkten (för flaggan)
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // Fullskärms-kartväljare
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapType, setMapType] = useState<'standard' | 'hybridFlyover'>('standard');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const regionRef = useRef<Region>(DEFAULT_REGION); // aktuell kartmitt (hårkorset)
  const mapRef = useRef<MapView>(null);

  // Reset när modalen öppnas. Off-airport: förifyll namnet med koden (som ICAO-fältet i Custom).
  useEffect(() => {
    if (visible) {
      setMode(initialMode);
      setIcao((initialCode ?? '').toUpperCase());
      setName(initialMode === 'offairport' ? (initialCode ?? '').toUpperCase() : '');
      setCountryCode('');
      setCoord(null);
      setSearch('');
      regionRef.current = DEFAULT_REGION;
    }
  }, [visible, initialCode, initialMode]);

  const openPicker = () => {
    regionRef.current = coord
      ? { latitude: coord.lat, longitude: coord.lon, latitudeDelta: 0.4, longitudeDelta: 0.4 }
      : DEFAULT_REGION;
    setPickerOpen(true);
  };

  const confirmPicker = async () => {
    const r = regionRef.current;
    setCoord({ lat: r.latitude, lon: r.longitude });
    setPickerOpen(false);
    Keyboard.dismiss();
    // Härled landet (ISO-kod → flagga) från var punkten placerades — användaren fyller inte i land.
    try {
      const [g] = await Location.reverseGeocodeAsync({ latitude: r.latitude, longitude: r.longitude });
      if (g?.isoCountryCode) setCountryCode(g.isoCountryCode.toUpperCase());
    } catch { /* offline → ingen flagga, men platsen sparas ändå */ }
  };

  const runSearch = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await Location.geocodeAsync(q);
      if (res[0]) {
        const next: Region = { latitude: res[0].latitude, longitude: res[0].longitude, latitudeDelta: 0.4, longitudeDelta: 0.4 };
        regionRef.current = next;
        mapRef.current?.animateToRegion(next, 500);
      } else {
        Alert.alert('Not found', 'No match for that search.');
      }
    } catch {
      Alert.alert('Search failed', 'Could not look up that place.');
    } finally { setSearching(false); }
  };

  const save = async () => {
    const nm = name.trim();
    if (mode === 'custom') {
      if (icao.trim().length !== 4) { Alert.alert('Invalid code', 'ICAO code must be 4 letters.'); return; }
      if (!nm) { Alert.alert('Name required', 'Enter an airport name.'); return; }
    } else {
      if (!nm) { Alert.alert('Name required', 'Enter an off-airport name.'); return; }
    }
    setSaving(true);
    try {
      const lat = coord?.lat ?? 0, lon = coord?.lon ?? 0;
      let code: string;
      if (mode === 'custom') {
        code = icao.trim().toUpperCase();
        await addCustomAirport({ icao: code, name: nm, country: countryCode, region: countryCode || code.slice(0, 2), lat, lon });
      } else {
        code = (initialCode ?? '').trim().toUpperCase() || await generateTemporaryIcao(nm);
        await addOffAirportPlace(code, nm, countryCode, lat, lon);
      }
      onAdded?.(code);
      onClose();
    } catch {
      Alert.alert('Error', 'Could not save the place.');
    } finally { setSaving(false); }
  };

  const isCustom = mode === 'custom';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Add place</Text>

            <View style={{ marginBottom: 14 }}>
              <SlideToggle<Mode>
                block sans
                options={[{ value: 'custom', label: 'Custom' }, { value: 'offairport', label: 'Off-airport' }]}
                value={mode}
                onChange={(m) => { setMode(m); if (m === 'offairport' && !name.trim() && initialCode) setName(initialCode.toUpperCase()); }}
              />
            </View>

            {isCustom && (
              <Field label="ICAO code">
                <TextInput style={styles.input} value={icao} onChangeText={(v) => setIcao(v.toUpperCase())}
                  placeholder="ESSA" placeholderTextColor={Colors.textMuted} maxLength={4} autoCapitalize="characters" autoCorrect={false} />
              </Field>
            )}

            <Field label={isCustom ? 'Airport name' : 'Off-airport name'}>
              <TextInput style={styles.input} value={name} onChangeText={setName}
                placeholder={isCustom ? 'Stockholm Arlanda' : "Farmer's field"} placeholderTextColor={Colors.textMuted} autoCorrect={false} />
            </Field>

            {/* Kart-preview → tryck för att placera. Landet (flaggan) härleds från kartpunkten. */}
            <Text style={styles.fieldLabel}>Location{countryCode ? ` · ${countryCode}` : ''}</Text>
            <TouchableOpacity activeOpacity={0.85} onPress={openPicker} style={styles.previewWrap}>
              {coord ? (
                <MapView
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                  region={{ latitude: coord.lat, longitude: coord.lon, latitudeDelta: 0.3, longitudeDelta: 0.3 }}
                  userInterfaceStyle="dark"
                >
                  <Marker coordinate={{ latitude: coord.lat, longitude: coord.lon }} />
                </MapView>
              ) : (
                <View style={styles.previewEmpty}>
                  <Ionicons name="location-outline" size={22} color={Colors.primary} />
                  <Text style={styles.previewEmptyText}>Tap to place on map</Text>
                </View>
              )}
              {coord && (
                <View style={styles.previewEditPill}>
                  <Ionicons name="create-outline" size={12} color="#fff" />
                  <Text style={styles.previewEditText}>{coord.lat.toFixed(3)}, {coord.lon.toFixed(3)}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save place'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* ── Fullskärms-kartväljare: panorera under fast hårkors ── */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={regionRef.current}
            mapType={mapType}
            userInterfaceStyle="dark"
            showsPointsOfInterest={false}
            showsCompass={false}
            toolbarEnabled={false}
            onRegionChangeComplete={(r) => { regionRef.current = r; }}
          />
          {/* Fast hårkors i mitten */}
          <View pointerEvents="none" style={styles.crosshair}>
            <Ionicons name="location" size={38} color={Colors.primary} style={{ marginBottom: 34 }} />
          </View>

          {/* Header: stäng + sök + karttyp */}
          <View style={[styles.pickerHeader, { top: insets.top + 8 }]}>
            <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={12} style={styles.iconBtn}>
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={15} color={Colors.textSecondary} />
              <TextInput style={styles.searchInput} value={search} onChangeText={setSearch}
                placeholder="Search a place" placeholderTextColor={Colors.textMuted}
                autoCorrect={false} returnKeyType="search" onSubmitEditing={runSearch} />
              {searching
                ? <Ionicons name="hourglass-outline" size={15} color={Colors.textMuted} />
                : search.length > 0 && (
                  <TouchableOpacity onPress={runSearch} hitSlop={8}><Ionicons name="arrow-forward-circle" size={18} color={Colors.primary} /></TouchableOpacity>
                )}
            </View>
            <TouchableOpacity onPress={() => setMapType((m) => (m === 'standard' ? 'hybridFlyover' : 'standard'))} hitSlop={12} style={styles.iconBtn}>
              <Ionicons name={mapType === 'standard' ? 'globe' : 'map'} size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Bekräfta */}
          <TouchableOpacity style={[styles.useBtn, { bottom: insets.bottom + 20 }]} onPress={confirmPicker} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
            <Text style={styles.useBtnText}>Use this location</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%', borderWidth: 1, borderColor: Colors.border },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 14 },

  fieldLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: { backgroundColor: Colors.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: 15, fontWeight: '600', borderWidth: 1, borderColor: Colors.border },

  previewWrap: { height: 150, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated, marginBottom: 16 },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  previewEmptyText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  previewEditPill: { position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(6,11,22,0.8)' },
  previewEditText: { color: '#fff', fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  saveBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },

  crosshair: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pickerHeader: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(6,11,22,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 10, backgroundColor: 'rgba(6,11,22,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  searchInput: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '600', padding: 0 },
  useBtn: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 26, backgroundColor: Colors.primary, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  useBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
});
