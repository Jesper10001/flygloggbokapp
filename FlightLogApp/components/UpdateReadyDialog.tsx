// "Update ready": en EAS Update är hämtad (vid start, när appen kom tillbaka eller timkollen i SilentUpdates).
// Visas bara på dashboarden (pilot, drönare, Essential), när ingenting annat pågår: inte före onboarding och
// Blades introduction (rundturen eller frågan om den), inte ovanpå App Store-popupen, "Blades was updated",
// en karta eller delningsrutan. "Restart now" startar om med den nya koden direkt; "Later" = den installeras
// nästa gång appen startar (rutan kommer inte tillbaka för samma uppdatering under den här körningen).
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useIsFocused } from 'expo-router';
import { create } from 'zustand';
import { Colors } from '../constants/colors';
import { GlassDialog } from './GlassDialog';
import { useUpdateAppliedOpen } from './UpdateAppliedModal';
import { useTourStore, isIntroTourPending } from '../store/tourStore';
import { useVersionStore } from '../store/versionStore';
import { useMapScreenStore } from '../store/mapScreenStore';
import { useShareSheetStore } from '../services/shareFile';

const ENABLED = !__DEV__ && Updates.isEnabled;
const APP_ICON = require('../assets/applogo-cyanonnavy.png');

// "Later" gäller den hämtade uppdateringen i hela appen (alla dashboards), tills nästa start.
const useLater = create<{ id: string | null }>(() => ({ id: null }));

export function UpdateReadyDialog() {
  return ENABLED ? <Dialog /> : null;
}

function Dialog() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const focused = useIsFocused();
  const tourBusy = useTourStore((st) => st.active || !!st.promptMode);
  const storeUpdate = useVersionStore((st) => st.updateAvailable || st.forceUpdate);
  const appliedOpen = useUpdateAppliedOpen((st) => st.open);
  // Läses alltid, var för sig (aldrig en hook bakom || eller &&).
  const mapOpen = useMapScreenStore((st) => st.open);
  const shareOpen = useShareSheetStore((st) => st.open);
  const laterId = useLater((st) => st.id);
  const [introPending, setIntroPending] = useState(true);
  const [restarting, setRestarting] = useState(false);

  // Blades introduction som ännu inte besvarats efter onboarding → vänta. Läses om när dashboarden får fokus.
  useEffect(() => {
    if (!focused) return;
    let alive = true;
    isIntroTourPending().then((p) => { if (alive) setIntroPending(p); }).catch(() => { if (alive) setIntroPending(false); });
    return () => { alive = false; };
  }, [focused, tourBusy]);

  const id = downloadedUpdate?.updateId ?? 'pending';
  const visible = isUpdatePending && focused && !introPending && !tourBusy && !storeUpdate && !appliedOpen
    && !mapOpen && !shareOpen && laterId !== id;

  const restart = () => {
    setRestarting(true);
    Updates.reloadAsync().catch(() => setRestarting(false));
  };

  return (
    <GlassDialog
      visible={visible || restarting}
      onClose={() => { if (!restarting) useLater.setState({ id }); }}
      icon={<View style={s.iconWrap}><Image source={APP_ICON} style={s.icon} accessibilityIgnoresInvertColors /></View>}
      eyebrow="UPDATE READY"
      title="A new update is ready"
      body="Restart Blades to use it now, or it installs the next time you open the app."
      primary={{ label: restarting ? 'Restarting…' : 'Restart now', onPress: restart, disabled: restarting }}
      secondary={restarting ? undefined : { label: 'Later', onPress: () => useLater.setState({ id }) }}
    />
  );
}

const s = StyleSheet.create({
  iconWrap: {
    marginBottom: 12, borderRadius: 16,
    shadowColor: Colors.primary, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 68, height: 68, borderRadius: 16 },
});
