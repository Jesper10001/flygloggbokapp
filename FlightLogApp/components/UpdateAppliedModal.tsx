// "Blades was updated"-popupen: visas en gång när appen startat med en ny EAS Update (rättningar utan App Store).
// Samma utseende som "Update available" (UpdateAvailableModal, förlagan som lämnas orörd) via GlassDialog, men
// inget att göra: uppdateringen är redan installerad. Vad som är nytt står i constants/updateNotes.json, en post
// per uppdatering, och bara posterna sedan popupen senast visades tas med (services/updateNotes.ts). Utan nya
// poster visas bara rubriken och brödtexten.

import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { create } from 'zustand';
import { Colors } from '../constants/colors';
import { GlassDialog } from './GlassDialog';
import { getSetting, setSetting } from '../db/flights';
import { useVersionStore, type ReleaseNote } from '../store/versionStore';
import { NOTES_ID, PREVIOUS_NOTES_ID, notesSince } from '../services/updateNotes';
import { useTourStore } from '../store/tourStore';

const APP_ICON = require('../assets/applogo-cyanonnavy.png');
const SEEN_KEY = 'last_seen_update_id';
const NOTES_KEY = 'last_seen_update_notes'; // senaste posten i constants/updateNotes.json som användaren redan har
const KIND_LABEL: Record<ReleaseNote['kind'], string> = { new: 'New', fix: 'Fixed', improved: 'Improved', other: '' };

// Rutan är öppen: "Update ready" (UpdateDownloadBanner) väntar tills den stängts. Händer när ännu en rättning
// hämtats medan den här visar den förra.
export const useUpdateAppliedOpen = create<{ open: boolean }>(() => ({ open: false }));

/** Id för uppdateringen som körs, om det är en nedladdad EAS Update (inte appens inbyggda kod eller dev). */
function runningUpdateId(): string | null {
  if (__DEV__ || !Updates.isEnabled || Updates.isEmbeddedLaunch) return null;
  return Updates.updateId ?? null;
}

export function UpdateAppliedModal() {
  const tourActive = useTourStore((st) => st.active || !!st.promptMode);
  // Väntar till App Store-popupen är borta, så att två rutor aldrig ligger på varandra.
  const storeUpdate = useVersionStore((st) => st.updateAvailable || st.forceUpdate);
  const [shown, setShown] = useState<{ updateId: string; notes: ReleaseNote[]; more: boolean } | null>(null);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    (async () => {
      const raw = await getSetting(NOTES_KEY);
      const since = raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
      const id = runningUpdateId();
      // Bygget självt (App Store eller TestFlight): allt i listan följer med det, och App Store visar What's New.
      if (!id) {
        if (since == null || since < NOTES_ID) await setSetting(NOTES_KEY, String(NOTES_ID));
        return;
      }
      const seen = await getSetting(SEEN_KEY);
      if (seen === id) return;
      // Inget sparat (appen hade koden före listan): har en popup visats förut är bara den senaste posten ny.
      setShown({ updateId: id, ...notesSince(since ?? (seen ? PREVIOUS_NOTES_ID : null)) });
    })().catch(() => {});
  }, []);

  const close = () => {
    if (shown) {
      setSetting(SEEN_KEY, shown.updateId).catch(() => {});
      setSetting(NOTES_KEY, String(NOTES_ID)).catch(() => {});
    }
    setShown(null);
  };

  const notes = shown?.notes ?? [];
  const more = shown?.more ?? false;
  const visible = !!shown && !tourActive && !storeUpdate;
  useEffect(() => {
    useUpdateAppliedOpen.setState({ open: visible });
    return () => useUpdateAppliedOpen.setState({ open: false }); // skärmen kan lämnas medan rutan är öppen
  }, [visible]);

  return (
    <GlassDialog
      visible={visible}
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
