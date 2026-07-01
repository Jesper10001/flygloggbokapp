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
import { getCategoryRecency, type CategoryRecency } from '../../db/drones';
import { useProfileStore, isOperator } from '../../store/profileStore';
import {
  listCertificates, addCertificate, updateCertificate, deleteCertificate,
  certStatus, type DroneCertificate,
} from '../../db/drones';
import { RatingModal } from '../../components/logbook-page/RatingModal';
import * as Haptics from 'expo-haptics';

// ── Myndighet + certifikattaxonomi ─────────────────────────────────────────────
// Giltighetstider verifierade mot EASA Part-FCL/Part-MED, FAA 14 CFR och UK CAA.
// months: 0 = ingen fast utgång (licens livslång / FAA-certifikat / currency-baserat).

type Authority = 'EASA' | 'FAA' | 'UK CAA';
const AUTHORITIES: Authority[] = ['EASA', 'FAA', 'UK CAA'];

type CertDef = { name: string; months: number; hint: string };
type CertGroup = { title: string; items: CertDef[] };

const OTHER_GROUP: CertGroup = { title: 'Other', items: [{ name: 'Other', months: 0, hint: 'Set a custom expiry if applicable.' }] };

const EASA_GROUPS: CertGroup[] = [
  { title: 'Licences', items: [
    { name: 'ATPL(A)', months: 0, hint: 'Licence — valid for life. Privileges depend on valid ratings & medical.' },
    { name: 'CPL', months: 0, hint: 'Licence — valid for life.' },
    { name: 'PPL', months: 0, hint: 'Licence — valid for life.' },
    { name: 'LAPL', months: 0, hint: 'Light licence — valid for life.' },
  ] },
  { title: 'Class & instrument ratings', items: [
    { name: 'SEP (land)', months: 24, hint: 'EASA: 24 months. Revalidate by 12h + training flight, or a proficiency check.' },
    { name: 'SEP (sea)', months: 24, hint: 'EASA: 24 months.' },
    { name: 'TMG', months: 24, hint: 'EASA: 24 months.' },
    { name: 'MEP (land)', months: 12, hint: 'EASA: 12 months — proficiency check required.' },
    { name: 'IR (Instrument Rating)', months: 12, hint: 'EASA: 12 months — Instrument Proficiency Check (IPC). Lapses independently of the class/type rating.' },
    { name: 'BIR (Basic IR)', months: 12, hint: 'EASA: 12 months — IPC.' },
    { name: 'Night Rating', months: 0, hint: 'No expiry — kept current by recent experience.' },
  ] },
  { title: 'Instructor & examiner', items: [
    { name: 'Flight Instructor (FI)', months: 36, hint: 'EASA: 36 months.' },
    { name: 'Class/Type Instructor (CRI/TRI)', months: 36, hint: 'EASA: 36 months.' },
    { name: 'IR Instructor (IRI)', months: 36, hint: 'EASA: 36 months.' },
    { name: 'Examiner (FE/TRE/CRE)', months: 36, hint: 'EASA: 36 months.' },
  ] },
  { title: 'Medical', items: [
    { name: 'Medical Class 1', months: 12, hint: 'EASA: 12 months (6 months if ≥60, or ≥40 in single-pilot CAT carrying passengers).' },
    { name: 'Medical Class 2', months: 24, hint: 'EASA: 60 mo (under 40) · 24 mo (40–50) · 12 mo (over 50).' },
    { name: 'Medical LAPL', months: 24, hint: 'EASA: 60 mo (under 40) · 24 mo (over 40).' },
  ] },
  { title: 'Operational checks', items: [
    { name: 'Proficiency Check (PC)', months: 12, hint: 'EASA: typically 12 months.' },
    { name: 'Operator Proficiency Check (OPC)', months: 12, hint: 'EASA: 12 months (CAT usually on a 6-month cycle).' },
    { name: 'Line Check', months: 12, hint: 'EASA: 12 months.' },
  ] },
  { title: 'Recurrent & endorsements', items: [
    { name: 'Dangerous Goods', months: 24, hint: 'Recurrent every 24 months.' },
    { name: 'CRM', months: 12, hint: 'Recurrent on the operator schedule.' },
    { name: 'LVO / CAT II/III', months: 12, hint: 'Recurrent with OPC / line training.' },
    { name: 'RVSM', months: 0, hint: 'Operator/aircraft approval — no personal expiry.' },
    { name: 'PBN', months: 0, hint: 'Now embedded in the IR — no separate expiry.' },
    { name: 'English Language Proficiency', months: 48, hint: 'Level 4: 4 years · Level 5: 6 years · Level 6: no expiry.' },
  ] },
  OTHER_GROUP,
];

