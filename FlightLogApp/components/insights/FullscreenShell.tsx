// Ram för Projections och Next licence i liggande helskärm. Öppningen sker i tre lugna steg så att inget hoppar:
// 1) skärmen tonar in som en tom navy-yta medan routen fortfarande är stående (Insights bakom vrids aldrig),
// 2) först när toningen är klar byts routens orientation till liggande (setOptions, react-native-screens roterar
//    då själv) och appen låses liggande; det som vrids är bara den tomma ytan,
// 3) när rotationen lagt sig tonar innehållet in. Stängningen är samma sak baklänges: innehållet tonas ut, ytan
// vrids tillbaka till stående och först därefter går navigeringen tillbaka, så Insights syns aldrig liggande.
// lockAsync väntas aldrig in (det kan hänga). Står telefonen ändå kvar i stående läge vrids innehållet 90°.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, TouchableOpacity, Animated, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
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

const ROTATE_MS = 340;   // iOS rotationsanimation, ungefär
const FADE_MS = 200;

export function FullscreenShell({ children }: { children: (close: () => void) => ReactNode }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [asked, setAsked] = useState(false);     // liggande begärt (efter in-toningen)
  const [ready, setReady] = useState(false);     // rotationen har lagt sig → innehållet får visas
  const [late, setLate] = useState(false);       // telefonen vägrade vrida → vrid innehållet själva
  const leavingRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const landscape = width > height;

  // Steg 2: när in-toningen är klar (eller senast efter 320 ms) begärs liggande läge.
  useEffect(() => {
    let done = false;
    const ask = () => {
      if (done) return;
      done = true;
      (navigation as any).setOptions({ orientation: 'landscape' });
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      setAsked(true);
    };
    const off = (navigation as any).addListener?.('transitionEnd', ask);
    const t = setTimeout(ask, 320);
    return () => {
      clearTimeout(t);
      off?.();
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [navigation]);

  // Steg 3: liggande + rotationen klar → innehållet monteras och tonas in. Vägrar telefonen vrida → vrid själva.
  useEffect(() => {
    if (!asked || leavingRef.current) return;
    if (landscape) {
      const t = setTimeout(() => setReady(true), ROTATE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLate(true), 800);
    return () => clearTimeout(t);
  }, [asked, landscape]);

  const show = (ready && landscape) || (late && !landscape);
  useEffect(() => {
    if (show) Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
  }, [show, opacity]);

  // Stängning: tona ut → vrid tillbaka den tomma ytan → navigera tillbaka när skärmen står (senast efter 700 ms).
  const close = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setReady(false); setLate(false);
      (navigation as any).setOptions({ orientation: 'portrait_up' });
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      waitPortrait.current = Date.now();
      setTick((n) => n + 1);
    });
  };
  const waitPortrait = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!waitPortrait.current) return;
    const back = () => { if (waitPortrait.current) { waitPortrait.current = 0; router.back(); } };
    if (!landscape) { const t = setTimeout(back, ROTATE_MS); return () => clearTimeout(t); }
    const t = setTimeout(back, Math.max(0, 700 - (Date.now() - waitPortrait.current)));
    return () => clearTimeout(t);
  }, [tick, landscape]);

  let body: ReactNode = null;
  if (show && landscape) body = children(close);
  else if (show && !landscape) {
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
      <Animated.View style={{ flex: 1, opacity }}>{body}</Animated.View>
    </View>
  );
}
