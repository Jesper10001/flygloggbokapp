import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BladesLogo } from '../components/BladesLogo';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppModeStore } from '../store/appModeStore';
import { useTranslation } from '../hooks/useTranslation';
import { getSetting } from '../db/flights';

// Ljus palett — matchar Blades-loggans bakgrund (vit) + märkesfärger
const P = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#D6DCE5',
  cardShadow: '#1F2A44',
  text: '#1F2A44',          // mörk navy, matchar "BLADES"-texten
  textSecondary: '#5A6B85',
  textMuted: '#8A96A8',
  accent: '#2FA8A5',         // teal, matchar vågen i loggan
  accentBg: '#2FA8A514',
  accentBorder: '#2FA8A555',
  activeBorder: '#1F2A44',
  activeBg: '#F5F8FC',
};

export default function ModePickerScreen() {
  const router = useRouter();
  const { mode, setMode } = useAppModeStore();
  const { t } = useTranslation();

  const pick = async (chosen: 'manned' | 'drone') => {
    if (chosen !== mode) await setMode(chosen);
    if (chosen === 'drone') {
      const previewDone = await getSetting('preview_done');
      const alwaysShowPreview = await getSetting('preview_always_show');
      if (previewDone !== '1' || alwaysShowPreview === '1') {
        router.replace('/preview');
        return;
      }
      const onboarded = await getSetting('drone_onboarded');
      if (onboarded !== '1') {
        router.replace('/drone-onboarding');
        return;
      }
    }
    if (chosen === 'manned') {
      const previewDone = await getSetting('manned_preview_done');
      const alwaysShowPreview = await getSetting('manned_preview_always_show');
      if (previewDone !== '1' || alwaysShowPreview === '1') {
        router.replace('/manned-preview');
        return;
      }
      const onboarded = await getSetting('manned_onboarded');
      if (onboarded !== '1') {
        router.replace('/manned-onboarding');
        return;
      }
    }
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BladesLogo size="large" />
        <View style={styles.wave} />
        <Text style={styles.title}>{t('mode_picker_title')}</Text>
        <Text style={styles.subtitle}>{t('mode_picker_subtitle')}</Text>
      </View>

      <View style={styles.cards}>
        <TouchableOpacity
          style={[styles.card, mode === 'manned' && styles.cardActive]}
          onPress={() => pick('manned')}
          activeOpacity={0.85}
        >
          <View style={styles.iconCircle}>
            <Ionicons name="airplane" size={34} color={P.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('mode_manned')}</Text>
            <Text style={styles.cardSub}>{t('mode_manned_sub')}</Text>
            {mode === 'manned' && <Text style={styles.lastUsed}>{t('last_used')}</Text>}
          </View>
          <Ionicons name="chevron-forward" size={20} color={P.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, mode === 'drone' && styles.cardActive]}
          onPress={() => pick('drone')}
          activeOpacity={0.85}
        >
          <View style={styles.iconCircle}>
            <Ionicons name="hardware-chip" size={34} color={P.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('mode_drone')}</Text>
            <Text style={styles.cardSub}>{t('mode_drone_sub')}</Text>
            {mode === 'drone' && <Text style={styles.lastUsed}>{t('last_used')}</Text>}
          </View>
          <Ionicons name="chevron-forward" size={20} color={P.textMuted} />
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>{t('mode_picker_footer')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: P.bg, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 44 },
  wave: {
    height: 3, width: 140, borderRadius: 2,
    backgroundColor: P.accent, opacity: 0.8,
    marginTop: -6, marginBottom: 22,
  },
  title: { color: P.text, fontSize: 24, fontWeight: '800', marginBottom: 6, textAlign: 'center', letterSpacing: 0.3 },
  subtitle: { color: P.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 10 },
  cards: { gap: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: P.card, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: P.cardBorder,
    shadowColor: P.cardShadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardActive: { borderColor: P.activeBorder, borderWidth: 2, backgroundColor: P.activeBg },
  iconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: P.accentBg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: P.accentBorder,
  },
  cardTitle: { color: P.text, fontSize: 17, fontWeight: '800' },
  cardSub: { color: P.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  lastUsed: {
    color: P.accent, fontSize: 10, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 4,
  },
  footer: { color: P.textMuted, fontSize: 11, textAlign: 'center', marginTop: 28, lineHeight: 16 },
});
