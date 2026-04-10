import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getStressHours } from '../db/flights';
import { Colors } from '../constants/colors';

type Level = 'grey' | 'green' | 'yellow' | 'red';

const MESSAGES: Record<Level, { icon: string; text: string }> = {
  grey: {
    icon: '📉',
    text: 'Låg flygtakt. Håll dig varm — regelbunden träning förbättrar planering och beslutsförmåga.',
  },
  green: {
    icon: '✅',
    text: 'Flygtakten är normal och balanserad. Bra jobbat!',
  },
  yellow: {
    icon: '⚠️',
    text: 'Förhöjd flygtakt. Prioritera sömn och håll koll på din ansträngningsnivå.',
  },
  red: {
    icon: '🚨',
    text: 'Kraftigt förhöjd flygtakt. EASA varnar för försämrad situationsmedvetande vid sömnbrist. Prioritera återhämtning.',
  },
};

const LEVEL_COLORS: Record<Level, string> = {
  grey: '#6b82a0',
  green: Colors.success,
  yellow: Colors.warning,
  red: Colors.danger,
};

export function StressWidget() {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    getStressHours().then(({ recent14, yearAvg14 }) => {
      setRatio(yearAvg14 > 0.01 ? recent14 / yearAvg14 : null);
    });
  }, []);

  // Visa inte om ingen historik finns att jämföra med
  if (ratio === null) return null;

  const diff = Math.round((ratio - 1) * 100);
  const fillPct = Math.min(100, Math.max(0, (ratio / 2) * 100));

  let level: Level;
  if (ratio < 0.75) level = 'grey';
  else if (ratio <= 1.25) level = 'green';
  else if (ratio <= 1.40) level = 'yellow';
  else level = 'red';

  const color = LEVEL_COLORS[level];
  const msg = MESSAGES[level];

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Stressindikator</Text>
        <Text style={[styles.pct, { color }]}>
          {diff >= 0 ? '+' : ''}{diff}%
        </Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fillPct}%` as any, backgroundColor: color }]} />
        {/* Mittpunkt = normal */}
        <View style={styles.midMark} />
      </View>

      <Text style={styles.message}>
        {msg.icon} {msg.text}
      </Text>
      <Text style={styles.sub}>Senaste 14 dagar jämfört med årssnitt (exkl. jul/dec)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderLeftWidth: 3,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  pct: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 8,
    backgroundColor: Colors.separator,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  midMark: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: Colors.border,
  },
  message: {
    color: Colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 11,
  },
});
