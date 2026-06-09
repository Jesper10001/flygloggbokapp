// Konfigurationssteg för en digital loggbok: mall, första/sista sida, rader per
// uppslag, samt anchor (vilken sida + rad den SENASTE flygningen ligger på i
// pappersboken) och ingående balans. Används för att skapa OCH redigera böcker.

import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Image, Alert, Platform,
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
import { numericColumns, sortFlightsChrono, type ColumnTotals } from '../../services/logbook/paginate';
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
  const sv = t('yes') === 'Ja';

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
    () => allTemplates.filter((tpl) => (appMode === 'drone') === tpl.id.includes('drone')),
    [allTemplates, appMode],
  );

  const [templateId, setTemplateId] = useState(initial?.template_id || pickable[0]?.id || 'sv-easa-standard');
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
      try { return initial ? JSON.parse(initial.opening_balance || '{}') : {}; } catch { return {}; }
    })();
    const o: Record<string, string> = {};
    for (const c of balCols) {
      const v = seed[c.flightKey!] ?? 0;
      o[c.flightKey!] = !v ? '' : (c.format === 'int' ? String(Math.round(v)) : formatTimeValue(v, timeFormat));
    }
    return o;
  });

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
  const [balanceMode, setBalanceMode] = useState<'confirm' | 'logged' | 'manual'>('confirm');

  const balanceInputs = (
    <View style={{ gap: 8, marginTop: 10 }}>
      {balCols.map((c) => (
        <View key={c.id} style={s.balRow}>
          <Text style={s.balLabel}>{c.group ? `${c.group} · ${c.label}` : c.label}</Text>
          <TextInput
            style={s.balInput}
            value={bal[c.flightKey!] ?? ''}
            onChangeText={(v) => setBal((p) => ({ ...p, [c.flightKey!]: v }))}
            keyboardType={c.format === 'int' ? 'number-pad' : (timeFormat === 'decimal' ? 'decimal-pad' : 'numbers-and-punctuation')}
            placeholder={c.format === 'int' ? '0' : (timeFormat === 'decimal' ? '0.0' : '0:00')}
            placeholderTextColor={Colors.textMuted}
          />
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

    // ingående balans → ColumnTotals (hoppas över om användaren bekräftat att
    // all flygerfarenhet redan är loggad).
    const balance: ColumnTotals = {};
    if (!showConfirm || balanceMode === 'manual') {
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
          opening_balance: JSON.stringify(balance),
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
          <TemplateRow key={tpl.id} tpl={tpl} active={tpl.id === templateId} onPress={() => chooseTemplate(tpl.id)} />
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
          // Ingen tidigare erfarenhet → vanlig ingående balans.
          <>
            <Text style={s.section}>{t('dlb_opening_balance')}</Text>
            <Text style={s.hint}>{carryOpeningBalance ? t('dlb_carry_balance_hint') : t('dlb_opening_balance_hint')}</Text>
            {balanceInputs}
          </>
        ) : balanceMode === 'confirm' ? (
          <>
            <Text style={s.section}>{sv ? 'Bekräfta att all din flygerfarenhet redan är loggad?' : 'Confirm all your flight experience already logged?'}</Text>
            <View style={s.confirmRow}>
              <TouchableOpacity style={[s.confirmBtn, s.confirmYes]} onPress={() => setBalanceMode('logged')} activeOpacity={0.85}>
                <Text style={s.confirmYesTxt}>{t('yes')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmBtn, s.confirmNo]} onPress={() => setBalanceMode('manual')} activeOpacity={0.85}>
                <Text style={s.confirmNoTxt}>{t('no')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : balanceMode === 'logged' ? (
          <>
            <Text style={s.section}>{sv ? 'All flygerfarenhet loggad' : 'All flight experience logged'}</Text>
            <TouchableOpacity style={s.backRow} onPress={() => setBalanceMode('confirm')} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={16} color={Colors.textMuted} />
              <Text style={s.backTxt}>{sv ? 'Tillbaka' : 'Back'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          // NO → ingående balans + tydlig markering av äldsta flygningen.
          <>
            <Text style={s.section}>{t('dlb_opening_balance')}</Text>
            <Text style={s.hint}>{carryOpeningBalance ? t('dlb_carry_balance_hint') : t('dlb_opening_balance_hint')}</Text>
            {oldestFlight && (
              <View style={s.oldestCard}>
                <Text style={s.oldestLabel}>{sv ? 'DIN ÄLDSTA LOGGADE FLYGNING' : 'YOUR OLDEST LOGGED FLIGHT'}</Text>
                <Text style={s.oldestRoute}>{(oldestFlight.dep_place || '—')} → {(oldestFlight.arr_place || '—')}</Text>
                <Text style={s.oldestMeta}>
                  {oldestFlight.date}
                  {oldestFlight.aircraft_type ? ` · ${oldestFlight.aircraft_type}` : ''}
                  {oldestFlight.registration ? ` · ${oldestFlight.registration}` : ''}
                  {` · ${formatTimeValue(oldestFlight.total_time ?? 0, timeFormat)}`}
                </Text>
                <Text style={s.hint}>{sv ? 'Lägg bara in timmar FÖRE denna flygning.' : 'Only enter hours from BEFORE this flight.'}</Text>
              </View>
            )}
            {balanceInputs}
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={s.saveBtn} onPress={handleSave} activeOpacity={0.85}>
        <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
        <Text style={s.saveTxt}>{mode === 'create' ? t('dlb_create_book') : t('save')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function TemplateRow({ tpl, active, onPress }: { tpl: LogbookTemplate; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.tplRow, active && s.tplRowActive]} onPress={onPress} activeOpacity={0.85}>
      {tpl.cover
        ? <Image source={tpl.cover} style={s.tplCover} resizeMode="cover" />
        : <View style={[s.tplCover, { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.elevated }]}><Ionicons name="book-outline" size={18} color={Colors.textMuted} /></View>}
      <Text style={[s.tplName, active && { color: Colors.primary }]} numberOfLines={1}>{tpl.name}</Text>
      {active && <Ionicons name="checkmark-circle" size={18} color={Colors.primary} />}
    </TouchableOpacity>
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
  tplRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 8 },
  tplRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0E' },
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
