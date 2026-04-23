import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { exportCustomCSV } from '../../services/export';

type ColumnDef = {
  key: string;
  defaultHeader: string;
  customHeader: string;
  enabled: boolean;
};

const ALL_COLUMNS: { key: string; header: string }[] = [
  { key: 'date', header: 'Date' },
  { key: 'aircraft_type', header: 'Aircraft type' },
  { key: 'registration', header: 'Registration' },
  { key: 'dep_place', header: 'Departure' },
  { key: 'dep_utc', header: 'Dep UTC' },
  { key: 'arr_place', header: 'Arrival' },
  { key: 'arr_utc', header: 'Arr UTC' },
  { key: 'total_time', header: 'Total time' },
  { key: 'multi_pilot', header: 'Multi-pilot' },
  { key: 'single_pilot', header: 'Single-pilot' },
  { key: 'se_time', header: 'SE' },
  { key: 'me_time', header: 'ME' },
  { key: 'pic', header: 'PIC' },
  { key: 'picus', header: 'PICUS' },
  { key: 'spic', header: 'SPIC' },
  { key: 'co_pilot', header: 'Co-pilot' },
  { key: 'dual', header: 'Dual' },
  { key: 'instructor', header: 'Instructor' },
  { key: 'examiner', header: 'Examiner' },
  { key: 'safety_pilot', header: 'Safety pilot' },
  { key: 'relief_crew', header: 'Relief crew' },
  { key: 'ferry_pic', header: 'Ferry PIC' },
  { key: 'observer', header: 'Observer' },
  { key: 'ifr', header: 'IFR' },
  { key: 'vfr', header: 'VFR' },
  { key: 'night', header: 'Night' },
  { key: 'nvg', header: 'NVG' },
  { key: 'landings_day', header: 'Landings day' },
  { key: 'landings_night', header: 'Landings night' },
  { key: 'tng_count', header: 'Touch & Go' },
  { key: 'flight_rules', header: 'Flight rules' },
  { key: 'second_pilot', header: 'Second pilot' },
  { key: 'remarks', header: 'Remarks' },
  { key: 'flight_type', header: 'Flight type' },
  { key: 'sim_category', header: 'Sim category' },
  { key: 'source', header: 'Source' },
];

const DEFAULT_ENABLED = new Set([
  'date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc',
  'arr_place', 'arr_utc', 'total_time', 'pic', 'co_pilot',
  'ifr', 'night', 'landings_day', 'landings_night', 'flight_rules', 'remarks',
]);

