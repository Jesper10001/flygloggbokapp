// OpenAIP-luftrum som VEKTOR-overlay på Apple Maps: ritbara polygoner med tydliga borders,
// lager-toggle per kategori och sök på R-områden (type 1). Data hämtas on-demand per kartvy.
// Stilen följer Blades (Colors). OBS: OpenAIP är CC BY-NC-SA (icke-kommersiell) → licens före release.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import MapView, { Polygon, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import {
  OPENAIP_KEY, AIRSPACE_CATEGORIES, MAX_BBOX_DEG,
  fetchAirspacesInBbox, fetchRestrictedForCountry, colorForType, categoryForType, formatLimit, boundsOf,
  type Airspace,
} from '../services/openaip';

const INITIAL: Region = { latitude: 59.3, longitude: 18.0, latitudeDelta: 2.2, longitudeDelta: 2.2 };
const withAlpha = (hex: string, aa: string) => hex + aa;

export function OpenAipMapModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const hasKey = OPENAIP_KEY.trim().length > 0;
  const mapRef = useRef<MapView>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mapType, setMapType] = useState<'standard' | 'hybridFlyover'>('standard');
  const [airspaces, setAirspaces] = useState<Airspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [tooZoomedOut, setTooZoomedOut] = useState(false);
  const [country, setCountry] = useState<string>('SE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tapped, setTapped] = useState<Airspace | null>(null);

  // Lager-toggle: vilka kategorier som visas (default enligt AIRSPACE_CATEGORIES).
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(AIRSPACE_CATEGORIES.map((c) => [c.key, c.defaultOn])));
  const [showLayers, setShowLayers] = useState(false);

  // Sök på R-områden.
  const [search, setSearch] = useState('');
  const [rAreas, setRAreas] = useState<Airspace[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);

  // Hämta luftrum för aktuell kartvy (om tillräckligt inzoomad).
  const loadForRegion = useCallback(async (region: Region) => {
    if (!hasKey) return;
    if (region.longitudeDelta > MAX_BBOX_DEG * 0.95 || region.latitudeDelta > MAX_BBOX_DEG * 0.95) {
      setTooZoomedOut(true); setAirspaces([]); return;
    }
    setTooZoomedOut(false);
    const lonHalf = region.longitudeDelta / 2, latHalf = region.latitudeDelta / 2;
    const bbox = {
      lonMin: region.longitude - lonHalf, latMin: region.latitude - latHalf,
      lonMax: region.longitude + lonHalf, latMax: region.latitude + latHalf,
    };
    setLoading(true);
    try {
      const list = await fetchAirspacesInBbox(bbox);
      setAirspaces(list);
      // Härled land (vanligaste) → styr R-sökningen.
      const counts: Record<string, number> = {};
      for (const a of list) if (a.country) counts[a.country] = (counts[a.country] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (top) setCountry(top);
    } catch { /* nätfel → behåll tidigare */ } finally { setLoading(false); }
  }, [hasKey]);

  const onRegionChange = useCallback((region: Region) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => loadForRegion(region), 350);
  }, [loadForRegion]);

  // Initial hämtning när modalen öppnas.
  useEffect(() => {
    if (visible) { setMapType('standard'); loadForRegion(INITIAL); }
  }, [visible, loadForRegion]);

  // Ladda landets R-områden när sök används (cachas i servicen).
  useEffect(() => {
    if (!searchFocused && !search) return;
    fetchRestrictedForCountry(country).then(setRAreas).catch(() => setRAreas([]));
  }, [searchFocused, search, country]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return rAreas.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 30);
  }, [search, rAreas]);

  const visibleAirspaces = useMemo(
    () => airspaces.filter((a) => enabled[categoryForType(a.type)]),
    [airspaces, enabled]);

  const selectAirspace = (a: Airspace) => {
    setEnabled((e) => ({ ...e, restricted: true })); // se till att R-lagret är på
    setSelectedId(a.id);
    setSearch(''); setSearchFocused(false); Keyboard.dismiss();
    mapRef.current?.animateToRegion(boundsOf(a.coordinates), 600);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          initialRegion={INITIAL}
          mapType={mapType}
          userInterfaceStyle="dark"
          showsPointsOfInterest={false}
          showsCompass={false}
          toolbarEnabled={false}
          onRegionChangeComplete={onRegionChange}
          onPress={() => { setTapped(null); setSelectedId(null); }}
        >
          {visibleAirspaces.map((a) => {
            const color = colorForType(a.type);
            const sel = a.id === selectedId;
            return (
              <Polygon
                key={a.id}
                coordinates={a.coordinates}
                holes={a.holes.length ? a.holes : undefined}
                strokeColor={color}
                strokeWidth={sel ? 3 : 1.6}
                fillColor={withAlpha(color, sel ? '44' : '22')}
                tappable
                onPress={() => { setTapped(a); setSelectedId(a.id); }}
                zIndex={sel ? 20 : a.type === 1 ? 10 : 1}
              />
            );
          })}
        </MapView>

        {/* ── Header: stäng · titel · karta/satellit ── */}
        <View style={[styles.header, { top: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Ionicons name="close" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.titlePill}>
            <Ionicons name="layers-outline" size={13} color={Colors.primary} />
            <Text style={styles.titleText}>Airspace</Text>
          </View>
          <TouchableOpacity onPress={() => setMapType((m) => (m === 'standard' ? 'hybridFlyover' : 'standard'))} hitSlop={12} style={styles.iconBtn}>
            <Ionicons name={mapType === 'standard' ? 'globe' : 'map'} size={16} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* ── Sökfält (R-områden) ── */}
        {hasKey && (
          <View style={[styles.searchWrap, { top: insets.top + 56 }]}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={Colors.textSecondary} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                onFocus={() => setSearchFocused(true)}
                placeholder="Search restricted areas (R)"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => { setSearch(''); Keyboard.dismiss(); }} hitSlop={10}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {results.length > 0 && (
              <ScrollView keyboardShouldPersistTaps="handled" style={styles.results}>
                {results.map((a) => (
                  <TouchableOpacity key={a.id} style={styles.resultRow} activeOpacity={0.8} onPress={() => selectAirspace(a)}>
                    <View style={[styles.dot, { backgroundColor: colorForType(a.type) }]} />
                    <Text style={styles.resultName} numberOfLines={1}>{a.name}</Text>
                    <Text style={styles.resultLim}>{formatLimit(a.lower)}–{formatLimit(a.upper)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* ── Lager-knapp (nedre höger) ── */}
        {hasKey && (
          <TouchableOpacity style={[styles.layersFab, { bottom: insets.bottom + 20 }]} activeOpacity={0.85} onPress={() => setShowLayers((s) => !s)}>
            <Ionicons name="layers" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
        )}

        {/* ── Lager-panel ── */}
        {hasKey && showLayers && (
          <View style={[styles.layersPanel, { bottom: insets.bottom + 76 }]}>
            <Text style={styles.panelTitle}>Layers</Text>
            {AIRSPACE_CATEGORIES.map((c) => (
              <TouchableOpacity key={c.key} style={styles.layerRow} activeOpacity={0.8} onPress={() => setEnabled((e) => ({ ...e, [c.key]: !e[c.key] }))}>
                <View style={[styles.swatch, { backgroundColor: withAlpha(c.color, '33'), borderColor: c.color }]} />
                <Text style={styles.layerLabel}>{c.label}</Text>
                <Ionicons name={enabled[c.key] ? 'checkbox' : 'square-outline'} size={18} color={enabled[c.key] ? Colors.primary : Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Info-kort för tryckt luftrum ── */}
        {tapped && (
          <View style={[styles.infoCard, { bottom: insets.bottom + 76 }]}>
            <View style={[styles.dot, { backgroundColor: colorForType(tapped.type), width: 10, height: 10, borderRadius: 5 }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoName} numberOfLines={2}>{tapped.name}</Text>
              <Text style={styles.infoLim}>{formatLimit(tapped.lower)} – {formatLimit(tapped.upper)}</Text>
            </View>
            <TouchableOpacity onPress={() => { setTapped(null); setSelectedId(null); }} hitSlop={10}>
              <Ionicons name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Status: laddar / zooma in ── */}
        {hasKey && (loading || tooZoomedOut) && (
          <View style={[styles.status, { top: insets.top + 104 }]}>
            {loading
              ? <><ActivityIndicator size="small" color={Colors.primary} /><Text style={styles.statusText}>Loading airspace…</Text></>
              : <><Ionicons name="search" size={13} color={Colors.textSecondary} /><Text style={styles.statusText}>Zoom in to load airspace</Text></>}
          </View>
        )}

        {/* ── Attribution ── */}
        <View style={[styles.attrib, { bottom: insets.bottom + 74 }]}>
          <Text style={styles.attribText}>Data © openAIP · CC BY-NC-SA</Text>
        </View>

        {/* ── Saknad nyckel ── */}
        {!hasKey && (
          <View style={styles.keyBanner}>
            <Ionicons name="key-outline" size={22} color={Colors.warning} />
            <Text style={styles.keyTitle}>OpenAIP API key needed</Text>
            <Text style={styles.keyBody}>Add a free key to EXPO_PUBLIC_OPENAIP_API_KEY in .env, then rebuild.</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surface + 'E6', borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  titlePill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.surface + 'E6', borderWidth: 1, borderColor: Colors.primary + '55' },
  titleText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '700' },

  searchWrap: { position: 'absolute', left: 12, right: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 10, backgroundColor: Colors.surface + 'F2', borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '600', padding: 0 },
  results: { marginTop: 6, maxHeight: 260, borderRadius: 10, backgroundColor: Colors.surface + 'F7', borderWidth: 1, borderColor: Colors.border },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  resultName: { flex: 1, color: Colors.textPrimary, fontSize: 12.5, fontWeight: '600' },
  resultLim: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4 },

  layersFab: { position: 'absolute', right: 14, width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  layersPanel: { position: 'absolute', bottom: 76, right: 14, left: 14, padding: 12, borderRadius: 14, backgroundColor: Colors.surface + 'F7', borderWidth: 1, borderColor: Colors.border, gap: 2 },
  panelTitle: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800', marginBottom: 6 },
  layerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  swatch: { width: 20, height: 14, borderRadius: 4, borderWidth: 1.5 },
  layerLabel: { flex: 1, color: Colors.textPrimary, fontSize: 12.5, fontWeight: '600' },

  infoCard: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: Colors.surface + 'F2', borderWidth: 1, borderColor: Colors.border },
  infoName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  infoLim: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },

  status: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surface + 'E6', borderWidth: 1, borderColor: Colors.border },
  statusText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' },

  attrib: { position: 'absolute', left: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.surface + 'B3' },
  attribText: { color: Colors.textSecondary, fontSize: 9.5, fontWeight: '600' },

  keyBanner: { position: 'absolute', top: '40%', left: 24, right: 24, alignItems: 'center', gap: 8, padding: 18, borderRadius: 14, backgroundColor: Colors.surface + 'F2', borderWidth: 1, borderColor: Colors.warning + '55' },
  keyTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  keyBody: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
