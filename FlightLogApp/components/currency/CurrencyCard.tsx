// Kompakt dashboard-kort: sämsta currency-status + genväg till "Current today?".
// Premium-gated (låst teaser för icke-premium). Laddar getPilotCurrency vid fokus.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { getPilotCurrency, type CurrencyItem, type CurrencyStatus } from '../../db/currency';

const color = (s: CurrencyStatus) =>
  s === 'current' ? Colors.success : s === 'warning' ? Colors.warning : s === 'expired' ? Colors.danger : Colors.textMuted;

export function CurrencyCard() {
  const router = useRouter();
  const { isPremium, isMax } = useFlightStore();
  const premium = isPremium || isMax;
  const [worst, setWorst] = useState<CurrencyItem | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!premium) return;
    let alive = true;
    getPilotCurrency().then((r) => { if (alive) { setWorst(r.worst); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [premium]));

  const card = (children: React.ReactNode) => (
    <TouchableOpacity
      onPress={() => router.push('/currency')}
      activeOpacity={0.8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 12 }}
    >
      {children}
    </TouchableOpacity>
  );

  if (!premium) {
    return card(<>
      <Ionicons name="shield-checkmark-outline" size={20} color={Colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Current today?</Text>
        <Text style={{ color: Colors.textMuted, fontSize: 12 }}>Track passenger, night, IFR & medical currency — Premium.</Text>
      </View>
      <Ionicons name="lock-closed" size={16} color={Colors.textMuted} />
    </>);
  }

  const c = worst ? color(worst.status) : Colors.success;
  const allCurrent = loaded && (!worst || worst.status === 'current');
  const title = 'Current today?';
  const sub = !loaded ? 'Checking…'
    : allCurrent ? 'All checks current'
    : `${worst!.label} — ${worst!.status === 'expired' ? 'not current' : worst!.detail}`;

  return card(<>
    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} />
    <View style={{ flex: 1 }}>
      <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: allCurrent ? Colors.textMuted : c, fontSize: 12, fontWeight: allCurrent ? '400' : '600' }} numberOfLines={1}>{sub}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
  </>);
}
