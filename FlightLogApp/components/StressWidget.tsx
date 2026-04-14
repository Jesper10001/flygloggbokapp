import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getStressHours } from '../db/flights';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';

type Level = 1 | 2 | 3 | 4 | 5 | 6;

// Stadie 1–6: mörkgrå → ljusgrå → ljusgrön → grön → gul → röd
const LEVEL_COLORS: Record<Level, string> = {
  1: '#4a5568',
  2: '#6b82a0',
  3: '#68b89a',
  4: Colors.success,
  5: Colors.warning,
  6: Colors.danger,
};

function makeStyles() {
  return StyleSheet.create({
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
    textCol: {
      gap: 4,
    },
    message: {
      color: Colors.textPrimary,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    action: {
      color: Colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    sub: {
      color: Colors.textMuted,
      fontSize: 11,
    },
  });
}

export function StressWidget() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [ratio, setRatio] = useState<number | null>(null);

  const MESSAGES: Record<Level, { icon: string; desc: string; action: string }> = {
    1: { icon: '😴', desc: t('stress_1_desc'), action: t('stress_1_action') },
    2: { icon: '📉', desc: t('stress_2_desc'), action: t('stress_2_action') },
    3: { icon: '🙂', desc: t('stress_3_desc'), action: t('stress_3_action') },
    4: { icon: '✅', desc: t('stress_4_desc'), action: t('stress_4_action') },
    5: { icon: '⚠️', desc: t('stress_5_desc'), action: t('stress_5_action') },
    6: { icon: '🚨', desc: t('stress_6_desc'), action: t('stress_6_action') },
  };

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
  if (ratio < 0.50)       level = 1;
  else if (ratio < 0.75)  level = 2;
  else if (ratio <= 1.00) level = 3;
  else if (ratio <= 1.25) level = 4;
  else if (ratio <= 1.40) level = 5;
  else                    level = 6;

  const color = LEVEL_COLORS[level];
  const msg = MESSAGES[level];

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('flight_load')}</Text>
        <Text style={[styles.pct, { color }]}>
          {diff >= 0 ? '+' : ''}{diff}%
        </Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fillPct}%` as any, backgroundColor: color }]} />
        <View style={styles.midMark} />
      </View>

      <View style={styles.textCol}>
        <Text style={styles.message}>{msg.desc}</Text>
        <Text style={styles.action}>{msg.action}</Text>
        <Text style={styles.sub}>{t('stress_last_14')}</Text>
      </View>
    </View>
  );
}

