import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, Alert, ActivityIndicator, Linking, useWindowDimensions,
  Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Circle } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { getSetting, setSetting } from '../../db/flights';
import { useScanQuotaStore } from '../../store/scanQuotaStore';
import { setScanBatch, spreadLimit, scanSpreadLimit, type ScanImage } from '../../store/scanStore';
import { useFlightStore } from '../../store/flightStore';
import { useScanBookStore } from '../../store/scanBookStore';
import {
  ScanCameraView, isScanCameraAvailable,
  type ScanCameraHandle, type ScanStatus, type ScanCapture, type ScanState,
} from '../../modules/scan-camera';

// Kameran för att skanna pappersloggboken. Liggande läge, en ram att passa in uppslaget i; kameran tar
// bilden själv när hela uppslaget är i ramen, skarpt och stilla. Sedan vänder man sida och nästa tas.
// Utseende (design A, "Side panels"): kamerabilden ligger fri i mitten. Till vänster en panel med vilket
// uppslag det gäller, vad man ska göra och tre bockar för det kameran väntar på; till höger lampa,
// avtryckare, Auto, tagna uppslag och Done.

// En hel bok ("Scan your whole logbook", ?book=1): fler uppslag i taget; fotona läggs i bokens skanning.
const BOOK_MAX = 60;
const ASPECT_KEY = 'scan_guide_aspect';
const DEFAULT_ASPECT = 1.5;
const OCR_WIDTH = 2000;             // samma bredd som övriga skanningsvägar

const HINTS: Record<ScanState, string> = {
  starting: 'Starting camera…',
  searching: 'Point the camera at your open logbook',
  fitInFrame: 'Fit the whole spread inside the frame',
  moveCloser: 'Move a little closer',
  center: 'Center the spread in the frame',
  tilt: 'Hold the phone parallel to the pages',
  dark: 'Too dark. Turn on the light',
  holdStill: 'Hold still',
  focus: 'Focusing…',
  ready: 'Hold still',
  capturing: 'Taking photo…',
  turnPage: 'Turn to the next spread',
};

type Spread = ScanCapture & { id: string };

