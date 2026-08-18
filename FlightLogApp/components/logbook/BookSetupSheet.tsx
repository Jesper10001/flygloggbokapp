// Konfigurationssteg för en digital loggbok: mall, första/sista sida, rader per
// uppslag, samt anchor (vilken sida + rad den SENASTE flygningen ligger på i
// pappersboken) och ingående balans. Används för att skapa OCH redigera böcker.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Image, Alert, Platform, Modal, useWindowDimensions, ActivityIndicator, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import {
  LOGBOOK_TEMPLATES, getTemplate, type LogbookTemplate,
} from '../../constants/logbookTemplates';
import { getCustomTemplates } from '../../db/customTemplates';
import { numericColumns, sortFlightsChrono, buildBookSpreads, computeBroughtForward, type ColumnTotals } from '../../services/logbook/paginate';
import { assignFlightsToBooks } from '../../services/logbook/books';
import { getBackfill } from '../../db/backfill';
import { SpreadWebView } from './SpreadWebView';
import type { Flight } from '../../types/flight';
import {
  createDigitalBook, updateDigitalBook, listDigitalBooks, type DigitalBook, type BookKind,
} from '../../db/digitalBooks';

// Ordningstal → "1st Logbook", "2nd Logbook" … (auto-namn, ingen manuell döpning).
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

