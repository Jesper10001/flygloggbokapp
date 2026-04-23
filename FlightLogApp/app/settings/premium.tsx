import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { PREMIUM_PRICE_MONTHLY, PREMIUM_PRICE_YEARLY, PREMIUM_PRICE_YEARLY_MONTHLY } from '../../components/PremiumModal';

type IoniconsName = keyof typeof Ionicons.glyphMap;

interface Feature {
  icon: IoniconsName;
  color: string;
  title: string;
  desc: string;
  timeSaved?: string;
}

export default function PremiumScreen() {
  const { t } = useTranslation();
  const { isPremium, setIsPremium } = useFlightStore();

  type Category = { title: string; desc: string; features: Feature[] };

  const categories: Category[] = [
    {
      title: t('prem_cat_import'),
      desc: t('prem_cat_import_desc'),
      features: [
        { icon: 'camera', color: Colors.primary, title: t('prem_feat_scan_title'), desc: t('prem_feat_scan_desc'), timeSaved: t('prem_feat_scan_time') },
        { icon: 'cloud-upload', color: Colors.primary, title: t('prem_feat_import_title'), desc: t('prem_feat_import_desc'), timeSaved: t('prem_feat_import_time') },
        { icon: 'cart', color: Colors.gold, title: t('prem_feat_packs_title'), desc: t('prem_feat_packs_desc') },
      ],
    },
    {
      title: t('prem_cat_logging'),
      desc: t('prem_cat_logging_desc'),
      features: [
        { icon: 'sparkles', color: Colors.gold, title: t('prem_feat_ai_title'), desc: t('prem_feat_ai_desc'), timeSaved: t('prem_feat_ai_time') },
        { icon: 'globe', color: Colors.info, title: t('prem_feat_icao_title'), desc: t('prem_feat_icao_desc') },
      ],
    },
    {
      title: t('prem_cat_tools'),
      desc: t('prem_cat_tools_desc'),
      features: [
        { icon: 'calculator', color: Colors.info, title: t('prem_feat_summary_title'), desc: t('prem_feat_summary_desc'), timeSaved: t('prem_feat_summary_time') },
        { icon: 'create', color: Colors.info, title: t('prem_feat_transcribe_title'), desc: t('prem_feat_transcribe_desc'), timeSaved: t('prem_feat_transcribe_time') },
      ],
    },
    {
      title: t('prem_cat_export'),
      desc: t('prem_cat_export_desc'),
      features: [
        { icon: 'document-text', color: Colors.success, title: t('prem_feat_pdf_title'), desc: t('prem_feat_pdf_desc') },
        { icon: 'cloud-download', color: Colors.primary, title: t('prem_feat_csv_title'), desc: t('prem_feat_csv_desc') },
      ],
    },
  ];

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Hero */}
      <View style={s.hero}>
        <View style={s.starCircle}>
          <Ionicons name="star" size={36} color={Colors.gold} />
        </View>
        <Text style={s.heroTitle}>Blades Premium</Text>
        <Text style={s.heroDesc}>{t('prem_hero_desc')}</Text>
        {isPremium && (
          <View style={s.activeBadge}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
            <Text style={s.activeBadgeText}>{t('prem_active')}</Text>
          </View>
        )}
      </View>

      {/* Time savings summary */}
      <View style={s.savingsCard}>
        <Ionicons name="time" size={20} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.savingsTitle}>{t('prem_time_title')}</Text>
          <Text style={s.savingsDesc}>{t('prem_time_desc')}</Text>
        </View>
      </View>

      {/* Categorized features */}
      {categories.map((cat, ci) => (
        <View key={ci} style={s.categoryBlock}>
          <Text style={s.categoryTitle}>{cat.title}</Text>
          <Text style={s.categoryDesc}>{cat.desc}</Text>
          {cat.features.map((f, fi) => (
            <View key={fi} style={s.featureCard}>
              <View style={[s.featureIcon, { backgroundColor: f.color + '18' }]}>
                <Ionicons name={f.icon} size={20} color={f.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureDesc}>{f.desc}</Text>
                {f.timeSaved && (
                  <View style={s.timeBadge}>
                    <Ionicons name="time-outline" size={11} color={Colors.success} />
                    <Text style={s.timeBadgeText}>{f.timeSaved}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      ))}

      {/* Pricing */}
      {!isPremium && (
        <>
          <Text style={s.pricingTitle}>{t('prem_pricing_title')}</Text>
          <TouchableOpacity style={s.yearlyBtn} onPress={() => setIsPremium(true)} activeOpacity={0.85}>
            <Text style={s.yearlyLabel}>{t('premium_monthly')}</Text>
            <Text style={s.yearlyPrice}>{PREMIUM_PRICE_MONTHLY} kr/{t('premium_month_short')}</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={s.legal}>{t('premium_legal')}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  hero: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  starCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.gold + '18', alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { color: Colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  heroDesc: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.success + '18', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 8, borderWidth: 0.5, borderColor: Colors.success + '44',
  },
  activeBadgeText: { color: Colors.success, fontSize: 13, fontWeight: '700' },

  savingsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.primary + '0E', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.primary + '22',
  },
  savingsTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  savingsDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },

  categoryBlock: { gap: 8 },
  categoryTitle: {
    color: Colors.textPrimary, fontSize: 16, fontWeight: '800',
    letterSpacing: -0.3, marginTop: 4,
  },
  categoryDesc: {
    color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 2,
  },
  featureCard: {
    flexDirection: 'row', gap: 14,
    backgroundColor: Colors.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  featureIcon: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  featureTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  featureDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  timeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6,
  },
  timeBadgeText: { color: Colors.success, fontSize: 11, fontWeight: '700' },

  pricingTitle: {
    color: Colors.textPrimary, fontSize: 18, fontWeight: '800',
    textAlign: 'center', marginTop: 8,
  },
  yearlyBtn: {
    backgroundColor: Colors.primary, borderRadius: 14, padding: 18,
    alignItems: 'center', gap: 4,
  },
  yearlyBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4,
  },
  yearlyBadgeText: { color: Colors.textInverse, fontSize: 11, fontWeight: '800' },
  yearlyLabel: { color: Colors.textInverse, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.8 },
  yearlyPrice: { color: Colors.textInverse, fontSize: 28, fontWeight: '800', fontFamily: 'Menlo' },
  yearlyPerMonth: { color: Colors.textInverse, fontSize: 12, fontWeight: '600', opacity: 0.8 },

  monthlyBtn: {
    backgroundColor: Colors.elevated, borderRadius: 14, padding: 16,
    alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.border,
  },
  monthlyLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  monthlyPrice: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', fontFamily: 'Menlo' },

  legal: {
    color: Colors.textMuted, fontSize: 10, textAlign: 'center',
    lineHeight: 14, paddingVertical: 12,
  },
});
