// Lista över ett lands flygplatser (öppnas från flagg-pin på GlobalAirportMap). Länder med
// ≥300 flygplatser regionindelas i expanderbara sektioner (t.ex. USA per delstat) via ISO
// 3166-2-koder; mindre länder visas i en platt bokstavsordnad lista.
import { useMemo, useState } from 'react';
import { View, Text, SectionList, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { flagEmoji } from '../constants/continents';
import { regionName } from '../constants/isoRegions';
import type { SeedRow } from './GlobalAirportMap';

const REGION_THRESHOLD = 100; // ≥ detta → regionindela

// Land-namn via ICU (Expo/Hermes). Faller tillbaka till koden om Intl.DisplayNames saknas.
let _dn: Intl.DisplayNames | null | undefined;
function countryName(cc: string): string {
  if (_dn === undefined) { try { _dn = new (Intl as any).DisplayNames(['en'], { type: 'region' }); } catch { _dn = null; } }
  try { return _dn?.of(cc.toUpperCase()) || cc; } catch { return cc; }
}

export function CountryAirportList({ country, rows, onClose, onSelectAirport }: {
  country: string; rows: SeedRow[]; onClose: () => void; onSelectAirport: (row: SeedRow) => void;
}) {
  const mine = useMemo(() => rows.filter((r) => r[2] === country), [rows, country]);
  const grouped = mine.length >= REGION_THRESHOLD;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sections = useMemo(() => {
    if (!grouped) return [] as { code: string; title: string; count: number; data: SeedRow[] }[];
    const byReg = new Map<string, SeedRow[]>();
    for (const r of mine) { const k = r[3] || ''; const a = byReg.get(k); if (a) a.push(r); else byReg.set(k, [r]); }
    return [...byReg.entries()]
      .map(([code, list]) => ({ code, title: regionName(code), count: list.length, data: [...list].sort((a, b) => a[1].localeCompare(b[1])) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [mine, grouped]);

  const flat = useMemo(() => grouped ? [] : [...mine].sort((a, b) => a[1].localeCompare(b[1])), [mine, grouped]);

  const toggle = (code: string) => setExpanded((prev) => {
    const n = new Set(prev); if (n.has(code)) n.delete(code); else n.add(code); return n;
  });

  const renderAirport = (r: SeedRow) => (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => onSelectAirport(r)}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.icao}>{r[0]}</Text>
        <Text style={s.name} numberOfLines={1}>{r[1]}</Text>
      </View>
      <Text style={s.coord}>{r[4].toFixed(2)}, {r[5].toFixed(2)}</Text>
      <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      <View style={s.grab} />
      <View style={s.header}>
        <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 2 }}>
          <Ionicons name="chevron-down" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.flag}>{flagEmoji(country)}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{countryName(country)}</Text>
          <Text style={s.sub}>{mine.length.toLocaleString()} airports{grouped ? ` · ${sections.length} regions` : ''}</Text>
        </View>
      </View>

      {grouped ? (
        <SectionList
          sections={sections.map((sec) => ({ ...sec, data: expanded.has(sec.code) ? sec.data : [] }))}
          keyExtractor={(item) => item[0]}
          stickySectionHeadersEnabled={false}
          initialNumToRender={25}
          windowSize={11}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderSectionHeader={({ section }) => {
            const code = (section as any).code as string;
            const open = expanded.has(code);
            return (
              <TouchableOpacity activeOpacity={0.7} style={s.regionHeader} onPress={() => toggle(code)}>
                <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={open ? Colors.primary : Colors.textSecondary} />
                <Text style={[s.regionTitle, open && { color: Colors.primary }]} numberOfLines={1}>{(section as any).title}</Text>
                <Text style={s.regionCount}>{(section as any).count}</Text>
              </TouchableOpacity>
            );
          }}
          renderItem={({ item }) => renderAirport(item)}
        />
      ) : (
        <FlatList
          data={flat}
          keyExtractor={(item) => item[0]}
          initialNumToRender={25}
          windowSize={11}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => renderAirport(item)}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginTop: 8, marginBottom: 2 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  flag: { fontSize: 26 },
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  sub: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },

  regionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.elevated,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  regionTitle: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  regionCount: {
    color: Colors.textMuted, fontSize: 12, fontWeight: '700',
    backgroundColor: Colors.separator, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  icao: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 1, fontFamily: 'Menlo' },
  name: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  coord: { color: Colors.textMuted, fontSize: 10.5, fontFamily: 'Menlo' },
});
