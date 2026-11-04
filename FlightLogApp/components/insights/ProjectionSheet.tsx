// Bottenpanel för Projections (Target / Pace / Goals): glider upp över Insights och en mörk bakgrund
// tonar in bakom den. Egen Animated i stället för Modalens "slide", så att bakgrunden tonar och inte glider med.
// Innehållet ligger kvar medan panelen stängs (föräldern byter det inte förrän nästa öppning).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, Animated, Easing, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { InsightsTheme } from './insightsTheme';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';

export function ProjectionSheet({ C, visible, title, sub, onClose, children }: {
  C: InsightsTheme; visible: boolean; title: string; sub: string; onClose: () => void; children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [visible, anim]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,8,16,0.62)', opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[st.sheet, {
          backgroundColor: C.card, borderColor: C.border, paddingBottom: insets.bottom + 16, maxHeight: height * 0.88,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
        }]}
      >
        <View style={[st.grabber, { backgroundColor: C.border }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: SERIF, fontSize: 20, fontWeight: '600', color: C.text }}>{title}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10.5, color: C.text2 }}>{sub}</Text>
          </View>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={[st.close, { borderColor: C.border, backgroundColor: C.elevated }]}>
            <Ionicons name="close" size={18} color={C.text2} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 16, paddingBottom: 2 }} showsVerticalScrollIndicator={false} bounces={false}>
          {children}
        </ScrollView>
        <TouchableOpacity onPress={onClose} style={[st.done, { backgroundColor: C.primary }]} accessibilityRole="button">
          <Text style={{ fontFamily: MONO, fontSize: 14, fontWeight: '700', color: C.deep }}>Done</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1,
    paddingTop: 10, paddingHorizontal: 16, gap: 16,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: -12 },
  },
  grabber: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center' },
  close: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  done: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
