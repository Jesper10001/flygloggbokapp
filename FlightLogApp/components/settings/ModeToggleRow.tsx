// LOGBOOK-rad med segment-toggle PILOT | DRONE (handoff variant B4). Knoppen glider (Animated translateX)
// och bytet bekräftas med en dialog + lätt haptik innan appläget faktiskt skiftas. Delad av pilot- och
// drönar-settings. Själva lägesbytet (switchProfile) sköts av föräldern via onConfirmSwitch.
// Dialogen är en egen Modal (ser ut som iOS-alerten) i stället för Alert.alert — en native alert kan inte
// visa den gröna raden som lugnar användaren att datan i läget man lämnar finns kvar.
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';
import { DR } from '../../constants/droneTheme';

const SAFE_GREEN = DR.success; // "datan finns kvar" — tydligt grön (cyan-accenten skulle smälta ihop)

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
    <Modal visible={dialog.open} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 }}>
        <View accessibilityViewIsModal style={{
          width: '100%', maxWidth: 340, padding: 22, paddingTop: 24, borderRadius: 30, gap: 14,
          backgroundColor: '#161B24', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
          shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 16,
        }}>
          <Text accessibilityRole="header" style={{ fontSize: 19, fontWeight: '700', color: '#FFFFFF' }}>
            {toDrone ? 'Switch to Drone logbook?' : 'Switch to Pilot logbook?'}
          </Text>
          <Text style={{ fontSize: 16, lineHeight: 22, color: 'rgba(235,241,248,0.72)' }}>
            {toDrone ? 'This switches the whole app to your Drone logbook.' : 'This switches the whole app to your Pilot logbook.'}
          </Text>
          {/* Grön lugnande rad: datan i läget man lämnar ligger kvar orörd (egna tabeller) — man kan byta tillbaka. */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
            backgroundColor: SAFE_GREEN + '1A', borderWidth: 1, borderColor: SAFE_GREEN + '45',
          }}>
            <Ionicons name="shield-checkmark" size={17} color={SAFE_GREEN} />
            <Text style={{ flex: 1, fontSize: 14.5, lineHeight: 19, fontWeight: '600', color: SAFE_GREEN }}>
              {toDrone ? 'All data in Pilot mode is saved.' : 'All data in Drone mode is saved.'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
            {([['Cancel', close], ['Switch', confirm]] as const).map(([label, onPress]) => (
              <Pressable key={label} onPress={onPress} accessibilityRole="button"
                style={({ pressed }) => ({
                  flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed ? 'rgba(255,255,255,0.17)' : 'rgba(255,255,255,0.09)',
                })}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#FFFFFF' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
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
    </>
  );
}
