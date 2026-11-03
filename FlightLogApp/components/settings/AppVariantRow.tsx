// Högra togglen i Settings-kortet med PILOT | DRONE (ModeToggleRow): Blades Extensive eller Blades Essential
// (app/essential).
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { GlassDialog, DialogIcon } from '../GlassDialog';
import { useAppVariantStore } from '../../store/appVariantStore';

const ACTIVE = { backgroundColor: 'rgba(0,200,232,0.14)', borderColor: 'rgba(0,200,232,0.5)' };

export function AppVariantToggle() {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const confirm = () => {
    setAsking(false);
    // Låt rutan tona ut innan skärmen byts: en Modal som stängs mitt i en navigering kan hänga sig.
    setTimeout(() => {
      router.replace('/essential');
      // Efter övergången: flikarna skickar vidare till Essential så fort varianten ändras och skulle bli tomma under den.
      setTimeout(() => { useAppVariantStore.getState().setVariant('essential').catch(() => {}); }, 500);
    }, 220);
  };
  return (
    <>
      <GlassDialog
        visible={asking}
        onClose={() => setAsking(false)}
        icon={<DialogIcon name="albums-outline" />}
        eyebrow="App"
        title="Switch to Blades Essential?"
        body="A simpler app: log flights, see your logbook, import and export. All your data stays, and you can switch back any time."
        primary={{ label: 'Switch', onPress: confirm }}
        secondary={{ label: 'Cancel', onPress: () => setAsking(false) }}
      />
      {/* Halva kortet: texten krymper hellre än bryts på smala telefoner. */}
      <View style={{ flex: 1, height: 44, borderRadius: 11, padding: 4, flexDirection: 'row', backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.cardBorder }}>
        <View accessible accessibilityLabel="App, Blades Extensive selected" accessibilityState={{ selected: true }}
          style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderRadius: 8, borderWidth: 1 }, ACTIVE]}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.primary }}>EXTENSIVE</Text>
        </View>
        <Pressable onPress={() => setAsking(true)} accessibilityRole="button" accessibilityLabel="Switch to Blades Essential"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: Colors.textSecondary }}>ESSENTIAL</Text>
        </Pressable>
      </View>
    </>
  );
}
