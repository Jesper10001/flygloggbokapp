// Mjuk "uppdatering finns"-popup på dashboarden. Visas när en nyare version ligger på App Store
// (useVersionStore.updateAvailable). Går att trycka bort (bara denna gång) och dyker upp igen nästa
// gång appen öppnas/kommer i förgrunden — tills man uppdaterat (då blir updateAvailable false av sig
// själv eftersom appens version matchar App Store-versionen). forceUpdate har en egen helskärmsgate
// i app/_layout.tsx och hanteras inte här.

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Modal, Linking, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useVersionStore } from '../store/versionStore';
import { useTourStore } from '../store/tourStore';

export function UpdateAvailableModal() {
  const { updateAvailable, forceUpdate, latestVersion, storeUrl, news, check } = useVersionStore();
  const tourActive = useTourStore((s) => s.active || !!s.promptMode);
  const [dismissed, setDismissed] = useState(false);

  // Kör en koll vid mount, och varje gång appen kommer i förgrunden igen → då nollas även "borttryckt"
  // så notisen kommer tillbaka (om man inte uppdaterat).
  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { setDismissed(false); check(); }
    });
    return () => sub.remove();
  }, [check]);

  // forceUpdate visas som egen helskärm i _layout; göm den mjuka popupen under rundturen.
  if (!updateAvailable || forceUpdate || dismissed || tourActive) return null;

  const isUpdateNews = news?.type === 'update';
  const title = isUpdateNews && news?.title ? news.title : 'Update available';
  const body = isUpdateNews && news?.body
    ? news.body
    : `A newer version of Blades${latestVersion ? ` (${latestVersion})` : ''} is available with the latest features and fixes.`;

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => setDismissed(true)}>
      <Pressable style={s.scrim} onPress={() => setDismissed(true)}>
        <Pressable style={s.card} onPress={() => { /* svälj */ }}>
          <View style={s.icon}><Ionicons name="arrow-up-circle" size={28} color={Colors.primary} /></View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.body}>{body}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(storeUrl)} activeOpacity={0.85} style={s.primaryBtn}>
            <Text style={s.primaryTxt}>Update now</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDismissed(true)} activeOpacity={0.8} style={s.laterBtn}>
            <Text style={s.laterTxt}>Later</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 400, backgroundColor: Colors.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 14 },
  icon: { width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: Colors.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginBottom: 8 },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: Colors.primary, borderRadius: 13, paddingVertical: 13, alignItems: 'center' },
  primaryTxt: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
  laterBtn: { alignSelf: 'stretch', paddingVertical: 11, alignItems: 'center' },
  laterTxt: { color: Colors.textSecondary, fontSize: 14.5, fontWeight: '700' },
});
