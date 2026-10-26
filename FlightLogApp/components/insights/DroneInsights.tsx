// Drönar-Insights — VISUELL TVILLING till manned Insights (components/insights/*).
// Samma kort-chrome, enat totals-hero (HeroTotals-spegling), FONT_LED7-numeraler,
// Fraunces-sektionsrubriker, bar-geometri. Navy DR-bas + användarens accent.
// Fonter = manned insights: Fraunces (serif) · JetBrainsMono (mono) · DSEG7 (LED).
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { getCategoryRecency, type CategoryRecency, type DroneFlight } from '../../db/drones';
import { FONT_LED7 } from '../logflight/tokens';
import { useTabBarSpace } from '../GlassTabBar';

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

// Info-popupen vid Currency: vad recency betyder här + EU:s operativa kategorier (förordning 2019/947).
const STALE_DAYS = 90; // = getCategoryRecency (isStale)
const CATEGORY_INFO: { code: string; title: string; text: string }[] = [
  { code: 'A1', title: 'Over people', text: 'Light drones — under 250 g, C0 or C1. Never over crowds; with C1, avoid flying over uninvolved people.' },
  { code: 'A2', title: 'Close to people', text: 'C2 drones. Keep at least 30 m from uninvolved people (5 m in low-speed mode). Requires the A2 certificate of competency.' },
  { code: 'A3', title: 'Far from people', text: 'Drones up to 25 kg (C2–C4, privately built or legacy). No uninvolved people nearby, and at least 150 m from residential, commercial, industrial or recreational areas.' },
  { code: 'Specific', title: 'Higher-risk operations', text: 'Anything outside the Open limits — e.g. BVLOS, above 120 m or heavier drones near people. Needs an operational authorisation, a declaration under a standard scenario (STS) or a LUC.' },
  { code: 'Certified', title: 'Highest risk', text: 'For example carrying people or dangerous goods. Requires a certified drone, a licensed remote pilot and an approved operator — like manned aviation.' },
];

