// Drönar-dashboard — layout A (editorial stack), navy bas + trådbar accent.
// Hero total-tid → kategori-mix (donut) → flygmoder → kartkort → senaste flygningar.
// (Kartkortet är en preview i Fas 1; native-kartan kopplas in i Fas 2.)

import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { DR, accentSoft, accentLine } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { listDrones, type DroneFlight } from '../../db/drones';
import { decimalToHHMM, decimalToMMSS } from '../../hooks/useTimeFormat';
import { useTranslation } from '../../hooks/useTranslation';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';

const CAT_COLORS: Record<string, string> = {
  Specific: '#FF8C42', A2: '#FFC857', A3: '#7FA8C8', A1: '#5A7FA0', Certified: '#A855F7',
};
const CAT_ORDER = ['Specific', 'A2', 'A3', 'A1', 'Certified'];
const CAT_FALLBACK = ['#5A7FA0', '#7FA8C8', '#A8BFD6', '#FFC857', '#A855F7'];
const MODE_ORDER: ('VLOS' | 'EVLOS' | 'BVLOS')[] = ['VLOS', 'EVLOS', 'BVLOS'];

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

export default function DroneDashboardScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, stats, loadFlights, loadStats } = useDroneFlightStore();
  const [droneCount, setDroneCount] = useState(0);

  useFocusEffect(useCallback(() => {
    loadAccent();
    loadFlights();
    loadStats();
    listDrones().then((d) => setDroneCount(d.length)).catch(() => {});
  }, [loadAccent, loadFlights, loadStats]));

  const droneById = useMemo(() => {
    // Visningsetikett per flygning (registrering › modell › fri text).
    return (f: DroneFlight) => f.registration || f.drone_type || '—';
  }, []);

  // ── Aggregat ur flights ──
  const last30Decimal = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cut = cutoff.toISOString().slice(0, 10);
    return flights.filter((f) => f.date >= cut).reduce((s, f) => s + (f.total_time || 0), 0);
  }, [flights]);

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of flights) { const k = f.category || '—'; counts[k] = (counts[k] || 0) + 1; }
    const keys = Object.keys(counts).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    let fb = 0;
    return keys.map((k) => ({ key: k, count: counts[k], color: CAT_COLORS[k] || CAT_FALLBACK[fb++ % CAT_FALLBACK.length] }));
  }, [flights]);

  const modes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of flights) { const k = f.flight_mode || 'VLOS'; counts[k] = (counts[k] || 0) + 1; }
    const total = flights.length || 1;
    return MODE_ORDER.map((k) => ({ key: k, count: counts[k] || 0, pct: Math.round(((counts[k] || 0) / total) * 100) }))
      .filter((m) => m.count > 0);
  }, [flights]);

  const siteCount = useMemo(() => {
    const set = new Set(flights.map((f) => (f.location || '').trim().toLowerCase()).filter(Boolean));
    return set.size;
  }, [flights]);

  const recent = flights.slice(0, 5);
  const totalFlights = stats?.total_flights ?? flights.length;

  // ── Tom-läge ──
  if ((stats?.total_flights ?? flights.length) === 0) {
    return (
      <View style={[s.screen, s.center, { paddingTop: insets.top }]}>
        <View style={[s.iconCircle, { backgroundColor: accentSoft(accent), borderColor: accentLine(accent) }]}>
          <Ionicons name="airplane-outline" size={30} color={accent} />
        </View>
        <Text style={s.emptyTitle}>{t('no_flights') ?? 'No drone flights yet'}</Text>
        <TouchableOpacity style={[s.cta, { backgroundColor: accent }]} onPress={() => router.push('/drone-flight/add')} activeOpacity={0.85}>
          <Ionicons name="add" size={18} color={DR.inkOnAccent} />
          <Text style={[s.ctaText, { color: DR.inkOnAccent }]}>{t('log_new_flight') ?? 'Log flight'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 10 }}>
      {/* ── Hero total-tid ── */}
      <View style={[s.card, s.heroGlow, { borderColor: accentLine(accent), shadowColor: accent }]}>
        <View style={[s.glowBlob, { backgroundColor: accentSoft(accent) }]} pointerEvents="none" />
        <View style={s.rowBetween}>
          <Text style={s.label}>TOTAL FLIGHT TIME</Text>
          <View style={[s.chip, { backgroundColor: accentSoft(accent), borderColor: accentLine(accent) }]}>
            <Ionicons name="hardware-chip-outline" size={11} color={accent} />
            <Text style={[s.chipText, { color: accent }]}>{droneCount} ACTIVE</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
          <Text style={s.heroNum}>{decimalToHHMM(stats?.total_time ?? 0)}</Text>
          <Text style={[s.heroUnit, { color: accent }]}>H:MM</Text>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 16 }}>
          {[
            { v: decimalToHHMM(stats?.year_to_date ?? 0), k: 'THIS YEAR' },
            { v: String(totalFlights), k: 'FLIGHTS' },
            { v: decimalToHHMM(last30Decimal), k: 'LAST 30 D' },
          ].map((c, i) => (
            <View key={c.k} style={{ flex: 1, paddingLeft: i ? 14 : 0, borderLeftWidth: i ? 1 : 0, borderLeftColor: DR.separator }}>
              <Text style={s.trioVal}>{c.v}</Text>
              <Text style={s.trioKey}>{c.k}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Kategori-mix ── */}
      {categories.length > 0 && (
        <View style={s.card}>
          <Text style={s.label}>CATEGORY MIX</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 }}>
            <Donut segments={categories} centerTop={String(categories.length)} centerBottom="CATS" />
            <View style={{ flex: 1, gap: 8 }}>
              {categories.map((c) => {
                const tot = categories.reduce((s2, x) => s2 + x.count, 0) || 1;
                return (
                  <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.color }} />
                    <Text style={[s.legendKey, { flex: 1 }]} numberOfLines={1}>{c.key}</Text>
                    <Text style={s.legendPct}>{Math.round((c.count / tot) * 100)}%</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {/* ── Flygmoder ── */}
      {modes.length > 0 && (
        <View style={s.card}>
          <Text style={s.label}>FLIGHT MODES</Text>
          <View style={{ gap: 13, marginTop: 12 }}>
            {modes.map((m) => (
              <View key={m.key} style={{ gap: 6 }}>
                <View style={s.rowBetween}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Ionicons name={m.key === 'BVLOS' ? 'cellular-outline' : 'eye-outline'} size={13} color={accent} />
                    <Text style={s.modeKey}>{m.key}</Text>
                    <Text style={s.modeCount}>{m.count} flt</Text>
                  </View>
                  <Text style={[s.modePct, { color: accent }]}>{m.pct}%</Text>
                </View>
                <View style={s.track}>
                  <View style={{ width: `${m.pct}%`, height: '100%', borderRadius: 99, backgroundColor: accent }} />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── Kartkort (preview; native karta i Fas 2) ── */}
      <TouchableOpacity style={[s.card, { padding: 0, overflow: 'hidden' }]} onPress={() => router.push('/drone-map')} activeOpacity={0.85}>
        <View style={{ height: 120, backgroundColor: DR.bgDeep, justifyContent: 'flex-end' }}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: accentSoft(accent), opacity: 0.5 }]} pointerEvents="none" />
          <View style={{ position: 'absolute', top: 10, left: 12 }}>
            <View style={[s.chip, { backgroundColor: accentSoft(accent), borderColor: accentLine(accent) }]}>
              <Ionicons name="location-outline" size={11} color={accent} />
              <Text style={[s.chipText, { color: accent }]}>{siteCount} SITES</Text>
            </View>
          </View>
          <View style={{ padding: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <Text style={s.mapTitle}>Where you've flown</Text>
              <Text style={s.mapSub}>GPS PER FLIGHT</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={DR.text3} />
          </View>
        </View>
      </TouchableOpacity>

      {/* ── Senaste flygningar ── */}
      <View style={{ marginTop: 4 }}>
        <View style={[s.rowBetween, { marginBottom: 10 }]}>
          <Text style={s.label}>RECENT FLIGHTS</Text>
          <TouchableOpacity onPress={() => router.push('/drone-log')} activeOpacity={0.7}>
            <Text style={[s.allLink, { color: accent }]}>ALL →</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
          {recent.map((f, i) => (
            <TouchableOpacity
              key={f.id}
              activeOpacity={0.7}
              onPress={() => router.push(`/drone-flight/${f.id}`)}
              style={[s.recentRow, i ? { borderTopWidth: 1, borderTopColor: DR.separator } : null]}
            >
              <View style={[s.recentIcon, { backgroundColor: DR.elevated }]}>
                <Ionicons name={missionIcon(f.mission_type)} size={17} color={accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={s.recentMission}>{f.mission_type || 'Flight'}</Text>
                  <View style={[s.miniChip, f.flight_mode === 'BVLOS'
                    ? { backgroundColor: 'rgba(255,200,87,0.12)', borderColor: 'rgba(255,200,87,0.4)' }
                    : { backgroundColor: 'rgba(127,168,200,0.08)', borderColor: DR.border }]}>
                    <Text style={[s.miniChipText, { color: f.flight_mode === 'BVLOS' ? DR.warning : DR.text3 }]}>{f.flight_mode}</Text>
                  </View>
                </View>
                <Text style={s.recentMeta} numberOfLines={1}>{droneById(f)} · {f.location || '—'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.recentTime}>{decimalToMMSS(f.total_time || 0)}</Text>
                <Text style={s.recentDate}>{relDate(f.date)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function Donut({ segments, centerTop, centerBottom }: { segments: { key: string; count: number; color: string }[]; centerTop: string; centerBottom: string }) {
  const size = 116, stroke = 13;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s2, x) => s2 + x.count, 0) || 1;
  let offset = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={DR.separator} strokeWidth={stroke} />
        {segments.map((seg) => {
          const dash = circ * (seg.count / total);
          const el = (
            <Circle
              key={seg.key}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={seg.color} strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontFamily: SERIF, fontSize: 26, fontWeight: '500', color: DR.text }}>{centerTop}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, color: DR.muted, marginTop: 3 }}>{centerBottom}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  iconCircle: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyTitle: { color: DR.text, fontSize: 18, fontWeight: '800' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 22 },
  ctaText: { fontSize: 15, fontWeight: '800' },

  card: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 16, padding: 16, position: 'relative' },
  heroGlow: { overflow: 'hidden', shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 14 } },
  glowBlob: { position: 'absolute', top: -50, right: -30, width: 180, height: 180, borderRadius: 90 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.8, color: DR.text3 },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },

  heroNum: { fontFamily: SERIF, fontSize: 56, fontWeight: '500', letterSpacing: -1.5, color: DR.text, fontVariant: ['tabular-nums'] },
  heroUnit: { fontFamily: MONO, fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  trioVal: { fontFamily: MONO, fontSize: 16, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },
  trioKey: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: DR.muted, marginTop: 3 },

  legendKey: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: DR.text2 },
  legendPct: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },

  modeKey: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4, color: DR.text },
  modeCount: { fontSize: 11, color: DR.muted },
  modePct: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  track: { height: 5, borderRadius: 99, backgroundColor: DR.separator, overflow: 'hidden' },

  mapTitle: { fontFamily: SERIF, fontSize: 15, fontWeight: '500', color: DR.text },
  mapSub: { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: DR.muted, marginTop: 2 },

  allLink: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  recentIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  recentMission: { fontSize: 13.5, fontWeight: '600', color: DR.text },
  miniChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  miniChipText: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  recentMeta: { fontFamily: MONO, fontSize: 10, color: DR.text3, marginTop: 2 },
  recentTime: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },
  recentDate: { fontFamily: MONO, fontSize: 9, color: DR.muted, marginTop: 2 },
});
