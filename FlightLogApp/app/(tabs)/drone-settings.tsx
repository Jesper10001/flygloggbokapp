// Drönar-settings — VISUELL TVILLING till manned (app/(tabs)/settings.tsx): exakt samma
// typografi (system-font + Menlo för siffror), radlayout, kort-struktur och sektions-UX,
// men navy via DR + användarens accent och drönar-relevanta rader. Inga custom-fonter
// (JetBrainsMono/Fraunces) — allt matchar manned-settings.

import { useCallback, useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Image,
  LayoutAnimation, Platform, UIManager, Linking, Alert, ActivityIndicator, Modal, Pressable, TextInput, AppState,
} from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { getDroneFlightCount } from '../../db/drones';
import { FREE_TIER_LIMIT_DRONE } from '../../constants/easa';
import { exportDroneFlightsToCSV } from '../../services/export';
import { useToastStore } from '../../components/Toast';
import { useProfileStore, type SubRole } from '../../store/profileStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useTourStore } from '../../store/tourStore';
import { TourPress } from '../../components/TourPress';
import { useFlightStore } from '../../store/flightStore';
import { useTokenQuotaStore } from '../../store/tokenQuotaStore';
import { tokensToCoins } from '../../utils/tokenGate';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useVersionStore } from '../../store/versionStore';
import { seedTestUser1, seedTestUser2, clearTestUser } from '../../services/testUserSeed';
import { getSetting, setSetting } from '../../db/flights';
import { ICloudSyncRow } from '../../components/settings/ICloudSyncRow';
import { useAppLockStore } from '../../store/appLockStore';
import { isPhotoSyncAvailable, hasPendingSync, hasUnfinishedReview } from '../../services/dronePhotoSync';
import { exportLogbookPages, getLogbookSpreadCount } from '../../services/logbook/exportPages';
import { listDigitalBooks } from '../../db/digitalBooks';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SectionKey = 'logbook' | 'import' | 'export' | 'app';

