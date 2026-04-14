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

export default function RootLayout() {
  const router = useRouter();
  const { loadLanguage } = useLanguageStore();
  const { loadTimeFormat } = useTimeFormatStore();
  const { loadTheme, theme } = useThemeStore();

  useEffect(() => {
    const init = async () => {
      try {
        await getDatabase();
        await seedIcaoAirports();
        await loadLanguage();
        await loadTimeFormat();
        await loadTheme();
        const onboarded = await getSetting('has_onboarded');
        if (!onboarded) {
          router.replace('/onboarding');
        }
      } catch (err) {
        console.error('DB init error:', err);
      }
    };
    init();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }} key={theme}>
      <StatusBar style={theme === 'bright' ? 'dark' : 'light'} />
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
        <Stack.Screen name="settings/auditlog" options={{ title: 'Change log' }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
