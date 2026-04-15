import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { EASA_CPL_REQUIREMENTS, EASA_ATPL_REQUIREMENTS, FREE_TIER_LIMIT } from '../../constants/easa';
import { AirportMapWidget } from '../../components/AirportMapWidget';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { FlightChart } from '../../components/FlightChart';
import { StressWidget } from '../../components/StressWidget';
import { RouteMapModal } from '../../components/RouteMapModal';
import { BestWeekMapModal } from '../../components/BestWeekMapModal';
import { getSetting, setSetting } from '../../db/flights';
import { useTranslation } from '../../hooks/useTranslation';

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 32 },

    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: Colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      marginBottom: 16,
      gap: 8,
    },
    addButtonText: {
      color: Colors.textInverse,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
    },

    freeNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: Colors.card,
      borderRadius: 8,
      padding: 10,
      marginBottom: 16,
      gap: 6,
      borderWidth: 0.5,
      borderColor: Colors.gold + '66',
    },
    freeNoticeText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
    upgradeLink: { color: Colors.gold, fontSize: 13, fontWeight: '700' },

    sectionTitle: {
      color: Colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      marginBottom: 10,
      marginTop: 20,
    },

    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    statCard: {
      backgroundColor: Colors.card,
      borderRadius: 10,
      padding: 14,
      flex: 1,
      minWidth: '28%',
      borderWidth: 0.5,
      borderColor: Colors.border,
      alignItems: 'center',
    },
    statCardAccent: {
      borderColor: Colors.primary + '55',
    },
    statValue: {
      color: Colors.textPrimary,
      fontSize: 22,
      fontWeight: '800',
      fontFamily: 'Menlo',
      fontVariant: ['tabular-nums'],
    },
    statValueAccent: {
      color: Colors.primary,
    },
    statLabel: {
      color: Colors.textSecondary,
      fontSize: 11,
      marginTop: 3,
      textAlign: 'center',
    },
    statSub: {
      color: Colors.textMuted,
      fontSize: 10,
    },

    spotlightRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 4,
    },
    spotlightCard: {
      flex: 1,
      backgroundColor: Colors.card,
      borderRadius: 10,
      padding: 16,
      gap: 6,
      borderWidth: 0.5,
      borderColor: Colors.border,
    },
    spotlightCardClickable: {
      borderColor: Colors.primary + '55',
    },
    spotlightIconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    spotlightLabel: {
      color: Colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    spotlightValue: {
      color: Colors.textPrimary,
      fontSize: 30,
      fontWeight: '800',
      fontFamily: 'Menlo',
      fontVariant: ['tabular-nums'],
      marginTop: 4,
    },
    spotlightSub: {
      color: Colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
    },

    easaCard: {
      backgroundColor: Colors.card,
      borderRadius: 10,
      padding: 16,
      gap: 16,
      borderWidth: 0.5,
      borderColor: Colors.border,
    },
    progressRow: { gap: 6 },
    progressHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    progressLabel: { color: Colors.textSecondary, fontSize: 13 },
    progressValue: {
      color: Colors.textPrimary,
      fontSize: 12,
      fontWeight: '600',
      fontFamily: 'Menlo',
      fontVariant: ['tabular-nums'],
    },
    progressTrack: {
      height: 4,
      backgroundColor: Colors.separator,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: 2 },

    premiumBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: Colors.card,
      borderRadius: 10,
      padding: 16,
      marginTop: 20,
      gap: 10,
      borderWidth: 0.5,
      borderColor: Colors.gold + '66',
    },
    premiumBannerText: {
      flex: 1,
      color: Colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
  });
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

