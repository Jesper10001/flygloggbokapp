// "Blades was updated"-popupen: visas en gång när appen startat med en ny EAS Update (rättningar utan App Store).
// Samma utseende som "Update available" (UpdateAvailableModal, förlagan som lämnas orörd) via GlassDialog, men
// inget att göra: uppdateringen är redan installerad. Vad som är nytt bakas in i paketet när det publiceras
// (scripts/publish-update.mjs --notes "Fixed: …|Improved: …" → EXPO_PUBLIC_UPDATE_NOTES), med samma radformat
// som App Store-texten. Utan noter visas bara rubriken och brödtexten.

import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { Colors } from '../constants/colors';
import { GlassDialog } from './GlassDialog';
import { getSetting, setSetting } from '../db/flights';
import { parseReleaseNotes, useVersionStore, type ReleaseNote } from '../store/versionStore';
import { useTourStore } from '../store/tourStore';

const APP_ICON = require('../assets/applogo-cyanonnavy.png');
const SEEN_KEY = 'last_seen_update_id';
const KIND_LABEL: Record<ReleaseNote['kind'], string> = { new: 'New', fix: 'Fixed', improved: 'Improved', other: '' };

/** Id för uppdateringen som körs, om det är en nedladdad EAS Update (inte appens inbyggda kod eller dev). */
function runningUpdateId(): string | null {
  if (__DEV__ || !Updates.isEnabled || Updates.isEmbeddedLaunch) return null;
  return Updates.updateId ?? null;
}

export function UpdateAppliedModal() {
  const tourActive = useTourStore((st) => st.active || !!st.promptMode);
  // Väntar till App Store-popupen är borta, så att två rutor aldrig ligger på varandra.
  const storeUpdate = useVersionStore((st) => st.updateAvailable || st.forceUpdate);
  const [updateId, setUpdateId] = useState<string | null>(null);

  useEffect(() => {
    const id = runningUpdateId();
    if (!id) return;
    getSetting(SEEN_KEY).then((seen) => { if (seen !== id) setUpdateId(id); }).catch(() => {});
  }, []);

  const close = () => {
    if (updateId) setSetting(SEEN_KEY, updateId).catch(() => {});
    setUpdateId(null);
  };

  const { notes, more } = parseReleaseNotes(process.env.EXPO_PUBLIC_UPDATE_NOTES ?? '');

  return (
    <GlassDialog
      visible={!!updateId && !tourActive && !storeUpdate}
      onClose={close}
      icon={<View style={s.iconWrap}><Image source={APP_ICON} style={s.icon} accessibilityIgnoresInvertColors /></View>}
      eyebrow="UPDATED"
      title="Blades was updated"
      body="The update was installed in the background. There's nothing you need to do."
      primary={{ label: 'Got it', onPress: close }}
    >
      {notes.length > 0 && (
        <View style={s.notes}>
          <Text style={s.notesHead}>What's new</Text>
          {notes.map((n, i) => (
            <View key={i} style={s.note} accessible accessibilityLabel={KIND_LABEL[n.kind] ? `${KIND_LABEL[n.kind]}: ${n.text}` : n.text}>
              <Text style={s.noteKind}>{KIND_LABEL[n.kind].toUpperCase()}</Text>
              <Text style={s.noteTxt}>{n.text}</Text>
            </View>
          ))}
          {more && <Text style={s.more}>And more fixes and improvements.</Text>}
        </View>
      )}
    </GlassDialog>
  );
}

// Samma mått som listan i UpdateAvailableModal.
const s = StyleSheet.create({
  iconWrap: {
    marginBottom: 12, borderRadius: 16,
    shadowColor: Colors.primary, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 68, height: 68, borderRadius: 16 },
  notes: {
    alignSelf: 'stretch', marginTop: 18, paddingTop: 16, gap: 11,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)',
  },
  notesHead: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800', letterSpacing: 0.2, marginBottom: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  noteKind: { width: 72, color: Colors.textSecondary, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9, marginTop: 3 },
  noteTxt: { flex: 1, color: Colors.textPrimary, opacity: 0.92, fontSize: 14, lineHeight: 19.5 },
  more: { color: Colors.textSecondary, fontSize: 13, marginLeft: 84 },
});
