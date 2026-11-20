// Info-kortet (Airport Info): PPR, bränsle, avgifter, öppettider, NOTAM, kontakt och hemsida — samma stil som
// flygplatskortet och väderkortet. Visas på global map (Info-knappen på kartan → kortet ovanför flygplatskortet)
// och i Find airport (lägger sig över kartrutan, så att en skärmdump får med flygplatskort, Info och rutten).
// Uppgifterna kommer bara från officiell källa (AIP) eller flygplatsens egen hemsida (store/airportInfoStore.ts).
// Design v1 2026-11-20, artifact TUS8mTBNxgCYYuEfCCpQGe: rubrikrad med Verified + ⓘ källor + ↻ (hämta om, 3 coins,
// bekräftas i en rad under rubriken), FEES bara när avgifter finns, NOTAM ur LFV:s PIB (gratis) i stället för Good to know.
// Ligger över kartornas Modal → inga native Alert/Modal här, allt visas inline.
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { useAirportInfoStore, type InfoRec } from '../store/airportInfoStore';
import { fetchNotams, refreshAirportInfo, RefreshError, type NotamResult, type Notam } from '../services/airportInfo';

const MONO = 'JetBrainsMono';
const GOLD = '#FFB830';
const SUB = '#A9C3DB';
const DIM = '#8FB0CC';

