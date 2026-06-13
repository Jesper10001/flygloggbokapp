// Transkriberings-hjälp: zoomar in ETT uppslag och panorerar kolumn för kolumn.
// Stående läge. Den vänstra kolumnen centreras först; pil → nästa kolumn centreras.
// Kolumnernas mittpunkter räknas deterministiskt ur mallens kolumnbredder (samma
// geometri som renderSpread: pagePad 16 + margin), så ingen injicerad JS behövs.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, useWindowDimensions,
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
  const [scrollX, setScrollX] = useState(0);

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
  const headerH = 56;
  const footerH = 76 + insets.bottom;
  const availH = Math.max(240, winH - insets.top - headerH - footerH);

  const contentZoomW = Math.round(viewportWidth * ZOOM);
  const contentZoomH = aspect ? Math.round(contentZoomW * aspect) : Math.round(contentZoomW * 0.55);

  const focus = (i: number) => {
    const idx = Math.max(0, Math.min(i, columns.length - 1));
    const cx = centers[idx] * ZOOM;                        // mittpunkt i zoomad bild
    const x = Math.max(0, Math.min(cx - availW / 2, Math.max(0, contentZoomW - availW)));
    scrollRef.current?.scrollTo({ x, animated: true });
  };

  // Centrera om vid byte av kolumn (och när bredden är klar).
  useEffect(() => { const id = setTimeout(() => focus(colIndex), 60); return () => clearTimeout(id); }, [colIndex, contentZoomW]); // eslint-disable-line react-hooks/exhaustive-deps

  const col = columns[colIndex];
  const colLabel = col ? (col.group ? `${col.group} · ${col.label}` : col.label) : '';
  const isLastCol = colIndex >= columns.length - 1;
  const isFirstCol = colIndex <= 0;

  // Kolumnens vänster-/högerkant på skärmen (följer med panorering via scrollX).
  const curLeftX = col ? lefts[colIndex] * ZOOM - scrollX : 0;
  const curRightX = col ? (lefts[colIndex] + col.width) * ZOOM - scrollX : 0;
  const fillL = Math.max(0, curLeftX);
  const fillR = Math.min(availW, curRightX);

  return (
    <Modal visible animationType="slide" supportedOrientations={['portrait']} onRequestClose={onClose}>
      <View style={[s.wrap, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={[s.header, { height: headerH }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.hBtn} activeOpacity={0.7}>
            <Ionicons name="close" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={s.hCenter}>
            <Text style={s.hTitle} numberOfLines={1}>{colLabel}</Text>
            <Text style={s.hSub}>{t('page')} {spread.page_left}–{spread.page_right} · {colIndex + 1}/{columns.length}</Text>
          </View>
          <View style={s.hBtn} />
        </View>

        {/* Zoomat uppslag — vertikal scroll för rader, horisontell för kolumner */}
        <View style={{ height: availH }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ minHeight: availH }}>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              scrollEventThrottle={16}
              onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
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
                />
              </View>
            </ScrollView>
          </ScrollView>
          {/* Markera kolumnstrecken på vänster + höger sida om aktuell kolumn */}
          {fillR > fillL && <View pointerEvents="none" style={[s.colFill, { left: fillL, width: fillR - fillL }]} />}
          {curLeftX >= -2 && curLeftX <= availW + 2 && <View pointerEvents="none" style={[s.colEdge, { left: curLeftX - 1.5 }]} />}
          {curRightX >= -2 && curRightX <= availW + 2 && <View pointerEvents="none" style={[s.colEdge, { left: curRightX - 1.5 }]} />}
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

  colFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: Colors.primary + '14' },
  colEdge: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: Colors.primary, shadowColor: Colors.primary, shadowOpacity: 0.8, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.border },
  arrow: { width: 64, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  arrowNext: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  arrowDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  arrowCancel: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  arrowOff: { opacity: 0.4 },
  dots: { flex: 1, alignItems: 'center' },
  dotsText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
