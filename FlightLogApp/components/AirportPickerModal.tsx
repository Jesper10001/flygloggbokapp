// Väder-visare: sök flygplats (ICAO/IATA/namn) och se dess METAR + TAF direkt under namnet.
// Växla mellan tolkad prosa och original-rapporten. Öppnas förvald på destinationen. Ändrar INTE
// den rullande tickern på dashboarden (den visar alltid destinationen) — detta är bara en uppslagsvy.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, ScrollView, StyleSheet, Keyboard, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { searchAirports, getAirportByIcao } from '../db/icao';
import { fetchDecodedWx, type DecodedWx, type WxStatus } from '../services/weather';
import type { IcaoAirport } from '../types/flight';

const isIcao = (s?: string) => /^[A-Z]{4}$/.test((s ?? '').toUpperCase());
const STATUS_COLOR: Record<WxStatus, string> = { fresh: Colors.success, aging: Colors.warning, stale: Colors.danger };

export function AirportPickerModal({ visible, onClose, initialIcao }: {
  visible: boolean;
  onClose: () => void;
  initialIcao?: string | null; // förvald flygplats (destinationen) att visa direkt vid öppning
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcaoAirport[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [wx, setWx] = useState<DecodedWx | null>(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [view, setView] = useState<'decoded' | 'raw'>('decoded');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectAirport = async (icao: string, name?: string) => {
    const id = icao.trim().toUpperCase();
    Keyboard.dismiss();
    setQuery(''); setResults([]);
    setSelected(id);
    setWx(null); setWxLoading(true);
    let nm = name ?? '';
    try { if (!nm) { const ap = await getAirportByIcao(id); nm = ap?.name ?? ''; } } catch { /* namn valfritt */ }
    setSelectedName(nm);
    try { setWx(await fetchDecodedWx(id)); } catch { setWx(null); } finally { setWxLoading(false); }
  };

  // Vid öppning: nollställ sök och förvälj destinationen (om given).
  useEffect(() => {
    if (!visible) return;
    setQuery(''); setResults([]); setView('decoded');
    if (initialIcao && isIcao(initialIcao)) { selectAirport(initialIcao); }
    else { setSelected(null); setSelectedName(''); setWx(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialIcao]);

  // Debouncad sökning (bara riktiga 4-bokstavs-ICAO listas — de kan ha METAR/TAF).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try { const r = await searchAirports(q); setResults(r.filter((a) => isIcao(a.icao))); }
      catch { setResults([]); } finally { setSearching(false); }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const showResults = results.length > 0 || (query.trim().length >= 2);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Weather</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Search ICAO, IATA or name"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); Keyboard.dismiss(); }} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {showResults ? (
          <FlatList
            data={results}
            keyExtractor={(a) => a.icao}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => selectAirport(item.icao, item.name)}>
                <Text style={styles.rowIcao}>{item.icao}</Text>
                <View style={styles.rowMid}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                  {(item.municipality || item.country) ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{[item.municipality, item.country].filter(Boolean).join(', ')}</Text>
                  ) : null}
                </View>
                {item.iata ? <Text style={styles.rowIata}>{item.iata}</Text> : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              searching ? <View style={styles.empty}><ActivityIndicator color={Colors.primary} /></View>
                : <Text style={styles.emptyTxt}>No airports found</Text>
            }
          />
        ) : selected ? (
          <ScrollView style={styles.detail} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
            <Text style={styles.airport}>{selected}{selectedName ? ` · ${selectedName}` : ''}</Text>

            {/* Tolkad ↔ original */}
            <View style={styles.toggle}>
              {(['decoded', 'raw'] as const).map((m) => (
                <TouchableOpacity key={m} activeOpacity={0.8} onPress={() => setView(m)}
                  style={[styles.toggleBtn, view === m && styles.toggleBtnActive]}>
                  <Text style={[styles.toggleTxt, view === m && styles.toggleTxtActive]}>{m === 'decoded' ? 'Decoded' : 'Raw'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {wxLoading ? (
              <View style={styles.empty}><ActivityIndicator color={Colors.primary} /></View>
            ) : wx ? (
              <>
                <Text style={[styles.wxLabel, { color: wx.metarStatus ? STATUS_COLOR[wx.metarStatus] : Colors.textMuted }]}>
                  METAR {wx.metarStation ?? selected}{wx.metarIsAlternate ? `  ·  nearest to ${wx.destIcao}` : ''}
                </Text>
                <Text style={[styles.wxBody, view === 'raw' && styles.wxRaw]}>
                  {view === 'decoded'
                    ? [wx.metarTimeZ, wx.metarText].filter(Boolean).join(' — ') || 'No data'
                    : (wx.rawMetar || 'No data')}
                </Text>

                <Text style={[styles.wxLabel, { marginTop: 16, color: wx.tafStatus ? STATUS_COLOR[wx.tafStatus] : Colors.textMuted }]}>
                  TAF {wx.tafStation ?? selected}{wx.tafIsAlternate ? `  ·  nearest to ${wx.destIcao}` : ''}
                </Text>
                <Text style={[styles.wxBody, view === 'raw' && styles.wxRaw]}>
                  {view === 'decoded' ? (wx.tafText || 'Not available') : (wx.rawTaf || 'Not available')}
                </Text>
              </>
            ) : (
              <Text style={styles.emptyTxt}>Weather unavailable</Text>
            )}
          </ScrollView>
        ) : (
          <Text style={styles.emptyTxt}>Search an airport to see its METAR and TAF</Text>
        )}
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

  list: { flex: 1, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  rowIcao: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', width: 52, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  rowMid: { flex: 1 },
  rowName: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: Colors.textMuted, fontSize: 11.5, fontWeight: '500', marginTop: 1 },
  rowIata: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },

  detail: { flex: 1, marginTop: 12 },
  airport: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  toggle: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 3, gap: 3, marginBottom: 14 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 7 },
  toggleBtnActive: { backgroundColor: Colors.primary },
  toggleTxt: { fontSize: 12.5, fontWeight: '700', color: Colors.textSecondary },
  toggleTxtActive: { color: Colors.textInverse },

  wxLabel: { fontSize: 13, fontWeight: '800', fontFamily: 'ChakraPetch-SemiBold', letterSpacing: 0.3, marginBottom: 5 },
  wxBody: { fontSize: 14, color: Colors.textPrimary, lineHeight: 21 },
  wxRaw: { fontFamily: 'JetBrainsMono', fontSize: 12.5, color: Colors.textSecondary, lineHeight: 19 },

  empty: { paddingVertical: 28, alignItems: 'center' },
  emptyTxt: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 28 },
});
