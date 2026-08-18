// Flygplatsväljare för väder-tickern: fritext-sök (ICAO/IATA/namn) + rullbar lista. Väljer man en
// flygplats visas METAR/TAF för den i stället för destinationen. Bara riktiga 4-bokstavs-ICAO listas
// (det är de som kan ha METAR/TAF). "Use last destination" återställer till automatiskt läge.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, StyleSheet, Keyboard, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { searchAirports } from '../db/icao';
import type { IcaoAirport } from '../types/flight';

const isIcao = (s?: string) => /^[A-Z]{4}$/.test((s ?? '').toUpperCase());

export function AirportPickerModal({ visible, onClose, onPick, onUseDestination, currentIcao, usingOverride }: {
  visible: boolean;
  onClose: () => void;
  onPick: (icao: string) => void;
  onUseDestination: () => void;
  currentIcao?: string | null;   // markeras med bock i listan
  usingOverride?: boolean;       // true = en annan flygplats än destinationen visas nu
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcaoAirport[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!visible) { setQuery(''); setResults([]); } }, [visible]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const r = await searchAirports(q);
        setResults(r.filter((a) => isIcao(a.icao)));
      } catch { setResults([]); } finally { setLoading(false); }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const pick = (icao: string) => { Keyboard.dismiss(); onPick(icao.toUpperCase()); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Weather station</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Search ICAO, IATA or name"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={styles.destRow} activeOpacity={0.7} onPress={() => { Keyboard.dismiss(); onUseDestination(); }}>
          <Ionicons name="navigate" size={16} color={Colors.primary} />
          <Text style={styles.destText}>Use last destination</Text>
          {!usingOverride && <Ionicons name="checkmark" size={16} color={Colors.primary} />}
        </TouchableOpacity>

        <FlatList
          data={results}
          keyExtractor={(a) => a.icao}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => pick(item.icao)}>
              <Text style={styles.icao}>{item.icao}</Text>
              <View style={styles.rowMid}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {(item.municipality || item.country) ? (
                  <Text style={styles.sub} numberOfLines={1}>{[item.municipality, item.country].filter(Boolean).join(', ')}</Text>
                ) : null}
              </View>
              {item.iata ? <Text style={styles.iata}>{item.iata}</Text> : null}
              {item.icao === currentIcao ? <Ionicons name="checkmark" size={16} color={Colors.primary} /> : null}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            loading ? (
              <View style={styles.empty}><ActivityIndicator color={Colors.primary} /></View>
            ) : (
              <Text style={styles.emptyText}>{query.trim().length >= 2 ? 'No airports found' : 'Type at least 2 characters'}</Text>
            )
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  input: { flex: 1, color: Colors.textPrimary, fontSize: 15, fontWeight: '600', padding: 0 },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  destText: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  icao: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', width: 52, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  rowMid: { flex: 1 },
  name: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  sub: { color: Colors.textMuted, fontSize: 11.5, fontWeight: '500', marginTop: 1 },
  iata: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  empty: { paddingVertical: 24, alignItems: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
});
