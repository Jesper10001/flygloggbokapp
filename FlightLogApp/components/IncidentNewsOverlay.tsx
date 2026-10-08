// Global map → News: stor inforuta med senaste flygincidenterna (AI + web search). Flygplatsnamn i
// fetstil, kort nyhet under, plus en knapp för att navigera till platsen på kartan. Stängs/öppnas fritt
// (resultatet cachas i useIncidentNewsStore) — ny sökning bara via Refresh eller app-omladdning.

import { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Pressable, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useIncidentNewsStore } from '../store/incidentNewsStore';
import { useFlightStore } from '../store/flightStore';

export function IncidentNewsOverlay({ visible, onClose, onViewOnMap, canLocate, onUpgrade }: {
  visible: boolean;
  onClose: () => void;
  onViewOnMap: (icao: string) => void;
  canLocate: (icao: string | null) => boolean;
  onUpgrade: () => void;
}) {
  const { status, incidents, error, load } = useIncidentNewsStore();
  const premium = useFlightStore((s) => s.isPremium || s.isMax);
  const locked = !premium || status === 'locked';
  // Hämtas färdig + cachad från proxyn → snabbt och gratis, så vi laddar automatiskt när rutan öppnas.
  useEffect(() => {
    if (visible && premium && status === 'idle') load();
  }, [visible, premium, status, load]);
  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: '#000A' }]} onPress={onClose} />
      <View style={s.wrap} pointerEvents="box-none">
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Flight incidents</Text>
              <Text style={s.sub}>Airports involved · latest month</Text>
            </View>
            {!locked && (status === 'ready' || status === 'error') ? (
              <TouchableOpacity onPress={() => load(true)} hitSlop={8} style={s.iconBtn}>
                <Ionicons name="refresh" size={18} color={Colors.primary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} hitSlop={8} style={s.iconBtn}>
              <Ionicons name="close" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          {locked ? (
            <View style={s.center}>
              <View style={s.bigIcon}><Ionicons name="lock-closed-outline" size={32} color={Colors.primary} /></View>
              <Text style={s.loadingTxt}>A Premium feature</Text>
              <Text style={s.scanHint}>Recent accidents and incidents at airports, gathered from aviation news sources. Upgrade to Premium to use it.</Text>
              <TouchableOpacity onPress={onUpgrade} activeOpacity={0.85} style={s.scanBtn}>
                <Ionicons name="sparkles" size={15} color={Colors.textInverse} />
                <Text style={s.scanBtnTxt}>See Premium</Text>
              </TouchableOpacity>
            </View>
          ) : status === 'idle' ? (
            <View style={s.center}>
              <View style={s.bigIcon}><Ionicons name="newspaper-outline" size={34} color={Colors.primary} /></View>
              <Text style={s.scanHint}>Recent incidents at airports and airfields — civil and military — from aviation news sources.</Text>
              <TouchableOpacity onPress={() => load()} activeOpacity={0.85} style={s.scanBtn}>
                <Ionicons name="newspaper" size={16} color={Colors.textInverse} />
                <Text style={s.scanBtnTxt}>Show recent airport incidents</Text>
              </TouchableOpacity>
            </View>
          ) : status === 'loading' ? (
            <View style={s.center}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={s.loadingTxt}>Loading recent incidents…</Text>
              <Text style={s.loadingSub}>Just a moment.</Text>
            </View>
          ) : status === 'error' ? (
            <View style={s.center}>
              <Ionicons name="cloud-offline-outline" size={32} color={Colors.textMuted} />
              <Text style={s.errTxt}>{error ?? 'Could not load incidents right now.'}</Text>
              <TouchableOpacity onPress={() => load(true)} activeOpacity={0.85} style={s.scanBtn}>
                <Text style={s.scanBtnTxt}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : incidents.length === 0 ? (
            <View style={s.center}>
              <Ionicons name="checkmark-circle-outline" size={32} color={Colors.success} />
              <Text style={s.loadingTxt}>No airport-linked incidents in the last month.</Text>
              <TouchableOpacity onPress={() => load(true)} activeOpacity={0.85} style={[s.scanBtn, { marginTop: 10 }]}>
                <Ionicons name="refresh" size={15} color={Colors.textInverse} />
                <Text style={s.scanBtnTxt}>Refresh</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ padding: 4 }} showsVerticalScrollIndicator={false}>
              {incidents.map((it, i) => {
                // Verifierad ICAO (finns i vår DB) driver kart-knappen; visa den om den finns, annars nyhetens kod.
                const loc = it.resolvedIcao ?? null;
                const shownIcao = loc ?? it.icao;
                return (
                <View key={`${it.icao ?? it.airport}-${i}`} style={s.item}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.airport}>
                      {it.airport}{shownIcao ? <Text style={s.icao}>{`  ${shownIcao}`}</Text> : null}
                    </Text>
                    {it.date ? <Text style={s.date}>{it.date}</Text> : null}
                    <Text style={s.summary}>{it.summary}</Text>
                    {it.source || it.link ? (
                      <TouchableOpacity
                        disabled={!it.link}
                        onPress={() => it.link && Linking.openURL(it.link)}
                        activeOpacity={0.7}
                        hitSlop={6}
                        style={s.sourceRow}
                      >
                        <Ionicons name="open-outline" size={11} color={Colors.textMuted} />
                        <Text style={s.sourceTxt} numberOfLines={1}>{it.source ?? 'Source'}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {loc && canLocate(loc) ? (
                    <TouchableOpacity onPress={() => onViewOnMap(loc)} activeOpacity={0.8} style={s.locBtn}>
                      <Ionicons name="location" size={16} color={Colors.primary} />
                      <Text style={s.locTxt}>Map</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                );
              })}
              <Text style={s.disclaimer}>Summaries compiled from third-party aviation news sources — tap a source to read the original. Verify before relying on it.</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  card: { width: '100%', maxWidth: 460, backgroundColor: Colors.card, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  sub: { color: Colors.textMuted, fontSize: 11.5, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.6 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.elevated },

  center: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 36, paddingHorizontal: 22 },
  bigIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center' },
  scanHint: { color: Colors.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 13, paddingVertical: 13, paddingHorizontal: 18 },
  scanBtnTxt: { color: Colors.textInverse, fontSize: 14, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  loadingTxt: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  loadingSub: { color: Colors.textMuted, fontSize: 12 },
  errTxt: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  airport: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  icao: { color: Colors.primary, fontSize: 13, fontWeight: '700', fontFamily: 'JetBrainsMono' },
  date: { color: Colors.textMuted, fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  summary: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  sourceTxt: { color: Colors.textMuted, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  locBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary + '44' },
  locTxt: { color: Colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  disclaimer: { color: Colors.textMuted, fontSize: 10.5, lineHeight: 15, textAlign: 'center', paddingHorizontal: 14, paddingVertical: 12 },
});
