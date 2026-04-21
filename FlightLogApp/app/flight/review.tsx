import { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal, Pressable, Platform, Image,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ocrScanLogbook, ocrScanPage, type AircraftDetection, type PageContext } from '../../services/ocr';
import { getScanBatch, clearScanImage } from '../../store/scanStore';
import { insertFlight, getAllAircraftTypes, addAircraftTypeToRegistry } from '../../db/flights';
import { getDatabase } from '../../db/database';
import { getActiveBook } from '../../db/logbookBooks';
import { saveLearnedMapping, buildContextHint } from '../../db/ocrLearned';
import * as Haptics from 'expo-haptics';
import { lookupAircraft } from '../../services/aircraftLookup';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { validatePageTotals } from '../../utils/validation';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { formatTimeValue, parseTimeInput } from '../../hooks/useTimeFormat';
import { IcaoInput } from '../../components/IcaoInput';
import { getAirportByIcao, addTemporaryPlace } from '../../db/icao';
import type { OcrFlightResult } from '../../types/flight';
import type { TimeFormat } from '../../store/timeFormatStore';

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type RowDecision = 'pending' | 'keep' | 'corrected' | 'skip';

interface ReviewRow {
  data: OcrFlightResult;
  original: OcrFlightResult;
  decision: RowDecision;
}

// ── Helper: field label mapping ──────────────────────────────────────────────

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    date: 'DATE', aircraft_type: 'TYPE', registration: 'REG',
    dep_place: 'DEP', arr_place: 'ARR', dep_utc: 'DEP UTC', arr_utc: 'ARR UTC',
    total_time: 'TOTAL', pic: 'PIC', co_pilot: 'CO-PILOT', dual: 'DUAL',
    ifr: 'IFR', night: 'NIGHT', landings_day: 'LDG DAY', landings_night: 'LDG NIGHT',
    remarks: 'REMARKS', second_pilot: '2ND PILOT', stop_place: 'STOP',
    multi_pilot: 'MULTI-PILOT', single_pilot: 'SINGLE-PILOT',
    instructor: 'INSTRUCTOR', picus: 'PICUS', spic: 'SPIC',
    examiner: 'EXAMINER', safety_pilot: 'SAFETY PILOT', nvg: 'NVG',
    se_time: 'SE TIME', me_time: 'ME TIME', tng_count: 'TNG COUNT',
    sim_category: 'SIMULATOR TYP',
    other_time_role: 'TIDTYP (OTHER)',
  };
  return map[field] ?? field.toUpperCase();
}

// ── Klocktid (UTC) — auto-formatera HH:MM medan man skriver ─────────────────