export function BookSetupSheet({
  mode, appMode, initial, flights, allBooks, carryOpeningBalance, timeFormat, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  appMode: 'manned' | 'drone';
  initial?: DigitalBook | null;
  flights: Flight[];
  allBooks?: DigitalBook[];   // alla böcker → för att härleda bokens FÖRSTA egna flight (brought-forward-gräns)
  carryOpeningBalance?: ColumnTotals;
  timeFormat: 'decimal' | 'hhmm';
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const sv = t('yes') === 'Ja';

  // Helskärms-förhandsvisning: bläddra mellan alla valbara böcker (previewIdx = startindex).
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [curPreview, setCurPreview] = useState(0);
  const [previewTestData, setPreviewTestData] = useState(false); // fyll bladet med egna (senaste) flygningar
  const [previewTimeFormat, setPreviewTimeFormat] = useState<'decimal' | 'hhmm'>(timeFormat);
  const previewListRef = useRef<FlatList>(null);
  const [saving, setSaving] = useState(false); // spinner medan boken skapas + laddas fram

  // Custom-mallar (användarskapade böcker) — laddas och uppdateras vid fokus så
  // en nyss skapad mall dyker upp direkt när man kommer tillbaka från skaparen.
  const [custom, setCustom] = useState<LogbookTemplate[]>([]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getCustomTemplates().then((c) => { if (alive) setCustom(c); }).catch(() => {});
      return () => { alive = false; };
    }, []),
  );

  const allTemplates = useMemo(() => [...LOGBOOK_TEMPLATES, ...custom], [custom]);
  const resolveTpl = (id: string) => allTemplates.find((x) => x.id === id) ?? getTemplate(id);
  const pickable = useMemo(
    // 'sv-easa-standard' är utfasad — visas inte längre som valbar mall (befintliga
    // böcker som använder den fortsätter fungera via getTemplate).
    () => allTemplates.filter((tpl) => (appMode === 'drone') === tpl.id.includes('drone') && tpl.id !== 'sv-easa-standard'),
    [allTemplates, appMode],
  );


  const [templateId, setTemplateId] = useState(initial?.template_id || pickable[0]?.id || 'easa-pilot-logbook');
  const [firstPage, setFirstPage] = useState(String(initial?.starting_page ?? 1));
  const [lastPage, setLastPage] = useState(initial && initial.end_page > 0 ? String(initial.end_page) : '');
  const template = useMemo(() => resolveTpl(templateId), [allTemplates, templateId]);
  const [rows, setRows] = useState(String(initial?.rows_per_spread ?? template.rows_per_spread));
  const [anchorPage, setAnchorPage] = useState(initial && initial.anchor_page > 0 ? String(initial.anchor_page) : '');
  const [anchorRow, setAnchorRow] = useState(initial && initial.anchor_row > 0 ? String(initial.anchor_row) : '');
  // Anchor auto-fylls (page/row där senaste flygningen hamnar) tills användaren själv ändrar.
  const [anchorEdited, setAnchorEdited] = useState(mode === 'edit');
  // Flera loggböcker: om flighterna inte får plats i en bok → fråga om tidigare böcker samma design.
  const [prevSameDesign, setPrevSameDesign] = useState<boolean | null>(null);

  // Antal riktiga bokrader (ej summeringsrader/backfill) → kapacitet & anchor-förslag.
  const numFlights = useMemo(
    () => flights.filter((f) => (f as any).flight_type !== 'summary' && (f as any).remarks !== '[BACKFILL]').length,
    [flights],
  );
  const design = useMemo(() => {
    const fp = Math.max(1, parseInt(firstPage, 10) || 1);
    const lp = lastPage.trim() ? Math.max(fp, parseInt(lastPage, 10) || 0) : 0;
    const rs = Math.max(1, parseInt(rows, 10) || template.rows_per_spread);
    const spreads = lp > 0 ? Math.floor((lp - fp) / 2) + 1 : Infinity;
    const capacity = spreads * rs; // rader per bok
    const overflow = lp > 0 && numFlights > capacity;
    const booksNeeded = overflow ? Math.ceil(numFlights / capacity) : 1;
    const flightsInCurrent = overflow ? numFlights - (booksNeeded - 1) * capacity : numFlights;
    // Position (1-indexerad rad uppifrån) för senaste flygningen i AKTUELLA boken.
    const pos = Math.max(1, Math.min(flightsInCurrent, capacity === Infinity ? flightsInCurrent : capacity));
    const spreadIdx = Math.ceil(pos / rs); // 1-indexerat uppslag
    const suggestPage = fp + (spreadIdx - 1) * 2;
    const suggestRow = ((pos - 1) % rs) + 1;
    return { fp, lp, rs, capacity, overflow, booksNeeded, flightsInCurrent, suggestPage, suggestRow };
  }, [firstPage, lastPage, rows, template.rows_per_spread, numFlights]);

  // Auto-fyll anchor (page/row där senaste flygningen hamnar) tills användaren själv ändrar.
  useEffect(() => {
    if (anchorEdited || numFlights <= 0) return;
    setAnchorPage(String(design.suggestPage));
    setAnchorRow(String(design.suggestRow));
  }, [design.suggestPage, design.suggestRow, numFlights, anchorEdited]);

  // Vid överspill måste användaren svara på flerboks-frågan innan spar.
  const needsOverflowAnswer = mode === 'create' && design.overflow && prevSameDesign === null;

  const balCols = useMemo(() => numericColumns(template), [template]);
  // Brought-forward-gräns = bokens FÖRSTA egna flight (samma som resolveOpeningBalance vid rendering),
  // INTE anchor_flight_id (senaste flighten) — annars blev "Modify" uppblåst mot "New"/den ritade boken.
  // Create (ingen bok än) → 0, dvs. bara summeringsrader / medförd balans (hanteras separat nedan).
  const bfBoundaryId = useMemo(() => {
    if (mode !== 'edit' || !initial || !allBooks?.length) return 0;
    const slice = assignFlightsToBooks(allBooks, flights).find((s) => s.book.id === initial.id);
    return slice?.flights?.[0]?.id ?? 0;
  }, [mode, initial, allBooks, flights]);
  const [bal, setBal] = useState<Record<string, string>>(() => {
    const seed: ColumnTotals = (() => {
      if (carryOpeningBalance) return carryOpeningBalance;
      // Redigerbar override: sparad korrigering om den finns, annars den auto-härledda
      // brought-forwarden (summering av loggade flyg + importerade summeringsrader före boken).
      let stored: ColumnTotals = {};
      try { stored = initial ? JSON.parse(initial.opening_balance || '{}') : {}; } catch { stored = {}; }
      if (Object.keys(stored).length > 0) return stored;
      return computeBroughtForward(flights, template, bfBoundaryId);
    })();
    const o: Record<string, string> = {};
    for (const c of balCols) {
      const v = seed[c.flightKey!] ?? 0;
      o[c.flightKey!] = !v ? '' : (c.format === 'int' ? String(Math.round(v)) : formatTimeValue(v, timeFormat));
    }
    return o;
  });

  // Ingående balans: Imported = ALL importerad/skannad erfarenhet (source ≠ 'manual') summerad
  // per kolumn — CSV, OCR och manuell erfarenhetslogg — så användaren ser hela sin brought-forward.
  // Current = brought-forward (allt före boken = importerat + loggat i appen) = redigerbara `bal`.
  const importedBal = useMemo(
    () => computeBroughtForward(flights, template, bfBoundaryId, (f) => (f as any).source !== 'manual', { noAnchorBase: 'all' }),
    [flights, template, bfBoundaryId],
  );
  const importSources = useMemo(() => {
    const sorted = sortFlightsChrono(flights);
    const before = bfBoundaryId > 0
      ? (() => { const idx = sorted.findIndex((f) => f.id === bfBoundaryId); return idx >= 0 ? sorted.slice(0, idx) : []; })()
      : sorted; // första boken → all historik (CSV/OCR/manuell), inte bara summeringsrader
    const set = new Set<string>();
    for (const f of before) {
      if ((f as any).source === 'manual') continue;
      if ((f as any).flight_type === 'summary') set.add(sv ? 'Manuell logg' : 'Manual log');
      else if ((f as any).source === 'ocr') set.add('OCR scan');
      else if ((f as any).source === 'import') set.add(sv ? 'CSV-import' : 'CSV import');
    }
    return [...set];
  }, [flights, bfBoundaryId, sv]);
  const fmtImported = (key: string) => {
    const col = balCols.find((c) => c.flightKey === key);
    const v = importedBal[key] ?? 0;
    if (!v) return '—';
    return col?.format === 'int' ? String(Math.round(v)) : formatTimeValue(v, timeFormat);
  };

  // Current = pilotens totala erfarenhet just nu = ALLA flygningar (importerat + loggat i appen),
  // dvs. bokens totalsumma (brought-forward + rader). Läsbar verifiering mot fysiska loggboken —
  // sparas EJ som opening_balance (skulle dubbelräknas mot bokraderna); balansen auto-härleds.
  const totalBal = useMemo(
    () => computeBroughtForward(flights, template, 0, undefined, { noAnchorBase: 'all' }),
    [flights, template],
  );
  // Backfill-justering (settings, ej flight) läggs till Current så bokens total inkluderar den.
  const [bfAdj, setBfAdj] = useState<Record<string, number>>({});
  useEffect(() => { getBackfill().then((v) => setBfAdj(v as any)); }, []);
  // Auto-härledd brought-forward (den boken använder utan override) + ev. sparad override.
  // Om en bok redan har en override är dess verkliga total = override + rader, inte totalBal.
  const autoBF = useMemo(() => computeBroughtForward(flights, template, bfBoundaryId), [flights, template, bfBoundaryId]);
  const storedOverride = useMemo(() => {
    try { return initial ? (JSON.parse(initial.opening_balance || '{}') as ColumnTotals) : {}; } catch { return {}; }
  }, [initial]);
  const hasOverride = Object.keys(storedOverride).length > 0;
  const fmtCurrent = (key: string) => {
    const col = balCols.find((c) => c.flightKey === key);
    // total = brought-forward + rader (+ backfill-justering); rader = totalBal − autoBF.
    const v = (hasOverride
      ? (totalBal[key] ?? 0) - (autoBF[key] ?? 0) + (storedOverride[key] ?? 0)
      : (totalBal[key] ?? 0)) + (bfAdj[key] ?? 0);
    if (!v) return '—';
    return col?.format === 'int' ? String(Math.round(v)) : formatTimeValue(v, timeFormat);
  };

  const latestFlight = useMemo(() => {
    const s = sortFlightsChrono(flights);
    return s.length ? s[s.length - 1] : null;
  }, [flights]);

  // Har användaren redan loggat flygerfarenhet (CSV-import/skanning/manuellt)?
  // Då ersätts ingående balans av en bekräftelse istället för inmatning.
  const hasExperience = flights.length > 0;
  // Visa bekräftelse-frågan vid skapande när det redan finns loggad erfarenhet —
  // men INTE vid carry-forward (då är förifylld ingående balans avsiktlig).
  const showConfirm = mode === 'create' && hasExperience && !carryOpeningBalance;
  const oldestFlight = useMemo(() => {
    const srt = sortFlightsChrono(flights);
    return srt.length ? srt[0] : null;
  }, [flights]);
  // Create-flödets bekräftelse: 'asking' (Confirm + Yes/No) → 'confirmed' (Create logbook)
  // eller 'editing' (röd "Modify above data…"). En ändring i datan återgår till 'asking'.
  const [confirmState, setConfirmState] = useState<'asking' | 'confirmed' | 'editing'>('asking');
  const [balEdited, setBalEdited] = useState(false);

  const balanceInputs = (
    <View style={{ gap: 8, marginTop: 10 }}>
      {importSources.length > 0 && (
        <Text style={s.hint}>{(sv ? 'Importerat från: ' : 'Imported from: ') + importSources.join(' · ')}</Text>
      )}
      {!carryOpeningBalance && (
        <Text style={s.hint}>
          {sv
            ? 'Imported = din importerade erfarenhet · Current = dina totala timmar just nu (importerat + loggat i appen). Bekräfta att Current stämmer med din riktiga loggbok.'
            : 'Imported = experience you brought in · Current = your total hours right now (imported + logged in the app). Confirm Current matches your actual logbook.'}
        </Text>
      )}
      {/* Kolumnrubriker: Imported (all importerad data) · Current (total just nu = imported + loggat) */}
      <View style={[s.balRow, { marginBottom: -2 }]}>
        <View style={{ flex: 1 }} />
        <Text style={[s.balColHead, { width: 72 }]}>{sv ? 'IMPORTERAT' : 'IMPORTED'}</Text>
        <Text style={[s.balColHead, { width: 96 }]}>{sv ? 'NUVARANDE' : 'CURRENT'}</Text>
      </View>
      {balCols.map((c) => (
        <View key={c.id} style={s.balRow}>
          <Text style={s.balLabel}>{c.group ? `${c.group} · ${c.label}` : c.label}</Text>
          <Text style={s.balImported}>{fmtImported(c.flightKey!)}</Text>
          {carryOpeningBalance ? (
            // Split-bok: Current = redigerbar brought-forward för den nya boken.
            <TextInput
              style={s.balInput}
              value={bal[c.flightKey!] ?? ''}
              onChangeText={(v) => { setBal((p) => ({ ...p, [c.flightKey!]: v })); setBalEdited(true); setConfirmState('asking'); }}
              keyboardType={c.format === 'int' ? 'number-pad' : (timeFormat === 'decimal' ? 'decimal-pad' : 'numbers-and-punctuation')}
              placeholder={c.format === 'int' ? '0' : (timeFormat === 'decimal' ? '0.0' : '0:00')}
              placeholderTextColor={Colors.textMuted}
            />
          ) : (
            // Current = total just nu (imported + loggat i appen), läsbar verifiering.
            <Text style={s.balCurrent}>{fmtCurrent(c.flightKey!)}</Text>
          )}
        </View>
      ))}
    </View>
  );

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    // matcha rader mot vald mall om användaren inte avvikit
    setRows(String(resolveTpl(id).rows_per_spread));
  };

  const handleSave = async () => {
    const fp = Math.max(1, parseInt(firstPage, 10) || 1);
    const lp = lastPage.trim() ? Math.max(fp, parseInt(lastPage, 10) || 0) : 0;
    const rs = Math.max(1, parseInt(rows, 10) || template.rows_per_spread);
    const ap = anchorPage.trim() ? Math.max(fp, parseInt(anchorPage, 10) || 0) : 0;
    const ar = anchorRow.trim() ? Math.max(1, Math.min(rs, parseInt(anchorRow, 10) || 0)) : 0;

    // Ingående balans sparas som override ENDAST om användaren redigerat Current-kolumnen
    // (korrigering); annars lämnas den tom → auto-härleds ur flygdata + summeringsrader.
    const balance: ColumnTotals = {};
    if (balEdited) {
      for (const c of balCols) {
        const raw = (bal[c.flightKey!] ?? '').trim();
        if (!raw) continue;
        if (c.format === 'int') {
          const n = parseInt(raw, 10);
          if (!isNaN(n) && n > 0) balance[c.flightKey!] = n;
        } else {
          const n = parseTimeInput(raw, timeFormat);
          if (n === null) { Alert.alert(t('error'), `${c.label}: ${t('dlb_invalid_time')}`); return; }
          if (n > 0) balance[c.flightKey!] = n;
        }
      }
    }

    // anchor knyts till den SENASTE flygningen (den användaren pekar ut / auto-förslaget)
    const anchorFlightId = ap > 0 && ar > 0 && latestFlight ? latestFlight.id : 0;
    const bookKind: BookKind = appMode === 'drone' ? 'drone' : 'digital';
    setSaving(true); // visa spinner tills boken skapats OCH föräldern laddat om + stängt arket
    try {
      if (mode === 'create') {
        // Auto-namn (1st/2nd/… Logbook) fortsätter från ev. befintliga böcker.
        const existing = await listDigitalBooks(bookKind);
        const base = existing.length;
        // Flera böcker: bara när flighterna spiller över OCH användaren bekräftat samma design.
        const multi = design.overflow && prevSameDesign === true;
        const total = multi ? design.booksNeeded : 1;
        for (let i = 0; i < total; i++) {
          const isCurrent = i === total - 1;
          await createDigitalBook({
            name: `${ordinal(base + i + 1)} Logbook`,
            templateId, startingPage: fp, rowsPerSpread: rs, endPage: lp,
            // Flera böcker = kapacitetsfyllning (inga ankare, brought-forward auto-härleds).
            // Enskild bok = anchor för senaste flygningen (auto-förslag/redigerat).
            anchorFlightId: multi ? 0 : anchorFlightId,
            anchorPage: multi ? 0 : ap,
            anchorRow: multi ? 0 : ar,
            openingBalance: (!multi && isCurrent) ? balance : {},
            customCols: {},
          }, bookKind);
        }
      } else if (initial) {
        await updateDigitalBook(initial.id, {
          name: initial.name, template_id: templateId, starting_page: fp, rows_per_spread: rs,
          end_page: lp, anchor_flight_id: anchorFlightId, anchor_page: ap, anchor_row: ar,
          opening_balance: balEdited ? JSON.stringify(balance) : (initial.opening_balance || '{}'),
        });
      }
      await onSaved(); // await:as → spinnern täcker även omladdning + stängning (arket avmonteras sen)
    } catch (e: any) {
      setSaving(false);
      Alert.alert(t('error'), e?.message ?? 'Failed');
    }
  };

  return (
    <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
      <View style={s.header}>
        <Text style={s.title}>{mode === 'create' ? t('dlb_new_book') : t('dlb_book_settings')}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={Colors.textSecondary} /></TouchableOpacity>
      </View>

      <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
        {/* Mall */}
        <Text style={s.label}>{t('dlb_choose_layout')}</Text>
        {pickable.map((tpl) => (
          <TemplateRow key={tpl.id} tpl={tpl} active={tpl.id === templateId} onPress={() => chooseTemplate(tpl.id)} onPreview={() => { const i = Math.max(0, pickable.findIndex((x) => x.id === tpl.id)); setCurPreview(i); setPreviewIdx(i); }} />
        ))}

        {/* Skapa egen bok som matchar valfri fysisk loggbok (FAA, udda layout …) */}
        <TouchableOpacity style={s.createRow} onPress={() => { onClose(); router.push('/logbook/create-custom'); }} activeOpacity={0.85}>
          <View style={[s.tplCover, { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '14', borderStyle: 'dashed', borderColor: Colors.primary + '55' }]}>
            <Ionicons name="add" size={20} color={Colors.primary} />
          </View>
          <Text style={[s.tplName, { color: Colors.primary }]} numberOfLines={1}>{sv ? 'Skapa egen bok…' : 'Create custom book…'}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </TouchableOpacity>

        {/* Böcker döps automatiskt (1st/2nd… Logbook) — inget namnfält. */}

        {/* Sidor */}
        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{t('dlb_first_page')}</Text>
            <TextInput style={s.input} value={firstPage} onChangeText={(v) => setFirstPage(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="1" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{t('dlb_last_page')}</Text>
            <TextInput style={s.input} value={lastPage} onChangeText={(v) => setLastPage(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder={t('dlb_unbounded')} placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={{ width: 90 }}>
            <Text style={s.label}>{t('dlb_rows_per_spread')}</Text>
            <TextInput style={s.input} value={rows} onChangeText={(v) => setRows(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="12" placeholderTextColor={Colors.textMuted} />
          </View>
        </View>
        <Text style={s.hint}>{t('dlb_last_page_hint')}</Text>

        {/* Anchor / flera böcker */}
        <View style={s.divider} />
        <Text style={s.section}>{t('dlb_anchor_title')}</Text>

        {/* Överspill: fler flygningar än en bok rymmer → erbjud flera böcker (samma design). */}
        {mode === 'create' && design.overflow && (
          <View style={{ marginTop: 6, marginBottom: 2 }}>
            <Text style={s.hint}>
              {sv
                ? `Du har ${numFlights} flygningar, men en bok med den här designen rymmer ${design.capacity}.`
                : `You have ${numFlights} flights, but one book with this design holds ${design.capacity}.`}
            </Text>
            <Text style={[s.section, { fontSize: 13.5, marginTop: 10 }]}>
              {sv ? 'Hade tidigare loggböcker samma design (antal sidor och uppslag) som denna?' : 'Previous logbooks same design (amount of pages and spreads) as current?'}
            </Text>
            <View style={s.confirmRow}>
              <TouchableOpacity style={[s.confirmBtn, prevSameDesign === true ? s.confirmYes : s.confirmNo]} onPress={() => setPrevSameDesign(true)} activeOpacity={0.85}>
                <Text style={prevSameDesign === true ? s.confirmYesTxt : s.confirmNoTxt}>{t('yes')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, prevSameDesign === false ? s.confirmYes : s.confirmNo]} onPress={() => setPrevSameDesign(false)} activeOpacity={0.85}>
                <Text style={prevSameDesign === false ? s.confirmYesTxt : s.confirmNoTxt}>{t('no')}</Text>
              </TouchableOpacity>
            </View>
            {prevSameDesign === true && (
              <Text style={[s.hint, { marginTop: 8 }]}>
                {sv
                  ? `Skapar ${design.booksNeeded} loggböcker (1st … ${ordinal(design.booksNeeded)} Logbook). Senaste flygningen hamnar på sida ${design.suggestPage}, rad ${design.suggestRow} i den aktuella boken.`
                  : `Creating ${design.booksNeeded} logbooks (1st … ${ordinal(design.booksNeeded)} Logbook). Your latest flight lands on page ${design.suggestPage}, row ${design.suggestRow} in the current book.`}
              </Text>
            )}
          </View>
        )}

        {/* Tie to paper book: anchor auto-fylls till där senaste flygningen hamnar (redigerbart).
            Döljs i flerboks-läget — då sköter kapacitetsfyllningen placeringen. */}
        {!(design.overflow && prevSameDesign === true) && (
          <>
            <Text style={s.hint}>{t('dlb_anchor_hint')}</Text>
            {latestFlight ? (
              <Text style={s.anchorFlight}>
                {t('dlb_anchor_latest')}: {latestFlight.date} · {(latestFlight.dep_place || '').toUpperCase()}–{(latestFlight.arr_place || '').toUpperCase()}
              </Text>
            ) : (
              <Text style={s.anchorFlight}>{t('dlb_anchor_no_flights')}</Text>
            )}
            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t('dlb_anchor_page')}</Text>
                <TextInput style={s.input} value={anchorPage} onChangeText={(v) => { setAnchorEdited(true); setAnchorPage(v.replace(/\D/g, '')); }} keyboardType="number-pad" placeholder="—" placeholderTextColor={Colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{t('dlb_anchor_row')}</Text>
                <TextInput style={s.input} value={anchorRow} onChangeText={(v) => { setAnchorEdited(true); setAnchorRow(v.replace(/\D/g, '')); }} keyboardType="number-pad" placeholder="—" placeholderTextColor={Colors.textMuted} />
              </View>
            </View>
          </>
        )}

        {/* Ingående balans / bekräfta loggad erfarenhet */}
        <View style={s.divider} />
        {!showConfirm ? (
          // Edit-läge eller ingen tidigare erfarenhet → vanlig ingående balans.
          <>
            <Text style={s.section}>{t('dlb_opening_balance')}</Text>
            <Text style={s.hint}>{carryOpeningBalance ? t('dlb_carry_balance_hint') : t('dlb_opening_balance_hint')}</Text>
            {balanceInputs}
          </>
        ) : (
          // Create + tidigare erfarenhet: visa Imported/Current så piloten kan jämföra mot sin
          // riktiga loggbok och ev. korrigera, och bekräfta innan boken skapas.
          <>
            <Text style={s.section}>{t('dlb_opening_balance')}</Text>
            {balanceInputs}
            {confirmState === 'asking' ? (
              <>
                <Text style={[s.section, { marginTop: 14 }]}>{sv ? 'Bekräfta att din flygerfarenhet stämmer med din riktiga loggbok' : 'Confirm your flight experience is correct according to your actual logbook'}</Text>
                <View style={s.confirmRow}>
                  <TouchableOpacity style={[s.confirmBtn, s.confirmYes]} onPress={() => setConfirmState('confirmed')} activeOpacity={0.85}>
                    <Text style={s.confirmYesTxt}>{t('yes')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.confirmBtn, s.confirmNo]} onPress={() => setConfirmState('editing')} activeOpacity={0.85}>
                    <Text style={s.confirmNoTxt}>{t('no')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : confirmState === 'confirmed' ? (
              <TouchableOpacity style={[s.saveBtn, { marginTop: 14 }, (saving || needsOverflowAnswer) && { opacity: 0.5 }]} onPress={handleSave} disabled={saving || needsOverflowAnswer} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color={Colors.textInverse} /> : <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />}
                <Text style={s.saveTxt}>{saving ? (sv ? 'Skapar…' : 'Creating…') : needsOverflowAnswer ? (sv ? 'Svara på frågan ovan' : 'Answer the question above') : (design.overflow && prevSameDesign ? (sv ? `Skapa ${design.booksNeeded} loggböcker` : `Create ${design.booksNeeded} logbooks`) : (sv ? 'Skapa loggbok' : 'Create logbook'))}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ color: Colors.danger, fontSize: 13, fontWeight: '700', marginTop: 12, lineHeight: 18 }}>
                {sv
                  ? 'Se över din importerade data under Import → Imported data så att totalerna stämmer med din riktiga loggbok, och öppna sedan den här igen.'
                  : 'Review your imported data under Import → Imported data so the totals match your actual logbook, then reopen this.'}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Bekräftelse-flödet (create + erfarenhet) har egen "Create logbook"-knapp i sektionen. */}
      {!showConfirm && (
        <TouchableOpacity style={[s.saveBtn, (saving || needsOverflowAnswer) && { opacity: 0.5 }]} onPress={handleSave} disabled={saving || needsOverflowAnswer} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color={Colors.textInverse} /> : <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />}
          <Text style={s.saveTxt}>{saving ? (sv ? 'Skapar…' : 'Creating…') : needsOverflowAnswer ? (sv ? 'Svara på frågan ovan' : 'Answer the question above') : (mode === 'create' ? (design.overflow && prevSameDesign ? (sv ? `Skapa ${design.booksNeeded} loggböcker` : `Create ${design.booksNeeded} logbooks`) : t('dlb_create_book')) : t('save'))}</Text>
        </TouchableOpacity>
      )}

      {/* Helskärms-förhandsvisning: bläddra i sidled mellan alla valbara böcker för att
          hitta den som ser ut som din egen. Varje sida = boken som två stående sidor. */}
      <Modal visible={previewIdx !== null} animationType="slide" supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setPreviewIdx(null)}>
        <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: Platform.OS === 'ios' ? 44 : 8 }}>
          <View style={s.previewTopBar}>
            <TouchableOpacity onPress={() => setPreviewIdx(null)} hitSlop={10} style={s.previewTopBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.previewTopTitle} numberOfLines={1}>{pickable[curPreview]?.name ?? ''}</Text>
              <Text style={s.previewTopSub}>{sv ? `Svep i sidled · ${curPreview + 1}/${pickable.length}` : `Swipe to compare · ${curPreview + 1}/${pickable.length}`}</Text>
            </View>
            <TouchableOpacity onPress={() => { const tpl = pickable[curPreview]; if (tpl) { chooseTemplate(tpl.id); setPreviewIdx(null); } }} hitSlop={10} style={s.previewTopBtn} activeOpacity={0.7}>
              <Ionicons name="checkmark" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          <FlatList
            ref={previewListRef}
            data={pickable}
            keyExtractor={(tpl) => tpl.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={previewIdx ?? 0}
            extraData={`${previewTestData}-${previewTimeFormat}`}
            getItemLayout={(_, index) => ({ length: winW, offset: winW * index, index })}
            onMomentumScrollEnd={(e) => setCurPreview(Math.round(e.nativeEvent.contentOffset.x / winW))}
            renderItem={({ item, index }) => (
              <PreviewPage
                tpl={item} index={index} total={pickable.length} width={winW}
                flights={flights} testData={previewTestData} timeFormat={previewTimeFormat}
                onUse={() => { chooseTemplate(item.id); setPreviewIdx(null); }}
                onToggleTest={() => setPreviewTestData((v) => !v)}
                onSetTimeFormat={setPreviewTimeFormat}
                onNav={(dir) => { const to = index + dir; if (to >= 0 && to < pickable.length) { previewListRef.current?.scrollToIndex({ index: to, animated: true }); setCurPreview(to); } }}
                sv={sv}
              />
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

// En sida i helskärms-förhandsvisningen: boken som två stående sidor, full bredd — så man ser
// exakt hur kolumnerna ser ut. "Test your data" fyller bladet med de SENASTE flygningarna +
// totaler; decimal/hh:mm-toggle; fram/bak-pilar som alternativ till svep.
function PreviewPage({ tpl, index, total, width, flights, testData, timeFormat, onUse, onToggleTest, onSetTimeFormat, onNav, sv }: {
  tpl: LogbookTemplate; index: number; total: number; width: number; flights: Flight[];
  testData: boolean; timeFormat: 'decimal' | 'hhmm';
  onUse: () => void; onToggleTest: () => void; onSetTimeFormat: (f: 'decimal' | 'hhmm') => void;
  onNav: (dir: -1 | 1) => void; sv: boolean;
}) {
  const [ratioL, setRatioL] = useState(0.72);
  const [ratioR, setRatioR] = useState(0.72);
  const spread = useMemo(() => {
    const cfg = { startingPage: 1, rowsPerSpread: tpl.rows_per_spread, openingBalance: {}, leadingEmptyRows: 0 };
    if (testData && flights.length) {
      const sp = buildBookSpreads(flights, tpl, cfg);
      return sp[sp.length - 1] ?? null; // senaste uppslaget (dina senaste flygningar + totaler)
    }
    return buildBookSpreads([], tpl, cfg)[0] ?? null;
  }, [tpl, testData, flights]);
  return (
    <View style={{ width }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 34 }} showsVerticalScrollIndicator={false}>
        {spread ? (
          <>
            <View style={{ width, height: width * ratioL, backgroundColor: Colors.background }}>
              <SpreadWebView spread={spread} template={tpl} pilotName="" timeFormat={timeFormat} width={width} signature={null} interactive={false} bare bgColor={Colors.background} side="left" margin={0} onAspect={(r) => { if (r > 0 && Math.abs(r - ratioL) > 0.01) setRatioL(r); }} />
            </View>
            <View style={{ width, height: width * ratioR, backgroundColor: Colors.background, marginTop: 6 }}>
              <SpreadWebView spread={spread} template={tpl} pilotName="" timeFormat={timeFormat} width={width} signature={null} interactive={false} bare bgColor={Colors.background} side="right" margin={0} onAspect={(r) => { if (r > 0 && Math.abs(r - ratioR) > 0.01) setRatioR(r); }} />
            </View>
          </>
        ) : null}

        <View style={{ paddingHorizontal: 16, marginTop: 14, gap: 10 }}>
          {/* Fram/bak-pilar (alternativ till svep) */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
            <TouchableOpacity disabled={index <= 0} onPress={() => onNav(-1)} activeOpacity={0.7} style={[s.previewArrow, index <= 0 && { opacity: 0.3 }]}>
              <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity disabled={index >= total - 1} onPress={() => onNav(1)} activeOpacity={0.7} style={[s.previewArrow, index >= total - 1 && { opacity: 0.3 }]}>
              <Ionicons name="chevron-forward" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.previewUse} onPress={onUse} activeOpacity={0.85}>
            <Text style={s.previewUseTxt}>{sv ? 'Använd den här layouten' : 'Use this layout'}</Text>
          </TouchableOpacity>

          {/* Testa dina flygningar i boken (senaste flygningarna + totaler) */}
          <TouchableOpacity style={[s.previewTest, testData && s.previewTestOn]} onPress={onToggleTest} activeOpacity={0.8}>
            <Ionicons name={testData ? 'checkbox' : 'square-outline'} size={16} color={testData ? Colors.primary : Colors.textSecondary} />
            <Text style={[s.previewTestTxt, testData && { color: Colors.primary }]}>{sv ? 'Testa dina flygningar i boken' : 'Test your data on logbook'}</Text>
          </TouchableOpacity>

          {/* Decimal ↔ hh:mm */}
          <View style={s.previewFmtRow}>
            {(['decimal', 'hhmm'] as const).map((k) => (
              <TouchableOpacity key={k} style={[s.previewFmtBtn, timeFormat === k && s.previewFmtOn]} onPress={() => onSetTimeFormat(k)} activeOpacity={0.8}>
                <Text style={[s.previewFmtTxt, timeFormat === k && { color: Colors.textInverse }]}>{k === 'decimal' ? '1.5' : '1:30'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function TemplateRow({ tpl, active, onPress, onPreview }: { tpl: LogbookTemplate; active: boolean; onPress: () => void; onPreview: () => void }) {
  return (
    <View style={[s.tplRow, active && s.tplRowActive]}>
      <TouchableOpacity style={s.tplMain} onPress={onPress} activeOpacity={0.85}>
        {tpl.cover
          ? <Image source={tpl.cover} style={s.tplCover} resizeMode="cover" />
          : <View style={[s.tplCover, { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.elevated }]}><Ionicons name="book-outline" size={18} color={Colors.textMuted} /></View>}
        <Text style={[s.tplName, active && { color: Colors.primary }]} numberOfLines={1}>{tpl.name}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onPreview} hitSlop={8} style={s.tplPreviewBtn} activeOpacity={0.7}>
        <Ionicons name="eye-outline" size={18} color={Colors.primary} />
      </TouchableOpacity>
      {active && <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />}
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 12 },
  section: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 4 },
  hint: { color: Colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  input: { backgroundColor: Colors.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: Colors.textPrimary, fontSize: 15, borderWidth: 1, borderColor: Colors.border },
  row2: { flexDirection: 'row', gap: 10 },
  divider: { height: 1, backgroundColor: Colors.separator, marginVertical: 16 },
  anchorFlight: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 8, fontStyle: 'italic' },
  balRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balLabel: { flex: 1, color: Colors.textSecondary, fontSize: 13 },
  balInput: { width: 96, backgroundColor: Colors.elevated, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: Colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: Colors.border, textAlign: 'right', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  balImported: { width: 72, textAlign: 'right', color: Colors.textSecondary, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  balCurrent: { width: 96, textAlign: 'right', color: Colors.textPrimary, fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  balColHead: { textAlign: 'right', color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 },
  tplRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 8 },
  tplRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0E' },
  tplMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tplPreviewBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '33' },
  previewBackdrop: { flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 16 },
  previewBox: { backgroundColor: Colors.surface, borderRadius: 16, padding: 12, gap: 10, maxWidth: '100%' },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  previewTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', flex: 1 },
  previewUse: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  previewUseTxt: { color: Colors.textInverse, fontSize: 14, fontWeight: '800' },
  previewTopBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.separator },
  previewTopBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  previewTopTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', maxWidth: 240 },
  previewTopSub: { color: Colors.textMuted, fontSize: 11, marginTop: 1 },
  previewArrow: { width: 48, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  previewTest: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated },
  previewTestOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '14' },
  previewTestTxt: { color: Colors.textSecondary, fontSize: 13.5, fontWeight: '700' },
  previewFmtRow: { flexDirection: 'row', gap: 6, alignSelf: 'center', backgroundColor: Colors.elevated, borderRadius: 9, borderWidth: 1, borderColor: Colors.border, padding: 3 },
  previewFmtBtn: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 7 },
  previewFmtOn: { backgroundColor: Colors.primary },
  previewFmtTxt: { color: Colors.textSecondary, fontSize: 13, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '44', borderStyle: 'dashed', marginBottom: 8, marginTop: 2 },
  tplCover: { width: 64, height: 42, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: Colors.cardBorder },
  tplName: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, marginTop: 12 },
  saveTxt: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },

  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  confirmBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1.5 },
  confirmYes: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  confirmYesTxt: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
  confirmNo: { backgroundColor: 'transparent', borderColor: Colors.cardBorder },
  confirmNoTxt: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start' },
  backTxt: { color: Colors.textMuted, fontSize: 13, fontWeight: '600' },
  oldestCard: { backgroundColor: Colors.elevated, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 12, marginTop: 10, gap: 3 },
  oldestLabel: { color: Colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  oldestRoute: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  oldestMeta: { color: Colors.textSecondary, fontSize: 12.5 },
});
