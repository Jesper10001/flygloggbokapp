// Appens popup-ruta, i samma stil som uppdateringspopupen (UpdateAvailableModal, som är förlagan och lämnas
// orörd): Liquid Glass på iOS 26, annars tjock mörk blur med ljus hårfin kant, radie 30, mjuk fjäderanimation
// in och ut, liten versal rubrik (eyebrow) i cyan, stor rubrik, dämpad brödtext, en neutral glaskapsel som
// huvudknapp och en textknapp under. Tryck utanför stänger. Används av alla centrerade popup-rutor, så att
// de ser likadana ut i hela appen.

import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, useWindowDimensions, type ViewStyle, type StyleProp, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Colors } from '../constants/colors';
import { canUseLiquidGlass } from '../utils/liquidGlass';

export const DIALOG_RADIUS = 30;

/** Kortets yta: Liquid Glass (iOS 26) med navy-ton för läsbarhet, annars tjock mörk blur med ljus kant. */
export function GlassSurface({ radius = DIALOG_RADIUS }: { radius?: number }) {
  if (canUseLiquidGlass()) {
    const { GlassView } = require('expo-glass-effect');
    return (
      <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(10,22,40,0.55)"
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
    );
  }
  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <BlurView tint="systemThickMaterialDark" intensity={95} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,26,48,0.6)' }]} />
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' }]} />
    </>
  );
}

/** Ikon överst i rutan: rund glasbubbla med svagt sken i accentfärgen. */
export function DialogIcon({ name, color = Colors.primary }: { name: keyof typeof Ionicons.glyphMap; color?: string }) {
  return (
    <View style={[d.iconWrap, { shadowColor: color }]}>
      <View style={[d.iconBubble, { borderColor: color + '55', backgroundColor: color + '1F' }]}>
        <Ionicons name={name} size={28} color={color} />
      </View>
    </View>
  );
}

// Ett val i en popup-ruta: ikon, rubrik, kort förklaring och pil (t.ex. kamera eller fotoalbum).
export function DialogOption({ icon, title, sub, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={d.option} onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      <View style={d.optionIcon}><Ionicons name={icon} size={20} color={Colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={d.optionTitle}>{title}</Text>
        <Text style={d.optionSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
    </TouchableOpacity>
  );
}

export interface DialogAction { label: string; onPress: () => void; disabled?: boolean }

export function GlassDialog(p: {
  visible: boolean;
  onClose: () => void;
  icon?: ReactNode;
  eyebrow?: string;
  title?: string;
  body?: ReactNode;
  children?: ReactNode;            // eget innehåll under brödtexten (listor, fält …)
  primary?: DialogAction;
  secondary?: DialogAction;
  closeOnScrim?: boolean;          // standard: ja
  align?: 'center' | 'left';       // rubrik och text (vänster för långa förklaringar)
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(p.visible);

  // In: fjäder (som uppdateringspopupen). Ut: kort tona, sedan avmonteras rutan.
  useEffect(() => {
    if (p.visible) {
      setMounted(true);
      progress.value = 0;
      progress.value = withSpring(1, { damping: 18, stiffness: 210, mass: 0.9 });
      return;
    }
    progress.value = withTiming(0, { duration: 160 });
    const t = setTimeout(() => setMounted(false), 170);
    return () => clearTimeout(t);
  }, [p.visible, progress]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.4),
    transform: [{ translateY: (1 - progress.value) * 18 }, { scale: 0.94 + 0.06 * progress.value }],
  }));

  if (!mounted) return null;
  const left = p.align === 'left';
  const tap = (a?: DialogAction) => () => {
    if (!a || a.disabled) return;
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* haptik är valfri */ }
    a.onPress();
  };

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={p.onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, d.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={p.closeOnScrim === false ? undefined : p.onClose} accessibilityLabel="Close" />
      </Animated.View>
      <View style={d.center} pointerEvents="box-none">
        <Animated.View style={[d.card, { maxHeight: Math.round(height * 0.86) }, cardStyle]} accessibilityViewIsModal>
          <GlassSurface />
          <View style={[d.content, left && { alignItems: 'stretch' }, p.contentStyle]}>
            {p.icon ? <View style={{ alignSelf: 'center' }}>{p.icon}</View> : null}
            {p.eyebrow ? <Text style={[d.eyebrow, left && d.left]}>{p.eyebrow.toUpperCase()}</Text> : null}
            {p.title ? <Text style={[d.title, left && d.left]} accessibilityRole="header">{p.title}</Text> : null}
            {typeof p.body === 'string' ? <Text style={[d.body, left && d.left]}>{p.body}</Text> : p.body ?? null}
            {p.children}
            {p.primary ? (
              <Pressable onPress={tap(p.primary)} accessibilityRole="button" disabled={p.primary.disabled}
                style={({ pressed }) => [d.primary, p.primary?.disabled && { opacity: 0.45 }, pressed && d.primaryPressed]}>
                <Text style={d.primaryTxt}>{p.primary.label}</Text>
              </Pressable>
            ) : null}
            {p.secondary ? (
              <Pressable onPress={tap(p.secondary)} accessibilityRole="button" style={({ pressed }) => [d.secondary, pressed && { opacity: 0.6 }]}>
                <Text style={d.secondaryTxt}>{p.secondary.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Delade stilar för innehåll i rutan (rader, mindre knappar) så att egna rutor följer samma språk.
export const dialogStyles = StyleSheet.create({
  divider: { alignSelf: 'stretch', height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.14)', marginVertical: 14 },
  row: { alignSelf: 'stretch', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  rowTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 3 },
  // Liten kapsel (t.ex. "Yes" på en rad): samma glasyta som huvudknappen.
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
  },
  pillTxt: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  pillGhost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, paddingHorizontal: 14 },
  pillGhostTxt: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
});

const d = StyleSheet.create({
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.06)',
  },
  optionIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '33',
  },
  optionTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  optionSub: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  scrim: { backgroundColor: 'rgba(4,10,20,0.55)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  card: {
    width: '100%', maxWidth: 380, borderRadius: DIALOG_RADIUS,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 18,
  },
  content: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 16, alignItems: 'center', gap: 4, flexShrink: 1 },
  iconWrap: { marginBottom: 12, borderRadius: 32, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  iconBubble: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: Colors.primary, fontSize: 11.5, fontWeight: '800', letterSpacing: 1.4, textAlign: 'center' },
  title: { color: Colors.textPrimary, fontSize: 23, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', marginTop: 2 },
  body: { color: Colors.textSecondary, fontSize: 14.5, lineHeight: 20, textAlign: 'center', marginTop: 2 },
  left: { textAlign: 'left' },
  // Neutral kapsel: ljus glasyta i stället för stark cyan, så att knappen hör ihop med kortet.
  primary: {
    alignSelf: 'stretch', marginTop: 22, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center',
  },
  primaryPressed: { backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ scale: 0.985 }] },
  primaryTxt: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  secondary: { alignSelf: 'stretch', height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  secondaryTxt: { color: Colors.textSecondary, fontSize: 15, fontWeight: '700' },
});
