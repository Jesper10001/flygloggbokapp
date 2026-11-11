// Next licence i liggande helskärm. Samma licens som kortet (useLicenceView). Till vänster stegen PPL → CPL → ATPL,
// READY / MET / ETA och takten man räknar med: ens bästa, som de senaste 12 månaderna eller ens långsammaste, med
// datumet för var och en. Till höger Chart eller List (växeln överst): den breda kurvan (LicenceFullChart) med alla
// krav i en rad under — tryck på en ruta för att markera kravet i kurvan — eller kraven som en lista med stapel,
// timmar och datum i den valda takten. I listan går varje liten graf att förstora (förstoringsglaset vid rubriken
// eller ett tryck på grafen): den växer ut över hela högerdelen och krymper tillbaka till sin plats.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, projectionUnlock, PROJECTION_MIN_DAYS, PROJECTION_MIN_FLIGHTS } from './insightsData';
import { buildState, hoursTxt, etaFor, pacePick, monthsAt, type LicPace, type LicState } from './licenceState';
import { useLicenceSet, useLicenceView, LIC_IDS, type LicId } from './licenceView';
import { absNow, mLabel, mShort, dur, one } from './projectionModel';
import { LicenceReqMini } from './LicenceReqMini';
import { LicenceFullChart, type LicRange } from './LicenceFullChart';
import { FullscreenClose } from './FullscreenShell';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const yShort = (a: number) => `’${String(Math.floor(a / 12)).slice(2)}`;
// Uppnådda timmar avrundas nedåt och återstående uppåt, så ett krav aldrig ser klart ut innan det är det.
const haveTxt = (h: number) => hoursTxt(h < 10 ? Math.floor(h * 10) / 10 : Math.floor(h));
const toGoTxt = (h: number) => hoursTxt(h < 10 ? Math.ceil(h * 10) / 10 : Math.ceil(h));

const PACES: [LicPace, string][] = [['fast', 'Your best pace'], ['usual', 'Last 12 months'], ['slow', 'Your slowest pace']];

