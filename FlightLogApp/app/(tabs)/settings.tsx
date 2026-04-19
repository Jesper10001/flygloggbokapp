import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { exportToCSV, exportToPDF } from '../../services/export';
import { exportDroneToCSV } from '../../services/droneExport';
import { clearAllFlights, getFlightCount } from '../../db/flights';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useThemeStore } from '../../store/themeStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useToastStore } from '../../components/Toast';
import { useOperatorStore } from '../../store/operatorStore';
import { seedTestUser1, seedTestUser2, clearTestUser } from '../../services/testUserSeed';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { clearDroneRegistryCategories, getDroneFlightCount } from '../../db/drones';
import { useDroneFlightStore } from '../../store/droneFlightStore';

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 40, gap: 8 },

    premiumCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 16, padding: 16,
      borderWidth: 1, borderColor: Colors.gold + '55', marginBottom: 8,
    },
    premiumLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    premiumBadge: {
      width: 40, height: 40, borderRadius: 10,
      backgroundColor: Colors.gold, alignItems: 'center', justifyContent: 'center',
    },
    premiumTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    premiumSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
    premiumPrice: { color: Colors.gold, fontSize: 12, fontWeight: '600', marginTop: 2 },

    dataPhilosophy: {
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: Colors.primary + '18', borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.primary + '33', marginBottom: 8,
    },
    dataPhilosophyText: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },

    sectionTitle: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1,
      marginTop: 16, marginBottom: 4, marginLeft: 4,
    },

    card: {
      backgroundColor: Colors.card, borderRadius: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
    },
    settingsRow: {
      flexDirection: 'row', alignItems: 'center',
      padding: 14, gap: 12,
      borderBottomWidth: 1, borderBottomColor: Colors.separator,
    },
    settingsIcon: {
      width: 34, height: 34, borderRadius: 8,
      backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center',
    },
    settingsText: { flex: 1 },
    settingsLabel: { color: Colors.textPrimary, fontSize: 14, fontWeight: '500' },
    settingsSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
    premiumTag: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: Colors.gold + '33', borderRadius: 3,
      paddingHorizontal: 4, paddingVertical: 1,
    },
    premiumTagText: { color: Colors.gold, fontSize: 9, fontWeight: '700' },

    divider: {
      height: 1, backgroundColor: Colors.separator, marginHorizontal: -16,
    },
    langToggle: {
      flexDirection: 'row',
      backgroundColor: Colors.elevated,
      borderRadius: 8,
      padding: 3,
      gap: 3,
      borderWidth: 0.5,
      borderColor: Colors.border,
      width: 150,
    },
    langBtn: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 4,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    langBtnActive: {
      backgroundColor: Colors.primary,
    },
    langBtnText: {
      color: Colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    langBtnTextActive: {
      color: Colors.textInverse,
    },
  });
}

