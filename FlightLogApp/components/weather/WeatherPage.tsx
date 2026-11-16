// Vädersidan för en flygplats (visas i AirportPickerModal när en station är vald). Uppifrån och ned:
// stationen med kategorin just nu, de två närmaste förändringarna, Now (ETT kort: karta, banvind och fyra
// värden) och prognosen (ETT kort: tidsbandet för TAF:en överst, en rad per TAF-grupp i klartext under).
// Etiketten på varje rad ser ut som sin stapel: fylld = grundprognosen, streckad = tillfällig (TEMPO/PROB),
// och raden säger TAF:ens egen term (TEMPORARY, BECOMING, FROM, PROBABILITY). Raw visar samma rader med
// den råa texten. All logik i services/wxPage.ts; design: Claude design "Blades vädersida" (2026-11-16).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { categoryColor, type DecodedWx, type FlightCat } from '../../services/weather';
import { buildWxPage, fmtTime, runwayWinds, type WxSeg, type WxTz } from '../../services/wxPage';
import { getRunwayGeo, runwayBearing } from '../../constants/runwayGeo';
import { WxRunwayMap } from './WxRunwayMap';

const MONO = 'JetBrainsMono';
const SUB = '#6E93B5';   // dämpad text som ändå går att läsa mot kortet (textMuted är för mörk för text)
const catColor = (c: FlightCat | null) => (c ? categoryColor(c) : Colors.textSecondary);

// Kategorietiketten på en rad: fylld för grundprognosen, streckad för en tillfällig grupp (som stapeln i bandet).
function Tag({ cat, temp }: { cat: FlightCat | null; temp?: boolean }) {
  const c = catColor(cat);
  return (
    <View style={[st.tag, temp ? { borderStyle: 'dashed', borderColor: c, backgroundColor: c + '29' } : { borderColor: c, backgroundColor: c }]}>
      <Text style={[st.tagTxt, { color: temp ? c : Colors.background }]}>{cat ?? '—'}</Text>
    </View>
  );
}

