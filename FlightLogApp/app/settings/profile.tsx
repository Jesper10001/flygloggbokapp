// Profil: vem du är (överst), ditt abonnemang och uppgifterna som hamnar på exporterade sidor. Abonnemanget
// hanteras här i stället för direkt i Settings (components/PlanCoinsSection → SubscriptionPanel).
import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { getSetting, setSetting } from '../../db/flights';
import { SignatureView, SignatureModal, type SignatureData } from '../../components/SignaturePad';
import { SubscriptionPanel } from '../../components/PlanCoinsSection';

const FIELDS = [
  { key: 'profile_first_name', label: 'first_name', placeholder: 'John' },
  { key: 'profile_last_name', label: 'last_name', placeholder: 'Smith' },
  { key: 'profile_initials', label: 'initials', placeholder: 'JS', maxLength: 4 },
  { key: 'profile_email', label: 'email', placeholder: 'name@example.com', optional: true, keyboardType: 'email-address' as const },
  { key: 'profile_phone', label: 'phone', placeholder: '+46 70 123 45 67', optional: true, keyboardType: 'phone-pad' as const },
  { key: 'profile_company', label: 'company', placeholder: 'Your workplace', optional: true },
  { key: 'profile_title', label: 'job_title', placeholder: 'Airline pilot', optional: true },
] as const;

type Field = (typeof FIELDS)[number];

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [sigModal, setSigModal] = useState(false);

  useEffect(() => {
    (async () => {
      const data: Record<string, string> = {};
      for (const f of FIELDS) {
        data[f.key] = (await getSetting(f.key)) ?? '';
      }
      setForm(data);
      const sg = await getSetting('pilot_signature');
      try { setSignature(sg ? JSON.parse(sg) : null); } catch { setSignature(null); }
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const f of FIELDS) {
        await setSetting(f.key, form[f.key] ?? '');
      }
      // Auto-generera initialer om inte manuellt satta
      if (!form.profile_initials && form.profile_first_name && form.profile_last_name) {
        const auto = `${form.profile_first_name[0]}${form.profile_last_name[0]}`.toUpperCase();
        await setSetting('profile_initials', auto);
      }
      Alert.alert(t('done'), t('profile_saved'), [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <View style={styles.container} />;

  // Överst: följer fälten medan man skriver.
  const first = (form.profile_first_name ?? '').trim();
  const last = (form.profile_last_name ?? '').trim();
  const name = [first, last].filter(Boolean).join(' ');
  const initials = (form.profile_initials ?? '').trim().toUpperCase() || `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
  const role = [form.profile_title, form.profile_company].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ');

  const fieldRow = (f: Field, isLast: boolean) => (
    <View key={f.key} style={[styles.fieldRow, isLast && { borderBottomWidth: 0 }]}>
      <Text style={styles.fieldLabel}>{t(f.label)}</Text>
      <TextInput
        style={styles.fieldInput}
        value={form[f.key] ?? ''}
        onChangeText={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
        placeholder={f.placeholder}
        placeholderTextColor={Colors.textMuted}
        maxLength={'maxLength' in f ? f.maxLength : undefined}
        keyboardType={'keyboardType' in f ? f.keyboardType : 'default'}
        autoCapitalize={f.key === 'profile_initials' ? 'characters' : 'keyboardType' in f ? 'none' : 'words'}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.avatar}>
            {initials
              ? <Text style={styles.avatarText}>{initials}</Text>
              : <Ionicons name="person-outline" size={28} color={Colors.textSecondary} />}
          </View>
          <Text style={styles.heroName} numberOfLines={1}>{name || t('your_name')}</Text>
          {role ? <Text style={styles.heroRole} numberOfLines={1}>{role}</Text> : null}
        </View>

        <Text style={styles.sectionHeader}>Subscription</Text>
        <SubscriptionPanel />

        <Text style={styles.sectionHeader}>{t('profile_basic')}</Text>
        <View style={styles.card}>
          {FIELDS.slice(0, 3).map((f, i) => fieldRow(f, i === 2))}
        </View>

        <Text style={styles.sectionHeader}>{t('profile_optional')}</Text>
        <View style={styles.card}>
          {FIELDS.slice(3).map((f, i) => fieldRow(f, i === FIELDS.length - 4))}
        </View>

        <Text style={styles.sectionHeader}>{t('signature_section')}</Text>
        <View style={styles.card}>
          <TouchableOpacity style={[styles.fieldRow, { borderBottomWidth: 0 }]} onPress={() => setSigModal(true)} activeOpacity={0.7}>
            <Text style={styles.fieldLabel}>{t('signature_title')}</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
              {signature
                ? <SignatureView data={signature} height={34} color={Colors.textPrimary} />
                : <Text style={{ color: Colors.textMuted, fontSize: 14 }}>{t('signature_add')}</Text>}
              <Ionicons name="create-outline" size={18} color={Colors.primary} />
            </View>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>{t('signature_sub')}</Text>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
          <Text style={styles.saveBtnText}>{t('save')}</Text>
        </TouchableOpacity>
        <Text style={[styles.hint, { marginTop: 14 }]}>{t('profile_hint')}</Text>

        <SignatureModal
          visible={sigModal}
          initial={signature}
          onClose={() => setSigModal(false)}
          onSave={(s) => { setSignature(s); setSetting('pilot_signature', s ? JSON.stringify(s) : ''); }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40 },

  hero: { alignItems: 'center', paddingTop: 8, paddingBottom: 6, gap: 4 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, marginBottom: 8,
    backgroundColor: Colors.elevated, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '700', letterSpacing: 1, color: Colors.textPrimary },
  heroName: { fontSize: 21, fontWeight: '700', color: Colors.textPrimary },
  heroRole: { fontSize: 13, color: Colors.textSecondary },

  sectionHeader: {
    fontSize: 11, fontWeight: '700', color: Colors.textSecondary,
    letterSpacing: 2.2, textTransform: 'uppercase',
    marginBottom: 8, marginTop: 24, paddingHorizontal: 4,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder,
    gap: 12,
  },
  fieldLabel: {
    width: 90, fontSize: 13, fontWeight: '600', color: Colors.textSecondary,
  },
  fieldInput: {
    flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary,
    padding: 0,
  },

  hint: {
    fontSize: 11, color: Colors.textMuted, marginTop: 12, textAlign: 'center', lineHeight: 16,
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16,
    marginTop: 28,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
});
