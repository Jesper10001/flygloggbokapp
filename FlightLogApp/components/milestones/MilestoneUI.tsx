import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';

export const MONO = 'JetBrainsMono';
export const SERIF = 'Fraunces';

// ── Sticky blurred header: back · centered title · share ──
export function MilestoneHeader({
  title, accent, topInset, onBack, onShare,
}: { title: string; accent: string; topInset: number; onBack: () => void; onShare?: () => void }) {
  const { t } = useTranslation();
  return (
    <BlurView intensity={28} tint="dark" style={[h.bar, { paddingTop: topInset + 8 }]}>
      <Pressable onPress={onBack} style={h.back} hitSlop={8}>
        <Ionicons name="chevron-back" size={20} color={accent} />
        <Text style={[h.backLabel, { color: accent }]}>{t('tab_dashboard')}</Text>
      </Pressable>
      <Text style={h.title} numberOfLines={1}>{title}</Text>
      <Pressable onPress={onShare} style={[h.share, { backgroundColor: accent + '1A' }]} hitSlop={8}>
        <Ionicons name="share-outline" size={16} color={accent} />
      </Pressable>
    </BlurView>
  );
}

export function Eyebrow({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <View style={[u.eyebrow, { backgroundColor: accent + '1F', borderColor: accent + '55' }]}>
      <View style={[u.eyebrowDot, { backgroundColor: accent }]} />
      <Text style={[u.eyebrowText, { color: accent }]}>{children}</Text>
    </View>
  );
}

export function SectionHead({ eyebrow, title, accent }: { eyebrow: string; title: string; accent: string }) {
  return (
    <View style={u.sectionHead}>
      <Text style={[u.sectionEyebrow, { color: accent }]}>{eyebrow.toUpperCase()}</Text>
      <Text style={u.sectionTitle}>{title}</Text>
    </View>
  );
}

export function StatBlock({
  label, value, color, serif,
}: { label: string; value: string; color?: string; serif?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={u.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[u.statValue, serif && { fontFamily: SERIF }, { color: color ?? Colors.textPrimary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[u.card, style]}>{children}</View>;
}

// ── Top-5 ranked bar list (shared by Best Week / Longest XC) ──
export interface Top5Item {
  rank: number;
  label: string;   // "v.15 · 2026" or "ESSA → EGLL"
  range: string;   // "06 Apr" or "12 Jun 2024"
  value: string;   // "24:30" or "1,280"
  unit: string;    // "HRS" / "NM"
  pct: number;     // 0..100
  current: boolean;
}

export function Top5Bars({ items, accent }: { items: Top5Item[]; accent: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12 }}>
      {items.map(it => (
        <View key={it.rank} style={{ gap: 5 }}>
          <View style={u.t5Row}>
            <View style={u.t5Left}>
              <Text style={[u.t5Rank, { color: it.current ? accent : Colors.textMuted }]}>
                {String(it.rank).padStart(2, '0')}
              </Text>
              <Text style={[u.t5Label, { color: it.current ? Colors.textPrimary : Colors.textSecondary }]} numberOfLines={1}>
                {it.label}
              </Text>
              {it.current && <Text style={[u.t5Best, { color: accent }]}>· {t('ms.best').toUpperCase()}</Text>}
            </View>
            <View style={u.t5Right}>
              <Text style={u.t5Range}>{it.range}</Text>
              <Text style={[u.t5Value, { color: it.current ? accent : Colors.textSecondary }]}>
                {it.value}<Text style={u.t5Unit}> {it.unit}</Text>
              </Text>
            </View>
          </View>
          <View style={u.t5Track}>
            <View style={[u.t5Fill, { width: `${it.pct}%`, backgroundColor: it.current ? accent : Colors.cardBorder }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function PrimaryCTA({ label, icon, accent, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; accent: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [u.primaryBtn, { backgroundColor: accent, opacity: pressed ? 0.9 : 1 }]}>
      <Ionicons name={icon} size={16} color={Colors.textInverse} />
      <Text style={[u.primaryLabel, { color: Colors.textInverse }]}>{label}</Text>
    </Pressable>
  );
}

export function GhostCTA({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [u.ghostBtn, { opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={15} color={Colors.textPrimary} />
      <Text style={u.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

const h = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingBottom: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 92 },
  backLabel: { fontSize: 16, fontWeight: '500' },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  share: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minWidth: 32 },
});

const u = StyleSheet.create({
  eyebrow: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
  },
  eyebrowDot: { width: 5, height: 5, borderRadius: 2.5 },
  eyebrowText: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },

  sectionHead: { gap: 4 },
  sectionEyebrow: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.8 },
  sectionTitle: { fontFamily: SERIF, fontSize: 22, fontWeight: '500', color: Colors.textPrimary, letterSpacing: -0.4 },

  statLabel: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textMuted },
  statValue: { fontFamily: MONO, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },

  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 16 },

  t5Row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  t5Left: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  t5Rank: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700' },
  t5Label: { fontFamily: MONO, fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  t5Best: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1 },
  t5Right: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  t5Range: { fontFamily: MONO, fontSize: 10, color: Colors.textMuted },
  t5Value: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  t5Unit: { fontSize: 8.5, color: Colors.textMuted, letterSpacing: 1 },
  t5Track: { height: 4, borderRadius: 99, backgroundColor: 'rgba(127,168,200,0.10)', overflow: 'hidden' },
  t5Fill: { height: '100%', borderRadius: 99 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, paddingHorizontal: 18, borderRadius: 14,
  },
  primaryLabel: { fontSize: 15, fontWeight: '700', letterSpacing: -0.15 },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 18, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  ghostLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
});
