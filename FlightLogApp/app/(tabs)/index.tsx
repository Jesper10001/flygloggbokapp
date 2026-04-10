import { useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { EASA_CPL_REQUIREMENTS, EASA_ATPL_REQUIREMENTS, FREE_TIER_LIMIT } from '../../constants/easa';
import { formatHours } from '../../utils/format';
import { AirportMapWidget } from '../../components/AirportMapWidget';
import { FlightChart } from '../../components/FlightChart';
import { StressWidget } from '../../components/StressWidget';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function ProgressBar({ label, current, required, color = Colors.primary }: {
  label: string;
  current: number;
  required: number;
  color?: string;
}) {
  const pct = Math.min((current / required) * 100, 100);
  const done = current >= required;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={[styles.progressValue, done && { color: Colors.success }]}>
          {formatHours(current)} / {required}h
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${pct}%` as any, backgroundColor: done ? Colors.success : color },
          ]}
        />
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { stats, flightCount, isPremium, isLoading, loadStats } = useFlightStore();

  useEffect(() => {
    loadStats();
  }, []);

  const s = stats;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={loadStats}
          tintColor={Colors.primary}
        />
      }
    >
      {/* Lägg till-knapp */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => router.push('/flight/add')}
        activeOpacity={0.8}
      >
        <Ionicons name="add-circle" size={20} color={Colors.textInverse} />
        <Text style={styles.addButtonText}>Logga ny flygning</Text>
      </TouchableOpacity>

      {/* Freemium-varning */}
      {!isPremium && (
        <View style={styles.freeNotice}>
          <Ionicons name="information-circle" size={16} color={Colors.gold} />
          <Text style={styles.freeNoticeText}>
            {flightCount}/{FREE_TIER_LIMIT} flygningar (gratis)
          </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/settings')}>
            <Text style={styles.upgradeLink}>Uppgradera</Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading && !s ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Totaler */}
          <Text style={styles.sectionTitle}>Totaler</Text>
          <View style={styles.statsGrid}>
            <StatCard label="Total flygtid" value={formatHours(s?.total_time ?? 0)} sub="timmar" />
            <StatCard label="PIC" value={formatHours(s?.total_pic ?? 0)} sub="timmar" />
            <StatCard label="IFR" value={formatHours(s?.total_ifr ?? 0)} sub="timmar" />
            <StatCard label="Natt" value={formatHours(s?.total_night ?? 0)} sub="timmar" />
            <StatCard label="Co-pilot" value={formatHours(s?.total_co_pilot ?? 0)} sub="timmar" />
            <StatCard label="Dual" value={formatHours(s?.total_dual ?? 0)} sub="timmar" />
          </View>

          {/* Landningar & starter */}
          <View style={styles.landingRow}>
            <View style={styles.landingCard}>
              <Ionicons name="sunny" size={18} color={Colors.gold} />
              <Text style={styles.landingValue}>{s?.total_landings_day ?? 0}</Text>
              <Text style={styles.landingLabel}>Landningar dag</Text>
            </View>
            <View style={styles.landingCard}>
              <Ionicons name="moon" size={18} color={Colors.primaryLight} />
              <Text style={styles.landingValue}>{s?.total_landings_night ?? 0}</Text>
              <Text style={styles.landingLabel}>Landningar natt</Text>
            </View>
            <View style={styles.landingCard}>
              <Ionicons name="time" size={18} color={Colors.accent} />
              <Text style={styles.landingValue}>{formatHours(s?.last_90_days ?? 0)}</Text>
              <Text style={styles.landingLabel}>Senaste 90 dagar</Text>
            </View>
          </View>

          {/* Karta — besökta flygplatser */}
          <Text style={styles.sectionTitle}>Karta</Text>
          <AirportMapWidget />

          {/* Flygtimmar per månad */}
          <Text style={styles.sectionTitle}>Statistik</Text>
          <FlightChart />

          {/* Stressindikator */}
          <StressWidget />

          {/* EASA CPL */}
          {isPremium && (
            <>
              <Text style={styles.sectionTitle}>EASA CPL-krav (FCL.515)</Text>
              <View style={styles.easaCard}>
                <ProgressBar
                  label={EASA_CPL_REQUIREMENTS.total_flight_time.label}
                  current={s?.total_time ?? 0}
                  required={EASA_CPL_REQUIREMENTS.total_flight_time.required}
                />
                <ProgressBar
                  label={EASA_CPL_REQUIREMENTS.pic.label}
                  current={s?.total_pic ?? 0}
                  required={EASA_CPL_REQUIREMENTS.pic.required}
                />
                <ProgressBar
                  label={EASA_CPL_REQUIREMENTS.instrument_time.label}
                  current={s?.total_ifr ?? 0}
                  required={EASA_CPL_REQUIREMENTS.instrument_time.required}
                />
                <ProgressBar
                  label={EASA_CPL_REQUIREMENTS.night_flight.label}
                  current={s?.total_night ?? 0}
                  required={EASA_CPL_REQUIREMENTS.night_flight.required}
                />
              </View>

              <Text style={styles.sectionTitle}>EASA ATPL-krav (FCL.510)</Text>
              <View style={styles.easaCard}>
                <ProgressBar
                  label={EASA_ATPL_REQUIREMENTS.total_flight_time.label}
                  current={s?.total_time ?? 0}
                  required={EASA_ATPL_REQUIREMENTS.total_flight_time.required}
                  color={Colors.gold}
                />
                <ProgressBar
                  label={EASA_ATPL_REQUIREMENTS.pic.label}
                  current={s?.total_pic ?? 0}
                  required={EASA_ATPL_REQUIREMENTS.pic.required}
                  color={Colors.gold}
                />
                <ProgressBar
                  label={EASA_ATPL_REQUIREMENTS.instrument_time.label}
                  current={s?.total_ifr ?? 0}
                  required={EASA_ATPL_REQUIREMENTS.instrument_time.required}
                  color={Colors.gold}
                />
                <ProgressBar
                  label={EASA_ATPL_REQUIREMENTS.night_flight.label}
                  current={s?.total_night ?? 0}
                  required={EASA_ATPL_REQUIREMENTS.night_flight.required}
                  color={Colors.gold}
                />
              </View>
            </>
          )}

          {!isPremium && (
            <TouchableOpacity
              style={styles.premiumBanner}
              onPress={() => router.push('/(tabs)/settings')}
              activeOpacity={0.8}
            >
              <Ionicons name="star" size={18} color={Colors.gold} />
              <Text style={styles.premiumBannerText}>
                Uppgradera till Premium för EASA-kravöversikt, OCR-skanning och export
              </Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.gold} />
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 32 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
    gap: 8,
  },
  addButtonText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },

  freeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.gold + '44',
  },
  freeNoticeText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  upgradeLink: { color: Colors.gold, fontSize: 13, fontWeight: '700' },

  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 20,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    flex: 1,
    minWidth: '28%',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
  },
  statValue: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  statSub: {
    color: Colors.textMuted,
    fontSize: 10,
  },

  landingRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  landingCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  landingValue: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  landingLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },

  easaCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  progressRow: { gap: 6 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { color: Colors.textSecondary, fontSize: 13 },
  progressValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.separator,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },

  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.gold + '55',
  },
  premiumBannerText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
});
