import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, AppState, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useAppLockStore } from '../store/appLockStore';

// Full-täckande lås-overlay som visas när app-låset är på och sessionen inte är upplåst.
// Auto-triggar Face ID vid visning och när appen återvänder till förgrunden. Låser vid bakgrund.
export function AppLockGate() {
  const { enabled, unlocked, authenticate, lock } = useAppLockStore();
  const prompting = useRef(false);

  // Lås vid bakgrund → kräv ny upplåsning när appen blir aktiv igen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') lock();
    });
    return () => sub.remove();
  }, [lock]);

  const locked = enabled && !unlocked;

  // Auto-prompta biometrik så fort skärmen är låst (en i taget).
  useEffect(() => {
    if (!locked || prompting.current) return;
    prompting.current = true;
    authenticate().finally(() => { prompting.current = false; });
  }, [locked, authenticate]);

  if (!locked) return null;

  return (
    <View style={s.wrap} pointerEvents="auto">
      <Image source={require('../assets/logo-splashscreen.png')} style={s.logo} resizeMode="contain" />
      <View style={s.badge}><Ionicons name="lock-closed" size={22} color={Colors.primary} /></View>
      <Text style={s.title}>Blades is locked</Text>
      <Text style={s.sub}>Unlock with Face ID to continue.</Text>
      <TouchableOpacity style={s.btn} onPress={() => { if (!prompting.current) { prompting.current = true; authenticate().finally(() => { prompting.current = false; }); } }} activeOpacity={0.85}>
        <Ionicons name="finger-print" size={18} color={Colors.textInverse} />
        <Text style={s.btnText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0A1628',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 100000,
    elevation: 100000,
  },
  logo: { width: 220, height: 220, marginBottom: -10 },
  badge: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.primary + '1A',
    borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: 'Georgia', fontSize: 22, fontWeight: '400', color: Colors.textPrimary },
  sub: { fontSize: 13.5, color: Colors.textSecondary, marginTop: -4 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 26,
  },
  btnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
});
