// Blades Essential → Settings: det som påverkar loggboken och exporten, plus support och juridik.
import { useState } from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { AppBackground } from '../../components/AppBackground';
import { GlassSurface } from '../../components/GlassDialog';
import { EssentialHeader, EssentialRow, useEssentialAccent } from '../../components/essential/EssentialUi';
import { useAppModeStore } from '../../store/appModeStore';
import { useRegulationStandardStore, type RegulationStandard } from '../../store/regulationStandardStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';

const STANDARDS: [RegulationStandard, string][] = [['easa', 'EASA · EU'], ['faa', 'FAA · USA'], ['caa', 'CAA · UK'], ['other', 'Other']];

export default function EssentialSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useEssentialAccent();
  const isDrone = useAppModeStore((s) => s.mode) === 'drone';
  const { timeFormat, setTimeFormat } = useTimeFormatStore();
  const { standard, setStandard } = useRegulationStandardStore();
  const [stdOpen, setStdOpen] = useState(false);

  const formatBtn = (value: 'decimal' | 'hhmm', label: string) => {
    const on = timeFormat === value;
    return (
      <TouchableOpacity onPress={() => setTimeFormat(value)} activeOpacity={0.8} accessibilityRole="radio" accessibilityState={{ selected: on }}
        style={{ paddingHorizontal: 12, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? accent + '2A' : 'transparent' }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: on ? accent : Colors.textSecondary }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <AppBackground accent={accent} />
      <EssentialHeader title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View>
          <GlassSurface radius={20} />
          <EssentialRow icon="person-outline" accent={accent} title="Name and signature" subtitle="Shown on your exported pages" onPress={() => router.push('/settings/profile')} />
          <EssentialRow icon="time-outline" accent={accent} title="Time format" border={!isDrone}
            right={<View style={{ flexDirection: 'row', gap: 2 }}>{formatBtn('decimal', '1.5')}{formatBtn('hhmm', '1:30')}</View>} />
          {!isDrone && (
            <>
              <EssentialRow icon="globe-outline" accent={accent} title="Pilot Certification Standard" border={false}
                subtitle={STANDARDS.find(([k]) => k === standard)?.[1]} onPress={() => setStdOpen((o) => !o)}
                right={<Ionicons name={stdOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />} />
              {stdOpen && STANDARDS.map(([k, label]) => (
                <TouchableOpacity key={k} onPress={() => { setStandard(k); setStdOpen(false); }} activeOpacity={0.7} accessibilityRole="radio" accessibilityState={{ selected: standard === k }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingLeft: 62, paddingRight: 16, borderTopWidth: 0.5, borderTopColor: Colors.separator }}>
                  <Text style={{ fontSize: 14, fontWeight: standard === k ? '700' : '500', color: standard === k ? accent : Colors.textPrimary }}>{label}</Text>
                  {standard === k ? <Ionicons name="checkmark" size={16} color={accent} /> : null}
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
        <View>
          <GlassSurface radius={20} />
          <EssentialRow icon="folder-open-outline" accent={accent} title="Manage app data" subtitle="See your data · clear everything" onPress={() => router.push('/settings/manage-data')} />
          <EssentialRow icon="mail-outline" accent={accent} title="Support" subtitle="support@blades-app.com" onPress={() => Linking.openURL('mailto:support@blades-app.com')} />
          <EssentialRow icon="document-text-outline" accent={accent} title="Privacy policy" onPress={() => Linking.openURL('https://blades-app.com/privacy.html')} />
          <EssentialRow icon="ribbon-outline" accent={accent} title="Acknowledgements" subtitle="Open data, open-source software & licenses" onPress={() => router.push('/settings/acknowledgements')} border={false} />
        </View>
        <Text style={{ textAlign: 'center', fontSize: 12, color: Colors.textSecondary }}>Blades {Constants.expoConfig?.version ?? ''}</Text>
      </ScrollView>
    </View>
  );
}