function ProgressBar({ label, current, required, color = Colors.primary }: {
  label: string;
  current: number;
  required: number;
  color?: string;
}) {
  const styles = makeStyles();
  const { formatTime } = useTimeFormat();
  const pct = Math.min((current / required) * 100, 100);
  const done = current >= required;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={[styles.progressValue, done && { color: Colors.success }]}>
          {formatTime(current)} / {required}h
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
  const styles = makeStyles();
  const router = useRouter();
  const { stats, flightCount, isPremium, isLoading, loadStats } = useFlightStore();
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const [xcMapVisible, setXcMapVisible] = useState(false);
  const [weekMapVisible, setWeekMapVisible] = useState(false);
  type ThirdWidget = 'ifr' | 'vfr' | 'night' | 'nvg';
  const [thirdWidget, setThirdWidget] = useState<ThirdWidget>('ifr');
  const [totalWidget, setTotalWidget] = useState<'total' | 'ytd'>('total');
  type RoleKey = 'pic' | 'co_pilot' | 'picus' | 'spic' | 'ferry_pic' | 'observer' | 'relief_crew' | 'dual' | 'instructor' | 'examiner' | 'safety_pilot';
  const [picWidget, setPicWidget] = useState<RoleKey>('pic');

  useEffect(() => {
    loadStats();
    getSetting('dashboard_third_widget').then((v) => {
      if (v === 'ifr' || v === 'vfr' || v === 'night' || v === 'nvg') setThirdWidget(v as ThirdWidget);
    });
    getSetting('dashboard_total_widget').then((v) => {
      if (v === 'total' || v === 'ytd') setTotalWidget(v);
    });
    getSetting('dashboard_pic_widget').then((v) => {
      const allowed: RoleKey[] = ['pic','co_pilot','picus','spic','ferry_pic','observer','relief_crew','dual','instructor','examiner','safety_pilot'];
      if (v && allowed.includes(v as RoleKey)) setPicWidget(v as RoleKey);
    });
  }, []);

  const toggleTotalWidget = async () => {
    const next = totalWidget === 'total' ? 'ytd' : 'total';
    setTotalWidget(next);
    await setSetting('dashboard_total_widget', next);
  };

  const toggleThirdWidget = async () => {
    const cycle: ThirdWidget[] = ['ifr', 'vfr', 'night', 'nvg'];
    const idx = cycle.indexOf(thirdWidget);
    const next = cycle[(idx + 1) % cycle.length];
    setThirdWidget(next);
    await setSetting('dashboard_third_widget', next);
  };

  const roleValue = (key: RoleKey): number => {
    const s = stats;
    switch (key) {
      case 'pic': return s?.total_pic ?? 0;
      case 'co_pilot': return s?.total_co_pilot ?? 0;
      case 'picus': return s?.total_picus ?? 0;
      case 'spic': return s?.total_spic ?? 0;
      case 'ferry_pic': return s?.total_ferry_pic ?? 0;
      case 'observer': return s?.total_observer ?? 0;
      case 'relief_crew': return s?.total_relief_crew ?? 0;
      case 'dual': return s?.total_dual ?? 0;
      case 'instructor': return s?.total_instructor ?? 0;
      case 'examiner': return s?.total_examiner ?? 0;
      case 'safety_pilot': return s?.total_safety_pilot ?? 0;
    }
  };
  const roleLabel = (key: RoleKey): string => {
    switch (key) {
      case 'pic': return t('pic');
      case 'co_pilot': return t('co_pilot');
      case 'picus': return 'PICUS';
      case 'spic': return 'SPIC';
      case 'ferry_pic': return 'Ferry PIC';
      case 'observer': return 'Observer';
      case 'relief_crew': return 'Relief Crew';
      case 'dual': return t('dual');
      case 'instructor': return 'FI';
      case 'examiner': return 'Examiner';
      case 'safety_pilot': return 'Safety Pilot';
    }
  };
  const activeRoles = (): RoleKey[] => {
    const order: RoleKey[] = ['pic','co_pilot','picus','spic','ferry_pic','observer','relief_crew','dual','instructor','examiner','safety_pilot'];
    return order.filter((k) => roleValue(k) > 0);
  };
  const togglePicWidget = async () => {
    const active = activeRoles();
    if (active.length === 0) return;
    const idx = active.indexOf(picWidget);
    const next = active[(idx + 1) % active.length] ?? active[0];
    setPicWidget(next);
    await setSetting('dashboard_pic_widget', next);
  };

  // Auto-korrigera om sparad roll inte längre har någon tid
  useEffect(() => {
    if (!stats) return;
    if (roleValue(picWidget) > 0) return;
    const active = activeRoles();
    if (active.length > 0 && active[0] !== picWidget) {
      setPicWidget(active[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  const xcCoordsOk = !!stats?.longest_xc_id;

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
      {/* Log new flight button */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => router.push('/flight/add')}
        activeOpacity={0.8}
      >
        <Ionicons name="add-circle" size={20} color={Colors.textInverse} />
        <Text style={styles.addButtonText}>{t('log_new_flight')}</Text>
      </TouchableOpacity>

      {/* Freemium notice */}
      {!isPremium && (
        <View style={styles.freeNotice}>
          <Ionicons name="information-circle" size={16} color={Colors.gold} />
          <Text style={styles.freeNoticeText}>
            {flightCount}/{FREE_TIER_LIMIT} {t('flights_free')}
          </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/settings')}>
            <Text style={styles.upgradeLink}>{t('upgrade')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading && !s ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Totals */}
          <Text style={styles.sectionTitle}>{t('totals')}</Text>
          <View style={styles.statsGrid}>
            <TouchableOpacity style={{ flex: 1 }} onPress={toggleTotalWidget} activeOpacity={0.7}>
              <StatCard
                label={totalWidget === 'total' ? t('total_flight_time') : t('flight_time_ytd')}
                value={formatTime(totalWidget === 'total' ? (s?.total_time ?? 0) : (s?.year_to_date ?? 0))}
                sub={t('tap_to_switch')}
                accent
              />
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1 }} onPress={togglePicWidget} activeOpacity={0.7}>
              <StatCard
                label={roleLabel(picWidget)}
                value={formatTime(roleValue(picWidget))}
                sub={t('tap_to_switch')}
                accent
              />
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1 }} onPress={toggleThirdWidget} activeOpacity={0.7}>
              <StatCard
                label={
                  thirdWidget === 'ifr' ? 'IFR'
                    : thirdWidget === 'vfr' ? 'VFR'
                    : thirdWidget === 'night' ? t('night')
                    : 'NVG'
                }
                value={formatTime(
                  thirdWidget === 'ifr' ? (s?.total_ifr ?? 0)
                    : thirdWidget === 'vfr' ? (s?.total_vfr ?? 0)
                    : thirdWidget === 'night' ? (s?.total_night ?? 0)
                    : (s?.total_nvg ?? 0)
                )}
                sub={t('tap_to_switch')}
                accent
              />
            </TouchableOpacity>
          </View>

          {/* Spotlight cards */}
          <View style={styles.spotlightRow}>
            {/* Best week */}
            <TouchableOpacity
              style={[styles.spotlightCard, s?.best_week_start && styles.spotlightCardClickable]}
              activeOpacity={s?.best_week_start ? 0.7 : 1}
              onPress={() => s?.best_week_start && setWeekMapVisible(true)}
            >
              <View style={styles.spotlightIconRow}>
                <Ionicons name="trophy" size={16} color={Colors.gold} />
                <Text style={styles.spotlightLabel}>{t('best_week')}</Text>
                {s?.best_week_last_flight_id ? (
                  <Ionicons name="chevron-forward" size={12} color={Colors.textMuted} style={{ marginLeft: 'auto' }} />
                ) : null}
              </View>
              <Text style={styles.spotlightValue}>
                {s?.best_week_hours ? `${formatTime(s.best_week_hours)}h` : '—'}
              </Text>
              <Text style={styles.spotlightSub}>
                {s?.best_week_label || t('no_data')}
              </Text>
            </TouchableOpacity>

            {/* Longest XC */}
            <TouchableOpacity
              style={[styles.spotlightCard, xcCoordsOk && styles.spotlightCardClickable]}
              activeOpacity={xcCoordsOk ? 0.7 : 1}
              onPress={() => xcCoordsOk && setXcMapVisible(true)}
              disabled={!xcCoordsOk}
            >
              <View style={styles.spotlightIconRow}>
                <Ionicons name="navigate" size={16} color={xcCoordsOk ? Colors.primary : Colors.textMuted} />
                <Text style={styles.spotlightLabel}>{t('longest_xc')}</Text>
                {xcCoordsOk ? (
                  <Ionicons name="map" size={12} color={Colors.textMuted} style={{ marginLeft: 'auto' }} />
                ) : null}
              </View>
              <Text style={styles.spotlightValue}>
                {s?.longest_xc_km ? `${s.longest_xc_km} NM` : '—'}
              </Text>
              <Text style={styles.spotlightSub}>
                {s?.longest_xc_first_dep && s?.longest_xc_last_arr
                  ? `${s.longest_xc_first_dep}→${s.longest_xc_last_arr} · ${s.longest_xc_date}`
                  : t('no_data')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* XC map modal */}
          {s?.longest_xc_date && (
            <RouteMapModal
              visible={xcMapVisible}
              onClose={() => setXcMapVisible(false)}
              xcDate={s.longest_xc_date}
              hours={s.longest_xc_hours}
            />
          )}

          {/* Best week map modal */}
          {s?.best_week_start && (
            <BestWeekMapModal
              visible={weekMapVisible}
              onClose={() => setWeekMapVisible(false)}
              weekStart={s.best_week_start}
              weekLabel={s.best_week_label}
              hours={s.best_week_hours}
            />
          )}

          {/* Performance / Stress widget */}
          <Text style={styles.sectionTitle}>{t('performance')}</Text>
          <StressWidget />

          {/* Map */}
          <Text style={styles.sectionTitle}>{t('map')}</Text>
          <AirportMapWidget />

          {/* Statistics */}
          <Text style={styles.sectionTitle}>{t('statistics')}</Text>
          <FlightChart />

          {/* EASA CPL */}
          {isPremium && (
            <>
              <Text style={styles.sectionTitle}>{t('easa_cpl_requirements')}</Text>
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

              <Text style={styles.sectionTitle}>{t('easa_atpl_requirements')}</Text>
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
                {t('upgrade_to_premium_banner')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.gold} />
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

