// Pilot-manned Logbook-skärm (ej operator): 3-vägsväljare List / Book / Fleet.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
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
  const { flights, isLoading, loadFlights, loadStats } = useFlightStore();
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
  const params = useLocalSearchParams<{ focusFlightId?: string; focusYear?: string; focusMonth?: string; t?: string }>();
  useEffect(() => {
    if (!params.focusYear || !params.focusMonth) return;
    const fy = Number(params.focusYear), fm = Number(params.focusMonth);
    setView('list');
    setExpand({ year: fy, monthKey: `${fy}-${fm - 1}` });
  }, [params.focusFlightId, params.focusYear, params.focusMonth, params.t]);

  const openFlight = (f: Flight) => router.push(`/flight/detail/${f.id}`);

  // Väljaren ligger i headern på samma rad som sidans titel (titel vänster, toggle höger).
  // Manuellt vy-byte rensar deep-link-expansionen → List öppnas i grundform.
  const switchView = (v: LogView) => { setView(v); setExpand({ year: null, monthKey: null }); };
  const toggleNode = <SegmentedToggle options={OPTIONS} value={view} onChange={switchView} accent={accent} />;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {isLoading && flights.length === 0 ? (
        <ActivityIndicator color={accent} style={{ marginTop: 60 }} />
      ) : view === 'list' ? (
        <ListView flights={flights} accent={accent} placeNames={placeNames} onOpenFlight={openFlight}
          expandYear={expand.year} expandMonthKey={expand.monthKey} headerRight={toggleNode} />
      ) : view === 'fleet' ? (
        <FleetView accent={accent} headerRight={toggleNode} />
      ) : (
        <BookView accent={accent} headerRight={toggleNode} />
      )}
    </View>
  );
}
