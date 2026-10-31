// "Uppdatering finns"-popupen på dashboarden (pilot + drönare). Visas när en nyare version ligger på App Store
// (useVersionStore.updateAvailable) och listar vad som är nytt — texten "What's New in This Version" från App Store
// Connect (releaseNotes), så varje version får rätt nyheter utan extra jobb. Kortet är Liquid Glass på iOS 26,
// annars mörk blur (samma reservläge som flikraden). Går att trycka bort (bara denna gång) och kommer tillbaka när
// appen kommer i förgrunden igen — tills man uppdaterat. forceUpdate har en egen helskärm i app/_layout.tsx.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Linking, AppState, Image, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Colors } from '../constants/colors';
import { useVersionStore, type ReleaseNote } from '../store/versionStore';
import { useTourStore } from '../store/tourStore';
import { canUseLiquidGlass } from '../utils/liquidGlass';

const RADIUS = 30;
const APP_ICON = require('../assets/applogo-cyanonnavy.png');

// Etiketter som i en vanlig versionslogg (ingen ikon per rad).
const KIND_LABEL: Record<ReleaseNote['kind'], string> = { new: 'New', fix: 'Fixed', improved: 'Improved', other: '' };

/** Kortets yta: Liquid Glass (iOS 26) med navy-ton för läsbarhet, annars tjock mörk blur med ljus kant. */
function GlassCard() {
  if (canUseLiquidGlass()) {
    const { GlassView } = require('expo-glass-effect');
    return (
      <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(10,22,40,0.55)"
        style={[StyleSheet.absoluteFill, { borderRadius: RADIUS }]} />
    );
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.fallbackClip]}>
      <BlurView tint="systemThickMaterialDark" intensity={95} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,26,48,0.6)' }]} />
    </View>
  );
}

export function UpdateAvailableModal() {
  const { updateAvailable, forceUpdate, latestVersion, storeUrl, releaseNotes, releaseNotesMore, news, check } = useVersionStore();
  const tourActive = useTourStore((st) => st.active || !!st.promptMode);
  const [dismissed, setDismissed] = useState(false);
  const { height } = useWindowDimensions();
  const progress = useSharedValue(0);

  // Kör en koll vid mount, och varje gång appen kommer i förgrunden igen → då nollas även "borttryckt"
  // så notisen kommer tillbaka (om man inte uppdaterat).
  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { setDismissed(false); check(); }
    });
    return () => sub.remove();
  }, [check]);

  // forceUpdate visas som egen helskärm i _layout; göm den mjuka popupen under rundturen.
  const visible = updateAvailable && !forceUpdate && !dismissed && !tourActive;

  useEffect(() => {
    if (!visible) return;
    progress.value = 0;
    progress.value = withSpring(1, { damping: 18, stiffness: 210, mass: 0.9 });
  }, [visible, progress]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.4),
    transform: [{ translateY: (1 - progress.value) * 18 }, { scale: 0.94 + 0.06 * progress.value }],
  }));

  if (!visible) return null;

  const close = () => {
    progress.value = withTiming(0, { duration: 160 });
    setTimeout(() => setDismissed(true), 170);
  };
  const update = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* haptik är valfri */ }
    Linking.openURL(storeUrl).catch(() => {});
  };

  const fromNews = news?.type === 'update' && news.body ? news.body : '';
  const subtitle = fromNews || 'Ready to install from the App Store.';
  const notes = releaseNotes.slice(0, 4);
  const compact = height < 700; // iPhone SE/mini: tätare luft så att allt får plats utan rullning

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, s.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <View style={s.center} pointerEvents="box-none">
        <Animated.View style={[s.card, cardStyle]} accessibilityViewIsModal>
          <GlassCard />
          {!canUseLiquidGlass() && <View pointerEvents="none" style={s.edge} />}
          <View style={[s.content, compact && { paddingTop: 22, gap: 2 }]}>
            <View style={s.iconWrap}>
              <Image source={APP_ICON} style={[s.icon, compact && { width: 56, height: 56, borderRadius: 13 }]} accessibilityIgnoresInvertColors />
            </View>
            <Text style={s.eyebrow}>UPDATE AVAILABLE</Text>
            <Text style={s.title} accessibilityRole="header">{latestVersion ? `Blades ${latestVersion}` : 'A new Blades'}</Text>
            <Text style={s.sub}>{subtitle}</Text>

            {notes.length > 0 && (
              <View style={[s.notes, compact && { marginTop: 12, paddingTop: 12 }]}>
                <Text style={s.notesHead}>What's new</Text>
                {notes.map((n, i) => (
                  <View key={i} style={s.note} accessible accessibilityLabel={KIND_LABEL[n.kind] ? `${KIND_LABEL[n.kind]}: ${n.text}` : n.text}>
                    <Text style={s.noteKind}>{KIND_LABEL[n.kind].toUpperCase()}</Text>
                    <Text style={s.noteTxt}>{n.text}</Text>
                  </View>
                ))}
                {releaseNotesMore && <Text style={s.more}>And more fixes and improvements.</Text>}
              </View>
            )}

            <Pressable onPress={update} accessibilityRole="button" accessibilityLabel="Update in the App Store"
              style={({ pressed }) => [s.primary, compact && { marginTop: 16 }, pressed && { backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ scale: 0.985 }] }]}>
              <Text style={s.primaryTxt}>Update</Text>
            </Pressable>
            <Pressable onPress={close} accessibilityRole="button" style={({ pressed }) => [s.secondary, pressed && { opacity: 0.6 }]}>
              <Text style={s.secondaryTxt}>Not now</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(4,10,20,0.55)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  card: {
    width: '100%', maxWidth: 380, borderRadius: RADIUS,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 18,
  },
  fallbackClip: { borderRadius: RADIUS, overflow: 'hidden' },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  content: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 16, alignItems: 'center', gap: 4 },
  iconWrap: {
    marginBottom: 12, borderRadius: 16,
    shadowColor: Colors.primary, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 68, height: 68, borderRadius: 16 },
  eyebrow: { color: Colors.primary, fontSize: 11.5, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: Colors.textPrimary, fontSize: 25, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', marginTop: 2 },
  sub: { color: Colors.textSecondary, fontSize: 14, lineHeight: 19, textAlign: 'center' },
  notes: {
    alignSelf: 'stretch', marginTop: 18, paddingTop: 16, gap: 11,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)',
  },
  notesHead: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800', letterSpacing: 0.2, marginBottom: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  noteKind: { width: 72, color: Colors.textSecondary, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9, marginTop: 3 },
  noteTxt: { flex: 1, color: Colors.textPrimary, opacity: 0.92, fontSize: 14, lineHeight: 19.5 },
  more: { color: Colors.textSecondary, fontSize: 13, marginLeft: 84 },
  // Neutral kapsel: ljus glasyta i stället för stark cyan, så att knappen hör ihop med kortet.
  primary: {
    alignSelf: 'stretch', marginTop: 22, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center',
  },
  primaryTxt: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  secondary: { alignSelf: 'stretch', height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  secondaryTxt: { color: Colors.textSecondary, fontSize: 15, fontWeight: '700' },
});
