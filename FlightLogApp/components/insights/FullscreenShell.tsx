// Ram för Projections och Next licence i liggande helskärm. Låser liggande läge när skärmen öppnas och stående
// igen när den stängs, som den digitala loggboken: lockAsync väntas aldrig in (det kan hänga), innehållet visas
// först när rotationen lagt sig, och tillbakanavigeringen väntar en kort stund så rotationen hunnit börja.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Colors } from '../../constants/colors';
import type { InsightsTheme } from './insightsTheme';

// Stängknappen sitter där helskärmsknappen satt på kortet: direkt efter rubriken.
export function FullscreenClose({ C, onPress }: { C: InsightsTheme; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel="Close full screen"
      hitSlop={{ top: 9, bottom: 9, left: 6, right: 9 }}
      style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="contract-outline" size={13} color={C.text2} />
    </TouchableOpacity>
  );
}

export function FullscreenShell({ children }: { children: (close: () => void) => ReactNode }) {
  const { width, height } = useWindowDimensions();
  const [settled, setSettled] = useState(false);
  const [late, setLate] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    const t1 = setTimeout(() => setSettled(true), 260);
    // Roterar skärmen inte (t.ex. iPad i delad vy) visas innehållet ändå efter en stund.
    const t2 = setTimeout(() => setLate(true), 900);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  const close = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTimeout(() => { router.back(); }, 230);
  };

  const show = !leaving && settled && (width > height || late);
  return <View style={{ flex: 1, backgroundColor: Colors.background }}>{show ? children(close) : null}</View>;
}
