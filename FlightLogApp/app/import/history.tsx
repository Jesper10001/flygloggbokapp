// "Imported data" — översikt över pilotens importbatcher (CSV / OCR-skanning / manuell
// erfarenhetslogg): när, hur, kategoriserad tid + antal flygplatser (expanderbar med flaggor).
// Går att radera en HEL import (inte enskilda datapunkter) om t.ex. en skanning blev fel.
import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { CountryFlag } from '../../components/CountryFlag';
import { BackfillMissingHours } from '../../components/import/BackfillMissingHours';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { getFlights, deleteFlights } from '../../db/flights';
import { getAirportByIcao } from '../../db/icao';
import { useFlightStore } from '../../store/flightStore';
import type { Flight } from '../../types/flight';

type Method = 'manual' | 'ocr' | 'csv';
type Batch = {
  key: string; method: Method; when: string; count: number; ids: number[];
  cats: Record<string, number>; icaos: string[]; aircraft: string[]; pilots: string[];
};

const META: Record<Method, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  manual: { label: 'Manual log', icon: 'create-outline' },
  ocr: { label: 'OCR scan', icon: 'camera-outline' },
  csv: { label: 'CSV import', icon: 'document-attach-outline' },
};

// Tidskategorier som summeras per import (visas bara om > 0, förutom Total).
const CATS: { key: keyof Flight; label: string }[] = [
  { key: 'total_time', label: 'Total' },
  { key: 'pic', label: 'PIC' },
  { key: 'co_pilot', label: 'Co-pilot' },
  { key: 'dual', label: 'Dual' },
  { key: 'instructor', label: 'Instructor' },
  { key: 'ifr', label: 'IFR' },
  { key: 'night', label: 'Night' },
];

function methodOf(f: Flight): Method {
  if ((f as any).flight_type === 'summary') return 'manual';
  if (f.source === 'ocr') return 'ocr';
  return 'csv';
}

