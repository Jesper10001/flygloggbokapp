// Ram för Projections och Next licence i liggande helskärm. Skärmen är liggande på två sätt: routen har
// orientation 'landscape' (navigeringen roterar själv), och appen låses i liggande läge som den digitala loggboken
// (lockAsync väntas aldrig in, det kan hänga). Står telefonen ändå kvar i stående läge vrids innehållet 90°, så att
// det aldrig visas hoptryckt. Innehållet visas först när rotationen lagt sig, och tillbakanavigeringen väntar en kort
// stund så rotationen tillbaka hunnit börja.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const [settled, setSettled] = useState(false);
  const [late, setLate] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    const t1 = setTimeout(() => setSettled(true), 260);
    const t2 = setTimeout(() => setLate(true), 700);
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

  const landscape = width > height;
  let body: ReactNode = null;
  if (!leaving && settled && landscape) body = children(close);
  else if (!leaving && late && !landscape) {
    // Telefonen roterade inte: vrid innehållet medurs. Innehållets vänsterkant hamnar där ön är (överkanten) och
    // högerkanten vid hemindikatorn, så marginalerna byter plats på samma sätt.
    body = (
      <SafeAreaInsetsContext.Provider value={{ top: insets.right, right: insets.bottom, bottom: insets.left, left: insets.top }}>
        <View style={{ position: 'absolute', width: height, height: width, left: (width - height) / 2, top: (height - width) / 2, transform: [{ rotate: '90deg' }] }}>
          {children(close)}
        </View>
      </SafeAreaInsetsContext.Provider>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <StatusBar hidden />
      {body}
    </View>
  );
}
