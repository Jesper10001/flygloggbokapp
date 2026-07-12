// Insights §2 — Hours bank. Alla flygtidskategorier + landningar i grupper (rad-
// layout, läsbara etiketter). "Backfill missing hours" ligger numera under Import →
// Imported data (dit piloten leds om timmarna inte stämmer).

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, fmtIntH } from './insightsData';
import { FONT_LED7 } from '../logflight/tokens';

const MONO = 'JetBrainsMono';

export function HoursBank() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const c = D.cats;
  const land = D.landings;
  const [open, setOpen] = useState(false);

  const groups: { title: string; unit: string; items: { label: string; v: number }[] }[] = [
    { title: 'Roles', unit: 'h', items: [{ label: 'PIC', v: c.pic }, { label: 'Co-pilot', v: c.co_pilot }, { label: 'Dual', v: c.dual }, { label: 'PICUS', v: c.picus }] },
    { title: 'Special roles', unit: 'h', items: [{ label: 'Instructor', v: c.instructor }, { label: 'Multi-pilot', v: c.multi_pilot }, { label: 'NVG', v: c.nvg }, { label: 'Sim', v: c.sim }] },
    { title: 'Rules & conditions', unit: 'h', items: [{ label: 'IFR', v: c.ifr }, { label: 'Night', v: c.night }, { label: 'Cross-country', v: c.xc }] },
    { title: 'Landings', unit: '', items: [{ label: 'Total', v: land.day + land.night }, { label: 'Day', v: land.day }, { label: 'Night', v: land.night }] },
  ];

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Text style={[st.head, { color: C.text2, flex: 1 }]}>HOURS BANK</Text>
        <Text style={{ fontFamily: FONT_LED7, fontSize: 13, fontWeight: '800', color: C.primary }}>{fmtIntH(D.total)}<Text style={{ fontFamily: MONO, fontSize: 9 }}>h</Text></Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={C.text3} />
      </TouchableOpacity>

      {open && (<>
      {/* Kompakt 2-kolumnsrutnät: grupperna ligger parvis bredvid varandra */}
      <View style={{ borderTopWidth: 1, borderTopColor: C.separator, flexDirection: 'row', flexWrap: 'wrap' }}>
        {groups.map((g, gi) => (
          <View key={g.title} style={{ width: '50%', paddingHorizontal: 14, paddingTop: 9, paddingBottom: 10,
            borderLeftWidth: gi % 2 === 1 ? 1 : 0, borderLeftColor: C.separator,
            borderTopWidth: gi >= 2 ? 1 : 0, borderTopColor: C.separator }}>
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

      </>)}
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
