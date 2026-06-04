import { useCallback, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppModeStore } from '../../store/appModeStore';
import { useProfileStore, isOperator } from '../../store/profileStore';
import {
  listCertificates, addCertificate, updateCertificate, deleteCertificate,
  certStatus, type DroneCertificate,
} from '../../db/drones';
import * as Haptics from 'expo-haptics';

const DRONE_CERT_TYPES = ['A1/A3', 'A2', 'STS-01', 'STS-02', 'Operational Authorization', 'Other'];

const MANNED_CERT_TYPES = [
  'ATPL', 'CPL', 'PPL', 'IR', 'Type Rating',
  'Medical Class 1', 'Medical Class 2', 'Medical LAPL',
  'Proficiency Check (PC)', 'Operator Proficiency Check (OPC)',
  'Line Check', 'CRM', 'Dangerous Goods',
  'PBN', 'RVSM', 'ETOPS', 'LVO / CAT II/III',
  'SEP', 'MEP', 'Instructor Rating',
  'English Language Proficiency',
  'Other',
];

const OPERATOR_CERT_TYPES = [
  'Crew Chief Qualification', 'Hoist Operator Cert', 'Rescue Swimmer Cert',
  'HEMS Crew Member', 'Loadmaster Cert',
  'Medical Class 2', 'Medical Class 3',
  'CRM', 'Underwater Escape Training',
  'Fire Fighting', 'First Aid',
  'NVG Qualification', 'Weapons Qualification',
  'Other',
];

function getCertTypes(mode: string, isOp: boolean): string[] {
  if (mode === 'drone') return DRONE_CERT_TYPES;
  if (isOp) return OPERATOR_CERT_TYPES;
  return MANNED_CERT_TYPES;
}

const CERT_DEFAULT_YEARS: Record<string, number> = {
  'A1/A3': 5, 'A2': 5, 'STS-01': 5, 'STS-02': 5, 'Operational Authorization': 2,
  'ATPL': 0, 'CPL': 0, 'PPL': 0, 'IR': 1, 'Type Rating': 1,
  'Medical Class 1': 1, 'Medical Class 2': 2, 'Medical LAPL': 2, 'Medical Class 3': 2,
  'Proficiency Check (PC)': 1, 'Operator Proficiency Check (OPC)': 1,
  'Line Check': 1, 'CRM': 3, 'Dangerous Goods': 2,
  'PBN': 0, 'RVSM': 0, 'ETOPS': 0, 'LVO / CAT II/III': 0,
  'SEP': 2, 'MEP': 1, 'Instructor Rating': 3,
  'English Language Proficiency': 4,
  'Crew Chief Qualification': 2, 'Hoist Operator Cert': 1, 'Rescue Swimmer Cert': 1,
  'HEMS Crew Member': 1, 'Loadmaster Cert': 2,
  'Underwater Escape Training': 4, 'Fire Fighting': 3, 'First Aid': 2,
  'NVG Qualification': 1, 'Weapons Qualification': 1,
  'Other': 0,
};

function addYears(dateStr: string, years: number): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split('T')[0];
}