export default function ScanCameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const camRef = useRef<ScanCameraHandle>(null);
  const available = isScanCameraAvailable();

  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [status, setStatus] = useState<ScanStatus>({ state: 'starting', progress: 0, aspect: DEFAULT_ASPECT });
  const [aspect, setAspect] = useState<number | null>(null);
  const [spreads, setSpreads] = useState<Spread[]>([]);
  const [autoCapture, setAutoCapture] = useState(true);
  const [torch, setTorch] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const lastAspect = useRef(DEFAULT_ASPECT);
  // Skärmen vrids till liggande när den öppnas (effekten nedan). Kameran startar direkt bakom en marinblå
  // täckare, så att bilden är framme när skärmen ligger ned; panelerna och kamerabilden visas först då, aldrig
  // hoptryckta i stående format. Har skärmen inte vridit sig efter en stund ber täckaren en vända telefonen.
  const win = useWindowDimensions();
  const landscape = win.width > win.height;
  const [late, setLate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLate(true), 2500); return () => clearTimeout(t); }, []);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);

  const bookMode = useLocalSearchParams<{ book?: string }>().book === '1';
  const { isPremium, isMax } = useFlightStore();
  // En vanlig skanning: aldrig fler uppslag än coinsen räcker till (skanningsrutans "about N spreads").
  const [max] = useState(() => (bookMode ? BOOK_MAX : scanSpreadLimit(isPremium || isMax)));
  const byCoins = !bookMode && max < spreadLimit(isPremium || isMax);
  const full = spreads.length >= max;

  // Liggande så länge kameran visas (expo-screen-orientation, som bokvyn). Stående igen när den stängs:
  // leave() nedan vrider tillbaka FÖRE navigeringen; låsen här är en reserv om skärmen stängs på annat sätt.
  // Kameran öppnas oftast från en dialog (valet av skanning) som just håller på att stängas. Så länge den
  // ligger kvar nekar iOS vridningen, och ett enda låsanrop vid öppningen gav då en stående kamera. Därför
  // upprepas låset tills skärmen ligger ned (varje anrop ber iOS vrida igen), eller tills man är på väg ut.
  useEffect(() => {
    const lock = () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {}); };
    lock();
    let tries = 0;
    const iv = setInterval(() => {
      const d = Dimensions.get('window');
      if (leavingRef.current || d.width > d.height || ++tries > 12) { clearInterval(iv); return; }
      lock();
    }, 250);
    return () => {
      clearInterval(iv);
      const portrait = () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
      portrait();
      setTimeout(portrait, 700);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const saved = parseFloat((await getSetting(ASPECT_KEY).catch(() => null)) ?? '');
      setAspect(Number.isFinite(saved) && saved > 0.8 ? saved : DEFAULT_ASPECT);
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
      setPermission(perm.granted ? 'granted' : 'denied');
    })();
  }, []);

  // Lämna kameran som bokvyn gör: släck kameran och panelerna, lås stående (fire-and-forget, lockAsync kan
  // hänga) och navigera först när skärmen står upp igen. Navigerar man först och vrider sedan ritas skärmen
  // under om i liggande format och blir kvar så (flygkortet bredare än skärmen, flikraden förskjuten).
  const leave = useCallback((go: () => void) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    const started = Date.now();
    const tick = () => {
      const d = Dimensions.get('window');
      const waitedMs = Date.now() - started;
      if ((d.height > d.width && waitedMs >= 230) || waitedMs >= 900) go();
      else setTimeout(tick, 40);
    };
    setTimeout(tick, 230);
  }, []);

  const onStatus = useCallback((e: { nativeEvent: ScanStatus }) => {
    lastAspect.current = e.nativeEvent.aspect;
    setStatus(e.nativeEvent);
  }, []);

  const onCapture = useCallback((e: { nativeEvent: ScanCapture }) => {
    const shot = e.nativeEvent;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSpreads(prev => [...prev, { ...shot, id: `${Date.now()}` }]);
    // Ramen har anpassat sig efter boken → kom ihåg proportionen till nästa gång.
    if (shot.detected) setSetting(ASPECT_KEY, lastAspect.current.toFixed(3)).catch(() => {});
  }, []);

  const onCameraError = useCallback((e: { nativeEvent: { code: string; message: string } }) => {
    if (e.nativeEvent.code === 'permission') { setPermission('denied'); return; }
    Alert.alert('Camera problem', e.nativeEvent.message);
  }, []);

  const shutter = () => {
    if (full || status.state === 'capturing') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    camRef.current?.capture().catch(() => {});
  };

  const removeSpread = (id: string) => {
    setSpreads(prev => {
      const hit = prev.find(s => s.id === id);
      if (hit) FileSystem.deleteAsync(hit.uri, { idempotent: true }).catch(() => {});
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) setTrayOpen(false);
      return next;
    });
    camRef.current?.rearm().catch(() => {});
  };

  const discardAll = () => {
    spreads.forEach(s => { FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => {}); });
    leave(() => router.back());
  };

  const close = () => {
    if (spreads.length === 0) { leave(() => router.back()); return; }
    Alert.alert(
      `Discard ${spreads.length === 1 ? 'this photo' : `${spreads.length} photos`}?`,
      'Nothing has been imported yet.',
      [{ text: 'Keep scanning', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: discardAll }],
    );
  };

  // Vidare till granskningen (arbetsbordet): JPEG base64, högst 2000 px bred, med storleken så att rutorna
  // kan ritas på rätt ställe.
  const finish = async () => {
    if (spreads.length === 0 || preparing) return;
    if (bookMode) {
      // Fotona (filer i cachen) förbereds i bokens skanning — inget kodas här.
      await useScanBookStore.getState().addPhotos(spreads.map((sp) => ({ uri: sp.uri, width: sp.width, height: sp.height, cropped: true })));
      leave(() => router.back());
      return;
    }
    setPreparing(true);
    try {
      const images: ScanImage[] = [];
      for (const s of spreads) {
        const actions: ImageManipulator.Action[] = s.width > OCR_WIDTH ? [{ resize: { width: OCR_WIDTH } }] : [];
        const out = await ImageManipulator.manipulateAsync(s.uri, actions, {
          compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true,
        });
        if (out.base64) images.push({ base64: out.base64, mediaType: 'image/jpeg', width: out.width, height: out.height, cropped: true, oriented: true });
      }
      if (images.length === 0) throw new Error('Could not prepare the photos.');
      spreads.forEach(s => { FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => {}); });
      for (let i = 0; i < images.length; i++) await useScanQuotaStore.getState().consumeScan();
      setScanBatch(images);
      leave(() => router.replace('/flight/scan-review'));
    } catch (e: any) {
      setPreparing(false);
      Alert.alert('Could not continue', e?.message ?? 'Try again.');
    }
  };

  // Panelerna: vänster med text, höger med knappar. Ramen får hela ytan däremellan.
  const padL = Math.max(insets.left, 16), padR = Math.max(insets.right, 16);
  const padB = Math.max(insets.bottom, 12) + 8;
  const leftW = padL + 178, rightW = padR + 92;
  const guideInsets: [number, number, number, number] = [14, rightW + 14, 14, leftW + 14];

  const st = status.state;
  const turned = st === 'turnPage' && spreads.length > 0;
  const hint = full
    ? byCoins
      ? `That's what your coins cover, ${max} spread${max === 1 ? '' : 's'}. Tap Done.`
      : `That's ${max} spreads, the most per ${bookMode ? 'round' : 'scan'}. Tap Done.`
    : turned
      ? 'Turn to the next spread'
      : !autoCapture && (st === 'ready' || st === 'holdStill')
        ? 'Tap the shutter to take the photo'
        : HINTS[st] ?? HINTS.searching;
  const good = st === 'ready' || st === 'capturing' || turned;
  const label = full
    ? `${spreads.length} SPREAD${spreads.length === 1 ? '' : 'S'} TAKEN`
    : turned ? `SPREAD ${spreads.length} TAKEN` : `SPREAD ${spreads.length + 1}`;
  // Bockarna i den ordning kameran prövar dem: uppslaget i ramen, sedan stilla, sedan skarpt. "dark" kommer
  // både med och utan hittad bok; bara med bok (coverage finns) är uppslaget i ramen.
  const framed = st === 'holdStill' || st === 'focus' || st === 'ready' || st === 'capturing' || (st === 'dark' && status.coverage != null);
  const still = st === 'focus' || st === 'ready' || st === 'capturing';
  const sharp = st === 'ready' || st === 'capturing';

  if (!available) {
    return (
      <Fallback
        insets={insets}
        icon="construct-outline"
        title="New scan camera needs an app update"
        body="This build of Blades doesn't include the new camera yet. Close and choose photos instead, or install the latest build."
        onClose={() => leave(() => router.back())}
      />
    );
  }
  if (permission === 'denied') {
    return (
      <Fallback
        insets={insets}
        icon="camera-outline"
        title="Camera access is off"
        body="Blades needs the camera to photograph your logbook pages. Turn it on in Settings."
        actionLabel="Open Settings"
        onAction={() => Linking.openSettings()}
        onClose={() => leave(() => router.back())}
      />
    );
  }

  return (
    <View style={s.root}>
      {permission === 'granted' && aspect != null && !leaving && (
        <ScanCameraView
          ref={camRef}
          style={StyleSheet.absoluteFill}
          active={!trayOpen && !preparing}
          autoCapture={landscape && autoCapture && !full}
          torch={torch}
          guideAspect={aspect}
          guideInsets={guideInsets}
          onStatus={onStatus}
          onCapture={onCapture}
          onCameraError={onCameraError}
        />
      )}

      {/* Vänster: stäng, vilket uppslag, vad man ska göra och vad kameran väntar på */}
      {landscape && !leaving && (
        <View style={[s.leftPanel, { width: leftW, paddingLeft: padL, paddingBottom: padB }]}>
          <TouchableOpacity style={s.closeBtn} onPress={close} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#DCE9F5" />
          </TouchableOpacity>
          <Text style={[s.panelLabel, good && { color: SCAN_GREEN }]}>{label}</Text>
          <Text style={s.panelHint} numberOfLines={4} adjustsFontSizeToFit minimumFontScale={0.75}>{hint}</Text>
          {!full && (
            <View style={s.checks} accessibilityLabel={`In the frame ${framed ? 'yes' : 'not yet'}, held still ${still ? 'yes' : 'not yet'}, sharp ${sharp ? 'yes' : 'not yet'}`}>
              <Check on={framed} text="In the frame" />
              <Check on={still} text="Held still" />
              <Check on={sharp} text="Sharp" />
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Text style={s.panelFoot}>
            {full ? 'Tap the photo to look through them.' : autoCapture ? 'The photo is taken by itself.' : 'Auto is off. You take each photo.'}
          </Text>
        </View>
      )}

      {/* Höger: lampa, avtryckare med Auto, tagna uppslag och Done */}
      {landscape && !leaving && (
        <View style={[s.rightPanel, { width: rightW, paddingRight: padR }]}>
          <TouchableOpacity
            style={[s.round, s.lightBtn, torch && s.roundActive]}
            onPress={() => setTorch(v => !v)}
            accessibilityRole="switch" accessibilityState={{ checked: torch }} accessibilityLabel="Light"
          >
            <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={torch ? '#06101E' : '#DCE9F5'} />
          </TouchableOpacity>

          <Shutter
            progress={autoCapture && st === 'ready' ? status.progress : 0}
            disabled={full || st === 'capturing'}
            onPress={shutter}
          />
          <TouchableOpacity
            style={s.autoTouch}
            onPress={() => setAutoCapture(v => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoCapture }}
            accessibilityLabel="Take photos automatically"
          >
            <View style={[s.chip, autoCapture && s.chipOn]}>
              <Text style={[s.chipText, autoCapture && s.chipTextOn]}>AUTO</Text>
            </View>
          </TouchableOpacity>

          <View style={[s.rightBottom, { bottom: padB, right: padR }]}>
            <TouchableOpacity
              style={[s.thumbWrap, spreads.length === 0 && s.thumbEmpty]}
              onPress={() => spreads.length > 0 && setTrayOpen(true)}
              disabled={spreads.length === 0}
              accessibilityLabel={`${spreads.length} spreads captured`}
            >
              {spreads.length > 0 ? (
                <>
                  <Image source={{ uri: spreads[spreads.length - 1].uri }} style={s.thumb} resizeMode="cover" />
                  <View style={s.badge}><Text style={s.badgeText}>{spreads.length}</Text></View>
                </>
              ) : (
                <Text style={s.thumbEmptyText}>0/{max}</Text>
              )}
            </TouchableOpacity>
            {spreads.length > 0 && (
              <TouchableOpacity
                style={s.doneBtn}
                onPress={finish}
                disabled={preparing}
                accessibilityRole="button"
                accessibilityLabel={`Done, read ${spreads.length} spreads`}
              >
                <Text style={s.doneText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {__DEV__ && !leaving && (
        <Text style={[s.dev, { left: leftW + 16, bottom: 2 }]}>
          {`${status.state} · ${status.detector ?? '-'} · sharp ${Math.round(status.sharpness ?? 0)} · lum ${Math.round(status.brightness ?? 0)} · cov ${(status.coverage ?? 0).toFixed(2)} · diff ${(status.sceneDiff ?? 0).toFixed(1)} · aspect ${status.aspect.toFixed(2)}`}
        </Text>
      )}

      {trayOpen && !leaving && (
        <View style={[s.tray, { paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }]}>
          <Text style={s.trayTitle}>{spreads.length === 1 ? '1 spread' : `${spreads.length} spreads`}</Text>
          <ScrollView horizontal contentContainerStyle={s.trayList} showsHorizontalScrollIndicator={false}>
            {spreads.map((sp, i) => (
              <View key={sp.id} style={s.trayItem}>
                <Image source={{ uri: sp.uri }} style={[s.trayImage, { aspectRatio: sp.width / Math.max(sp.height, 1) }]} resizeMode="contain" />
                <View style={s.trayItemRow}>
                  <Text style={s.trayLabel}>Spread {i + 1}{sp.detected ? '' : ' · frame crop'}</Text>
                  <TouchableOpacity onPress={() => removeSpread(sp.id)} hitSlop={10} accessibilityLabel={`Delete spread ${i + 1}`}>
                    <Ionicons name="trash-outline" size={18} color={Colors.dangerLight} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={s.trayActions}>
            <TouchableOpacity style={s.traySecondary} onPress={() => setTrayOpen(false)}>
              <Text style={s.traySecondaryText}>{full ? 'Back' : 'Keep scanning'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.trayPrimary} onPress={finish} disabled={preparing}>
              <Text style={s.trayPrimaryText}>{spreads.length === 1 ? 'Read 1 spread' : `Read ${spreads.length} spreads`}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {preparing && (
        <View style={s.preparing}>
          <ActivityIndicator color="#fff" />
          <Text style={s.preparingText}>Preparing photos…</Text>
        </View>
      )}

      {/* Täckare medan skärmen vrids: in till liggande när kameran öppnas, tillbaka till stående när den stängs. */}
      {(leaving || !landscape) && (
        <View style={s.cover}>
          {!leaving && late && (
            <>
              <Ionicons name="phone-landscape-outline" size={34} color="#B4C9DD" />
              <Text style={s.coverTitle}>Turn your phone sideways</Text>
              <Text style={s.coverBody}>The logbook camera works in landscape.</Text>
              <TouchableOpacity style={s.traySecondary} onPress={() => leave(() => router.back())} accessibilityRole="button">
                <Text style={s.traySecondaryText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const SCAN_GREEN = '#00E8A0';

// En rad i vänsterpanelen: tom ring tills kameran är nöjd, grön bock sedan.
function Check({ on, text }: { on: boolean; text: string }) {
  return (
    <View style={s.checkRow}>
      <View style={[s.checkRing, on && s.checkRingOn]}>
        {on && <Ionicons name="checkmark" size={13} color="#06101E" />}
      </View>
      <Text style={[s.checkText, on && s.checkTextOn]}>{text}</Text>
    </View>
  );
}

// Avtryckaren. Ringen fylls medan kameran väntar på att uppslaget ska ligga still (auto).
function Shutter({ progress, disabled, onPress }: { progress: number; disabled: boolean; onPress: () => void }) {
  const size = 76, stroke = 4, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityLabel="Take photo" style={{ opacity: disabled ? 0.4 : 1 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.9)" strokeWidth={stroke} fill="none" />
          {progress > 0 && (
            <Circle
              cx={size / 2} cy={size / 2} r={r} stroke={Colors.success} strokeWidth={stroke} fill="none"
              strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.min(1, progress))}
              strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </Svg>
        <View style={s.shutterInner} />
      </View>
    </TouchableOpacity>
  );
}

function Fallback({ insets, icon, title, body, actionLabel, onAction, onClose }: {
  insets: { top: number; left: number; right: number; bottom: number };
  icon: keyof typeof Ionicons.glyphMap; title: string; body: string;
  actionLabel?: string; onAction?: () => void; onClose: () => void;
}) {
  return (
    <View style={[s.root, s.fallback, { paddingLeft: insets.left + 24, paddingRight: insets.right + 24 }]}>
      <Ionicons name={icon} size={32} color={Colors.textSecondary} />
      <Text style={s.fallbackTitle}>{title}</Text>
      <Text style={s.fallbackBody}>{body}</Text>
      <View style={s.fallbackActions}>
        {actionLabel && onAction && (
          <TouchableOpacity style={s.trayPrimary} onPress={onAction}><Text style={s.trayPrimaryText}>{actionLabel}</Text></TouchableOpacity>
        )}
        <TouchableOpacity style={s.traySecondary} onPress={onClose}><Text style={s.traySecondaryText}>Close</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // Paneler i appens marinblå, alltid mörka (kameran följer inte appens tema).
  leftPanel: {
    position: 'absolute', left: 0, top: 0, bottom: 0, paddingTop: 8, paddingRight: 16,
    backgroundColor: '#0A1628', borderRightWidth: 1, borderRightColor: 'rgba(127,168,200,0.18)',
  },
  closeBtn: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  panelLabel: {
    marginTop: 10, marginBottom: 6, fontFamily: 'JetBrainsMono', fontSize: 10, fontWeight: '700', letterSpacing: 1.8,
    color: '#00C8E8',
  },
  panelHint: { fontFamily: 'Fraunces', fontSize: 21, lineHeight: 25, fontWeight: '600', color: '#fff', marginBottom: 16 },
  checks: { gap: 9 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  checkRing: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(143,176,204,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkRingOn: { borderColor: SCAN_GREEN, backgroundColor: SCAN_GREEN },
  checkText: { fontSize: 13.5, fontWeight: '600', color: '#B4C9DD' },
  checkTextOn: { color: '#fff' },
  panelFoot: { fontSize: 12, lineHeight: 16, color: '#8FB0CC' },

  rightPanel: {
    position: 'absolute', right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0A1628', borderLeftWidth: 1, borderLeftColor: 'rgba(127,168,200,0.18)',
  },
  round: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(127,168,200,0.3)', backgroundColor: 'rgba(15,30,58,0.6)',
  },
  roundActive: { backgroundColor: '#FFB830', borderColor: '#FFB830' },
  lightBtn: { position: 'absolute', top: 14, left: 24 },   // mitt i panelens 92 pt breda yta
  autoTouch: { height: 44, marginTop: 4, justifyContent: 'center' },
  chip: {
    height: 28, paddingHorizontal: 12, borderRadius: 14, justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(143,176,204,0.5)',
  },
  chipOn: { borderColor: '#00C8E8', backgroundColor: 'rgba(0,200,232,0.16)' },
  chipText: { fontFamily: 'JetBrainsMono', color: '#B4C9DD', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  chipTextOn: { color: '#5FD9EE' },

  rightBottom: { position: 'absolute', left: 0, alignItems: 'center', gap: 8 },
  doneBtn: {
    width: 84, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#00C8E8',
  },
  doneText: { color: '#06101E', fontSize: 15, fontWeight: '700' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  thumbWrap: {
    width: 64, height: 44, borderRadius: 8, overflow: 'visible',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: '#152338',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(143,176,204,0.5)', backgroundColor: 'transparent' },
  thumbEmptyText: { fontFamily: 'JetBrainsMono', color: '#B4C9DD', fontSize: 12, fontWeight: '700' },
  thumb: { width: '100%', height: '100%', borderRadius: 7 },
  badge: {
    position: 'absolute', top: -8, right: -8, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: Colors.textInverse, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },

  dev: { position: 'absolute', color: 'rgba(255,255,255,0.75)', fontSize: 10, fontFamily: 'Menlo' },

  tray: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,12,24,0.94)',
    paddingTop: 20, paddingBottom: 20, gap: 14,
  },
  trayTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  trayList: { gap: 14, alignItems: 'center' },
  trayItem: { width: 280, gap: 8 },
  trayImage: { width: 280, maxHeight: 190, borderRadius: 8, backgroundColor: '#111' },
  trayItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trayLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  trayActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  trayPrimary: { height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: Colors.primary, justifyContent: 'center' },
  trayPrimaryText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
  traySecondary: {
    height: 44, paddingHorizontal: 22, borderRadius: 22, justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  traySecondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  preparing: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  preparingText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0A1628',
    alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32,
  },
  coverTitle: { color: '#fff', fontFamily: 'Fraunces', fontSize: 21, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  coverBody: { color: '#B4C9DD', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 10 },

  fallback: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.background },
  fallbackTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  fallbackBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 460 },
  fallbackActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
