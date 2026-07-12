import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  Alert, ActivityIndicator, TextInput, Switch, Linking, LayoutAnimation, Modal, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { exportToCSV, exportOperatorCSV } from '../../services/export';
import { exportPilotPDF, type PdfTemplate } from '../../services/pdfExport/generatePDF';
import { exportLogbookPages, getLogbookSpreadCount } from '../../services/logbook/exportPages';
import { exportDroneToCSV } from '../../services/droneExport';
import { clearAllFlights, getFlightCount } from '../../db/flights';
import { useTranslation } from '../../hooks/useTranslation';
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

function Card({
  children,
  padding = 0,
  backgroundColor = Colors.card,
  borderColor = Colors.cardBorder,
}: {
  children: React.ReactNode;
  padding?: number;
  backgroundColor?: string;
  borderColor?: string;
}) {
  return (
    <View style={{
      backgroundColor,
      borderRadius: 16,
      borderWidth: 1,
      borderColor,
      padding,
      marginHorizontal: 20,
      overflow: 'hidden',
    }}>
      {children}
    </View>
  );
}

function Row({
  icon, iconColor, iconBg, title, subtitle, right, onClick, border = true, pressable = true, separatorColor = Colors.separator,
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
  separatorColor?: string;
}) {
  const content = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14,
      borderBottomWidth: border ? 0.5 : 0, borderBottomColor: separatorColor,
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

function CollapsibleSectionHeader({
  children,
  expanded,
  onPress,
}: {
  children: string;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 20,
        marginTop: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: Colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Colors.cardBorder,
      }}
    >
      <Text style={{
        flex: 1,
        fontSize: 12, fontWeight: '700', color: expanded ? Colors.gold : Colors.textPrimary,
        letterSpacing: 0.8, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
      <Ionicons
        name={expanded ? 'chevron-down' : 'chevron-forward'}
        size={16}
        color={expanded ? Colors.gold : Colors.primary}
        style={{ marginLeft: 8 }}
      />
    </TouchableOpacity>
  );
}

// ── Huvudskärm ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const styles = makeSettingsStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const { timeFormat, setTimeFormat } = useTimeFormatStore();
  const { theme, setTheme } = useThemeStore();
  const { mode: appMode, setMode: setAppMode } = useAppModeStore();
  const { operatorId, setOperatorId, loadOperatorId } = useOperatorStore();
  const { loadFlights: loadDroneFlights, loadStats: loadDroneStats } = useDroneFlightStore();
  const { isPremium, isMax, setIsPremium, flightCount, loadFlights, loadStats } = useFlightStore();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const setPilotType = usePilotTypeStore((s) => s.setPilotType);
  const { standard, setStandard } = useRegulationStandardStore();
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [exportingPages, setExportingPages] = useState(false);
  const [pagesModal, setPagesModal] = useState(false);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [pagesChoice, setPagesChoice] = useState<number | 'custom'>(3);
  const [pagesCustom, setPagesCustom] = useState('');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumFeatureName, setPremiumFeatureName] = useState('');
  const [expandedSection, setExpandedSection] = useState<'logbook' | 'import' | 'export' | 'app' | null>(null);
  const [showLogbookTypeModal, setShowLogbookTypeModal] = useState(false);
  const isDrone = appMode === 'drone';
  const isOp = isOperator(profile);
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
  const [wrappedUnlocked, setWrappedUnlocked] = useState(false);

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
      setWrappedUnlocked((await getSetting('wrapped_unlocked')) === '1');
    })();
  }, []));

  // ── Handlers ──

  const toggleSection = (section: 'logbook' | 'import' | 'export' | 'app') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      if (isDrone) await exportDroneToCSV();
      else if (isOp) {
        await exportOperatorCSV();
        Alert.alert(t('export_to_csv'), 'Operator log exported.', [{ text: 'OK' }]);
      }
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

  const openPagesExport = async () => {
    try {
      const total = await getLogbookSpreadCount();
      if (total === 0) { Alert.alert(t('export_logbook_pages'), t('dlb_export_empty')); return; }
      setPagesTotal(total);
      setPagesChoice(total < 3 ? 'custom' : 3);
      setPagesCustom(String(total));
      setPagesModal(true);
    } catch (e: any) { Alert.alert(t('export_failed'), e.message); }
  };
  const runPagesExport = async () => {
    const raw = pagesChoice === 'custom' ? parseInt(pagesCustom || '0', 10) : pagesChoice;
    const count = Math.max(1, Math.min(raw || 1, pagesTotal || 1));
    setPagesModal(false);
    setExportingPages(true);
    try { await exportLogbookPages(count); }
    catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExportingPages(false); }
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
        await setSetting('additional_profiles', '');
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

  const switchPilotType = async (next: 'commercial' | 'military' | 'hobby') => {
    if (next === pilotType) return;
    await setPilotType(next);
  };

  const switchMode = async (target: 'manned' | 'drone') => {
    await setAppMode(target);
    router.replace((target === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)/index') as any);
  };

  const switchProfile = async (mainRole: 'pilot-manned' | 'pilot-unmanned' | 'operator', subRole: SubRole) => {
    // Save current profile to additional_profiles before switching
    if (profile) {
      // Remove any existing profile from the same mainRole to ensure only one per category
      const currentProfiles = additionalProfiles.filter(
        p => p.mainRole !== profile.mainRole
      );
      const newAdditional = [...currentProfiles, { mainRole: profile.mainRole, subRole: profile.subRole }];
      await setSetting('additional_profiles', JSON.stringify(newAdditional));
      setAdditionalProfiles(newAdditional);
    }

    // Switch to new profile and mode before navigating
    setShowLogbookTypeModal(false);
    await setProfile({ mainRole, subRole });
    const targetMode = mainRole === 'pilot-unmanned' ? 'drone' : 'manned';
    await setAppMode(targetMode);

    // Navigate to tabs container (layout will render correct dashboard based on mode)
    router.replace('/(tabs)' as any);
  };

  // ── Render ──

  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.8 }}>
          {t('tab_settings')}
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

          {/* Current today? — currency/recency */}
          <TouchableOpacity
            style={{ paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            activeOpacity={0.7}
            onPress={() => router.push('/currency')}
          >
            <View style={{
              width: 32, height: 32, borderRadius: 8,
              backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="today" size={15} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textPrimary }}>Current today?</Text>
              <Text style={{ fontSize: 11, color: Colors.textMuted }}>Passenger, night, IFR, medical & rating currency</Text>
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

      {/* ── B. Wrapped (låses upp efter import; endast bemannad pilot) ── */}
      {profile?.mainRole === 'pilot-manned' && wrappedUnlocked && (
        <View style={{ paddingHorizontal: 20, paddingVertical: 6 }}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/wrapped')}>
            <LinearGradient
              colors={[Colors.primary + '2E', Colors.card, Colors.card]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 18, borderWidth: 1, borderColor: Colors.primary + '66',
                paddingVertical: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden',
              }}
            >
              <Image source={require('../../assets/blades-mark.png')} style={{ width: 38, height: 40 }} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Fraunces', fontSize: 18, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.3 }}>
                  Logbook Wrapped
                </Text>
                <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 11.5, fontWeight: '600', letterSpacing: 0.3, color: Colors.primary, marginTop: 5 }}>
                  Your flight history - A journey
                </Text>
              </View>
              <Ionicons name="sparkles" size={18} color={Colors.primary} />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

{/* ── C. Loggbok ── */}
      <CollapsibleSectionHeader expanded={expandedSection === 'logbook'} onPress={() => toggleSection('logbook')}>
        {t('tab_logbook') ?? 'LOGBOOK'}
      </CollapsibleSectionHeader>
      {expandedSection === 'logbook' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
          {/* Current logbook type */}
          <Row
            icon={isDrone ? 'hardware-chip-outline' : 'airplane-outline'}
            iconColor={Colors.primary}
            title={t('logbook_type') ?? 'Logbook Type'}
            subtitle={isDrone ? 'Pilot Unmanned Aircraft' : isOp ? 'Operator Manned Aircraft' : 'Pilot Manned Aircraft'}
            pressable={false}
            separatorColor={Colors.background}
          />

          {/* Logbook type selector */}
          <View style={{ paddingHorizontal: 16, paddingTop: 0, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.background }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 30 }}>
              {/* Current profile button */}
              {!isDrone && !isOp && (
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                    backgroundColor: Colors.primary,
                    borderWidth: 1,
                    borderColor: Colors.primary,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: Colors.textInverse,
                  }}>
                    Pilot fixed/rotary
                  </Text>
                </TouchableOpacity>
              )}
              {isDrone && (
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                    backgroundColor: Colors.primary,
                    borderWidth: 1,
                    borderColor: Colors.primary,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: Colors.textInverse,
                  }}>
                    Drone
                  </Text>
                </TouchableOpacity>
              )}
              {isOp && (
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                    backgroundColor: Colors.primary,
                    borderWidth: 1,
                    borderColor: Colors.primary,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: Colors.textInverse,
                  }}>
                    Operator
                  </Text>
                </TouchableOpacity>
              )}

              {/* Additional profile buttons - only show profiles from different categories */}
              {additionalProfiles
                .filter(p => p.mainRole !== profile?.mainRole)
                .map((p) => (
                  <TouchableOpacity
                    key={`${p.mainRole}-${p.subRole}`}
                    onPress={() => switchProfile(p.mainRole as any, p.subRole as any)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: Colors.elevated,
                      borderWidth: 1,
                      borderColor: Colors.border,
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: Colors.textPrimary,
                    }}>
                      {p.mainRole === 'pilot-unmanned' ? 'Drone' : p.mainRole === 'operator' ? 'Operator' : 'Pilot fixed/rotary'}
                    </Text>
                  </TouchableOpacity>
                ))}

              {/* Add button - show to add missing profile types */}
              {!additionalProfiles.some(p => p.mainRole === 'pilot-unmanned') || !additionalProfiles.some(p => p.mainRole === 'operator') || !additionalProfiles.some(p => p.mainRole === 'pilot-manned') ? (
                <TouchableOpacity
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: Colors.elevated,
                    borderWidth: 1,
                    borderColor: Colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  activeOpacity={0.75}
                  onPress={() => setShowLogbookTypeModal(true)}
                >
                  <Ionicons name="add" size={18} color={Colors.primary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Operator role selector */}
          {isOperator(profile) && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.background }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Ionicons name="person-outline" size={18} color={Colors.primary} />
                <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>
                  {t('operator_role')}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 30 }}>
                {(['crew-chief', 'swimmer', 'hoist', 'hems', 'loadmaster'] as SubRole[]).map((role) => (
                  <TouchableOpacity
                    key={role}
                    onPress={() => profile && setProfile({ ...profile, subRole: role })}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: profile?.subRole === role ? Colors.primary : Colors.elevated,
                      borderWidth: 1,
                      borderColor: profile?.subRole === role ? Colors.primary : Colors.border,
                    }}
                  >
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: profile?.subRole === role ? Colors.textInverse : Colors.textPrimary,
                      textTransform: 'capitalize',
                    }}>
                      {role === 'crew-chief' ? 'Crew Chief' : role === 'swimmer' ? 'Rescue Swimmer' : role.charAt(0).toUpperCase() + role.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Drone pilot type selector */}
          {isDrone && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: Colors.background }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Ionicons name="layers-outline" size={18} color={Colors.primary} />
                <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>
                  {t('pilot_type_title') ?? 'Pilot Type'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 30 }}>
                {(['commercial', 'military', 'hobby'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => switchPilotType(type)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: pilotType === type ? Colors.primary : Colors.elevated,
                      borderWidth: 1,
                      borderColor: pilotType === type ? Colors.primary : Colors.border,
                    }}
                  >
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: pilotType === type ? Colors.textInverse : Colors.textPrimary,
                      textTransform: 'capitalize',
                    }}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {isDrone && (
            <Row icon="hardware-chip-outline" iconColor={Colors.primary} title={t('manage_drones')} subtitle={t('manage_drones_sub')} onClick={() => router.push('/settings/drones')} separatorColor={Colors.background} />
          )}
          {isPilot && <Row icon="location" iconColor={Colors.info} title={t('manage_airports')} subtitle={t('add_custom_icao')} onClick={() => router.push('/settings/airport')} separatorColor={Colors.background} />}
          {isPilot && <Row icon="images-outline" iconColor={Colors.gold} title={t('flight_album')} subtitle={t('flight_album_sub')} onClick={() => router.push('/settings/album')} separatorColor={Colors.background} />}
          <Row icon="time" iconColor={Colors.primary} title={t('audit_log')} subtitle={t('all_changes_logged')} onClick={() => router.push('/settings/auditlog')} border={false} separatorColor={Colors.background} />
        </Card>
      )}

      {/* ── D. Import ── */}
      <CollapsibleSectionHeader expanded={expandedSection === 'import'} onPress={() => toggleSection('import')}>
        {t('import_section') ?? 'IMPORT'}
      </CollapsibleSectionHeader>
      {expandedSection === 'import' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
          <Row
            icon="document-attach-outline" iconColor={Colors.primary}
            title={t('import_csv_title')}
            subtitle={t('import_csv_sub')}
            onClick={() => router.push('/import')}
            separatorColor={Colors.background}
          />
          {isPilot && <Row
            icon="camera-outline" iconColor={Colors.primary}
            title={t('import_scan_title')}
            subtitle={t('import_scan_sub')}
            right={!isPremium && !isMax ? <PremiumPill /> : undefined}
            onClick={isPremium || isMax ? () => router.push('/import/scan') : () => { setPremiumFeatureName(t('import_scan_title')); setShowPremiumModal(true); }}
            separatorColor={Colors.background}
          />}
          <Row
            icon="create-outline" iconColor={Colors.primary}
            title={t('import_manual_title')}
            subtitle={t('import_manual_sub')}
            onClick={() => router.push('/import/manual')}
            separatorColor={Colors.background}
          />
          <Row
            icon="folder-open-outline" iconColor={Colors.primary}
            title="Imported data"
            subtitle="Review and delete your imports"
            onClick={() => router.push('/import/history')}
            border={false}
            separatorColor={Colors.background}
          />
        </Card>
      )}

      {/* ── E. Data & Export ── */}
      <CollapsibleSectionHeader expanded={expandedSection === 'export'} onPress={() => toggleSection('export')}>
        {t('export') ?? 'DATA & EXPORT'}
      </CollapsibleSectionHeader>
      {expandedSection === 'export' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
          <Row
            icon="cloud-outline" iconColor={Colors.info}
            title={t('icloud_sync')} subtitle={t('coming_soon')}
            right={<Switch value={false} disabled trackColor={{ false: Colors.elevated, true: Colors.primary }} />}
            pressable={false}
            separatorColor={Colors.background}
          />
          {isPilot && <Row
            icon="document-text-outline" iconColor={Colors.primary}
            title={t('export_to_pdf')} subtitle={t('export_to_pdf_premium')}
            right={exportingPDF ? <ActivityIndicator size="small" color={Colors.primary} /> : !isPremium ? <PremiumPill /> : undefined}
            onClick={isPremium ? handleExportPDF : () => { setPremiumFeatureName(t('export_to_pdf')); setShowPremiumModal(true); }}
            separatorColor={Colors.background}
          />}
          {isPilot && <Row
            icon="book-outline" iconColor={Colors.primary}
            title={t('export_logbook_pages')} subtitle={t('export_logbook_pages_sub')}
            right={exportingPages ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
            onClick={openPagesExport}
            separatorColor={Colors.background}
          />}
          <Row
            icon="cloud-upload-outline" iconColor={Colors.primary}
            title={t('export_to_csv')} subtitle={`Always free — all fields, ${standard === 'faa' ? 'FAA' : 'EASA'} format`}
            right={exportingCSV ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
            onClick={handleExportCSV}
            separatorColor={Colors.background}
          />
          <Row
            icon="options-outline" iconColor={Colors.primary}
            title={t('custom_csv_title')} subtitle={t('custom_csv_sub')}
            onClick={() => router.push('/settings/custom-export')}
            separatorColor={Colors.background}
          />
        </Card>
      )}

      {/* ── F. App ── */}
      <CollapsibleSectionHeader expanded={expandedSection === 'app'} onPress={() => toggleSection('app')}>
        {t('app_section')}
      </CollapsibleSectionHeader>
      {expandedSection === 'app' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
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
            separatorColor={Colors.background}
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
            } pressable={false}
            separatorColor={Colors.background}
          />
          {isPilot && <Row icon="globe-outline" iconColor={Colors.primary} title="Pilot Certification Standard" subtitle={standard === 'easa' ? 'EASA (EU)' : standard === 'faa' ? 'FAA (USA)' : 'CAA (UK)'}
            right={
              <View style={styles.toggle}>
                <TouchableOpacity style={[styles.toggleBtn, standard === 'easa' && styles.toggleBtnActive]} onPress={() => setStandard('easa')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, standard === 'easa' && styles.toggleTextActive]}>EASA</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, standard === 'faa' && styles.toggleBtnActive]} onPress={() => setStandard('faa')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, standard === 'faa' && styles.toggleTextActive]}>FAA</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, standard === 'caa' && styles.toggleBtnActive]} onPress={() => setStandard('caa')} activeOpacity={0.7}>
                  <Text style={[styles.toggleText, standard === 'caa' && styles.toggleTextActive]}>CAA</Text>
                </TouchableOpacity>
              </View>
            } pressable={false} border={false}
            separatorColor={Colors.background}
          />}
        </Card>
      )}

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
          <Row icon="flask-outline" iconColor={Colors.primary} title="Test pilot 1 — Airline" subtitle="A320, ~5500h" onClick={() => applyMannedTestUser(1)} />
          <Row icon="flask-outline" iconColor={Colors.primary} title="Test pilot 2 — Bushpilot" subtitle="B407/H125, ~3200h" onClick={() => applyMannedTestUser(2)} />
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

      {/* ── Export logbook pages: välj antal siduppslag ── */}
      <Modal visible={pagesModal} transparent animationType="fade" onRequestClose={() => setPagesModal(false)}>
        <Pressable
          onPress={() => setPagesModal(false)}
          style={{ flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <Pressable
            onPress={() => {}}
            style={{ width: '100%', maxWidth: 440, backgroundColor: Colors.surface, borderRadius: 18, padding: 20, gap: 14 }}
          >
            <Text style={{ color: Colors.textPrimary, fontSize: 18, fontWeight: '800' }}>{t('export_logbook_pages')}</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 13, lineHeight: 19 }}>{t('dlb_export_choose')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[3, 5, 10].map((n) => {
                const active = pagesChoice === n;
                return (
                  <TouchableOpacity
                    key={n} onPress={() => setPagesChoice(n)} activeOpacity={0.8}
                    style={{
                      minWidth: 56, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center',
                      backgroundColor: active ? Colors.primary : Colors.elevated,
                      borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '800', color: active ? Colors.textInverse : Colors.textPrimary }}>{n}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => setPagesChoice('custom')} activeOpacity={0.8}
                style={{
                  flex: 1, minWidth: 90, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center',
                  backgroundColor: pagesChoice === 'custom' ? Colors.primary : Colors.elevated,
                  borderWidth: 1, borderColor: pagesChoice === 'custom' ? Colors.primary : Colors.border,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: pagesChoice === 'custom' ? Colors.textInverse : Colors.textPrimary }}>{t('dlb_export_custom')}</Text>
              </TouchableOpacity>
            </View>
            {pagesChoice === 'custom' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TextInput
                  value={pagesCustom}
                  onChangeText={(v) => setPagesCustom(v.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  placeholder={String(pagesTotal)}
                  placeholderTextColor={Colors.textMuted}
                  style={{ width: 90, backgroundColor: Colors.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: Colors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: Colors.border, textAlign: 'center' }}
                />
                <Text style={{ color: Colors.textMuted, fontSize: 13 }}>{t('dlb_export_max')} {pagesTotal}</Text>
              </View>
            )}
            <Text style={{ color: Colors.textMuted, fontSize: 12, lineHeight: 17 }}>{t('dlb_export_note')}</Text>
            <TouchableOpacity
              onPress={runPagesExport} activeOpacity={0.85}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15 }}
            >
              <Ionicons name="share-outline" size={18} color={Colors.textInverse} />
              <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '800' }}>{t('dlb_export_btn')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Logbook Type Modal */}
      <Modal visible={showLogbookTypeModal} transparent animationType="slide" onRequestClose={() => setShowLogbookTypeModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' }} onPress={() => setShowLogbookTypeModal(false)}>
          <Pressable style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 32, borderTopWidth: 0.5, borderTopColor: Colors.border }} onPress={(e) => e.stopPropagation()}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 10 }} />
            <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 14, letterSpacing: 0.3 }}>
              {t('switch_profile') ?? 'Switch Profile'}
            </Text>

            <View style={{ gap: 8 }}>
              {/* Available profiles to add - only show if not already added */}
              {!additionalProfiles.some(p => p.mainRole === 'pilot-unmanned') && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder }}
                  onPress={() => switchProfile('pilot-unmanned', 'commercial')}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Drone</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Pilot Unmanned Aircraft</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}

              {!additionalProfiles.some(p => p.mainRole === 'operator') && !isDrone && !isOp && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder }}
                  onPress={() => switchProfile('operator', 'crew-chief')}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Operator</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Operator Manned Aircraft</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}

              {!additionalProfiles.some(p => p.mainRole === 'pilot-manned') && isDrone && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder }}
                  onPress={() => switchProfile('pilot-manned', 'fixed')}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Pilot fixed/rotary</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Pilot Manned Aircraft</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}

              {!additionalProfiles.some(p => p.mainRole === 'operator') && isDrone && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder }}
                  onPress={() => switchProfile('operator', 'crew-chief')}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Operator</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Operator Manned Aircraft</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}

              {!additionalProfiles.some(p => p.mainRole === 'pilot-manned') && isOp && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder }}
                  onPress={() => switchProfile('pilot-manned', 'fixed')}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Pilot fixed/rotary</Text>
                    <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 2 }}>Pilot Manned Aircraft</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}

            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
