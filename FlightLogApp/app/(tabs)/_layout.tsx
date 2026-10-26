import { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { Text, View, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useThemeStore } from '../../store/themeStore';
import { useAppModeStore } from '../../store/appModeStore';
import { getSetting, getManualFlightCount } from '../../db/flights';
import { getDroneFlightCount } from '../../db/drones';
import { FREE_TIER_LIMIT, FREE_TIER_LIMIT_DRONE } from '../../constants/easa';
import { FlightLimitModal } from '../../components/FlightLimitModal';
import { TourPress } from '../../components/TourPress';
import { GlassTabBar } from '../../components/GlassTabBar';
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

  // Gratisgräns nådd → visa uppmaning till Premium istället för att öppna Log Flight.
  const [limitModal, setLimitModal] = useState<null | 'pilot' | 'drone'>(null);
  const premium = isPremium || isMax;

  // Kollar mot databasen vid tryck (färsk siffra) → free-användaren stoppas vid gränsen.
  const openLogFlight = async () => {
    if (!premium) {
      const n = await getManualFlightCount().catch(() => 0);
      if (n >= FREE_TIER_LIMIT) { setLimitModal('pilot'); return; }
    }
    router.push('/flight/add');
  };
  const openDroneFlight = async () => {
    if (!premium) {
      const n = await getDroneFlightCount().catch(() => 0);
      if (n >= FREE_TIER_LIMIT_DRONE) { setLimitModal('drone'); return; }
    }
    router.push('/drone-flight/add');
  };

  useEffect(() => {
    (async () => {
      const saved = await getSetting('scan_page_start_count');
      const startCount = parseInt(saved ?? '0', 10) || 0;
      setScanBadge(flightCount - startCount >= PAGE_SIZE);
    })();
  }, [flightCount]);

  return (
    <>
    <Tabs
      // Lägesbytet navigerar EXPLICIT till rätt dashboard (settings/drone-settings, deferred
      // efter re-render) → ingen remount-key behövs. /(tabs) löser sig till manned-ankaret
      // 'index'; drönarläget navigeras explicit till '/(tabs)/drone-dashboard'.
      // Flytande glas-flikrad: innehållet rullar under den (skärmarna lägger useTabBarSpace() i botten).
      tabBar={(props) => (
        <GlassTabBar {...props} activeTint={isDrone ? accent : Colors.primary} inactiveTint="#C9D9EA" />
      )}
      screenOptions={{
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
            : () => <LogFlightButton premium={isPremium || isMax} onPress={openLogFlight} />,
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
            ? () => <DroneFabButton premium={isPremium || isMax} onPress={openDroneFlight} />
            : undefined,
        }}
      />
      <Tabs.Screen
        name="drone-insights"
        options={{
          href: isDrone ? undefined : null,
          title: t('tab_transcription'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="analytics-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Book flyttad till settings ("Your logbook") för manned-paritet — ej tab */}
      <Tabs.Screen
        name="drone-book"
        options={{ href: null }}
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
    <FlightLimitModal
      visible={limitModal !== null}
      kind={limitModal ?? 'pilot'}
      limit={limitModal === 'drone' ? FREE_TIER_LIMIT_DRONE : FREE_TIER_LIMIT}
      onClose={() => setLimitModal(null)}
      onGoPremium={() => { setLimitModal(null); router.push('/settings/premium'); }}
    />
    </>
  );
}

function LogFlightButton({ onPress }: { premium: boolean; onPress: () => void }) {
  // ALLTID cyan B-logga (oförändrad i free/premium) — guld-varianten används inte längre.
  const h = 52; // ryms i glas-kapseln (TAB_BAR_HEIGHT 62)
  const w = h * (1536 / 1024);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
        style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Image source={require('../../assets/cyanfloatingb.png')}
          style={{ height: h, width: w }} resizeMode="contain" />
        <TourPress id="fab" radius={14} />
      </TouchableOpacity>
    </View>
  );
}

// Drönar-center = SAMMA B-logga som manned — ALLTID cyan (visuell paritet, oförändrad vid premium).
function DroneFabButton({ onPress }: { premium: boolean; onPress: () => void }) {
  const h = 52; // ryms i glas-kapseln (TAB_BAR_HEIGHT 62)
  const w = h * (1536 / 1024);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
        style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Image source={require('../../assets/cyanfloatingb.png')}
          style={{ height: h, width: w }} resizeMode="contain" />
        <TourPress id="fab" radius={14} />
      </TouchableOpacity>
    </View>
  );
}