const FAA_GROUPS: CertGroup[] = [
  { title: 'Certificates', items: [
    { name: 'ATP', months: 0, hint: 'FAA certificate — never expires. Currency via Flight Review + medical.' },
    { name: 'Commercial', months: 0, hint: 'No expiry — Flight Review every 24 months.' },
    { name: 'Private', months: 0, hint: 'No expiry — Flight Review every 24 months.' },
    { name: 'Sport', months: 0, hint: 'No expiry.' },
    { name: 'Recreational', months: 0, hint: 'No expiry.' },
  ] },
  { title: 'Ratings', items: [
    { name: 'Instrument Rating', months: 0, hint: 'No expiry — IPC only if instrument currency lapses.' },
    { name: 'Multi-Engine', months: 0, hint: 'No expiry.' },
    { name: 'CFI (Flight Instructor)', months: 24, hint: 'FAA: expires every 24 months — renew by activity, checkride or FIRC.' },
  ] },
  { title: 'Medical', items: [
    { name: 'Medical First Class', months: 12, hint: 'FAA: 12 months (under 40) · 6 months (40+) for ATP privileges.' },
    { name: 'Medical Second Class', months: 12, hint: 'FAA: 12 months for commercial privileges.' },
    { name: 'Medical Third Class', months: 60, hint: 'FAA: 60 months (under 40) · 24 months (40+).' },
    { name: 'BasicMed', months: 48, hint: 'FAA: medical exam every 48 months; online course every 24 months.' },
  ] },
  { title: 'Currency & checks', items: [
    { name: 'Flight Review (BFR)', months: 24, hint: 'FAA: every 24 calendar months to act as PIC.' },
    { name: 'IPC (Instrument Proficiency Check)', months: 0, hint: 'Required only when instrument currency lapses.' },
    { name: '61.58 PIC Proficiency Check', months: 12, hint: 'FAA: 12 months for type-rated / turbojet PIC.' },
    { name: 'Line Check', months: 12, hint: 'Part 121/135: 12 months.' },
  ] },
  { title: 'Recurrent & endorsements', items: [
    { name: 'Dangerous Goods / HazMat', months: 24, hint: 'Recurrent every 24 months.' },
    { name: 'CRM', months: 12, hint: 'Recurrent on the operator schedule.' },
    { name: 'RVSM', months: 0, hint: 'Operator / aircraft authorization.' },
    { name: 'English Proficient', months: 0, hint: 'FAA: endorsement on the certificate — no expiry.' },
  ] },
  OTHER_GROUP,
];

