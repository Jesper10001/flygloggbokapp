import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, PanResponder,
  useWindowDimensions, type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';

// Signaturen lagras upplösningsoberoende som SVG-path-strängar + ritytans mått,
// så den kan skalas till valfri storlek (skärm, loggbokssida, PDF).
export interface SignatureData {
  paths: string[];
  w: number;   // bounding box-bredd (beskuren till faktiskt bläck)
  h: number;   // bounding box-höjd
  x?: number;  // bounding box-origo X
  y?: number;  // bounding box-origo Y
}

const INK = '#16243F';
const rnd = (n: number) => Math.round(n);

function extendBbox(b: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number) {
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

// ── Ritytan ────────────────────────────────────────────────────
export function SignaturePad({ initial, onChange, height = 200 }: {
  initial?: SignatureData | null;
  onChange: (sig: SignatureData) => void;
  height?: number;
}) {
  const sizeRef = useRef({ w: initial?.w ?? 0, h: initial?.h ?? height });
  const pathsRef = useRef<string[]>(initial?.paths ?? []);
  const bboxRef = useRef(
    initial && initial.w
      ? { minX: initial.x ?? 0, minY: initial.y ?? 0, maxX: (initial.x ?? 0) + initial.w, maxY: (initial.y ?? 0) + initial.h }
      : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const [paths, setPaths] = useState<string[]>(initial?.paths ?? []);
  const [cur, setCur] = useState('');
  const curRef = useRef('');
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        extendBbox(bboxRef.current, locationX, locationY);
        lastPtRef.current = { x: locationX, y: locationY };
        curRef.current = `M${rnd(locationX)},${rnd(locationY)}`;
        setCur(curRef.current);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const last = lastPtRef.current;
        // Glesa ut punkter (hoppa mikrorörelser) — håller SVG-banan liten.
        if (last && Math.abs(locationX - last.x) < 2.5 && Math.abs(locationY - last.y) < 2.5) return;
        lastPtRef.current = { x: locationX, y: locationY };
        extendBbox(bboxRef.current, locationX, locationY);
        curRef.current += ` L${rnd(locationX)},${rnd(locationY)}`;
        setCur(curRef.current);
      },
      onPanResponderRelease: () => {
        if (!curRef.current) return;
        const next = [...pathsRef.current, curRef.current];
        pathsRef.current = next;
        setPaths(next);
        const b = bboxRef.current;
        const pad = 8;
        const x = Math.max(0, Math.floor(b.minX - pad));
        const y = Math.max(0, Math.floor(b.minY - pad));
        const w = Math.max(1, Math.ceil(b.maxX - b.minX) + pad * 2);
        const h = Math.max(1, Math.ceil(b.maxY - b.minY) + pad * 2);
        onChange({ paths: next, x, y, w, h });
        curRef.current = '';
        setCur('');
        lastPtRef.current = null;
      },
    }),
  ).current;

  const onLayout = (ev: LayoutChangeEvent) => {
    const { width, height: h } = ev.nativeEvent.layout;
    sizeRef.current = { w: Math.round(width), h: Math.round(h) };
  };

  return (
    <View style={[styles.pad, { height }]} onLayout={onLayout} {...responder.panHandlers}>
      <Svg width="100%" height="100%">
        {paths.map((d, i) => (
          <Path key={i} d={d} stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {cur ? <Path d={cur} stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </Svg>
    </View>
  );
}

// ── Read-only-vy (förhandsvisning) ─────────────────────────────
export function SignatureView({ data, height = 60, color = INK }: {
  data?: SignatureData | null;
  height?: number;
  color?: string;
}) {
  if (!data || !data.paths?.length || !data.w || !data.h) return null;
  const width = Math.round(height * (data.w / data.h));
  return (
    <Svg width={width} height={height} viewBox={`${data.x ?? 0} ${data.y ?? 0} ${data.w} ${data.h}`}>
      {data.paths.map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

// ── Modal med ritytan ──────────────────────────────────────────
export function SignatureModal({ visible, initial, onClose, onSave }: {
  visible: boolean;
  initial?: SignatureData | null;
  onClose: () => void;
  onSave: (sig: SignatureData | null) => void;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const [sig, setSig] = useState<SignatureData | null>(initial ?? null);
  const [padKey, setPadKey] = useState(0);

  // Skapa signaturen i liggande — bredare ruta, lättare att skriva snyggt.
  useEffect(() => {
    if (!visible) return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    setSig(initial ?? null);
    setPadKey((k) => k + 1);
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const padH = Math.max(140, Math.min(240, Math.round(height * 0.48)));

  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.panel, { width: Math.min(width - 32, 760) }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('signature_title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={Colors.textSecondary} /></TouchableOpacity>
          </View>
          <Text style={styles.hint}>{t('signature_hint')}</Text>

          <SignaturePad key={padKey} initial={sig} onChange={setSig} height={padH} />

          <View style={styles.row}>
            <TouchableOpacity style={styles.clearBtn} onPress={() => { setSig(null); setPadKey((k) => k + 1); }} activeOpacity={0.7}>
              <Ionicons name="refresh" size={16} color={Colors.textSecondary} />
              <Text style={styles.clearText}>{t('signature_clear')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.saveBtn} onPress={() => { onSave(sig); onClose(); }} activeOpacity={0.85}>
              <Text style={styles.saveText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pad: { borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { backgroundColor: Colors.surface, borderRadius: 18, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  hint: { color: Colors.textSecondary, fontSize: 12.5, marginTop: -4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 6 },
  clearText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  saveText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
});
