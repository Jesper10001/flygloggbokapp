// Blades Essential → Security: samma reglage som Settings → App, inget annat.
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, ScrollView, Switch, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors } from '../../constants/colors';
import { AppBackground } from '../../components/AppBackground';
import { GlassSurface } from '../../components/GlassDialog';
import { ICloudSyncRow } from '../../components/settings/ICloudSyncRow';
import { EssentialHeader, EssentialRow, useEssentialAccent } from '../../components/essential/EssentialUi';
import { useAppLockStore } from '../../store/appLockStore';
import { useAiConsentStore } from '../../store/aiConsentStore';
import { requestAiConsent } from '../../services/aiConsent';

export default function EssentialSecurity() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useEssentialAccent();

  const lockEnabled = useAppLockStore((s) => s.enabled);
  const lockAvailable = useAppLockStore((s) => s.available);
  const aiConsent = useAiConsentStore((s) => s.consent);
  const [locGranted, setLocGranted] = useState(false);

  const refreshLocation = useCallback(() => {
    Location.getForegroundPermissionsAsync().then((p) => setLocGranted(p.granted)).catch(() => {});
  }, []);
  useFocusEffect(refreshLocation);
  // Platstillståndet ändras i iOS-inställningar, utanför appen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refreshLocation(); });
    return () => sub.remove();
  }, [refreshLocation]);

  const toggleLock = async (next: boolean) => {
    if (next && !lockAvailable) {
      Alert.alert('Face ID unavailable', 'Set up Face ID or Touch ID for your device, then try again.');
      return;
    }
    await useAppLockStore.getState().setEnabled(next);
  };
  const toggleAi = async (next: boolean) => {
    if (next) await requestAiConsent();
    else await useAiConsentStore.getState().setConsent('declined');
  };
  // iOS låter inte appen stänga av platstillståndet: påslag frågar, annars öppnas Inställningar.
  const toggleLocation = async (next: boolean) => {
    try {
      if (next) {
        const cur = await Location.getForegroundPermissionsAsync();
        if (cur.granted) { setLocGranted(true); return; }
        if (cur.canAskAgain) {
          const r = await Location.requestForegroundPermissionsAsync();
          if (r.granted) { setLocGranted(true); return; }
        }
      }
      Linking.openSettings();
    } catch { /* ignore */ }
  };
  const track = { false: Colors.elevated, true: accent };

  return (
    <View style={{ flex: 1 }}>
      <AppBackground accent={accent} />
      <EssentialHeader title="Security" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <View>
          <GlassSurface radius={20} />
          <EssentialRow icon="finger-print-outline" accent={accent} title="Require Face ID to open"
            subtitle={lockAvailable ? (lockEnabled ? 'On · Face ID required to open the app' : 'Off') : 'Set up Face ID / Touch ID to enable'}
            right={<Switch value={lockEnabled} disabled={!lockAvailable} onValueChange={toggleLock} trackColor={track} />} />
          <EssentialRow icon="location-outline" accent={accent} title="Allow app to show my position"
            subtitle={locGranted ? 'On' : 'Off · used to find nearby airports'}
            right={<Switch value={locGranted} onValueChange={toggleLocation} trackColor={track} />} />
          <EssentialRow icon="sparkles-outline" accent={accent} title="AI features"
            subtitle={aiConsent === 'granted' ? 'On · scans, imports & look-ups via Anthropic' : "Off · you'll be asked before anything is sent"}
            right={<Switch value={aiConsent === 'granted'} onValueChange={toggleAi} trackColor={track} />} />
          <ICloudSyncRow flat accent={accent} />
          <EssentialRow icon="lock-closed-outline" accent={accent} title="Encryption" subtitle="Protected by iOS · optional AES-256"
            onPress={() => router.push('/settings/encryption')} border={false} />
        </View>
      </ScrollView>
    </View>
  );
}