function fmtWhen(iso: string): string {
  const d = new Date((iso || '').replace(' ', 'T') + 'Z'); // created_at = datetime('now') (UTC)
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ImportedDataScreen() {
  const insets = useSafeAreaInsets();
  const { formatTime } = useTimeFormat();
  const { loadFlights, loadStats } = useFlightStore();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [allFlights, setAllFlights] = useState<Flight[]>([]);
  const [openAirports, setOpenAirports] = useState<Set<string>>(new Set());
  const [openAircraft, setOpenAircraft] = useState<Set<string>>(new Set());
  const [openPilots, setOpenPilots] = useState<Set<string>>(new Set());
  const [airportMeta, setAirportMeta] = useState<Record<string, { name: string; country: string; known: boolean }>>({});
  const toggleKey = (setter: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    setter((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const load = useCallback(() => {
    getFlights(100000).then((all) => {
      setAllFlights(all);
      const imported = all.filter((f) => f.source !== 'manual'); // allt som inte loggats i appen
      const map = new Map<string, Batch>();
      for (const f of imported) {
        const method = methodOf(f);
        const minute = (f.created_at || '').slice(0, 16); // gruppera per import-tillfälle (till minuten)
        const key = `${method}|${minute}`;
        let b = map.get(key);
        if (!b) { b = { key, method, when: f.created_at || '', count: 0, ids: [], cats: {}, icaos: [], aircraft: [], pilots: [] }; map.set(key, b); }
        b.count++;
        b.ids.push(f.id);
        for (const c of CATS) b.cats[c.key as string] = (b.cats[c.key as string] || 0) + (Number((f as any)[c.key]) || 0);
        for (const p of [f.dep_place, f.arr_place]) if (p && !b.icaos.includes(p)) b.icaos.push(p);
        const at = (f.aircraft_type || '').trim(); if (at && !b.aircraft.includes(at)) b.aircraft.push(at);
        const sp = (f.second_pilot || '').trim(); if (sp && !b.pilots.includes(sp)) b.pilots.push(sp);
        if ((f.created_at || '') < b.when) b.when = f.created_at || '';
      }
      setBatches([...map.values()].sort((a, b) => (a.when < b.when ? 1 : -1))); // nyast först
    });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleAirports = (b: Batch) => {
    setOpenAirports((prev) => {
      const next = new Set(prev);
      if (next.has(b.key)) { next.delete(b.key); return next; }
      next.add(b.key);
      // Resolva namn + land för denna batchs flygplatser (endast de som saknas).
      const missing = b.icaos.filter((ic) => !airportMeta[ic]);
      if (missing.length) {
        Promise.all(missing.map((ic) => getAirportByIcao(ic))).then((rows) => {
          setAirportMeta((m) => {
            const merged = { ...m };
            // known = finns i databasen som riktig flygplats (ej temporary/off-airport, ej okänd ICAO)
            missing.forEach((ic, i) => { const r = rows[i]; merged[ic] = { name: r?.name || ic, country: r?.country || '', known: !!r && !r.temporary }; });
            return merged;
          });
        }).catch(() => {});
      }
      return next;
    });
  };

  const removeBatch = (b: Batch) => {
    Alert.alert(
      'Delete import',
      `Remove this ${META[b.method].label} import (${b.count} ${b.count === 1 ? 'flight' : 'flights'})? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteFlights(b.ids);
          await Promise.all([loadFlights(), loadStats()]);
          load();
        } },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 10 }}>
        {/* Backfill missing hours — hit leds piloten om timmarna inte stämmer. */}
        <BackfillMissingHours flights={allFlights} onSaved={load} />

        <Text style={{ color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 4 }}>
          Every batch of data you brought in — CSV import, OCR scan or a manual experience log. Delete a whole import if it was wrong.
        </Text>

        {batches === null ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : batches.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 50, gap: 10 }}>
            <Ionicons name="file-tray-outline" size={44} color={Colors.textMuted} />
            <Text style={{ color: Colors.textMuted, fontSize: 13 }}>No imported data yet</Text>
          </View>
        ) : batches.map((b) => {
          const open = openAirports.has(b.key);
          const openAc = openAircraft.has(b.key);
          const openPl = openPilots.has(b.key);
          return (
            <View key={b.key} style={{ backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' }}>
              {/* Header: metod · när · radera */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={META[b.method].icon} size={18} color={Colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>{META[b.method].label}</Text>
                  <Text style={{ color: Colors.textMuted, fontSize: 11.5, marginTop: 2 }}>{fmtWhen(b.when)} · {b.count} {b.count === 1 ? 'flight' : 'flights'}</Text>
                </View>
                <TouchableOpacity onPress={() => removeBatch(b)} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>

              {/* Kategoriserad tid (rader, bara > 0 utom Total) */}
              <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
                {CATS.filter((c) => c.key === 'total_time' || (b.cats[c.key as string] || 0) > 0).map((c) => (
                  <View key={c.key as string} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ color: Colors.textSecondary, fontSize: 13 }}>{c.label}</Text>
                    <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{formatTime(b.cats[c.key as string] || 0)}</Text>
                  </View>
                ))}
              </View>

              {/* Flygplatser (längst ner) — expanderbar rad med flaggor */}
              <TouchableOpacity onPress={() => toggleAirports(b)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Ionicons name="location-outline" size={15} color={Colors.primary} />
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>Airports</Text>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{b.icaos.length}</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
              </TouchableOpacity>
              {open && (() => {
                const resolved = b.icaos.every((ic) => airportMeta[ic]);
                if (!resolved) return (
                  <View style={{ paddingVertical: 16 }}><ActivityIndicator color={Colors.primary} /></View>
                );
                const known = b.icaos.filter((ic) => airportMeta[ic].known);
                const unknown = b.icaos.filter((ic) => !airportMeta[ic].known);
                const row = (ic: string) => {
                  const meta = airportMeta[ic];
                  return (
                    <View key={ic} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {meta.known
                        ? <CountryFlag code={meta.country} height={14} />
                        : <View style={{ width: Math.round((14 * 4) / 3), height: 14, borderRadius: 2, backgroundColor: Colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="help" size={10} color={Colors.textMuted} />
                          </View>}
                      <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo', width: 52 }}>{ic}</Text>
                      <Text numberOfLines={1} style={{ flex: 1, color: Colors.textMuted, fontSize: 12 }}>{meta.name === ic ? '' : meta.name}</Text>
                    </View>
                  );
                };
                return (
                  <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                    {known.map(row)}
                    {unknown.length > 0 && (
                      <>
                        {known.length > 0 && <View style={{ height: 1, backgroundColor: Colors.separator, marginVertical: 2 }} />}
                        <Text style={{ color: Colors.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Off-airport & unknown</Text>
                        {unknown.map(row)}
                      </>
                    )}
                  </View>
                );
              })()}

              {/* Flygfarkostmodeller (enbart namn) — expanderbar */}
              <TouchableOpacity onPress={() => toggleKey(setOpenAircraft, b.key)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Ionicons name="airplane-outline" size={15} color={Colors.primary} />
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>Aircraft</Text>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{b.aircraft.length}</Text>
                <Ionicons name={openAc ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
              </TouchableOpacity>
              {openAc && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {b.aircraft.length === 0
                    ? <Text style={{ color: Colors.textMuted, fontSize: 12 }}>None</Text>
                    : b.aircraft.map((a) => (
                      <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="airplane" size={13} color={Colors.textMuted} />
                        <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{a}</Text>
                      </View>
                    ))}
                </View>
              )}

              {/* Second pilots (namn) — expanderbar */}
              <TouchableOpacity onPress={() => toggleKey(setOpenPilots, b.key)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: Colors.separator }}>
                <Ionicons name="people-outline" size={15} color={Colors.primary} />
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>Second pilots</Text>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{b.pilots.length}</Text>
                <Ionicons name={openPl ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
              </TouchableOpacity>
              {openPl && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {b.pilots.length === 0
                    ? <Text style={{ color: Colors.textMuted, fontSize: 12 }}>None</Text>
                    : b.pilots.map((p) => (
                      <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="person" size={13} color={Colors.textMuted} />
                        <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13 }}>{p}</Text>
                      </View>
                    ))}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
