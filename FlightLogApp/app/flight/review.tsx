import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal, Pressable, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ocrScanLogbook, type AircraftDetection } from '../../services/ocr';
import { insertFlight, getAllAircraftTypes, addAircraftTypeToRegistry } from '../../db/flights';
import { lookupAircraft } from '../../services/aircraftLookup';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { validatePageTotals } from '../../utils/validation';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { formatTimeValue, parseTimeInput } from '../../hooks/useTimeFormat';
import { IcaoInput } from '../../components/IcaoInput';
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
  idx, row, onChange, onDecision, timeFormat, savedAircraftTypes,
}: {
  idx: number;
  row: ReviewRow;
  onChange: (key: keyof OcrFlightResult, val: any) => void;
  onDecision: (d: RowDecision) => void;
  timeFormat: TimeFormat;
  savedAircraftTypes: string[];
}) {
  // Om AI har angett field_issues — visa ENDAST dessa fält som default.
  // Toggle för att expandera till alla fält.
  const issueFields = new Set((row.data.field_issues ?? []).map((i) => i.field));
  const [showAll, setShowAll] = useState(issueFields.size === 0);
  const shouldShow = (name: string) => showAll || issueFields.has(name);
  const hasIssues = issueFields.size > 0;
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
      {/* Rad-referens: Rad N · datum */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 12, paddingVertical: 6,
        backgroundColor: Colors.elevated,
        borderTopLeftRadius: 12, borderTopRightRadius: 12,
        borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
      }}>
        <Ionicons name="list" size={11} color={Colors.textMuted} />
        <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>
          Rad {idx + 1}
        </Text>
        {row.data.date ? (
          <>
            <Text style={{ color: Colors.textMuted, fontSize: 11 }}>·</Text>
            <Text style={{ color: Colors.textPrimary, fontSize: 11, fontFamily: 'Menlo', fontWeight: '600' }}>
              {row.data.date}
            </Text>
          </>
        ) : null}
        {row.data.dep_place && row.data.arr_place ? (
          <>
            <Text style={{ color: Colors.textMuted, fontSize: 11 }}>·</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 11, fontFamily: 'Menlo' }}>
              {row.data.dep_place} → {row.data.arr_place}
            </Text>
          </>
        ) : null}
      </View>

      {/* Varning */}
      <View style={styles.flagBanner}>
        <Ionicons name="warning" size={14} color={Colors.danger} />
        <Text style={styles.flagBannerText} numberOfLines={2}>
          {row.data.review_reason ?? t('review_before_saving')}
        </Text>
      </View>

      {/* Issue-banner + toggle */}
      {hasIssues && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4,
          backgroundColor: Colors.warning + '14',
          borderRadius: 8, borderWidth: 0.5, borderColor: Colors.warning + '66',
        }}>
          <Ionicons name="alert-circle" size={13} color={Colors.warning} />
          <Text style={{ color: Colors.warning, fontSize: 11, fontWeight: '700', flex: 1 }}>
            {issueFields.size} {issueFields.size === 1 ? 'fält behöver granskas' : 'fält behöver granskas'}
          </Text>
          <TouchableOpacity
            onPress={() => setShowAll((v) => !v)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 3,
              paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
              backgroundColor: Colors.elevated, borderWidth: 0.5, borderColor: Colors.border,
            }}
          >
            <Ionicons name={showAll ? 'chevron-up' : 'chevron-down'} size={11} color={Colors.textSecondary} />
            <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700' }}>
              {showAll ? 'Göm övriga' : 'Visa alla fält'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Redigerbara fält */}
      <View style={styles.fields}>
        {/* Grunddata */}
        {shouldShow('date') && <FieldRowDate     value={row.data.date}           onChange={v => onChange('date', v)}           original={row.original.date} />}
        {shouldShow('aircraft_type') && <FieldRowAircraft value={row.data.aircraft_type}  savedTypes={savedAircraftTypes} onChange={v => onChange('aircraft_type', v)} original={row.original.aircraft_type} />}
        {shouldShow('registration') && <FieldRow label="Reg"       value={row.data.registration}  onChange={v => onChange('registration', v.toUpperCase())} original={row.original.registration} mono />}

        {/* Rutt */}
        {shouldShow('dep_place') && <FieldRowIcao label="Dep"   value={row.data.dep_place}     onChange={v => onChange('dep_place', v.toUpperCase())} original={row.original.dep_place} />}
        {(shouldShow('dep_utc') || row.data.time_mismatch) && <FieldRowClock
          label="Dep·T"
          value={row.data.dep_utc}
          onChange={v => onChange('dep_utc', v)}
          original={row.original.dep_utc}
          mismatch={row.data.time_mismatch ? {
            correctArr: row.data.time_mismatch.computed_arr_if_dep_correct,
            side: 'dep',
          } : undefined}
          onAcceptAsCorrect={() => {
            if (!row.data.time_mismatch) return;
            onChange('arr_utc', row.data.time_mismatch.computed_arr_if_dep_correct);
            onChange('time_mismatch' as any, null as any);
          }}
        />}
        {shouldShow('arr_place') && <FieldRowIcao label="Arr"   value={row.data.arr_place}     onChange={v => onChange('arr_place', v.toUpperCase())} original={row.original.arr_place} />}
        {(shouldShow('arr_utc') || row.data.time_mismatch) && <FieldRowClock
          label="Arr·T"
          value={row.data.arr_utc}
          onChange={v => onChange('arr_utc', v)}
          original={row.original.arr_utc}
          mismatch={row.data.time_mismatch ? {
            correctArr: row.data.time_mismatch.computed_dep_if_arr_correct,
            side: 'arr',
          } : undefined}
          onAcceptAsCorrect={() => {
            if (!row.data.time_mismatch) return;
            onChange('dep_utc', row.data.time_mismatch.computed_dep_if_arr_correct);
            onChange('time_mismatch' as any, null as any);
          }}
        />}
        {row.data.time_mismatch && (
          <View style={{
            backgroundColor: Colors.warning + '14', borderColor: Colors.warning + '66',
            borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 4,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="warning" size={12} color={Colors.warning} />
              <Text style={{ color: Colors.warning, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>
                Tid stämmer inte ({row.data.time_mismatch.anchor_total_h.toFixed(1)}h)
              </Text>
            </View>
            <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 4 }}>
              Klicka ✓ bredvid den tid som är korrekt — den andra justeras automatiskt.
            </Text>
          </View>
        )}

        {/* Tider (duration — endast valt format visas, ingen alternativ) */}
        {shouldShow('total_time') && <FieldRowDur label="Total"    value={row.data.total_time} onChange={v => onChange('total_time', v)} original={row.original.total_time} timeFormat={timeFormat} primary />}
        {(() => { const cap = parseFloat(row.data.total_time) || 0; return <>
          {shouldShow('pic') && <FieldRowDur label="PIC"      value={row.data.pic}        onChange={v => onChange('pic', v)}        original={row.original.pic} timeFormat={timeFormat} capTo={cap} />}
          {shouldShow('co_pilot') && <FieldRowDur label="Co-Pilot" value={row.data.co_pilot}   onChange={v => onChange('co_pilot', v)}   original={row.original.co_pilot} timeFormat={timeFormat} capTo={cap} />}
          {shouldShow('dual') && <FieldRowDur label="Dual"     value={row.data.dual}       onChange={v => onChange('dual', v)}       original={row.original.dual} timeFormat={timeFormat} capTo={cap} />}
          {shouldShow('ifr') && <FieldRowDur label="IFR"      value={row.data.ifr}        onChange={v => onChange('ifr', v)}        original={row.original.ifr} timeFormat={timeFormat} capTo={cap} />}
          {shouldShow('night') && <FieldRowDur label="Night"    value={row.data.night}      onChange={v => onChange('night', v)}      original={row.original.night} timeFormat={timeFormat} capTo={cap} />}
        </>; })()}

        {/* Landningar */}
        {shouldShow('landings_day') && <FieldRowInt label="Ldg Day"   value={row.data.landings_day ?? '0'}   onChange={v => onChange('landings_day', v)}   original={row.original.landings_day} />}
        {shouldShow('landings_night') && <FieldRowInt label="Ldg Night" value={row.data.landings_night ?? '0'} onChange={v => onChange('landings_night', v)} original={row.original.landings_night} />}

        {/* Remarks med AI-förslag */}
        {(row.data.remarks_suggestion || shouldShow('remarks')) && (
          <>
            {row.data.remarks_suggestion && (
              <RemarksSuggestion
                suggestion={row.data.remarks_suggestion}
                onAccept={() => {
                  const s = row.data.remarks_suggestion!;
                  onChange(s.field as keyof OcrFlightResult, s.value);
                  const cleaned = (row.data.remarks ?? '').replace(s.original_text, '').replace(/\s{2,}/g, ' ').trim();
                  onChange('remarks', cleaned);
                  onChange('remarks_suggestion' as any, null as any);
                }}
                onReject={() => onChange('remarks_suggestion' as any, null as any)}
              />
            )}
            <FieldRow label="Rmk."    value={row.data.remarks ?? ''} onChange={v => onChange('remarks', v)} original={row.original.remarks} />
          </>
        )}

        {/* Avancerade fält — endast när "Visa alla fält" är på */}
        {showAll && <AdvancedFields row={row} onChange={onChange} timeFormat={timeFormat} />}
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
  const fastTrack = (row.data.overall_confidence ?? 0) >= 0.95 && (row.data.field_issues ?? []).length === 0;

  return (
    <TouchableOpacity style={styles.okRow} onPress={onExpand} activeOpacity={0.7}>
      <Ionicons name={fastTrack ? 'flash' : 'checkmark-circle'} size={15} color={fastTrack ? Colors.primary : Colors.success} />
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

// ── Klocktid (UTC) — auto-formatera HH:MM medan man skriver ─────────────────

function FieldRowClock({ label, value, onChange, original, mismatch, onAcceptAsCorrect }: {
  label: string; value: string; onChange: (v: string) => void; original?: string;
  mismatch?: { correctArr: string; side: 'dep' | 'arr' };
  onAcceptAsCorrect?: () => void;
}) {
  const styles = makeStyles();
  const changed = original !== undefined && value !== original;
  const handle = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) onChange('');
    else if (digits.length <= 2) onChange(digits);
    else onChange(`${digits.slice(0, 2)}:${digits.slice(2)}`);
  };
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, styles.fieldMono, changed && styles.fieldChanged, mismatch && { flex: 0, width: 90 }]}
        value={value}
        onChangeText={handle}
        keyboardType="number-pad"
        maxLength={5}
        placeholder="HH:MM"
        placeholderTextColor={Colors.textMuted}
      />
      {mismatch && onAcceptAsCorrect && (
        <TouchableOpacity
          onPress={onAcceptAsCorrect}
          activeOpacity={0.75}
          style={{
            marginLeft: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6,
            backgroundColor: Colors.success + '1F', borderWidth: 0.5, borderColor: Colors.success + '88',
            flexDirection: 'row', alignItems: 'center', gap: 4,
          }}
        >
          <Ionicons name="checkmark" size={13} color={Colors.success} />
          <Text style={{ color: Colors.success, fontSize: 10, fontWeight: '700' }}>Rätt</Text>
        </TouchableOpacity>
      )}
      {changed && original ? <Text style={styles.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Duration-fält med alternativ tidsformat-caption ─────────────────────────

function FieldRowDur({ label, value, onChange, original, timeFormat, showAlt = false, primary = false, capTo }: {
  label: string; value: string; onChange: (v: string) => void; original?: string; timeFormat: TimeFormat; showAlt?: boolean; primary?: boolean;
  // Om värdet > capTo visas en "≤ Total"-knapp som klampar värdet till capTo.
  // Ingen tidkolumn (utom total) får någonsin vara > total flygtid.
  capTo?: number;
}) {
  const styles = makeStyles();
  const changed = original !== undefined && value !== original;

  // Visa alltid i användarens valda format. Decimal = 1 decimal (inte två).
  const d = parseFloat(value) || 0;
  const displayValue = !value
    ? ''
    : timeFormat === 'decimal'
      ? (d === 0 ? '' : d.toFixed(1))
      : formatTimeValue(d, 'hhmm');

  // Alternativ format — visas om showAlt eller primary=true (för Total)
  const alt = (!showAlt && !primary) ? '' : (() => {
    if (!d) return '';
    if (timeFormat === 'decimal') {
      const h = Math.floor(d);
      const m = Math.round((d - h) * 60);
      return `${h}:${String(m).padStart(2, '0')}`;
    }
    return d.toFixed(1);
  })();

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, styles.fieldMono, changed && styles.fieldChanged, { flex: 0, width: 90 }]}
        value={displayValue}
        onChangeText={(v) => {
          const parsed = parseTimeInput(v, timeFormat);
          onChange(parsed !== null ? String(parsed) : v);
        }}
        keyboardType={timeFormat === 'hhmm' ? 'numbers-and-punctuation' : 'decimal-pad'}
        placeholder={timeFormat === 'hhmm' ? '0:00' : '0.0'}
        placeholderTextColor={Colors.textMuted}
      />
      {alt ? (
        <Text style={{ color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo', marginLeft: 6, minWidth: 48 }}>
          {primary ? `(${alt})` : `= ${alt}`}
        </Text>
      ) : null}
      {capTo !== undefined && d > capTo + 0.01 && (
        <TouchableOpacity
          onPress={() => onChange(String(capTo))}
          activeOpacity={0.75}
          style={{
            marginLeft: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6,
            backgroundColor: Colors.warning + '1F', borderWidth: 0.5, borderColor: Colors.warning + '88',
            flexDirection: 'row', alignItems: 'center', gap: 3,
          }}
        >
          <Ionicons name="arrow-down" size={11} color={Colors.warning} />
          <Text style={{ color: Colors.warning, fontSize: 10, fontWeight: '800' }}>= Total</Text>
        </TouchableOpacity>
      )}
      {changed && original ? <Text style={styles.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Heltals-fält (landningar m.m.) ─────────────────────────────────────────

function FieldRowInt({ label, value, onChange, original }: {
  label: string; value: string; onChange: (v: string) => void; original?: string;
}) {
  const styles = makeStyles();
  const changed = original !== undefined && value !== original;
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, styles.fieldMono, changed && styles.fieldChanged, { flex: 0, width: 80, textAlign: 'center' as const }]}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="0"
        placeholderTextColor={Colors.textMuted}
      />
      {changed && original ? <Text style={styles.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Remarks-förslag från AI ────────────────────────────────────────────────

function RemarksSuggestion({
  suggestion, onAccept, onReject,
}: {
  suggestion: { field: string; value: string; original_text: string; confidence: number; reason: string };
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <View style={{
      backgroundColor: Colors.primary + '14', borderColor: Colors.primary + '66',
      borderWidth: 1, borderRadius: 10, padding: 10, gap: 8, marginVertical: 4,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="sparkles" size={13} color={Colors.primary} />
        <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>
          AI förslag
        </Text>
      </View>
      <Text style={{ color: Colors.textPrimary, fontSize: 12 }}>
        "{suggestion.original_text}" → <Text style={{ fontWeight: '800' }}>{suggestion.field}</Text>? ({Math.round(suggestion.confidence * 100)}%)
      </Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{suggestion.reason}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 8,
            backgroundColor: Colors.primary, alignItems: 'center',
          }}
          onPress={onAccept}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textInverse, fontSize: 12, fontWeight: '800' }}>Ja</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 8,
            backgroundColor: Colors.elevated, alignItems: 'center',
            borderWidth: 0.5, borderColor: Colors.border,
          }}
          onPress={onReject}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '700' }}>Nej</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Avancerade fält — collapsible ─────────────────────────────────────────

function AdvancedFields({ row, onChange, timeFormat }: {
  row: ReviewRow;
  onChange: (key: keyof OcrFlightResult, val: any) => void;
  timeFormat: TimeFormat;
}) {
  const styles = makeStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: 6 }}>
      <TouchableOpacity
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: Colors.separator,
        }}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={Colors.textMuted} />
        <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Advanced fields
        </Text>
      </TouchableOpacity>
      {open && (() => { const cap = parseFloat(row.data.total_time) || 0; return (
        <View style={styles.fields}>
          <FieldRowDur label="Multi-pilot"  value={row.data.multi_pilot ?? ''}  onChange={v => onChange('multi_pilot', v)}  original={row.original.multi_pilot}  timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="Single-pilot" value={row.data.single_pilot ?? ''} onChange={v => onChange('single_pilot', v)} original={row.original.single_pilot} timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="Instructor"   value={row.data.instructor ?? ''}   onChange={v => onChange('instructor', v)}   original={row.original.instructor}   timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="PICUS"        value={row.data.picus ?? ''}        onChange={v => onChange('picus', v)}        original={row.original.picus}        timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="SPIC"         value={row.data.spic ?? ''}         onChange={v => onChange('spic', v)}         original={row.original.spic}         timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="Examiner"     value={row.data.examiner ?? ''}     onChange={v => onChange('examiner', v)}     original={row.original.examiner}     timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="Safety Pilot" value={row.data.safety_pilot ?? ''} onChange={v => onChange('safety_pilot', v)} original={row.original.safety_pilot} timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="NVG"          value={row.data.nvg ?? ''}          onChange={v => onChange('nvg', v)}          original={row.original.nvg}          timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="SE time"      value={(row.data as any).se_time ?? ''}      onChange={v => onChange('se_time' as any, v)} original={(row.original as any).se_time} timeFormat={timeFormat} capTo={cap} />
          <FieldRowDur label="ME time"      value={(row.data as any).me_time ?? ''}      onChange={v => onChange('me_time' as any, v)} original={(row.original as any).me_time} timeFormat={timeFormat} capTo={cap} />
          <FieldRowInt label="TNG count"    value={row.data.tng_count ?? '0'}   onChange={v => onChange('tng_count', v)}   original={row.original.tng_count} />
          <FieldRow    label="2nd pilot"    value={row.data.second_pilot ?? ''} onChange={v => onChange('second_pilot', v)} original={row.original.second_pilot} mono />
          <FieldRow    label="Stop place"   value={row.data.stop_place ?? ''}   onChange={v => onChange('stop_place', v.toUpperCase())} original={row.original.stop_place} mono />
        </View>
      ); })()}
    </View>
  );
}

