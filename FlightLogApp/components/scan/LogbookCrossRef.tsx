// "View as logbook" i skanningsrapporten: de skannade uppslagen ritade som loggbok, i liggande helskärm som
// "Dina böcker", med samma kolumner och rader som de fotade uppslagen (services/logbook/scanSpread.ts). Alla
// uppslag i skanningen finns med — svep mellan dem; vyn öppnar på uppslaget man tryckte på. Man lägger
// pappersboken bredvid och jämför. "By column" går igenom kolumnerna en i taget som Transcribe
// (TranscribeOverlay), utan de tomma.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, FlatList, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Colors } from '../../constants/colors';
import type { ScanRow } from '../../services/scanImport';
import type { PageGrid } from '../../services/scanGeometry';
import { scanSpreadAsLogbook } from '../../services/logbook/scanSpread';
import { SpreadWebView } from '../logbook/SpreadWebView';
import { TranscribeOverlay } from '../logbook/TranscribeOverlay';

export interface ScannedSpread {
  page: number;                                         // uppslagets index i skanningen
  rows: ScanRow[];                                      // uppslagets rader (överhoppade visas inte)
  grid: PageGrid | null;
  pageNumbers: { left: number | null; right: number | null };
}

export function LogbookCrossRef(p: {
  spreads: ScannedSpread[];
  initialPage: number;                 // uppslaget man tryckte på
  rowsPerPage: number;
  timeFormat: 'decimal' | 'hhmm';
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [ready, setReady] = useState(false);       // dölj boken tills orienteringen lagt sig (ingen stående blixt)
  const [byColumn, setByColumn] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const listRef = useRef<FlatList>(null);

  const books = useMemo(
    () => p.spreads.map((sp) => ({ sp, ...scanSpreadAsLogbook(sp.rows, sp.grid, sp.pageNumbers, p.rowsPerPage) })),
    [p.spreads, p.rowsPerPage],
  );
  const startIdx = Math.max(0, books.findIndex((b) => b.sp.page === p.initialPage));
  const [idx, setIdx] = useState(startIdx);
  const cur = books[Math.min(idx, books.length - 1)];
  const label = (b: (typeof books)[number]) => (b.sp.pageNumbers.left ? `p. ${b.spread.page_left}–${b.spread.page_right}` : `Spread ${b.sp.page + 1}`);

  // Liggande medan boken visas (By column vrider själv till stående och tillbaka).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    const t = setTimeout(() => setReady(true), 260);
    return () => clearTimeout(t);
  }, []);

  // Håll uppslaget kvar vid breddändring (rotation).
  useEffect(() => {
    const t = setTimeout(() => { try { listRef.current?.scrollToIndex({ index: idx, animated: false }); } catch { /* listan inte klar */ } }, 60);
    return () => clearTimeout(t);
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stäng: töm boken, lås stående (vänta aldrig på lockAsync) och stäng strax efter.
  const close = () => {
    setLeaving(true);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    setTimeout(p.onClose, 230);
  };
  const go = (to: number) => {
    const n = Math.max(0, Math.min(books.length - 1, to));
    setIdx(n);
    try { listRef.current?.scrollToIndex({ index: n, animated: true }); } catch { /* listan inte klar */ }
  };

  const landscape = width > height;
  const many = books.length > 1;
  return (
    <Modal visible animationType="fade" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={close}>
      <View style={s.root}>
        <View style={[s.header, { paddingLeft: insets.left + 6, paddingRight: insets.right + 6, paddingTop: landscape ? 0 : insets.top }]}>
          <TouchableOpacity onPress={close} style={s.iconBtn} accessibilityLabel="Back to the scan report">
            <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.title} numberOfLines={1}>
              {cur ? label(cur) : ''} · as read by Blades{many ? `  ·  ${idx + 1} / ${books.length}` : ''}
            </Text>
            <Text style={s.sub} numberOfLines={1}>
              {cur?.fromPhoto ? 'Same columns and rows as your photo. Compare it with your paper logbook.' : 'Compare it with your paper logbook.'}
              {many ? ' Swipe for the next spread.' : ''}
            </Text>
          </View>
          <View style={s.iconBtn} />
        </View>

        <View style={{ flex: 1 }}>
          {ready && !leaving && landscape && (
            <FlatList
              ref={listRef}
              data={books}
              keyExtractor={(b) => String(b.sp.page)}
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              initialScrollIndex={startIdx}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
              onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item }) => (
                <View style={{ width, flex: 1 }}>
                  <SpreadWebView spread={item.spread} template={item.template} pilotName="" timeFormat={p.timeFormat}
                    width={width} interactive={false} centerVertical onlyThisPageTotal />
                </View>
              )}
            />
          )}
        </View>

        <View style={[s.footer, { paddingBottom: insets.bottom + 6, paddingLeft: insets.left, paddingRight: insets.right }]}>
          {many && (
            <TouchableOpacity style={s.arrow} onPress={() => go(idx - 1)} disabled={idx <= 0} accessibilityLabel="Previous spread">
              <Ionicons name="chevron-back" size={18} color={idx <= 0 ? Colors.textMuted : Colors.textSecondary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.byColumn} onPress={() => setByColumn(true)} activeOpacity={0.85} disabled={!ready || leaving || !cur}>
            <Ionicons name="reader-outline" size={16} color={Colors.primary} />
            <Text style={s.byColumnText}>By column</Text>
          </TouchableOpacity>
          {many && (
            <TouchableOpacity style={s.arrow} onPress={() => go(idx + 1)} disabled={idx >= books.length - 1} accessibilityLabel="Next spread">
              <Ionicons name="chevron-forward" size={18} color={idx >= books.length - 1 ? Colors.textMuted : Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {byColumn && cur && (
        <TranscribeOverlay
          spread={cur.spread}
          template={cur.template}
          pilotName=""
          timeFormat={p.timeFormat}
          onlyThisPageTotal
          skipEmptyColumns
          onClose={() => setByColumn(false)}
        />
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  sub: { color: Colors.textSecondary, fontSize: 11, marginTop: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 6, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.border },
  arrow: { width: 38, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.cardBorder },
  // Samma knapp som "Transcribe" i Dina böcker.
  byColumn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '44' },
  byColumnText: { color: Colors.primary, fontSize: 13, fontWeight: '800' },
  useOff: { backgroundColor: 'transparent', borderColor: Colors.cardBorder, borderStyle: 'dashed' },
  useOn: { backgroundColor: Colors.success + '14', borderColor: Colors.success + '66' },
});
