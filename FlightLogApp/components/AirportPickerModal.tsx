// Väder-visare: sök flygplats (ICAO/IATA/namn) och se dess METAR + TAF som vädersidan (components/weather/WeatherPage:
// överblick, banvind, tidslinje, ändringar och rå text). Öppnas förvald på stationen väderkortet visar. Ändrar INTE
// den rullande tickern på dashboarden (den visar alltid destinationen) — detta är bara en uppslagsvy.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList, ScrollView, StyleSheet, Keyboard, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { searchAirports, getAirportByIcao } from '../db/icao';
import { fetchDecodedWx, type DecodedWx } from '../services/weather';
import { WeatherPage } from './weather/WeatherPage';
import type { WxTz } from '../services/wxPage';
import { getSetting, setSetting } from '../db/flights';

const TZ_KEY = 'wx_time_zone';
import type { IcaoAirport } from '../types/flight';
import { displayCode } from '../utils/airportCodes';

const isIcao = (s?: string) => /^[A-Z]{4}$/.test((s ?? '').toUpperCase());

export function AirportPickerModal({ visible, onClose, initialIcao }: {
  visible: boolean;
  onClose: () => void;
  initialIcao?: string | null; // förvald flygplats (destinationen) att visa direkt vid öppning
}) {
  const insets = useSafeAreaInsets();
  const winH = useWindowDimensions().height;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcaoAirport[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [wx, setWx] = useState<DecodedWx | null>(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [view, setView] = useState<'decoded' | 'raw'>('decoded');
  // UTC/LOCAL för alla tider på vädersidan, sparas i settings.
  const [tz, setTz] = useState<WxTz>('utc');
  useEffect(() => { getSetting(TZ_KEY).then((v) => { if (v === 'local' || v === 'utc') setTz(v); }).catch(() => {}); }, []);
  const pickTz = (v: WxTz) => { setTz(v); setSetting(TZ_KEY, v).catch(() => {}); };
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
        {/* Ingen rubrik: sökfältet och stängknappen på samma rad. */}
        <View style={styles.header}>
        <View style={[styles.searchBar, { flex: 1 }]}>
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
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close weather">
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }}>
        {/* Tolkad vädersida ↔ rå METAR/TAF. */}
        {/* DECODED/RAW till vänster, UTC/LOCAL till höger, i samma storlek. */}
        {selected && wx && !wxLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={styles.viewSeg}>
              {(['decoded', 'raw'] as const).map((m) => (
                <TouchableOpacity key={m} activeOpacity={0.8} onPress={() => setView(m)} accessibilityRole="button" accessibilityState={{ selected: view === m }}
                  style={[styles.viewBtn, view === m && { backgroundColor: Colors.primary }]}>
                  <Text style={[styles.viewTxt, { color: view === m ? Colors.card : Colors.textSecondary }]}>{m === 'decoded' ? 'DECODED' : 'RAW'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.viewSeg}>
              {(['utc', 'local'] as const).map((v) => (
                <TouchableOpacity key={v} activeOpacity={0.8} onPress={() => pickTz(v)} accessibilityRole="button" accessibilityState={{ selected: tz === v }}
                  style={[styles.viewBtn, tz === v && { backgroundColor: Colors.primary }]}>
                  <Text style={[styles.viewTxt, { color: tz === v ? Colors.card : Colors.textSecondary }]}>{v === 'utc' ? 'UTC' : 'LOCAL'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {selected ? (
          <ScrollView style={styles.detail} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
            {wxLoading ? (
              <View style={styles.empty}><ActivityIndicator color={Colors.primary} /></View>
            ) : wx ? (
              <WeatherPage wx={wx} fallbackName={selectedName} view={view} tz={tz} />
            ) : (
              <>
                <Text style={styles.airport}>{selected}{selectedName ? ` · ${selectedName}` : ''}</Text>
                <Text style={styles.emptyTxt}>Weather unavailable</Text>
              </>
            )}
          </ScrollView>
        ) : (
          <Text style={styles.emptyTxt}>Search an airport to see its METAR and TAF</Text>
        )}

        {/* Sökträffarna som en rullista OVANPÅ vädersidan (sidan ligger kvar under). Tryck utanför → stäng. */}
        {showResults ? (
          <>
            <TouchableOpacity activeOpacity={1} accessibilityLabel="Close search results"
              onPress={() => { setQuery(''); Keyboard.dismiss(); }}
              style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(6,16,30,0.55)' }]} />
            <View style={[styles.dropdown, { maxHeight: Math.max(220, winH * 0.42) }]}>
              <FlatList
                data={results}
                keyExtractor={(a) => a.icao}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                renderItem={({ item, index }) => (
                  <TouchableOpacity style={[styles.row, index === results.length - 1 && { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => selectAirport(item.icao, item.name)}>
                    <Text style={styles.rowIcao}>{displayCode(item.icao)}</Text>
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
            </View>
          </>
        ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  viewSeg: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden', marginBottom: 4 },
  viewBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  viewTxt: { fontFamily: 'JetBrainsMono', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  input: { flex: 1, color: Colors.textPrimary, fontSize: 15, fontWeight: '600', padding: 0 },

  dropdown: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 12, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  rowIcao: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', width: 52, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  rowMid: { flex: 1 },
  rowName: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: Colors.textMuted, fontSize: 11.5, fontWeight: '500', marginTop: 1 },
  rowIata: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },

  detail: { flex: 1, marginTop: 12 },
  airport: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  empty: { paddingVertical: 28, alignItems: 'center' },
  emptyTxt: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 28 },
});
