import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useTranslation } from '../../hooks/useTranslation';
import { useBestWeekFull } from '../../hooks/useMilestoneDetails';
import { monthShort } from '../../utils/dateLabels';
import { BWDayBars } from '../../components/milestones/BWDayBars';
import { MilestoneShareCard, ShareData } from '../../components/milestones/MilestoneShareCard';
import {
  MilestoneHeader, Eyebrow, SectionHead, StatBlock, Card, Top5Bars, PrimaryCTA, GhostCTA, MONO, SERIF,
} from '../../components/milestones/MilestoneUI';

function dayHeader(iso: string, dow: string, language: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${dow.toUpperCase()} ${String(d).padStart(2, '0')} ${monthShort(language, (m || 1) - 1).toUpperCase()}`;
}
function hhmm(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

export default function BestWeekScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = Colors.accent;
  const stats = useFlightStore(s => s.stats);
  const { t, language } = useTranslation();

  const d = useBestWeekFull(
    stats?.best_week_start || undefined,
    stats?.best_week_label || '',
    stats?.best_week_hours ?? 0,
  );

  const maxTop5 = Math.max(1, ...d.top5.map(t => t.hours));
  const cmpMax = Math.max(d.hoursNum, d.baselineWeek, 0.1);
  const daysWithFlights = d.days.filter(day => day.flights.length > 0);

  const [shareVisible, setShareVisible] = useState(false);
  const peak = d.days.reduce((a, b) => (b.hours > a.hours ? b : a), d.days[0] ?? { dow: '—', hours: 0, iso: '', date: 0, flights: [] });
  const shareData: ShareData | null = d.ready ? {
    variant: 'bw',
    weekLabel: stats?.best_week_label || d.weekLabel || '',
    hoursLabel: d.hoursLabel,
    hrsUnit: t('ms.hrs'),
    sectorsLabel: `${d.sectors} ${t('ms.sectors')}`,
    days: d.days.map(day => ({ iso: day.iso, dow: day.dow, hours: day.hours })),
    meta: [
      { l: t('ms.range'), v: d.rangeLabel.split(' ').slice(0, 3).join(' ') },
      { l: t('ms.airports'), v: String(d.airports) },
      { l: t('ms.bw_top_day'), v: `${peak.dow.toUpperCase()} · ${hhmm(peak.hours)}` },
    ],
  } : null;

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <MilestoneHeader
        title={t('ms.best_week')}
        accent={accent}
        topInset={insets.top}
        onBack={() => router.back()}
        onShare={() => setShareVisible(true)}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={s.hero}>
          <Eyebrow accent={accent}>{t('ms.bw_eyebrow')}</Eyebrow>
          <View style={s.heroRow}>
            <Text style={s.heroNum}>{d.hoursLabel || hhmm(stats?.best_week_hours ?? 0)}</Text>
            <Text style={[s.heroUnit, { color: accent }]}>{t('ms.hrs')}</Text>
          </View>
          <Text style={s.heroCaption}>
            {(stats?.best_week_label || '').toUpperCase()}{d.rangeLabel ? ` · ${d.rangeLabel.toUpperCase()}` : ''}
          </Text>
        </View>

        {/* Day bars panel */}
        <View style={s.section}>
          <Card style={{ padding: 18 }}>
            <View style={s.panelHead}>
              <Text style={[s.panelEyebrow, { color: accent }]}>{t('ms.bw_day_by_day').toUpperCase()}</Text>
              <Text style={s.panelMeta}>{d.daysFlown} / 7 {t('ms.bw_days_flown').toUpperCase()}</Text>
            </View>
            <View style={{ height: 150 }}>
              <BWDayBars days={d.days} accent={accent} />
            </View>
            <View style={s.statRow}>
              <StatBlock label={t('ms.sectors')} value={String(d.sectors)} color={accent} />
              <StatBlock label={t('ms.airports')} value={String(d.airports)} color={Colors.textSecondary} />
              <StatBlock label={t('ms.bw_top_day')} value={d.topDay} color={accent} />
              <StatBlock label={t('ms.bw_vs_avg')} value={d.vsAvg > 0 ? `${d.vsAvg.toFixed(1)}×` : '—'} color={Colors.textSecondary} />
            </View>
          </Card>
        </View>

        {/* Comparison vs baseline */}
        {d.baselineWeek > 0 && (
          <View style={s.section}>
            <SectionHead eyebrow={t('ms.bw_pace')} title={t('ms.bw_against_typical')} accent={accent} />
            <Card style={{ marginTop: 14, padding: 16, gap: 14 }}>
              <CompareBar tag={t('ms.bw_this_week').toUpperCase()} label={d.hoursLabel} pct={(d.hoursNum / cmpMax) * 100} accent={accent} primary />
              <CompareBar tag={t('ms.bw_typical_avg').toUpperCase()} label={d.baselineLabel} pct={(d.baselineWeek / cmpMax) * 100} accent={accent} primary={false} />
            </Card>
          </View>
        )}

        {/* Sectors list grouped by day */}
        {daysWithFlights.length > 0 && (
          <View style={s.section}>
            <SectionHead eyebrow={t('ms.bw_flights')} title={`${d.sectors} ${d.sectors === 1 ? t('ms.sector_one') : t('ms.sector_many')}`} accent={accent} />
            <Card style={{ marginTop: 14, overflow: 'hidden' }}>
              {daysWithFlights.map((day, di) => (
                <View key={day.iso}>
                  <View style={s.dayHead}>
                    <Text style={[s.dayHeadLeft, { color: accent }]}>{dayHeader(day.iso, day.dow, language)}</Text>
                    <Text style={s.dayHeadRight}>{hhmm(day.hours)} {t('ms.total').toUpperCase()}</Text>
                  </View>
                  {day.flights.map((f, fi) => (
                    <Pressable
                      key={f.id}
                      onPress={() => router.push(`/flight/detail/${f.id}`)}
                      style={({ pressed }) => [s.flightRow, fi > 0 && s.flightRowBorder, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <View style={[s.flightDot, { backgroundColor: accent }]} />
                      <View style={s.flightRoute}>
                        <Text style={s.flightIcao}>{f.dep}</Text>
                        <Text style={[s.flightArrow, { color: accent }]}>→</Text>
                        <Text style={s.flightIcao}>{f.arr}</Text>
                      </View>
                      <Text style={s.flightRole}>{f.isPic ? 'PIC' : ''}</Text>
                      <Text style={[s.flightDur, { color: accent }]}>{f.dur}</Text>
                    </Pressable>
                  ))}
                  {di < daysWithFlights.length - 1 && <View style={s.daySep} />}
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Top 5 weeks */}
        {d.top5.length > 0 && (
          <View style={s.section}>
            <SectionHead eyebrow={t('ms.career_ladder')} title={t('ms.bw_top5')} accent={accent} />
            <Card style={{ marginTop: 14, padding: 16 }}>
              <Top5Bars
                accent={accent}
                items={d.top5.map(w => ({
                  rank: w.rank, label: w.label, range: w.range,
                  value: hhmm(w.hours), unit: t('ms.hrs'),
                  pct: (w.hours / maxTop5) * 100, current: w.current,
                }))}
              />
            </Card>
          </View>
        )}

        {/* CTAs */}
        <View style={[s.section, { gap: 10 }]}>
          <PrimaryCTA label={t('ms.bw_share')} icon="share-outline" accent={accent} onPress={() => setShareVisible(true)} />
          <GhostCTA label={t('ms.bw_open_logbook')} icon="list-outline" onPress={() => router.push('/log')} />
        </View>
      </ScrollView>

      <MilestoneShareCard visible={shareVisible} onClose={() => setShareVisible(false)} data={shareData} accent={Colors.gold} />
    </View>
  );
}

function CompareBar({ tag, label, pct, accent, primary }: {
  tag: string; label: string; pct: number; accent: string; primary: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 6 }}>
      <View style={s.cmpRow}>
        <Text style={[s.cmpTag, { color: primary ? accent : Colors.textMuted }]}>{tag}</Text>
        <Text style={[s.cmpVal, { color: primary ? Colors.textPrimary : Colors.textSecondary }]}>
          {label}<Text style={s.cmpUnit}> {t('ms.hrs')}</Text>
        </Text>
      </View>
      <View style={[s.cmpTrack, { height: primary ? 8 : 5 }]}>
        <View style={[s.cmpFill, { width: `${Math.min(100, pct)}%`, backgroundColor: primary ? accent : Colors.cardBorder, shadowColor: accent, shadowOpacity: primary ? 0.5 : 0 }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  hero: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18, gap: 14 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  heroNum: { fontFamily: SERIF, fontSize: 84, lineHeight: 84, fontWeight: '500', letterSpacing: -3, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  heroUnit: { fontFamily: MONO, fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  heroCaption: { fontFamily: MONO, fontSize: 11, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.8 },

  section: { paddingHorizontal: 20, marginTop: 18 },

  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 },
  panelEyebrow: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.8 },
  panelMeta: { fontFamily: MONO, fontSize: 10, fontWeight: '600', color: Colors.textMuted, letterSpacing: 0.8 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.separator },

  cmpRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cmpTag: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6 },
  cmpVal: { fontFamily: MONO, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cmpUnit: { fontSize: 9, color: Colors.textMuted, letterSpacing: 1.4 },
  cmpTrack: { borderRadius: 99, overflow: 'hidden', backgroundColor: 'rgba(127,168,200,0.08)' },
  cmpFill: { height: '100%', borderRadius: 99, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },

  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  dayHeadLeft: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },
  dayHeadRight: { fontFamily: MONO, fontSize: 10, fontWeight: '600', color: Colors.textMuted, letterSpacing: 0.8 },
  flightRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  flightRowBorder: { borderTopWidth: 1, borderTopColor: Colors.separator },
  flightDot: { width: 6, height: 6, borderRadius: 3 },
  flightRoute: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  flightIcao: { fontFamily: MONO, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, color: Colors.textPrimary },
  flightArrow: { fontFamily: MONO, fontSize: 13, fontWeight: '700' },
  flightRole: { fontFamily: MONO, fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.8, width: 28, textAlign: 'right' },
  flightDur: { fontFamily: MONO, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], width: 46, textAlign: 'right' },
  daySep: { height: 1, backgroundColor: Colors.cardBorder },
});
