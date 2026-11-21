// Väderkortet över kartrutan i Find airport (knappen "Weather" uppe till vänster), design 2026-11-20
// (artifact Fcsm4ESifWgX5PVu9ptoGM): samma data och färgkodning som dashboardens väderkort (components/WxCard.tsx,
// services/weather.ts fetchDecodedWx) men utan stationsraden — flygplatskortet ovanför har redan namnet.
// Rubrik: kategori, METAR-tid och ålder, Map. Fyra värden. TAF: giltighet, tidslinje per flygkategori och upp till
// tre ändringar (utils/tafTimeline.ts). Ligger över kartornas Modal → inga native Modal/Alert här.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { fetchDecodedWx, categoryColor, type DecodedWx, type FlightCat, type WxCell } from '../services/weather';
import { tafBar, tafTicks, tafChanges, tafExpired } from '../utils/tafTimeline';
import { localOffsetMinutes, tzAbbr } from '../utils/timezone';
import { FONT_MONO } from './logbook-page/tokens';

const PILL_INK = '#06121F';
const SUB = '#A9C3DB';
const DIM = '#8FB0CC';
// Samma flygplats igen inom tio minuter visar det redan hämtade
const cache = new Map<string, { at: number; wx: DecodedWx | null }>();
const TTL_MS = 10 * 60 * 1000;

const p2 = (n: number) => String(n).padStart(2, '0');
/** "GMT+1", "GMT-5", "GMT+5:30", "GMT" — flygplatsens zon (land/region, sommartid räknas in) */
const gmtLabel = (off: number) => (off === 0 ? 'GMT' : `GMT${off > 0 ? '+' : '-'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? ':' + p2(Math.abs(off) % 60) : ''}`);

function Pill({ cat, outline }: { cat: FlightCat; outline?: boolean }) {
  const c = categoryColor(cat);
  return (
    <View style={{ paddingHorizontal: outline ? 6 : 8, paddingVertical: outline ? 1 : 3, borderRadius: 8, backgroundColor: outline ? 'transparent' : c, borderWidth: outline ? 1 : 0, borderColor: c }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: outline ? 9 : 11, fontWeight: '700', letterSpacing: 1, color: outline ? c : PILL_INK }}>{cat}</Text>
    </View>
  );
}
function Cell({ label, cell, first, line }: { label: string; cell: WxCell; first: boolean; line: string }) {
  return (
    <View style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center', borderLeftWidth: first ? 0 : 1, borderLeftColor: line }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, color: Colors.gold }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: '700', color: '#fff', marginTop: 4 }}>{cell.value}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 10, color: SUB, marginTop: 2, minHeight: 13 }}>{cell.unit}</Text>
    </View>
  );
}

