import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Day {
  dow: string;
  date: number;
  hours: number;
}

interface BWDayBarsProps {
  days: Day[];
  height?: number;
  compact?: boolean;
  accent?: string;
}

export function BWDayBars({ days, height = 130, compact = false, accent = Colors.gold }: BWDayBarsProps) {
  const maxHours = useMemo(() => {
    return Math.max(...days.map(d => d.hours), 1);
  }, [days]);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <View style={[s.container, { height }]}>
      <View style={s.barsRow}>
        {days.map((day, idx) => {
          const barHeight = (day.hours / maxHours) * (height - (compact ? 20 : 40));
          const isHighest = day.hours === maxHours && day.hours > 0;

          return (
            <View key={idx} style={s.barColumn}>
              {/* Bar */}
              <View
                style={[
                  s.bar,
                  {
                    height: Math.max(barHeight, 2),
                    backgroundColor: isHighest ? accent : Colors.textMuted,
                    opacity: day.hours === 0 ? 0.3 : 1,
                    shadowColor: isHighest ? accent : 'transparent',
                  },
                ]}
              />

              {/* Label */}
              {!compact && (
                <Text style={s.label}>
                  {dayLabels[idx]?.slice(0, 1)}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Compact mode: shows hours as text on right side */}
      {compact && (
        <Text style={s.compactHours}>
          {Math.max(...days.map(d => d.hours)).toFixed(1)}h
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  barsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    justifyContent: 'space-between',
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  bar: {
    width: '100%',
    borderRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontFamily: 'Menlo',
    fontSize: 9.5,
    fontWeight: '700',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  compactHours: {
    fontFamily: 'Fraunces',
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
    alignSelf: 'flex-end',
  },
});
