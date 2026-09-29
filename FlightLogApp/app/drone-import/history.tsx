// "Imported data" (drönare) — speglar den bemannade sidan men på drönar-flygningar. Överst
// backfill-verktyget; därunder importbatcher (CSV / bulk-historik) grupperade per import-tillfälle,
// med kategoriserad tid + platser + drönarmodeller. En hel batch kan raderas. Manuellt loggade
// flygningar (source='manual') listas inte här — de bor i loggboken/tidslinjen.
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { DroneBackfillMissingHours } from '../../components/import/DroneBackfillMissingHours';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { getDroneFlights, deleteDroneFlight, type DroneFlight } from '../../db/drones';
import { useDroneFlightStore } from '../../store/droneFlightStore';

type Method = 'summary' | 'csv';
type Batch = {
  key: string; method: Method; when: string; count: number; ids: number[];
  cats: Record<string, number>; places: string[]; drones: string[];
};

const META: Record<Method, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  summary: { label: 'Manual log', icon: 'create-outline' },
  csv: { label: 'CSV import', icon: 'document-attach-outline' },
};

const CATS: { key: string; label: string; night?: boolean; mode?: string }[] = [
  { key: 'total_time', label: 'Total' },
  { key: 'night', label: 'Night', night: true },
  { key: 'vlos', label: 'VLOS', mode: 'VLOS' },
  { key: 'bvlos', label: 'BVLOS', mode: 'BVLOS' },
];

function methodOf(f: DroneFlight): Method {
  return f.source === 'summary' ? 'summary' : 'csv';
}

function fmtWhen(iso: string): string {
  const d = new Date((iso || '').replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function DroneImportedDataScreen() {
  const insets = useSafeAreaInsets();
  const { formatTime } = useTimeFormat();
  const accent = useDroneAccentStore((s) => s.color);
  const { loadFlights, loadStats } = useDroneFlightStore();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [allFlights, setAllFlights] = useState<DroneFlight[]>([]);
  const [openPlaces, setOpenPlaces] = useState<Set<string>>(new Set());
  const [openDrones, setOpenDrones] = useState<Set<string>>(new Set());
  const toggle = (setter: (fn: (p: Set<string>) => Set<string>) => void, key: string) =>
    setter((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const load = useCallback(() => {
    getDroneFlights(100000).then((all) => {
      setAllFlights(all);
      const imported = all.filter((f) => f.source !== 'manual'); // batcher = CSV / bulk-historik
      const map = new Map<string, Batch>();
      for (const f of imported) {
        const method = methodOf(f);
        const minute = (f.created_at || '').slice(0, 16);
        const key = `${method}|${minute}`;
        let b = map.get(key);
        if (!b) { b = { key, method, when: f.created_at || '', count: 0, ids: [], cats: {}, places: [], drones: [] }; map.set(key, b); }
        b.count++;
        b.ids.push(f.id);
        const t = Number(f.total_time) || 0;
        b.cats.total_time = (b.cats.total_time || 0) + t;
        if (f.is_night) b.cats.night = (b.cats.night || 0) + t;
        if (f.flight_mode === 'VLOS') b.cats.vlos = (b.cats.vlos || 0) + t;
        if (f.flight_mode === 'BVLOS') b.cats.bvlos = (b.cats.bvlos || 0) + t;
        for (const p of [f.location, f.landing_location]) { const v = (p || '').trim(); if (v && !b.places.includes(v)) b.places.push(v); }
        const dr = (f.drone_type || '').trim(); if (dr && !b.drones.includes(dr)) b.drones.push(dr);
        if ((f.created_at || '') < b.when) b.when = f.created_at || '';
      }
      setBatches([...map.values()].sort((a, b) => (a.when < b.when ? 1 : -1)));
    });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const removeBatch = (b: Batch) => {
    Alert.alert(
      'Delete import',
      `Remove this ${META[b.method].label} import (${b.count} ${b.count === 1 ? 'flight' : 'flights'})? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          for (const id of b.ids) await deleteDroneFlight(id);
          await Promise.all([loadFlights(), loadStats()]);
          load();
        } },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: DR.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 10 }}>
        {/* Backfill missing hours — justera drönar-totaler mot din riktiga loggbok. */}
        <DroneBackfillMissingHours flights={allFlights} onSaved={load} />

        <Text style={{ color: DR.text2, fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 4 }}>
          Every batch of drone data you brought in — CSV import or a manual experience log. Delete a whole import if it was wrong.
        </Text>

        {batches === null ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : batches.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 50, gap: 10 }}>
            <Ionicons name="file-tray-outline" size={44} color={DR.faint} />
            <Text style={{ color: DR.muted, fontSize: 13 }}>No imported data yet</Text>
          </View>
        ) : batches.map((b) => {
          const openPl = openPlaces.has(b.key);
          const openDr = openDrones.has(b.key);
          return (
            <View key={b.key} style={{ backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: accent + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={META[b.method].icon} size={18} color={accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: DR.text, fontSize: 14, fontWeight: '700' }}>{META[b.method].label}</Text>
                  <Text style={{ color: DR.muted, fontSize: 11.5, marginTop: 2 }}>{fmtWhen(b.when)} · {b.count} {b.count === 1 ? 'flight' : 'flights'}</Text>
                </View>
                <TouchableOpacity onPress={() => removeBatch(b)} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={18} color={DR.danger} />
                </TouchableOpacity>
              </View>

              <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
                {CATS.filter((c) => c.key === 'total_time' || (b.cats[c.key] || 0) > 0).map((c) => (
                  <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ color: DR.text2, fontSize: 13 }}>{c.label}</Text>
                    <Text style={{ color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{formatTime(b.cats[c.key] || 0)}</Text>
                  </View>
                ))}
              </View>

              {/* Platser */}
              <TouchableOpacity onPress={() => toggle(setOpenPlaces as any, b.key)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: DR.separator }}>
                <Ionicons name="location-outline" size={15} color={accent} />
                <Text style={{ flex: 1, color: DR.text2, fontSize: 13 }}>Locations</Text>
                <Text style={{ color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{b.places.length}</Text>
                <Ionicons name={openPl ? 'chevron-up' : 'chevron-down'} size={15} color={DR.muted} />
              </TouchableOpacity>
              {openPl && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {b.places.length === 0
                    ? <Text style={{ color: DR.muted, fontSize: 12 }}>None</Text>
                    : b.places.map((p) => (
                      <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="location" size={13} color={DR.muted} />
                        <Text numberOfLines={1} style={{ flex: 1, color: DR.text, fontSize: 13 }}>{p}</Text>
                      </View>
                    ))}
                </View>
              )}

              {/* Drönare */}
              <TouchableOpacity onPress={() => toggle(setOpenDrones as any, b.key)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: DR.separator }}>
                <Ionicons name="hardware-chip-outline" size={15} color={accent} />
                <Text style={{ flex: 1, color: DR.text2, fontSize: 13 }}>Drones</Text>
                <Text style={{ color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{b.drones.length}</Text>
                <Ionicons name={openDr ? 'chevron-up' : 'chevron-down'} size={15} color={DR.muted} />
              </TouchableOpacity>
              {openDr && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
                  {b.drones.length === 0
                    ? <Text style={{ color: DR.muted, fontSize: 12 }}>None</Text>
                    : b.drones.map((d) => (
                      <View key={d} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Ionicons name="hardware-chip" size={13} color={DR.muted} />
                        <Text style={{ flex: 1, color: DR.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{d}</Text>
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
