import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useTranslation } from '../../hooks/useTranslation';
import { useLongestXcFull } from '../../hooks/useMilestoneDetails';
import { MiniRouteMap } from '../../components/milestones/MiniRouteMap';
import { RouteLeafletModal } from '../../components/milestones/RouteLeafletModal';
import { MilestoneShareCard, ShareData } from '../../components/milestones/MilestoneShareCard';
import {
  MilestoneHeader, Eyebrow, SectionHead, StatBlock, Card, Top5Bars, PrimaryCTA, GhostCTA, MONO, SERIF,
} from '../../components/milestones/MilestoneUI';

export default function LongestXcScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const accent = Colors.accent;
  const stats = useFlightStore(s => s.stats);
  const { t } = useTranslation();
  const [mapVisible, setMapVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

  const d = useLongestXcFull({
    date: stats?.longest_xc_date || undefined,
    km: stats?.longest_xc_km ?? 0,
    hours: stats?.longest_xc_hours ?? 0,
    flightId: stats?.longest_xc_id ?? null,
    firstDep: stats?.longest_xc_first_dep,
    lastArr: stats?.longest_xc_last_arr,
  });

  const mapW = width - 40;
  const chips = [
    d.cruiseKts ? { l: t('ms.lx_cruise'), v: `${d.cruiseKts} KTS` } : null,
    d.altFl ? { l: t('ms.lx_alt'), v: d.altFl } : null,
    d.rules ? { l: t('ms.lx_rules'), v: d.rules } : null,
  ].filter(Boolean) as Array<{ l: string; v: string }>;

  const maxTop5 = Math.max(1, ...d.top5.map(r => r.nm));

  const shareData: ShareData | null = d.ready ? {
    variant: 'lx',
    distanceNm: d.distanceNm,
    distanceKm: d.distanceKm,
    nmUnit: t('ms.nm'),
    legs: d.legs.map(l => ({ icao: l.icao, city: l.name })),
    meta: [
      { l: t('ms.block'), v: d.totalLabel },
      { l: t('ms.date'), v: d.dateShort },
      { l: t('ms.aircraft'), v: d.aircraftReg || '—' },
    ],
  } : null;

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <MilestoneHeader
        title={t('ms.longest_xc')}
        accent={accent}
        topInset={insets.top}
        onBack={() => router.back()}
        onShare={() => setShareVisible(true)}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={s.hero}>
          <Eyebrow accent={accent}>{t('ms.lx_eyebrow')}</Eyebrow>
          <View style={s.heroRow}>
            <Text style={s.heroNum}>{(d.distanceNm || 0).toLocaleString('en-US')}</Text>
            <Text style={[s.heroUnit, { color: accent }]}>{t('ms.nm')}</Text>
          </View>
          <Text style={s.heroCaption}>
            {d.distanceKm.toLocaleString('en-US')} KM · {d.totalLabel} {t('ms.lx_block')} · {d.dateLong.toUpperCase()}
          </Text>
        </View>

        {/* Map */}
        <View style={s.section}>
          <View style={[s.mapCard, { height: 300 }]}>
            {d.legs.length >= 2 ? (
              <MiniRouteMap
                width={mapW}
                height={300}
                legs={d.legs}
                accent={accent}
                showGraticule
                showLabels
                padX={70}
                padTop={70}
                padBottom={70}
              />
            ) : (
              <View style={s.mapEmpty}><Text style={s.mapEmptyText}>{t('ms.lx_no_coords')}</Text></View>
            )}
            {d.legs.length >= 1 && (
              <Pressable onPress={() => setMapVisible(true)} style={({ pressed }) => [s.showMapBtn, { borderColor: accent + '55', opacity: pressed ? 0.8 : 1 }]} hitSlop={6}>
                <Ionicons name="map-outline" size={13} color={accent} />
                <Text style={[s.showMapText, { color: accent }]}>{t('ms.lx_show_on_map').toUpperCase()}</Text>
              </Pressable>
            )}
            {chips.length > 0 && (
              <View style={s.chips}>
                {chips.map(c => (
                  <View key={c.l} style={s.chip}>
                    <Text style={s.chipLabel}>{c.l.toUpperCase()}</Text>
                    <Text style={[s.chipValue, { color: accent }]}>{c.v}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Route legs */}
        {d.legs.length > 0 && (
          <View style={s.section}>
            <SectionHead eyebrow={t('ms.lx_route')} title={legTitle(d.legs.length, t)} accent={accent} />
            <Card style={{ marginTop: 14, overflow: 'hidden' }}>
              {d.legs.map((leg, i) => {
                const isLast = i === d.legs.length - 1;
                const tag = leg.role === 'dep' ? t('ms.leg_departure') : leg.role === 'arr' ? t('ms.leg_arrival') : t('ms.leg_via');
                return (
                  <View key={leg.icao + i}>
                    <View style={s.legRow}>
                      <View style={s.legDotWrap}>
                        <View style={[s.legDot, { borderColor: accent, backgroundColor: leg.role === 'via' ? 'transparent' : accent }]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={s.legHeadRow}>
                          <Text style={s.legIcao}>{leg.icao}</Text>
                          {!!leg.name && <Text style={s.legName} numberOfLines={1}>{leg.name}</Text>}
                        </View>
                      </View>
                      <Text style={[s.legTag, { color: leg.role === 'via' ? Colors.textMuted : accent }]}>{tag.toUpperCase()}</Text>
                    </View>
                    {!isLast && <View style={[s.legConnector, { borderColor: accent + '66' }]} />}
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* On the day */}
        <View style={s.section}>
          <SectionHead eyebrow={t('ms.lx_the_flight')} title={t('ms.lx_on_the_day')} accent={accent} />
          <Card style={{ marginTop: 14, padding: 16 }}>
            <View style={[s.grid2, s.rowDivider]}>
              <StatBlock label={t('ms.aircraft')} value={d.aircraftReg || '—'} color={accent} />
              <StatBlock label={t('ms.type')} value={d.aircraftType || '—'} color={Colors.textSecondary} />
            </View>
            <View style={[s.grid3, s.rowDivider, { paddingTop: 14 }]}>
              <StatBlock label={t('ms.total')} value={d.totalLabel} color={accent} />
              <StatBlock label={t('ms.day')} value={d.dayLabel} color={Colors.textSecondary} />
              <StatBlock label={t('ms.night')} value={d.nightLabel} color={Colors.textMuted} />
            </View>
            {d.blockOff && d.blockOn ? (
              <View style={{ paddingTop: 14 }}>
                <Text style={s.subLabel}>{t('ms.lx_sun_window').toUpperCase()}</Text>
                <SunBar accent={accent} sunrise={d.sunrise} sunset={d.sunset} blockOff={d.blockOff} blockOn={d.blockOn} />
              </View>
            ) : null}
          </Card>
        </View>

        {/* Top 5 */}
        {d.top5.length > 0 && (
          <View style={s.section}>
            <SectionHead eyebrow={t('ms.career_ladder')} title={t('ms.lx_top5')} accent={accent} />
            <Card style={{ marginTop: 14, padding: 16 }}>
              <Top5Bars
                accent={accent}
                items={d.top5.map(r => ({
                  rank: r.rank, label: r.route, range: r.date,
                  value: r.nm.toLocaleString('en-US'), unit: t('ms.nm'),
                  pct: (r.nm / maxTop5) * 100, current: r.current,
                }))}
              />
            </Card>
          </View>
        )}

        {/* CTAs */}
        <View style={[s.section, { gap: 10 }]}>
          <PrimaryCTA label={t('ms.lx_share')} icon="share-outline" accent={accent} onPress={() => setShareVisible(true)} />
          <GhostCTA
            label={t('ms.lx_open_detail')}
            icon="document-text-outline"
            onPress={() => stats?.longest_xc_id && router.push(`/flight/${stats.longest_xc_id}`)}
          />
        </View>
      </ScrollView>

      <RouteLeafletModal
        visible={mapVisible}
        onClose={() => setMapVisible(false)}
        points={d.legs.map(l => ({ icao: l.icao, name: l.name, lat: l.lat, lon: l.lon }))}
        accent={accent}
      />

      <MilestoneShareCard visible={shareVisible} onClose={() => setShareVisible(false)} data={shareData} accent={Colors.gold} />
    </View>
  );
}

function legTitle(n: number, t: (k: any) => string): string {
  return n === 2 ? t('ms.lx_route_title_two') : t('ms.lx_route_title_n').replace('{n}', String(n));
}

// ── Sun & flight window bar (24h) ──
function SunBar({ accent, sunrise, sunset, blockOff, blockOn }: {
  accent: string; sunrise?: string; sunset?: string; blockOff: string; blockOn: string;
}) {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const DAY = 1440;
  const pct = (m: number) => (m / DAY) * 100;
  const bo = toMin(blockOff), bi = toMin(blockOn);
  const fL = pct(Math.min(bo, bi)), fW = Math.max(2, pct(Math.abs(bi - bo)));
  const hasSun = !!sunrise && !!sunset;
  const sr = hasSun ? pct(toMin(sunrise!)) : 0;
  const ss = hasSun ? pct(toMin(sunset!)) : 100;

  return (
    <View style={{ gap: 10 }}>
      <View style={sb.bar}>
        {hasSun && <View style={[sb.night, { left: 0, width: `${sr}%` }]} />}
        {hasSun && <View style={[sb.night, { right: 0, width: `${100 - ss}%` }]} />}
        {hasSun && <View style={[sb.marker, { left: `${sr}%` }]} />}
        {hasSun && <View style={[sb.marker, { left: `${ss}%` }]} />}
        <View style={[sb.flight, { left: `${fL}%`, width: `${fW}%`, backgroundColor: accent, shadowColor: accent }]} />
      </View>
      <View style={sb.ticks}>
        <Text style={sb.tick}>00</Text>
        {hasSun && <Text style={[sb.tick, { color: Colors.warning }]}>↑ {sunrise}</Text>}
        <Text style={[sb.tick, { color: accent }]}>{blockOff} → {blockOn}</Text>
        {hasSun && <Text style={[sb.tick, { color: Colors.warning }]}>↓ {sunset}</Text>}
        <Text style={sb.tick}>24</Text>
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

  section: { paddingHorizontal: 20, paddingTop: 6, marginTop: 18 },

  mapCard: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.background, position: 'relative' },
  mapEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mapEmptyText: { fontFamily: MONO, fontSize: 11, color: Colors.textMuted },
  showMapBtn: {
    position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1,
    backgroundColor: 'rgba(10,22,40,0.82)',
  },
  showMapText: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },
  chips: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(10,22,40,0.82)', gap: 2 },
  chipLabel: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textMuted },
  chipValue: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  legRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  legDotWrap: { width: 22, alignItems: 'center' },
  legDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  legHeadRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  legIcao: { fontFamily: MONO, fontSize: 14, fontWeight: '700', letterSpacing: 0.8, color: Colors.textPrimary },
  legName: { fontSize: 12.5, color: Colors.textSecondary, flexShrink: 1 },
  legTag: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  legConnector: { marginLeft: 35, height: 18, borderLeftWidth: 1.5, borderStyle: 'dashed' },

  grid2: { flexDirection: 'row', gap: 14 },
  grid3: { flexDirection: 'row', gap: 14 },
  rowDivider: { paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  subLabel: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textMuted, marginBottom: 10 },
});

const sb = StyleSheet.create({
  bar: { height: 28, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: Colors.cardBorder, position: 'relative' },
  night: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(20,40,80,0.45)' },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: Colors.warning, opacity: 0.8 },
  flight: { position: 'absolute', top: 6, bottom: 6, borderRadius: 4, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontFamily: MONO, fontSize: 10, color: Colors.textMuted, letterSpacing: 0.5 },
});
