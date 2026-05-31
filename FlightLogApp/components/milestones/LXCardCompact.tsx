import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { MiniRouteMap, RouteLeg } from './MiniRouteMap';

interface LXCardCompactProps {
  width: number;
  accent?: string;
  /** distance in nautical miles (already converted from km) */
  distanceNm: number;
  routeFrom: string;
  routeTo: string;
  durationLabel: string; // e.g. "6H 42M"
  dateShort: string;     // e.g. "12 JUN 2024"
  legs: RouteLeg[];
  onPress?: () => void;
}

const MAP_H = 100;

export function LXCardCompact({
  width,
  accent = Colors.accent,
  distanceNm,
  routeFrom,
  routeTo,
  durationLabel,
  dateShort,
  legs,
  onPress,
}: LXCardCompactProps) {
  const focused = useIsFocused();
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Longest XC, ${Math.round(distanceNm)} nautical miles`}
      style={({ pressed }) => [styles.card, { width, opacity: pressed ? 0.85 : 1 }]}
    >
      {/* Map fills the top */}
      <View style={[styles.mapWrap, { height: MAP_H }]}>
        <MiniRouteMap
          width={width}
          height={MAP_H}
          legs={legs}
          accent={accent}
          showGraticule
          animate={focused}
        />
        <BlurView intensity={18} tint="dark" style={[styles.badge, { borderColor: accent + '55' }]}>
          <View style={[styles.badgeDot, { backgroundColor: accent }]} />
          <Text style={[styles.badgeText, { color: accent }]}>{t('ms.longest_xc').toUpperCase()}</Text>
        </BlurView>
      </View>

      {/* Stats */}
      <View style={styles.body}>
        <View>
          <View style={styles.heroRow}>
            <Text style={styles.hero}>{Math.round(distanceNm).toLocaleString('en-US')}</Text>
            <Text style={[styles.heroUnit, { color: accent }]}>{t('ms.nm')}</Text>
          </View>
          <View style={styles.routeRow}>
            <Text style={styles.routeIcao}>{routeFrom}</Text>
            <Text style={[styles.routeArrow, { color: accent }]}>→</Text>
            <Text style={styles.routeIcao}>{routeTo}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerStat}>{durationLabel.toUpperCase()}</Text>
          <Text style={styles.footerStat}>{dateShort.toUpperCase()}</Text>
        </View>
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
  },
  mapWrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.separator,
    backgroundColor: Colors.background,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  badgeDot: { width: 4, height: 4, borderRadius: 2 },
  badgeText: {
    fontFamily: MONO,
    fontSize: 7.5,
    fontWeight: '700',
    letterSpacing: 1.1,
  },

  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    justifyContent: 'space-between',
  },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  hero: {
    fontFamily: SERIF,
    fontSize: 32,
    lineHeight: 32,
    fontWeight: '500',
    letterSpacing: -1,
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  heroUnit: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  routeIcao: {
    fontFamily: MONO,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: Colors.textSecondary,
  },
  routeArrow: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
    paddingTop: 8,
  },
  footerStat: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: Colors.textSecondary,
  },
});
