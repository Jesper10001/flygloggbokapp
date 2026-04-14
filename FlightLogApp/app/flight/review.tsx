import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ocrScanLogbook } from '../../services/ocr';
import { insertFlight } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { validatePageTotals } from '../../utils/validation';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { formatTimeValue, parseTimeInput } from '../../hooks/useTimeFormat';
import type { OcrFlightResult } from '../../types/flight';
import type { TimeFormat } from '../../store/timeFormatStore';

type RowDecision = 'pending' | 'keep' | 'corrected' | 'skip';

interface ReviewRow {
  data: OcrFlightResult;
  original: OcrFlightResult;
  decision: RowDecision;
}

// ── Redigerbar rad för flaggade flygningar ────────────────────────────────────

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    content: { padding: 12, paddingBottom: 40, gap: 8 },

    header: {
      flexDirection: 'row', alignItems: 'center',
      padding: 14, backgroundColor: Colors.surface,
      borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 12,
    },
    headerTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    headerSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
    saveBtn: {
      backgroundColor: Colors.primary, borderRadius: 8,
      paddingHorizontal: 18, paddingVertical: 9, alignItems: 'center',
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },

    pageWarning: {
      flexDirection: 'row', gap: 6, alignItems: 'center',
      backgroundColor: Colors.warning + '18', padding: 10,
      borderBottomWidth: 1, borderBottomColor: Colors.warning + '44',
    },
    pageWarningText: { color: Colors.warning, fontSize: 12, flex: 1 },

    sectionLabel: {
      color: Colors.textMuted, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.8,
      marginTop: 4, marginBottom: 4, marginLeft: 2,
    },

    // Flaggad kort
    flagCard: {
      backgroundColor: Colors.card, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.danger + '66',
      overflow: 'hidden', marginBottom: 2,
    },
    cardSkipped: { borderColor: Colors.border, opacity: 0.5 },

    flagBanner: {
      flexDirection: 'row', gap: 6, alignItems: 'center',
      backgroundColor: Colors.danger + '18',
      paddingHorizontal: 12, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: Colors.danger + '33',
    },
    flagBannerText: { color: Colors.danger, fontSize: 12, flex: 1 },

    fields: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 4 },
    fieldRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.separator,
    },
    fieldLabel: { color: Colors.textMuted, fontSize: 11, width: 56 },
    fieldInput: {
      flex: 1, color: Colors.textPrimary, fontSize: 13,
      paddingVertical: 2, paddingHorizontal: 4,
    },
    fieldMono: { fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
    fieldChanged: { color: Colors.success },
    fieldOriginal: {
      color: Colors.textMuted, fontSize: 10,
      textDecorationLine: 'line-through', marginLeft: 4,
    },

    decisionRow: {
      flexDirection: 'row', gap: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      borderTopWidth: 1, borderTopColor: Colors.separator,
    },
    decisionBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 4, paddingVertical: 8, borderRadius: 7, borderWidth: 1,
    },
    btnOk: { borderColor: Colors.success + '66', backgroundColor: Colors.success + '14' },
    btnSkip: { borderColor: Colors.border, backgroundColor: Colors.elevated },
    decisionText: { fontSize: 13, fontWeight: '600' },

    compactRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
    },
    compactText: { color: Colors.textMuted, fontSize: 13, flex: 1 },
    undoText: { color: Colors.primary, fontSize: 12, fontWeight: '600' },

    // Godkänd lista
    okList: {
      backgroundColor: Colors.card, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    },
    okRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: Colors.separator,
    },
    okDate: { color: Colors.textMuted, fontSize: 11, width: 72 },
    okRoute: {
      flex: 1, color: Colors.textPrimary, fontSize: 12,
      fontWeight: '600', fontFamily: 'Menlo',
    },
    okType: { color: Colors.textMuted, fontSize: 11, width: 44 },
    okTime: {
      color: Colors.textSecondary, fontSize: 12,
      fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
    },
    okExpanded: {
      marginHorizontal: 0,
      borderTopWidth: 1, borderTopColor: Colors.separator,
    },

    scanningText: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
    scanningSubtext: { color: Colors.textSecondary, fontSize: 14 },
    errorTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
    errorText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
    retryBtn: {
      backgroundColor: Colors.card, borderRadius: 10,
      paddingHorizontal: 24, paddingVertical: 12, marginTop: 8,
      borderWidth: 1, borderColor: Colors.border,
    },
    retryBtnText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  });
}