export function DroneInsights() {
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, stats, loadFlights, loadStats } = useDroneFlightStore();
  const [recency, setRecency] = useState<CategoryRecency[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    loadAccent(); loadFlights(); loadStats();
    getCategoryRecency().then(setRecency).catch(() => {});
  }, [loadAccent, loadFlights, loadStats]));

  const monthly = useMemo(() => buildMonthly(flights), [flights]);
  const tabSpace = useTabBarSpace(); // flytande glas-flikrad täcker botten
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
  // Snitt flygningar per månad under perioden (alla 12 månader, även tomma) → streckad linje i Activity.
  const monthAvg = monthly.reduce((sum, m) => sum + m.count, 0) / Math.max(1, monthly.length);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 12, paddingBottom: tabSpace + 40, gap: 16 }}>
      {/* Enat totals-hero (= manned HeroTotals) — LED-numeraler */}
      <View style={s.heroCard}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, padding: 14, gap: 3 }}>
            <Text style={s.cap}>TOTAL FLIGHT TIME</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={s.ledBig}>{hToHHMM(stats.total_time)}</Text>
              <Text style={[s.ledUnit, { color: accent }]}>h</Text>
            </View>
          </View>
          <View style={{ flex: 1, padding: 14, gap: 3, borderLeftWidth: 1, borderLeftColor: DR.separator, alignItems: 'flex-end' }}>
            <Text style={s.cap}>THIS YEAR</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={s.ledMid}>{hToHHMM(stats.year_to_date)}</Text>
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
              <Text style={s.ledSmall}>{c.v}</Text>
              <Text style={s.cap8}>{c.l}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Currency — featured (accent-tonad ram, = manned LicenceJourney) */}
      {recency.length > 0 && (
        <Section accent={accent} title="Currency" icon="time-outline" hint="Days since last flight per category" featured onInfo={() => setInfoOpen(true)}>
          <View style={{ gap: 8 }}>
            {recency.map((r) => (
              <View key={r.category} style={s.recencyRow}>
                <View style={[s.catPill, { borderColor: accent + '55', backgroundColor: accent + '14' }]}>
                  <Text style={[s.catPillText, { color: accent }]}>{r.category}</Text>
                </View>
                <Text style={s.recencyDays}>{r.daysAgo === 0 ? '0' : String(r.daysAgo)}<Text style={s.recencyUnit}> {r.daysAgo === 0 ? 'today' : 'd ago'}</Text></Text>
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
            return <BarRow key={c.key} label={c.label} value={hToHHMM(v)} pct={v / catMax} accent={accent} />;
          })}
        </View>
      </Section>

      {/* By flight mode */}
      <Section accent={accent} title="By flight mode" icon="eye-outline">
        <View style={{ gap: 9 }}>
          {MODE_KEYS.filter((m) => ((stats as any)[m.key] || 0) > 0).map((m) => {
            const v = (stats as any)[m.key] || 0;
            return <BarRow key={m.key} label={m.label} value={hToHHMM(v)} pct={v / modeMax} accent={accent} />;
          })}
        </View>
      </Section>

      {/* Activity */}
      <Section accent={accent} title="Activity" icon="bar-chart-outline" hint="Flights per month">
        {/* Staplar i eget område (så snittlinjen kan placeras exakt i samma skala), etiketter under. */}
        <View style={s.chartBars}>
          {monthly.map((m, i) => (
            <View key={i} style={s.chartCol}>
              <View style={[s.chartBar, { height: `${Math.round((m.count / monthMax) * 100)}%`, backgroundColor: m.count ? accent : DR.elevated }]} />
            </View>
          ))}
          {monthAvg > 0 && (
            <View pointerEvents="none" style={[s.avgWrap, { bottom: `${(monthAvg / monthMax) * 100}%` }]}>
              <View style={s.avgDashes}>
                {Array.from({ length: 34 }, (_, i) => <View key={i} style={s.avgDash} />)}
              </View>
              <View style={s.avgTag}><Text style={s.avgTagText}>AVG {monthAvg.toFixed(1)}</Text></View>
            </View>
          )}
        </View>
        <View style={s.chartLabels}>
          {monthly.map((m, i) => <Text key={i} style={s.chartLabel}>{m.label}</Text>)}
        </View>
      </Section>

      <CurrencyInfo visible={infoOpen} accent={accent} onClose={() => setInfoOpen(false)} />
    </ScrollView>
  );
}

