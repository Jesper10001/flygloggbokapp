import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useScanQuotaStore, MONTHLY_QUOTA, QUOTAS_ENABLED } from '../../store/scanQuotaStore';
import { presentPaywall } from '../../services/purchases';
import { setScanBatch, setScanSources, setScanUseBookLayout, getScanUseBookLayout, setScanFocus, MAX_SPREADS, type ScanImage } from '../../store/scanStore';
import { useScanBookStore, sessionsOf } from '../../store/scanBookStore';
import { PremiumModal } from '../../components/PremiumModal';
import { askAiConsent } from '../../services/aiConsent';
import { getActiveDigitalBook } from '../../db/digitalBooks';
import { getAnyTemplate } from '../../db/customTemplates';
import { isScanCameraAvailable } from '../../modules/scan-camera';
import { isAvailable as visionAvailable } from '../../modules/apple-vision-ocr';
import { getDeviceId } from '../../services/anthropicClient';
import * as Crypto from 'expo-crypto';
import { getSetting, setSetting } from '../../db/flights';
import { loadLedger } from '../../services/paperLedger';
import { ledgerStatus, type LedgerStatus } from '../../services/scanPaperFixes';
import { PaperFixGuide } from '../../components/scan/PaperFixGuide';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { GlassDialog } from '../../components/GlassDialog';

// Startsidan för att skanna pappersloggboken: hur det går till, vilken loggbok som läses, och vägen in i
// kameran (eller fotobiblioteket). Själva kameran ligger i scan-camera.tsx, granskningen i flight/review.

const OCR_WIDTH = 2000;

type BookInfo = { name: string; layout: string; rows: number } | null;

