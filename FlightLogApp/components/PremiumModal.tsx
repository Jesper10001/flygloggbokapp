import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useFlightStore } from '../store/flightStore';

export const PREMIUM_PRICE_MONTHLY = 69;
export const PREMIUM_PRICE_YEARLY = 499;
export const PREMIUM_PRICE_YEARLY_MONTHLY = Math.round(PREMIUM_PRICE_YEARLY / 12);

interface Props {
  visible: boolean;
  onClose: () => void;
  feature?: string;
}

export function PremiumModal({ visible, onClose, feature }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { setIsPremium } = useFlightStore();

  const handlePurchaseMonthly = () => {
    // TODO: Implement actual IAP
    setIsPremium(true);
    onClose();
  };

  const handlePurchaseYearly = () => {
    // TODO: Implement actual IAP
    setIsPremium(true);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={s.header}>
              <TouchableOpacity onPress={onClose} hitSlop={10} style={s.closeBtn}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
              <View style={s.iconCircle}>
                <Ionicons name="star" size={28} color={Colors.gold} />
              </View>
              <Text style={s.title}>{t('premium_modal_title')}</Text>
              {feature && (
                <View style={s.featureBadge}>
                  <Ionicons name="lock-closed" size={11} color={Colors.gold} />
                  <Text style={s.featureBadgeText}>{feature}</Text>
                </View>
              )}
              <Text style={s.desc}>{t('premium_modal_desc')}</Text>
            </View>

            {/* Highlights */}
            <View style={s.highlights}>
              {[
                { icon: 'camera' as const, text: t('premium_feat_scan') },
                { icon: 'calculator' as const, text: t('premium_feat_summarize') },
                { icon: 'sparkles' as const, text: t('premium_feat_ai') },
                { icon: 'document-text' as const, text: t('premium_feat_pdf') },
                { icon: 'cloud-upload' as const, text: t('premium_feat_import') },
              ].map((h, i) => (
                <View key={i} style={s.highlightRow}>
                  <Ionicons name={h.icon} size={16} color={Colors.primary} />
                  <Text style={s.highlightText}>{h.text}</Text>
                </View>
              ))}
            </View>

            {/* Pricing */}
            <View style={s.priceCards}>
              {/* Yearly — best value */}
              <TouchableOpacity style={[s.priceCard, s.priceCardBest]} onPress={handlePurchaseYearly} activeOpacity={0.85}>
                <View style={s.saveBadge}>
                  <Text style={s.saveBadgeText}>{t('premium_save_40')}</Text>
                </View>
                <Text style={s.priceCardLabel}>{t('premium_yearly')}</Text>
                <View style={s.priceRow}>
                  <Text style={s.priceAmount}>{PREMIUM_PRICE_YEARLY}</Text>
                  <Text style={s.priceCurrency}>kr/{t('premium_year_short')}</Text>
                </View>
                <Text style={s.pricePerMonth}>{PREMIUM_PRICE_YEARLY_MONTHLY} kr/{t('premium_month_short')}</Text>
              </TouchableOpacity>

              {/* Monthly */}
              <TouchableOpacity style={s.priceCard} onPress={handlePurchaseMonthly} activeOpacity={0.85}>
                <Text style={s.priceCardLabel}>{t('premium_monthly')}</Text>
                <View style={s.priceRow}>
                  <Text style={s.priceAmount}>{PREMIUM_PRICE_MONTHLY}</Text>
                  <Text style={s.priceCurrency}>kr/{t('premium_month_short')}</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Discover all */}
            <TouchableOpacity
              style={s.discoverBtn}
              onPress={() => { onClose(); setTimeout(() => router.push('/settings/premium'), 300); }}
              activeOpacity={0.75}
            >
              <Ionicons name="arrow-forward-circle" size={18} color={Colors.primary} />
              <Text style={s.discoverBtnText}>{t('premium_discover_all')}</Text>
            </TouchableOpacity>

            <Text style={s.legal}>{t('premium_legal')}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  sheet: {
    backgroundColor: Colors.surface, borderRadius: 20,
    width: '100%', maxWidth: 380, maxHeight: '85%', overflow: 'hidden',
  },
  header: { alignItems: 'center', padding: 24, paddingBottom: 16 },
  closeBtn: { position: 'absolute', top: 14, right: 14, zIndex: 1 },
  iconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.gold + '1A', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  featureBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.gold + '18', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, marginTop: 8, borderWidth: 0.5, borderColor: Colors.gold + '44',
  },
  featureBadgeText: { color: Colors.gold, fontSize: 12, fontWeight: '700' },
  desc: {
    color: Colors.textSecondary, fontSize: 14, lineHeight: 20,
    textAlign: 'center', marginTop: 10, paddingHorizontal: 8,
  },

  highlights: { paddingHorizontal: 24, gap: 10, marginBottom: 16 },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  highlightText: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', flex: 1 },

  priceCards: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  priceCard: {
    flex: 1, backgroundColor: Colors.elevated, borderRadius: 14, padding: 16,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border, gap: 4,
  },
  priceCardBest: {
    borderColor: Colors.primary, backgroundColor: Colors.primary + '0A',
  },
  saveBadge: {
    backgroundColor: Colors.primary, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4,
  },
  saveBadgeText: { color: Colors.textInverse, fontSize: 10, fontWeight: '800' },
  priceCardLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  priceAmount: { color: Colors.textPrimary, fontSize: 28, fontWeight: '800', fontFamily: 'Menlo' },
  priceCurrency: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  pricePerMonth: { color: Colors.primary, fontSize: 11, fontWeight: '700' },

  discoverBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, paddingVertical: 12, borderRadius: 10,
    backgroundColor: Colors.primary + '0E', borderWidth: 1, borderColor: Colors.primary + '33',
  },
  discoverBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  legal: {
    color: Colors.textMuted, fontSize: 10, textAlign: 'center',
    paddingHorizontal: 24, paddingVertical: 16, lineHeight: 14,
  },
});
