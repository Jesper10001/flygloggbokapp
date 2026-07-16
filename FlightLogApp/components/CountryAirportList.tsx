// Lista över ett lands flygplatser (öppnas från flagg-pin på GlobalAirportMap) som en dragbar
// bottom-sheet: dra i baren överst för att ändra storlek (snap: full / halv / peek). Länder med
// ≥100 flygplatser regionindelas i expanderbara sektioner (t.ex. USA per delstat); mindre länder
// visas i en platt bokstavsordnad lista. När `minimized` (en flygplats är vald) dras arket ner
// till peek — pilen till vänster expanderar det igen.
import { useMemo, useState, useRef, useEffect } from 'react';
import { View, Text, SectionList, FlatList, TouchableOpacity, StyleSheet, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { flagEmoji } from '../constants/continents';
import { regionName } from '../constants/isoRegions';
import type { SeedRow } from './GlobalAirportMap';

const REGION_THRESHOLD = 100; // ≥ detta → regionindela
const PEEK_VISIBLE = 64;      // synlig höjd i peek-läge (grabber + header)

let _dn: Intl.DisplayNames | null | undefined;
function countryName(cc: string): string {
  if (_dn === undefined) { try { _dn = new (Intl as any).DisplayNames(['en'], { type: 'region' }); } catch { _dn = null; } }
  try { return _dn?.of(cc.toUpperCase()) || cc; } catch { return cc; }
}

export function CountryAirportList({ country, rows, onClose, onSelectAirport, containerHeight, minimized }: {
  country: string; rows: SeedRow[]; onClose: () => void; onSelectAirport: (row: SeedRow) => void;
  containerHeight: number; minimized?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const mine = useMemo(() => rows.filter((r) => r[2] === country), [rows, country]);
  const grouped = mine.length >= REGION_THRESHOLD;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── Sheet-geometri + drag ──────────────────────────────────────────────────
  const H = containerHeight || 600;
  const FULL = 0;
  const HALF = Math.round(H * 0.45);
  const PEEK = Math.max(0, H - PEEK_VISIBLE - insets.bottom);
  const snaps = useRef({ FULL, HALF, PEEK });
  snaps.current = { FULL, HALF, PEEK }; // håll aktuell (containerHeight kan mätas efter mount)

  const topAnim = useRef(new Animated.Value(HALF)).current;
  const currentTop = useRef(HALF);
  const [snapState, setSnapState] = useState<'full' | 'half' | 'peek'>('half');

  const snapTo = (state: 'full' | 'half' | 'peek') => {
    const target = state === 'full' ? snaps.current.FULL : state === 'peek' ? snaps.current.PEEK : snaps.current.HALF;
    currentTop.current = target;
    setSnapState(state);
    Animated.spring(topAnim, { toValue: target, useNativeDriver: false, bounciness: 3, speed: 16 }).start();
  };

  // Extern styrning: flygplats vald → peek; avvald → halv (kör bara vid ändring).
  const minRef = useRef(minimized);
  useEffect(() => {
    if (minimized === minRef.current) return;
    minRef.current = minimized;
    snapTo(minimized ? 'peek' : 'half');
  }, [minimized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap-punkterna ändras när containerHeight mäts först → håll aktuellt läge.
  useEffect(() => {
    const target = snapState === 'full' ? FULL : snapState === 'peek' ? PEEK : HALF;
    currentTop.current = target;
    topAnim.setValue(target);
  }, [containerHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    // Capture: fånga vertikala drag ÖVERALLT på headern (även över pil/X-knapparna), så hela
    // headern går att ta tag i och dra. Rena tryck (utan rörelse) släpps till knapparna.
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => {
      const next = Math.min(snaps.current.PEEK, Math.max(snaps.current.FULL, currentTop.current + g.dy));
      topAnim.setValue(next);
    },
    onPanResponderRelease: (_, g) => {
      const final = Math.min(snaps.current.PEEK, Math.max(snaps.current.FULL, currentTop.current + g.dy));
      const pts: [number, 'full' | 'half' | 'peek'][] = [[snaps.current.FULL, 'full'], [snaps.current.HALF, 'half'], [snaps.current.PEEK, 'peek']];
      let best = pts[1], bd = Infinity;
      for (const p of pts) { const d = Math.abs(final - p[0]); if (d < bd) { bd = d; best = p; } }
      snapTo(best[1]);
    },
  })).current;

  // ── Data ────────────────────────────────────────────────────────────────────
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
    <Animated.View style={[s.sheet, { top: topAnim }]}>
      {/* Grabber + header — dragbar för att ändra storlek */}
      <View {...pan.panHandlers}>
        <View style={s.grab} />
        <View style={s.header}>
          {/* Vänster: pil som växlar peek ⇄ full */}
          <TouchableOpacity onPress={() => snapTo(snapState === 'peek' ? 'full' : 'peek')} hitSlop={10} style={{ padding: 2 }}>
            <Ionicons name={snapState === 'peek' ? 'chevron-up' : 'chevron-down'} size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.flag}>{flagEmoji(country)}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={1}>{countryName(country)}</Text>
            <Text style={s.sub}>{mine.length.toLocaleString()} airports{grouped ? ` · ${sections.length} regions` : ''}</Text>
          </View>
          {/* Höger: stäng landet → tillbaka till översikten */}
          <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
            <Ionicons name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {grouped ? (
        <SectionList
          style={{ flex: 1 }}
          sections={sections.map((sec) => ({ ...sec, data: expanded.has(sec.code) ? sec.data : [] }))}
          keyExtractor={(item) => item[0]}
          stickySectionHeadersEnabled={false}
          initialNumToRender={25}
          windowSize={11}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
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
          style={{ flex: 1 }}
          data={flat}
          keyExtractor={(item) => item[0]}
          initialNumToRender={25}
          windowSize={11}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          renderItem={({ item }) => renderAirport(item)}
        />
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden',
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 12,
  },
  grab: { alignSelf: 'center', width: 54, height: 6, borderRadius: 3, backgroundColor: Colors.textMuted, marginTop: 12, marginBottom: 10 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
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