function FlaggedCard({
  idx, row, onChange, onDecision, timeFormat,
}: {
  idx: number;
  row: ReviewRow;
  onChange: (key: keyof OcrFlightResult, val: string) => void;
  onDecision: (d: RowDecision) => void;
  timeFormat: TimeFormat;
}) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const skipped = row.decision === 'skip';

  if (skipped) {
    return (
      <View style={[styles.flagCard, styles.cardSkipped]}>
        <View style={styles.compactRow}>
          <Ionicons name="remove-circle-outline" size={16} color={Colors.textMuted} />
          <Text style={styles.compactText}>
            {row.data.dep_place} → {row.data.arr_place} · {row.data.date}
          </Text>
          <TouchableOpacity onPress={() => onDecision('pending')}>
            <Text style={styles.undoText}>{t('undo')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flagCard}>
      {/* Varning */}
      <View style={styles.flagBanner}>
        <Ionicons name="warning" size={14} color={Colors.danger} />
        <Text style={styles.flagBannerText} numberOfLines={2}>
          {row.data.review_reason ?? t('review_before_saving')}
        </Text>
      </View>

      {/* Redigerbara fält */}
      <View style={styles.fields}>
        <FieldRow label="Date"    value={row.data.date}         onChange={v => onChange('date', v)}         original={row.original.date} />
        <FieldRow label="Type"    value={row.data.aircraft_type} onChange={v => onChange('aircraft_type', v)} original={row.original.aircraft_type} />
        <FieldRow label="Reg"     value={row.data.registration}  onChange={v => onChange('registration', v)}  original={row.original.registration} />
        <FieldRow label="Dep"     value={row.data.dep_place}     onChange={v => onChange('dep_place', v.toUpperCase())} original={row.original.dep_place} mono />
        <FieldRow label="Dep.time" value={row.data.dep_utc}      onChange={v => onChange('dep_utc', v)}       original={row.original.dep_utc} mono />
        <FieldRow label="Arr"     value={row.data.arr_place}     onChange={v => onChange('arr_place', v.toUpperCase())} original={row.original.arr_place} mono />
        <FieldRow label="Arr.time" value={row.data.arr_utc}      onChange={v => onChange('arr_utc', v)}       original={row.original.arr_utc} mono />
        <FieldRow label="Total"   value={row.data.total_time}    onChange={v => onChange('total_time', v)}    original={row.original.total_time} num timeFormat={timeFormat} />
        <FieldRow label="PIC"     value={row.data.pic}           onChange={v => onChange('pic', v)}           original={row.original.pic} num timeFormat={timeFormat} />
        <FieldRow label="IFR"     value={row.data.ifr}           onChange={v => onChange('ifr', v)}           original={row.original.ifr} num timeFormat={timeFormat} />
        <FieldRow label="Night"   value={row.data.night}         onChange={v => onChange('night', v)}         original={row.original.night} num timeFormat={timeFormat} />
        {row.data.remarks ? (
          <FieldRow label="Rmk."  value={row.data.remarks}       onChange={v => onChange('remarks', v)}       original={row.original.remarks} />
        ) : null}
      </View>

      {/* Knappar */}
      <View style={styles.decisionRow}>
        <TouchableOpacity style={[styles.decisionBtn, styles.btnOk]} onPress={() => onDecision('corrected')}>
          <Ionicons name="checkmark" size={14} color={Colors.success} />
          <Text style={[styles.decisionText, { color: Colors.success }]}>{t('approve')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.decisionBtn, styles.btnSkip]} onPress={() => onDecision('skip')}>
          <Ionicons name="close" size={14} color={Colors.textMuted} />
          <Text style={[styles.decisionText, { color: Colors.textMuted }]}>{t('skip')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Kompakt rad för godkända flygningar ───────────────────────────────────────

function OkRow({ row, onExpand, timeFormat }: { row: ReviewRow; onExpand: () => void; timeFormat: TimeFormat }) {
  const styles = makeStyles();
  const h = parseFloat(row.data.total_time) || 0;
  const timeStr = formatTimeValue(h, timeFormat);

  return (
    <TouchableOpacity style={styles.okRow} onPress={onExpand} activeOpacity={0.7}>
      <Ionicons name="checkmark-circle" size={15} color={Colors.success} />
      <Text style={styles.okDate}>{row.data.date}</Text>
      <Text style={styles.okRoute}>
        {row.data.dep_place || '—'} → {row.data.arr_place || '—'}
      </Text>
      <Text style={styles.okType}>{row.data.aircraft_type}</Text>
      <Text style={styles.okTime}>{timeStr}</Text>
    </TouchableOpacity>
  );
}

function FieldRow({
  label, value, onChange, mono, num, original, timeFormat,
}: {
  label: string; value: string; onChange: (v: string) => void;
  mono?: boolean; num?: boolean; original?: string; timeFormat?: TimeFormat;
}) {
  const styles = makeStyles();
  const changed = original !== undefined && value !== original;
  // For numeric time fields: display in user's format, store raw input
  const displayValue = (num && timeFormat && value)
    ? formatTimeValue(parseFloat(value) || 0, timeFormat)
    : value;
  const originalDisplay = (num && timeFormat && original)
    ? formatTimeValue(parseFloat(original) || 0, timeFormat)
    : original;

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, (mono || num) && styles.fieldMono, changed && styles.fieldChanged]}
        value={displayValue}
        onChangeText={(v) => {
          if (num && timeFormat) {
            // Convert to decimal on change, store as decimal string
            const parsed = parseTimeInput(v, timeFormat);
            onChange(parsed !== null ? String(parsed) : v);
          } else {
            onChange(v);
          }
        }}
        autoCapitalize={mono ? 'characters' : 'none'}
        keyboardType={num
          ? (timeFormat === 'hhmm' ? 'numbers-and-punctuation' : 'decimal-pad')
          : 'default'}
      />
      {changed && originalDisplay ? (
        <Text style={styles.fieldOriginal}>{originalDisplay}</Text>
      ) : null}
    </View>
  );
}

