// Kortet under Log flight-knappen på dashboarden (pilot och drönare) när det finns ett ofullständigt utkast
// (services/flightDrafts). Ett tryck fortsätter i Log Flight; krysset slänger utkastet efter en fråga.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Colors } from '../constants/colors';
import { loadFlightDraft, clearFlightDraft, type DraftMode, type FlightDraft } from '../services/flightDrafts';

export function DraftBanner({ mode, onOpen }: { mode: DraftMode; onOpen: () => void }) {
  const [draft, setDraft] = useState<FlightDraft | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    loadFlightDraft(mode).then((d) => { if (alive) setDraft(d); });
    return () => { alive = false; };
  }, [mode]));
  if (!draft) return null;

  const discard = () => Alert.alert('Discard this draft?', 'The unfinished flight is deleted. This can\'t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: () => { clearFlightDraft(mode).catch(() => {}); setDraft(null); } },
  ]);

  return (
    <TouchableOpacity style={s.card} onPress={onOpen} activeOpacity={0.85} accessibilityRole="button"
      accessibilityLabel={`Unfinished draft, ${draft.title}. Continue logging.`}>
      <View style={s.icon}><Ionicons name="document-text-outline" size={17} color={Colors.warning} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={1}>Unfinished draft · <Text style={s.route}>{draft.title}</Text></Text>
        {draft.subtitle ? <Text style={s.sub} numberOfLines={1}>{draft.subtitle}</Text> : null}
      </View>
      <Text style={s.cta}>Continue</Text>
      <Ionicons name="chevron-forward" size={15} color={Colors.warning} />
      <TouchableOpacity onPress={discard} hitSlop={10} accessibilityLabel="Discard draft" style={{ marginLeft: 4 }}>
        <Ionicons name="close" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.warning + '77', backgroundColor: Colors.warning + '10',
  },
  icon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.warning + '1F' },
  title: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '800' },
  route: { color: Colors.textPrimary, fontWeight: '700' },
  sub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  cta: { color: Colors.warning, fontSize: 13, fontWeight: '800' },
});
