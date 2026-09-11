// Centrerad modal efter CSV-import när Fleet-datan berikats/uppdaterats. GLOBAL (renderas i
// _layout, som ToastHost) eftersom import-skärmen ofta hunnit stängas när bakgrundsberikningen
// blir klar. Kort sammanfattning + knapp till Fleet-sidan; X uppe till vänster struntar i den.
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { create } from 'zustand';
import { Colors } from '../constants/colors';

// Info om berikningen (för partiell-hämtning/uppgraderings-läget). null = enkel "klart"-variant.
export interface FleetDoneInfo { enriched: number; total: number; remaining: number; stoppedForQuota: boolean; }

interface FleetDoneStore {
  visible: boolean;
  info: FleetDoneInfo | null;
  show: (info?: FleetDoneInfo) => void;
  hide: () => void;
}

export const useFleetDoneStore = create<FleetDoneStore>((set) => ({
  visible: false,
  info: null,
  show: (info) => set({ visible: true, info: info ?? null }),
  hide: () => set({ visible: false }),
}));

export function FleetDoneHost() {
  const visible = useFleetDoneStore((s) => s.visible);
  const info = useFleetDoneStore((s) => s.info);
  const hide = useFleetDoneStore((s) => s.hide);

  const goFleet = () => {
    hide();
    // Logbook-FLIKEN (app/(tabs)/log.tsx → PilotLogbook), inte helskärms-boken (/logbook).
    router.push({ pathname: '/(tabs)/log', params: { view: 'fleet', t: String(Date.now()) } } as any);
  };
  const goUpgrade = () => {
    hide();
    router.push('/settings/premium' as any);
  };

  // Pausad pga slut på Blade-coins → visa hur många som hämtades + uppgraderingsknapp.
  const partial = !!info?.stoppedForQuota && info.remaining > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={hide}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity onPress={hide} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.close} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.iconWrap}>
            <Ionicons name={partial ? 'server' : 'airplane'} size={26} color={Colors.primary} />
          </View>
          {partial ? (
            <>
              <Text style={styles.title}>Fleet partly updated</Text>
              <Text style={styles.body}>
                Fetched specs & images for {info!.enriched} of {info!.total} aircraft. You're out of Blade-coins —
                upgrade to Blades Premium to fetch the remaining {info!.remaining}.
              </Text>
              <TouchableOpacity onPress={goUpgrade} style={styles.btn} activeOpacity={0.85}>
                <Text style={styles.btnText}>Upgrade to Blades Premium</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goFleet} style={styles.btnGhost} activeOpacity={0.7}>
                <Text style={styles.btnGhostText}>Go to fleet page</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Fleet updated</Text>
              <Text style={styles.body}>Your fleet of aircraft has been updated after the CSV import. Check it out!</Text>
              <TouchableOpacity onPress={goFleet} style={styles.btn} activeOpacity={0.85}>
                <Text style={styles.btnText}>Navigate to fleet page</Text>
              </TouchableOpacity>
            </>
          )}
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
  btnGhost: { alignSelf: 'stretch', paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  btnGhostText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
});
