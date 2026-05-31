import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { BWDayBars } from './BWDayBars';
import type { BestWeekDay } from '../../hooks/useMilestoneDetails';

interface BWCardCompactProps {
  width: number;
  accent?: string;
  hoursLabel: string;   // "24:30"
  weekLabel: string;    // "v.15 · 2026"
  sectors: number;
  airports: number;
  days: BestWeekDay[];
  onPress?: () => void;
}

export function BWCardCompact({
  width,
  accent = Colors.accent,
  hoursLabel,
  weekLabel,
  sectors,
  airports,
  days,
  onPress,
}: BWCardCompactProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Best week, ${hoursLabel} hours`}
      style={({ pressed }) => [styles.card, { width, opacity: pressed ? 0.85 : 1 }]}
    >
      {/* Eyebrow + week label */}
      <View style={styles.head}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={[styles.eyebrow, { color: accent }]}>{t('ms.best_week').toUpperCase()}</Text>
        </View>
        <Text style={styles.weekLabel} numberOfLines={1}>{weekLabel.toUpperCase()}</Text>
      </View>

      {/* Hero hours */}
      <View style={styles.heroRow}>
        <Text style={styles.hero}>{hoursLabel}</Text>
        <Text style={[styles.heroUnit, { color: accent }]}>{t('ms.hrs')}</Text>
      </View>

      {/* Day bars fill the middle */}
      <View style={styles.barsWrap}>
        <BWDayBars days={days} accent={accent} compact />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerStat}>
          <Text style={{ color: accent }}>{sectors}</Text> {t('ms.sectors').toUpperCase()}
        </Text>
        <Text style={styles.footerStat}>
          <Text style={{ color: accent }}>{airports}</Text> {t('ms.airports').toUpperCase()}
        </Text>
      </View>
    </Pressable>
  );
}

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';

const styles = StyleSheet.create({
  card: {
    height: 220,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
    padding: 12,
    gap: 9,
  },
  head: { gap: 3 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  eyebrow: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.4 },
  weekLabel: { fontFamily: MONO, fontSize: 9, fontWeight: '600', letterSpacing: 0.9, color: Colors.textSecondary },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  hero: {
    fontFamily: SERIF,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '500',
    letterSpacing: -0.8,
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },

  barsWrap: { flex: 1, minHeight: 0 },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
    paddingTop: 8,
  },
  footerStat: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.6, color: Colors.textSecondary },
});
