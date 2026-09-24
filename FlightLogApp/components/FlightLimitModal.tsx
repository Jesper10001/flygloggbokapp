import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Popup när free-användaren nått gratisgränsen för manuellt loggade flygningar (pilot resp. drönare).
// Uppmanar till Blades Premium — enda vägen till obegränsat antal flygningar.
const N = {
  sheet: '#102441',
  cardBorder: '#1A3A5A',
  goldSoft: 'rgba(255, 184, 48, 0.10)',
  goldEdge: 'rgba(255, 184, 48, 0.35)',
  gold: '#FFB830',
  bg: '#0A1628',
  text: '#FFFFFF',
  text2: '#B5C8D8',
  text3: '#7FA8C8',
};

interface Props {
  visible: boolean;
  kind: 'pilot' | 'drone';
  limit: number;
  onClose: () => void;
  onGoPremium: () => void;
}

export function FlightLimitModal({ visible, kind, limit, onClose, onGoPremium }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(40);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const noun = kind === 'drone' ? 'drone flights' : 'flights';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Animated.View style={[s.sheetWrap, { transform: [{ translateY: slideAnim }], opacity: opacityAnim }]}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={e => e.stopPropagation()}>
            <View style={s.handleRow}>
              <View style={{ width: 32 }} />
              <View style={s.handle} />
              <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={12}>
                <Ionicons name="close" size={16} color={N.text3} />
              </TouchableOpacity>
            </View>

            <View style={s.badge}>
              <Ionicons name="airplane" size={26} color={N.gold} />
            </View>

            <Text style={s.title}>You've logged {limit} free {noun}</Text>

            <Text style={s.lead}>
              The free plan includes <Text style={s.leadBold}>{limit} manually logged {noun}</Text>. Everything else in
              Blades stays free — go Premium for <Text style={s.leadBold}>unlimited flights</Text> and a monthly
              refill of Blade-coins.
            </Text>

            <TouchableOpacity style={s.ctaPrimary} onPress={onGoPremium} activeOpacity={0.85}>
              <Ionicons name="star" size={16} color={N.bg} />
              <Text style={s.ctaPrimaryText}>Go to Blades Premium</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.ctaSecondary} onPress={onClose}>
              <Text style={s.ctaSecondaryText}>Not now</Text>
            </TouchableOpacity>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(4, 12, 24, 0.72)', justifyContent: 'flex-end' },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: N.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: N.cardBorder,
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: N.cardBorder },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: N.goldSoft,
    borderWidth: 1, borderColor: N.goldEdge, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginTop: 6, marginBottom: 14,
  },
  title: {
    fontFamily: 'Georgia', fontSize: 25, fontWeight: '400', letterSpacing: -0.4,
    lineHeight: 30, color: N.text, textAlign: 'center', marginBottom: 12, paddingHorizontal: 8,
  },
  lead: {
    fontSize: 14.5, color: N.text2, textAlign: 'center', lineHeight: 22,
    marginBottom: 24, paddingHorizontal: 6,
  },
  leadBold: { color: N.text, fontWeight: '600' },
  ctaPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: N.gold, borderRadius: 100, paddingVertical: 15, marginBottom: 8,
  },
  ctaPrimaryText: { color: N.bg, fontSize: 15.5, fontWeight: '700', letterSpacing: -0.1 },
  ctaSecondary: { alignItems: 'center', paddingVertical: 12 },
  ctaSecondaryText: { color: N.text3, fontSize: 14, fontWeight: '600' },
});
