import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const PREMIUM_PRICE_MONTHLY = 49;
export const PREMIUM_PRICE_YEARLY = 349;
export const PREMIUM_PRICE_YEARLY_MONTHLY = Math.round(PREMIUM_PRICE_YEARLY / 12);

const N = {
  bg: '#0A1628',
  sheet: '#102441',
  cardBorder: '#1A3A5A',
  goldSoft: 'rgba(255, 184, 48, 0.10)',
  goldEdge: 'rgba(255, 184, 48, 0.35)',
  gold: '#FFB830',
  text: '#FFFFFF',
  text2: '#B5C8D8',
  text3: '#7FA8C8',
};

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  camera: 'camera-outline',
  instrument: 'speedometer-outline',
  sparkle: 'sparkles-outline',
  progress: 'trending-up-outline',
  pdf: 'document-outline',
};

const PRIMARY_FEATURES = [
  { icon: 'camera', t: 'Skanna pappersloggbok med AI' },
  { icon: 'instrument', t: 'Logga från instrumentbild' },
  { icon: 'sparkle', t: 'AI-uppslag av flygplan och bana' },
  { icon: 'progress', t: 'EASA-progress med prognos för CPL/ATPL' },
  { icon: 'pdf', t: 'PDF-export — pilot-CV som du faktiskt vill skicka' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  feature?: string;
}

export function PremiumModal({ visible, onClose, feature }: Props) {
  const router = useRouter();
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

  const handleExplore = () => {
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Animated.View style={[s.sheetWrap, { transform: [{ translateY: slideAnim }], opacity: opacityAnim }]}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={e => e.stopPropagation()}>
            {/* Handle + close */}
            <View style={s.handleRow}>
              <View style={{ width: 32 }} />
              <View style={s.handle} />
              <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={12}>
                <Ionicons name="close" size={16} color={N.text3} />
              </TouchableOpacity>
            </View>

            {/* Star badge */}
            <View style={s.starBadge}>
              <Ionicons name="star" size={28} color={N.gold} />
            </View>

            {/* Title */}
            <Text style={s.title}>Premium-funktion</Text>

            {/* Locked feature pill */}
            {feature ? (
              <View style={s.pillRow}>
                <View style={s.pill}>
                  <Ionicons name="lock-closed-outline" size={13} color={N.gold} />
                  <Text style={s.pillText}>{feature}</Text>
                </View>
              </View>
            ) : null}

            {/* Lead */}
            <Text style={s.lead}>
              Premium öppnar upp <Text style={s.leadBold}>AI-loggning</Text>, <Text style={s.leadBold}>EASA-progress</Text> och en <Text style={s.leadBold}>professionell PDF-export</Text>.
            </Text>

            {/* Feature list */}
            <View style={s.featureList}>
              {PRIMARY_FEATURES.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <View style={s.featureIcon}>
                    <Ionicons name={ICON_MAP[f.icon] ?? 'sparkles-outline'} size={15} color={N.gold} />
                  </View>
                  <Text style={s.featureText}>{f.t}</Text>
                </View>
              ))}
            </View>

            {/* Primary CTA */}
            <TouchableOpacity style={s.ctaPrimary} onPress={handleExplore} activeOpacity={0.85}>
              <Text style={s.ctaPrimaryText}>Upptäck allt i Premium</Text>
              <Ionicons name="arrow-forward" size={16} color={N.bg} />
            </TouchableOpacity>

            {/* Secondary */}
            <TouchableOpacity style={s.ctaSecondary} onPress={onClose}>
              <Text style={s.ctaSecondaryText}>Inte nu</Text>
            </TouchableOpacity>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 12, 24, 0.72)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
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
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: N.cardBorder,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: N.goldSoft,
    borderWidth: 1,
    borderColor: N.goldEdge,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '400',
    letterSpacing: -0.4,
    lineHeight: 29,
    color: N.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  pillRow: {
    alignItems: 'center',
    marginBottom: 14,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: N.goldSoft,
    borderWidth: 1,
    borderColor: N.goldEdge,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
    color: N.gold,
    letterSpacing: -0.1,
  },
  lead: {
    fontSize: 14.5,
    color: N.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 22,
    paddingHorizontal: 6,
  },
  leadBold: {
    color: N.text,
    fontWeight: '600',
  },
  featureList: {
    gap: 12,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: N.goldSoft,
    borderWidth: 1,
    borderColor: N.goldEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 14,
    color: N.text,
    fontWeight: '500',
    lineHeight: 19,
    flex: 1,
  },
  ctaPrimary: {
    width: '100%',
    paddingVertical: 15,
    backgroundColor: N.gold,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaPrimaryText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
    color: N.bg,
  },
  ctaSecondary: {
    width: '100%',
    marginTop: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  ctaSecondaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: N.text3,
  },
});
