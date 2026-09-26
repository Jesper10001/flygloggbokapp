import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { getUserDataInventory, type DataInventory } from '../../db/appData';
import { wipeEverything } from '../../services/wipeData';
import { useFlightStore } from '../../store/flightStore';
import { useAppLockStore } from '../../store/appLockStore';
import { useICloudStore } from '../../store/icloudStore';
import { useProfileStore } from '../../store/profileStore';
import { useToastStore } from '../../components/Toast';

export default function ManageDataScreen() {
  const router = useRouter();
  const [inv, setInv] = useState<DataInventory | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getUserDataInventory().then(setInv).catch(() => setInv(null)); }, []);

  const rows: { label: string; value: number }[] = inv ? [
    { label: 'Flights (pilot)', value: inv.flights },
    { label: 'Drone flights', value: inv.droneFlights },
    { label: 'Aircraft', value: inv.aircraft },
    { label: 'Drones', value: inv.drones },
    { label: 'Logbooks', value: inv.logbooks },
    { label: 'Certificates', value: inv.certificates },
    { label: 'Custom export templates', value: inv.templates },
    { label: 'Photos & videos', value: inv.media },
    { label: 'Custom / off-airport places', value: inv.customPlaces },
  ] : [];

  const doWipe = async () => {
    setBusy(true);
    try {
      await wipeEverything();
      // Nollställ minnes-state så inget gammalt hänger kvar.
      try { useFlightStore.getState().setIsPremium(false); } catch { /* ignore */ }
      try { await useFlightStore.getState().loadFlights(); await useFlightStore.getState().loadStats(); } catch { /* ignore */ }
      try { useAppLockStore.setState({ enabled: false, unlocked: true, available: useAppLockStore.getState().available }); } catch { /* ignore */ }
      try { await useICloudStore.getState().refresh(); } catch { /* ignore */ }
      try { await useProfileStore.getState().load(); } catch { /* ignore */ }
      // Kort bekräftelse (ToastHost ligger i root-layouten → syns kvar efter navigeringen).
      try { useToastStore.getState().show('Your data was deleted'); } catch { /* ignore */ }
      router.replace('/onboarding');
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not delete', e?.message ?? 'Something went wrong. Please try again.');
    }
  };

  const confirmFinal = () => {
    Alert.alert(
      'Delete everything?',
      'This permanently erases all your data — on this device and in your iCloud backup. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: doWipe },
      ],
    );
  };

  const onClearPress = () => {
    Alert.alert(
      'Clear all data and flights',
      'This will permanently delete everything you have entered — flights, aircraft, logbooks, photos and settings — on this device and in your iCloud backup. This cannot be undone.\n\nWould you like to export your data first?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export first', onPress: () => router.replace({ pathname: '/(tabs)/settings', params: { expand: 'export' } }) },
        { text: 'Delete without exporting', style: 'destructive', onPress: confirmFinal },
      ],
    );
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.heroBadge}><Ionicons name="folder-open-outline" size={24} color={Colors.primary} /></View>
          <Text style={s.heroTitle}>Your data</Text>
          <Text style={s.heroSub}>Everything you've entered into Blades, stored on this device.</Text>
        </View>

        <View style={s.card}>
          {inv == null ? (
            <View style={{ padding: 24, alignItems: 'center' }}><ActivityIndicator color={Colors.primary} /></View>
          ) : (
            rows.map((r, i) => (
              <View key={r.label} style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
                <Text style={s.rowLabel}>{r.label}</Text>
                <Text style={s.rowValue}>{r.value.toLocaleString('en-US')}</Text>
              </View>
            ))
          )}
        </View>

        {inv?.profileName ? (
          <Text style={s.note}>Profile: {inv.profileName}</Text>
        ) : null}

        <Text style={s.note}>
          Promo codes are tied to your device on our server and are not affected by clearing local data.
        </Text>

        <TouchableOpacity style={[s.clearBtn, busy && { opacity: 0.6 }]} onPress={onClearPress} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color={Colors.danger} /> : (
            <>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              <Text style={s.clearText}>Clear all data and flights</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 4, paddingHorizontal: 8 },
  heroBadge: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary + '1A',
    borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontFamily: 'Georgia', fontSize: 23, fontWeight: '400', color: Colors.textPrimary },
  heroSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  rowLabel: { fontSize: 14, color: Colors.textPrimary },
  rowValue: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'Menlo' },
  note: { fontSize: 11.5, color: Colors.textMuted, lineHeight: 16, paddingHorizontal: 4 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 8, paddingVertical: 15, borderRadius: 14,
    backgroundColor: Colors.danger + '18', borderWidth: 1, borderColor: Colors.danger + '55',
  },
  clearText: { color: Colors.danger, fontSize: 15, fontWeight: '800' },
});
