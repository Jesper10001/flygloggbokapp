import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { GlassSurface } from './GlassDialog';

// Meny av glaskapslar vid en knapp: skärmen tonas ner och valen glider fram. Tryck utanför stänger. Kapslarna hamnar
// ovanför knappen när de får plats, annars under, och i linje med knappens närmaste sida.

export interface GlassMenuOption { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; selected?: boolean; onPress: () => void }
export type GlassMenuAnchor = { x: number; y: number; w: number; h: number };

const PILL_H = 52;
const PILL_RADIUS = 18;
const GAP = 10;
// iOS visar inte nästa ruta eller kamera medan menyn fortfarande stängs.
const CLOSE_MS = 180;

export function GlassMenu({ anchor, options, onClosed, accent = Colors.primary }: {
  anchor: GlassMenuAnchor | null;      // null = stängd
  options: GlassMenuOption[];
  onClosed: () => void;
  accent?: string;
}) {
  const { width: W } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  // Glaset får inte tonas in: iOS hoppar över effekten på en vy som är nästan genomskinlig när den visas, och då
  // får bara en del av kapslarna glas. Vid öppning glider och växer ytorna; bara innehåll och mörkläggning tonas.
  const glassFade = useRef(new Animated.Value(1)).current;
  const closing = useRef(false);

  useEffect(() => {
    if (!anchor) return;
    closing.current = false;
    progress.setValue(0);
    glassFade.setValue(1);
    Animated.spring(progress, { toValue: 1, damping: 18, stiffness: 240, mass: 0.8, useNativeDriver: true }).start();
  }, [anchor, progress, glassFade]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    const timing = { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true };
    Animated.parallel([Animated.timing(progress, timing), Animated.timing(glassFade, timing)]).start(() => {
      onClosed();
      if (then) setTimeout(then, CLOSE_MS);
    });
  };

  if (!anchor) return null;
  const stackH = options.length * (PILL_H + GAP);
  const above = anchor.y - stackH >= insets.top + 8;
  const onLeft = anchor.x + anchor.w / 2 <= W / 2;
  // Närmast knappen kommer först när kapslarna glider fram.
  const direction = above ? 1 : -1;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => close()}>
      <Animated.View style={[StyleSheet.absoluteFill, s.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <View pointerEvents="box-none" style={[s.stack, {
        top: above ? anchor.y - stackH : anchor.y + anchor.h + GAP,
        alignItems: onLeft ? 'flex-start' : 'flex-end',
        ...(onLeft ? { left: anchor.x } : { right: W - anchor.x - anchor.w }),
      }]}>
        {options.map((o, i) => {
          const distance = above ? options.length - i : i + 1;
          return (
            <Animated.View key={o.key} style={{
              opacity: glassFade,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [direction * distance * 22, 0], extrapolate: 'clamp' }) },
                { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1], extrapolate: 'clamp' }) },
              ],
            }}>
              <TouchableOpacity style={s.pill} onPress={() => close(o.onPress)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: !!o.selected }}>
                <GlassSurface radius={PILL_RADIUS} />
                <Animated.View style={[s.pillContent, { opacity: progress }]}>
                  <Ionicons name={o.icon} size={20} color={accent} />
                  <Text style={s.pillText}>{o.label}</Text>
                  {o.selected && <Ionicons name="checkmark" size={18} color={accent} />}
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(3,8,18,0.72)' },
  stack: { position: 'absolute', gap: GAP },
  pill: { height: PILL_H, justifyContent: 'center', paddingHorizontal: 18 },
  pillContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pillText: { color: Colors.textPrimary, fontSize: 15.5, fontWeight: '700' },
});
