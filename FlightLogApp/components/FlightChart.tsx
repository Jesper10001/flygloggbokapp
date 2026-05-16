import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const [showHelp, setShowHelp] = useState(false);

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

  // Only render if there's any data
  const hasData = months.some(m => m.cur > 0 || m.prev > 0);
  if (!hasData) return null;

  // Calculate monthly baseline
  const allMonthlyHours = months.map(m => m.cur + m.prev);
  const monthsWithData = allMonthlyHours.filter(h => h > 0);
  const rawAvg = monthsWithData.length > 0 ? monthsWithData.reduce((s, h) => s + h, 0) / monthsWithData.length : 0;
  const activeMonthlyHours = monthsWithData.filter(h => h >= rawAvg * 0.3);
  const baseline = activeMonthlyHours.length > 0
    ? Math.round((activeMonthlyHours.reduce((s, h) => s + h, 0) / activeMonthlyHours.length) * 10) / 10
    : 0;

  const thisMonthHours = months[now.getMonth()].cur;

  // Year-over-year
  const curMonthIdx = now.getMonth();
  const curYtd = months.slice(0, curMonthIdx + 1).reduce((s, m) => s + m.cur, 0);
  const prevYtd = months.slice(0, curMonthIdx + 1).reduce((s, m) => s + m.prev, 0);
  const yoyPct = prevYtd > 0 ? Math.round(((curYtd - prevYtd) / prevYtd) * 100) : 0;
  const yoyUp = yoyPct >= 0;

  const maxH = Math.max(...months.map(m => Math.max(m.cur, m.prev)), 0.1);
  const BAR_MAX = 72; // px
  const baselinePct = maxH > 0 ? (baseline / maxH) * BAR_MAX : 0;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={styles.title}>{t('flight_hours_per_month')}</Text>
        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: 'Menlo', color: Colors.success }}>
          {thisMonthHours.toFixed(1)}h this month
        </Text>
      </View>
      <View style={styles.legend}>
        <View style={[styles.dot, { backgroundColor: Colors.primary }]} />
        <Text style={styles.legendText}>{curYear}</Text>
        <View style={[styles.dot, { backgroundColor: Colors.textMuted, marginLeft: 10 }]} />
        <Text style={styles.legendText}>{prevYear}</Text>
      </View>
      <View style={{ position: 'relative' }}>
        {/* Baseline line */}
        {baseline > 0 && (
          <View style={{
            position: 'absolute', left: 0, right: 0,
            bottom: baselinePct + 14, zIndex: 1,
          }} pointerEvents="none">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1, height: 1, backgroundColor: Colors.gold }} />
            </View>
          </View>
        )}
        {/* Baseline label */}
        {baseline > 0 && (
          <View style={{
            position: 'absolute', right: 0,
            bottom: baselinePct + 16, zIndex: 10,
          }} pointerEvents="none">
            <Text style={{
              fontSize: 7, color: Colors.gold, fontFamily: 'Menlo',
              backgroundColor: Colors.card, paddingHorizontal: 3,
            }}>{baseline.toFixed(1)}h BASELINE</Text>
          </View>
        )}
        <View style={styles.chart}>
          {months.map((m, i) => (
            <View key={i} style={styles.column}>
              <View style={styles.bars}>
                {m.prev > 0 && (
                  <View
                    style={[
                      styles.bar,
                      styles.barPrev,
                      { height: Math.max((m.prev / maxH) * BAR_MAX, 3), zIndex: 0 },
                    ]}
                  />
                )}
                {m.cur > 0 && (
                  <View
                    style={[
                      styles.bar,
                      styles.barCur,
                      { height: Math.max((m.cur / maxH) * BAR_MAX, 3), zIndex: 2 },
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
        {prevYtd > 0 && (
          <Text style={{ fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 8 }}>
            <Text style={{ color: yoyUp ? Colors.success : Colors.warning, fontWeight: '700' }}>
              {yoyUp ? '+' : ''}{yoyPct}%
            </Text> over baseline so far
          </Text>
        )}
      </View>

      {/* Help button */}
      <TouchableOpacity
        style={{ position: 'absolute', bottom: 8, right: 8, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}
        onPress={() => setShowHelp(true)}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.textMuted }}>?</Text>
      </TouchableOpacity>

      {/* Help modal */}
      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <View style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: Colors.surface, borderRadius: 18, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: Colors.textPrimary }}>Flight Hours Per Month</Text>
              <TouchableOpacity onPress={() => setShowHelp(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>What it shows</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  A smooth curve showing your flight hours for the current year (cyan) versus the previous year (grey). This lets you see seasonal patterns and trends more clearly.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>This month</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  The green number in the top right shows your total hours flown so far this month.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>The dashed baseline</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  The dashed line shows your average monthly hours across both years. Inactive months are excluded so the baseline reflects your actual working pace.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Year-over-year comparison</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  The percentage at the bottom compares your total hours this year (up to the current month) against the same period last year. Green means you're flying more than last year, orange means less.
                </Text>
              </View>

            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
