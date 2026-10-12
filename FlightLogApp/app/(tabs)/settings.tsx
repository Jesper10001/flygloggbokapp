import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  Alert, ActivityIndicator, TextInput, Switch, Linking, LayoutAnimation, Modal, Pressable, AppState,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import * as Application from 'expo-application';
import { useFlightStore } from '../../store/flightStore';
import { useTokenQuotaStore } from '../../store/tokenQuotaStore';
import { tokensToCoins } from '../../utils/tokenGate';
import { Colors } from '../../constants/colors';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { exportToCSV } from '../../services/export';
import { exportPilotPDF, type PdfTemplate } from '../../services/pdfExport/generatePDF';
import { exportLogbookPages, getLogbookSpreadCount } from '../../services/logbook/exportPages';
import { exportDroneToCSV } from '../../services/droneExport';
import { getFlightCount } from '../../db/flights';
import { listDigitalBooks } from '../../db/digitalBooks';
import { useTranslation } from '../../hooks/useTranslation';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useThemeStore } from '../../store/themeStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useTourStore, beginTour } from '../../store/tourStore';
import { TourPress } from '../../components/TourPress';
import { useToastStore } from '../../components/Toast';
import { seedMannedPilot1, seedMannedPilot2, seedMannedPilot3, clearMannedTestUser } from '../../services/testUserSeed';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useProfileStore, type SubRole } from '../../store/profileStore';
import { PremiumModal } from '../../components/PremiumModal';
import { presentPaywall, refreshEntitlement, presentManageSubscription } from '../../services/purchases';
import { redeemPromo } from '../../services/promo';
import { clearDroneRegistryCategories, getDroneFlightCount, listCertificates } from '../../db/drones';
import { getSetting, setSetting } from '../../db/flights';
import { SignatureView, type SignatureData } from '../../components/SignaturePad';
import { ModeToggleRow } from '../../components/settings/ModeToggleRow';
import { useVersionStore } from '../../store/versionStore';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
import { ICloudSyncRow } from '../../components/settings/ICloudSyncRow';
import { useAppLockStore } from '../../store/appLockStore';
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
  icon, iconColor, iconBg, title, subtitle, right, onClick, onLongPress, border = true, pressable = true, separatorColor = Colors.separator, tourPressId,
}: {
  icon: string;
  iconColor?: string;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  onLongPress?: () => void;
  border?: boolean;
  pressable?: boolean;
  separatorColor?: string;
  tourPressId?: string; // Blades introduction: tänder cyan tryck-markering när rundturen pekar hit
}) {
  const content = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14,
      borderBottomWidth: border ? 0.5 : 0, borderBottomColor: separatorColor,
    }}>
      {tourPressId ? <TourPress id={tourPressId} radius={0} /> : null}
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

  if ((!pressable || !onClick) && !onLongPress) return content;
  return <TouchableOpacity onPress={onClick} onLongPress={onLongPress} delayLongPress={600} activeOpacity={0.7}>{content}</TouchableOpacity>;
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
  tourPressId,
  right,
}: {
  children: string;
  expanded: boolean;
  onPress: () => void;
  tourPressId?: string; // Blades introduction: cyan tryck-markering när rundturen pekar hit
  right?: React.ReactNode; // valfritt innehåll till höger om etiketten (t.ex. app-version på ABOUT)
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
      {tourPressId ? <TourPress id={tourPressId} radius={12} /> : null}
      <Text style={{
        flex: 1,
        fontSize: 12, fontWeight: '700', color: expanded ? Colors.gold : Colors.textPrimary,
        letterSpacing: 0.8, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
      {right != null ? <View style={{ marginLeft: 8 }}>{right}</View> : null}
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
  const { isPremium, isMax, flightCount, manualFlightCount, loadFlights, loadStats, setIsPremium } = useFlightStore();
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
  const [pagesChoice, setPagesChoice] = useState<number | 'whole' | 'custom'>(3);
  const [pagesCustom, setPagesCustom] = useState('');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumFeatureName, setPremiumFeatureName] = useState('');
  const [stdOpen, setStdOpen] = useState(false); // regelverks-dropdown (EASA/FAA/CAA/Other)
  const [expandedSection, setExpandedSection] = useState<'logbook' | 'import' | 'export' | 'app' | 'about' | null>(null);
  const [locGranted, setLocGranted] = useState(false);
  const [showCoinInfo, setShowCoinInfo] = useState(false);
  const appLockEnabled = useAppLockStore((s) => s.enabled);
  const appLockAvailable = useAppLockStore((s) => s.available);
  // Uppdaterings-koll: prenumerera REAKTIVT (så About-badgen dyker upp när App Store-kollen är klar) och
  // kör check() vid fokus (nedan). check() slår mot Apples publika lookup och är strypt till max 1/min.
  const updateAvailable = useVersionStore((s) => s.updateAvailable);
  const appVersion = Application.nativeApplicationVersion ?? '1.0.0';
  // Öppna en viss sektion via param (t.ex. från "Manage app data" → "Export first").
  const { expand } = useLocalSearchParams<{ expand?: string }>();
  // Scrolla fram sektionen när den öppnas via param (bl.a. Blades introduction → Import/App).
  const scrollRef = useRef<ScrollView>(null);
  const importSectionY = useRef(0);
  const appSectionY = useRef(0);
  useEffect(() => {
    if (expand === 'export' || expand === 'app' || expand === 'logbook' || expand === 'import') {
      setExpandedSection(expand);
      const y = expand === 'import' ? importSectionY.current : expand === 'app' ? appSectionY.current : 0;
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }), 360);
    } else {
      // Ingen sektion vald (rundturens settings-översikt) → börja högst upp.
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 120);
    }
  }, [expand]);
  // Pilot↔drönare-byte ska ge en REN settings-vy: kollapsa alla sektioner när läget ändras medan sidan
  // ligger kvar monterad (bevarat tab-state). Ref-skydd → körs ej vid första mount (så deep-link-`expand`
  // ovan inte skrivs över).
  const prevAppMode = useRef(appMode);
  useEffect(() => {
    if (prevAppMode.current !== appMode) { prevAppMode.current = appMode; setExpandedSection(null); }
  }, [appMode]);
  const isDrone = appMode === 'drone';
  const isPilot = !isDrone;

  // Profildata — laddas från settings-DB
  const [profileName, setProfileName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null); // pilotsignatur → visas till höger i profilkortet
  const [profileInitials, setProfileInitials] = useState('');
  const [userProfile, setUserProfile] = useState('');
  const [profileCredentials, setProfileCredentials] = useState('');
  const [hasOtherModeData, setHasOtherModeData] = useState(false);
  const [certCount, setCertCount] = useState(0);
  const [certLabels, setCertLabels] = useState('');
  const [additionalProfiles, setAdditionalProfiles] = useState<Array<{ mainRole: string; subRole: string }>>([]);
  // AI-tokenförbrukning (delad store — samma siffra som gate-kollarna i övriga appen)
  const tokenUsage = useTokenQuotaStore((s) => s.usage);

  useFocusEffect(useCallback(() => {
    useRegulationStandardStore.getState().load();
    useTokenQuotaStore.getState().load();
    useFlightStore.getState().loadFlights();
    useVersionStore.getState().check().catch(() => {}); // App Store-koll (strypt 1/min) → About-badge

    Location.getForegroundPermissionsAsync().then((p) => setLocGranted(p.granted)).catch(() => {});
    (async () => {
      const first = (await getSetting('profile_first_name')) ?? '';
      const last = (await getSetting('profile_last_name')) ?? '';
      const initials = (await getSetting('profile_initials')) ?? '';
      const creds = (await getSetting('profile_credentials')) ?? '';
      setProfileName(`${first} ${last}`.trim());
      setProfileInitials(initials || `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?');
      setProfileCredentials(creds);
      try { const sg = await getSetting('pilot_signature'); setSignature(sg ? JSON.parse(sg) : null); } catch { setSignature(null); }
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

  // Platstillstånd ändras i iOS-inställningar (utanför appen) → uppdatera togglen när appen blir aktiv igen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        Location.getForegroundPermissionsAsync().then((p) => setLocGranted(p.granted)).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // ── Handlers ──

  const toggleSection = (section: 'logbook' | 'import' | 'export' | 'app' | 'about') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection(expandedSection === section ? null : section);
  };

  // App-lås (Face ID): påslag verifierar biometrik + kräver en lyckad auth innan det aktiveras.
  const toggleAppLock = async (next: boolean) => {
    if (next && !appLockAvailable) {
      Alert.alert('Face ID unavailable', 'Set up Face ID or Touch ID for your device, then try again.');
      return;
    }
    await useAppLockStore.getState().setEnabled(next);
  };

  // Platstillstånd kan inte slås av inifrån appen (iOS) → begär vid påslag, annars/vid avslag → Inställningar.
  const toggleLocation = async (next: boolean) => {
    try {
      if (next) {
        const cur = await Location.getForegroundPermissionsAsync();
        if (cur.granted) { setLocGranted(true); return; }
        if (cur.canAskAgain) {
          const r = await Location.requestForegroundPermissionsAsync();
          if (r.granted) { setLocGranted(true); return; }
        }
        Linking.openSettings();
      } else {
        Linking.openSettings();
      }
    } catch { /* ignore */ }
  };

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      if (isDrone) await exportDroneToCSV();
      else {
        await exportToCSV(standard === 'other' ? 'easa' : standard); // 'other' → EASA-format i CSV
        Alert.alert(
          'Logbook Exported',
          'Your logbook has been exported as a CSV file with all your data.',
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
      setPagesChoice(total < 3 ? 'whole' : 3);
      setPagesCustom(String(total));
      setPagesModal(true);
    } catch (e: any) { Alert.alert(t('export_failed'), e.message); }
  };
  // Exporterar antingen ett antal uppslag (3/5/10/custom, aktiv bok) eller HELA en vald bok.
  const doPagesExport = async (mode: number | 'whole', bookId?: number) => {
    setExportingPages(true);
    try {
      const total = await getLogbookSpreadCount(bookId);
      if (total === 0) { Alert.alert(t('export_logbook_pages'), t('dlb_export_empty')); return; }
      const count = mode === 'whole' ? total : Math.max(1, Math.min(mode, total));
      await exportLogbookPages(count, bookId);
    } catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExportingPages(false); }
  };
  const runPagesExport = async () => {
    setPagesModal(false);
    if (pagesChoice === 'whole') {
      // Hela loggboken → fråga VILKEN bok bara om det finns flera i appen.
      const books = await listDigitalBooks().catch(() => []);
      if (books.length > 1) {
        Alert.alert(t('export_logbook_pages'), 'Which logbook do you want to export?', [
          ...books.map((b) => ({ text: b.name || `Logbook ${b.id}`, onPress: () => doPagesExport('whole', b.id) })),
          { text: t('cancel'), style: 'cancel' as const },
        ]);
      } else {
        doPagesExport('whole', books[0]?.id);
      }
      return;
    }
    const raw = pagesChoice === 'custom' ? parseInt(pagesCustom || '0', 10) : pagesChoice;
    doPagesExport(Math.max(1, raw || 1));
  };

  const applyMannedTestUser = (which: 1 | 2 | 3 | 'clear') => {
    const label = which === 'clear' ? 'Clear test data' : which === 1 ? 'Airline pilot (SAS)' : which === 2 ? 'HEMS pilot' : 'Student pilot (CPL)';
    const msg = which === 'clear' ? 'Remove all logbook data?' : 'This replaces all current logbook data with the demo profile. Continue?';
    Alert.alert(label, msg, [
      { text: t('cancel'), style: 'cancel' },
      { text: which === 'clear' ? 'Clear' : 'Load', style: 'destructive', onPress: async () => {
        try {
          if (which === 1) { await seedMannedPilot1(); }
          else if (which === 2) { await seedMannedPilot2(); }
          else if (which === 3) { await seedMannedPilot3(); }
          else { await clearMannedTestUser(); }
          await useProfileStore.getState().load();
          if (which !== 'clear') { await setAppMode('manned'); }
          await Promise.all([loadFlights(), loadStats()]);
          useToastStore.getState().show(which === 'clear' ? 'Test data cleared' : `${label} loaded`);
          if (which !== 'clear') requestAnimationFrame(() => router.replace('/(tabs)'));
        } catch (e: any) { Alert.alert(t('error'), e.message); }
      }},
    ]);
  };

  // Dold trigger (långtryck på versionsnumret i About) → ladda demo-profiler. Developer-sektionen är borttagen.
  const openDevMenu = () => {
    Alert.alert('Test profiles', 'Replace all logbook data with a demo pilot profile.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Airline pilot (SAS)', onPress: () => applyMannedTestUser(1) },
      { text: 'HEMS pilot', onPress: () => applyMannedTestUser(2) },
      { text: 'Student pilot (CPL)', onPress: () => applyMannedTestUser(3) },
      { text: 'Clear logbook data', style: 'destructive', onPress: () => applyMannedTestUser('clear') },
    ]);
  };

  const switchPilotType = async (next: 'commercial' | 'military' | 'hobby') => {
    if (next === pilotType) return;
    await setPilotType(next);
  };

  const switchMode = async (target: 'manned' | 'drone') => {
    await setAppMode(target);
    // Navigera EXPLICIT till respektive dashboard, EFTER att layouten re-renderat/remountat
    // (rAF). '/(tabs)' löser sig annars till ankaret 'index' som är href:null i drönarläge → svart.
    const dest = target === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)';
    requestAnimationFrame(() => router.replace(dest as any));
  };

  const switchProfile = async (mainRole: 'pilot-manned' | 'pilot-unmanned', subRole: SubRole) => {
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
    await setProfile({ mainRole, subRole });
    const targetMode = mainRole === 'pilot-unmanned' ? 'drone' : 'manned';
    await setAppMode(targetMode);

    // Stanna kvar på SETTINGS i det nya läget (lättare skärm än dashboarden → mjukare byte; och
    // href:null-ankaret undviks genom att navigera explicit till rätt settings-route).
    const dest = targetMode === 'drone' ? '/(tabs)/drone-settings' : '/(tabs)/settings';
    requestAnimationFrame(() => router.replace(dest as any));
  };

  // ── Render ──

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.8 }}>
          {t('tab_settings')}
        </Text>
      </View>

      {/* ── A. Profilkort ── */}
      {/* Profil + Blades Premium — design "D" (handoff): profilkort + slank guld-strip, gap 10. */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 10 }}>
        {/* Profil-rad (kort) — nedbantad till ~samma storlek som Blades Premium-stripen (höjd/radie/padding),
            men BEHÅLLER "PROFILE" + namn staplade till vänster och signaturen till höger. */}
        <TouchableOpacity
          style={{ height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Profile, ${profileName || t('your_name')}`}
          onPress={() => router.push('/settings/profile')}
        >
          {signature ? (
            // Med signatur: "PROFILE" + namn staplade till vänster, signaturen till höger.
            <>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase', color: Colors.textSecondary }}>
                  Profile
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary, marginTop: 2 }} numberOfLines={1}>
                  {profileName || t('your_name')}
                </Text>
              </View>
              <View style={{ maxWidth: 110, overflow: 'hidden', alignItems: 'flex-end' }}>
                <SignatureView data={signature} height={26} color={Colors.textSecondary} />
              </View>
            </>
          ) : (
            // Utan signatur: "PROFILE" till vänster, namnet till höger (fyller signaturens plats).
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase', color: Colors.textSecondary }}>
                Profile
              </Text>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary, textAlign: 'right' }} numberOfLines={1}>
                {profileName || t('your_name')}
              </Text>
            </>
          )}
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </TouchableOpacity>

        {/* Blades Premium — slank guld-strip (status som text, ingen pill/ikon) */}
        <LinearGradient
          colors={['rgba(255,184,48,0.14)', 'rgba(255,184,48,0.03)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,184,48,0.30)', overflow: 'hidden' }}
        >
          <TouchableOpacity
            style={{ height: 52, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Blades Premium, ${isPremium || isMax ? 'Active' : 'Upgrade'}`}
            onPress={() => {
              if (isPremium || isMax) {
                presentManageSubscription().then((ok) => { if (!ok) router.push('/settings/premium'); });
              } else {
                presentPaywall();
              }
            }}
          >
            <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase', color: Colors.gold }}>
              Blades Premium
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '500', fontFamily: 'Menlo', color: '#C9B07A' }}>
              {isPremium || isMax ? 'Active' : 'Upgrade'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.gold} />
          </TouchableOpacity>
        </LinearGradient>
      </View>

      {/* ── Blade-coins-mätare: förbrukning (server-räknad per device, visad som coins) ── */}
      {tokenUsage && (() => {
        // Handoff B2: 64px mynt till vänster, segmenterad mätare, visar KVARVARANDE coins (ej förbrukade).
        const usedCoins = tokensToCoins(tokenUsage.used);
        const limitCoins = tokensToCoins(tokenUsage.limit);
        const leftCoins = Math.max(0, limitCoins - usedCoins);
        const leftPct = limitCoins > 0 ? leftCoins / limitCoins : 0; // 0..1
        const CELLS = 10;
        const fill = leftPct * CELLS;
        const full = Math.floor(fill);         // helt fyllda celler
        const partial = fill - full;           // 0..1 → delvis fylld nästa cell
        const empty = leftCoins <= 0;
        const low = !empty && leftPct <= 0.10; // ≤10 % kvar → bärnstensgul varning
        const countColor = empty ? '#7F98B2' : low ? Colors.gold : '#00C8E8';
        const gFull = (low ? ['#FFD27A', '#FFB830'] : ['#7DF2FF', '#00B4D8']) as [string, string];
        const partColor = low ? '#FFB830' : '#1CD8F5';
        const isFree = tokenUsage.month === 'lifetime';
        return (
          <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Image source={require('../../assets/Blade_coin.PNG')} style={{ width: 64, height: 64 }} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                {/* Topprad: etikett + hjälp | kvarvarande / tak */}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>Blade-coins</Text>
                    <TouchableOpacity onPress={() => setShowCoinInfo(true)} hitSlop={8} activeOpacity={0.7}>
                      <Ionicons name="help-circle-outline" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontFamily: 'Menlo', fontSize: 15, fontWeight: '700' }}>
                    <Text style={{ color: countColor }}>{leftCoins.toLocaleString('en-US')}</Text>
                    <Text style={{ color: '#56708C', fontWeight: '500' }}> / {limitCoins.toLocaleString('en-US')}</Text>
                  </Text>
                </View>
                {/* Segmenterad mätare (10 celler) */}
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 10, marginBottom: 6 }}>
                  {Array.from({ length: CELLS }).map((_, i) => {
                    const isFull = i < full;
                    const isPart = i === full && partial > 0;
                    return (
                      <View key={i} style={{ flex: 1, height: 8, borderRadius: 2, backgroundColor: '#1A2D45' }}>
                        {isFull ? (
                          <LinearGradient colors={gFull} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                            style={{ flex: 1, borderRadius: 2, shadowColor: '#00D6FF', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
                        ) : isPart ? (
                          <View style={{ width: `${Math.max(10, Math.round(partial * 100))}%`, height: '100%', borderRadius: 2, backgroundColor: partColor }} />
                        ) : null}
                      </View>
                    );
                  })}
                </View>
                {/* Bildtext */}
                <Text style={{ fontSize: 12, color: Colors.textMuted }}>
                  {isFree
                    ? 'Free one-time Blade-coins · upgrade for a monthly refill'
                    : 'Left this month · refills monthly'}
                </Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* ── Fria flygningar-mätare: manuellt loggade flygningar mot gratisgränsen (importerade räknas ej).
          Döljs helt för premium/MAX — där är flygningar obegränsade, så mätaren fyller ingen funktion. ── */}
      {(() => {
        if (isPremium || isMax) return null;
        const used = manualFlightCount;
        const limit = FREE_TIER_LIMIT;
        const left = Math.max(0, limit - used);
        const pct = isPremium ? 100 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
        return (
          <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
            <View style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: Colors.textSecondary }}>Flights logged</Text>
                <Text style={{ fontSize: 12, color: Colors.textSecondary, fontFamily: 'Menlo', fontWeight: '600' }}>
                  {isPremium ? `${used} · ∞` : `${used} / ${limit}`}
                </Text>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: Colors.elevated, overflow: 'hidden' }}>
                <View style={{ height: 4, borderRadius: 2, width: `${pct}%`, backgroundColor: Colors.textMuted }} />
              </View>
              <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>
                {isPremium
                  ? 'Premium · unlimited flights'
                  : `${left} more you can add for free`}
              </Text>
            </View>
          </View>
        );
      })()}

      {/* Logbook Wrapped flyttad till Insights (mellan Hours bank och Experience & projections). */}

{/* ── C. Loggbok ── */}
      <CollapsibleSectionHeader expanded={expandedSection === 'logbook'} onPress={() => toggleSection('logbook')}>
        General
      </CollapsibleSectionHeader>
      {expandedSection === 'logbook' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
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
          <Row icon="time" iconColor={Colors.primary} title={t('audit_log')} subtitle={t('all_changes_logged')} onClick={() => router.push('/settings/auditlog')} separatorColor={Colors.background} />

          {/* Preferenser (flyttade hit från App security) */}
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
          {isPilot && (
            <>
              <Row icon="globe-outline" iconColor={Colors.primary} title="Pilot Certification Standard"
                subtitle={standard === 'easa' ? 'EASA (EU)' : standard === 'faa' ? 'FAA (USA)' : standard === 'caa' ? 'CAA (UK)' : 'Other'}
                right={<Ionicons name={stdOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.primary} />}
                onClick={() => setStdOpen((o) => !o)} border={false} separatorColor={Colors.background}
              />
              {stdOpen && (
                <View style={styles.stdOptions}>
                  {([['easa', 'EASA · EU'], ['faa', 'FAA · USA'], ['caa', 'CAA · UK'], ['other', 'Other']] as const).map(([k, label], i) => (
                    <TouchableOpacity key={k} onPress={() => { setStandard(k); setStdOpen(false); }} activeOpacity={0.7}
                      style={[styles.stdOption, i > 0 && { borderTopWidth: 1, borderTopColor: Colors.separator }]}>
                      <Text style={[styles.stdOptionText, standard === k && { color: Colors.primary, fontWeight: '700' }]}>{label}</Text>
                      {standard === k ? <Ionicons name="checkmark" size={16} color={Colors.primary} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </Card>
      )}

      {/* ── D. Import ── */}
      <View onLayout={(e) => { importSectionY.current = e.nativeEvent.layout.y; }}>
        <CollapsibleSectionHeader expanded={expandedSection === 'import'} onPress={() => toggleSection('import')} tourPressId="import-section">
          {t('import_section') ?? 'IMPORT'}
        </CollapsibleSectionHeader>
      </View>
      {expandedSection === 'import' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
          <Row
            icon="document-attach-outline" iconColor={Colors.primary}
            title={t('import_csv_title')}
            subtitle={t('import_csv_sub')}
            onClick={() => router.push('/import')}
            separatorColor={Colors.background}
          />
          {/* Scan logbook images — pausad inför lansering, visas som "coming soon". */}
          {isPilot && <Row
            icon="camera-outline" iconColor={Colors.textMuted}
            title={t('import_scan_title')}
            subtitle={t('coming_soon')}
            right={<Text style={styles.soonPill}>SOON</Text>}
            pressable={false}
            separatorColor={Colors.background}
          />}
          <Row
            icon="create-outline" iconColor={Colors.primary}
            title={t('import_manual_title')}
            subtitle={t('import_manual_sub')}
            onClick={() => router.push('/import/manual')}
            separatorColor={Colors.background}
            tourPressId="import-manual"
          />
          <Row
            icon="folder-open-outline" iconColor={Colors.primary}
            title="Imported data"
            subtitle="Review and delete your imports"
            onClick={() => router.push('/import/history')}
            border={false}
            separatorColor={Colors.background}
            tourPressId="import-history"
          />
        </Card>
      )}

      {/* ── E. Data & Export ── */}
      <CollapsibleSectionHeader expanded={expandedSection === 'export'} onPress={() => toggleSection('export')}>
        {t('export') ?? 'DATA & EXPORT'}
      </CollapsibleSectionHeader>
      {expandedSection === 'export' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
          {/* Export to PDF — pausad inför lansering, visas som "coming soon". */}
          {isPilot && <Row
            icon="document-text-outline" iconColor={Colors.textMuted}
            title={t('export_to_pdf')} subtitle={t('coming_soon')}
            right={<Text style={styles.soonPill}>SOON</Text>}
            pressable={false}
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
            title={t('export_to_csv')} subtitle="All of your data, Blades format"
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

      {/* ── F. App security ── */}
      <View onLayout={(e) => { appSectionY.current = e.nativeEvent.layout.y; }}>
        <CollapsibleSectionHeader expanded={expandedSection === 'app'} onPress={() => toggleSection('app')}>
          Security
        </CollapsibleSectionHeader>
      </View>
      {expandedSection === 'app' && (
        <Card backgroundColor={Colors.background} borderColor={Colors.background}>
          {/* Säkerhetsposter direkt (ingen extra Security-dropdown). */}
          <Row icon="finger-print-outline" iconColor={Colors.primary} title="Require Face ID to open"
            subtitle={appLockAvailable ? (appLockEnabled ? 'On · Face ID required to open the app' : 'Off') : 'Set up Face ID / Touch ID to enable'}
            right={<Switch value={appLockEnabled} disabled={!appLockAvailable} onValueChange={toggleAppLock} trackColor={{ false: Colors.elevated, true: Colors.primary }} />}
            pressable={false}
            separatorColor={Colors.background}
          />
          <Row icon="location-outline" iconColor={Colors.primary} title="Allow app to show my position"
            subtitle={locGranted ? 'On' : 'Off · used to find nearby airports'}
            right={<Switch value={locGranted} onValueChange={toggleLocation} trackColor={{ false: Colors.elevated, true: Colors.primary }} />}
            pressable={false}
            separatorColor={Colors.background}
          />
          <ICloudSyncRow flat />
          <Row icon="lock-closed-outline" iconColor={Colors.primary} title="Encryption information"
            subtitle="How your data is encrypted"
            onClick={() => router.push('/settings/encryption')}
            separatorColor={Colors.background}
            tourPressId="app-security"
          />
          <Row icon="folder-open-outline" iconColor={Colors.primary} title="Manage app data"
            subtitle="See your data · clear everything"
            onClick={() => router.push('/settings/manage-data')}
            border={false}
            separatorColor={Colors.background}
          />
        </Card>
      )}

      {/* ── G. Om — dropdown som övriga sektioner; app-versionen visas till höger på headern. ── */}
      <CollapsibleSectionHeader
        expanded={expandedSection === 'about'}
        onPress={() => toggleSection('about')}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13, color: Colors.textMuted, fontFamily: 'Menlo' }}>{appVersion}</Text>
            {updateAvailable && (
              <View style={{ backgroundColor: Colors.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.primary }}>{t('update_available')}</Text>
              </View>
            )}
          </View>
        }
      >
        {t('about')}
      </CollapsibleSectionHeader>
      {expandedSection === 'about' && (
      <Card backgroundColor={Colors.background} borderColor={Colors.background}>
        <Row icon="information-circle-outline" iconColor={Colors.textSecondary} title={t('version')} subtitle={appVersion} separatorColor={Colors.background}
          right={
            updateAvailable ? (
              <View style={{ backgroundColor: Colors.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.primary }}>{t('update_available')}</Text>
              </View>
            ) : undefined
          }
          onClick={() => {
            // Kör en färsk koll (strypt 1/min) och agera på resultatet.
            useVersionStore.getState().check().catch(() => {}).then(() => {
              if (useVersionStore.getState().updateAvailable) {
                Alert.alert(t('update_available'), t('update_available_sub'), [
                  { text: t('cancel'), style: 'cancel' },
                  { text: 'App Store', onPress: () => Linking.openURL(useVersionStore.getState().storeUrl) },
                ]);
              } else {
                Alert.alert(t('version'), t('version_up_to_date') ?? 'You are on the latest version.');
              }
            });
          }}
          /* onLongPress={openDevMenu} — dold testprofil/clear-data-trigger AVSTÄNGD för detta bygge.
             openDevMenu() + handleDev() finns kvar nedan; återaktivera genom att lägga tillbaka propen. */
        />
        <Row icon="mail" iconColor={Colors.textSecondary} title={t('support')} subtitle="support@blades-app.com" separatorColor={Colors.background}
          onClick={() => Linking.openURL('mailto:support@blades-app.com')}
        />
        <Row icon="globe-outline" iconColor={Colors.textSecondary} title="blades-app.com" separatorColor={Colors.background}
          subtitle={t('website_sub')}
          onClick={() => Linking.openURL('https://blades-app.com')}
        />
        <Row icon="document-text-outline" iconColor={Colors.textSecondary} title={t('privacy_policy')} separatorColor={Colors.background}
          onClick={() => Linking.openURL('https://blades-app.com/privacy.html')}
        />
        <Row icon="pricetag-outline" iconColor={Colors.textSecondary} title="Redeem promo code" border={false}
          onLongPress={() => {
            Alert.alert('Remove promo access?', 'This removes promo-based Blades Premium from this device. You can redeem a code again anytime.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: async () => {
                await setSetting('promo_premium', '0').catch(() => {});
                setIsPremium(false);
                refreshEntitlement().catch(() => {}); // återställer till ev. riktigt RevenueCat-köp
                Alert.alert('Promo removed', 'Promo Premium has been removed from this device.');
              } },
            ]);
          }}
          onClick={() => {
            Alert.prompt(
              'Redeem promo code',
              'Enter your promo code to unlock Blades Premium.',
              async (code?: string) => {
                const c = (code ?? '').trim();
                if (!c) return;
                const ok = await redeemPromo(c).catch(() => false);
                if (!ok) { Alert.alert('Invalid code', 'That promo code is not valid.'); return; }
                await setSetting('promo_premium', '1').catch(() => {});
                setIsPremium(true);
                Alert.alert('Blades Premium unlocked', 'Your promo access is now active.');
              },
              'plain-text',
            );
          }}
        />
      </Card>
      )}

      {/* Byt hela loggboken — LOGBOOK-rad med PILOT|DRONE-toggle (handoff B4). Stannar kvar på Settings. */}
      <ModeToggleRow
        mode={isDrone ? 'drone' : 'manned'}
        onConfirmSwitch={(target) => {
          if (target === 'drone') {
            const ex = additionalProfiles.find(p => p.mainRole === 'pilot-unmanned');
            switchProfile('pilot-unmanned', (ex?.subRole as SubRole) ?? 'commercial');
          } else {
            const ex = additionalProfiles.find(p => p.mainRole === 'pilot-manned');
            switchProfile('pilot-manned', (ex?.subRole as SubRole) ?? 'fixed');
          }
        }}
      />

      {/* Blades introduction — diskret textlänk (handoff B4). */}
      <View style={{ marginTop: 26, marginBottom: 28, alignItems: 'center' }}>
        <TouchableOpacity onPress={() => beginTour(isDrone ? 'drone' : 'pilot')} activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: Colors.textSecondary, borderBottomWidth: 1, borderBottomColor: '#2A4260', paddingBottom: 2 }}>
            Take the Blades introduction
          </Text>
        </TouchableOpacity>
      </View>


      {/* Blade-coins — förklarande popup */}
      <Modal visible={showCoinInfo} transparent animationType="fade" onRequestClose={() => setShowCoinInfo(false)}>
        <Pressable onPress={() => setShowCoinInfo(false)} style={{ flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 420, backgroundColor: Colors.surface, borderRadius: 18, padding: 20, gap: 12, borderWidth: 1, borderColor: Colors.cardBorder }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image source={require('../../assets/Blade_coin.PNG')} style={{ width: 30, height: 30 }} resizeMode="contain" />
              <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 18, fontWeight: '800' }}>Blade-coins</Text>
              <TouchableOpacity onPress={() => setShowCoinInfo(false)} hitSlop={10}><Ionicons name="close" size={22} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={{ color: Colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
              Blade-coins power the app's smart features — automatic aircraft & drone lookups (specs and photos), scanning and reading data from images, and other assisted tasks that do the typing for you.
            </Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
              Each smart action spends a few coins. Free accounts get a one-time batch to try them out; Premium refills your coins every month.
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: 13, lineHeight: 19 }}>
              When your coins run out, these smart features pause until your next refill — everything else in the app keeps working as normal.
            </Text>
            <TouchableOpacity onPress={() => setShowCoinInfo(false)} activeOpacity={0.85}
              style={{ marginTop: 4, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '800' }}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

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
            {/* 3 / 5 / 10 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[3, 5, 10].map((n) => {
                const active = pagesChoice === n;
                return (
                  <TouchableOpacity
                    key={n} onPress={() => setPagesChoice(n)} activeOpacity={0.8}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                      backgroundColor: active ? Colors.primary : Colors.elevated,
                      borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '800', color: active ? Colors.textInverse : Colors.textPrimary }}>{n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* Whole logbook */}
            <TouchableOpacity
              onPress={() => setPagesChoice('whole')} activeOpacity={0.8}
              style={{
                paddingVertical: 13, borderRadius: 12, alignItems: 'center',
                backgroundColor: pagesChoice === 'whole' ? Colors.primary : Colors.elevated,
                borderWidth: 1, borderColor: pagesChoice === 'whole' ? Colors.primary : Colors.border,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: pagesChoice === 'whole' ? Colors.textInverse : Colors.textPrimary }}>Whole logbook</Text>
            </TouchableOpacity>
            {/* Custom pages */}
            <TouchableOpacity
              onPress={() => setPagesChoice('custom')} activeOpacity={0.8}
              style={{
                paddingVertical: 13, borderRadius: 12, alignItems: 'center',
                backgroundColor: pagesChoice === 'custom' ? Colors.primary : Colors.elevated,
                borderWidth: 1, borderColor: pagesChoice === 'custom' ? Colors.primary : Colors.border,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: pagesChoice === 'custom' ? Colors.textInverse : Colors.textPrimary }}>Custom pages</Text>
            </TouchableOpacity>
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
  // Regelverks-dropdown (ersätter toggeln): utfällbar lista under raden.
  stdOptions: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.elevated, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  stdOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14 },
  stdOptionText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '500' },
  soonPill: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: Colors.textMuted, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden' },
}); }
