// Insights §4 — Experience & projections. Kompakt kort: NOW → TARGET → ETA, en kumulativ kurva där målet dras
// med fingret (ProjectionChart) och tre delvyer i bottenpaneler: Target (sorts tid och mål), Pace (takten och
// "tänk om") och Goals (egna mål i den ordning de nås, sparade i settings). Låst tills loggboken har 60 dagar
// och 10 flygningar (ProjectionsLocked).

import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { getSetting, setSetting } from '../../db/flights';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme, type InsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH, projectionUnlock } from './insightsData';
import { ProjectionChart } from './ProjectionChart';
import { ProjectionSheet } from './ProjectionSheet';
import { ProjectionsLocked } from './ProjectionsLocked';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GOALS_KEY = 'projection_goals';

const CATS = [
  { key: 'total', label: 'Total' }, { key: 'pic', label: 'PIC' }, { key: 'ifr', label: 'IFR' },
  { key: 'night', label: 'Night' }, { key: 'nvg', label: 'NVG' }, { key: 'multi_pilot', label: 'Multi-pilot' },
  { key: 'co_pilot', label: 'Co-pilot' }, { key: 'dual', label: 'Dual' }, { key: 'xc', label: 'Cross-country' },
];
const labelOf = (k: string) => CATS.find((c) => c.key === k)?.label ?? k;

// Milstolpar efter hur mycket tid man har: steg om 50 h under 150 h, sedan 100, 250 och 500.
const stepFor = (h: number) => (h < 150 ? 50 : h < 500 ? 100 : h < 1500 ? 250 : 500);
const milestonesFor = (h: number) => { const s = stepFor(h); const m1 = Math.ceil((h + 1) / s) * s; return [m1, m1 + s, m1 + 2 * s, m1 + 5 * s]; };

const absNow = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
const absOfIso = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const mLabel = (a: number) => `${MON3[((a % 12) + 12) % 12]} ${Math.floor(a / 12)}`;
const mShort = (a: number) => `${MON3[((a % 12) + 12) % 12]} ’${String(Math.floor(a / 12)).slice(2)}`;
const dur = (m: number) => (m < 12 ? `${m} mo` : `${Math.floor(m / 12)} yr${m % 12 ? ` ${m % 12} mo` : ''}`);
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const led = (h: number) => (h < 100 ? h.toFixed(1) : String(Math.round(h)));