const CAA_GROUPS: CertGroup[] = [
  { title: 'Licences', items: [
    { name: 'ATPL(A)', months: 0, hint: 'UK CAA licence — valid for life.' },
    { name: 'CPL', months: 0, hint: 'Valid for life.' },
    { name: 'PPL', months: 0, hint: 'Valid for life.' },
    { name: 'LAPL', months: 0, hint: 'Valid for life.' },
    { name: 'NPPL', months: 0, hint: 'UK national PPL — valid for life.' },
  ] },
  { title: 'Class & instrument ratings', items: [
    { name: 'SEP (land)', months: 24, hint: 'UK CAA: 24 months.' },
    { name: 'SEP (sea)', months: 24, hint: 'UK CAA: 24 months.' },
    { name: 'TMG', months: 24, hint: 'UK CAA: 24 months.' },
    { name: 'MEP (land)', months: 12, hint: 'UK CAA: 12 months — proficiency check.' },
    { name: 'IR (Instrument Rating)', months: 12, hint: 'UK CAA: 12 months — IPC.' },
    { name: 'IR(R) / IMC', months: 25, hint: 'UK-only rating: 25 months.' },
    { name: 'Night Rating', months: 0, hint: 'No expiry.' },
  ] },
  { title: 'Instructor & examiner', items: [
    { name: 'Flight Instructor (FI)', months: 36, hint: 'UK CAA: 36 months.' },
    { name: 'Class/Type Instructor', months: 36, hint: 'UK CAA: 36 months.' },
    { name: 'Examiner', months: 36, hint: 'UK CAA: 36 months.' },
  ] },
  { title: 'Medical', items: [
    { name: 'Medical Class 1', months: 12, hint: 'UK CAA: 12 months (6 months if ≥60 / ≥40 single-pilot CAT pax).' },
    { name: 'Medical Class 2', months: 24, hint: 'UK CAA: 60 mo (under 40) · 24 mo (40–50) · 12 mo (over 50).' },
    { name: 'Medical LAPL', months: 24, hint: 'UK CAA: 60 mo (under 40) · 24 mo (over 40).' },
    { name: 'PMD (Pilot Medical Declaration)', months: 0, hint: 'UK self-declaration — valid until age 70, then renew.' },
  ] },
  { title: 'Operational checks', items: [
    { name: 'Proficiency Check (PC)', months: 12, hint: 'UK CAA: typically 12 months.' },
    { name: 'Operator Proficiency Check (OPC)', months: 12, hint: 'UK CAA: 12 months.' },
    { name: 'Line Check', months: 12, hint: 'UK CAA: 12 months.' },
  ] },
  { title: 'Recurrent & endorsements', items: [
    { name: 'Dangerous Goods', months: 24, hint: 'Recurrent every 24 months.' },
    { name: 'CRM', months: 12, hint: 'Recurrent on the operator schedule.' },
    { name: 'English Language Proficiency', months: 48, hint: 'Level 4: 4 years · Level 5: 6 years · Level 6: no expiry.' },
  ] },
  OTHER_GROUP,
];

// Operatörskvalifikationer (SAR/HEMS/militär) — läggs till för operatörer.
const OPERATOR_EXTRA: CertGroup = { title: 'Crew qualifications', items: [
  { name: 'Crew Chief Qualification', months: 24, hint: 'Operator-defined recurrent.' },
  { name: 'Hoist Operator', months: 12, hint: 'Operator-defined recurrent.' },
  { name: 'Rescue Swimmer', months: 12, hint: 'Operator-defined recurrent.' },
  { name: 'HEMS Crew Member', months: 12, hint: 'Operator-defined recurrent.' },
  { name: 'Loadmaster', months: 24, hint: 'Operator-defined recurrent.' },
  { name: 'NVG Qualification', months: 12, hint: 'Kept current by recent experience.' },
  { name: 'Underwater Escape (HUET)', months: 48, hint: 'Typically every 3–4 years.' },
  { name: 'Fire Fighting', months: 36, hint: 'Recurrent.' },
  { name: 'First Aid', months: 24, hint: 'Recurrent.' },
] };

const DRONE_GROUPS: CertGroup[] = [
  { title: 'Certificates of competency', items: [
    { name: 'A1/A3', months: 60, hint: 'EU Open category — 5 years.' },
    { name: 'A2', months: 60, hint: 'EU Open category (A2 CofC) — 5 years.' },
    { name: 'STS-01', months: 60, hint: 'EU Specific (standard scenario) — 5 years.' },
    { name: 'STS-02', months: 60, hint: 'EU Specific (standard scenario) — 5 years.' },
    { name: 'Operational Authorization', months: 24, hint: 'Specific category — per authorisation (often ~2 years).' },
    { name: 'Other', months: 0, hint: 'Set a custom expiry if applicable.' },
  ] },
];

