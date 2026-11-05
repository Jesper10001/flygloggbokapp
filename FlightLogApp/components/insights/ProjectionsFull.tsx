// Projections i liggande helskärm. Samma val som kortet (useProjectionView), så man kommer tillbaka till samma läge.
// Till vänster NOW → TARGET, ETA, det troliga fönstret, milstolparna och sorts tid. Till höger den breda kurvan
// (ProjectionFullChart) och under den takten med "What if". Inga bottenpaneler: allt ändras direkt på skärmen.

import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH } from './insightsData';
import {
  CATS, labelOf, milestonesFor, stepFor, absNow, mLabel, mShort, dur, one, led,
  useProjectionView, setProjectionMetric, projectionModel, type PaceMode,
} from './projectionModel';
import { ProjectionFullChart, type ChartRange } from './ProjectionFullChart';
import { FullscreenClose } from './FullscreenShell';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const RAIL = 214;

export function ProjectionsFull({ onClose }: { onClose: () => void }) {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const insets = useSafeAreaInsets();
  const view = useProjectionView();
  const [range, setRange] = useState<ChartRange>('all');
  const nowA = absNow();
  const M = projectionModel(D, view, nowA);
  const { metric, paceMode } = view;
  const etaA = M.etaM != null ? nowA + M.etaM : null;
  const tap = () => { Haptics.selectionAsync().catch(() => {}); };
  const setTarget = (t: number) => useProjectionView.setState({ target: t });
  const setPace = (p: PaceMode, custom = 0) => useProjectionView.setState({ paceMode: p, customPace: custom });

  return (
    <View style={{
      flex: 1, flexDirection: 'row', gap: 18,
      paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16),
      paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 10),
    }}>
      <ScrollView style={{ width: RAIL, flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1, gap: 8 }} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 }}>
          <Ionicons name="trending-up" size={17} color={C.text2} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: SERIF, fontSize: 19, fontWeight: '600', color: C.text }}>Projections</Text>
          <FullscreenClose C={C} onPress={onClose} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
          <View style={{ gap: 3 }}>
            <Text style={[st.cap, { color: C.text2 }]}>NOW</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
              <Text style={[st.led, { color: C.text }]}>{led(M.have)}</Text>
              <Text style={[st.unit, { color: C.primary }]}>h</Text>
            </View>
          </View>
          <Ionicons name="arrow-forward" size={14} color={C.text2} style={{ marginBottom: 6 }} />
          <View style={{ gap: 3 }}>
            <Text style={[st.cap, { color: C.text2 }]}>TARGET</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
              <Text style={[st.led, { color: C.soft }]}>{led(M.tgt)}</Text>
              <Text style={[st.unit, { color: C.muted }]}>h</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ gap: 1, flexShrink: 1 }}>
            <Text style={[st.cap, { color: C.text2 }]}>ETA</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: C.text }}>
              {etaA != null ? mLabel(etaA) : '—'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2, paddingBottom: 4 }}>
            <Text style={[st.small, { color: C.text2 }]}>{fmtIntH(M.toGo)} h to go</Text>
            <Text style={[st.small, { color: C.text2 }]}>{M.etaM != null ? `in ${dur(M.etaM)}` : 'no pace yet'}</Text>
          </View>
        </View>

        <View style={{ gap: 3 }}>
          <Text style={[st.small, { color: C.text2 }]}>
            {M.hasWindow ? `likely ${mShort(M.fastA!)}–${mShort(M.slowA!)}` : M.etaM == null ? `No ${labelOf(metric)} time in the last 12 months` : ''}
          </Text>
          <Text style={[st.small, { fontWeight: '700', color: paceMode === 'r12' ? C.text : M.diff >= 0 ? C.primary : C.text2 }]}>{M.paceDelta}</Text>
        </View>

        <View style={{ marginTop: 'auto', gap: 8 }}>
          <View style={{ gap: 6 }}>
            <Text style={[st.cap, { color: C.text2 }]}>NEXT MILESTONES</Text>
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {milestonesFor(M.have).map((q) => {
                const sel = q === M.tgt;
                return (
                  <TouchableOpacity key={q} onPress={() => { tap(); setTarget(q); }} accessibilityLabel={`Set the target to ${fmtIntH(q)} hours`}
                    accessibilityState={{ selected: sel }}
                    style={[st.mile, { borderColor: sel ? C.soft : C.border, backgroundColor: sel ? C.soft + '14' : C.elevated }]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: C.text }}>{fmtIntH(q)}</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 9, color: sel ? C.text : C.text2 }}>
                      {M.pace > 0 ? mShort(nowA + Math.ceil((q - M.have) / M.pace)) : '—'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[st.cap, { color: C.text2 }]}>KIND OF TIME</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
              {CATS.map((k) => {
                const on = k.key === metric;
                return (
                  <TouchableOpacity key={k.key} onPress={() => { tap(); setProjectionMetric(k.key); }} accessibilityState={{ selected: on }}
                    style={[st.kind, { borderColor: on ? C.primary : C.border, backgroundColor: on ? C.primary : C.elevated }]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: on ? C.deep : C.text2 }}>{k.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
        <ProjectionFullChart C={C} series={M.series} have={M.have} target={M.tgt} pace={M.pace} fast={M.fast} slow={M.slow}
          step={stepFor(M.have)} snap={M.snap} minTarget={M.minTarget} nowA={nowA}
          range={range} onRange={setRange} onTarget={(v) => setTarget(v)} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40 }}>
          <Text style={[st.cap, { color: C.text2 }]}>PACE</Text>
          <View style={[st.seg, { backgroundColor: C.deep }]}>
            {([['r3', 'Last 3 mo'], ['r12', 'Last 12 mo'], ['career', 'Career']] as const).map(([k, label]) => {
              const sel = paceMode === k;
              return (
                <TouchableOpacity key={k} onPress={() => { tap(); setPace(k); }} accessibilityState={{ selected: sel }}
                  style={[st.segBtn, sel && { backgroundColor: C.primary }]}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 9, color: sel ? C.deep : C.text2 }}>{label}</Text>
                  <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: sel ? C.deep : C.text2 }}>{one(M.P[k])}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity accessibilityLabel="Fly less each month" style={[st.step, { borderColor: C.border, backgroundColor: C.elevated }]}
            onPress={() => { tap(); setPace('custom', Math.max(M.paceStep, Math.round((M.pace - M.paceStep) * 10) / 10)); }}>
            <Ionicons name="remove" size={18} color={C.text} />
          </TouchableOpacity>
          <View style={{ width: 74, alignItems: 'center', gap: 1 }}>
            <Text style={[st.cap, { fontSize: 8.5, letterSpacing: 1.2, color: C.text2 }]}>WHAT IF</Text>
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: paceMode === 'custom' ? C.primary : C.text }}>{one(M.pace)} h/mo</Text>
          </View>
          <TouchableOpacity accessibilityLabel="Fly more each month" style={[st.step, { borderColor: C.border, backgroundColor: C.elevated }]}
            onPress={() => { tap(); setPace('custom', Math.round((M.pace + M.paceStep) * 10) / 10); }}>
            <Ionicons name="add" size={18} color={C.text} />
          </TouchableOpacity>
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
  mile: { flex: 1, minHeight: 42, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  kind: { width: (RAIL - 10) / 3, minHeight: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  seg: { flex: 1, flexDirection: 'row', gap: 3, padding: 3, borderRadius: 11 },
  segBtn: { flex: 1, minWidth: 0, minHeight: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: 4 },
  step: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
