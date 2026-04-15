import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Alert, ScrollView, ActivityIndicator, Modal, TextInput, FlatList,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { setScanImage } from '../../store/scanStore';
import { useScanQuotaStore, MONTHLY_QUOTA, MONTHLY_SUMMARIZE_QUOTA, SCAN_PACKS } from '../../store/scanQuotaStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { formatTimeValue } from '../../hooks/useTimeFormat';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import { ocrSummarizePage, type PageSummary } from '../../services/ocr';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import {
  saveScanSummary, getAllScanSummaries,
  type ScanSummary,
} from '../../db/scanSummaries';
import { getSetting, setSetting, getFlights } from '../../db/flights';

type Mode = 'summarize' | 'import';
const PAGE_SIZE = 12;

function toHHMM(decimal: number): string {
  if (!decimal) return '0:00';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

type SummaryRow = { label: string; isTime: boolean; field: keyof import('../../services/ocr').PageTotals };

const SUMMARY_ROWS: SummaryRow[] = [
  { label: 'Total flygtid', isTime: true,  field: 'total_time' },
  { label: 'PIC',           isTime: true,  field: 'pic' },
  { label: 'Co-pilot',      isTime: true,  field: 'co_pilot' },
  { label: 'Dual',          isTime: true,  field: 'dual' },
  { label: 'Instructor',    isTime: true,  field: 'instructor' },
  { label: 'IFR',           isTime: true,  field: 'ifr' },
  { label: 'Natt',          isTime: true,  field: 'night' },
  { label: 'Ldg dag',       isTime: false, field: 'landings_day' },
  { label: 'Ldg natt',      isTime: false, field: 'landings_night' },
];

function makeStyles() {
  return StyleSheet.create({
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

    // Kvota
    quotaCard: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 10,
    },
    quotaRow: { flexDirection: 'row', alignItems: 'center' },
    quotaLeft: { flex: 1, gap: 2 },
    quotaCount: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    quotaCountEmpty: { color: Colors.danger ?? '#EF4444' },
    quotaSub: { color: Colors.textMuted, fontSize: 12 },
    buyMoreBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: Colors.primary + '18', borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 6,
      borderWidth: 1, borderColor: Colors.primary + '33',
    },
    buyMoreText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
    quotaBarBg: {
      height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden',
    },
    quotaBarFill: {
      height: '100%', backgroundColor: Colors.primary, borderRadius: 2,
    },
    quotaBarEmpty: { backgroundColor: '#EF4444' },

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
    resultTableHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingBottom: 4,
    },
    resultColLabel: { flex: 1 },
    resultColHead: {
      width: 64, textAlign: 'right',
      color: Colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    },
    resultColHeadTotal: { color: Colors.primary },
    resultTable: {
      borderRadius: 8, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.border,
    },
    resultRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: Colors.separator,
    },
    resultLabel: { flex: 1, color: Colors.textSecondary, fontSize: 13 },
    resultValue: {
      width: 64, textAlign: 'right',
      color: Colors.textPrimary, fontSize: 13, fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    resultValueTotal: { color: Colors.primary, fontWeight: '800' },
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

    // Köp-modal
    buyOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end',
    },
    buySheet: {
      backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 24, paddingBottom: 40, gap: 16,
      borderWidth: 1, borderColor: Colors.border,
    },
    buyHandle: {
      width: 40, height: 4, backgroundColor: Colors.border,
      borderRadius: 2, alignSelf: 'center', marginBottom: 4,
    },
    buyTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800' },
    buySub: { color: Colors.textSecondary, fontSize: 13, marginTop: -8 },
    packCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.elevated, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: Colors.border,
    },
    packLeft: { flex: 1, gap: 3 },
    packCount: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
    packNote: { color: Colors.textMuted, fontSize: 12 },
    packPriceBox: {
      backgroundColor: Colors.primary, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    packPrice: { color: '#fff', fontSize: 15, fontWeight: '800' },
    closeBuyBtn: {
      alignItems: 'center', paddingVertical: 12,
      borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    },
    closeBuyBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },

    // Book-chips i spara-modal
    bookChip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    bookChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    bookChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
    bookChipTextActive: { color: Colors.textInverse },

    // Historik
    badgeBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      backgroundColor: Colors.primary + '18', borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    badgeBannerText: { flex: 1, color: Colors.primary, fontSize: 13, lineHeight: 18 },
    emptyHistory: { alignItems: 'center', gap: 10, paddingVertical: 40 },
    emptyHistoryText: { color: Colors.textMuted, fontSize: 14 },
    historyCard: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 6,
    },
    historyCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    historyCardName: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
    historyCardDate: { color: Colors.textMuted, fontSize: 12 },
    historyCardMeta: { color: Colors.textSecondary, fontSize: 13 },
    historyCardActions: { flexDirection: 'row', gap: 16, justifyContent: 'flex-end', marginTop: 4 },
    nameInput: {
      backgroundColor: Colors.elevated, borderRadius: 10, padding: 14,
      color: Colors.textPrimary, fontSize: 15, borderWidth: 1, borderColor: Colors.border,
      alignSelf: 'stretch',
    },
    nextBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    },
    nextBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

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
}

