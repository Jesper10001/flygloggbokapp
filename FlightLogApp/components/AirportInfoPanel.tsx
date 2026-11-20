// Info-kortet (Airport Info): PPR, bränsle, öppettider, Good to know, kontakt, hemsida och källa — samma stil som
// flygplatskortet och väderkortet. Visas på global map (Info-knappen på kartan → kortet ovanför flygplatskortet)
// och i Find airport (lägger sig över kartrutan, så att en skärmdump får med flygplatskort, Info och rutten).
// Uppgifterna kommer bara från officiell källa (AIP) eller flygplatsens egen hemsida (store/airportInfoStore.ts).
// Design 2026-11-20, artifact TUS8mTBNxgCYYuEfCCpQGe.
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import type { InfoRec } from '../store/airportInfoStore';

const MONO = 'JetBrainsMono';
const GOLD = '#FFB830';
const SUB = '#A9C3DB';

const PPR_LABEL: Record<string, { t: string; c: string; bg: string }> = {
  required: { t: 'Required', c: '#FFD080', bg: 'rgba(255,184,48,0.16)' },
  partial: { t: 'Partly required', c: '#FFD080', bg: 'rgba(255,184,48,0.10)' },
  not_required: { t: 'Not required', c: '#2DD4A3', bg: 'rgba(45,212,163,0.12)' },
  unknown: { t: 'Not stated', c: '#9DB4CC', bg: 'rgba(255,255,255,0.06)' },
};

