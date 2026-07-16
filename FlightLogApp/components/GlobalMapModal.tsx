// Global flygplatskarta som helskärmsmodal (utan header, likt Visited airports). Flytande
// sökruta upptill, kategoriserad typfilter-box nere till vänster, land → dragbar lista,
// filtrerade pins per land, infokort i botten vid val. Öppnas från Manage airports + dashboard.
import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, StyleSheet, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useProfileStore, isOperator } from '../store/profileStore';
import { GlobalAirportMap } from './GlobalAirportMap';
import { CountryAirportList } from './CountryAirportList';
import { AirportInfoCard } from './AirportInfoCard';
import { getSeedAirports } from '../db/icao';
import { getAirportLandingCounts, getAirportLastFlight } from '../db/flights';
import { Colors } from '../constants/colors';

type SeedRow = [string, string, string, string, number, number];

function fmtVisit(d?: string): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${(y || '').slice(-2)}`;
}

// Flygplatstyper (namn-regex) → filtrerar kartan. "Airport" (~21k) uteslutet.
const AIRPORT_TYPES: { key: string; re: RegExp }[] = [
  { key: 'Seaplane', re: /sea ?plane|float ?plane|water aerodrome|hydroba/i },
  { key: 'Heliport', re: /heliport/i },
  { key: 'Hospital', re: /hospital|medical|clinic/i },
  { key: 'Helipad', re: /helipad|helicopter|helibase/i },
  { key: 'Airfield', re: /airfield|air field/i },
  { key: 'Airstrip', re: /airstrip|air strip|landing strip/i },
  { key: 'Aerodrome', re: /aerodrome/i },
  { key: 'Airpark', re: /airpark|air park/i },
  { key: 'Air Base', re: /air ?base|\bAFB\b|\bRAF\b|naval air|air force|military/i },
  { key: 'Glider', re: /glider|gliding|segelflug/i },
  { key: 'Ultralight', re: /ultralight|microlight/i },
  { key: 'Balloon', re: /balloon/i },
  { key: 'Farm/Ranch', re: /ranch|farm(?!ington)/i },
];

// Kategorier för filter-boxen. Kategori med en enda typ (Air Base) appliceras direkt.
const FILTER_CATS: { key: string; types: string[] }[] = [
  { key: 'Air Base', types: ['Air Base'] },
  { key: 'Helicopter', types: ['Heliport', 'Hospital', 'Helipad'] },
  { key: 'Fields', types: ['Airfield', 'Airstrip', 'Aerodrome', 'Airpark'] },
  { key: 'Other', types: ['Glider', 'Ultralight', 'Balloon', 'Farm/Ranch', 'Seaplane'] },
];

export function GlobalMapModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seedData, setSeedData] = useState<SeedRow[]>([]);
  const [mapCountry, setMapCountry] = useState<string | null>(null);
  const [mapSearch, setMapSearch] = useState('');
  const [focusAirport, setFocusAirport] = useState<SeedRow | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [mapH, setMapH] = useState(0);
  const [landingCounts, setLandingCounts] = useState<Record<string, number>>({});
  const [lastFlightMap, setLastFlightMap] = useState<Record<string, { id: number; date: string; reg: string }>>({});

  useEffect(() => {
    if (!visible || seedData.length) return;
    getSeedAirports().then((d) => setSeedData(d as SeedRow[]));
    getAirportLandingCounts().then(setLandingCounts);
    getAirportLastFlight().then(setLastFlightMap);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeRe = useMemo(() => AIRPORT_TYPES.find((x) => x.key === typeFilter)?.re ?? null, [typeFilter]);
  const typedSeed = useMemo(() => (typeRe ? seedData.filter((r) => typeRe.test(r[1])) : seedData), [typeRe, seedData]);
  const countryPins = useMemo(
    () => (typeFilter && mapCountry ? typedSeed.filter((r) => r[2] === mapCountry) : []),
    [typeFilter, mapCountry, typedSeed],
  );
  // Startregion vid pins-läge (så kartan ramar in landet direkt efter remount).
  const pinsRegion = useMemo(() => {
    if (!countryPins.length) return undefined;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const a of countryPins) { minLa = Math.min(minLa, a[4]); maxLa = Math.max(maxLa, a[4]); minLo = Math.min(minLo, a[5]); maxLo = Math.max(maxLo, a[5]); }
    return {
      latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2,
      latitudeDelta: Math.max(0.4, (maxLa - minLa) * 1.4 + 0.3),
      longitudeDelta: Math.max(0.4, (maxLo - minLo) * 1.4 + 0.3),
    };
  }, [countryPins]);
  // Remounta kartan (ny key) bara när FILTRET ändras — då byggs flaggornas koordinater om helt
  // (native-krasch annars). Land-val remountar INTE längre, så in/ut-zoom kan animeras mjukt.
  const mapKey = `${typeFilter ?? 'all'}`;
  const searchResults = useMemo(() => {
    const q = mapSearch.trim().toUpperCase();
    if (q.length < 2) return [];
    const exact: SeedRow[] = [], pre: SeedRow[] = [], nameM: SeedRow[] = [];
    for (const r of seedData) {
      const icao = r[0].toUpperCase();
      if (icao === q) exact.push(r);
      else if (icao.startsWith(q)) { if (pre.length < 30) pre.push(r); }
      else if (r[1].toUpperCase().includes(q)) { if (nameM.length < 30) nameM.push(r); }
    }
    return [...exact, ...pre, ...nameM].slice(0, 20);
  }, [mapSearch, seedData]);

  const closeMap = () => {
    setMapCountry(null); setMapSearch(''); setFocusAirport(null); setTypeFilter(null); setFilterCat(null); setSatellite(false);
    onClose();
  };
  const focusByIcao = (icao: string) => {
    const r = seedData.find((x) => x[0] === icao);
    if (r) setFocusAirport(r);
  };
  const applyType = (t: string) => {
    setTypeFilter((cur) => (cur === t ? null : t));
    setFilterCat(null); setFocusAirport(null); setMapSearch('');
  };

  const showFilterBox = !focusAirport && !(mapCountry && !typeFilter);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeMap}>
      <View style={{ flex: 1, backgroundColor: Colors.background }} onLayout={(e) => setMapH(e.nativeEvent.layout.height)}>
        {visible && (
          <GlobalAirportMap
            key={mapKey}
            airports={typedSeed}
            initialRegion={pinsRegion}
            mode="country"
            onSelectCountry={setMapCountry}
            onSelectAirport={focusByIcao}
            focus={focusAirport}
            hideCountries={!!focusAirport || mapSearch.trim().length >= 2}
            mapType={satellite ? 'hybrid' : 'standard'}
            pins={countryPins}
          />
        )}

        {/* Stäng — uppe till höger */}
        <TouchableOpacity onPress={closeMap} activeOpacity={0.8}
          style={{ position: 'absolute', top: insets.top + 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Sökruta — fritt liggande upptill (som period-väljaren på visited) */}
        {!mapCountry && (
          <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 60, pointerEvents: 'box-none' }}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search ICAO or name"
                placeholderTextColor={Colors.textMuted}
                value={mapSearch}
                onChangeText={(v) => { setMapSearch(v); if (focusAirport) setFocusAirport(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {(mapSearch.length > 0 || focusAirport) && (
                <TouchableOpacity onPress={() => { setMapSearch(''); setFocusAirport(null); Keyboard.dismiss(); }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Sökresultat under sökrutan */}
        {!mapCountry && !focusAirport && searchResults.length > 0 && (
          <View style={{ position: 'absolute', top: insets.top + 12 + 48, left: 12, right: 60, pointerEvents: 'box-none' }}>
            <View style={styles.searchDropdown}>
              <ScrollView keyboardShouldPersistTaps="handled">
                {searchResults.map((r) => (
                  <TouchableOpacity key={r[0]} style={styles.searchResult} activeOpacity={0.7}
                    onPress={() => { setFocusAirport(r); setMapSearch(''); Keyboard.dismiss(); }}>
                    <Text style={styles.searchResultIcao}>{r[0]}</Text>
                    <Text style={styles.searchResultName} numberOfLines={1}>{r[1]}</Text>
                    <Ionicons name="location" size={13} color={Colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        )}

        {/* Tillbaka till länderna (från typfilter-pins) */}
        {mapCountry && typeFilter && !focusAirport && (
          <TouchableOpacity onPress={() => setMapCountry(null)} activeOpacity={0.85}
            style={{ position: 'absolute', top: insets.top + 12, left: 12, zIndex: 25, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: Colors.primary + '66' }}>
            <Ionicons name="chevron-back" size={16} color={Colors.primary} />
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>Back to countries</Text>
          </TouchableOpacity>
        )}

        {/* Kategoriserat typfilter — nere till vänster (alltid kvar) */}
        {showFilterBox && (
          <View style={styles.filterBox}>
            <View style={styles.filterHeader}>
              {filterCat ? (
                <TouchableOpacity onPress={() => setFilterCat(null)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                  <Ionicons name="chevron-back" size={15} color={Colors.primary} />
                  <Text style={styles.filterHeaderTxt} numberOfLines={1}>{filterCat}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.filterHeaderTxt, { flex: 1 }]}>{typeFilter ?? 'Filter'}</Text>
              )}
              {typeFilter && !filterCat && (
                <TouchableOpacity onPress={() => setTypeFilter(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={15} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView style={{ maxHeight: 5 * 34 }} showsVerticalScrollIndicator={false}>
              {filterCat
                ? (FILTER_CATS.find((c) => c.key === filterCat)?.types ?? []).map((t) => (
                    <TouchableOpacity key={t} onPress={() => applyType(t)} activeOpacity={0.7}
                      style={[styles.filterRow, typeFilter === t && { backgroundColor: Colors.primary + '33' }]}>
                      <Text style={styles.filterRowTxt} numberOfLines={1}>{t}</Text>
                      {typeFilter === t && <Ionicons name="checkmark" size={15} color={Colors.primary} />}
                    </TouchableOpacity>
                  ))
                : FILTER_CATS.map((cat) => {
                    const single = cat.types.length === 1;
                    const active = cat.types.includes(typeFilter ?? '');
                    return (
                      <TouchableOpacity key={cat.key} onPress={() => (single ? applyType(cat.types[0]) : setFilterCat(cat.key))} activeOpacity={0.7}
                        style={[styles.filterRow, active && { backgroundColor: Colors.primary + '33' }]}>
                        <Text style={styles.filterRowTxt} numberOfLines={1}>{cat.key}</Text>
                        {single
                          ? (active ? <Ionicons name="checkmark" size={15} color={Colors.primary} /> : null)
                          : <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />}
                      </TouchableOpacity>
                    );
                  })}
            </ScrollView>
          </View>
        )}

        {/* Satellit-växel — nere till höger (som visited) */}
        {showFilterBox && (
          <TouchableOpacity onPress={() => setSatellite((s) => !s)} activeOpacity={0.8}
            style={{ position: 'absolute', bottom: 24, right: 16, height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)' }}>
            <Ionicons name={satellite ? 'map' : 'globe'} size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{satellite ? 'Map' : 'Satellite'}</Text>
          </TouchableOpacity>
        )}

        {/* Vald flygplats → infokort i botten */}
        {focusAirport && (() => {
          const lc = landingCounts[focusAirport[0]] ?? 0;
          const lf = lastFlightMap[focusAirport[0]];
          // Land-listflödet: sheet:en täcker botten → visa kortet överst, till vänster om X.
          const atTop = !!(mapCountry && !typeFilter);
          return (
            <View style={atTop
              ? { position: 'absolute', top: insets.top + 12, left: 12, right: 60, zIndex: 15 }
              : { position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 14, zIndex: 15 }}>
              {/* Tillbaka: med filter → landets överblick; utan filter → hela vägen till världsvyn */}
              {mapCountry && (
                <TouchableOpacity onPress={() => { setFocusAirport(null); if (!typeFilter) setMapCountry(null); }} activeOpacity={0.85}
                  style={{ alignSelf: 'flex-start', marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Colors.primary + '66' }}>
                  <Ionicons name="chevron-back" size={16} color={Colors.primary} />
                  <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>Back to overview</Text>
                </TouchableOpacity>
              )}
              <AirportInfoCard
                icao={focusAirport[0]}
                name={focusAirport[1]}
                landingCount={lc > 0 ? lc : undefined}
                lastText={lf ? fmtVisit(lf.date) : undefined}
                onLastPress={lf ? () => {
                  closeMap();
                  const op = isOperator(useProfileStore.getState().profile);
                  router.push((op ? `/flight/${lf.id}` : `/flight/detail/${lf.id}`) as any);
                } : undefined}
                onClose={() => setFocusAirport(null)}
              />
            </View>
          );
        })()}

        {/* Land vald (utan typfilter) → dragbar flygplatslista */}
        {mapCountry && !typeFilter && mapH > 0 && (
          <CountryAirportList
            country={mapCountry}
            rows={seedData}
            onClose={() => { setFocusAirport(null); setMapCountry(null); }}
            onSelectAirport={(r) => setFocusAirport(r)}
            containerHeight={mapH}
            minimized={!!focusAirport}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(15,22,38,0.95)', borderRadius: 12,
    paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', gap: 8,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 10 },
  searchDropdown: {
    maxHeight: 280, backgroundColor: 'rgba(15,22,38,0.97)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  searchResult: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  searchResultIcao: { color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 1, width: 52 },
  searchResultName: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, flex: 1 },

  filterBox: {
    position: 'absolute', bottom: 24, left: 16, width: 180, zIndex: 20,
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden',
  },
  filterHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, height: 34,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  filterHeaderTxt: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 34 },
  filterRowTxt: { flex: 1, color: '#fff', fontSize: 12.5, fontWeight: '600' },
});
