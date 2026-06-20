// Insights §4 — Experience & projections. Kumulativ journey (Total/PIC), projicera
// framåt (+500/+1000) eller bygg ett custom multi-kategori-mål (inkl. roll+villkor-
// kombikategorier som PIC+Natt) med en kurva per kategori.

import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH, forecastFwd } from './insightsData';
import { JourneyChart } from './JourneyChart';
import { LicenceChart, type Req } from './LicenceChart';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';

const CAT_LABELS: Record<string, string> = {
  total: 'Total', pic: 'PIC', ifr: 'IFR', nvg: 'NVG', 'vfr+night': 'VFR-Night', multi_pilot: 'Multi-pilot',
  'pic+ifr': 'PIC + IFR', 'pic+nvg': 'PIC + NVG', 'pic+night': 'PIC + Night',
  co_pilot: 'Co-pilot', dual: 'Dual', picus: 'PICUS', night: 'Night', xc: 'Cross-country', instructor: 'Instructor', sim: 'Sim',
};
const PRIMARY = ['total', 'pic', 'ifr', 'nvg', 'vfr+night', 'multi_pilot', 'pic+ifr', 'pic+nvg', 'pic+night'];
const OTHER = ['co_pilot', 'dual', 'picus', 'night', 'xc', 'instructor', 'sim'];
const ALL_KEYS = [...PRIMARY, ...OTHER];

