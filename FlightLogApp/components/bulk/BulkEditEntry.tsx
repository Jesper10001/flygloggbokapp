// Ingången till Edit many flights (app/bulk-edit.tsx) i loggbokens lista, pilot- och drönarläget.
// Visar hur många saker i loggboken som ser fel ut ("Check your data"), räknat på flygningarna i listan
// minus förslagen man har avfärdat.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/colors';
import { getSetting } from '../../db/flights';
import { suggestionsFor, type BulkMode, type BulkRow } from '../../services/bulkEdit/engine';

export function BulkEditEntry({ mode, rows, accent }: { mode: BulkMode; rows: BulkRow[]; accent: string }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useFocusEffect(useCallback(() => {
    getSetting(`bulk_dismissed_${mode}`).then((raw) => { try { setDismissed(raw ? JSON.parse(raw) : []); } catch { setDismissed([]); } }).catch(() => {});
  }, [mode]));
  const toCheck = useMemo(() => suggestionsFor(mode, rows).filter((s) => !dismissed.includes(s.id)).length, [mode, rows, dismissed]);
  return (
    <TouchableOpacity onPress={() => router.push(`/bulk-edit?mode=${mode}` as any)} activeOpacity={0.8} accessibilityRole="button"
      accessibilityLabel={toCheck ? `Edit many flights. ${toCheck} to check in your data.` : 'Edit many flights'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingHorizontal: 12, height: 44, borderRadius: 11, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface }}>
      <Ionicons name="checkmark-done-outline" size={17} color={accent} />
      <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: Colors.textPrimary }}>Edit many flights</Text>
      {toCheck > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: Colors.warning + '1F', borderWidth: 1, borderColor: Colors.warning + '59' }}>
          <Ionicons name="alert-circle-outline" size={13} color={Colors.warning} />
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: Colors.warning }}>{toCheck} to check</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}
