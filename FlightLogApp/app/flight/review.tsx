import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ocrScanLogbook } from '../../services/ocr';
import { insertFlight } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { validatePageTotals } from '../../utils/validation';
import type { OcrFlightResult } from '../../types/flight';

type RowDecision = 'pending' | 'keep' | 'corrected' | 'skip';

interface ReviewRow {
  data: OcrFlightResult;
  original: OcrFlightResult;
  decision: RowDecision;
  reason: string;
}

export default function ReviewScreen() {
  const router = useRouter();
  const { loadFlights, loadStats, canAddFlight } = useFlightStore();

  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [pageTotals, setPageTotals] = useState<any>(null);
  const [pageWarning, setPageWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disclaimerShown, setDisclaimerShown] = useState(false);

  useEffect(() => {
    {
      ocrScanLogbook()
        .then(({ flights, pageTotals: pt }) => {
          setRows(flights.map((f) => ({
            data: { ...f },
            original: { ...f },
            decision: f.needs_review ? 'pending' : 'keep',
            reason: '',
          })));
          setPageTotals(pt);

          // Sidvalidering
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
    }
  }, []);

  const updateField = (idx: number, key: keyof OcrFlightResult, val: string) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        data: { ...copy[idx].data, [key]: val },
        decision: 'corrected',
      };
      return copy;
    });
  };

  const setDecision = (idx: number, decision: RowDecision, reason = '') => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], decision, reason };
      return copy;
    });
  };

  const saveAll = async () => {
    if (!canAddFlight()) {
      Alert.alert('Gränsen nådd', 'Uppgradera till Premium för obegränsat antal flygningar.');
      return;
    }

    setSaving(true);
    let saved = 0;
    let skipped = 0;

    try {
      for (const row of rows) {
        if (row.decision === 'skip') { skipped++; continue; }

        const originalData = JSON.stringify(row.original);
        const status = row.data.needs_review && row.decision !== 'corrected' ? 'flagged' : 'scanned';

        await insertFlight(row.data, {
          source: 'ocr',
          originalData,
        });
        saved++;
      }

      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert(
        'Klart!',
        `${saved} flygningar sparade.${skipped > 0 ? ` ${skipped} hoppades över.` : ''}`,
        [{ text: 'OK', onPress: () => router.dismissAll() }]
      );
    } finally {
      setSaving(false);
    }
  };

  // Ansvarsfriskrivning
  if (!disclaimerShown && !scanning && !error) {
    return (
      <View style={styles.disclaimerContainer}>
        <View style={styles.disclaimerCard}>
          <Ionicons name="shield-checkmark" size={40} color={Colors.primary} />
          <Text style={styles.disclaimerTitle}>Viktig information</Text>
          <Text style={styles.disclaimerText}>
            Denna app digitaliserar din loggbok som den är skriven. Du ansvarar för att korrigera eventuella fel
            i enlighet med EASA FCL.050 regler för loggbokskorrigering.{'\n\n'}
            Appen flaggar misstänkta fel — du beslutar alltid vad som sparas. Originaldata bevaras alltid i sin helhet.
          </Text>
          <TouchableOpacity style={styles.disclaimerBtn} onPress={() => setDisclaimerShown(true)}>
            <Text style={styles.disclaimerBtnText}>Jag förstår — visa granskning</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (scanning) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.scanningText}>Analyserar med Claude AI...</Text>
        <Text style={styles.scanningSubtext}>10–30 sekunder</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle" size={48} color={Colors.danger} />
        <Text style={styles.errorTitle}>Skanningen misslyckades</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
          <Text style={styles.retryBtnText}>Tillbaka</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const flaggedCount = rows.filter((r) => r.data.needs_review && r.decision === 'pending').length;
  const toSave = rows.filter((r) => r.decision !== 'skip').length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{rows.length} rader hittades</Text>
          {flaggedCount > 0 && (
            <Text style={styles.flaggedText}>{flaggedCount} rader behöver granskning</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.saveAllBtn, saving && { opacity: 0.6 }]}
          onPress={saveAll}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={Colors.textInverse} size="small" />
            : <Text style={styles.saveAllText}>Spara {toSave}</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Sidvarning */}
      {pageWarning && (
        <View style={styles.pageWarning}>
          <Ionicons name="warning" size={14} color={Colors.danger} />
          <Text style={styles.pageWarningText}>{pageWarning}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {rows.map((row, idx) => (
          <FlightReviewCard
            key={idx}
            idx={idx}
            row={row}
            onChange={(key, val) => updateField(idx, key, val)}
            onDecision={(d, reason) => setDecision(idx, d, reason)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function FlightReviewCard({
  idx, row, onChange, onDecision,
}: {
  idx: number;
  row: ReviewRow;
  onChange: (key: keyof OcrFlightResult, val: string) => void;
  onDecision: (d: RowDecision, reason?: string) => void;
}) {
  const flagged = row.data.needs_review;
  const skipped = row.decision === 'skip';

  return (
    <View style={[
      styles.card,
      flagged && row.decision === 'pending' && styles.cardFlagged,
      skipped && styles.cardSkipped,
      row.decision === 'corrected' && styles.cardCorrected,
    ]}>
      {/* Card header */}
      <View style={styles.cardHeader}>
        <Text style={styles.cardRoute}>
          {row.data.dep_place || '???'} → {row.data.arr_place || '???'}
        </Text>
        <Text style={styles.cardDate}>{row.data.date}</Text>

        {/* Status-badge */}
        <View style={[
          styles.statusBadge,
          row.decision === 'skip' && { backgroundColor: Colors.textMuted + '33' },
          row.decision === 'corrected' && { backgroundColor: Colors.success + '33' },
          row.decision === 'pending' && flagged && { backgroundColor: Colors.danger + '33' },
          row.decision === 'keep' && { backgroundColor: Colors.primary + '33' },
        ]}>
          <Text style={styles.statusText}>
            {row.decision === 'skip' ? 'Hoppa över'
              : row.decision === 'corrected' ? 'Korrigerad'
              : row.decision === 'keep' && !flagged ? 'Godkänd'
              : 'Granskas'}
          </Text>
        </View>
      </View>

      {/* Flaggad varning */}
      {flagged && row.decision === 'pending' && (
        <View style={styles.flagBox}>
          <Ionicons name="warning" size={14} color={Colors.danger} />
          <Text style={styles.flagText}>{row.data.review_reason ?? 'Misstänkt fel — granska'}</Text>
        </View>
      )}

      {/* Fält */}
      {!skipped && (
        <View style={styles.fields}>
          <Row label="Datum" value={row.data.date} onChange={(v) => onChange('date', v)} flagged={flagged && !row.data.date} original={row.original.date} />
          <Row label="Typ" value={row.data.aircraft_type} onChange={(v) => onChange('aircraft_type', v)} original={row.original.aircraft_type} />
          <Row label="Reg" value={row.data.registration} onChange={(v) => onChange('registration', v)} original={row.original.registration} />
          <Row label="Avgång" value={row.data.dep_place} onChange={(v) => onChange('dep_place', v.toUpperCase())} flagged={flagged} original={row.original.dep_place} mono />
          <Row label="Avg.tid" value={row.data.dep_utc} onChange={(v) => onChange('dep_utc', v)} original={row.original.dep_utc} mono />
          <Row label="Ankomst" value={row.data.arr_place} onChange={(v) => onChange('arr_place', v.toUpperCase())} flagged={flagged} original={row.original.arr_place} mono />
          <Row label="Ank.tid" value={row.data.arr_utc} onChange={(v) => onChange('arr_utc', v)} original={row.original.arr_utc} mono />
          <Row label="Flygtid" value={row.data.total_time} onChange={(v) => onChange('total_time', v)} flagged={flagged} original={row.original.total_time} keyboardType="decimal-pad" />
          <Row label="PIC" value={row.data.pic} onChange={(v) => onChange('pic', v)} original={row.original.pic} keyboardType="decimal-pad" />
          <Row label="IFR" value={row.data.ifr} onChange={(v) => onChange('ifr', v)} original={row.original.ifr} keyboardType="decimal-pad" />
          <Row label="Natt" value={row.data.night} onChange={(v) => onChange('night', v)} original={row.original.night} keyboardType="decimal-pad" />
        </View>
      )}

      {/* Åtgärdsknappar för flaggade rader */}
      {flagged && row.decision === 'pending' && (
        <View style={styles.decisionRow}>
          <TouchableOpacity style={[styles.decisionBtn, styles.decisionKeep]} onPress={() => onDecision('keep')}>
            <Text style={styles.decisionText}>Behåll original</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.decisionBtn, styles.decisionCorrect]} onPress={() => onDecision('corrected')}>
            <Text style={styles.decisionText}>Korrigera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.decisionBtn, styles.decisionSkip]} onPress={() => onDecision('skip')}>
            <Text style={styles.decisionText}>Hoppa över</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Ångra hoppa-över */}
      {skipped && (
        <TouchableOpacity style={styles.undoBtn} onPress={() => onDecision('pending')}>
          <Ionicons name="arrow-undo" size={14} color={Colors.primary} />
          <Text style={styles.undoText}>Ångra</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function Row({
  label, value, onChange, mono, flagged, original, keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  flagged?: boolean;
  original?: string;
  keyboardType?: string;
}) {
  const changed = original !== undefined && value !== original;

  return (
    <View style={[styles.fieldRow, flagged && styles.fieldFlagged]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[
          styles.fieldInput,
          mono && styles.fieldMono,
          flagged && styles.fieldInputFlagged,
          changed && styles.fieldInputChanged,
        ]}
        value={value}
        onChangeText={onChange}
        autoCapitalize={mono ? 'characters' : 'none'}
        keyboardType={(keyboardType as any) ?? 'default'}
      />
      {changed && original && (
        <Text style={styles.originalValue}>{original}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  content: { padding: 12, paddingBottom: 40, gap: 10 },

  disclaimerContainer: { flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: 24 },
  disclaimerCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 24,
    gap: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  disclaimerTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800' },
  disclaimerText: { color: Colors.textSecondary, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  disclaimerBtn: {
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 24, paddingVertical: 12, alignSelf: 'stretch',
    alignItems: 'center', marginTop: 4,
  },
  disclaimerBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
  flaggedText: { color: Colors.danger, fontSize: 12, marginTop: 2 },
  saveAllBtn: {
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 90, alignItems: 'center',
  },
  saveAllText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },

  pageWarning: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: Colors.danger + '18', padding: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.danger + '44',
  },
  pageWarningText: { color: Colors.danger, fontSize: 12, flex: 1 },

  card: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  cardFlagged: { borderColor: Colors.danger + '88', backgroundColor: Colors.danger + '08' },
  cardSkipped: { opacity: 0.45 },
  cardCorrected: { borderColor: Colors.success + '88' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardRoute: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: 1, flex: 1 },
  cardDate: { color: Colors.textSecondary, fontSize: 12 },
  statusBadge: {
    backgroundColor: Colors.primary + '33', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  statusText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },

  flagBox: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: Colors.danger + '18', borderRadius: 6,
    padding: 8, marginBottom: 8,
  },
  flagText: { color: Colors.danger, fontSize: 12, flex: 1 },

  fields: { gap: 0 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  fieldFlagged: { backgroundColor: Colors.danger + '11' },
  fieldLabel: { color: Colors.textMuted, fontSize: 11, width: 60 },
  fieldInput: { flex: 1, color: Colors.textPrimary, fontSize: 13, paddingVertical: 2, paddingHorizontal: 4 },
  fieldMono: { fontVariant: ['tabular-nums'], letterSpacing: 0.5 },
  fieldInputFlagged: { color: Colors.danger },
  fieldInputChanged: { color: Colors.success },
  originalValue: { color: Colors.textMuted, fontSize: 10, textDecorationLine: 'line-through', marginLeft: 4 },

  decisionRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  decisionBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  decisionKeep: { backgroundColor: Colors.primary + '33' },
  decisionCorrect: { backgroundColor: Colors.success + '33' },
  decisionSkip: { backgroundColor: Colors.textMuted + '22' },
  decisionText: { color: Colors.textPrimary, fontSize: 11, fontWeight: '600' },

  undoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 6 },
  undoText: { color: Colors.primary, fontSize: 12 },

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
