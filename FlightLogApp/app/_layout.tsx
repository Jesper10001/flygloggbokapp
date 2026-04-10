import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getDatabase } from '../db/database';
import { seedIcaoAirports } from '../db/icao';
import { Colors } from '../constants/colors';

export default function RootLayout() {
  useEffect(() => {
    const init = async () => {
      try {
        await getDatabase();
        await seedIcaoAirports();
      } catch (err) {
        console.error('DB init error:', err);
      }
    };
    init();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="flight/[id]" options={{ title: 'Flygning' }} />
        <Stack.Screen name="flight/add" options={{ title: 'Logga flygning', presentation: 'modal' }} />
        <Stack.Screen name="flight/review" options={{ title: 'Granska OCR-data', presentation: 'modal' }} />
        <Stack.Screen name="import/index" options={{ title: 'Importera loggbok', presentation: 'modal' }} />
        <Stack.Screen name="settings/airport" options={{ title: 'Hantera flygplatser' }} />
        <Stack.Screen name="settings/auditlog" options={{ title: 'Ändringslogg' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
