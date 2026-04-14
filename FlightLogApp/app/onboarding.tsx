import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useLanguageStore } from '../store/languageStore';
import { useTimeFormatStore, type TimeFormat } from '../store/timeFormatStore';
import { setSetting } from '../db/flights';

type Step = 'language' | 'timeformat';

function makeStyles() {
  return StyleSheet.create({
    container: {
      flex: 1, backgroundColor: Colors.background, padding: 24,
    },
    dotsRow: {
      flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 12, marginBottom: 32,
    },
    dot: {
      width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border,
    },
    dotActive: { backgroundColor: Colors.primary, width: 24 },

    stepContent: {
      flex: 1, alignItems: 'center', gap: 16,
    },
    title: {
      color: Colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 16,
    },
    subtitle: {
      color: Colors.textSecondary, fontSize: 15, textAlign: 'center',
    },

    optionsCol: {
      alignSelf: 'stretch', gap: 12, marginTop: 8,
    },
    option: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: Colors.card, borderRadius: 14, padding: 18,
      borderWidth: 2, borderColor: Colors.border,
    },
    optionActive: {
      borderColor: Colors.primary, backgroundColor: Colors.primary + '12',
    },
    optionFlag: { fontSize: 32 },
    formatExample: {
      width: 52, height: 52, borderRadius: 10,
      backgroundColor: Colors.elevated, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: Colors.border,
    },
    formatExampleText: {
      color: Colors.primary, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'],
    },
    optionText: { flex: 1, gap: 2 },
    optionLabel: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700' },
    optionLabelActive: { color: Colors.primary },
    optionSub: { color: Colors.textMuted, fontSize: 13 },

    noteBox: {
      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
      backgroundColor: Colors.primary + '12', borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.primary + '33', alignSelf: 'stretch',
    },
    noteText: { flex: 1, color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },

    btnRow: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
    backBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.card, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 20,
      borderWidth: 1, borderColor: Colors.border,
    },
    backBtnText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
    nextBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15,
    },
    nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}

export default function OnboardingScreen() {
  const styles = makeStyles();
  const router = useRouter();
  const { setLanguage } = useLanguageStore();
  const { setTimeFormat } = useTimeFormatStore();

  const [step, setStep] = useState<Step>('language');
  const [selectedLang, setSelectedLang] = useState<'en' | 'sv'>('en');
  const [selectedFormat, setSelectedFormat] = useState<TimeFormat>('decimal');

  const handleFinish = async () => {
    await setLanguage(selectedLang);
    await setTimeFormat(selectedFormat);
    await setSetting('has_onboarded', '1');
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress dots */}
      <View style={styles.dotsRow}>
        <View style={[styles.dot, step === 'language' && styles.dotActive]} />
        <View style={[styles.dot, step === 'timeformat' && styles.dotActive]} />
      </View>

      {step === 'language' ? (
        <View style={styles.stepContent}>
          <Ionicons name="globe-outline" size={48} color={Colors.primary} />
          <Text style={styles.title}>Choose language</Text>
          <Text style={styles.subtitle}>Välj språk / Choose language</Text>

          <View style={styles.optionsCol}>
            <TouchableOpacity
              style={[styles.option, selectedLang === 'sv' && styles.optionActive]}
              onPress={() => setSelectedLang('sv')}
              activeOpacity={0.8}
            >
              <Text style={styles.optionFlag}>🇸🇪</Text>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selectedLang === 'sv' && styles.optionLabelActive]}>Svenska</Text>
                <Text style={styles.optionSub}>Swedish</Text>
              </View>
              {selectedLang === 'sv' && <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.option, selectedLang === 'en' && styles.optionActive]}
              onPress={() => setSelectedLang('en')}
              activeOpacity={0.8}
            >
              <Text style={styles.optionFlag}>🇬🇧</Text>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selectedLang === 'en' && styles.optionLabelActive]}>English</Text>
                <Text style={styles.optionSub}>Engelska</Text>
              </View>
              {selectedLang === 'en' && <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.nextBtn} onPress={() => setStep('timeformat')} activeOpacity={0.8}>
            <Text style={styles.nextBtnText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.stepContent}>
          <Ionicons name="time-outline" size={48} color={Colors.primary} />
          <Text style={styles.title}>Time format</Text>
          <Text style={styles.subtitle}>How do you log flight times?</Text>

          <View style={styles.optionsCol}>
            <TouchableOpacity
              style={[styles.option, selectedFormat === 'decimal' && styles.optionActive]}
              onPress={() => setSelectedFormat('decimal')}
              activeOpacity={0.8}
            >
              <View style={styles.formatExample}>
                <Text style={styles.formatExampleText}>1.5</Text>
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selectedFormat === 'decimal' && styles.optionLabelActive]}>Decimal</Text>
                <Text style={styles.optionSub}>e.g. 1.5h · max 1 decimal</Text>
              </View>
              {selectedFormat === 'decimal' && <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.option, selectedFormat === 'hhmm' && styles.optionActive]}
              onPress={() => setSelectedFormat('hhmm')}
              activeOpacity={0.8}
            >
              <View style={styles.formatExample}>
                <Text style={styles.formatExampleText}>1:30</Text>
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selectedFormat === 'hhmm' && styles.optionLabelActive]}>HH:MM</Text>
                <Text style={styles.optionSub}>e.g. 1:30 · hours and minutes</Text>
              </View>
              {selectedFormat === 'hhmm' && <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />}
            </TouchableOpacity>
          </View>

          <View style={styles.noteBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.noteText}>
              Dashboard totals always shown as HH:MM. This setting can be changed later in Settings.
            </Text>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep('language')} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextBtn} onPress={handleFinish} activeOpacity={0.8}>
              <Text style={styles.nextBtnText}>Get started</Text>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
