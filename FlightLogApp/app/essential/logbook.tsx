// Blades Essential → Logbook: flygningarna per år och månad, utan sök och filter, och aktivitetskalendern under.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackground } from '../../components/AppBackground';
import { YearMonthAccordion } from '../../components/logbook-page/YearMonthAccordion';
import { LogbookEmptyCTA } from '../../components/logbook-page/LogbookEmptyCTA';
import { HeatmapCalendar } from '../../components/insights/ActivitySection';
import { EssentialHeader, useEssentialAccent } from '../../components/essential/EssentialUi';
import { DroneActivityCalendar, DroneYearMonthAccordion } from '../(tabs)/drone-log';
import { useAppModeStore } from '../../store/appModeStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useFlightStore } from '../../store/flightStore';

export default function EssentialLogbook() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDrone = useAppModeStore((s) => s.mode) === 'drone';
  const accent = useEssentialAccent();
  const { flights: pilotFlights, loadFlights: loadPilot } = useFlightStore();
  const { flights: droneFlights, loadFlights: loadDrone } = useDroneFlightStore();
  const [loaded, setLoaded] = useState(false);
  // "Open this day in logbook" i kalendern: dagens flygningar fälls upp och ramas in här i listan.
  const scrollRef = useRef<ScrollView>(null);
  const [viewportH, setViewportH] = useState(0);
  const [focus, setFocus] = useState<{ date: string; nonce: string } | null>(null);

  // Hämtas vid varje besök: en flygning kan ha ändrats eller raderats på detaljsidan.
  const load = useCallback(() => {
    Promise.resolve(isDrone ? loadDrone() : loadPilot()).catch(() => {}).finally(() => setLoaded(true));
  }, [isDrone, loadDrone, loadPilot]);
  useFocusEffect(load);
  useEffect(() => { setLoaded(false); }, [isDrone]);

  const count = isDrone ? droneFlights.length : pilotFlights.length;

  return (
    <View style={{ flex: 1 }}>
      <AppBackground accent={accent} />
      <EssentialHeader title={isDrone ? 'Drone logbook' : 'Logbook'} />
      <ScrollView ref={scrollRef} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {!loaded && count === 0 ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : count === 0 ? (
          <LogbookEmptyCTA accent={accent} mode={isDrone ? 'drone' : 'pilot'} />
        ) : isDrone ? (
          <>
            <DroneYearMonthAccordion flights={droneFlights} accent={accent} forceOpen={false} onOpen={(id) => router.push(`/drone-flight/${id}`)} />
            <View style={{ paddingHorizontal: 14, marginTop: 14 }}>
              <DroneActivityCalendar flights={droneFlights} accent={accent} />
            </View>
          </>
        ) : (
          <>
            <YearMonthAccordion flights={pilotFlights} accent={accent} filter="all" photoMode={false} forceOpen={false}
              onOpenFlight={(f) => router.push(`/flight/detail/${f.id}`)}
              focusDate={focus?.date ?? null} focusNonce={focus?.nonce ?? null} scrollRef={scrollRef} viewportH={viewportH} />
            <View style={{ paddingHorizontal: 14, marginTop: 14 }}>
              <HeatmapCalendar onOpenDay={(date) => setFocus({ date, nonce: String(Date.now()) })} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