export function LicenceFull({ onClose }: { onClose: () => void }) {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const insets = useSafeAreaInsets();
  const { set, flights } = useLicenceSet();
  const unlock = useMemo(() => projectionUnlock(flights), [flights]);
  const [listW, setListW] = useState(0);
  const selId = useLicenceView((s) => s.sel);
  const [pace, setPace] = useState<LicPace>('usual');
  const [range, setRange] = useState<LicRange>('recent');
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const tap = () => { Haptics.selectionAsync().catch(() => {}); };

  // Förstorad graf (listan): rutan växer från den lilla grafens plats till hela högerdelen. from = den lilla
  // grafens ram i högerdelens koordinater, uppmätt när man trycker; col = högerdelens storlek.
  const colRef = useRef<View>(null);
  const miniRefs = useRef<Record<string, View | null>>({});
  const [col, setCol] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<{ key: string; from: { x: number; y: number; w: number; h: number } } | null>(null);
  const grow = useRef(new Animated.Value(0)).current;
  const zoomIn = (key: string) => {
    const mini = miniRefs.current[key], host = colRef.current;
    if (!mini || !host || zoom) return;
    tap();
    host.measureInWindow((hx, hy) => {
      mini.measureInWindow((x, y, w, h) => {
        if (!(w > 0 && h > 0)) return;
        grow.setValue(0);
        setZoom({ key, from: { x: x - hx, y: y - hy, w, h } });
        Animated.timing(grow, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      });
    });
  };
  const zoomOut = () => {
    if (!zoom) return;
    tap();
    Animated.timing(grow, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setZoom(null); });
  };
  // Byter man licens eller vy är den förstorade grafen inte längre aktuell.
  useEffect(() => { setZoom(null); grow.setValue(0); }, [selId, view, grow]);

  const pad = {
    paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16),
    paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 10),
  };
  if (!set) {
    return (
      <View style={[{ flex: 1, gap: 10 }, pad]}>
        <FullscreenClose C={C} onPress={onClose} />
        <Text style={{ fontFamily: MONO, fontSize: 12, color: C.text2 }}>Licence tracking isn{'’'}t available for the {'"'}Other{'"'} framework.</Text>
      </View>
    );
  }

  const nowA = absNow();
  const startA = D.journey.length ? D.journey[0].date.getFullYear() * 12 + D.journey[0].date.getMonth() : nowA;
  const states: Record<LicId, LicState> = { ppl: buildState(set.ppl, D, nowA), cpl: buildState(set.cpl, D, nowA), atpl: buildState(set.atpl, D, nowA) };
  const current = LIC_IDS.find((id) => !states[id].done) ?? 'atpl';
  const sel = selId ?? current;
  const S = states[sel];
  const pick = pacePick(pace);
  const E = etaFor(S, pick);
  const etas = { fast: etaFor(S, pacePick('fast')), usual: etaFor(S, pacePick('usual')), slow: etaFor(S, pacePick('slow')) };
  const etaA = E.m != null ? nowA + E.m : null;
  const readyPct = S.done ? 100 : Math.min(99, Math.floor(S.ready * 100));

  // Före 60 dagar och 10 flygningar finns inga datum (som Projections): bara listan med timmarna.
  const datesLocked = !unlock.ready && !S.done;
  const shownView = datesLocked ? 'list' : view;
  const flightsLeft = Math.max(0, PROJECTION_MIN_FLIGHTS - unlock.flights);
  const daysOk = unlock.days >= PROJECTION_MIN_DAYS;
  const unlockDay = unlock.unlockDate ? `${unlock.unlockDate.getDate()} ${mShort(unlock.unlockDate.getFullYear() * 12 + unlock.unlockDate.getMonth()).split(' ')[0]}` : '';
  const lockWhen = !daysOk && flightsLeft > 0 ? `Dates from ${unlockDay}, after ${flightsLeft} more flights`
    : !daysOk ? `Dates from ${unlockDay}` : `Dates after ${flightsLeft} more ${flightsLeft === 1 ? 'flight' : 'flights'}`;
  const miniW = listW > 0 ? Math.floor((listW - 18) / 2) : 0;

  let subLeft: string;
  if (datesLocked) subLeft = lockWhen;
  else if (S.done) subLeft = `All ${S.reqs.length} requirements met${S.doneA != null ? ` · ${dur(Math.max(0, S.doneA - startA))} from first flight` : ''}`;
  else if (E.m == null) subLeft = `No ${E.lim?.short ?? ''} time in the last 12 months`;
  else subLeft = `${E.lim?.short ?? ''} sets the date · ${toGoTxt(E.lim?.toGo ?? 0)} h`;

  return (
    <View style={[{ flex: 1, flexDirection: 'row', gap: 18 }, pad]}>
      <ScrollView style={{ width: 222, flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1, gap: 10 }} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 }}>
          <Ionicons name="ribbon-outline" size={17} color={C.text2} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: SERIF, fontSize: 19, fontWeight: '600', color: C.text }}>Next licence</Text>
          <FullscreenClose C={C} onPress={onClose} />
        </View>

        {/* Stegen som tre lika breda rutor på två rader (koden, sedan året eller procenten), så året syns även för (H). */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {LIC_IDS.map((id, i) => {
            const L2 = states[id], on = id === sel, cur = id === current && !L2.done;
            const color = cur || on ? C.text : L2.done ? C.text2 : C.muted;
            const p = Math.min(99, Math.floor(L2.ready * 100));
            return (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                {i > 0 ? <View style={{ width: 6, height: 1, backgroundColor: C.border }} /> : null}
                <TouchableOpacity onPress={() => { tap(); useLicenceView.setState({ sel: id }); setFocus(null); }}
                  accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={L2.done && L2.doneA != null ? `${L2.code}, complete ${mLabel(L2.doneA)}` : `${L2.code}, ${p} percent ready`}
                  hitSlop={{ top: 6, bottom: 6 }}
                  style={[st.rung, {
                    borderColor: on ? 'rgba(255,255,255,0.55)' : C.border, borderStyle: L2.done || cur ? 'solid' : 'dashed',
                    backgroundColor: on ? C.elevated : 'transparent',
                  }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    {L2.done ? <Ionicons name="checkmark" size={9} color={color} /> : null}
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1, fontFamily: MONO, fontSize: 10, fontWeight: '700', color }}>{L2.code}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9, fontWeight: '500', color: C.muted }}>
                    {L2.done && L2.doneA != null ? yShort(L2.doneA) : `${p}%`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <View style={{ gap: 3 }}>
            <Text style={[st.cap, { color: C.text2 }]}>READY</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
              <Text style={[st.led, { color: C.text }]}>{readyPct}</Text>
              <Text style={[st.unit, { color: C.muted }]}>%</Text>
            </View>
          </View>
          <View style={{ width: 1, height: 30, backgroundColor: C.border, marginBottom: 2 }} />
          <View style={{ gap: 3 }}>
            <Text style={[st.cap, { color: C.text2 }]}>MET</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
              <Text style={[st.led, { color: C.text }]}>{S.metCount}</Text>
              <Text style={[st.unit, { color: C.text2, fontSize: 11 }]}>/{S.reqs.length}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ gap: 1, flexShrink: 1 }}>
            <Text style={[st.cap, { color: C.text2 }]}>{S.done ? 'COMPLETE' : datesLocked ? 'DATES' : 'ETA'}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: C.text }}>
              {S.done ? mLabel(S.doneA ?? nowA) : datesLocked ? 'Locked' : etaA != null ? mLabel(etaA) : '—'}
            </Text>
          </View>
          {!S.done && !datesLocked && E.m != null ? <Text style={[st.small, { color: C.text2, paddingBottom: 4 }]}>in {dur(E.m)}</Text> : null}
        </View>
        <Text style={[st.small, { color: C.text2, marginTop: -4 }]}>{subLeft}</Text>

        {!S.done && !datesLocked ? (
          <View style={{ marginTop: 'auto', gap: 6 }}>
            <Text style={[st.cap, { color: C.text2 }]}>IF YOU FLY AT</Text>
            {PACES.map(([k, label]) => {
              const on = pace === k, e = etas[k];
              return (
                <TouchableOpacity key={k} onPress={() => { tap(); setPace(k); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={[st.paceRow, { borderColor: on ? C.primary : C.border, backgroundColor: on ? C.primary + '1A' : C.elevated }]}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: MONO, fontSize: 10.5, fontWeight: '600', color: on ? C.text : C.text2 }}>{label}</Text>
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: on ? C.text : C.text2 }}>{e.m != null ? mLabel(nowA + e.m) : '—'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </ScrollView>

      <View ref={colRef} collapsable={false} style={{ flex: 1, minWidth: 0, gap: 10 }}
        onLayout={(e) => setCol({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) })}>
        {!datesLocked ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <View style={[st.seg, { backgroundColor: C.deep }]}>
            {(['chart', 'list'] as const).map((v) => {
              const on = view === v;
              return (
                <TouchableOpacity key={v} onPress={() => { tap(); setView(v); setFocus(null); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={v === 'chart' ? 'Show as chart' : 'Show as list'} hitSlop={{ top: 8, bottom: 8 }}
                  style={[st.segBtn, { backgroundColor: on ? C.elevated : 'transparent' }]}>
                  <Ionicons name={v === 'chart' ? 'analytics-outline' : 'list'} size={11} color={on ? C.text : C.muted} />
                  <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: on ? C.text : C.muted }}>{v === 'chart' ? 'Chart' : 'List'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View> : null}
        {shownView === 'chart' ? (<>
        <LicenceFullChart C={C} S={S} nowA={nowA} startA={startA} pick={pick} etaM={E.m} lim={E.lim}
          scaleM={etas.slow.m ?? etas.usual.m} focus={focus} range={range} onRange={setRange} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {S.reqs.map((r) => {
            const on = focus === r.key, isLim = !S.done && r === E.lim, m = monthsAt(r, pick);
            const value = r.met ? `✓ ${mShort(r.metA ?? nowA)}` : m != null ? mShort(nowA + m) : 'No pace';
            const p = Math.min(1, r.have / r.required);
            return (
              <TouchableOpacity key={r.key} onPress={() => { tap(); setFocus(on ? null : r.key); }}
                accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={r.met ? `${r.label}, met ${mLabel(r.metA ?? nowA)}`
                  : `${r.label}, ${toGoTxt(r.toGo)} hours to go${m != null ? `, ${mLabel(nowA + m)}` : ''}`}
                style={[st.tile, { borderColor: on ? C.primary : isLim ? C.quiet : C.border, backgroundColor: on ? C.primary + '1A' : C.elevated }]}>
                <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: C.text2 }}>{r.short.toUpperCase()}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: r.met ? C.text2 : m == null ? C.muted : C.text }}>{value}</Text>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: C.bg, overflow: 'hidden' }}>
                  <View style={{ width: `${p * 100}%`, height: '100%', borderRadius: 2, backgroundColor: r.met ? C.quiet : C.primary }} />
                </View>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: C.text2 }}>
                  {haveTxt(r.have)}<Text style={{ fontWeight: '400', color: C.muted }}>/{hoursTxt(r.required)}</Text>
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        </>) : (
          // List: alla krav i två kolumner, var och en med en egen liten graf (LicenceReqMini) och egen tidsaxel;
          // datumen i den takt som är vald till vänster.
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 10, paddingTop: 2, paddingBottom: 6 }}
            showsVerticalScrollIndicator={false} onLayout={(e) => setListW(Math.round(e.nativeEvent.layout.width))}>
            {S.reqs.map((r) => {
              const isLim = !S.done && !datesLocked && E.m != null && r === E.lim;
              const m = datesLocked ? null : monthsAt(r, pick);
              const when = r.met ? `✓ ${mShort(r.metA ?? nowA)}` : datesLocked ? `${toGoTxt(r.toGo)} h to go` : m != null ? mShort(nowA + m) : 'No pace';
              const whenColor = r.met || datesLocked ? C.text2 : m == null ? C.muted : C.text;
              const foot = r.met ? `+${hoursTxt(Math.max(0, r.have - r.required))} h over` : datesLocked ? '' : m != null ? `${one(pick(r))} h/mo` : 'No pace';
              return (
                <View key={r.key} style={{ width: miniW || '45%', gap: 3 }}
                  accessible accessibilityLabel={r.met ? `${r.label}, met ${mLabel(r.metA ?? nowA)}`
                    : `${r.label}, ${haveTxt(r.have)} of ${hoursTxt(r.required)} hours, ${toGoTxt(r.toGo)} to go${m != null ? `, ${mLabel(nowA + m)}` : ''}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, fontWeight: '600', color: C.text }}>{r.label}</Text>
                    <TouchableOpacity onPress={() => zoomIn(r.key)} accessibilityRole="button" accessibilityLabel={`Enlarge the chart for ${r.label}`}
                      hitSlop={{ top: 11, bottom: 11, left: 8, right: 11 }} style={[st.zoomBtn, { borderColor: C.border, backgroundColor: C.elevated }]}>
                      <MaterialCommunityIcons name="magnify-plus-outline" size={14} color={C.text2} />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }} />
                    {isLim ? (
                      <View style={{ paddingVertical: 2, paddingHorizontal: 5, borderRadius: 5, borderWidth: 1, borderColor: C.quiet }}>
                        <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: C.soft }}>SETS THE DATE</Text>
                      </View>
                    ) : null}
                    <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: whenColor }}>{when}</Text>
                  </View>
                  {miniW > 0 ? (
                    <TouchableOpacity activeOpacity={0.8} onPress={() => zoomIn(r.key)} accessible={false}>
                      <View ref={(v) => { miniRefs.current[r.key] = v; }} collapsable={false} style={{ borderRadius: 8, overflow: 'hidden' }}>
                        <LicenceReqMini C={C} r={r} w={miniW} a0={startA} nowA={nowA} m={m} isLim={isLim} />
                      </View>
                    </TouchableOpacity>
                  ) : <View style={{ height: 60 }} />}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: r.met ? C.text2 : C.text }}>
                      {haveTxt(r.have)}<Text style={{ fontWeight: '400', color: C.muted }}>/{hoursTxt(r.required)} h</Text>
                    </Text>
                    {foot ? <Text style={{ fontFamily: MONO, fontSize: 9.5, color: C.text2 }}>{foot}</Text> : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Förstorad graf: samma krav, stort, över hela högerdelen. Rutan skalas från den lilla grafens ram till
            full storlek (transform, så animeringen går på den inbyggda tråden); innehållet tonar in på vägen. */}
        {zoom && shownView === 'list' && col.w > 0 && (() => {
          const r = S.reqs.find((x) => x.key === zoom.key);
          if (!r) return null;
          const isLim = !S.done && !datesLocked && E.m != null && r === E.lim;
          const m = datesLocked ? null : monthsAt(r, pick);
          const when = r.met ? `✓ ${mLabel(r.metA ?? nowA)}` : datesLocked ? `${toGoTxt(r.toGo)} h to go` : m != null ? mLabel(nowA + m) : 'No pace';
          const foot = r.met ? `+${hoursTxt(Math.max(0, r.have - r.required))} h over` : datesLocked ? '' : m != null ? `${one(pick(r))} h/mo` : 'No pace';
          const f = zoom.from;
          const PADX = 14, HEAD = 40, FOOT = 26;
          const chartW = col.w - PADX * 2, chartH = Math.max(120, col.h - HEAD - FOOT - 24);
          const box = {
            transform: [
              { translateX: grow.interpolate({ inputRange: [0, 1], outputRange: [f.x + f.w / 2 - col.w / 2, 0] }) },
              { translateY: grow.interpolate({ inputRange: [0, 1], outputRange: [f.y + f.h / 2 - col.h / 2, 0] }) },
              { scaleX: grow.interpolate({ inputRange: [0, 1], outputRange: [f.w / col.w, 1] }) },
              { scaleY: grow.interpolate({ inputRange: [0, 1], outputRange: [f.h / col.h, 1] }) },
            ],
            opacity: grow.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 1] }),
          };
          const inner = { opacity: grow.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }) };
          return (
            <Animated.View style={[st.zoomBox, { width: col.w, height: col.h, backgroundColor: C.bg, borderColor: C.border }, box]}>
              <Animated.View style={[{ flex: 1, paddingHorizontal: PADX, paddingTop: 8, paddingBottom: 10, gap: 6 }, inner]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 28 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: C.text }}>{r.label}</Text>
                  {isLim ? (
                    <View style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1, borderColor: C.quiet }}>
                      <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, color: C.soft }}>SETS THE DATE</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: r.met || datesLocked ? C.text2 : m == null ? C.muted : C.text }}>{when}</Text>
                  <TouchableOpacity onPress={zoomOut} accessibilityRole="button" accessibilityLabel="Back to all charts"
                    hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }} style={[st.zoomBtn, { width: 28, height: 28, borderColor: C.border, backgroundColor: C.elevated }]}>
                    <MaterialCommunityIcons name="magnify-minus-outline" size={17} color={C.text} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity activeOpacity={0.9} onPress={zoomOut} accessible={false} style={{ borderRadius: 10, overflow: 'hidden' }}>
                  <LicenceReqMini C={C} r={r} w={chartW} h={chartH} a0={startA} nowA={nowA} m={m} isLim={isLim} />
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: r.met ? C.text2 : C.text }}>
                    {haveTxt(r.have)}<Text style={{ fontWeight: '400', color: C.muted }}>/{hoursTxt(r.required)} h</Text>
                    {!r.met ? <Text style={{ fontWeight: '400', color: C.text2 }}>{`  ·  ${toGoTxt(r.toGo)} h to go`}</Text> : null}
                  </Text>
                  {foot ? <Text style={{ fontFamily: MONO, fontSize: 12, color: C.text2 }}>{foot}</Text> : null}
                </View>
              </Animated.View>
            </Animated.View>
          );
        })()}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cap: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  small: { fontFamily: MONO, fontSize: 10 },
  led: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22 },
  unit: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  rung: { flex: 1, minWidth: 0, minHeight: 38, paddingHorizontal: 4, paddingVertical: 4, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 1 },
  paceRow: { minHeight: 36, borderRadius: 9, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10 },
  tile: { flex: 1, minWidth: 0, minHeight: 62, borderRadius: 11, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 8, justifyContent: 'center', gap: 4 },
  zoomBtn: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  zoomBox: { position: 'absolute', left: 0, top: 0, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  seg: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 9 },
  segBtn: { minHeight: 24, paddingHorizontal: 8, borderRadius: 7, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
