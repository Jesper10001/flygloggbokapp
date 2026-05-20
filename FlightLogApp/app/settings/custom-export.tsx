import { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, Switch,
  LayoutAnimation,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { exportCustomCSV } from '../../services/export';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';

type ColumnDef = {
  key: string;
  defaultHeader: string;
  customHeader: string;
  enabled: boolean;
  selectionIndex: number; // -1 if disabled, 0+ if enabled in selection order
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

// Default columns (same for both EASA and FAA) - up to and including total_time
const DEFAULT_ENABLED = new Set([
  'date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc',
  'arr_place', 'arr_utc', 'total_time',
]);

const getDefaultEnabled = () => DEFAULT_ENABLED;

interface DraggableRowProps {
  col: ColumnDef;
  idx: number;
  totalCount: number;
  isDragging: boolean;
  onDragStart: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleEdit: () => void;
  onEditingHeader: boolean;
  onUpdateHeader: (value: string) => void;
  onRemove: () => void;
}

const DraggableRow = ({
  col,
  idx,
  totalCount,
  isDragging,
  onDragStart,
  onMoveUp,
  onMoveDown,
  onToggleEdit,
  onEditingHeader,
  onUpdateHeader,
  onRemove,
}: DraggableRowProps) => {
  const handleIconPress = () => {
    onDragStart();
  };

  return (
    <View style={[s.selectedColumnRow, isDragging && s.selectedColumnRowDragging]}>
      <TouchableOpacity onPress={handleIconPress} style={{ marginRight: 8 }}>
        <Ionicons
          name="reorder-four"
          size={18}
          color={isDragging ? Colors.primary : Colors.textMuted}
        />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        {onEditingHeader ? (
          <TextInput
            style={s.headerInput}
            value={col.customHeader}
            onChangeText={onUpdateHeader}
            placeholder={col.defaultHeader}
            placeholderTextColor={Colors.textMuted}
            autoFocus
          />
        ) : (
          <TouchableOpacity onPress={onToggleEdit}>
            <Text style={s.columnName}>
              {col.customHeader || col.defaultHeader}
            </Text>
            {col.customHeader ? (
              <Text style={s.columnOriginal}>{col.defaultHeader}</Text>
            ) : null}
          </TouchableOpacity>
        )}
      </View>

      {isDragging && (
        <View style={{ flexDirection: 'row', gap: 2 }}>
          <TouchableOpacity onPress={onMoveUp} disabled={idx === 0} style={s.moveBtn}>
            <Ionicons name="chevron-up" size={18} color={idx === 0 ? Colors.border : Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onMoveDown} disabled={idx === totalCount - 1} style={s.moveBtn}>
            <Ionicons name="chevron-down" size={18} color={idx === totalCount - 1 ? Colors.border : Colors.primary} />
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity onPress={onRemove} style={s.removeBtn}>
        <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

export default function CustomExportScreen() {
  const { t } = useTranslation();
  const defaultEnabled = getDefaultEnabled();

  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    let selectionIdx = 0;
    return ALL_COLUMNS.map(c => {
      const isEnabled = defaultEnabled.has(c.key);
      return {
        key: c.key,
        defaultHeader: c.header,
        customHeader: '',
        enabled: isEnabled,
        selectionIndex: isEnabled ? selectionIdx++ : -1,
      };
    });
  });
  const [separator, setSeparator] = useState<',' | ';' | '\\t'>(',');
  const [timeFormat, setTimeFormat] = useState<'hhmm' | 'decimal'>('hhmm');
  const [exporting, setExporting] = useState(false);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);


  const toggleColumn = (key: string) => {
    setColumns(prev => {
      const col = prev.find(c => c.key === key);
      if (!col) return prev;

      if (col.enabled) {
        // Disabling: set selectionIndex to -1
        return prev.map(c => c.key === key ? { ...c, enabled: false, selectionIndex: -1 } : c);
      } else {
        // Enabling: get the highest current selectionIndex and add 1
        const maxIndex = prev.reduce((max, c) => (c.enabled ? Math.max(max, c.selectionIndex) : max), -1);
        return prev.map(c => c.key === key ? { ...c, enabled: true, selectionIndex: maxIndex + 1 } : c);
      }
    });
  };

  const updateHeader = (key: string, value: string) => {
    setColumns(prev => prev.map(c =>
      c.key === key ? { ...c, customHeader: value } : c
    ));
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    setColumns(prev => {
      const enabledBySelection = prev
        .filter(c => c.enabled)
        .sort((a, b) => a.selectionIndex - b.selectionIndex);

      const curIdx = enabledBySelection.findIndex(c => c.key === key);
      if (curIdx < 0) return prev;

      const newIdx = curIdx + dir;
      if (newIdx < 0 || newIdx >= enabledBySelection.length) return prev;

      const swapKey = enabledBySelection[newIdx].key;
      const curCol = prev.find(c => c.key === key)!;
      const swapCol = prev.find(c => c.key === swapKey)!;

      // Swap selectionIndex values
      return prev.map(c => {
        if (c.key === key) return { ...c, selectionIndex: swapCol.selectionIndex };
        if (c.key === swapKey) return { ...c, selectionIndex: curCol.selectionIndex };
        return c;
      });
    });
  };

  // Get columns by status
  const enabledColumns = columns.filter(c => c.enabled).sort((a, b) => a.selectionIndex - b.selectionIndex);
  const disabledColumns = columns.filter(c => !c.enabled);

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

  const selectAll = () => {
    setColumns(prev => {
      let selectionIdx = 0;
      return prev.map(c => ({
        ...c,
        enabled: true,
        selectionIndex: selectionIdx++,
      }));
    });
  };

  const selectNone = () => {
    setColumns(prev => prev.map(c => ({
      ...c,
      enabled: false,
      selectionIndex: -1,
    })));
  };

  const handleDragStart = (key: string) => {
    setDraggedKey(draggedKey === key ? null : key);
  };

  const handleMoveUp = (key: string) => {
    const enabled = columns.filter(c => c.enabled).sort((a, b) => a.selectionIndex - b.selectionIndex);
    const idx = enabled.findIndex(c => c.key === key);
    if (idx > 0) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      moveColumn(key, -1);
    }
  };

  const handleMoveDown = (key: string) => {
    const enabled = columns.filter(c => c.enabled).sort((a, b) => a.selectionIndex - b.selectionIndex);
    const idx = enabled.findIndex(c => c.key === key);
    if (idx < enabled.length - 1) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      moveColumn(key, 1);
    }
  };

  const handleEndDrag = () => {
    setDraggedKey(null);
  };

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

      {/* Column selection - Two column layout */}
      <View style={s.columnHeader}>
        <Text style={s.columnTitle}>{t('csv_columns')} ({enabledColumns.length}/{columns.length})</Text>
        <TouchableOpacity onPress={selectAll}>
          <Text style={s.linkText}>{t('select_all')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={selectNone}>
          <Text style={s.linkText}>{t('select_none')}</Text>
        </TouchableOpacity>
      </View>

      <View style={s.twoColumnContainer}>
        {/* Left column - Selected columns */}
        <View style={s.column}>
          <Text style={s.columnSectionTitle}>{t('csv_selected_order')}</Text>
          <View style={s.columnList}>
            {enabledColumns.length === 0 ? (
              <Text style={s.emptyText}>{t('csv_no_columns_selected')}</Text>
            ) : (
              enabledColumns.map((col, idx) => (
                <DraggableRow
                  key={col.key}
                  col={col}
                  idx={idx}
                  totalCount={enabledColumns.length}
                  isDragging={draggedKey === col.key}
                  onDragStart={() => handleDragStart(col.key)}
                  onMoveUp={() => handleMoveUp(col.key)}
                  onMoveDown={() => handleMoveDown(col.key)}
                  onToggleEdit={() => setEditingHeader(col.key)}
                  onEditingHeader={editingHeader === col.key}
                  onUpdateHeader={(value) => updateHeader(col.key, value)}
                  onRemove={() => {
                    toggleColumn(col.key);
                    handleEndDrag();
                  }}
                />
              ))
            )}
          </View>
        </View>

        {/* Right column - Available columns */}
        <View style={s.column}>
          <Text style={s.columnSectionTitle}>{t('csv_available')}</Text>
          <View style={s.columnList}>
            {disabledColumns.length === 0 ? (
              <Text style={s.emptyText}>{t('csv_all_selected')}</Text>
            ) : (
              disabledColumns.map((col) => (
                <TouchableOpacity
                  key={col.key}
                  style={s.availableColumnRow}
                  onPress={() => toggleColumn(col.key)}
                >
                  <Ionicons name="add-circle-outline" size={18} color={Colors.primary} style={{ marginRight: 8 }} />
                  <Text style={s.availableColumnName}>{col.defaultHeader}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>
      </View>

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

  twoColumnContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  column: {
    flex: 1,
  },
  columnSectionTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  columnList: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  selectedColumnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.cardBorder,
  },
  selectedColumnRowDragging: {
    backgroundColor: Colors.elevated,
    opacity: 0.9,
    borderBottomColor: Colors.primary,
    borderBottomWidth: 2,
  },
  availableColumnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.cardBorder,
  },
  columnName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  availableColumnName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '500', flex: 1 },
  columnOriginal: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },
  headerInput: {
    color: Colors.textPrimary, fontSize: 13, fontWeight: '600',
    backgroundColor: Colors.elevated, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary,
  },
  moveBtn: { padding: 6 },
  removeBtn: { marginLeft: 8, padding: 4 },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    padding: 12,
    textAlign: 'center',
  },

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
