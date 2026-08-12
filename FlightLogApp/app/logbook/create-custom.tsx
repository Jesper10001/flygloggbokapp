// Skapa en egen digital loggbok (custom-mall) som matchar valfri fysisk loggbok
// (FAA, JAR eller en udda layout). Foto först: AI detekterar kolumnerna, sedan
// bekräftar/justerar användaren mappning, sida och rader. Sparas som en
// LogbookTemplate som dyker upp i bok-galleriet OCH används som OCR-layout.

import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert,
  ActivityIndicator, Modal, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import type { LogbookColumn, LogbookTemplate } from '../../constants/logbookTemplates';
import {
  analyzeLogbookStructure,
  labelForField, formatForField, flightKeyForField, type StructureScan,
} from '../../services/logbookStructure';
import { saveCustomTemplate, makeUniqueCustomTemplateId } from '../../db/customTemplates';
import { showQuotaExceededAlert } from '../../utils/quotaAlert';

interface EditCol {
  uid: number;
  label: string;
  fieldKey: string;          // '' = omappad fri kolumn
  page: 'left' | 'right';
  dateFormat?: string;       // bara för date-kolumn: ordning dag/månad/år
}

// Datumformat (ordning dag/månad/år) för date-kolumnen.
const DATE_FORMATS: { key: string; ex: string }[] = [
  { key: 'iso', ex: '2026-08-11' },
  { key: 'dmy', ex: '11/08/2026' },
  { key: 'mdy', ex: '08/11/2026' },
  { key: 'dmy2', ex: '11/08/26' },
  { key: 'dmon', ex: '11 Aug 2026' },
];

function widthFor(format: NonNullable<LogbookColumn['format']>): number {
  switch (format) {
    case 'date': return 84;
    case 'text': return 90;
    case 'icao': return 56;
    case 'time-utc': return 52;
    case 'int': return 46;
    default: return 52;
  }
}

function splitIndex(struct: StructureScan, n: number): number {
  if (struct.page_layout === 'single') return n;
  if (struct.right_page_start_index > 0 && struct.right_page_start_index < n) return struct.right_page_start_index;
  return Math.ceil(n / 2);
}

// Bygg-från-tomt: förvalda grundkolumner (resten lägger användaren till själv).
const BASE_FIELDS = ['date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time'];
const BASE_LEFT = new Set(['date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc']);

// Kolumner väljs kategorivis ur appens datafält (inga egna namn).
const FIELD_CATEGORIES: { en: string; sv: string; keys: string[] }[] = [
  { en: 'Basics', sv: 'Grunddata', keys: ['date', 'aircraft_type', 'registration'] },
  { en: 'Route & time', sv: 'Rutt & tid', keys: ['dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time', 'cross_country'] },
  { en: 'Pilot function', sv: 'Pilotfunktion', keys: ['pic', 'co_pilot', 'dual', 'instructor', 'picus', 'spic', 'solo'] },
  { en: 'Operational conditions', sv: 'Operativa förhållanden', keys: ['ifr', 'vfr', 'night', 'nvg'] },
  { en: 'Aircraft class', sv: 'Luftfartygsklass', keys: ['single_pilot', 'multi_pilot', 'se_time', 'me_time', 'sim'] },
  { en: 'Landings', sv: 'Landningar', keys: ['landings_day', 'landings_night'] },
  { en: 'Notes', sv: 'Anteckningar', keys: ['remarks'] },
];

