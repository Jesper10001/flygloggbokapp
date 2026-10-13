// LOGBOOK-rad med segment-toggle PILOT | DRONE (handoff variant B4). Knoppen glider (Animated translateX)
// och bytet bekräftas med en Alert + lätt haptik innan appläget faktiskt skiftas. Delad av pilot- och
// drönar-settings. Själva lägesbytet (switchProfile) sköts av föräldern via onConfirmSwitch.
import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';

const SEG_W = 176;
const PAD = 4;
const BORDER = 1;
// Dra av ramen (1px per sida) + paddingen så knoppen matchar segmenten exakt.
const KNOB_W = (SEG_W - BORDER * 2 - PAD * 2) / 2; // 83

export function ModeToggleRow({ mode, onConfirmSwitch }: {
  mode: 'manned' | 'drone';
  onConfirmSwitch: (target: 'manned' | 'drone') => void;
}) {
  const isDrone = mode === 'drone';
  const anim = useRef(new Animated.Value(isDrone ? 1 : 0)).current;

  // Håll knoppen i synk med aktuellt läge (t.ex. om man landar här efter ett byte).
  // JS-driver (useNativeDriver:false) → den interpolerade positionen appliceras direkt vid varje render,
  // så knoppen hamnar rätt redan vid mount (native-driver applicerade ibland inte initialvärdet → boxen
  // fastnade till vänster medan bara texten highlightades).
  useEffect(() => {
    Animated.spring(anim, { toValue: isDrone ? 1 : 0, useNativeDriver: false, friction: 9, tension: 80 }).start();
  }, [isDrone, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, KNOB_W] });

  const press = (target: 'manned' | 'drone') => {
    if (target === mode) return;
    const toDrone = target === 'drone';
    Alert.alert(
      toDrone ? 'Switch to Drone logbook?' : 'Switch to Pilot logbook?',
      toDrone ? 'This switches the whole app to your Drone logbook.' : 'This switches the whole app to your Pilot logbook.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: () => {
            try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* haptik valfri */ }
            // Animera INTE knoppen här mot target — knoppen styrs ENBART av `isDrone` (useEffect:en ovan).
            // Att flytta knoppen mot target och sedan navigera gjorde att den fastnade på fel plats om
            // skärmen låg kvar monterad och `isDrone` inte ändrades (t.ex. drönar-settings). Nu glider den
            // via useEffect:en när läget faktiskt ändras → alltid i synk med vald sida.
            onConfirmSwitch(target);
          },
        },
      ],
    );
  };

  return (
    <View style={{
      marginHorizontal: 20, marginTop: 24, height: 64, paddingLeft: 20, paddingRight: 10, borderRadius: 16,
      backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row', alignItems: 'center',
    }}>
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase', color: Colors.textMuted }}>
        Logbook
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`Logbook, ${isDrone ? 'Drone' : 'Pilot'} selected`}
        style={{ width: SEG_W, height: 44, borderRadius: 11, padding: PAD, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row' }}
      >
        <Animated.View style={{
          // top + bottom = PAD → lika stort glapp upptill/nedtill (symmetrisk höjd oavsett ramen).
          position: 'absolute', top: PAD, bottom: PAD, left: PAD, width: KNOB_W, borderRadius: 8,
          backgroundColor: 'rgba(0,200,232,0.14)', borderWidth: 1, borderColor: 'rgba(0,200,232,0.5)',
          transform: [{ translateX }],
        }} />
        <Pressable onPress={() => press('manned')} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.8, color: !isDrone ? Colors.primary : Colors.textSecondary }}>PILOT</Text>
        </Pressable>
        <Pressable onPress={() => press('drone')} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.8, color: isDrone ? Colors.primary : Colors.textSecondary }}>DRONE</Text>
        </Pressable>
      </View>
    </View>
  );
}
