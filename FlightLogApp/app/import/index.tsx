import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pickImportFile, importFromFile, type ImportResult } from '../../services/import';
import { insertFlight } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import type { OcrFlightResult } from '../../types/flight';

const SUPPORTED_FORMATS = [
  { name: 'ForeFlight', icon: 'airplane', ext: 'CSV' },
  { name: 'LogTen Pro', icon: 'document-text', ext: 'TXT' },
  { name: 'MyFlightbook', icon: 'book', ext: 'CSV' },
  { name: 'mccPILOTLOG', icon: 'grid', ext: 'CSV/XLS' },
  { name: 'Logbook Pro', icon: 'document', ext: 'CSV' },
  { name: 'APDL', icon: 'layers', ext: 'TXT' },
  { name: 'Eflightbook', icon: 'albums', ext: 'CSV' },
  { name: 'Generisk CSV', icon: 'code', ext: 'CSV' },
];

export default function ImportScreen() {
  const router = useRouter();
  const { loadFlights, loadStats } = useFlightStore();

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');

  const handlePick = async () => {
    const file = await pickImportFile();
    if (!file) return;

    setFileName(file.name);
    setImporting(true);
    setResult(null);
    setProgress({ current: 0, total: 0 });

    try {
      const res = await importFromFile(file.uri, (current, total) => {
        setProgress({ current, total });
      });
      setResult(res);
    } catch (e: any) {
      Alert.alert('Import misslyckades', e.message);
    } finally {
      setImporting(false);
    }
  };

  const saveAll = async () => {
    if (!result) return;
    setSaving(true);
    let saved = 0;
    try {
      for (const f of result.flights) {
        await insertFlight(f, { source: 'import' });
        saved++;
      }
      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert('Klart!', `${saved} flygningar importerade.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Fel vid sparning', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Importera loggbok</Text>
      <Text style={styles.subtitle}>
        Ladda upp en exportfil från din nuvarande loggboksapp. Claude identifierar formatet
        och mappar kolumnerna automatiskt.
      </Text>

      {/* Gratis-info */}
      <View style={styles.freeNotice}>
        <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
        <Text style={styles.freeNoticeText}>
          Import är alltid gratis — din data tillhör dig.
        </Text>
      </View>

      {/* Format-lista */}
      <Text style={styles.section}>Stöds format</Text>
      <View style={styles.formatGrid}>
        {SUPPORTED_FORMATS.map((f) => (
          <View key={f.name} style={styles.formatChip}>
            <Ionicons name={f.icon as any} size={14} color={Colors.primary} />
            <Text style={styles.formatName}>{f.name}</Text>
            <Text style={styles.formatExt}>{f.ext}</Text>
          </View>
        ))}
      </View>

      {/* Välj fil */}
      <TouchableOpacity
        style={[styles.pickBtn, importing && { opacity: 0.6 }]}
        onPress={handlePick}
        disabled={importing}
        activeOpacity={0.8}
      >
        {importing ? (
          <>
            <ActivityIndicator color={Colors.textInverse} size="small" />
            <Text style={styles.pickBtnText}>
              {progress.current === 0 ? 'Läser fil...' :
               progress.current === 1 ? 'Claude identifierar format...' :
               progress.current === 2 ? 'Tolkar rader...' :
               'Klar!'}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="cloud-upload" size={20} color={Colors.textInverse} />
            <Text style={styles.pickBtnText}>Välj fil att importera</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Förhandsvisning */}
      {result && (
        <>
          <View style={styles.resultHeader}>
            <View style={styles.resultInfo}>
              <Text style={styles.resultFormat}>{result.detectedFormat}</Text>
              <Text style={styles.resultFile} numberOfLines={1}>{fileName}</Text>
            </View>
            <View style={styles.resultStats}>
              <StatPill label="Rader" value={String(result.totalRows)} />
              <StatPill label="Mappade" value={String(result.mappedRows)} color={Colors.success} />
              {result.warnings.length > 0 && (
                <StatPill label="Varningar" value={String(result.warnings.length)} color={Colors.warning} />
              )}
            </View>
          </View>

          {/* Varningar */}
          {result.warnings.length > 0 && (
            <View style={styles.warningBox}>
              {result.warnings.map((w, i) => (
                <View key={i} style={styles.warningRow}>
                  <Ionicons name="warning" size={12} color={Colors.warning} />
                  <Text style={styles.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Förhandsvisning av flygningar */}
          <Text style={styles.section}>Förhandsvisning ({result.flights.length} flygningar)</Text>
          {result.flights.slice(0, 10).map((f, i) => (
            <FlightPreviewRow key={i} flight={f} />
          ))}
          {result.flights.length > 10 && (
            <Text style={styles.moreText}>... och {result.flights.length - 10} till</Text>
          )}

          {/* Spara-knapp */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={saveAll}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
                <Text style={styles.saveBtnText}>Importera {result.flights.length} flygningar</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            All importerad data sparas med källan "import" och kan granskas i ändringsloggen.
          </Text>
        </>
      )}

      {/* Instruktioner */}
      <Text style={styles.section}>Hur exporterar jag?</Text>
      {[
        { app: 'ForeFlight', steps: 'Logbook → Export → CSV' },
        { app: 'LogTen Pro', steps: 'File → Export → LogTen Pro' },
        { app: 'MyFlightbook', steps: 'Profile → Download → CSV' },
        { app: 'mccPILOTLOG', steps: 'Logbook → Export → CSV/Excel' },
      ].map(({ app, steps }) => (
        <View key={app} style={styles.instructionRow}>
          <Text style={styles.instructionApp}>{app}</Text>
          <Text style={styles.instructionSteps}>{steps}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function FlightPreviewRow({ flight }: { flight: OcrFlightResult }) {
  return (
    <View style={[styles.previewRow, flight.needs_review && styles.previewRowFlagged]}>
      <Text style={styles.previewRoute}>{flight.dep_place}→{flight.arr_place}</Text>
      <Text style={styles.previewDate}>{flight.date}</Text>
      <Text style={styles.previewTime}>{flight.total_time}h</Text>
      {flight.needs_review && (
        <Ionicons name="warning" size={12} color={Colors.warning} />
      )}
    </View>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

  freeNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.success + '18', borderRadius: 8,
    padding: 12, borderWidth: 1, borderColor: Colors.success + '44',
  },
  freeNoticeText: { color: Colors.success, fontSize: 13, fontWeight: '600' },

  section: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 8, marginBottom: 4,
  },

  formatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formatChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
  },
  formatName: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  formatExt: { color: Colors.textMuted, fontSize: 10 },

  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 15, gap: 8,
  },
  pickBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  resultHeader: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  resultInfo: { flex: 1 },
  resultFormat: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  resultFile: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  resultStats: { flexDirection: 'row', gap: 8 },
  statPill: { alignItems: 'center' },
  statValue: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
  statLabel: { color: Colors.textMuted, fontSize: 9, textTransform: 'uppercase' },

  warningBox: {
    backgroundColor: Colors.warning + '18', borderRadius: 10, padding: 12,
    gap: 6, borderWidth: 1, borderColor: Colors.warning + '44',
  },
  warningRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  warningText: { color: Colors.warning, fontSize: 12, flex: 1 },

  previewRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  previewRowFlagged: { borderColor: Colors.warning + '66' },
  previewRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', width: 90 },
  previewDate: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
  previewTime: { color: Colors.primary, fontSize: 13, fontWeight: '600' },
  moreText: { color: Colors.textMuted, fontSize: 12, textAlign: 'center' },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15, gap: 8, marginTop: 8,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
  hint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },

  instructionRow: {
    flexDirection: 'row', backgroundColor: Colors.card,
    borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  instructionApp: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', width: 110 },
  instructionSteps: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
});