export default function CreateCustomLogbook() {
  const { t } = useTranslation();
  const router = useRouter();
  const sv = t('yes') === 'Ja';

  // Att skapa en custom logbook sker i stående (bara den faktiska boken är liggande).
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState(false);
  const [name, setName] = useState('');
  const [rows, setRows] = useState(12);
  const [cols, setCols] = useState<EditCol[]>([]);
  const [footer, setFooter] = useState({ brought_forward: true, this_page_total: true, total_to_date: true });
  const [pickerFor, setPickerFor] = useState<number | 'add' | null>(null); // uid = ändra kolumn, 'add' = ny

  const runDetection = async (uri: string) => {
    setBusy(true);
    try {
      const info = await ImageManipulator.manipulateAsync(uri, [], {});
      const actions: ImageManipulator.Action[] = [];
      if (info.height > info.width) actions.push({ rotate: 90 });
      actions.push({ resize: { width: 2000 } });
      const img = await ImageManipulator.manipulateAsync(
        uri, actions, { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!img.base64) throw new Error('Could not process image');
      const struct = await analyzeLogbookStructure(img.base64, 'image/jpeg');
      if (!struct.columns.length) throw new Error(sv ? 'Inga kolumner hittades — prova en tydligare bild.' : 'No columns found — try a clearer photo.');
      const split = splitIndex(struct, struct.columns.length);
      let seq = 0;
      const edit: EditCol[] = struct.columns.map((k, i) => {
        const fk = k.startsWith('other_flight_time') ? '' : k;
        const custom = struct.custom_columns.find((c) => c.key === k);
        return {
          uid: seq++,
          label: fk ? labelForField(fk) : (custom?.header_text || (sv ? 'Kolumn' : 'Column')),
          fieldKey: fk,
          page: i < split ? 'left' : 'right',
        };
      });
      setCols(edit);
      if (struct.rows_per_page > 0) setRows(struct.rows_per_page);
      setFooter({
        brought_forward: !!struct.summary_rows.brought_forward,
        this_page_total: !!struct.summary_rows.total_this_page,
        total_to_date: !!struct.summary_rows.total_to_date,
      });
      setDetected(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (msg.includes('QUOTA_EXCEEDED') || msg.includes('quota') || msg.includes('429')) {
        showQuotaExceededAlert(t as any, sv ? 'Analyser slut denna månad.' : 'Analyses exhausted this month.');
      } else {
        Alert.alert(sv ? 'Analys misslyckades' : 'Analysis failed', msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const fromCamera = async () => {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!r.canceled && r.assets?.[0]) runDetection(r.assets[0].uri);
  };
  const fromLibrary = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!r.canceled && r.assets?.[0]) runDetection(r.assets[0].uri);
  };

  const startBlank = () => {
    setDetected(true);
    let seq = 0;
    // Förval: date, make/mod/var, reg, dep place/time, arr place/time, total flight time.
    setCols(BASE_FIELDS.map((k) => ({ uid: seq++, label: labelForField(k), fieldKey: k, page: BASE_LEFT.has(k) ? 'left' : 'right' })));
  };

  const updateCol = (uid: number, patch: Partial<EditCol>) =>
    setCols((p) => p.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  const removeCol = (uid: number) => setCols((p) => p.filter((c) => c.uid !== uid));
  const moveCol = (uid: number, dir: -1 | 1) =>
    setCols((p) => {
      const i = p.findIndex((c) => c.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addCol = () => { Haptics.selectionAsync(); setPickerFor('add'); };

  // Väljer ett fält i kategori-väljaren: 'add' → ny kolumn; uid → byt fält på befintlig.
  const pickField = (key: string) => {
    const label = labelForField(key);
    if (pickerFor === 'add') {
      setCols((p) => {
        const uid = p.reduce((m, c) => Math.max(m, c.uid), -1) + 1;
        return [...p, { uid, label, fieldKey: key, page: p.length && p[p.length - 1].page === 'right' ? 'right' : 'left' }];
      });
    } else if (pickerFor !== null) {
      updateCol(pickerFor, { fieldKey: key, label });
    }
    setPickerFor(null);
  };

  const save = async () => {
    const finalName = name.trim() || (sv ? 'Min loggbok' : 'My logbook');
    if (!cols.length) { Alert.alert(sv ? 'Inga kolumner' : 'No columns', sv ? 'Lägg till minst en kolumn.' : 'Add at least one column.'); return; }
    setBusy(true);
    try {
      const toCol = (e: EditCol): LogbookColumn => {
        const format = e.fieldKey ? formatForField(e.fieldKey) : 'decimal';
        return {
          id: e.fieldKey ? `${e.fieldKey}_${e.uid}` : `col_${e.uid}`,
          label: e.label.trim() || labelForField(e.fieldKey) || 'Column',
          flightKey: e.fieldKey ? flightKeyForField(e.fieldKey) : undefined,
          format,
          width: widthFor(format),
          ...(format === 'date' ? { date_format: e.dateFormat || 'iso' } : {}),
        };
      };
      const id = await makeUniqueCustomTemplateId(finalName);
      const tpl: LogbookTemplate = {
        id,
        name: finalName,
        rows_per_spread: Math.max(1, rows),
        language: 'en',
        time_format: 'decimal', // tidsformat styrs globalt (ingen toggle här)
        left_columns: cols.filter((c) => c.page === 'left').map(toCol),
        right_columns: cols.filter((c) => c.page === 'right').map(toCol),
        summary_layout: 'bottom',
        footer: { ...footer, signature: true },
      };
      await saveCustomTemplate(tpl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      Alert.alert(sv ? 'Kunde inte spara' : 'Could not save', e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  // ── Capture-läge (innan detektering) ──
  if (!detected) {
    return (
      <View style={s.container}>
        <Header title={sv ? 'Skapa egen loggbok' : 'Create custom logbook'} onBack={() => router.back()} />
        <View style={s.captureWrap}>
          <Ionicons name="book-outline" size={48} color={Colors.textMuted} />
          <Text style={s.captureTitle}>{sv ? 'Fotografera din loggbok' : 'Photograph your logbook'}</Text>
          <Text style={s.captureBody}>
            {sv
              ? 'Ta en bild på ett uppslag (helst en tom sida) så identifierar AI kolumnerna automatiskt. Du bekräftar och justerar sedan.'
              : 'Take a photo of a spread (an empty page works best) and the AI identifies the columns. You then confirm and adjust.'}
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={fromCamera} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color={Colors.textInverse} /> : <><Ionicons name="camera" size={18} color={Colors.textInverse} /><Text style={s.primaryTxt}>{sv ? 'Fotografera' : 'Take photo'}</Text></>}
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={fromLibrary} disabled={busy} activeOpacity={0.8}>
            <Ionicons name="images" size={16} color={Colors.primary} /><Text style={s.secondaryTxt}>{sv ? 'Välj från bibliotek' : 'Choose from library'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.blankLink} onPress={startBlank} disabled={busy}>
            <Text style={s.blankTxt}>{sv ? 'Bygg från tomt istället' : 'Build from scratch instead'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Editor ──
  return (
    <View style={s.container}>
      <Header title={sv ? 'Justera kolumnerna' : 'Adjust the columns'} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>{sv ? 'Bokens namn' : 'Book name'}</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder={sv ? 'Min loggbok' : 'My logbook'} placeholderTextColor={Colors.textMuted} />

        <View style={{ marginTop: 14 }}>
          <Text style={s.label}>{sv ? 'Rader per uppslag' : 'Rows per spread'}</Text>
          <View style={s.stepper}>
            <TouchableOpacity style={s.stepBtn} onPress={() => setRows((r) => Math.max(1, r - 1))}><Ionicons name="remove" size={16} color={Colors.textPrimary} /></TouchableOpacity>
            <Text style={s.stepVal}>{rows}</Text>
            <TouchableOpacity style={s.stepBtn} onPress={() => setRows((r) => r + 1)}><Ionicons name="add" size={16} color={Colors.textPrimary} /></TouchableOpacity>
          </View>
        </View>

        <Text style={[s.label, { marginTop: 18 }]}>{sv ? `Kolumner (${cols.length})` : `Columns (${cols.length})`}</Text>
        <Text style={s.hint}>{sv ? 'Lägg till kolumner från den kategoriserade listan. Tryck på ett fält för att byta. V/H = vänster/höger sida.' : 'Add columns from the categorised list. Tap a field to swap it. L/R = left/right page.'}</Text>

        {cols.map((c, i) => (
          <View key={c.uid} style={s.colCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.colNum}>{i + 1}</Text>
              {/* Fältnamnet kommer från datalistan (tryck för att byta) — inga egna namn. */}
              <TouchableOpacity style={s.fieldBtnFlex} onPress={() => setPickerFor(c.uid)} activeOpacity={0.8}>
                <Ionicons name="pricetag-outline" size={13} color={c.fieldKey ? Colors.primary : Colors.textMuted} />
                <Text style={[s.fieldTxt, !c.fieldKey && { color: Colors.textMuted }]} numberOfLines={1}>{c.fieldKey ? labelForField(c.fieldKey) : (sv ? 'Välj fält' : 'Choose field')}</Text>
                <Ionicons name="chevron-down" size={13} color={Colors.textMuted} />
              </TouchableOpacity>
              <View style={s.pageSeg}>
                {(['left', 'right'] as const).map((pg) => (
                  <TouchableOpacity key={pg} style={[s.pageBtn, c.page === pg && s.pageBtnActive]} onPress={() => updateCol(c.uid, { page: pg })}>
                    <Text style={[s.pageTxt, c.page === pg && s.pageTxtActive]}>{pg === 'left' ? (sv ? 'V' : 'L') : (sv ? 'H' : 'R')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {/* Datumformat — ordning dag/månad/år (bara date-kolumnen) */}
            {c.fieldKey === 'date' && (
              <View style={{ marginTop: 8 }}>
                <Text style={s.dateFmtLabel}>{sv ? 'Datumformat' : 'Date format'}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
                  {DATE_FORMATS.map((df) => {
                    const active = (c.dateFormat || 'iso') === df.key;
                    return (
                      <TouchableOpacity key={df.key} style={[s.dfChip, active && s.dfChipActive]} onPress={() => updateCol(c.uid, { dateFormat: df.key })} activeOpacity={0.8}>
                        <Text style={[s.dfChipTxt, active && s.dfChipTxtActive]}>{df.ex}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => moveCol(c.uid, -1)} hitSlop={6} style={s.iconBtn}><Ionicons name="chevron-up" size={16} color={Colors.textSecondary} /></TouchableOpacity>
              <TouchableOpacity onPress={() => moveCol(c.uid, 1)} hitSlop={6} style={s.iconBtn}><Ionicons name="chevron-down" size={16} color={Colors.textSecondary} /></TouchableOpacity>
              <TouchableOpacity onPress={() => removeCol(c.uid)} hitSlop={6} style={s.iconBtn}><Ionicons name="trash-outline" size={15} color={Colors.danger} /></TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity style={s.addColBtn} onPress={addCol} activeOpacity={0.8}>
          <Ionicons name="add-circle-outline" size={18} color={Colors.primary} /><Text style={s.addColTxt}>{sv ? 'Lägg till kolumn' : 'Add column'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[s.primaryBtn, { marginTop: 22 }]} onPress={save} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color={Colors.textInverse} /> : <><Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} /><Text style={s.primaryTxt}>{sv ? 'Spara loggbok' : 'Save logbook'}</Text></>}
        </TouchableOpacity>
      </ScrollView>

      {/* Kategori-väljare: välj kolumn ur appens datafält (grupperat, redan använda döljs) */}
      <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickerFor(null)}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>{sv ? 'Välj kolumn' : 'Add column'}</Text>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              {FIELD_CATEGORIES.map((cat) => {
                const usedKeys = new Set(cols.filter((c) => pickerFor === 'add' || c.uid !== pickerFor).map((c) => c.fieldKey));
                const keys = cat.keys.filter((k) => !usedKeys.has(k));
                if (keys.length === 0) return null;
                return (
                  <View key={cat.en} style={{ marginBottom: 8 }}>
                    <Text style={s.catTitle}>{sv ? cat.sv : cat.en}</Text>
                    {keys.map((k) => (
                      <TouchableOpacity key={k} style={s.optRow} onPress={() => pickField(k)} activeOpacity={0.7}>
                        <Text style={s.optTxt}>{labelForField(k)}</Text>
                        <Ionicons name="add" size={16} color={Colors.primary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={s.headerBtn}><Ionicons name="close" size={22} color={Colors.textSecondary} /></TouchableOpacity>
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={s.headerBtn} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  headerBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },

  captureWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  captureTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 6 },
  captureBody: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 8 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 22, alignSelf: 'stretch' },
  primaryTxt: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, borderWidth: 1, borderColor: Colors.primary + '55', alignSelf: 'stretch' },
  secondaryTxt: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  blankLink: { paddingVertical: 8 },
  blankTxt: { color: Colors.textMuted, fontSize: 12.5, textDecorationLine: 'underline' },

  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  hint: { color: Colors.textMuted, fontSize: 11.5, lineHeight: 16, marginBottom: 10 },
  input: { backgroundColor: Colors.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: Colors.textPrimary, fontSize: 15, borderWidth: 1, borderColor: Colors.border },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 38, height: 40, borderRadius: 10, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepVal: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', minWidth: 30, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  segRow: { flexDirection: 'row', gap: 6 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  segActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segTxt: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  segTxtActive: { color: Colors.textInverse },

  colCard: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 10, marginBottom: 8 },
  colNum: { color: Colors.primary, fontSize: 12, fontWeight: '800', width: 18, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  colLabel: { flex: 1, backgroundColor: Colors.elevated, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: Colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: Colors.border },
  pageSeg: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  pageBtn: { width: 34, paddingVertical: 8, alignItems: 'center', backgroundColor: Colors.elevated },
  pageBtnActive: { backgroundColor: Colors.primary },
  pageTxt: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800' },
  pageTxtActive: { color: Colors.textInverse },
  fieldBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.primary + '12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: Colors.primary + '33' },
  fieldBtnFlex: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: Colors.primary + '33' },
  fieldTxt: { flex: 1, color: Colors.primary, fontSize: 13, fontWeight: '700' },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  addColBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '44', borderStyle: 'dashed', marginTop: 4 },
  addColTxt: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  modalBg: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28 },
  modalTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 10 },
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.separator },
  optTxt: { color: Colors.textPrimary, fontSize: 14.5 },
  catTitle: { color: Colors.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10, marginBottom: 2 },
  dateFmtLabel: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  dfChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  dfChipActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  dfChipTxt: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  dfChipTxtActive: { color: Colors.primary },
});
