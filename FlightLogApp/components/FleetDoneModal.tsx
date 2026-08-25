// Centrerad modal efter CSV-import när Fleet-datan berikats/uppdaterats. GLOBAL (renderas i
// _layout, som ToastHost) eftersom import-skärmen ofta hunnit stängas när bakgrundsberikningen
// blir klar. Kort sammanfattning + knapp till Fleet-sidan; X uppe till vänster struntar i den.
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { create } from 'zustand';
import { Colors } from '../constants/colors';

interface FleetDoneStore {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useFleetDoneStore = create<FleetDoneStore>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));

export function FleetDoneHost() {
  const visible = useFleetDoneStore((s) => s.visible);
  const hide = useFleetDoneStore((s) => s.hide);

  const goFleet = () => {
    hide();
    // Logbook-FLIKEN (app/(tabs)/log.tsx → PilotLogbook), inte helskärms-boken (/logbook).
    router.push({ pathname: '/(tabs)/log', params: { view: 'fleet', t: String(Date.now()) } } as any);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={hide}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity onPress={hide} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.close} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.iconWrap}>
            <Ionicons name="airplane" size={26} color={Colors.primary} />
          </View>
          <Text style={styles.title}>Fleet updated</Text>
          <Text style={styles.body}>Your fleet of aircraft has been updated after the CSV import. Check it out!</Text>
          <TouchableOpacity onPress={goFleet} style={styles.btn} activeOpacity={0.85}>
            <Text style={styles.btnText}>Navigate to fleet page</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: {
    width: '100%', maxWidth: 360, backgroundColor: Colors.card, borderRadius: 20, borderWidth: 1, borderColor: Colors.primary + '55',
    paddingTop: 30, paddingBottom: 20, paddingHorizontal: 22, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 10,
  },
  close: { position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  iconWrap: { width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  btn: { alignSelf: 'stretch', backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
});