function daysUntil(dateStr: string): { text: string; days: number } {
  const exp = new Date(dateStr);
  const days = Math.floor((exp.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `Expired ${-days}d ago`, days };
  if (days === 0) return { text: 'Expires today', days };
  if (days < 30) return { text: `${days} days left`, days };
  if (days < 365) return { text: `${Math.floor(days / 30)} months left`, days };
  return { text: `Valid`, days };
}

function statusColor(status: string): string {
  if (status === 'expired') return Colors.danger;
  if (status === 'critical' || status === 'warning') return Colors.warning;
  if (status === 'valid') return Colors.success;
  return Colors.textMuted;
}

function statusIcon(status: string): string {
  if (status === 'expired') return 'close-circle';
  if (status === 'critical' || status === 'warning') return 'alert-circle';
  return 'checkmark-circle';
}

export default function CertificatesScreen() {
  const { t } = useTranslation();
  const mode = useAppModeStore(s => s.mode);
  const profile = useProfileStore(s => s.profile);
  const CERT_TYPES = getCertTypes(mode, isOperator(profile));
  const [certs, setCerts] = useState<DroneCertificate[]>([]);
  const [editing, setEditing] = useState<DroneCertificate | null>(null);
  const [adding, setAdding] = useState(false);
  const [renewing, setRenewing] = useState<DroneCertificate | null>(null);
  const [renewDate, setRenewDate] = useState(new Date());

  const load = async () => setCerts(await listCertificates());
  useFocusEffect(useCallback(() => { load(); }, []));

  const active = certs.filter(c => { const s = certStatus(c.expires_date); return s === 'valid' || s === 'warning'; });
  const expiring = certs.filter(c => { const s = certStatus(c.expires_date); return s === 'critical'; });
  const expired = certs.filter(c => certStatus(c.expires_date) === 'expired');
  const noDate = certs.filter(c => certStatus(c.expires_date) === 'no_date');

  const renderCard = (c: DroneCertificate) => {
    const status = certStatus(c.expires_date);
    const color = statusColor(status);
    const info = c.expires_date ? daysUntil(c.expires_date) : { text: 'No expiry', days: 9999 };
    return (
      <TouchableOpacity
        key={c.id}
        style={s.card}
        onPress={() => setEditing(c)}
        activeOpacity={0.75}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Ionicons name={statusIcon(status) as any} size={18} color={color} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{c.cert_type}</Text>
            {c.label ? <Text style={s.cardLabel}>{c.label}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
        <View style={s.cardFooter}>
          {c.issued_date ? (
            <Text style={s.cardDate}>{c.issued_date}{c.expires_date ? ` → ${c.expires_date}` : ''}</Text>
          ) : null}
          <Text style={[s.cardStatus, { color }]}>{info.text}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {c.notes ? <Text style={[s.cardNotes, { flex: 1 }]} numberOfLines={1}>{c.notes}</Text> : <View style={{ flex: 1 }} />}
          {c.expires_date && (
            <TouchableOpacity
              style={s.renewBtn}
              onPress={(e) => {
                e.stopPropagation?.();
                const years = CERT_DEFAULT_YEARS[c.cert_type] ?? 1;
                const def = new Date();
                if (years > 0) def.setFullYear(def.getFullYear() + years);
                setRenewDate(def);
                setRenewing(c);
                Haptics.selectionAsync();
              }}
              activeOpacity={0.75}
            >
              <Ionicons name="refresh" size={12} color={Colors.primary} />
              <Text style={s.renewText}>{t('renew') ?? 'Renew'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSection = (title: string, items: DroneCertificate[], icon: string, iconColor: string) => {
    if (items.length === 0) return null;
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8 }}>
          <Ionicons name={icon as any} size={14} color={iconColor} />
          <Text style={s.sectionTitle}>{title}</Text>
          <View style={[s.badge, { backgroundColor: iconColor + '22' }]}>
            <Text style={[s.badgeText, { color: iconColor }]}>{items.length}</Text>
          </View>
        </View>
        {items.map(renderCard)}
      </View>
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Summary bar */}
      <View style={s.summaryBar}>
        <View style={s.summaryItem}>
          <Text style={[s.summaryValue, { color: Colors.success }]}>{active.length + noDate.length}</Text>
          <Text style={s.summaryLabel}>Active</Text>
        </View>
        <View style={s.summaryDivider} />
        <View style={s.summaryItem}>
          <Text style={[s.summaryValue, { color: Colors.warning }]}>{expiring.length}</Text>
          <Text style={s.summaryLabel}>Expiring</Text>
        </View>
        <View style={s.summaryDivider} />
        <View style={s.summaryItem}>
          <Text style={[s.summaryValue, { color: Colors.danger }]}>{expired.length}</Text>
          <Text style={s.summaryLabel}>Expired</Text>
        </View>
        <View style={s.summaryDivider} />
        <View style={s.summaryItem}>
          <Text style={[s.summaryValue, { color: Colors.textPrimary }]}>{certs.length}</Text>
          <Text style={s.summaryLabel}>Total</Text>
        </View>
      </View>

      {/* Expiring soon */}
      {renderSection('Expiring soon', expiring, 'alert-circle', Colors.warning)}

      {/* Expired */}
      {renderSection('Expired', expired, 'close-circle', Colors.danger)}

      {/* Active */}
      {renderSection('Active', [...active, ...noDate], 'checkmark-circle', Colors.success)}

      {/* Empty state */}
      {certs.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="shield-checkmark-outline" size={40} color={Colors.textMuted} />
          <Text style={s.emptyTitle}>{t('certificates_empty')}</Text>
          <Text style={s.emptyText}>Add your licences, ratings and certificates to track their validity and include them in your PDF export.</Text>
        </View>
      )}

      {/* Add button */}
      <TouchableOpacity style={s.addBtn} onPress={() => { setAdding(true); Haptics.selectionAsync(); }} activeOpacity={0.85}>
        <Ionicons name="add-circle" size={18} color={Colors.textInverse} />
        <Text style={s.addBtnText}>{t('add_certificate')}</Text>
      </TouchableOpacity>

      <CertForm
        visible={adding}
        initial={null}
        certTypes={CERT_TYPES}
        onClose={() => setAdding(false)}
        onSaved={async () => { await load(); setAdding(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
      />
      <CertForm
        visible={!!editing}
        initial={editing}
        certTypes={CERT_TYPES}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); setEditing(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
      />

      {/* Renew date picker */}
      {renewing && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setRenewing(null)}>
          <Pressable style={fs.backdrop} onPress={() => setRenewing(null)}>
            <Pressable style={fs.datePickerSheet} onPress={(e) => e.stopPropagation()}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
                <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '700' }}>
                  {t('renew') ?? 'Renew'} — {renewing.cert_type}
                </Text>
                <TouchableOpacity onPress={() => setRenewing(null)}>
                  <Text style={{ color: Colors.textMuted, fontSize: 14 }}>{t('cancel')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ color: Colors.textMuted, fontSize: 12, paddingHorizontal: 16, marginTop: 4 }}>
                {t('new_expiry_date') ?? 'Set new expiry date'}
              </Text>
              <DateTimePicker
                value={renewDate}
                mode="date"
                display="inline"
                themeVariant="dark"
                minimumDate={new Date()}
                onChange={(_, d) => { if (d) setRenewDate(d); }}
              />
              <TouchableOpacity
                style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, marginHorizontal: 16, marginBottom: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
                onPress={async () => {
                  if (!renewing) return;
                  const today = new Date().toISOString().split('T')[0];
                  const newExpiry = renewDate.toISOString().split('T')[0];
                  await updateCertificate(renewing.id, {
                    cert_type: renewing.cert_type,
                    label: renewing.label,
                    issued_date: today,
                    expires_date: newExpiry,
                    notes: renewing.notes,
                  });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setRenewing(null);
                  await load();
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark-circle" size={16} color={Colors.textInverse} />
                <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>{t('save')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </ScrollView>
  );
}

function CertForm({
  visible, initial, certTypes, onClose, onSaved,
}: {
  visible: boolean;
  initial: DroneCertificate | null;
  certTypes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [certType, setCertType] = useState(initial?.cert_type ?? certTypes[0] ?? 'Other');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [issued, setIssued] = useState(initial?.issued_date ?? '');
  const [expires, setExpires] = useState(initial?.expires_date ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [showIssuedDate, setShowIssuedDate] = useState(false);
  const [showExpiresDate, setShowExpiresDate] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCertType(initial?.cert_type ?? certTypes[0] ?? 'Other');
    setLabel(initial?.label ?? '');
    setIssued(initial?.issued_date ?? '');
    setExpires(initial?.expires_date ?? '');
    setNotes(initial?.notes ?? '');
  }, [visible, initial?.id]);

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
      <KeyboardAvoidingView style={fs.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Pressable style={fs.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={fs.handle} />
          <Text style={fs.title}>{initial ? t('edit_certificate') : t('add_certificate')}</Text>

          <ScrollView style={{ maxHeight: '75%' }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Type picker */}
            <Text style={fs.label}>{t('cert_type')}</Text>
            <View style={fs.typeGrid}>
              {certTypes.map((c) => {
                const active = certType === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[fs.typeBtn, active && fs.typeBtnActive]}
                    onPress={() => {
                      setCertType(c);
                      Haptics.selectionAsync();
                      const years = CERT_DEFAULT_YEARS[c] ?? 0;
                      if (years > 0 && !expires) setExpires(addYears(issued || '', years));
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[fs.typeText, active && fs.typeTextActive]}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Issuer / label */}
            <Text style={fs.label}>ISSUER / REFERENCE</Text>
            <TextInput
              style={fs.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Transportstyrelsen, AME Stockholm"
              placeholderTextColor={Colors.textMuted}
            />

            {/* Dates */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={fs.label}>{t('issued_date')}</Text>
                <TouchableOpacity style={fs.dateBtn} onPress={() => setShowIssuedDate(true)} activeOpacity={0.7}>
                  <Text style={[fs.dateText, !issued && { color: Colors.textMuted }]}>{issued || 'YYYY-MM-DD'}</Text>
                  <Ionicons name="calendar-outline" size={14} color={Colors.primary} />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={fs.label}>{t('expires_date')}</Text>
                <TouchableOpacity style={fs.dateBtn} onPress={() => setShowExpiresDate(true)} activeOpacity={0.7}>
                  <Text style={[fs.dateText, !expires && { color: Colors.textMuted }]}>{expires || 'No expiry'}</Text>
                  <Ionicons name="calendar-outline" size={14} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Notes */}
            <Text style={fs.label}>{t('notes')}</Text>
            <TextInput
              style={[fs.input, { minHeight: 56, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Additional details..."
              placeholderTextColor={Colors.textMuted}
            />
          </ScrollView>

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {initial && (
              <TouchableOpacity style={fs.deleteBtn} onPress={remove} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={16} color={Colors.danger} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={fs.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={fs.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={fs.saveBtn} onPress={save} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.textInverse} />
              <Text style={fs.saveText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>

        {/* Date pickers */}
        {showIssuedDate && Platform.OS === 'android' && (
          <DateTimePicker
            value={issued ? new Date(issued) : new Date()}
            mode="date" display="calendar"
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
            mode="date" display="calendar"
            onChange={(e, d) => { setShowExpiresDate(false); if (e.type === 'set' && d) setExpires(d.toISOString().split('T')[0]); }}
          />
        )}
        {Platform.OS === 'ios' && (showIssuedDate || showExpiresDate) && (
          <Modal visible transparent animationType="slide">
            <Pressable style={fs.backdrop} onPress={() => { setShowIssuedDate(false); setShowExpiresDate(false); }}>
              <Pressable style={fs.datePickerSheet} onPress={(e) => e.stopPropagation()}>
                <TouchableOpacity style={{ alignSelf: 'flex-end', padding: 12 }} onPress={() => { setShowIssuedDate(false); setShowExpiresDate(false); }}>
                  <Text style={{ color: Colors.primary, fontWeight: '700' }}>{t('done')}</Text>
                </TouchableOpacity>
                <DateTimePicker
                  value={(showIssuedDate ? issued : expires) ? new Date(showIssuedDate ? issued : expires) : new Date()}
                  mode="date" display="inline" themeVariant="dark"
                  onChange={(_, d) => {
                    if (!d) return;
                    const iso = d.toISOString().split('T')[0];
                    if (showIssuedDate) {
                      setIssued(iso);
                      const years = CERT_DEFAULT_YEARS[certType] ?? 0;
                      if (years > 0 && !expires) setExpires(addYears(iso, years));
                    } else { setExpires(iso); }
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

// ── Main list styles ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 6 },

  summaryBar: {
    flexDirection: 'row', backgroundColor: Colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, padding: 14,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', fontFamily: 'Menlo' },
  summaryLabel: { fontSize: 9, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: Colors.separator, marginVertical: 4 },

  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '800' },

  card: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  cardLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontSize: 11, color: Colors.textMuted, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
  cardStatus: { fontSize: 11, fontWeight: '700' },
  cardNotes: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTitle: { color: Colors.textSecondary, fontSize: 15, fontWeight: '700' },
  emptyText: { color: Colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 24 },

  renewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '44',
  },
  renewText: { color: Colors.primary, fontSize: 11, fontWeight: '700' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, marginTop: 8,
  },
  addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
});

// ── Form styles ───────────────────────────────────────────────────────────────

const fs = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: Colors.border,
    maxHeight: '90%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 12 },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 12 },
  label: {
    color: Colors.textMuted, fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 14, marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeBtn: {
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  typeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  typeTextActive: { color: Colors.textInverse },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  dateText: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  deleteBtn: {
    paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, backgroundColor: Colors.danger + '15',
    borderWidth: 1, borderColor: Colors.danger + '44',
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  cancelText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  saveBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 10, backgroundColor: Colors.primary,
  },
  saveText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  datePickerSheet: {
    backgroundColor: Colors.card, paddingBottom: 24, paddingTop: 8,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
});
