import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Font from 'expo-font';
import { getDatabase } from '../db/database';
import { seedIcaoAirports } from '../db/icao';
import { getSetting } from '../db/flights';
import { Colors } from '../constants/colors';
import { useLanguageStore } from '../store/languageStore';
import { useTimeFormatStore } from '../store/timeFormatStore';
import { useThemeStore } from '../store/themeStore';
import { useAppModeStore } from '../store/appModeStore';
import { useFlightStore } from '../store/flightStore';
import { useOperatorStore } from '../store/operatorStore';
import { usePilotTypeStore } from '../store/pilotTypeStore';
import { useProfileStore } from '../store/profileStore';
import { useScanProfileStore } from '../store/scanProfileStore';
import { cleanupDittoEntries } from '../db/ocrLearned';
import { useVersionStore } from '../store/versionStore';
import * as ScreenOrientation from 'expo-screen-orientation';
import { ToastHost } from '../components/Toast';

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const { loadLanguage } = useLanguageStore();
  const { loadTimeFormat } = useTimeFormatStore();
  const { loadTheme, theme } = useThemeStore();
  const { loadMode } = useAppModeStore();
  const { forceUpdate, check: checkVersion } = useVersionStore();

  useEffect(() => {
    // Lås rotation till portrait som default — bara transkriberingsvyn
    // släpper till landscape
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { /* ignore */ });
    const init = async () => {
      try {
        // Ladda designtypsnitten (milestone-korten m.fl.). Variabel-fonterna
        // registreras under stabila family-namn så de kan användas direkt.
        await Font.loadAsync({
          Fraunces: require('../assets/fonts/Fraunces-Variable.ttf'),
          'Fraunces-Italic': require('../assets/fonts/Fraunces-Italic-Variable.ttf'),
          JetBrainsMono: require('../assets/fonts/JetBrainsMono-Variable.ttf'),
          SpaceGrotesk: require('../assets/fonts/SpaceGrotesk-Variable.ttf'),
        }).catch(() => { /* fonter ej kritiska – fall back till system */ });
        setFontsLoaded(true);

        await getDatabase();
        const { isPremium } = useFlightStore.getState();
        await seedIcaoAirports(isPremium);
        await loadLanguage();
        await loadTimeFormat();
        await loadTheme();
        await loadMode();
        await useOperatorStore.getState().loadOperatorId();
        await usePilotTypeStore.getState().load();
        await useProfileStore.getState().load();
        await useScanProfileStore.getState().load();
        await cleanupDittoEntries();
        await checkVersion();
        const { mode } = useAppModeStore.getState();
        await useThemeStore.getState().applyForMode(mode);
        const onboarded = await getSetting('has_onboarded');
        // Wait for layout to mount before navigating
        await new Promise(r => setTimeout(r, 500));
        const dest = !onboarded ? '/onboarding' : '/(tabs)';
        router.replace(dest);
      } catch (err) {
        console.error('DB init error:', err);
      }
    };
    init();
  }, []);

  if (forceUpdate) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <StatusBar style={theme === 'bright' ? 'dark' : 'light'} />
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Ionicons name="arrow-up-circle" size={32} color={Colors.primary} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Uppdatering krävs
        </Text>
        <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
          Den här versionen stöds inte längre. Uppdatera appen för att fortsätta.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 }}
          onPress={() => Linking.openURL('https://apps.apple.com')}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textInverse, fontSize: 16, fontWeight: '700' }}>Öppna App Store</Text>
        </TouchableOpacity>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} key={theme}>
      <StatusBar style={theme === 'bright' ? 'dark' : 'light'} />
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
        <Stack.Screen name="flight/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="milestones/best-week" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="milestones/longest-xc" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="flight/add" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="flight/add-operator" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="flight/review" options={{ title: 'Review OCR data', presentation: 'modal' }} />
        <Stack.Screen name="import/index" options={{ title: 'Import logbook', presentation: 'modal' }} />
        <Stack.Screen name="import/scan" options={{ title: 'Scan logbook', presentation: 'modal' }} />
        <Stack.Screen name="import/manual" options={{ title: 'Manual import', presentation: 'modal' }} />
        <Stack.Screen name="settings/airport" options={{ title: 'Manage airports' }} />
        <Stack.Screen name="settings/drones" options={{ title: 'Manage drones' }} />
        <Stack.Screen name="settings/certificates" options={{ title: 'Certificates' }} />
        <Stack.Screen name="drone-flight/add" options={{ title: 'Log drone flight', presentation: 'modal' }} />
        <Stack.Screen name="drone-flight/[id]" options={{ title: 'Flight' }} />
        <Stack.Screen name="settings/auditlog" options={{ title: 'Change log' }} />
        <Stack.Screen name="settings/scan-profile" options={{ title: 'Scan Profile' }} />
        <Stack.Screen name="settings/custom-export" options={{ title: 'Custom export' }} />
        <Stack.Screen name="settings/premium" options={{ title: 'Premium', headerShown: false }} />
        <Stack.Screen name="settings/profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="settings/logbook-books" options={{ title: 'Physical logbooks' }} />
        <Stack.Screen name="transcribe" options={{ title: 'Transcribe' }} />
        <Stack.Screen name="logbook/index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="mode-picker" options={{ headerShown: false }} />
      </Stack>
      <ToastHost />
    </GestureHandlerRootView>
  );
}