// tz (UTC/LOCAL) väljs med växeln uppe till höger i AirportPickerModal.
export function WeatherPage({ wx, fallbackName, view = 'decoded', tz = 'utc' }: { wx: DecodedWx; fallbackName?: string; view?: 'decoded' | 'raw'; tz?: WxTz }) {
  const [sel, setSel] = useState<string | null>(null);
  const [selRow, setSelRow] = useState<string | null>(null);   // raden man tryckt på (annars följer raderna stapeln)
  const [nowMs, setNowMs] = useState(Date.now());


  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(t); }, []);

  const page = useMemo(() => buildWxPage(wx.metarObj, wx.tafObj, tz, nowMs), [wx, tz, nowMs]);
  const station = wx.metarStation ?? wx.tafStation ?? wx.destIcao;
  const name = (station === wx.metarStation ? wx.metarStationName : wx.tafStationName) || fallbackName || '';

  // Helikopterbanor ("08H/26H") räknas inte: de är inte banor för flygplan och skulle bara störa banvinden.
  const runways = useMemo(() => getRunwayGeo(wx.metarStation ?? station).filter((r) => !/H$/.test(r.leIdent) && !/H$/.test(r.heIdent)), [wx.metarStation, station]);
  const rw = useMemo(() => runwayWinds(
    runways.map((r) => ({ leIdent: r.leIdent, heIdent: r.heIdent, bearing: runwayBearing(r) })),
    page.now?.windDir ?? null, page.now?.windSpd ?? 0,
  ), [runways, page.now]);

  // Vald del av tidslinjen (förvalt: det som gäller nu).
  const tl = page.timeline;
  const segs: WxSeg[] = tl ? [...tl.base, ...tl.temp.flat()] : [];
  const cur = (sel ? segs.find((s) => s.ids.includes(sel) && s.kind !== 'becmg') ?? segs.find((s) => s.ids.includes(sel)) : undefined)
    ?? tl?.base.find((s) => s.from <= nowMs / 1000 && s.to > nowMs / 1000) ?? tl?.base[0];
  const isSel = (id: string) => (cur ? cur.ids.includes(id) : false);

  // Kommande förändringar (rutan för "Now" ersätts av kategorietiketten bredvid stationen).
  const upcoming = page.glance.filter((g) => g.when !== 'NOW');
  const obsAge = wx.metarObsMs ? Math.max(0, Math.round((nowMs - wx.metarObsMs) / 60000)) : null;
  const obsTime = wx.metarObsMs ? fmtTime(wx.metarObsMs / 1000, tz, nowMs / 1000).toUpperCase() : '';
  const pct = (sec: number) => (tl ? ((sec - tl.start) / (tl.end - tl.start)) * 100 : 0);

  // Raden som är markerad: den man tryckt på, annars stapelns rader, annars den som gäller nu.
  const nowCard = page.cards.find((c) => !c.temp)?.id ?? null;
  const rowOn = (id: string) => (selRow ? id === selRow : sel ? isSel(id) : id === nowCard);
  const pickBar = (id: string | null) => { setSel(id); setSelRow(null); };
  const pickRow = (id: string) => { setSel(id); setSelRow(id); };

  // Stationen med kategorin just nu till höger: samma rubrik i Decoded och Raw.
  const hero = (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[st.icao, { flex: 1 }]} numberOfLines={1}>{station}</Text>
        {page.nowCat ? (
          <TouchableOpacity activeOpacity={0.8} onPress={() => pickBar(null)} accessibilityLabel={`${page.nowCat} now`}
            style={[st.nowBadge, { borderColor: catColor(page.nowCat) + '99', backgroundColor: catColor(page.nowCat) + '1F' }]}>
            <View style={[st.nowDot, { backgroundColor: catColor(page.nowCat) }]} />
            <Text style={[st.nowCat, { color: catColor(page.nowCat) }]}>{page.nowCat}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {name ? <Text style={st.name} numberOfLines={1}>{name}</Text> : null}
      {wx.metarIsAlternate || wx.tafIsAlternate
        ? <Text style={st.meta}>NEAREST REPORT TO {wx.destIcao}</Text> : null}
      {obsTime ? <Text style={st.meta}>OBSERVED {obsTime}{obsAge != null ? ` · ${obsAge < 60 ? `${obsAge} MIN` : `${Math.floor(obsAge / 60)} H ${obsAge % 60} MIN`} AGO` : ''}</Text> : null}
    </View>
  );

  // Raw: samma kort och etiketter som Decoded, med den råa texten. En rad per TAF-grupp.
  if (view === 'raw') {
    return (
      <View style={{ gap: 24, marginTop: 10 }}>
        {hero}
        {wx.rawMetar ? (
          <View style={{ gap: 10 }}>
            <View style={st.secHead}>
              <Text style={st.sec}>NOW</Text>
              <Text style={st.secSub}>METAR {wx.metarStation}</Text>
            </View>
            <View style={[st.card, { padding: 8 }]}>
              <View style={st.rawRow}>
                {page.nowCat ? <Tag cat={page.nowCat} /> : null}
                <Text selectable style={st.raw}>{wx.rawMetar}</Text>
              </View>
            </View>
          </View>
        ) : null}
        {wx.rawTaf ? (
          <View style={{ gap: 10 }}>
            <View style={st.secHead}>
              <Text style={st.sec}>FORECAST</Text>
              <Text style={st.secSub}>TAF {wx.tafStation}</Text>
            </View>
            <View style={[st.card, { padding: 8, gap: 4 }]}>
              {page.rawTaf.length ? page.rawTaf.map((g, i) => (
                <View key={i} style={st.rawRow}>
                  {g.cat ? <Tag cat={g.cat} temp={/^(TEMPO|PROB)/.test(g.text)} /> : null}
                  <Text selectable style={st.raw}>{g.text}</Text>
                </View>
              )) : (
                <View style={st.rawRow}><Text selectable style={st.raw}>{wx.rawTaf}</Text></View>
              )}
            </View>
          </View>
        ) : null}
        {!wx.rawMetar && !wx.rawTaf ? <Text style={st.empty}>No reports for this station</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 24, marginTop: 10 }}>
      {/* Station med kategorin just nu till höger, sedan kommande förändringar som halvbreda rutor. */}
      <View style={{ gap: 14 }}>
        {hero}
        {upcoming.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {upcoming.map((g, i) => (
              <TouchableOpacity key={g.id + i} activeOpacity={0.8} onPress={() => pickBar(g.id)}
                style={[st.glance, { borderColor: isSel(g.id) && sel ? catColor(g.cat) : Colors.border }]}>
                <Text style={st.lbl} numberOfLines={1}>{g.when}</Text>
                <Text style={[st.glanceCat, { color: catColor(g.cat) }]} numberOfLines={1} adjustsFontSizeToFit>{g.label}</Text>
                <Text style={st.glanceNote} numberOfLines={2}>{g.note}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Now (METAR): ett kort. Kartan fyller vänstra halvan, vinden och banorna till höger, fyra värden under. */}
      {page.now && (
        <View style={{ gap: 10 }}>
          <View style={st.secHead}>
            <Text style={st.sec}>NOW</Text>
            <Text style={st.secSub}>METAR {obsTime}</Text>
          </View>
          <View style={[st.card, { overflow: 'hidden' }]}>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, aspectRatio: 1, borderRightWidth: 1, borderRightColor: Colors.border }}>
                <WxRunwayMap runways={runways} ends={rw.ends} windDir={page.now.windDir} />
              </View>
              <View style={{ flex: 1, gap: 10, padding: 12, justifyContent: 'center' }}>
                <View style={{ gap: 3 }}>
                  <Text style={st.lbl}>WIND</Text>
                  <Text style={st.wind} numberOfLines={1} adjustsFontSizeToFit>
                    {page.now.windValue}{page.now.windSpd > 0 ? <Text style={st.windUnit}> kt</Text> : null}
                  </Text>
                  <Text style={[st.windNote, page.now.gust > 0 && { color: Colors.warning, fontWeight: '600' }]}>{page.now.windNote}</Text>
                </View>
                {rw.list.length > 0 && (
                  <View style={{ gap: 6 }}>
                    {rw.list.slice(0, 2).map((r) => (
                      <View key={r.ident} style={[st.rwRow, { backgroundColor: r.favored ? 'rgba(103,232,249,0.10)' : Colors.background }]}>
                        <Text style={[st.rwId, { color: r.favored ? '#67E8F9' : '#DCE6F0' }]} numberOfLines={1}>{r.ident}</Text>
                        <Text style={[st.rwTxt, { color: r.favored ? Colors.textPrimary : Colors.textSecondary }]} numberOfLines={1} adjustsFontSizeToFit>
                          {r.head >= 0 ? `${r.head} head` : `${-r.head} tail`} · {r.cross} cross
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border }}>
              {page.now.tiles.map((t, i) => (
                <View key={t.label} style={[st.tile, i > 0 && { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
                  <Text style={st.lbl} numberOfLines={1}>{t.label}</Text>
                  <Text style={st.tileVal} numberOfLines={1} adjustsFontSizeToFit>
                    {t.value}{t.unit ? <Text style={st.tileUnit}>{t.unit}</Text> : null}
                  </Text>
                  <Text style={st.tileNote} numberOfLines={2}>{t.note}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* Prognosen (TAF): ett kort. Tidsbandet överst, en rad per TAF-grupp under. */}
      <View style={{ gap: 10 }}>
        <View style={st.secHead}>
          <Text style={st.sec}>{tl ? `NEXT ${Math.round((tl.end - tl.start) / 3600)} HOURS` : 'FORECAST'}</Text>
          {page.tafIssued ? <Text style={st.secSub}>TAF {page.tafIssued}</Text> : null}
        </View>
        {tl ? (
          <View style={[st.card, { overflow: 'hidden' }]}>
            <View style={{ padding: 14, paddingTop: 16, paddingBottom: 12, gap: 8 }}>
              <View style={{ height: 34 }}>
                {tl.base.map((s, i) => (
                  <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => pickBar(s.id)}
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
                    <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => pickBar(s.id)}
                      style={{ position: 'absolute', top: 0, height: 22, left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%` }}>
                      <View style={[st.tempBar, { borderColor: catColor(s.cat), backgroundColor: catColor(s.cat) + '29', borderWidth: isSel(s.id) ? 2 : 1, borderStyle: 'dashed' }]}>
                        <Text style={[st.tempTxt, { color: catColor(s.cat) }]} numberOfLines={1}>{s.label}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
              <View style={{ height: 40, borderTopWidth: 1, borderTopColor: Colors.border }}>
                {tl.winds.map((w, i) => (
                  <View key={i} style={{ position: 'absolute', top: 8, left: `${pct(w.t)}%`, width: 40, marginLeft: i === 0 ? 0 : -20, alignItems: i === 0 ? 'flex-start' : 'center', gap: 3 }}>
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
                  <Text key={i} style={[st.tick, { left: `${pct(t.t)}%`, marginLeft: i === 0 ? 0 : -15, textAlign: i === 0 ? 'left' : 'center' }, i === 0 && { color: Colors.textPrimary, fontWeight: '700' }]}>{t.label}</Text>
                ))}
              </View>
            </View>
            {page.cards.length > 0 && (
              <View style={{ borderTopWidth: 1, borderTopColor: Colors.border, padding: 8, gap: 4 }}>
                {page.cards.map((c) => (
                  <TouchableOpacity key={c.id} activeOpacity={0.85} onPress={() => pickRow(c.id)}
                    style={[st.row, rowOn(c.id) && { backgroundColor: Colors.background }]}
                    accessibilityRole="button" accessibilityState={{ selected: rowOn(c.id) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Tag cat={c.cat} temp={c.temp} />
                      <Text style={st.rowWhen}>{c.when.toUpperCase()}</Text>
                      <View style={{ flex: 1 }} />
                      {c.kind ? <Text style={st.rowKind}>{c.kind}</Text> : null}
                    </View>
                    <Text style={st.rowTxt}>{c.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          <Text style={st.empty}>No forecast for this station</Text>
        )}
      </View>

    </View>
  );
}

// Ett system: en kortstil (card), en etikettstil (lbl/sec, mono 10), värden i mono, text i systemfonten.
const st = StyleSheet.create({
  icao: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 46, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.5, lineHeight: 52 },
  name: { fontSize: 15, color: Colors.textSecondary },
  meta: { fontFamily: MONO, fontSize: 10, letterSpacing: 1.2, color: Colors.textSecondary },
  nowBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  nowCat: { fontFamily: MONO, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  glance: { width: '48.6%', gap: 6, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, backgroundColor: Colors.card },
  lbl: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: Colors.textSecondary },
  glanceCat: { fontFamily: MONO, fontSize: 17, fontWeight: '800' },
  glanceNote: { fontSize: 12, lineHeight: 16, color: Colors.textSecondary },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sec: { fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: Colors.textSecondary },
  secSub: { fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, color: SUB },
  card: { borderWidth: 1, borderColor: Colors.border, borderRadius: 18, backgroundColor: Colors.card },
  wind: { fontFamily: MONO, fontSize: 26, fontWeight: '800', color: Colors.textPrimary },
  windUnit: { fontSize: 12, color: Colors.textSecondary },
  windNote: { fontSize: 12.5, color: Colors.textSecondary },
  rwRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10 },
  rwId: { fontFamily: MONO, fontSize: 11, fontWeight: '800', width: 40 },
  rwTxt: { flex: 1, fontSize: 12 },
  tile: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 4 },
  tileVal: { fontFamily: MONO, fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  tileUnit: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  tileNote: { fontSize: 11, lineHeight: 14, color: Colors.textSecondary, textAlign: 'center' },
  bar: { flex: 1, justifyContent: 'center', paddingLeft: 8, borderRadius: 8, borderColor: Colors.textPrimary, overflow: 'hidden' },
  barTxt: { fontFamily: MONO, fontSize: 10, fontWeight: '800', color: Colors.background },
  tempBar: { flex: 1, justifyContent: 'center', paddingLeft: 8, borderRadius: 6, overflow: 'hidden' },
  tempTxt: { fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  windTick: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  tick: { position: 'absolute', width: 30, fontFamily: MONO, fontSize: 10, letterSpacing: 0.4, color: SUB },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  tagTxt: { fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  row: { gap: 7, padding: 12, borderRadius: 12 },
  rowWhen: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: Colors.textPrimary },
  rowKind: { fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: Colors.textSecondary },
  rowTxt: { fontSize: 14, lineHeight: 20, color: Colors.textPrimary },
  rawRow: { alignItems: 'flex-start', gap: 8, padding: 12 },
  raw: { fontFamily: MONO, fontSize: 13, lineHeight: 21, color: Colors.textPrimary },
  empty: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
});
