// Inline flygplats-snabbsökning för globmenyn: sökrutan ÄR knappen (samma stil som övriga menyknappar),
// träffar dyker upp i en dropdown nedanför. Väljer man en → kompakt popup på dashboarden (flygplatskort +
// bank-snippet + avstånd/magnetisk kurs) — inte helskärm. Ersätter den tidigare helskärms-lookupen.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, Pressable, ScrollView, StyleSheet, Keyboard, ActivityIndicator, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors } from '../constants/colors';
import { searchAirports } from '../db/icao';
import { getLastFlownAircraftType, getAircraftPerf, getAllAircraftTypes } from '../db/flights';
import type { IcaoAirport } from '../types/flight';
import { fetchAirportMetar, type AirportMetar } from '../services/weather';
import { AirportInfoCard } from './AirportInfoCard';
import { AirportRunwaySnippet } from './AirportRunwaySnippet';

// ── Geo (storcirkel) ─────────────────────────────────────────────────────────
const R_NM = 3440.065; // jordradie i nautiska mil
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const FUEL_DENS = 0.72;     // kg/L (ungefär, Avgas) för enhetsväxling L↔kg
const L_PER_GAL = 3.785411; // US gallon

function distanceNM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(toDeg(Math.atan2(y, x)));
}
function fmtEte(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
}

// Lokal magnetisk deklination via kompassen: trueHeading − magHeading (oberoende av hur telefonen hålls).
// EN giltig avläsning räcker. null om otillgänglig → visa sann kurs (°T).
async function readDeclination(): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    let sub: Location.LocationSubscription | null = null;
    const finish = (v: number | null) => { if (settled) return; settled = true; sub?.remove(); resolve(v); };
    Location.watchHeadingAsync((h) => {
      const t = h.trueHeading, m = h.magHeading;
      if (t != null && t >= 0 && m != null && m >= 0) finish(((t - m + 540) % 360) - 180); // → [-180,180)
    }).then((s) => { sub = s; if (settled) s.remove(); }).catch(() => finish(null));
    setTimeout(() => finish(null), 3000);
  });
}

type Perf = { type: string; cruiseKts: number; fuelBurn: number; fuelUnit: string };

