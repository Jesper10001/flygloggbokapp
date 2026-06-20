// Insights §1 — Total flygtid. Total + This year (eller valt datumintervall),
// Last 3/6/12 mo, och en "Pick range" med från/till-steppers (månadsupplösning).

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH } from './insightsData';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';
const MONTH3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function HeroTotals() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const now = new Date();
  const curAbs = now.getFullYear() * 12 + now.getMonth();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<{ s: number; e: number } | null>(null);
  const [dS, setDS] = useState(curAbs - 11);
  const [dE, setDE] = useState(curAbs);

  const monthTotal = (absM: number) => {
    const y = Math.floor(absM / 12), m = ((absM % 12) + 12) % 12;
    return D.monthly[`${y}-${String(m + 1).padStart(2, '0')}`] || 0;
  };
  const rangeHours = (s: number, e: number) => { let t = 0; for (let a = s; a <= e; a++) t += monthTotal(a); return t; };
  const fmtAbs = (absM: number) => { const y = Math.floor(absM / 12), m = ((absM % 12) + 12) % 12; return `${MONTH3[m]} '${String(y).slice(2)}`; };

  const showRange = !!range;
  const ytdLabel = showRange ? `${fmtAbs(range!.s)} – ${fmtAbs(range!.e)}` : 'This year';
  const ytdVal = showRange ? rangeHours(range!.s, range!.e) : D.ytd;

  const Stepper = ({ label, val, set, min, max }: { label: string; val: number; set: (n: number) => void; min: number; max: number }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, color: C.muted, width: 34 }}>{label.toUpperCase()}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.deep, borderWidth: 1, borderColor: C.border, borderRadius: 9, padding: 5 }}>
        <TouchableOpacity onPress={() => set(Math.max(min, val - 1))} style={[st.stepBtn, { backgroundColor: C.elevated }]}><Text style={{ color: C.text2, fontFamily: MONO, fontSize: 16, fontWeight: '700' }}>‹</Text></TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: C.text }}>{fmtAbs(val)}</Text>
        <TouchableOpacity onPress={() => set(Math.min(max, val + 1))} style={[st.stepBtn, { backgroundColor: C.elevated }]}><Text style={{ color: C.text2, fontFamily: MONO, fontSize: 16, fontWeight: '700' }}>›</Text></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      {/* total + this-year/range */}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, padding: 14, gap: 3 }}>
          <Text style={[st.cap, { color: C.muted }]}>TOTAL FLIGHT TIME</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: 32, letterSpacing: -1, color: C.text }}>{fmtIntH(D.total)}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.primary }}>h</Text>
          </View>
        </View>
        <TouchableOpacity activeOpacity={showRange ? 0.7 : 1} onPress={() => showRange && setRange(null)}
          style={{ flex: 1, padding: 14, gap: 3, borderLeftWidth: 1, borderLeftColor: C.separator, alignItems: 'flex-end' }}>
          <Text style={[st.cap, { color: showRange ? C.primary : C.muted }]} numberOfLines={1}>{ytdLabel}{showRange ? ' ✕' : ''}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: 24, letterSpacing: -0.8, color: C.text2 }}>{fmtIntH(ytdVal)}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.muted }}>h</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 3 / 6 / 12 + range */}
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.separator }}>
        {[{ l: '3 MO', v: D.m3 }, { l: '6 MO', v: D.m6 }, { l: '12 MO', v: D.m12 }].map((s, i) => (
          <View key={s.l} style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center', gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: C.separator }}>
            <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 13, color: C.text }}>{fmtIntH(s.v)}h</Text>
            <Text style={[st.cap8, { color: C.muted }]}>LAST {s.l}</Text>
          </View>
        ))}
        <TouchableOpacity onPress={() => { setOpen((o) => !o); if (range) { setDS(range.s); setDE(range.e); } }}
          style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 8, alignItems: 'center', gap: 2, borderLeftWidth: 1, borderLeftColor: C.separator, backgroundColor: open ? C.primary + '22' : 'transparent' }}>
          <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 13, color: C.primary }}>{open ? 'Close' : 'Pick →'}</Text>
          <Text style={[st.cap8, { color: C.muted }]}>RANGE</Text>
        </TouchableOpacity>
      </View>

      {/* range picker */}
      {open && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.separator, padding: 14, gap: 8, backgroundColor: C.deep }}>
          <Stepper label="From" val={dS} set={(x) => setDS(Math.min(x, dE))} min={curAbs - 120} max={dE} />
          <Stepper label="To" val={dE} set={(x) => setDE(Math.max(x, dS))} min={dS} max={curAbs} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.text2 }}>
              = {fmtIntH(rangeHours(dS, dE))}<Text style={{ color: C.muted }}>h </Text>
              <Text style={{ color: C.muted, fontSize: 9 }}>{dE - dS + 1} mo</Text>
            </Text>
            <TouchableOpacity onPress={() => { setRange({ s: dS, e: dE }); setOpen(false); }} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9, backgroundColor: C.primary }}>
              <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: C.deep }}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  cap: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  cap8: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  stepBtn: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
