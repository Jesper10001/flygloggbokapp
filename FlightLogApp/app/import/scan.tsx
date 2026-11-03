import { HowItWorks } from '../../components/HowItWorks';
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useScanQuotaStore, MONTHLY_QUOTA, QUOTAS_ENABLED } from '../../store/scanQuotaStore';
import { presentPaywall } from '../../services/purchases';
import { setScanUseBookLayout, getScanUseBookLayout, setScanFromOnboarding, MAX_SPREADS, spreadLimit, TEST_BUILD } from '../../store/scanStore';
import { useScanBookStore, sessionsOf } from '../../store/scanBookStore';
import { PremiumModal } from '../../components/PremiumModal';
import { askAiConsent } from '../../services/aiConsent';
import { getActiveDigitalBook } from '../../db/digitalBooks';
import { getAnyTemplate } from '../../db/customTemplates';
import { getDeviceId } from '../../services/anthropicClient';
import * as Crypto from 'expo-crypto';
import { getSetting, setSetting } from '../../db/flights';
import { loadLedger } from '../../services/paperLedger';
import { ledgerStatus, type LedgerStatus } from '../../services/scanPaperFixes';
import { PaperFixGuide } from '../../components/scan/PaperFixGuide';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { GlassDialog } from '../../components/GlassDialog';
import { useLogbookScanStart } from '../../components/LogbookScanChooser';

// Startsidan för att skanna pappersloggboken: hur det går till, vilken loggbok som läses, och vägen in i
// kameran (eller fotobiblioteket). Själva kameran ligger i scan-camera.tsx, granskningen i flight/review.


type BookInfo = { name: string; layout: string; rows: number } | null;

