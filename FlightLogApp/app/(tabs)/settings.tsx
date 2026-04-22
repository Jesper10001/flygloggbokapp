import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { exportToCSV, exportToPDF } from '../../services/export';
import { exportDroneToCSV } from '../../services/droneExport';
import { clearAllFlights, getFlightCount } from '../../db/flights';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useThemeStore } from '../../store/themeStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useToastStore } from '../../components/Toast';
import { useOperatorStore } from '../../store/operatorStore';
import { seedTestUser1, seedTestUser2, clearTestUser, seedMannedPilot1, seedMannedPilot2, clearMannedTestUser } from '../../services/testUserSeed';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { PremiumModal } from '../../components/PremiumModal';
import { clearDroneRegistryCategories, getDroneFlightCount } from '../../db/drones';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { getSetting, setSetting } from '../../db/flights';

// ── Design components (från Claude Design handoff) ─────────────────────────

function SectionHeader({ children }: { children: string }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
      <Text style={{
        fontSize: 11, fontWeight: '700', color: Colors.textMuted,
        letterSpacing: 0.9, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
    </View>
  );
}

function Card({ children, padding = 0 }: { children: React.ReactNode; padding?: number }) {
  return (
    <View style={{
      backgroundColor: Colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
      padding,
      marginHorizontal: 20,
      overflow: 'hidden',
    }}>
      {children}
    </View>
  );
}

function Row({
  icon, iconColor, iconBg, title, subtitle, right, onClick, border = true, pressable = true,
}: {
  icon: string;
  iconColor?: string;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  border?: boolean;
  pressable?: boolean;
}) {
  const content = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14,
      borderBottomWidth: border ? 0.5 : 0, borderBottomColor: Colors.separator,
    }}>
      {iconBg ? (
        <View style={{
          width: 32, height: 32, borderRadius: 8,
          backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name={icon as any} size={16} color={iconColor ?? Colors.textPrimary} />
        </View>
      ) : (
        <Ionicons name={icon as any} size={18} color={iconColor ?? Colors.textPrimary} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right ?? (onClick ? <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} /> : null)}
    </View>
  );

  if (!pressable || !onClick) return content;
  return <TouchableOpacity onPress={onClick} activeOpacity={0.7}>{content}</TouchableOpacity>;
}

function PremiumPill() {
  return (
    <View style={{
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
      backgroundColor: Colors.gold + '25',
    }}>
      <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>
        Premium
      </Text>
    </View>
  );
}