export function MapWxPanel({ icao, height, onMap, country, region, lon }: {
  icao: string; height: number; onMap: () => void;
  country?: string; region?: string; lon?: number | null;   // för flygplatsens tidszon (UTC/GMT±N-växeln)
}) {
  const [local, setLocal] = useState(false);
  const offAt = (ms: number) => localOffsetMinutes(new Date(ms), country, region, lon);
  const nowOff = offAt(Date.now());
  // Zonens vedertagna namn med sommartid (PST/PDT, CET/CEST, EST …); utan namn "UTC+4" (utils/timezone.ts)
  const zoneName = tzAbbr(new Date(), country, region, lon);
  // Tid i vald zon: UTC "21:50z"/"21z", lokalt "22:50"/"22" (zonen står i växeln)
  const clock = (ms: number) => {
    const o = local && nowOff != null ? offAt(ms) ?? 0 : 0;
    const d = new Date(ms + o * 60000);
    return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${local && nowOff != null ? '' : 'z'}`;
  };
  const hour = (sec: number) => clock(sec * 1000).replace(/:00(z?)$/, '$1').replace(/^(\d\d):(\d\d)(z?)$/, '$1:$2$3');
  const hit = cache.get(icao);
  const [wx, setWx] = useState<DecodedWx | null>(hit && Date.now() - hit.at < TTL_MS ? hit.wx : null);
  const [state, setState] = useState<'loading' | 'ok' | 'none'>(hit && Date.now() - hit.at < TTL_MS ? (hit.wx ? 'ok' : 'none') : 'loading');

  useEffect(() => {
    const c = cache.get(icao);
    if (c && Date.now() - c.at < TTL_MS) { setWx(c.wx); setState(c.wx ? 'ok' : 'none'); return; }
    let alive = true;
    setState('loading');
    fetchDecodedWx(icao)
      .then((r) => { cache.set(icao, { at: Date.now(), wx: r }); if (alive) { setWx(r); setState(r ? 'ok' : 'none'); } })
      .catch(() => { if (alive) setState('none'); });
    return () => { alive = false; };
  }, [icao]);

  const accent = wx?.category ? categoryColor(wx.category) : Colors.primary;
  const line = accent + '33';
  const min = wx?.metarObsMs != null ? Math.max(0, Math.round((Date.now() - wx.metarObsMs) / 60000)) : null;   // bara för färgen
  const ageColor = min == null || min <= 60 ? SUB : min <= 120 ? Colors.warning : Colors.danger;
  const t = wx?.tafObj;
  const bar = t ? tafBar(t) : [];
  const ticks = t ? tafTicks(t, hour) : [];
  const rows = t ? tafChanges(t, Date.now(), Infinity, hour) : [];   // alla kommande ändringar (TAF-delen rullar)
  const expired = t ? tafExpired(t) : false;
  const total = bar.reduce((s, x) => s + (x.to - x.from), 0) || 1;
  const nowPos = bar.length ? Math.min(1, Math.max(0, (Date.now() / 1000 - bar[0].from) / total)) : -1;
  const station = (s?: string | null) => (s && s !== icao ? ` · ${s}` : '');

  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '66' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,30,58,0.97)' }} />
      <LinearGradient colors={[accent + '1F', 'rgba(15,30,58,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

      {/* Rubrik: kategori, METAR-tid och ålder, Map */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 12, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: line }}>
        {/* Väder från en annan flygplats: dess ICAO-kod i liten text under kategorin */}
        <View style={{ alignItems: 'center', gap: 2 }}>
          {wx?.category ? <Pill cat={wx.category} /> : <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: accent }}>WEATHER</Text>}
          {!!wx?.metarStation && wx.metarStation !== icao && (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: SUB }} accessibilityLabel={`Weather from ${wx.metarStation}`}>{wx.metarStation}</Text>
          )}
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10.5, color: ageColor, fontWeight: min != null && min > 60 ? '700' : '500' }}>
          {state === 'loading' ? '' : wx?.metarObsMs != null ? `METAR ${clock(wx.metarObsMs)}` : ''}
        </Text>
        {nowOff != null && (
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
            {[false, true].map((l) => (
              <TouchableOpacity key={String(l)} onPress={() => setLocal(l)} accessibilityRole="radio" accessibilityState={{ selected: local === l }}
                style={{ height: 26, paddingHorizontal: 9, justifyContent: 'center', backgroundColor: local === l ? 'rgba(255,255,255,0.18)' : 'transparent' }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: local === l ? '#fff' : SUB }}>{l ? zoneName ?? gmtLabel(nowOff) : 'UTC'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity onPress={onMap} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Show map"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(10,22,40,0.9)' }}>
          <Ionicons name="map-outline" size={13} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '800' }}>Map</Text>
        </TouchableOpacity>
      </View>

      {state === 'loading' ? (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Loading current weather…</Text>
        </View>
      ) : state === 'none' || !wx ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <Text style={{ color: SUB, fontSize: 13, textAlign: 'center' }}>No weather found near {icao}.</Text>
        </View>
      ) : (
        <>
          {/* Fyra värden */}
          {wx.cells ? (
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: line }}>
              <Cell label="WIND" cell={wx.cells.wind} first line={line} />
              <Cell label="VISIBILITY" cell={wx.cells.vis} first={false} line={line} />
              <Cell label="CLOUD" cell={wx.cells.cloud} first={false} line={line} />
              <Cell label="QNH" cell={wx.cells.qnh} first={false} line={line} />
            </View>
          ) : (
            <Text style={{ fontSize: 12.5, color: SUB, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: line }}>No current observation near {icao}</Text>
          )}

          {/* TAF: giltighet, tidslinje, ändringar */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 10 }} nestedScrollEnabled showsVerticalScrollIndicator bounces={false}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: Colors.gold }}>TAF</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: SUB }}>
                {!t ? 'No forecast for this station' : expired ? 'This forecast has expired' : `Valid ${ticks[0] ?? ''}–${ticks[ticks.length - 1] ?? ''}${station(wx.tafStation)}`}
              </Text>
            </View>
            {t && !expired && bar.length > 0 && (
              <View style={{ gap: 3 }}>
                <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
                  {bar.map((b, i) => (
                    <View key={i} style={{ flex: b.to - b.from, backgroundColor: b.cat ? categoryColor(b.cat) : 'rgba(255,255,255,0.15)' }} />
                  ))}
                  {nowPos > 0 && nowPos < 1 && (
                    <View style={{ position: 'absolute', top: -1, bottom: -1, left: `${nowPos * 100}%`, width: 2, backgroundColor: '#fff' }} />
                  )}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {ticks.map((x, i) => <Text key={i} style={{ fontFamily: FONT_MONO, fontSize: 9, color: DIM }}>{x}</Text>)}
                </View>
              </View>
            )}
            {t && !expired && (rows.length ? rows.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                {/* Typen först, sedan tiden: läses som "BECOMING 06z–08z" */}
                <Text style={{ width: 70, marginTop: 3, fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.6, color: Colors.gold }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{r.kind}</Text>
                <Text style={{ width: 56, marginTop: 1, fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: '#fff' }}>{r.time}</Text>
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 16, color: '#fff' }}>{r.text}</Text>
                {r.cat && <Pill cat={r.cat} outline />}
              </View>
            )) : (
              <Text style={{ fontSize: 12, color: '#fff' }}>{wx.tafNext?.text ?? 'No change expected'}</Text>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}
