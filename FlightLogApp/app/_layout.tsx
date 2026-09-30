import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, ActivityIndicator, AppState, Image } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Font from 'expo-font';
import { getDatabase } from '../db/database';
import { runEncryptionSelfTest } from '../db/sqlite';
import { seedIcaoAirports } from '../db/icao';
import { getSetting, setSetting } from '../db/flights';
import { checkPromoEntitlement } from '../services/promo';
import { Colors } from '../constants/colors';
import { useLanguageStore } from '../store/languageStore';
import { useTimeFormatStore } from '../store/timeFormatStore';
import { useThemeStore } from '../store/themeStore';
import { useAppModeStore } from '../store/appModeStore';
import { useFlightStore } from '../store/flightStore';
import { useOperatorStore } from '../store/operatorStore';
import { usePilotTypeStore } from '../store/pilotTypeStore';
import { useProfileStore } from '../store/profileStore';
import { cleanupDittoEntries } from '../db/ocrLearned';
import { logLogbookDiagnostics } from '../services/logbook/diagnostics';
import { useTokenQuotaStore } from '../store/tokenQuotaStore';
import { useRegulationStandardStore } from '../store/regulationStandardStore';
import { useVersionStore } from '../store/versionStore';
import * as ScreenOrientation from 'expo-screen-orientation';
import { ToastHost } from '../components/Toast';
import { FleetDoneHost } from '../components/FleetDoneModal';
import { SplashOverlay } from '../components/SplashOverlay';
import { AppLockGate } from '../components/AppLockGate';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAppLockStore } from '../store/appLockStore';
import { useICloudStore } from '../store/icloudStore';
import { isEnabled as icloudEnabled } from '../services/icloudSync';

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [initError, setInitError] = useState<string | null>(null); // start-fel (t.ex. DB kunde inte öppnas)
  const [retryNonce, setRetryNonce] = useState(0);                  // ökas av "Try again" → kör om init
  const { loadLanguage } = useLanguageStore();
  const { loadTimeFormat } = useTimeFormatStore();
  const { loadTheme, theme } = useThemeStore();
  const { loadMode } = useAppModeStore();
  const { forceUpdate, storeUrl, check: checkVersion } = useVersionStore();

  // Auto-backup till iCloud när appen går till bakgrunden (om synk är på). Bara lokala fil-ops körs
  // synkront — själva uppladdningen sköter iOS efteråt. Debouncad 60 s. Tyst vid fel.
  useEffect(() => {
    let last = 0;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background') return;
      const now = Date.now();
      if (now - last < 60000) return;
      last = now;
      (async () => {
        try {
          if (!(await icloudEnabled())) return;
          const st = useICloudStore.getState();
          if (st.busy) return;
          await st.backupNow();
        } catch { /* tyst i bakgrunden */ }
      })();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Lås rotation till portrait som default — bara transkriberingsvyn
    // släpper till landscape
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { /* ignore */ });
    const init = async () => {
      setInitError(null);
      try {
        // Ladda designtypsnitten (milestone-korten m.fl.). Variabel-fonterna
        // registreras under stabila family-namn så de kan användas direkt.
        await Font.loadAsync({
          Fraunces: require('../assets/fonts/Fraunces-Variable.ttf'),
          'Fraunces-Italic': require('../assets/fonts/Fraunces-Italic-Variable.ttf'),
          JetBrainsMono: require('../assets/fonts/JetBrainsMono-Variable.ttf'),
          SpaceGrotesk: require('../assets/fonts/SpaceGrotesk-Variable.ttf'),
          DSEG7Classic: require('../assets/fonts/DSEG7Classic-Bold.ttf'),
          ChakraPetch: require('../assets/fonts/ChakraPetch-SemiBold.ttf'),
          'ChakraPetch-SemiBold': require('../assets/fonts/ChakraPetch-SemiBold.ttf'),
        }).catch(() => { /* fonter ej kritiska – fall back till system */ });
        setFontsLoaded(true);

        await getDatabase();
        // App-lås (Face ID) laddas tidigt så låsskärmen kan visas innan innehåll renderas.
        await useAppLockStore.getState().load().catch(() => {});
        // DEV-ONLY: verifierar att SQLCipher är aktivt och att fel nyckel avvisas. Loggar [crypto] ... i konsolen.
        if (__DEV__) runEncryptionSelfTest();
        // Promo-kod (gratis Premium): cache-först (snabbt/offline) → server-verifiering i bakgrunden.
        // Servern (proxyns KV) är sanningskällan → revocera en testare genom att ta bort KV-nyckeln.
        const promoCached = (await getSetting('promo_premium').catch(() => null)) === '1';
        if (promoCached) useFlightStore.getState().setIsPremium(true);
        checkPromoEntitlement().then(async (prem) => {
          if (prem === true) { useFlightStore.getState().setIsPremium(true); await setSetting('promo_premium', '1').catch(() => {}); }
          else if (prem === false && promoCached) { useFlightStore.getState().setIsPremium(false); await setSetting('promo_premium', '0').catch(() => {}); }
        }).catch(() => {});
        const { isPremium } = useFlightStore.getState();
        await seedIcaoAirports(isPremium);
        await loadLanguage();
        await loadTimeFormat();
        await loadTheme();
        await loadMode();
        await useOperatorStore.getState().loadOperatorId();
        await usePilotTypeStore.getState().load();
        await useProfileStore.getState().load();
        await cleanupDittoEntries();
        logLogbookDiagnostics(); // TILLFÄLLIG felsökning → loggbokstotaler till Metro-terminalen vid varje start
        useTokenQuotaStore.getState().load(); // fire-and-forget — får inte blockera app-starten på nätverk
        useRegulationStandardStore.getState().load(); // EASA/FAA-val → styr insights hours bank m.m.
        await checkVersion();
        const { mode } = useAppModeStore.getState();
        await useThemeStore.getState().applyForMode(mode);
        const onboarded = await getSetting('has_onboarded');
        // Wait for layout to mount before navigating
        await new Promise(r => setTimeout(r, 500));
        // Drönarläge → navigera EXPLICIT till drönar-dashboarden. '/(tabs)' löser sig annars
        // till ankaret 'index' (manned, href:null i drönarläge) → svart skärm vid omstart.
        const dest = !onboarded ? '/onboarding' : (mode === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)');
        router.replace(dest as any);
      } catch (err: any) {
        // Startfel (oftast DB kunde inte öppnas — korrupt fil eller SQLCipher-nyckel saknas).
        // Visa en recovery-vy i stället för att hänga kvar på splash för alltid.
        console.error('DB init error:', err);
        setInitError(String(err?.message ?? err ?? 'Unknown error'));
        setFontsLoaded(true); // så vi lämnar splash-gaten och kan rendera recovery-vyn
      }
    };
    init();
  }, [retryNonce]);

  if (forceUpdate) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <StatusBar style={'light'} />
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Ionicons name="arrow-up-circle" size={32} color={Colors.primary} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Update required
        </Text>
        <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
          This version is no longer supported. Update the app to continue.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 }}
          onPress={() => Linking.openURL(storeUrl)}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textInverse, fontSize: 16, fontWeight: '700' }}>Open App Store</Text>
        </TouchableOpacity>
      </GestureHandlerRootView>
    );
  }

  // Startfel (t.ex. databasen kunde inte öppnas): visa en recovery-vy med "Try again" i stället
  // för att fastna på splash. Datan ligger kvar på enheten — omstart eller iCloud-restore är vägen ut.
  if (initError) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <StatusBar style={'light'} />
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.danger + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Ionicons name="warning" size={32} color={Colors.danger} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Couldn't start
        </Text>
        <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
          The app couldn't open your logbook database. Your data is still on this device. Try again, or restart the app. If it keeps failing, you can restore from an iCloud backup after reinstalling.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 }}
          onPress={() => setRetryNonce((n) => n + 1)}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textInverse, fontSize: 16, fontWeight: '700' }}>Try again</Text>
        </TouchableOpacity>
      </GestureHandlerRootView>
    );
  }

  // Vänta med att montera navigatorn tills typsnitten registrerats — annars hinner skärmar
  // (dashboardens LED/serif-text m.fl.) renderas med system-fallback och ritas inte om när fonten
  // laddats klart. Native-splashen matchar denna navy-yta → sömlös övergång. fontsLoaded sätts alltid
  // (även om laddningen fallerar) så detta kan aldrig fastna.
  if (!fontsLoaded) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style={'light'} />
        <Image source={require('../assets/logo-splashscreen.png')} style={{ width: 380, height: 380 }} resizeMode="contain" />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} key={theme}>
      <StatusBar style={'light'} />
      <ErrorBoundary>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          headerBackTitle: '',
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="flight/detail/[id]" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="milestones/best-week" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="milestones/longest-xc" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="flight/add" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="flight/review" options={{ title: 'Review OCR data', presentation: 'modal' }} />
        <Stack.Screen name="import/index" options={{ title: 'Import logbook', presentation: 'modal' }} />
        <Stack.Screen name="import/scan" options={{ title: 'Scan logbook', presentation: 'modal' }} />
        <Stack.Screen name="import/manual" options={{ title: 'Manual import', presentation: 'modal' }} />
        <Stack.Screen name="import/history" options={{ title: 'Imported data', presentation: 'modal' }} />
        <Stack.Screen name="drone-import/index" options={{ title: 'Import CSV', presentation: 'modal' }} />
        <Stack.Screen name="drone-import/history" options={{ title: 'Imported data', presentation: 'modal' }} />
        <Stack.Screen name="drone-import/manual" options={{ title: 'Log flight manually', presentation: 'modal' }} />
        <Stack.Screen name="photo-sync" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="settings/airport" options={{ title: 'Manage airports', presentation: 'modal' }} />
        <Stack.Screen name="settings/album" options={{ title: 'Flight album', presentation: 'modal' }} />
        <Stack.Screen name="settings/drones" options={{ title: 'Manage drones', presentation: 'modal' }} />
        <Stack.Screen name="settings/certificates" options={{ title: 'Certificates', presentation: 'modal' }} />
        <Stack.Screen name="currency" options={{ title: 'Current today?', presentation: 'modal' }} />
        <Stack.Screen name="drone-flight/add" options={{ title: 'Log drone flight', presentation: 'modal' }} />
        <Stack.Screen name="drone-flight/[id]" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="drone-album" options={{ headerShown: false }} />
        <Stack.Screen name="settings/auditlog" options={{ title: 'Change log', presentation: 'modal' }} />
        <Stack.Screen name="settings/custom-export" options={{ title: 'Custom export', presentation: 'modal' }} />
        <Stack.Screen name="settings/premium" options={{ title: 'Premium', headerShown: false }} />
        <Stack.Screen name="settings/profile" options={{ title: 'Profile', presentation: 'modal' }} />
        <Stack.Screen name="settings/logbook-books" options={{ title: 'Physical logbooks', presentation: 'modal' }} />
        <Stack.Screen name="settings/icloud" options={{ title: 'iCloud Storage', presentation: 'modal' }} />
        <Stack.Screen name="settings/encryption" options={{ title: 'Encryption', presentation: 'modal' }} />
        <Stack.Screen name="settings/manage-data" options={{ title: 'Manage app data', presentation: 'modal' }} />
        <Stack.Screen name="transcribe" options={{ title: 'Transcribe' }} />
        <Stack.Screen name="logbook/index" options={{ headerShown: false }} />
        <Stack.Screen name="drone-logbook/index" options={{ headerShown: false }} />
        <Stack.Screen name="logbook/fill" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="mode-picker" options={{ headerShown: false }} />
        <Stack.Screen name="wrapped" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
      </ErrorBoundary>
      <ToastHost />
      <FleetDoneHost />
      <SplashOverlay />
      <AppLockGate />
    </GestureHandlerRootView>
  );
}