// ── Huvudskärm ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { timeFormat, setTimeFormat } = useTimeFormatStore();
  const { theme, setTheme } = useThemeStore();
  const { mode: appMode, setMode: setAppMode } = useAppModeStore();
  const { operatorId, setOperatorId, loadOperatorId } = useOperatorStore();
  const { loadFlights: loadDroneFlights, loadStats: loadDroneStats } = useDroneFlightStore();
  const { isPremium, setIsPremium, flightCount, loadFlights, loadStats } = useFlightStore();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const setPilotType = usePilotTypeStore((s) => s.setPilotType);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumFeatureName, setPremiumFeatureName] = useState('');
  const isDrone = appMode === 'drone';

  // Profildata — laddas från settings-DB
  const [profileName, setProfileName] = useState('');
  const [profileInitials, setProfileInitials] = useState('');
  const [profileCredentials, setProfileCredentials] = useState('');

  useFocusEffect(useCallback(() => {
    (async () => {
      const first = (await getSetting('profile_first_name')) ?? '';
      const last = (await getSetting('profile_last_name')) ?? '';
      const initials = (await getSetting('profile_initials')) ?? '';
      const creds = (await getSetting('profile_credentials')) ?? '';
      setProfileName(`${first} ${last}`.trim());
      setProfileInitials(initials || `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?');
      setProfileCredentials(creds);
    })();
  }, []));

  // ── Handlers ──

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      if (isDrone) await exportDroneToCSV();
      else await exportToCSV();
    } catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExportingCSV(false); }
  };

  const handleExportPDF = async () => {
    setExportingPDF(true);
    try { await exportToPDF(); }
    catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExportingPDF(false); }
  };

  const handleClearAll = () => {
    Alert.alert(t('clear_all_data'), `${t('clear_all_data_message')} ${flightCount} ${t('clear_all_data_message2')}`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('clear_all'), style: 'destructive', onPress: async () => {
        await clearAllFlights();
        await Promise.all([loadFlights(), loadStats()]);
        Alert.alert(t('done'), t('all_deleted'));
      }},
    ]);
  };

  const applyDroneTestUser = (which: 1 | 2 | 'clear') => {
    const label = which === 'clear' ? t('clear_test_user') : `${t('test_user')} ${which}`;
    Alert.alert(label, t('test_user_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('apply'), style: 'destructive', onPress: async () => {
        try {
          if (which === 1) { await seedTestUser1(); await setTheme('drone-industrial'); }
          else if (which === 2) { await seedTestUser2(); await setTheme('drone-neon'); }
          else { await clearTestUser(); }
          await loadOperatorId(); await loadDroneFlights(); await loadDroneStats();
          useToastStore.getState().show(label);
        } catch (e: any) { Alert.alert(t('error'), e.message); }
      }},
    ]);
  };

  const applyMannedTestUser = (which: 1 | 2 | 'clear') => {
    const label = which === 'clear' ? t('clear_test_user') : `Manned ${t('test_user')} ${which}`;
    Alert.alert(label, t('test_user_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('apply'), style: 'destructive', onPress: async () => {
        try {
          if (which === 1) { await seedMannedPilot1(); }
          else if (which === 2) { await seedMannedPilot2(); }
          else { await clearMannedTestUser(); }
          await Promise.all([loadFlights(), loadStats()]);
          useToastStore.getState().show(label);
        } catch (e: any) { Alert.alert(t('error'), e.message); }
      }},
    ]);
  };

  const switchPilotType = (next: 'commercial' | 'military') => {
    if (next === pilotType) return;
    Alert.alert(t('pilot_type_switch_title'), t('pilot_type_switch_body'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('pilot_type_switch_confirm'), onPress: async () => {
        await clearDroneRegistryCategories();
        await setPilotType(next);
        router.push('/settings/drones');
      }},
    ]);
  };

  const switchMode = async (target: 'manned' | 'drone') => {
    await setAppMode(target);
    const hasData = target === 'drone' ? (await getDroneFlightCount()) > 0 : (await getFlightCount()) > 0;
    if (hasData) router.replace(target === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)');
    else router.replace(target === 'drone' ? '/preview' : '/manned-preview');
  };

  // ── Render ──

  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.8 }}>
          {t('settings')}
        </Text>
      </View>

      {/* ── A. Profilkort ── */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <TouchableOpacity
          style={{
            backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder,
            padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
          }}
          activeOpacity={0.7}
          onPress={() => router.push('/settings/profile')}
        >
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: Colors.primary,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.textInverse, letterSpacing: -0.5 }}>
              {profileInitials || '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.2 }}>
              {profileName || t('your_name')}
            </Text>
            <Text style={{ fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>
              {profileCredentials || t('tap_to_edit_profile')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* ── B. Läge ── */}
      <SectionHeader>{t('app_mode') ?? 'LÄGE'}</SectionHeader>
      <Card>
        <Row
          icon="airplane" iconColor={Colors.primary} iconBg={Colors.primary + '25'}
          title={t('mode_manned')} subtitle="Hkp & flygplan"
          right={appMode === 'manned' ? <Ionicons name="checkmark" size={16} color={Colors.success} /> : undefined}
          onClick={() => { if (appMode !== 'manned') switchMode('manned'); }}
        />
        <Row
          icon="hardware-chip" iconColor={Colors.warning} iconBg={Colors.warning + '25'}
          title={t('mode_drone')} subtitle="UAS open & specific"
          right={appMode === 'drone' ? <Ionicons name="checkmark" size={16} color={Colors.success} /> : undefined}
          onClick={() => { if (appMode !== 'drone') switchMode('drone'); }}
          border={false}
        />
      </Card>

      {/* ── C. Loggbok ── */}
      <SectionHeader>{t('tab_logbook') ?? 'LOGGBOK'}</SectionHeader>
      <Card>
        <Row icon="book-outline" iconColor={Colors.primary} title={t('physical_logbooks')} subtitle={t('physical_logbooks_sub')} onClick={() => router.push('/settings/logbook-books')} />
        {!isDrone && (
          <Row icon="airplane-outline" iconColor={Colors.primary} title={t('saved_airframes')} subtitle={t('manage_airports_sub') ?? 'Sparade farkoster'} onClick={() => router.push('/(tabs)/log')} />
        )}
        {isDrone && (
          <Row icon="hardware-chip-outline" iconColor={Colors.primary} title={t('manage_drones')} subtitle={t('manage_drones_sub')} onClick={() => router.push('/settings/drones')} />
        )}
        <Row icon="shield-checkmark-outline" iconColor={Colors.success} title={t('certificates')} subtitle={t('certificates_sub')} onClick={() => router.push('/settings/certificates')} />
        <Row icon="location" iconColor={Colors.info} title={t('manage_airports')} subtitle={t('add_custom_icao')} onClick={() => router.push('/settings/airport')} border={false} />
      </Card>

      {/* ── D. Import ── */}
      <SectionHeader>{t('import_section') ?? 'IMPORT'}</SectionHeader>
      <Card>
        <Row
          icon="document-attach-outline" iconColor={Colors.primary}
          title={t('import_csv_title')}
          subtitle={t('import_csv_sub')}
          onClick={() => router.push('/import')}
        />
        <Row
          icon="camera-outline" iconColor={Colors.primary}
          title={t('import_scan_title')}
          subtitle={t('import_scan_sub')}
          right={!isPremium ? <PremiumPill /> : undefined}
          onClick={() => router.push('/import/scan')}
        />
        <Row
          icon="create-outline" iconColor={Colors.primary}
          title={t('import_manual_title')}
          subtitle={t('import_manual_sub')}
          onClick={() => router.push('/import/manual')}
          border={false}
        />
      </Card>

      {/* ── E. Data & Export ── */}
      <SectionHeader>{t('export') ?? 'DATA & EXPORT'}</SectionHeader>
      <Card>
        <Row
          icon="cloud-outline" iconColor={Colors.info}
          title="iCloud-sync" subtitle={t('coming_soon')}
          right={<Switch value={false} disabled trackColor={{ false: Colors.elevated, true: Colors.primary }} />}
          pressable={false}
        />
        <Row
          icon="document-text-outline" iconColor={Colors.primary}
          title={t('export_to_pdf')} subtitle={isPremium ? t('export_to_pdf_premium') : t('export_to_pdf_locked')}
          right={!isPremium ? <PremiumPill /> : exportingPDF ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
          onClick={isPremium ? handleExportPDF : () => { setPremiumFeatureName(t('prem_feat_pdf_title')); setShowPremiumModal(true); }}
        />
        <Row
          icon="cloud-upload-outline" iconColor={Colors.primary}
          title={t('export_to_csv')} subtitle={t('export_to_csv_sub')}
          right={exportingCSV ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
          onClick={handleExportCSV}
        />
        <Row icon="time" iconColor={Colors.primary} title={t('audit_log')} subtitle={t('all_changes_logged')} onClick={() => router.push('/settings/auditlog')} border={false} />
      </Card>

      {/* ── E. Premium ── */}
      <SectionHeader>PREMIUM</SectionHeader>
      <Card>
        <Row
          icon="star-outline" iconColor={Colors.gold} iconBg={Colors.gold + '25'}
          title={t('tailwind_premium')}
          subtitle={isPremium ? t('all_features_unlocked') : t('premium_sub')}
          right={isPremium ? <Ionicons name="checkmark-circle" size={18} color={Colors.success} /> : undefined}
          onClick={() => {
            if (!isPremium) Alert.alert(t('premium_alert_title'), t('premium_alert_message'), [
              { text: t('cancel'), style: 'cancel' },
              { text: t('enable_test'), onPress: () => setIsPremium(true) },
            ]);
          }}
          border={false}
        />
      </Card>

      {/* ── F. App ── */}
      <SectionHeader>{t('app_section')}</SectionHeader>
      <Card>
        <Row icon="language" iconColor={Colors.primary} title={t('language')} subtitle={language === 'sv' ? 'Svenska' : 'English'}
          right={
            <View style={styles.toggle}>
              <TouchableOpacity style={[styles.toggleBtn, language === 'en' && styles.toggleBtnActive]} onPress={() => setLanguage('en')} activeOpacity={0.7}>
                <Text style={[styles.toggleText, language === 'en' && styles.toggleTextActive]}>ENG</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.toggleBtn, language === 'sv' && styles.toggleBtnActive]} onPress={() => setLanguage('sv')} activeOpacity={0.7}>
                <Text style={[styles.toggleText, language === 'sv' && styles.toggleTextActive]}>SWE</Text>
              </TouchableOpacity>
            </View>
          } pressable={false}
        />
        <Row icon="contrast-outline" iconColor={Colors.primary} title={t('theme')} subtitle={t('theme_sub')}
          right={
            <View style={styles.toggle}>
              {appMode === 'manned' ? (<>
                <TouchableOpacity style={[styles.toggleBtn, theme === 'navy' && styles.toggleBtnActive]} onPress={() => setTheme('navy')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, theme === 'navy' && styles.toggleTextActive]}>{t('theme_navy')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, theme === 'bright' && styles.toggleBtnActive]} onPress={() => setTheme('bright')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, theme === 'bright' && styles.toggleTextActive]}>{t('theme_bright')}</Text>
                </TouchableOpacity>
              </>) : (<>
                <TouchableOpacity style={[styles.toggleBtn, theme === 'drone-industrial' && styles.toggleBtnActive]} onPress={() => setTheme('drone-industrial')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, theme === 'drone-industrial' && styles.toggleTextActive]}>{t('theme_matt')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, theme === 'drone-neon' && styles.toggleBtnActive]} onPress={() => setTheme('drone-neon')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, theme === 'drone-neon' && styles.toggleTextActive]}>{t('theme_neon')}</Text>
                </TouchableOpacity>
              </>)}
            </View>
          } pressable={false}
        />
        <Row icon="time-outline" iconColor={Colors.primary} title={t('time_format')} subtitle={t('time_format_sub')}
          right={
            <View style={styles.toggle}>
              <TouchableOpacity style={[styles.toggleBtn, timeFormat === 'decimal' && styles.toggleBtnActive]} onPress={() => setTimeFormat('decimal')} activeOpacity={0.7}>
                <Text style={[styles.toggleText, timeFormat === 'decimal' && styles.toggleTextActive]}>1.5</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.toggleBtn, timeFormat === 'hhmm' && styles.toggleBtnActive]} onPress={() => setTimeFormat('hhmm')} activeOpacity={0.7}>
                <Text style={[styles.toggleText, timeFormat === 'hhmm' && styles.toggleTextActive]}>1:30</Text>
              </TouchableOpacity>
            </View>
          } pressable={false} border={false}
        />
      </Card>

      {/* ── G. Om ── */}
      <SectionHeader>{t('about')}</SectionHeader>
      <Card>
        <Row icon="information-circle-outline" iconColor={Colors.textSecondary} title="Version"
          right={<Text style={{ fontSize: 13, color: Colors.textMuted }}>1.0.0</Text>} pressable={false}
        />
        <Row icon="shield-checkmark" iconColor={Colors.textSecondary} title="Local data storage"
          subtitle="All data on your device" pressable={false}
        />
        <Row icon="mail" iconColor={Colors.textSecondary} title="Support" subtitle="support@flightlogpro.se"
          onClick={() => Alert.alert(t('support_alert_title'), t('support_alert_message'))} border={false}
        />
      </Card>

      {/* ── H. Utvecklare ── */}
      <SectionHeader>{t('developer_section')}</SectionHeader>
      <Card>
        <Row icon="star" iconColor={Colors.gold}
          title="Premium"
          subtitle={isPremium ? 'Active' : 'Inactive'}
          right={<Switch value={isPremium} onValueChange={setIsPremium} trackColor={{ false: Colors.elevated, true: Colors.primary }} />}
          pressable={false}
        />
        {/* Pilottyp (drone only) */}
        {isDrone && (
          <Row icon="ribbon-outline" iconColor={Colors.primary}
            title={t('pilot_type')}
            subtitle={pilotType === 'military' ? t('pilot_type_military_sub') : t('pilot_type_commercial_sub')}
            right={
              <View style={styles.toggle}>
                <TouchableOpacity style={[styles.toggleBtn, pilotType === 'commercial' && styles.toggleBtnActive]} onPress={() => switchPilotType('commercial')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, pilotType === 'commercial' && styles.toggleTextActive]}>{t('pilot_type_commercial')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, pilotType === 'military' && styles.toggleBtnActive]} onPress={() => switchPilotType('military')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, pilotType === 'military' && styles.toggleTextActive]}>{t('pilot_type_military')}</Text>
                </TouchableOpacity>
              </View>
            } pressable={false}
          />
        )}

        {/* Drone test users */}
        {isDrone && (<>
          <Row icon="flask-outline" iconColor={Colors.primary} title={`${t('test_user')} 1`} subtitle={t('test_user_1_sub')} onClick={() => applyDroneTestUser(1)} />
          <Row icon="flask-outline" iconColor={Colors.primary} title={`${t('test_user')} 2`} subtitle={t('test_user_2_sub')} onClick={() => applyDroneTestUser(2)} />
          <Row icon="refresh-outline" iconColor={Colors.danger} title={t('clear_test_user')} subtitle={t('clear_test_user_sub')} onClick={() => applyDroneTestUser('clear')} />
        </>)}

        {/* Manned test users */}
        {!isDrone && (<>
          <Row icon="flask-outline" iconColor={Colors.primary} title="Testpilot 1 — Airline" subtitle="A320, kommersiell, ~5500h" onClick={() => applyMannedTestUser(1)} />
          <Row icon="flask-outline" iconColor={Colors.primary} title="Testpilot 2 — Bushpilot" subtitle="B407/H125, NVG, ~3200h" onClick={() => applyMannedTestUser(2)} />
          <Row icon="refresh-outline" iconColor={Colors.danger} title={t('clear_test_user')} subtitle="Rensa manned testdata" onClick={() => applyMannedTestUser('clear')} />
        </>)}

        {/* Rundtur */}
        <Row icon="compass-outline" iconColor={Colors.primary} title={t('replay_tour')} subtitle={t('replay_tour_sub')}
          onClick={() => router.push(isDrone ? '/preview' : '/manned-preview')} />

        {/* Rensa data */}
        <Row icon="trash" iconColor={Colors.danger} title={t('clear_all_logbook_data')} subtitle={t('clear_all_sub')} onClick={handleClearAll} border={false} />
      </Card>

      {/* ── I. Byt loggbok ── */}
      <SwitchModeButton appMode={appMode} setAppMode={setAppMode} />

      <PremiumModal visible={showPremiumModal} onClose={() => setShowPremiumModal(false)} feature={premiumFeatureName} />
    </ScrollView>
  );
}

// ── Switch mode-knapp ──────────────────────────────────────────────────────

function SwitchModeButton({ appMode, setAppMode }: { appMode: 'manned' | 'drone'; setAppMode: (m: 'manned' | 'drone') => Promise<void> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const target: 'manned' | 'drone' = appMode === 'manned' ? 'drone' : 'manned';
  const label = target === 'drone' ? t('switch_to_drone_logbook') : t('switch_to_manned_logbook');
  const icon = target === 'drone' ? 'hardware-chip' : 'airplane';

  const onPress = async () => {
    await setAppMode(target);
    const hasData = target === 'drone' ? (await getDroneFlightCount()) > 0 : (await getFlightCount()) > 0;
    if (hasData) router.replace(target === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)');
    else router.replace(target === 'drone' ? '/preview' : '/manned-preview');
  };

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 }}>
      <TouchableOpacity
        onPress={onPress} activeOpacity={0.85}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
          backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16,
          shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.35, shadowRadius: 10, elevation: 4,
        }}
      >
        <Ionicons name={icon as any} size={20} color={Colors.textInverse} />
        <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '800', letterSpacing: 0.3 }}>{label}</Text>
        <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row', backgroundColor: Colors.elevated,
    borderRadius: 8, padding: 3, gap: 3,
    borderWidth: 0.5, borderColor: Colors.border, width: 150,
  },
  toggleBtn: {
    flex: 1, paddingVertical: 6, paddingHorizontal: 4,
    borderRadius: 6, alignItems: 'center', justifyContent: 'center',
  },
  toggleBtnActive: { backgroundColor: Colors.primary },
  toggleText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  toggleTextActive: { color: Colors.textInverse },
});
