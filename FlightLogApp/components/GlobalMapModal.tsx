// Global flygplatskarta som helskärmsmodal (utan header, likt Visited airports). Flytande sökruta
// upptill; flervals-filterbox (kategori → undertyper → yta) + "Properties" (banlängd-slider, yta,
// Lit) nere till vänster; land-val → region-drill DIREKT PÅ KARTAN (cyan-gränser + antal, borra ner
// tills ICAO-pins) i stället för lista; infokort i botten vid val. Öppnas från Manage airports + dashboard.
import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, StyleSheet, Keyboard } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useProfileStore, isOperator } from '../store/profileStore';
import { GlobalAirportMap, type RegionMarker } from './GlobalAirportMap';
import { AirportInfoCard } from './AirportInfoCard';
import { getSeedAirports } from '../db/icao';
import { getAirportLandingCounts, getAirportLastFlight } from '../db/flights';
import { getRunwayIndex } from '../utils/runways';
import { countryNameFull } from '../constants/countryNames';
import { COUNTRY_POPULATION, formatPopulation } from '../constants/countryPopulation';
import { CountryFlag } from './CountryFlag';
import {
  FILTER_TREE, leavesFor, activeCountUnder, keysNeedRunway, propsActive, matchProps,
  filterCountLabel, EMPTY_PROPS, type FilterNode, type MapProps,
} from '../constants/mapFilters';
import { countryRoot, buildChildren, nodeAirports, DRILL_CAP, type DrillNode } from '../utils/regionDrill';
import { neighborCountries } from '../utils/neighbors';
import { Colors } from '../constants/colors';

type SeedRow = [string, string, string, string, number, number];
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
const WORLD: Region = { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };
const MAX_LEN = 4000; // slider-tak för banlängd (m)

