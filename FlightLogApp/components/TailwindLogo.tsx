import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';

interface Props {
  size?: 'small' | 'medium' | 'large';
  showWordmark?: boolean;
}

// Tailwind-logans vingsymbol — tre diagonala linjer i cyan
function WingMark({ width = 28, height = 20 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 140 100">
      <G>
        {/* Linje 1 — längst ned, tunnast */}
        <Path
          d="M0 90 Q40 70 120 30"
          stroke="#00C8E8"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
          opacity={0.5}
        />
        {/* Linje 2 — mitten */}
        <Path
          d="M0 68 Q45 48 125 10"
          stroke="#00C8E8"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
          opacity={0.75}
        />
        {/* Linje 3 — längst upp, tjockast och ljusast */}
        <Path
          d="M10 48 Q55 22 135 0"
          stroke="#00C8E8"
          strokeWidth="11"
          strokeLinecap="round"
          fill="none"
          opacity={1}
        />
      </G>
    </Svg>
  );
}

export function TailwindLogo({ size = 'medium', showWordmark = true }: Props) {
  const config = {
    small:  { w: 20, h: 14, fontSize: 14, gap: 6 },
    medium: { w: 28, h: 20, fontSize: 20, gap: 8 },
    large:  { w: 52, h: 37, fontSize: 36, gap: 14 },
  }[size];

  return (
    <View style={[styles.row, { gap: config.gap }]}>
      <WingMark width={config.w} height={config.h} />
      {showWordmark && (
        <Text style={[styles.wordmark, { fontSize: config.fontSize }]}>
          TAILWIND
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    color: '#00C8E8',
    fontWeight: '700',
    letterSpacing: 2,
    fontFamily: 'System',
  },
});
