// Konfigurationssteg för en digital loggbok: mall, första/sista sida, rader per
// uppslag, samt anchor (vilken sida + rad den SENASTE flygningen ligger på i
// pappersboken) och ingående balans. Används för att skapa OCH redigera böcker.

import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Image, Alert, Platform, Modal, useWindowDimensions,
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
import { SpreadWebView } from './SpreadWebView';
import type { Flight } from '../../types/flight';
import {
  createDigitalBook, updateDigitalBook, type DigitalBook,
} from '../../db/digitalBooks';

export function BookSetupSheet({
  mode, appMode, initial, flights, carryOpeningBalance, timeFormat, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  appMode: 'manned' | 'drone';
  initial?: DigitalBook | null;
  flights: Flight[];
  carryOpeningBalance?: ColumnTotals;
  timeFormat: 'decimal' | 'hhmm';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const sv = t('yes') === 'Ja';

  // Tom förhandsvisning av en layout (innan man väljer den).
  const [previewTpl, setPreviewTpl] = useState<LogbookTemplate | null>(null);
  const [previewAspect, setPreviewAspect] = useState<number | null>(null);

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

  // Ett tomt uppslag för den layout som förhandsvisas.
  const previewSpread = useMemo(() => {
    if (!previewTpl) return null;
    const sp = buildBookSpreads([], previewTpl, { startingPage: 1, rowsPerSpread: previewTpl.rows_per_spread, openingBalance: {}, leadingEmptyRows: 0 });
    return sp[0] ?? null;
  }, [previewTpl]);
  const previewBoxW = Math.min(winW - 48, 560);

  const [templateId, setTemplateId] = useState(initial?.template_id || pickable[0]?.id || 'easa-pilot-logbook');
  const [name, setName] = useState(initial?.name || '');
  const [firstPage, setFirstPage] = useState(String(initial?.starting_page ?? 1));
  const [lastPage, setLastPage] = useState(initial && initial.end_page > 0 ? String(initial.end_page) : '');
  const template = useMemo(() => resolveTpl(templateId), [allTemplates, templateId]);
  const [rows, setRows] = useState(String(initial?.rows_per_spread ?? template.rows_per_spread));
  const [anchorPage, setAnchorPage] = useState(initial && initial.anchor_page > 0 ? String(initial.anchor_page) : '');
  const [anchorRow, setAnchorRow] = useState(initial && initial.anchor_row > 0 ? String(initial.anchor_row) : '');

  const balCols = useMemo(() => numericColumns(template), [template]);
  const [bal, setBal] = useState<Record<string, string>>(() => {
    const seed: ColumnTotals = (() => {
      if (carryOpeningBalance) return carryOpeningBalance;
      // Redigerbar override: sparad korrigering om den finns, annars den auto-härledda
      // brought-forwarden (summering av loggade flyg + importerade summeringsrader före boken).
      let stored: ColumnTotals = {};
      try { stored = initial ? JSON.parse(initial.opening_balance || '{}') : {}; } catch { stored = {}; }
      if (Object.keys(stored).length > 0) return stored;
      return computeBroughtForward(flights, template, initial?.anchor_flight_id ?? 0);
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
  const anchorId = initial?.anchor_flight_id ?? 0;
  const importedBal = useMemo(
    () => computeBroughtForward(flights, template, anchorId, (f) => (f as any).source !== 'manual', { noAnchorBase: 'all' }),
    [flights, template, anchorId],
  );
  const importSources = useMemo(() => {
    const sorted = sortFlightsChrono(flights);
    const before = anchorId > 0
      ? (() => { const idx = sorted.findIndex((f) => f.id === anchorId); return idx >= 0 ? sorted.slice(0, idx) : []; })()
      : sorted; // första boken → all historik (CSV/OCR/manuell), inte bara summeringsrader
    const set = new Set<string>();
    for (const f of before) {
      if ((f as any).source === 'manual') continue;
      if ((f as any).flight_type === 'summary') set.add(sv ? 'Manuell logg' : 'Manual log');
      else if ((f as any).source === 'ocr') set.add('OCR scan');
      else if ((f as any).source === 'import') set.add(sv ? 'CSV-import' : 'CSV import');
    }
    return [...set];
  }, [flights, anchorId, sv]);
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
  // Auto-härledd brought-forward (den boken använder utan override) + ev. sparad override.
  // Om en bok redan har en override är dess verkliga total = override + rader, inte totalBal.
  const autoBF = useMemo(() => computeBroughtForward(flights, template, anchorId), [flights, template, anchorId]);
  const storedOverride = useMemo(() => {
    try { return initial ? (JSON.parse(initial.opening_balance || '{}') as ColumnTotals) : {}; } catch { return {}; }
  }, [initial]);
  const hasOverride = Object.keys(storedOverride).length > 0;
  const fmtCurrent = (key: string) => {
    const col = balCols.find((c) => c.flightKey === key);
    // total = brought-forward + rader; rader = totalBal − autoBF (oberoende av override).
    const v = hasOverride
      ? (totalBal[key] ?? 0) - (autoBF[key] ?? 0) + (storedOverride[key] ?? 0)
      : (totalBal[key] ?? 0);
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

    // anchor knyts till den SENASTE flygningen (den användaren pekar ut)
    const anchorFlightId = ap > 0 && ar > 0 && latestFlight ? latestFlight.id : 0;
    const finalName = name.trim() || (mode === 'create' ? t('dlb_book_default_name') : initial?.name || 'Logbook');

    try {
      if (mode === 'create') {
        await createDigitalBook({
          name: finalName, templateId, startingPage: fp, rowsPerSpread: rs,
          endPage: lp, anchorFlightId, anchorPage: ap, anchorRow: ar,
          openingBalance: balance, customCols: {},
        });
      } else if (initial) {
        await updateDigitalBook(initial.id, {
          name: finalName, template_id: templateId, starting_page: fp, rows_per_spread: rs,
          end_page: lp, anchor_flight_id: anchorFlightId, anchor_page: ap, anchor_row: ar,
          opening_balance: balEdited ? JSON.stringify(balance) : (initial.opening_balance || '{}'),
        });
      }
      onSaved();
    } catch (e: any) {
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
          <TemplateRow key={tpl.id} tpl={tpl} active={tpl.id === templateId} onPress={() => chooseTemplate(tpl.id)} onPreview={() => { setPreviewAspect(null); setPreviewTpl(tpl); }} />
        ))}

        {/* Skapa egen bok som matchar valfri fysisk loggbok (FAA, udda layout …) */}
        <TouchableOpacity style={s.createRow} onPress={() => router.push('/logbook/create-custom')} activeOpacity={0.85}>
          <View style={[s.tplCover, { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '14', borderStyle: 'dashed', borderColor: Colors.primary + '55' }]}>
            <Ionicons name="add" size={20} color={Colors.primary} />
          </View>
          <Text style={[s.tplName, { color: Colors.primary }]} numberOfLines={1}>{sv ? 'Skapa egen bok…' : 'Create custom book…'}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </TouchableOpacity>

        {/* Namn */}
        <Text style={s.label}>{t('book_name')}</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder={t('dlb_book_default_name')} placeholderTextColor={Colors.textMuted} />

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

        {/* Anchor */}
        <View style={s.divider} />
        <Text style={s.section}>{t('dlb_anchor_title')}</Text>
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
            <TextInput style={s.input} value={anchorPage} onChangeText={(v) => setAnchorPage(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="—" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{t('dlb_anchor_row')}</Text>
            <TextInput style={s.input} value={anchorRow} onChangeText={(v) => setAnchorRow(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="—" placeholderTextColor={Colors.textMuted} />
          </View>
        </View>

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
              <TouchableOpacity style={[s.saveBtn, { marginTop: 14 }]} onPress={handleSave} activeOpacity={0.85}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
                <Text style={s.saveTxt}>{sv ? 'Skapa loggbok' : 'Create logbook'}</Text>
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
        <TouchableOpacity style={s.saveBtn} onPress={handleSave} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
          <Text style={s.saveTxt}>{mode === 'create' ? t('dlb_create_book') : t('save')}</Text>
        </TouchableOpacity>
      )}

      {/* Tom förhandsvisning av en layout (innan val) */}
      <Modal visible={!!previewTpl} animationType="fade" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => { setPreviewTpl(null); setPreviewAspect(null); }}>
        <View style={s.previewBackdrop}>
          <View style={[s.previewBox, { width: previewBoxW + 24 }]}>
            <View style={s.previewHead}>
              <Text style={s.previewTitle} numberOfLines={1}>{previewTpl?.name}</Text>
              <TouchableOpacity onPress={() => { setPreviewTpl(null); setPreviewAspect(null); }} hitSlop={10} activeOpacity={0.7}><Ionicons name="close" size={20} color={Colors.textSecondary} /></TouchableOpacity>
            </View>
            {previewSpread && previewTpl ? (
              <View pointerEvents="none" style={{ width: previewBoxW, height: previewAspect ? Math.round(previewBoxW * previewAspect) : Math.round(previewBoxW * 0.5), borderRadius: 10, overflow: 'hidden', alignSelf: 'center' }}>
                <SpreadWebView spread={previewSpread} template={previewTpl} pilotName="" timeFormat={timeFormat} width={previewBoxW} signature={null} interactive={false} margin={10} onAspect={setPreviewAspect} />
              </View>
            ) : null}
            <TouchableOpacity style={s.previewUse} onPress={() => { if (previewTpl) chooseTemplate(previewTpl.id); setPreviewTpl(null); setPreviewAspect(null); }} activeOpacity={0.85}>
              <Text style={s.previewUseTxt}>{sv ? 'Använd den här layouten' : 'Use this layout'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