function fmtVisit(d?: string): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${(y || '').slice(-2)}`;
}

// Bounds-region som ramar in en uppsättning flygplatser. Robust mot antimeridian-spann (ex USA:s
// Aleuter ligger på +172° medan resten är negativt → naiv center/delta blir ogiltig och kraschar
// MapKit) och med tak på delta så animateToRegion aldrig får ogiltiga värden.
function boundsRegion(rows: SeedRow[]): Region {
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const r of rows) {
    minLa = Math.min(minLa, r[4]); maxLa = Math.max(maxLa, r[4]);
    minLo = Math.min(minLo, r[5]); maxLo = Math.max(maxLo, r[5]);
  }
  let cLon = (minLo + maxLo) / 2, dLon = (maxLo - minLo) * 1.4 + 0.3;
  if (dLon > 180) {
    // Antimeridian (ex Chukotka): veckla ut negativa lon (+360), räkna center/delta där, veckla tillbaka.
    let umin = 360, umax = -360, usum = 0;
    for (const r of rows) { const lu = r[5] < 0 ? r[5] + 360 : r[5]; umin = Math.min(umin, lu); umax = Math.max(umax, lu); usum += lu; }
    cLon = usum / rows.length; if (cLon > 180) cLon -= 360;
    dLon = (umax - umin) * 1.4 + 0.3;
  }
  return {
    latitude: (minLa + maxLa) / 2, longitude: cLon,
    latitudeDelta: Math.min(120, Math.max(0.4, (maxLa - minLa) * 1.4 + 0.3)),
    longitudeDelta: Math.min(160, Math.max(0.4, dLon)),
  };
}

export function GlobalMapModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seedData, setSeedData] = useState<SeedRow[]>([]);
  const [mapSearch, setMapSearch] = useState('');
  const [focusAirport, setFocusAirport] = useState<SeedRow | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [landingCounts, setLandingCounts] = useState<Record<string, number>>({});
  const [lastFlightMap, setLastFlightMap] = useState<Record<string, { id: number; date: string; reg: string }>>({});

  // Filter: flervals-löv (Set) + Properties. Filter-boxens nedborrning = nod-stack (filterNav).
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [mapProps, setMapProps] = useState<MapProps>(EMPTY_PROPS);
  const [filterNav, setFilterNav] = useState<FilterNode[]>([]);
  const [showProps, setShowProps] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false); // filterboxen börjar hopfälld; kvar tills man fäller ihop / lämnar

  // Region-drill på kartan (ersätter land-listan). Tom = världsvy (flaggor).
  const [drillStack, setDrillStack] = useState<DrillNode[]>([]);

  useEffect(() => {
    if (!visible || seedData.length) return;
    getSeedAirports().then((d) => setSeedData(d as SeedRow[]));
    getAirportLandingCounts().then(setLandingCounts);
    getAirportLastFlight().then(setLastFlightMap);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtrerat urval (union av aktiva löv, AND Properties) ────────────────────
  const typedSeed = useMemo(() => {
    const leaves = leavesFor(activeKeys);
    const pActive = propsActive(mapProps);
    if (!leaves.length && !pActive) return seedData;
    const idx = (pActive || keysNeedRunway(activeKeys)) ? getRunwayIndex() : null;
    return seedData.filter((r) => {
      const rwy = idx?.get(r[0]);
      if (leaves.length && !leaves.some((l) => l.match(r, rwy))) return false;
      if (pActive && !matchProps(rwy, mapProps)) return false;
      return true;
    });
  }, [seedData, activeKeys, mapProps]);

  // Remounta kartan (ny key) bara i VÄRLDSVYN när filtret ändras — då byggs flaggornas koordinater
  // om helt (native-krasch annars). Medan man är nedborrad fryses nyckeln → kartan remountar INTE
  // vid filterändring, så man stannar kvar på platsen. (Flaggor visas inte i drill-läget → ingen krasch.)
  const filterSig = useMemo(
    () => [...activeKeys].sort().join(',') + `|${mapProps.minLenM}_${mapProps.maxLenM}_${mapProps.surface}_${mapProps.lit}`,
    [activeKeys, mapProps],
  );
  // Remounta kartan bara i VÄRLDSVYN när filtret ändras (flaggornas koordinater byggs om → krasch
  // annars). Medan man är nedborrad fryses nyckeln → INGEN remount vid landval/nedborrning/filter →
  // frameRegion-effekten sköter en mjuk animateToRegion (zoom in vid landval, ut vid Back).
  const mapKeyRef = useRef(filterSig);
  if (drillStack.length === 0) mapKeyRef.current = filterSig;
  const mapKey = mapKeyRef.current;

  // ── Aktuell drill-nod → flygplatser härleds LIVE ur typedSeed (stanna kvar vid filterändring) ──
  const currentNode = drillStack.length ? drillStack[drillStack.length - 1] : null;
  const currentAirports = useMemo(() => (currentNode ? nodeAirports(currentNode, typedSeed) : []), [currentNode, typedSeed]);
  const childrenData = useMemo(
    () => (currentNode && currentAirports.length > DRILL_CAP ? buildChildren(currentNode, currentAirports) : []),
    [currentNode, currentAirports],
  );
  const isBranch = childrenData.length > 1; // >1 delnod → gren (region-markörer); annars löv (pins)
  const pins = currentNode && !isBranch ? currentAirports : undefined;
  const regionMarkers = isBranch
    ? childrenData.map((c) => ({ key: c.node.key, label: c.node.label, count: c.count, lat: c.lat, lon: c.lon }))
    : undefined;
  const hulls = isBranch ? childrenData.map((c) => c.hull).filter((h) => h.length >= 3) : undefined;
  // Ingen träff på platsen med aktuellt filter → varningsruta (försvinner vid Back / bredare filter).
  const noMatches = !!currentNode && !focusAirport && currentAirports.length === 0;
  // Rama in noden bara vid NAVIGERING (dep: currentNode) — INTE vid filterändring → kartan står still.
  const frameRegion = useMemo<Region | undefined>(() => {
    if (!currentNode) return WORLD;
    const rows = nodeAirports(currentNode, typedSeed);
    return rows.length ? boundsRegion(rows) : undefined;
  }, [currentNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Landruta. Nedborrad i en region → visa regionens namn + antal (annars landets totala).
  const country = drillStack.length ? drillStack[0].cc : null;
  const countryAirportCount = useMemo(
    () => (country ? typedSeed.filter((r) => r[2] === country).length : 0),
    [country, typedSeed],
  );
  const inRegion = drillStack.length >= 2;
  const regionLabel = inRegion ? drillStack[drillStack.length - 1].label : null;
  const boxAirportCount = inRegion ? currentAirports.length : countryAirportCount;

  // ── Klickbara grann-gränser: grannLÄNDER på landsnivå, region-SYSKON när man borrat i en region ──
  // Landets alla region-noder — behövs bara för region-syskon (regionnivå), så beräkna ej på landsnivå
  // (där bygger childrenData redan samma sak → undvik dubbel buildChildren).
  const atRegion = drillStack.length >= 2;
  const countryChildren = useMemo(() => {
    if (!country || !atRegion) return [] as ReturnType<typeof buildChildren>;
    const cAir = typedSeed.filter((r) => r[2] === country);
    return cAir.length > DRILL_CAP ? buildChildren(countryRoot(country, countryNameFull(country)), cAir) : [];
  }, [country, typedSeed, atRegion]);

  const neighbors = useMemo(() => {
    if (!currentNode || focusAirport) return { markers: undefined as RegionMarker[] | undefined, hulls: undefined as { latitude: number; longitude: number }[][] | undefined };
    let entries: { key: string; label: string; count: number; lat: number; lon: number; hull: { latitude: number; longitude: number }[] }[];
    if (currentNode.kind === 'country') {
      entries = neighborCountries(seedData, currentNode.cc, 8).map((n) => ({ key: `nbc:${n.cc}`, label: n.label, count: n.count, lat: n.lat, lon: n.lon, hull: n.hull }));
    } else {
      const regKey = drillStack.length >= 2 ? drillStack[1].key : null;
      const cur = countryChildren.find((c) => c.node.key === regKey);
      const sibs = countryChildren.filter((c) => c.node.key !== regKey);
      const ranked = cur
        ? [...sibs].sort((a, b) => ((a.lat - cur.lat) ** 2 + (a.lon - cur.lon) ** 2) - ((b.lat - cur.lat) ** 2 + (b.lon - cur.lon) ** 2))
        : sibs;
      entries = ranked.slice(0, 8).map((c) => ({ key: c.node.key, label: c.node.label, count: c.count, lat: c.lat, lon: c.lon, hull: c.hull }));
    }
    return {
      markers: entries.map(({ key, label, count, lat, lon }) => ({ key, label, count, lat, lon })),
      hulls: entries.map((e) => e.hull).filter((h) => h.length >= 3),
    };
  }, [currentNode, focusAirport, seedData, countryChildren, drillStack]);
  const neighborMarkers = neighbors.markers;
  const neighborHulls = neighbors.hulls;

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
    setDrillStack([]); setFocusAirport(null); setMapSearch('');
    setActiveKeys(new Set()); setMapProps(EMPTY_PROPS); setFilterNav([]); setShowProps(false); setFilterOpen(false); setSatellite(false);
    onClose();
  };
  // Fäll ihop → tillbaka till rotnivån (så expandering alltid öppnar på kategori-listan).
  const toggleFilterOpen = () => setFilterOpen((o) => { if (o) { setFilterNav([]); setShowProps(false); } return !o; });
  const focusByIcao = (icao: string) => {
    const r = seedData.find((x) => x[0] === icao);
    if (r) setFocusAirport(r);
  };
  // Land: exakt 1 (filtrerad) träff → direkt till flygplatsen; annars → region-drill-rot.
  const handleSelectCountry = (cc: string) => {
    const inCountry = typedSeed.filter((r) => r[2] === cc);
    if (!inCountry.length) return;
    if (inCountry.length === 1) { setFocusAirport(inCountry[0]); return; }
    setDrillStack([countryRoot(cc, countryNameFull(cc))]);
  };
  const handleSelectRegion = (key: string) => {
    const child = childrenData.find((c) => c.node.key === key);
    if (child) setDrillStack((s) => [...s, child.node]);
  };
  // Grann-gräns: land (nbc:XX) → öppna landet; annars region-syskon-nyckel → hoppa till den regionen.
  const handleSelectNeighbor = (key: string) => {
    if (key.startsWith('nbc:')) { handleSelectCountry(key.slice(4)); return; }
    const sib = countryChildren.find((c) => c.node.key === key);
    if (sib && country) setDrillStack([countryRoot(country, countryNameFull(country)), sib.node]);
  };
  const goBack = () => {
    if (focusAirport) { setFocusAirport(null); return; }
    setDrillStack((s) => s.slice(0, -1));
  };

  // ── Filter-box-hjälpare ──────────────────────────────────────────────────────
  const currentFilterNodes = filterNav.length ? filterNav[filterNav.length - 1].children ?? [] : FILTER_TREE;
  const toggleKey = (k: string) => setActiveKeys((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const clearAll = () => { setActiveKeys(new Set()); setMapProps(EMPTY_PROPS); };
  const setMinLen = (v: number) => setMapProps((p) => ({ ...p, minLenM: v > 0 ? Math.min(v, p.maxLenM ?? MAX_LEN) : null }));
  const setMaxLen = (v: number) => setMapProps((p) => ({ ...p, maxLenM: v < MAX_LEN ? Math.max(v, p.minLenM ?? 0) : null }));
  const toggleSurface = (sfc: 'asphalt' | 'grass') => setMapProps((p) => ({ ...p, surface: p.surface === sfc ? null : sfc }));

  const anyFilter = activeKeys.size > 0 || propsActive(mapProps);
  const showFilterBox = !focusAirport;
  const hideCountries = !!focusAirport || mapSearch.trim().length >= 2 || drillStack.length > 0;
  const showBack = !!focusAirport || drillStack.length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeMap}>
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {visible && (
          <GlobalAirportMap
            key={mapKey}
            airports={typedSeed}
            initialRegion={frameRegion}
            mode="country"
            onSelectCountry={handleSelectCountry}
            onSelectAirport={focusByIcao}
            onSelectRegion={handleSelectRegion}
            focus={focusAirport}
            hideCountries={hideCountries}
            mapType={satellite ? 'hybridFlyover' : 'standard'}
            pins={pins}
            regionMarkers={regionMarkers}
            hulls={hulls}
            neighborMarkers={neighborMarkers}
            neighborHulls={neighborHulls}
            onSelectNeighbor={handleSelectNeighbor}
            frameRegion={frameRegion}
            showCompass
            compassTop={insets.top + 60}
          />
        )}

        {/* Ingen träff på platsen med aktuellt filter → centrerad varning */}
        {noMatches && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={styles.noMatchBox}>
              <Ionicons name="funnel-outline" size={20} color={Colors.textSecondary} />
              <Text style={styles.noMatchTxt}>No matches according to{'\n'}filters / properties</Text>
            </View>
          </View>
        )}

        {/* Stäng — uppe till höger */}
        <TouchableOpacity onPress={closeMap} activeOpacity={0.8}
          style={{ position: 'absolute', top: insets.top + 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Tillbaka — uppe till vänster (poppar drill-nivå / rensar fokus) */}
        {showBack && (
          <TouchableOpacity onPress={goBack} activeOpacity={0.85}
            style={{ position: 'absolute', top: insets.top + 12, left: 12, zIndex: 25, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: Colors.primary + '66' }}>
            <Ionicons name="chevron-back" size={16} color={Colors.primary} />
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>Back</Text>
          </TouchableOpacity>
        )}

        {/* Landruta — mellan Back och X: flagga (SVG), landsnamn, antal flygplatser, befolkning */}
        {country && (
          <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 12, left: 96, right: 56, alignItems: 'center', zIndex: 24 }}>
            <View style={styles.countryBox}>
              <CountryFlag code={country} height={42} radius={3} />
              <View style={styles.countryInfo}>
                <Text style={styles.countryName} numberOfLines={1}>{countryNameFull(country)}</Text>
                {inRegion && <Text style={styles.countryRegion} numberOfLines={2}>{regionLabel}</Text>}
                <Text style={styles.countryStat} numberOfLines={1}>
                  {String(boxAirportCount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} {filterCountLabel(activeKeys)}
                </Text>
                {!inRegion && <Text style={styles.countryStat} numberOfLines={1}>{formatPopulation(COUNTRY_POPULATION[country])} people</Text>}
              </View>
            </View>
          </View>
        )}

        {/* Sökruta — bara i världsvyn (utan fokus) */}
        {drillStack.length === 0 && !focusAirport && (
          <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 60, pointerEvents: 'box-none' }}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search ICAO or name"
                placeholderTextColor={Colors.textMuted}
                value={mapSearch}
                onChangeText={setMapSearch}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {mapSearch.length > 0 && (
                <TouchableOpacity onPress={() => { setMapSearch(''); Keyboard.dismiss(); }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {searchResults.length > 0 && (
              <View style={[styles.searchDropdown, { marginTop: 8 }]}>
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
            )}
          </View>
        )}

        {/* Flervals-filterbox — nere till vänster */}
        {showFilterBox && (
          <View style={[styles.filterBox, filterOpen && showProps && { width: 234 }]}>
            <View style={styles.filterHeader}>
              {(filterOpen && (showProps || filterNav.length > 0)) ? (
                <TouchableOpacity onPress={() => (showProps ? setShowProps(false) : setFilterNav((s) => s.slice(0, -1)))} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                  <Ionicons name="chevron-back" size={15} color={Colors.primary} />
                  <Text style={styles.filterHeaderTxt} numberOfLines={1}>{showProps ? 'Properties' : filterNav[filterNav.length - 1].label}</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity onPress={toggleFilterOpen} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                    <Text style={styles.filterHeaderTxt}>Filters{anyFilter ? ` · ${activeKeys.size + (propsActive(mapProps) ? 1 : 0)}` : ''}</Text>
                    <Ionicons name={filterOpen ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.primary} />
                  </TouchableOpacity>
                  {anyFilter && (
                    <TouchableOpacity onPress={clearAll} activeOpacity={0.7} style={styles.clearBtn}>
                      <Ionicons name="close-circle" size={13} color={Colors.textMuted} />
                      <Text style={styles.clearBtnTxt}>Clear all</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>

            {filterOpen && (showProps ? (
              <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                <Text style={styles.propLabel}>Runway length</Text>
                <Text style={styles.propVal}>Min: {mapProps.minLenM != null ? `${mapProps.minLenM} m` : 'Any'}</Text>
                <Slider style={{ height: 30 }} minimumValue={0} maximumValue={MAX_LEN} step={100}
                  value={mapProps.minLenM ?? 0} onSlidingComplete={setMinLen}
                  minimumTrackTintColor={Colors.primary} maximumTrackTintColor="rgba(255,255,255,0.25)" thumbTintColor={Colors.primary} />
                <Text style={styles.propVal}>Max: {mapProps.maxLenM != null ? `${mapProps.maxLenM} m` : 'Any'}</Text>
                <Slider style={{ height: 30 }} minimumValue={0} maximumValue={MAX_LEN} step={100}
                  value={mapProps.maxLenM ?? MAX_LEN} onSlidingComplete={setMaxLen}
                  minimumTrackTintColor={Colors.primary} maximumTrackTintColor="rgba(255,255,255,0.25)" thumbTintColor={Colors.primary} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 }}>
                  {(['asphalt', 'grass'] as const).map((sfc) => (
                    <TouchableOpacity key={sfc} onPress={() => toggleSurface(sfc)} activeOpacity={0.7}
                      style={[styles.propPill, mapProps.surface === sfc && styles.propPillOn]}>
                      <Text style={[styles.propPillTxt, mapProps.surface === sfc && { color: Colors.primary }]}>{sfc === 'asphalt' ? 'Asphalt' : 'Grass'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={() => setMapProps((p) => ({ ...p, lit: !p.lit }))} activeOpacity={0.7} style={styles.filterRow}>
                  <Ionicons name={mapProps.lit ? 'checkbox' : 'square-outline'} size={17} color={mapProps.lit ? Colors.primary : Colors.textMuted} />
                  <Text style={styles.filterRowTxt}>Lit runway</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 6 * 34 }} showsVerticalScrollIndicator={false}>
                {currentFilterNodes.map((node) => {
                  const selectable = !!node.match;
                  const drillable = !!node.children;
                  const checked = selectable && activeKeys.has(node.key);
                  const cnt = drillable ? activeCountUnder(node, activeKeys) : 0;
                  return (
                    <View key={node.key} style={[styles.filterRow, checked && !drillable && { backgroundColor: Colors.primary + '22' }]}>
                      {selectable && (
                        <TouchableOpacity onPress={() => toggleKey(node.key)} hitSlop={6}>
                          <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={17} color={checked ? Colors.primary : Colors.textMuted} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }} activeOpacity={0.7}
                        onPress={() => (drillable ? setFilterNav((s) => [...s, node]) : toggleKey(node.key))}>
                        <Text style={styles.filterRowTxt} numberOfLines={1}>{node.label}</Text>
                        {cnt > 0 && <View style={styles.branchBadge}><Text style={styles.branchBadgeTxt}>{cnt}</Text></View>}
                        {drillable && <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />}
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {filterNav.length === 0 && (
                  <TouchableOpacity onPress={() => setShowProps(true)} activeOpacity={0.7}
                    style={[styles.filterRow, { borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.1)' }]}>
                    <Ionicons name="options-outline" size={16} color={propsActive(mapProps) ? Colors.primary : Colors.textMuted} />
                    <Text style={[styles.filterRowTxt, { flex: 1 }, propsActive(mapProps) && { color: Colors.primary }]}>Properties</Text>
                    <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </ScrollView>
            ))}
          </View>
        )}

        {/* Satellit-växel — nere till höger */}
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
          return (
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 14, zIndex: 15 }}>
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
    position: 'absolute', bottom: 24, left: 16, width: 190, zIndex: 20,
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden',
  },
  filterHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, height: 34,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  filterHeaderTxt: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 34, paddingLeft: 10, paddingRight: 10, marginRight: -10,
    borderLeftWidth: 0.5, borderLeftColor: 'rgba(255,255,255,0.1)',
  },
  clearBtnTxt: { color: Colors.textMuted, fontSize: 11.5, fontWeight: '700' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, minHeight: 34 },
  filterRowTxt: { flex: 1, color: '#fff', fontSize: 12.5, fontWeight: '600' },
  branchBadge: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  branchBadgeTxt: { color: '#062024', fontSize: 10, fontWeight: '900' },

  propLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  propVal: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 4 },
  propPill: {
    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  propPillOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  propPillTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  noMatchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(15,22,38,0.95)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 18, paddingVertical: 14, maxWidth: '82%',
  },
  noMatchTxt: { color: Colors.textSecondary, fontSize: 13.5, fontWeight: '700', lineHeight: 19 },
  countryBox: {
    flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: '100%',
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingLeft: 6, paddingRight: 14, paddingVertical: 5,
  },
  countryInfo: { alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  countryName: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 21, flexShrink: 1 },
  countryRegion: { color: Colors.primary, fontSize: 12.5, fontWeight: '700', lineHeight: 15, textAlign: 'center', flexShrink: 1 },
  countryStat: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '600', lineHeight: 13.5 },
});
