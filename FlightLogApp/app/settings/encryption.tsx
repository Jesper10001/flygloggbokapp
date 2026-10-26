import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Alert, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TourPress } from '../../components/TourPress';
import { getDatabaseEncryption, setDatabaseEncryption } from '../../db/database';
import { isEnabled as isICloudBackupEnabled } from '../../services/icloudSync';
import { useICloudStore } from '../../store/icloudStore';

// Krypteringssidan: iOS dataskydd gäller alltid. Extra kryptering (SQLCipher AES-256, nyckel i Keychain) är ett
// eget val — AV som standard, befintliga krypterade installationer står som PÅ. Reglaget konverterar loggboken
// (db/database.setDatabaseEncryption) efter en riskdialog. Öppnas från Settings → App → "Encryption".
// Engelska (appen är en-låst).

type Busy = { on: boolean; done: boolean } | null;

function Section({ icon, title, tone = Colors.primary, children }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; tone?: string; children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={[s.iconBox, { backgroundColor: tone + '22' }]}><Ionicons name={icon} size={16} color={tone} /></View>
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
}

export default function EncryptionScreen() {
  const [on, setOn] = useState<boolean | null>(null); // null = läses fortfarande
  const [busy, setBusy] = useState<Busy>(null);
  const [backupOn, setBackupOn] = useState(false);
  const icloudBusy = useICloudStore((st) => st.busy);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    getDatabaseEncryption().then((v) => { if (mounted.current) setOn(v); }).catch(() => { if (mounted.current) setOn(false); });
    isICloudBackupEnabled().then((v) => { if (mounted.current) setBackupOn(v); }).catch(() => {});
    return () => { mounted.current = false; };
  }, []);

  const run = async (next: boolean) => {
    setBusy({ on: next, done: false });
    try {
      await setDatabaseEncryption(next);
      if (!mounted.current) return;
      setOn(next);
      setBusy({ on: next, done: true });
      // iCloud-kopian ska följa det nya läget direkt (storen hoppar själv över om en backup redan pågår).
      if (backupOn) useICloudStore.getState().backupNow().catch(() => {});
      setTimeout(() => { if (mounted.current) setBusy(null); }, 1100);
    } catch (e) {
      console.warn('[encryption] toggle failed', e);
      if (!mounted.current) return;
      setBusy(null);
      Alert.alert(
        next ? "Couldn't turn on encryption" : "Couldn't turn off encryption",
        'Your logbook was not changed. Please try again.',
      );
    }
  };

  const onToggle = (next: boolean) => {
    if (on === null || busy || icloudBusy) return;
    if (next) {
      Alert.alert(
        'Turn on extra encryption?',
        "Your logbook will be encrypted with AES-256, using a key stored in this iPhone's Keychain.\n\n" +
        "If that key is ever lost, the logbook can't be opened — not even by Blades. " +
        (backupOn
          ? 'Your next iCloud backup saves a copy of the key in your iCloud Keychain.'
          : "iCloud Sync is off, so the key will exist only on this iPhone. Turn on iCloud Sync to keep a copy in your iCloud Keychain."),
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn on', onPress: () => { void run(true); } },
        ],
      );
    } else {
      Alert.alert(
        'Turn off extra encryption?',
        'Your logbook will be protected by iOS data protection only. Nothing is deleted.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Turn off', style: 'destructive', onPress: () => { void run(false); } },
        ],
      );
    }
  };

  const enabled = on === true;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <View style={s.heroBadge}>
          <Ionicons name={enabled ? 'lock-closed' : 'shield-checkmark'} size={26} color={Colors.primary} />
        </View>
        <Text style={s.heroTitle}>{enabled ? 'Extra encryption is on' : 'Protected by iOS'}</Text>
        <Text style={s.heroSub}>
          {enabled
            ? 'Your logbook is encrypted with AES-256, on top of the protection iOS gives every app.'
            : 'Your logbook stays on this iPhone, protected by iOS. Turn on AES-256 below for an extra layer.'}
        </Text>
      </View>

      <View style={s.toggleCard}>
        <TourPress id="enc-toggle" variant="focus" radius={16} />
        <View style={s.toggleRow}>
          <View style={[s.iconBox, { backgroundColor: Colors.primary + '22' }]}>
            <Ionicons name="key-outline" size={16} color={Colors.primary} />
          </View>
          <View style={s.toggleText}>
            <Text style={s.toggleTitle}>Extra encryption (AES-256)</Text>
            <Text style={s.toggleSub}>{enabled ? "On · key kept in this iPhone's Keychain" : 'Off · optional'}</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            disabled={on === null || !!busy || icloudBusy}
            trackColor={{ false: Colors.elevated, true: Colors.primary }}
          />
        </View>
        {icloudBusy && <Text style={s.toggleHint}>Wait for the iCloud backup to finish before changing this.</Text>}
      </View>

      <Section icon="phone-portrait-outline" title="Always on: iOS data protection">
        <P>
          Your logbook is stored only on this iPhone — no account, no Blades servers. iOS encrypts the app's files
          with a key tied to your passcode, so they can't be read while the phone is off or hasn't been unlocked
          since it restarted. Keep a passcode (or Face ID / Touch ID) turned on — it's the lock that guards everything.
        </P>
      </Section>

      <Section icon="key-outline" title="Extra: AES-256 encryption">
        <P>
          Turn it on and the logbook database itself is encrypted with AES-256 (SQLCipher), using a key that is
          created on this iPhone and kept in the iOS Keychain. The key is never sent to Blades, and there's no
          password — the app still opens straight to your logbook.
        </P>
      </Section>

      <Section icon="warning-outline" title="Before you turn it on" tone={Colors.warning}>
        <P>
          The key is the only way to open an encrypted logbook. If it's lost — for example when an iPhone is
          restored from an unencrypted computer backup, or its Keychain is reset — the logbook can't be opened,
          not even by Blades. With iCloud Sync on, a copy of the key is kept in your iCloud Keychain so you can
          restore on a new iPhone. You can turn the extra encryption off at any time; nothing is deleted.
        </P>
      </Section>

      <Section icon="cloud-outline" title="iCloud backup">
        <P>
          {enabled
            ? 'Your iCloud backup is an encrypted copy of the logbook that only your key can open. '
            : 'Your iCloud backup is stored in your iCloud account and protected by Apple. '}
          For end-to-end encryption of everything in iCloud, turn on Advanced Data Protection in your iCloud settings.
        </P>
      </Section>

      <Modal visible={!!busy} transparent animationType="fade" statusBarTranslucent>
        <View style={s.overlay}>
          <View style={s.overlayCard}>
            {busy?.done
              ? <Ionicons name="checkmark-circle" size={36} color={Colors.success} />
              : <ActivityIndicator size="large" color={Colors.primary} />}
            <Text style={s.overlayTitle}>
              {busy?.done
                ? (busy.on ? 'Extra encryption is on' : 'Extra encryption is off')
                : (busy?.on ? 'Encrypting your logbook…' : 'Removing extra encryption…')}
            </Text>
            {!busy?.done && <Text style={s.overlaySub}>Keep Blades open — this takes a few seconds.</Text>}
          </View>
        </View>
      </Modal>
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
  toggleCard: {
    backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.primary + '55',
    padding: 16, gap: 10,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleText: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: 15.5, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.2 },
  toggleSub: { fontSize: 12.5, color: Colors.textSecondary },
  toggleHint: { fontSize: 12, color: Colors.warning, lineHeight: 17 },
  card: {
    backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 16, gap: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 15.5, fontWeight: '700', color: Colors.textPrimary, letterSpacing: -0.2 },
  body: { fontSize: 13.5, color: Colors.textSecondary, lineHeight: 20 },
  overlay: { flex: 1, backgroundColor: 'rgba(5,12,24,0.72)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  overlayCard: {
    width: '100%', maxWidth: 320, backgroundColor: Colors.card, borderRadius: 18, borderWidth: 1,
    borderColor: Colors.cardBorder, paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center', gap: 12,
  },
  overlayTitle: { fontSize: 16.5, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  overlaySub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
});
