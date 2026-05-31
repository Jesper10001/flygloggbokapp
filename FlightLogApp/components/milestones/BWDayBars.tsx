import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import type { BestWeekDay } from '../../hooks/useMilestoneDetails';

interface BWDayBarsProps {
  days: BestWeekDay[];
  accent?: string;
  compact?: boolean;
  showLabels?: boolean;
}

function hhmm(h: number): string {
  if (h <= 0) return '—';
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

export function BWDayBars({ days, accent = Colors.accent, compact = false, showLabels = true }: BWDayBarsProps) {
  const max = Math.max(...days.map(d => d.hours), 1);

  return (
    <View style={[styles.row, { gap: compact ? 3 : 6 }]}>
      {days.map(d => {
        const empty = d.hours <= 0;
        const pct = empty ? 0 : (d.hours / max) * 100;
        const isPeak = d.hours === max && !empty;
        return (
          <View key={d.iso} style={[styles.col, { gap: compact ? 3 : 5 }]}>
            <Text
              style={[
                styles.hours,
                { fontSize: compact ? 8 : 10, color: empty ? Colors.textMuted : isPeak ? accent : Colors.textPrimary, opacity: empty ? 0.6 : 1 },
              ]}
              numberOfLines={1}
            >
              {empty ? '—' : hhmm(d.hours)}
            </Text>

            <View style={styles.track}>
              {!empty && (
                <LinearGradient
                  colors={isPeak ? [accent, accent + 'aa'] : [accent + 'cc', accent + '55']}
                  style={[
                    styles.fill,
                    { height: `${pct}%` },
                    isPeak && { shadowColor: accent, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
                  ]}
                />
              )}
            </View>

            {showLabels && (
              <View style={styles.labels}>
                <Text style={[styles.dow, { fontSize: compact ? 8 : 9, color: empty ? Colors.textMuted : Colors.textSecondary }]}>
                  {d.dow.toUpperCase()}
                </Text>
                <Text style={[styles.date, { fontSize: compact ? 8.5 : 10, color: empty ? Colors.textMuted : Colors.textSecondary }]}>
                  {String(d.date).padStart(2, '0')}
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const MONO = 'JetBrainsMono';

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  col: { flex: 1, alignItems: 'center' },
  hours: {
    fontFamily: MONO,
    fontWeight: '700',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    width: '100%',
    minHeight: 8,
    backgroundColor: 'rgba(127,168,200,0.05)',
    borderWidth: 1,
    borderColor: Colors.separator,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { width: '100%', borderRadius: 3 },
  labels: { alignItems: 'center' },
  dow: { fontFamily: MONO, fontWeight: '700', letterSpacing: 1.2 },
  date: { fontFamily: MONO, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