export default function ScanImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isPremium, isMax } = useFlightStore();
  // Gratisanvändare skannar högst FREE_SPREADS uppslag åt gången; hela boken kräver Premium.
  const paying = isPremium || isMax;
  const limit = spreadLimit(paying);
  const limitText = paying ? `Up to ${limit} spreads per scan` : `Up to ${limit} spreads per scan on the free plan`;
  const from = useLocalSearchParams<{ from?: string }>().from;
  useEffect(() => { setScanFromOnboarding(from === 'onboarding'); }, [from]);
  const { load, totalRemaining, monthlyRemaining, extraScans, canScan, loaded } = useScanQuotaStore();
  const [showBuy, setShowBuy] = useState(false);
  const logbookScan = useLogbookScanStart({ replace: true, onNoScans: () => setShowBuy(true) });

  const [book, setBook] = useState<BookInfo | undefined>(undefined);
  const [sameLayout, setSameLayout] = useState(getScanUseBookLayout());
  const chooseLayout = (same: boolean) => { setSameLayout(same); setScanUseBookLayout(same); };
  const [devHash, setDevHash] = useState<string | null>(null);
  // Regel som användaren bekräftat i en tidigare skanning: total = avgång → ankomst + tillägg (t.ex. 0.2 h).
  const [addition, setAddition] = useState<number | null>(null);
  const [ruleInfo, setRuleInfo] = useState(false);   // rutan med regeln (Keep / Forget)
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
    // Hela boken är Premium. En skanning som redan påbörjats går att fortsätta.
    if (!paying && !wholeBook?.photos.length) { presentPaywall('Logbook scan'); return; }
    if (!(await ready())) return;
    // replace: startsidan är ett modalfönster; granskningen och kameran öppnas ovanpå helbokssidan.
    router.replace('/import/scan-book');
  };

  // Testbyggen: enhetens hash som proxyn använder (samma som hashDevice i proxy/src/index.ts). Står den i
  // QUOTA_EXEMPT_DEVICES kostar skanningarna inga Blade coins medan funktionen byggs. TestFlight-appen har ett
  // annat id än dev-builden (annat bundle-id), så den får en egen hash.
  useEffect(() => {
    if (!TEST_BUILD) return;
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

  const remaining = loaded ? totalRemaining() : 0;
  const monthly = loaded ? monthlyRemaining() : 0;
  const extra = loaded ? extraScans : 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Samma uppbyggnad och stil som Import logbook (app/import/index.tsx). */}
      <View style={s.hero}>
        <Text style={s.title}>Logbook scan</Text>
        <Text style={s.subtitle}>Photograph your paper logbook. Claude reads every row, and you check anything it is unsure of before it is saved.</Text>
      </View>

      <TouchableOpacity style={s.uploadCard} onPress={logbookScan.start} activeOpacity={0.9}>
        <View style={s.uploadIconWrap}>
          <Ionicons name="camera-outline" size={30} color={Colors.primary} />
        </View>
        <Text style={s.uploadTitle}>Photograph your logbook</Text>
        <Text style={s.uploadSub}>
          Take the photos now, or choose photos you've already taken. {limitText}.
        </Text>
      </TouchableOpacity>

      {/* Tre enkla rader: hela boken (alla foton på en gång, granskas tio uppslag i taget, app/import/scan-book),
          regeln som lärts från boken och rättelserna i pappersboken. De två sista syns bara när det finns något. */}
      <View style={s.lines}>
        <Line
          icon="library-outline"
          title="Whole logbook"
          status={!wholeBook?.photos.length ? (paying ? 'All at once' : 'Premium') : bookSaved === bookSessions.length ? 'All saved' : `${bookSaved}/${bookSessions.length} parts`}
          a11y={wholeBook?.photos.length
            ? `Continue scanning your whole logbook. ${wholeBook.photos.length} spreads, ${bookSaved} of ${bookSessions.length} parts saved.`
            : `Scan your whole logbook. Add every spread at once, then check ${MAX_SPREADS} spreads at a time.`}
          onPress={openWholeBook}
        />
        {addition ? (
          <Line icon="sparkles-outline" title="Flight time rule" status={`+${addition} h`} a11y={`Learned from your logbook: total time is departure to arrival plus ${addition} hours.`} onPress={() => setRuleInfo(true)} />
        ) : null}
        {paper && paper.open > 0 ? (
          <Line
            icon={paper.ready ? 'create-outline' : 'hourglass-outline'}
            title="Paper logbook fixes"
            status={`${paper.open} ${paper.ready ? 'ready' : 'waiting'}`}
            a11y={paper.ready
              ? `Paper logbook fixes: ${paper.open} ready to fix.`
              : `Paper logbook fixes: ${paper.open} found. Wait until your logbook is scanned to the page you're writing on.`}
            onPress={() => setPaperGuide(true)}
          />
        ) : null}
      </View>

      <GlassDialog
        visible={ruleInfo}
        onClose={() => setRuleInfo(false)}
        eyebrow="LEARNED FROM YOUR LOGBOOK"
        title={`Total time = departure → arrival + ${addition ?? 0} h`}
        body="You confirmed this in an earlier scan, so those rows aren't questioned."
        primary={{ label: 'Keep', onPress: () => setRuleInfo(false) }}
        secondary={{ label: 'Forget', onPress: () => { setRuleInfo(false); forgetAddition(); } }}
      />

      {logbookScan.chooser}

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

      {/* Hur det går till — en verklig ordningsföljd, därav siffrorna */}
      <HowItWorks steps={[
        { t: 'Photograph each spread', d: 'Use the camera, or choose photos from your library.' },
        { t: 'Claude reads every row', d: `${limitText}. Anything Claude is unsure of is circled on the page.` },
        { t: 'Check and save', d: 'Choose how much you want to check — you see the estimated time first. Answer the questions one at a time, see every flight in the scan report, then save. Nothing is saved until you approve.' },
      ]} />

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

      {/* Osynlig: håll fingret längst ner på sidan och välj Kopiera. Bara hashen kopieras. */}
      {TEST_BUILD && devHash && (
        <Text style={s.devHash} selectable accessibilityLabel="Device id for free test scans">{devHash}</Text>
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

// En rad under "Photograph your logbook": ikon, namn, läge och pil.
function Line({ icon, title, status, a11y, onPress, disabled }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; status: string; a11y: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity style={s.line} onPress={onPress} disabled={disabled} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={a11y}>
      <Ionicons name={icon} size={18} color={Colors.textSecondary} />
      <Text style={s.lineTitle} numberOfLines={1}>{title}</Text>
      <Text style={s.lineStatus} numberOfLines={1}>{status}</Text>
      <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
    </TouchableOpacity>
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
  lines: { borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder, marginBottom: -StyleSheet.hairlineWidth },
  lineTitle: { flex: 1, color: Colors.textPrimary, fontSize: 14.5, fontWeight: '600' },
  lineStatus: { color: Colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  infoCard: {
    backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 14, gap: 12,
  },
  infoTitle: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  stepTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  stepDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletTerm: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  bulletDesc: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choiceBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  choiceBtnOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  choiceText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  choiceTextOn: { color: Colors.primary },
  devHash: { color: 'transparent', fontSize: 11, fontFamily: 'Menlo', textAlign: 'center', paddingVertical: 12 },

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
