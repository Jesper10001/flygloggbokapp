// Book-vy: visar den aktiva digitala bokens uppslag som TVÅ stående sidor i full
// bredd — vänster sida överst, höger sida under — så man läser varje sida utan att
// vinkla telefonen. Bläddra/fullskärm under den högra sidan.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Modal, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { getSetting } from '../../db/flights';
import { getTemplate, ASSIGNABLE_TIME_FIELDS, type LogbookTemplate, type LogbookColumn } from '../../constants/logbookTemplates';
import { buildBookSpreads, type ColumnTotals, type LogbookSpread } from '../../services/logbook/paginate';
import { assignFlightsToBooks, type BookSlice } from '../../services/logbook/books';
import { ensureDigitalBooksMigrated, listDigitalBooks, setActiveDigitalBook, type DigitalBook } from '../../db/digitalBooks';
import { SpreadWebView } from '../logbook/SpreadWebView';
import { BookSetupSheet } from '../logbook/BookSetupSheet';
import { type SignatureData } from '../SignaturePad';
import { FONT_SERIF, FONT_MONO } from './tokens';

const parseJson = <T,>(s: string | undefined, fallback: T): T => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

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

export function BookView({ accent, headerRight }: { accent: string; headerRight?: React.ReactNode }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { flights } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();

  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<DigitalBook[]>([]);
  const [pilotName, setPilotName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [idx, setIdx] = useState(0);
  const [showOverview, setShowOverview] = useState(false); // page-overview dropdown
  const [showBooks, setShowBooks] = useState(false);       // bok-väljare (via titeln)
  const [setup, setSetup] = useState<{ mode: 'create' | 'edit'; initial: DigitalBook | null; carry?: ColumnTotals } | null>(null);
  // Realistisk default-ratio för en halvsida (~0.7) så containern aldrig blir dubbelt
  // för hög innan onAspect hinner mäta → ingen lång navy-lucka mellan sidorna.
  const [ratioL, setRatioL] = useState(0.72); // höjd/bredd för vänster sida (uppdateras av onAspect)
  const [ratioR, setRatioR] = useState(0.72);

  useEffect(() => {
    (async () => {
      await ensureDigitalBooksMigrated();
      const [fn, ln, sg] = await Promise.all([
        getSetting('profile_first_name'), getSetting('profile_last_name'), getSetting('pilot_signature'),
      ]);
      setPilotName([fn, ln].filter(Boolean).join(' '));
      setSignature(parseJson<SignatureData | null>(sg ?? undefined, null));
      setBooks(await listDigitalBooks());
      setLoading(false);
    })();
  }, []);

  const book = useMemo(() => books.find((b) => b.is_active === 1) ?? books[books.length - 1] ?? null, [books]);
  const slice = useMemo<BookSlice | null>(() => (book ? assignFlightsToBooks(books, flights).find((s) => s.book.id === book.id) ?? null : null), [book, books, flights]);
  const template = useMemo(() => (book ? applyCustomCols(getTemplate(book.template_id), parseJson<Record<string, string>>(book.custom_cols, {})) : null), [book]);
  const spreads = useMemo<LogbookSpread[]>(() => {
    if (!book || !template) return [];
    return buildBookSpreads(slice?.flights ?? [], template, {
      startingPage: book.starting_page,
      rowsPerSpread: book.rows_per_spread,
      openingBalance: parseJson<ColumnTotals>(book.opening_balance, {}),
      leadingEmptyRows: slice?.leadingEmptyRows ?? 0,
    });
  }, [book, template, slice]);

  // Hoppa till senaste uppslaget när boken/antalet uppslag ändras (t.ex. vid bokbyte).
  useEffect(() => { if (spreads.length) setIdx(spreads.length - 1); }, [spreads.length, book?.id]);
  const safeIdx = Math.min(idx, Math.max(0, spreads.length - 1));
  const current = spreads[safeIdx];

  const ctrlBtn = { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' } as const;
  const secBtn = { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface } as const;

  const Header = (
    <View style={{ paddingTop: 6, paddingHorizontal: 14, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 30 }}>
      <TouchableOpacity onPress={() => books.length > 1 && setShowBooks((v) => !v)} disabled={books.length <= 1}
        activeOpacity={0.7} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: Colors.textPrimary, flexShrink: 1 }}>{book?.name || 'Book'}</Text>
        {books.length > 1 ? <Ionicons name={showBooks ? 'chevron-up' : 'chevron-down'} size={16} color={accent} /> : null}
      </TouchableOpacity>
      <View style={{ flex: 1 }} />
      {headerRight}
    </View>
  );

  if (loading) return <View style={{ flex: 1, backgroundColor: Colors.background }}><ActivityIndicator color={accent} style={{ marginTop: 60 }} /></View>;

  // Ingen bok → CTA (behåll headern med väljaren så man kan byta vy).
  if (!book || !template) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {Header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 }}>
          <Ionicons name="book-outline" size={44} color={accent} />
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 20, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' }}>No logbook yet</Text>
          <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 }}>Create a digital logbook to see your flights laid out as a real EASA spread.</Text>
          <TouchableOpacity onPress={() => router.push('/logbook')} activeOpacity={0.85}
            style={{ marginTop: 6, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 13, backgroundColor: accent }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.background }}>Create logbook</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {Header}
      {/* Pages xx–xx — själva texten är dropdown-toggeln för uppslagsval */}
      <View style={{ paddingBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
        <TouchableOpacity onPress={() => spreads.length > 1 && setShowOverview((v) => !v)} disabled={spreads.length <= 1}
          activeOpacity={0.7} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: '600', color: Colors.textSecondary }}>
            {current ? `Pages ${current.page_left}–${current.page_right}` : ''}
          </Text>
          {spreads.length > 1 ? <Ionicons name={showOverview ? 'chevron-up' : 'chevron-down'} size={14} color={accent} /> : null}
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 2, paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        {current ? (
          <>
            {/* vänster sida (överst) — full bredd */}
            <View style={{ width: '100%', height: width * ratioL, backgroundColor: Colors.background }}>
              <SpreadWebView spread={current} template={template} pilotName={pilotName} timeFormat={timeFormat}
                width={width} signature={signature} interactive={false} bare bgColor={Colors.background} side="left" margin={0}
                onAspect={(r) => { if (r > 0 && Math.abs(r - ratioL) > 0.01) setRatioL(r); }} />
            </View>
            {/* höger sida (under) — full bredd */}
            <View style={{ width: '100%', height: width * ratioR, backgroundColor: Colors.background, marginTop: 6 }}>
              <SpreadWebView spread={current} template={template} pilotName={pilotName} timeFormat={timeFormat}
                width={width} signature={signature} interactive={false} bare bgColor={Colors.background} side="right" margin={0}
                onAspect={(r) => { if (r > 0 && Math.abs(r - ratioR) > 0.01) setRatioR(r); }} />
            </View>

            {/* bläddra / fullskärm under den högra sidan */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, paddingVertical: 16 }}>
              <TouchableOpacity disabled={safeIdx <= 0} onPress={() => setIdx((i) => Math.max(0, i - 1))} activeOpacity={0.7}
                style={[ctrlBtn, { opacity: safeIdx <= 0 ? 0.4 : 1 }]}>
                <Ionicons name="chevron-back" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/logbook?recent=1')} activeOpacity={0.7} style={ctrlBtn}>
                <Ionicons name="expand-outline" size={18} color={accent} />
              </TouchableOpacity>
              <TouchableOpacity disabled={safeIdx >= spreads.length - 1} onPress={() => setIdx((i) => Math.min(spreads.length - 1, i + 1))} activeOpacity={0.7}
                style={[ctrlBtn, { opacity: safeIdx >= spreads.length - 1 ? 0.4 : 1 }]}>
                <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Modify / New logbook — samma flöde som i helskärm (redigera resp. skapa) */}
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingBottom: 8 }}>
              <TouchableOpacity onPress={() => setSetup({ mode: 'edit', initial: book })} activeOpacity={0.8} style={secBtn}>
                <Ionicons name="create-outline" size={16} color={accent} />
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: accent }}>Modify logbook</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSetup({ mode: 'create', initial: null, carry: spreads.length ? spreads[spreads.length - 1].total_to_date : undefined })} activeOpacity={0.8} style={secBtn}>
                <Ionicons name="add" size={18} color={accent} />
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: accent }}>New logbook</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={{ color: Colors.textMuted, textAlign: 'center', marginTop: 40 }}>No pages yet</Text>
        )}
      </ScrollView>

      {/* Page-overview dropdown — flyter över uppslaget (flyttar inte ner innehållet) */}
      {showOverview && (
        <>
          <TouchableOpacity activeOpacity={1} onPress={() => setShowOverview(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} />
          <View style={{ position: 'absolute', top: 80, left: 0, right: 0, alignItems: 'center', zIndex: 50 }} pointerEvents="box-none">
            <View style={{ width: 250, maxHeight: 320, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {spreads.map((sp, i) => (
                  <TouchableOpacity key={sp.spread_number} onPress={() => { setIdx(i); setShowOverview(false); }} activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: Colors.separator, backgroundColor: i === safeIdx ? accent + '1F' : 'transparent' }}>
                    <Text style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: '700', color: i === safeIdx ? accent : Colors.textPrimary }}>pp {sp.page_left}–{sp.page_right}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}>{i + 1}/{spreads.length}</Text>
                    {i === safeIdx ? <Ionicons name="checkmark" size={14} color={accent} /> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </>
      )}

      {/* Bok-väljare — flyter under titeln, byter aktiv bok */}
      {showBooks && (
        <>
          <TouchableOpacity activeOpacity={1} onPress={() => setShowBooks(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} />
          <View style={{ position: 'absolute', top: 44, left: 14, width: 250, maxHeight: 320, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, overflow: 'hidden', zIndex: 60, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[...books].sort((a, b) => (b.display_order - a.display_order) || (b.id - a.id)).map((b, i) => {
                const active = b.id === book?.id;
                return (
                  <TouchableOpacity key={b.id} activeOpacity={0.7}
                    onPress={async () => { setShowBooks(false); await setActiveDigitalBook(b.id); setBooks(await listDigitalBooks()); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: Colors.separator, backgroundColor: active ? accent + '1F' : 'transparent' }}>
                    <Ionicons name="book-outline" size={15} color={active ? accent : Colors.textMuted} />
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT_SERIF, fontSize: 14, fontWeight: '600', color: active ? accent : Colors.textPrimary }}>{b.name}</Text>
                    {active ? <Ionicons name="checkmark" size={15} color={accent} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </>
      )}

      {/* Skapa/redigera bok — samma sheet som i helskärm (stående) */}
      <Modal visible={!!setup} animationType="slide" transparent supportedOrientations={['portrait']} onRequestClose={() => setSetup(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          {setup && (
            <BookSetupSheet mode={setup.mode} appMode="manned" initial={setup.initial} flights={flights} carryOpeningBalance={setup.carry} timeFormat={timeFormat}
              onClose={() => setSetup(null)} onSaved={() => { setSetup(null); listDigitalBooks().then(setBooks); }} />
          )}
        </View>
      </Modal>
    </View>
  );
}
