import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { setSetting } from '../db/flights';

export default function MannedOnboardingScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const styles = makeStyles();

  const markDone = async () => setSetting('manned_onboarded', '1');

  const finish = async () => {
    await markDone();
    router.replace('/(tabs)');
  };

  const goImport = async () => {
    await markDone();
    router.replace('/(tabs)');
    setTimeout(() => router.push('/import'), 200);
  };

  const goAddFlight = async () => {
    await markDone();
    router.replace('/(tabs)');
    setTimeout(() => router.push('/flight/add'), 200);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progress}>
        <View style={[styles.progressDot, step >= 0 && styles.progressDotActive]} />
        <View style={[styles.progressDot, step >= 1 && styles.progressDotActive]} />
      </View>

      {step === 0 ? (
        <View style={styles.step}>
          <View style={styles.iconWrap}>
            <Ionicons name="airplane" size={56} color={Colors.primary} />
          </View>
          <Text style={styles.title}>{t('manned_onb_1_title')}</Text>
          <Text style={styles.body}>{t('manned_onb_1_body')}</Text>
          <View style={styles.bullets}>
            <Bullet text={t('manned_onb_bullet_easa')} />
            <Bullet text={t('manned_onb_bullet_ocr')} />
            <Bullet text={t('manned_onb_bullet_export')} />
          </View>
        </View>
      ) : (
        <View style={styles.step}>
          <View style={styles.iconWrap}>
            <Ionicons name="rocket" size={56} color={Colors.primary} />
          </View>
          <Text style={styles.title}>{t('manned_onb_2_title')}</Text>
          <Text style={styles.body}>{t('manned_onb_2_body')}</Text>
        </View>
      )}

      <View style={{ gap: 10, marginTop: 24 }}>
        {step === 0 ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep(1)} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>{t('next')}</Text>
            <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={goImport} activeOpacity={0.85}>
              <Ionicons name="cloud-upload-outline" size={16} color={Colors.textInverse} />
              <Text style={styles.primaryBtnText}>{t('manned_onb_import')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryFilledBtn} onPress={goAddFlight} activeOpacity={0.85}>
              <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.secondaryFilledBtnText}>{t('manned_onb_log_first')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={finish} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>{t('manned_onb_skip')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Bullet({ text }: { text: string }) {
  const styles = makeStyles();
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="checkmark-circle" size={16} color={Colors.primary} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 24, paddingTop: 60, paddingBottom: 40, gap: 12 },
    progress: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 20 },
    progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
    progressDotActive: { backgroundColor: Colors.primary, width: 24 },

    step: { alignItems: 'center', gap: 14 },
    iconWrap: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: Colors.primary + '18',
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    body: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 10 },
    bullets: { gap: 10, marginTop: 10, width: '100%' },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    bulletText: { color: Colors.textPrimary, fontSize: 13, lineHeight: 18, flex: 1 },

    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    },
    primaryBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
    secondaryFilledBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary + '18',
      borderRadius: 12, paddingVertical: 14,
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    secondaryFilledBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '800' },
    secondaryBtn: { alignItems: 'center', paddingVertical: 10 },
    secondaryBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  });
}
