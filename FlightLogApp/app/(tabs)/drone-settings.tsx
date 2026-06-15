// Drönar-settings (More) — egen skärm i navy DR + trådbar accent. Speglar manned
// (profilkort → collapsible sektioner → about) men med drönar-relevanta rader och
// accent-väljaren (cyan/amber/violet/lime).

import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch,
  LayoutAnimation, Platform, UIManager, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { DR, accentSoft, accentLine, DRONE_ACCENTS, DRONE_ACCENT_ORDER } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useLanguageStore } from '../../store/languageStore';
import { listCertificates, certStatus } from '../../db/drones';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SectionKey = 'logbook' | 'import' | 'data' | 'app';

export default function DroneSettingsScreen() {
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const accentKey = useDroneAccentStore((s) => s.key);
  const setAccent = useDroneAccentStore((s) => s.setAccent);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const [expanded, setExpanded] = useState<SectionKey | null>('logbook');
  const [credCount, setCredCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);

  useFocusEffect(useCallback(() => {
    loadAccent();
    listCertificates().then((cs) => {
      setCredCount(cs.length);
      setExpiringCount(cs.filter((c) => ['critical', 'warning'].includes(certStatus(c.expires_date))).length);
    }).catch(() => {});
  }, [loadAccent]));

  const toggle = (k: SectionKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(expanded === k ? null : k);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
      <Text style={s.title}>Settings</Text>

      {/* Profilkort */}
      <View style={s.card}>
        <Row accent={accent} icon="person-circle-outline" title="Drone pilot" subtitle="Unmanned aircraft" onPress={() => router.push('/settings/profile')} first />
        <Row accent={accent} icon="shield-checkmark-outline"
          title="Certificates & competency"
          subtitle={`${credCount} credentials${expiringCount ? ` · ${expiringCount} expiring` : ''}`}
          onPress={() => router.push('/settings/certificates')} />
        <Row accent={accent} icon="star-outline" title="Blades Premium" subtitle="Manage subscription" onPress={() => router.push('/settings/premium')} />
      </View>

      {/* Logbook */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="LOGBOOK" open={expanded === 'logbook'} onPress={() => toggle('logbook')} />
        {expanded === 'logbook' && (
          <View style={s.card}>
            <Row accent={accent} icon="hardware-chip-outline" title="Logbook type" subtitle="Drone · Unmanned aircraft" first />
            <Row accent={accent} icon="list-outline" title="Manage drones" onPress={() => router.push('/settings/drones')} />
            <Row accent={accent} icon="book-outline" title="Your logbook" onPress={() => router.push('/drone-book')} />
            <Row accent={accent} icon="time-outline" title="Audit log" onPress={() => router.push('/settings/auditlog')} />
          </View>
        )}
      </View>

      {/* Import */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="IMPORT" open={expanded === 'import'} onPress={() => toggle('import')} />
        {expanded === 'import' && (
          <View style={s.card}>
            <Row accent={accent} icon="document-text-outline" title="Import CSV" onPress={() => router.push('/import')} first />
            <Row accent={accent} icon="scan-outline" title="Scan controller log" subtitle="DJI / Autel export" onPress={() => router.push('/import/scan')} />
            <Row accent={accent} icon="add-circle-outline" title="Add manually" onPress={() => router.push('/drone-flight/add')} />
          </View>
        )}
      </View>

      {/* Data & Export */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="DATA & EXPORT" open={expanded === 'data'} onPress={() => toggle('data')} />
        {expanded === 'data' && (
          <View style={s.card}>
            <Row accent={accent} icon="cloud-outline" title="iCloud sync" subtitle="Coming soon" first
              right={<Switch value={false} disabled trackColor={{ true: accent, false: DR.elevated }} />} />
            <Row accent={accent} icon="download-outline" title="Export CSV" subtitle="EASA format" onPress={() => router.push('/settings/custom-export')} />
            <Row accent={accent} icon="options-outline" title="Custom export" onPress={() => router.push('/settings/custom-export')} />
          </View>
        )}
      </View>

      {/* App */}
      <View style={s.group}>
        <SectionHeader accent={accent} label="APP" open={expanded === 'app'} onPress={() => toggle('app')} />
        {expanded === 'app' && (
          <View style={s.card}>
            <Row accent={accent} icon="language-outline" title="Language" first right={
              <View style={s.toggle}>
                {(['en', 'sv'] as const).map((l) => (
                  <TouchableOpacity key={l} onPress={() => setLanguage(l)} style={[s.toggleBtn, language === l && { backgroundColor: accent }]}>
                    <Text style={[s.toggleText, { color: language === l ? DR.inkOnAccent : DR.muted }]}>{l === 'en' ? 'ENG' : 'SWE'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            } />
            {/* Accent-väljare */}
            <View style={[s.row, { borderTopWidth: 1, borderTopColor: DR.separator }]}>
              <View style={[s.rowIcon, { backgroundColor: accentSoft(accent), borderColor: accentLine(accent), borderWidth: 1 }]}>
                <Ionicons name="color-palette-outline" size={17} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Accent</Text>
                <Text style={s.rowSub}>Drone signature colour</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {DRONE_ACCENT_ORDER.map((k) => (
                  <TouchableOpacity key={k} onPress={() => setAccent(k)} activeOpacity={0.8}
                    style={[s.swatch, { backgroundColor: DRONE_ACCENTS[k], borderColor: accentKey === k ? DR.text : 'transparent' }]}>
                    {accentKey === k && <Ionicons name="checkmark" size={15} color={DR.inkOnAccent} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>

      {/* About */}
      <View style={s.group}>
        <Text style={[s.sectionLabel, { paddingHorizontal: 4, paddingBottom: 10 }]}>ABOUT</Text>
        <View style={s.card}>
          <Row accent={accent} icon="mail-outline" title="Support" subtitle="toreldjesper@gmail.com" onPress={() => Linking.openURL('mailto:toreldjesper@gmail.com')} first />
          <Row accent={accent} icon="globe-outline" title="Website" onPress={() => Linking.openURL('https://blades-app.com')} />
          <Row accent={accent} icon="lock-closed-outline" title="Privacy policy" onPress={() => Linking.openURL('https://blades-app.com/privacy')} />
        </View>
      </View>
    </ScrollView>
  );
}

function Row({ accent, icon, title, subtitle, right, onPress, first }: {
  accent: string; icon: any; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; first?: boolean;
}) {
  const body = (
    <View style={[s.row, !first && { borderTopWidth: 1, borderTopColor: DR.separator }]}>
      <View style={[s.rowIcon, { backgroundColor: DR.elevated }]}>
        <Ionicons name={icon} size={17} color={accent} />
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

function SectionHeader({ accent, label, open, onPress }: { accent: string; label: string; open: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.sectionHeader} onPress={onPress} activeOpacity={0.7}>
      <Text style={[s.sectionLabel, open && { color: accent }]}>{label}</Text>
      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={open ? accent : DR.muted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.background },
  title: { fontFamily: SERIF, fontSize: 26, fontWeight: '500', letterSpacing: -0.5, color: DR.text },

  card: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 16, overflow: 'hidden' },
  group: { gap: 0 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 10 },
  sectionLabel: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.8, color: DR.text3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: DR.text, fontSize: 14.5, fontWeight: '600' },
  rowSub: { color: DR.text3, fontSize: 11.5, marginTop: 2, fontFamily: MONO },

  toggle: { flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 8, padding: 3, gap: 3, borderWidth: 0.5, borderColor: DR.border },
  toggleBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  toggleText: { fontSize: 12, fontWeight: '700' },

  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
