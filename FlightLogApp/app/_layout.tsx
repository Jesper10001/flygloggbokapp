import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import * as ScreenOrientation from 'expo-screen-orientation';
import { ToastHost } from '../components/Toast';

export default function RootLayout() {
  const router = useRouter();
  const { loadLanguage } = useLanguageStore();
  const { loadTimeFormat } = useTimeFormatStore();
  const { loadTheme, theme } = useThemeStore();
  const { loadMode } = useAppModeStore();

  useEffect(() => {
    // Lås rotation till portrait som default — bara transkriberingsvyn
    // släpper till landscape
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { /* ignore */ });
    const init = async () => {
      try {
        await getDatabase();
        const { isPremium } = useFlightStore.getState();
        await seedIcaoAirports(isPremium);
        await loadLanguage();
        await loadTimeFormat();
        await loadTheme();
        await loadMode();
        await useOperatorStore.getState().loadOperatorId();
        await usePilotTypeStore.getState().load();
        const { mode } = useAppModeStore.getState();
        await useThemeStore.getState().applyForMode(mode);
        const onboarded = await getSetting('has_onboarded');
        if (!onboarded) {
          router.replace('/onboarding');
          return;
        }
        // Mode-picker visas alltid vid appstart — användaren väljer aktivt vilket läge
        router.replace('/mode-picker');
      } catch (err) {
        console.error('DB init error:', err);
      }
    };
    init();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={theme === 'bright' ? 'dark' : 'light'} key={theme} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="flight/[id]" options={{ title: 'Flight' }} />
        <Stack.Screen name="flight/add" options={{ title: 'Log flight', presentation: 'modal' }} />
        <Stack.Screen name="flight/review" options={{ title: 'Review OCR data', presentation: 'modal' }} />
        <Stack.Screen name="import/index" options={{ title: 'Import logbook', presentation: 'modal' }} />
        <Stack.Screen name="settings/airport" options={{ title: 'Manage airports' }} />
        <Stack.Screen name="settings/drones" options={{ title: 'Manage drones' }} />
        <Stack.Screen name="settings/certificates" options={{ title: 'Certificates' }} />
        <Stack.Screen name="drone-flight/add" options={{ title: 'Log drone flight', presentation: 'modal' }} />
        <Stack.Screen name="drone-flight/[id]" options={{ title: 'Flight' }} />
        <Stack.Screen name="settings/auditlog" options={{ title: 'Change log' }} />
        <Stack.Screen name="settings/profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="settings/logbook-books" options={{ title: 'Physical logbooks' }} />
        <Stack.Screen name="transcribe" options={{ title: 'Transcribe' }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="mode-picker" options={{ headerShown: false }} />
        <Stack.Screen name="drone-onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="manned-onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="preview" options={{ headerShown: false }} />
        <Stack.Screen name="manned-preview" options={{ headerShown: false }} />
      </Stack>
      <ToastHost />
    </GestureHandlerRootView>
  );
}