export default function DroneSettingsScreen() {
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const setAppMode = useAppModeStore((s) => s.setMode);
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const setPilotType = usePilotTypeStore((s) => s.setPilotType);
  const { loadFlights: loadDroneFlights, loadStats: loadDroneStats } = useDroneFlightStore();

  const { isPremium, isMax, setIsPremium } = useFlightStore();
  const tokenUsage = useTokenQuotaStore((s) => s.usage);
  const timeFormat = useTimeFormatStore((s) => s.timeFormat);
  const setTimeFormat = useTimeFormatStore((s) => s.setTimeFormat);
  const [locGranted, setLocGranted] = useState(false);
  const [showCoinInfo, setShowCoinInfo] = useState(false);
  const appLockEnabled = useAppLockStore((s) => s.enabled);
  const appLockAvailable = useAppLockStore((s) => s.available);

  const [expanded, setExpanded] = useState<SectionKey | null>('logbook');
  // Öppna + scrolla fram en sektion via param (Blades introduction → Import).
  const { expand } = useLocalSearchParams<{ expand?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const importSectionY = useRef(0);
  const appSectionY = useRef(0);
  useEffect(() => {
    if (expand === 'import' || expand === 'export' || expand === 'app' || expand === 'logbook') {
      setExpanded(expand as SectionKey);
      const y = expand === 'import' ? importSectionY.current : expand === 'app' ? appSectionY.current : 0;
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }), 420);
    } else {
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 120);
    }
  }, [expand]);
  const [flightCount, setFlightCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  // Export logbook pages (= pilot mode, drönar-böcker)
  const [exportingPages, setExportingPages] = useState(false);
  const [pagesModal, setPagesModal] = useState(false);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [pagesChoice, setPagesChoice] = useState<number | 'whole' | 'custom'>(3);
  const [pagesCustom, setPagesCustom] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileInitials, setProfileInitials] = useState('');
  const [additionalProfiles, setAdditionalProfiles] = useState<Array<{ mainRole: string; subRole: string }>>([]);
  // Foto-synk: kan synkas / pausad granskning att återuppta (= pilotläget).
  const photoSyncOn = isPhotoSyncAvailable();
  const [canSync, setCanSync] = useState(false);
  const [resumeReview, setResumeReview] = useState(false);

  useFocusEffect(useCallback(() => {
    loadAccent();
    useTokenQuotaStore.getState().load();
    getDroneFlightCount().then(setFlightCount).catch(() => {});
    if (photoSyncOn) {
      hasPendingSync().then(setCanSync).catch(() => setCanSync(false));
      hasUnfinishedReview().then(setResumeReview).catch(() => setResumeReview(false));
    }
    Location.getForegroundPermissionsAsync().then((p) => setLocGranted(p.granted)).catch(() => {});
    (async () => {
      const first = (await getSetting('profile_first_name')) ?? '';
      const last = (await getSetting('profile_last_name')) ?? '';
      const initials = (await getSetting('profile_initials')) ?? '';
      setProfileName(`${first} ${last}`.trim());
      setProfileInitials(initials || `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase());
      const addJson = (await getSetting('additional_profiles')) ?? '';
      if (addJson) { try { setAdditionalProfiles(JSON.parse(addJson)); } catch { setAdditionalProfiles([]); } }
    })().catch(() => {});
  }, [loadAccent]));

  const toggleSection = (section: SectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(expanded === section ? null : section);
  };

  // Exportera BARA drone_flights (aldrig pilot-datat). Speglar manned-exportens flöde.
  const handleExportCsv = async () => {
    if (exporting) return;
    if (flightCount === 0) { useToastStore.getState().show('No drone flights to export yet'); return; }
    setExporting(true);
    try { await exportDroneFlightsToCSV(); }
    catch (e: any) { useToastStore.getState().show(e?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  // Byt loggbok/läge (= manned switchProfile): spara nuvarande profil, sätt målprofil + appMode,
  // navigera EXPLICIT till rätt dashboard efter re-render (annars → href:null-ankaret = svart).
  const switchProfile = async (mainRole: 'pilot-manned' | 'pilot-unmanned', subRole: SubRole) => {
    if (profile) {
      const currentProfiles = additionalProfiles.filter((p) => p.mainRole !== profile.mainRole);
      const newAdditional = [...currentProfiles, { mainRole: profile.mainRole, subRole: profile.subRole }];
      await setSetting('additional_profiles', JSON.stringify(newAdditional));
      setAdditionalProfiles(newAdditional);
    }
    await setProfile({ mainRole, subRole });
    const targetMode = mainRole === 'pilot-unmanned' ? 'drone' : 'manned';
    await setAppMode(targetMode);
    const dest = targetMode === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)';
    requestAnimationFrame(() => router.replace(dest as any));
  };

  const shiftToPilot = () => {
    const ex = additionalProfiles.find((p) => p.mainRole === 'pilot-manned');
    switchProfile('pilot-manned', (ex?.subRole as SubRole) ?? 'fixed');
  };

  const applyDroneTestUser = (which: 1 | 2 | 'clear') => {
    const label = which === 'clear' ? 'Clear test data' : `Test user ${which}`;
    Alert.alert(label, 'This replaces all drone data (drones, certificates, flights). Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Apply', style: 'destructive', onPress: async () => {
        try {
          if (which === 1) { await seedTestUser1(); }
          else if (which === 2) { await seedTestUser2(); }
          else { await clearTestUser(); }
          await loadDroneFlights(); await loadDroneStats();
          getDroneFlightCount().then(setFlightCount).catch(() => {});
          useToastStore.getState().show(label);
        } catch (e: any) { Alert.alert('Error', e.message); }
      } },
    ]);
  };

  // Dold trigger (långtryck på versionsnumret) → drönar-testanvändare. Developer-sektionen borttagen.
  const openDevMenu = () => {
    Alert.alert('Test data', 'Replace all drone data with a demo profile.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Test user 1 — Inspection', onPress: () => applyDroneTestUser(1) },
      { text: 'Test user 2 — Military', onPress: () => applyDroneTestUser(2) },
      { text: 'Clear drone data', style: 'destructive', onPress: () => applyDroneTestUser('clear') },
    ]);
  };

  // App-lås (Face ID) — samma som pilotläget.
  const toggleAppLock = async (next: boolean) => {
    if (next && !appLockAvailable) { Alert.alert('Face ID unavailable', 'Set up Face ID or Touch ID for your device, then try again.'); return; }
    await useAppLockStore.getState().setEnabled(next);
  };
  // Platstillstånd kan inte slås av inifrån appen (iOS) → begär vid påslag, annars/avslag → Inställningar.
  const toggleLocation = async (next: boolean) => {
    try {
      if (next) {
        const cur = await Location.getForegroundPermissionsAsync();
        if (cur.granted) { setLocGranted(true); return; }
        if (cur.canAskAgain) { const r = await Location.requestForegroundPermissionsAsync(); if (r.granted) { setLocGranted(true); return; } }
        Linking.openSettings();
      } else { Linking.openSettings(); }
    } catch { /* ignore */ }
  };

  // Platstillstånd ändras utanför appen → uppdatera togglen när appen blir aktiv igen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') Location.getForegroundPermissionsAsync().then((p) => setLocGranted(p.granted)).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  const checkVersion = () => {
    useVersionStore.getState().check().then(() => {
      const vs = useVersionStore.getState();
      if (vs.updateAvailable) {
        Alert.alert('Update available', 'A new version is available.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'App Store', onPress: () => Linking.openURL(vs.storeUrl) },
        ]);
      } else {
        Alert.alert('Version', 'You are on the latest version.');
      }
    });
  };

  // ── Export logbook pages (drönar-böcker) — samma flöde som pilot mode ──
  const openPagesExport = async () => {
    try {
      const total = await getLogbookSpreadCount(undefined, 'drone');
      if (total === 0) { Alert.alert('Export logbook pages', 'No logbook pages to export yet.'); return; }
      setPagesTotal(total);
      setPagesChoice(total < 3 ? 'whole' : 3);
      setPagesCustom(String(total));
      setPagesModal(true);
    } catch (e: any) { Alert.alert('Export failed', e.message); }
  };
  const doPagesExport = async (mode: number | 'whole', bookId?: number) => {
    setExportingPages(true);
    try {
      const total = await getLogbookSpreadCount(bookId, 'drone');
      if (total === 0) { Alert.alert('Export logbook pages', 'No logbook pages to export yet.'); return; }
      const count = mode === 'whole' ? total : Math.max(1, Math.min(mode, total));
      await exportLogbookPages(count, bookId, 'drone');
    } catch (e: any) { Alert.alert('Export failed', e.message); }
    finally { setExportingPages(false); }
  };
  const runPagesExport = async () => {
    setPagesModal(false);
    if (pagesChoice === 'whole') {
      const books = await listDigitalBooks('drone').catch(() => []);
      if (books.length > 1) {
        Alert.alert('Export logbook pages', 'Which logbook do you want to export?', [
          ...books.map((b) => ({ text: b.name || `Logbook ${b.id}`, onPress: () => doPagesExport('whole', b.id) })),
          { text: 'Cancel', style: 'cancel' as const },
        ]);
      } else { doPagesExport('whole', books[0]?.id); }
      return;
    }
    const raw = pagesChoice === 'custom' ? parseInt(pagesCustom || '0', 10) : pagesChoice;
    doPagesExport(Math.max(1, raw || 1));
  };

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: DR.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: DR.text, letterSpacing: -0.8 }}>Settings</Text>
      </View>

      {/* ── A. Profilkort ── */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{ backgroundColor: DR.surface, borderRadius: 16, borderWidth: 1, borderColor: DR.border, overflow: 'hidden' }}>
          {/* Profil-rad */}
          <TouchableOpacity
            style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 0.5, borderBottomColor: DR.separator }}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/profile')}
          >
            <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: isMax ? DR.text2 : (isPremium ? DR.warning : accent), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: DR.inkOnAccent, letterSpacing: -0.5 }}>{profileInitials || '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: DR.text, letterSpacing: -0.2 }}>{profileName || 'Your name'}</Text>
              <Text style={{ fontSize: 12, color: DR.muted, marginTop: 2 }}>Tap to edit profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={DR.muted} />
          </TouchableOpacity>

          {/* Certifikat + "Current today?" borttagna inför lansering (dolda från UI). */}

          {/* Premium */}
          <TouchableOpacity style={{ paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }} activeOpacity={0.7} onPress={() => router.push('/settings/premium')}>
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: (isMax ? DR.text2 : DR.warning) + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="star" size={15} color={isMax ? DR.text2 : DR.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: DR.text }}>{isMax ? 'Blades MAX' : 'Blades Premium'}</Text>
              <Text style={{ fontSize: 11, color: DR.muted }}>{isPremium || isMax ? 'Active' : 'Discover all features'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={DR.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Blade-coins-mätare ── */}
      {tokenUsage && (() => {
        const pct = Math.min(100, Math.round((tokenUsage.used / Math.max(tokenUsage.limit, 1)) * 100));
        // Flytande sektion (ingen ruta) · shiny zyan bar + siffror.
        return (
          <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Image source={isPremium ? require('../../assets/Gold_blade_coin.PNG') : require('../../assets/Blade_coin.PNG')} style={{ width: 68, height: 68 }} resizeMode="contain" />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: DR.text }}>Blade-coins</Text>
                    <TouchableOpacity onPress={() => setShowCoinInfo(true)} hitSlop={8} activeOpacity={0.7}>
                      <Ionicons name="help-circle-outline" size={16} color={DR.muted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontSize: 13, color: '#3DE3F7', fontFamily: 'Menlo', fontWeight: '700', textShadowColor: 'rgba(0,214,255,0.55)', textShadowRadius: 6 }}>{tokensToCoins(tokenUsage.used).toLocaleString('en-US')} / {tokensToCoins(tokenUsage.limit).toLocaleString('en-US')}</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: DR.elevated, overflow: 'hidden' }}>
                  <LinearGradient colors={['#7DF2FF', '#1CD8F5', '#00B4D8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 6, borderRadius: 3, width: `${pct}%` }} />
                </View>
                <Text style={{ fontSize: 10.5, color: DR.muted }}>{tokenUsage.month === 'lifetime' ? 'Free one-time Blade-coins · upgrade for a monthly refill' : 'Blade-coins used this month · refills monthly'}</Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* ── Fria flygningar-mätare: manuellt loggade drönarflygningar mot gratisgränsen ── */}
      {(() => {
        const used = flightCount;
        const limit = FREE_TIER_LIMIT_DRONE;
        const left = Math.max(0, limit - used);
        const pct = isPremium ? 100 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
        return (
          <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
            <View style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: DR.text2 }}>Flights logged</Text>
                <Text style={{ fontSize: 12, color: DR.text2, fontFamily: 'Menlo', fontWeight: '600' }}>
                  {isPremium ? `${used} · ∞` : `${used} / ${limit}`}
                </Text>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: DR.elevated, overflow: 'hidden' }}>
                <View style={{ height: 4, borderRadius: 2, width: `${pct}%`, backgroundColor: DR.muted }} />
              </View>
              <Text style={{ fontSize: 10.5, color: DR.muted }}>
                {isPremium
                  ? 'Premium · unlimited flights'
                  : `${left} more you can add for free`}
              </Text>
            </View>
          </View>
        );
      })()}

      {/* ── C. Logbook ── */}
      <CollapsibleSectionHeader accent={accent} expanded={expanded === 'logbook'} onPress={() => toggleSection('logbook')}>Logbook</CollapsibleSectionHeader>
      {expanded === 'logbook' && (
        <SectionCard>
          <Row accent={accent} icon="images-outline" iconColor={accent} title="Flight album" subtitle="Photos & videos from your flights" onPress={() => router.push('/drone-album')} separatorColor={DR.background} />
          <Row accent={accent} icon="time-outline" iconColor={accent} title="Audit log" subtitle="All changes logged" onPress={() => router.push('/settings/auditlog')} separatorColor={DR.background} />
          {/* Time format (flyttat hit från App, = pilotläget) */}
          <Row accent={accent} icon="time-outline" iconColor={accent} title="Time format" subtitle="Decimal or hours:minutes" pressable={false} border={false} separatorColor={DR.background}
            right={
              <View style={s.toggle}>
                <TouchableOpacity style={[s.toggleBtn, timeFormat === 'decimal' && { backgroundColor: accent }]} onPress={() => setTimeFormat('decimal')} activeOpacity={0.7}>
                  <Text style={[s.toggleText, { color: timeFormat === 'decimal' ? DR.inkOnAccent : DR.muted }]}>1.5</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.toggleBtn, timeFormat === 'hhmm' && { backgroundColor: accent }]} onPress={() => setTimeFormat('hhmm')} activeOpacity={0.7}>
                  <Text style={[s.toggleText, { color: timeFormat === 'hhmm' ? DR.inkOnAccent : DR.muted }]}>1:30</Text>
                </TouchableOpacity>
              </View>
            } />
        </SectionCard>
      )}

      {/* ── D. Import — endast drönar-säkra vägar (inget hamnar i pilot-loggboken) ── */}
      <View onLayout={(e) => { importSectionY.current = e.nativeEvent.layout.y; }}>
        <CollapsibleSectionHeader accent={accent} expanded={expanded === 'import'} onPress={() => toggleSection('import')} tourPressId="import-section">Import</CollapsibleSectionHeader>
      </View>
      {expanded === 'import' && (
        <SectionCard>
          <Row accent={accent} icon="create-outline" iconColor={accent} title="Log flight manually" subtitle="Add historical drone hours" onPress={() => router.push('/drone-import/manual')} separatorColor={DR.background} tourPressId="import-manual" />
          <Row accent={accent} icon="camera-outline" iconColor={accent} title="Scan controller log" subtitle="DJI / Autel — coming soon" right={<Text style={s.soon}>SOON</Text>} pressable={false} separatorColor={DR.background} />
          <Row accent={accent} icon="document-attach-outline" iconColor={accent} title="Import CSV" subtitle="Import a drone-log CSV" onPress={() => router.push('/drone-import')} separatorColor={DR.background} />
          <Row accent={accent} icon="folder-open-outline" iconColor={accent} title="Imported data" subtitle="Review and delete your imports" onPress={() => router.push('/drone-import/history')} border={false} tourPressId="import-history" />
        </SectionCard>
      )}

      {/* ── E. Data & Export — exporterar BARA drone_flights ── */}
      <CollapsibleSectionHeader accent={accent} expanded={expanded === 'export'} onPress={() => toggleSection('export')}>Data & Export</CollapsibleSectionHeader>
      {expanded === 'export' && (
        <SectionCard>
          <Row accent={accent} icon="book-outline" iconColor={accent} title="Export logbook pages"
            subtitle="PDF of your latest page spreads" onPress={openPagesExport} separatorColor={DR.background}
            right={exportingPages ? <ActivityIndicator size="small" color={accent} /> : undefined} />
          <Row accent={accent} icon="download-outline" iconColor={accent} title="Export CSV"
            subtitle={flightCount > 0 ? `${flightCount} drone ${flightCount === 1 ? 'flight' : 'flights'}` : 'No flights yet'}
            onPress={handleExportCsv} border={false}
            right={exporting ? <ActivityIndicator size="small" color={accent} /> : undefined} />
        </SectionCard>
      )}

      {/* ── F. App security (= pilotläget: app-lås, plats, iCloud, kryptering, hantera data) ── */}
      <View onLayout={(e) => { appSectionY.current = e.nativeEvent.layout.y; }}>
        <CollapsibleSectionHeader accent={accent} expanded={expanded === 'app'} onPress={() => toggleSection('app')}>App security</CollapsibleSectionHeader>
      </View>
      {expanded === 'app' && (
        <SectionCard>
          <Row accent={accent} icon="finger-print-outline" iconColor={accent} title="Require Face ID to open"
            subtitle={appLockAvailable ? (appLockEnabled ? 'On · Face ID required to open the app' : 'Off') : 'Set up Face ID / Touch ID to enable'}
            right={<Switch value={appLockEnabled} disabled={!appLockAvailable} onValueChange={toggleAppLock} trackColor={{ false: DR.elevated, true: accent }} />}
            pressable={false} separatorColor={DR.background} />
          <Row accent={accent} icon="location-outline" iconColor={accent} title="Allow app to show my position"
            subtitle={locGranted ? 'On' : 'Off · used to find nearby airports'}
            right={<Switch value={locGranted} onValueChange={toggleLocation} trackColor={{ false: DR.elevated, true: accent }} />}
            pressable={false} separatorColor={DR.background} />
          <ICloudSyncRow accent={accent} flat />
          <Row accent={accent} icon="lock-closed-outline" iconColor={accent} title="Encryption information" subtitle="How your data is encrypted"
            onPress={() => router.push('/settings/encryption')} separatorColor={DR.background} tourPressId="app-security" />
          <Row accent={accent} icon="folder-open-outline" iconColor={accent} title="Manage app data" subtitle="See your data · clear everything"
            onPress={() => router.push('/settings/manage-data')} border={false} separatorColor={DR.background} />
        </SectionCard>
      )}

      {/* ── About (version → långtryck = testdata-meny; Developer-sektionen borttagen) ── */}
      <SectionHeader>About</SectionHeader>
      <Card>
        <Row accent={accent} icon="information-circle-outline" iconColor={DR.text3} title="Version" onPress={checkVersion} onLongPress={openDevMenu}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 13, color: DR.muted, fontFamily: 'Menlo' }}>1.0.0</Text>
              {useVersionStore.getState().updateAvailable && (
                <View style={{ backgroundColor: accent + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: accent }}>UPDATE</Text>
                </View>
              )}
            </View>
          } />
        <Row accent={accent} icon="shield-checkmark" iconColor={DR.text3} title="Local storage" subtitle="All data stored on this device" pressable={false} />
        <Row accent={accent} icon="mail" iconColor={DR.text3} title="Support" subtitle="support@blades-app.com" onPress={() => Linking.openURL('mailto:support@blades-app.com')} />
        <Row accent={accent} icon="globe-outline" iconColor={DR.text3} title="blades-app.com" subtitle="News, guides & support" onPress={() => Linking.openURL('https://blades-app.com')} />
        <Row accent={accent} icon="document-text-outline" iconColor={DR.text3} title="Privacy policy" onPress={() => Linking.openURL('https://blades-app.com/privacy.html')} border={false} />
      </Card>

      {/* Byt hela loggboken → längst ner (man skiftar hela appläget). Egen framträdande design. */}
      <TouchableOpacity onPress={shiftToPilot} activeOpacity={0.85} style={{ marginHorizontal: 16, marginTop: 24, marginBottom: 12 }}>
        <LinearGradient colors={[accent + '2E', accent + '0D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: accent + '55' }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: accent + '26', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: accent + '55' }}>
            <Ionicons name="airplane-outline" size={20} color={accent} />
          </View>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: DR.text }}>Shift to Pilot logbook</Text>
          <Ionicons name="swap-horizontal" size={22} color={accent} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Blades introduction — kör den guidade rundturen igen (drönarläget). */}
      <TouchableOpacity
        onPress={() => useTourStore.getState().start('drone')}
        activeOpacity={0.8}
        style={{ marginHorizontal: 16, marginBottom: 28, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface }}
      >
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: accent + '1A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: accent + '44' }}>
          <Ionicons name="compass-outline" size={20} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: DR.text }}>Blades introduction</Text>
          <Text style={{ fontSize: 12, color: DR.text2, marginTop: 2 }}>Take the guided tour again</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={DR.muted} />
      </TouchableOpacity>

      {/* Blade-coins — förklarande popup */}
      <Modal visible={showCoinInfo} transparent animationType="fade" onRequestClose={() => setShowCoinInfo(false)}>
        <Pressable onPress={() => setShowCoinInfo(false)} style={{ flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 420, backgroundColor: DR.surface, borderRadius: 18, padding: 20, gap: 12, borderWidth: 1, borderColor: DR.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image source={require('../../assets/Blade_coin.PNG')} style={{ width: 30, height: 30 }} resizeMode="contain" />
              <Text style={{ flex: 1, color: DR.text, fontSize: 18, fontWeight: '800' }}>Blade-coins</Text>
              <TouchableOpacity onPress={() => setShowCoinInfo(false)} hitSlop={10}><Ionicons name="close" size={22} color={DR.muted} /></TouchableOpacity>
            </View>
            <Text style={{ color: DR.text2, fontSize: 14, lineHeight: 21 }}>
              Blade-coins power the app's smart features — automatic aircraft & drone lookups (specs and photos), scanning and reading data from images, and other assisted tasks that do the typing for you.
            </Text>
            <Text style={{ color: DR.text2, fontSize: 14, lineHeight: 21 }}>
              Each smart action spends a few coins. Free accounts get a one-time batch to try them out; Premium refills your coins every month.
            </Text>
            <Text style={{ color: DR.muted, fontSize: 13, lineHeight: 19 }}>
              When your coins run out, these smart features pause until your next refill — everything else in the app keeps working as normal.
            </Text>
            <TouchableOpacity onPress={() => setShowCoinInfo(false)} activeOpacity={0.85}
              style={{ marginTop: 4, backgroundColor: accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ color: DR.inkOnAccent, fontSize: 15, fontWeight: '800' }}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Export logbook pages: välj antal siduppslag (= pilot mode) ── */}
      <Modal visible={pagesModal} transparent animationType="fade" onRequestClose={() => setPagesModal(false)}>
        <Pressable onPress={() => setPagesModal(false)} style={{ flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 440, backgroundColor: DR.surface, borderRadius: 18, padding: 20, gap: 14 }}>
            <Text style={{ color: DR.text, fontSize: 18, fontWeight: '800' }}>Export logbook pages</Text>
            <Text style={{ color: DR.text2, fontSize: 13, lineHeight: 19 }}>Choose how many of your latest page spreads to export as a PDF.</Text>
            {/* 3 / 5 / 10 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[3, 5, 10].map((n) => {
                const active = pagesChoice === n;
                return (
                  <TouchableOpacity key={n} onPress={() => setPagesChoice(n)} activeOpacity={0.8}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: active ? accent : DR.elevated, borderWidth: 1, borderColor: active ? accent : DR.border }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: active ? DR.inkOnAccent : DR.text }}>{n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity onPress={() => setPagesChoice('whole')} activeOpacity={0.8}
              style={{ paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: pagesChoice === 'whole' ? accent : DR.elevated, borderWidth: 1, borderColor: pagesChoice === 'whole' ? accent : DR.border }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: pagesChoice === 'whole' ? DR.inkOnAccent : DR.text }}>Whole logbook</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPagesChoice('custom')} activeOpacity={0.8}
              style={{ paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: pagesChoice === 'custom' ? accent : DR.elevated, borderWidth: 1, borderColor: pagesChoice === 'custom' ? accent : DR.border }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: pagesChoice === 'custom' ? DR.inkOnAccent : DR.text }}>Custom pages</Text>
            </TouchableOpacity>
            {pagesChoice === 'custom' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TextInput value={pagesCustom} onChangeText={(v) => setPagesCustom(v.replace(/\D/g, ''))} keyboardType="number-pad"
                  placeholder={String(pagesTotal)} placeholderTextColor={DR.muted}
                  style={{ width: 90, backgroundColor: DR.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: DR.text, fontSize: 16, borderWidth: 1, borderColor: DR.border, textAlign: 'center' }} />
                <Text style={{ color: DR.muted, fontSize: 13 }}>of {pagesTotal}</Text>
              </View>
            )}
            <TouchableOpacity onPress={runPagesExport} activeOpacity={0.85}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: accent, borderRadius: 14, paddingVertical: 15 }}>
              <Ionicons name="share-outline" size={18} color={DR.inkOnAccent} />
              <Text style={{ color: DR.inkOnAccent, fontSize: 15, fontWeight: '800' }}>Export PDF</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

// ── Design-komponenter (= manned settings, DR-tema) ─────────────────────────

function SectionHeader({ children }: { children: string }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: DR.muted, letterSpacing: 0.9, textTransform: 'uppercase' }}>{children}</Text>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: DR.surface, borderRadius: 16, borderWidth: 1, borderColor: DR.border, marginHorizontal: 20, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

// Sektionsinnehåll = transparent kort (blandar in i sidan, = manned bg-kort).
function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={{ marginHorizontal: 20, marginTop: 6, overflow: 'hidden' }}>{children}</View>;
}

function CollapsibleSectionHeader({ accent, children, expanded, onPress, tourPressId }: { accent: string; children: string; expanded: boolean; onPress: () => void; tourPressId?: string }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border }}>
      {tourPressId ? <TourPress id={tourPressId} radius={12} /> : null}
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: expanded ? accent : DR.text, letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>
      <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={expanded ? accent : DR.text3} style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
}

function Row({ accent, icon, iconColor, iconBg, title, subtitle, right, onPress, onLongPress, border = true, pressable = true, separatorColor = DR.separator, tourPressId }: {
  accent: string; icon: any; iconColor?: string; iconBg?: string; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; onLongPress?: () => void; border?: boolean; pressable?: boolean; separatorColor?: string; tourPressId?: string;
}) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14, borderBottomWidth: border ? 0.5 : 0, borderBottomColor: separatorColor }}>
      {tourPressId ? <TourPress id={tourPressId} radius={0} /> : null}
      {iconBg ? (
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={16} color={iconColor ?? DR.text} />
        </View>
      ) : (
        <Ionicons name={icon} size={18} color={iconColor ?? DR.text} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: DR.text }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 12, color: DR.muted, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right ?? (pressable && onPress ? <Ionicons name="chevron-forward" size={16} color={DR.muted} /> : null)}
    </View>
  );
  if ((!pressable || !onPress) && !onLongPress) return content;
  return <TouchableOpacity onPress={onPress} onLongPress={onLongPress} delayLongPress={600} activeOpacity={0.7}>{content}</TouchableOpacity>;
}

const s = StyleSheet.create({
  soon: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: DR.muted, borderWidth: 1, borderColor: DR.border, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden', fontFamily: 'Menlo' },
  toggle: { flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 8, padding: 3, gap: 3, borderWidth: 0.5, borderColor: DR.border, width: 150 },
  toggleBtn: { flex: 1, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontSize: 12, fontWeight: '700' },
});
