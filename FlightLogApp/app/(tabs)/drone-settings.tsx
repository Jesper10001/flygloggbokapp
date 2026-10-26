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
import * as Application from 'expo-application';

import { DR } from '../../constants/droneTheme';
import { FONT_SERIF } from '../../components/logbook-page/tokens';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { getDroneFlightCount } from '../../db/drones';
import { FREE_TIER_LIMIT_DRONE } from '../../constants/easa';
import { exportDroneFlightsToCSV } from '../../services/export';
import { useToastStore } from '../../components/Toast';
import { useProfileStore, type SubRole } from '../../store/profileStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useTourStore, beginTour } from '../../store/tourStore';
import { TourPress } from '../../components/TourPress';
import { useFlightStore } from '../../store/flightStore';
import { presentPaywall, refreshEntitlement, presentManageSubscription } from '../../services/purchases';
import { redeemPromo } from '../../services/promo';
import { useTokenQuotaStore } from '../../store/tokenQuotaStore';
import { tokensToCoins } from '../../utils/tokenGate';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useAltitudeUnitStore } from '../../store/altitudeUnitStore';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useVersionStore } from '../../store/versionStore';
import { seedTestUser1, seedTestUser2, clearTestUser } from '../../services/testUserSeed';
import { getSetting, setSetting } from '../../db/flights';
import { SignatureView, type SignatureData } from '../../components/SignaturePad';
import { ModeToggleRow } from '../../components/settings/ModeToggleRow';
import { ICloudSyncRow } from '../../components/settings/ICloudSyncRow';
import { useAppLockStore } from '../../store/appLockStore';
import { isPhotoSyncAvailable, hasPendingSync, hasUnfinishedReview } from '../../services/dronePhotoSync';
import { exportLogbookPages, getLogbookSpreadCount } from '../../services/logbook/exportPages';
import { listDigitalBooks } from '../../db/digitalBooks';
import { useTabBarSpace } from '../../components/GlassTabBar';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SectionKey = 'logbook' | 'import' | 'export' | 'app' | 'about';