// ── Huvud ─────────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { loadFlights, loadStats, canAddFlight } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();

  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [pageWarning, setPageWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedOk, setExpandedOk] = useState<Set<number>>(new Set());

  useEffect(() => {
    ocrScanLogbook(timeFormat)
      .then(({ flights, pageTotals: pt }) => {
        setRows(flights.map((f) => ({
          data: { ...f },
          original: { ...f },
          decision: f.needs_review ? 'pending' : 'keep',
        })));

        if (pt.brought_forward !== null && pt.total_this_page !== null && pt.total_to_date !== null) {
          const issue = validatePageTotals({
            broughtForward: pt.brought_forward,
            totalThisPage: pt.total_this_page,
            totalToDate: pt.total_to_date,
          });
          if (issue) setPageWarning(issue.message);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setScanning(false));
  }, []);

  const updateField = (idx: number, key: keyof OcrFlightResult, val: string) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], data: { ...copy[idx].data, [key]: val }, decision: 'corrected' };
      return copy;
    });
  };

  const setDecision = (idx: number, decision: RowDecision) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], decision };
      return copy;
    });
  };

  const toggleExpand = (idx: number) => {
    setExpandedOk((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const saveAll = async () => {
    if (!canAddFlight()) {
      Alert.alert(t('limit_reached'), t('limit_reached_upgrade'));
      return;
    }
    const pendingLeft = rows.filter(r => r.decision === 'pending').length;
    if (pendingLeft > 0) {
      Alert.alert(
        t('incomplete_review'),
        `${pendingLeft} ${pendingLeft > 1 ? t('rows_not_reviewed') : t('row_not_reviewed')}`,
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('save_anyway'), onPress: () => doSave() },
        ]
      );
      return;
    }
    doSave();
  };

  const doSave = async () => {
    setSaving(true);
    let saved = 0, skipped = 0;
    try {
      for (const row of rows) {
        if (row.decision === 'skip') { skipped++; continue; }
        await insertFlight(row.data, { source: 'ocr', originalData: JSON.stringify(row.original) });
        saved++;
      }
      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert(
        t('done_exclamation'),
        `${saved} ${t('flights_saved')}${skipped > 0 ? ` ${skipped} ${t('skipped')}` : ''}`,
        [{ text: 'OK', onPress: () => router.dismissAll() }]
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Laddning ──

  if (scanning) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.scanningText}>{t('analysing_with_claude')}</Text>
        <Text style={styles.scanningSubtext}>{t('ten_to_thirty_seconds')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle" size={48} color={Colors.danger} />
        <Text style={styles.errorTitle}>{t('scan_failed')}</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
          <Text style={styles.retryBtnText}>{t('go_back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const flagged = rows.filter(r => (r.data.needs_review && r.decision === 'pending') || r.decision === 'skip');
  const ok      = rows.filter(r => !r.data.needs_review || r.decision === 'corrected' || r.decision === 'keep');
  const toSave  = rows.filter(r => r.decision !== 'skip').length;
  const pendingLeft = rows.filter(r => r.decision === 'pending').length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{rows.length} {t('rows_imported')}</Text>
          <Text style={styles.headerSub}>
            {pendingLeft > 0
              ? `${pendingLeft} ${t('requires_review')}`
              : t('all_rows_approved')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, (saving || rows.length === 0) && { opacity: 0.5 }]}
          onPress={saveAll}
          disabled={saving || rows.length === 0}
        >
          {saving
            ? <ActivityIndicator color={Colors.textInverse} size="small" />
            : <Text style={styles.saveBtnText}>{t('save')} {toSave}</Text>}
        </TouchableOpacity>
      </View>

      {/* Sidvarning */}
      {pageWarning && (
        <View style={styles.pageWarning}>
          <Ionicons name="warning" size={14} color={Colors.warning} />
          <Text style={styles.pageWarningText}>{pageWarning}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >

        {/* ── Flaggade / hoppa-över ── */}
        {flagged.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>
              <Ionicons name="warning" size={11} color={Colors.danger} /> {t('requires_review_label')} ({flagged.length})
            </Text>
            {flagged.map((row) => {
              const idx = rows.indexOf(row);
              return (
                <FlaggedCard
                  key={idx}
                  idx={idx}
                  row={row}
                  onChange={(key, val) => updateField(idx, key, val)}
                  onDecision={(d) => setDecision(idx, d)}
                  timeFormat={timeFormat}
                />
              );
            })}
          </>
        )}

        {/* ── Godkända ── */}
        {ok.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>
              <Ionicons name="checkmark-circle" size={11} color={Colors.success} /> {t('approved_label')} ({ok.length})
            </Text>
            <View style={styles.okList}>
              {ok.map((row) => {
                const idx = rows.indexOf(row);
                const expanded = expandedOk.has(idx);
                return (
                  <View key={idx}>
                    <OkRow row={row} onExpand={() => toggleExpand(idx)} timeFormat={timeFormat} />
                    {expanded && (
                      <View style={styles.okExpanded}>
                        <FlaggedCard
                          idx={idx}
                          row={row}
                          onChange={(key, val) => updateField(idx, key, val)}
                          onDecision={(d) => setDecision(idx, d)}
                          timeFormat={timeFormat}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
