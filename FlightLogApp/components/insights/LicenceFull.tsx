// Next licence i liggande helskärm. Samma licens som kortet (useLicenceView). Till vänster stegen PPL → CPL → ATPL,
// READY / MET / ETA och takten man räknar med: ens bästa, som de senaste 12 månaderna eller ens långsammaste, med
// datumet för var och en. Till höger den breda kurvan (LicenceFullChart) och alla krav i en rad under, med stapel,
// timmar och datum i samma ruta, så Chart och List blir en vy. Tryck på en ruta för att markera kravet i kurvan.

import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData } from './insightsData';
import { buildState, hoursTxt, etaFor, pacePick, monthsAt, type LicPace, type LicState } from './licenceState';
import { useLicenceSet, useLicenceView, LIC_IDS, type LicId } from './licenceView';
import { absNow, mLabel, mShort, dur } from './projectionModel';
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
  const { set } = useLicenceSet();
  const selId = useLicenceView((s) => s.sel);
  const [pace, setPace] = useState<LicPace>('usual');
  const [range, setRange] = useState<LicRange>('recent');
  const [focus, setFocus] = useState<string | null>(null);
  const tap = () => { Haptics.selectionAsync().catch(() => {}); };

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

  let subLeft: string;
  if (S.done) subLeft = `All ${S.reqs.length} requirements met${S.doneA != null ? ` · ${dur(Math.max(0, S.doneA - startA))} from first flight` : ''}`;
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
            <Text style={[st.cap, { color: C.text2 }]}>{S.done ? 'COMPLETE' : 'ETA'}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: C.text }}>
              {S.done ? mLabel(S.doneA ?? nowA) : etaA != null ? mLabel(etaA) : '—'}
            </Text>
          </View>
          {!S.done && E.m != null ? <Text style={[st.small, { color: C.text2, paddingBottom: 4 }]}>in {dur(E.m)}</Text> : null}
        </View>
        <Text style={[st.small, { color: C.text2, marginTop: -4 }]}>{subLeft}</Text>

        {!S.done ? (
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

      <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
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
});
