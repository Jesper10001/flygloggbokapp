// Drönar-Log — två sub-flikar: Flights (månadsgrupperat) + Fleet (drönare + batterier).
// Navy bas + trådbar accent. Per-flygning visas i MM:SS, totaler i H:MM.

import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { DR, accentSoft, accentLine } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { decimalToHHMM, decimalToMMSS } from '../../hooks/useTimeFormat';
import {
  listDrones, listBatteries, getDroneUsage,
  type DroneFlight, type DroneRegistryEntry, type DroneBattery,
} from '../../db/drones';
import { categoryLabel } from '../../constants/droneCategories';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function relDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const days = Math.round((now.setHours(0, 0, 0, 0) - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
const missionIcon = (m: string): any => {
  if (m === 'Mapping' || m === 'Survey') return 'map-outline';
  if (m === 'Film' || m === 'Photo / Video') return 'camera-outline';
  return 'git-network-outline';
};

export default function DroneLog() {
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, loadFlights } = useDroneFlightStore();
  const [tab, setTab] = useState<'flights' | 'fleet'>('flights');

  useFocusEffect(useCallback(() => { loadAccent(); loadFlights(); }, [loadAccent, loadFlights]));

  return (
    <View style={s.container}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={s.screenTitle}>Log</Text>
        <View style={s.subTabs}>
          {(['flights', 'fleet'] as const).map((k) => (
            <TouchableOpacity
              key={k}
              style={[s.subTab, tab === k && { backgroundColor: accent }]}
              onPress={() => setTab(k)}
              activeOpacity={0.8}
            >
              <Text style={[s.subTabText, { color: tab === k ? DR.inkOnAccent : DR.text3 }]}>
                {k === 'flights' ? 'Flights' : 'Fleet'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'flights'
        ? <FlightsTab flights={flights} accent={accent} onOpen={(id) => router.push(`/drone-flight/${id}`)} />
        : <FleetTab accent={accent} onManage={() => router.push('/settings/drones')} />}
    </View>
  );
}

function FlightsTab({ flights, accent, onOpen }: {
  flights: DroneFlight[]; accent: string; onOpen: (id: number) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flights;
    return flights.filter((f) =>
      (f.location ?? '').toLowerCase().includes(q) ||
      (f.drone_type ?? '').toLowerCase().includes(q) ||
      (f.registration ?? '').toLowerCase().includes(q) ||
      (f.mission_type ?? '').toLowerCase().includes(q) ||
      (f.category ?? '').toLowerCase().includes(q) ||
      (f.flight_mode ?? '').toLowerCase().includes(q));
  }, [flights, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; flights: DroneFlight[] }>();
    for (const f of filtered) {
      const p = f.date?.split('-'); if (!p || p.length < 2) continue;
      const key = `${p[0]}-${p[1]}`;
      if (!map.has(key)) map.set(key, { title: `${MONTHS[parseInt(p[1]) - 1]} ${p[0]}`, flights: [] });
      map.get(key)!.flights.push(f);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, v]) => ({ key, ...v }));
  }, [filtered]);

  const totalTime = useMemo(() => flights.reduce((s2, f) => s2 + (f.total_time || 0), 0), [flights]);
  const last30 = useMemo(() => {
    const c = new Date(); c.setDate(c.getDate() - 30); const cut = c.toISOString().slice(0, 10);
    return flights.filter((f) => f.date >= cut).length;
  }, [flights]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 100, gap: 16 }} keyboardShouldPersistTaps="handled">
        {/* Summering */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { v: String(flights.length), k: 'TOTAL FLIGHTS', acc: true },
            { v: decimalToHHMM(totalTime), k: 'TOTAL TIME', acc: false },
            { v: String(last30), k: 'LAST 30 D', acc: false },
          ].map((t2) => (
            <View key={t2.k} style={[s.card, { flex: 1, padding: 12 }]}>
              <Text style={[s.trioVal, t2.acc && { color: accent }]}>{t2.v}</Text>
              <Text style={s.trioKey}>{t2.k}</Text>
            </View>
          ))}
        </View>

        {flights.length > 0 && (
          <View style={s.searchRow}>
            <Ionicons name="search" size={15} color={DR.muted} />
            <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search flights" placeholderTextColor={DR.muted} />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={DR.muted} /></TouchableOpacity>
            )}
          </View>
        )}

        {groups.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="hardware-chip-outline" size={44} color={DR.muted} />
            <Text style={s.emptyText}>No drone flights yet</Text>
          </View>
        ) : groups.map((g) => (
          <View key={g.key} style={{ gap: 8 }}>
            <Text style={s.label}>{g.title.toUpperCase()}</Text>
            <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
              {g.flights.map((f, i) => (
                <TouchableOpacity key={f.id} activeOpacity={0.7} onPress={() => onOpen(f.id)}
                  style={[s.row, i ? { borderTopWidth: 1, borderTopColor: DR.separator } : null]}>
                  <View style={[s.rowIcon, { backgroundColor: DR.elevated }]}>
                    <Ionicons name={missionIcon(f.mission_type)} size={18} color={accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.mission}>{f.mission_type || 'Flight'}</Text>
                      <Chip text={f.flight_mode} tone={f.flight_mode === 'BVLOS' ? 'warn' : 'muted'} accent={accent} />
                      {f.category ? <Chip text={categoryLabel(f.category)} tone="acc" accent={accent} /> : null}
                    </View>
                    <Text style={s.rowMeta} numberOfLines={1}>{f.registration || f.drone_type || '—'} · {f.location || '—'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.rowTime}>{decimalToMMSS(f.total_time || 0)}</Text>
                    <Text style={s.rowDate}>{relDate(f.date)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function FleetTab({ accent, onManage }: { accent: string; onManage: () => void }) {
  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [usage, setUsage] = useState<Record<number, { h: number; c: number }>>({});
  const [batteries, setBatteries] = useState<{ b: DroneBattery; droneLabel: string }[]>([]);

  useFocusEffect(useCallback(() => {
    (async () => {
      const ds = await listDrones();
      setDrones(ds);
      const u = await getDroneUsage();
      const um: Record<number, { h: number; c: number }> = {};
      for (const row of u as any[]) um[row.id] = { h: row.total_time || 0, c: row.flight_count || 0 };
      setUsage(um);
      const bats: { b: DroneBattery; droneLabel: string }[] = [];
      for (const d of ds) {
        const list = await listBatteries(d.id);
        for (const b of list) bats.push({ b, droneLabel: d.registration || d.model || `#${d.id}` });
      }
      setBatteries(bats);
    })().catch(() => {});
  }, []));

  const healthColor = (h: number) => (h >= 80 ? DR.success : h >= 50 ? DR.warning : DR.danger);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40, gap: 18 }}>
      {/* Drönare */}
      <View>
        <SectionLabel accent={accent} action="+ ADD" onAction={onManage}>DRONES · {drones.length}</SectionLabel>
        <View style={{ gap: 10 }}>
          {drones.length === 0 ? (
            <View style={s.empty}><Ionicons name="hardware-chip-outline" size={40} color={DR.muted} /><Text style={s.emptyText}>No drones yet</Text></View>
          ) : drones.map((d) => {
            const u = usage[d.id] ?? { h: 0, c: 0 };
            const batCount = batteries.filter((x) => x.b.drone_id === d.id).length;
            return (
              <TouchableOpacity key={d.id} activeOpacity={0.7} onPress={onManage} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}>
                <View style={[s.fleetIcon, { backgroundColor: DR.elevated }]}><Ionicons name="hardware-chip-outline" size={22} color={accent} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.droneTitle} numberOfLines={1}>{d.model || d.registration || '—'}</Text>
                  <Text style={s.droneMeta} numberOfLines={1}>
                    {d.registration ? `${d.registration} · ` : ''}{u.c} flt · {decimalToHHMM(u.h)} h{batCount ? ` · ${batCount} batt` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={DR.muted} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Batterier */}
      <View>
        <SectionLabel accent={accent} action="+ ADD" onAction={onManage}>BATTERIES · {batteries.length}</SectionLabel>
        {batteries.length === 0 ? (
          <View style={s.empty}><Ionicons name="battery-half-outline" size={36} color={DR.muted} /><Text style={s.emptyText}>No batteries yet</Text></View>
        ) : (
          <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
            {batteries.map(({ b, droneLabel }, i) => (
              <View key={b.id} style={[s.batRow, i ? { borderTopWidth: 1, borderTopColor: DR.separator } : null]}>
                <Ionicons name="battery-half-outline" size={20} color={DR.text3} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.batLabel} numberOfLines={1}>{b.label || b.serial || `#${b.id}`}</Text>
                  <Text style={s.batMeta} numberOfLines={1}>{droneLabel} · {b.cycle_count} cycles</Text>
                </View>
                <View style={{ width: 96 }}>
                  <View style={{ alignItems: 'flex-end', marginBottom: 5 }}>
                    <View style={[s.cycChip, { borderColor: healthColor(b.health) + '66', backgroundColor: healthColor(b.health) + '1F' }]}>
                      <Text style={[s.cycChipText, { color: healthColor(b.health) }]}>{b.health}%</Text>
                    </View>
                  </View>
                  <View style={s.track}>
                    <View style={{ width: `${Math.max(0, Math.min(100, b.health))}%`, height: '100%', borderRadius: 99, backgroundColor: healthColor(b.health) }} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Chip({ text, tone, accent }: { text: string; tone: 'acc' | 'warn' | 'muted'; accent: string }) {
  const c = tone === 'acc' ? accent : tone === 'warn' ? DR.warning : DR.text3;
  const bg = tone === 'acc' ? accentSoft(accent) : tone === 'warn' ? 'rgba(255,200,87,0.12)' : 'rgba(127,168,200,0.08)';
  const bd = tone === 'acc' ? accentLine(accent) : tone === 'warn' ? 'rgba(255,200,87,0.4)' : DR.border;
  return (
    <View style={[s.chip, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[s.chipText, { color: c }]}>{text}</Text>
    </View>
  );
}

function SectionLabel({ children, accent, action, onAction }: { children: React.ReactNode; accent: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
      <Text style={s.label}>{children}</Text>
      {action ? <TouchableOpacity onPress={onAction} hitSlop={8}><Text style={[s.action, { color: accent }]}>{action}</Text></TouchableOpacity> : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DR.background },
  screenTitle: { fontFamily: SERIF, fontSize: 26, fontWeight: '500', letterSpacing: -0.5, color: DR.text, marginBottom: 14 },

  subTabs: { flexDirection: 'row', gap: 4, backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 12, padding: 4, marginBottom: 4 },
  subTab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  subTabText: { fontSize: 13, fontWeight: '700' },

  card: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 16, padding: 16 },
  label: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.8, color: DR.text3 },
  action: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },

  trioVal: { fontFamily: MONO, fontSize: 17, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },
  trioKey: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: DR.muted, marginTop: 4 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: DR.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: DR.border },
  searchInput: { flex: 1, color: DR.text, fontSize: 14, paddingVertical: 4 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  emptyText: { color: DR.text2, fontSize: 13, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mission: { fontSize: 14, fontWeight: '600', color: DR.text },
  rowMeta: { fontFamily: MONO, fontSize: 10, color: DR.text3, marginTop: 3 },
  rowTime: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },
  rowDate: { fontFamily: MONO, fontSize: 9, color: DR.muted, marginTop: 2 },

  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  fleetIcon: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  droneTitle: { fontSize: 14, fontWeight: '600', color: DR.text },
  droneMeta: { fontFamily: MONO, fontSize: 10, color: DR.text3, marginTop: 3 },

  batRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  batLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: DR.text },
  batMeta: { fontFamily: MONO, fontSize: 9.5, color: DR.muted, marginTop: 2 },
  cycChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  cycChipText: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  track: { height: 4, borderRadius: 99, backgroundColor: DR.separator, overflow: 'hidden' },

  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
});
