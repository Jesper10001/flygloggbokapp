import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

// ── Eyebrow chip ──────────────────────────────────────────────────────────
export function Eyebrow({ children, accent = Colors.gold }: { children: React.ReactNode; accent?: string }) {
  return (
    <View style={[s.eyebrow, { backgroundColor: accent + '1F', borderColor: accent + '55' }]}>
      <View style={[s.eyebrowDot, { backgroundColor: accent, shadowColor: accent }]} />
      <Text style={[s.eyebrowText, { color: accent }]}>{children}</Text>
    </View>
  );
}

// ── Stat block ─────────────────────────────────────────────────────────────
export function Stat({ label, value, valueColor = Colors.textPrimary, fontFamily = 'Menlo' }: {
  label: string;
  value: string | number;
  valueColor?: string;
  fontFamily?: string;
}) {
  return (
    <View style={s.statBlock}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color: valueColor, fontFamily }]}>{value}</Text>
    </View>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
export function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionEyebrow}>{eyebrow}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── Primary CTA button ─────────────────────────────────────────────────────
export function PrimaryCTA({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.primaryCTA, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        // Loading spinner
        <View style={{ width: 16, height: 16 }} />
      ) : icon ? (
        <Ionicons name={icon as any} size={16} color={Colors.textInverse} style={{ marginRight: 8 }} />
      ) : null}
      <Text style={s.primaryCTAText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Ghost / Secondary CTA ──────────────────────────────────────────────────
export function SecondaryCTA({
  label,
  onPress,
  icon,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.secondaryCTA, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      {icon && <Ionicons name={icon as any} size={16} color={Colors.textPrimary} style={{ marginRight: 8 }} />}
      <Text style={s.secondaryCTAText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  eyebrow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
  },
  eyebrowDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 4,
  },
  eyebrowText: {
    fontFamily: 'Menlo',
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  statBlock: {
    gap: 4,
  },
  statLabel: {
    fontFamily: 'Menlo',
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 0,
  },

  sectionHeader: {
    gap: 4,
  },
  sectionEyebrow: {
    fontFamily: 'Menlo',
    fontSize: 9.5,
    fontWeight: '700',
    color: Colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontFamily: 'Fraunces',
    fontSize: 22,
    fontWeight: '500',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
    lineHeight: 1.1,
  },

  primaryCTA: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 8,
  },
  primaryCTAText: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textInverse,
    letterSpacing: -0.15,
  },

  secondaryCTA: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  secondaryCTAText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    letterSpacing: -0.1,
  },
});
