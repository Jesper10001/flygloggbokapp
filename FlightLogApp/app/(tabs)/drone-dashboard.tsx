import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useAppModeStore } from '../../store/appModeStore';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import { getSetting, setSetting } from '../../db/flights';
import {
  getExpiringCertificates, certStatus, getBatteryOverview,
  type DroneCertificate, type DroneBatteryStatus,
} from '../../db/drones';

type TotalMode = 'total' | 'ytd';
type ModeMode = 'vlos' | 'evlos' | 'bvlos' | 'night';
type CatMode = 'A1' | 'A2' | 'A3' | 'Specific' | 'Certified';

const MAX_BATTERY_CYCLES = 200; // approx livslängd på en typisk LiPo

export default function DroneDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const mode = useAppModeStore((s) => s.mode);
  const { stats, loadStats, loadFlights } = useDroneFlightStore();
  const styles = makeStyles();
  const [totalMode, setTotalMode] = useState<TotalMode>('total');
  const [modeMode, setModeMode] = useState<ModeMode>('vlos');
  const [catMode, setCatMode] = useState<CatMode>('A1');
  const [expiring, setExpiring] = useState<DroneCertificate[]>([]);
  const [batteryGroups, setBatteryGroups] = useState<DroneBatteryStatus[]>([]);

  useFocusEffect(useCallback(() => {
    loadStats();
    loadFlights();
    getExpiringCertificates(60).then(setExpiring);
    getBatteryOverview(3).then(setBatteryGroups);
    getSetting('drone_total_widget').then((v) => { if (v === 'total' || v === 'ytd') setTotalMode(v); });
    getSetting('drone_mode_widget').then((v) => {
      if (v === 'vlos' || v === 'evlos' || v === 'bvlos' || v === 'night') setModeMode(v as ModeMode);
    });
    getSetting('drone_cat_widget').then((v) => {
      if (v === 'A1' || v === 'A2' || v === 'A3' || v === 'Specific' || v === 'Certified') setCatMode(v as CatMode);
    });
  }, []));

  const modeValue = (k: ModeMode) => {
    if (!stats) return 0;
    if (k === 'vlos') return stats.vlos;
    if (k === 'evlos') return stats.evlos;
    if (k === 'bvlos') return stats.bvlos;
    return stats.night;
  };
  const modeLabel = (k: ModeMode) => k === 'night' ? t('night') : k.toUpperCase();
  const catValue = (k: CatMode) => {
    if (!stats) return 0;
    switch (k) {
      case 'A1': return stats.cat_a1;
      case 'A2': return stats.cat_a2;
      case 'A3': return stats.cat_a3;
      case 'Specific': return stats.cat_specific;
      case 'Certified': return stats.cat_certified;
    }
  };

  const cycleTotal = async () => {
    const next: TotalMode = totalMode === 'total' ? 'ytd' : 'total';
    setTotalMode(next);
    await setSetting('drone_total_widget', next);
  };
  const cycleMode = async () => {
    const order: ModeMode[] = ['vlos', 'evlos', 'bvlos', 'night'];
    const active = order.filter((k) => modeValue(k) > 0);
    if (active.length === 0) return;
    const idx = active.indexOf(modeMode);
    const next = active[(idx + 1) % active.length] ?? active[0];
    setModeMode(next);
    await setSetting('drone_mode_widget', next);
  };
  const cycleCat = async () => {
    const order: CatMode[] = ['A1', 'A2', 'A3', 'Specific', 'Certified'];
    const active = order.filter((k) => catValue(k) > 0);
    if (active.length === 0) return;
    const idx = active.indexOf(catMode);
    const next = active[(idx + 1) % active.length] ?? active[0];
    setCatMode(next);
    await setSetting('drone_cat_widget', next);
  };

  const totalValue = totalMode === 'total' ? (stats?.total_time ?? 0) : (stats?.year_to_date ?? 0);
  const totalLabel = totalMode === 'total' ? t('total_flight_time') : t('flight_time_ytd');

  // Category breakdown för staplar
  const catBreakdown: { label: CatMode; value: number }[] = [
    { label: 'A1', value: stats?.cat_a1 ?? 0 },
    { label: 'A2', value: stats?.cat_a2 ?? 0 },
    { label: 'A3', value: stats?.cat_a3 ?? 0 },
    { label: 'Specific', value: stats?.cat_specific ?? 0 },
    { label: 'Certified', value: stats?.cat_certified ?? 0 },
  ].filter((c) => c.value > 0);
  const catMax = Math.max(1, ...catBreakdown.map((c) => c.value));

  // Empty-state: ingen loggad flygning än — visa tydliga CTA
  const isEmpty = (stats?.total_flights ?? 0) === 0;
  if (isEmpty) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { flexGrow: 1 }]}>
        <View style={{ alignItems: 'center', paddingTop: 32, paddingHorizontal: 8 }}>
          <View style={{
            width: 96, height: 96, borderRadius: 48,
            backgroundColor: Colors.primary + '22',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: Colors.primary + '55',
            marginBottom: 16,
          }}>
            <Ionicons name="rocket" size={44} color={Colors.primary} />
          </View>
          <Text style={{ color: Colors.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' }}>
            {t('drone_empty_title')}
          </Text>
          <Text style={{ color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20, marginBottom: 24 }}>
            {t('drone_empty_body')}
          </Text>
          <View style={{ width: '100%', gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.push('/settings/drones')}
              activeOpacity={0.85}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
              }}
            >
              <Ionicons name="hardware-chip" size={18} color={Colors.textInverse} />
              <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '800' }}>
                {t('drone_empty_cta_add_drone')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/drone-flight/add')}
              activeOpacity={0.85}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: Colors.primary + '1F', borderRadius: 12, paddingVertical: 14,
                borderWidth: 1, borderColor: Colors.primary + '66',
              }}
            >
              <Ionicons name="add-circle" size={18} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontSize: 15, fontWeight: '700' }}>
                {t('drone_empty_cta_log_flight')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {expiring.length > 0 && (() => {
        const worst = expiring.reduce<'expired' | 'critical' | 'warning' | 'valid' | 'no_date'>((acc, c) => {
          const s = certStatus(c.expires_date);
          const rank = { expired: 4, critical: 3, warning: 2, valid: 1, no_date: 0 } as const;
          return rank[s] > rank[acc] ? s : acc;
        }, 'valid');
        const color = worst === 'expired' || worst === 'critical' ? Colors.danger : Colors.warning;
        return (
          <TouchableOpacity
            style={[styles.certBanner, { borderColor: color + '88', backgroundColor: color + '18' }]}
            onPress={() => router.push('/settings/certificates')}
            activeOpacity={0.8}
          >
            <Ionicons name="warning" size={16} color={color} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.certBannerTitle, { color }]}>
                {expiring.length} {expiring.length === 1 ? t('cert_expiring_one') : t('cert_expiring_many')}
              </Text>
              <Text style={styles.certBannerSub}>
                {expiring.slice(0, 2).map((c) => c.cert_type + (c.label ? ` ${c.label}` : '')).join(' · ')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        );
      })()}

      <Text style={styles.sectionTitle}>{t('totals')}</Text>
      <View style={styles.statsGrid}>
        <TouchableOpacity style={{ flex: 1 }} onPress={cycleTotal} activeOpacity={0.7}>
          <StatCard label={totalLabel} value={decimalToHHMM(totalValue)} sub={t('tap_to_switch')} accent />
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={cycleMode} activeOpacity={0.7}>
          <StatCard label={modeLabel(modeMode)} value={decimalToHHMM(modeValue(modeMode))} sub={t('tap_to_switch')} accent />
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={cycleCat} activeOpacity={0.7}>
          <StatCard label={catMode} value={decimalToHHMM(catValue(catMode))} sub={t('tap_to_switch')} accent />
        </TouchableOpacity>
      </View>

      {catBreakdown.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('category_breakdown')}</Text>
          <View style={styles.card}>
            {catBreakdown.map((c) => (
              <View key={c.label} style={styles.barRow}>
                <Text style={styles.barLabel}>{c.label}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(c.value / catMax) * 100}%` }]} />
                </View>
                <Text style={styles.barValue}>{decimalToHHMM(c.value)}h</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {batteryGroups.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('battery_health')}</Text>
          <View style={{ gap: 10 }}>
            {batteryGroups.map((g) => (
              <View key={g.drone_id} style={styles.card}>
                <View style={styles.batteryHeader}>
                  <Ionicons name="hardware-chip-outline" size={14} color={Colors.primary} />
                  <Text style={styles.batteryDroneTitle}>{g.drone_model}</Text>
                  {g.drone_reg ? <Text style={styles.batteryDroneReg}>{g.drone_reg}</Text> : null}
                </View>
                {g.batteries.map((b) => {
                  const pct = Math.min(100, Math.round((b.cycle_count / MAX_BATTERY_CYCLES) * 100));
                  const color = pct >= 85 ? Colors.danger : pct >= 60 ? Colors.warning : Colors.success;
                  return (
                    <View key={b.id} style={styles.batteryRow}>
                      <Text style={styles.batteryLabel}>{b.label}</Text>
                      <View style={styles.batteryTrack}>
                        <View style={[styles.batteryFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                      <Text style={[styles.batteryValue, { color }]}>
                        {b.cycle_count}/{MAX_BATTERY_CYCLES}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>{t('summary')}</Text>
      <View style={styles.card}>
        <SummaryRow label={t('total_flights')} value={String(stats?.total_flights ?? 0)} />
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  const styles = makeStyles();
  return (
    <View style={[styles.statCard, accent && styles.statCardAccent]}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const styles = makeStyles();
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, gap: 6, paddingBottom: 60 },
    sectionTitle: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 4,
    },
    statsGrid: { flexDirection: 'row', gap: 8 },
    statCard: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 14,
      flex: 1, minWidth: '28%', borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center',
    },
    statCardAccent: { borderColor: Colors.primary + '55' },
    statValue: {
      color: Colors.textPrimary, fontSize: 22, fontWeight: '800',
      fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
    },
    statValueAccent: { color: Colors.primary },
    statLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 4, textAlign: 'center' },
    statSub: { color: Colors.textMuted, fontSize: 9, marginTop: 2 },

    card: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 14,
      borderWidth: 0.5, borderColor: Colors.border, gap: 10,
    },

    barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    barLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', width: 72 },
    barTrack: {
      flex: 1, height: 8, borderRadius: 4,
      backgroundColor: Colors.elevated, overflow: 'hidden',
    },
    barFill: { height: '100%', borderRadius: 4, backgroundColor: Colors.primary },
    barValue: {
      color: Colors.textPrimary, fontSize: 12, fontWeight: '700',
      fontFamily: 'Menlo', fontVariant: ['tabular-nums'], width: 60, textAlign: 'right',
    },

    batteryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    batteryDroneTitle: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800', flex: 1 },
    batteryDroneReg: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo' },
    batteryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    batteryLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', width: 80 },
    batteryTrack: {
      flex: 1, height: 8, borderRadius: 4,
      backgroundColor: Colors.elevated, overflow: 'hidden',
    },
    batteryFill: { height: '100%', borderRadius: 4 },
    batteryValue: {
      fontSize: 11, fontWeight: '700',
      fontFamily: 'Menlo', fontVariant: ['tabular-nums'], width: 60, textAlign: 'right',
    },

    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    summaryLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
    summaryValue: {
      color: Colors.primary,
      fontSize: 18,
      fontWeight: '800',
      fontFamily: 'Menlo',
      letterSpacing: 2,
      fontVariant: ['tabular-nums'],
    },

    certBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      borderRadius: 10, padding: 12, borderWidth: 1,
      marginBottom: 4,
    },
    certBannerTitle: { fontSize: 13, fontWeight: '800' },
    certBannerSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  });
}
