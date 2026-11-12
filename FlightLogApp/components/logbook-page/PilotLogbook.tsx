// Pilot-manned Logbook-skärm (ej operator): 3-vägsväljare List / Book / Fleet.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useTourStore } from '../../store/tourStore';
import { DEMO_FLIGHTS } from '../../constants/tourDemoData';
import { batchPlaceNames } from '../../db/icao';
import type { Flight } from '../../types/flight';
import { SegmentedToggle, type ToggleOption } from './SegmentedToggle';
import { ListView } from './ListView';
import { FleetView } from './FleetView';
import { BookView } from './BookView';

type LogView = 'list' | 'book' | 'fleet';
const OPTIONS: ToggleOption<LogView>[] = [
  { key: 'list', icon: 'list' },
  { key: 'book', icon: 'book-outline' },
  { key: 'fleet', icon: 'grid-outline' },
];

export function PilotLogbook() {
  const router = useRouter();
  const accent = Colors.primary;
  const { flights: realFlights, isLoading, loadFlights, loadStats } = useFlightStore();
  // Blades introduction: exempelflygningen (bara i minnet) läggs överst medan rundturen kör, och DEMO-
  // flygningar fyller på när loggboken annars är tom.
  const tourDemo = useTourStore((s) => s.demo);
  const tourExample = useTourStore((s) => (s.active ? s.examplePilot : null));
  const tourActive = useTourStore((s) => s.active);
  const flights = useMemo(
    () => (tourDemo || tourExample
      ? [...(tourExample ? [tourExample] : []), ...realFlights, ...(tourDemo ? DEMO_FLIGHTS : [])].sort((x, y) => y.date.localeCompare(x.date))
      : realFlights),
    [tourDemo, tourExample, realFlights],
  );
  const [view, setView] = useState<LogView>('list');
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  // Deep-link-expansion (år/månad) från heatmapen. Nollställs vid vy-byte och när
  // fliken lämnas så att List alltid öppnas i grundform (inget år/månad intryckt).
  const [expand, setExpand] = useState<{ year: number | null; monthKey: string | null }>({ year: null, monthKey: null });

  useFocusEffect(useCallback(() => {
    loadFlights(); loadStats();
    return () => setExpand({ year: null, monthKey: null });
  }, []));

  useEffect(() => {
    const icaos = flights.flatMap((f) => [f.dep_place, f.arr_place].filter(Boolean));
    if (icaos.length) batchPlaceNames(icaos).then(setPlaceNames);
  }, [flights]);

  // Djuplänk från Insights-heatmapen: öppna List och expandera rätt år/månad.
  const params = useLocalSearchParams<{ focusFlightId?: string; focusDate?: string; focusStart?: string; focusEnd?: string; focusYear?: string; focusMonth?: string; t?: string; view?: string }>();
  useEffect(() => {
    if (!params.focusYear || !params.focusMonth) return;
    const fy = Number(params.focusYear), fm = Number(params.focusMonth);
    setView('list');
    setExpand({ year: fy, monthKey: `${fy}-${fm - 1}` });
  }, [params.focusFlightId, params.focusYear, params.focusMonth, params.t]);

  // Djuplänk till en specifik vy (t.ex. Fleet efter CSV-import: /logbook?view=fleet).
  useEffect(() => {
    if (params.view === 'fleet' || params.view === 'book' || params.view === 'list') setView(params.view);
  }, [params.view, params.t]);

  const openFlight = (f: Flight) => router.push(`/flight/detail/${f.id}`);

  // Väljaren ligger i headern på samma rad som sidans titel (titel vänster, toggle höger).
  // Manuellt vy-byte rensar deep-link-expansionen → List öppnas i grundform.
  const switchView = (v: LogView) => { setView(v); setExpand({ year: null, monthKey: null }); };
  // Pennan till vänster om väljaren öppnar Edit flights (app/bulk-edit.tsx): ändra många flygningar på en gång.
  // Bara i list-vyn (inte i Book eller Fleet), inte under rundturen (exempelflygningarna finns inte i databasen)
  // och inte utan flygningar.
  const canEdit = view === 'list' && realFlights.length > 0 && !tourDemo && !tourActive;
  const toggleNode = (
    // alignItems: 'stretch' → pennans ruta får exakt samma höjd som väljaren, vad den än är.
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}>
      {canEdit && (
        <TouchableOpacity onPress={() => router.push('/bulk-edit?mode=pilot' as any)} activeOpacity={0.75}
          accessibilityRole="button" accessibilityLabel="Edit flights" hitSlop={6}
          style={{ width: 36, borderRadius: 9, borderWidth: 1, borderColor: accent + '73', backgroundColor: accent + '1F', alignItems: 'center', justifyContent: 'center' }}>
          {/* Ikonens penna sticker ut uppe till höger, så dess tyngdpunkt ligger nere till vänster: flyttad en
              punkt upp och åt höger för att se centrerad ut. Fast ruta så att radhöjden inte förskjuter den. */}
          <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: 1 }, { translateY: -1 }] }}>
            <Ionicons name="create-outline" size={18} color={accent} style={{ lineHeight: 18 }} />
          </View>
        </TouchableOpacity>
      )}
      <SegmentedToggle options={OPTIONS} value={view} onChange={switchView} accent={accent} />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {isLoading && flights.length === 0 ? (
        <ActivityIndicator color={accent} style={{ marginTop: 60 }} />
      ) : view === 'list' ? (
        <ListView flights={flights} accent={accent} placeNames={placeNames} onOpenFlight={openFlight}
          expandYear={expand.year} expandMonthKey={expand.monthKey} headerRight={toggleNode}
          focusDate={params.focusDate ?? null} focusStart={params.focusStart ?? null} focusEnd={params.focusEnd ?? null} focusNonce={params.t ?? null} />
      ) : view === 'fleet' ? (
        <FleetView accent={accent} headerRight={toggleNode} />
      ) : (
        <BookView accent={accent} headerRight={toggleNode} />
      )}
    </View>
  );
}
