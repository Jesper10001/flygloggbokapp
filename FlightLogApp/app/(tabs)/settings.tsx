import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Switch, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { exportToCSV } from '../../services/export';
import { exportPilotPDF, type PdfTemplate } from '../../services/pdfExport/generatePDF';
import { exportDroneToCSV } from '../../services/droneExport';
import { clearAllFlights, getFlightCount } from '../../db/flights';
import { useTranslation } from '../../hooks/useTranslation';
import { useLanguageStore } from '../../store/languageStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useThemeStore } from '../../store/themeStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useToastStore } from '../../components/Toast';
import { useOperatorStore } from '../../store/operatorStore';
import { seedTestUser1, seedTestUser2, clearTestUser, seedMannedPilot1, seedMannedPilot2, clearMannedTestUser, seedOperatorCrewChief, seedOperatorSwimmer, seedOperatorHEMS, clearOperatorTestUser } from '../../services/testUserSeed';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useProfileStore, isOperator, type SubRole } from '../../store/profileStore';
import { PremiumModal } from '../../components/PremiumModal';
import { clearDroneRegistryCategories, getDroneFlightCount, listCertificates } from '../../db/drones';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { getSetting, setSetting } from '../../db/flights';
import { useVersionStore } from '../../store/versionStore';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
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
  const styles = makeSettingsStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const { timeFormat, setTimeFormat } = useTimeFormatStore();
  const { theme, setTheme } = useThemeStore();
  const { mode: appMode, setMode: setAppMode } = useAppModeStore();
  const { operatorId, setOperatorId, loadOperatorId } = useOperatorStore();
  const { loadFlights: loadDroneFlights, loadStats: loadDroneStats } = useDroneFlightStore();
  const { isPremium, isMax, setIsPremium, flightCount, loadFlights, loadStats } = useFlightStore();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const setPilotType = usePilotTypeStore((s) => s.setPilotType);
  const { standard, setStandard } = useRegulationStandardStore();
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumFeatureName, setPremiumFeatureName] = useState('');
  const isDrone = appMode === 'drone';
  const isOp = isOperator(useProfileStore.getState().profile);
  const isPilot = !isDrone && !isOp;

  // Profildata — laddas från settings-DB
  const [profileName, setProfileName] = useState('');
  const [profileInitials, setProfileInitials] = useState('');
  const [userProfile, setUserProfile] = useState('');
  const [profileCredentials, setProfileCredentials] = useState('');
  const [hasOtherModeData, setHasOtherModeData] = useState(false);
  const [certCount, setCertCount] = useState(0);
  const [certLabels, setCertLabels] = useState('');
  const [additionalProfiles, setAdditionalProfiles] = useState<Array<{ mainRole: string; subRole: string }>>([]);

  useFocusEffect(useCallback(() => {
    useRegulationStandardStore.getState().load();
    (async () => {
      const first = (await getSetting('profile_first_name')) ?? '';
      const last = (await getSetting('profile_last_name')) ?? '';
      const initials = (await getSetting('profile_initials')) ?? '';
      const creds = (await getSetting('profile_credentials')) ?? '';
      setProfileName(`${first} ${last}`.trim());
      setProfileInitials(initials || `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?');
      setProfileCredentials(creds);
      const { profile } = useProfileStore.getState();
      setUserProfile(profile ? t(`profile_${profile.subRole}` as any) : '');
      const otherHasData = isDrone
        ? (await getFlightCount()) > 0
        : (await getDroneFlightCount()) > 0;
      setHasOtherModeData(otherHasData);
      const certs = await listCertificates();
      setCertCount(certs.length);
      const labels = certs.slice(0, 3).map(c => c.cert_type).join(', ');
      setCertLabels(labels + (certs.length > 3 ? ` +${certs.length - 3}` : ''));
      // Load additional profiles
      const addJson = (await getSetting('additional_profiles')) ?? '';
      if (addJson) {
        try {
          setAdditionalProfiles(JSON.parse(addJson));
        } catch {
          setAdditionalProfiles([]);
        }
      }
    })();
  }, []));

  // ── Handlers ──

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      if (isDrone) await exportDroneToCSV();
      else {
        const standardName = standard === 'faa' ? 'FAA' : 'EASA';
        await exportToCSV(standard);
        Alert.alert(
          `${standardName} Format Exported`,
          `Your logbook has been exported in ${standardName} format.`,
          [{ text: 'OK' }]
        );
      }
    } catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExportingCSV(false); }
  };

  const handleExportPDF = () => {
    Alert.alert(
      t('pdf_layout_title'),
      t('pdf_layout_desc'),
      [
        { text: t('pdf_layout_easa'), onPress: () => runPdfExport('easa') },
        { text: t('pdf_layout_modern'), onPress: () => runPdfExport('modern') },
        { text: t('pdf_layout_editorial'), onPress: () => runPdfExport('editorial') },
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  };

  const runPdfExport = async (template: PdfTemplate) => {
    setExportingPDF(true);
    try { await exportPilotPDF(template); }
    catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExportingPDF(false); }
  };

  const handleClearAll = () => {
    Alert.alert(t('clear_all_data'), `${t('clear_all_data_message')} ${flightCount} ${t('clear_all_data_message2')}`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('clear_all'), style: 'destructive', onPress: async () => {
        await clearAllFlights();
        await useProfileStore.getState().clearProfile();
        await setSetting('profile_first_name', '');
        await setSetting('profile_last_name', '');
        await setSetting('profile_initials', '');
        await setSetting('profile_credentials', '');
        useFlightStore.getState().setIsPremium(false);
        useFlightStore.getState().setTier('free');
        router.replace('/onboarding');
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
    router.replace((target === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)/index') as any);
  };

  // ── Render ──

  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.8 }}>
          {t('settings')}
        </Text>
      </View>

      {/* ── A. Profilkort ── */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{
          backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder,
          overflow: 'hidden',
        }}>
          {/* Profil-rad */}
          <TouchableOpacity
            style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14,
              borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/profile')}
          >
            <View style={{
              width: 50, height: 50, borderRadius: 25,
              backgroundColor: isMax ? Colors.silver : (isPremium ? Colors.gold : Colors.primary),
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: isMax ? Colors.textPrimary : (isPremium ? '#1a1200' : Colors.textInverse), letterSpacing: -0.5 }}>
                {profileInitials || '?'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.2 }}>
                {profileName || t('your_name')}
              </Text>
              <Text style={{ fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>
                {certLabels || t('tap_to_edit_profile')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>

          {/* Certifikat-rad */}
          <TouchableOpacity
            style={{ paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/certificates')}
          >
            <View style={{
              width: 32, height: 32, borderRadius: 8,
              backgroundColor: Colors.success + '22', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="shield-checkmark" size={15} color={Colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textPrimary }}>{t('certificates')}</Text>
              <Text style={{ fontSize: 11, color: Colors.textMuted }}>
                {certCount > 0 ? `${certCount} ${t('certificates_count')}` : t('certificates_sub')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>

          {/* Premium */}
          <TouchableOpacity
            style={{ paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/premium')}
          >
            <View style={{
              width: 32, height: 32, borderRadius: 8,
              backgroundColor: (isMax ? Colors.silver : Colors.gold) + '22', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="star" size={15} color={isMax ? Colors.silver : Colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textPrimary }}>{isMax ? 'Blades MAX' : 'Blades Premium'}</Text>
              <Text style={{ fontSize: 11, color: Colors.textMuted }}>
                {isMax ? 'Active' : isPremium ? 'Active, upgrade to MAX?' : 'Discover all features'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

{/* ── C. Loggbok ── */}
      <SectionHeader>{t('tab_logbook') ?? 'LOGGBOK'}</SectionHeader>
      <Card>
        {/* Current logbook type */}
        <Row
          icon={isDrone ? 'hardware-chip-outline' : 'airplane-outline'}
          iconColor={Colors.primary}
          title={t('logbook_type') ?? 'Logbook Type'}
          subtitle={isDrone ? 'Drone Pilot' : appMode === 'drone' ? 'Operator' : 'Manned Aircraft'}
          pressable={false}
        />
        {isDrone && (
          <Row icon="hardware-chip-outline" iconColor={Colors.primary} title={t('manage_drones')} subtitle={t('manage_drones_sub')} onClick={() => router.push('/settings/drones')} />
        )}
        {isPilot && <Row icon="location" iconColor={Colors.info} title={t('manage_airports')} subtitle={t('add_custom_icao')} onClick={() => router.push('/settings/airport')} />}
        {isPilot && <Row icon="images-outline" iconColor={Colors.gold} title={t('flight_album')} subtitle={t('flight_album_sub')} onClick={() => router.push('/settings/album')} />}
        <Row icon="time" iconColor={Colors.primary} title={t('audit_log')} subtitle={t('all_changes_logged')} onClick={() => router.push('/settings/auditlog')} border={false} />
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
        {isPilot && <Row
          icon="camera-outline" iconColor={Colors.primary}
          title={t('import_scan_title')}
          subtitle={t('import_scan_sub')}
          right={!isPremium && !isMax ? <PremiumPill /> : undefined}
          onClick={isPremium || isMax ? () => router.push('/import/scan') : () => { setPremiumFeatureName(t('import_scan_title')); setShowPremiumModal(true); }}
        />}
        <Row
          icon="create-outline" iconColor={Colors.primary}
          title={t('import_manual_title')}
          subtitle={t('import_manual_sub')}
          onClick={() => router.push('/import/manual')}
        />
        {isPilot && <Row
          icon="scan-outline" iconColor={Colors.accent}
          title={t('scan_profile_title') ?? 'Scan Profile'}
          subtitle={t('scan_profile_sub') ?? 'Help AI read your logbook'}
          onClick={() => router.push('/settings/scan-profile')}
          border={false}
        />}
      </Card>

      {/* ── E. Data & Export ── */}
      <SectionHeader>{t('export') ?? 'DATA & EXPORT'}</SectionHeader>
      <Card>
        <Row
          icon="cloud-outline" iconColor={Colors.info}
          title={t('icloud_sync')} subtitle={t('coming_soon')}
          right={<Switch value={false} disabled trackColor={{ false: Colors.elevated, true: Colors.primary }} />}
          pressable={false}
        />
        {isPilot && <Row
          icon="document-text-outline" iconColor={Colors.primary}
          title={t('export_to_pdf')} subtitle={t('export_to_pdf_premium')}
          right={exportingPDF ? <ActivityIndicator size="small" color={Colors.primary} /> : !isPremium ? <PremiumPill /> : undefined}
          onClick={isPremium ? handleExportPDF : () => { setPremiumFeatureName(t('export_to_pdf')); setShowPremiumModal(true); }}
        />}
        <Row
          icon="cloud-upload-outline" iconColor={Colors.primary}
          title={t('export_to_csv')} subtitle={`Always free — all fields, ${standard === 'faa' ? 'FAA' : 'EASA'} format`}
          right={exportingCSV ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
          onClick={handleExportCSV}
        />
        <Row
          icon="options-outline" iconColor={Colors.primary}
          title={t('custom_csv_title')} subtitle={t('custom_csv_sub')}
          onClick={() => router.push('/settings/custom-export')}
        />
      </Card>

      {/* ── E. App ── */}
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
        <Row icon="globe-outline" iconColor={Colors.primary} title="Pilot Certification Standard" subtitle={standard === 'easa' ? 'EASA (EU)' : 'FAA (USA)'}
          right={
            <View style={styles.toggle}>
              <TouchableOpacity style={[styles.toggleBtn, standard === 'easa' && styles.toggleBtnActive]} onPress={() => setStandard('easa')} activeOpacity={0.7}>
                <Text style={[styles.toggleText, standard === 'easa' && styles.toggleTextActive]}>EASA</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.toggleBtn, standard === 'faa' && styles.toggleBtnActive]} onPress={() => setStandard('faa')} activeOpacity={0.7}>
                <Text style={[styles.toggleText, standard === 'faa' && styles.toggleTextActive]}>FAA</Text>
              </TouchableOpacity>
            </View>
          } pressable={false} border={false}
        />
      </Card>

      {/* ── G. Om ── */}
      <SectionHeader>{t('about')}</SectionHeader>
      <Card>
        <Row icon="information-circle-outline" iconColor={Colors.textSecondary} title={t('version')}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 13, color: Colors.textMuted, fontFamily: 'Menlo' }}>1.0.0</Text>
              {useVersionStore.getState().updateAvailable && (
                <View style={{ backgroundColor: Colors.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.primary }}>{t('update_available')}</Text>
                </View>
              )}
            </View>
          }
          onClick={() => {
            useVersionStore.getState().check().then(() => {
              if (useVersionStore.getState().updateAvailable) {
                Alert.alert(t('update_available'), t('update_available_sub'), [
                  { text: t('cancel'), style: 'cancel' },
                  { text: 'App Store', onPress: () => require('react-native').Linking.openURL('https://apps.apple.com') },
                ]);
              } else {
                Alert.alert(t('version'), t('version_up_to_date') ?? 'You are on the latest version.');
              }
            });
          }}
        />
        <Row icon="shield-checkmark" iconColor={Colors.textSecondary} title={t('local_storage')}
          subtitle={t('local_storage_sub')} pressable={false}
        />
        <Row icon="mail" iconColor={Colors.textSecondary} title={t('support')} subtitle="support@blades-app.com"
          onClick={() => Linking.openURL('mailto:support@blades-app.com')}
        />
        <Row icon="globe-outline" iconColor={Colors.textSecondary} title="blades-app.com"
          subtitle={t('website_sub')}
          onClick={() => Linking.openURL('https://blades-app.com')}
        />
        <Row icon="document-text-outline" iconColor={Colors.textSecondary} title={t('privacy_policy')}
          onClick={() => Linking.openURL('https://blades-app.com/privacy.html')} border={false}
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
        {/* Test users — based on current profile */}
        {isDrone && (<>
          <Row icon="flask-outline" iconColor={Colors.primary} title={`${t('test_user')} 1`} subtitle={t('test_user_1_sub')} onClick={() => applyDroneTestUser(1)} />
          <Row icon="flask-outline" iconColor={Colors.primary} title={`${t('test_user')} 2`} subtitle={t('test_user_2_sub')} onClick={() => applyDroneTestUser(2)} />
          <Row icon="refresh-outline" iconColor={Colors.danger} title={t('clear_test_user')} subtitle={t('clear_test_user_sub')} onClick={() => applyDroneTestUser('clear')} />
        </>)}
        {!isDrone && !isOperator(useProfileStore.getState().profile) && (<>
          <Row icon="flask-outline" iconColor={Colors.primary} title="Testpilot 1 — Airline" subtitle="A320, ~5500h" onClick={() => applyMannedTestUser(1)} />
          <Row icon="flask-outline" iconColor={Colors.primary} title="Testpilot 2 — Bushpilot" subtitle="B407/H125, ~3200h" onClick={() => applyMannedTestUser(2)} />
          <Row icon="refresh-outline" iconColor={Colors.danger} title={t('clear_test_user')} onClick={() => applyMannedTestUser('clear')} />
        </>)}
        {isOperator(useProfileStore.getState().profile) && (<>
          <Row icon="flask-outline" iconColor={Colors.gold} title="🎖️ Crew Chief" subtitle="HKP16/14, ~620h" onClick={async () => { await seedOperatorCrewChief(); await loadFlights(); await loadStats(); Alert.alert('OK', 'Crew Chief loaded'); }} />
          <Row icon="flask-outline" iconColor={Colors.info} title="🏊 Rescue Swimmer" subtitle="HKP16, ~280h" onClick={async () => { await seedOperatorSwimmer(); await loadFlights(); await loadStats(); Alert.alert('OK', 'Swimmer loaded'); }} />
          <Row icon="flask-outline" iconColor={Colors.danger} title="🏥 HEMS Operator" subtitle="EC135, ~340h" onClick={async () => { await seedOperatorHEMS(); await loadFlights(); await loadStats(); Alert.alert('OK', 'HEMS loaded'); }} />
          <Row icon="refresh-outline" iconColor={Colors.danger} title={t('clear_test_user')} onClick={async () => { await clearOperatorTestUser(); await loadFlights(); await loadStats(); }} />
        </>)}

        <Row icon="refresh-circle-outline" iconColor={Colors.primary} title={t('replay_onboarding')} subtitle={t('replay_onboarding_sub')}
          onClick={async () => { await setSetting('has_onboarded', '0'); router.replace('/onboarding'); }} />

        {/* Reset import quota */}
        <Row icon="checkmark-done-outline" iconColor={Colors.success} title="Reset Import Quota" subtitle="Reset CSV import counter to 0"
          onClick={async () => { await setSetting('import_used', '0'); Alert.alert('OK', 'Import quota reset'); }} />

        {/* Switch logbook (dev only) */}
        {additionalProfiles.length > 0 && (
          <Row icon="swap-horizontal-outline" iconColor={Colors.info} title="Switch Logbook" subtitle="Dev: switch without onboarding"
            onClick={() => {
              // Group profiles by mainRole and subRole
              const grouped = additionalProfiles.reduce((acc, profile) => {
                const key = profile.mainRole;
                if (!acc[key]) acc[key] = [];
                acc[key].push(profile);
                return acc;
              }, {} as Record<string, typeof additionalProfiles>);

              // Define category structure with subcategories
              const categoryMap: Record<string, { label: string; subcategories?: Record<string, string[]> }> = {
                'pilot-manned': {
                  label: '✈️ Pilot (Manned)',
                  subcategories: {
                    'rotary': ['Rotary (Helicopter)'],
                    'fixed': ['Fixed Wing (Airplane)']
                  }
                },
                'operator': {
                  label: '🛡️ Operator'
                },
                'pilot-unmanned': {
                  label: '🚁 Pilot (Unmanned)',
                  subcategories: {
                    'military': ['Military'],
                    'commercial': ['Commercial']
                  }
                }
              };

              // Show main category selection
              const categoryOptions = [
                { text: 'Cancel', onPress: () => {} },
                ...Object.entries(categoryMap)
                  .filter(([key]) => grouped[key])
                  .map(([key, cat]) => ({
                    text: cat.label,
                    onPress: () => {
                      const mainRole = key as any;
                      const profiles = grouped[mainRole];

                      // If no subcategories, show profiles directly
                      if (!cat.subcategories) {
                        const options = [
                          { text: 'Back', onPress: () => {} },
                          ...profiles.map((profile) => ({
                            text: profile.subRole.charAt(0).toUpperCase() + profile.subRole.slice(1),
                            onPress: async () => {
                              await useProfileStore.getState().setProfile({ mainRole, subRole: profile.subRole as SubRole });
                              const isDrn = mainRole === 'pilot-unmanned';
                              await switchMode(isDrn ? 'drone' : 'manned');
                            }
                          }))
                        ];
                        Alert.alert('Switch Logbook', `Choose ${cat.label.split(' ').slice(1).join(' ')}:`, options);
                      } else {
                        // Show subcategory selection
                        const subCatOptions = [
                          { text: 'Back', onPress: () => {} },
                          ...Object.keys(cat.subcategories)
                            .filter(subKey => profiles.some(p => p.subRole === subKey))
                            .map((subKey) => ({
                              text: cat.subcategories![subKey][0],
                              onPress: () => {
                                // Show profiles for this subcategory
                                const subRoleProfiles = profiles.filter(p => p.subRole === subKey);
                                const profileOptions = [
                                  { text: 'Back', onPress: () => {} },
                                  ...subRoleProfiles.map((profile) => ({
                                    text: profile.subRole.charAt(0).toUpperCase() + profile.subRole.slice(1),
                                    onPress: async () => {
                                      await useProfileStore.getState().setProfile({ mainRole, subRole: profile.subRole as SubRole });
                                      const isDrn = mainRole === 'pilot-unmanned';
                                      await switchMode(isDrn ? 'drone' : 'manned');
                                    }
                                  }))
                                ];
                                Alert.alert('Switch Logbook', 'Choose profile:', profileOptions);
                              }
                            }))
                        ];
                        Alert.alert('Switch Logbook', `Choose type:`, subCatOptions);
                      }
                    }
                  }))
              ];
              Alert.alert('Switch Logbook', 'Choose category:', categoryOptions);
            }}
          />
        )}

        {/* Rensa data */}
        <Row icon="trash" iconColor={Colors.danger} title={t('clear_all_logbook_data')} subtitle={t('clear_all_sub')} onClick={handleClearAll} border={false} />
      </Card>


      {isPremium && (
        <TouchableOpacity
          style={{
            marginHorizontal: 20, marginTop: 16, paddingVertical: 14,
            borderRadius: 12, alignItems: 'center',
            backgroundColor: Colors.danger + '12',
            borderWidth: 1, borderColor: Colors.danger + '33',
          }}
          onPress={() => {
            Alert.alert(
              t('cancel_premium_title'),
              t('cancel_premium_body'),
              [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('cancel_premium_confirm'),
                  style: 'destructive',
                  onPress: () => {
                    setIsPremium(false);
                    Alert.alert(t('cancel_premium_done_title'), t('cancel_premium_done_body'));
                  },
                },
              ],
            );
          }}
          activeOpacity={0.75}
        >
          <Text style={{ color: Colors.danger, fontSize: 13, fontWeight: '600' }}>
            {t('cancel_premium_btn')}
          </Text>
        </TouchableOpacity>
      )}

      <PremiumModal visible={showPremiumModal} onClose={() => setShowPremiumModal(false)} feature={premiumFeatureName} />
    </ScrollView>
  );
}

// ── Switch mode-knapp ──────────────────────────────────────────────────────


// ── Styles ──────────────────────────────────────────────────────────────────

function makeSettingsStyles() { return StyleSheet.create({
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
}); }
