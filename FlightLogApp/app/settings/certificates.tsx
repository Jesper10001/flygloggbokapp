import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import {
  listCertificates, addCertificate, updateCertificate, deleteCertificate,
  certStatus, type DroneCertificate,
} from '../../db/drones';

const CERT_TYPES = ['A1/A3', 'A2', 'STS-01', 'STS-02', 'Operational Authorization', 'Other'];

// Default validity in years per certificate type (EASA reference values)
const CERT_DEFAULT_YEARS: Record<string, number> = {
  'A1/A3': 5,
  'A2': 5,
  'STS-01': 5,
  'STS-02': 5,
  'Operational Authorization': 2,
  'Other': 0,
};

function addYears(dateStr: string, years: number): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split('T')[0];
}

export default function CertificatesScreen() {
  const { t } = useTranslation();
  const styles = makeStyles();
  const [certs, setCerts] = useState<DroneCertificate[]>([]);
  const [editing, setEditing] = useState<DroneCertificate | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => setCerts(await listCertificates());
  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>{t('certificates_subtitle')}</Text>

      {certs.map((c) => {
        const status = certStatus(c.expires_date);
        const color =
          status === 'expired' ? Colors.danger :
          status === 'critical' ? Colors.danger :
          status === 'warning' ? Colors.warning :
          status === 'valid' ? Colors.success : Colors.textMuted;
        const daysText = c.expires_date ? daysUntil(c.expires_date) : t('no_expiry');
        return (
          <TouchableOpacity key={c.id} style={[styles.row, { borderLeftColor: color, borderLeftWidth: 3 }]} onPress={() => setEditing(c)} activeOpacity={0.75}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{c.cert_type}{c.label ? ` · ${c.label}` : ''}</Text>
              <Text style={[styles.rowMeta, { color }]}>{daysText}</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        );
      })}

      {certs.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyText}>{t('certificates_empty')}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} activeOpacity={0.8}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.addBtnText}>{t('add_certificate')}</Text>
      </TouchableOpacity>

      <CertForm
        visible={adding}
        initial={null}
        onClose={() => setAdding(false)}
        onSaved={async () => { await load(); setAdding(false); }}
      />
      <CertForm
        visible={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); setEditing(null); }}
      />
    </ScrollView>
  );
}

function daysUntil(dateStr: string): string {
  const exp = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return `Expired ${-days} days ago · ${dateStr}`;
  if (days === 0) return `Expires today · ${dateStr}`;
  if (days < 60) return `${days} days left · ${dateStr}`;
  return `Valid · ${dateStr}`;
}

