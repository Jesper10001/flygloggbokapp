import { useEffect, useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { GlassDialog, DialogOption } from './GlassDialog';
import { useFlightStore } from '../store/flightStore';
import { useScanQuotaStore } from '../store/scanQuotaStore';
import { useTranslation } from '../hooks/useTranslation';
import { setScanBatch, setScanSources, setScanFocus, setScanFromOnboarding, spreadLimit, type ScanImage } from '../store/scanStore';
import { askAiConsent } from '../services/aiConsent';
import { presentPaywall } from '../services/purchases';
import { getSetting } from '../db/flights';
import { isScanCameraAvailable } from '../modules/scan-camera';
import { isAvailable as visionAvailable } from '../modules/apple-vision-ocr';

// Logbook scan: rutan som frågar efter kamera eller fotoalbum, och vägen därifrån in i kameran eller läsningen.
// Används från dashboardens meny (bara rutan, ingen sida bakom) och från sidan Logbook scan.

// iOS visar inte kameran eller fotoväljaren medan rutan fortfarande stängs.
const CLOSE_MS = 320;

/**
 * `start` kontrollerar kvot och AI-samtycke och öppnar rutan. Lägg `chooser` i skärmen.
 * replace: skärmen är ett modalfönster som ska ersättas (kameran måste vara en vanlig skärm för att bli liggande).
 */
export function useLogbookScanStart({ replace = false, onNoScans }: { replace?: boolean; onNoScans?: () => void } = {}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { isPremium, isMax } = useFlightStore();
  const limit = spreadLimit(isPremium || isMax);
  const cameraAvailable = isScanCameraAvailable();
  const [open, setOpen] = useState(false);
  const go = (path: '/import/scan-camera' | '/import/scan-crop' | '/flight/scan-review') => (replace ? router.replace(path) : router.push(path));

  // Förra valet av fokus ("What matters most to you?") förväljs när granskningen frågar efter läsningen.
  useEffect(() => {
    getSetting('scan_focus').then((v) => {
      if (v === 'exact' || v === 'balanced' || v === 'totals') setScanFocus(v);
    }).catch(() => {});
  }, []);

  const toReview = async (images: ScanImage[]) => {
    for (let i = 0; i < images.length; i++) await useScanQuotaStore.getState().consumeScan();
    setScanBatch(images);
    go('/flight/scan-review');
  };

  // Byggen utan den nya kameran: iOS inbyggda dokumentskanner (beskär och rätar upp, men vet inget om
  // loggböcker). Lazy-require så att appen inte kraschar i ett bygge utan modulen. Granskningen förbereder bilderna.
  const scanWithSystemScanner = async () => {
    let DocumentScanner: any;
    try {
      DocumentScanner = require('react-native-document-scanner-plugin').default;
    } catch {
      Alert.alert('Camera not available', 'Choose photos from your library instead.');
      return;
    }
    try {
      const { scannedImages, status } = await DocumentScanner.scanDocument({ maxNumDocuments: limit, croppedImageQuality: 90 });
      if (status === 'cancel' || !scannedImages?.length) return;
      await toReview(scannedImages.map((uri: string) => ({ base64: '', sourceUri: uri, mediaType: 'image/jpeg' as const, cropped: true })));
    } catch (e: any) {
      Alert.alert(t('error'), e?.message ?? 'Scan failed');
    }
  };

  const openCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('permission_required'), t('camera_permission'));
      return;
    }
    if (cameraAvailable) { go('/import/scan-camera'); return; }
    await scanWithSystemScanner();
  };

  const choosePhotos = async () => {
    // quality 1: ingen omkodning i väljaren (granskningen skalar och kodar ändå) → snabbare tillbaka.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: visionAvailable() ? 1 : 0.9,
      allowsMultipleSelection: true, selectionLimit: limit, orderedSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    // Utan Apple Vision vrids och beskärs varje foto i "Frame the logbook" innan det läses.
    if (!visionAvailable()) {
      setScanSources(result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
      go('/import/scan-crop');
      return;
    }
    // Annars direkt till läsningen: granskningen förbereder fotona och hittar boken i varje foto. Inget görs här,
    // så att läsningsskärmen syns direkt efter valet.
    await toReview(result.assets.map((a) => ({
      base64: '', sourceUri: a.uri, mediaType: 'image/jpeg' as const, width: a.width, height: a.height, cropped: false, oriented: false,
    })));
  };

  const pick = (source: 'camera' | 'library') => {
    setOpen(false);
    setTimeout(() => { (source === 'camera' ? openCamera() : choosePhotos()).catch(() => {}); }, CLOSE_MS);
  };

  // OCR är ett AI-anrop → samtycke innan kameran/biblioteket öppnas, och kvoten kontrolleras först.
  const start = async () => {
    if (!replace) setScanFromOnboarding(false);
    if (!useScanQuotaStore.getState().canScan()) {
      if (onNoScans) onNoScans(); else presentPaywall('Logbook scan');
      return;
    }
    if (await askAiConsent()) setOpen(true);
  };

  const chooser = (
    <GlassDialog
      visible={open}
      onClose={() => setOpen(false)}
      eyebrow="LOGBOOK SCAN"
      title="Photograph your logbook"
      body="Take the photos now, or choose photos you've already taken."
      secondary={{ label: 'Cancel', onPress: () => setOpen(false) }}
    >
      <View style={s.options}>
        <DialogOption icon="camera-outline" title="Take photos" onPress={() => pick('camera')}
          sub={cameraAvailable
            ? 'Hold your phone sideways. The camera takes the photo when the whole spread is sharp.'
            : 'Uses the iPhone document scanner. The new logbook camera comes with the next app build.'} />
        <DialogOption icon="images-outline" title="Choose from your photos" onPress={() => pick('library')}
          sub={`Up to ${limit} photos. Blades finds and straightens the logbook in each one.`} />
      </View>
    </GlassDialog>
  );
  return { start, chooser };
}

const s = StyleSheet.create({
  options: { alignSelf: 'stretch', gap: 8, marginTop: 14 },
});
