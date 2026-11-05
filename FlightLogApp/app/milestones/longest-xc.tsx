// Longest XC: dagen med längst sammanlagd distans (samma regel som stats). Distansen stort överst, rutten som en linje
// där avstånden motsvarar benens längd, dagens karta som förhandsbild (ett tryck spelar upp flygningen i helskärm),
// benen med markstopp, topp 5 och "Open flight detail".

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useLongestXcFull, type LXTop5Row } from '../../hooks/useMilestoneDetails';
import { StaticMap, GlowLine, regionFor, toLatLng, MAP_CYAN } from '../../components/milestones/MilestoneMap';
import { StopMarker, Glass } from '../../components/milestones/ReplayKit';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const clockMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`;

export default function LongestXcScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stats = useFlightStore(s => s.stats);

  // Utan parametrar = längsta XC. Med ?date= = en av topp 5-dagarna (#2–5), öppnad från listan nedan.
  const params = useLocalSearchParams<{ date?: string; rank?: string; nm?: string; hours?: string; from?: string; to?: string }>();
  const sub = !!params.date;
  const rank = sub ? Number(params.rank) || 0 : 1;
  const d = useLongestXcFull(sub ? {
    date: params.date, km: Number(params.nm) || 0, hours: parseFloat(params.hours ?? '') || 0,
    flightId: null, firstDep: params.from, lastArr: params.to,
  } : {
    date: stats?.longest_xc_date || undefined, km: stats?.longest_xc_km ?? 0, hours: stats?.longest_xc_hours ?? 0,
    flightId: stats?.longest_xc_id ?? null, firstDep: stats?.longest_xc_first_dep, lastArr: stats?.longest_xc_last_arr,
  });

  // Topp 5-rad → samma vy för den dagen. Från längsta XC läggs ett kort ovanpå; på ett sådant kort
  // byts innehållet på plats (setParams) och #1 stänger kortet → "tillbaka" landar alltid på längsta XC.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [params.date]);
  const openXc = (r: LXTop5Row) => {
    if (r.current) return;
    if (sub && r.rank === 1) { router.back(); return; }
    const p = { date: r.iso, rank: String(r.rank), nm: String(r.nm), hours: String(r.hours), from: r.from, to: r.to };
    if (sub) router.setParams(p); else router.push({ pathname: '/milestones/longest-xc', params: p });
  };
  const openMap = () => router.push({ pathname: '/milestones/longest-xc-map', params: sub ? { ...params } : {} });
  const detailId = sub ? d.flightId : stats?.longest_xc_id;

  const legs = d.flightLegs;
  const strip = legs.filter((l) => l.nm > 0);
  const stripNm = strip.reduce((s, l) => s + l.nm, 0);
  const [stripW, setStripW] = useState(0);
  const region = regionFor(d.legs);
  const caption = [
    `${d.distanceKm.toLocaleString('en-US')} km in ${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}`,
    d.totalLabel ? `${d.totalLabel} in the air` : '',
    d.aircraftType, d.role,
  ].filter(Boolean).join(' · ');

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <View style={[s.header, { paddingTop: Math.min(insets.top, 6) + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Text style={s.title}>{rank === 1 ? 'Longest XC' : `#${rank} longest XC`}</Text>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 34 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 4, paddingTop: 10 }}>
          <Text style={s.eyebrow}>{(rank > 1 ? `#${rank} of your longest days · ` : '') + d.dateLong}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={s.heroNum}>{(d.distanceNm || 0).toLocaleString('en-US')}</Text>
            <Text style={s.heroUnit}>NM</Text>
          </View>
          <Text style={s.caption}>{caption}</Text>
        </View>

        {strip.length > 0 && stripNm > 0 ? (
          <View style={{ height: 52 }} onLayout={(e) => setStripW(e.nativeEvent.layout.width)}>
            {stripW > 0 ? (() => {
              const X0 = 6, X1 = stripW - 6;
              const codes = [strip[0].from, ...strip.map((l) => l.to)];
              let acc = 0;
              const xs = [X0, ...strip.map((l) => { acc += l.nm; return X0 + (acc / stripNm) * (X1 - X0); })];
              return (
                <>
                  <View style={[s.stripLine, { left: X0, width: X1 - X0 }]} />
                  {strip.map((l, i) => (
                    <Text key={`n${i}`} style={[s.stripNm, { left: (xs[i] + xs[i + 1]) / 2 - 30 }]}>{Math.round(l.nm)} NM</Text>
                  ))}
                  {codes.map((k, i) => {
                    const end = i === 0 || i === codes.length - 1;
                    const align = i === 0 ? 'left' : i === codes.length - 1 ? 'right' : 'center';
                    const left = align === 'left' ? xs[i] - 4 : align === 'right' ? xs[i] - 86 : xs[i] - 45;
                    return (
                      <React.Fragment key={`c${i}`}>
                        <View style={[s.stripDot, end ? s.stripEnd : s.stripVia, { left: xs[i] - (end ? 5 : 4) }]} />
                        <Text style={[s.stripCode, { position: 'absolute', top: 34, left, width: 90, textAlign: align }]}>{k}</Text>
                      </React.Fragment>
                    );
                  })}
                </>
              );
            })() : null}
          </View>
        ) : null}

        {region && d.legs.length >= 2 ? (
          <Pressable onPress={openMap} accessibilityRole="button" accessibilityLabel="Open the map and replay the flight">
            <StaticMap region={region} style={s.map} fade={Colors.background}>
              <GlowLine coords={d.legs.map(toLatLng)} width={2.4} />
              {d.legs.filter((p, i, arr) => arr.findIndex((q) => q.icao === p.icao) === i).map((p) => (
                <StopMarker key={p.icao} p={p} code={p.icao} visited />
              ))}
            </StaticMap>
            <Glass style={s.expand}><Ionicons name="expand-outline" size={14} color="#DCE4EE" /></Glass>
            <Glass style={s.replay}>
              <View style={s.replayIcon}><Ionicons name="play" size={10} color={Colors.textInverse} /></View>
              <Text style={s.replayText}>Replay the flight</Text>
            </Glass>
          </Pressable>
        ) : d.ready ? <Text style={s.caption}>No coordinates for this route.</Text> : null}

        {legs.length > 0 ? (
          <View>
            <Text style={[s.eyebrow, { paddingBottom: 8 }]}>THE LEGS</Text>
            {legs.map((l, j) => {
              const prevOn = j > 0 ? clockMin(legs[j - 1].on) : null, off = clockMin(l.off);
              const ground = prevOn != null && off != null ? (off - prevOn + 1440) % 1440 : null;
              return (
                <React.Fragment key={`${l.from}-${l.to}-${j}`}>
                  {j > 0 && ground != null ? (
                    <View style={s.groundRow}>
                      <View style={{ width: 40 }} />
                      <View style={s.groundRail}><View style={{ flex: 1, width: 1.5, backgroundColor: '#2A4E70' }} /></View>
                      <Text style={s.groundText}>{hm(ground)} on the ground at {l.from}</Text>
                    </View>
                  ) : null}
                  <View style={s.legRow}>
                    <View style={{ width: 40, gap: 2 }}>
                      <Text style={s.legOff}>{l.off || '—'}</Text>
                      <Text style={s.legOn}>{l.on}</Text>
                    </View>
                    <View style={s.legDot} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.legRoute}>{l.from} → {l.to}</Text>
                      {l.fromName || l.toName ? <Text numberOfLines={1} style={s.legNames}>{l.fromName} to {l.toName}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={s.legNm}>{Math.round(l.nm)} NM</Text>
                      <Text style={s.legNames}>{hm(l.hours * 60)}</Text>
                    </View>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        ) : null}

        {d.top5.length > 0 ? (
          <View>
            <Text style={[s.eyebrow, { paddingBottom: 6 }]}>YOUR TOP 5 DAYS</Text>
            {d.top5.map((r) => (
              <Pressable key={r.iso} onPress={() => openXc(r)} style={s.topRow} accessibilityRole="button">
                <Text style={[s.topRank, { color: r.current ? Colors.accent : Colors.textMuted }]}>{r.rank}</Text>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text numberOfLines={1} style={s.topRoute}>{r.route}</Text>
                  <Text style={s.topDate}>{r.date}</Text>
                </View>
                <Text style={[s.topNm, { color: r.current ? Colors.accent : Colors.textPrimary }]}>{r.nm.toLocaleString('en-US')} NM</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable onPress={() => detailId && router.push(`/flight/detail/${detailId}`)} style={({ pressed }) => [s.ghost, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="open-outline" size={15} color={Colors.accent} />
          <Text style={s.ghostText}>Open flight detail</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 4 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: SERIF, fontSize: 17, fontWeight: '600', color: Colors.textPrimary },
  eyebrow: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textSecondary, textTransform: 'uppercase' },
  heroNum: { fontFamily: SERIF, fontSize: 76, lineHeight: 80, fontWeight: '600', letterSpacing: -2, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  heroUnit: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: Colors.accent },
  caption: { fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: Colors.textSecondary },
  stripLine: { position: 'absolute', top: 23, height: 2, backgroundColor: Colors.accent, opacity: 0.5 },
  stripNm: { position: 'absolute', top: 0, width: 60, textAlign: 'center', fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: Colors.accentLight },
  stripDot: { position: 'absolute', top: 19, borderRadius: 6 },
  stripEnd: { width: 10, height: 10, backgroundColor: Colors.accent },
  stripVia: { width: 8, height: 8, marginTop: 1, backgroundColor: Colors.background, borderWidth: 2, borderColor: Colors.accent },
  stripCode: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: Colors.textPrimary },
  map: { height: 250, borderRadius: 16, borderWidth: 1, borderColor: Colors.separator },
  expand: { position: 'absolute', right: 10, top: 10, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  replay: { position: 'absolute', right: 10, bottom: 10, height: 34, paddingLeft: 5, paddingRight: 13, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 8 },
  replayIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: MAP_CYAN, alignItems: 'center', justifyContent: 'center' },
  replayText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: Colors.textPrimary },
  groundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 30 },
  groundRail: { width: 12, alignSelf: 'stretch', alignItems: 'center' },
  groundText: { fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.separator },
  legOff: { fontFamily: MONO, fontSize: 10, fontWeight: '700', color: Colors.textPrimary },
  legOn: { fontFamily: MONO, fontSize: 10, color: Colors.textSecondary },
  legDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 2, backgroundColor: Colors.accent },
  legRoute: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  legNames: { fontFamily: MONO, fontSize: 10, color: Colors.textSecondary },
  legNm: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: Colors.accent },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  topRank: { width: 18, fontFamily: SERIF, fontSize: 18, fontWeight: '600' },
  topRoute: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  topDate: { fontFamily: MONO, fontSize: 10, color: Colors.textSecondary },
  topNm: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700' },
  ghost: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ghostText: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.accent },
});
