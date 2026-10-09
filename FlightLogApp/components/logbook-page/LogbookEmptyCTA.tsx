// Tom-tillstånd i loggboken (List-vyn) när man INTE har någon registrerad flygning: rubrik + tre vägar in.
// Visas bara när loggboken faktiskt är tom (inte vid filtrerad/sökt tom träff) och försvinner så fort man
// har minst en flygning. Delas av pilot- och drönarläget (accent-prop skiljer dem åt).
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_SERIF } from './tokens';

export function LogbookEmptyCTA({ accent, mode }: { accent: string; mode: 'pilot' | 'drone' }) {
  const router = useRouter();
  const drone = mode === 'drone';
  const options: { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }[] = [
    { icon: 'document-attach-outline', label: 'Import CSV/Excel', route: drone ? '/drone-import' : '/import' },
    { icon: 'create-outline', label: 'Log flight manually', route: drone ? '/drone-import/manual' : '/import/manual' },
    { icon: 'airplane', label: 'Log flight', route: drone ? '/drone-flight/add' : '/flight/add' },
  ];
  return (
    <View style={{ alignItems: 'center', paddingVertical: 44, paddingHorizontal: 22 }}>
      <Ionicons name={drone ? 'rocket-outline' : 'airplane-outline'} size={44} color={Colors.textMuted} />
      <Text style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center', marginTop: 14 }}>
        No flights yet?
      </Text>
      <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 22 }}>
        Get started by one of three options:
      </Text>
      <View style={{ alignSelf: 'stretch', gap: 10 }}>
        {options.map((o) => (
          <TouchableOpacity
            key={o.label}
            onPress={() => router.push(o.route as any)}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14,
              borderWidth: 1, borderColor: accent + '55', backgroundColor: accent + '14',
            }}>
            <Ionicons name={o.icon} size={20} color={accent} />
            <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: Colors.textPrimary }}>{o.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
