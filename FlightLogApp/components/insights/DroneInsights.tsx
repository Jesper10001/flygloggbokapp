// Drönar-Insights — VISUELL TVILLING till manned Insights (components/insights/*).
// Samma kort-chrome, enat totals-hero (HeroTotals-spegling), FONT_LED7-numeraler,
// Fraunces-sektionsrubriker, bar-geometri. Navy DR-bas + användarens accent.
// Fonter = manned insights: Fraunces (serif) · JetBrainsMono (mono) · DSEG7 (LED).
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { getCategoryRecency, type CategoryRecency, type DroneFlight } from '../../db/drones';
import { FONT_LED7, ledGlow } from '../logflight/tokens';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';

const hToHHMM = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 60 ? `${hh + 1}:00` : `${hh}:${String(mm).padStart(2, '0')}`;
};
const fmtIntH = (h: number) => String(Math.round(h)); // hela timmar för LED-hero (= manned)

const CAT_KEYS = [
  { key: 'cat_a1', label: 'A1' }, { key: 'cat_a2', label: 'A2' }, { key: 'cat_a3', label: 'A3' },
  { key: 'cat_specific', label: 'Specific' }, { key: 'cat_certified', label: 'Certified' },
] as const;
const MODE_KEYS = [
  { key: 'vlos', label: 'VLOS' }, { key: 'evlos', label: 'EVLOS' }, { key: 'bvlos', label: 'BVLOS' },
] as const;