function PreviewAlwaysRow({ appMode }: { appMode: 'manned' | 'drone' }) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [on, setOn] = useState(false);
  const key = appMode === 'drone' ? 'preview_always_show' : 'manned_preview_always_show';
  useEffect(() => {
    import('../../db/flights').then(({ getSetting }) => {
      getSetting(key).then((v) => setOn(v === '1'));
    });
  }, [key]);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    const { setSetting } = await import('../../db/flights');
    await setSetting(key, next ? '1' : '0');
  };
  return (
    <View style={styles.settingsRow}>
      <View style={styles.settingsIcon}>
        <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
      </View>
      <View style={styles.settingsText}>
        <Text style={styles.settingsLabel}>{t('preview_always_label')}</Text>
        <Text style={styles.settingsSub}>{t('preview_always_sub')}</Text>
      </View>
      <View style={styles.langToggle}>
        <TouchableOpacity
          style={[styles.langBtn, !on && styles.langBtnActive]}
          onPress={() => !on ? null : toggle()}
        >
          <Text style={[styles.langBtnText, !on && styles.langBtnTextActive]}>{t('off')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.langBtn, on && styles.langBtnActive]}
          onPress={() => on ? null : toggle()}
        >
          <Text style={[styles.langBtnText, on && styles.langBtnTextActive]}>{t('on')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PilotTypeRow() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const setPilotType = usePilotTypeStore((s) => s.setPilotType);

  const switchTo = (next: 'commercial' | 'military') => {
    if (next === pilotType) return;
    Alert.alert(
      t('pilot_type_switch_title'),
      t('pilot_type_switch_body'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('pilot_type_switch_confirm'),
          onPress: async () => {
            await clearDroneRegistryCategories();
            await setPilotType(next);
            router.push('/settings/drones');
          },
        },
      ],
    );
  };

  return (
    <View style={styles.settingsRow}>
      <View style={styles.settingsIcon}>
        <Ionicons name="ribbon-outline" size={18} color={Colors.primary} />
      </View>
      <View style={styles.settingsText}>
        <Text style={styles.settingsLabel}>{t('pilot_type')}</Text>
        <Text style={styles.settingsSub}>
          {pilotType === 'military' ? t('pilot_type_military_sub') : t('pilot_type_commercial_sub')}
        </Text>
      </View>
      <View style={styles.langToggle}>
        <TouchableOpacity
          style={[styles.langBtn, pilotType === 'commercial' && styles.langBtnActive]}
          onPress={() => switchTo('commercial')}
          activeOpacity={0.7}
        >
          <Text style={[styles.langBtnText, pilotType === 'commercial' && styles.langBtnTextActive]}>
            {t('pilot_type_commercial')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.langBtn, pilotType === 'military' && styles.langBtnActive]}
          onPress={() => switchTo('military')}
          activeOpacity={0.7}
        >
          <Text style={[styles.langBtnText, pilotType === 'military' && styles.langBtnTextActive]}>
            {t('pilot_type_military')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ThemePill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const styles = makeStyles();
  return (
    <TouchableOpacity
      style={[styles.langBtn, active && styles.langBtnActive, { flex: 0, paddingHorizontal: 12, paddingVertical: 5 }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.langBtnText, active && styles.langBtnTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function SettingsRow({
  icon, label, sub, onPress, rightEl, danger, locked,
}: {
  icon: string;
  label: string;
  sub?: string;
  onPress?: () => void;
  rightEl?: React.ReactNode;
  danger?: boolean;
  locked?: boolean;
}) {
  const styles = makeStyles();
  return (
    <TouchableOpacity
      style={styles.settingsRow}
      onPress={onPress}
      disabled={!onPress && !rightEl}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[styles.settingsIcon, danger && { backgroundColor: Colors.danger + '22' }]}>
        <Ionicons name={icon as any} size={18} color={danger ? Colors.danger : Colors.primary} />
      </View>
      <View style={styles.settingsText}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.settingsLabel, danger && { color: Colors.danger }]}>{label}</Text>
          {locked && (
            <View style={styles.premiumTag}>
              <Ionicons name="star" size={9} color={Colors.gold} />
              <Text style={styles.premiumTagText}>Premium</Text>
            </View>
          )}
        </View>
        {sub ? <Text style={styles.settingsSub}>{sub}</Text> : null}
      </View>
      {rightEl ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} /> : null)}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const styles = makeStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { timeFormat, setTimeFormat } = useTimeFormatStore();
  const { theme, setTheme } = useThemeStore();
  const { mode: appMode, setMode: setAppMode } = useAppModeStore();
  const { operatorId, setOperatorId, loadOperatorId } = useOperatorStore();
  const { loadFlights: loadDroneFlights, loadStats: loadDroneStats } = useDroneFlightStore();

  const applyTestUser = (which: 1 | 2 | 'clear') => {
    const label = which === 'clear' ? t('clear_test_user') : `${t('test_user')} ${which}`;
    Alert.alert(
      label,
      t('test_user_confirm'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('apply'),
          style: 'destructive',
          onPress: async () => {
            try {
              if (which === 1) {
                await seedTestUser1();
                await setTheme('drone-industrial');
              } else if (which === 2) {
                await seedTestUser2();
                await setTheme('drone-neon');
              } else {
                await clearTestUser();
              }
              await loadOperatorId();
              await loadDroneFlights();
              await loadDroneStats();
              useToastStore.getState().show(label);
            } catch (e: any) {
              Alert.alert(t('error'), e.message);
            }
          },
        },
      ]
    );
  };
  const { isPremium, setIsPremium, flightCount, loadFlights, loadStats } = useFlightStore();
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      if (appMode === 'drone') await exportDroneToCSV();
      else await exportToCSV();
    } catch (e: any) {
      Alert.alert(t('export_failed'), e.message);
    } finally {
      setExportingCSV(false);
    }
  };

  const handleExportPDF = async () => {
    setExportingPDF(true);
    try {
      await exportToPDF();
    } catch (e: any) {
      Alert.alert(t('export_failed'), e.message);
    } finally {
      setExportingPDF(false);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      t('clear_all_data'),
      `${t('clear_all_data_message')} ${flightCount} ${t('clear_all_data_message2')}`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clear_all'),
          style: 'destructive',
          onPress: async () => {
            await clearAllFlights();
            await Promise.all([loadFlights(), loadStats()]);
            Alert.alert(t('done'), t('all_deleted'));
          },
        },
      ]
    );
  };

  const handleUpgrade = () => {
    Alert.alert(
      t('premium_alert_title'),
      t('premium_alert_message'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('enable_test'), onPress: () => setIsPremium(true) },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Premium banner */}
      {!isPremium ? (
        <TouchableOpacity style={styles.premiumCard} onPress={handleUpgrade} activeOpacity={0.85}>
          <View style={styles.premiumLeft}>
            <View style={styles.premiumBadge}>
              <Ionicons name="star" size={20} color={Colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>{t('tailwind_premium')}</Text>
              <Text style={styles.premiumSub}>{t('premium_sub')}</Text>
              <Text style={styles.premiumPrice}>{t('premium_price')}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.gold} />
        </TouchableOpacity>
      ) : (
        <View style={[styles.premiumCard, { borderColor: Colors.success + '55' }]}>
          <View style={styles.premiumLeft}>
            <View style={[styles.premiumBadge, { backgroundColor: Colors.success }]}>
              <Ionicons name="checkmark" size={20} color={Colors.textInverse} />
            </View>
            <View>
              <Text style={styles.premiumTitle}>{t('premium_active')}</Text>
              <Text style={styles.premiumSub}>{t('all_features_unlocked')}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Data philosophy */}
      <View style={styles.dataPhilosophy}>
        <Ionicons name="shield-checkmark" size={16} color={Colors.primary} />
        <Text style={styles.dataPhilosophyText}>{t('data_philosophy')}</Text>
      </View>

      {/* Developer */}
      <Text style={styles.sectionTitle}>{t('developer_section')}</Text>
      <View style={styles.card}>
        {appMode === 'drone' && <PilotTypeRow />}
        {appMode === 'drone' && (
          <>
            <SettingsRow
              icon="flask-outline"
              label={`${t('test_user')} 1`}
              sub={t('test_user_1_sub')}
              onPress={() => applyTestUser(1)}
            />
            <SettingsRow
              icon="flask-outline"
              label={`${t('test_user')} 2`}
              sub={t('test_user_2_sub')}
              onPress={() => applyTestUser(2)}
            />
            <SettingsRow
              icon="refresh-outline"
              label={t('clear_test_user')}
              sub={t('clear_test_user_sub')}
              onPress={() => applyTestUser('clear')}
              danger
            />
          </>
        )}
        <SettingsRow
          icon="compass-outline"
          label={t('replay_tour')}
          sub={t('replay_tour_sub')}
          onPress={() => router.push(appMode === 'drone' ? '/preview' : '/manned-preview')}
        />
        <PreviewAlwaysRow appMode={appMode} />
        <SettingsRow
          icon="trash"
          label={t('clear_all_logbook_data')}
          sub={t('clear_all_sub')}
          onPress={handleClearAll}
          danger
        />
      </View>

      {/* App section — language */}
      <Text style={styles.sectionTitle}>{t('app_section')}</Text>
      <View style={styles.card}>
        <View style={styles.settingsRow}>
          <View style={[styles.settingsIcon]}>
            <Ionicons name="language" size={18} color={Colors.primary} />
          </View>
          <View style={styles.settingsText}>
            <Text style={styles.settingsLabel}>{t('language')}</Text>
            <Text style={styles.settingsSub}>{t('language_sub')}</Text>
          </View>
          <View style={styles.langToggle}>
            <TouchableOpacity
              style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
              onPress={() => setLanguage('en')}
              activeOpacity={0.7}
            >
              <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>ENG</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === 'sv' && styles.langBtnActive]}
              onPress={() => setLanguage('sv')}
              activeOpacity={0.7}
            >
              <Text style={[styles.langBtnText, language === 'sv' && styles.langBtnTextActive]}>SWE</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Theme */}
        <View style={styles.settingsRow}>
          <View style={styles.settingsIcon}>
            <Ionicons name="contrast-outline" size={18} color={Colors.primary} />
          </View>
          <View style={styles.settingsText}>
            <Text style={styles.settingsLabel}>{t('theme')}</Text>
            <Text style={styles.settingsSub}>{t('theme_sub')}</Text>
          </View>
          <View style={styles.langToggle}>
            {appMode === 'manned' ? (
              <>
                <TouchableOpacity
                  style={[styles.langBtn, theme === 'navy' && styles.langBtnActive]}
                  onPress={() => setTheme('navy')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.langBtnText, theme === 'navy' && styles.langBtnTextActive]}>{t('theme_navy')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langBtn, theme === 'bright' && styles.langBtnActive]}
                  onPress={() => setTheme('bright')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.langBtnText, theme === 'bright' && styles.langBtnTextActive]}>{t('theme_bright')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.langBtn, theme === 'drone-industrial' && styles.langBtnActive]}
                  onPress={() => setTheme('drone-industrial')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.langBtnText, theme === 'drone-industrial' && styles.langBtnTextActive]}>{t('theme_matt')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langBtn, theme === 'drone-neon' && styles.langBtnActive]}
                  onPress={() => setTheme('drone-neon')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.langBtnText, theme === 'drone-neon' && styles.langBtnTextActive]}>{t('theme_neon')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Time format */}
        <View style={styles.settingsRow}>
          <View style={styles.settingsIcon}>
            <Ionicons name="time-outline" size={18} color={Colors.primary} />
          </View>
          <View style={styles.settingsText}>
            <Text style={styles.settingsLabel}>{t('time_format')}</Text>
            <Text style={styles.settingsSub}>{t('time_format_sub')}</Text>
          </View>
          <View style={styles.langToggle}>
            <TouchableOpacity
              style={[styles.langBtn, timeFormat === 'decimal' && styles.langBtnActive]}
              onPress={() => setTimeFormat('decimal')}
              activeOpacity={0.7}
            >
              <Text style={[styles.langBtnText, timeFormat === 'decimal' && styles.langBtnTextActive]}>1.5</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, timeFormat === 'hhmm' && styles.langBtnActive]}
              onPress={() => setTimeFormat('hhmm')}
              activeOpacity={0.7}
            >
              <Text style={[styles.langBtnText, timeFormat === 'hhmm' && styles.langBtnTextActive]}>1:30</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Subscription */}
      <Text style={styles.sectionTitle}>{t('subscription')}</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="airplane"
          label={t('flights_logged')}
          sub={`${flightCount} of ${isPremium ? '∞' : FREE_TIER_LIMIT}`}
        />
        {!isPremium ? (
          <SettingsRow
            icon="star"
            label={t('upgrade_to_premium')}
            sub={t('upgrade_to_premium_sub')}
            onPress={handleUpgrade}
          />
        ) : (
          <SettingsRow
            icon="star-outline"
            label={t('cancel_premium')}
            onPress={() => Alert.alert(t('cancel_premium_alert'), t('disable_premium'), [
              { text: t('cancel'), style: 'cancel' },
              { text: t('yes'), onPress: () => setIsPremium(false) },
            ])}
          />
        )}
        <SettingsRow
          icon="refresh"
          label={t('restore_purchases')}
          sub={t('restore_purchases_sub')}
          onPress={() => Alert.alert(t('restore_alert_title'), t('restore_alert_message'))}
        />
      </View>

      {/* Import */}
      <Text style={styles.sectionTitle}>{t('import')}</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="cloud-upload"
          label={t('import_from_another_app')}
          sub={t('import_from_another_app_sub')}
          onPress={() => router.push('/import')}
        />
        <SettingsRow
          icon="create-outline"
          label={t('enter_experience_manually')}
          sub={t('enter_experience_manually_sub')}
          onPress={() => router.push('/import/manual')}
        />
      </View>

      {/* Export */}
      <Text style={styles.sectionTitle}>{t('export')}</Text>
      <View style={styles.card}>
        {appMode === 'drone' ? (
          <>
            <SettingsRow
              icon="document-text"
              label={t('export_csv_basic')}
              sub={t('export_csv_basic_sub')}
              onPress={handleExportCSV}
              rightEl={exportingCSV ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
            />
            <View style={[styles.settingsRow, { opacity: 0.5 }]}>
              <View style={styles.settingsIcon}>
                <Ionicons name="document-text-outline" size={18} color={Colors.textMuted} />
              </View>
              <View style={styles.settingsText}>
                <Text style={[styles.settingsLabel, { color: Colors.textMuted }]}>{t('export_csv_extended')}</Text>
                <Text style={styles.settingsSub}>{t('export_csv_extended_sub')}</Text>
              </View>
              <View style={{
                backgroundColor: Colors.elevated, borderRadius: 6,
                borderWidth: 0.5, borderColor: Colors.border,
                paddingHorizontal: 8, paddingVertical: 4,
              }}>
                <Text style={{ color: Colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {t('coming_soon')}
                </Text>
              </View>
            </View>
          </>
        ) : (
          <>
            <SettingsRow
              icon="document-text"
              label={t('export_to_csv')}
              sub={t('export_to_csv_sub')}
              onPress={handleExportCSV}
              rightEl={exportingCSV ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
            />
            <SettingsRow
              icon="print"
              label={t('export_to_pdf')}
              sub={isPremium ? t('export_to_pdf_premium') : t('export_to_pdf_locked')}
              locked={!isPremium}
              onPress={isPremium ? handleExportPDF : handleUpgrade}
              rightEl={exportingPDF ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
            />
          </>
        )}
      </View>

      {/* Database & traceability */}
      <Text style={styles.sectionTitle}>{t('database_traceability')}</Text>
      <View style={styles.card}>
        {appMode === 'drone' && (
          <>
            <View style={styles.settingsRow}>
              <View style={styles.settingsIcon}>
                <Ionicons name="person-outline" size={18} color={Colors.primary} />
              </View>
              <View style={styles.settingsText}>
                <Text style={styles.settingsLabel}>{t('operator_id')}</Text>
                <Text style={styles.settingsSub}>{t('operator_id_sub')}</Text>
              </View>
              <TextInput
                style={{
                  backgroundColor: Colors.elevated, borderRadius: 7,
                  borderWidth: 0.5, borderColor: Colors.border,
                  color: Colors.textPrimary, fontSize: 12, fontWeight: '600',
                  paddingHorizontal: 8, paddingVertical: 6, minWidth: 140, textAlign: 'right',
                }}
                value={operatorId}
                onChangeText={setOperatorId}
                placeholder="SWE-OP-xxx"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
              />
            </View>
            <SettingsRow
              icon="shield-checkmark-outline"
              label={t('certificates')}
              sub={t('certificates_sub')}
              onPress={() => router.push('/settings/certificates')}
            />
          </>
        )}
        {appMode === 'manned' && (
          <>
            <SettingsRow
              icon="location"
              label={t('manage_airports')}
              sub={t('add_custom_icao')}
              onPress={() => router.push('/settings/airport')}
            />
            <SettingsRow
              icon="book-outline"
              label={t('physical_logbooks')}
              sub={t('physical_logbooks_sub')}
              onPress={() => router.push('/settings/logbook-books')}
            />
          </>
        )}
        {/* Dold när fel mode, bevarad för källref */}
        {false && <SettingsRow
          icon="location"
          label={t('manage_airports')}
          sub={t('add_custom_icao')}
          onPress={() => router.push('/settings/airport')}
        />}
        <SettingsRow
          icon="time"
          label={t('audit_log')}
          sub={t('all_changes_logged')}
          onPress={() => router.push('/settings/auditlog')}
        />
      </View>

      {/* About */}
      <Text style={styles.sectionTitle}>{t('about')}</Text>
      <View style={styles.card}>
        <SettingsRow icon="information-circle" label="Blades" sub="Version 1.0.0" />
        <SettingsRow icon="shield-checkmark" label="Local data storage" sub="All data on your device — nothing in the cloud without your permission" />
        <SettingsRow
          icon="mail"
          label="Support"
          sub="support@flightlogpro.se"
          onPress={() => Alert.alert(t('support_alert_title'), t('support_alert_message'))}
        />
      </View>

      {/* Switch mode (längst ner) */}
      <SwitchModeButton appMode={appMode} setAppMode={setAppMode} />
    </ScrollView>
  );
}

function SwitchModeButton({
  appMode, setAppMode,
}: {
  appMode: 'manned' | 'drone';
  setAppMode: (m: 'manned' | 'drone') => Promise<void>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const target: 'manned' | 'drone' = appMode === 'manned' ? 'drone' : 'manned';
  const label = target === 'drone' ? t('switch_to_drone_logbook') : t('switch_to_manned_logbook');
  const icon = target === 'drone' ? 'hardware-chip' : 'airplane';

  const onPress = async () => {
    await setAppMode(target);
    const hasData = target === 'drone' ? (await getDroneFlightCount()) > 0 : (await getFlightCount()) > 0;
    if (hasData) {
      // Navigera till respektive lägets dashboard-rutt — index.tsx (manned)
      // eller drone-dashboard. Annars visar den gömda manned-ruttens guard
      // bara en tom vy efter bytet.
      router.replace(target === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)');
    } else {
      router.replace(target === 'drone' ? '/preview' : '/manned-preview');
    }
  };

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
          backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16,
          shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.35, shadowRadius: 10, elevation: 4,
        }}
      >
        <Ionicons name={icon as any} size={20} color={Colors.textInverse} />
        <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '800', letterSpacing: 0.3 }}>
          {label}
        </Text>
        <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}
