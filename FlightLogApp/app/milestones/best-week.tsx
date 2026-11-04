// Best week: veckan med mest flygtid (måndag–söndag, samma regel som stats). Timmarna stort överst, dagar, sektorer,
// landningar och flygplatser på en rad, dag för dag som tunna staplar (lokala flygningar på basen mörkare, resor
// ljusare), den valda dagens flygningar, veckans karta som förhandsbild (ett tryck spelar upp veckan i helskärm),
// topp 5 och "Open week in logbook".

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useBestWeekFull, type BWTop5Row } from '../../hooks/useMilestoneDetails';
import { StaticMap, AirportMarker, HomeMarker, arcCoords, regionFor, MAP_GOLD } from '../../components/milestones/MilestoneMap';
import { MONO, SERIF } from '../../components/milestones/MilestoneUI';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BAR = 112;

function hhmm(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
const weekNo = (label: string) => (label.match(/W(\d+)/) || [])[1] || '';
function dayTitle(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `${DOW_LONG[dt.getDay()]} ${dt.getDate()} ${MONTH_LONG[dt.getMonth()]}`;
}

export default function BestWeekScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stats = useFlightStore(s => s.stats);
  // Utan parametrar = bästa veckan. Med ?week= = en av topp 5-veckorna (#2–5), öppnad från listan nedan.
  const params = useLocalSearchParams<{ week?: string; rank?: string; label?: string; hours?: string }>();
  const sub = !!params.week;
  const rank = sub ? Number(params.rank) || 0 : 1;
  const weekStart = sub ? params.week : stats?.best_week_start || undefined;
  const weekLabel = sub ? params.label ?? '' : stats?.best_week_label || '';
  const weekHours = sub ? parseFloat(params.hours ?? '') || 0 : stats?.best_week_hours ?? 0;
  const d = useBestWeekFull(weekStart, weekLabel, weekHours);

  // Dagen med mest flygtid är vald från början; ett tryck på en stapel väljer en annan.
  const [picked, setPicked] = useState<number | null>(null);
  const busiest = d.days.reduce((best, x, i) => (x.hours > (d.days[best]?.hours ?? -1) ? i : best), 0);
  const sel = picked ?? busiest;

  // Topp 5-rad → samma vy för den veckan. Från bästa veckan läggs ett kort ovanpå; på ett sådant kort
  // byts innehållet på plats (setParams) och #1 stänger kortet → "tillbaka" landar alltid på bästa veckan.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); setPicked(null); }, [params.week]);
  const openWeek = (w: BWTop5Row) => {
    if (w.current) return;
    if (sub && w.rank === 1) { router.back(); return; }
    const p = { week: w.weekStart, rank: String(w.rank), label: w.label, hours: String(w.hours) };
    if (sub) router.setParams(p); else router.push({ pathname: '/milestones/best-week', params: p });
  };
  const openMap = () => {
    if (!weekStart) return;
    router.push({ pathname: '/milestones/best-week-map', params: { week: weekStart, label: weekLabel, hours: String(weekHours) } });
  };
  const openLogbook = () => {
    // Loggboken med veckans flygningar inramade (veckan kan spänna över två månader).
    const isos = d.days.map((x) => x.iso).filter(Boolean).sort();
    const start = isos[0], end = isos[isos.length - 1];
    if (!start || !end) { router.push('/log'); return; }
    const [y, m] = start.split('-').map(Number);
    router.push({ pathname: '/log', params: { focusStart: start, focusEnd: end, focusYear: String(y), focusMonth: String(m), t: String(Date.now()) } });
  };

  const maxDay = Math.max(0.1, ...d.days.map((x) => x.hours));
  const selDay = d.days[sel];
  const geo = d.geo;
  const home = geo?.home ? geo.coords[geo.home] : undefined;
  const trips = d.days.flatMap((day, i) => day.flights.filter((f) => !f.local && geo?.coords[f.dep] && geo?.coords[f.arr]).map((f) => ({ ...f, day: i })));
  const away = [...new Set(trips.flatMap((t) => [t.dep, t.arr]))].filter((k) => k !== geo?.home);
  const region = regionFor(Object.values(geo?.coords ?? {}));
  const caption = [
    rank === 1 ? 'Your best week so far' : `#${rank} of your best weeks`,
    d.vsAvg > 0 ? `${d.vsAvg.toFixed(1)}× your usual ${d.baselineLabel}` : '',
  ].filter(Boolean).join(', ');
  const maxTop = Math.max(0.1, ...d.top5.map((w) => w.hours));

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false, animation: 'slide_from_bottom' }} />
      <View style={[s.header, { paddingTop: Math.min(insets.top, 6) + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
        </Pressable>
        <Text style={s.title}>{rank === 1 ? 'Best week' : `#${rank} best week`}</Text>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 34 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 4, paddingTop: 10 }}>
          <Text style={s.eyebrow}>{`WEEK ${weekNo(weekLabel)} · ${d.rangeLabel}`.toUpperCase()}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={s.heroNum}>{d.hoursLabel || hhmm(weekHours)}</Text>
            <Text style={[s.heroUnit, { color: Colors.accent }]}>h</Text>
          </View>
          <Text style={s.caption}>{caption}</Text>
        </View>

        <View style={s.strip}>
          {[[`${d.daysFlown}/7`, 'DAYS'], [String(d.sectors), 'SECTORS'], [String(d.landings), 'LANDINGS'], [String(d.airports), 'AIRPORTS']].map(([v, l], i) => (
            <View key={l} style={[s.stripCell, i > 0 && { borderLeftWidth: 1, borderLeftColor: Colors.separator }]}>
              <Text style={s.stripValue}>{v}</Text>
              <Text style={s.stripLabel}>{l}</Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={s.eyebrow}>DAY BY DAY</Text>
          <View style={{ flexDirection: 'row', height: 164 }}>
            {d.days.map((day, i) => {
              const on = i === sel, rest = day.hours <= 0;
              const loc = day.flights.filter((f) => f.local).reduce((sum, f) => sum + f.hours, 0);
              const awayH = Math.max(0, day.hours - loc);
              const seg = (h: number, color: string) => h > 0
                ? <View style={{ width: 8, borderRadius: 4, height: Math.max(4, (h / maxDay) * BAR), backgroundColor: color }} />
                : null;
              return (
                <Pressable key={day.iso} onPress={() => setPicked(i)} style={s.dayCol} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${dayTitle(day.iso)}, ${rest ? 'no flying' : `${hhmm(day.hours)} hours`}`}>
                  <Text style={[s.dayHours, { color: on ? Colors.accent : Colors.textSecondary }]}>{rest ? '—' : hhmm(day.hours)}</Text>
                  <View style={{ alignItems: 'center', gap: 2 }}>
                    {seg(awayH, on ? '#7FE4F3' : '#7D8FA5')}
                    {rest ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#22344A' }} /> : seg(loc, on ? Colors.accent : '#3A4D66')}
                  </View>
                  <Text style={[s.dayDow, { color: on ? Colors.accent : rest ? Colors.textMuted : Colors.textSecondary }]}>{day.dow}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Legend color="#3A4D66" label={`Local at ${geo?.home ?? 'base'}`} />
            <Legend color="#7D8FA5" label="Away" />
          </View>
        </View>

        {selDay ? (
          <View>
            <View style={s.dayHead}>
              <Text style={s.dayTitle}>{dayTitle(selDay.iso)}</Text>
              <Text style={s.dayTotal}>{selDay.hours > 0 ? hhmm(selDay.hours) : '—'}</Text>
            </View>
            {selDay.flights.length ? selDay.flights.map((f) => (
              <Pressable key={f.id} onPress={() => router.push(`/flight/detail/${f.id}`)} style={s.row}>
                <View style={{ width: 44, gap: 2 }}>
                  <Text style={s.rowOff}>{f.depUtc || '—'}</Text>
                  <Text style={s.rowOn}>{f.arrUtc || ''}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.rowRoute}>{f.local ? `${f.dep} · local` : `${f.dep} → ${f.arr}`}</Text>
                  <Text style={[s.rowSub, { color: f.local ? Colors.accent : Colors.textSecondary }]}>
                    {f.landings} {f.landings === 1 ? 'landing' : 'landings'}
                  </Text>
                </View>
                <Text style={s.rowDur}>{f.dur}</Text>
              </Pressable>
            )) : <Text style={s.restText}>No flying this day.</Text>}
          </View>
        ) : null}

        {region ? (
          <View style={{ gap: 12 }}>
            <Text style={s.eyebrow}>WHERE</Text>
            <Pressable onPress={openMap} accessibilityRole="button" accessibilityLabel="Open the map and replay the week">
              <StaticMap region={region} style={s.map}>
                {trips.map((t, i) => (
                  <Polyline key={`${t.id}-${i}`} coordinates={arcCoords(geo!.coords[t.dep], geo!.coords[t.arr])}
                    strokeColor={t.day === sel ? MAP_GOLD : 'rgba(255,184,48,0.3)'} strokeWidth={t.day === sel ? 2.2 : 1.4} lineCap="round" />
                ))}
                {away.map((k) => <AirportMarker key={k} p={geo!.coords[k]} icao={k} />)}
                {home && geo?.home ? (
                  <HomeMarker p={home} label={geo.localCount ? `${geo.home} · ${geo.localCount} local · ${geo.localLandings} landings` : geo.home} />
                ) : null}
              </StaticMap>
              <View style={s.expand}><Ionicons name="expand-outline" size={14} color="#C8CDD3" /></View>
              <View style={s.replay}>
                <Ionicons name="play" size={11} color={Colors.textInverse} />
                <Text style={s.replayText}>Replay the week</Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        {d.top5.length > 0 ? (
          <View>
            <Text style={[s.eyebrow, { paddingBottom: 6 }]}>YOUR TOP 5 WEEKS</Text>
            {d.top5.map((w) => (
              <Pressable key={w.weekStart} onPress={() => openWeek(w)} style={s.topRow} accessibilityRole="button">
                <Text style={[s.topRank, { color: w.current ? Colors.gold : Colors.textMuted }]}>{w.rank}</Text>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={s.topLabel}>{w.label.replace('W', 'Week ')}</Text>
                    <Text style={s.topRange}>{w.range}</Text>
                  </View>
                  <View style={{ height: 2, backgroundColor: Colors.separator }}>
                    <View style={{ height: 2, width: `${(w.hours / maxTop) * 100}%`, backgroundColor: w.current ? Colors.accent : '#2A4E70' }} />
                  </View>
                </View>
                <Text style={s.topHours}>{hhmm(w.hours)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable onPress={openLogbook} style={({ pressed }) => [s.ghost, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="list-outline" size={15} color={Colors.accent} />
          <Text style={s.ghostText}>Open week in logbook</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontFamily: MONO, fontSize: 9.5, color: Colors.textSecondary }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 4 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: SERIF, fontSize: 17, fontWeight: '600', color: Colors.textPrimary },
  eyebrow: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textSecondary },
  heroNum: { fontFamily: SERIF, fontSize: 76, lineHeight: 80, fontWeight: '600', letterSpacing: -2, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  heroUnit: { fontFamily: MONO, fontSize: 14, fontWeight: '700' },
  caption: { fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: Colors.textSecondary },
  strip: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.separator },
  stripCell: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 14 },
  stripValue: { fontFamily: SERIF, fontSize: 22, fontWeight: '600', color: Colors.textPrimary },
  stripLabel: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.1, color: Colors.textSecondary },
  dayCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  dayHours: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700' },
  dayDow: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  dayTitle: { fontFamily: SERIF, fontSize: 19, fontWeight: '600', color: Colors.textPrimary },
  dayTotal: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  rowOff: { fontFamily: MONO, fontSize: 10, fontWeight: '700', color: Colors.textPrimary },
  rowOn: { fontFamily: MONO, fontSize: 10, color: Colors.textSecondary },
  rowRoute: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  rowSub: { fontFamily: MONO, fontSize: 10 },
  rowDur: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  restText: { fontFamily: MONO, fontSize: 11, color: Colors.textSecondary, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  map: { height: 240, borderRadius: 16, borderWidth: 1, borderColor: Colors.separator },
  expand: { position: 'absolute', right: 10, top: 10, width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(18,26,36,0.85)', borderWidth: 1, borderColor: '#3A3F46', alignItems: 'center', justifyContent: 'center' },
  replay: { position: 'absolute', right: 10, bottom: 10, height: 32, paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: Colors.accent, flexDirection: 'row', alignItems: 'center', gap: 7 },
  replayText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: Colors.textInverse },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  topRank: { width: 18, fontFamily: SERIF, fontSize: 18, fontWeight: '600' },
  topLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  topRange: { fontFamily: MONO, fontSize: 10, color: Colors.textSecondary },
  topHours: { width: 46, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  ghost: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ghostText: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: Colors.accent },
});
