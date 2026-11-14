// Blades introduction — Insights-stoppet när loggboken är helt tom. Utan flygningar har Insights inget att
// visa, så rundturen visar de fyra riktiga förhandsvisningarna (Projections, Next licence, Longest XC, Best
// week) med exempelsiffror — samma rutor, kurvor och kartor som när man har flygningar. Bara i minnet; syns
// aldrig utanför rundturen. Med flygningar visar rundturen användarens egna rutor (app/(tabs)/insights.tsx).

import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { TourSpot } from '../TourSpot';
import { InsightsPreviewsDemo } from './InsightsPreviews';

export function TourInsightsDemo() {
  return (
    <View style={{ flex: 1, padding: 12, gap: 12 }}>
      <Text style={styles.note} maxFontSizeMultiplier={1.2}>EXAMPLE · YOUR OWN NUMBERS APPEAR AS YOU LOG</Text>
      <View>
        <InsightsPreviewsDemo />
        <TourSpot id="insights-top" radius={20} inset={5} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1, marginTop: 4 },
});
