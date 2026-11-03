// "Downloading update"-kapseln överst: vid start hämtar expo-updates nya rättningar (EAS Update) i bakgrunden.
// Utan något som syntes såg appen ut att ha hängt sig, och man startade om mitt i hämtningen. Kapseln visar
// förloppet och sedan "Update ready" med Restart, så att rättningen gäller direkt (annars nästa gång appen
// öppnas). Efter omstarten visar UpdateAppliedModal vad som är nytt. Bara i App Store- och TestFlight-byggen.

import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';

const ENABLED = !__DEV__ && Updates.isEnabled;

export function UpdateDownloadBanner() {
  return ENABLED ? <Banner /> : null;
}

function Banner() {
  const insets = useSafeAreaInsets();
  const { isDownloading, isUpdatePending, isRestarting, downloadProgress } = Updates.useUpdates();
  const [later, setLater] = useState(false);
  // Kollen efter uppdateringar vid varje start visas inte, bara en hämtning som faktiskt pågår.
  const state = isRestarting ? 'restarting' : isUpdatePending ? 'ready' : isDownloading ? 'downloading' : null;
  if (!state || (state === 'ready' && later)) return null;

  const pct = state === 'downloading' && downloadProgress ? Math.round(downloadProgress * 100) : 0;
  const title = state === 'downloading' ? `Downloading update${pct > 0 && pct < 100 ? ` · ${pct}%` : ''}`
    : state === 'ready' ? 'Update ready' : 'Restarting…';
  const sub = state === 'downloading' ? 'Keep Blades open, it only takes a moment.'
    : state === 'ready' ? 'Restart to use it now, or it installs next time.' : null;

  return (
    <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 6 }]}>
      <View style={s.pill}>
        <View style={s.textWrap} accessible accessibilityLiveRegion="polite" accessibilityLabel={sub ? `${title}. ${sub}` : title}>
          {state === 'ready'
            ? <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
            : <ActivityIndicator size="small" color={Colors.primary} />}
          <View style={{ flexShrink: 1 }}>
            <Text style={s.title} numberOfLines={1}>{title}</Text>
            {sub && <Text style={s.sub} numberOfLines={2}>{sub}</Text>}
          </View>
        </View>
        {state === 'ready' && (
          <>
            <TouchableOpacity style={s.btn} onPress={() => Updates.reloadAsync().catch(() => {})} accessibilityRole="button">
              <Text style={s.btnText}>Restart</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLater(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Later">
              <Ionicons name="close" size={17} color={Colors.textSecondary} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

// Samma kapsel som Toast, men ovanför splashen (zIndex) så att den syns från första stund.
const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 10000 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: 420,
    backgroundColor: Colors.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.primary + '66',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  textWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  title: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  sub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  btn: { backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  btnText: { color: Colors.textInverse, fontSize: 13, fontWeight: '800' },
});