type PaceMode = 'r3' | 'r12' | 'career' | 'custom';
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
  const [metric, setMetricKey] = useState('total');
  const [target, setTarget] = useState<number | null>(null);   // null = näst närmaste milstolpen
  const [paceMode, setPaceMode] = useState<PaceMode>('r12');
  const [customPace, setCustomPace] = useState(0);
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
  const series = D.seriesFor(metric);
  const have = haveOf(metric);
  const monthly = series.map((p, i) => p.cum - (i ? series[i - 1].cum : 0));
  const P = {
    r3: monthly.slice(-3).reduce((a, b) => a + b, 0) / 3,
    r12: D.rateFor(metric),
    career: series.length ? have / series.length : 0,
  };
  const pace = Math.max(0, paceMode === 'custom' ? customPace : P[paceMode]);
  const snap = stepFor(have) / 10;
  const minTarget = Math.ceil((have + snap) / snap) * snap;
  const tgt = Math.max(minTarget, target ?? milestonesFor(have)[1]);
  const toGo = tgt - have;
  const etaM = pace > 0 ? Math.ceil(toGo / pace) : null;
  const natural = [P.r3, P.r12, P.career].filter((p) => p > 0);
  const fast = natural.length ? Math.max(...natural) : 0, slow = natural.length ? Math.min(...natural) : 0;
  const fastA = fast > 0 ? nowA + Math.ceil(toGo / fast) : null, slowA = slow > 0 ? nowA + Math.ceil(toGo / slow) : null;
  const hasWindow = fastA != null && slowA != null && fastA !== slowA;

  const setMetric = (k: string, t: number | null = null) => {
    setMetricKey(k); setTarget(t);
    if (paceMode === 'custom') setPaceMode('r12');
  };
  const openSheet = (s: SheetKind) => { setSheet(s); setAdding(false); setOpen(true); };

  // Målen: varje kategori i sin egen 12-månaderstakt, skalad som takten ovan (flyger man mer, flyger man mer av allt).
  const mult = P.r12 > 0 && pace > 0 ? pace / P.r12 : 1;
  const built = goals.map((g, idx) => {
    const h = haveOf(g.key), reached = h >= g.hours, rate = D.rateFor(g.key) * mult;
    const met = reached ? D.metDateFor(g.key, g.hours) : null;
    const at = reached ? (met ? absOfIso(met) : nowA) : rate > 0 ? nowA + Math.ceil((g.hours - h) / rate) : null;
    return { g, idx, h, reached, at };
  }).sort((a, b) => (a.reached === b.reached ? 0 : a.reached ? -1 : 1) || (a.at ?? Infinity) - (b.at ?? Infinity));
  const firstOpen = built.findIndex((b) => !b.reached);
  const nextGoal = firstOpen >= 0 ? built[firstOpen] : null;

  const baseM = P.r12 > 0 ? Math.ceil(toGo / P.r12) : null;
  const diff = baseM != null && etaM != null ? baseM - etaM : 0;
  const paceDelta = paceMode === 'r12' ? 'Your usual pace'
    : diff === 0 ? 'Same month as your usual pace'
    : diff > 0 ? `${dur(diff)} sooner than usual` : `${dur(-diff)} later than usual`;
  const paceStep = P.r12 >= 5 ? 1 : 0.5;

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
        <Ionicons name="trending-up" size={17} color={C.primary} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: C.text }}>Experience & projections</Text>
        <TouchableOpacity onPress={() => openSheet('target')} accessibilityLabel={`${labelOf(metric)} time. Change the kind of time`}
          style={[st.chip, { borderColor: C.border, backgroundColor: C.elevated }]}>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.primary }}>{labelOf(metric)}</Text>
          <Ionicons name="chevron-down" size={11} color={C.primary} />
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
          <Text style={[st.cap, { color: C.gold }]}>TARGET</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={[st.led, { color: C.gold }]}>{led(tgt)}</Text>
            <Text style={[st.unit, { color: C.gold }]}>h</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end', gap: 1, minWidth: 0 }}>
          <Text style={[st.cap, { color: C.text2 }]}>ETA</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 24, fontWeight: '600', color: C.gold }}>
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
        <Opener C={C} label="TARGET" value={`${fmtIntH(tgt)} h`} valueColor={C.gold} onPress={() => openSheet('target')} />
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
                    <Text style={[st.led, { fontSize: 30, color: C.gold }]}>{led(tgt)}</Text>
                    <Text style={[st.unit, { color: C.gold }]}>h</Text>
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
                      style={[st.quick, { borderColor: sel ? C.gold : C.border, backgroundColor: sel ? C.gold + '24' : C.elevated }]}>
                      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: sel ? C.gold : C.text }}>{fmtIntH(q)}</Text>
                      <Text style={{ fontFamily: MONO, fontSize: 9.5, color: sel ? C.gold : C.text2 }}>
                        {pace > 0 ? mShort(nowA + Math.ceil((q - have) / pace)) : '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {hasWindow ? (
              <Text style={[st.note, { color: C.gold, borderColor: C.gold + '38', backgroundColor: C.gold + '14' }]}>
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
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 14 + (pace / barMax) * 56, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.gold }} />
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
                  color: paceMode === 'r12' ? C.text : diff >= 0 ? C.success : C.gold }}>{paceDelta}</Text>
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
                const next = i === firstOpen, color = b.reached ? C.success : next ? C.gold : C.text2;
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
                          {next ? <Text style={[st.tag, { backgroundColor: C.gold, color: C.deep }]}>NEXT</Text> : null}
                        </View>
                        <Text style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: b.reached ? C.success : next ? C.gold : C.text }}>
                          {b.at == null ? '—' : b.reached ? `✓ ${mLabel(b.at)}` : mLabel(b.at)}
                        </Text>
                      </View>
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: C.elevated, overflow: 'hidden' }}>
                        <View style={{ height: 5, borderRadius: 3, width: `${pct * 100}%`, backgroundColor: b.reached ? C.success : next ? C.gold : C.primary }} />
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
                      <Text style={[st.led, { fontSize: 26, color: C.gold }]}>{led(addHours)}</Text>
                      <Text style={[st.unit, { color: C.gold }]}>h</Text>
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

function Opener({ C, label, value, valueColor, onPress }: { C: InsightsTheme; label: string; value: string; valueColor: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityLabel={`${label.toLowerCase()}: ${value}`} style={[st.opener, { borderColor: C.border, backgroundColor: C.elevated }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[st.cap, { color: C.text2 }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={11} color={C.text2} />
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: valueColor }}>{value}</Text>
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
  opener: { flex: 1, minHeight: 54, borderRadius: 12, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 9, justifyContent: 'center', gap: 4 },
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