export default function DroneSettingsScreen() {
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const setAppMode = useAppModeStore((s) => s.setMode);
  const appMode = useAppModeStore((s) => s.mode);
  // Uppdaterings-koll (App Store-lookup) — reaktiv badge + check() vid fokus (nedan), strypt 1/min.
  const updateAvailable = useVersionStore((s) => s.updateAvailable);
  const appVersion = Application.nativeApplicationVersion ?? '1.0.0';
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const setPilotType = usePilotTypeStore((s) => s.setPilotType);
  const { loadFlights: loadDroneFlights, loadStats: loadDroneStats } = useDroneFlightStore();

  const { isPremium, isMax, setIsPremium } = useFlightStore();
  const tokenUsage = useTokenQuotaStore((s) => s.usage);
  const timeFormat = useTimeFormatStore((s) => s.timeFormat);
  const setTimeFormat = useTimeFormatStore((s) => s.setTimeFormat);
  const altUnit = useAltitudeUnitStore((s) => s.unit);
  const setAltUnit = useAltitudeUnitStore((s) => s.setUnit);
  const [locGranted, setLocGranted] = useState(false);
  const [showCoinInfo, setShowCoinInfo] = useState(false);
  const appLockEnabled = useAppLockStore((s) => s.enabled);
  const appLockAvailable = useAppLockStore((s) => s.available);

  // Starta med ALLA sektioner kollapsade (= pilot-settings). Default var tidigare 'logbook' → "General"
  // öppnades av sig själv varje gång drönar-settings monterades, bl.a. vid pilot↔drönare-byte.
  const [expanded, setExpanded] = useState<SectionKey | null>(null);
  // Öppna + scrolla fram en sektion via param (Blades introduction → Import).
  const { expand } = useLocalSearchParams<{ expand?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const tabSpace = useTabBarSpace(); // flytande glas-flikrad täcker botten
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
  // Pilot↔drönare-byte ska ge en REN settings-vy: kollapsa alla sektioner när läget ändras medan sidan
  // ligger kvar monterad (bevarat tab-state). Ref-skydd → körs ej vid första mount (deep-link-`expand` kvar).
  const prevAppMode = useRef(appMode);
  useEffect(() => {
    if (prevAppMode.current !== appMode) { prevAppMode.current = appMode; setExpanded(null); }
  }, [appMode]);
  const [flightCount, setFlightCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  // Export logbook pages (= pilot mode, drönar-böcker)
  const [exportingPages, setExportingPages] = useState(false);
  const [pagesModal, setPagesModal] = useState(false);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [pagesChoice, setPagesChoice] = useState<number | 'whole' | 'custom'>(3);
  const [pagesCustom, setPagesCustom] = useState('');
  const [profileName, setProfileName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null); // pilotsignatur → visas till höger i profilkortet
  const [profileInitials, setProfileInitials] = useState('');
  const [additionalProfiles, setAdditionalProfiles] = useState<Array<{ mainRole: string; subRole: string }>>([]);
  // Foto-synk: kan synkas / pausad granskning att återuppta (= pilotläget).
  const photoSyncOn = isPhotoSyncAvailable();
  const [canSync, setCanSync] = useState(false);
  const [resumeReview, setResumeReview] = useState(false);

  useFocusEffect(useCallback(() => {
    loadAccent();
    useTokenQuotaStore.getState().load();
    useVersionStore.getState().check().catch(() => {}); // App Store-koll (strypt 1/min) → About-badge
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
      try { const sg = await getSetting('pilot_signature'); setSignature(sg ? JSON.parse(sg) : null); } catch { setSignature(null); }
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
    // Stanna kvar på SETTINGS i det nya läget (lättare skärm än dashboarden → mjukare byte).
    const dest = targetMode === 'drone' ? '/(tabs)/drone-settings' : '/(tabs)/settings';
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
    <ScrollView ref={scrollRef} style={{ flex: 1, backgroundColor: DR.background }} contentContainerStyle={{ paddingBottom: tabSpace + 40 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
        <Text style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: DR.text }}>Settings</Text>
      </View>

      {/* ── A. Profil + Blades Premium — design "D" (handoff): profilkort + slank guld-strip, gap 10. ── */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 10 }}>
        {/* Profil-rad (kort) — ~samma storlek som Blades Premium-stripen. Med signatur: "PROFILE" + namn
            staplade vänster, signatur höger. Utan signatur: namnet till höger (fyller signaturens plats). */}
        <TouchableOpacity
          style={{ height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: DR.surface, borderRadius: 14, borderWidth: 1, borderColor: DR.border }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Profile, ${profileName || 'Your name'}`}
          onPress={() => router.push('/settings/profile')}
        >
          {signature ? (
            <>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase', color: DR.text3 }}>Profile</Text>
                <Text style={{ fontSize: 15, fontWeight: '600', color: DR.text, marginTop: 2 }} numberOfLines={1}>{profileName || 'Your name'}</Text>
              </View>
              <View style={{ maxWidth: 110, overflow: 'hidden', alignItems: 'flex-end' }}>
                <SignatureView data={signature} height={26} color={DR.text2} />
              </View>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase', color: DR.text3 }}>Profile</Text>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: DR.text, textAlign: 'right' }} numberOfLines={1}>{profileName || 'Your name'}</Text>
            </>
          )}
          <Ionicons name="chevron-forward" size={16} color={accent} />
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
            onPress={() => { if (isPremium || isMax) { presentManageSubscription().then((ok) => { if (!ok) router.push('/settings/premium'); }); } else { presentPaywall(); } }}
          >
            <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 2.4, textTransform: 'uppercase', color: '#FFB830' }}>Blades Premium</Text>
            <Text style={{ fontSize: 12, fontWeight: '500', fontFamily: 'Menlo', color: '#C9B07A' }}>{isPremium || isMax ? 'Active' : 'Upgrade'}</Text>
            <Ionicons name="chevron-forward" size={16} color="#FFB830" />
          </TouchableOpacity>
        </LinearGradient>
      </View>

      {/* ── Blade-coins-mätare ── */}
      {tokenUsage && (() => {
        // Handoff B2 (= pilot): 64px mynt till vänster, segmenterad mätare, visar KVARVARANDE coins.
        const usedCoins = tokensToCoins(tokenUsage.used);
        const limitCoins = tokensToCoins(tokenUsage.limit);
        const leftCoins = Math.max(0, limitCoins - usedCoins);
        const leftPct = limitCoins > 0 ? leftCoins / limitCoins : 0;
        const CELLS = 10;
        const fill = leftPct * CELLS;
        const full = Math.floor(fill);
        const partial = fill - full;
        const empty = leftCoins <= 0;
        const low = !empty && leftPct <= 0.10;
        const countColor = empty ? '#7F98B2' : low ? '#FFB830' : '#00C8E8';
        const gFull = (low ? ['#FFD27A', '#FFB830'] : ['#7DF2FF', '#00B4D8']) as [string, string];
        const partColor = low ? '#FFB830' : '#1CD8F5';
        const isFree = tokenUsage.month === 'lifetime';
        return (
          <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Image source={require('../../assets/Blade_coin.PNG')} style={{ width: 64, height: 64 }} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: DR.text }}>Blade-coins</Text>
                    <TouchableOpacity onPress={() => setShowCoinInfo(true)} hitSlop={8} activeOpacity={0.7}>
                      <Ionicons name="help-circle-outline" size={16} color={DR.muted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontFamily: 'Menlo', fontSize: 15, fontWeight: '700' }}>
                    <Text style={{ color: countColor }}>{leftCoins.toLocaleString('en-US')}</Text>
                    <Text style={{ color: '#56708C', fontWeight: '500' }}> / {limitCoins.toLocaleString('en-US')}</Text>
                  </Text>
                </View>
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
                <Text style={{ fontSize: 12, color: DR.muted }}>
                  {isFree
                    ? 'Free one-time Blade-coins · upgrade for a monthly refill'
                    : 'Left this month · refills monthly'}
                </Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* ── Fria flygningar-mätare: manuellt loggade drönarflygningar mot gratisgränsen.
          Döljs helt för premium/MAX — obegränsade flygningar, så mätaren fyller ingen funktion. ── */}
      {(() => {
        if (isPremium || isMax) return null;
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
      <CollapsibleSectionHeader accent={accent} expanded={expanded === 'logbook'} onPress={() => toggleSection('logbook')}>General</CollapsibleSectionHeader>
      {expanded === 'logbook' && (
        <SectionCard>
          <Row accent={accent} icon="images-outline" iconColor={accent} title="Flight album" subtitle="Photos & videos from your flights" onPress={() => router.push('/drone-album')} separatorColor={DR.background} />
          <Row accent={accent} icon="time-outline" iconColor={accent} title="Audit log" subtitle="All changes logged" onPress={() => router.push('/settings/auditlog')} separatorColor={DR.background} />
          {/* Time format (flyttat hit från App, = pilotläget) */}
          <Row accent={accent} icon="time-outline" iconColor={accent} title="Time format" subtitle="Decimal or hours:minutes" pressable={false} separatorColor={DR.background}
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
          {/* Höjdenhet (meter/fot) — styr Max alt i Log flight, detaljvyn och exporten. Lagras alltid i meter. */}
          <Row accent={accent} icon="trending-up-outline" iconColor={accent} title="Altitude" subtitle="Meters or feet" pressable={false} border={false} separatorColor={DR.background}
            right={
              <View style={s.toggle}>
                {(['m', 'ft'] as const).map((u) => (
                  <TouchableOpacity key={u} style={[s.toggleBtn, altUnit === u && { backgroundColor: accent }]} onPress={() => setAltUnit(u)} activeOpacity={0.7}>
                    <Text style={[s.toggleText, { color: altUnit === u ? DR.inkOnAccent : DR.muted }]}>{u}</Text>
                  </TouchableOpacity>
                ))}
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
          <Row accent={accent} icon="create-outline" iconColor={accent} title="Block import manually" subtitle="Add historical drone hours" onPress={() => router.push('/drone-import/manual')} separatorColor={DR.background} tourPressId="import-manual" />
          <Row accent={accent} icon="camera-outline" iconColor={accent} title="Scan controller log" subtitle="Log flights from a DJI / Autel screenshot" onPress={() => router.push('/drone-flight/add?scan=1')} separatorColor={DR.background} />
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
        <CollapsibleSectionHeader accent={accent} expanded={expanded === 'app'} onPress={() => toggleSection('app')}>Security</CollapsibleSectionHeader>
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
          <Row accent={accent} icon="lock-closed-outline" iconColor={accent} title="Encryption" subtitle="Protected by iOS · optional AES-256"
            onPress={() => router.push('/settings/encryption')} separatorColor={DR.background} tourPressId="app-security" />
          <Row accent={accent} icon="folder-open-outline" iconColor={accent} title="Manage app data" subtitle="See your data · clear everything"
            onPress={() => router.push('/settings/manage-data')} border={false} separatorColor={DR.background} />
        </SectionCard>
      )}

      {/* ── About (version → långtryck = testdata-meny; Developer-sektionen borttagen) ── */}
      {/* About — dropdown som övriga sektioner; app-versionen visas till höger på headern. */}
      <CollapsibleSectionHeader accent={accent} expanded={expanded === 'about'} onPress={() => toggleSection('about')}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13, color: DR.muted, fontFamily: 'Menlo' }}>{appVersion}</Text>
            {updateAvailable && (
              <View style={{ backgroundColor: accent + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: accent }}>Update available</Text>
              </View>
            )}
          </View>
        }
      >About</CollapsibleSectionHeader>
      {expanded === 'about' && (
      <SectionCard>
        {/* onLongPress={openDevMenu} — dold testprofil/clear-data-trigger AVSTÄNGD för detta bygge (openDevMenu finns kvar). */}
        <Row accent={accent} icon="information-circle-outline" iconColor={DR.text3} title="Version" subtitle={appVersion} onPress={checkVersion} separatorColor={DR.background}
          right={
            updateAvailable ? (
              <View style={{ backgroundColor: accent + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: accent }}>Update available</Text>
              </View>
            ) : undefined
          } />
        <Row accent={accent} icon="mail" iconColor={DR.text3} title="Support" subtitle="support@blades-app.com" onPress={() => Linking.openURL('mailto:support@blades-app.com')} separatorColor={DR.background} />
        <Row accent={accent} icon="globe-outline" iconColor={DR.text3} title="blades-app.com" subtitle="News, guides & support" onPress={() => Linking.openURL('https://blades-app.com')} separatorColor={DR.background} />
        <Row accent={accent} icon="document-text-outline" iconColor={DR.text3} title="Privacy policy" onPress={() => Linking.openURL('https://blades-app.com/privacy.html')} separatorColor={DR.background} />
        <Row accent={accent} icon="pricetag-outline" iconColor={DR.text3} title="Redeem promo code" border={false}
          onLongPress={() => {
            Alert.alert('Remove promo access?', 'This removes promo-based Blades Premium from this device. You can redeem a code again anytime.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: async () => {
                await setSetting('promo_premium', '0').catch(() => {});
                setIsPremium(false);
                refreshEntitlement().catch(() => {});
                Alert.alert('Promo removed', 'Promo Premium has been removed from this device.');
              } },
            ]);
          }}
          onPress={() => {
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
          }} />
      </SectionCard>
      )}

      {/* Byt hela loggboken — LOGBOOK-rad med PILOT|DRONE-toggle (handoff B4). Stannar kvar på Settings. */}
      <ModeToggleRow
        mode={appMode === 'drone' ? 'drone' : 'manned'}
        onConfirmSwitch={(target) => {
          if (target === 'manned') {
            const ex = additionalProfiles.find((p) => p.mainRole === 'pilot-manned');
            switchProfile('pilot-manned', (ex?.subRole as SubRole) ?? 'fixed');
          } else {
            const ex = additionalProfiles.find((p) => p.mainRole === 'pilot-unmanned');
            switchProfile('pilot-unmanned', (ex?.subRole as SubRole) ?? 'commercial');
          }
        }}
      />

      {/* Blades introduction — diskret textlänk (handoff B4). */}
      <View style={{ marginTop: 26, marginBottom: 28, alignItems: 'center' }}>
        <TouchableOpacity onPress={() => beginTour('drone')} activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '500', color: DR.text2, borderBottomWidth: 1, borderBottomColor: '#2A4260', paddingBottom: 2 }}>
            Take the Blades introduction
          </Text>
        </TouchableOpacity>
      </View>

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

function CollapsibleSectionHeader({ accent, children, expanded, onPress, tourPressId, right }: { accent: string; children: string; expanded: boolean; onPress: () => void; tourPressId?: string; right?: React.ReactNode }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border }}>
      {tourPressId ? <TourPress id={tourPressId} radius={12} /> : null}
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: expanded ? accent : DR.text, letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>
      {right != null ? <View style={{ marginLeft: 8 }}>{right}</View> : null}
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
