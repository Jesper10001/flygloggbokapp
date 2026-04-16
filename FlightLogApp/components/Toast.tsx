import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../constants/colors';
import { create } from 'zustand';

interface ToastStore {
  message: string | null;
  show: (message: string) => void;
  hide: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  show: (message: string) => {
    set({ message });
    setTimeout(() => set({ message: null }), 2400);
  },
  hide: () => set({ message: null }),
}));

export function ToastHost() {
  const message = useToastStore((s) => s.message);
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
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity, transform: [{ translateY: translate }] }]}>
      <View style={styles.pill}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', zIndex: 9999,
  },
  pill: {
    backgroundColor: Colors.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.primary + '66',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
});
