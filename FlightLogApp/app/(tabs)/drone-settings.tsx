// Drönar-settings (More) — egen skärm i navy DR + trådbar accent. Speglar manned
// (profilkort → collapsible sektioner → about) men med drönar-relevanta rader och
// accent-väljaren (cyan/amber/violet/lime).

import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch,
  LayoutAnimation, Platform, UIManager, Linking, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { DR, accentSoft, accentLine } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { listCertificates, certStatus, getDroneFlightCount } from '../../db/drones';
import { exportDroneFlightsToCSV } from '../../services/export';
import { useToastStore } from '../../components/Toast';
import { useProfileStore, type MainRole, type SubRole } from '../../store/profileStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlightStore } from '../../store/flightStore';
import { useTokenQuotaStore } from '../../store/tokenQuotaStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { getSetting, setSetting } from '../../db/flights';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SectionKey = 'logbook' | 'import' | 'data' | 'app';

export default function DroneSettingsScreen() {
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const profile = useProfileStore((s) => s.profile);
  const setProfile = useProfileStore((s) => s.setProfile);
  const setAppMode = useAppModeStore((s) => s.setMode);

  const { isPremium, isMax } = useFlightStore();
  const tokenUsage = useTokenQuotaStore((s) => s.usage);
  const timeFormat = useTimeFormatStore((s) => s.timeFormat);
  const setTimeFormat = useTimeFormatStore((s) => s.setTimeFormat);

  const [expanded, setExpanded] = useState<SectionKey | null>('logbook');
  const [credCount, setCredCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);
  const [flightCount, setFlightCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileInitials, setProfileInitials] = useState('');

  useFocusEffect(useCallback(() => {
    loadAccent();
    useTokenQuotaStore.getState().load();
    listCertificates().then((cs) => {
      setCredCount(cs.length);
      setExpiringCount(cs.filter((c) => ['critical', 'warning'].includes(certStatus(c.expires_date))).length);
    }).catch(() => {});
    getDroneFlightCount().then(setFlightCount).catch(() => {});
    (async () => {
      const first = (await getSetting('profile_first_name')) ?? '';
      const last = (await getSetting('profile_last_name')) ?? '';
      const initials = (await getSetting('profile_initials')) ?? '';
      setProfileName(`${first} ${last}`.trim());
      setProfileInitials(initials || `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase());
    })().catch(() => {});
  }, [loadAccent]));

  // Exportera BARA drone_flights (aldrig pilot-datat). Speglar manned-exportens flöde.
  const handleExportCsv = async () => {
    if (exporting) return;
    if (flightCount === 0) {
      useToastStore.getState().show('No drone flights to export yet');
      return;
    }
    setExporting(true);
    try {
      await exportDroneFlightsToCSV();
    } catch (e: any) {
      useToastStore.getState().show(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const toggle = (k: SectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(expanded === k ? null : k);
  };

  // Byt loggbok/läge (speglar manned switchProfile): spara nuvarande profil,
  // återställ ev. sparad profil för målrollen, sätt profil + appMode, navigera om.
  const switchTo = async (mainRole: MainRole, defaultSub: SubRole) => {
    setShowSwitch(false);
    let subRole: SubRole = defaultSub;
    try {
      const raw = await getSetting('additional_profiles');
      const saved: { mainRole: MainRole; subRole: SubRole }[] = raw ? JSON.parse(raw) : [];
      const existing = saved.find((p) => p.mainRole === mainRole);
      if (existing) subRole = existing.subRole;
      if (profile) {
        const next = saved.filter((p) => p.mainRole !== profile.mainRole && p.mainRole !== mainRole);
        next.push({ mainRole: profile.mainRole, subRole: profile.subRole });
        await setSetting('additional_profiles', JSON.stringify(next));
      }
    } catch {}
    await setProfile({ mainRole, subRole });
    const targetMode = mainRole === 'pilot-unmanned' ? 'drone' : 'manned';
    await setAppMode(targetMode);
    // Navigera explicit till rätt dashboard efter re-render (annars → href:null-ankaret = svart).
    const dest = targetMode === 'drone' ? '/(tabs)/drone-dashboard' : '/(tabs)';
    requestAnimationFrame(() => router.replace(dest as any));
  };

  return (
    <>
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
      <Text style={s.title}>Settings</Text>

      {/* Profilkort — avatar-header (= manned) */}
      <View style={s.card}>
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
            <Text style={{ fontSize: 12, color: DR.muted, marginTop: 2 }}>
              {credCount ? `${credCount} credentials${expiringCount ? ` · ${expiringCount} expiring` : ''}` : 'Tap to edit profile'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={DR.muted} />
        </TouchableOpacity>
        <Row accent={accent} icon="shield-checkmark-outline" iconColor={DR.success}
          title="Certificates & competency"
          subtitle={`${credCount} credentials${expiringCount ? ` · ${expiringCount} expiring` : ''}`}
          onPress={() => router.push('/settings/certificates')} />
        <Row accent={accent} icon="today-outline"
          title="Current today?" subtitle="Night, category recency & certificate currency"
          onPress={() => router.push('/currency')} />
        <Row accent={accent} icon="star-outline" iconColor={DR.warning} title="Blades Premium" subtitle="Manage subscription" onPress={() => router.push('/settings/premium')} />
      </View>

      {/* AI-token-mätare (= manned) */}
      {tokenUsage && (() => {
        const pct = Math.min(100, Math.round((tokenUsage.used / Math.max(tokenUsage.limit, 1)) * 100));
        const barColor = pct >= 90 ? DR.danger : pct >= 75 ? DR.warning : accent;
        return (
          <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }]}>
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: accentSoft(accent), borderWidth: 1, borderColor: accentLine(accent), alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="flash" size={15} color={accent} />
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: DR.text }}>AI tokens</Text>
                <Text style={{ fontSize: 11.5, color: DR.text3, fontFamily: MONO }}>
                  {tokenUsage.used.toLocaleString('en-US')} / {tokenUsage.limit.toLocaleString('en-US')}
                </Text>
              </View>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: DR.elevated, overflow: 'hidden' }}>
                <View style={{ height: 5, borderRadius: 3, width: `${pct}%`, backgroundColor: barColor }} />
              </View>
              <Text style={{ fontSize: 10.5, color: DR.muted }}>
                {tokenUsage.month === 'lifetime' ? 'Free one-time AI allowance · upgrade for monthly tokens' : 'AI usage this month · resets monthly'}
              </Text>
            </View>
          </View>
        );
      })()}

      {/* Logbook */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="LOGBOOK" open={expanded === 'logbook'} onPress={() => toggle('logbook')} />
        {expanded === 'logbook' && (
          <View style={s.card}>
            <Row accent={accent} icon="hardware-chip-outline" title="Logbook type" subtitle="Drone · Unmanned aircraft" first />
            <Row accent={accent} icon="swap-horizontal-outline" title="Switch logbook" subtitle="Pilot · Drone" onPress={() => setShowSwitch(true)} />
            <Row accent={accent} icon="list-outline" title="Manage drones" onPress={() => router.push('/settings/drones')} />
            <Row accent={accent} icon="book-outline" title="Your logbook" onPress={() => router.push('/drone-logbook')} />
          </View>
        )}
      </View>

      {/* Import — endast drönar-säkra vägar. CSV/controller-import bygger på egna
          drönar-parsers (kommer); tills dess bara manuell inmatning så inget hamnar
          i pilot-loggboken. */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="IMPORT" open={expanded === 'import'} onPress={() => toggle('import')} />
        {expanded === 'import' && (
          <View style={s.card}>
            <Row accent={accent} icon="add-circle-outline" title="Add manually" onPress={() => router.push('/drone-flight/add')} first />
            <Row accent={accent} icon="scan-outline" title="Scan controller log" subtitle="DJI / Autel — coming soon"
              right={<Text style={s.soon}>SOON</Text>} />
            <Row accent={accent} icon="document-text-outline" title="Import CSV" subtitle="Drone log CSV — coming soon"
              right={<Text style={s.soon}>SOON</Text>} />
          </View>
        )}
      </View>

      {/* Data & Export — exporterar BARA drone_flights (aldrig pilot-datat) */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="DATA & EXPORT" open={expanded === 'data'} onPress={() => toggle('data')} />
        {expanded === 'data' && (
          <View style={s.card}>
            <Row accent={accent} icon="cloud-outline" title="iCloud sync" subtitle="Coming soon" first
              right={<Switch value={false} disabled trackColor={{ true: accent, false: DR.elevated }} />} />
            <Row accent={accent} icon="download-outline" title="Export CSV"
              subtitle={flightCount > 0 ? `${flightCount} drone ${flightCount === 1 ? 'flight' : 'flights'}` : 'No flights yet'}
              onPress={handleExportCsv}
              right={exporting ? <ActivityIndicator size="small" color={accent} /> : undefined} />
          </View>
        )}
      </View>

      {/* App */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="APP" open={expanded === 'app'} onPress={() => toggle('app')} />
        {expanded === 'app' && (
          <View style={s.card}>
            {/* Tidsformat-toggle (= manned APP) */}
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: DR.elevated }]}>
                <Ionicons name="time-outline" size={17} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Time format</Text>
                <Text style={s.rowSub}>Decimal or hours:minutes</Text>
              </View>
              <View style={s.toggle}>
                <TouchableOpacity style={[s.toggleBtn, timeFormat === 'decimal' && { backgroundColor: accent }]} onPress={() => setTimeFormat('decimal')} activeOpacity={0.7}>
                  <Text style={[s.toggleText, { color: timeFormat === 'decimal' ? DR.inkOnAccent : DR.text3 }]}>1.5</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.toggleBtn, timeFormat === 'hhmm' && { backgroundColor: accent }]} onPress={() => setTimeFormat('hhmm')} activeOpacity={0.7}>
                  <Text style={[s.toggleText, { color: timeFormat === 'hhmm' ? DR.inkOnAccent : DR.text3 }]}>1:30</Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Accent-väljaren borttagen — förenat navy-tema med fast accent. */}
          </View>
        )}
      </View>

      {/* About — neutrala (ej accent-tonade) ikoner, + Version/Local storage (= manned) */}
      <View style={s.group}>
        <Text style={[s.sectionLabel, { paddingHorizontal: 4, paddingBottom: 10 }]}>ABOUT</Text>
        <View style={s.card}>
          <Row accent={accent} iconColor={DR.text3} icon="information-circle-outline" title="Version"
            right={<Text style={{ fontFamily: 'Menlo', fontSize: 13, color: DR.muted }}>1.0.0</Text>} first />
          <Row accent={accent} iconColor={DR.text3} icon="phone-portrait-outline" title="Local storage" subtitle="All data stored on this device" />
          <Row accent={accent} iconColor={DR.text3} icon="mail-outline" title="Support" subtitle="toreldjesper@gmail.com" onPress={() => Linking.openURL('mailto:toreldjesper@gmail.com')} />
          <Row accent={accent} iconColor={DR.text3} icon="globe-outline" title="Website" onPress={() => Linking.openURL('https://blades-app.com')} />
          <Row accent={accent} iconColor={DR.text3} icon="lock-closed-outline" title="Privacy policy" onPress={() => Linking.openURL('https://blades-app.com/privacy')} />
        </View>
      </View>
    </ScrollView>

    <Modal visible={showSwitch} transparent animationType="fade" onRequestClose={() => setShowSwitch(false)}>
      <Pressable style={s.backdrop} onPress={() => setShowSwitch(false)}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.sheetTitle}>Switch logbook</Text>
          <TouchableOpacity style={s.optRow} activeOpacity={0.8} onPress={() => switchTo('pilot-manned', 'fixed')}>
            <View style={[s.optIcon, { backgroundColor: DR.elevated }]}><Ionicons name="airplane-outline" size={18} color={accent} /></View>
            <View style={{ flex: 1 }}><Text style={s.rowTitle}>Pilot (manned)</Text><Text style={s.rowSub}>Fixed-wing / helicopter</Text></View>
            <Ionicons name="chevron-forward" size={16} color={DR.muted} />
          </TouchableOpacity>
          <View style={[s.optRow, s.optBorder]}>
            <View style={[s.optIcon, { backgroundColor: accentSoft(accent), borderColor: accentLine(accent), borderWidth: 1 }]}><Ionicons name="hardware-chip-outline" size={18} color={accent} /></View>
            <View style={{ flex: 1 }}><Text style={s.rowTitle}>Drone</Text><Text style={s.rowSub}>Unmanned aircraft</Text></View>
            <View style={[s.curChip, { borderColor: accentLine(accent), backgroundColor: accentSoft(accent) }]}><Text style={[s.curChipText, { color: accent }]}>CURRENT</Text></View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

function Row({ accent, icon, iconColor, title, subtitle, right, onPress, first }: {
  accent: string; icon: any; iconColor?: string; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; first?: boolean;
}) {
  const ic = iconColor ?? accent;
  const body = (
    <View style={[s.row, !first && { borderTopWidth: 1, borderTopColor: DR.separator }]}>
      <View style={[s.rowIcon, { backgroundColor: ic + '1A' }]}>
        <Ionicons name={icon} size={17} color={ic} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSub}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={DR.muted} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{body}</TouchableOpacity>;
}

// Kort-knapp-rubrik (= manned CollapsibleSectionHeader): rundad DR.surface-knapp,
// accent-färgad etikett/chevron när öppen.
function SectionHeader({ accent, label, open, onPress }: { accent: string; label: string; open: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.sectionBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.sectionBtnLabel, { color: open ? accent : DR.text }]}>{label}</Text>
      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={open ? accent : DR.text3} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.background },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: DR.text },

  card: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 16, overflow: 'hidden' },
  group: { gap: 0 },

  // Kort-knapp-rubrik (= manned): rundad DR.surface-knapp
  sectionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border },
  sectionBtnLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionLabel: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.8, color: DR.text3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: DR.text, fontSize: 14.5, fontWeight: '600' },
  rowSub: { color: DR.text3, fontSize: 11.5, marginTop: 2, fontFamily: MONO },

  toggle: { flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 8, padding: 3, gap: 3, borderWidth: 0.5, borderColor: DR.border },
  toggleBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  toggleText: { fontSize: 12, fontWeight: '700' },

  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  soon: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: DR.muted, borderWidth: 1, borderColor: DR.border, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden' },

  backdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
  sheet: { backgroundColor: DR.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 32, borderWidth: 1, borderColor: DR.border },
  sheetTitle: { fontFamily: SERIF, fontSize: 18, fontWeight: '500', color: DR.text, marginBottom: 6 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  optBorder: { borderTopWidth: 1, borderTopColor: DR.separator },
  optIcon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  curChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  curChipText: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});
