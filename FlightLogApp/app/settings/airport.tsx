import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, TextInput, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { searchAirports, addCustomAirport, deleteCustomAirport } from '../../db/icao';
import { Colors } from '../../constants/colors';
import type { IcaoAirport } from '../../types/flight';

const EMPTY = { icao: '', name: '', country: '', region: '', lat: '', lon: '' };

export default function AirportScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcaoAirport[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (query.length >= 2) {
      searchAirports(query).then(setResults);
    } else {
      // Visa anpassade flygplatser
      searchAirports('').then((r) => setResults(r.filter((a) => a.custom)));
    }
  }, [query]);

  const handleAdd = async () => {
    if (!form.icao || form.icao.length !== 4) {
      Alert.alert('Fel', 'ICAO-kod måste vara exakt 4 bokstäver.');
      return;
    }
    if (!form.name.trim()) {
      Alert.alert('Fel', 'Flygplatsnamn krävs.');
      return;
    }
    await addCustomAirport({
      icao: form.icao.toUpperCase(),
      name: form.name,
      country: form.country || 'Okänt',
      region: form.region || form.icao.slice(0, 2).toUpperCase(),
      lat: parseFloat(form.lat) || 0,
      lon: parseFloat(form.lon) || 0,
    });
    setForm(EMPTY);
    setShowForm(false);
    searchAirports('').then((r) => setResults(r.filter((a) => a.custom)));
    Alert.alert('Tillagd', `${form.icao.toUpperCase()} har lagts till.`);
  };

  const handleDelete = (airport: IcaoAirport) => {
    Alert.alert('Ta bort', `Ta bort ${airport.icao} — ${airport.name}?`, [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Ta bort', style: 'destructive',
        onPress: async () => {
          await deleteCustomAirport(airport.icao);
          setResults((prev) => prev.filter((a) => a.icao !== airport.icao));
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.subtitle}>
        Sök bland inbyggda flygplatser eller lägg till egna ICAO-koder.
      </Text>

      {/* Sök */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Sök ICAO eller namn..."
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
        />
      </View>

      {/* Resultat */}
      {results.map((a) => (
        <View key={a.icao} style={styles.airportRow}>
          <View style={styles.airportLeft}>
            <Text style={styles.airportIcao}>{a.icao}</Text>
            <Text style={styles.airportName}>{a.name}</Text>
            <Text style={styles.airportCountry}>{a.country} · {a.region}</Text>
          </View>
          <View style={styles.airportRight}>
            {a.custom && (
              <TouchableOpacity onPress={() => handleDelete(a)} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={16} color={Colors.danger} />
              </TouchableOpacity>
            )}
            <View style={[styles.badge, a.custom && styles.badgeCustom]}>
              <Text style={styles.badgeText}>{a.custom ? 'Anpassad' : 'Inbyggd'}</Text>
            </View>
          </View>
        </View>
      ))}

      {/* Lägg till */}
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => setShowForm(!showForm)}
        activeOpacity={0.8}
      >
        <Ionicons name={showForm ? 'close' : 'add'} size={18} color={Colors.textInverse} />
        <Text style={styles.addBtnText}>{showForm ? 'Avbryt' : 'Lägg till flygplats'}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={styles.form}>
          <Text style={styles.formTitle}>Ny flygplats</Text>
          {[
            { label: 'ICAO-kod *', key: 'icao', placeholder: 'ESSA', maxLength: 4, caps: true },
            { label: 'Flygplatsnamn *', key: 'name', placeholder: 'Stockholm Arlanda' },
            { label: 'Land', key: 'country', placeholder: 'Sweden' },
            { label: 'Region (2 bokst.)', key: 'region', placeholder: 'ES', maxLength: 2, caps: true },
            { label: 'Latitud', key: 'lat', placeholder: '59.6519', keyboard: 'decimal-pad' },
            { label: 'Longitud', key: 'lon', placeholder: '17.9186', keyboard: 'decimal-pad' },
          ].map(({ label, key, placeholder, maxLength, caps, keyboard }) => (
            <View key={key} style={styles.formField}>
              <Text style={styles.formLabel}>{label}</Text>
              <TextInput
                style={styles.formInput}
                value={(form as any)[key]}
                onChangeText={(v) => setForm((p) => ({ ...p, [key]: v }))}
                placeholder={placeholder}
                placeholderTextColor={Colors.textMuted}
                maxLength={maxLength}
                autoCapitalize={caps ? 'characters' : 'none'}
                keyboardType={(keyboard as any) ?? 'default'}
              />
            </View>
          ))}
          <TouchableOpacity style={styles.saveBtn} onPress={handleAdd}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
            <Text style={styles.saveBtnText}>Spara flygplats</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10,
    paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 15, paddingVertical: 10 },

  airportRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  airportLeft: { flex: 1, gap: 1 },
  airportIcao: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  airportName: { color: Colors.textSecondary, fontSize: 12 },
  airportCountry: { color: Colors.textMuted, fontSize: 11 },
  airportRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deleteBtn: { padding: 4 },
  badge: {
    backgroundColor: Colors.separator, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeCustom: { backgroundColor: Colors.primary + '33' },
  badgeText: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 12, gap: 6,
  },
  addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  form: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 16,
    gap: 10, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  formTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  formField: { gap: 4 },
  formLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  formInput: {
    backgroundColor: Colors.elevated, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6, marginTop: 4,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
});
