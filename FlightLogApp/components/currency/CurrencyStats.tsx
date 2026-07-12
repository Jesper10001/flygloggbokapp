// Ren stat-ruta (ingen titel) längst ner på dashboarden: 5 datapunkter för senaste
// perioden. T/O och LDG togglar D/N, APP togglar 2D/3D genom att trycka på siffran.
// Period växlas under: 30D / 90D / 6M / 1Y.
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';

const MONO = 'JetBrainsMono';
const PERIODS: { key: string; label: string; days: number }[] = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
];

// Beskrivande etikett med aktivt delläge markerat, t.ex. T/O (D/N) där D eller N lyser.
function Lbl({ base, a, b, active }: { base: string; a: string; b: string; active: 'a' | 'b' }) {
  return (
    <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: Colors.textMuted, marginTop: 3, letterSpacing: 0.2 }}>
      {base} (<Text style={{ color: active === 'a' ? Colors.primary : Colors.textMuted }}>{a}</Text>
      /<Text style={{ color: active === 'b' ? Colors.primary : Colors.textMuted }}>{b}</Text>)
    </Text>
  );
}

export function CurrencyStats({ flights }: { flights: Flight[] }) {
  const [period, setPeriod] = useState('30d');
  const [toN, setToN] = useState(false);    // takeoffs: false = day, true = night
  const [ldgN, setLdgN] = useState(false);  // landings: false = day, true = night
  const [app3, setApp3] = useState(false);  // approaches: false = 2D, true = 3D

  const days = PERIODS.find((p) => p.key === period)!.days;
  const s = useMemo(() => {
    const cut = new Date(); cut.setDate(cut.getDate() - days);
    const cutStr = cut.toISOString().slice(0, 10);
    let toD = 0, toNn = 0, ldgD = 0, ldgNn = 0, a2 = 0, a3 = 0, hold = 0, flt = 0;
    for (const f of flights) {
      if (!f.date || f.date < cutStr) continue;
      flt++;
      toD += f.takeoffs_day || 0; toNn += f.takeoffs_night || 0;
      ldgD += f.landings_day || 0; ldgNn += f.landings_night || 0;
      a2 += f.app_2d || 0; a3 += f.app_3d || 0;
      hold += f.holds || 0;
    }
    return { toD, toNn, ldgD, ldgNn, a2, a3, hold, flt };
  }, [flights, days]);

  const cells: { value: number; label: React.ReactNode; onPress?: () => void }[] = [
    { value: toN ? s.toNn : s.toD, label: <Lbl base="T/O" a="D" b="N" active={toN ? 'b' : 'a'} />, onPress: () => setToN((v) => !v) },
    { value: ldgN ? s.ldgNn : s.ldgD, label: <Lbl base="LDG" a="D" b="N" active={ldgN ? 'b' : 'a'} />, onPress: () => setLdgN((v) => !v) },
    { value: app3 ? s.a3 : s.a2, label: <Lbl base="APP" a="2D" b="3D" active={app3 ? 'b' : 'a'} />, onPress: () => setApp3((v) => !v) },
    { value: s.hold, label: <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: Colors.textMuted, marginTop: 3, letterSpacing: 0.2 }}>HOLD</Text> },
    { value: s.flt, label: <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: Colors.textMuted, marginTop: 3, letterSpacing: 0.2 }}># FLT</Text> },
  ];

  return (
    <View style={{ backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, padding: 12 }}>
      <View style={{ flexDirection: 'row' }}>
        {cells.map((c, i) => (
          <TouchableOpacity key={i} disabled={!c.onPress} onPress={c.onPress} activeOpacity={0.6}
            style={{ flex: 1, alignItems: 'center', paddingHorizontal: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: Colors.separator }}>
            <Text style={{ fontFamily: MONO, fontSize: 21, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'] }}>{c.value}</Text>
            {c.label}
          </TouchableOpacity>
        ))}
      </View>
      {/* Period-växel: 30D / 90D / 6M / 1Y */}
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 12, backgroundColor: Colors.elevated, borderRadius: 9, padding: 3 }}>
        {PERIODS.map((p) => {
          const sel = p.key === period;
          return (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p.key)} activeOpacity={0.8}
              style={{ flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center', backgroundColor: sel ? Colors.primary : 'transparent' }}>
              <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: sel ? Colors.background : Colors.textSecondary }}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
