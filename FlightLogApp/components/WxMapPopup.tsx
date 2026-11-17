// Vädret för en flygplats ovanpå kartorna (Global map, Visited airports): samma väderkort som på dashboarden
// (WxCard), 10 % genomskinligt. Tryck på kortet fäller ut hela METAR och TAF (Decoded/Raw) under det; tryck
// utanför stänger. Ett overlay, ingen native Modal: en Modal ovanpå kartans Modal gör att Apple-kartan slutar svara.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { fetchDecodedWx, type DecodedWx } from '../services/weather';
import { WxCard, WxFetchingRow } from './WxCard';
import { FONT_MONO } from './logbook-page/tokens';

const PANEL = { borderRadius: 16, overflow: 'hidden' as const, borderWidth: 1, borderColor: Colors.primary + '44', backgroundColor: 'rgba(15,30,58,0.9)' };

export function WxMapPopup({ icao, onClose }: { icao: string; onClose: () => void }) {
  const [wx, setWx] = useState<DecodedWx | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'ok'>('loading');
  const [full, setFull] = useState(false);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    let alive = true;
    setState('loading'); setWx(null); setFull(false);
    fetchDecodedWx(icao)
      .then((r) => { if (alive) { setWx(r); setState(r ? 'ok' : 'none'); } })
      .catch(() => { if (alive) setState('none'); });
    return () => { alive = false; };
  }, [icao]);

  const metar = wx ? (raw ? wx.rawMetar || wx.metarText : wx.metarText) : '';
  const taf = wx ? (raw ? wx.rawTaf || wx.tafText || '' : wx.tafText || '') : '';

  return (
    <Pressable onPress={onClose} accessibilityLabel="Close weather" style={[StyleSheet.absoluteFill, { zIndex: 90, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', paddingHorizontal: 14 }]}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 460, alignSelf: 'center', gap: 8 }}>
        {state === 'ok' && wx ? (
          <WxCard wx={wx} translucent onPress={() => setFull((v) => !v)} />
        ) : (
          <View style={[PANEL, { padding: 14 }]}>
            {state === 'loading'
              ? <WxFetchingRow place={icao} />
              : <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center' }}>No weather reported for {icao}</Text>}
          </View>
        )}
        {full && wx && (
          <View style={PANEL}>
            <View style={{ flexDirection: 'row', alignSelf: 'flex-start', margin: 12, marginBottom: 4, backgroundColor: 'rgba(10,22,40,0.6)', borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 3, gap: 3 }}>
              {([false, true] as const).map((r) => (
                <TouchableOpacity key={String(r)} activeOpacity={0.8} onPress={() => setRaw(r)} accessibilityRole="button" accessibilityState={{ selected: raw === r }}
                  style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 7, backgroundColor: raw === r ? Colors.primary : 'transparent' }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: raw === r ? Colors.textInverse : Colors.textSecondary }}>{r ? 'Raw' : 'Decoded'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 12 }}>
              {!!metar && (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Colors.gold }}>METAR {wx.metarStation ?? ''} {wx.metarTimeZ}</Text>
                  <Text style={raw ? s.raw : s.prose}>{metar}</Text>
                </View>
              )}
              {!!taf && (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Colors.gold }}>TAF {wx.tafStation ?? ''}</Text>
                  <Text style={raw ? s.raw : s.prose}>{taf}</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  prose: { fontSize: 14, lineHeight: 21, color: Colors.textPrimary },
  raw: { fontFamily: 'JetBrainsMono', fontSize: 12.5, lineHeight: 19, color: Colors.textSecondary },
});
