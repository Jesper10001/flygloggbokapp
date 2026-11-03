// Vid start hämtar expo-updates nya rättningar (EAS Update) i bakgrunden. Utan något som syntes såg appen ut att
// ha hängt sig, och man startade om mitt i hämtningen. Medan den hämtas: "Downloading update"-kapseln överst med
// förloppet. När den är klar: "Update ready"-rutan (GlassDialog, samma stil som "Blades was updated") med
// "Restart now", så att rättningen gäller direkt, eller "Later" (då installeras den nästa gång appen öppnas).
// Efter omstarten visar UpdateAppliedModal vad som är nytt. Bara i App Store- och TestFlight-byggen.

import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { GlassDialog } from './GlassDialog';
import { useUpdateAppliedOpen } from './UpdateAppliedModal';
import { useTourStore } from '../store/tourStore';
import { useVersionStore } from '../store/versionStore';

const ENABLED = !__DEV__ && Updates.isEnabled;
const APP_ICON = require('../assets/applogo-cyanonnavy.png');

export function UpdateDownloadBanner() {
  return ENABLED ? <Banner /> : null;
}

function Banner() {
  const insets = useSafeAreaInsets();
  const { isDownloading, isUpdatePending, isRestarting, downloadProgress } = Updates.useUpdates();
  const [later, setLater] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // Rutan väntar på rundturen och på de andra uppdateringsrutorna, så att två rutor aldrig ligger på varandra.
  const tourActive = useTourStore((st) => st.active || !!st.promptMode);
  const storeUpdate = useVersionStore((st) => st.updateAvailable || st.forceUpdate);
  const appliedOpen = useUpdateAppliedOpen((st) => st.open);

  const ready = isUpdatePending || isRestarting;
  const busy = restarting || isRestarting;
  const restart = () => {
    setRestarting(true);
    Updates.reloadAsync().catch(() => setRestarting(false));
  };

  // Kollen efter uppdateringar vid varje start visas inte, bara en hämtning som faktiskt pågår.
  if (!ready) {
    if (!isDownloading) return null;
    const pct = downloadProgress ? Math.round(downloadProgress * 100) : 0;
    const title = `Downloading update${pct > 0 && pct < 100 ? ` · ${pct}%` : ''}`;
    const sub = 'Keep Blades open, it only takes a moment.';
    return (
      <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 6 }]}>
        <View style={s.pill} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${sub}`}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <View style={{ flexShrink: 1 }}>
            <Text style={s.title} numberOfLines={1}>{title}</Text>
            <Text style={s.sub} numberOfLines={2}>{sub}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <GlassDialog
      visible={!later && !tourActive && !storeUpdate && !appliedOpen}
      onClose={() => { if (!busy) setLater(true); }}
      icon={<View style={s.iconWrap}><Image source={APP_ICON} style={s.icon} accessibilityIgnoresInvertColors /></View>}
      eyebrow="Update ready"
      title="A new update is ready"
      body="Restart Blades to use it now, or it installs the next time you open the app."
      primary={{ label: busy ? 'Restarting…' : 'Restart now', onPress: restart, disabled: busy }}
      secondary={busy ? undefined : { label: 'Later', onPress: () => setLater(true) }}
    />
  );
}

// Kapseln: samma som Toast, men ovanför splashen (zIndex) så att den syns från första stund. Ikonen: samma som
// i UpdateAppliedModal.
const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 10000 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 420,
    backgroundColor: Colors.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.primary + '66',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  sub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  iconWrap: {
    marginBottom: 12, borderRadius: 16,
    shadowColor: Colors.primary, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 68, height: 68, borderRadius: 16 },
});
