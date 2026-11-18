// Global map → News: ark nerifrån med senaste flygincidenterna vid flygplatser (proxy-cachad nyhetslista).
// Design 2026-11-18 (artifact BZeSBM6qZVe53pHAoznFhd): kartan syns ovanför arket med platserna markerade
// (föräldern ritar prickarna), tidslinje med datum till vänster, "This week" / "Earlier", källa + Show on map.
// Arket täcker nedre NEWS_SHEET_FRACTION av skärmen och dras upp för hela listan; listan scrollar i båda lägena.
// Stängs BARA med krysset (ingen bakgrund som stänger). Resultatet cachas i useIncidentNewsStore.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Linking, Animated, PanResponder, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useIncidentNewsStore } from '../store/incidentNewsStore';
import { useFlightStore } from '../store/flightStore';
import type { AirportIncident } from '../services/incidentNews';

export const NEWS_SHEET_FRACTION = 0.6; // arkets höjd i ihopfällt läge (andel av skärmen)
const AMBER = '#FFB020';
const SHEET = '#0D1A30';
const MUTED = '#8FB0CC';
const FAINT = '#6F89A6';
const BODY = '#B9CCE0';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ISO-datum → { dag, månad, dagar sedan }. Fritext (okänt format) → null.
function parseDate(d: string): { day: string; mon: string; ago: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!Number.isFinite(t)) return null;
  return { day: m[3], mon: MONTHS[+m[2] - 1] ?? '', ago: Math.floor((Date.now() - t) / 86400000) };
}

