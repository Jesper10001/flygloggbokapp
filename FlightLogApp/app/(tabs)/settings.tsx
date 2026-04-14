import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { exportToCSV, exportToPDF } from '../../services/export';
import { clearAllFlights } from '../../db/flights';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useThemeStore } from '../../store/themeStore';

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
    },
    langBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
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
  const { isPremium, setIsPremium, flightCount, loadFlights, loadStats } = useFlightStore();
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      await exportToCSV();
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
              <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>EN</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === 'sv' && styles.langBtnActive]}
              onPress={() => setLanguage('sv')}
              activeOpacity={0.7}
            >
              <Text style={[styles.langBtnText, language === 'sv' && styles.langBtnTextActive]}>SV</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Divider */}
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
            <Text style={styles.settingsLabel}>Time format</Text>
            <Text style={styles.settingsSub}>Dashboard always shows HH:MM</Text>
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
      </View>

      {/* Database & traceability */}
      <Text style={styles.sectionTitle}>{t('database_traceability')}</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="location"
          label={t('manage_airports')}
          sub={t('add_custom_icao')}
          onPress={() => router.push('/settings/airport')}
        />
        <SettingsRow
          icon="time"
          label={t('audit_log')}
          sub={t('all_changes_logged')}
          onPress={() => router.push('/settings/auditlog')}
        />
      </View>

      {/* Troubleshooting */}
      <Text style={styles.sectionTitle}>{t('troubleshooting')}</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="trash"
          label={t('clear_all_logbook_data')}
          sub={t('clear_all_sub')}
          onPress={handleClearAll}
          danger
        />
      </View>

      {/* About */}
      <Text style={styles.sectionTitle}>{t('about')}</Text>
      <View style={styles.card}>
        <SettingsRow icon="information-circle" label="Tailwind" sub="Version 1.0.0 · EASA FCL.050" />
        <SettingsRow icon="shield-checkmark" label="Local data storage" sub="All data on your device — nothing in the cloud without your permission" />
        <SettingsRow
          icon="mail"
          label="Support"
          sub="support@flightlogpro.se"
          onPress={() => Alert.alert(t('support_alert_title'), t('support_alert_message'))}
        />
      </View>
    </ScrollView>
  );
}