export function AirportQuickSearch({ accent = Colors.primary, onPick, onFocusShift }: {
  accent?: string;
  onPick?: () => void;               // anropas när en flygplats valts (t.ex. stäng globmenyn)
  onFocusShift?: (dy: number) => void; // be dashboarden flytta upp sig så sökrutan syns över tangentbordet
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcaoAirport[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<IcaoAirport | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [decl, setDecl] = useState<number | null>(null);
  const [locState, setLocState] = useState<'idle' | 'loading' | 'denied' | 'ready'>('idle');
  const [perf, setPerf] = useState<Perf | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const [kbH, setKbH] = useState(0);
  const naturalBottom = useRef(0); // sökrutans nederkant i naturligt läge (mätt vid fokus, före uppflytt)
  const [courseMode, setCourseMode] = useState<'mag' | 'true'>('mag'); // tryck på COURSE växlar
  const [fuelDisp, setFuelDisp] = useState<'L' | 'kg' | 'gal'>('L');    // tryck på CONSUMPTION cyklar
  useEffect(() => { if (perf) setFuelDisp(perf.fuelUnit === 'kg/h' ? 'kg' : 'L'); }, [perf]);
  const [metar, setMetar] = useState<AirportMetar | null>(null); // rapporteras från kortet → vind till snippeten
  const [fleetList, setFleetList] = useState<Perf[]>([]);        // fleet för att byta beräknings-farkost
  const [pickerOpen, setPickerOpen] = useState(false);

  // Följ tangentbordshöjden.
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKbH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Minimal uppflytt: flytta bara upp så mycket att sökrutan hamnar PRECIS ovanför tangentbordet (inget
  // gap under). Träfflistan öppnas uppåt (över rutan) så den inte hamnar bakom tangentbordet. MARGIN =
  // litet andrum mellan ruta och tangentbord.
  useEffect(() => {
    if (!focused) { onFocusShift?.(0); return; }
    if (kbH <= 0) return;
    const MARGIN = 10;
    const screenH = Dimensions.get('window').height;
    const overlap = naturalBottom.current + MARGIN - (screenH - kbH);
    onFocusShift?.(Math.max(0, overlap));
  }, [focused, kbH]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debouncad sökning: alla flygplatser (ICAO/IATA/namn).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try { setResults(await searchAirports(q)); } catch { setResults([]); } finally { setSearching(false); }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  // Hämta position + deklination en gång (återanvänds för alla uppslag).
  const ensureLocation = async () => {
    if (locState !== 'idle') return;
    setLocState('loading');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocState('denied'); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
      setLocState('ready');
      readDeclination().then(setDecl).catch(() => {});
    } catch { setLocState('denied'); }
  };

  // Prestanda för beräkningarna. Läses om vid VARJE uppslag så att ändringar i Fleet (t.ex. cruise)
  // slår igenom direkt — behåller användarens valda typ (annars senast flugna).
  const refreshPerf = async () => {
    try {
      const type = perf?.type ?? (await getLastFlownAircraftType());
      if (!type) return;
      const p = await getAircraftPerf(type);
      setPerf({ type, ...p });
    } catch { /* utan perf visas bara avstånd + kurs */ }
  };

  // Hela flottan → låter användaren byta vilken farkost beräkningen baseras på. Läses om varje gång
  // så väljaren visar färska specar efter Fleet-redigeringar.
  const openFleetPicker = async () => {
    try {
      const all = await getAllAircraftTypes();
      setFleetList(all
        .filter((a) => a.cruise_speed_kts > 0) // behöver cruise för att kunna räkna flygtid
        .map((a) => ({ type: a.aircraft_type, cruiseKts: a.cruise_speed_kts, fuelBurn: a.fuel_burn, fuelUnit: a.fuel_burn_unit || 'l/h' })));
    } catch { /* tom lista → ingen picker */ }
    setPickerOpen(true);
  };

  const pick = (a: IcaoAirport) => {
    Keyboard.dismiss();
    setQuery(''); setResults([]);
    setSelected(a);
    onPick?.();
    ensureLocation();
    refreshPerf();
  };

  const showDropdown = query.trim().length >= 2;

  // Avstånd + kurs (+ flygtid/förbrukning från senaste flygplanet) till vald flygplats.
  const nav = selected && pos
    ? (() => {
        const d = distanceNM(pos.lat, pos.lon, selected.lat, selected.lon);
        const tb = initialBearing(pos.lat, pos.lon, selected.lat, selected.lon);
        const magBrg = decl != null ? norm360(tb - decl) : null;
        let ete: string | null = null, fuelL: number | null = null;
        if (perf && perf.cruiseKts > 0) {
          const hours = d / perf.cruiseKts;
          ete = fmtEte(hours);
          if (perf.fuelBurn > 0) {
            const qtyNative = perf.fuelBurn * hours;
            fuelL = perf.fuelUnit === 'kg/h' ? qtyNative / FUEL_DENS : qtyNative; // normalisera till liter
          }
        }
        return { d, trueBrg: tb, magBrg, ete, fuelL };
      })()
    : null;

  // Kurs enligt toggle (mag om deklination finns, annars true). Förbrukning i vald enhet (L/kg/gal).
  const fmtQty = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const course = nav ? (courseMode === 'mag' && nav.magBrg != null ? { v: nav.magBrg, s: 'M' } : { v: nav.trueBrg, s: 'T' }) : null;
  const fuel = nav && nav.fuelL != null
    ? (fuelDisp === 'kg' ? { v: nav.fuelL * FUEL_DENS, u: 'kg' } : fuelDisp === 'gal' ? { v: nav.fuelL / L_PER_GAL, u: 'gal' } : { v: nav.fuelL, u: 'L' })
    : null;

  return (
    <View style={{ width: '100%' }}>
      {/* Sökrutan = knappen (samma mått/stil som övriga menyknappar) */}
      <View ref={rowRef} style={[styles.searchRow, { borderColor: accent + '66' }]}>
        <View style={[styles.iconBox, { backgroundColor: accent + '22' }]}>
          <Ionicons name="search" size={18} color={accent} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Find airport — ICAO / IATA"
          placeholderTextColor="rgba(255,255,255,0.5)"
          style={styles.input}
          onFocus={() => {
            // Mät sökrutans NATURLIGA nederkant (uppflytt är 0 vid fokus) → effekten räknar minimal uppflytt.
            rowRef.current?.measureInWindow((_x, y, _w, h) => { naturalBottom.current = y + h; setFocused(true); });
          }}
          onBlur={() => setFocused(false)}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); Keyboard.dismiss(); }} hitSlop={10}>
            <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        )}
      </View>

      {/* Dropdown med träffar (flyter under sökrutan, påverkar inte layouten) */}
      {showDropdown && (
        <View style={styles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 234 }}>
            {results.length ? results.map((a) => (
              <TouchableOpacity key={a.icao} activeOpacity={0.7} style={styles.row} onPress={() => pick(a)}>
                <Text style={styles.rowIcao}>{a.icao}</Text>
                <View style={styles.rowMid}>
                  <Text style={styles.rowName} numberOfLines={1}>{a.name}</Text>
                  {(a.municipality || a.country) ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{[a.municipality, a.country].filter(Boolean).join(', ')}</Text>
                  ) : null}
                </View>
                {a.iata ? <Text style={styles.rowIata}>{a.iata}</Text> : null}
              </TouchableOpacity>
            )) : (
              <View style={styles.dropEmpty}>
                {searching ? <ActivityIndicator color={accent} /> : <Text style={styles.dropEmptyTxt}>No airports found</Text>}
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* Kompakt popup på dashboarden: kort + bank-snippet + avstånd/kurs (ej helskärm) */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => (pickerOpen ? setPickerOpen(false) : setSelected(null))}>
        <Pressable
          onPress={() => setSelected(null)}
          style={[styles.backdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
        >
          {selected && (
            <Pressable onPress={() => {}} style={styles.popup}>
              <AirportInfoCard
                icao={selected.icao}
                name={selected.name}
                iata={selected.iata || undefined}
                alt={selected.alt}
                type={selected.type}
                accent={accent}
                onClose={() => setSelected(null)}
                onMetar={setMetar}
                freqStats
              />
              <AirportRunwaySnippet icao={selected.icao} lat={selected.lat} lon={selected.lon} windDir={metar?.windDir ?? null} windSpeed={metar?.windSpeed ?? null} />
              <View style={styles.navCard}>
                {locState === 'denied' ? (
                  <Text style={styles.navHint}>Enable location access to see distance & course from your position.</Text>
                ) : !pos ? (
                  <View style={styles.navLoading}>
                    <ActivityIndicator color={accent} />
                    <Text style={styles.navHint}>Getting your position…</Text>
                  </View>
                ) : nav ? (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={styles.navCol}>
                        <Text style={styles.navLabel}>DISTANCE</Text>
                        <Text style={styles.navValue}>{fmtQty(nav.d)}<Text style={styles.navUnit}> NM</Text></Text>
                      </View>
                      {course && (
                        <TouchableOpacity style={styles.navCol} activeOpacity={0.6} onPress={() => setCourseMode((m) => (m === 'mag' ? 'true' : 'mag'))}>
                          <View style={styles.navLabelRow}>
                            <Text style={styles.navLabel}>COURSE</Text>
                            <Ionicons name="swap-horizontal" size={9} color={Colors.textMuted} />
                          </View>
                          <Text style={[styles.navValue, { color: accent }]}>{String(Math.round(course.v) % 360).padStart(3, '0')}<Text style={styles.navUnit}>°{course.s}</Text></Text>
                        </TouchableOpacity>
                      )}
                      {nav.ete && (
                        <View style={styles.navCol}>
                          <Text style={styles.navLabel}>FLIGHT TIME</Text>
                          <Text style={styles.navValue}>{nav.ete}<Text style={styles.navUnit}> h</Text></Text>
                        </View>
                      )}
                      {fuel && (
                        <TouchableOpacity style={styles.navCol} activeOpacity={0.6} onPress={() => setFuelDisp((u) => (u === 'L' ? 'kg' : u === 'kg' ? 'gal' : 'L'))}>
                          <View style={styles.navLabelRow}>
                            <Text style={styles.navLabel}>CONSUMPTION</Text>
                            <Ionicons name="swap-horizontal" size={9} color={Colors.textMuted} />
                          </View>
                          <Text style={styles.navValue}>{fmtQty(fuel.v)}<Text style={styles.navUnit}> {fuel.u}</Text></Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.navCaptionRow}>
                      <Text style={[styles.navFrom, { flex: 2 }]}>from your position</Text>
                      {perf && nav.ete ? (
                        <TouchableOpacity style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 3 }} activeOpacity={0.6} onPress={openFleetPicker}>
                          <Text style={styles.navFrom} numberOfLines={1}>based on {perf.type}</Text>
                          <Ionicons name="chevron-down" size={11} color={accent} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {nav.magBrg == null && locState === 'ready' && (
                      <Text style={styles.trueNote}>Magnetic course needs the compass — showing true (°T). Move the device in a figure-8 to calibrate.</Text>
                    )}
                  </>
                ) : null}
              </View>
            </Pressable>
          )}
        </Pressable>

        {/* Farkost-väljare som overlay INUTI samma modal (två separata Modaler visas ej ovanpå varandra på iOS). */}
        {pickerOpen && (
          <Pressable onPress={() => setPickerOpen(false)}
            style={[StyleSheet.absoluteFill, styles.pickerOverlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
            <Pressable onPress={() => {}} style={styles.pickerSheet}>
              <Text style={styles.pickerTitle}>Calculate for…</Text>
              {fleetList.length === 0 ? (
                <Text style={styles.pickerEmpty}>No aircraft with a cruise speed in your fleet.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
                  {fleetList.map((f) => {
                    const sel = perf?.type === f.type;
                    return (
                      <TouchableOpacity key={f.type} activeOpacity={0.7} style={styles.pickerRow}
                        onPress={() => { setPerf(f); setPickerOpen(false); }}>
                        <Text style={[styles.pickerType, sel && { color: accent }]}>{f.type}</Text>
                        <Text style={styles.pickerSpec}>{f.cruiseKts} kt{f.fuelBurn > 0 ? `  ·  ${f.fuelBurn} ${f.fuelUnit}` : ''}</Text>
                        {sel ? <Ionicons name="checkmark" size={16} color={accent} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14,
    backgroundColor: 'rgba(6,11,22,0.85)', borderWidth: 1,
  },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700', padding: 0 },

  dropdown: {
    // Öppnas UPPÅT (ovanför sökrutan) → hamnar inte bakom tangentbordet när rutan ligger precis ovanför det.
    position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, zIndex: 50,
    backgroundColor: 'rgba(6,11,22,0.97)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  rowIcao: { color: '#fff', fontSize: 14, fontWeight: '800', width: 48, letterSpacing: 0.4, fontFamily: 'Menlo' },
  rowMid: { flex: 1 },
  rowName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  rowSub: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '500', marginTop: 1 },
  rowIata: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  dropEmpty: { paddingVertical: 20, alignItems: 'center' },
  dropEmptyTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 12.5 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'center', paddingHorizontal: 16 },
  popup: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 10 },

  navCard: { backgroundColor: 'rgba(15,22,38,0.96)', borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 16, paddingVertical: 14 },
  navCol: { flex: 1, paddingRight: 6 },
  navLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  navLabel: { color: Colors.textMuted, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.4, fontFamily: 'Menlo' },
  navValue: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  navUnit: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  navCaptionRow: { flexDirection: 'row', marginTop: 10 },
  navFrom: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '600' },
  pickerOverlay: { backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'center', paddingHorizontal: 16 },
  pickerSheet: { width: '100%', maxWidth: 380, alignSelf: 'center', backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 6 },
  pickerTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', paddingHorizontal: 12, paddingBottom: 8 },
  pickerEmpty: { color: Colors.textMuted, fontSize: 12.5, paddingHorizontal: 12, paddingVertical: 18, textAlign: 'center' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  pickerType: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', fontFamily: 'Menlo', width: 72 },
  pickerSpec: { flex: 1, color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  navLoading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navHint: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600', flex: 1, lineHeight: 18 },
  trueNote: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '500', marginTop: 10, lineHeight: 14 },
});
