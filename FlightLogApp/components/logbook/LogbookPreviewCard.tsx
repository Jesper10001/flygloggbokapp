// Loggboks-kort för Log-fliken: visar en ÄKTA renderad mini-sida av det senaste
// uppslaget (samma motor som boken). Tryck på previewn → bok-läsaren (bläddra).
// "Modify logbook" → book settings (BookSetupSheet) direkt i Log-fliken (stående).
// Saknas bok → enkelt kort som leder till intro/skapande.

import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
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
import { buildBookSpreads, type ColumnTotals, type LogbookSpread } from '../../services/logbook/paginate';
import { assignFlightsToBooks, resolveOpeningBalance } from '../../services/logbook/books';
import {
  ensureDigitalBooksMigrated, listDigitalBooks, type DigitalBook,
} from '../../db/digitalBooks';
import { SpreadWebView } from './SpreadWebView';
import { BookSetupSheet } from './BookSetupSheet';
import { type SignatureData } from '../SignaturePad';

// Tomma kolumner → tilldelad flygtidstyp (per bok). Spegel av app/logbook/index.tsx.
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

export function LogbookPreviewCard() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { mode } = useAppModeStore();
  const { flights } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();

  const [books, setBooks] = useState<DigitalBook[]>([]);
  const [pilotName, setPilotName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null); // uppslagets höjd/bredd (för tight höjd)

  const reload = useCallback(async () => {
    await ensureDigitalBooksMigrated();
    const [fn, ln, sg, bks] = await Promise.all([
      getSetting('profile_first_name'),
      getSetting('profile_last_name'),
      getSetting('pilot_signature'),
      listDigitalBooks(),
    ]);
    setPilotName([fn, ln].filter(Boolean).join(' '));
    setSignature(parseJson<SignatureData | null>(sg ?? undefined, null));
    setBooks(bks);
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const activeBook = useMemo(
    () => books.find((b) => b.is_active === 1) ?? books[books.length - 1] ?? null,
    [books],
  );

  const effectiveTemplate = useMemo(() => {
    if (!activeBook) return null;
    return applyCustomCols(getTemplate(activeBook.template_id), parseJson<Record<string, string>>(activeBook.custom_cols, {}));
  }, [activeBook]);

  const latestSpread = useMemo<LogbookSpread | null>(() => {
    if (!activeBook || !effectiveTemplate) return null;
    const slices = assignFlightsToBooks(books, flights);
    const slice = slices.find((s) => s.book.id === activeBook.id) ?? null;
    const spreads = buildBookSpreads(slice?.flights ?? [], effectiveTemplate, {
      startingPage: activeBook.starting_page,
      rowsPerSpread: activeBook.rows_per_spread,
      openingBalance: resolveOpeningBalance(activeBook, books, flights, effectiveTemplate),
      leadingEmptyRows: slice?.leadingEmptyRows ?? 0,
    });
    return spreads.length ? spreads[spreads.length - 1] : null;
  }, [activeBook, effectiveTemplate, books, flights]);

  if (!loaded) return null;

  // ── Ingen bok ännu → enkelt kort som leder till intro/skapande ──
  if (!activeBook) {
    return (
      <TouchableOpacity onPress={() => router.push('/logbook')} activeOpacity={0.85} style={s.simpleCard}>
        <View style={s.simpleIcon}><Ionicons name="book" size={24} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.simpleTitle}>{t('your_books')}</Text>
          <Text style={s.simpleSub}>{t('your_books_sub')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }

  // Rendera uppslaget i NATURLIG bredd (1:1 → WebViewen behöver inte skala och
  // klipper därför inget) och krymp hela vyn med en RN-transform så den får plats.
  const MARGIN = 16;
  const previewW = Math.max(200, width - 24);
  const contentWidth = effectiveTemplate
    ? [...effectiveTemplate.left_columns, ...effectiveTemplate.right_columns].reduce((sum, c) => sum + c.width, 0)
    : 0;
  const viewportWidth = contentWidth + 34 + MARGIN * 2; // = renderSpreads viewportWidth
  const scale = viewportWidth > 0 ? previewW / viewportWidth : 1;
  // + MARGIN: scrollHeight tar inte med sidans nedre marginal → lägg till den så
  // att nedre långsidan får samma beige marginal som den övre.
  const naturalH = viewportWidth * (aspect ?? 0.5) + MARGIN;
  const previewH = viewportWidth > 0 ? Math.round(naturalH * scale) : Math.round(previewW * 0.5);

  return (
    <View style={s.wrap}>
      <Text style={s.heading}>{activeBook.name || t('your_books')}</Text>

      {/* Preview av senaste sidan → bok-läsaren (bläddra) */}
      <TouchableOpacity activeOpacity={0.9} onPress={() => router.push(`/logbook?book=${activeBook.id}&spread=latest`)} style={[s.previewCard, { height: previewH }]}>
        {latestSpread && effectiveTemplate && viewportWidth > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: viewportWidth,
              height: naturalH,
              left: (previewW - viewportWidth) / 2,
              top: (previewH - naturalH) / 2,
              transform: [{ scale }],
            }}
          >
            <SpreadWebView
              spread={latestSpread}
              template={effectiveTemplate}
              pilotName={pilotName}
              timeFormat={timeFormat}
              width={viewportWidth}
              signature={signature}
              interactive={false}
              margin={MARGIN}
              onAspect={setAspect}
            />
          </View>
        ) : (
          <View style={s.previewEmpty}><Ionicons name="documents-outline" size={28} color={Colors.textMuted} /></View>
        )}
      </TouchableOpacity>

      {/* Modify logbook → book settings (BookSetupSheet) i Log-fliken */}
      <TouchableOpacity activeOpacity={0.85} onPress={() => setEditing(true)} style={s.modifyBtn}>
        <Ionicons name="options-outline" size={18} color={Colors.textSecondary} />
        <Text style={s.modifyText}>{t('dlb_modify_book') ?? 'Modify logbook'}</Text>
      </TouchableOpacity>

      {/* Book settings-sheet (stående) */}
      <Modal visible={editing} animationType="slide" transparent supportedOrientations={['portrait']} onRequestClose={() => setEditing(false)}>
        <View style={s.sheetBackdrop}>
          <BookSetupSheet
            mode="edit"
            appMode={mode === 'drone' ? 'drone' : 'manned'}
            initial={activeBook}
            flights={flights}
            timeFormat={timeFormat}
            onClose={() => setEditing(false)}
            onSaved={async () => { setEditing(false); await reload(); }}
          />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginTop: 16, marginBottom: 8, gap: 8 },
  heading: { color: Colors.textPrimary, fontSize: 14, fontWeight: '800', letterSpacing: 0.2, paddingHorizontal: 2 },

  previewCard: {
    borderRadius: 16, overflow: 'hidden', backgroundColor: '#ECE3CC',
    borderWidth: 1, borderColor: Colors.primary + '55', position: 'relative',
  },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(10,22,40,0.82)',
  },
  previewBarText: { color: Colors.textPrimary, fontSize: 12.5, fontWeight: '700', flex: 1 },
  previewBarRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  previewBarHint: { color: Colors.primary, fontSize: 11.5, fontWeight: '800' },

  modifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  modifyText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },

  simpleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 12, marginTop: 16, marginBottom: 8,
    backgroundColor: Colors.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.primary + '55',
  },
  simpleIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: Colors.primary + '1A', alignItems: 'center', justifyContent: 'center' },
  simpleTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
  simpleSub: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },

  sheetBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
});
