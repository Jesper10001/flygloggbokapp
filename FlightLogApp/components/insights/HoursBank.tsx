// Insights §2 — Hours bank. ALLA tidskategorier + landningar/starter/approacher i grupper. FAA-läge
// visar FAA-nattens currency-varianter (starter/landningar) och döljer EASA-begreppen PICUS/SPIC.
// "Backfill missing hours" ligger under Import → Imported data (dit piloten leds om timmarna inte stämmer).

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH } from './insightsData';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
import { FONT_LED7 } from '../logflight/tokens';

const MONO = 'JetBrainsMono';
type Item = { label: string; v: number };
type Group = { title: string; unit: string; items: Item[] };

export function HoursBank() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const c = D.cats;
  const n = D.counts;
  const faa = useRegulationStandardStore((s) => s.standard) === 'faa';
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'your' | 'all'>('your'); // Your = bara fält med data (default); All = allt

  const keep = (items: (Item | false)[]): Item[] => items.filter(Boolean) as Item[];

  const groups: Group[] = [
    { title: 'Roles', unit: 'h', items: keep([
      { label: 'PIC', v: c.pic }, { label: 'Co-pilot', v: c.co_pilot }, { label: 'Dual', v: c.dual },
      { label: 'Instructor', v: c.instructor }, { label: 'Examiner', v: c.examiner },
    ]) },
    { title: 'Crew time', unit: 'h', items: keep([
      { label: 'Multi-pilot', v: c.multi_pilot }, { label: 'Single-pilot', v: c.single_pilot },
      { label: 'Pilot flying', v: c.pilot_flying }, { label: 'Safety pilot', v: c.safety_pilot },
      { label: 'Observer', v: c.observer }, { label: 'Relief crew', v: c.relief_crew }, { label: 'Ferry PIC', v: c.ferry_pic },
      // EASA-begrepp: dölj i FAA-läge OM man saknar dem (men göm aldrig faktisk data).
      (!faa || c.picus > 0) && { label: 'PICUS', v: c.picus }, (!faa || c.spic > 0) && { label: 'SPIC', v: c.spic },
    ]) },
    { title: 'Class', unit: 'h', items: keep([
      { label: 'Single-engine', v: c.se }, { label: 'Multi-engine', v: c.me },
    ]) },
    { title: 'Conditions', unit: 'h', items: keep([
      { label: 'IFR', v: c.ifr }, { label: 'VFR', v: c.vfr }, { label: 'Night', v: c.night },
      { label: 'NVG', v: c.nvg }, { label: 'Cross-country', v: c.xc }, { label: 'Sim', v: c.sim },
    ]) },
    { title: 'Takeoffs', unit: '', items: keep([
      { label: 'Day', v: n.takeoffs_day }, { label: 'Night', v: n.takeoffs_night },
      // FAA-natt (striktare currency): visas i FAA-läge, eller om data finns.
      (faa || n.takeoffs_faa_night > 0) && { label: 'Night (FAA)', v: n.takeoffs_faa_night },
    ]) },
    { title: 'Landings', unit: '', items: keep([
      { label: 'Day', v: n.landings_day }, { label: 'Night', v: n.landings_night },
      (faa || n.landings_faa_night > 0) && { label: 'Night (FAA)', v: n.landings_faa_night },
      { label: 'Full-stop day', v: n.landings_fs_day }, { label: 'Full-stop night', v: n.landings_fs_night },
      (faa || n.landings_fs_faa_night > 0) && { label: 'Full-stop night (FAA)', v: n.landings_fs_faa_night },
      { label: 'Touch & go', v: n.tng },
    ]) },
    { title: 'Instrument', unit: '', items: keep([
      { label: 'Approaches 2D', v: n.app_2d }, { label: 'Approaches 3D', v: n.app_3d }, { label: 'Holds', v: n.holds },
    ]) },
  ].filter((g) => g.items.length > 0);

  // Your = bara fält med data; All = alla fält (nollor gråas). Tomma grupper döljs.
  const shown: Group[] = groups
    .map((g) => ({ ...g, items: mode === 'your' ? g.items.filter((it) => it.v > 0) : g.items }))
    .filter((g) => g.items.length > 0);

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14 }}>
        <TouchableOpacity onPress={() => setOpen((o) => !o)} hitSlop={{ top: 10, bottom: 10 }}>
          <Text style={[st.head, { color: C.text2 }]}>HOURS BANK</Text>
        </TouchableOpacity>
        {/* Your/All-toggle — visas bara när panelen är expanderad. */}
        {open && (
          <View style={[st.seg, { borderColor: C.border }]}>
            {(['your', 'all'] as const).map((m) => (
              <TouchableOpacity key={m} onPress={() => setMode(m)} activeOpacity={0.8}
                style={[st.segBtn, mode === m && { backgroundColor: C.primary }]}>
                <Text style={[st.segTxt, { color: mode === m ? C.card : C.text3 }]}>{m === 'your' ? 'Your fields' : 'All fields'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => setOpen((o) => !o)} hitSlop={{ top: 10, bottom: 10 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: FONT_LED7, fontSize: 13, fontWeight: '800', color: C.primary }}>{fmtIntH(D.total)}<Text style={{ fontFamily: MONO, fontSize: 9 }}>h</Text></Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={C.text3} />
        </TouchableOpacity>
      </View>

      {open && shown.length === 0 && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.separator, paddingHorizontal: 16, paddingVertical: 18 }}>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: C.muted, textAlign: 'center' }}>No logged data yet</Text>
        </View>
      )}
      {open && shown.length > 0 && (
        // 2-kolumns MASONRY: varje kolumn staplar sina sektioner TÄTT (borderTop mellan dem) → inga
        // tomrum under kortare sektioner (som flex-wrap annars ger när grannkolumnen är högre).
        <View style={{ borderTopWidth: 1, borderTopColor: C.separator, flexDirection: 'row' }}>
          {[0, 1].map((col) => (
            <View key={col} style={{ flex: 1, borderLeftWidth: col === 1 ? 1 : 0, borderLeftColor: C.separator }}>
              {shown.filter((_, gi) => gi % 2 === col).map((g, j) => (
                <View key={g.title} style={{ paddingHorizontal: 14, paddingTop: 9, paddingBottom: 10, borderTopWidth: j > 0 ? 1 : 0, borderTopColor: C.separator }}>
                  <View style={{ paddingBottom: 5, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.primary }} />
                    <Text style={[st.grpTitle, { color: C.text3 }]}>{g.title.toUpperCase()}</Text>
                  </View>
                  {g.items.map((it) => (
                    <View key={it.label} style={st.row}>
                      <Text style={[st.label, { color: it.v === 0 ? C.muted : C.text2 }]}>{it.label}</Text>
                      <Text style={{ fontFamily: FONT_LED7, fontWeight: '800', fontSize: 15, color: it.v === 0 ? C.faint : C.text }}>
                        {fmtIntH(it.v)}<Text style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>{g.unit}</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  head: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  segBtn: { paddingHorizontal: 8, paddingVertical: 3 },
  segTxt: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.3 },
  grpTitle: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  label: { fontSize: 15, fontWeight: '500' },
});
