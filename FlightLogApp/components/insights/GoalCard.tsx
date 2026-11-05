// Insights §4 — Projections. Kompakt kort: NOW → TARGET → ETA, en kumulativ kurva där målet dras
// med fingret (ProjectionChart) och tre delvyer i bottenpaneler: Target (sorts tid och mål), Pace (takten och
// "tänk om") och Goals (egna mål i den ordning de nås, sparade i settings). Låst tills loggboken har 60 dagar
// och 10 flygningar (ProjectionsLocked).

import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useFlightStore } from '../../store/flightStore';
import { getSetting, setSetting } from '../../db/flights';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme, type InsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH, projectionUnlock } from './insightsData';
import {
  MON3, CATS, labelOf, milestonesFor, stepFor, absNow, absOfIso, mLabel, mShort, dur, one, led,
  useProjectionView, setProjectionMetric, projectionModel, type PaceMode,
} from './projectionModel';
import { ProjectionChart } from './ProjectionChart';
import { ProjectionSheet } from './ProjectionSheet';
import { ProjectionsLocked } from './ProjectionsLocked';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const GOALS_KEY = 'projection_goals';

type SheetKind = 'target' | 'pace' | 'goals';
interface Goal { key: string; hours: number }

export function GoalCard({ onDrag }: { onDrag?: (active: boolean) => void }) {
  const flights = useFlightStore((s) => s.flights);
  const unlock = useMemo(() => projectionUnlock(flights), [flights]);
  return unlock.ready ? <Projections onDrag={onDrag} /> : <ProjectionsLocked unlock={unlock} />;
}

