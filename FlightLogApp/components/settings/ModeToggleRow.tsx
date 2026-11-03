// Kortet med två segment-toggles, utan rubriker: PILOT | DRONE till vänster och EXTENSIVE | ESSENTIAL till
// höger (AppVariantToggle). PILOT | DRONE: knoppen glider (Animated translateX) och bytet bekräftas med en
// dialog + lätt haptik innan appläget faktiskt skiftas. Delad av pilot- och drönar-settings. Själva
// lägesbytet (switchProfile) sköts av föräldern via onConfirmSwitch.
// Dialogen är appens popup-ruta (GlassDialog) i stället för Alert.alert — en native alert kan inte visa den
// gröna raden som lugnar användaren att datan i läget man lämnar finns kvar.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';
import { DR } from '../../constants/droneTheme';
import { GlassDialog, DialogIcon } from '../GlassDialog';
import { AppVariantToggle } from './AppVariantRow';

const SAFE_GREEN = DR.success; // "datan finns kvar" — tydligt grön (cyan-accenten skulle smälta ihop)

const PAD = 4;
const BORDER = 1;

export function ModeToggleRow({ mode, onConfirmSwitch }: {
  mode: 'manned' | 'drone';
  onConfirmSwitch: (target: 'manned' | 'drone') => void;
}) {
  const isDrone = mode === 'drone';
  const anim = useRef(new Animated.Value(isDrone ? 1 : 0)).current;
  // Segmentet delar kortets bredd med app-togglen. Knoppen = halva insidan (ramen + paddingen avdragna).
  const [segW, setSegW] = useState(0);
  const KNOB_W = Math.max(0, (segW - BORDER * 2 - PAD * 2) / 2);

  // Håll knoppen i synk med aktuellt läge (t.ex. om man landar här efter ett byte).
  // JS-driver (useNativeDriver:false) → den interpolerade positionen appliceras direkt vid varje render,
  // så knoppen hamnar rätt redan vid mount (native-driver applicerade ibland inte initialvärdet → boxen
  // fastnade till vänster medan bara texten highlightades).
  useEffect(() => {
    Animated.spring(anim, { toValue: isDrone ? 1 : 0, useNativeDriver: false, friction: 9, tension: 80 }).start();
  }, [isDrone, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, KNOB_W] });

  // Bekräftelsedialogen. target behålls även när den stängs → texten byter inte riktning under uttoningen.
  const [dialog, setDialog] = useState<{ open: boolean; target: 'manned' | 'drone' }>({ open: false, target: 'drone' });
  const toDrone = dialog.target === 'drone';
  const close = () => setDialog((d) => ({ ...d, open: false }));

  const press = (target: 'manned' | 'drone') => {
    if (target === mode) return;
    setDialog({ open: true, target });
  };

  const confirm = () => {
    if (!dialog.open) return;
    const target = dialog.target;
    close();
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* haptik valfri */ }
    // Animera INTE knoppen här mot target — knoppen styrs ENBART av `isDrone` (useEffect:en ovan).
    // Att flytta knoppen mot target och sedan navigera gjorde att den fastnade på fel plats om
    // skärmen låg kvar monterad och `isDrone` inte ändrades (t.ex. drönar-settings). Nu glider den
    // via useEffect:en när läget faktiskt ändras → alltid i synk med vald sida.
    // Låt dialogen tona ut innan bytet (som byter skärm) — en Modal som stängs mitt i en navigering kan hänga sig.
    setTimeout(() => onConfirmSwitch(target), 220);
  };

  return (
    <>
    <GlassDialog
      visible={dialog.open}
      onClose={close}
      icon={<DialogIcon name={toDrone ? 'hardware-chip-outline' : 'airplane-outline'} />}
      eyebrow="Logbook"
      title={toDrone ? 'Switch to Drone logbook?' : 'Switch to Pilot logbook?'}
      body={
        <Text style={{ color: Colors.textSecondary, fontSize: 14.5, lineHeight: 20, textAlign: 'center', marginTop: 2 }}>
          {toDrone ? 'This switches the whole app to your Drone logbook.' : 'This switches the whole app to your Pilot logbook.'}
          {'\n'}
          {/* Andra meningen i grönt: datan i läget man lämnar ligger kvar orörd (egna tabeller). */}
          <Text style={{ color: SAFE_GREEN }}>{toDrone ? 'All data in Pilot mode is saved.' : 'All data in Drone mode is saved.'}</Text>
        </Text>
      }
      primary={{ label: 'Switch', onPress: confirm }}
      secondary={{ label: 'Cancel', onPress: close }}
    />
    <View style={{
      marginHorizontal: 20, marginTop: 24, padding: 10, gap: 10, borderRadius: 16,
      backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row', alignItems: 'center',
    }}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`Logbook, ${isDrone ? 'Drone' : 'Pilot'} selected`}
        onLayout={(e) => setSegW(e.nativeEvent.layout.width)}
        style={{ flex: 1, height: 44, borderRadius: 11, padding: PAD, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row' }}
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
      <AppVariantToggle />
    </View>
    </>
  );
}
