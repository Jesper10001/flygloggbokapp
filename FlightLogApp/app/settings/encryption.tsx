import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

// Läs-sida: förklarar hur appens data krypteras och vad det innebär. Öppnas från
// Settings → App → Security → "Encryption information". Engelska (appen är en-låst).

function Section({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={s.iconBox}><Ionicons name={icon} size={16} color={Colors.primary} /></View>
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
}

export default function EncryptionInfoScreen() {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <View style={s.heroBadge}><Ionicons name="lock-closed" size={26} color={Colors.primary} /></View>
        <Text style={s.heroTitle}>Your logbook is encrypted</Text>
        <Text style={s.heroSub}>
          Everything you log is stored encrypted on your device. Here's what that means.
        </Text>
      </View>

      <Section icon="shield-checkmark-outline" title="Encrypted at rest (AES-256)">
        <P>
          Your flight database is encrypted on this device using SQLCipher with AES-256 — the same class of
          encryption trusted for sensitive data. If someone gained access to the raw database file, it would be
          unreadable without the key.
        </P>
      </Section>

      <Section icon="key-outline" title="A key only your device holds">
        <P>
          The encryption key is generated on your device and stored in the iOS Keychain, protected by the Secure
          Enclave. It never leaves your device and is never sent to us or anyone else. There is no separate password
          to remember — unlocking your phone is what protects the key.
        </P>
      </Section>

      <Section icon="finger-print-outline" title="No password, no friction">
        <P>
          Because the key lives in the Keychain, the app opens straight to your logbook — no login, no PIN. The
          protection is transparent: you get strong encryption without any extra step.
        </P>
      </Section>

      <Section icon="cloud-outline" title="iCloud backup stays encrypted">
        <P>
          If you turn on iCloud Sync, the backup snapshot is itself an encrypted copy — it is not stored in the
          clear. Restoring on the same device uses your Keychain key automatically.
        </P>
      </Section>

      <Section icon="phone-portrait-outline" title="What you can do">
        <P>
          Keep a device passcode (or Face ID / Touch ID) enabled — it's the lock that guards the key. For the
          strongest iCloud protection, you can also enable Apple's Advanced Data Protection in your iCloud settings.
        </P>
      </Section>

      <Text style={s.footnote}>
        Blades uses standard encryption (AES + HTTPS), which is exempt from additional export requirements.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  hero: { alignItems: 'center', gap: 10, marginBottom: 4, paddingHorizontal: 8 },
  heroBadge: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.primary + '1A',
    borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontFamily: 'Georgia', fontSize: 24, fontWeight: '400', color: Colors.textPrimary, textAlign: 'center' },
  heroSub: { fontSize: 13.5, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 16, gap: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.primary + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: 15.5, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.2 },
  body: { fontSize: 13.5, color: Colors.textSecondary, lineHeight: 20 },
  footnote: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', lineHeight: 16, marginTop: 6, paddingHorizontal: 10 },
});