function CertForm({
  visible, initial, onClose, onSaved,
}: {
  visible: boolean;
  initial: DroneCertificate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const styles = makeStyles();
  const [certType, setCertType] = useState(initial?.cert_type ?? 'A1/A3');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [issued, setIssued] = useState(initial?.issued_date ?? '');
  const [expires, setExpires] = useState(initial?.expires_date ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [showIssuedDate, setShowIssuedDate] = useState(false);
  const [showExpiresDate, setShowExpiresDate] = useState(false);

  // Reset when opening
  useCallback(() => {
    if (!visible) return;
    setCertType(initial?.cert_type ?? 'A1/A3');
    setLabel(initial?.label ?? '');
    setIssued(initial?.issued_date ?? '');
    setExpires(initial?.expires_date ?? '');
    setNotes(initial?.notes ?? '');
  }, [visible, initial?.id])();

  const save = async () => {
    const data = { cert_type: certType, label: label.trim(), issued_date: issued, expires_date: expires, notes: notes.trim() };
    if (!data.cert_type) { Alert.alert(t('error'), t('cert_type_required')); return; }
    if (initial) await updateCertificate(initial.id, data);
    else await addCertificate(data);
    onSaved();
  };

  const remove = () => {
    if (!initial) return;
    Alert.alert(t('delete'), initial.cert_type, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => { await deleteCertificate(initial.id); onSaved(); } },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{initial ? t('edit_certificate') : t('add_certificate')}</Text>
          <ScrollView style={{ maxHeight: '75%' }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>{t('cert_type')}</Text>
            <View style={styles.segRow}>
              {CERT_TYPES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.segBtn, certType === c && styles.segBtnActive]}
                  onPress={() => {
                    setCertType(c);
                    // Auto-fyll utgångsdatum baserat på typens default-giltighet, om det inte är manuellt satt
                    const years = CERT_DEFAULT_YEARS[c] ?? 0;
                    if (years > 0 && !expires) {
                      setExpires(addYears(issued || '', years));
                    }
                  }}
                >
                  <Text style={[styles.segText, certType === c && styles.segTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t('cert_label')}</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="SWE-RP-123"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>{t('issued_date')}</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowIssuedDate(true)} activeOpacity={0.7}>
              <Text style={[styles.dateBtnText, !issued && { color: Colors.textMuted }]}>{issued || 'YYYY-MM-DD'}</Text>
              <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
            </TouchableOpacity>

            <Text style={styles.label}>{t('expires_date')}</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowExpiresDate(true)} activeOpacity={0.7}>
              <Text style={[styles.dateBtnText, !expires && { color: Colors.textMuted }]}>{expires || 'YYYY-MM-DD'}</Text>
              <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
            </TouchableOpacity>

            <Text style={styles.label}>{t('notes')}</Text>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholderTextColor={Colors.textMuted}
            />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {initial && (
              <TouchableOpacity style={styles.dangerBtn} onPress={remove} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={15} color={Colors.danger} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.textInverse} />
              <Text style={styles.saveBtnText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>

        {showIssuedDate && Platform.OS === 'android' && (
          <DateTimePicker
            value={issued ? new Date(issued) : new Date()}
            mode="date"
            display="calendar"
            onChange={(e, d) => {
              setShowIssuedDate(false);
              if (e.type === 'set' && d) {
                const iso = d.toISOString().split('T')[0];
                setIssued(iso);
                const years = CERT_DEFAULT_YEARS[certType] ?? 0;
                if (years > 0 && !expires) setExpires(addYears(iso, years));
              }
            }}
          />
        )}
        {showExpiresDate && Platform.OS === 'android' && (
          <DateTimePicker
            value={expires ? new Date(expires) : new Date()}
            mode="date"
            display="calendar"
            onChange={(e, d) => {
              setShowExpiresDate(false);
              if (e.type === 'set' && d) setExpires(d.toISOString().split('T')[0]);
            }}
          />
        )}
        {Platform.OS === 'ios' && (showIssuedDate || showExpiresDate) && (
          <Modal visible transparent animationType="slide">
            <Pressable style={styles.modalBackdrop} onPress={() => { setShowIssuedDate(false); setShowExpiresDate(false); }}>
              <Pressable style={styles.datePickerSheet} onPress={(e) => e.stopPropagation()}>
                <TouchableOpacity style={{ alignSelf: 'flex-end', padding: 12 }} onPress={() => { setShowIssuedDate(false); setShowExpiresDate(false); }}>
                  <Text style={{ color: Colors.primary, fontWeight: '700' }}>{t('done')}</Text>
                </TouchableOpacity>
                <DateTimePicker
                  value={(showIssuedDate ? issued : expires) ? new Date(showIssuedDate ? issued : expires) : new Date()}
                  mode="date"
                  display="inline"
                  themeVariant="dark"
                  onChange={(_, d) => {
                    if (!d) return;
                    const iso = d.toISOString().split('T')[0];
                    if (showIssuedDate) {
                      setIssued(iso);
                      const years = CERT_DEFAULT_YEARS[certType] ?? 0;
                      if (years > 0 && !expires) setExpires(addYears(iso, years));
                    } else {
                      setExpires(iso);
                    }
                  }}
                />
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 60, gap: 10 },
    subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
    row: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    rowTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    rowMeta: { fontSize: 12, marginTop: 2, fontWeight: '600' },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    emptyText: { color: Colors.textMuted, fontSize: 13 },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6,
    },
    addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

    modalBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16,
      padding: 20, paddingBottom: 32, borderWidth: 1, borderColor: Colors.border,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 10 },
    sheetTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 8 },
    label: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 10, marginBottom: 4 },
    input: {
      backgroundColor: Colors.elevated, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14, paddingHorizontal: 10, paddingVertical: 9,
    },
    dateBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: Colors.elevated, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: 10, paddingVertical: 11,
    },
    dateBtnText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
    segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    segBtn: {
      paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    segBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    segText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
    segTextActive: { color: Colors.textInverse },

    saveBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
    dangerBtn: {
      paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
      borderRadius: 10, backgroundColor: Colors.danger + '18',
      borderWidth: 1, borderColor: Colors.danger + '44',
    },
    datePickerSheet: {
      backgroundColor: Colors.card, paddingBottom: 24, paddingTop: 8,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
  });
}
