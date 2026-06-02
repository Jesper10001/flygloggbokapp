// Helskärms-ifyllnadsvy: visar den aktiva digitala bokens SENASTE uppslag i
// helskärm (inga sidolister), swipe bakåt till tidigare sidor, enkel tillbaka-
// knapp uppe till vänster. Syfte: snabbt fylla i den fysiska loggboken + summera.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { getSetting } from '../../db/flights';
import {
  getTemplate, ASSIGNABLE_TIME_FIELDS, type LogbookTemplate, type LogbookColumn,
} from '../../constants/logbookTemplates';
import { buildBookSpreads, type ColumnTotals, type LogbookSpread } from '../../services/logbook/paginate';
import { assignFlightsToBooks } from '../../services/logbook/books';
import { listDigitalBooks, ensureDigitalBooksMigrated, type DigitalBook } from '../../db/digitalBooks';
import { SpreadWebView } from '../../components/logbook/SpreadWebView';
import { type SignatureData } from '../../components/SignaturePad';

function applyCustomCols(template: LogbookTemplate, customCols: Record<string, string>): LogbookTemplate {
  if (!customCols || Object.keys(customCols).length === 0) return template;
  const apply = (c: LogbookColumn): LogbookColumn => {
    const fk = customCols[c.id];
    if (!fk) return c;
    const f = ASSIGNABLE_TIME_FIELDS.find((a) => a.key === fk);
    if (!f) return c;
    return { ...c, flightKey: f.key, format: f.format, label: f.label };
  };
  return { ...template, left_columns: template.left_columns.map(apply), right_columns: template.right_columns.map(apply) };
}

const parseJson = <T,>(s: string | undefined, fb: T): T => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };

export default function FillScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { flights, loadFlights } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();

  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<DigitalBook | null>(null);
  const [books, setBooks] = useState<DigitalBook[]>([]);
  const [pilotName, setPilotName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const positioned = useRef(false);

  useEffect(() => {
    (async () => {
      await ensureDigitalBooksMigrated();
      const [fn, ln, sg] = await Promise.all([
        getSetting('profile_first_name'), getSetting('profile_last_name'), getSetting('pilot_signature'),
      ]);
      setPilotName([fn, ln].filter(Boolean).join(' '));
      setSignature(parseJson<SignatureData | null>(sg ?? undefined, null));
      const bks = await listDigitalBooks();
      setBooks(bks);
      setBook(bks.find((b) => b.is_active === 1) ?? bks[bks.length - 1] ?? null);
      await loadFlights();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const task = ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); void task; };
  }, []);

  const template = useMemo(() => {
    if (!book) return null;
    return applyCustomCols(getTemplate(book.template_id), parseJson<Record<string, string>>(book.custom_cols, {}));
  }, [book]);

  const spreads = useMemo<LogbookSpread[]>(() => {
    if (!book || !template) return [];
    const slice = assignFlightsToBooks(books, flights).find((s) => s.book.id === book.id);
    return buildBookSpreads(slice?.flights ?? [], template, {
      startingPage: book.starting_page,
      rowsPerSpread: book.rows_per_spread,
      openingBalance: parseJson<ColumnTotals>(book.opening_balance, {}),
      leadingEmptyRows: slice?.leadingEmptyRows ?? 0,
    });
  }, [book, template, books, flights]);

  // Starta på SENASTE uppslaget.
  useEffect(() => {
    if (loading || spreads.length === 0 || positioned.current) return;
    positioned.current = true;
    const last = spreads.length - 1;
    setIndex(last);
    setTimeout(() => { try { listRef.current?.scrollToIndex({ index: last, animated: false }); } catch {} }, 80);
  }, [loading, spreads.length]);

  const hasFlights = spreads.some((s) => s.flights.length > 0);

  if (loading) {
    return <View style={st.center}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={Colors.primary} /></View>;
  }

  return (
    <View style={st.full}>
      <Stack.Screen options={{ headerShown: false }} />

      {!book || !template || !hasFlights ? (
        <View style={st.center}>
          <Ionicons name="documents-outline" size={48} color={Colors.textMuted} />
          <Text style={st.emptyTitle}>{t('dlb_empty_title')}</Text>
          <Text style={st.emptyBody}>{t('dlb_empty_body')}</Text>
          <TouchableOpacity style={st.primaryBtn} onPress={() => router.push('/logbook')} activeOpacity={0.85}>
            <Ionicons name="book" size={18} color={Colors.textInverse} />
            <Text style={st.primaryBtnText}>{t('your_books')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={spreads}
          keyExtractor={(s) => String(s.spread_number)}
          horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          initialScrollIndex={spreads.length - 1}
          initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
          onScrollToIndexFailed={(info) => { setTimeout(() => { try { listRef.current?.scrollToIndex({ index: info.index, animated: false }); } catch {} }, 120); }}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <SpreadWebView spread={item} template={template} pilotName={pilotName} timeFormat={timeFormat} width={width} signature={signature} interactive={false} centerVertical />
          )}
        />
      )}

      {/* Flytande tillbaka-knapp (helskärm, inga barer) */}
      <TouchableOpacity
        style={[st.backBtn, { top: insets.top + 8, left: insets.left + 8 }]}
        onPress={() => router.back()}
        activeOpacity={0.8}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
      </TouchableOpacity>

      {/* Diskret sidindikator nere till höger */}
      {book && hasFlights && spreads[index] && (
        <View style={[st.pageChip, { bottom: insets.bottom + 8, right: insets.right + 10 }]}>
          <Text style={st.pageChipText}>{t('page')} {spreads[index].page_left}–{spreads[index].page_right}</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#ECE3CC' },
  center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 22, marginTop: 8 },
  primaryBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
  backBtn: {
    position: 'absolute', width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FCF8EEDD', borderWidth: 1, borderColor: '#D9CEB4',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4,
  },
  pageChip: { position: 'absolute', backgroundColor: '#FCF8EEDD', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#D9CEB4' },
  pageChipText: { color: '#4A4030', fontSize: 11, fontWeight: '700', fontFamily: 'Courier New' },
});