function getGroups(mode: string, isOp: boolean, authority: Authority): CertGroup[] {
  if (mode === 'drone') return DRONE_GROUPS;
  const base = authority === 'FAA' ? FAA_GROUPS : authority === 'UK CAA' ? CAA_GROUPS : EASA_GROUPS;
  if (!isOp) return base;
  // Operatörsgrupp infogas precis före "Other".
  return [...base.slice(0, -1), OPERATOR_EXTRA, base[base.length - 1]];
}

// Plattt namn→månader för renew-knappens default (myndighetsoberoende).
const MONTHS_BY_NAME: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const g of [...EASA_GROUPS, ...FAA_GROUPS, ...CAA_GROUPS, OPERATOR_EXTRA, ...DRONE_GROUPS]) {
    for (const d of g.items) if (!(d.name in m)) m[d.name] = d.months;
  }
  m['Type Rating'] = 12; // skapas via rating-popupen
  return m;
})();

function toISODate(d: Date): string { return d.toISOString().split('T')[0]; }
function addMonthsISO(fromISO: string, months: number): string {
  const d = fromISO ? new Date(fromISO + 'T00:00:00') : new Date();
  d.setMonth(d.getMonth() + months);
  return toISODate(d);
}
function monthsLabel(m: number): string {
  if (m <= 0) return 'no fixed expiry';
  if (m % 12 === 0) { const y = m / 12; return `${y} ${y === 1 ? 'year' : 'years'}`; }
  return `${m} months`;
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
  const isOp = isOperator(profile);
  const [authority, setAuthority] = useState<Authority>('EASA');
  const [certs, setCerts] = useState<DroneCertificate[]>([]);
  const [recency, setRecency] = useState<CategoryRecency[]>([]);
  const [editing, setEditing] = useState<DroneCertificate | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingRating, setAddingRating] = useState(false);
  const [renewing, setRenewing] = useState<DroneCertificate | null>(null);
  const [renewDate, setRenewDate] = useState(new Date());

  const load = useCallback(async () => {
    setCerts(await listCertificates());
    setRecency(mode === 'drone' ? await getCategoryRecency() : []);
  }, [mode]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Pilot-relevant ordning: närmast utgång först (mest brådskande).
  const byExpiryAsc = (a: DroneCertificate, b: DroneCertificate) =>
    (a.expires_date || '9999-99-99').localeCompare(b.expires_date || '9999-99-99');
  const byExpiryDesc = (a: DroneCertificate, b: DroneCertificate) =>
    (b.expires_date || '').localeCompare(a.expires_date || '');
  const active = certs.filter(c => { const st = certStatus(c.expires_date); return st === 'valid' || st === 'warning'; }).sort(byExpiryAsc);
  const expiring = certs.filter(c => certStatus(c.expires_date) === 'critical').sort(byExpiryAsc);
  const expired = certs.filter(c => certStatus(c.expires_date) === 'expired').sort(byExpiryDesc);
  const noDate = certs.filter(c => certStatus(c.expires_date) === 'no_date');

  const renderCard = (c: DroneCertificate) => {
    const status = certStatus(c.expires_date);
    const color = statusColor(status);
    const info = c.expires_date ? daysUntil(c.expires_date) : { text: 'No expiry', days: 9999 };
    return (
      <TouchableOpacity key={c.id} style={s.card} onPress={() => setEditing(c)} activeOpacity={0.75}>
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
          ) : <View />}
          <Text style={[s.cardStatus, { color }]}>{info.text}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {c.notes ? <Text style={[s.cardNotes, { flex: 1 }]} numberOfLines={1}>{c.notes}</Text> : <View style={{ flex: 1 }} />}
          {c.expires_date && (
            <TouchableOpacity
              style={s.renewBtn}
              onPress={(e) => {
                e.stopPropagation?.();
                const months = MONTHS_BY_NAME[c.cert_type] ?? 12;
                const def = new Date();
                if (months > 0) def.setMonth(def.getMonth() + months);
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

      {/* Sektioner i fallande brådska */}
      {renderSection('Expired', expired, 'close-circle', Colors.danger)}
      {renderSection('Expiring soon', expiring, 'alert-circle', Colors.warning)}
      {renderSection('Active', [...active, ...noDate], 'checkmark-circle', Colors.success)}

      {/* Recency per kategori (endast drönarläge) */}
      {mode === 'drone' && recency.length > 0 && (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8 }}>
            <Ionicons name="trending-up" size={14} color={Colors.success} />
            <Text style={s.sectionTitle}>Recency by category</Text>
          </View>
          <View style={{ backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 16, gap: 14 }}>
            {recency.map((r) => {
              const color = r.isStale ? Colors.danger : r.daysAgo > 54 ? Colors.warning : Colors.success;
              const pct = Math.max(4, Math.min(100, 100 - (r.daysAgo / 90) * 100));
              return (
                <View key={r.category} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700' }}>{r.category}</Text>
                    <Text style={{ color, fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' }}>
                      {r.isStale ? `${r.daysAgo}d · out of recency` : `${r.daysAgo}d ago`}
                    </Text>
                  </View>
                  <View style={{ height: 5, backgroundColor: Colors.elevated, borderRadius: 3, overflow: 'hidden' }}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
                  </View>
                </View>
              );
            })}
            <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 2 }}>Stay current by flying each category within 90 days.</Text>
          </View>
        </View>
      )}

      {/* Empty state */}
      {certs.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="shield-checkmark-outline" size={40} color={Colors.textMuted} />
          <Text style={s.emptyTitle}>{t('certificates_empty')}</Text>
          <Text style={s.emptyText}>Add your licences, ratings and certificates to track their validity and include them in your PDF export.</Text>
        </View>
      )}

      {/* Add buttons */}
      {mode !== 'drone' && (
        <TouchableOpacity style={s.ratingBtn} onPress={() => { setAddingRating(true); Haptics.selectionAsync(); }} activeOpacity={0.85}>
          <Ionicons name="ribbon-outline" size={17} color={Colors.primary} />
          <Text style={s.ratingBtnText}>Add type rating</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={s.addBtn} onPress={() => { setAdding(true); Haptics.selectionAsync(); }} activeOpacity={0.85}>
        <Ionicons name="add-circle" size={18} color={Colors.textInverse} />
        <Text style={s.addBtnText}>{t('add_certificate')}</Text>
      </TouchableOpacity>

      <CertForm
        visible={adding}
        initial={null}
        mode={mode}
        isOp={isOp}
        authority={authority}
        onAuthorityChange={setAuthority}
        onClose={() => setAdding(false)}
        onSaved={async () => { await load(); setAdding(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
      />
      <CertForm
        visible={!!editing}
        initial={editing}
        mode={mode}
        isOp={isOp}
        authority={authority}
        onAuthorityChange={setAuthority}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); setEditing(null); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }}
      />

      {/* Type rating — samma popup som på Fleet-korten */}
      <RatingModal
        visible={addingRating}
        title="Add type rating"
        initialName=""
        initialExpiry=""
        accent={Colors.primary}
        onSave={async (name, expiryISO) => {
          await addCertificate({ cert_type: 'Type Rating', label: name, issued_date: toISODate(new Date()), expires_date: expiryISO, notes: '' });
          setAddingRating(false);
          await load();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
        onClose={() => setAddingRating(false)}
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
                  await updateCertificate(renewing.id, {
                    cert_type: renewing.cert_type,
                    label: renewing.label,
                    issued_date: toISODate(new Date()),
                    expires_date: toISODate(renewDate),
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

// ── Add/Edit-formulär ──────────────────────────────────────────────────────────

function CertForm({
  visible, initial, mode, isOp, authority, onAuthorityChange, onClose, onSaved,
}: {
  visible: boolean;
  initial: DroneCertificate | null;
  mode: string;
  isOp: boolean;
  authority: Authority;
  onAuthorityChange: (a: Authority) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const showAuthority = mode !== 'drone';

  let groups = getGroups(mode, isOp, authority);
  // Vid redigering: om typen inte finns i nuvarande grupper, visa den som "Current".
  const known = new Set(groups.flatMap(g => g.items.map(i => i.name)));
  if (initial && initial.cert_type && !known.has(initial.cert_type)) {
    groups = [{ title: 'Current', items: [{ name: initial.cert_type, months: MONTHS_BY_NAME[initial.cert_type] ?? 0, hint: 'Existing entry — adjust the expiry below.' }] }, ...groups];
  }
  const allDefs = groups.flatMap(g => g.items);

  const [certType, setCertType] = useState(initial?.cert_type ?? allDefs[0]?.name ?? 'Other');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [issued, setIssued] = useState(initial?.issued_date ?? '');
  const [expires, setExpires] = useState(initial?.expires_date ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [showIssuedDate, setShowIssuedDate] = useState(false);
  const [showExpiresDate, setShowExpiresDate] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCertType(initial?.cert_type ?? allDefs[0]?.name ?? 'Other');
    setLabel(initial?.label ?? '');
    setIssued(initial?.issued_date ?? '');
    setExpires(initial?.expires_date ?? '');
    setNotes(initial?.notes ?? '');
    setShowIssuedDate(false);
    setShowExpiresDate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial?.id, authority]);

  const selectedDef = allDefs.find(d => d.name === certType);
  const suggestMonths = selectedDef?.months ?? 0;

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

  const expiryChips: { label: string; onPress: () => void; active: boolean }[] = [
    ...(suggestMonths > 0 ? [{
      label: `Suggested · ${monthsLabel(suggestMonths)}`,
      onPress: () => setExpires(addMonthsISO(issued, suggestMonths)),
      active: !!expires && expires === addMonthsISO(issued, suggestMonths),
    }] : []),
    { label: '+1 yr', onPress: () => setExpires(addMonthsISO(issued, 12)), active: false },
    { label: '+2 yr', onPress: () => setExpires(addMonthsISO(issued, 24)), active: false },
    { label: '+5 yr', onPress: () => setExpires(addMonthsISO(issued, 60)), active: false },
    { label: 'No expiry', onPress: () => setExpires(''), active: !expires },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={fs.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Pressable style={fs.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={fs.handle} />
          <Text style={fs.title}>{initial ? t('edit_certificate') : t('add_certificate')}</Text>

          <ScrollView style={{ maxHeight: '78%' }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Authority */}
            {showAuthority && (
              <>
                <Text style={fs.label}>REGULATORY AUTHORITY</Text>
                <View style={fs.authBar}>
                  {AUTHORITIES.map((a) => {
                    const on = authority === a;
                    return (
                      <TouchableOpacity key={a} style={[fs.authSeg, on && fs.authSegActive]} onPress={() => { onAuthorityChange(a); Haptics.selectionAsync(); }} activeOpacity={0.8}>
                        <Text style={[fs.authText, on && fs.authTextActive]}>{a}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Type picker — grupperat per kategori */}
            <Text style={fs.label}>{t('cert_type')}</Text>
            {groups.map((g) => (
              <View key={g.title}>
                {groups.length > 1 && <Text style={fs.groupLabel}>{g.title}</Text>}
                <View style={fs.typeGrid}>
                  {g.items.map((d) => {
                    const sel = certType === d.name;
                    return (
                      <TouchableOpacity
                        key={d.name}
                        style={[fs.typeBtn, sel && fs.typeBtnActive]}
                        onPress={() => { setCertType(d.name); Haptics.selectionAsync(); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[fs.typeText, sel && fs.typeTextActive]}>{d.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* Validity hint */}
            {selectedDef && (
              <View style={fs.hintBox}>
                <Ionicons name="information-circle-outline" size={15} color={Colors.primary} style={{ marginTop: 1 }} />
                <Text style={fs.hintText}>{selectedDef.hint}</Text>
              </View>
            )}

            {/* Issuer / label */}
            <Text style={fs.label}>ISSUER / REFERENCE</Text>
            <TextInput
              style={fs.input}
              value={label}
              onChangeText={setLabel}
              placeholder={t('cert_issuer_ph')}
              placeholderTextColor={Colors.textMuted}
            />

            {/* Issued date */}
            <Text style={fs.label}>{t('issued_date')}</Text>
            <TouchableOpacity style={fs.dateBtn} onPress={() => setShowIssuedDate(true)} activeOpacity={0.7}>
              <Text style={[fs.dateText, !issued && { color: Colors.textMuted }]}>{issued || 'Tap to choose'}</Text>
              <Ionicons name="calendar-outline" size={15} color={Colors.primary} />
            </TouchableOpacity>

            {/* Expiry — du väljer själv */}
            <Text style={fs.label}>EXPIRY DATE</Text>
            <View style={fs.chipRow}>
              {expiryChips.map((c) => (
                <TouchableOpacity key={c.label} style={[fs.chip, c.active && fs.chipActive]} onPress={() => { c.onPress(); Haptics.selectionAsync(); }} activeOpacity={0.75}>
                  <Text style={[fs.chipText, c.active && fs.chipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={fs.dateBtn} onPress={() => setShowExpiresDate(true)} activeOpacity={0.7}>
              <Text style={[fs.dateText, !expires && { color: Colors.textMuted }]}>{expires || 'No expiry — tap to set a date'}</Text>
              <Ionicons name="calendar-outline" size={15} color={Colors.primary} />
            </TouchableOpacity>

            {/* Notes */}
            <Text style={fs.label}>{t('notes')}</Text>
            <TextInput
              style={[fs.input, { minHeight: 56, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder={t('details_ph')}
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
            onChange={(e, d) => { setShowIssuedDate(false); if (e.type === 'set' && d) setIssued(toISODate(d)); }}
          />
        )}
        {showExpiresDate && Platform.OS === 'android' && (
          <DateTimePicker
            value={expires ? new Date(expires) : new Date()}
            mode="date" display="calendar"
            onChange={(e, d) => { setShowExpiresDate(false); if (e.type === 'set' && d) setExpires(toISODate(d)); }}
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
                    if (showIssuedDate) setIssued(toISODate(d));
                    else setExpires(toISODate(d));
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
  ratingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary + '14', borderRadius: 12, paddingVertical: 13, marginTop: 8,
    borderWidth: 1, borderColor: Colors.primary + '55',
  },
  ratingBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
});

// ── Form styles ───────────────────────────────────────────────────────────────

const fs = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: Colors.border,
    maxHeight: '92%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 12 },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  label: {
    color: Colors.textMuted, fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 7,
  },
  input: {
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10,
  },

  authBar: { flexDirection: 'row', backgroundColor: Colors.elevated, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 3, gap: 3 },
  authSeg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  authSegActive: { backgroundColor: Colors.primary },
  authText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  authTextActive: { color: Colors.textInverse },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeBtn: {
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  typeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  typeTextActive: { color: Colors.textInverse },
  groupLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 12, marginBottom: 6 },

  hintBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.primary + '12', borderRadius: 10, borderWidth: 1, borderColor: Colors.primary + '33',
    paddingHorizontal: 11, paddingVertical: 10, marginTop: 12,
  },
  hintText: { flex: 1, color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  chipActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: Colors.primary },

  dateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 12,
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
