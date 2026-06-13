import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, ScrollView,
  ActivityIndicator, useWindowDimensions, Platform, Alert, InteractionManager,
  Animated, Pressable,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlightStore } from '../../store/flightStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { getSetting } from '../../db/flights';
import {
  getTemplate, ASSIGNABLE_TIME_FIELDS, type LogbookTemplate, type LogbookColumn,
} from '../../constants/logbookTemplates';
import {
  buildBookSpreads, type ColumnTotals, type LogbookSpread,
} from '../../services/logbook/paginate';
import { assignFlightsToBooks, type BookSlice } from '../../services/logbook/books';
import { SpreadWebView } from '../../components/logbook/SpreadWebView';
import { type SignatureData } from '../../components/SignaturePad';
import {
  ensureDigitalBooksMigrated, listDigitalBooks, setActiveDigitalBook,
  deleteDigitalBook, renameDigitalBook, updateDigitalBook, type DigitalBook,
} from '../../db/digitalBooks';
import { BookSetupSheet } from '../../components/logbook/BookSetupSheet';
import { TranscribeOverlay } from '../../components/logbook/TranscribeOverlay';

// Tomma kolumner → tilldelad flygtidstyp (per bok, {colId:flightKey}).
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

const parseJson = <T,>(s: string | undefined, fallback: T): T => {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};