// Info-popup: vad Current/Stale betyder + vad kategorierna (EU Open/Specific/Certified) innebär.
function CurrencyInfo({ visible, accent, onClose }: { visible: boolean; accent: string; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.infoBackdrop} onPress={onClose}>
        <Pressable style={s.infoCard} onPress={() => {}}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="information-circle" size={20} color={accent} />
            <Text style={[s.sectionTitle, { flex: 1 }]}>Currency & categories</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={20} color={DR.muted} /></TouchableOpacity>
          </View>
          <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 6 }}>
              <Text style={s.infoText}>
                Currency shows how recently you have flown in each operational category. A category is{' '}
                <Text style={{ color: DR.good, fontWeight: '700' }}>Current</Text> while you have flown it within the last {STALE_DAYS} days, and{' '}
                <Text style={{ color: DR.warning, fontWeight: '700' }}>Stale</Text> after that — a reminder to get some recent practice.
              </Text>
              <Text style={s.infoNote}>
                The EU rules have no formal recency requirement in the Open category, but your operator or operations manual may have one — common in the Specific category.
              </Text>
            </View>
            <View style={{ gap: 10 }}>
              <Text style={s.cap}>Categories · EU drone rules</Text>
              {CATEGORY_INFO.map((c) => (
                <View key={c.code} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={[s.catPill, { borderColor: accent + '55', backgroundColor: accent + '14', minWidth: 74 }]}>
                    <Text style={[s.catPillText, { color: accent }]}>{c.code}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.infoItemTitle}>{c.title}</Text>
                    <Text style={s.infoItemText}>{c.text}</Text>
                  </View>
                </View>
              ))}
            </View>
            <Text style={s.infoNote}>
              All Open-category flights (A1–A3): max 120 m above ground, within visual line of sight, under 25 kg. Other categories, such as NATO classes, follow your organisation's rules.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({ accent, title, hint, icon, featured, onInfo, children }: {
  accent: string; title: string; hint?: string; icon?: any; featured?: boolean; onInfo?: () => void; children: React.ReactNode;
}) {
  return (
    <View style={[s.section, featured && { borderColor: accent + '55' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <Ionicons name={icon} size={16} color={accent} /> : null}
        <Text style={s.sectionTitle}>{title}</Text>
        {onInfo ? (
          <TouchableOpacity onPress={onInfo} hitSlop={10} style={{ marginLeft: 'auto' }}
            accessibilityRole="button" accessibilityLabel={`About ${title.toLowerCase()}`}>
            <Ionicons name="information-circle-outline" size={20} color={accent} />
          </TouchableOpacity>
        ) : null}
      </View>
      {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

// Timmarna i en fast, bred kolumn (lika lång bar-track på alla rader → jämförbara staplar). Talet i LED,
// "h" som egen liten enhet — radbryts aldrig (krymper hellre lite vid väldigt många timmar).
function BarRow({ label, value, unit = 'h', pct, accent }: { label: string; value: string; unit?: string; pct: number; accent: string }) {
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${Math.max(3, Math.round(pct * 100))}%`, backgroundColor: accent }]} />
      </View>
      <View style={s.barValueBox}>
        <Text style={s.barValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
        <Text style={s.barUnit}>{unit}</Text>
      </View>
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
  barValueBox: { width: 84, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 2 },
  barValue: { flexShrink: 1, color: DR.text, fontSize: 12, textAlign: 'right', fontFamily: FONT_LED7, fontVariant: ['tabular-nums'] },
  barUnit: { fontFamily: MONO, fontSize: 10, fontWeight: '700', color: DR.muted },

  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  infoCard: { width: '100%', maxWidth: 420, maxHeight: '82%', backgroundColor: DR.surface, borderRadius: 16, borderWidth: 1, borderColor: DR.border, padding: 18 },
  infoText: { color: DR.text2, fontSize: 13.5, lineHeight: 20 },
  infoNote: { color: DR.muted, fontSize: 12, lineHeight: 17 },
  infoItemTitle: { color: DR.text, fontSize: 13, fontWeight: '700' },
  infoItemText: { color: DR.text2, fontSize: 12.5, lineHeight: 18 },

  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 74, marginTop: 14 },
  chartCol: { flex: 1, height: '100%', justifyContent: 'flex-end', borderRadius: 4, overflow: 'hidden' },
  chartBar: { width: '100%', borderRadius: 4, minHeight: 3 },
  chartLabels: { flexDirection: 'row', gap: 4, marginTop: 5 },
  chartLabel: { flex: 1, textAlign: 'center', color: DR.muted, fontSize: 9, fontFamily: MONO },
  // Snittlinje: streckad, ljus (syns både över staplarna och bakgrunden) + liten etikett i högerkanten.
  avgWrap: { position: 'absolute', left: 0, right: 0, height: 0 },
  avgDashes: { position: 'absolute', left: 0, right: 0, top: -0.75, flexDirection: 'row', justifyContent: 'space-between' },
  avgDash: { width: 5, height: 1.5, borderRadius: 1, backgroundColor: DR.text, opacity: 0.9 },
  avgTag: { position: 'absolute', right: 0, bottom: 3, backgroundColor: DR.surface, borderRadius: 4, borderWidth: 1, borderColor: DR.border, paddingHorizontal: 4, paddingVertical: 1 },
  avgTagText: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: DR.text, letterSpacing: 0.4 },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  placeName: { flex: 1, color: DR.text, fontSize: 13.5, fontWeight: '600' },
  placeCount: { color: DR.text, fontSize: 13, fontFamily: FONT_LED7 },
  placeUnit: { fontFamily: MONO, fontSize: 11, fontWeight: '400', color: DR.text3 },
});
