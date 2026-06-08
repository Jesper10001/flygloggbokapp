import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { getStressHours } from '../db/flights';
import { getDatabase } from '../db/database';
import { useFlightStore } from '../store/flightStore';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function makeStyles() {
  return StyleSheet.create({
    card: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
    title: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
    legend: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 4 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { color: Colors.textSecondary, fontSize: 11 },
    chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
    column: { flex: 1, alignItems: 'center', gap: 4 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: 80, justifyContent: 'center' },
    bar: { width: 5, borderRadius: 2 },
    barCur: { backgroundColor: Colors.primary },
    barPrev: { backgroundColor: Colors.textMuted, opacity: 0.6 },
    barEmpty: { width: 5, height: 2, backgroundColor: Colors.separator, borderRadius: 1 },
    label: { color: Colors.textMuted, fontSize: 9, fontWeight: '600' },
    labelActive: { color: Colors.primary },
  });
}

type DayData = { cur: number; prev: number; day: string };

export function RollingLoadChart({ accent }: { accent?: string } = {}) {
  const styles = makeStyles();
  const acc = accent ?? Colors.primary;
  const [days, setDays] = useState<DayData[]>([]);
  const [baseline, setBaseline] = useState(0);
  const [thisWeekHours, setThisWeekHours] = useState(0);
  const flightCount = useFlightStore(s => s.flightCount);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      // Last 28 days of daily hours
      const rows = await db.getAllAsync<{ d: string; h: number }>(
        `SELECT date as d, ROUND(SUM(total_time), 2) as h FROM flights
         WHERE date >= date('now', '-27 days')
         GROUP BY date ORDER BY date ASC`
      );

      const today = new Date();
      const mapped: DayData[] = [];
      for (let i = 13; i >= 0; i--) {
        const curDate = new Date(today);
        curDate.setDate(today.getDate() - i);
        const curIso = curDate.toISOString().split('T')[0];

        const prevDate = new Date(today);
        prevDate.setDate(today.getDate() - i - 14);
        const prevIso = prevDate.toISOString().split('T')[0];

        mapped.push({
          cur: rows.find(r => r.d === curIso)?.h ?? 0,
          prev: rows.find(r => r.d === prevIso)?.h ?? 0,
          day: DAY_LABELS[curDate.getDay()],
        });
      }
      setDays(mapped);

      // This week (Mon–Sun)
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const mondayDate = new Date(today);
      mondayDate.setDate(today.getDate() - mondayOffset);
      const mondayIso = mondayDate.toISOString().split('T')[0];
      const weekHours = mapped.filter((_, idx) => {
        const d = new Date(today);
        d.setDate(today.getDate() - (13 - idx));
        return d.toISOString().split('T')[0] >= mondayIso;
      }).reduce((s, d) => s + d.cur, 0);
      setThisWeekHours(weekHours);

      const stress = await getStressHours();
      setBaseline(stress.yearAvg14);
    })();
  }, [flightCount]);

  if (days.length === 0) return null;

  // Daily baseline: average hours on days actually flown (not calendar days)
  const flyDaysCur = days.filter(d => d.cur > 0);
  const flyDaysPrev = days.filter(d => d.prev > 0);
  const allFlyDays = [...flyDaysCur.map(d => d.cur), ...flyDaysPrev.map(d => d.prev)];
  const dailyBaseline = allFlyDays.length > 0
    ? allFlyDays.reduce((s, h) => s + h, 0) / allFlyDays.length
    : 0;
  const maxH = Math.max(...days.map(d => Math.max(d.cur, d.prev)), dailyBaseline, 0.1);
  const BAR_MAX = 72;
  const baselinePx = (dailyBaseline / maxH) * BAR_MAX;

  // Compare this 14-day period vs annual baseline
  const thisPeriod = days.reduce((s, d) => s + d.cur, 0);
  const popPct = baseline > 0 ? Math.round(((thisPeriod - baseline) / baseline) * 100) : 0;
  const popUp = popPct >= 0;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <Text style={styles.title}>14-DAY ROLLING LOAD</Text>
        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: 'Menlo', color: Colors.success }}>
          {thisWeekHours.toFixed(1)}h this week
        </Text>
      </View>
      <View style={styles.legend}>
        <View style={[styles.dot, { backgroundColor: acc }]} />
        <Text style={styles.legendText}>This</Text>
        <View style={[styles.dot, { backgroundColor: Colors.textMuted, marginLeft: 10 }]} />
        <Text style={styles.legendText}>Last</Text>
      </View>
      <View style={{ position: 'relative' }}>
        {/* Baseline line — behind current bars, in front of prev */}
        {dailyBaseline > 0 && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: baselinePx + 14, zIndex: 1 }} pointerEvents="none">
            <View style={{ flex: 1, height: 1, backgroundColor: Colors.gold }} />
          </View>
        )}
        {dailyBaseline > 0 && (
          <View style={{ position: 'absolute', right: 0, bottom: baselinePx + 16, zIndex: 10 }} pointerEvents="none">
            <Text style={{ fontSize: 7, color: Colors.gold, fontFamily: 'Menlo', backgroundColor: Colors.card, paddingHorizontal: 3 }}>
              {dailyBaseline.toFixed(1)}h BASELINE
            </Text>
          </View>
        )}
        <View style={styles.chart}>
          {days.map((d, i) => {
            const isToday = i === days.length - 1;
            return (
              <View key={i} style={styles.column}>
                <View style={styles.bars}>
                  {d.prev > 0 && (
                    <View style={[styles.bar, styles.barPrev, { height: Math.max((d.prev / maxH) * BAR_MAX, 3), zIndex: 0 }]} />
                  )}
                  {d.cur > 0 && (
                    <View style={[styles.bar, styles.barCur, { height: Math.max((d.cur / maxH) * BAR_MAX, 3), zIndex: 2, backgroundColor: acc }]} />
                  )}
                  {d.cur === 0 && d.prev === 0 && <View style={styles.barEmpty} />}
                </View>
                <Text style={[styles.label, isToday && [styles.labelActive, { color: acc }]]}>{d.day}</Text>
              </View>
            );
          })}
        </View>
        {baseline > 0 && (
          <Text style={{ fontSize: 10, color: Colors.textMuted, textAlign: 'center', marginTop: 8 }}>
            <Text style={{ color: popUp ? Colors.success : Colors.warning, fontWeight: '700' }}>
              {popUp ? '+' : ''}{Math.abs(popPct)}%
            </Text> {popUp ? 'over' : 'under'} annual baseline
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
              <Text style={{ fontSize: 17, fontWeight: '800', color: Colors.textPrimary }}>How 14-Day Load Works</Text>
              <TouchableOpacity onPress={() => setShowHelp(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>What it measures</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  Your total flight hours over the last 14 days, compared to your personal baseline. It tells you if you're flying more or less than your normal pace.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>How baseline is calculated</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  We look at your flight hours from the past year and calculate a daily average — but only from the days and months you actually fly. Inactive periods are excluded so the baseline reflects your real working pace.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Inactive months</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  Months where you flew less than 30% of your monthly average are considered inactive and excluded. Example: if you average 20h/month but flew only 3h in July — July is excluded from the baseline.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Inactive weekdays</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  Weekdays where you fly significantly less than your most active day are considered "normally off". Example: if you average 8h on Mondays but only 30 minutes on Saturdays — Saturdays are excluded from the baseline.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>The gold line</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  Shows your average daily hours on days you actually fly. The blue bars (this period) and grey bars (previous 14 days) let you compare your current pace visually.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Stress zones (dashboard)</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  The dashboard gauge uses your 14-day total vs baseline to determine a workload zone:
                </Text>
                <View style={{ gap: 4, marginTop: 4 }}>
                  {[
                    { color: Colors.info, label: 'LOW', desc: '0–40% of baseline — light activity' },
                    { color: Colors.primary, label: 'MODERATE', desc: '40–70% — building up' },
                    { color: Colors.success, label: 'OPTIMAL', desc: '70–140% — normal working pace' },
                    { color: Colors.warning, label: 'HIGH', desc: '140–195% — above normal, monitor fatigue' },
                    { color: Colors.danger, label: 'OVERLOAD', desc: '195%+ — significantly above baseline' },
                  ].map((z, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: z.color }} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: z.color, width: 70 }}>{z.label}</Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted, flex: 1 }}>{z.desc}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Example</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  A pilot flies ~25h per 14-day period on average (baseline). This period they've flown 30h — that's +20% over baseline, placing them in the OPTIMAL zone. If they had flown 50h it would be +100%, reaching HIGH. The system adapts to each pilot's rhythm automatically.
                </Text>
              </View>

            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
