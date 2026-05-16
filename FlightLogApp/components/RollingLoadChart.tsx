import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '../constants/colors';
import { getStressHours } from '../db/flights';
import { getDatabase } from '../db/database';
import { useFlightStore } from '../store/flightStore';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CHART_COLOR = '#00C8E8'; // Cyan to match Blades theme

// Helper to generate smooth curve path from points
function generateSmoothPath(data: { x: number; maxY: number }[], width: number, height: number, padding: number = 30): string {
  if (data.length === 0) return '';

  const maxY = Math.max(...data.map(d => d.maxY || 0), 1);
  const pointWidth = (width - padding * 2) / (data.length - 1 || 1);

  // Generate points
  const points = data.map((d, i) => ({
    x: padding + i * pointWidth,
    y: height - padding - (d.maxY / maxY) * (height - padding * 2),
  }));

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  // Generate cubic bezier curves
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = i + 1 < points.length ? points[i + 1] : p1;
    const p_1 = i - 2 >= 0 ? points[i - 2] : p0;

    // Catmull-Rom to cubic bezier
    const cp1x = p0.x + (p1.x - p_1.x) / 6;
    const cp1y = p0.y + (p1.y - p_1.y) / 6;
    const cp2x = p1.x - (p2.x - p0.x) / 6;
    const cp2y = p1.y - (p2.y - p0.y) / 6;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }

  return path;
}

function makeStyles() {
  return StyleSheet.create({
    card: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
    title: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
    legend: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 4 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: Colors.textSecondary, fontSize: 11 },
    chartContainer: { height: 200, marginVertical: 8 },
    statsText: { fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 8 },
  });
}

type DayData = { hours: number; day: string };

