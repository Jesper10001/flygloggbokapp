// Logbook Wrapped-ingång i Insights (flyttad från Settings) — placeras mellan Hours bank och
// Experience & projections. Insights manned-fliken är redan pilot-manned, så bara unlock-checken
// behövs (Wrapped låses upp efter första importen). Uppdateras vid varje fokus på fliken.
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { Colors } from '../../constants/colors';
import { getSetting } from '../../db/flights';

export function WrappedCard() {
  const [unlocked, setUnlocked] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    getSetting('wrapped_unlocked').then((v) => { if (active) setUnlocked(v === '1'); });
    return () => { active = false; };
  }, []));

  if (!unlocked) return null;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/wrapped')}>
      <LinearGradient
        colors={[Colors.primary + '2E', Colors.card, Colors.card]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 18, borderWidth: 1, borderColor: Colors.primary + '66',
          paddingVertical: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden',
        }}
      >
        <Image source={require('../../assets/blades-mark.png')} style={{ width: 38, height: 40 }} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Fraunces', fontSize: 18, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.3 }}>
            Logbook Wrapped
          </Text>
          <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 11.5, fontWeight: '600', letterSpacing: 0.3, color: Colors.primary, marginTop: 5 }}>
            Your flight history - A journey
          </Text>
        </View>
        <Ionicons name="sparkles" size={18} color={Colors.primary} />
      </LinearGradient>
    </TouchableOpacity>
  );
}
