import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, PanResponder, ActivityIndicator, Alert, LayoutAnimation,
  useWindowDimensions, type LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';
import { AppBackground } from '../../components/AppBackground';
import { getScanSources, setScanBatch, getScanTimeBasis, setScanTimeBasis, type ScanImage, type TimeBasis } from '../../store/scanStore';
import { useScanQuotaStore } from '../../store/scanQuotaStore';
import { suggestFraming, type Rotation } from '../../services/scanFrame';
import { getSetting, setSetting } from '../../db/flights';
import type { Rect } from '../../services/scanGeometry';

// "Frame the logbook": foton ur kamerarullen vrids rätt och beskärs så att bara loggboken kommer med,
// innan Claude läser dem. Blades föreslår vridning och ram (Apple Vision); användaren justerar med hörnen,
// flyttar ramen genom att dra inuti den och vrider 90° åt gången. Här väljs också om tiderna i boken är UTC
// eller lokal tid. Ett foto i taget; sedan vidare till läsningen (flight/scan-review).

const OCR_WIDTH = 2000;
const MIN = 0.12;            // minsta ramstorlek (andel av bilden)
const HANDLE = 44;           // träffyta för hörnen

type Shown = { uri: string; width: number; height: number };

export default function ScanCropScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const sources = useMemo(() => getScanSources(), []);

  const [index, setIndex] = useState(0);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [stage, setStage] = useState({ w: W - 32, h: 360 });
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [basis, setBasis] = useState<TimeBasis>(getScanTimeBasis());
  const [working, setWorking] = useState(false);
  const done = useRef<ScanImage[]>([]);
  const touched = useRef(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const src = sources[index];

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    getSetting('scan_time_basis').then((v) => { if (v === 'utc' || v === 'local') { setBasis(v); setScanTimeBasis(v); } }).catch(() => {});
  }, []);

  // Visningskopia för aktuell vridning (mindre, så att det går snabbt att rita).
  useEffect(() => {
    if (!src) return;
    let alive = true;
    ImageManipulator.manipulateAsync(src.uri, [...(rotation ? [{ rotate: rotation }] : []), { resize: { width: 1400 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG })
      .then((r) => { if (alive) setShown({ uri: r.uri, width: r.width, height: r.height }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [src, rotation]);

  // Förslag från Blades: vridning + ram runt loggboken. Skriver inte över om användaren redan börjat justera.
  useEffect(() => {
    if (!src) return;
    let alive = true;
    touched.current = false;
    setSuggested(false);
    setSuggesting(true);
    setRotation(0);
    setRect({ x: 0, y: 0, w: 1, h: 1 });
    suggestFraming(src.uri).then((sg) => {
      if (!alive || !sg || touched.current) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setRotation(sg.rotation);
      if (sg.rect) setRect(sg.rect);
      setSuggested(true);
    }).finally(() => { if (alive) setSuggesting(false); });
    return () => { alive = false; };
  }, [src]);

  // Bilden i scenen (contain).
  const fit = useMemo(() => {
    if (!shown) return { x: 0, y: 0, w: stage.w, h: stage.h };
    const s = Math.min(stage.w / shown.width, stage.h / shown.height);
    const w = shown.width * s, h = shown.height * s;
    return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
  }, [shown, stage]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Hörnen och ramen dras med PanResponder; ramen hålls inom bilden och aldrig mindre än MIN.
  const makePan = (kind: 'tl' | 'tr' | 'bl' | 'br' | 'move') => {
    let start: Rect = rectRef.current;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { start = rectRef.current; touched.current = true; setSuggested(false); },
      onPanResponderMove: (_, g) => {
        const dx = g.dx / fitRef.current.w, dy = g.dy / fitRef.current.h;
        let x0 = start.x, y0 = start.y, x1 = start.x + start.w, y1 = start.y + start.h;
        if (kind === 'move') {
          const nx = Math.max(0, Math.min(1 - start.w, start.x + dx));
          const ny = Math.max(0, Math.min(1 - start.h, start.y + dy));
          setRect({ x: nx, y: ny, w: start.w, h: start.h });
          return;
        }
        if (kind === 'tl' || kind === 'bl') x0 = Math.max(0, Math.min(x1 - MIN, x0 + dx));
        if (kind === 'tr' || kind === 'br') x1 = Math.min(1, Math.max(x0 + MIN, x1 + dx));
        if (kind === 'tl' || kind === 'tr') y0 = Math.max(0, Math.min(y1 - MIN, y0 + dy));
        if (kind === 'bl' || kind === 'br') y1 = Math.min(1, Math.max(y0 + MIN, y1 + dy));
        setRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      },
    });
  };
  const pans = useMemo(() => ({
    tl: makePan('tl'), tr: makePan('tr'), bl: makePan('bl'), br: makePan('br'), move: makePan('move'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const rotate = () => {
    touched.current = true;
    setSuggested(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Ramen följer med vridningen medurs 90°: (x, y, w, h) → (1 − y − h, x, h, w).
    setRect((r) => ({ x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }));
    setRotation((d) => (((d + 90) % 360) as Rotation));
  };

  const chooseBasis = (b: TimeBasis) => { setBasis(b); setScanTimeBasis(b); setSetting('scan_time_basis', b).catch(() => {}); };

  // Vrid + beskär från originalet (full upplösning), högst 2000 px bred, och gå vidare.
  const confirm = async () => {
    if (!src || working) return;
    setWorking(true);
    try {
      const rotated = await ImageManipulator.manipulateAsync(src.uri, rotation ? [{ rotate: rotation }] : [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      const crop = {
        originX: Math.round(rect.x * rotated.width), originY: Math.round(rect.y * rotated.height),
        width: Math.max(1, Math.round(rect.w * rotated.width)), height: Math.max(1, Math.round(rect.h * rotated.height)),
      };
      const actions: ImageManipulator.Action[] = [{ crop }];
      if (crop.width > OCR_WIDTH) actions.push({ resize: { width: OCR_WIDTH } });
      const out = await ImageManipulator.manipulateAsync(rotated.uri, actions, { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!out.base64) throw new Error('Could not prepare the photo.');
      done.current = [...done.current, { base64: out.base64, mediaType: 'image/jpeg', width: out.width, height: out.height, cropped: true, oriented: true }];
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (index + 1 < sources.length) { setIndex(index + 1); setShown(null); setWorking(false); return; }
      for (let i = 0; i < done.current.length; i++) await useScanQuotaStore.getState().consumeScan();
      setScanBatch(done.current);
      router.replace('/flight/scan-review');
    } catch (e: any) {
      setWorking(false);
      Alert.alert('Could not continue', e?.message ?? 'Try again.');
    }
  };

  const onStage = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - stage.w) > 1 || Math.abs(height - stage.h) > 1) setStage({ w: width, h: height });
  };

  if (!src) {
    return (
      <View style={[s.root, s.center]}>
        <AppBackground />
        <Text style={s.title}>No photo to frame</Text>
        <TouchableOpacity style={s.secondary} onPress={() => router.back()}><Text style={s.secondaryText}>Go back</Text></TouchableOpacity>
      </View>
    );
  }

  // Ramen i scenens koordinater.
  const fx = fit.x + rect.x * fit.w, fy = fit.y + rect.y * fit.h, fw = rect.w * fit.w, fh = rect.h * fit.h;
  const dim = 'rgba(3,8,16,0.62)';

  return (
    <View style={s.root}>
      <AppBackground />
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={s.close} accessibilityLabel="Cancel">
          <Ionicons name="close" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.title}>Frame the logbook</Text>
          {sources.length > 1 && <Text style={s.step}>PHOTO {index + 1} OF {sources.length}</Text>}
        </View>
        <View style={{ width: 38 }} />
      </View>

      <View style={s.stage} onLayout={onStage}>
        {shown ? (
          <>
            <Image source={{ uri: shown.uri }} style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fit.h }} resizeMode="stretch" />
            {/* Nedtonat utanför ramen */}
            <View pointerEvents="none" style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fy - fit.y, backgroundColor: dim }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: fit.x, top: fy + fh, width: fit.w, height: fit.y + fit.h - fy - fh, backgroundColor: dim }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: fit.x, top: fy, width: fx - fit.x, height: fh, backgroundColor: dim }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: fx + fw, top: fy, width: fit.x + fit.w - fx - fw, height: fh, backgroundColor: dim }} />
            {/* Ramen: dra inuti för att flytta, tredjedelslinjer */}
            <View {...pans.move.panHandlers} style={[s.frame, { left: fx, top: fy, width: fw, height: fh }]}>
              <View pointerEvents="none" style={[s.third, { left: '33.3%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View pointerEvents="none" style={[s.third, { left: '66.6%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View pointerEvents="none" style={[s.third, { top: '33.3%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
              <View pointerEvents="none" style={[s.third, { top: '66.6%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            </View>
            {/* Hörnen (samma formspråk som skanningskameran) */}
            {([['tl', fx, fy], ['tr', fx + fw, fy], ['bl', fx, fy + fh], ['br', fx + fw, fy + fh]] as const).map(([k, cx, cy]) => (
              <View key={k} {...pans[k].panHandlers} style={[s.handle, { left: cx - HANDLE / 2, top: cy - HANDLE / 2 }]}>
                <View style={[s.bracket, k === 'tl' && s.bTL, k === 'tr' && s.bTR, k === 'bl' && s.bBL, k === 'br' && s.bBR]} />
              </View>
            ))}
          </>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.status}>
          {suggesting ? (
            <><ActivityIndicator size="small" color={Colors.primary} /><Text style={s.statusText}>Finding the logbook…</Text></>
          ) : suggested ? (
            <><Ionicons name="sparkles" size={14} color={Colors.primary} /><Text style={s.statusText}>Blades framed the logbook. Adjust if needed.</Text></>
          ) : (
            <Text style={s.statusText}>Turn the photo so the writing reads normally, then drag the corners so only the logbook is inside the frame.</Text>
          )}
        </View>

        <View style={s.row}>
          <TouchableOpacity style={s.secondary} onPress={rotate} accessibilityLabel="Rotate 90 degrees">
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={s.secondaryText}>Rotate</Text>
          </TouchableOpacity>
          <View style={s.basis}>
            <Text style={s.basisLabel}>TIMES IN THE BOOK</Text>
            <View style={s.segment}>
              {(['utc', 'local'] as const).map((b) => (
                <TouchableOpacity key={b} style={[s.segBtn, basis === b && s.segBtnOn]} onPress={() => chooseBasis(b)}
                  accessibilityRole="radio" accessibilityState={{ selected: basis === b }}>
                  <Text style={[s.segText, basis === b && s.segTextOn]}>{b === 'utc' ? 'UTC' : 'Local'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity style={[s.primary, (working || !shown) && { opacity: 0.6 }]} onPress={confirm} disabled={working || !shown}>
          {working ? <ActivityIndicator color={Colors.textInverse} /> : (
            <>
              <Ionicons name="checkmark" size={20} color={Colors.textInverse} />
              <Text style={s.primaryText}>{index + 1 < sources.length ? 'Next photo' : 'Read logbook'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  close: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(10,22,40,0.5)',
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  step: { color: Colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, fontFamily: 'Menlo', marginTop: 2 },

  stage: { flex: 1, marginHorizontal: 16, marginVertical: 8, alignItems: 'center', justifyContent: 'center' },
  frame: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(0,200,232,0.7)' },
  third: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' },
  bracket: { width: 22, height: 22, borderColor: Colors.primary },
  bTL: { borderLeftWidth: 3.5, borderTopWidth: 3.5, borderTopLeftRadius: 6, transform: [{ translateX: 10 }, { translateY: 10 }] },
  bTR: { borderRightWidth: 3.5, borderTopWidth: 3.5, borderTopRightRadius: 6, transform: [{ translateX: -10 }, { translateY: 10 }] },
  bBL: { borderLeftWidth: 3.5, borderBottomWidth: 3.5, borderBottomLeftRadius: 6, transform: [{ translateX: 10 }, { translateY: -10 }] },
  bBR: { borderRightWidth: 3.5, borderBottomWidth: 3.5, borderBottomRightRadius: 6, transform: [{ translateX: -10 }, { translateY: -10 }] },

  bottom: { paddingHorizontal: 16, gap: 12 },
  status: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(10,22,40,0.6)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  statusText: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  secondary: {
    height: 46, paddingHorizontal: 18, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  secondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  basis: { flex: 1, gap: 4 },
  basisLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  segment: { flexDirection: 'row', height: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', padding: 3, gap: 3 },
  segBtn: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: Colors.primary + '26' },
  segText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  segTextOn: { color: Colors.primary, fontWeight: '800' },
  primary: { height: 54, borderRadius: 14, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },
});
