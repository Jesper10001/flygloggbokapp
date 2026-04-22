import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useScanQuotaStore, MONTHLY_QUOTA, SCAN_PACKS } from '../../store/scanQuotaStore';
import { setScanImage, setScanBatch } from '../../store/scanStore';
import { PremiumModal } from '../../components/PremiumModal';

export default function ScanImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isPremium } = useFlightStore();
  const {
    load, totalRemaining, monthlyRemaining, extraScans,
    canScan, loaded, addExtraScans,
  } = useScanQuotaStore();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [working, setWorking] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [showPremium, setShowPremium] = useState(false);

  if (!isPremium) {
    return (
      <View style={s.container}>
        <PremiumModal visible={true} onClose={() => router.back()} feature={t('import_scan_title')} />
      </View>
    );
  }

  useEffect(() => { load(); }, []);

  const pickImage = async (fromCamera: boolean) => {
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('permission_required'), t('camera_permission'));
        return;
      }
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    setImageUri(result.assets[0].uri);
    setRotation(0);
  };

  const pickBatch = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 5,
      orderedSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setWorking(true);
    try {
      const images: { base64: string; mediaType: 'image/jpeg' }[] = [];
      for (const asset of result.assets) {
        const info = await ImageManipulator.manipulateAsync(asset.uri, [], {});
        const actions: ImageManipulator.Action[] = [];
        if (info.height > info.width) actions.push({ rotate: 90 });
        actions.push({ resize: { width: 2000 } });
        const prepared = await ImageManipulator.manipulateAsync(
          asset.uri, actions,
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (prepared.base64) images.push({ base64: prepared.base64, mediaType: 'image/jpeg' });
      }
      if (images.length === 0) { Alert.alert(t('error'), t('could_not_process_image')); return; }
      setScanBatch(images);
      router.push('/flight/review?batch=1');
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setWorking(false);
    }
  };

  const handleScan = async () => {
    if (!canScan()) { setShowBuy(true); return; }
    if (!imageUri) return;
    setWorking(true);
    try {
      const actions: ImageManipulator.Action[] = [];
      if (rotation !== 0) actions.push({ rotate: rotation });
      const info = await ImageManipulator.manipulateAsync(imageUri, [], {});
      if (info.height > info.width) actions.push({ rotate: 90 });
      actions.push({ resize: { width: 2000 } });
      const img = await ImageManipulator.manipulateAsync(
        imageUri, actions,
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!img.base64) { Alert.alert(t('error'), t('could_not_process_image')); return; }
      await useScanQuotaStore.getState().consumeScan();
      setScanImage(img.base64, 'image/jpeg');
      router.push('/flight/review');
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setWorking(false);
    }
  };

  const remaining = loaded ? totalRemaining() : 0;
  const monthly = loaded ? monthlyRemaining() : 0;
  const extra = loaded ? extraScans : 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.title}>{t('scan_import_title')}</Text>
      <Text style={s.subtitle}>{t('scan_import_desc')}</Text>

      {/* Quota bar */}
      <View style={s.quotaCard}>
        <View style={s.quotaRow}>
          <Text style={s.quotaLabel}>{t('scan_remaining')}</Text>
          <Text style={[s.quotaValue, remaining === 0 && { color: Colors.danger }]}>
            {remaining}
          </Text>
        </View>
        <View style={s.quotaBarBg}>
          <View style={[s.quotaBarFill, { width: `${Math.min(100, (monthly / MONTHLY_QUOTA) * 100)}%` }]} />
        </View>
        <Text style={s.quotaDetail}>
          {monthly}/{MONTHLY_QUOTA} {t('scan_monthly')}
          {extra > 0 ? `  +  ${extra} ${t('scan_extra')}` : ''}
        </Text>
      </View>

      {!imageUri ? (
        <>
          {/* Tips */}
          <View style={s.tipsCard}>
            <Text style={s.tipsTitle}>{t('scan_tips_title')}</Text>
            {[
              t('scan_tip_1'),
              t('scan_tip_2'),
              t('scan_tip_3'),
              t('scan_tip_4'),
              t('scan_tip_5'),
            ].map((tip, i) => (
              <View key={i} style={s.tipRow}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                <Text style={s.tipText}>{tip}</Text>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={s.actionCards}>
            <TouchableOpacity style={s.actionCard} onPress={() => pickImage(true)} activeOpacity={0.8}>
              <Ionicons name="camera" size={28} color={Colors.primary} />
              <Text style={s.actionCardTitle}>{t('scan_camera')}</Text>
              <Text style={s.actionCardSub}>{t('scan_camera_sub')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.actionCard} onPress={() => pickImage(false)} activeOpacity={0.8}>
              <Ionicons name="images" size={28} color={Colors.primary} />
              <Text style={s.actionCardTitle}>{t('scan_library')}</Text>
              <Text style={s.actionCardSub}>{t('scan_library_sub')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.batchBtn} onPress={pickBatch} activeOpacity={0.8}>
            <Ionicons name="copy-outline" size={16} color={Colors.primary} />
            <Text style={s.batchBtnText}>{t('scan_batch')}</Text>
            <Text style={s.batchBtnSub}>{t('scan_batch_sub')}</Text>
          </TouchableOpacity>

          {/* Buy packs */}
          <View style={s.buySection}>
            <Text style={s.buySectionTitle}>{t('scan_buy_title')}</Text>
            <Text style={s.buySectionDesc}>{t('scan_buy_desc')}</Text>
            {SCAN_PACKS.map((pack, i) => (
              <TouchableOpacity
                key={i}
                style={s.packCard}
                onPress={() => {
                  Alert.alert(
                    `${pack.count} ${t('scan_scans')}`,
                    `${pack.price} kr — ${pack.pricePerScan}`,
                    [
                      { text: t('cancel'), style: 'cancel' },
                      { text: t('scan_buy_btn'), onPress: () => addExtraScans(pack.count) },
                    ],
                  );
                }}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.packTitle}>{pack.count} {t('scan_scans')}</Text>
                  <Text style={s.packSub}>{pack.pricePerScan}</Text>
                </View>
                <Text style={s.packPrice}>{pack.price} kr</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <>
          {/* Preview */}
          <View style={s.previewContainer}>
            <Image
              source={{ uri: imageUri }}
              style={[s.preview, { transform: [{ rotate: `${rotation}deg` }] }]}
              resizeMode="contain"
            />
          </View>
          <View style={s.previewActions}>
            <TouchableOpacity style={s.previewBtn} onPress={() => { setImageUri(null); setRotation(0); }}>
              <Ionicons name="close-circle-outline" size={18} color={Colors.textSecondary} />
              <Text style={s.previewBtnText}>{t('change_image')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.previewBtn} onPress={() => setRotation(r => (r + 90) % 360)}>
              <Ionicons name="refresh" size={18} color={Colors.primary} />
              <Text style={[s.previewBtnText, { color: Colors.primary }]}>{t('rotate')} {rotation}°</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[s.scanBtn, working && { opacity: 0.5 }]}
            onPress={handleScan}
            disabled={working}
            activeOpacity={0.85}
          >
            {working ? (
              <><ActivityIndicator color={Colors.textInverse} /><Text style={s.scanBtnText}>{t('importing')}</Text></>
            ) : (
              <><Ionicons name="sparkles" size={18} color={Colors.textInverse} /><Text style={s.scanBtnText}>{t('import_with_ai')}</Text></>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* Buy modal when out of scans */}
      {showBuy && (
        <View style={s.buyOverlay}>
          <View style={s.buySheet}>
            <Ionicons name="warning" size={32} color={Colors.gold} />
            <Text style={s.buySheetTitle}>{t('scan_no_scans_title')}</Text>
            <Text style={s.buySheetDesc}>{t('scan_no_scans_desc')}</Text>
            {SCAN_PACKS.map((pack, i) => (
              <TouchableOpacity
                key={i}
                style={s.packCard}
                onPress={() => {
                  addExtraScans(pack.count);
                  setShowBuy(false);
                }}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.packTitle}>{pack.count} {t('scan_scans')}</Text>
                  <Text style={s.packSub}>{pack.pricePerScan}</Text>
                </View>
                <Text style={s.packPrice}>{pack.price} kr</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setShowBuy(false)}>
              <Text style={{ color: Colors.textMuted, fontSize: 13, marginTop: 8 }}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 16 },

  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

  quotaCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 6,
  },
  quotaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quotaLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  quotaValue: { color: Colors.primary, fontSize: 22, fontWeight: '800', fontFamily: 'Menlo' },
  quotaBarBg: {
    height: 4, borderRadius: 2, backgroundColor: Colors.border, overflow: 'hidden',
  },
  quotaBarFill: { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  quotaDetail: { color: Colors.textMuted, fontSize: 11 },

  tipsCard: {
    backgroundColor: Colors.elevated, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  tipsTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },

  actionCards: { flexDirection: 'row', gap: 10 },
  actionCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center', gap: 8,
  },
  actionCardTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  actionCardSub: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },

  batchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  batchBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  batchBtnSub: { color: Colors.textMuted, fontSize: 11, flex: 1 },

  buySection: {
    backgroundColor: Colors.elevated, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  buySectionTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  buySectionDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },

  packCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: Colors.primary + '44', gap: 10,
  },
  packTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  packSub: { color: Colors.textMuted, fontSize: 11 },
  packPrice: { color: Colors.primary, fontSize: 18, fontWeight: '800' },

  previewContainer: {
    height: 220, borderRadius: 12, overflow: 'hidden',
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  preview: { flex: 1 },
  previewActions: {
    flexDirection: 'row', justifyContent: 'center', gap: 20,
  },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  previewBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },

  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15,
  },
  scanBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  buyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24,
  },
  buySheet: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 20, alignItems: 'center', gap: 10,
  },
  buySheetTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  buySheetDesc: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
