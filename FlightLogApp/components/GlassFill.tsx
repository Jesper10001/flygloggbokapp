// Glasyta bakom en knapp (dashboardens knapprad: skanna · Log flight · böcker), samma glas som flikraden
// (GlassTabBar): iOS 26 → riktig Liquid Glass (expo-glass-effect), annars systemets blur med en ljus kant och
// en svag spegling överst. Läggs först i knappen; knappen själv har ingen bakgrund eller ram.
import { View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { canUseLiquidGlass } from '../utils/liquidGlass';

export function GlassFill({ radius }: { radius: number }) {
  if (canUseLiquidGlass()) {
    const { GlassView } = require('expo-glass-effect');
    return (
      <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(255,255,255,0.04)"
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
    );
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <BlurView tint="systemThinMaterialDark" intensity={80} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.08)']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'rgba(255,255,255,0.18)' }]} />
      <View style={{ position: 'absolute', left: radius * 0.6, right: radius * 0.6, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
    </View>
  );
}