export function GoalCard() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const [metric, setMetric] = useState<'total' | 'pic'>('total');
  const [goal, setGoal] = useState<number | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [cats, setCats] = useState<{ key: string; hours: number }[]>([]);
  const [pickKey, setPickKey] = useState('pic');
  const [pickHours, setPickHours] = useState('');
  const [showOther, setShowOther] = useState(false);

  const series = metric === 'pic' ? D.journeyPic : D.journey;
  const rate = D.rateFor(metric);
  const now = series.length ? series[series.length - 1].cum : (metric === 'pic' ? D.cats.pic : D.total);
  const base = Math.floor(now / 500) * 500;
  const presets = [base + 500, base + 1000];

  const goalNum = (!customMode && typeof goal === 'number') ? goal : null;
  const remaining = goalNum ? Math.max(0, goalNum - now) : 0;
  const fc = goalNum ? forecastFwd(remaining, rate) : null;

  const usedKeys = cats.map((c) => c.key);
  const addCat = () => {
    const h = parseInt(pickHours, 10);
    if (!h || h <= 0 || usedKeys.includes(pickKey)) return;
    setCats([...cats, { key: pickKey, hours: h }]);
    setPickHours('');
    const free = ALL_KEYS.find((k) => !usedKeys.includes(k) && k !== pickKey);
    if (free) setPickKey(free);
  };
  const customReqs: Req[] = cats.filter((c) => c.hours > 0).map((c) => ({ label: CAT_LABELS[c.key], key: c.key, required: c.hours }));

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <Ionicons name="git-network-outline" size={17} color={C.primary} />
        <Text style={{ flex: 1, fontFamily: SERIF, fontSize: 18, fontWeight: '500', color: C.text }}>Experience & projections</Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.primary }}>{Math.round(now)}h</Text>
      </View>

      {!customMode ? (
        <>
          <View style={{ flexDirection: 'row', gap: 3, backgroundColor: C.elevated, borderRadius: 9, padding: 3, marginVertical: 10 }}>
            {([['total', 'Total time'], ['pic', 'PIC time']] as const).map(([k, label]) => (
              <TouchableOpacity key={k} onPress={() => { setMetric(k); setGoal(null); }} style={[st.seg, metric === k && { backgroundColor: C.primary }]}>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: metric === k ? C.deep : C.text3 }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, color: C.muted, marginBottom: 6 }}>Cumulative {metric === 'pic' ? 'PIC' : 'flight'} time · hours over time</Text>
          <JourneyChart C={C} series={series} goal={goalNum} rate={rate} />
          {fc && (
            <View style={{ alignItems: 'center', marginVertical: 8 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.2, color: C.muted }}>{fmtIntH(goalNum!)}h {metric === 'pic' ? 'PIC' : 'total'} projected</Text>
              <Text style={{ fontFamily: SERIF, fontSize: 24, fontWeight: '600', color: C.gold, marginTop: 2 }}>{fc.label}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 2 }}>{fmtIntH(remaining)}h to go · {fc.months} mo at {Math.round(rate)}h/mo</Text>
            </View>
          )}
        </>
      ) : (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, color: C.muted, marginBottom: 8 }}>Multi-category target · e.g. a job's hour requirements</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {cats.map((c, i) => (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: C.primary + '22', borderWidth: 1, borderColor: C.primary + '55' }}>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: C.primary }}>{CAT_LABELS[c.key]} {fmtIntH(c.hours)}h</Text>
                <TouchableOpacity onPress={() => setCats(cats.filter((_, j) => j !== i))}><Text style={{ color: C.muted, fontFamily: MONO, fontSize: 12 }}>✕</Text></TouchableOpacity>
              </View>
            ))}
            {cats.length === 0 && <Text style={{ fontFamily: MONO, fontSize: 10, color: C.faint }}>Add a category below.</Text>}
          </View>
          {/* category picker — primära + "Other…" (speglar designens två-stegs-dropdown) */}
          <View style={{ marginBottom: 8, gap: 6 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {PRIMARY.filter((k) => !usedKeys.includes(k)).map((k) => (
                <TouchableOpacity key={k} onPress={() => setPickKey(k)} style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: pickKey === k ? C.primary : C.elevated, borderWidth: 1, borderColor: pickKey === k ? C.primary : C.border }}>
                  <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: pickKey === k ? C.deep : C.text2 }}>{CAT_LABELS[k]}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setShowOther((v) => !v)} style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: showOther ? C.primary + '22' : C.elevated, borderWidth: 1, borderColor: showOther ? C.primary : C.border }}>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: showOther ? C.primary : C.text3 }}>Other…</Text>
              </TouchableOpacity>
            </ScrollView>
            {showOther && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {OTHER.filter((k) => !usedKeys.includes(k)).map((k) => (
                  <TouchableOpacity key={k} onPress={() => setPickKey(k)} style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: pickKey === k ? C.primary : C.elevated, borderWidth: 1, borderColor: pickKey === k ? C.primary : C.border }}>
                    <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: pickKey === k ? C.deep : C.text2 }}>{CAT_LABELS[k]}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
            <TextInput value={pickHours} onChangeText={(v) => setPickHours(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="hours" placeholderTextColor={C.muted}
              style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border, color: C.text, fontFamily: MONO, fontSize: 12, fontWeight: '700' }} />
            <TouchableOpacity onPress={addCat} style={{ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 9, backgroundColor: C.primary, justifyContent: 'center' }}>
              <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: C.deep }}>Add</Text>
            </TouchableOpacity>
          </View>
          {customReqs.length > 0
            ? <LicenceChart C={C} reqs={customReqs} journey={D.journey} haveFor={D.haveFor} rateFor={D.rateFor} />
            : <Text style={{ fontFamily: MONO, fontSize: 10, color: C.faint, textAlign: 'center', paddingVertical: 20 }}>Add at least one category to see the projection.</Text>}
        </View>
      )}

      {/* project forward */}
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: C.muted, marginTop: 14, marginBottom: 7 }}>PROJECT FORWARD TO</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {presets.map((p) => {
          const sel = !customMode && goal === p;
          return (
            <TouchableOpacity key={p} onPress={() => { setCustomMode(false); setGoal(sel ? null : p); }} style={[st.fwd, { borderColor: sel ? C.primary : C.border, backgroundColor: sel ? C.primary : C.elevated }]}>
              <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: sel ? C.deep : C.text2 }}>{fmtIntH(p)}h</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={() => { setCustomMode((v) => !v); setGoal(null); }} style={[st.fwd, { borderColor: customMode ? C.primary : C.border, backgroundColor: customMode ? C.primary : C.elevated }]}>
          <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: customMode ? C.deep : C.text3 }}>Custom</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  seg: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center' },
  fwd: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, alignItems: 'center' },
});
