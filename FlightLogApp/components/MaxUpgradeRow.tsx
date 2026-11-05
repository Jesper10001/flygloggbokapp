// Rad under "Blades Premium" i inställningarna (pilot och drönare) för den som har Premium men inte Max: öppnar
// paywallen med Premium och Max, där Max är ett byte inom samma prenumeration. Bara med de nya paywallsen.
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../store/flightStore';
import { presentPaywall } from '../services/purchases';
import { NEW_PAYWALLS } from '../constants/paywalls';

export function MaxUpgradeRow() {
  const { isPremium, isMax } = useFlightStore();
  if (!NEW_PAYWALLS || !isPremium || isMax) return null;
  return (
    <>
      <View style={{ height: 1, marginHorizontal: 18, backgroundColor: 'rgba(255,184,48,0.18)' }} />
      <TouchableOpacity
        style={{ height: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Blades Max, 500 coins every month"
        onPress={() => { presentPaywall('Blades Max', { upgrade: true }); }}
      >
        <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase', color: '#FFB830' }}>Blades Max</Text>
        <Text style={{ fontSize: 12, fontWeight: '500', fontFamily: 'Menlo', color: '#C9B07A' }}>500 coins / month</Text>
        <Ionicons name="chevron-forward" size={16} color="#FFB830" />
      </TouchableOpacity>
    </>
  );
}
