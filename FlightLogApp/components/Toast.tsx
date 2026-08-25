import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { create } from 'zustand';

interface ToastStore {
  message: string | null;
  action: (() => void) | null; // om satt → tappbar toast; körs vid tryck
  show: (message: string, action?: () => void) => void;
  hide: () => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  message: null,
  action: null,
  show: (message: string, action?: () => void) => {
    set({ message, action: action ?? null });
    // Utan action: kort auto-dölj. Med action: längre (så man hinner trycka), men försvinner ändå.
    const ttl = action ? 8000 : 2400;
    setTimeout(() => { if (get().message === message) set({ message: null, action: null }); }, ttl);
  },
  hide: () => set({ message: null, action: null }),
}));

export function ToastHost() {
  const message = useToastStore((s) => s.message);
  const action = useToastStore((s) => s.action);
  const hide = useToastStore((s) => s.hide);
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    if (message) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translate, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(translate, { toValue: -20, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [message]);

  if (!message) return null;

  // Tappbar toast (action satt) → TouchableOpacity + chevron; annars ren info-pill (ej tappbar).
  const inner = (
    <View style={[styles.pill, action && styles.pillAction]}>
      <Text style={styles.text}>{message}</Text>
      {action && <Ionicons name="chevron-forward" size={15} color={Colors.primary} style={{ marginLeft: 8 }} />}
    </View>
  );

  return (
    <Animated.View pointerEvents={action ? 'box-none' : 'none'} style={[styles.wrap, { opacity, transform: [{ translateY: translate }] }]}>
      {action ? (
        <TouchableOpacity activeOpacity={0.85} onPress={() => { const a = action; hide(); a?.(); }}>
          {inner}
        </TouchableOpacity>
      ) : inner}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', zIndex: 9999,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.primary + '66',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pillAction: { borderColor: Colors.primary, paddingVertical: 12 },
  text: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
});