function Projections({ onDrag }: { onDrag?: (active: boolean) => void }) {
  const C = useInsightsTheme();
  const D = useInsightsData();
  // Sorts tid, mål och takt delas med helskärmen (projectionModel).
  const view = useProjectionView();
  const { metric, paceMode } = view;
  const setTarget = (t: number | null) => useProjectionView.setState({ target: t });
  const setPaceMode = (p: PaceMode) => useProjectionView.setState({ paceMode: p });
  const setCustomPace = (n: number) => useProjectionView.setState({ customPace: n });
  const [sheet, setSheet] = useState<SheetKind>('target');
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState('pic');
  const [addHours, setAddHours] = useState(0);

  useEffect(() => {
    getSetting(GOALS_KEY).then((v) => {
      const g = v ? JSON.parse(v) : [];
      if (Array.isArray(g)) setGoals(g.filter((x) => x && CATS.some((c) => c.key === x.key) && Number(x.hours) > 0));
    }).catch(() => {});
  }, []);
  const saveGoals = (g: Goal[]) => { setGoals(g); setSetting(GOALS_KEY, JSON.stringify(g)).catch(() => {}); };

  const nowA = absNow();
  const haveOf = (k: string) => { const s = D.seriesFor(k); return s.length ? s[s.length - 1].cum : 0; };
  const { series, have, monthly, P, pace, snap, minTarget, tgt, toGo, etaM, fast, slow, fastA, slowA, hasWindow, mult, diff, paceDelta, paceStep } =
    projectionModel(D, view, nowA);

  const setMetric = setProjectionMetric;
  const openSheet = (s: SheetKind) => { setSheet(s); setAdding(false); setOpen(true); };

  // Målen: varje kategori i sin egen 12-månaderstakt, skalad som takten ovan (flyger man mer, flyger man mer av allt).
  const built = goals.map((g, idx) => {
    const h = haveOf(g.key), reached = h >= g.hours, rate = D.rateFor(g.key) * mult;
    const met = reached ? D.metDateFor(g.key, g.hours) : null;
    const at = reached ? (met ? absOfIso(met) : nowA) : rate > 0 ? nowA + Math.ceil((g.hours - h) / rate) : null;
    return { g, idx, h, reached, at };
  }).sort((a, b) => (a.reached === b.reached ? 0 : a.reached ? -1 : 1) || (a.at ?? Infinity) - (b.at ?? Infinity));
  const firstOpen = built.findIndex((b) => !b.reached);
  const nextGoal = firstOpen >= 0 ? built[firstOpen] : null;

  const addHave = haveOf(addKey), addStep = stepFor(addHave) / 5;
  const addRate = D.rateFor(addKey) * mult;
  const addM = addRate > 0 ? Math.ceil(Math.max(0, addHours - addHave) / addRate) : null;

  const titles: Record<SheetKind, [string, string]> = {
    target: ['Projection', 'Choose the time and the target'],
    pace: ['Pace', 'How much you fly a month'],
    goals: ['Your goals', 'In the order you reach them'],
  };
  const last12 = series.slice(-12).map((p, i, arr) => ({ p, h: monthly[monthly.length - arr.length + i] }));
  const barMax = Math.max(pace, ...last12.map((b) => b.h), 0.1) * 1.15;

  const Stepper = ({ label, onPress, icon }: { label: string; onPress: () => void; icon: 'remove' | 'add' }) => (
    <TouchableOpacity onPress={onPress} accessibilityLabel={label} style={[st.step, { borderColor: C.border, backgroundColor: C.elevated }]}>
      <Ionicons name={icon} size={20} color={C.text} />
    </TouchableOpacity>
  );

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Ionicons name="trending-up" size={17} color={C.text2} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: C.text }}>Projections</Text>
        <FullscreenButton C={C} label="Open Projections in full screen" onPress={() => router.push('/projections-full')} />
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => openSheet('target')} accessibilityLabel={`${labelOf(metric)} time. Change the kind of time`}
          style={[st.chip, { borderColor: C.border, backgroundColor: C.elevated }]}>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.text }}>{labelOf(metric)}</Text>
          <Ionicons name="chevron-down" size={11} color={C.muted} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
        <View style={{ gap: 3 }}>
          <Text style={[st.cap, { color: C.text2 }]}>NOW</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={[st.led, { color: C.text }]}>{led(have)}</Text>
            <Text style={[st.unit, { color: C.primary }]}>h</Text>
          </View>
        </View>
        <Ionicons name="arrow-forward" size={14} color={C.text2} style={{ marginBottom: 6 }} />
        <View style={{ gap: 3 }}>
          <Text style={[st.cap, { color: C.text2 }]}>TARGET</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={[st.led, { color: C.soft }]}>{led(tgt)}</Text>
            <Text style={[st.unit, { color: C.muted }]}>h</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end', gap: 1, minWidth: 0 }}>
          <Text style={[st.cap, { color: C.text2 }]}>ETA</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 24, fontWeight: '600', color: C.text }}>
            {etaM != null ? mLabel(nowA + etaM) : '—'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: -4 }}>
        <Text style={[st.small, { color: C.text2 }]}>
          {etaM != null ? `${fmtIntH(toGo)} h to go · ${dur(etaM)}` : `No ${labelOf(metric)} time in the last 12 months`}
        </Text>
        {hasWindow ? <Text style={[st.small, { color: C.text2 }]}>likely {mShort(fastA!)}{'–'}{mShort(slowA!)}</Text> : null}
      </View>

      <ProjectionChart C={C} series={series} have={have} target={tgt} pace={pace} fast={fast} slow={slow}
        snap={snap} minTarget={minTarget} nowA={nowA} onTarget={(v) => setTarget(v)} onDrag={onDrag} />

      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Opener C={C} label="TARGET" value={`${fmtIntH(tgt)} h`} valueColor={C.text} onPress={() => openSheet('target')} />
        <Opener C={C} label="PACE" value={`${one(pace)} h/mo`} valueColor={paceMode === 'r12' ? C.text : C.primary} onPress={() => openSheet('pace')} />
        <Opener C={C} label="GOALS" value={nextGoal?.at != null ? `Next ${mShort(nextGoal.at)}` : goals.length ? `${goals.length} done` : 'Add one'}
          valueColor={C.text} onPress={() => openSheet('goals')} />
      </View>

      <ProjectionSheet C={C} visible={open} title={titles[sheet][0]} sub={titles[sheet][1]} onClose={() => { setOpen(false); setAdding(false); }}>
        {sheet === 'target' && (
          <>
            <View style={{ gap: 7 }}>
              <Text style={[st.cap, { color: C.text2 }]}>KIND OF TIME</Text>
              <View style={st.grid3}>
                {CATS.map((k) => (
                  <Chip key={k.key} C={C} label={k.label} selected={k.key === metric} onPress={() => setMetric(k.key)} />
                ))}
              </View>
            </View>
            <View style={{ gap: 7 }}>
              <Text style={[st.cap, { color: C.text2 }]}>TARGET</Text>
              <View style={[st.stepRow, { backgroundColor: C.deep }]}>
                <Stepper label="Lower the target" icon="remove" onPress={() => setTarget(Math.max(minTarget, tgt - snap))} />
                <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                    <Text style={[st.led, { fontSize: 30, color: C.soft }]}>{led(tgt)}</Text>
                    <Text style={[st.unit, { color: C.muted }]}>h</Text>
                  </View>
                  <Text style={[st.small, { color: C.text2 }]}>{etaM != null ? `ETA ${mLabel(nowA + etaM)} · ${dur(etaM)}` : 'No pace yet'}</Text>
                </View>
                <Stepper label="Raise the target" icon="add" onPress={() => setTarget(tgt + snap)} />
              </View>
            </View>
            <View style={{ gap: 7 }}>
              <Text style={[st.cap, { color: C.text2 }]}>NEXT MILESTONES</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {milestonesFor(have).map((q) => {
                  const sel = q === tgt;
                  return (
                    <TouchableOpacity key={q} onPress={() => setTarget(q)} accessibilityLabel={`Set the target to ${fmtIntH(q)} hours`}
                      style={[st.quick, { borderColor: sel ? C.soft : C.border, backgroundColor: sel ? C.soft + '14' : C.elevated }]}>
                      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: C.text }}>{fmtIntH(q)}</Text>
                      <Text style={{ fontFamily: MONO, fontSize: 9.5, color: sel ? C.text : C.text2 }}>
                        {pace > 0 ? mShort(nowA + Math.ceil((q - have) / pace)) : '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {hasWindow ? (
              <Text style={[st.note, { color: C.text2, borderColor: C.border, backgroundColor: C.elevated }]}>
                Likely between {mLabel(fastA!)} and {mLabel(slowA!)}, depending on how much you fly. The shaded wedge on the chart.
              </Text>
            ) : null}
          </>
        )}

        {sheet === 'pace' && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={[st.cap, { color: C.text2 }]}>LAST 12 MONTHS {'·'} {labelOf(metric).toUpperCase()}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: C.text }}>
                {one(pace)} <Text style={{ fontSize: 10.5, fontWeight: '400', color: C.text2 }}>h/mo</Text>
              </Text>
            </View>
            <View style={{ height: 70, paddingBottom: 14 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
                {last12.map((b, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    <View style={{ width: '100%', maxWidth: 18, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
                      height: Math.max(2, (b.h / barMax) * 56), backgroundColor: i === last12.length - 1 ? C.primary : C.primary + '55' }} />
                    <Text style={{ position: 'absolute', bottom: -14, fontFamily: MONO, fontSize: 9, color: C.text2 }}>{MON3[b.p.date.getMonth()].charAt(0)}</Text>
                  </View>
                ))}
              </View>
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 14 + (pace / barMax) * 56, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.soft }} />
            </View>
            <View style={[st.seg, { backgroundColor: C.deep }]}>
              {([['r3', 'Last 3 mo'], ['r12', 'Last 12 mo'], ['career', 'Career']] as const).map(([k, label]) => {
                const sel = paceMode === k;
                return (
                  <TouchableOpacity key={k} onPress={() => { setPaceMode(k); setCustomPace(0); }} accessibilityState={{ selected: sel }}
                    style={[st.segBtn, sel && { backgroundColor: C.primary }]}>
                    <Text style={{ fontFamily: MONO, fontSize: 10, color: sel ? C.deep : C.text2 }}>{label}</Text>
                    <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: sel ? C.deep : C.text2 }}>{one(P[k])}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Stepper label="Fly less each month" icon="remove" onPress={() => { setPaceMode('custom'); setCustomPace(Math.max(paceStep, Math.round((pace - paceStep) * 10) / 10)); }} />
              <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Text style={[st.small, { color: C.text2 }]}>What if you fly more or less?</Text>
                <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', textAlign: 'center',
                  color: paceMode === 'r12' ? C.text : diff >= 0 ? C.primary : C.text2 }}>{paceDelta}</Text>
              </View>
              <Stepper label="Fly more each month" icon="add" onPress={() => { setPaceMode('custom'); setCustomPace(Math.round((pace + paceStep) * 10) / 10); }} />
            </View>
            <Text style={[st.small, { color: C.text2, lineHeight: 15 }]}>The ETA and your goals follow this pace. Simulator time isn{'’'}t counted.</Text>
          </>
        )}

        {sheet === 'goals' && (
          <>
            {built.length === 0 && !adding ? (
              <Text style={[st.small, { color: C.text2, lineHeight: 16 }]}>No goals yet. Add one, for example 1 500 h PIC, and see when you reach it.</Text>
            ) : null}
            <View>
              {built.map((b, i) => {
                const next = i === firstOpen, color = b.reached ? C.text2 : next ? C.text : C.muted;
                const pct = Math.min(1, b.h / b.g.hours);
                return (
                  <View key={`${b.g.key}-${b.g.hours}-${b.idx}`} style={{ flexDirection: 'row', gap: 11 }}>
                    <View style={{ width: 14, alignItems: 'center', paddingTop: 3 }}>
                      <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: color, backgroundColor: b.reached ? color : C.card }} />
                      <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: i === built.length - 1 ? 'transparent' : C.border }} />
                    </View>
                    <TouchableOpacity style={{ flex: 1, paddingBottom: 14, gap: 6 }} accessibilityLabel={`Show ${labelOf(b.g.key)} ${fmtIntH(b.g.hours)} hours on the chart`}
                      onPress={() => { setMetric(b.g.key, b.reached ? null : b.g.hours); setOpen(false); }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                          <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: C.text }}>{labelOf(b.g.key)} {fmtIntH(b.g.hours)} h</Text>
                          {next ? <Text style={[st.tag, { backgroundColor: C.soft, color: C.deep }]}>NEXT</Text> : null}
                        </View>
                        <Text style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: b.reached ? C.text2 : C.text }}>
                          {b.at == null ? '—' : b.reached ? `✓ ${mLabel(b.at)}` : mLabel(b.at)}
                        </Text>
                      </View>
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: C.elevated, overflow: 'hidden' }}>
                        <View style={{ height: 5, borderRadius: 3, width: `${pct * 100}%`, backgroundColor: b.reached ? C.quiet : next ? C.primary : C.primary + '88' }} />
                      </View>
                      <Text style={[st.small, { color: C.text2 }]}>
                        {b.reached ? `Reached · ${fmtIntH(b.h)} h now`
                          : b.at == null ? `${fmtIntH(b.h)} of ${fmtIntH(b.g.hours)} h · no pace yet`
                          : `${fmtIntH(b.h)} of ${fmtIntH(b.g.hours)} h · in ${dur(b.at - nowA)}`}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => saveGoals(goals.filter((_, j) => j !== b.idx))} accessibilityLabel={`Remove ${labelOf(b.g.key)} ${fmtIntH(b.g.hours)} hours`}
                      style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="close" size={15} color={C.text2} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            {!adding ? (
              <TouchableOpacity onPress={() => { setAdding(true); setAddHours(milestonesFor(haveOf(addKey))[0]); }}
                style={[st.addBtn, { borderColor: C.border }]}>
                <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: C.primary }}>+ Add goal</Text>
              </TouchableOpacity>
            ) : (
              <View style={[st.addBox, { borderColor: C.border, backgroundColor: C.elevated }]}>
                <View style={st.grid3}>
                  {CATS.map((k) => (
                    <Chip key={k.key} C={C} label={k.label} selected={k.key === addKey} dark
                      onPress={() => { setAddKey(k.key); setAddHours(milestonesFor(haveOf(k.key))[0]); }} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Stepper label="Fewer hours" icon="remove" onPress={() => setAddHours(Math.max(addStep, addHours - addStep))} />
                  <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                      <Text style={[st.led, { fontSize: 26, color: C.soft }]}>{led(addHours)}</Text>
                      <Text style={[st.unit, { color: C.muted }]}>h</Text>
                    </View>
                    <Text style={[st.small, { color: C.text2 }]}>
                      {addHave >= addHours ? 'Already reached' : addM != null ? `${mLabel(nowA + addM)} · in ${dur(addM)}` : 'No pace yet'}
                    </Text>
                  </View>
                  <Stepper label="More hours" icon="add" onPress={() => setAddHours(addHours + addStep)} />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => { saveGoals([...goals, { key: addKey, hours: addHours }]); setAdding(false); }}
                    style={[st.btn, { backgroundColor: C.primary }]}>
                    <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '700', color: C.deep }}>Add goal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setAdding(false)} style={[st.btn, { borderWidth: 1, borderColor: C.border }]}>
                    <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: '600', color: C.text }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </ProjectionSheet>
    </View>
  );
}