function agoText(ms: number | null): string {
  if (!ms) return '';
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return 'updated just now';
  if (min < 60) return `updated ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `updated ${h} h ago`;
  return `updated ${Math.round(h / 24)} d ago`;
}

export function IncidentNewsOverlay({ visible, onClose, onViewOnMap, canLocate, onUpgrade, selectedIcao, onSelect }: {
  visible: boolean;
  onClose: () => void;
  onViewOnMap: (icao: string) => void;
  canLocate: (icao: string | null) => boolean;
  onUpgrade: () => void;
  selectedIcao?: string | null;          // posten vars prick lyser på kartan
  onSelect?: (icao: string | null) => void;
}) {
  const { status, incidents, error, load, lastFetched } = useIncidentNewsStore();
  const premium = useFlightStore((s) => s.isPremium || s.isMax);
  const locked = !premium || status === 'locked';
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  // Hämtas färdig + cachad från proxyn → snabbt och gratis, så vi laddar automatiskt när arket öppnas.
  useEffect(() => {
    if (visible && premium && status === 'idle') load();
  }, [visible, premium, status, load]);

  // Arkets överkant: ihopfällt (karta ovanför) eller uppdraget (nästan helskärm). Dras i greppet/rubriken.
  const lowTop = H * (1 - NEWS_SHEET_FRACTION);
  const highTop = insets.top + 48;
  const top = useRef(new Animated.Value(lowTop)).current;
  const topNow = useRef(lowTop);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (visible) { top.setValue(lowTop); topNow.current = lowTop; setExpanded(false); } }, [visible, lowTop, top]);
  const snap = (up: boolean) => {
    const to = up ? highTop : lowTop;
    topNow.current = to;
    setExpanded(up);
    Animated.spring(top, { toValue: to, useNativeDriver: false, bounciness: 2, speed: 16 }).start();
  };
  const startTop = useRef(lowTop);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { startTop.current = topNow.current; },
    onPanResponderMove: (_, g) => { top.setValue(Math.min(lowTop + 40, Math.max(highTop, startTop.current + g.dy))); },
    onPanResponderRelease: (_, g) => {
      const at = startTop.current + g.dy;
      snap(g.vy < -0.4 ? true : g.vy > 0.4 ? false : at < (lowTop + highTop) / 2);
    },
    onPanResponderTerminate: () => snap(topNow.current < (lowTop + highTop) / 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lowTop, highTop]);

  // Tidslinjen: sorterad nyast först, uppdelad i "This week" (≤ 7 dagar) och "Earlier".
  const rows = useMemo(() => {
    const list = incidents.map((it, i) => ({ it, i, d: parseDate(it.date) }));
    list.sort((a, b) => (a.d ? -a.d.ago : -1e9) < (b.d ? -b.d.ago : -1e9) ? 1 : -1);
    return list;
  }, [incidents]);
  const week = rows.filter((r) => r.d && r.d.ago <= 7);
  const earlier = rows.filter((r) => !r.d || r.d.ago > 7);
  const airportCount = new Set(incidents.map((it) => it.resolvedIcao ?? it.icao ?? it.airport)).size;

  if (!visible) return null;

  const renderItem = ({ it, i, d }: { it: AirportIncident; i: number; d: ReturnType<typeof parseDate> }, last: boolean) => {
    const loc = it.resolvedIcao ?? null;
    const onMap = !!loc && canLocate(loc);
    const sel = !!loc && loc === selectedIcao;
    return (
      <TouchableOpacity key={`${it.icao ?? it.airport}-${i}`} activeOpacity={0.85} onPress={() => onSelect?.(sel ? null : loc)}
        disabled={!onMap} style={s.item} accessibilityRole="button" accessibilityLabel={`${it.airport}. ${it.summary}`}>
        <View style={s.rail}>
          {d ? (
            <>
              <Text style={[s.day, sel && { color: AMBER }]}>{d.day}</Text>
              <Text style={s.mon}>{d.mon}</Text>
            </>
          ) : <Ionicons name="time-outline" size={16} color={FAINT} style={{ marginTop: 3 }} />}
          {!last && <View style={s.railLine} />}
        </View>
        <View style={[s.itemBody, last && { paddingBottom: 6 }]}>
          <View style={s.titleRow}>
            <Text style={s.airport} numberOfLines={2}>{it.airport}</Text>
            {loc ? <Text style={s.icao}>{loc}</Text> : <Text style={s.notOnMap}>Not on the map</Text>}
          </View>
          {!d && it.date ? <Text style={s.rawDate}>{it.date}</Text> : null}
          <Text style={s.summary}>{it.summary}</Text>
          <View style={s.footRow}>
            {it.source || it.link ? (
              <TouchableOpacity disabled={!it.link} onPress={() => it.link && Linking.openURL(it.link)} hitSlop={8} style={s.source} accessibilityRole="link">
                <Text style={s.sourceTxt} numberOfLines={1}>{it.source ?? 'Source'}</Text>
                {it.link ? <Ionicons name="arrow-up-outline" size={11} color={MUTED} style={{ transform: [{ rotate: '45deg' }] }} /> : null}
              </TouchableOpacity>
            ) : <View />}
            <View style={{ flex: 1 }} />
            {onMap && (
              <TouchableOpacity onPress={() => onViewOnMap(loc!)} activeOpacity={0.8} style={s.mapBtn} accessibilityRole="button" accessibilityLabel={`Show ${loc} on the map`}>
                <Ionicons name="location" size={13} color={Colors.primary} />
                <Text style={s.mapBtnTxt}>Show on map</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const skeleton = (n: number) => Array.from({ length: n }, (_, k) => (
    <View key={k} style={{ flexDirection: 'row', gap: 14, marginBottom: 18 }}>
      <View style={{ width: 40, height: 34, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.07)' }} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ width: k % 2 ? '45%' : '55%', height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.1)' }} />
        <View style={{ width: '92%', height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.06)' }} />
        <View style={{ width: '70%', height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </View>
    </View>
  ));

  const subtitle = locked ? 'From aviation news sources'
    : status === 'loading' ? 'Checking aviation news…'
    : status === 'ready' && incidents.length ? `${airportCount} ${airportCount === 1 ? 'airport' : 'airports'} · ${agoText(lastFetched)}`
    : status === 'ready' ? agoText(lastFetched) : 'From aviation news sources';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[s.sheet, { top }]}>
        {/* Greppet + rubriken: dra upp/ned. Tryck på greppet växlar också. */}
        <View {...pan.panHandlers}>
          <TouchableOpacity onPress={() => snap(!expanded)} activeOpacity={1} style={s.grabWrap}
            accessibilityRole="button" accessibilityLabel={expanded ? 'Make the list smaller' : 'Show the full list'}>
            <View style={s.grab} />
          </TouchableOpacity>
          <View style={s.header}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.title}>Incidents</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {!locked && status === 'ready' && incidents.length > 0 && <View style={s.amberDot} />}
                <Text style={s.sub}>{subtitle}</Text>
              </View>
            </View>
            {!locked && (status === 'ready' || status === 'error') && (
              <TouchableOpacity onPress={() => load(true)} hitSlop={8} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Refresh">
                <Ionicons name="refresh" size={17} color={Colors.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={8} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={19} color="#C9D6E6" />
            </TouchableOpacity>
          </View>
        </View>

        {locked ? (
          <View style={{ flex: 1, paddingHorizontal: 18 }}>
            <View style={{ opacity: 0.35 }}>{skeleton(3)}</View>
            <View style={s.lockPanel}>
              <Text style={s.lockTitle}>Incidents at airports, from aviation news</Text>
              <TouchableOpacity onPress={onUpgrade} activeOpacity={0.85} style={s.primaryBtn}>
                <Text style={s.primaryBtnTxt}>See Premium</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : status === 'loading' || status === 'idle' ? (
          <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 6 }}>
            {skeleton(3)}
            {status === 'idle' && (
              <TouchableOpacity onPress={() => load()} activeOpacity={0.85} style={[s.primaryBtn, { alignSelf: 'center' }]}>
                <Text style={s.primaryBtnTxt}>Show recent airport incidents</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : status === 'error' ? (
          <View style={s.stateRow}>
            <View style={[s.stateIcon, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
              <Ionicons name="cloud-offline-outline" size={22} color={MUTED} />
            </View>
            <Text style={[s.stateTxt, { flex: 1 }]}>{error ?? 'Could not load incidents right now.'}</Text>
            <TouchableOpacity onPress={() => load(true)} style={s.outlineBtn}><Text style={s.outlineBtnTxt}>Try again</Text></TouchableOpacity>
          </View>
        ) : incidents.length === 0 ? (
          <View style={s.stateRow}>
            <View style={[s.stateIcon, { backgroundColor: 'rgba(48,209,88,0.12)' }]}>
              <Ionicons name="checkmark" size={22} color="#30D158" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.stateTxt}>No incidents at airports right now</Text>
              {lastFetched ? <Text style={s.sub}>{agoText(lastFetched).replace('updated', 'Checked')}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => load(true)} style={s.outlineBtn}><Text style={s.outlineBtnTxt}>Refresh</Text></TouchableOpacity>
          </View>
        ) : (
          // Listan scrollar i båda lägena; luft i botten så sista posten går att läsa ovanför hemindikatorn.
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator indicatorStyle="white">
            {week.length > 0 && <Text style={s.group}>This week</Text>}
            {week.map((r, k) => renderItem(r, k === week.length - 1))}
            {earlier.length > 0 && <Text style={s.group}>Earlier</Text>}
            {earlier.map((r, k) => renderItem(r, k === earlier.length - 1))}
            <Text style={s.disclaimer}>Summaries of third-party aviation news. Open the source before relying on it.</Text>
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: SHEET, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: -8 }, elevation: 18 },
  grabWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.2 },
  sub: { color: MUTED, fontSize: 12 },
  amberDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16294A' },

  group: { color: FAINT, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', paddingTop: 4, paddingBottom: 10 },
  item: { flexDirection: 'row', gap: 14 },
  rail: { width: 40, alignItems: 'center' },
  day: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 22, fontVariant: ['tabular-nums'] },
  mon: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  railLine: { flex: 1, width: 1, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  itemBody: { flex: 1, minWidth: 0, paddingBottom: 18, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  airport: { flex: 1, minWidth: 0, color: '#fff', fontSize: 15.5, fontWeight: '700' },
  icao: { fontFamily: 'JetBrainsMono', fontSize: 11.5, fontWeight: '800', color: Colors.primary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: 'rgba(0,200,232,0.12)', overflow: 'hidden' },
  notOnMap: { color: FAINT, fontSize: 11 },
  rawDate: { color: FAINT, fontSize: 11 },
  summary: { color: BODY, fontSize: 13.5, lineHeight: 19 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  sourceTxt: { color: MUTED, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(0,200,232,0.45)' },
  mapBtnTxt: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
  disclaimer: { color: FAINT, fontSize: 10.5, lineHeight: 15, paddingTop: 10 },

  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 18 },
  stateIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stateTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  outlineBtn: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,200,232,0.45)', alignItems: 'center', justifyContent: 'center' },
  outlineBtnTxt: { color: Colors.primary, fontSize: 12.5, fontWeight: '700' },
  lockPanel: { alignItems: 'center', gap: 12, paddingTop: 10 },
  lockTitle: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  primaryBtn: { height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnTxt: { color: '#0A1628', fontSize: 14, fontWeight: '800' },
});
