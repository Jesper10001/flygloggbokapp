// Blades introduction — Insights-stoppet när loggboken är helt tom. Utan flygningar har Insights inget att
// visa, så rundturen visar fyra exempelrutor i stället (samma fyra som de riktiga förhandsvisningarna:
// Projections, Next licence, Longest XC, Best week). Bara siffror i minnet; syns aldrig utanför rundturen.

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { TourSpot } from '../TourSpot';

function Tile({ label, value, sub, children }: { label: string; value: string; sub: string; children?: React.ReactNode }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.label} maxFontSizeMultiplier={1.2}>{label}</Text>
      <Text style={styles.value} maxFontSizeMultiplier={1.2}>{value}</Text>
      <Text style={styles.sub} maxFontSizeMultiplier={1.2}>{sub}</Text>
      {children}
    </View>
  );
}

export function TourInsightsDemo() {
  return (
    <View style={{ flex: 1, padding: 12, gap: 12 }}>
      <Text style={styles.note} maxFontSizeMultiplier={1.2}>EXAMPLE · YOUR OWN NUMBERS APPEAR AS YOU LOG</Text>
      <View>
        <View style={styles.grid}>
          <Tile label="PROJECTIONS" value="1 500 h" sub="by Aug 2027">
            <Svg width="100%" height={40} viewBox="0 0 150 40" preserveAspectRatio="none">
              <Path d="M2 36 L40 29 L78 21 L112 12 L148 3" fill="none" stroke={Colors.primary} strokeWidth={2.5} strokeLinecap="round" />
            </Svg>
          </Tile>
          <Tile label="NEXT LICENCE" value="ATPL" sub="86 % of the hours">
            <Svg width="100%" height={40} viewBox="0 0 150 40" preserveAspectRatio="none">
              <Rect x={2} y={15} width={146} height={10} rx={5} fill="#16304F" />
              <Rect x={2} y={15} width={126} height={10} rx={5} fill={Colors.primary} />
            </Svg>
          </Tile>
          <Tile label="LONGEST XC" value="412 NM" sub="ESSA → EGLL" />
          <Tile label="BEST WEEK" value="18:40" sub="12 flights, June" />
        </View>
        <TourSpot id="insights-top" radius={20} inset={5} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', flexGrow: 1, minHeight: 138, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 16, padding: 12, gap: 4 },
  label: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1 },
  value: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { color: Colors.textSecondary, fontSize: 12.5 },
});
