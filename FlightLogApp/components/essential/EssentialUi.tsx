// Delade delar för Blades Essentials undersidor: rubrik med tillbakaknapp, lägets accentfärg och en rad med ikon.
import { type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { FONT_SERIF } from '../logbook-page/tokens';
import { useAppModeStore } from '../../store/appModeStore';
import { useDroneAccentStore } from '../../store/droneAccentStore';

export function useEssentialAccent(): string {
  const isDrone = useAppModeStore((s) => s.mode) === 'drone';
  const droneAccent = useDroneAccentStore((s) => s.color);
  return isDrone ? droneAccent : Colors.primary;
}

export function EssentialHeader({ title }: { title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
      </TouchableOpacity>
      <Text style={{ flex: 1, fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: Colors.textPrimary }} numberOfLines={1}>{title}</Text>
    </View>
  );
}

export function EssentialRow({ icon, accent, title, subtitle, right, onPress, border = true }: {
  icon: keyof typeof Ionicons.glyphMap; accent: string; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; border?: boolean;
}) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: border ? 0.5 : 0, borderBottomColor: Colors.separator }}>
      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: accent + '22', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} /> : null)}
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={title}>{content}</TouchableOpacity> : content;
}
