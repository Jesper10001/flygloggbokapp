// Rad under LOGBOOK-växlaren i Settings: Blades Extensive eller Blades Essential (app/essential).
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { GlassDialog, DialogIcon } from '../GlassDialog';
import { useAppVariantStore } from '../../store/appVariantStore';

const ACTIVE = { backgroundColor: 'rgba(0,200,232,0.14)', borderColor: 'rgba(0,200,232,0.5)' };

export function AppVariantRow() {
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
      <View style={{
        marginHorizontal: 20, marginTop: 10, height: 64, paddingLeft: 20, paddingRight: 10, borderRadius: 16,
        backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, flexDirection: 'row', alignItems: 'center',
      }}>
        <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase', color: Colors.textMuted }}>App</Text>
        <View style={{ width: 196, height: 44, borderRadius: 11, padding: 4, flexDirection: 'row', backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.cardBorder }}>
          <View accessibilityState={{ selected: true }} style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 }, ACTIVE]}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.primary }}>EXTENSIVE</Text>
          </View>
          <Pressable onPress={() => setAsking(true)} accessibilityRole="button" accessibilityLabel="Switch to Blades Essential" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textSecondary }}>ESSENTIAL</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}
