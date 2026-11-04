// Insights — egen manned-flik. Steg 0: renderar nuvarande innehåll (återanvänt)
// så fliken funkar direkt; sektionerna byts successivt mot den nya designen
// (HeroTotals / HoursBank / ActivitySection / GoalCard / LicenceJourney).

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { HeroTotals } from '../../components/insights/HeroTotals';
import { HoursBank } from '../../components/insights/HoursBank';
import { GoalCard } from '../../components/insights/GoalCard';
import { LicenceJourney } from '../../components/insights/LicenceJourney';
import { MilestonesSection } from '../../components/insights/MilestonesSection';
import { projectionUnlock } from '../../components/insights/insightsData';
import { DroneInsights } from '../../components/insights/DroneInsights';
import { useTabBarSpace } from '../../components/GlassTabBar';

export default function InsightsScreen() {
  const mode = useAppModeStore((s) => s.mode);
  const stats = useFlightStore((s) => s.stats);
  const loadStats = useFlightStore((s) => s.loadStats);
  const loadFlights = useFlightStore((s) => s.loadFlights);
  const flights = useFlightStore((s) => s.flights);
  const tabSpace = useTabBarSpace(); // flytande glas-flikrad täcker botten

  // Ladda om vid fokus så tomt-tillståndet/innehållet speglar aktuell loggbok (som drönar-Insights).
  useFocusEffect(useCallback(() => { loadStats(); loadFlights(); }, [loadStats, loadFlights]));

  // Projections låses upp efter 60 dagar och 10 flygningar (projectionUnlock). Tills dess ligger
  // sektionen längst ner (under Milestones); upplåst är den tillbaka på sin vanliga plats.
  const projectionsReady = useMemo(() => projectionUnlock(flights).ready, [flights]);
  // Medan målet dras i projektionsdiagrammet står sidan still.
  const [chartDrag, setChartDrag] = useState(false);

  if (mode === 'drone') return <DroneInsights />;
  if (mode !== 'manned') return <View style={{ flex: 1 }} />;

  // Inga flygningar än → ingen data presenteras (samma tomma tillstånd som drönarläget).
  if (stats && stats.total_flights === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 }}>
        <Ionicons name="analytics-outline" size={40} color={Colors.textMuted} />
        <Text style={{ color: Colors.textSecondary, fontSize: 15, fontWeight: '700' }}>No flights yet</Text>
        <Text style={{ color: Colors.textMuted, fontSize: 12.5, textAlign: 'center' }}>Log a flight to see your insights build up here.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      scrollEnabled={!chartDrag}
      contentContainerStyle={{ padding: 12, paddingBottom: tabSpace + 40, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <HeroTotals />
      <HoursBank />
      {projectionsReady && <GoalCard onDrag={setChartDrag} />}
      <LicenceJourney />
      <MilestonesSection />
      {!projectionsReady && <GoalCard onDrag={setChartDrag} />}
    </ScrollView>
  );
}
