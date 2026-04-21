import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { getSetting, setSetting } from '../../db/flights';

const FIELDS = [
  { key: 'profile_first_name', label: 'first_name', placeholder: 'Johan' },
  { key: 'profile_last_name', label: 'last_name', placeholder: 'Andersson' },
  { key: 'profile_initials', label: 'initials', placeholder: 'JA', maxLength: 4 },
  { key: 'profile_credentials', label: 'credentials', placeholder: 'CPL(H) · IR · NVG · A2 UAS' },
  { key: 'profile_email', label: 'email', placeholder: 'namn@exempel.se', optional: true, keyboardType: 'email-address' as const },
  { key: 'profile_phone', label: 'phone', placeholder: '+46 70 123 45 67', optional: true, keyboardType: 'phone-pad' as const },
  { key: 'profile_company', label: 'company', placeholder: 'Scandinavian Helicopter AB', optional: true },
  { key: 'profile_title', label: 'job_title', placeholder: 'Linjepilot', optional: true },
] as const;

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const data: Record<string, string> = {};
      for (const f of FIELDS) {
        data[f.key] = (await getSetting(f.key)) ?? '';
      }
      setForm(data);
      setLoaded(true);
    })();
  }, []);

  const initials = form.profile_initials
    || `${(form.profile_first_name ?? '')[0] ?? ''}${(form.profile_last_name ?? '')[0] ?? ''}`.toUpperCase()
    || '?';

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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Avatar preview */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.avatarName}>
            {form.profile_first_name || form.profile_last_name
              ? `${form.profile_first_name ?? ''} ${form.profile_last_name ?? ''}`.trim()
              : t('your_name')}
          </Text>
          {form.profile_credentials ? (
            <Text style={styles.avatarSub}>{form.profile_credentials}</Text>
          ) : null}
        </View>

        {/* Grunddata */}
        <Text style={styles.sectionHeader}>{t('profile_basic')}</Text>
        <View style={styles.card}>
          {FIELDS.slice(0, 4).map((f, i) => (
            <View key={f.key} style={[styles.fieldRow, i === 3 && { borderBottomWidth: 0 }]}>
              <Text style={styles.fieldLabel}>{t(f.label)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form[f.key] ?? ''}
                onChangeText={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
                placeholder={f.placeholder}
                placeholderTextColor={Colors.textMuted}
                maxLength={(f as any).maxLength}
                autoCapitalize={f.key === 'profile_initials' ? 'characters' : 'words'}
              />
            </View>
          ))}
        </View>

        {/* Kontakt & Organisation */}
        <Text style={styles.sectionHeader}>{t('profile_optional')}</Text>
        <View style={styles.card}>
          {FIELDS.slice(4).map((f, i) => (
            <View key={f.key} style={[styles.fieldRow, i === FIELDS.length - 5 && { borderBottomWidth: 0 }]}>
              <Text style={styles.fieldLabel}>{t(f.label)}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form[f.key] ?? ''}
                onChangeText={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
                placeholder={f.placeholder}
                placeholderTextColor={Colors.textMuted}
                keyboardType={(f as any).keyboardType ?? 'default'}
              />
            </View>
          ))}
        </View>

        <Text style={styles.hint}>{t('profile_hint')}</Text>

        {/* Spara */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
          <Text style={styles.saveBtnText}>{t('save')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: Colors.textInverse, letterSpacing: -0.5 },
  avatarName: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.2 },
  avatarSub: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },

  sectionHeader: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.9, textTransform: 'uppercase',
    marginBottom: 8, marginTop: 16,
  },
  card: {
    backgroundColor: Colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
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
    marginTop: 24,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
});
