import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getMonthlyHours } from '../db/flights';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';

const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

function makeStyles() {
  return StyleSheet.create({
    card: {
      backgroundColor: Colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
    },
    title: {
      color: Colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    legend: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      gap: 4,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    legendText: {
      color: Colors.textSecondary,
      fontSize: 11,
    },
    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
    },
    column: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    bars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 1,
      height: 80,
      justifyContent: 'center',
    },
    bar: {
      width: 5,
      borderRadius: 2,
    },
    barCur: {
      backgroundColor: Colors.primary,
    },
    barPrev: {
      backgroundColor: Colors.textMuted,
      opacity: 0.6,
    },
    barEmpty: {
      width: 5,
      height: 2,
      backgroundColor: Colors.separator,
      borderRadius: 1,
    },
    label: {
      color: Colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
    },
    labelActive: {
      color: Colors.primary,
    },
  });
}

export function FlightChart() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [data, setData] = useState<{ year: number; month: number; hours: number }[]>([]);

  useEffect(() => {
    getMonthlyHours().then(setData);
  }, []);

  if (data.length === 0) return null;

  const now = new Date();
  const curYear = now.getFullYear();
  const prevYear = curYear - 1;

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return {
      label: MONTH_LABELS[i],
      cur: data.find(d => d.year === curYear && d.month === m)?.hours ?? 0,
      prev: data.find(d => d.year === prevYear && d.month === m)?.hours ?? 0,
    };
  });

  const maxH = Math.max(...months.map(m => Math.max(m.cur, m.prev)), 0.1);
  const BAR_MAX = 72; // px

  // Only render if there's any data
  const hasData = months.some(m => m.cur > 0 || m.prev > 0);
  if (!hasData) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('flight_hours_per_month')}</Text>
      <View style={styles.legend}>
        <View style={[styles.dot, { backgroundColor: Colors.primary }]} />
        <Text style={styles.legendText}>{curYear}</Text>
        <View style={[styles.dot, { backgroundColor: Colors.textMuted, marginLeft: 10 }]} />
        <Text style={styles.legendText}>{prevYear}</Text>
      </View>
      <View style={styles.chart}>
        {months.map((m, i) => (
          <View key={i} style={styles.column}>
            <View style={styles.bars}>
              {m.prev > 0 && (
                <View
                  style={[
                    styles.bar,
                    styles.barPrev,
                    { height: Math.max((m.prev / maxH) * BAR_MAX, 3) },
                  ]}
                />
              )}
              {m.cur > 0 && (
                <View
                  style={[
                    styles.bar,
                    styles.barCur,
                    { height: Math.max((m.cur / maxH) * BAR_MAX, 3) },
                  ]}
                />
              )}
              {m.cur === 0 && m.prev === 0 && <View style={styles.barEmpty} />}
            </View>
            <Text style={[styles.label, i === now.getMonth() && styles.labelActive]}>
              {m.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
