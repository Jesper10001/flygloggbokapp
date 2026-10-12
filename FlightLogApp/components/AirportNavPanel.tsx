// Fristående "flyg till"-panel: bank-snippet (med användarens position inpassad) + DISTANCE / COURSE /
// FLIGHT TIME / CONSUMPTION från min position till en flygplats, med farkost-väljare. Självförsörjande —
// hämtar egen position + deklination + prestanda (senast flugna typ) så den kan droppas in var som helst.
// Används i globmenyns "Fly to XXXX" och speglar panelen i Find airport (AirportQuickSearch).
import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Colors } from '../constants/colors';
import { getLastFlownAircraftType, getAircraftPerf, getAllAircraftTypes } from '../db/flights';
import type { AirportMetar } from '../services/weather';
import { AirportRunwaySnippet } from './AirportRunwaySnippet';

// ── Geo (storcirkel) — samma matematik som AirportQuickSearch ─────────────────
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
const fmtQty = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

// Lokal magnetisk deklination via kompassen: trueHeading − magHeading. EN giltig avläsning räcker.
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

export function AirportNavPanel({ icao, lat, lon, accent, frozen = false, metar = null }: {
  icao: string;
  lat: number;
  lon: number;
  accent: string;
  frozen?: boolean;
  metar?: AirportMetar | null;
}) {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [decl, setDecl] = useState<number | null>(null);
  const [locState, setLocState] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [perf, setPerf] = useState<Perf | null>(null);
  const [courseMode, setCourseMode] = useState<'mag' | 'true'>('mag'); // tryck på COURSE växlar mag/true
  const [fuelDisp, setFuelDisp] = useState<'L' | 'kg' | 'gal'>('L');   // tryck på CONSUMPTION cyklar L/kg/gal
  const [fleetList, setFleetList] = useState<Perf[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const mounted = useRef(true);

  // Position + deklination + prestanda hämtas en gång när panelen monteras (per flygplats).
  useEffect(() => {
    mounted.current = true;
    (async () => {
      setLocState('loading');
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!mounted.current) return;
        if (status !== 'granted') { setLocState('denied'); return; }
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!mounted.current) return;
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
        setLocState('ready');
        readDeclination().then((d) => { if (mounted.current) setDecl(d); }).catch(() => {});
      } catch { if (mounted.current) setLocState('denied'); }
    })();
    (async () => {
      try {
        const type = await getLastFlownAircraftType();
        if (!type || !mounted.current) return;
        const pf = await getAircraftPerf(type);
        if (mounted.current) setPerf({ type, ...pf });
      } catch { /* utan perf visas bara avstånd + kurs */ }
    })();
    return () => { mounted.current = false; };
  }, [icao]);

  // Behåll fuel-enheten i linje med farkostens enhet (kg/h → kg, annars liter).
  useEffect(() => { if (perf) setFuelDisp(perf.fuelUnit === 'kg/h' ? 'kg' : 'L'); }, [perf]);

  // Hela flottan → byt vilken farkost beräkningen baseras på. Läses om varje gång (färska Fleet-specar).
  const openFleetPicker = async () => {
    try {
      const all = await getAllAircraftTypes();
      setFleetList(all
        .filter((a) => a.cruise_speed_kts > 0)
        .map((a) => ({ type: a.aircraft_type, cruiseKts: a.cruise_speed_kts, fuelBurn: a.fuel_burn, fuelUnit: a.fuel_burn_unit || 'l/h' })));
    } catch { /* tom lista → ingen picker */ }
    setPickerOpen(true);
  };

  // Avstånd + kurs (+ flygtid/förbrukning) från min position till flygplatsen.
  const nav = pos
    ? (() => {
        const d = distanceNM(pos.lat, pos.lon, lat, lon);
        const tb = initialBearing(pos.lat, pos.lon, lat, lon);
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

  const course = nav ? (courseMode === 'mag' && nav.magBrg != null ? { v: nav.magBrg, s: 'M' } : { v: nav.trueBrg, s: 'T' }) : null;
  const fuel = nav && nav.fuelL != null
    ? (fuelDisp === 'kg' ? { v: nav.fuelL * FUEL_DENS, u: 'kg' } : fuelDisp === 'gal' ? { v: nav.fuelL / L_PER_GAL, u: 'gal' } : { v: nav.fuelL, u: 'L' })
    : null;

  return (
    <View style={{ gap: 10 }}>
      <AirportRunwaySnippet
        icao={icao} lat={lat} lon={lon}
        windDir={metar?.windDir ?? null} windSpeed={metar?.windSpeed ?? null}
        frozen={frozen}
        userLat={pos?.lat ?? null} userLon={pos?.lon ?? null}
        fitUser
      />
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

      {/* Farkost-väljare som overlay (ingen nästlad Modal → ingen iOS-kart-frysning). */}
      {pickerOpen && (
        <Pressable onPress={() => setPickerOpen(false)} style={[StyleSheet.absoluteFill, styles.pickerOverlay]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  navCard: { backgroundColor: 'rgba(15,22,38,0.96)', borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 16, paddingVertical: 14 },
  navCol: { flex: 1, paddingRight: 6 },
  navLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  navLabel: { color: Colors.textMuted, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.4, fontFamily: 'Menlo' },
  navValue: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  navUnit: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  navCaptionRow: { flexDirection: 'row', marginTop: 10 },
  navFrom: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '600' },
  navLoading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navHint: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600', flex: 1, lineHeight: 18 },
  trueNote: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '500', marginTop: 10, lineHeight: 14 },
  pickerOverlay: { backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'center', paddingHorizontal: 16 },
  pickerSheet: { width: '100%', maxWidth: 380, alignSelf: 'center', backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 6 },
  pickerTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', paddingHorizontal: 12, paddingBottom: 8 },
  pickerEmpty: { color: Colors.textMuted, fontSize: 12.5, paddingHorizontal: 12, paddingVertical: 18, textAlign: 'center' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.separator },
  pickerType: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', fontFamily: 'Menlo', width: 72 },
  pickerSpec: { flex: 1, color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
});
