import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, Alert, ActivityIndicator, Linking,
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
import { setScanBatch, spreadLimit, type ScanImage } from '../../store/scanStore';
import { useFlightStore } from '../../store/flightStore';
import { useScanBookStore } from '../../store/scanBookStore';
import {
  ScanCameraView, isScanCameraAvailable,
  type ScanCameraHandle, type ScanStatus, type ScanCapture, type ScanState,
} from '../../modules/scan-camera';

// Kameran för att skanna pappersloggboken. Liggande läge, en ram att passa in uppslaget i; kameran tar
// bilden själv när hela uppslaget är i ramen, skarpt och stilla. Sedan vänder man sida och nästa tas.

// En hel bok ("Scan your whole logbook", ?book=1): fler uppslag i taget; fotona läggs i bokens skanning.
const BOOK_MAX = 60;
const ASPECT_KEY = 'scan_guide_aspect';
const DEFAULT_ASPECT = 1.5;
const OCR_WIDTH = 2000;             // samma bredd som övriga skanningsvägar

const HINTS: Record<ScanState, string> = {
  starting: 'Starting camera…',
  searching: 'Point the camera at an open logbook spread',
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

  const bookMode = useLocalSearchParams<{ book?: string }>().book === '1';
  const { isPremium, isMax } = useFlightStore();
  const max = bookMode ? BOOK_MAX : spreadLimit(isPremium || isMax);
  const full = spreads.length >= max;

  // Liggande så länge kameran visas (expo-screen-orientation, som bokvyn). Stående igen när den stängs —
  // direkt, och en gång till när övergången är klar.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
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
    router.back();
  };

  const close = () => {
    if (spreads.length === 0) { router.back(); return; }
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
      router.back();
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
      router.replace('/flight/scan-review');
    } catch (e: any) {
      setPreparing(false);
      Alert.alert('Could not continue', e?.message ?? 'Try again.');
    }
  };

  // Plats för knapparna: hintraden överst, knappkolumnen till höger.
  const rightCol = insets.right + 16 + 76 + 12;
  const guideInsets: [number, number, number, number] = [insets.top + 64, rightCol, insets.bottom + 18, insets.left + 18];

  const hint = full
    ? `That's ${max} spreads, the most per ${bookMode ? 'round' : 'scan'}. Tap Done.`
    : status.state === 'turnPage' && spreads.length > 0
      ? `Spread ${spreads.length} captured. Turn the page`
      : !autoCapture && (status.state === 'ready' || status.state === 'holdStill')
        ? 'Tap the shutter to take the photo'
        : HINTS[status.state] ?? HINTS.searching;
  const good = status.state === 'ready' || (status.state === 'turnPage' && spreads.length > 0);

  if (!available) {
    return (
      <Fallback
        insets={insets}
        icon="construct-outline"
        title="New scan camera needs an app update"
        body="This build of Blades doesn't include the new camera yet. Close and choose photos instead, or install the latest build."
        onClose={() => router.back()}
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
        onClose={() => router.back()}
      />
    );
  }

  return (
    <View style={s.root}>
      {permission === 'granted' && aspect != null && (
        <ScanCameraView
          ref={camRef}
          style={StyleSheet.absoluteFill}
          active={!trayOpen && !preparing}
          autoCapture={autoCapture && !full}
          torch={torch}
          guideAspect={aspect}
          guideInsets={guideInsets}
          onStatus={onStatus}
          onCapture={onCapture}
          onCameraError={onCameraError}
        />
      )}

      {/* Överst: stäng, instruktion, Auto + lampa */}
      <View style={[s.topRow, { top: insets.top + 12, left: insets.left + 16, right: rightCol }]}>
        <RoundButton icon="close" onPress={close} label="Close" />
        <View style={[s.hintPill, good && s.hintPillGood]}>
          {good && <Ionicons name="checkmark-circle" size={16} color={Colors.success} />}
          <Text style={s.hintText} numberOfLines={1}>{hint}</Text>
        </View>
        <TouchableOpacity
          style={[s.chip, autoCapture && s.chipOn]}
          onPress={() => setAutoCapture(v => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: autoCapture }}
          accessibilityLabel="Take photos automatically"
        >
          <Text style={[s.chipText, autoCapture && s.chipTextOn]}>AUTO</Text>
        </TouchableOpacity>
        <RoundButton icon={torch ? 'flashlight' : 'flashlight-outline'} active={torch} onPress={() => setTorch(v => !v)} label="Light" />
      </View>

      {/* Höger: Done, avtryckare, tagna uppslag */}
      <View style={[s.rightCol, { right: insets.right + 16, top: insets.top + 12, bottom: insets.bottom + 18 }]}>
        <TouchableOpacity
          style={[s.doneBtn, spreads.length === 0 && s.doneBtnHidden]}
          onPress={finish}
          disabled={spreads.length === 0 || preparing}
          accessibilityLabel={`Done, read ${spreads.length} spreads`}
        >
          <Text style={s.doneText}>Done</Text>
        </TouchableOpacity>

        <Shutter
          progress={autoCapture && status.state === 'ready' ? status.progress : 0}
          disabled={full || status.state === 'capturing'}
          onPress={shutter}
        />

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
      </View>

      {__DEV__ && (
        <Text style={[s.dev, { left: insets.left + 18, bottom: insets.bottom + 6 }]}>
          {`${status.state} · ${status.detector ?? '-'} · sharp ${Math.round(status.sharpness ?? 0)} · lum ${Math.round(status.brightness ?? 0)} · cov ${(status.coverage ?? 0).toFixed(2)} · diff ${(status.sceneDiff ?? 0).toFixed(1)} · aspect ${status.aspect.toFixed(2)}`}
        </Text>
      )}

      {trayOpen && (
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
    </View>
  );
}

function RoundButton({ icon, onPress, active, label }: {
  icon: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean; label: string;
}) {
  return (
    <TouchableOpacity style={[s.round, active && s.roundActive]} onPress={onPress} accessibilityLabel={label} hitSlop={6}>
      <Ionicons name={icon} size={20} color={active ? Colors.textInverse : '#fff'} />
    </TouchableOpacity>
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

  topRow: { position: 'absolute', height: 40, flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,22,40,0.62)',
  },
  roundActive: { backgroundColor: Colors.warning },
  hintPill: {
    flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 16, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,22,40,0.72)',
  },
  hintPillGood: { backgroundColor: 'rgba(0,60,44,0.78)' },
  hintText: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chip: {
    height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(10,22,40,0.62)',
  },
  chipOn: { borderColor: Colors.primary, backgroundColor: 'rgba(0,200,232,0.18)' },
  chipText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  chipTextOn: { color: Colors.primary },

  rightCol: { position: 'absolute', width: 76, alignItems: 'center', justifyContent: 'space-between' },
  doneBtn: {
    width: 76, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  doneBtnHidden: { opacity: 0 },
  doneText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  thumbWrap: {
    width: 64, height: 44, borderRadius: 8, overflow: 'visible',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(10,22,40,0.62)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbEmpty: { borderColor: 'rgba(255,255,255,0.3)' },
  thumbEmptyText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
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

  fallback: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.background },
  fallbackTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  fallbackBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 460 },
  fallbackActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
