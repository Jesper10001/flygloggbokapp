import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { setScanImage } from '../../store/scanStore';
import { ocrSummarizePage, type PageSummary } from '../../services/ocr';
import { Colors } from '../../constants/colors';

type Mode = 'import' | 'summarize';

function toHHMM(decimal: number): string {
  if (!decimal) return '0:00';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function SummaryResult({ summary, onReset }: { summary: PageSummary; onReset: () => void }) {
  const rows: { label: string; value: string; isTime: boolean }[] = [
    { label: 'Total flygtid',     value: toHHMM(summary.total_time),    isTime: true },
    { label: 'PIC',               value: toHHMM(summary.pic),           isTime: true },
    { label: 'Co-pilot',          value: toHHMM(summary.co_pilot),      isTime: true },
    { label: 'Dual (elev)',       value: toHHMM(summary.dual),          isTime: true },
    { label: 'Instruktör',        value: toHHMM(summary.instructor),    isTime: true },
    { label: 'IFR',               value: toHHMM(summary.ifr),           isTime: true },
    { label: 'Natt',              value: toHHMM(summary.night),         isTime: true },
    { label: 'Landningar dag',    value: String(summary.landings_day),  isTime: false },
    { label: 'Landningar natt',   value: String(summary.landings_night),isTime: false },
  ].filter(r => r.value !== '0:00' && r.value !== '0');

  return (
    <View style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
        <Text style={styles.resultTitle}>Sidsummering</Text>
        <Text style={styles.resultSub}>{summary.row_count} rader lästa</Text>
      </View>

      <Text style={styles.resultInstruction}>
        Fyll i dessa värden i raden "Total this page" längst ner på sidan:
      </Text>

      <View style={styles.resultTable}>
        {rows.map((row) => (
          <View key={row.label} style={styles.resultRow}>
            <Text style={styles.resultLabel}>{row.label}</Text>
            <Text style={[styles.resultValue, row.isTime && styles.resultValueTime]}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>

      {summary.note ? (
        <View style={styles.noteRow}>
          <Ionicons name="warning-outline" size={14} color={Colors.warning} />
          <Text style={styles.noteText}>{summary.note}</Text>
        </View>
      ) : null}

      <TouchableOpacity style={styles.resetBtn} onPress={onReset} activeOpacity={0.8}>
        <Ionicons name="camera-outline" size={16} color={Colors.primary} />
        <Text style={styles.resetBtnText}>Skanna ny sida</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ScanScreen() {
  const router = useRouter();
  const { isPremium } = useFlightStore();

  const [mode, setMode] = useState<Mode>('import');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [working, setWorking] = useState(false);
  const [summary, setSummary] = useState<PageSummary | null>(null);

  const reset = () => {
    setImageUri(null);
    setRotation(0);
    setSummary(null);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    reset();
  };

  const pickImage = async (fromCamera: boolean) => {
    let result;
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Behörighet krävs', 'Kameraåtkomst behövs för att skanna loggböcker.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'] as any,
        quality: 0.85,
        base64: false,
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        quality: 0.85,
        base64: false,
      });
    }
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setRotation(0);
      setSummary(null);
    }
  };

  const prepareImage = async () => {
    if (!imageUri) return null;
    const actions: ImageManipulator.Action[] = [];
    if (rotation !== 0) actions.push({ rotate: rotation });
    return ImageManipulator.manipulateAsync(
      imageUri,
      actions,
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
  };

  const handleImport = async () => {
    setWorking(true);
    try {
      const img = await prepareImage();
      if (!img?.base64) { Alert.alert('Fel', 'Kunde inte behandla bilden.'); return; }
      setScanImage(img.base64, 'image/jpeg');
      router.push('/flight/review');
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    } finally {
      setWorking(false);
    }
  };

  const handleSummarize = async () => {
    setWorking(true);
    try {
      const img = await prepareImage();
      if (!img?.base64) { Alert.alert('Fel', 'Kunde inte behandla bilden.'); return; }
      const result = await ocrSummarizePage(img.base64, 'image/jpeg');
      setSummary(result);
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    } finally {
      setWorking(false);
    }
  };

  // ── Locked ────────────────────────────────────────────────────────────────
  if (!isPremium) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockedCard}>
          <Ionicons name="star" size={48} color={Colors.gold} />
          <Text style={styles.lockedTitle}>Premium-funktion</Text>
          <Text style={styles.lockedText}>
            OCR-skanning av fysiska loggböcker är tillgängligt med Premium-abonnemang.
          </Text>
          <View style={styles.featureList}>
            {[
              'Importera flygningar direkt från foto',
              'Summera en sidas flygtider automatiskt',
              'AI-tolkning av handskrift (Claude)',
              'Granska och korrigera innan sparning',
              'Export till CSV och PDF',
            ].map((f) => (
              <View key={f} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push('/(tabs)/settings')} activeOpacity={0.8}>
            <Ionicons name="star" size={18} color={Colors.textInverse} />
            <Text style={styles.upgradeBtnText}>Uppgradera till Premium</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Huvud ─────────────────────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Lägesväxlare */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'import' && styles.modeBtnActive]}
          onPress={() => switchMode('import')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="cloud-upload-outline"
            size={16}
            color={mode === 'import' ? Colors.textInverse : Colors.textSecondary}
          />
          <Text style={[styles.modeBtnText, mode === 'import' && styles.modeBtnTextActive]}>
            Importera till app
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'summarize' && styles.modeBtnActive]}
          onPress={() => switchMode('summarize')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="calculator-outline"
            size={16}
            color={mode === 'summarize' ? Colors.textInverse : Colors.textSecondary}
          />
          <Text style={[styles.modeBtnText, mode === 'summarize' && styles.modeBtnTextActive]}>
            Summera sida
          </Text>
        </TouchableOpacity>
      </View>

      {/* Beskrivning */}
      <Text style={styles.subtitle}>
        {mode === 'import'
          ? 'Skanna en sida ur loggboken. Claude läser av varje rad och du granskar innan sparning.'
          : 'Skanna en sida ur loggboken. Claude summerar alla kolumner åt dig — du ser vad som ska skrivas längst ner på sidan.'}
      </Text>

      {/* Bildresultat (summera-läge) */}
      {summary ? (
        <SummaryResult summary={summary} onReset={reset} />
      ) : !imageUri ? (
        /* Bildval */
        <View style={styles.pickRow}>
          <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage(true)} activeOpacity={0.8}>
            <Ionicons name="camera" size={32} color={Colors.primary} />
            <Text style={styles.pickBtnText}>Kamera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage(false)} activeOpacity={0.8}>
            <Ionicons name="images" size={32} color={Colors.primary} />
            <Text style={styles.pickBtnText}>Bildbibliotek</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* Förhandsvisning */
        <>
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: imageUri }}
              style={[styles.preview, { transform: [{ rotate: `${rotation}deg` }] }]}
              resizeMode="contain"
            />
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={reset}>
              <Ionicons name="close-circle-outline" size={20} color={Colors.textSecondary} />
              <Text style={styles.actionBtnText}>Byt bild</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => setRotation((r) => (r + 90) % 360)}>
              <Ionicons name="refresh" size={20} color={Colors.primary} />
              <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Rotera {rotation}°</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.scanBtn, working && { opacity: 0.6 }]}
            onPress={mode === 'import' ? handleImport : handleSummarize}
            disabled={working}
            activeOpacity={0.8}
          >
            {working ? (
              <>
                <ActivityIndicator color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>
                  {mode === 'import' ? 'Importerar…' : 'Summerar…'}
                </Text>
              </>
            ) : mode === 'import' ? (
              <>
                <Ionicons name="cloud-upload" size={20} color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>Importera med Claude AI</Text>
              </>
            ) : (
              <>
                <Ionicons name="calculator" size={20} color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>Summera med Claude AI</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* Tips */}
      {!summary && (
        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Tips för bästa resultat</Text>
          {[
            'God belysning — undvik skuggor och reflexer',
            'Håll kameran rakt ovanför sidan',
            'All text ska vara skarp och i fokus',
            'Skanna en sida i taget',
            'Rotera bilden om loggboken är stående',
          ].map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Ionicons name="bulb-outline" size={14} color={Colors.gold} />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 14 },

  modeRow: {
    flexDirection: 'row',
    backgroundColor: Colors.elevated,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 9,
  },
  modeBtnActive: { backgroundColor: Colors.primary },
  modeBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: Colors.textInverse, fontWeight: '700' },

  subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },

  pickRow: { flexDirection: 'row', gap: 14 },
  pickBtn: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 16,
    padding: 24, alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  pickBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },

  previewContainer: {
    width: '100%', height: 300, borderRadius: 12,
    backgroundColor: Colors.card, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  preview: { width: '100%', height: '100%' },

  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: Colors.card, borderRadius: 10,
    paddingVertical: 10, borderWidth: 1, borderColor: Colors.border,
  },
  actionBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },

  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15, gap: 8,
  },
  scanBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  // Summerings-resultat
  resultCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: Colors.success + '55', gap: 12,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', flex: 1 },
  resultSub: { color: Colors.textMuted, fontSize: 12 },
  resultInstruction: {
    color: Colors.textSecondary, fontSize: 13, lineHeight: 18,
    backgroundColor: Colors.primary + '12', borderRadius: 8,
    padding: 10, borderWidth: 1, borderColor: Colors.primary + '33',
  },
  resultTable: {
    borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  resultLabel: { color: Colors.textSecondary, fontSize: 14 },
  resultValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  resultValueTime: {
    fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
    color: Colors.primary, fontSize: 15, fontWeight: '700',
  },
  noteRow: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.warning + '18', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: Colors.warning + '44',
  },
  noteText: { color: Colors.warning, fontSize: 12, flex: 1, lineHeight: 17 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.primary + '55',
    backgroundColor: Colors.primary + '12',
  },
  resetBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  tipsCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 16, gap: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  tipsTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tipText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },

  lockedContainer: { flex: 1, backgroundColor: Colors.background, padding: 20, justifyContent: 'center' },
  lockedCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 24,
    gap: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.gold + '44',
  },
  lockedTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800' },
  lockedText: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  featureList: { alignSelf: 'stretch', gap: 8, marginVertical: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { color: Colors.textPrimary, fontSize: 14 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.gold, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 24, gap: 8, marginTop: 8, alignSelf: 'stretch',
  },
  upgradeBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
});
