// Drönar-settings — VISUELL TVILLING till manned (app/(tabs)/settings.tsx): exakt samma
// typografi (system-font + Menlo för siffror), radlayout, kort-struktur och sektions-UX,
// men navy via DR + användarens accent och drönar-relevanta rader. Inga custom-fonter
// (JetBrainsMono/Fraunces) — allt matchar manned-settings.

import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Image,
  LayoutAnimation, Platform, UIManager, Linking, Alert, ActivityIndicator, Modal, Pressable, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
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

  const [expanded, setExpanded] = useState<SectionKey | null>('logbook');
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

  useFocusEffect(useCallback(() => {
    loadAccent();
    useTokenQuotaStore.getState().load();
    getDroneFlightCount().then(setFlightCount).catch(() => {});
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
    <ScrollView style={{ flex: 1, backgroundColor: DR.background }} contentContainerStyle={{ paddingBottom: 40 }}>
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
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: DR.text }}>Blade-coins</Text>
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
          <Row accent={accent} icon="hardware-chip-outline" iconColor={accent} title="Logbook type" subtitle="Pilot Unmanned Aircraft" pressable={false} separatorColor={DR.background} />
          {/* Shift to Pilot logbook (= manned inline-knapp) */}
          <View style={{ paddingHorizontal: 16, paddingTop: 0, paddingBottom: 8 }}>
            <TouchableOpacity onPress={shiftToPilot} activeOpacity={0.8}
              style={{ marginLeft: 32, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border }}>
              <Ionicons name="airplane-outline" size={16} color={accent} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: DR.text }}>Shift to Pilot logbook</Text>
            </TouchableOpacity>
          </View>
          {/* Drone pilot type selector (= manned) */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Ionicons name="layers-outline" size={18} color={accent} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: DR.text }}>Pilot type</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 32 }}>
              {(['commercial', 'military', 'hobby'] as const).map((type) => (
                <TouchableOpacity key={type} onPress={() => { if (type !== pilotType) setPilotType(type); }}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: pilotType === type ? accent : DR.elevated, borderWidth: 1, borderColor: pilotType === type ? accent : DR.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: pilotType === type ? DR.inkOnAccent : DR.text, textTransform: 'capitalize' }}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Row accent={accent} icon="list-outline" iconColor={accent} title="Manage drones" subtitle="Models, registration, category" onPress={() => router.push('/settings/drones')} separatorColor={DR.background} />
          <Row accent={accent} icon="book-outline" iconColor={accent} title="Your logbook" onPress={() => router.push('/drone-logbook')} border={false} />
        </SectionCard>
      )}

      {/* ── D. Import — endast drönar-säkra vägar (inget hamnar i pilot-loggboken) ── */}
      <CollapsibleSectionHeader accent={accent} expanded={expanded === 'import'} onPress={() => toggleSection('import')}>Import</CollapsibleSectionHeader>
      {expanded === 'import' && (
        <SectionCard>
          <Row accent={accent} icon="create-outline" iconColor={accent} title="Add manually" subtitle="Log a drone flight" onPress={() => router.push('/drone-flight/add')} separatorColor={DR.background} />
          <Row accent={accent} icon="camera-outline" iconColor={accent} title="Scan controller log" subtitle="DJI / Autel — coming soon" right={<Text style={s.soon}>SOON</Text>} pressable={false} separatorColor={DR.background} />
          <Row accent={accent} icon="document-attach-outline" iconColor={accent} title="Import CSV" subtitle="Drone log CSV — coming soon" right={<Text style={s.soon}>SOON</Text>} pressable={false} border={false} />
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

      {/* ── F. App ── */}
      <CollapsibleSectionHeader accent={accent} expanded={expanded === 'app'} onPress={() => toggleSection('app')}>App</CollapsibleSectionHeader>
      {expanded === 'app' && (
        <SectionCard>
          <Row accent={accent} icon="time-outline" iconColor={accent} title="Time format" subtitle="Decimal or hours:minutes" pressable={false} border={false}
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

      {/* ── Backup (iCloud) ── */}
      <SectionHeader>Backup</SectionHeader>
      <ICloudSyncRow accent={accent} />

      {/* ── G. About ── */}
      <SectionHeader>About</SectionHeader>
      <Card>
        <Row accent={accent} icon="information-circle-outline" iconColor={DR.text3} title="Version" onPress={checkVersion}
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
        <Row accent={accent} icon="mail" iconColor={DR.text3} title="Support" subtitle="toreldjesper@gmail.com" onPress={() => Linking.openURL('mailto:toreldjesper@gmail.com')} />
        <Row accent={accent} icon="globe-outline" iconColor={DR.text3} title="blades-app.com" onPress={() => Linking.openURL('https://blades-app.com')} />
        <Row accent={accent} icon="document-text-outline" iconColor={DR.text3} title="Privacy policy" onPress={() => Linking.openURL('https://blades-app.com/privacy.html')} border={false} />
      </Card>

      {/* ── H. Developer ── */}
      <SectionHeader>Developer</SectionHeader>
      <Card>
        <Row accent={accent} icon="star" iconColor={DR.warning} title="Premium" subtitle={isPremium ? 'Active' : 'Inactive'} pressable={false}
          right={<Switch value={isPremium} onValueChange={setIsPremium} trackColor={{ false: DR.elevated, true: accent }} />} />
        <Row accent={accent} icon="flask-outline" iconColor={accent} title="Test user 1" subtitle="Inspection pilot — ~95h" onPress={() => applyDroneTestUser(1)} />
        <Row accent={accent} icon="flask-outline" iconColor={accent} title="Test user 2" subtitle="Military pilot" onPress={() => applyDroneTestUser(2)} />
        <Row accent={accent} icon="refresh-outline" iconColor={DR.danger} title="Clear test data" subtitle="Removes all drones, certificates and flights" onPress={() => applyDroneTestUser('clear')} />
        <Row accent={accent} icon="refresh-circle-outline" iconColor={accent} title="Replay onboarding" subtitle="See the intro flow again"
          onPress={async () => { await setSetting('has_onboarded', '0'); router.replace('/onboarding'); }} />
        <Row accent={accent} icon="checkmark-done-outline" iconColor={DR.success} title="Reset import quota" subtitle="Reset CSV import counter to 0"
          onPress={async () => { await setSetting('import_used', '0'); Alert.alert('OK', 'Import quota reset'); }} border={false} />
      </Card>

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

function CollapsibleSectionHeader({ accent, children, expanded, onPress }: { accent: string; children: string; expanded: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border }}>
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: expanded ? accent : DR.text, letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>
      <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={expanded ? accent : DR.text3} style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
}

function Row({ accent, icon, iconColor, iconBg, title, subtitle, right, onPress, border = true, pressable = true, separatorColor = DR.separator }: {
  accent: string; icon: any; iconColor?: string; iconBg?: string; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; border?: boolean; pressable?: boolean; separatorColor?: string;
}) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14, borderBottomWidth: border ? 0.5 : 0, borderBottomColor: separatorColor }}>
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
  if (!pressable || !onPress) return content;
  return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
}

const s = StyleSheet.create({
  soon: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: DR.muted, borderWidth: 1, borderColor: DR.border, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden', fontFamily: 'Menlo' },
  toggle: { flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 8, padding: 3, gap: 3, borderWidth: 0.5, borderColor: DR.border, width: 150 },
  toggleBtn: { flex: 1, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontSize: 12, fontWeight: '700' },
});
