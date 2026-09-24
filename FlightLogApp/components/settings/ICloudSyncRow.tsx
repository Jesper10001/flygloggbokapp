// Delad Settings-komponent: "iCloud Sync"-toggle + "iCloud Storage"-knapp. Monteras i både
// pilot- (app/(tabs)/settings.tsx) och drönar-läget (app/(tabs)/drone-settings.tsx). All logik i
// store/icloudStore.ts → services/icloudSync.ts. Strängar hålls på engelska (appen är en-låst).
import { useCallback } from 'react';
import { View, Text, Switch, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useICloudStore } from '../../store/icloudStore';

function relTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ICloudSyncRow({ accent = Colors.primary }: { accent?: string }) {
  const router = useRouter();
  const { hasModule, enabled, status, lastError, manifest, busy, refresh, setEnabled } = useICloudStore();

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const statusText = (): string => {
    if (!hasModule) return 'Available in the full app build';
    if (status === 'uploading') return 'Backing up…';
    if (status === 'restoring') return 'Restoring…';
    if (status === 'checking') return 'Checking…';
    if (status === 'error') return lastError ?? 'Something went wrong';
    if (enabled && manifest) return `Synced · ${relTime(manifest.createdAt)}`;
    if (enabled) return 'On';
    return 'Off · your data stays on this device';
  };
  const statusColor = status === 'error' ? Colors.danger : enabled ? Colors.success : Colors.textMuted;

  return (
    <View style={{
      marginHorizontal: 20, backgroundColor: Colors.card, borderRadius: 16,
      borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
    }}>
      {/* Toggle-rad */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
        gap: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
      }}>
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: accent + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="cloud-outline" size={16} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>iCloud Sync</Text>
          <Text style={{ fontSize: 12, color: statusColor, marginTop: 2 }} numberOfLines={2}>{statusText()}</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={accent} style={{ marginRight: 4 }} /> : null}
        <Switch
          value={enabled}
          disabled={!hasModule || busy}
          onValueChange={(v) => setEnabled(v)}
          trackColor={{ false: Colors.elevated, true: accent }}
        />
      </View>

      {/* Storage-rad (grå-inaktiverad tills synk är på) */}
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={!enabled}
        onPress={() => router.push('/settings/icloud')}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14, opacity: enabled ? 1 : 0.45 }}
      >
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="folder-open-outline" size={16} color={Colors.textSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>iCloud Storage</Text>
          <Text style={{ fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>See what's backed up</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}