export function RollingLoadChart() {
  const styles = makeStyles();
  const [days, setDays] = useState<DayData[]>([]);
  const [baseline, setBaseline] = useState(0);
  const [weekHours, setWeekHours] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);
  const [daysToShow, setDaysToShow] = useState(14); // 7, 14, 30, 90
  const [periodLabel, setPeriodLabel] = useState('');
  const flightCount = useFlightStore(s => s.flightCount);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      // Get data for the past 120 days to allow going back further
      const rows = await db.getAllAsync<{ d: string; h: number }>(
        `SELECT date as d, ROUND(SUM(total_time), 2) as h FROM flights
         WHERE date >= date('now', '-120 days')
         GROUP BY date ORDER BY date ASC`
      );

      const today = new Date();
      const centerDate = new Date(today);
      centerDate.setDate(today.getDate() - dayOffset);

      // Calculate how many days before/after center date to show
      const halfDays = Math.floor(daysToShow / 2);
      const mapped: DayData[] = [];

      for (let i = halfDays; i >= -halfDays; i--) {
        const curDate = new Date(centerDate);
        curDate.setDate(centerDate.getDate() - i);
        const curIso = curDate.toISOString().split('T')[0];

        mapped.push({
          hours: rows.find(r => r.d === curIso)?.h ?? 0,
          day: DAY_LABELS[curDate.getDay()],
        });
      }
      setDays(mapped);

      // Calculate label
      if (dayOffset === 0) {
        setPeriodLabel(`Last ${daysToShow} days (now)`);
      } else if (dayOffset === 1) {
        setPeriodLabel('Yesterday');
      } else {
        setPeriodLabel(`${dayOffset} days ago`);
      }

      // Week hours for the window
      const dayOfWeek = centerDate.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const mondayDate = new Date(centerDate);
      mondayDate.setDate(centerDate.getDate() - mondayOffset);
      const mondayIso = mondayDate.toISOString().split('T')[0];
      const wHours = mapped.filter((_, idx) => {
        const d = new Date(centerDate);
        d.setDate(centerDate.getDate() - (halfDays - idx));
        return d.toISOString().split('T')[0] >= mondayIso;
      }).reduce((s, d) => s + d.hours, 0);
      setWeekHours(wHours);

      const stress = await getStressHours();
      setBaseline(stress.yearAvg14);
    })();
  }, [flightCount, dayOffset, daysToShow]);

  if (days.length === 0) return null;

  // Daily baseline: average hours on days actually flown
  const flyDays = days.filter(d => d.hours > 0);
  const allFlyDays = flyDays.map(d => d.hours);
  const dailyBaseline = allFlyDays.length > 0
    ? allFlyDays.reduce((s, h) => s + h, 0) / allFlyDays.length
    : 0;

  // Compare this 14-day period vs annual baseline
  const thisPeriod = days.reduce((s, d) => s + d.hours, 0);
  const popPct = baseline > 0 ? Math.round(((thisPeriod - baseline) / baseline) * 100) : 0;
  const popUp = popPct >= 0;

  const chartWidth = Dimensions.get('window').width - 64;
  const maxHours = Math.max(...days.map(d => d.hours), dailyBaseline, 1);

  // Generate smooth path for current period only
  const curData = days.map((d, i) => ({ x: i, maxY: d.hours }));
  const curPath = generateSmoothPath(curData, chartWidth, 160);

  // Baseline Y position
  const padding = 30;
  const baselineY = dailyBaseline > 0 ? 160 - padding - (dailyBaseline / maxHours) * (160 - padding * 2) : 0;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <Text style={styles.title}>14-DAY ROLLING LOAD</Text>
        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: 'Menlo', color: Colors.success }}>
          {thisPeriod.toFixed(1)}h total
        </Text>
      </View>
      <View style={styles.legend}>
        <View style={[styles.dot, { backgroundColor: CHART_COLOR }]} />
        <Text style={styles.legendText}>{periodLabel}</Text>
      </View>

      <View style={{ marginVertical: 12 }}>
        <Svg width={chartWidth} height={160}>
          <Defs>
            <LinearGradient id="areaGradient2" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={CHART_COLOR} stopOpacity="0.3" />
              <Stop offset="100%" stopColor={CHART_COLOR} stopOpacity="0" />
            </LinearGradient>
          </Defs>

          {/* Baseline dashed line */}
          {dailyBaseline > 0 && (
            <Path
              d={`M 0 ${baselineY} L ${chartWidth} ${baselineY}`}
              stroke={Colors.gold}
              strokeWidth="1"
              strokeDasharray="4,4"
            />
          )}

          {/* Current period area + line */}
          <Path d={`${curPath} L ${chartWidth - 30} 160 L 30 160 Z`} fill="url(#areaGradient2)" />
          <Path d={curPath} stroke={CHART_COLOR} strokeWidth="2" fill="none" />
        </Svg>

        {/* X-axis labels - adaptive based on daysToShow */}
        {days.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 30, marginTop: 8 }}>
            {days.map((day, i) => {
              const step = Math.max(1, Math.ceil(days.length / 6)); // Show ~6 labels
              const showLabel = i % step === 0 || i === days.length - 1;
              return (
                <Text key={i} style={{ fontSize: 9, color: Colors.textMuted, fontWeight: '600' }}>
                  {showLabel ? day.day : ''}
                </Text>
              );
            })}
          </View>
        )}

        {/* Navigation controls */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setDaysToShow(prev => Math.max(7, prev - 7))}
              style={{ padding: 8 }}
            >
              <Ionicons name="remove-circle-outline" size={20} color={CHART_COLOR} />
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600', alignSelf: 'center' }}>
              {daysToShow}d
            </Text>
            <TouchableOpacity
              onPress={() => setDaysToShow(prev => Math.min(90, prev + 7))}
              style={{ padding: 8 }}
            >
              <Ionicons name="add-circle-outline" size={20} color={CHART_COLOR} />
            </TouchableOpacity>
          </View>

          <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600' }}>
            {periodLabel}
          </Text>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setDayOffset(prev => prev + 1)}
              style={{ padding: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color={CHART_COLOR} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => dayOffset > 0 && setDayOffset(prev => prev - 1)}
              disabled={dayOffset === 0}
              style={{ opacity: dayOffset === 0 ? 0.3 : 1, padding: 8 }}
            >
              <Ionicons name="chevron-forward" size={20} color={CHART_COLOR} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {dailyBaseline > 0 && (
        <Text style={{ fontSize: 8, color: Colors.gold, marginTop: 4 }}>— baseline: {dailyBaseline.toFixed(1)}h</Text>
      )}

      {baseline > 0 && (
        <Text style={styles.statsText}>
          <Text style={{ color: popUp ? Colors.success : Colors.warning, fontWeight: '700' }}>
            {popUp ? '+' : ''}{Math.abs(popPct)}%
          </Text> {popUp ? 'over' : 'under'} annual baseline
        </Text>
      )}

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
              <Text style={{ fontSize: 17, fontWeight: '800', color: Colors.textPrimary }}>How 14-Day Load Works</Text>
              <TouchableOpacity onPress={() => setShowHelp(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>What it measures</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  Your total flight hours over the last 14 days (cyan curve), compared to the same days two weeks ago (grey curve). This shows if you're flying more or less than your normal pace.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>How baseline is calculated</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  The dashed line shows your average daily hours across all flying days. Inactive periods are excluded so the baseline reflects your real working pace.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Stress zones (dashboard)</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  The dashboard gauge uses your 14-day total vs annual baseline to determine a workload zone.
                </Text>
              </View>

            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
