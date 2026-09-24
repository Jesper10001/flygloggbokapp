// "iCloud Storage"-vy: visar EXAKT vad som ligger i molnbackupen (läst ur manifest.json), konto-/synk-
// status, och åtgärder (Back up now / Restore / Delete). Presenteras som modal (route registrerad i
// app/_layout.tsx). Strängar på engelska (appen är en-låst).
import { useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useICloudStore } from '../../store/icloudStore';

function relTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtBytes(n: number): string {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// manifest.counts-nycklar → visningsetiketter (fasta, i wanted display-ordning).
const COUNT_LABELS: [string, string][] = [
  ['flights', 'Flights'],
  ['droneFlights', 'Drone flights'],
  ['aircraft', 'Aircraft types'],
  ['drones', 'Drones'],
  ['books', 'Logbook books'],
  ['favorites', 'Favorite airports'],
  ['customAirports', 'Custom airports'],
  ['templates', 'Custom templates'],
];

export default function ICloudStorageScreen() {
  const { hasModule, available, signedIn, enabled, status, lastError, manifest, busy, refresh, backupNow, restoreNow, deleteBackup } = useICloudStore();

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const runBackup = async () => {
    await backupNow();
    const st = useICloudStore.getState();
    if (st.status === 'error') Alert.alert('Backup failed', st.lastError ?? 'Please try again.');
  };

  const confirmRestore = () => {
    Alert.alert(
      'Restore from iCloud',
      'This replaces the data on this device with the latest iCloud backup. A local safety copy is made first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', style: 'destructive', onPress: async () => {
            await restoreNow();
            const st = useICloudStore.getState();
            if (st.status === 'error') Alert.alert('Restore failed', st.lastError ?? 'Please try again.');
            else Alert.alert('Restore complete', 'Your data has been restored from iCloud.');
          },
        },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete iCloud backup',
      'This removes the backup from iCloud. The data on this device is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteBackup() },
      ],
    );
  };

  // ── Ej tillgängligt (ingen native-modul / ej inloggad) ──
  if (!hasModule || !available) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <View style={s.card}>
          <View style={s.centerBox}>
            <Ionicons name={hasModule ? 'cloud-offline-outline' : 'construct-outline'} size={40} color={Colors.textMuted} />
            <Text style={s.emptyTitle}>{hasModule ? 'iCloud unavailable' : 'Not in this build'}</Text>
            <Text style={s.emptyText}>
              {!hasModule
                ? 'iCloud sync is available in the full app build (App Store / TestFlight).'
                : signedIn
                  ? 'iCloud Drive is turned off for this app. Enable it in Settings › Apple ID › iCloud › iCloud Drive.'
                  : 'Sign in to iCloud on this device to use sync (Settings › Apple ID).'}
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* Status */}
      <View style={s.card}>
        <View style={s.statusRow}>
          <View style={[s.dot, { backgroundColor: status === 'error' ? Colors.danger : status === 'synced' ? Colors.success : Colors.gold }]} />
          <Text style={s.statusText}>
            {status === 'uploading' ? 'Backing up…'
              : status === 'restoring' ? 'Restoring…'
              : status === 'checking' ? 'Checking…'
              : status === 'error' ? (lastError ?? 'Error')
              : manifest ? 'Synced' : 'No backup yet'}
          </Text>
          {busy ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
        </View>
        {manifest ? (
          <Text style={s.statusSub}>
            Last backup {relTime(manifest.createdAt)}{manifest.device ? ` · from ${manifest.device}` : ''} · {fmtBytes(manifest.totalBytes)}
          </Text>
        ) : (
          <Text style={s.statusSub}>Turn on iCloud Sync and back up to store your data in iCloud.</Text>
        )}
      </View>

      {/* Stored in iCloud */}
      {manifest ? (
        <>
          <Text style={s.sectionLabel}>Stored in iCloud</Text>
          <View style={s.card}>
            {COUNT_LABELS.filter(([k]) => (manifest.counts?.[k] ?? 0) > 0).map(([k, label], i, arr) => (
              <View key={k} style={[s.dataRow, i < arr.length - 1 && s.dataRowBorder]}>
                <Text style={s.dataLabel}>{label}</Text>
                <Text style={s.dataValue}>{manifest.counts[k].toLocaleString('en-US')}</Text>
              </View>
            ))}
            <View style={[s.dataRow]}>
              <Text style={s.dataLabel}>Photos &amp; cutouts</Text>
              <Text style={s.dataValue}>
                {manifest.files.length}{manifest.files.length ? ` · ${fmtBytes(manifest.files.reduce((a, f) => a + (f.size || 0), 0))}` : ''}
              </Text>
            </View>
          </View>
          <Text style={s.footnote}>
            Photos linked from your library sync via iCloud Photos and appear on devices where iCloud Photos is on.
          </Text>
        </>
      ) : null}

      {/* Actions */}
      <Text style={s.sectionLabel}>Actions</Text>
      <View style={s.card}>
        <TouchableOpacity style={s.actionRow} disabled={busy} activeOpacity={0.7} onPress={runBackup}>
          <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
          <Text style={[s.actionText, { color: Colors.primary }]}>Back up now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionRow, s.dataRowBorderTop]} disabled={busy || !manifest} activeOpacity={0.7} onPress={confirmRestore}>
          <Ionicons name="cloud-download-outline" size={18} color={manifest ? Colors.textPrimary : Colors.textMuted} />
          <Text style={[s.actionText, { color: manifest ? Colors.textPrimary : Colors.textMuted }]}>Restore from iCloud</Text>
        </TouchableOpacity>
      </View>

      {manifest ? (
        <TouchableOpacity style={s.deleteBtn} disabled={busy} activeOpacity={0.7} onPress={confirmDelete}>
          <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          <Text style={s.deleteText}>Delete iCloud backup</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  card: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  centerBox: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  statusSub: { fontSize: 12.5, color: Colors.textMuted, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, lineHeight: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 14, marginBottom: 2, marginLeft: 4 },
  dataRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 16 },
  dataRowBorder: { borderBottomWidth: 0.5, borderBottomColor: Colors.separator },
  dataRowBorderTop: { borderTopWidth: 0.5, borderTopColor: Colors.separator },
  dataLabel: { fontSize: 14, color: Colors.textSecondary },
  dataValue: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'Menlo' },
  footnote: { fontSize: 11.5, color: Colors.textMuted, lineHeight: 17, marginTop: 8, marginHorizontal: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 16 },
  actionText: { fontSize: 15, fontWeight: '600' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 18 },
  deleteText: { fontSize: 14, fontWeight: '600', color: Colors.danger },
});
