import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import {
  getActiveBook, getSpreadsForBook, markSpreadTranscribed,
  unmarkLastSpread, type SpreadInfo, type LogbookBook,
} from '../db/logbookBooks';
import {
  getTemplate, formatCell, type LogbookTemplate, type LogbookColumn,
} from '../constants/logbookTemplates';
import { useFlightStore } from '../store/flightStore';
import type { Flight } from '../types/flight';

import * as ScreenOrientation from 'expo-screen-orientation';

export default function TranscribeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ spread?: string }>();
  const { loadFlights } = useFlightStore();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [book, setBook] = useState<LogbookBook | null>(null);
  const [spreads, setSpreads] = useState<SpreadInfo[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [orientationLocked, setOrientationLocked] = useState(false);
  const insets = useSafeAreaInsets();

  // Auto-lås landscape när skärmen öppnas, lås upp vid unmount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        if (active) setOrientationLocked(true);
      } catch { /* ignorera */ }
    })();
    return () => {
      active = false;
      // Återställ till portrait när man lämnar vyn
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { /* ignore */ });
    };
  }, []);

  const load = useCallback(async () => {
    const b = await getActiveBook();
    if (!b) {
      Alert.alert(t('error'), t('transcribe_no_book'));
      router.back();
      return;
    }
    setBook(b);
    const sprs = await getSpreadsForBook(b);
    setSpreads(sprs);
    const wanted = parseInt(params.spread ?? '', 10);
    const idx = sprs.findIndex((s) => s.spread_number === wanted);
    setActiveIdx(idx >= 0 ? idx : Math.max(0, sprs.length - 1));
  }, [params.spread]);

  useEffect(() => { load(); }, [load]);

  const current = spreads[activeIdx];
  const template = book ? getTemplate(book.template_id) : null;

  const handleMarkDone = async () => {
    if (!current || !book || !current.is_current) return;
    Alert.alert(
      t('transcribe_confirm_title'),
      `${t('transcribe_confirm_body')} (${current.flights.length} · ${current.page_left}–${current.page_right})`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('transcribe_mark_done'),
          onPress: async () => {
            await markSpreadTranscribed(book.id, current.flights.map((f) => f.id));
            await loadFlights();
            Alert.alert(t('transcribe_marked_title'), t('transcribe_marked_body'));
            router.back();
          },
        },
      ],
    );
  };

  const handleUndoLast = async () => {
    if (!book || book.transcribed_spreads === 0) return;
    Alert.alert(
      t('transcribe_undo_title'),
      t('transcribe_undo_body'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('undo'),
          style: 'destructive',
          onPress: async () => { await unmarkLastSpread(book.id); await load(); },
        },
      ],
    );
  };

  if (!book || !template) return <View style={{ flex: 1, backgroundColor: Colors.background }} />;

  return (
    <View style={{
      flex: 1,
      backgroundColor: Colors.background,
      paddingLeft: insets.left,   // kompensera för notch/camera på vänster sida i landscape
      paddingRight: insets.right, // och höger sida beroende på rotation
    }}>
      {/* Dölj Stack-header helt — tabellen ska ha maximal höjd i landscape */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* Rotate-hint när i portrait + fallback till CSS-rotation */}
      {!isLandscape && !orientationLocked && (
        <View style={styles.rotateHint}>
          <Ionicons name="phone-landscape" size={20} color={Colors.primary} />
          <Text style={styles.rotateText}>{t('transcribe_rotate_hint')}</Text>
        </View>
      )}

      {/* Slim header i en rad: back + boknamn + uppslag-navigation */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4 }}
        >
          <Ionicons name="chevron-back" size={18} color={Colors.primary} />
          <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>{t('back')}</Text>
        </TouchableOpacity>
        <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '700', marginLeft: 10 }}>
          {book.name}
        </Text>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Ionicons name="hand-left-outline" size={14} color={Colors.gold} />
          <Text style={{ color: Colors.gold, fontSize: 13, fontWeight: '700' }}>
            {t('transcribe_tap_column_hint')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setActiveIdx((i) => Math.max(0, i - 1))}
          disabled={activeIdx === 0}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={15} color={activeIdx === 0 ? Colors.textMuted : Colors.primary} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', paddingHorizontal: 10 }}>
          <Text style={styles.spreadTitle}>
            {current
              ? `${t('page')} ${current.page_left}–${current.page_right}`
              : t('transcribe_no_spreads')}
          </Text>
          {current && (
            <Text style={styles.spreadSub}>
              {current.is_current ? t('transcribe_current') : t('transcribe_past')}
              {' · '}{current.flights.length}/{book.rows_per_spread}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setActiveIdx((i) => Math.min(spreads.length - 1, i + 1))}
          disabled={activeIdx >= spreads.length - 1}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={15} color={activeIdx >= spreads.length - 1 ? Colors.textMuted : Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabellen */}
      {current && (() => {
        // Samla alla flygningar från tidigare uppslag för per-kolumn brought-forward
        const priorFlights = spreads
          .filter((s) => s.spread_number < current.spread_number)
          .flatMap((s) => s.flights);
        return (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator
          >
            <ScrollView
              horizontal
              contentContainerStyle={{ minWidth: '100%' }}
              showsHorizontalScrollIndicator
            >
              <View>
                <SpreadTable
                  template={template}
                  flights={current.flights}
                  rowsPerSpread={book.rows_per_spread}
                  priorFlights={priorFlights}
                />
              </View>
            </ScrollView>
          </ScrollView>
        );
      })()}

      {/* Footer-knappar */}
      <View style={styles.footer}>
        {book.transcribed_spreads > 0 && (
          <TouchableOpacity style={styles.undoBtn} onPress={handleUndoLast} activeOpacity={0.7}>
            <Ionicons name="arrow-undo" size={14} color={Colors.textMuted} />
            <Text style={styles.undoText}>{t('transcribe_undo_btn')}</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        {current && current.is_current && current.flights.length > 0 && (
          <TouchableOpacity style={styles.doneBtn} onPress={handleMarkDone} activeOpacity={0.85}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
            <Text style={styles.doneText}>{t('transcribe_mark_done')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function SpreadTable({ template, flights, rowsPerSpread, priorFlights = [] }: {
  template: LogbookTemplate;
  flights: Flight[];
  rowsPerSpread: number;
  priorFlights?: Flight[];
}) {
  const { t } = useTranslation();
  const [doneColumns, setDoneColumns] = useState<Set<string>>(new Set());
  const toggleDone = (colId: string) => {
    setDoneColumns(prev => {
      const next = new Set(prev);
      next.has(colId) ? next.delete(colId) : next.add(colId);
      return next;
    });
  };
  const columns = [...template.left_columns, ...template.right_columns];
  const emptyRows = Math.max(0, rowsPerSpread - flights.length);
  const totalColWidth = columns.reduce((s, c) => s + c.width, 0);

  const isNumeric = (c: LogbookColumn) => c.format === 'decimal' || c.format === 'int';
  const fmt = (c: LogbookColumn, v: number) => {
    if (!v) return '';
    if (c.format === 'int') return String(Math.round(v));
    if (template.time_format === 'hhmm') {
      const h = Math.floor(v);
      const m = Math.round((v - h) * 60);
      return `${h}:${String(m).padStart(2, '0')}`;
    }
    return v.toFixed(1);
  };
  const sumFor = (fs: Flight[], c: LogbookColumn): number => {
    if (!c.flightKey || !isNumeric(c)) return 0;
    return fs.reduce((s, f) => {
      const raw = (f as any)[c.flightKey!];
      const n = parseFloat(String(raw)) || 0;
      return s + n;
    }, 0);
  };

  const firstNumericIdx = columns.findIndex(isNumeric);
  const labelColIdx = Math.max(0, firstNumericIdx - 1); // kolumnen precis innan första numeriska — där rubriken skrivs

  // Hjälpare: rendera en "summary"-rad (brought forward / total this page / total to date)
  const renderSummaryRow = (label: string, sourceFlights: Flight[], opts: { highlight?: boolean; bold?: boolean } = {}) => {
    const { highlight, bold } = opts;
    return (
      <View style={{ flexDirection: 'row' }}>
        {columns.map((c, i) => {
          const showLabel = i === labelColIdx;
          const numeric = isNumeric(c);
          const sum = numeric ? sumFor(sourceFlights, c) : 0;
          return (
            <View
              key={c.id}
              style={{
                width: c.width, paddingVertical: 7, paddingHorizontal: 3,
                borderWidth: 0.5, borderColor: Colors.border,
                backgroundColor: highlight ? Colors.primary + '1F' : Colors.elevated,
                alignItems: numeric ? 'center' : 'flex-end', justifyContent: 'center',
              }}
            >
              {showLabel ? (
                <Text style={{
                  color: highlight ? Colors.primary : Colors.textSecondary,
                  fontSize: 10, fontWeight: bold ? '900' : '800', letterSpacing: 0.5,
                  textTransform: 'uppercase', textAlign: 'right',
                }} numberOfLines={2}>
                  {label}
                </Text>
              ) : numeric ? (
                <Text style={{
                  color: highlight ? Colors.primary : Colors.textPrimary,
                  fontSize: bold ? 12 : 11,
                  fontWeight: bold ? '900' : '700',
                  fontFamily: 'Menlo',
                  fontVariant: ['tabular-nums'],
                }}>
                  {fmt(c, sum) || (bold ? '0' : '')}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    );
  };

  // Gruppera kolumner som har samma group-etikett för att rita rubriker över flera kolumner
  type GroupSegment = { group?: string; columns: LogbookColumn[] };
  const groups: GroupSegment[] = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last && last.group === col.group) last.columns.push(col);
    else groups.push({ group: col.group, columns: [col] });
  }

  return (
    <View style={{ padding: 2, minWidth: 1280 }}>
      {/* Brought forward — översta raden ovanför grupprubrikerna, matchar pappret */}
      {renderSummaryRow('Brought forward', priorFlights)}

      {/* Grupprubriker */}
      <View style={{ flexDirection: 'row' }}>
        {groups.map((g, i) => {
          const w = g.columns.reduce((s, c) => s + c.width, 0);
          return (
            <View
              key={i}
              style={{
                width: w, paddingVertical: 2, paddingHorizontal: 2,
                borderWidth: g.group ? 0.5 : 0,
                borderColor: Colors.border,
                backgroundColor: g.group ? Colors.elevated : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text
                style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}
                numberOfLines={1}
              >
                {g.group ?? ''}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Kolumnrubriker */}
      <View style={{ flexDirection: 'row' }}>
        {columns.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={{
              width: c.width, paddingVertical: 3, paddingHorizontal: 2,
              borderWidth: 0.5, borderColor: doneColumns.has(c.id) ? Colors.success + '44' : Colors.border,
              backgroundColor: doneColumns.has(c.id) ? Colors.success + '22' : Colors.surface,
              alignItems: 'center', justifyContent: 'center',
            }}
            onPress={() => toggleDone(c.id)}
            activeOpacity={0.7}
          >
            {doneColumns.has(c.id) ? (
              <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
            ) : (
              <Text style={{
                color: Colors.textSecondary,
                fontSize: 9, fontWeight: '700', textAlign: 'center',
              }} numberOfLines={1}>
                {c.label}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Data-rader med kolumn-overlay */}
      <View style={{ position: 'relative' }}>
        {flights.map((f, idx) => (
          <Row key={f.id} flight={f} columns={columns} rowIndex={idx} doneColumns={doneColumns} onToggle={toggleDone} />
        ))}
        {Array.from({ length: emptyRows }).map((_, i) => (
          <EmptyRow key={`e${i}`} columns={columns} rowIndex={flights.length + i} doneColumns={doneColumns} onToggle={toggleDone} />
        ))}

        {/* "Klar" overlay per done column */}
        {columns.map((c) => {
          if (!doneColumns.has(c.id)) return null;
          const xOffset = columns.slice(0, columns.indexOf(c)).reduce((s, col) => s + col.width, 0);
          return (
            <TouchableOpacity
              key={`overlay-${c.id}`}
              style={{
                position: 'absolute', top: 0, bottom: 0,
                left: xOffset, width: c.width,
                alignItems: 'center', justifyContent: 'center',
              }}
              onPress={() => toggleDone(c.id)}
              activeOpacity={0.8}
            >
              <View style={{
                backgroundColor: Colors.success + 'DD',
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 4,
                alignItems: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
                  {t('transcribe_done')}
                </Text>
              </View>
              <Text style={{ color: Colors.success, fontSize: 8, marginTop: 3, fontWeight: '600', textAlign: 'center' }}>
                {t('transcribe_tap_to_undo')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Total this page — per kolumn, fetstil, primärfärgad tint */}
      {renderSummaryRow('Total this page', flights, { highlight: true, bold: true })}

      {/* Total to date — per kolumn, fetstil, primärfärgad tint */}
      {renderSummaryRow('Total to date', [...priorFlights, ...flights], { highlight: true, bold: true })}

      {/* Certified true and correct + signatur under totals */}
      <View style={{
        flexDirection: 'row', width: totalColWidth,
        borderWidth: 0.5, borderColor: Colors.border, borderTopWidth: 0,
        backgroundColor: Colors.card, padding: 10, gap: 10,
      }}>
        <Text style={{ color: Colors.textMuted, fontSize: 10, fontStyle: 'italic' }}>
          Certified true and correct.
        </Text>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
            Pilot's signature:
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: Colors.border, marginTop: 8 }} />
        </View>
      </View>
    </View>
  );
}

function Row({ flight, columns, rowIndex, doneColumns, onToggle }: {
  flight: Flight; columns: LogbookColumn[]; rowIndex: number;
  doneColumns: Set<string>; onToggle: (id: string) => void;
}) {
  const bg = rowIndex % 2 === 0 ? Colors.card : Colors.elevated;
  return (
    <View style={{ flexDirection: 'row' }}>
      {columns.map((c) => {
        const raw = c.flightKey ? (flight as any)[c.flightKey] : '';
        const value = formatCell(raw, c);
        const done = doneColumns.has(c.id);
        return (
          <TouchableOpacity
            key={c.id}
            style={{
              width: c.width, minHeight: 22, paddingVertical: 2, paddingHorizontal: 4,
              borderWidth: 0.5, borderColor: done ? Colors.success + '44' : Colors.border,
              backgroundColor: done ? Colors.success + '18' : bg, justifyContent: 'center',
            }}
            onPress={() => onToggle(c.id)}
            activeOpacity={0.7}
          >
            <Text
              style={{
                color: done ? 'transparent' : (value ? Colors.textPrimary : Colors.textMuted),
                fontSize: 11, fontFamily: 'Menlo',
                textAlign: c.format === 'text' ? 'left' : 'center',
              }}
              numberOfLines={2}
            >
              {value || '·'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function EmptyRow({ columns, rowIndex, doneColumns, onToggle }: {
  columns: LogbookColumn[]; rowIndex: number;
  doneColumns: Set<string>; onToggle: (id: string) => void;
}) {
  const bg = rowIndex % 2 === 0 ? Colors.card : Colors.elevated;
  return (
    <View style={{ flexDirection: 'row' }}>
      {columns.map((c) => {
        const done = doneColumns.has(c.id);
        return (
          <TouchableOpacity
            key={c.id}
            style={{
              width: c.width, minHeight: 22,
              borderWidth: 0.5, borderColor: done ? Colors.success + '44' : Colors.border,
              backgroundColor: done ? Colors.success + '18' : bg,
            }}
            onPress={() => onToggle(c.id)}
            activeOpacity={0.7}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rotateHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: Colors.primary + '1F',
    borderBottomWidth: 0.5, borderBottomColor: Colors.primary + '44',
  },
  rotateText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  navBtn: { padding: 5, borderRadius: 6, backgroundColor: Colors.elevated },
  spreadTitle: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  spreadSub: { color: Colors.textSecondary, fontSize: 10, marginTop: 1 },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5, borderTopColor: Colors.border,
  },
  undoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 8 },
  undoText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingVertical: 7, paddingHorizontal: 14,
  },
  doneText: { color: Colors.textInverse, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
});
