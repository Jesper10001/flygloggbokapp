import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { Text } from 'react-native';
import { BladesTabIcon } from '../../components/BladesTabIcon';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { getSetting } from '../../db/flights';

const PAGE_SIZE = 12; // flygningar per blad

export default function TabsLayout() {
  const { t } = useTranslation();
  const { flightCount } = useFlightStore();
  const { mode } = useAppModeStore();
  const [scanBadge, setScanBadge] = useState(false);
  const isDrone = mode === 'drone';

  useEffect(() => {
    (async () => {
      const saved = await getSetting('scan_page_start_count');
      const startCount = parseInt(saved ?? '0', 10) || 0;
      setScanBadge(flightCount - startCount >= PAGE_SIZE);
    })();
  }, [flightCount]);

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 0.5,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.tabIconDefault,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
        headerShown: true,
        headerTitle: '',
        headerStyle: { backgroundColor: Colors.background },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: isDrone ? null : undefined,
          title: t('tab_dashboard'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          href: isDrone ? null : undefined,
          title: t('tab_logbook'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          href: isDrone ? null : undefined,
          title: '',
          tabBarLabel: () => null,
          tabBarIcon: ({ size, focused }) => (
            <BladesTabIcon size={size + 4} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="drone-dashboard"
        options={{
          href: isDrone ? undefined : null,
          title: t('tab_dashboard'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="drone-log"
        options={{
          href: isDrone ? undefined : null,
          title: t('tab_logbook'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="drone-prep"
        options={{
          href: isDrone ? undefined : null,
          title: t('tab_prep_flight'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tab_settings'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