const open = (url: string) => Linking.openURL(/^(https?:|tel:|mailto:)/.test(url) ? url : `https://${url}`).catch(() => {});
const tel = (ph: string) => open(`tel:${ph.replace(/[^\d+]/g, '')}`);
const fmtDate = (d?: string) => {
  if (!d) return '';
  const t = new Date(`${d}T12:00:00Z`);
  return isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function AirportInfoPanel({ info, accent = Colors.primary, maxHeight, height, onMap }: {
  info: InfoRec;
  accent?: string;
  maxHeight?: number;   // global map: kortet växer till max denna höjd, sedan rullar det
  height?: number;      // Find airport: exakt kartrutans höjd
  onMap?: () => void;   // Find airport: "Map" tar tillbaka kartan
}) {
  const [srcOpen, setSrcOpen] = useState(false);
  const line = accent + '33';
  const ppr = info.ppr ? PPR_LABEL[info.ppr.s] ?? PPR_LABEL.unknown : null;
  const h24 = /^H24\b/.test(info.hours?.ad ?? '');
  const utc = info.kind === 'aip';
  return (
    <View style={[s.card, { borderColor: accent + '55' }, height ? { height } : maxHeight ? { maxHeight } : null]}>
      <LinearGradient colors={['rgba(18,48,74,0.97)', 'rgba(15,30,58,0.97)']} locations={[0, 0.55]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {onMap && (
        <View style={[s.head, { borderBottomColor: line }]}>
          <Text style={[s.headTxt, { color: accent }]}>AIRPORT INFO</Text>
          <TouchableOpacity onPress={onMap} activeOpacity={0.8} style={s.mapBtn} accessibilityRole="button" accessibilityLabel="Show map">
            <Ionicons name="map-outline" size={13} color="#fff" />
            <Text style={s.mapBtnTxt}>Map</Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView showsVerticalScrollIndicator nestedScrollEnabled bounces={false}>
        {(ppr || info.fuel) && (
          <View style={[s.row2, { borderBottomColor: line }]}>
            <View style={s.cell}>
              <Text style={s.label}>PPR</Text>
              {ppr ? (
                <>
                  <Text style={[s.badge, { color: ppr.c, backgroundColor: ppr.bg, borderColor: ppr.c + '80' }]}>{ppr.t}</Text>
                  {!!info.ppr?.n && <Text style={s.small}>{info.ppr.n}</Text>}
                  {!!info.ppr?.url && (
                    <TouchableOpacity onPress={() => open(info.ppr!.url!)} hitSlop={8} accessibilityRole="link">
                      <Text style={[s.link, { color: accent }]}>Request PPR ↗</Text>
                    </TouchableOpacity>
                  )}
                  {!!info.ppr?.ph && (
                    <TouchableOpacity onPress={() => tel(info.ppr!.ph!)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Call for PPR ${info.ppr.ph}`}>
                      <Text style={[s.link, { color: accent }]}>Call for PPR</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : <Text style={s.small}>Not stated</Text>}
            </View>
            <View style={[s.cell, { borderLeftWidth: 1, borderLeftColor: line }]}>
              <Text style={s.label}>FUEL</Text>
              {info.fuel?.t?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {info.fuel.t.map((t) => <Text key={t} style={[s.fuelChip, { color: accent, borderColor: accent + '99' }]}>{t}</Text>)}
                </View>
              ) : <Text style={s.small}>{info.fuel ? '' : 'Not stated'}</Text>}
              {!!info.fuel?.n && <Text style={s.small}>{info.fuel.n}</Text>}
              {!!info.fuel?.h && <Text style={s.small}>Hours: {info.fuel.h}</Text>}
            </View>
          </View>
        )}

        {!!info.hours?.ad && (
          <View style={[s.block, { borderBottomColor: line }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.label}>OPENING HOURS</Text>
              {h24 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#2DD4A3' }} />
                  <Text style={{ color: '#2DD4A3', fontSize: 11.5, fontWeight: '700' }}>Open · H24</Text>
                </View>
              )}
            </View>
            <Text style={s.value}>{info.hours.ad}</Text>
            {!!info.hours.n && <Text style={s.small}>{info.hours.n}</Text>}
            {utc && !h24 && <Text style={s.note}>Times in UTC as in the AIP; summer times in brackets.</Text>}
          </View>
        )}

        {!!info.gtk?.length && (
          <View style={[s.block, { borderBottomColor: line }]}>
            <Text style={s.label}>GOOD TO KNOW</Text>
            {info.gtk.map((g, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 7 }}>
                <Text style={{ color: accent, fontSize: 13 }}>•</Text>
                <Text style={[s.value, { flex: 1 }]}>{g}</Text>
              </View>
            ))}
          </View>
        )}

        {!!info.contacts?.length && (
          <View style={[s.block, { borderBottomColor: line }]}>
            <Text style={s.label}>CONTACT</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {info.contacts.map((c, i) => (
                <TouchableOpacity key={i} onPress={() => tel(c.ph)} activeOpacity={0.8} style={[s.pill, { borderColor: accent + '80', backgroundColor: accent + '24' }]}
                  accessibilityRole="button" accessibilityLabel={`Call ${c.l}, ${c.ph}`}>
                  <Ionicons name="call-outline" size={12} color={accent} />
                  <Text style={[s.pillTxt, { color: accent }]} numberOfLines={1}>{c.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={s.foot}>
          {!!info.web && (
            <TouchableOpacity onPress={() => open(info.web!)} activeOpacity={0.8} style={[s.pill, { borderColor: accent + '80', backgroundColor: accent + '24' }]} accessibilityRole="link">
              <Ionicons name="globe-outline" size={12} color={accent} />
              <Text style={[s.pillTxt, { color: accent }]}>Website</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          {!!info.src?.length && (
            <TouchableOpacity onPress={() => (info.src!.length === 1 ? open(info.src![0].url) : setSrcOpen((o) => !o))} hitSlop={8} accessibilityRole="button"
              style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: accent, fontSize: 12, fontWeight: '700' }}>ⓘ Source</Text>
              {!!info.v && <Text style={{ color: '#8FB0CC', fontSize: 10 }}>Verified {fmtDate(info.v)}</Text>}
            </TouchableOpacity>
          )}
        </View>
        {srcOpen && info.src && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8, gap: 4 }}>
            {info.src.map((x, i) => (
              <TouchableOpacity key={i} onPress={() => open(x.url)} accessibilityRole="link">
                <Text style={{ color: accent, fontSize: 12 }} numberOfLines={1}>{x.t || x.url} ↗</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={[s.note, { paddingHorizontal: 14, paddingBottom: 12 }]}>Not for operational use. Always check the AIP, NOTAM and with the aerodrome before flight.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 10, paddingVertical: 8, borderBottomWidth: 1 },
  headTxt: { flex: 1, fontFamily: MONO, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(10,22,40,0.9)' },
  mapBtnTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  row2: { flexDirection: 'row', borderBottomWidth: 1 },
  cell: { flex: 1, minWidth: 0, gap: 5, paddingVertical: 10, paddingHorizontal: 14 },
  block: { gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  label: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: GOLD },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, fontSize: 12.5, fontWeight: '800', overflow: 'hidden' },
  fuelChip: { fontFamily: MONO, fontSize: 11.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  small: { color: SUB, fontSize: 11.5, lineHeight: 16 },
  value: { color: '#E4ECF5', fontSize: 12.5, lineHeight: 17 },
  note: { color: '#8FB0CC', fontSize: 10.5, lineHeight: 14 },
  link: { fontSize: 12, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 16, borderWidth: 1 },
  pillTxt: { fontSize: 12.5, fontWeight: '800' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
});