export default function LogbookScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ book?: string; spread?: string; recent?: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { mode } = useAppModeStore();
  const { flights, loadFlights } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();
  const styles = makeStyles();

  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<DigitalBook[]>([]);
  const [activeBookId, setActiveBookId] = useState<number | null>(null);
  const [pilotName, setPilotName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const [showBooks, setShowBooks] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [setup, setSetup] = useState<{ mode: 'create' | 'edit'; initial: DigitalBook | null; carry?: ColumnTotals } | null>(null);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [transcribe, setTranscribe] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const listRef = useRef<FlatList>(null);
  const positionedBook = useRef<number | null>(null);
  const ovAnim = useRef(new Animated.Value(0)).current;

  const reloadBooks = useCallback(async () => {
    const bks = await listDigitalBooks();
    setBooks(bks);
    return bks;
  }, []);

  useEffect(() => {
    (async () => {
      await ensureDigitalBooksMigrated();
      const [fn, ln, sg] = await Promise.all([
        getSetting('profile_first_name'),
        getSetting('profile_last_name'),
        getSetting('pilot_signature'),
      ]);
      setPilotName([fn, ln].filter(Boolean).join(' '));
      setSignature(parseJson<SignatureData | null>(sg ?? undefined, null));
      const bks = await reloadBooks();
      await loadFlights();
      const paramBook = params.book ? parseInt(String(params.book), 10) : null;
      const initial = (paramBook && bks.find((b) => b.id === paramBook)?.id)
        || bks.find((b) => b.is_active === 1)?.id
        || bks[bks.length - 1]?.id
        || null;
      setActiveBookId(initial);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orientering: ENDAST den faktiska boken (böcker finns och vi är inte i
  // setup) är liggande. Intro (inga böcker) och skapa/redigera-bok är stående.
  useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      // Transcribe-overlayen är stående; när den stängs återställer detta liggande
      // (efter att modalen animerat klart) så läsaren inte fastnar i portrait-layout.
      const showingBook = books.length > 0 && !setup && !transcribe;
      const lock = showingBook ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP;
      ScreenOrientation.lockAsync(lock).catch(() => {});
    });
    return () => { cancelled = true; (task as any)?.cancel?.(); };
  }, [setup, books.length, transcribe]);

  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const slices = useMemo<BookSlice[]>(() => assignFlightsToBooks(books, flights), [books, flights]);
  const selectedBook = useMemo(() => books.find((b) => b.id === activeBookId) ?? null, [books, activeBookId]);
  const selectedSlice = useMemo(() => slices.find((s) => s.book.id === activeBookId) ?? null, [slices, activeBookId]);

  const effectiveTemplate = useMemo(() => {
    if (!selectedBook) return null;
    return applyCustomCols(getTemplate(selectedBook.template_id), parseJson<Record<string, string>>(selectedBook.custom_cols, {}));
  }, [selectedBook]);

  const spreads = useMemo<LogbookSpread[]>(() => {
    if (!selectedBook || !effectiveTemplate) return [];
    return buildBookSpreads(selectedSlice?.flights ?? [], effectiveTemplate, {
      startingPage: selectedBook.starting_page,
      rowsPerSpread: selectedBook.rows_per_spread,
      openingBalance: parseJson<ColumnTotals>(selectedBook.opening_balance, {}),
      leadingEmptyRows: selectedSlice?.leadingEmptyRows ?? 0,
    });
  }, [selectedBook, effectiveTemplate, selectedSlice]);

  // Dashboard-vägen (recent=1): visa bara innevarande + de 2 föregående uppslagen.
  const recent = params.recent === '1';
  const visibleSpreads = useMemo(() => (recent ? spreads.slice(-3) : spreads), [recent, spreads]);

  const hasFlightsInBook = (selectedSlice?.flights.length ?? 0) > 0;
  const safeIndex = Math.min(activeIndex, Math.max(0, visibleSpreads.length - 1));
  const current = visibleSpreads[safeIndex];
  const sheetMax = Math.min(520, Math.round(height * 0.62));

  const availableTypes = useMemo(() => {
    if (!selectedBook) return [];
    const base = getTemplate(selectedBook.template_id);
    const used = new Set<string>();
    for (const c of [...base.left_columns, ...base.right_columns]) if (c.flightKey) used.add(c.flightKey);
    if (used.has('tt_total')) used.add('total_time');
    if (used.has('sp_se')) used.add('se_time');
    if (used.has('sp_me')) used.add('me_time');
    const hasData = (key: string) => flights.some((f) => (parseFloat(String((f as any)[key])) || 0) > 0);
    return ASSIGNABLE_TIME_FIELDS.filter((a) => !used.has(a.key) && hasData(a.key));
  }, [selectedBook, flights]);

  // Öppna alltid på SENASTE uppslaget när man går in i en bok (eller byter bok).
  useEffect(() => {
    if (loading || visibleSpreads.length === 0) return;
    if (positionedBook.current === activeBookId) return;
    positionedBook.current = activeBookId;
    const last = visibleSpreads.length - 1;
    setActiveIndex(last);
    setTimeout(() => { try { listRef.current?.scrollToIndex({ index: last, animated: false }); } catch {} }, 80);
  }, [loading, visibleSpreads.length, activeBookId]);

  // Håll uppslaget i synk vid rotation/breddändring.
  useEffect(() => {
    const id = setTimeout(() => { try { listRef.current?.scrollToIndex({ index: safeIndex, animated: false }); } catch {} }, 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // Sidöversikt-dropdownen "trillar ner" när den öppnas.
  useEffect(() => {
    if (!showOverview) return;
    ovAnim.setValue(0);
    Animated.timing(ovAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [showOverview, ovAnim]);

  const goToIndex = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, visibleSpreads.length - 1));
    setActiveIndex(clamped);
    try { listRef.current?.scrollToIndex({ index: clamped, animated: false }); } catch {}
  };

  // Lämna boken utan orienterings-frysning: töm den tunga FlatList/WebView-vyn,
  // vänta in portrait-låset, och navigera sedan — inget tungt om-renderas under bytet.
  const handleBack = async () => {
    setLeaving(true);
    try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch {}
    router.back();
  };

  const onAssign = useCallback((colId: string) => { setAssignTarget(colId); setAssignOpen(true); }, []);

  const applyAssign = async (flightKey: string | null) => {
    if (!assignTarget || !selectedBook) return;
    const cur = parseJson<Record<string, string>>(selectedBook.custom_cols, {});
    if (flightKey) cur[assignTarget] = flightKey; else delete cur[assignTarget];
    await updateDigitalBook(selectedBook.id, { custom_cols: JSON.stringify(cur) });
    await reloadBooks();
    setAssignOpen(false); setAssignTarget(null);
  };

  const switchBook = async (id: number) => {
    await setActiveDigitalBook(id);
    await reloadBooks();
    setActiveBookId(id);
    setShowBooks(false);
  };

  const onSetupSaved = async () => {
    const bks = await reloadBooks();
    const act = bks.find((b) => b.is_active === 1) ?? bks[bks.length - 1];
    setActiveBookId(act?.id ?? null);
    setSetup(null);
    setShowBooks(false);
  };

  const startNewBook = () => {
    const carry = spreads.length ? spreads[spreads.length - 1].total_to_date : undefined;
    setShowBooks(false);
    setSetup({ mode: 'create', initial: null, carry });
  };

  const confirmDelete = (b: DigitalBook) => {
    Alert.alert(b.name, t('dlb_delete_book_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => { await deleteDigitalBook(b.id); const bks = await reloadBooks(); if (activeBookId === b.id) setActiveBookId(bks.find((x) => x.is_active === 1)?.id ?? bks[bks.length - 1]?.id ?? null); } },
    ]);
  };

  const promptRename = (b: DigitalBook) => {
    if (Platform.OS === 'ios' && (Alert as any).prompt) {
      (Alert as any).prompt(t('rename'), undefined, async (txt: string) => { if (txt?.trim()) { await renameDigitalBook(b.id, txt.trim()); await reloadBooks(); } }, 'plain-text', b.name);
    } else {
      setSetup({ mode: 'edit', initial: b });
    }
  };

  // ── Render-grenar ──────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={Colors.primary} /></View>
    );
  }

  // På väg ut: rendera en tom vy (boken/WebViewerna avmonteras) medan orienteringen
  // växlar till portrait och vi navigerar — undviker frysning vid orienteringsbytet.
  if (leaving) {
    return <View style={styles.container}><Stack.Screen options={{ headerShown: false }} /></View>;
  }

  if (books.length === 0) {
    return (
      <>
        <Intro onStart={() => setSetup({ mode: 'create', initial: null })} onBack={() => router.back()} />
        <Modal visible={!!setup} animationType="slide" transparent supportedOrientations={['portrait']} onRequestClose={() => setSetup(null)}>
          <View style={styles.sheetBackdrop}>
            {setup && (
              <BookSetupSheet mode={setup.mode} appMode={mode === 'drone' ? 'drone' : 'manned'} initial={setup.initial} flights={flights} carryOpeningBalance={setup.carry} timeFormat={timeFormat} onClose={() => setSetup(null)} onSaved={onSetupSaved} />
            )}
          </View>
        </Modal>
      </>
    );
  }

  const booksLatestFirst = [...books].sort((a, b) => (b.display_order - a.display_order) || (b.id - a.id));

  return (
    <View style={[styles.container, { paddingTop: width > height ? 0 : insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingLeft: insets.left + 6, paddingRight: insets.right + 6 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.headerCenter} onPress={() => setShowBooks(true)} activeOpacity={0.7}>
          <View style={styles.headerSubRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>{selectedBook?.name ?? t('your_books')}</Text>
            <Ionicons name="chevron-down" size={12} color={Colors.textMuted} />
          </View>
          {current && hasFlightsInBook && (
            <Text style={styles.headerSub}>{t('page')} {current.page_left}–{current.page_right} · {safeIndex + 1}/{visibleSpreads.length}</Text>
          )}
        </TouchableOpacity>

        {!recent && (
          <TouchableOpacity onPress={() => setShowOverview((v) => !v)} style={styles.iconBtn} activeOpacity={0.7} disabled={!hasFlightsInBook}>
            <Ionicons name="list-outline" size={20} color={hasFlightsInBook ? Colors.textSecondary : Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {!hasFlightsInBook ? (
        <Empty onAdd={() => router.push('/flight/add')} />
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={visibleSpreads}
            keyExtractor={(s) => String(s.spread_number)}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            key={activeBookId ?? 'none'}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
            onMomentumScrollEnd={(e) => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <SpreadWebView spread={item} template={effectiveTemplate!} pilotName={pilotName} timeFormat={timeFormat} width={width} signature={signature} onAssign={onAssign} />
            )}
          />
          <View style={[styles.footerHint, { paddingBottom: insets.bottom + 6 }]}>
            {recent ? (
              <TouchableOpacity style={styles.transcribeBtn} onPress={() => current && setTranscribe(true)} activeOpacity={0.85}>
                <Ionicons name="reader-outline" size={16} color={Colors.primary} />
                <Text style={styles.transcribeTxt}>{current ? t('dlb_transcribe_pages').replace('{pages}', `${current.page_left}–${current.page_right}`) : t('dlb_transcribe')}</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Ionicons name="swap-horizontal" size={13} color={Colors.textMuted} />
                <Text style={styles.footerHintText}>{t('dlb_swipe_hint')}</Text>
              </>
            )}
          </View>
        </>
      )}

      {/* ── Böcker-sheet ── */}
      <Modal visible={showBooks} animationType="slide" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setShowBooks(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <SheetHeader title={t('your_books')} onClose={() => setShowBooks(false)} />
            <ScrollView style={{ maxHeight: sheetMax }}>
              {booksLatestFirst.map((b) => {
                const isActive = b.id === activeBookId;
                const slice = slices.find((s) => s.book.id === b.id);
                const full = !!slice?.isFull;
                return (
                  <TouchableOpacity key={b.id} style={[styles.bookRow, isActive && styles.bookRowActive]} onPress={() => switchBook(b.id)} activeOpacity={0.8}>
                    <Ionicons name="book" size={20} color={isActive ? Colors.primary : Colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bookName, isActive && { color: Colors.primary }]} numberOfLines={1}>{b.name}</Text>
                      <Text style={styles.bookMeta}>
                        {getTemplate(b.template_id).name} · {t('page')} {b.starting_page}{b.end_page > 0 ? `–${b.end_page}` : '+'} · {slice?.flights.length ?? 0} {t('flights').toLowerCase()}
                      </Text>
                    </View>
                    {full && <View style={styles.fullPill}><Text style={styles.fullPillText}>{t('dlb_full')}</Text></View>}
                    <TouchableOpacity onPress={() => promptRename(b)} hitSlop={8} style={{ padding: 4 }}><Ionicons name="create-outline" size={18} color={Colors.textMuted} /></TouchableOpacity>
                    {books.length > 1 && <TouchableOpacity onPress={() => confirmDelete(b)} hitSlop={8} style={{ padding: 4 }}><Ionicons name="trash-outline" size={18} color={Colors.danger} /></TouchableOpacity>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.primaryBtn} onPress={startNewBook} activeOpacity={0.85}>
              <Ionicons name="add" size={18} color={Colors.textInverse} />
              <Text style={styles.primaryBtnText}>{t('dlb_new_book')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Sidöversikt: dropdown som trillar ner över boken ── */}
      {showOverview && (
        <>
          <Pressable style={[styles.ovBackdrop, { top: insets.top + 48 }]} onPress={() => setShowOverview(false)} />
          <Animated.View
            style={[
              styles.ovDropdown,
              {
                top: insets.top + 48,
                right: insets.right + 10,
                opacity: ovAnim,
                transform: [{ translateY: ovAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
              },
            ]}
          >
            <View style={styles.ovDropdownHeader}>
              <Text style={styles.ovDropdownTitle}>{t('dlb_overview')}</Text>
              <TouchableOpacity onPress={() => setShowOverview(false)} hitSlop={10} activeOpacity={0.7}>
                <Ionicons name="close" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: Math.round(height * 0.6) }}>
              {visibleSpreads.map((sp, i) => (
                <TouchableOpacity key={sp.spread_number} style={[styles.ovRow, i === safeIndex && styles.ovRowActive]} onPress={() => { setShowOverview(false); goToIndex(i); }} activeOpacity={0.7}>
                  <Ionicons name="document-text-outline" size={18} color={i === safeIndex ? Colors.primary : Colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ovTitle, i === safeIndex && { color: Colors.primary }]}>{t('page')} {sp.page_left}–{sp.page_right}</Text>
                    <Text style={styles.ovMeta}>{sp.flights.length} {t('flights').toLowerCase()}</Text>
                  </View>
                  {i === visibleSpreads.length - 1 && <View style={styles.latestPill}><Text style={styles.latestPillText}>{t('dlb_latest')}</Text></View>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Animated.View>
        </>
      )}

      {/* ── Bok-konfiguration (skapa/redigera) ── */}
      <Modal visible={!!setup} animationType="slide" transparent supportedOrientations={['portrait']} onRequestClose={() => setSetup(null)}>
        <View style={styles.sheetBackdrop}>
          {setup && (
            <BookSetupSheet mode={setup.mode} appMode={mode === 'drone' ? 'drone' : 'manned'} initial={setup.initial} flights={flights} carryOpeningBalance={setup.carry} timeFormat={timeFormat} onClose={() => setSetup(null)} onSaved={onSetupSaved} />
          )}
        </View>
      </Modal>

      {/* ── Välj flygtidstyp för en tom kolumn ── */}
      <Modal visible={assignOpen} animationType="slide" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setAssignOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <SheetHeader title={t('dlb_pick_time_type')} onClose={() => setAssignOpen(false)} />
            <Text style={styles.sheetHint}>{t('dlb_pick_time_type_sub')}</Text>
            <ScrollView style={{ maxHeight: sheetMax }}>
              {assignTarget && parseJson<Record<string, string>>(selectedBook?.custom_cols, {})[assignTarget] ? (
                <TouchableOpacity style={styles.ovRow} onPress={() => applyAssign(null)} activeOpacity={0.7}>
                  <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} />
                  <Text style={[styles.ovTitle, { color: Colors.textSecondary }]}>{t('dlb_remove_type')}</Text>
                </TouchableOpacity>
              ) : null}
              {availableTypes.length === 0 ? (
                <Text style={{ color: Colors.textMuted, fontSize: 13, padding: 16, textAlign: 'center' }}>{t('dlb_no_types')}</Text>
              ) : availableTypes.map((a) => {
                const active = !!assignTarget && parseJson<Record<string, string>>(selectedBook?.custom_cols, {})[assignTarget] === a.key;
                return (
                  <TouchableOpacity key={a.key} style={[styles.ovRow, active && styles.ovRowActive]} onPress={() => applyAssign(a.key)} activeOpacity={0.7}>
                    <Ionicons name="time-outline" size={18} color={active ? Colors.primary : Colors.textMuted} />
                    <Text style={[styles.ovTitle, active && { color: Colors.primary }]}>{a.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Transkriberings-hjälp: zooma in uppslaget, panorera kolumn för kolumn ── */}
      {transcribe && current && effectiveTemplate && (
        <TranscribeOverlay
          spread={current}
          template={effectiveTemplate}
          pilotName={pilotName}
          timeFormat={timeFormat}
          signature={signature}
          onClose={() => setTranscribe(false)}
        />
      )}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
function Intro({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = makeStyles();
  const points: { icon: any; title: string; body: string }[] = [
    { icon: 'book-outline', title: t('dlb_intro_p1_t'), body: t('dlb_intro_p1_b') },
    { icon: 'calculator-outline', title: t('dlb_intro_p2_t'), body: t('dlb_intro_p2_b') },
    { icon: 'color-palette-outline', title: t('dlb_intro_p3_t'), body: t('dlb_intro_p3_b') },
    { icon: 'cloud-done-outline', title: t('dlb_intro_p4_t'), body: t('dlb_intro_p4_b') },
  ];
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn} activeOpacity={0.7}><Ionicons name="chevron-back" size={22} color={Colors.primary} /></TouchableOpacity>
        <View style={styles.headerCenter}><Text style={styles.headerTitle}>{t('your_books')}</Text></View>
        <View style={styles.iconBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <View style={styles.introHero}><Ionicons name="book" size={34} color={Colors.primary} /></View>
        <Text style={styles.introTitle}>{t('dlb_intro_title')}</Text>
        <Text style={styles.introLead}>{t('dlb_intro_lead')}</Text>
        <View style={{ gap: 12, marginTop: 4 }}>
          {points.map((p) => (
            <View key={p.title} style={styles.introPoint}>
              <View style={styles.introPointIcon}><Ionicons name={p.icon} size={18} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.introPointTitle}>{p.title}</Text><Text style={styles.introPointBody}>{p.body}</Text></View>
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={onStart} activeOpacity={0.85}>
          <Ionicons name="add" size={18} color={Colors.textInverse} />
          <Text style={styles.primaryBtnText}>{t('dlb_get_started')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const styles = makeStyles();
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="documents-outline" size={48} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>{t('dlb_empty_title')}</Text>
      <Text style={styles.emptyBody}>{t('dlb_empty_body')}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onAdd} activeOpacity={0.85}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.primaryBtnText}>{t('import_manual_title')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const styles = makeStyles();
  return (
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle}>{title}</Text>
      <TouchableOpacity onPress={onClose} hitSlop={10} activeOpacity={0.7}><Ionicons name="close" size={22} color={Colors.textSecondary} /></TouchableOpacity>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
    iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 0.2, maxWidth: 220 },
    headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    headerSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 1 },
    footerHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 6, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.border },
    footerHintText: { color: Colors.textMuted, fontSize: 11 },
    transcribeBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '44' },
    transcribeTxt: { color: Colors.primary, fontSize: 13, fontWeight: '800' },

    introHero: { alignSelf: 'center', width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.primary + '1A', alignItems: 'center', justifyContent: 'center' },
    introTitle: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center' },
    introLead: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    introPoint: { flexDirection: 'row', gap: 12, backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: Colors.cardBorder },
    introPointIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '14', alignItems: 'center', justifyContent: 'center' },
    introPointTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    introPointBody: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 2 },

    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, marginTop: 10 },
    primaryBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },

    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
    emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
    emptyBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

    sheetBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
    sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    sheetTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
    sheetHint: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: 10 },

    bookRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.separator },
    bookRowActive: { backgroundColor: Colors.primary + '0E' },
    bookName: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
    bookMeta: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
    fullPill: { backgroundColor: Colors.warning + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    fullPillText: { color: Colors.warning, fontSize: 10, fontWeight: '800' },

    ovRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: Colors.separator },
    ovRowActive: { backgroundColor: Colors.primary + '0E' },
    ovTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    ovMeta: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
    latestPill: { backgroundColor: Colors.primary + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    latestPillText: { color: Colors.primary, fontSize: 10, fontWeight: '800' },

    ovBackdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40 },
    ovDropdown: {
      position: 'absolute', width: 300, maxWidth: '92%', backgroundColor: Colors.surface,
      borderRadius: 14, borderWidth: 0.5, borderColor: Colors.border, overflow: 'hidden', zIndex: 50,
      shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 10,
    },
    ovDropdownHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
    },
    ovDropdownTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '800' },
  });
}