const PPR_LABEL: Record<string, { t: string; c: string; bg: string }> = {
  required: { t: 'Required', c: '#FFD080', bg: 'rgba(255,184,48,0.16)' },
  partial: { t: 'Partly required', c: '#FFD080', bg: 'rgba(255,184,48,0.10)' },
  not_required: { t: 'Not required', c: '#2DD4A3', bg: 'rgba(45,212,163,0.12)' },
  unknown: { t: 'Not stated', c: '#9DB4CC', bg: 'rgba(255,255,255,0.06)' },
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const open = (url: string) => Linking.openURL(/^(https?:|tel:|mailto:)/.test(url) ? url : `https://${url}`).catch(() => {});
const tel = (ph: string) => open(`tel:${ph.replace(/[^\d+]/g, '')}`);
const fmtDate = (d?: string) => {
  if (!d) return '';
  const t = new Date(`${d}T12:00:00Z`);
  return isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
/** "16 NOV 2026 06:00" → "16 NOV 06:00" (året bara när det inte är i år) */
const shortDt = (s?: string | null) => {
  if (!s) return '';
  const m = s.match(/^(\d{2} [A-Z]{3}) (\d{4}) (\d{2}:\d{2})$/);
  if (!m) return s;
  return +m[2] === new Date().getUTCFullYear() ? `${m[1]} ${m[3]}` : `${m[1]} ${m[2]} ${m[3]}`;
};
const when = (n: Notam) => {
  if (!n.from) return '';
  const to = n.to === 'PERM' ? 'PERM' : n.to ? `${shortDt(n.to)}${n.est ? ' EST' : ''}` : 'UFN';
  return `${shortDt(n.from)} → ${to}`;
};
const zTime = (iso?: string | null) => (iso ? `${iso.slice(11, 13)}:${iso.slice(14, 16)}Z` : '');

type NotamState = { s: 'idle' } | { s: 'loading' } | { s: 'error' } | { s: 'ok'; r: NotamResult; all: boolean };
type RefreshState = 'closed' | 'confirm' | 'working' | { done: string } | { err: string };

export function AirportInfoPanel({ info, infoKey, accent = Colors.primary, maxHeight, height, onMap }: {
  info: InfoRec;
  infoKey: string;      // flygplatsens nyckel (ICAO för svenska fält) — för NOTAM och ↻
  accent?: string;
  maxHeight?: number;   // global map: kortet växer till max denna höjd, sedan rullar det
  height?: number;      // Find airport: exakt kartrutans höjd
  onMap?: () => void;   // Find airport: "Map" tar tillbaka kartan
}) {
  const saveLocal = useAirportInfoStore((st) => st.saveLocal);
  const [srcOpen, setSrcOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const [notam, setNotam] = useState<NotamState>({ s: 'idle' });
  const [refresh, setRefresh] = useState<RefreshState>('closed');
  const line = accent + '33';
  const ppr = info.ppr ? PPR_LABEL[info.ppr.s] ?? PPR_LABEL.unknown : null;
  const h24 = /^H24\b/.test(info.hours?.ad ?? '');
  const utc = info.kind === 'aip';
  const swedish = /^ES[A-Z]{2}$/.test(infoKey);
  // "Parking …" skrivs av raden själv; ta bort ordet om källtexten redan har det (↻ kan ge "Parking 100 SEK/night")
  const fees = info.fees?.landing ? { ...info.fees, parking: info.fees.parking?.replace(/^parking:?\s*/i, '') } : null;

  const loadNotams = async () => {
    setNotam({ s: 'loading' });
    try { setNotam({ s: 'ok', r: await fetchNotams(infoKey), all: false }); } catch { setNotam({ s: 'error' }); }
  };
  const doRefresh = async () => {
    setRefresh('working');
    try {
      const { record, changed } = await refreshAirportInfo(infoKey);
      saveLocal(infoKey, record);
      setRefresh({ done: changed.length ? `Updated · ${changed.length} ${changed.length === 1 ? 'change' : 'changes'} from the source` : 'Checked · already up to date' });
    } catch (e) {
      const code = e instanceof RefreshError ? e.code : 'failed';
      setRefresh({ err: code === 'no_coins' ? 'Not enough Blade coins.' : code === 'source_unavailable' ? 'The official source could not be reached. No coins used.' : 'Could not update right now. No coins used.' });
    }
  };

  const chip = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, a11y?: string) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={[s.pill, { borderColor: accent + '80', backgroundColor: accent + '24' }]}
      accessibilityRole="button" accessibilityLabel={a11y ?? label}>
      <Ionicons name={icon} size={12} color={accent} />
      <Text style={[s.pillTxt, { color: accent }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
  const round = (child: React.ReactNode, onPress: () => void, a11y: string, on = false) => (
    <TouchableOpacity onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={a11y}
      style={[s.round, { borderColor: accent + '73' }, on && { backgroundColor: accent + '2E' }]}>{child}</TouchableOpacity>
  );

  const notams = notam.s === 'ok' ? [
    ...(notam.r.snowtam ? [{ text: notam.r.snowtam.text, snow: notam.r.snowtam.issued } as Notam & { snow?: string }] : []),
    ...notam.r.notams,
  ] as (Notam & { snow?: string })[] : [];
  const shown = notam.s === 'ok' && !notam.all ? notams.slice(0, 2) : notams;

  return (
    <View style={[s.card, { borderColor: accent + '55' }, height ? { height } : maxHeight ? { maxHeight } : null]}>
      <LinearGradient colors={['rgba(18,48,74,0.97)', 'rgba(15,30,58,0.97)']} locations={[0, 0.55]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[s.head, { borderBottomColor: line }]}>
        <Text style={[s.headTxt, { color: accent }]} numberOfLines={1}>AIRPORT INFO</Text>
        {!!info.v && (
          // Två rader så att AIRPORT INFO inte kortas när Map-knappen också får plats (Find airport)
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.verLbl}>VERIFIED</Text>
            <Text style={s.verified} numberOfLines={1}>{fmtDate(info.v)}</Text>
          </View>
        )}
        {!!info.src?.length && round(<Text style={{ color: accent, fontSize: 13, fontWeight: '800' }}>ⓘ</Text>, () => setSrcOpen((o) => !o), 'Sources', srcOpen)}
        {swedish && round(<Ionicons name="refresh" size={14} color={accent} />, () => setRefresh((r) => (r === 'confirm' ? 'closed' : r === 'working' ? r : 'confirm')), "Update this airport's info", refresh === 'confirm')}
        {onMap && (
          <TouchableOpacity onPress={onMap} activeOpacity={0.8} style={s.mapBtn} accessibilityRole="button" accessibilityLabel="Show map">
            <Ionicons name="map-outline" size={13} color="#fff" />
            <Text style={s.mapBtnTxt}>Map</Text>
          </TouchableOpacity>
        )}
      </View>
      {refresh !== 'closed' && (
        <View style={s.confirm}>
          {refresh === 'confirm' ? (
            <>
              <Text style={s.confirmTxt}>Fetch the latest info for this airport from its official sources? Uses <Text style={{ fontWeight: '800' }}>3 coins</Text>.</Text>
              <TouchableOpacity onPress={doRefresh} style={s.confirmBtn} accessibilityRole="button"><Text style={s.confirmBtnTxt}>Update</Text></TouchableOpacity>
            </>
          ) : refresh === 'working' ? (
            <>
              <ActivityIndicator size="small" color={GOLD} />
              <Text style={s.confirmTxt}>Reading the official sources…</Text>
            </>
          ) : (
            <Text style={[s.confirmTxt, 'err' in refresh && { color: '#FF9A8A' }]}>{'done' in refresh ? refresh.done : refresh.err}</Text>
          )}
          {refresh !== 'working' && (
            <TouchableOpacity onPress={() => setRefresh('closed')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={15} color={DIM} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {srcOpen && !!info.src?.length && (
        <View style={[s.srcBox, { borderBottomColor: line }]}>
          {info.src.map((x, i) => (
            <TouchableOpacity key={i} onPress={() => open(x.url)} accessibilityRole="link">
              <Text style={{ color: accent, fontSize: 12 }} numberOfLines={1}>{x.t || x.url} ↗</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator nestedScrollEnabled bounces={false}>
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
              ) : !info.fuel ? <Text style={s.small}>Not stated</Text> : null}
              {!!info.fuel?.n && <Text style={s.small}>{info.fuel.n}</Text>}
              {!!info.fuel?.h && <Text style={s.small}>Hours: {info.fuel.h}</Text>}
            </View>
          </View>
        )}

        {fees && (
          <TouchableOpacity onPress={() => setFeesOpen((o) => !o)} activeOpacity={0.8} style={[s.fees, { borderBottomColor: line }]}
            accessibilityRole="button" accessibilityState={{ expanded: feesOpen }} accessibilityLabel="Fees">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={s.label}>FEES</Text>
              <Text style={s.feesLine} numberOfLines={1}>
                {fees.landing}{fees.parking ? ` · Parking ${fees.parking}` : ''}
              </Text>
              <Ionicons name={feesOpen ? 'chevron-up' : 'chevron-down'} size={12} color="#6F89A6" />
            </View>
            {feesOpen && (
              <View style={{ gap: 3 }}>
                <Text style={s.small}>{fees.landing}</Text>
                {!!fees.parking && <Text style={s.small}>Parking: {fees.parking}</Text>}
                {!!fees.note && <Text style={s.small}>{fees.note}</Text>}
                <Text style={s.note}>{fees.year ? `Price list ${fees.year}` : 'Price list'}{fees.url ? ' · ' : ''}
                  {!!fees.url && <Text style={{ color: accent }} onPress={() => open(fees.url!)}>Source ↗</Text>}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {!!info.hours?.ad && (
          <View style={[s.block, { borderBottomColor: line }]}>
            <View style={s.rowBetween}>
              <Text style={s.label}>OPENING HOURS</Text>
              {h24 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#2DD4A3' }} />
                  <Text style={{ color: '#2DD4A3', fontSize: 11.5, fontWeight: '700' }}>Open · H24</Text>
                </View>
              )}
            </View>
            {h24 ? (
              <View style={{ flexDirection: 'row', gap: 3 }}>
                {DAYS.map((d) => (
                  <View key={d} style={s.day}>
                    <Text style={{ color: SUB, fontSize: 10, fontWeight: '700' }}>{d}</Text>
                    <Text style={{ color: '#2DD4A3', fontFamily: MONO, fontSize: 10, fontWeight: '700' }}>H24</Text>
                  </View>
                ))}
              </View>
            ) : <Text style={s.value}>{info.hours.ad}</Text>}
            {!!info.hours.n && <Text style={s.small}>{info.hours.n}</Text>}
            {utc && !h24 && <Text style={s.note}>Times in UTC as in the AIP; summer times in brackets.</Text>}
          </View>
        )}

        {swedish && (
          <View style={[s.block, { borderBottomColor: line }]}>
            <View style={s.rowBetween}>
              <Text style={s.label}>NOTAM</Text>
              {notam.s === 'ok' && !!notam.r.issued && <Text style={s.verified}>LFV PIB · updated {zTime(notam.r.issued)}</Text>}
            </View>
            {(notam.s === 'idle' || notam.s === 'error') && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {chip('refresh', notam.s === 'error' ? 'Try again' : 'Fetch NOTAMs', loadNotams)}
                <Text style={[s.note, { flex: 1 }]}>{notam.s === 'error' ? 'Could not reach the LFV bulletin.' : 'Free · official LFV bulletin'}</Text>
              </View>
            )}
            {notam.s === 'loading' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 32 }}>
                <ActivityIndicator size="small" color={accent} />
                <Text style={s.note}>Reading the LFV bulletin…</Text>
              </View>
            )}
            {notam.s === 'ok' && (
              <View style={{ gap: 6 }}>
                {!notam.r.covered ? (
                  <Text style={s.small}>This aerodrome is not in LFV's VFR bulletin. Check NOTAM with the aerodrome or in the AIS.</Text>
                ) : !notams.length ? (
                  <Text style={s.small}>No NOTAM in the current bulletin.</Text>
                ) : shown.map((n, i) => (
                  <View key={i} style={s.notam}>
                    <Text style={{ fontFamily: MONO, fontSize: 10.5 }} numberOfLines={1}>
                      {n.snow ? <Text style={{ color: accent, fontWeight: '800' }}>SNOWTAM  </Text> : null}
                      <Text style={{ color: SUB }}>{n.snow ? shortDt(n.snow) : when(n)}</Text>
                    </Text>
                    <Text style={s.notamTxt}>{n.text}</Text>
                    {!!n.sched && <Text style={[s.note, { fontFamily: MONO }]}>Schedule: {n.sched}</Text>}
                  </View>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  {notams.length > 2 && (
                    <TouchableOpacity onPress={() => setNotam({ ...notam, all: !notam.all })} hitSlop={8} accessibilityRole="button">
                      <Text style={[s.link, { color: accent }]}>{notam.all ? 'Show less' : `+${notams.length - 2} more ›`}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => open(notam.r.covered ? notam.r.pibUrl : notam.r.listUrl)} hitSlop={8} accessibilityRole="link">
                    <Text style={[s.link, { color: accent, fontWeight: '700' }]}>Full PIB ↗</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {!!info.contacts?.length && (
          <View style={[s.block, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <Text style={s.label}>CONTACT</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {info.contacts.map((c, i) => <View key={i}>{chip('call-outline', c.l, () => tel(c.ph), `Call ${c.l}, ${c.ph}`)}</View>)}
            </View>
          </View>
        )}

        {!!info.web && <View style={s.foot}>{chip('globe-outline', 'Website', () => open(info.web!))}</View>}
        <Text style={[s.note, { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 }]}>Not for operational use. Always check the AIP, NOTAM and with the aerodrome before flight.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 10, paddingVertical: 8, borderBottomWidth: 1 },
  headTxt: { flex: 1, minWidth: 100, fontFamily: MONO, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  verLbl: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: DIM },
  verified: { color: DIM, fontSize: 10.5 },
  round: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(10,22,40,0.9)' },
  mapBtnTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,184,48,0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,184,48,0.3)' },
  confirmTxt: { flex: 1, color: '#FFD080', fontSize: 11.5, lineHeight: 15 },
  confirmBtn: { height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: GOLD, backgroundColor: 'rgba(255,184,48,0.18)', justifyContent: 'center' },
  confirmBtnTxt: { color: '#FFD080', fontSize: 12, fontWeight: '800' },
  srcBox: { paddingHorizontal: 14, paddingVertical: 8, gap: 4, borderBottomWidth: 1 },
  row2: { flexDirection: 'row', borderBottomWidth: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cell: { flex: 1, minWidth: 0, gap: 5, paddingVertical: 10, paddingHorizontal: 14 },
  block: { gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  fees: { gap: 4, paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1 },
  feesLine: { flex: 1, minWidth: 0, color: '#C9D6E6', fontSize: 12 },
  label: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: GOLD },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, fontSize: 12.5, fontWeight: '800', overflow: 'hidden' },
  fuelChip: { fontFamily: MONO, fontSize: 11.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  day: { flex: 1, alignItems: 'center', gap: 1, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(45,212,163,0.10)', borderWidth: 1, borderColor: 'rgba(45,212,163,0.35)' },
  notam: { gap: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  notamTxt: { fontFamily: MONO, fontSize: 11.5, lineHeight: 15, color: '#E4ECF5' },
  small: { color: SUB, fontSize: 11.5, lineHeight: 16 },
  value: { color: '#E4ECF5', fontSize: 12.5, lineHeight: 17 },
  note: { color: DIM, fontSize: 10.5, lineHeight: 14 },
  link: { fontSize: 12, fontWeight: '800' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 16, borderWidth: 1 },
  pillTxt: { fontSize: 12.5, fontWeight: '800' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
});