export default function CustomExportScreen() {
  const { t } = useTranslation();
  const [columns, setColumns] = useState<ColumnDef[]>(
    ALL_COLUMNS.map(c => ({
      key: c.key,
      defaultHeader: c.header,
      customHeader: '',
      enabled: DEFAULT_ENABLED.has(c.key),
    }))
  );
  const [separator, setSeparator] = useState<',' | ';' | '\\t'>(',');
  const [timeFormat, setTimeFormat] = useState<'hhmm' | 'decimal'>('hhmm');
  const [exporting, setExporting] = useState(false);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);

  const toggleColumn = (key: string) => {
    setColumns(prev => prev.map(c =>
      c.key === key ? { ...c, enabled: !c.enabled } : c
    ));
  };

  const updateHeader = (key: string, value: string) => {
    setColumns(prev => prev.map(c =>
      c.key === key ? { ...c, customHeader: value } : c
    ));
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    setColumns(prev => {
      const idx = prev.findIndex(c => c.key === key);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const enabledColumns = columns.filter(c => c.enabled);

  const handleExport = async () => {
    if (enabledColumns.length === 0) {
      Alert.alert(t('error'), t('custom_csv_no_columns'));
      return;
    }
    setExporting(true);
    try {
      await exportCustomCSV({
        columns: enabledColumns.map(c => ({
          key: c.key,
          header: c.customHeader.trim() || c.defaultHeader,
        })),
        separator: separator === '\\t' ? '\t' : separator,
        timeFormat,
      });
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setExporting(false);
    }
  };

  const selectAll = () => setColumns(prev => prev.map(c => ({ ...c, enabled: true })));
  const selectNone = () => setColumns(prev => prev.map(c => ({ ...c, enabled: false })));

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{t('custom_csv_title')}</Text>
      <Text style={s.subtitle}>{t('custom_csv_desc')}</Text>

      {/* Format options */}
      <View style={s.optionCard}>
        <Text style={s.optionLabel}>{t('csv_separator')}</Text>
        <View style={s.segmentRow}>
          {([',', ';', '\\t'] as const).map(sep => (
            <TouchableOpacity
              key={sep}
              style={[s.segmentBtn, separator === sep && s.segmentBtnActive]}
              onPress={() => setSeparator(sep)}
              activeOpacity={0.75}
            >
              <Text style={[s.segmentText, separator === sep && s.segmentTextActive]}>
                {sep === '\\t' ? 'Tab' : sep}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.optionLabel, { marginTop: 12 }]}>{t('csv_time_format')}</Text>
        <View style={s.segmentRow}>
          {(['hhmm', 'decimal'] as const).map(fmt => (
            <TouchableOpacity
              key={fmt}
              style={[s.segmentBtn, timeFormat === fmt && s.segmentBtnActive]}
              onPress={() => setTimeFormat(fmt)}
              activeOpacity={0.75}
            >
              <Text style={[s.segmentText, timeFormat === fmt && s.segmentTextActive]}>
                {fmt === 'hhmm' ? 'HH:MM' : t('decimal')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Column selection */}
      <View style={s.columnHeader}>
        <Text style={s.columnTitle}>{t('csv_columns')} ({enabledColumns.length}/{columns.length})</Text>
        <TouchableOpacity onPress={selectAll}>
          <Text style={s.linkText}>{t('select_all')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={selectNone}>
          <Text style={s.linkText}>{t('select_none')}</Text>
        </TouchableOpacity>
      </View>

      {columns.map((col, idx) => (
        <View key={col.key} style={[s.columnRow, !col.enabled && s.columnRowDisabled]}>
          <TouchableOpacity onPress={() => toggleColumn(col.key)} style={{ marginRight: 8 }}>
            <Ionicons
              name={col.enabled ? 'checkbox' : 'square-outline'}
              size={20}
              color={col.enabled ? Colors.primary : Colors.textMuted}
            />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            {editingHeader === col.key ? (
              <TextInput
                style={s.headerInput}
                value={col.customHeader}
                onChangeText={(v) => updateHeader(col.key, v)}
                onBlur={() => setEditingHeader(null)}
                placeholder={col.defaultHeader}
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
            ) : (
              <TouchableOpacity onPress={() => col.enabled && setEditingHeader(col.key)}>
                <Text style={[s.columnName, !col.enabled && { color: Colors.textMuted }]}>
                  {col.customHeader || col.defaultHeader}
                </Text>
                {col.customHeader ? (
                  <Text style={s.columnOriginal}>{col.defaultHeader}</Text>
                ) : null}
              </TouchableOpacity>
            )}
          </View>
          {col.enabled && (
            <View style={{ flexDirection: 'row', gap: 2 }}>
              <TouchableOpacity onPress={() => moveColumn(col.key, -1)} disabled={idx === 0} style={s.moveBtn}>
                <Ionicons name="chevron-up" size={16} color={idx === 0 ? Colors.border : Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => moveColumn(col.key, 1)} disabled={idx === columns.length - 1} style={s.moveBtn}>
                <Ionicons name="chevron-down" size={16} color={idx === columns.length - 1 ? Colors.border : Colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}

      {/* Export button */}
      <TouchableOpacity
        style={[s.exportBtn, exporting && { opacity: 0.5 }]}
        onPress={handleExport}
        disabled={exporting}
        activeOpacity={0.85}
      >
        {exporting ? (
          <ActivityIndicator color={Colors.textInverse} />
        ) : (
          <>
            <Ionicons name="download-outline" size={18} color={Colors.textInverse} />
            <Text style={s.exportBtnText}>{t('export_custom_csv')}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Preview */}
      {enabledColumns.length > 0 && (
        <View style={s.preview}>
          <Text style={s.previewLabel}>{t('csv_preview')}</Text>
          <Text style={s.previewText} numberOfLines={2}>
            {enabledColumns.map(c => c.customHeader || c.defaultHeader).join(separator === '\\t' ? '  ' : separator + ' ')}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },

  optionCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  optionLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  segmentRow: { flexDirection: 'row', gap: 6 },
  segmentBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  segmentBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segmentText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: Colors.textInverse },

  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  columnTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  linkText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },

  columnRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10, padding: 10,
    borderWidth: 0.5, borderColor: Colors.cardBorder,
  },
  columnRowDisabled: { opacity: 0.5 },
  columnName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  columnOriginal: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },
  headerInput: {
    color: Colors.textPrimary, fontSize: 13, fontWeight: '600',
    backgroundColor: Colors.elevated, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary,
  },
  moveBtn: { padding: 4 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15, marginTop: 8,
  },
  exportBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  preview: {
    backgroundColor: Colors.elevated, borderRadius: 10, padding: 12,
    borderWidth: 0.5, borderColor: Colors.border,
  },
  previewLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  previewText: { color: Colors.textSecondary, fontSize: 11, fontFamily: 'Menlo' },
});
