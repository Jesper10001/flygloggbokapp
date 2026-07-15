// List-vyn: sticky header (titel), sök, filterchips, år→månad-accordion + årskalender.
import { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { roleLabel } from './flightDisplay';
import { YearMonthAccordion } from './YearMonthAccordion';
import { HeatmapCalendar } from '../insights/ActivitySection';

const FILTERS: [string, string][] = [['all', 'All'], ['pic', 'PIC'], ['ifr', 'IFR'], ['night', 'Night'], ['photo', 'Photo']];

export function ListView({ flights, accent, placeNames, onOpenFlight, expandYear, expandMonthKey, headerRight }: {
  flights: Flight[]; accent: string; placeNames: Record<string, string>;
  onOpenFlight: (f: Flight) => void; expandYear?: number | null; expandMonthKey?: string | null;
  headerRight?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const sorted = useMemo(() => [...flights].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [flights]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return sorted.filter((f) => {
      if (filter === 'pic' && roleLabel(f) !== 'PIC') return false;
      if (filter === 'ifr' && !(f.ifr > 0)) return false;
      if (filter === 'night' && !(f.night > 0)) return false;
      if (filter === 'photo' && !(f.photo_uri || f.photo_local_id)) return false; // inkl. synkade + videor
      if (ql) {
        const hay = `${f.dep_place} ${f.arr_place} ${placeNames[f.dep_place] || ''} ${placeNames[f.arr_place] || ''} ${f.registration} ${f.aircraft_type} ${roleLabel(f)}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [sorted, q, filter, placeNames]);

  const forceOpen = !!q.trim() || filter !== 'all';
  const photoMode = filter === 'photo';

  return (
    <View style={{ flex: 1 }}>
      {/* sticky header */}
      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: Colors.textPrimary, flex: 1 }}>Logbook</Text>
          {headerRight}
        </View>
        {/* sök */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search airport, aircraft, role…" placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters" style={{ flex: 1, color: Colors.textPrimary, fontSize: 13.5, padding: 0 }} />
          {q ? <TouchableOpacity onPress={() => setQ('')}><Ionicons name="close" size={15} color={Colors.textMuted} /></TouchableOpacity> : null}
        </View>
        {/* filterchips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 10 }}>
          {FILTERS.map(([k, label]) => {
            const sel = filter === k;
            return (
              <TouchableOpacity key={k} onPress={() => setFilter(k)} activeOpacity={0.8}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: sel ? accent : Colors.border, backgroundColor: sel ? accent : Colors.surface }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: sel ? Colors.background : Colors.textSecondary }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* body */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 50, paddingHorizontal: 20 }}>
            <Ionicons name="airplane-outline" size={44} color={Colors.textMuted} />
            <Text style={{ fontFamily: FONT_MONO, fontSize: 12, color: Colors.textMuted, marginTop: 10, textAlign: 'center' }}>
              {q.trim() ? `No flights match "${q.trim()}"` : 'No flights yet'}
            </Text>
          </View>
        ) : (
          <YearMonthAccordion flights={filtered} accent={accent} filter={filter} photoMode={photoMode}
            forceOpen={forceOpen} onOpenFlight={onOpenFlight} expandYear={expandYear} expandMonthKey={expandMonthKey} />
        )}
        {/* Årskalender + almenacka längst ner, under äldsta årtalet (bara i ofiltrerad vy) */}
        {filter === 'all' && !q.trim() && flights.length > 0 && (
          <View style={{ paddingHorizontal: 14, marginTop: 14 }}>
            <HeatmapCalendar />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