function SummaryResult({ summary, onReset, onSave }: { summary: PageSummary; onReset: () => void; onSave?: () => void }) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const { timeFormat } = useTimeFormatStore();

  function fmt(val: number, isTime: boolean): string {
    if (isTime) return formatTimeValue(val, timeFormat);
    return String(val);
  }

  const visibleRows = SUMMARY_ROWS.filter(r => {
    const a = summary.total_this_page[r.field];
    const b = summary.brought_forward[r.field];
    return a !== 0 || b !== 0;
  });

  return (
    <View style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
        <Text style={styles.resultTitle}>{t('page_summary')}</Text>
        <Text style={styles.resultSub}>{summary.row_count} {t('rows_read')}</Text>
      </View>

      {/* Kolumnrubriker */}
      <View style={styles.resultTableHeader}>
        <Text style={styles.resultColLabel} />
        <Text style={styles.resultColHead}>Denna sida</Text>
        <Text style={styles.resultColHead}>B/F</Text>
        <Text style={[styles.resultColHead, styles.resultColHeadTotal]}>Totalt</Text>
      </View>

      <View style={styles.resultTable}>
        {visibleRows.map((row) => {
          const page = summary.total_this_page[row.field];
          const bf   = summary.brought_forward[row.field];
          const tot  = summary.total_to_date[row.field];
          return (
            <View key={row.field} style={styles.resultRow}>
              <Text style={styles.resultLabel}>{row.label}</Text>
              <Text style={styles.resultValue}>{fmt(page, row.isTime)}</Text>
              <Text style={styles.resultValue}>{fmt(bf, row.isTime)}</Text>
              <Text style={[styles.resultValue, styles.resultValueTotal]}>{fmt(tot, row.isTime)}</Text>
            </View>
          );
        })}
      </View>

      {summary.note ? (
        <View style={styles.noteRow}>
          <Ionicons name="warning-outline" size={14} color={Colors.warning} />
          <Text style={styles.noteText}>{summary.note}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity style={[styles.resetBtn, { flex: 1 }]} onPress={onReset} activeOpacity={0.8}>
          <Ionicons name="camera-outline" size={16} color={Colors.primary} />
          <Text style={styles.resetBtnText}>{t('scan_new_page')}</Text>
        </TouchableOpacity>
        {onSave && (
          <TouchableOpacity style={[styles.resetBtn, { flex: 1, borderColor: Colors.success + '55', backgroundColor: Colors.success + '12' }]} onPress={onSave} activeOpacity={0.8}>
            <Ionicons name="save-outline" size={16} color={Colors.success} />
            <Text style={[styles.resetBtnText, { color: Colors.success }]}>Spara</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function BuyModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = makeStyles();
  const { addExtraScans } = useScanQuotaStore();

  const handlePurchase = async (pack: typeof SCAN_PACKS[number]) => {
    // TODO: Ersätt med riktigt köp via StoreKit/IAP när Apple Developer-konto är klart
    await addExtraScans(pack.count);
    onClose();
    Alert.alert('Klart!', `${pack.count} skanningar har lagts till på ditt konto.`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.buyOverlay}>
        <View style={styles.buySheet}>
          <View style={styles.buyHandle} />
          <Text style={styles.buyTitle}>Köp fler skanningar</Text>
          <Text style={styles.buySub}>Köpta skanningar förfaller aldrig</Text>

          {SCAN_PACKS.map(pack => (
            <TouchableOpacity
              key={pack.count}
              style={styles.packCard}
              onPress={() => handlePurchase(pack)}
              activeOpacity={0.8}
            >
              <View style={styles.packLeft}>
                <Text style={styles.packCount}>{pack.count} skanningar</Text>
                <Text style={styles.packNote}>{pack.pricePerScan}</Text>
              </View>
              <View style={styles.packPriceBox}>
                <Text style={styles.packPrice}>{pack.price} kr</Text>
              </View>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.closeBuyBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeBuyBtnText}>Stäng</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}


export default function ScanScreen() {
  const styles = makeStyles();
  const router = useRouter();
  const { isPremium, flightCount } = useFlightStore();
  const { t } = useTranslation();
  const {
    load, monthlyRemaining, totalRemaining, summarizeRemaining,
    canScan, canSummarize, consumeScan, consumeSummarize,
    extraScans, loaded,
  } = useScanQuotaStore();
  const { timeFormat } = useTimeFormatStore();

  const [mode, setMode] = useState<Mode>('summarize');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [working, setWorking] = useState(false);
  const [summary, setSummary] = useState<PageSummary | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [pendingSummary, setPendingSummary] = useState<PageSummary | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showNextPageModal, setShowNextPageModal] = useState(false);
  const [recentFlights, setRecentFlights] = useState<{ id: number; date: string; dep_place: string; arr_place: string; aircraft_type: string }[]>([]);
  const [history, setHistory] = useState<ScanSummary[]>([]);
  const [scanBadge, setScanBadge] = useState(false);
  const [saveBookName, setSaveBookName] = useState('');
  const [savePageName, setSavePageName] = useState('');

  useEffect(() => { load(); }, []);

  const loadHistory = useCallback(async () => {
    const summaries = await getAllScanSummaries();
    setHistory(summaries);
  }, []);

  const checkBadge = useCallback(async () => {
    const saved = await getSetting('scan_page_start_count');
    const startCount = parseInt(saved ?? '0', 10) || 0;
    setScanBadge(flightCount - startCount >= PAGE_SIZE);
  }, [flightCount]);

  useFocusEffect(useCallback(() => {
    loadHistory();
    checkBadge();
  }, [loadHistory, checkBadge]));

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
        Alert.alert(t('permission_required'), t('camera_permission'));
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
    // Begränsa bredden till 2000px — behåller aspect ratio, räcker för OCR
    actions.push({ resize: { width: 2000 } });
    return ImageManipulator.manipulateAsync(
      imageUri,
      actions,
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
  };

  const handleImport = async () => {
    if (!canScan()) { setShowBuyModal(true); return; }
    setWorking(true);
    try {
      const img = await prepareImage();
      if (!img?.base64) { Alert.alert(t('error'), t('could_not_process_image')); return; }
      await consumeScan();
      setScanImage(img.base64, 'image/jpeg');
      router.push('/flight/review');
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setWorking(false);
    }
  };

  const handleSummarize = async () => {
    if (!canSummarize()) {
      Alert.alert('Gränsen nådd', `Du har använt alla ${MONTHLY_SUMMARIZE_QUOTA} summerings-skanningar för denna månad.`);
      return;
    }
    setWorking(true);
    try {
      const img = await prepareImage();
      if (!img?.base64) { Alert.alert(t('error'), t('could_not_process_image')); return; }
      await consumeSummarize();
      const result = await ocrSummarizePage(img.base64, 'image/jpeg', timeFormat);
      setSummary(result);
      setPendingSummary(result);
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
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
          <Text style={styles.lockedTitle}>{t('premium_feature')}</Text>
          <Text style={styles.lockedText}>{t('ocr_premium_text')}</Text>
          <View style={styles.featureList}>
            {[
              t('feature_import_photo'),
              t('feature_summarise'),
              t('feature_ai'),
              t('feature_review'),
              t('feature_export'),
            ].map((f) => (
              <View key={f} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => router.push('/(tabs)/settings')} activeOpacity={0.8}>
            <Ionicons name="star" size={18} color={Colors.textInverse} />
            <Text style={styles.upgradeBtnText}>{t('upgrade_to_premium')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const monthly = monthlyRemaining();
  const total = totalRemaining();
  const summarize = summarizeRemaining();
  const isImport = mode === 'import';
  const displayTotal = isImport ? total : summarize;
  const displayQuota = isImport ? MONTHLY_QUOTA : MONTHLY_SUMMARIZE_QUOTA;
  const displayMonthly = isImport ? monthly : summarize;
  const barWidth = `${(displayMonthly / displayQuota) * 100}%` as any;

  // ── Huvud ─────────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >

      {/* Mode switcher */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'summarize' && styles.modeBtnActive]}
          onPress={() => switchMode('summarize')}
          activeOpacity={0.8}
        >
          <Ionicons name="calculator-outline" size={16} color={mode === 'summarize' ? Colors.textInverse : Colors.textSecondary} />
          <Text style={[styles.modeBtnText, mode === 'summarize' && styles.modeBtnTextActive]}>{t('summarise_page')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'import' && styles.modeBtnActive]}
          onPress={() => switchMode('import')}
          activeOpacity={0.8}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={mode === 'import' ? Colors.textInverse : Colors.textSecondary} />
          <Text style={[styles.modeBtnText, mode === 'import' && styles.modeBtnTextActive]}>{t('import_to_app')}</Text>
        </TouchableOpacity>
      </View>

      {/* Kvotbanner */}
      {loaded && (
        <View style={styles.quotaCard}>
          <View style={styles.quotaRow}>
            <View style={styles.quotaLeft}>
              <Text style={[styles.quotaCount, displayTotal === 0 && styles.quotaCountEmpty]}>
                {displayTotal === 0 ? 'Inga skanningar kvar' : `${displayTotal} skanning${displayTotal === 1 ? '' : 'ar'} kvar`}
              </Text>
              <Text style={styles.quotaSub}>
                {displayMonthly}/{displayQuota} månadskvot
                {isImport && extraScans > 0 ? ` · +${extraScans} köpta` : ''}
              </Text>
            </View>
            {isImport && (
              <TouchableOpacity style={styles.buyMoreBtn} onPress={() => setShowBuyModal(true)} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={14} color={Colors.primary} />
                <Text style={styles.buyMoreText}>Köp fler</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.quotaBarBg}>
            <View style={[styles.quotaBarFill, { width: barWidth }, total === 0 && styles.quotaBarEmpty]} />
          </View>
        </View>
      )}

      {/* Description */}
      <Text style={styles.subtitle}>
        {mode === 'import' ? t('scan_import_desc') : t('scan_summarise_desc')}
      </Text>

      {/* ── Notisbanner (Summarise-läge) ── */}
      {mode === 'summarize' && scanBadge && (
        <View style={styles.badgeBanner}>
          <Ionicons name="notifications" size={16} color={Colors.primary} />
          <Text style={styles.badgeBannerText}>Dags att summera nästa blad! Du har loggat {PAGE_SIZE}+ flygningar sedan senaste summering.</Text>
        </View>
      )}

      {/* Bildresultat (summera-läge) */}
      {summary ? (
        <SummaryResult summary={summary} onReset={reset} onSave={() => { setSaveBookName(''); setSavePageName(''); setShowSaveModal(true); }} />
      ) : !imageUri ? (
        /* Bildval */
        <View style={styles.pickRow}>
          <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage(true)} activeOpacity={0.8}>
            <Ionicons name="camera" size={32} color={Colors.primary} />
            <Text style={styles.pickBtnText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage(false)} activeOpacity={0.8}>
            <Ionicons name="images" size={32} color={Colors.primary} />
            <Text style={styles.pickBtnText}>Photo library</Text>
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
              <Text style={styles.actionBtnText}>Change image</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => setRotation((r) => (r + 90) % 360)}>
              <Ionicons name="refresh" size={20} color={Colors.primary} />
              <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Rotate {rotation}°</Text>
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
                  {mode === 'import' ? 'Importing…' : 'Summarising…'}
                </Text>
              </>
            ) : mode === 'import' ? (
              <>
                <Ionicons name="cloud-upload" size={20} color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>Import with Claude AI</Text>
              </>
            ) : (
              <>
                <Ionicons name="calculator" size={20} color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>Summarise with Claude AI</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* Tips */}
      {!summary && (
        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Tips for best results</Text>
          {[
            'Good lighting — avoid shadows and reflections',
            'Hold the camera straight above the page',
            'All text should be sharp and in focus',
            'Scan one page at a time',
            'Rotate the image if the logbook is in portrait orientation',
          ].map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Ionicons name="bulb-outline" size={14} color={Colors.gold} />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}


      {/* ── Spara-modal ── */}
      <Modal visible={showSaveModal} transparent animationType="slide" onRequestClose={() => setShowSaveModal(false)}>
        <KeyboardAvoidingView
          style={styles.buyOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.buySheet}>
            <View style={styles.buyHandle} />
            <Text style={styles.buyTitle}>Namnge blad</Text>

            {/* Bok-val: snabbknappar för befintliga böcker */}
            {Array.from(new Set(history.map(s => s.book_name).filter(Boolean))).length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.buySub, { marginTop: 0 }]}>Välj bok</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {Array.from(new Set(history.map(s => s.book_name).filter(Boolean))).map(book => (
                    <TouchableOpacity
                      key={book}
                      style={[styles.bookChip, saveBookName === book && styles.bookChipActive]}
                      onPress={() => setSaveBookName(book)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.bookChipText, saveBookName === book && styles.bookChipTextActive]}>{book}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <TextInput
              style={styles.nameInput}
              value={saveBookName}
              onChangeText={setSaveBookName}
              placeholder="Bok 1"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <TextInput
              style={styles.nameInput}
              value={savePageName}
              onChangeText={setSavePageName}
              placeholder="Blad 60–61"
              placeholderTextColor={Colors.textMuted}
            />
            <TouchableOpacity
              style={[styles.nextBtn, { alignSelf: 'stretch' }]}
              activeOpacity={0.8}
              onPress={async () => {
                if (!pendingSummary) return;
                await saveScanSummary(
                  saveBookName || 'Okänd bok',
                  savePageName || 'Okänt blad',
                  pendingSummary.total_this_page,
                  pendingSummary.brought_forward,
                  pendingSummary.total_to_date,
                  pendingSummary.row_count,
                  flightCount,
                );
                setShowSaveModal(false);
                setPendingSummary(null);
                setSaveBookName('');
                setSavePageName('');
                loadHistory();
                // Hämta senaste flygningar för nästa-blad-väljaren
                const flights = await getFlights(15);
                setRecentFlights(flights.map((f: any) => ({
                  id: f.id, date: f.date, dep_place: f.dep_place,
                  arr_place: f.arr_place, aircraft_type: f.aircraft_type,
                })));
                setShowNextPageModal(true);
              }}
            >
              <Text style={styles.nextBtnText}>Spara</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBuyBtn} onPress={() => setShowSaveModal(false)}>
              <Text style={styles.closeBuyBtnText}>Hoppa över</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Nästa blad-modal ── */}
      <Modal visible={showNextPageModal} transparent animationType="slide" onRequestClose={() => setShowNextPageModal(false)}>
        <View style={styles.buyOverlay}>
          <View style={[styles.buySheet, { maxHeight: '80%' }]}>
            <View style={styles.buyHandle} />
            <Text style={styles.buyTitle}>Nästa blads första flygning</Text>
            <Text style={styles.buySub}>Välj vilken flygning som är den första på nästa blad, eller välj "Nästa jag loggar"</Text>

            <TouchableOpacity
              style={[styles.packCard, { marginBottom: 4 }]}
              activeOpacity={0.8}
              onPress={async () => {
                await setSetting('scan_page_start_count', String(flightCount));
                setShowNextPageModal(false);
                checkBadge();
                Alert.alert('Klart', 'Nästa flygning du loggar markeras som första på nästa blad.');
              }}
            >
              <View style={styles.packLeft}>
                <Text style={styles.packCount}>Nästa flygning jag loggar</Text>
                <Text style={styles.packNote}>Börjar räkna från nu</Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={24} color={Colors.primary} />
            </TouchableOpacity>

            <FlatList
              data={recentFlights}
              keyExtractor={f => String(f.id)}
              style={{ maxHeight: 280 }}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={styles.packCard}
                  activeOpacity={0.8}
                  onPress={async () => {
                    // Sätt startcount = flightCount - index (denna flight's "position från slutet")
                    await setSetting('scan_page_start_count', String(flightCount - index));
                    setShowNextPageModal(false);
                    checkBadge();
                  }}
                >
                  <View style={styles.packLeft}>
                    <Text style={styles.packCount}>{item.dep_place} → {item.arr_place}</Text>
                    <Text style={styles.packNote}>{item.date} · {item.aircraft_type}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity style={styles.closeBuyBtn} onPress={() => setShowNextPageModal(false)}>
              <Text style={styles.closeBuyBtnText}>Hoppa över</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BuyModal visible={showBuyModal} onClose={() => setShowBuyModal(false)} />
    </ScrollView>
  );
}