function FieldRowClock({ label, value, onChange, original, mismatch, onAcceptAsCorrect }: {
  label: string; value: string; onChange: (v: string) => void; original?: string;
  mismatch?: { correctArr: string; side: 'dep' | 'arr' };
  onAcceptAsCorrect?: () => void;
}) {
  const s = makeStyles();
  const changed = original !== undefined && value !== original;
  const handle = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) onChange('');
    else if (digits.length <= 2) onChange(digits);
    else onChange(`${digits.slice(0, 2)}:${digits.slice(2)}`);
  };
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.fieldInput, s.fieldMono, changed && s.fieldChanged, mismatch && { flex: 0, width: 90 }]}
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
          <Text style={{ color: Colors.success, fontSize: 10, fontWeight: '700' }}>Ratt</Text>
        </TouchableOpacity>
      )}
      {changed && original ? <Text style={s.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Duration-falt med alternativ tidsformat-caption ─────────────────────────

function FieldRowDur({ label, value, onChange, original, timeFormat, showAlt = false, primary = false, capTo }: {
  label: string; value: string; onChange: (v: string) => void; original?: string; timeFormat: TimeFormat; showAlt?: boolean; primary?: boolean;
  capTo?: number;
}) {
  const s = makeStyles();
  const changed = original !== undefined && value !== original;

  const d = parseFloat(value) || 0;
  const displayValue = !value
    ? ''
    : timeFormat === 'decimal'
      ? (d === 0 ? '' : d.toFixed(1))
      : formatTimeValue(d, 'hhmm');

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
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.fieldInput, s.fieldMono, changed && s.fieldChanged, { flex: 0, width: 90 }]}
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
        <Text style={{ color: Colors.textMuted, fontSize: 11, fontFamily: mono, marginLeft: 6, minWidth: 48 }}>
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
      {changed && original ? <Text style={s.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Heltals-falt (landningar m.m.) ─────────────────────────────────────────

function FieldRowInt({ label, value, onChange, original }: {
  label: string; value: string; onChange: (v: string) => void; original?: string;
}) {
  const s = makeStyles();
  const changed = original !== undefined && value !== original;
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.fieldInput, s.fieldMono, changed && s.fieldChanged, { flex: 0, width: 80, textAlign: 'center' as const }]}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="0"
        placeholderTextColor={Colors.textMuted}
      />
      {changed && original ? <Text style={s.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── FieldRow (generic text) ─────────────────────────────────────────────────

function FieldRow({
  label, value, onChange, monoFont, num, original, timeFormat,
}: {
  label: string; value: string; onChange: (v: string) => void;
  monoFont?: boolean; num?: boolean; original?: string; timeFormat?: TimeFormat;
}) {
  const s = makeStyles();
  const changed = original !== undefined && value !== original;
  const displayValue = (num && timeFormat && value)
    ? formatTimeValue(parseFloat(value) || 0, timeFormat)
    : value;
  const originalDisplay = (num && timeFormat && original)
    ? formatTimeValue(parseFloat(original) || 0, timeFormat)
    : original;

  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.fieldInput, (monoFont || num) && s.fieldMono, changed && s.fieldChanged]}
        value={displayValue}
        onChangeText={(v) => {
          if (num && timeFormat) {
            const parsed = parseTimeInput(v, timeFormat);
            onChange(parsed !== null ? String(parsed) : v);
          } else {
            onChange(v);
          }
        }}
        autoCapitalize={monoFont ? 'characters' : 'none'}
        keyboardType={num
          ? (timeFormat === 'hhmm' ? 'numbers-and-punctuation' : 'decimal-pad')
          : 'default'}
      />
      {changed && originalDisplay ? (
        <Text style={s.fieldOriginal}>{originalDisplay}</Text>
      ) : null}
    </View>
  );
}

// ── Datumfalt med DateTimePicker ──────────────────────────────────────────────

function FieldRowDate({ value, onChange, original }: { value: string; onChange: (v: string) => void; original?: string }) {
  const s = makeStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const changed = original !== undefined && value !== original;

  const parseDate = (str: string): Date => {
    const d = new Date(str);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  const setFromPicker = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    onChange(`${y}-${m}-${day}`);
  };

  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>Date</Text>
      <TouchableOpacity
        style={[s.fieldInput, s.fieldMono, changed && s.fieldChanged, { paddingVertical: 10, justifyContent: 'center' }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={{ color: value ? Colors.textPrimary : Colors.textMuted, fontSize: 13, fontFamily: mono }}>
          {value || 'YYYY-MM-DD'}
        </Text>
      </TouchableOpacity>
      {changed && original ? <Text style={s.fieldOriginal}>{original}</Text> : null}

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

// ── ICAO-falt med sokning ─────────────────────────────────────────────────────

function FieldRowIcao({ label, value, onChange, original, isUnknown, onMarkTemporary }: {
  label: string; value: string; onChange: (v: string) => void; original?: string;
  isUnknown?: boolean; onMarkTemporary?: () => void;
}) {
  const s = makeStyles();
  const { t } = useTranslation();
  const changed = original !== undefined && value !== original;
  return (
    <View style={[s.fieldRow, { alignItems: 'flex-start', flexWrap: 'wrap' }]}>
      <Text style={[s.fieldLabel, { marginTop: 8 }]}>{label}</Text>
      <View style={{ flex: 1 }}>
        <IcaoInput
          label=""
          value={value}
          onChangeText={(v) => onChange(v.toUpperCase())}
        />
      </View>
      {changed && original ? <Text style={s.fieldOriginal}>{original}</Text> : null}
      {isUnknown && onMarkTemporary && (
        <TouchableOpacity
          onPress={onMarkTemporary}
          activeOpacity={0.75}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            marginTop: 4, paddingHorizontal: 10, paddingVertical: 6,
            borderRadius: 8, backgroundColor: Colors.warning + '1F',
            borderWidth: 0.5, borderColor: Colors.warning + '88',
            width: '100%',
          }}
        >
          <Ionicons name="location-outline" size={13} color={Colors.warning} />
          <Text style={{ color: Colors.warning, fontSize: 11, fontWeight: '700', flex: 1 }}>
            {value} — {t('mark_as_temporary')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Fartygstyp — textfalt + chip-rad med sparade typer ────────────────────────

function FieldRowAircraft({ value, onChange, original, savedTypes }: {
  value: string; onChange: (v: string) => void; original?: string; savedTypes: string[];
}) {
  const s = makeStyles();
  const changed = original !== undefined && value !== original;
  const q = (value ?? '').toUpperCase();
  const suggestions = q
    ? savedTypes.filter((tp) => tp.toUpperCase().startsWith(q) && tp.toUpperCase() !== q).slice(0, 4)
    : savedTypes.slice(0, 4);

  return (
    <View style={[s.fieldRow, { flexWrap: 'wrap', alignItems: 'flex-start' }]}>
      <Text style={[s.fieldLabel, { marginTop: 8 }]}>Type</Text>
      <View style={{ flex: 1, gap: 4 }}>
        <TextInput
          style={[s.fieldInput, s.fieldMono, changed && s.fieldChanged]}
          value={value}
          onChangeText={(v) => onChange(v.toUpperCase())}
          autoCapitalize="characters"
          placeholder="R44, A320..."
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
                <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '700', fontFamily: mono }}>{tp}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      {changed && original ? <Text style={s.fieldOriginal}>{original}</Text> : null}
    </View>
  );
}

// ── Remarks-forslag fran AI ────────────────────────────────────────────────

function RemarksSuggestionBlock({
  suggestion, onAccept, onReject,
}: {
  suggestion: { field: string; value: string; original_text: string; confidence: number; reason: string };
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{
      padding: 10, borderRadius: 8,
      backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '55',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Ionicons name="sparkles" size={12} color={Colors.primary} />
        <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>
          {t('ai_suggestion')} ({Math.round(suggestion.confidence * 100)}%)
        </Text>
      </View>
      <Text style={{ color: Colors.textPrimary, fontSize: 12, marginBottom: 4 }}>
        "<Text style={{ fontFamily: mono, fontWeight: '700' }}>{suggestion.original_text}</Text>"
        {' '}&rarr;{' '}
        <Text style={{ fontWeight: '800', color: Colors.primary }}>{fieldLabel(suggestion.field)}</Text>?
      </Text>
      <Text style={{ color: Colors.textMuted, fontSize: 10, marginBottom: 8 }}>{suggestion.reason}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 8,
            backgroundColor: Colors.primary, alignItems: 'center',
          }}
          onPress={onAccept}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textInverse, fontSize: 12, fontWeight: '800' }}>{t('yes_btn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 8,
            backgroundColor: 'transparent', alignItems: 'center',
            borderWidth: 1, borderColor: Colors.border,
          }}
          onPress={onReject}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{t('no_keep')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── TimeMismatch block ────────────────────────────────────────────────────────

function TimeMismatchBlock({ tm, onAcceptDep, onAcceptArr }: {
  tm: OcrFlightResult['time_mismatch'];
  onAcceptDep: () => void;
  onAcceptArr: () => void;
}) {
  const { t } = useTranslation();
  if (!tm) return null;
  return (
    <View style={{
      padding: 10, borderRadius: 8,
      backgroundColor: Colors.warning + '12', borderWidth: 1, borderColor: Colors.warning + '55',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Ionicons name="time" size={13} color={Colors.warning} />
        <Text style={{ color: Colors.warning, fontSize: 11, fontWeight: '800' }}>
          {t('time_mismatch_title')} ({tm.anchor_total_h.toFixed(1)}h)
        </Text>
      </View>
      <Text style={{ color: Colors.textSecondary, fontSize: 11, marginBottom: 8 }}>
        {t('time_mismatch_help')}
      </Text>

      {/* DEP option */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: 6, paddingHorizontal: 8, borderRadius: 6,
        backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, marginBottom: 4,
      }}>
        <Text style={{ width: 32, fontSize: 10, fontWeight: '700', color: Colors.textMuted }}>DEP</Text>
        <Text style={{ fontSize: 13, fontFamily: mono, fontWeight: '700', color: Colors.textPrimary }}>{tm.read_dep}</Text>
        <Text style={{ fontSize: 10, color: Colors.textMuted, flex: 1 }}>ARR blir {tm.computed_arr_if_dep_correct}</Text>
        <TouchableOpacity
          onPress={onAcceptDep}
          activeOpacity={0.75}
          style={{
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5,
            backgroundColor: Colors.success + '20', borderWidth: 1, borderColor: Colors.success + '70',
          }}
        >
          <Text style={{ color: Colors.success, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>{t('correct_btn')}</Text>
        </TouchableOpacity>
      </View>

      {/* ARR option */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: 6, paddingHorizontal: 8, borderRadius: 6,
        backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
      }}>
        <Text style={{ width: 32, fontSize: 10, fontWeight: '700', color: Colors.textMuted }}>ARR</Text>
        <Text style={{ fontSize: 13, fontFamily: mono, fontWeight: '700', color: Colors.textPrimary }}>{tm.read_arr}</Text>
        <Text style={{ fontSize: 10, color: Colors.textMuted, flex: 1 }}>DEP blir {tm.computed_dep_if_arr_correct}</Text>
        <TouchableOpacity
          onPress={onAcceptArr}
          activeOpacity={0.75}
          style={{
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5,
            backgroundColor: Colors.success + '20', borderWidth: 1, borderColor: Colors.success + '70',
          }}
        >
          <Text style={{ color: Colors.success, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 }}>{t('correct_btn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── FieldEditor (one per field_issue) ─────────────────────────────────────────

function FieldEditor({ issue, value, originalValue, suggestedValue, onChangeText, onShowImage }: {
  issue: { field: string; reason: string; confidence: number; x_pct?: number };
  value: string;
  originalValue?: string;
  suggestedValue?: string;  // AI:s alternativa förslag (t.ex. ETHB? när primary = ETAB)
  onChangeText: (v: string) => void;
  onShowImage?: () => void;
}) {
  const isChanged = originalValue != null && value !== originalValue;
  const isIcao = issue.field === 'dep_place' || issue.field === 'arr_place';
  const isTime = issue.field === 'dep_utc' || issue.field === 'arr_utc';
  const isNum = ['total_time', 'pic', 'co_pilot', 'dual', 'ifr', 'night', 'landings_day', 'landings_night'].includes(issue.field);
  const isSim = issue.field === 'sim_category';
  const isOtherRole = issue.field === 'other_time_role';
  const SIM_TYPES = ['FFS', 'FTD', 'FNPT II', 'FNPT I', 'BITD', 'CPT/PPT', 'CBT'];
  const TIME_ROLES = ['Instructor', 'PICUS', 'SPIC', 'Multi-pilot', 'Single-pilot', 'Examiner', 'Safety pilot', 'NVG', 'SE time', 'ME time'];
  const [icaoResults, setIcaoResults] = useState<{ icao: string; name: string }[]>([]);

  const handleIcaoChange = async (v: string) => {
    const upper = v.toUpperCase();
    onChangeText(upper);
    if (isIcao && upper.length >= 2) {
      try {
        const { searchAirports } = require('../../db/icao');
        setIcaoResults(await searchAirports(upper, 4));
      } catch { setIcaoResults([]); }
    } else { setIcaoResults([]); }
  };

  const handleTime = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) onChangeText('');
    else if (digits.length <= 2) onChangeText(digits);
    else onChangeText(`${digits.slice(0, 2)}:${digits.slice(2)}`);
  };

  const borderColor = isChanged ? Colors.success : Colors.warning + '44';

  return (
    <View style={{
      padding: 8, paddingHorizontal: 10, backgroundColor: Colors.elevated,
      borderRadius: 8, borderWidth: 1, borderColor, marginBottom: 6,
    }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 5 }}>
        {isChanged && <Ionicons name="checkmark-circle" size={12} color={Colors.success} />}
        <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: isChanged ? Colors.success : Colors.warning, textTransform: 'uppercase' }}>
          {fieldLabel(issue.field)}
        </Text>
        <Text style={{ flex: 1, fontSize: 10, color: Colors.textMuted }} numberOfLines={1}>{issue.reason}</Text>
        <Text style={{ fontSize: 10, fontFamily: mono, fontWeight: '700', color: isChanged ? Colors.success : Colors.warning }}>
          {isChanged ? 'ÄNDRAD' : `${Math.round(issue.confidence * 100)}%`}
        </Text>
      </View>
      {(isSim || isOtherRole) ? (
        /* Chip-picker: simulatortyp ELLER roll */
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {(isSim ? SIM_TYPES : TIME_ROLES).map(opt => {
            const key = opt.replace(/[\s\/\-]/g, '_').toLowerCase();
            const active = value === key || value === opt || value.toLowerCase() === key;
            return (
              <TouchableOpacity key={opt} onPress={() => onChangeText(key)} activeOpacity={0.75}
                style={{
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
                  backgroundColor: active ? Colors.primary : Colors.elevated,
                  borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
                }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: active ? Colors.textInverse : Colors.textSecondary }}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TextInput
            style={{
              flex: 1, padding: 7, paddingHorizontal: 10, borderRadius: 6,
              backgroundColor: Colors.card,
              borderWidth: 1, borderColor: isChanged ? Colors.success + '88' : Colors.border,
              color: Colors.textPrimary, fontSize: 13, fontFamily: mono, fontWeight: '600',
            }}
            value={value}
            onChangeText={isIcao ? handleIcaoChange : isTime ? handleTime : onChangeText}
            autoCapitalize={isIcao || issue.field === 'registration' || issue.field === 'aircraft_type' ? 'characters' : 'none'}
            keyboardType={isNum ? 'decimal-pad' : isTime ? 'number-pad' : 'default'}
            maxLength={isIcao ? 4 : isTime ? 5 : undefined}
          />
          {onShowImage && (
            <TouchableOpacity onPress={onShowImage} activeOpacity={0.7}
              style={{ width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '20', borderWidth: 1, borderColor: Colors.primary + '50' }}>
              <Ionicons name="search" size={14} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {/* Förslag med grön bock — snabb accept */}
      {suggestedValue && suggestedValue !== value && (
        <TouchableOpacity
          onPress={() => onChangeText(suggestedValue)}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            marginTop: 4, paddingVertical: 5, paddingHorizontal: 8,
            backgroundColor: Colors.success + '14', borderRadius: 6,
            borderWidth: 1, borderColor: Colors.success + '55',
          }}
        >
          <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
          <Text style={{ fontSize: 12, fontFamily: mono, fontWeight: '700', color: Colors.success }}>
            {suggestedValue}?
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontSize: 10, color: Colors.textMuted }}>Tryck för att acceptera</Text>
        </TouchableOpacity>
      )}
      {/* ICAO autocomplete */}
      {icaoResults.length > 0 && (
        <View style={{ backgroundColor: Colors.card, borderRadius: 6, borderWidth: 1, borderColor: Colors.cardBorder, marginTop: 4, overflow: 'hidden' }}>
          {icaoResults.map(r => (
            <TouchableOpacity key={r.icao} onPress={() => { onChangeText(r.icao); setIcaoResults([]); }} activeOpacity={0.7}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
              <Text style={{ fontSize: 12, fontFamily: mono, color: Colors.primary, fontWeight: '700' }}>{r.icao}</Text>
              <Text style={{ fontSize: 10, color: Colors.textMuted }} numberOfLines={1}>{r.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── MiniField varianter (kompakt 2-kolumns-grid) ─────────────────────────────

const miniInputStyle = {
  width: '100%' as any, padding: 6, paddingHorizontal: 8, borderRadius: 6,
  backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  fontSize: 12, fontFamily: mono, color: Colors.textPrimary,
};
const miniLabelStyle = {
  fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.6,
  textTransform: 'uppercase' as const, color: Colors.textMuted, marginBottom: 3,
};

function MiniField({ label, value, onChangeText }: {
  label: string; value: string; onChangeText: (v: string) => void;
}) {
  return (
    <View style={{ width: '48%', marginBottom: 10 }}>
      <Text style={miniLabelStyle}>{label}</Text>
      <TextInput style={miniInputStyle} value={value} onChangeText={onChangeText} />
    </View>
  );
}

function MiniFieldDate({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const d = value ? new Date(value) : new Date();
  return (
    <View style={{ width: '48%', marginBottom: 10 }}>
      <Text style={miniLabelStyle}>DATE</Text>
      <TouchableOpacity style={miniInputStyle} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={{ fontSize: 12, fontFamily: mono, color: value ? Colors.textPrimary : Colors.textMuted }}>
          {value || 'YYYY-MM-DD'}
        </Text>
      </TouchableOpacity>
      {open && Platform.OS === 'android' && (
        <DateTimePicker value={d} mode="date" display="default" onChange={(_, picked) => {
          setOpen(false);
          if (picked) onChangeText(`${picked.getFullYear()}-${String(picked.getMonth()+1).padStart(2,'0')}-${String(picked.getDate()).padStart(2,'0')}`);
        }} />
      )}
      {open && Platform.OS === 'ios' && (
        <Modal transparent visible animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={{ flex:1, backgroundColor:'#00000088', justifyContent:'flex-end' }} onPress={() => setOpen(false)}>
            <Pressable style={{ backgroundColor:Colors.surface, padding:14, borderTopLeftRadius:16, borderTopRightRadius:16 }} onPress={e => e.stopPropagation()}>
              <DateTimePicker value={d} mode="date" display="spinner" themeVariant="dark"
                onChange={(_, picked) => { if (picked) onChangeText(`${picked.getFullYear()}-${String(picked.getMonth()+1).padStart(2,'0')}-${String(picked.getDate()).padStart(2,'0')}`); }} />
              <TouchableOpacity style={{ backgroundColor:Colors.primary, borderRadius:10, paddingVertical:10, alignItems:'center', marginTop:6 }} onPress={() => setOpen(false)}>
                <Text style={{ color:Colors.textInverse, fontSize:14, fontWeight:'700' }}>OK</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function MiniFieldIcao({ label, value, onChangeText, onAddTemp }: {
  label: string; value: string; onChangeText: (v: string) => void; onAddTemp?: () => void;
}) {
  const [results, setResults] = useState<{ icao: string; name: string }[]>([]);
  const handleChange = async (v: string) => {
    const upper = v.toUpperCase();
    onChangeText(upper);
    if (upper.length >= 2) {
      try {
        const { searchAirports } = require('../../db/icao');
        const found = await searchAirports(upper, 4);
        setResults(found);
      } catch { setResults([]); }
    } else { setResults([]); }
  };
  return (
    <View style={{ width: '48%', marginBottom: 10 }}>
      <Text style={miniLabelStyle}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <TextInput
          style={[miniInputStyle, { flex: 1 }]}
          value={value}
          onChangeText={handleChange}
          autoCapitalize="characters"
          maxLength={4}
        />
        {onAddTemp && (
          <TouchableOpacity onPress={onAddTemp} activeOpacity={0.7}
            style={{ width: 28, borderRadius: 6, backgroundColor: Colors.warning + '22', borderWidth: 1, borderColor: Colors.warning + '55', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={14} color={Colors.warning} />
          </TouchableOpacity>
        )}
      </View>
      {results.length > 0 && (
        <View style={{ backgroundColor: Colors.card, borderRadius: 6, borderWidth: 1, borderColor: Colors.cardBorder, marginTop: 2, overflow: 'hidden' }}>
          {results.map(r => (
            <TouchableOpacity key={r.icao} onPress={() => { onChangeText(r.icao); setResults([]); }} activeOpacity={0.7}
              style={{ paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
              <Text style={{ fontSize: 11, fontFamily: mono, color: Colors.primary, fontWeight: '700' }}>{r.icao}</Text>
              <Text style={{ fontSize: 9, color: Colors.textMuted }} numberOfLines={1}>{r.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function MiniFieldTime({ label, value, onChangeText }: {
  label: string; value: string; onChangeText: (v: string) => void;
}) {
  const handle = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) onChangeText('');
    else if (digits.length <= 2) onChangeText(digits);
    else onChangeText(`${digits.slice(0, 2)}:${digits.slice(2)}`);
  };
  return (
    <View style={{ width: '48%', marginBottom: 10 }}>
      <Text style={miniLabelStyle}>{label}</Text>
      <TextInput style={miniInputStyle} value={value} onChangeText={handle} keyboardType="number-pad" maxLength={5} placeholder="HH:MM" placeholderTextColor={Colors.textMuted} />
    </View>
  );
}

function MiniFieldNum({ label, value, onChangeText }: {
  label: string; value: string; onChangeText: (v: string) => void;
}) {
  return (
    <View style={{ width: '48%', marginBottom: 10 }}>
      <Text style={miniLabelStyle}>{label}</Text>
      <TextInput style={miniInputStyle} value={value} onChangeText={onChangeText} keyboardType="decimal-pad" />
    </View>
  );
}

// ── SummaryRow (done state) ──────────────────────────────────────────────────

function SummaryRow({ icon, iconColor, label, count, isLast }: {
  icon: keyof typeof Ionicons.glyphMap; iconColor: string; label: string; count: number; isLast?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 10, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: Colors.separator,
    }}>
      <View style={{
        width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
        backgroundColor: iconColor + '20',
      }}>
        <Ionicons name={icon} size={14} color={iconColor} />
      </View>
      <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textPrimary }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '800', fontFamily: mono, color: Colors.textPrimary }}>{count}</Text>
    </View>
  );
}

// ── Aircraft-bekraftelse innan review ─────────────────────────────────────

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

  // Auto-lookup via AI nar skarmen oppnas
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
    for (const d of detections) {
      const f = forms[d.as_written]; if (!f) continue;
      const typeUpper = f.type.trim().toUpperCase();
      if (!typeUpper) continue;
      let imgUrl = '';
      try {
        const searchTerm = encodeURIComponent(`${typeUpper} helicopter OR aircraft`);
        const wikiRes = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${searchTerm}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`);
        if (wikiRes.ok) {
          const wikiData = await wikiRes.json();
          const pages = wikiData.query?.pages;
          if (pages) {
            const keywords = ['aircraft', 'helicopter', 'airplane', 'airliner', 'rotorcraft'];
            for (const id of Object.keys(pages)) {
              const info = pages[id]?.imageinfo?.[0];
              if (!info?.thumburl) continue;
              const cats = (info.extmetadata?.Categories?.value ?? '').toLowerCase();
              const desc = (info.extmetadata?.ImageDescription?.value ?? '').toLowerCase();
              if (keywords.some(kw => cats.includes(kw) || desc.includes(kw))) { imgUrl = info.thumburl; break; }
            }
            if (!imgUrl) {
              for (const id of Object.keys(pages)) {
                const thumb = pages[id]?.imageinfo?.[0]?.thumburl;
                if (thumb) { imgUrl = thumb; break; }
              }
            }
          }
        }
      } catch { /* bild-hamtning frivillig */ }

      await addAircraftTypeToRegistry(
        typeUpper,
        parseInt(f.speed) || 0,
        parseFloat(f.endurance.replace(',', '.')) || 0,
        Array.from(f.crewTypes).sort().join(','),
        f.category,
        f.engineType,
        imgUrl,
      );
      if (d.as_written && d.as_written !== typeUpper) {
        await saveLearnedMapping('aircraft_type', d.as_written, typeUpper);
      }
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
        AI har identifierat {detections.length} {detections.length === 1 ? 'luftfartyg' : 'luftfartyg'} pa sidan. Rattar du nagot har uppdateras ALLA rader med samma handstilsform automatiskt — och fartyget sparas under Sparade luftfartyg.
      </Text>

      {detections.map((d, idx) => {
        const f = forms[d.as_written];
        if (!f) return null;
        const filteredSaved = savedTypes
          .filter((tp) => tp.toUpperCase().startsWith(f.type.toUpperCase()) && tp.toUpperCase() !== f.type.toUpperCase())
          .slice(0, 4);
        const aiActive = (k: string) => f.aiFilled.has(k);
        return (
          <View key={`${d.as_written}-${d.registration}-${idx}`} style={{
            backgroundColor: Colors.card, borderRadius: 14, padding: 14,
            borderWidth: 0.5, borderColor: Colors.cardBorder, gap: 10,
          }}>
            {/* Header */}
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
                  {f.loading ? 'Hamtar...' : 'Autogenererat med AI'}
                </Text>
              </View>
            </View>

            {/* Upptackt-rad */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={{ color: Colors.textMuted, fontSize: 11 }}>Piloten skrev</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: 12, fontFamily: mono, fontWeight: '700' }}>
                "{d.as_written}"
              </Text>
              <Text style={{ color: Colors.textMuted, fontSize: 11 }}>
                . Forst rad {d.first_row} . {d.rows.length} {d.rows.length === 1 ? 'rad' : 'rader'}
              </Text>
            </View>

            {/* Grid: Type / Speed / Endurance */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 2 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Type</Text>
                <TextInput
                  style={{
                    backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                    color: Colors.textPrimary, fontSize: 15, fontFamily: mono, fontWeight: '800',
                    paddingHorizontal: 10, paddingVertical: 10, textAlign: 'center',
                  }}
                  value={f.type}
                  onChangeText={(v) => updateForm(d.as_written, { type: v.toUpperCase() })}
                  autoCapitalize="characters"
                  placeholder="R44, A320..."
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Speed (kts)</Text>
                <TextInput
                  style={[{
                    backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
                    color: Colors.textPrimary, fontSize: 15, fontFamily: mono, fontWeight: '800',
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
                    color: Colors.textPrimary, fontSize: 15, fontFamily: mono, fontWeight: '800',
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

            {/* Forslag pa sparade typer */}
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
                    <Text style={{ color: Colors.primary, fontSize: 10, fontWeight: '700', fontFamily: mono }}>{tp}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

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
          Bekrafta & fortsatt granska flygningarna
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── MAIN SCREEN ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

export default function ReviewScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { loadFlights, loadStats, canAddFlight } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();
  const scrollRef = useRef<ScrollView>(null);

  // ── Existing state ──────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [pageWarning, setPageWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAircraftTypes, setSavedAircraftTypes] = useState<string[]>([]);
  const [detections, setDetections] = useState<AircraftDetection[]>([]);
  const [aircraftConfirmed, setAircraftConfirmed] = useState(false);

  // Batch-progress
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const [calibrationDone, setCalibrationDone] = useState(true);
  const [page1RowCount, setPage1RowCount] = useState(0);
  const [batchRemainder, setBatchRemainder] = useState<{ pages: any[]; prevContext: PageContext | undefined; allDetections: AircraftDetection[] } | null>(null);
  const [scannedPageNumbers, setScannedPageNumbers] = useState<{ left: number | null; right: number | null }[]>([]);
  const [scanImages, setScanImages] = useState<string[]>([]);
  const [scanLayouts, setScanLayouts] = useState<{ x_pct: number; y_pct: number; w_pct: number; h_pct: number }[]>([]);
  const [popupImage, setPopupImage] = useState<{ base64: string; rowIndex: number; totalRows: number; fieldXPct?: number } | null>(null);
  const [unknownIcaos, setUnknownIcaos] = useState<Set<string>>(new Set());

  // ── NEW wizard state ────────────────────────────────────────────────────────
  const [wizardCursor, setWizardCursor] = useState(0);
  const [wizardDecisions, setWizardDecisions] = useState<Record<number, 'corrected' | 'skip'>>({});
  const [wizardEdits, setWizardEdits] = useState<Record<number, Record<string, any>>>({});
  const [showAllFields, setShowAllFields] = useState(false);
  const [fullImage, setFullImage] = useState(false);

  // ── Derived wizard data ─────────────────────────────────────────────────────
  const isFastTrack = (r: ReviewRow) => !r.data.needs_review && (r.data.overall_confidence ?? 0) >= 0.95;
  const flaggedIdx = rows.map((r, i) => !isFastTrack(r) ? i : -1).filter(i => i >= 0);
  const fastTrackCount = rows.length - flaggedIdx.length;
  const atEnd = wizardCursor >= flaggedIdx.length;
  const currentFlaggedRowIdx = flaggedIdx[wizardCursor];
  const currentRow = atEnd ? null : rows[currentFlaggedRowIdx];

  const manuallyApprovedCount = Object.values(wizardDecisions).filter(d => d === 'corrected').length;
  const skippedCount = Object.values(wizardDecisions).filter(d => d === 'skip').length;
  const totalToSave = fastTrackCount + manuallyApprovedCount;

  // ── Pre-render logic (completely unchanged) ─────────────────────────────────

  const dedupeDetections = (dets: AircraftDetection[]): AircraftDetection[] => {
    const map = new Map<string, AircraftDetection>();
    for (const d of dets) {
      const key = d.as_written.toUpperCase();
      const existing = map.get(key);
      if (existing) {
        existing.rows = [...new Set([...existing.rows, ...d.rows])];
        if (d.confidence > existing.confidence) {
          existing.resolved = d.resolved;
          existing.confidence = d.confidence;
        }
      } else {
        map.set(key, { ...d, rows: [...d.rows] });
      }
    }
    return Array.from(map.values());
  };

  const resolveArithmetic = (data: OcrFlightResult): void => {
    const timeFields: (keyof OcrFlightResult)[] = [
      'total_time', 'pic', 'co_pilot', 'dual', 'ifr', 'night',
      'instructor', 'picus', 'spic', 'nvg', 'multi_pilot', 'single_pilot',
    ];
    const addPattern = /^\s*(\d+[\.,]\d+)\s*\+\s*(\d+[\.,]\d+)\s*$/;
    const issues = data.field_issues ? [...data.field_issues] : [];
    for (const field of timeFields) {
      const raw = String((data as any)[field] ?? '');
      const match = raw.match(addPattern);
      if (!match) continue;
      const a = parseFloat(match[1].replace(',', '.'));
      const b = parseFloat(match[2].replace(',', '.'));
      if (isNaN(a) || isNaN(b)) continue;
      const sum = Math.round((a + b) * 10) / 10;
      (data as any)[field] = String(sum);
      issues.push({
        field: field as string,
        reason: `AI laste "${raw}" — summan ${sum} har beraknats. Stammer det?`,
        confidence: 0.6,
      });
      data.needs_review = true;
      data.review_reason = data.review_reason || 'Aritmetik i tidsfalt';
    }
    data.field_issues = issues;
  };

  const flightsToRows = (flights: OcrFlightResult[]): ReviewRow[] =>
    flights.map((f) => {
      const data = { ...f };
      resolveArithmetic(data);

      // "Other type of flight time" → användaren anger vilken roll
      const otherVal = parseFloat(String((data as any).other_time ?? '0')) || 0;
      if (otherVal > 0) {
        data.needs_review = true;
        data.review_reason = data.review_reason || '"Other type of flight time" — ange vilken tid';
        const issues = data.field_issues ? [...data.field_issues] : [];
        if (!issues.find((i) => i.field === 'other_time_role')) {
          issues.push({ field: 'other_time_role', reason: 'Ange vilken typ av tid', confidence: 0.5 });
        }
        data.field_issues = issues;
      }

      // Simulator-detektion: om flight_type='sim' eller STD-tid finns → flagga för sim-typ
      const isSim = data.flight_type === 'sim';
      const stdVal = parseFloat(String((data as any).std ?? '0')) || 0;
      if ((isSim || stdVal > 0) && !data.sim_category) {
        data.flight_type = 'sim';
        // Sim-tid loggas INTE som vanlig flygtid — säkerställ
        if (stdVal > 0 && (parseFloat(data.total_time) || 0) === 0) {
          data.total_time = String(stdVal);
        }
        data.needs_review = true;
        data.review_reason = data.review_reason || 'Simulator — välj typ';
        const issues = data.field_issues ? [...data.field_issues] : [];
        if (!issues.find((i) => i.field === 'sim_category')) {
          issues.push({ field: 'sim_category', reason: 'Välj typ av simulator (FFS, FTD, FNPT…)', confidence: 0.5 });
        }
        data.field_issues = issues;
      }

      const totalH = parseFloat(data.total_time) || 0;
      if (data.dep_utc && data.arr_utc && data.dep_utc === data.arr_utc && totalH > 0 && !data.time_mismatch) {
        const [dh, dm] = data.dep_utc.split(':').map(Number);
        if (!isNaN(dh) && !isNaN(dm)) {
          const depMin = dh * 60 + dm;
          const totalMin = Math.round(totalH * 60);
          const arrMin = depMin + totalMin;
          const arrH = Math.floor(arrMin / 60) % 24;
          const arrM = arrMin % 60;
          const computedArr = `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`;
          const depFromArr = depMin - totalMin;
          const depH2 = Math.floor(((depFromArr % 1440) + 1440) % 1440 / 60);
          const depM2 = ((depFromArr % 1440) + 1440) % 1440 % 60;
          const computedDep = `${String(depH2).padStart(2, '0')}:${String(depM2).padStart(2, '0')}`;
          data.time_mismatch = {
            anchor_total_h: totalH,
            read_dep: data.dep_utc,
            read_arr: data.arr_utc,
            computed_arr_if_dep_correct: computedArr,
            computed_dep_if_arr_correct: computedDep,
          };
          data.needs_review = true;
          data.review_reason = data.review_reason || 'Dep och arr har samma tid — en maste vara fel';
        }
      }
      const totalHvfr = parseFloat(data.total_time) || 0;
      const ifrH = parseFloat(data.ifr) || 0;
      if (totalHvfr > 0 && (!data.vfr || parseFloat(data.vfr) === 0)) {
        data.vfr = String(Math.round(Math.max(0, totalHvfr - ifrH) * 10) / 10);
      }
      if (!data.flight_rules || data.flight_rules === 'VFR') {
        data.flight_rules = ifrH > 0 ? (ifrH >= totalHvfr ? 'IFR' : 'Y') : 'VFR';
      }

      const conf = data.overall_confidence ?? 0;
      const issues = (data.field_issues ?? []).length;
      const fastTrack = conf >= 0.95 && issues === 0 && !data.needs_review;
      return { data, original: { ...f }, decision: fastTrack ? 'keep' : (data.needs_review ? 'pending' : 'keep') };
    });

  useEffect(() => {
    getAllAircraftTypes().then((entries) => {
      const unique = Array.from(new Set(entries.map((e: any) => e.aircraft_type).filter(Boolean)));
      setSavedAircraftTypes(unique);
    });
  }, []);

  const validateIcaoCodes = async (newRows: ReviewRow[]) => {
    const icaoPattern = /^[A-Z]{4}$/;
    const checked = new Set<string>();
    const unknown = new Set<string>();
    for (const row of newRows) {
      for (const field of ['dep_place', 'arr_place'] as const) {
        const code = (row.data[field] ?? '').toUpperCase();
        if (!code || !icaoPattern.test(code) || checked.has(code)) continue;
        checked.add(code);
        const airport = await getAirportByIcao(code);
        if (!airport) unknown.add(code);
      }
    }
    if (unknown.size === 0) return;
    setUnknownIcaos((prev) => new Set([...prev, ...unknown]));
    setRows((prev) => prev.map((r) => {
      const depUnknown = unknown.has((r.data.dep_place ?? '').toUpperCase());
      const arrUnknown = unknown.has((r.data.arr_place ?? '').toUpperCase());
      if (!depUnknown && !arrUnknown) return r;
      const issues = [...(r.data.field_issues ?? [])];
      if (depUnknown && !issues.find((i) => i.field === 'dep_place')) {
        issues.push({ field: 'dep_place', reason: `${r.data.dep_place} finns inte i ICAO-databasen — tillfallig plats?`, confidence: 0.3 });
      }
      if (arrUnknown && !issues.find((i) => i.field === 'arr_place')) {
        issues.push({ field: 'arr_place', reason: `${r.data.arr_place} finns inte i ICAO-databasen — tillfallig plats?`, confidence: 0.3 });
      }
      return {
        ...r,
        data: { ...r.data, field_issues: issues, needs_review: true,
          review_reason: r.data.review_reason || 'Okand flygplatskod' },
        decision: r.decision === 'keep' ? 'pending' : r.decision,
      };
    }));
  };

  // ── Batch useEffect ─────────────────────────────────────────────────────────

  useEffect(() => {
    const batch = getScanBatch();
    if (batch.length > 1) {
      setBatchTotal(batch.length);
      setBatchRunning(true);
      setCalibrationDone(false);

      (async () => {
        let prevContext: PageContext | undefined;
        let allDetections: AircraftDetection[] = [];

        try {
          const page = batch[0];
          const result = await ocrScanPage(page.base64, page.mediaType, timeFormat, prevContext);
          const newPageRows = flightsToRows(result.flights);
          setRows(newPageRows);
          setPage1RowCount(newPageRows.length);
          validateIcaoCodes(newPageRows);
          setScanImages([page.base64]);
          setScanLayouts([result.imageLayout?.logbook_bounds ?? { x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 }]);
          allDetections = [...result.aircraftDetections];
          setDetections(dedupeDetections(allDetections));
          setScannedPageNumbers([result.pageNumbers]);
          setBatchDone(1);
          setScanning(false);

          const lastFlight = result.flights[result.flights.length - 1];
          if (lastFlight) {
            prevContext = {
              last_date: lastFlight.date,
              last_aircraft_type: lastFlight.aircraft_type,
              last_registration: lastFlight.registration,
              last_dep_place: lastFlight.dep_place,
              last_arr_place: lastFlight.arr_place,
              page_number: 1,
            };
          }
        } catch (e: any) {
          setError(`Sida 1: ${e.message}`);
          setBatchRunning(false);
          clearScanImage();
          return;
        }

        if (allDetections.length === 0) setAircraftConfirmed(true);
        setBatchRunning(false);
        setBatchRemainder({ pages: batch.slice(1), prevContext, allDetections });
      })();
    } else {
      const singleImg = getScanBatch()[0];
      if (singleImg) setScanImages([singleImg.base64]);
      ocrScanLogbook(timeFormat)
        .then(({ flights, pageTotals: pt, aircraftDetections, pageNumbers, imageLayout }) => {
          setScanLayouts([imageLayout?.logbook_bounds ?? { x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 }]);
          const deduped = dedupeDetections(aircraftDetections);
          setDetections(deduped);
          if (!deduped || deduped.length === 0) setAircraftConfirmed(true);
          const newRows = flightsToRows(flights);
          setRows(newRows);
          setScannedPageNumbers([pageNumbers]);
          validateIcaoCodes(newRows);
          if (pt.brought_forward !== null && pt.total_this_page !== null && pt.total_to_date !== null) {
            const issue = validatePageTotals({ broughtForward: pt.brought_forward, totalThisPage: pt.total_this_page, totalToDate: pt.total_to_date });
            if (issue) setPageWarning(issue.message);
          }
        })
        .catch((e) => setError(e.message))
        .finally(() => setScanning(false));
    }
  }, []);

  // Continue batch after calibration
  useEffect(() => {
    if (!calibrationDone || !batchRemainder) return;
    const { pages, prevContext: initCtx, allDetections: initDets } = batchRemainder;
    setBatchRemainder(null);
    setBatchRunning(true);

    (async () => {
      let prevContext = initCtx;
      let allDetections = [...initDets];

      for (let i = 0; i < pages.length; i++) {
        try {
          const page = pages[i];
          const result = await ocrScanPage(page.base64, page.mediaType, timeFormat, prevContext);
          const newPageRows = flightsToRows(result.flights);
          setRows((prev) => [...prev, ...newPageRows]);
          validateIcaoCodes(newPageRows);
          setScanImages((prev) => [...prev, page.base64]);
          setScanLayouts((prev) => [...prev, result.imageLayout?.logbook_bounds ?? { x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 }]);
          allDetections = [...allDetections, ...result.aircraftDetections];
          setDetections(dedupeDetections(allDetections));
          setScannedPageNumbers((prev) => [...prev, result.pageNumbers]);
          setBatchDone(i + 2);

          const lastFlight = result.flights[result.flights.length - 1];
          if (lastFlight) {
            prevContext = {
              last_date: lastFlight.date,
              last_aircraft_type: lastFlight.aircraft_type,
              last_registration: lastFlight.registration,
              last_dep_place: lastFlight.dep_place,
              last_arr_place: lastFlight.arr_place,
              page_number: i + 2,
            };
          }
        } catch (e: any) {
          setError(`Sida ${i + 2}: ${e.message}`);
          break;
        }
      }
      setBatchRunning(false);
      clearScanImage();
    })();
  }, [calibrationDone]);

  // ── Calibration confirm ─────────────────────────────────────────────────────

  const handleCalibrationConfirm = async () => {
    const page1Rows = rows.slice(0, page1RowCount);
    for (const row of page1Rows) {
      if (row.data.aircraft_type && row.data.aircraft_type !== row.original.aircraft_type && row.original.aircraft_type) {
        await saveLearnedMapping('aircraft_type', row.original.aircraft_type, row.data.aircraft_type);
      }
      if (row.data.dep_place && row.data.dep_place !== row.original.dep_place && row.original.dep_place) {
        await saveLearnedMapping('icao', row.original.dep_place, row.data.dep_place);
      }
      if (row.data.arr_place && row.data.arr_place !== row.original.arr_place && row.original.arr_place) {
        await saveLearnedMapping('icao', row.original.arr_place, row.data.arr_place);
      }
      if (row.data.second_pilot && row.data.second_pilot !== row.original.second_pilot && row.original.second_pilot) {
        await saveLearnedMapping('second_pilot', row.original.second_pilot, row.data.second_pilot);
      }
      const timeFields: (keyof OcrFlightResult)[] = ['total_time', 'pic', 'co_pilot', 'dual', 'ifr', 'night', 'dep_utc', 'arr_utc'];
      for (const field of timeFields) {
        const orig = String(row.original[field] ?? '');
        const curr = String(row.data[field] ?? '');
        if (orig && curr && orig !== curr) {
          await saveLearnedMapping('time_correction', orig, curr);
        }
      }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCalibrationDone(true);
  };

  // ── updateField / setDecision ───────────────────────────────────────────────

  const updateField = (idx: number, key: keyof OcrFlightResult, val: any) => {
    setRows((prev) => {
      const copy = [...prev];
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
    if (decision === 'corrected' || decision === 'keep') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (decision === 'skip') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  // ── Wizard advance / undo ───────────────────────────────────────────────────

  const advanceWizard = (decision: 'corrected' | 'skip') => {
    setWizardDecisions(d => ({ ...d, [currentFlaggedRowIdx]: decision }));
    // Apply any pending edits to rows for 'corrected'
    if (decision === 'corrected' && wizardEdits[currentFlaggedRowIdx]) {
      const edits = wizardEdits[currentFlaggedRowIdx];
      Object.entries(edits).forEach(([key, val]) => updateField(currentFlaggedRowIdx, key as any, val));
    }
    setDecision(currentFlaggedRowIdx, decision);
    Haptics.notificationAsync(decision === 'corrected' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    setWizardCursor(c => c + 1);
    setShowAllFields(false);
    // Auto-scroll to top
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const undoWizard = () => {
    if (wizardCursor <= 0) return;
    setWizardCursor(c => c - 1);
    setShowAllFields(false);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // ── Save logic (updated for wizard decisions) ───────────────────────────────

  const doSave = async () => {
    setSaving(true);
    let saved = 0, skipped = 0, duplicates = 0;
    const savedFlightIds: number[] = [];
    try {
      const db = await getDatabase();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Skip rows: wizard-skipped flagged rows, or rows with decision='skip'
        if (row.decision === 'skip' || wizardDecisions[i] === 'skip') {
          skipped++;
          continue;
        }
        // Duplicate check
        const dup = await db.getFirstAsync<{ id: number }>(
          `SELECT id FROM flights WHERE date=? AND dep_place=? AND arr_place=? AND ABS(total_time - ?) < 0.05 LIMIT 1`,
          [row.data.date, row.data.dep_place, row.data.arr_place, parseFloat(row.data.total_time) || 0],
        );
        if (dup) {
          duplicates++;
          continue;
        }
        const id = await insertFlight(row.data, { source: 'ocr', originalData: JSON.stringify(row.original) });
        if (id) savedFlightIds.push(id);
        saved++;
      }

      // Save unknown ICAOs as temporary places
      for (const icao of unknownIcaos) {
        try { await addTemporaryPlace(icao, icao); } catch { /* redan tillagd */ }
      }

      // Link to active paper logbook
      const book = await getActiveBook();
      if (book && savedFlightIds.length > 0 && scannedPageNumbers.length > 0) {
        const db = await getDatabase();
        for (const pn of scannedPageNumbers) {
          const leftPage = pn.left;
          if (!leftPage) continue;
          const spreadNumber = Math.floor((leftPage - book.starting_page) / 2) + 1;
          if (spreadNumber <= 0) continue;
          const placeholders = savedFlightIds.map(() => '?').join(',');
          await db.runAsync(
            `UPDATE flights SET book_id=?, spread_number=? WHERE id IN (${placeholders}) AND book_id=0`,
            [book.id, spreadNumber, ...savedFlightIds],
          );
          await db.runAsync(
            `UPDATE logbook_books SET transcribed_spreads = MAX(transcribed_spreads, ?) WHERE id = ?`,
            [spreadNumber, book.id],
          );
        }
      }

      await Promise.all([loadFlights(), loadStats()]);

      const pageLabel = scannedPageNumbers
        .filter((p) => p.left)
        .map((p) => `${p.left}–${p.right ?? (p.left! + 1)}`)
        .join(', ');
      const bookNote = pageLabel ? `\n${t('linked_to_book')}: ${book?.name ?? ''} . ${t('page')} ${pageLabel}` : '';

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        t('done_exclamation'),
        `${saved} ${t('flights_saved')}${skipped > 0 ? ` . ${skipped} ${t('skipped')}` : ''}${duplicates > 0 ? ` . ${duplicates} ${t('duplicates_skipped')}` : ''}${bookNote}`,
        [{ text: 'OK', onPress: () => router.dismissAll() }]
      );
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    if (!canAddFlight()) {
      Alert.alert(t('limit_reached'), t('limit_reached_upgrade'));
      return;
    }
    doSave();
  };

  // ── Close with confirmation ─────────────────────────────────────────────────

  const handleClose = () => {
    if (Object.keys(wizardDecisions).length > 0) {
      Alert.alert(
        t('exit_without_saving'),
        t('exit_without_saving_body'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('exit_btn'), style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  };

  // ── Helper: get field value from row (with wizard edits overlay) ────────────

  const getEditedValue = (rowIdx: number, field: string): string => {
    if (wizardEdits[rowIdx] && wizardEdits[rowIdx][field] !== undefined) {
      return String(wizardEdits[rowIdx][field]);
    }
    return String((rows[rowIdx]?.data as any)?.[field] ?? '');
  };

  const setWizardEdit = (rowIdx: number, field: string, value: any) => {
    setWizardEdits(prev => ({
      ...prev,
      [rowIdx]: { ...(prev[rowIdx] ?? {}), [field]: value },
    }));
    // Also update the row directly for immediate visual feedback
    updateField(rowIdx, field as any, value);
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // ── RENDER ────────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Loading state ──
  if (scanning) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.scanningText}>{t('analysing_with_claude')}</Text>
        <Text style={styles.scanningSubtext}>{t('ten_to_thirty_seconds')}</Text>
      </View>
    );
  }

  // ── Error state ──
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

  // ── Aircraft confirmation gate ──
  if (!aircraftConfirmed && detections.length > 0) {
    return (
      <View style={styles.container}>
        <View style={styles.acHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.acHeaderTitle}>Steg 1 av 2: Bekrafta luftfartyg</Text>
            <Text style={styles.acHeaderSub}>Ratta innan vi gar till flygningarna — uppdaterar alla rader</Text>
          </View>
        </View>
        <AircraftConfirmation
          detections={detections}
          savedTypes={savedAircraftTypes}
          onConfirm={(corrections) => {
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

  // ── Calibration banner (batch mode, page 1 done) ──
  if (!calibrationDone && !batchRunning && batchTotal > 1) {
    return (
      <View style={styles.container}>
        <View style={styles.wizardHeader}>
          <TouchableOpacity onPress={handleClose} style={styles.headerBtn}>
            <Ionicons name="close" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={styles.headerLabel}>{t('calibration_page_title').toUpperCase()}</Text>
          </View>
          <View style={styles.headerBtn} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View style={{
            padding: 14, borderRadius: 12,
            backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '55',
            gap: 8,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="school" size={16} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontSize: 14, fontWeight: '800' }}>
                {t('calibration_page_title')}
              </Text>
            </View>
            <Text style={{ color: Colors.textSecondary, fontSize: 13, lineHeight: 18 }}>
              {t('calibration_page_body')}
            </Text>
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary, marginTop: 4,
              }}
              onPress={handleCalibrationConfirm}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>
                {t('calibration_confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Check for unresolved ICAO — blockerar bara om fältet INTE ändrats ──
  const currentHasUnresolvedIcao = currentRow ? (currentRow.data.field_issues ?? []).some(
    (i) => {
      if (!(i.field === 'dep_place' || i.field === 'arr_place') || !i.reason.includes('ICAO')) return false;
      // Om användaren ändrat fältet → inte längre blockerat
      const current = String((currentRow.data as any)[i.field] ?? '');
      const original = String((currentRow.original as any)[i.field] ?? '');
      return current === original; // blockerad bara om oförändrat
    },
  ) : false;

  // ══════════════════════════════════════════════════════════════════════════════
  // ── WIZARD UI ─────────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <View style={styles.container}>
      {/* ── Wizard Header ── */}
      <View style={styles.wizardHeader}>
        <TouchableOpacity onPress={handleClose} style={styles.headerBtn}>
          <Ionicons name="close" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={styles.headerLabel}>
            {atEnd ? t('review_done') : t('review_problems')}
          </Text>
          {!atEnd && (
            <Text style={styles.headerProgress}>
              {wizardCursor + 1} / {flaggedIdx.length}
            </Text>
          )}
          {atEnd && (
            <Text style={[styles.headerProgress, { color: Colors.success }]}>
              {'\u2713'} {t('review_done')}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={undoWizard}
          style={[styles.headerBtn, wizardCursor === 0 && { opacity: 0.3 }]}
          disabled={wizardCursor === 0}
        >
          <Ionicons name="arrow-undo" size={18} color={wizardCursor === 0 ? Colors.textMuted : Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* ── Progress dots ── */}
      {flaggedIdx.length > 0 && (
        <View style={styles.progressRow}>
          {flaggedIdx.map((_, i) => {
            let bgColor = Colors.border; // future
            if (i === wizardCursor && !atEnd) bgColor = Colors.primary; // current
            else if (wizardDecisions[flaggedIdx[i]] === 'corrected') bgColor = Colors.success;
            else if (wizardDecisions[flaggedIdx[i]] === 'skip') bgColor = Colors.textMuted;
            return <View key={i} style={[styles.progressDot, { backgroundColor: bgColor }]} />;
          })}
        </View>
      )}

      {/* ── Batch progress bar ── */}
      {batchRunning && batchTotal > 1 && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 11, marginBottom: 4 }}>
            {t('batch_scanning')} {batchDone}/{batchTotal}...
          </Text>
          <View style={{ height: 3, backgroundColor: Colors.elevated, borderRadius: 2 }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: Colors.primary, width: `${(batchDone / batchTotal) * 100}%` }} />
          </View>
        </View>
      )}

      {/* ── Page warning ── */}
      {pageWarning && (
        <View style={styles.pageWarning}>
          <Ionicons name="warning" size={14} color={Colors.warning} />
          <Text style={styles.pageWarningText}>{pageWarning}</Text>
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {atEnd ? (
          /* ════════════════════════════════════════════════════════════════════
             DONE STATE
             ════════════════════════════════════════════════════════════════════ */
          <ScrollView contentContainerStyle={styles.doneContainer} keyboardShouldPersistTaps="handled">
            {/* Hero */}
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={styles.doneHero}>
                <Ionicons name="checkmark" size={38} color={Colors.success} />
              </View>
              <Text style={styles.doneTitle}>{t('all_done_title')}</Text>
              <Text style={styles.doneSub}>{t('all_done_sub')}</Text>
            </View>

            {/* Summary card */}
            <View style={styles.summaryCard}>
              <SummaryRow icon="flash" iconColor={Colors.success} label={t('auto_approved')} count={fastTrackCount} />
              <SummaryRow icon="checkmark-circle" iconColor={Colors.success} label={t('manually_approved')} count={manuallyApprovedCount} />
              <SummaryRow icon="remove-circle" iconColor={Colors.textMuted} label={t('skipped_count')} count={skippedCount} isLast />
            </View>

            {/* Info box */}
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={14} color={Colors.primary} />
              <Text style={styles.infoText}>{t('first_review_disclaimer')}</Text>
            </View>

            {/* Action buttons */}
            <View style={styles.doneActions}>
              <TouchableOpacity
                style={styles.reviewAgainBtn}
                onPress={() => {
                  setWizardCursor(0);
                  setShowAllFields(false);
                  scrollRef.current?.scrollTo({ y: 0, animated: true });
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.reviewAgainText}>{t('review_again')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.importBtn, saving && { opacity: 0.5 }]}
                onPress={saveAll}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color={Colors.textInverse} size="small" />
                  : <Text style={styles.importBtnText}>
                      {t('import_n_flights').replace('{n}', String(totalToSave))}
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : currentRow ? (
          /* ════════════════════════════════════════════════════════════════════
             WIZARD CARD — one flagged row at a time
             ════════════════════════════════════════════════════════════════════ */
          <>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.wizardBody}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {/* 1. Image preview card med highlight + crop — scrollbar */}
              {(() => {
                const pageIdx = Math.min(Math.floor(currentFlaggedRowIdx / 12), scanImages.length - 1);
                if (pageIdx < 0 || !scanImages[pageIdx]) return null;
                const rowYPct = currentRow?.data?.row_y_pct;
                const issues = currentRow?.data?.field_issues ?? [];
                // Logbook bounds — crop visuellt till bara loggboken
                const bounds = scanLayouts[pageIdx] ?? { x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 };
                const fullW = 800;
                const fullH = 500;
                // Skala upp: bilden visas i full storlek men vi offsettar till loggbokens area
                const cropX = (bounds.x_pct / 100) * fullW;
                const cropY = (bounds.y_pct / 100) * fullH;
                const imgW = (bounds.w_pct / 100) * fullW;
                const imgH = (bounds.h_pct / 100) * fullH;
                // Auto-scroll till rad-position (relativt croppat område)
                const relativeRowY = rowYPct != null
                  ? Math.max(0, ((rowYPct - bounds.y_pct) / bounds.h_pct) * imgH - 90)
                  : 0;
                return (
                  <View style={[styles.imageCard, { height: 200 }]}>
                    <ScrollView
                      horizontal
                      contentOffset={{ x: 0, y: 0 }}
                      showsHorizontalScrollIndicator={false}
                      showsVerticalScrollIndicator={false}
                      style={{ height: 200 }}
                    >
                      <ScrollView
                        contentOffset={{ x: 0, y: relativeRowY }}
                        showsVerticalScrollIndicator={false}
                        nestedScrollEnabled
                      >
                        <View style={{ width: imgW, height: imgH, overflow: 'hidden' }}>
                          <Image
                            source={{ uri: `data:image/jpeg;base64,${scanImages[pageIdx]}` }}
                            style={{
                              width: fullW, height: fullH,
                              marginLeft: -cropX,
                              marginTop: -cropY,
                            }}
                            resizeMode="contain"
                          />
                          {/* Rad-highlight — relativ till croppat område */}
                          {rowYPct != null && (
                            <View
                              style={{
                                position: 'absolute',
                                top: ((rowYPct - bounds.y_pct) / bounds.h_pct) * imgH - 12,
                                left: 0, width: imgW, height: 24,
                                backgroundColor: Colors.warning + '30',
                                borderTopWidth: 2, borderBottomWidth: 2,
                                borderColor: Colors.warning,
                              }}
                            />
                          )}
                          {/* Fält-highlights */}
                          {issues.map((issue, i) => (
                            issue.x_pct != null && rowYPct != null ? (
                              <View
                                key={i}
                                style={{
                                  position: 'absolute',
                                  top: ((rowYPct - bounds.y_pct) / bounds.h_pct) * imgH - 12,
                                  left: ((issue.x_pct - bounds.x_pct) / bounds.w_pct) * imgW - 20,
                                  width: 40, height: 24,
                                  borderWidth: 2, borderColor: Colors.danger,
                                  borderRadius: 4,
                                  backgroundColor: Colors.danger + '25',
                                }}
                              />
                            ) : null
                          ))}
                        </View>
                      </ScrollView>
                    </ScrollView>
                    <TouchableOpacity
                      style={styles.expandBtn}
                      onPress={() => setPopupImage({
                        base64: scanImages[pageIdx],
                        rowIndex: currentFlaggedRowIdx % 12,
                        totalRows: 12,
                      })}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="expand" size={10} color="#FFF" />
                      <Text style={styles.expandBtnText}>{t('expand_image')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}

              {/* 2. Row summary card */}
              <View style={styles.rowSummaryCard}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={styles.routeText}>
                    {currentRow.data.dep_place || '----'} {'\u2192'} {currentRow.data.arr_place || '----'}
                  </Text>
                  <Text style={styles.dateText}>{currentRow.data.date}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: Colors.gold, fontSize: 13, fontWeight: '800', fontFamily: 'Menlo' }}>
                    Rad {currentFlaggedRowIdx + 1}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <Text style={styles.metaText}>
                    {currentRow.data.dep_utc || '--:--'}–{currentRow.data.arr_utc || '--:--'}
                    {' '}{'\u00B7'}{' '}{currentRow.data.aircraft_type} {currentRow.data.registration}
                    {' '}{'\u00B7'}{' '}
                    <Text style={{ color: Colors.textSecondary, fontWeight: '700' }}>
                      {(parseFloat(currentRow.data.total_time) || 0).toFixed(1)}h
                    </Text>
                  </Text>
                </View>
              </View>

              {/* 3. Problem section */}
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Ionicons name="alert-circle" size={14} color={Colors.warning} />
                  <Text style={styles.problemLabel}>{t('what_needs_checking')}</Text>
                </View>
                <Text style={styles.reviewReasonText}>
                  {currentRow.data.review_reason ?? t('review_before_saving')}
                </Text>
              </View>

              {/* 3a. TimeMismatch block */}
              {currentRow.data.time_mismatch && (
                <View style={{ marginTop: 12 }}>
                  <TimeMismatchBlock
                    tm={currentRow.data.time_mismatch}
                    onAcceptDep={() => {
                      if (!currentRow.data.time_mismatch) return;
                      updateField(currentFlaggedRowIdx, 'arr_utc', currentRow.data.time_mismatch.computed_arr_if_dep_correct);
                      updateField(currentFlaggedRowIdx, 'time_mismatch' as any, null as any);
                    }}
                    onAcceptArr={() => {
                      if (!currentRow.data.time_mismatch) return;
                      updateField(currentFlaggedRowIdx, 'dep_utc', currentRow.data.time_mismatch.computed_dep_if_arr_correct);
                      updateField(currentFlaggedRowIdx, 'time_mismatch' as any, null as any);
                    }}
                  />
                </View>
              )}

              {/* 3b. RemarksSuggestion block */}
              {currentRow.data.remarks_suggestion && (
                <View style={{ marginTop: 12 }}>
                  <RemarksSuggestionBlock
                    suggestion={currentRow.data.remarks_suggestion}
                    onAccept={() => {
                      const s = currentRow.data.remarks_suggestion!;
                      updateField(currentFlaggedRowIdx, s.field as keyof OcrFlightResult, s.value);
                      const cleaned = (currentRow.data.remarks ?? '').replace(s.original_text, '').replace(/\s{2,}/g, ' ').trim();
                      updateField(currentFlaggedRowIdx, 'remarks', cleaned);
                      updateField(currentFlaggedRowIdx, 'remarks_suggestion' as any, null as any);
                      if (s.field === 'second_pilot') {
                        saveLearnedMapping('second_pilot', s.original_text, s.value);
                      }
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                    onReject={() => updateField(currentFlaggedRowIdx, 'remarks_suggestion' as any, null as any)}
                  />
                </View>
              )}

              {/* 3c. FieldEditor per field_issue */}
              {(currentRow.data.field_issues ?? []).length > 0 && (
                <View style={{ marginTop: 12, gap: 6 }}>
                  {(currentRow.data.field_issues ?? []).map((issue, i) => {
                    const pageIdx = Math.min(Math.floor(currentFlaggedRowIdx / 12), scanImages.length - 1);
                    return (
                      <FieldEditor
                        key={`${issue.field}-${i}`}
                        issue={issue}
                        value={String((currentRow.data as any)[issue.field] ?? '')}
                        originalValue={String((currentRow.original as any)[issue.field] ?? '')}
                        suggestedValue={issue.suggested_value}
                        onChangeText={(v) => {
                          updateField(currentFlaggedRowIdx, issue.field as any, v);
                        }}
                        onShowImage={scanImages[pageIdx] ? () => setPopupImage({
                          base64: scanImages[pageIdx],
                          rowIndex: currentRow.data.row_y_pct ?? (currentFlaggedRowIdx % 12) * (100 / 12),
                          totalRows: 100,
                          fieldXPct: issue.x_pct,
                        }) : undefined}
                      />
                    );
                  })}
                </View>
              )}

              {/* Unknown ICAO warning */}
              {currentHasUnresolvedIcao && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: Colors.danger + '14', borderRadius: 8, padding: 8, marginTop: 12,
                  borderWidth: 0.5, borderColor: Colors.danger + '55',
                }}>
                  <Ionicons name="alert-circle" size={13} color={Colors.danger} />
                  <Text style={{ color: Colors.danger, fontSize: 11, fontWeight: '700', flex: 1 }}>
                    {t('unknown_icao_block')}
                  </Text>
                </View>
              )}

              {/* 4. "Visa alla falt" collapsible */}
              <Pressable
                onPress={() => setShowAllFields(v => !v)}
                style={styles.showAllToggle}
              >
                <Ionicons name="list" size={14} color={Colors.textSecondary} />
                <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textSecondary }}>
                  {showAllFields ? t('hide_fields') : t('show_all_fields')}
                </Text>
                <Ionicons name={showAllFields ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textMuted} />
              </Pressable>

              {showAllFields && (
                <View style={styles.miniFieldGrid}>
                  <MiniFieldDate value={currentRow.data.date ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'date', v)} />
                  <MiniField label="REG" value={currentRow.data.registration ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'registration', v.toUpperCase())} />
                  <MiniFieldIcao label="DEP" value={currentRow.data.dep_place ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'dep_place', v)} onAddTemp={() => {
                    const code = currentRow.data.dep_place?.toUpperCase();
                    if (code) { setUnknownIcaos(prev => new Set([...prev, code])); Alert.alert('Tillfällig plats', `${code} sparas som tillfällig landningsplats`); }
                  }} />
                  <MiniFieldIcao label="ARR" value={currentRow.data.arr_place ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'arr_place', v)} onAddTemp={() => {
                    const code = currentRow.data.arr_place?.toUpperCase();
                    if (code) { setUnknownIcaos(prev => new Set([...prev, code])); Alert.alert('Tillfällig plats', `${code} sparas som tillfällig landningsplats`); }
                  }} />
                  <MiniFieldTime label="DEP UTC" value={currentRow.data.dep_utc ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'dep_utc', v)} />
                  <MiniFieldTime label="ARR UTC" value={currentRow.data.arr_utc ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'arr_utc', v)} />
                  <MiniFieldNum label="TOTAL" value={currentRow.data.total_time ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'total_time', v)} />
                  <MiniFieldNum label="PIC" value={currentRow.data.pic ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'pic', v)} />
                  <MiniFieldNum label="DUAL" value={currentRow.data.dual ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'dual', v)} />
                  <MiniFieldNum label="IFR" value={currentRow.data.ifr ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'ifr', v)} />
                  <MiniFieldNum label="NIGHT" value={currentRow.data.night ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'night', v)} />
                  <MiniFieldNum label="LDG DAY" value={currentRow.data.landings_day ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'landings_day', v)} />
                  <MiniFieldNum label="LDG NIGHT" value={currentRow.data.landings_night ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'landings_night', v)} />
                  <MiniField label="REMARKS" value={currentRow.data.remarks ?? ''} onChangeText={v => updateField(currentFlaggedRowIdx, 'remarks', v)} />
                </View>
              )}

              {/* Spacer for bottom bar */}
              <View style={{ height: 100 }} />
            </ScrollView>

            {/* ── Bottom action bar ── */}
            <View style={styles.bottomBar}>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={() => advanceWizard('skip')}
                activeOpacity={0.7}
              >
                <Text style={styles.skipBtnText}>{t('skip')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.approveBtn, currentHasUnresolvedIcao && { opacity: 0.35 }]}
                onPress={() => {
                  if (currentHasUnresolvedIcao) {
                    Alert.alert(t('unknown_icao_block_title'), t('unknown_icao_block_body'));
                    return;
                  }
                  advanceWizard('corrected');
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.approveBtnText}>{t('approve')}</Text>
                <Ionicons name="arrow-forward" size={16} color={Colors.textInverse} />
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </KeyboardAvoidingView>

      {/* ── Fullscreen image overlay ── */}
      {popupImage && (() => {
        // Zoom 2x inzoomat — visa bara ~50% av bildens bredd och ~20% höjd
        const scale = 2.0;
        const imgW = 800 * scale;
        const imgH = 500 * scale;
        const rowYPct = popupImage.rowIndex;  // redan i procent (0-100)
        const fieldXPct = popupImage.fieldXPct ?? 50;
        // Centrera scroll på fältet
        const scrollX = Math.max(0, (fieldXPct / 100) * imgW - 180);
        const scrollY = Math.max(0, (rowYPct / 100) * imgH - 60);
        return (
          <Modal transparent visible animationType="fade" onRequestClose={() => setPopupImage(null)}>
            <Pressable
              style={{ flex: 1, backgroundColor: '#000000EE', justifyContent: 'center', padding: 14 }}
              onPress={() => setPopupImage(null)}
            >
              <Pressable onPress={(e) => e.stopPropagation()}>
                <View style={{ height: 160, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: Colors.warning }}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentOffset={{ x: scrollX, y: 0 }}
                  >
                    <ScrollView
                      showsVerticalScrollIndicator={false}
                      contentOffset={{ x: 0, y: scrollY }}
                      nestedScrollEnabled
                    >
                      <View style={{ width: imgW, height: imgH }}>
                        <Image
                          source={{ uri: `data:image/jpeg;base64,${popupImage.base64}` }}
                          style={{ width: imgW, height: imgH }}
                          resizeMode="contain"
                        />
                        {/* Gul highlight-ruta på texten */}
                        <View style={{
                          position: 'absolute',
                          top: (rowYPct / 100) * imgH - 14,
                          left: (fieldXPct / 100) * imgW - 40,
                          width: 80, height: 28,
                          backgroundColor: Colors.warning + '30',
                          borderWidth: 2.5, borderColor: Colors.warning,
                          borderRadius: 6,
                        }} />
                      </View>
                    </ScrollView>
                  </ScrollView>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => setPopupImage(null)}
                    style={{ backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>Stäng</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── STYLES ──────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function makeStyles() {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },

  // ── Scanning / error ──
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

  // ── Aircraft confirmation header ──
  acHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 12,
  },
  acHeaderTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  acHeaderSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },

  // ── Wizard header ──
  wizardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 54, paddingHorizontal: 16, paddingBottom: 6,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
  },
  headerLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  headerProgress: {
    fontSize: 15, fontWeight: '800', letterSpacing: -0.2,
    fontFamily: mono, color: Colors.textPrimary, marginTop: 1,
  },

  // ── Progress dots ──
  progressRow: {
    flexDirection: 'row', gap: 3, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface,
  },
  progressDot: {
    flex: 1, height: 3, borderRadius: 2,
  },

  // ── Page warning ──
  pageWarning: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: Colors.warning + '18', padding: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.warning + '44',
  },
  pageWarningText: { color: Colors.warning, fontSize: 12, flex: 1 },

  // ── Wizard body ──
  wizardBody: {
    padding: 16, paddingBottom: 20,
  },

  // ── Image card ──
  imageCard: {
    borderRadius: 12, overflow: 'hidden', height: 180,
    backgroundColor: Colors.card, marginBottom: 12,
  },
  expandBtn: {
    position: 'absolute', bottom: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  expandBtnText: {
    color: '#FFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.3,
  },

  // ── Row summary card ──
  rowSummaryCard: {
    padding: 12, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  routeText: {
    fontSize: 19, fontWeight: '800', letterSpacing: -0.3,
    color: Colors.textPrimary, fontFamily: mono,
  },
  dateText: {
    fontSize: 13, fontWeight: '600', color: Colors.textSecondary, fontFamily: mono,
  },
  metaText: {
    fontSize: 11, color: Colors.textMuted, fontFamily: mono,
  },

  // ── Problem section ──
  problemLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
    color: Colors.warning,
  },
  reviewReasonText: {
    fontSize: 14, color: Colors.textPrimary, lineHeight: 21, marginBottom: 4,
  },

  // ── Show all fields toggle ──
  showAllToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    marginTop: 16,
  },
  miniFieldGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    padding: 12, borderRadius: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
    marginTop: 8,
  },

  // ── Bottom bar ──
  bottomBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 24,
    backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  skipBtn: {
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  skipBtnText: {
    fontSize: 13, fontWeight: '700', color: Colors.textMuted,
  },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14,
    backgroundColor: Colors.success,
  },
  approveBtnText: {
    fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: Colors.textInverse,
  },

  // ── Done state ──
  doneContainer: {
    padding: 20, paddingTop: 24,
  },
  doneHero: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.success + '20', borderWidth: 2, borderColor: Colors.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  doneTitle: {
    fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: Colors.textPrimary,
  },
  doneSub: {
    fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginTop: 6, textAlign: 'center',
  },
  summaryCard: {
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
    marginBottom: 12,
  },
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    padding: 10, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '40',
    marginBottom: 20,
  },
  infoText: {
    flex: 1, fontSize: 11, color: Colors.textSecondary, lineHeight: 16,
  },
  doneActions: {
    flexDirection: 'row', gap: 8, marginTop: 'auto' as any,
  },
  reviewAgainBtn: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewAgainText: {
    fontSize: 13, fontWeight: '700', color: Colors.textSecondary,
  },
  importBtn: {
    flex: 1, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  importBtnText: {
    fontSize: 15, fontWeight: '800', letterSpacing: -0.2, color: Colors.textInverse,
  },

  // ── Field row (shared by sub-components) ──
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  fieldLabel: { color: Colors.textMuted, fontSize: 11, width: 56 },
  fieldInput: {
    flex: 1, color: Colors.textPrimary, fontSize: 13,
    paddingVertical: 2, paddingHorizontal: 4,
  },
  fieldMono: { fontFamily: mono, fontVariant: ['tabular-nums'] },
  fieldChanged: { color: Colors.success },
  fieldOriginal: {
    color: Colors.textMuted, fontSize: 10,
    textDecorationLine: 'line-through', marginLeft: 4,
  },
  });
}
