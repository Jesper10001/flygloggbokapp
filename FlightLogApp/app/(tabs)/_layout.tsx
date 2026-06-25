import { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { Text, View, TouchableOpacity, Image } from 'react-native';
import { useProfileStore, isOperator } from '../../store/profileStore';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useThemeStore } from '../../store/themeStore';
import { useAppModeStore } from '../../store/appModeStore';
import { getSetting } from '../../db/flights';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';

const PAGE_SIZE = 12; // flygningar per blad

export default function TabsLayout() {
  const { t } = useTranslation();
  const { flightCount, isPremium, isMax } = useFlightStore();
  const { mode } = useAppModeStore();
  const _theme = useThemeStore(s => s.theme);
  const [scanBadge, setScanBadge] = useState(false);
  const isDrone = mode === 'drone';
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  useEffect(() => { loadAccent(); }, [loadAccent]);

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
          backgroundColor: isDrone ? DR.surface : Colors.surface,
          borderTopColor: isDrone ? DR.border : Colors.border,
          borderTopWidth: 0.5,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: isDrone ? accent : Colors.primary,
        tabBarInactiveTintColor: isDrone ? DR.faint : Colors.tabIconDefault,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
        headerShown: true,
        headerTitle: '',
        headerStyle: { backgroundColor: isDrone ? DR.background : Colors.background, height: 50 },
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
      {/* Center-logga = "+ Log flight" (manned). Dold i drönarläge (där drone-fab är center). */}
      <Tabs.Screen
        name="scan"
        options={{
          href: isDrone ? null : undefined,
          title: '',
          tabBarButton: isDrone
            ? undefined
            : () => <LogFlightButton premium={isPremium || isMax} onPress={() => router.push(isOperator(useProfileStore.getState().profile) ? '/flight/add-operator' : '/flight/add')} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          href: isDrone ? null : undefined,
          title: t('tab_transcription'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="analytics-outline" size={size} color={color} />
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
        name="drone-fab"
        options={{
          href: isDrone ? undefined : null,
          title: '',
          tabBarButton: isDrone
            ? () => <DroneFabButton accent={accent} onPress={() => router.push('/drone-flight/add')} />
            : undefined,
        }}
      />
      <Tabs.Screen
        name="drone-book"
        options={{
          href: isDrone ? undefined : null,
          title: t('tab_book'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="book-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="drone-prep"
        options={{
          href: null,
          title: t('tab_prep_flight'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: isDrone ? null : undefined,
          title: t('tab_settings'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="drone-settings"
        options={{
          href: isDrone ? undefined : null,
          title: t('tab_settings'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

function LogFlightButton({ premium, onPress }: { premium: boolean; onPress: () => void }) {
  // Premium/Max → guld, annars cyan. Båda är tight-beskurna (fyller ramen) → SAMMA höjd
  // och SAMMA plats; varje bild med sin egen aspekt (resizeMode contain, ingen distorsion).
  const h = 53;
  const w = premium ? h * (1024 / 960) : h * (1536 / 1024);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        style={{ alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
        <Image source={premium ? require('../../assets/goldfloatingb.png') : require('../../assets/cyanfloatingb.png')}
          style={{ height: h, width: w }} resizeMode="contain" />
      </TouchableOpacity>
    </View>
  );
}

function DroneFabButton({ accent, onPress }: { accent: string; onPress: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={{
          width: 52, height: 52, borderRadius: 26, backgroundColor: accent,
          alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          shadowColor: accent, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
        }}
      >
        <Ionicons name="add" size={30} color={DR.inkOnAccent} />
      </TouchableOpacity>
    </View>
  );
}
