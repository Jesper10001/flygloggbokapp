// Vädersidan för en flygplats (visas i AirportPickerModal när en station är vald). Uppifrån och ned:
// stationen och en mening om vädret, Now + de två närmaste förändringarna, Now (METAR) med kartcirkel,
// banvind och fyra värden på en rad, tidslinjen för TAF:en med UTC/LOCAL-växel, en rad per TAF-grupp och
// rå METAR/TAF bakom en knapp. All logik i services/wxPage.ts; design: Claude design "Vädersidan METAR + TAF".
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { categoryColor, type DecodedWx, type FlightCat } from '../../services/weather';
import { buildWxPage, fmtTime, runwayWinds, type WxSeg, type WxTz } from '../../services/wxPage';
import { getRunwayGeo, runwayBearing } from '../../constants/runwayGeo';
import { getSetting, setSetting } from '../../db/flights';
import { WxRunwayMap } from './WxRunwayMap';

const MONO = 'JetBrainsMono';
const TZ_KEY = 'wx_time_zone';
const catColor = (c: FlightCat | null) => (c ? categoryColor(c) : Colors.textSecondary);

export function WeatherPage({ wx, fallbackName }: { wx: DecodedWx; fallbackName?: string }) {
  const [tz, setTz] = useState<WxTz>('utc');
  const [sel, setSel] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => { getSetting(TZ_KEY).then((v) => { if (v === 'local' || v === 'utc') setTz(v); }).catch(() => {}); }, []);
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(t); }, []);
  const pickTz = (v: WxTz) => { setTz(v); setSetting(TZ_KEY, v).catch(() => {}); };

  const page = useMemo(() => buildWxPage(wx.metarObj, wx.tafObj, tz, nowMs), [wx, tz, nowMs]);
  const station = wx.metarStation ?? wx.tafStation ?? wx.destIcao;
  const name = (station === wx.metarStation ? wx.metarStationName : wx.tafStationName) || fallbackName || '';

  const runways = useMemo(() => getRunwayGeo(wx.metarStation ?? station), [wx.metarStation, station]);
  const rw = useMemo(() => runwayWinds(
    runways.map((r) => ({ leIdent: r.leIdent, heIdent: r.heIdent, bearing: runwayBearing(r) })),
    page.now?.windDir ?? null, page.now?.windSpd ?? 0,
  ), [runways, page.now]);

  // Vald del av tidslinjen (förvalt: det som gäller nu).
  const tl = page.timeline;
  const segs: WxSeg[] = tl ? [...tl.base, ...tl.temp.flat()] : [];
  const cur = segs.find((s) => s.id === sel && (s.kind !== 'becmg' || !segs.some((x) => x.id === sel && x.kind !== 'becmg')))
    ?? segs.find((s) => s.id === sel) ?? tl?.base.find((s) => s.from <= nowMs / 1000 && s.to > nowMs / 1000) ?? tl?.base[0];
  const isSel = (id: string) => (cur ? cur.id === id : false);

  const obsAge = wx.metarObsMs ? Math.max(0, Math.round((nowMs - wx.metarObsMs) / 60000)) : null;
  const obsTime = wx.metarObsMs ? fmtTime(wx.metarObsMs / 1000, tz, nowMs / 1000).toUpperCase() : '';
  const pct = (sec: number) => (tl ? ((sec - tl.start) / (tl.end - tl.start)) * 100 : 0);

  return (
    <View style={{ gap: 22 }}>
      {/* Station + överblick */}
      <View style={{ gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={st.icao}>{station}</Text>
          {name ? <Text style={st.name} numberOfLines={1}>{name}</Text> : null}
          {wx.metarIsAlternate || wx.tafIsAlternate
            ? <Text style={st.meta}>NEAREST REPORT TO {wx.destIcao}</Text> : null}
          {obsTime ? <Text style={st.meta}>OBSERVED {obsTime}{obsAge != null ? ` · ${obsAge < 60 ? `${obsAge} MIN` : `${Math.floor(obsAge / 60)} H ${obsAge % 60} MIN`} AGO` : ''}</Text> : null}
        </View>
        <Text style={st.summary}>{page.summary}</Text>
        {page.glance.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {page.glance.map((g, i) => {
              const on = i === 0 ? !sel || isSel(g.id) : isSel(g.id);
              return (
                <TouchableOpacity key={g.id + i} activeOpacity={0.8} onPress={() => setSel(g.id)}
                  style={[st.glance, { borderColor: on ? catColor(g.cat) : Colors.border }]}>
                  <Text style={st.lbl} numberOfLines={1}>{g.when}</Text>
                  <Text style={[st.glanceCat, { color: catColor(g.cat) }]} numberOfLines={1} adjustsFontSizeToFit>{g.label}</Text>
                  <Text style={st.glanceNote} numberOfLines={2}>{g.note}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Now (METAR) */}
      {page.now && (
        <View style={{ gap: 10 }}>
          <View style={st.secHead}>
            <Text style={st.sec}>NOW</Text>
            <Text style={st.secSub}>METAR {obsTime}</Text>
          </View>
          <View style={[st.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }]}>
            <WxRunwayMap runways={runways} favored={rw.favored} windDir={page.now.windDir} />
            <View style={{ flex: 1, gap: 10 }}>
              <View style={{ gap: 2 }}>
                <Text style={st.wind} numberOfLines={1} adjustsFontSizeToFit>
                  {page.now.windValue}{page.now.windSpd > 0 ? <Text style={st.windUnit}> kt</Text> : null}
                </Text>
                <Text style={st.windNote}>{page.now.windNote}</Text>
              </View>
              {rw.list.slice(0, 2).map((r) => (
                <View key={r.ident} style={[st.rwRow, { backgroundColor: r.favored ? 'rgba(0,200,232,0.10)' : Colors.background }]}>
                  <Text style={[st.rwId, { color: r.favored ? '#67E8F9' : '#DCE6F0' }]} numberOfLines={1}>{r.ident}</Text>
                  <Text style={[st.rwTxt, { color: r.favored ? Colors.textPrimary : Colors.textSecondary }]} numberOfLines={1} adjustsFontSizeToFit>
                    {r.head >= 0 ? `${r.head} head` : `${-r.head} tail`} · {r.cross} cross
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {page.now.tiles.map((t) => (
              <View key={t.label} style={st.tile}>
                <Text style={st.tileLbl}>{t.label}</Text>
                <Text style={st.tileVal} numberOfLines={1} adjustsFontSizeToFit>
                  {t.value}{t.unit ? <Text style={st.tileUnit}>{t.unit}</Text> : null}
                </Text>
                <Text style={st.tileNote} numberOfLines={2}>{t.note}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Tidslinjen (TAF) */}
      <View style={{ gap: 10 }}>
        <View style={st.secHead}>
          <Text style={st.sec}>{tl ? `NEXT ${Math.round((tl.end - tl.start) / 3600)} HOURS` : 'FORECAST'}</Text>
          {page.tafIssued ? <Text style={st.secSub}>TAF {page.tafIssued}</Text> : null}
          <View style={{ flex: 1 }} />
          <View style={st.seg}>
            {(['utc', 'local'] as const).map((v) => (
              <TouchableOpacity key={v} onPress={() => pickTz(v)} activeOpacity={0.8} accessibilityRole="button"
                accessibilityState={{ selected: tz === v }} style={[st.segBtn, tz === v && { backgroundColor: Colors.primary }]}>
                <Text style={[st.segTxt, { color: tz === v ? Colors.card : Colors.textSecondary }]}>{v === 'utc' ? 'UTC' : 'LOCAL'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {tl ? (
          <View style={[st.card, { padding: 14, paddingBottom: 12, gap: 8 }]}>
            <View style={{ height: 34 }}>
              {tl.base.map((s, i) => (
                <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => setSel(s.id)}
                  style={{ position: 'absolute', top: 0, height: 34, left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%`, paddingRight: 2 }}>
                  <View style={[st.bar, { backgroundColor: catColor(s.cat), opacity: s.kind === 'becmg' ? 0.55 : 1, borderWidth: isSel(s.id) ? 2 : 0 }]}>
                    <Text style={st.barTxt} numberOfLines={1}>{s.label}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: -6, bottom: -6, width: 2, borderRadius: 1, backgroundColor: Colors.textPrimary }} />
            </View>
            {tl.temp.map((row, ri) => (
              <View key={ri} style={{ height: 22 }}>
                {row.map((s, i) => (
                  <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => setSel(s.id)}
                    style={{ position: 'absolute', top: 0, height: 22, left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%` }}>
                    <View style={[st.tempBar, { borderColor: catColor(s.cat), backgroundColor: catColor(s.cat) + '2E', borderWidth: isSel(s.id) ? 2 : 1, borderStyle: 'dashed' }]}>
                      <Text style={[st.tempTxt, { color: catColor(s.cat) }]} numberOfLines={1}>{s.label}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            <View style={{ height: 40, borderTopWidth: 1, borderTopColor: Colors.separator }}>
              {tl.winds.map((w, i) => (
                <View key={i} style={{ position: 'absolute', top: 6, left: `${pct(w.t)}%`, width: 34, marginLeft: i === 0 ? 0 : -17, alignItems: i === 0 ? 'flex-start' : 'center', gap: 2 }}>
                  {w.dir != null ? (
                    <Svg width={13} height={13} viewBox="0 0 24 24" style={{ transform: [{ rotate: `${w.dir}deg` }] }}>
                      <Path d="M12 4v16M6 14l6 6 6-6" stroke={Colors.textSecondary} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </Svg>
                  ) : <Text style={[st.windTick, { color: Colors.textSecondary }]}>VRB</Text>}
                  <Text style={[st.windTick, { color: w.gust ? Colors.warning : Colors.textSecondary }]}>{w.gust ? `${w.spd}G${w.gust}` : w.spd}</Text>
                </View>
              ))}
            </View>
            <View style={{ height: 14 }}>
              {tl.ticks.map((t, i) => (
                <Text key={i} style={[st.tick, { left: `${pct(t.t)}%`, marginLeft: i === 0 ? 0 : -15, textAlign: i === 0 ? 'left' : 'center', color: i === 0 ? Colors.textPrimary : Colors.textMuted }]}>{t.label}</Text>
              ))}
            </View>
            {cur ? (
              <View style={st.readout}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[st.readCat, { color: catColor(cur.cat) }]}>{cur.kind === 'temp' ? cur.label : cur.cat ?? '—'}</Text>
                  <Text style={st.readWhen} numberOfLines={1}>{cur.when}</Text>
                </View>
                <Text style={st.readTxt}>{cur.text}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={st.empty}>No forecast for this station</Text>
        )}
      </View>

      {/* En rad per TAF-grupp */}
      {page.cards.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={st.sec}>CHANGES</Text>
          {page.cards.map((c) => (
            <TouchableOpacity key={c.id} activeOpacity={0.85} onPress={() => setSel(c.id)}
              style={[st.change, { borderColor: isSel(c.id) ? Colors.primary : Colors.border }]}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: catColor(c.cat) }} />
              <View style={{ flex: 1, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={st.chWhen}>{c.when}</Text>
                  <Text style={st.chKind}>{c.kind}</Text>
                  <View style={{ flex: 1 }} />
                  {c.cat ? <Text style={[st.chCat, { color: catColor(c.cat) }]}>{c.cat}</Text> : null}
                </View>
                <Text style={st.chTxt}>{c.text}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Rå METAR och TAF */}
      {(wx.rawMetar || wx.rawTaf) && (
        <View style={{ gap: 10 }}>
          <TouchableOpacity onPress={() => setRawOpen((o) => !o)} activeOpacity={0.8} style={st.rawBtn} accessibilityRole="button">
            <Text style={st.rawBtnTxt}>{rawOpen ? 'HIDE RAW METAR & TAF' : 'SHOW RAW METAR & TAF'}</Text>
            <Ionicons name={rawOpen ? 'chevron-up' : 'chevron-down'} size={13} color={Colors.primary} />
          </TouchableOpacity>
          {rawOpen && (
            <View style={[st.card, { padding: 14, gap: 14 }]}>
              {wx.rawMetar ? (
                <View style={{ gap: 6 }}>
                  <Text style={st.tileLbl}>METAR {wx.metarStation}</Text>
                  <Text selectable style={st.raw}>{wx.rawMetar}</Text>
                </View>
              ) : null}
              {wx.rawTaf ? (
                <View style={{ gap: 6 }}>
                  <Text style={st.tileLbl}>TAF {wx.tafStation}</Text>
                  <Text selectable style={st.raw}>
                    {page.rawTaf.length
                      ? page.rawTaf.map((g, i) => <Text key={i} style={{ color: g.cat ? catColor(g.cat) : Colors.textPrimary }}>{(i ? '\n' : '') + g.text}</Text>)
                      : wx.rawTaf}
                  </Text>
                </View>
              ) : null}
              {page.rawTaf.length > 1 ? <Text style={{ fontSize: 12, color: Colors.textMuted }}>Colours match the forecast band above.</Text> : null}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  icao: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 46, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.5, lineHeight: 52 },
  name: { fontSize: 15, color: Colors.textSecondary },
  meta: { fontFamily: MONO, fontSize: 10.5, letterSpacing: 0.4, color: Colors.textSecondary },
  summary: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: Colors.textPrimary },
  glance: { flex: 1, gap: 6, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, backgroundColor: Colors.card },
  lbl: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, color: Colors.textSecondary },
  glanceCat: { fontFamily: MONO, fontSize: 17, fontWeight: '800' },
  glanceNote: { fontSize: 11.5, lineHeight: 15, color: Colors.textSecondary },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sec: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textSecondary },
  secSub: { fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.4, color: Colors.textMuted },
  card: { borderWidth: 1, borderColor: Colors.border, borderRadius: 18, backgroundColor: Colors.card },
  wind: { fontFamily: MONO, fontSize: 26, fontWeight: '800', color: Colors.textPrimary },
  windUnit: { fontSize: 12, color: Colors.textSecondary },
  windNote: { fontSize: 12.5, color: Colors.textSecondary },
  rwRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10 },
  rwId: { fontFamily: MONO, fontSize: 11, fontWeight: '800', width: 40 },
  rwTxt: { flex: 1, fontSize: 12 },
  tile: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  tileLbl: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: Colors.textSecondary },
  tileVal: { fontFamily: MONO, fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  tileUnit: { fontSize: 9.5, fontWeight: '700', color: Colors.textSecondary },
  tileNote: { fontSize: 10.5, lineHeight: 13, color: Colors.textSecondary, textAlign: 'center' },
  seg: { flexDirection: 'row', borderWidth: 1, borderColor: Colors.border, borderRadius: 8, overflow: 'hidden' },
  segBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  segTxt: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4 },
  bar: { flex: 1, justifyContent: 'center', paddingLeft: 7, borderRadius: 8, borderColor: Colors.textPrimary, overflow: 'hidden' },
  barTxt: { fontFamily: MONO, fontSize: 10, fontWeight: '800', color: Colors.background },
  tempBar: { flex: 1, justifyContent: 'center', paddingLeft: 7, borderRadius: 6, overflow: 'hidden' },
  tempTxt: { fontFamily: MONO, fontSize: 9, fontWeight: '800' },
  windTick: { fontFamily: MONO, fontSize: 9, fontWeight: '700' },
  tick: { position: 'absolute', width: 30, fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.3 },
  readout: { marginTop: 4, padding: 12, borderRadius: 12, backgroundColor: Colors.background, gap: 4 },
  readCat: { fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  readWhen: { flex: 1, fontFamily: MONO, fontSize: 10, letterSpacing: 0.3, color: Colors.textSecondary },
  readTxt: { fontSize: 14, lineHeight: 20, color: Colors.textPrimary },
  change: { flexDirection: 'row', gap: 12, padding: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, backgroundColor: Colors.card },
  chWhen: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  chKind: { fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: Colors.border, color: Colors.textSecondary, overflow: 'hidden' },
  chCat: { fontFamily: MONO, fontSize: 11, fontWeight: '800' },
  chTxt: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  rawBtn: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 14 },
  rawBtnTxt: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, color: Colors.primary },
  raw: { fontFamily: MONO, fontSize: 12.5, lineHeight: 20, color: Colors.textPrimary },
  empty: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
});
