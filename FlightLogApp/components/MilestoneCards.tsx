import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Colors } from '../constants/colors';
import { Eyebrow, Stat } from './MilestoneShared';
import { BWDayBars } from './BWDayBars';
import { LXRouteMap } from './LXRouteMap';
import { decimalToHHMM } from '../hooks/useTimeFormat';

interface BestWeekCardProps {
  hours: number;
  weekLabel: string;
  sectors: number;
  airports: number;
  days: Array<{ dow: string; date: number; hours: number }>;
  onPress: () => void;
  accent?: string;
}

interface LongestXcCardProps {
  distance_nm: number;
  distance_km: number;
  hours: number;
  dep: string;
  arr: string;
  flights: Array<{ depLat: number; depLon: number; arrLat: number; arrLon: number; dep: string; arr: string }>;
  onPress: () => void;
  accent?: string;
}

// ── Best Week Compact Card ──────────────────────────────────────────────────
export function BestWeekCard({
  hours,
  weekLabel,
  sectors,
  airports,
  days,
  onPress,
  accent = Colors.gold,
}: BestWeekCardProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={s.cardContent}>
        {/* Header */}
        <Eyebrow accent={accent}>● BEST WEEK</Eyebrow>
        <Text style={[s.weekLabel, { color: accent }]}>{weekLabel}</Text>

        {/* Hero number */}
        <Text style={[s.heroNumber, { color: accent }]}>
          {decimalToHHMM(hours)}
          <Text style={s.heroUnit}> HRS</Text>
        </Text>

        {/* Day bars */}
        <View style={{ height: 56 }}>
          <BWDayBars days={days} height={56} compact accent={accent} />
        </View>

        {/* Footer stats */}
        <View style={s.footer}>
          <Text style={s.footerStat}>
            <Text style={{ color: accent }}>{sectors}</Text> SECTORS
          </Text>
          <Text style={s.footerStat}>
            <Text style={{ color: accent }}>{airports}</Text> AIRPORTS
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Longest XC Compact Card ─────────────────────────────────────────────────
export function LongestXcCard({
  distance_nm,
  distance_km,
  hours,
  dep,
  arr,
  flights,
  onPress,
  accent = Colors.gold,
}: LongestXcCardProps) {
  const isFocused = useIsFocused();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={s.cardContent}>
        {/* Mini map (100px tall) */}
        <View style={s.mapContainer}>
          {isFocused && flights.length > 0 && (
            <LXRouteMap
              width={176}
              height={100}
              legs={flights.map(f => ({
                icao: f.dep,
                name: f.dep,
                lat: f.depLat,
                lon: f.depLon,
                role: 'dep' as 'dep' | 'arr',
              })).concat(
                flights.length > 0
                  ? [{
                      icao: flights[flights.length - 1].arr,
                      name: flights[flights.length - 1].arr,
                      lat: flights[flights.length - 1].arrLat,
                      lon: flights[flights.length - 1].arrLon,
                      role: 'arr' as 'dep' | 'arr',
                    }]
                  : []
              )}
              showLabels={false}
              showGraticule
              showPlane={false}
              accent={accent}
            />
          )}
          {/* Badge on map */}
          <View style={[s.mapBadge, { borderColor: accent + '88' }]}>
            <Text style={[s.mapBadgeText, { color: accent }]}>● LONGEST XC</Text>
          </View>
        </View>

        {/* Hero number */}
        <Text style={[s.heroNumber, { color: accent, marginTop: 8 }]}>
          {Math.round(distance_nm)}
          <Text style={s.heroUnit}> NM</Text>
        </Text>

        {/* Route */}
        <Text style={s.route}>
          {dep} → {arr}
        </Text>

        {/* Footer stats */}
        <View style={s.footer}>
          <Text style={s.footerStat}>
            <Text style={{ color: accent }}>{decimalToHHMM(hours)}</Text>
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    width: 176,
    height: 220,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    padding: 12,
    gap: 10,
  },

  weekLabel: {
    fontFamily: 'Menlo',
    fontSize: 8.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  heroNumber: {
    fontSize: 38,
    fontWeight: '500',
    lineHeight: 34,
    letterSpacing: -0.03,
  },
  heroUnit: {
    fontFamily: 'Menlo',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  route: {
    fontFamily: 'Menlo',
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.04,
  },

  mapContainer: {
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.background,
    position: 'relative',
  },
  mapBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: Colors.background + 'CC',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 10,
  },
  mapBadgeText: {
    fontFamily: 'Menlo',
    fontSize: 7.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
    paddingTop: 8,
  },
  footerStat: {
    fontFamily: 'Menlo',
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