export function DroneInsights() {
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, stats, loadFlights, loadStats } = useDroneFlightStore();
  const [recency, setRecency] = useState<CategoryRecency[]>([]);

  useFocusEffect(useCallback(() => {
    loadAccent(); loadFlights(); loadStats();
    getCategoryRecency().then(setRecency).catch(() => {});
  }, [loadAccent, loadFlights, loadStats]));

  const monthly = useMemo(() => buildMonthly(flights), [flights]);
  const topPlaces = useMemo(() => buildTopPlaces(flights), [flights]);
  const last90 = useMemo(() => {
    const c = new Date(); c.setDate(c.getDate() - 90); const cut = c.toISOString().slice(0, 10);
    return flights.filter((f) => f.date >= cut).reduce((s, f) => s + (f.total_time || 0), 0);
  }, [flights]);

  if (!stats || stats.total_flights === 0) {
    return (
      <View style={s.emptyWrap}>
        <Ionicons name="analytics-outline" size={40} color={DR.faint} />
        <Text style={s.emptyText}>No drone flights yet</Text>
        <Text style={s.emptySub}>Log a flight to see your insights build up here.</Text>
      </View>
    );
  }

  const catMax = Math.max(1, ...CAT_KEYS.map((c) => (stats as any)[c.key] || 0));
  const modeMax = Math.max(1, ...MODE_KEYS.map((m) => (stats as any)[m.key] || 0));
  const monthMax = Math.max(1, ...monthly.map((m) => m.count));

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 16 }}>
      {/* Enat totals-hero (= manned HeroTotals) — LED-numeraler */}
      <View style={s.heroCard}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, padding: 14, gap: 3 }}>
            <Text style={s.cap}>TOTAL FLIGHT TIME</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={[s.ledBig, ledGlow(DR.text, 8)]}>{hToHHMM(stats.total_time)}</Text>
              <Text style={[s.ledUnit, { color: accent }]}>h</Text>
            </View>
          </View>
          <View style={{ flex: 1, padding: 14, gap: 3, borderLeftWidth: 1, borderLeftColor: DR.separator, alignItems: 'flex-end' }}>
            <Text style={s.cap}>THIS YEAR</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={[s.ledMid, ledGlow(DR.text2, 6)]}>{hToHHMM(stats.year_to_date)}</Text>
              <Text style={[s.ledUnit, { color: DR.muted }]}>h</Text>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: DR.separator }}>
          {[
            { l: 'FLIGHTS', v: String(stats.total_flights) },
            { l: 'LAST 90 D', v: fmtIntH(last90) + 'h' },
            { l: 'NIGHT', v: fmtIntH(stats.night) + 'h' },
          ].map((c, i) => (
            <View key={c.l} style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center', gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: DR.separator }}>
              <Text style={[s.ledSmall, ledGlow(DR.text, 4)]}>{c.v}</Text>
              <Text style={s.cap8}>{c.l}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Currency — featured (accent-tonad ram, = manned LicenceJourney) */}
      {recency.length > 0 && (
        <Section accent={accent} title="Currency" icon="time-outline" hint="Days since last flight per category" featured>
          <View style={{ gap: 8 }}>
            {recency.map((r) => (
              <View key={r.category} style={s.recencyRow}>
                <View style={[s.catPill, { borderColor: accent + '55', backgroundColor: accent + '14' }]}>
                  <Text style={[s.catPillText, { color: accent }]}>{r.category}</Text>
                </View>
                <Text style={[s.recencyDays, ledGlow(DR.text2, 3)]}>{r.daysAgo === 0 ? '0' : String(r.daysAgo)}<Text style={s.recencyUnit}> {r.daysAgo === 0 ? 'today' : 'd ago'}</Text></Text>
                <View style={[s.statusDot, { backgroundColor: r.isStale ? DR.warning : DR.good }]} />
                <Text style={[s.recencyState, { color: r.isStale ? DR.warning : DR.good }]}>{r.isStale ? 'Stale' : 'Current'}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* By category */}
      <Section accent={accent} title="By category" icon="layers-outline" hint="Flight time per operational category">
        <View style={{ gap: 9 }}>
          {CAT_KEYS.filter((c) => ((stats as any)[c.key] || 0) > 0).map((c) => {
            const v = (stats as any)[c.key] || 0;
            return <BarRow key={c.key} label={c.label} value={hToHHMM(v) + 'h'} pct={v / catMax} accent={accent} />;
          })}
        </View>
      </Section>

      {/* By flight mode */}
      <Section accent={accent} title="By flight mode" icon="eye-outline">
        <View style={{ gap: 9 }}>
          {MODE_KEYS.filter((m) => ((stats as any)[m.key] || 0) > 0).map((m) => {
            const v = (stats as any)[m.key] || 0;
            return <BarRow key={m.key} label={m.label} value={hToHHMM(v) + 'h'} pct={v / modeMax} accent={accent} />;
          })}
        </View>
      </Section>

      {/* Activity */}
      <Section accent={accent} title="Activity" icon="bar-chart-outline" hint="Flights per month">
        <View style={s.chartRow}>
          {monthly.map((m, i) => (
            <View key={i} style={s.chartCol}>
              <View style={s.chartBarTrack}>
                <View style={[s.chartBar, { height: `${Math.round((m.count / monthMax) * 100)}%`, backgroundColor: m.count ? accent : DR.elevated }]} />
              </View>
              <Text style={s.chartLabel}>{m.label}</Text>
            </View>
          ))}
        </View>
      </Section>

      {/* Top locations */}
      {topPlaces.length > 0 && (
        <Section accent={accent} title="Top locations" icon="location-outline">
          <View style={{ gap: 8 }}>
            {topPlaces.map((p) => (
              <View key={p.name} style={s.placeRow}>
                <Ionicons name="location" size={14} color={accent} />
                <Text style={s.placeName} numberOfLines={1}>{p.name}</Text>
                <Text style={[s.placeCount, ledGlow(DR.text, 3)]}>{p.count}<Text style={s.placeUnit}> {p.count === 1 ? 'flight' : 'flights'}</Text></Text>
              </View>
            ))}
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

function Section({ accent, title, hint, icon, featured, children }: {
  accent: string; title: string; hint?: string; icon?: any; featured?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={[s.section, featured && { borderColor: accent + '55' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Ionicons name={icon} size={16} color={accent} /> : null}
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

function BarRow({ label, value, pct, accent }: { label: string; value: string; pct: number; accent: string }) {
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${Math.max(3, Math.round(pct * 100))}%`, backgroundColor: accent }]} />
      </View>
      <Text style={[s.barValue, ledGlow(DR.text, 3)]}>{value}</Text>
    </View>
  );
}

function buildMonthly(flights: DroneFlight[]): { label: string; count: number }[] {
  const now = new Date();
  const buckets: { label: string; count: number; key: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short' })[0],
      count: 0,
    });
  }
  const idx: Record<string, number> = {};
  buckets.forEach((b, i) => { idx[b.key] = i; });
  for (const f of flights) {
    const key = (f.date || '').slice(0, 7);
    if (key in idx) buckets[idx[key]].count++;
  }
  return buckets.map(({ label, count }) => ({ label, count }));
}

function buildTopPlaces(flights: DroneFlight[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const f of flights) {
    const name = (f.location || '').trim();
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count).slice(0, 5);
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.background },
  emptyWrap: { flex: 1, backgroundColor: DR.background, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 },
  emptyText: { color: DR.text2, fontSize: 15, fontWeight: '700', fontFamily: SERIF },
  emptySub: { color: DR.muted, fontSize: 12.5, textAlign: 'center' },

  // Hero (= manned HeroTotals): radius 16, LED-numeraler
  heroCard: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 16, overflow: 'hidden' },
  cap: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: DR.muted },
  cap8: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted },
  ledBig: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 30, color: DR.text, fontVariant: ['tabular-nums'] },
  ledMid: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22, color: DR.text2, fontVariant: ['tabular-nums'] },
  ledSmall: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 14, color: DR.text, fontVariant: ['tabular-nums'] },
  ledUnit: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },

  section: { backgroundColor: DR.surface, borderRadius: 16, borderWidth: 1, borderColor: DR.border, padding: 16 },
  sectionTitle: { color: DR.text, fontSize: 18, fontWeight: '500', fontFamily: SERIF },
  sectionHint: { fontFamily: MONO, fontSize: 9.5, color: DR.muted, marginTop: 3 },

  recencyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catPill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, minWidth: 62, alignItems: 'center' },
  catPillText: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  recencyDays: { flex: 1, color: DR.text2, fontSize: 14, fontFamily: FONT_LED7 },
  recencyUnit: { fontFamily: MONO, fontSize: 11, fontWeight: '400', color: DR.muted },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  recencyState: { fontSize: 11.5, fontWeight: '700', width: 58, textAlign: 'right' },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { color: DR.text2, fontSize: 12.5, fontWeight: '600', width: 68 },
  barTrack: { flex: 1, height: 6, borderRadius: 99, backgroundColor: DR.separator, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 99 },
  barValue: { color: DR.text, fontSize: 12, width: 58, textAlign: 'right', fontFamily: FONT_LED7 },

  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 96 },
  chartCol: { flex: 1, alignItems: 'center', gap: 5 },
  chartBarTrack: { width: '100%', height: 74, justifyContent: 'flex-end', borderRadius: 4, overflow: 'hidden' },
  chartBar: { width: '100%', borderRadius: 4, minHeight: 3 },
  chartLabel: { color: DR.muted, fontSize: 9, fontFamily: MONO },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  placeName: { flex: 1, color: DR.text, fontSize: 13.5, fontWeight: '600' },
  placeCount: { color: DR.text, fontSize: 13, fontFamily: FONT_LED7 },
  placeUnit: { fontFamily: MONO, fontSize: 11, fontWeight: '400', color: DR.text3 },
});
