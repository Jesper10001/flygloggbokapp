// "View as logbook" i skanningsrapporten: de skannade uppslagen ritade som loggbok, i liggande helskärm som
// "Dina böcker", med samma kolumner och rader som de fotade uppslagen (services/logbook/scanSpread.ts). Alla
// uppslag i skanningen finns med — svep mellan dem; vyn öppnar på uppslaget man tryckte på. Man lägger
// pappersboken bredvid och jämför. "By column" går igenom kolumnerna en i taget som Transcribe
// (TranscribeOverlay), utan de tomma.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, FlatList, useWindowDimensions, Image, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Colors } from '../../constants/colors';
import type { ScanRow } from '../../services/scanImport';
import type { PageGrid } from '../../services/scanGeometry';
import { scanSpreadAsLogbook, fieldOfColumn } from '../../services/logbook/scanSpread';
import { cellRect } from '../../services/scanGeometry';
import { inputValue, parseInput, label as fieldLabel } from '../../services/scanFields';
import { SpreadWebView } from '../logbook/SpreadWebView';
import { TranscribeOverlay } from '../logbook/TranscribeOverlay';

export interface ScannedSpread {
  page: number;                                         // uppslagets index i skanningen
  rows: ScanRow[];                                      // uppslagets rader (överhoppade visas inte)
  grid: PageGrid | null;
  pageNumbers: { left: number | null; right: number | null };
}

// Ändra celler direkt i boken (nya Scan report): osäkra celler är röda, ändrade blå. Tryck på en cell → en
// ruta överst med en bit av fotot (cellen inringad, grannarna bredvid), vad Claude är osäker på och ett fält.
export interface CrossRefEditing {
  cellState: (rowKey: string, field: string) => 'open' | 'changed' | null;
  issueFor: (rowKey: string, field: string) => { id: string; reason: string } | null;
  photo: (page: number) => { uri: string; width: number; height: number } | null;
  onSave: (rowKey: string, field: string, value: string) => void;   // värdet i lagrat format (parseInput)
  onLooksRight: (issueId: string) => void;
}