export default function ScanImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isPremium } = useFlightStore();
  const { load, totalRemaining, monthlyRemaining, extraScans, canScan, loaded } = useScanQuotaStore();
  const cameraAvailable = isScanCameraAvailable();

  const [book, setBook] = useState<BookInfo | undefined>(undefined);
  const [sameLayout, setSameLayout] = useState(getScanUseBookLayout());
  const chooseLayout = (same: boolean) => { setSameLayout(same); setScanUseBookLayout(same); };
  const [working, setWorking] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [devHash, setDevHash] = useState<string | null>(null);
  // Förra valet av fokus ("What matters most to you?") förväljs när granskningen frågar efter läsningen.
  useEffect(() => {
    getSetting('scan_focus').then((v) => {
      if (v === 'exact' || v === 'balanced' || v === 'totals') setScanFocus(v);
    }).catch(() => {});
  }, []);
  // Regel som användaren bekräftat i en tidigare skanning: total = avgång → ankomst + tillägg (t.ex. 0.2 h).
  const [addition, setAddition] = useState<number | null>(null);
  const forgetAddition = () => { setAddition(null); setSetting('scan_time_addition', '').catch(() => {}); };
  // Felräknade summor i pappersboken från tidigare skanningar (services/paperLedger.ts) → kortet öppnar guiden.
  const [paper, setPaper] = useState<LedgerStatus | null>(null);
  const [paperGuide, setPaperGuide] = useState(false);
  const { timeFormat } = useTimeFormatStore();
  const reloadPaper = () => loadLedger().then((l) => setPaper(ledgerStatus(l))).catch(() => {});

  useEffect(() => { load(); }, []);

  // "Scan your whole logbook": en pågående skanning av hela boken visas på kortet (fortsätt där man var).
  const wholeBook = useScanBookStore((st) => st.project);
  const loadBook = useScanBookStore((st) => st.load);
  useEffect(() => { loadBook(); }, []);
  const bookSessions = wholeBook ? sessionsOf(wholeBook.photos) : [];
  const bookSaved = bookSessions.filter((x) => x.saved).length;
  const openWholeBook = async () => {
    if (!(await ready())) return;
    // replace: startsidan är ett modalfönster; granskningen och kameran öppnas ovanpå helbokssidan.
    router.replace('/import/scan-book');
  };

  // Dev: enhetens hash som proxyn använder (samma som hashDevice i proxy/src/index.ts). Står den i
  // QUOTA_EXEMPT_DEVICES kostar skanningarna inga Blade coins medan funktionen byggs.
  useEffect(() => {
    if (!__DEV__) return;
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `blades-device:v2:${getDeviceId()}`)
      .then((hex) => setDevHash(`d2_${hex.slice(0, 32)}`))
      .catch(() => {});
  }, []);

  // Läses om när man kommer tillbaka från loggbokssidan (där mallen väljs).
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      try {
        const b = await getActiveDigitalBook();
        const tpl = b ? await getAnyTemplate(b.template_id) : null;
        if (alive) setBook(b && tpl ? { name: b.name, layout: tpl.name, rows: b.rows_per_spread } : null);
      } catch {
        if (alive) setBook(null);
      }
      const add = parseFloat((await getSetting('scan_time_addition').catch(() => null)) ?? '');
      if (alive) setAddition(add > 0 ? add : null);
      if (alive) reloadPaper();
    })();
    return () => { alive = false; };
  }, []));

  if (!isPremium && loaded && totalRemaining() <= 0) {
    return (
      <View style={s.container}>
        <PremiumModal visible={true} onClose={() => router.back()} feature={t('import_scan_title')} />
      </View>
    );
  }

  // OCR är ett AI-anrop → samtycke innan kameran/biblioteket öppnas, och kvoten kontrolleras först.
  const ready = async (): Promise<boolean> => {
    if (!canScan()) { setShowBuy(true); return false; }
    return askAiConsent();
  };

  const toReview = async (images: ScanImage[]) => {
    for (let i = 0; i < images.length; i++) await useScanQuotaStore.getState().consumeScan();
    setScanBatch(images);
    router.replace('/flight/scan-review');   // ersätter modalfönstret (se openCamera)
  };

  const prepare = async (uris: string[], compress: number, cropped: boolean) => {
    const images: ScanImage[] = [];
    for (const uri of uris) {
      // Ingen auto-rotation: modellen klarar en roterad bok, och ramens form säger inget om bokens.
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: OCR_WIDTH } }], {
        compress, format: ImageManipulator.SaveFormat.JPEG, base64: true,
      });
      if (out.base64) images.push({ base64: out.base64, mediaType: 'image/jpeg', width: out.width, height: out.height, cropped });
    }
    return images;
  };

  // "Photograph your logbook" → först valet kamera eller fotoalbum (samtycke och kvot kontrolleras innan).
  // Kameran/väljaren öppnas när rutan stängts helt — iOS visar inte två presentationer samtidigt.
  const [sourcePicker, setSourcePicker] = useState(false);
  const startScan = async () => {
    if (!(await ready())) return;
    setSourcePicker(true);
  };
  const pickSource = (src: 'camera' | 'library') => {
    setSourcePicker(false);
    setTimeout(() => { (src === 'camera' ? openCamera(true) : choosePhotos(true)).catch(() => {}); }, 320);
  };

  const openCamera = async (checked = false) => {
    if (!checked && !(await ready())) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('permission_required'), t('camera_permission'));
      return;
    }
    // replace: startsidan är ett modalfönster; kameran måste vara en vanlig skärm för att kunna bli liggande.
    if (cameraAvailable) { router.replace('/import/scan-camera'); return; }
    await scanWithSystemScanner();
  };

  // Byggen utan den nya kameran: iOS inbyggda dokumentskanner (beskär och rätar upp, men vet inget om
  // loggböcker). Lazy-require så att appen inte kraschar i ett bygge utan modulen.
  const scanWithSystemScanner = async () => {
    let DocumentScanner: any;
    try {
      DocumentScanner = require('react-native-document-scanner-plugin').default;
    } catch {
      Alert.alert('Camera not available', 'Choose photos from your library instead.');
      return;
    }
    try {
      const { scannedImages, status } = await DocumentScanner.scanDocument({
        maxNumDocuments: MAX_SPREADS, croppedImageQuality: 90,
      });
      if (status === 'cancel' || !scannedImages?.length) return;
      setWorking(true);
      const images = await prepare(scannedImages, 0.85, true);
      if (images.length === 0) { Alert.alert(t('error'), t('could_not_process_image')); return; }
      await toReview(images);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message ?? 'Scan failed');
    } finally {
      setWorking(false);
    }
  };

  const choosePhotos = async (checked = false) => {
    if (!checked && !(await ready())) return;
    // quality 1: ingen omkodning i väljaren (granskningen skalar och kodar ändå) → snabbare tillbaka.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: visionAvailable() ? 1 : 0.9,
      allowsMultipleSelection: true, selectionLimit: MAX_SPREADS, orderedSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    // Utan Apple Vision vrids och beskärs varje foto i "Frame the logbook" innan det läses.
    if (!visionAvailable()) {
      setScanSources(result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
      router.replace('/import/scan-crop');
      return;
    }
    // Annars direkt till läsningen: granskningen förbereder fotona (skalar och kodar) och hittar boken i
    // varje foto, vrider den rätt, rätar upp och beskär (findLogbook). Inget görs här, så att läsningsskärmen
    // syns direkt efter valet.
    await toReview(result.assets.map((a) => ({
      base64: '', sourceUri: a.uri, mediaType: 'image/jpeg' as const, width: a.width, height: a.height, cropped: false, oriented: false,
    })));
  };

  const remaining = loaded ? totalRemaining() : 0;
  const monthly = loaded ? monthlyRemaining() : 0;
  const extra = loaded ? extraScans : 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Samma uppbyggnad och stil som Import logbook (app/import/index.tsx). */}
      <View style={s.hero}>
        <Text style={s.title}>Scan logbook</Text>
        <Text style={s.subtitle}>Photograph your paper logbook. Claude reads every row, and you check anything it is unsure of before it is saved.</Text>
      </View>

      <TouchableOpacity style={[s.uploadCard, working && { opacity: 0.85 }]} onPress={startScan} disabled={working} activeOpacity={0.9}>
        <View style={s.uploadIconWrap}>
          {working ? <ActivityIndicator color={Colors.primary} size="large" /> : <Ionicons name="camera-outline" size={30} color={Colors.primary} />}
        </View>
        <Text style={s.uploadTitle}>{working ? 'Preparing…' : 'Photograph your logbook'}</Text>
        {!working && (
          <Text style={s.uploadSub}>
            Take the photos now, or choose photos you've already taken. Up to {MAX_SPREADS} spreads per scan.
          </Text>
        )}
      </TouchableOpacity>

      {/* En hel bok på en gång: alla foton förbereds direkt och formatet läses från första uppslaget; sedan
          granskas boken tio uppslag i taget (app/import/scan-book). */}
      <TouchableOpacity style={s.rowCard} onPress={openWholeBook} disabled={working} activeOpacity={0.8} accessibilityRole="button">
        <View style={s.rowIcon}><Ionicons name="library-outline" size={18} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowTitle}>{wholeBook?.photos.length ? 'Continue scanning your whole logbook' : 'Scan your whole logbook'}</Text>
          <Text style={s.rowSub}>
            {wholeBook?.photos.length
              ? `${wholeBook.photos.length} ${wholeBook.photos.length === 1 ? 'spread' : 'spreads'} · ${bookSaved} of ${bookSessions.length} ${bookSessions.length === 1 ? 'part' : 'parts'} saved${wholeBook.flightsSaved ? ` · ${wholeBook.flightsSaved} flights` : ''}`
              : `Add every spread at once. Blades straightens the photos and reads your logbook's format, then you check ${MAX_SPREADS} spreads at a time.`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </TouchableOpacity>

      <GlassDialog
        visible={sourcePicker}
        onClose={() => setSourcePicker(false)}
        eyebrow="SCAN LOGBOOK"
        title="Photograph your logbook"
        body="Take the photos now, or choose photos you've already taken."
        secondary={{ label: 'Cancel', onPress: () => setSourcePicker(false) }}
      >
        <View style={s.sourceList}>
          {([
            ['camera', 'camera-outline', 'Take photos', cameraAvailable
              ? 'Hold your phone sideways. The camera takes the photo when the whole spread is sharp.'
              : 'Uses the iPhone document scanner. The new logbook camera comes with the next app build.'],
            ['library', 'images-outline', 'Choose from your photos', `Up to ${MAX_SPREADS} photos. Blades finds and straightens the logbook in each one.`],
          ] as const).map(([key, icon, title, sub]) => (
            <TouchableOpacity key={key} style={s.sourceRow} onPress={() => pickSource(key)} activeOpacity={0.8} accessibilityRole="button">
              <View style={s.rowIcon}><Ionicons name={icon} size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{title}</Text>
                <Text style={s.rowSub}>{sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </GlassDialog>

      {/* Bara om användaren redan har en loggbok i appen: samma upplägg som den man fotar? Ja → skannern får
          bokens kolumner. Ingen bok → ingen fråga, Claude läser kolumnerna själv. */}
      {book ? (
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>Your logbook in Blades</Text>
          <View>
            <Text style={s.stepTitle}>{book.layout}</Text>
            <Text style={s.stepDesc}>Is the logbook you're scanning laid out the same way?</Text>
          </View>
          <View style={s.choiceRow}>
            {([[true, 'Same layout'], [false, 'Different']] as const).map(([v, text]) => (
              <TouchableOpacity key={text} style={[s.choiceBtn, sameLayout === v && s.choiceBtnOn]} onPress={() => chooseLayout(v)}
                accessibilityRole="radio" accessibilityState={{ selected: sameLayout === v }}>
                <Text style={[s.choiceText, sameLayout === v && s.choiceTextOn]}>{text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {addition ? (
        <View style={s.infoCard}>
          <Text style={s.infoTitle}>Learned from your logbook</Text>
          <View style={s.learnedRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>Total time = departure → arrival + {addition} h</Text>
              <Text style={s.stepDesc}>You confirmed this in an earlier scan, so those rows aren't questioned.</Text>
            </View>
            <TouchableOpacity onPress={forgetAddition} hitSlop={8} accessibilityLabel="Forget this rule">
              <Text style={s.forget}>Forget</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {paper && paper.open > 0 ? (
        <TouchableOpacity style={s.rowCard} onPress={() => setPaperGuide(true)} activeOpacity={0.8}>
          <View style={[s.rowIcon, !paper.ready && { backgroundColor: Colors.warning + '1A' }]}>
            <Ionicons name={paper.ready ? 'create-outline' : 'hourglass-outline'} size={18} color={paper.ready ? Colors.primary : Colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>Paper logbook fixes</Text>
            <Text style={s.rowSub}>
              {paper.ready
                ? `Ready: ${paper.open === 1 ? 'a miscounted total' : `${paper.open} miscounted totals`} to fix, with every total after them.`
                : `${paper.open === 1 ? 'A miscounted total' : `${paper.open} miscounted totals`} found. Wait with your paper logbook until it's scanned to the page you're writing on.`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      ) : null}

      {/* Hur det går till — en verklig ordningsföljd, därav siffrorna */}
      <View style={s.infoCard}>
        <Text style={s.infoTitle}>How it works</Text>
        {[
          ['Photograph each spread', 'Use the camera, or choose photos from your library.'],
          ['Claude reads every row', `Up to ${MAX_SPREADS} spreads per scan. Anything Claude is unsure of is circled on the page.`],
          ['Check and save', 'Choose how much you want to check — you see the estimated time first. Answer the questions one at a time, see every flight in the scan report, then save. Nothing is saved until you approve.'],
        ].map(([title, body], i) => (
          <View key={title} style={s.stepRow}>
            <View style={s.stepBubble}><Text style={s.stepNum}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>{title}</Text>
              <Text style={s.stepDesc}>{body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={s.infoCard}>
        <Text style={s.infoTitle}>Works best with</Text>
        {([
          ['sunny-outline', 'Even light', 'no shadows or glare on the pages'],
          ['scan-outline', 'The whole spread', 'both pages, including the totals at the bottom'],
          ['reader-outline', 'Readable writing', 'one spread per photo, held straight'],
        ] as const).map(([icon, term, desc]) => (
          <View key={term} style={s.bulletRow}>
            <Ionicons name={icon} size={15} color={Colors.primary} />
            <Text style={s.bulletTerm}>{term}</Text>
            <Text style={[s.bulletDesc, { flex: 1 }]}>{desc}</Text>
          </View>
        ))}
      </View>

      {__DEV__ && devHash && (
        <Text style={s.devHash} selectable>Dev · device for free scans: {devHash}</Text>
      )}

      {/* Bara när de lokala skanningskvoterna är påslagna (annars styr proxyns Blade-coins). */}
      {QUOTAS_ENABLED && (
        <View style={s.quotaCard}>
          <View style={s.quotaRow}>
            <Text style={s.quotaLabel}>{t('scan_remaining')}</Text>
            <Text style={[s.quotaValue, remaining === 0 && { color: Colors.danger }]}>{remaining}</Text>
          </View>
          <View style={s.quotaBarBg}>
            <View style={[s.quotaBarFill, { width: `${Math.min(100, (monthly / MONTHLY_QUOTA) * 100)}%` }]} />
          </View>
          <Text style={s.quotaDetail}>
            {monthly}/{MONTHLY_QUOTA} {t('scan_monthly')}
            {extra > 0 ? `  +  ${extra} ${t('scan_extra')}` : ''}
          </Text>
        </View>
      )}

      {/* Slut på skanningar: gratis → Premium-betalväggen (RevenueCat); Premium → fylls på nästa månad. */}
      {showBuy && (
        <View style={s.buyOverlay}>
          <View style={s.buySheet}>
            <Ionicons name="warning" size={32} color={Colors.gold} />
            <Text style={s.buySheetTitle}>{t('scan_no_scans_title')}</Text>
            <Text style={s.buySheetDesc}>{isPremium ? t('scan_no_scans_desc') : t('scan_no_scans_free_desc')}</Text>
            {!isPremium && (
              <TouchableOpacity
                style={s.packCard}
                onPress={() => { setShowBuy(false); presentPaywall('Logbook scan'); }}
                activeOpacity={0.8}
              >
                <Text style={s.packTitle}>{t('scan_see_premium')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowBuy(false)}>
              <Text style={{ color: Colors.textMuted, fontSize: 13, marginTop: 8 }}>{isPremium ? t('ok') : t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {paperGuide && <PaperFixGuide visible timeFormat={timeFormat} onClose={() => { setPaperGuide(false); reloadPaper(); }} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  // Samma mått och färger som Import logbook (app/import/index.tsx).
  hero: { gap: 4, marginBottom: 2 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  uploadCard: {
    alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 18,
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary + '80',
    backgroundColor: Colors.primary + '0D',
  },
  uploadIconWrap: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '33',
  },
  uploadTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 2 },
  uploadSub: { color: Colors.textSecondary, fontSize: 12.5, textAlign: 'center', lineHeight: 17 },
  sourceList: { alignSelf: 'stretch', gap: 8, marginTop: 14 },
  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '33',
  },
  rowTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rowSub: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  infoCard: {
    backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 14, gap: 12,
  },
  infoTitle: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepBubble: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '1C', borderWidth: 1, borderColor: Colors.primary + '33', marginTop: 1,
  },
  stepNum: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  stepTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  stepDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  learnedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  forget: { color: Colors.dangerLight, fontSize: 13.5, fontWeight: '700' },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletTerm: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  bulletDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choiceBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  choiceBtnOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  choiceText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  choiceTextOn: { color: Colors.primary },
  devHash: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo', textAlign: 'center' },

  quotaCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 6,
  },
  quotaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quotaLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  quotaValue: { color: Colors.primary, fontSize: 22, fontWeight: '800', fontFamily: 'Menlo' },
  quotaBarBg: { height: 4, borderRadius: 2, backgroundColor: Colors.border, overflow: 'hidden' },
  quotaBarFill: { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  quotaDetail: { color: Colors.textMuted, fontSize: 11 },

  buyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24,
  },
  buySheet: { backgroundColor: Colors.surface, borderRadius: 18, padding: 20, alignItems: 'center', gap: 10 },
  buySheetTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  buySheetDesc: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  packCard: {
    alignSelf: 'stretch', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: Colors.gold + '88',
  },
  packTitle: { color: Colors.gold, fontSize: 14, fontWeight: '700' },
});
