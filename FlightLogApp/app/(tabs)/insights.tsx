// Insights — egen manned-flik. Steg 0: renderar nuvarande innehåll (återanvänt)
// så fliken funkar direkt; sektionerna byts successivt mot den nya designen
// (HeroTotals / HoursBank / ActivitySection / GoalCard / LicenceJourney).
// Operator-roll → OperatorInsights (oförändrad).

import { ScrollView, View } from 'react-native';
import { useProfileStore, isOperator } from '../../store/profileStore';
import { useAppModeStore } from '../../store/appModeStore';
import { Colors } from '../../constants/colors';
import { HeroTotals } from '../../components/insights/HeroTotals';
import { HoursBank } from '../../components/insights/HoursBank';
import { GoalCard } from '../../components/insights/GoalCard';
import { LicenceJourney } from '../../components/insights/LicenceJourney';
import { MilestonesSection } from '../../components/insights/MilestonesSection';
import { OperatorInsights } from '../../components/OperatorInsights';

export default function InsightsScreen() {
  const mode = useAppModeStore((s) => s.mode);
  const profile = useProfileStore((s) => s.profile);

  if (mode !== 'manned') return <View style={{ flex: 1, backgroundColor: Colors.background }} />;
  if (isOperator(profile)) return <OperatorInsights />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.background }}
      contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <HeroTotals />
      <HoursBank />
      <GoalCard />
      <LicenceJourney />
      <MilestonesSection />
    </ScrollView>
  );
}