// ── Aircraft-bekräftelse innan review ─────────────────────────────────────

interface AircraftForm {
  type: string;
  reg: string;
  speed: string;
  endurance: string;
  crewTypes: Set<'sp' | 'mp'>;
  engineType: 'se' | 'me' | '';
  category: 'airplane' | 'helicopter' | '';
  aiFilled: Set<string>;
  loading: boolean;
}

function AircraftConfirmation({
  detections, savedTypes, onConfirm,
}: {
  detections: AircraftDetection[];
  savedTypes: string[];
  onConfirm: (corrections: { as_written: string; new_type: string; new_registration: string }[]) => void;
}) {
  const { t } = useTranslation();
  const [forms, setForms] = useState<Record<string, AircraftForm>>(() => {
    const init: Record<string, AircraftForm> = {};
    detections.forEach((d) => {
      init[d.as_written] = {
        type: d.resolved,
        reg: d.registration,
        speed: '',
        endurance: '',
        crewTypes: new Set(),
        engineType: '',
        category: '',
        aiFilled: new Set(),
        loading: true,
      };
    });
    return init;
  });

  // Auto-lookup via AI när skärmen öppnas
  useEffect(() => {
    detections.forEach(async (d) => {
      try {
        const r = await lookupAircraft(d.resolved || d.as_written);
        setForms((prev) => {
          const curr = prev[d.as_written];
          if (!curr) return prev;
          if (r.needs_manual || !r.aircraft_type) return { ...prev, [d.as_written]: { ...curr, loading: false } };
          const filled = new Set<string>();
          const next = { ...curr, loading: false };
          if (!curr.speed && r.cruise_speed_kts > 0) { next.speed = String(r.cruise_speed_kts); filled.add('speed'); }
          if (!curr.endurance && r.endurance_h > 0) { next.endurance = String(r.endurance_h); filled.add('endurance'); }
          if (curr.crewTypes.size === 0 && r.crew_type) {
            const keys = r.crew_type.split(',').filter((k) => k === 'sp' || k === 'mp') as ('sp' | 'mp')[];
            if (keys.length) { next.crewTypes = new Set(keys); filled.add('crew'); }
          }
          if (!curr.engineType && r.engine_type) { next.engineType = r.engine_type; filled.add('engine'); }
          if (!curr.category && r.category) { next.category = r.category; filled.add('category'); }
          next.aiFilled = filled;
          return { ...prev, [d.as_written]: next };
        });
      } catch {
        setForms((prev) => ({ ...prev, [d.as_written]: { ...prev[d.as_written], loading: false } }));
      }
    });
  }, [detections]);

  const updateForm = (key: string, patch: Partial<AircraftForm>) => {
    setForms((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const toggleCrew = (key: string, which: 'sp' | 'mp') => {
    setForms((prev) => {
      const curr = prev[key]; if (!curr) return prev;
      const next = new Set(curr.crewTypes);
      if (next.has(which)) next.delete(which); else next.add(which);
      const aiFilled = new Set(curr.aiFilled); aiFilled.delete('crew');
      return { ...prev, [key]: { ...curr, crewTypes: next, aiFilled } };
    });
  };

  const apply = async () => {
    // Spara varje luftfartyg till registret
    for (const d of detections) {
      const f = forms[d.as_written]; if (!f) continue;
      const typeUpper = f.type.trim().toUpperCase();
      if (!typeUpper) continue;
      await addAircraftTypeToRegistry(
        typeUpper,
        parseInt(f.speed) || 0,
        parseFloat(f.endurance.replace(',', '.')) || 0,
        Array.from(f.crewTypes).sort().join(','),
        f.category,
        f.engineType,
      );
    }
    onConfirm(detections.map((d) => ({
      as_written: d.as_written,
      new_type: (forms[d.as_written]?.type ?? d.resolved).toUpperCase(),
      new_registration: (forms[d.as_written]?.reg ?? d.registration).toUpperCase(),
    })));
  };

  const aiBtn = { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' } as const;
  const aiInput = { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' } as const;

  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }}>
      <Text style={{ color: Colors.textSecondary, fontSize: 12, lineHeight: 17, paddingHorizontal: 2 }}>
        AI har identifierat {detections.length} {detections.length === 1 ? 'luftfartyg' : 'luftfartyg'} på sidan. Rättar du något här uppdateras ALLA rader med samma handstilsform automatiskt — och fartyget sparas under Sparade luftfartyg.
      </Text>

      {detections.map((d) => {
        const f = forms[d.as_written];
        if (!f) return null;
        const filteredSaved = savedTypes
          .filter((tp) => tp.toUpperCase().startsWith(f.type.toUpperCase()) && tp.toUpperCase() !== f.type.toUpperCase())
          .slice(0, 4);
        const aiActive = (k: string) => f.aiFilled.has(k);
        return (
          <View key={d.as_written} style={{
            backgroundColor: Colors.card, borderRadius: 14, padding: 14,
            borderWidth: 0.5, borderColor: Colors.cardBorder, gap: 10,
          }}>
            {/* Header "Flygplansdata" + AI-badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="speedometer-outline" size={16} color={Colors.gold} />
              <Text style={{ color: Colors.gold, fontSize: 15, fontWeight: '800' }}>
                Flygplansdata
              </Text>
              <View style={{ flex: 1 }} />
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
                backgroundColor: Colors.primary + '1F',
                borderWidth: 0.5, borderColor: Colors.primary + '66',
              }}>
                {f.loading
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <Ionicons name="sparkles" size={10} color={Colors.primary} />}
                <Text style={{ color: Colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>
                  {f.loading ? 'Hämtar…' : 'Autogenererat med AI'}
                </Text>
              </View>
            </View>

            {/* Upptäckt-rad: piloten skrev X på rad Y */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={{ color: Colors.textMuted, fontSize: 11 }}>Piloten skrev</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: 12, fontFamily: 'Menlo', fontWeight: '700' }}>
                "{d.as_written}"
              </Text>
              <Text style={{ color: Colors.textMuted, fontSize: 11 }}>
                · Först rad {d.first_row} · {d.rows.length} {d.rows.length === 1 ? 'rad' : 'rader'}
              </Text>
            </View>

            {/* Grid: Type / Speed / Endurance */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 2 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Type</Text>
                <TextInput
                  style={{
                    backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                    color: Colors.textPrimary, fontSize: 15, fontFamily: 'Menlo', fontWeight: '800',
                    paddingHorizontal: 10, paddingVertical: 10, textAlign: 'center',
                  }}
                  value={f.type}
                  onChangeText={(v) => updateForm(d.as_written, { type: v.toUpperCase() })}
                  autoCapitalize="characters"
                  placeholder="R44, A320…"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Speed (kts)</Text>
                <TextInput
                  style={[{
                    backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                    color: Colors.textPrimary, fontSize: 15, fontFamily: 'Menlo', fontWeight: '800',
                    paddingHorizontal: 10, paddingVertical: 10, textAlign: 'center',
                  }, aiActive('speed') && aiInput]}
                  value={f.speed}
                  onChangeText={(v) => updateForm(d.as_written, { speed: v.replace(/\D/g, ''), aiFilled: (() => { const s = new Set(f.aiFilled); s.delete('speed'); return s; })() })}
                  keyboardType="number-pad"
                  placeholder="110"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Endur. (h)</Text>
                <TextInput
                  style={[{
                    backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                    color: Colors.textPrimary, fontSize: 15, fontFamily: 'Menlo', fontWeight: '800',
                    paddingHorizontal: 10, paddingVertical: 10, textAlign: 'center',
                  }, aiActive('endurance') && aiInput]}
                  value={f.endurance}
                  onChangeText={(v) => updateForm(d.as_written, { endurance: v, aiFilled: (() => { const s = new Set(f.aiFilled); s.delete('endurance'); return s; })() })}
                  keyboardType="decimal-pad"
                  placeholder="3.0"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            </View>

            {/* Förslag på sparade typer */}
            {filteredSaved.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {filteredSaved.map((tp) => (
                  <TouchableOpacity
                    key={tp}
                    onPress={() => updateForm(d.as_written, { type: tp.toUpperCase() })}
                    activeOpacity={0.7}
                    style={{
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5,
                      backgroundColor: Colors.primary + '1F',
                      borderWidth: 0.5, borderColor: Colors.primary + '66',
                    }}
                  >
                    <Text style={{ color: Colors.primary, fontSize: 10, fontWeight: '700', fontFamily: 'Menlo' }}>{tp}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Registration */}
            <View>
              <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Registrering</Text>
              <TextInput
                style={{
                  backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                  color: Colors.textPrimary, fontSize: 14, fontFamily: 'Menlo', fontWeight: '700',
                  paddingHorizontal: 10, paddingVertical: 9,
                }}
                value={f.reg}
                onChangeText={(v) => updateForm(d.as_written, { reg: v.toUpperCase() })}
                autoCapitalize="characters"
                placeholder="SE-XXX"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            {/* SP / MP / SE / ME */}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['sp', 'mp'] as const).map((k) => {
                const active = f.crewTypes.has(k);
                const ai = aiActive('crew') && active;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => toggleCrew(d.as_written, k)}
                    activeOpacity={0.75}
                    style={[{
                      flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center',
                      backgroundColor: active ? Colors.primary + '1A' : Colors.elevated,
                      borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                    }, ai && aiBtn]}
                  >
                    <Text style={{ color: active ? Colors.primary : Colors.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>
                      {k.toUpperCase()}
                    </Text>
                    <Text style={{ color: Colors.textMuted, fontSize: 10 }}>
                      {k === 'sp' ? 'Single pilot' : 'Multi-pilot'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {(['se', 'me'] as const).map((k) => {
                const active = f.engineType === k;
                const ai = aiActive('engine') && active;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => { updateForm(d.as_written, { engineType: active ? '' : k, aiFilled: (() => { const s = new Set(f.aiFilled); s.delete('engine'); return s; })() }); }}
                    activeOpacity={0.75}
                    style={[{
                      flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center',
                      backgroundColor: active ? Colors.primary + '1A' : Colors.elevated,
                      borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                    }, ai && aiBtn]}
                  >
                    <Text style={{ color: active ? Colors.primary : Colors.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>
                      {k.toUpperCase()}
                    </Text>
                    <Text style={{ color: Colors.textMuted, fontSize: 10 }}>
                      {k === 'se' ? 'Single engine' : 'Multi engine'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Flygplan / Helikopter */}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['airplane', 'helicopter'] as const).map((c) => {
                const active = f.category === c;
                const ai = aiActive('category') && active;
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => { updateForm(d.as_written, { category: active ? '' : c, aiFilled: (() => { const s = new Set(f.aiFilled); s.delete('category'); return s; })() }); }}
                    activeOpacity={0.75}
                    style={[{
                      flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
                      backgroundColor: active ? Colors.primary + '1A' : Colors.elevated,
                      borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                    }, ai && aiBtn]}
                  >
                    <Text style={{ color: active ? Colors.primary : Colors.textSecondary, fontSize: 13, fontWeight: '800' }}>
                      {c === 'airplane' ? 'Flygplan' : 'Helikopter'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}

      <TouchableOpacity
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, marginTop: 2,
        }}
        onPress={apply}
        activeOpacity={0.85}
      >
        <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
        <Text style={{ color: Colors.textInverse, fontSize: 14, fontWeight: '800', letterSpacing: 0.3 }}>
          Bekräfta & fortsätt granska flygningarna
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Datumfält med DateTimePicker ──────────────────────────────────────────────

function FieldRowDate({ value, onChange, original }: { value: string; onChange: (v: string) => void; original?: string }) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const changed = original !== undefined && value !== original;

  const parseDate = (s: string): Date => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  const setFromPicker = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    onChange(`${y}-${m}-${day}`);
  };

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>Date</Text>
      <TouchableOpacity
        style={[styles.fieldInput, styles.fieldMono, changed && styles.fieldChanged, { paddingVertical: 10, justifyContent: 'center' }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={{ color: value ? Colors.textPrimary : Colors.textMuted, fontSize: 13, fontFamily: 'Menlo' }}>
          {value || 'YYYY-MM-DD'}
        </Text>
      </TouchableOpacity>
      {changed && original ? <Text style={styles.fieldOriginal}>{original}</Text> : null}

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={parseDate(value)}
          mode="date"
          display="default"
          onChange={(_, d) => {
            setOpen(false);
            if (d) setFromPicker(d);
          }}
        />
      )}
      {Platform.OS === 'ios' && (
        <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' }} onPress={() => setOpen(false)}>
            <Pressable style={{ backgroundColor: Colors.surface, padding: 14, borderTopLeftRadius: 16, borderTopRightRadius: 16 }} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={parseDate(value)}
                mode="date"
                display="spinner"
                onChange={(_, d) => { if (d) setFromPicker(d); }}
                themeVariant="dark"
              />
              <TouchableOpacity
                style={{ backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6 }}
                onPress={() => setOpen(false)}
                activeOpacity={0.75}
              >
                <Text style={{ color: Colors.textInverse, fontSize: 14, fontWeight: '700' }}>{t('done')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ── ICAO-fält med sökning ─────────────────────────────────────────────────────

function FieldRowIcao({ label, value, onChange, original }: {
  label: string; value: string; onChange: (v: string) => void; original?: string;
}) {
  const styles = makeStyles();
  const changed = original !== undefined && value !== original;
  return (
    <View style={[styles.fieldRow, { alignItems: 'flex-start' }]}>
      <Text style={[styles.fieldLabel, { marginTop: 8 }]}>{label}</Text>
      <View style={{ flex: 1 }}>
        <IcaoInput
          label=""
          value={value}
          onChangeText={(v) => onChange(v.toUpperCase())}
        />
      </View>
      {changed && original ? <Text style={styles.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Fartygstyp — textfält + chip-rad med sparade typer ────────────────────────

function FieldRowAircraft({ value, onChange, original, savedTypes }: {
  value: string; onChange: (v: string) => void; original?: string; savedTypes: string[];
}) {
  const styles = makeStyles();
  const changed = original !== undefined && value !== original;
  const q = (value ?? '').toUpperCase();
  const suggestions = q
    ? savedTypes.filter((tp) => tp.toUpperCase().startsWith(q) && tp.toUpperCase() !== q).slice(0, 4)
    : savedTypes.slice(0, 4);

  return (
    <View style={[styles.fieldRow, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
      <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Type</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <TextInput
          style={[styles.fieldInput, styles.fieldMono, changed && styles.fieldChanged]}
          value={value}
          onChangeText={(v) => onChange(v.toUpperCase())}
          autoCapitalize="characters"
          placeholder="R44, A320…"
          placeholderTextColor={Colors.textMuted}
        />
        {suggestions.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {suggestions.map((tp) => (
              <TouchableOpacity
                key={tp}
                onPress={() => onChange(tp.toUpperCase())}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
                  backgroundColor: Colors.primary + '1F',
                  borderWidth: 0.5, borderColor: Colors.primary + '66',
                }}
              >
                <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '700', fontFamily: 'Menlo' }}>{tp}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      {changed && original ? <Text style={styles.fieldOriginal}>{original}</Text> : null}
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
  const [savedAircraftTypes, setSavedAircraftTypes] = useState<string[]>([]);
  const [detections, setDetections] = useState<AircraftDetection[]>([]);
  const [aircraftConfirmed, setAircraftConfirmed] = useState(false);

  useEffect(() => {
    getAllAircraftTypes().then((entries) => {
      const unique = Array.from(new Set(entries.map((e: any) => e.aircraft_type).filter(Boolean)));
      setSavedAircraftTypes(unique);
    });
  }, []);

  useEffect(() => {
    ocrScanLogbook(timeFormat)
      .then(({ flights, pageTotals: pt, aircraftDetections }) => {
        setDetections(aircraftDetections);
        // Om inga detektioner eller bara en med hög konfidens kan vi hoppa över bekräftelsen
        if (!aircraftDetections || aircraftDetections.length === 0) {
          setAircraftConfirmed(true);
        }
        setRows(flights.map((f) => {
          // Fast-track: hög konfidens + inga field_issues + ingen needs_review
          // → auto-godkänn (decision='keep' direkt, behandlas som "keep")
          const conf = f.overall_confidence ?? 0;
          const issues = (f.field_issues ?? []).length;
          const fastTrack = conf >= 0.95 && issues === 0 && !f.needs_review;
          return {
            data: { ...f },
            original: { ...f },
            decision: fastTrack ? 'keep' : (f.needs_review ? 'pending' : 'keep'),
          };
        }));

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

  const updateField = (idx: number, key: keyof OcrFlightResult, val: any) => {
    setRows((prev) => {
      const copy = [...prev];
      // Viktigt: ändra INTE decision vid editering — då flyttas flaggade rader
      // till "godkända" vid varje knapptryck och fokus tappas. Användaren måste
      // aktivt trycka "Godkänn" eller "Hoppa över" för att ändra decision.
      copy[idx] = { ...copy[idx], data: { ...copy[idx].data, [key]: val } };
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

  // Bekräftelsesteg för luftfartyg — visas FÖRE review-listan
  if (!aircraftConfirmed && detections.length > 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Steg 1 av 2: Bekräfta luftfartyg</Text>
            <Text style={styles.headerSub}>Rätta innan vi går till flygningarna — uppdaterar alla rader</Text>
          </View>
        </View>
        <AircraftConfirmation
          detections={detections}
          savedTypes={savedAircraftTypes}
          onConfirm={(corrections) => {
            // Propagera rättningar till alla rader med matching aircraft_type
            setRows((prev) => prev.map((r) => {
              const hit = corrections.find((c) =>
                c.as_written === r.original.aircraft_type ||
                c.as_written === r.data.aircraft_type
              );
              if (!hit) return r;
              return {
                ...r,
                data: {
                  ...r.data,
                  aircraft_type: hit.new_type,
                  registration: r.data.registration || hit.new_registration,
                },
              };
            }));
            setAircraftConfirmed(true);
          }}
        />
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

      {/* Batch-godkänn verifierade (hög konfidens, tomma field_issues) */}
      {(() => {
        const verifiable = rows.filter(r =>
          r.decision === 'pending' &&
          (r.data.overall_confidence ?? 0) >= 0.85 &&
          (r.data.field_issues ?? []).length === 0 &&
          !r.data.time_mismatch
        );
        if (verifiable.length === 0) return null;
        return (
          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginHorizontal: 12, marginTop: 8, paddingVertical: 10, borderRadius: 10,
              backgroundColor: Colors.primary + '1F',
              borderWidth: 1, borderColor: Colors.primary + '88',
            }}
            onPress={() => {
              setRows(prev => prev.map(r => {
                if (verifiable.includes(r)) return { ...r, decision: 'corrected' };
                return r;
              }));
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="flash" size={14} color={Colors.primary} />
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '800' }}>
              Godkänn {verifiable.length} verifierade rader
            </Text>
          </TouchableOpacity>
        );
      })()}

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
                  savedAircraftTypes={savedAircraftTypes}
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
                          savedAircraftTypes={savedAircraftTypes}
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
