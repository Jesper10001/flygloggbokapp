// Transkriberings-hjälp: zoomar in ETT uppslag och panorerar kolumn för kolumn.
// Stående läge. Den vänstra kolumnen centreras först; pil → nästa kolumn centreras.
// Kolumnernas mittpunkter räknas deterministiskt ur mallens kolumnbredder (samma
// geometri som renderSpread: pagePad 16 + margin), så ingen injicerad JS behövs.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, useWindowDimensions, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { SpreadWebView } from './SpreadWebView';
import type { LogbookTemplate } from '../../constants/logbookTemplates';
import type { LogbookSpread } from '../../services/logbook/paginate';
import type { SignatureData } from '../SignaturePad';

const PAGE_PAD = 16;   // renderSpread .page padding-left
const MARGIN = 10;     // desk-marginal vi skickar till renderSpread
const ZOOM = 2.2;      // hur mycket uppslaget förstoras (läsbarhet)

export function TranscribeOverlay({
  spread, template, pilotName, timeFormat, signature, onClose,
}: {
  spread: LogbookSpread;
  template: LogbookTemplate;
  pilotName: string;
  timeFormat: 'decimal' | 'hhmm';
  signature?: SignatureData | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [colIndex, setColIndex] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null); // höjd/bredd
  // Scroll-offset som Animated.Value → rektangeln flyttas nativt i synk med scrollen (ingen JS-släpning).
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const [geom, setGeom] = useState<{ top: number; botData: number; botSum: number; colX?: number[] } | null>(null);

  // Lås stående medan man transkriberar; återställ liggande (bok-läsaren) vid stängning.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {}); };
  }, []);

  const columns = useMemo(() => [...template.left_columns, ...template.right_columns], [template]);

  // Kolumnernas mittpunkter (CSS-px) + dokumentbredd (viewport).
  const { centers, lefts, viewportWidth } = useMemo(() => {
    const contentWidth = columns.reduce((s, c) => s + c.width, 0);
    const vw = contentWidth + PAGE_PAD * 2 + 2 + MARGIN * 2; // = renderSpreads viewportWidth
    const left0 = MARGIN + PAGE_PAD;                          // tabellens vänsterkant
    const cs: number[] = [];
    const ls: number[] = [];
    let x = left0;
    for (const c of columns) { ls.push(x); cs.push(x + c.width / 2); x += c.width; }
    return { centers: cs, lefts: ls, viewportWidth: vw };
  }, [columns]);

  const availW = winW;
  // Ingen övre header längre — bara loggboken + nedre pil-navigering.
  const footerH = 76 + insets.bottom;
  const availH = Math.max(240, winH - insets.top - footerH);

  const contentZoomW = Math.round(viewportWidth * ZOOM);
  const contentZoomH = aspect ? Math.round(contentZoomW * aspect) : Math.round(contentZoomW * 0.55);

  // Exakta kolumnkanter (CSS-px) från DOM-mätningen; fallback till mall-beräknade lefts.
  const colX = geom?.colX;
  const colLeftCss = (i: number) => (colX && colX[i] != null ? colX[i] : lefts[i]);
  const colRightCss = (i: number) => (colX && colX[i + 1] != null ? colX[i + 1] : lefts[i] + columns[i].width);

  const focus = (i: number) => {
    const idx = Math.max(0, Math.min(i, columns.length - 1));
    const cx = ((colLeftCss(idx) + colRightCss(idx)) / 2) * ZOOM;  // kolumnens mitt i zoomad bild
    const x = Math.max(0, Math.min(cx - availW / 2, Math.max(0, contentZoomW - availW)));
    scrollRef.current?.scrollTo({ x, animated: true });
  };

  // Centrera om vid byte av kolumn (och när bredden är klar).
  useEffect(() => { const id = setTimeout(() => focus(colIndex), 60); return () => clearTimeout(id); }, [colIndex, contentZoomW]); // eslint-disable-line react-hooks/exhaustive-deps

  const col = columns[colIndex];
  const colLabel = col ? (col.group ? `${col.group} · ${col.label}` : col.label) : '';
  const isLastCol = colIndex >= columns.length - 1;
  const isFirstCol = colIndex <= 0;

  // Rektangel runt kolumnens datarutor (12 rader) + ev. summering. Vänster/höger följer
  // horisontell panorering (scrollX), topp/botten följer vertikal (scrollY); containern
  // klipper det som hamnar utanför. Bara numeriska kolumner (decimal/int) har summerings-
  // värden till höger om etiketten → för dem når rektangeln ned till "Total to date".
  // Text-/plats-/remarks-kolumner stannar vid sista dataraden.
  const hasSummary = !!col && (col.format === 'decimal' || col.format === 'int');
  // Rektangelns statiska CSS-position (zoomad); scroll-offset läggs på nativt via transform.
  const rLeft = col ? colLeftCss(colIndex) * ZOOM : 0;
  const rRight = col ? colRightCss(colIndex) * ZOOM : 0;
  const rTop = geom ? geom.top * ZOOM : 0;
  const rBot = geom ? (hasSummary ? geom.botSum : geom.botData) * ZOOM : 0;

  return (
    <Modal visible animationType="slide" supportedOrientations={['portrait']} onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: insets.top }]}>
        {/* Ingen header — bara loggboken. Stäng sker via nedre bakåt-/avbryt-knappen. */}
        {/* Zoomat uppslag — vertikal scroll för rader, horisontell för kolumner */}
        <View style={{ height: availH, overflow: 'hidden' }}>
          <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ minHeight: availH }}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}>
            <Animated.ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              scrollEventThrottle={16}
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
            >
              <View pointerEvents="none" style={{ width: contentZoomW, height: contentZoomH }}>
                <SpreadWebView
                  spread={spread}
                  template={template}
                  pilotName={pilotName}
                  timeFormat={timeFormat}
                  width={contentZoomW}
                  signature={signature}
                  interactive={false}
                  margin={MARGIN}
                  onAspect={setAspect}
                  onGeometry={setGeom}
                />
              </View>
            </Animated.ScrollView>
          </Animated.ScrollView>
          {/* Sluten rektangel runt kolumnens datarutor + summering. Statisk CSS-position;
              scroll läggs på nativt via transform → följer innehållet exakt utan släpning.
              −1.5/+3 centrerar 3px-kanten på kolumnens exakta gränslinjer. */}
          {geom && col && rRight > rLeft && rBot > rTop && (
            <Animated.View pointerEvents="none" style={[s.rect, {
              left: rLeft - 1.5, top: rTop - 1.5,
              width: (rRight - rLeft) + 3, height: (rBot - rTop) + 3,
              transform: [
                { translateX: Animated.multiply(scrollX, -1) },
                { translateY: Animated.multiply(scrollY, -1) },
              ],
            }]} />
          )}
        </View>

        {/* Pil-navigering */}
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[s.arrow, isFirstCol ? s.arrowCancel : null]}
            onPress={() => { if (isFirstCol) onClose(); else setColIndex((i) => Math.max(0, i - 1)); }}
            activeOpacity={0.85}
          >
            <Ionicons name={isFirstCol ? 'close' : 'chevron-back'} size={26} color={isFirstCol ? Colors.textInverse : Colors.textSecondary} />
          </TouchableOpacity>

          <View style={s.dots}>
            <Text style={s.dotsText}>{colIndex + 1} / {columns.length}</Text>
          </View>

          <TouchableOpacity
            style={[s.arrow, isLastCol ? s.arrowDone : s.arrowNext]}
            onPress={() => { if (isLastCol) onClose(); else setColIndex((i) => Math.min(columns.length - 1, i + 1)); }}
            activeOpacity={0.85}
          >
            <Ionicons name={isLastCol ? 'checkmark' : 'chevron-forward'} size={26} color={Colors.textInverse} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hCenter: { flex: 1, alignItems: 'center' },
  hTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', maxWidth: 260 },
  hSub: { color: Colors.textMuted, fontSize: 11, marginTop: 1 },

  // Sluten rektangel (blå kant + svag fyllning + glöd) runt kolumnens datarutor + summering.
  rect: { position: 'absolute', borderWidth: 3, borderColor: Colors.primary, borderRadius: 5, backgroundColor: Colors.primary + '14', shadowColor: Colors.primary, shadowOpacity: 0.7, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: Colors.surface + '80', borderTopWidth: 0.5, borderTopColor: Colors.border },
  arrow: { width: 64, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  arrowNext: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  arrowDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  arrowCancel: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  arrowOff: { opacity: 0.4 },
  dots: { flex: 1, alignItems: 'center' },
  dotsText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
