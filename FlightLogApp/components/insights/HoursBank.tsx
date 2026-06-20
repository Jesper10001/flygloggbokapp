// Insights §2 — Hours bank. Alla flygtidskategorier + landningar i grupper (rad-
// layout, läsbara etiketter) + en "Backfill missing hours"-lista (endast kategorier
// på 0 h) som öppnar appens befintliga fix-modaler (DUAL / INSTR / NVG).

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH } from './insightsData';
import { MissingDualModal } from '../MissingDualModal';
import { MissingInstructorModal } from '../MissingInstructorModal';
import { MissingNvgModal } from '../MissingNvgModal';

const MONO = 'JetBrainsMono';

export function HoursBank() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const c = D.cats;
  const land = D.landings;
  const [open, setOpen] = useState(false);
  const [bfOpen, setBfOpen] = useState(false);
  const [showDual, setShowDual] = useState(false);
  const [showInstr, setShowInstr] = useState(false);
  const [showNvg, setShowNvg] = useState(false);

  const groups: { title: string; unit: string; items: { label: string; v: number }[] }[] = [
    { title: 'Roles', unit: 'h', items: [{ label: 'PIC', v: c.pic }, { label: 'Co-pilot', v: c.co_pilot }, { label: 'Dual', v: c.dual }, { label: 'PICUS', v: c.picus }] },
    { title: 'Special roles', unit: 'h', items: [{ label: 'Instructor', v: c.instructor }, { label: 'Multi-pilot', v: c.multi_pilot }, { label: 'NVG', v: c.nvg }, { label: 'Sim', v: c.sim }] },
    { title: 'Rules & conditions', unit: 'h', items: [{ label: 'IFR', v: c.ifr }, { label: 'Night', v: c.night }, { label: 'Cross-country', v: c.xc }] },
    { title: 'Landings', unit: '', items: [{ label: 'Total', v: land.day + land.night }, { label: 'Day', v: land.day }, { label: 'Night', v: land.night }] },
  ];
  const missing = [
    { label: 'Dual', open: () => setShowDual(true), v: c.dual },
    { label: 'Instructor', open: () => setShowInstr(true), v: c.instructor },
    { label: 'NVG', open: () => setShowNvg(true), v: c.nvg },
  ].filter((m) => m.v === 0);

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Text style={[st.head, { color: C.text2, flex: 1 }]}>HOURS BANK</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.primary }}>{fmtIntH(D.total)}h</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={C.text3} />
      </TouchableOpacity>

      {open && (<>
      {groups.map((g) => (
        <View key={g.title} style={{ borderTopWidth: 1, borderTopColor: C.separator }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.primary }} />
            <Text style={[st.grpTitle, { color: C.text3 }]}>{g.title.toUpperCase()}</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {g.items.map((it) => (
              <View key={it.label} style={st.row}>
                <Text style={[st.label, { color: it.v === 0 ? C.muted : C.text2 }]}>{it.label}</Text>
                <Text style={{ fontFamily: MONO, fontWeight: '700', fontSize: 15, color: it.v === 0 ? C.faint : C.text }}>
                  {fmtIntH(it.v)}<Text style={{ fontSize: 9, color: C.muted }}>{g.unit}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {/* backfill — only categories at 0 h */}
      {missing.length > 0 && (
        <>
          <TouchableOpacity onPress={() => setBfOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.separator }}>
            <Text style={[st.head, { color: C.muted, flex: 1, fontSize: 9 }]}>BACKFILL MISSING HOURS</Text>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: C.primary }}>{missing.length}</Text>
            <Ionicons name={bfOpen ? 'chevron-down' : 'chevron-forward'} size={14} color={C.primary} />
          </TouchableOpacity>
          {bfOpen && missing.map((m) => (
            <TouchableOpacity key={m.label} onPress={m.open} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.separator }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.text }}>{m.label} hours</Text>
                <Text style={{ fontFamily: MONO, fontSize: 10, color: C.muted, marginTop: 1 }}>None logged — add retroactively</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="add" size={13} color={C.primary} />
                <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.primary }}>Add</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}
      </>)}

      <MissingDualModal visible={showDual} onClose={() => setShowDual(false)} />
      <MissingInstructorModal visible={showInstr} onClose={() => setShowInstr(false)} />
      <MissingNvgModal visible={showNvg} onClose={() => setShowNvg(false)} />
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  head: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  grpTitle: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  label: { fontSize: 15, fontWeight: '500' },
});