export function LogbookCrossRef(p: {
  spreads: ScannedSpread[];
  initialPage: number;                 // uppslaget man tryckte på
  rowsPerPage: number;
  timeFormat: 'decimal' | 'hhmm';
  onClose: () => void;
  editing?: CrossRefEditing;
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
  // Vald cell (redigeringsläget) och dess värde i fältet.
  const [sel, setSel] = useState<{ page: number; rowKey: string; field: string | null; colLabel: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);
  const [clearSel, setClearSel] = useState(0);
  const ed = p.editing;
  const rowOf = (page: number, key: string) => p.spreads.find((x) => x.page === page)?.rows.find((r) => r.key === key) ?? null;
  const marksOf = (b: (typeof books)[number]) => {
    if (!ed) return undefined;
    const m: Record<string, 'unsure' | 'changed'> = {};
    const cols = [...b.template.left_columns, ...b.template.right_columns];
    b.slotKeys.forEach((key, i) => {
      if (!key) return;
      for (const c of cols) {
        const f = fieldOfColumn(c);
        const st = f ? ed.cellState(key, f) : null;
        if (st) m[`${i}:${c.id}`] = st === 'open' ? 'unsure' : 'changed';
      }
    });
    return m;
  };
  const marksBy = useMemo(() => books.map(marksOf), [books, ed]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (b: (typeof books)[number], slot: number, colId: string) => {
    const key = b.slotKeys[slot];
    const col = [...b.template.left_columns, ...b.template.right_columns].find((c) => c.id === colId);
    const row = key ? rowOf(b.sp.page, key) : null;
    if (!row || !col) return;
    const field = fieldOfColumn(col);
    setSel({ page: b.sp.page, rowKey: row.key, field, colLabel: col.label });
    setDraft(field ? inputValue(row.data, field, p.timeFormat) : '');
    setBad(false);
  };
  const unpick = () => { setSel(null); setBad(false); setClearSel((n) => n + 1); };
  const selRow = sel ? rowOf(sel.page, sel.rowKey) : null;
  const selIssue = sel?.field && ed ? ed.issueFor(sel.rowKey, sel.field) : null;
  const selOpen = !!(sel?.field && ed && ed.cellState(sel.rowKey, sel.field) === 'open');
  const unchanged = !!(sel?.field && selRow && draft === inputValue(selRow.data, sel.field, p.timeFormat));
  const commit = () => {
    if (!sel?.field || !ed || !selRow) { unpick(); return; }
    if (unchanged) {
      if (selOpen && selIssue) ed.onLooksRight(selIssue.id);
      unpick();
      return;
    }
    const v = parseInput(sel.field, draft, p.timeFormat);
    if (v == null) { setBad(true); return; }
    ed.onSave(sel.rowKey, sel.field, v);
    unpick();
  };
  const openCount = cur && ed ? Object.values(marksBy[Math.min(idx, books.length - 1)] ?? {}).filter((m) => m === 'unsure').length : 0;

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
    setSel(null);
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
              {ed
                ? `${openCount === 0 ? 'Nothing unsure on this spread' : openCount === 1 ? '1 unsure cell, in red' : `${openCount} unsure cells, in red`} · Tap any cell to change it.`
                : cur?.fromPhoto ? 'Same columns and rows as your photo. Compare it with your paper logbook.' : 'Compare it with your paper logbook.'}
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
              onMomentumScrollEnd={(e) => { const n = Math.round(e.nativeEvent.contentOffset.x / width); if (n !== idx) { setIdx(n); setSel(null); } }}
              renderItem={({ item, index }) => (
                <View style={{ width, flex: 1 }}>
                  <SpreadWebView spread={item.spread} template={item.template} pilotName="" timeFormat={p.timeFormat}
                    width={width} interactive={false} centerVertical onlyThisPageTotal
                    marks={marksBy[index]} onCell={ed ? (r, c) => pick(item, r, c) : undefined} clearSel={clearSel} />
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

      {/* Vald cell: fotobiten, vad Claude är osäker på och rätt värde. Överst, så att tangentbordet inte täcker. */}
      {sel && selRow && (
        <View style={[s.edit, { left: insets.left + 8, right: insets.right + 8, borderColor: selOpen ? Colors.danger + 'BB' : Colors.primary }]}>
          <CellSnippet photo={ed?.photo(sel.page) ?? null} grid={p.spreads.find((x) => x.page === sel.page)?.grid ?? null}
            rowIndex={selRow.rowIndex} field={sel.field} danger={selOpen} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.editLabel} numberOfLines={1}>ROW {selRow.rowIndex} · {(sel.field ? fieldLabel(sel.field) : sel.colLabel).toUpperCase()}</Text>
            {sel.field ? (
              <Text style={[s.editReason, selOpen && { color: Colors.danger }]} numberOfLines={2}>
                {bad ? "That doesn't look right for this column. Check the value."
                  : selOpen && selIssue ? `Claude is unsure: ${selIssue.reason}` : 'From your photo. Change it if it is wrong.'}
              </Text>
            ) : (
              <Text style={s.editReason} numberOfLines={2}>This column is worked out from the flight. Change it under Edit flight in the report.</Text>
            )}
            {sel.field && (
              <View style={s.editRow}>
                <TextInput value={draft} onChangeText={(t) => { setDraft(t); setBad(false); }} style={s.editInput} autoFocus
                  autoCapitalize="characters" autoCorrect={false} returnKeyType="done" onSubmitEditing={commit}
                  accessibilityLabel={fieldLabel(sel.field)} placeholder="Empty" placeholderTextColor={Colors.textMuted} />
                <TouchableOpacity onPress={unpick} style={s.editCancel} accessibilityRole="button"><Text style={s.editCancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={commit} style={s.editSave} accessibilityRole="button">
                  <Text style={s.editSaveText}>{unchanged ? (selOpen ? 'Looks right' : 'Done') : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            )}
            {!sel.field && (
              <TouchableOpacity onPress={unpick} style={[s.editCancel, { alignSelf: 'flex-start' }]}><Text style={s.editCancelText}>OK</Text></TouchableOpacity>
            )}
          </View>
        </View>
      )}

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

// En bit av fotot: cellen (inringad) med lite av grannarna runt om, i fotots egna proportioner.
const SNIP_H = 66, SNIP_W = 230;
function CellSnippet({ photo, grid, rowIndex, field, danger }: {
  photo: { uri: string; width: number; height: number } | null; grid: ScannedSpread['grid']; rowIndex: number; field: string | null; danger: boolean;
}) {
  const rect = photo && grid && field ? cellRect(grid, rowIndex, field) : null;
  if (!photo || !rect) {
    return (
      <View style={[s.snip, { alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="image-outline" size={18} color={Colors.textMuted} />
        <Text style={s.snipNone}>No photo of this cell</Text>
      </View>
    );
  }
  const W = photo.width, H = photo.height;
  const y1 = Math.max(0, rect.y - rect.h * 0.7), y2 = Math.min(1, rect.y + rect.h * 1.7);
  const scale = SNIP_H / Math.max(1, (y2 - y1) * H);
  const cx = (rect.x + rect.w / 2) * W * scale;
  const left = Math.min(0, Math.max(SNIP_W - W * scale, SNIP_W / 2 - cx));
  return (
    <View style={s.snip} accessibilityLabel="Your handwriting in this cell, from the photo">
      <Image source={{ uri: photo.uri }} style={{ position: 'absolute', width: W * scale, height: H * scale, left, top: -y1 * H * scale }} />
      <View style={{
        position: 'absolute', left: left + rect.x * W * scale - 2, top: (rect.y - y1) * H * scale - 2,
        width: rect.w * W * scale + 4, height: rect.h * H * scale + 4, borderRadius: 5, borderWidth: 2,
        borderColor: danger ? Colors.danger : Colors.primary,
      }} />
    </View>
  );
}

const s = StyleSheet.create({
  edit: { position: 'absolute', top: 6, flexDirection: 'row', gap: 12, padding: 10, borderRadius: 14, borderWidth: 1, backgroundColor: '#0F1E3A', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  editLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  editReason: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput: { flex: 1, minWidth: 80, height: 38, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary, backgroundColor: 'rgba(10,22,40,0.7)', color: '#FFFFFF', fontSize: 16, fontWeight: '700', paddingHorizontal: 10 },
  editCancel: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  editCancelText: { color: '#FFFFFF', fontSize: 13 },
  editSave: { height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  editSaveText: { color: '#0A1628', fontSize: 13, fontWeight: '800' },
  snip: { width: SNIP_W, height: SNIP_H, borderRadius: 8, overflow: 'hidden', backgroundColor: '#E2DAC6' },
  snipNone: { color: Colors.textMuted, fontSize: 11, marginTop: 3 },
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
