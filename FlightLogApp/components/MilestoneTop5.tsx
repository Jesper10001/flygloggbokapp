import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Top5Item {
  rank: number;
  label: string;
  range?: string;
  value: number;
  current: boolean;
}

interface Top5Props {
  items: Top5Item[];
  unit: 'hours' | 'nm';
  accent?: string;
}

export function Top5({ items, unit, accent = Colors.gold }: Top5Props) {
  const maxValue = useMemo(() => Math.max(...items.map(i => i.value), 1), [items]);

  const formatValue = (value: number) => {
    if (unit === 'hours') {
      const hours = Math.floor(value);
      const mins = Math.round((value - hours) * 60);
      return `${hours}:${String(mins).padStart(2, '0')}`;
    }
    return `${Math.round(value)} NM`;
  };

  return (
    <View style={s.container}>
      {items.map((item, idx) => {
        const barWidth = (item.value / maxValue) * 100;
        const isCurrent = item.current;

        return (
          <View key={idx} style={s.row}>
            {/* Rank */}
            <Text style={[s.rank, isCurrent && { color: accent }]}>
              {String(item.rank).padStart(2, '0')}
            </Text>

            {/* Label & range */}
            <View style={s.labelColumn}>
              <Text style={[s.label, isCurrent && { color: accent }]}>
                {item.label}
                {isCurrent && ' · '}
                {isCurrent && <Text style={{ color: accent, fontWeight: '700' }}>BEST</Text>}
              </Text>
              {item.range && <Text style={s.range}>{item.range}</Text>}
            </View>

            {/* Value */}
            <Text style={[s.value, isCurrent && { color: accent }]}>
              {formatValue(item.value)}
            </Text>
          </View>
        );
      })}

      {/* Track bars */}
      <View style={s.trackContainer}>
        {items.map((item, idx) => {
          const barWidth = (item.value / maxValue) * 100;
          const isCurrent = item.current;

          return (
            <View key={`track-${idx}`} style={s.trackRow}>
              <View
                style={[
                  s.track,
                  {
                    width: `${barWidth}%`,
                    backgroundColor: isCurrent ? accent : Colors.textMuted,
                    shadowColor: isCurrent ? accent : 'transparent',
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rank: {
    fontFamily: 'Menlo',
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    width: 24,
    textAlign: 'center',
  },
  labelColumn: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  range: {
    fontFamily: 'Menlo',
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  value: {
    fontFamily: 'Menlo',
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    minWidth: 60,
    textAlign: 'right',
  },
  trackContainer: {
    marginTop: 8,
    gap: 6,
  },
  trackRow: {
    height: 4,
    width: '100%',
    backgroundColor: Colors.elevated,
    borderRadius: 2,
    overflow: 'hidden',
  },
  track: {
    height: '100%',
    borderRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 2,
  },
});