// Knappen direkt efter rubriken som öppnar kortet i liggande helskärm (delas med Next licence).
export function FullscreenButton({ C, label, onPress }: { C: InsightsTheme; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={label}
      hitSlop={{ top: 9, bottom: 9, left: 6, right: 9 }}
      style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="expand-outline" size={13} color={C.text2} />
    </TouchableOpacity>
  );
}

function Opener({ C, label, value, valueColor, onPress }: { C: InsightsTheme; label: string; value: string; valueColor: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityLabel={`${label.toLowerCase()}: ${value}`} style={[st.opener, { borderColor: C.border, backgroundColor: C.elevated }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[st.cap, { color: C.text2 }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={10} color={C.text2} />
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: valueColor }}>{value}</Text>
    </TouchableOpacity>
  );
}

function Chip({ C, label, selected, onPress, dark }: { C: InsightsTheme; label: string; selected: boolean; onPress: () => void; dark?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityState={{ selected }}
      style={[st.chipBig, { borderColor: selected ? C.primary : C.border, backgroundColor: selected ? C.primary : dark ? C.card : C.elevated }]}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: selected ? C.deep : C.text2 }}>{label}</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  cap: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  small: { fontFamily: MONO, fontSize: 10 },
  led: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22 },
  unit: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  chip: { minHeight: 32, paddingLeft: 11, paddingRight: 8, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  opener: { flex: 1, minHeight: 40, borderRadius: 11, borderWidth: 1, paddingVertical: 5, paddingHorizontal: 9, justifyContent: 'center', gap: 2 },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipBig: { width: '31.8%', minHeight: 42, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14 },
  step: { width: 44, height: 44, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quick: { flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  note: { fontFamily: MONO, fontSize: 10.5, lineHeight: 16, padding: 10, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  seg: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12 },
  segBtn: { flex: 1, minHeight: 48, borderRadius: 9, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tag: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  addBtn: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addBox: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  btn: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
