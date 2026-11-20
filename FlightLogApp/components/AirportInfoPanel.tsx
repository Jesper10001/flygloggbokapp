// Info-kortet (Airport Info), kompakt design 2026-11-20 (artifact 8C5eHnfwFL5m7M5WKSqQZ7): samma stil som
// flygplatskortet — rubriker i guld, värden i vitt. En rad med PPR | FUEL | FEES (FEES bara när avgifter finns);
// ett tryck på en ruta fäller ut detaljerna under raden. Öppettiderna ur AIP visas inte (de styrs av NOTAM):
// "Fetch NOTAMs" hämtar LFV:s PIB (gratis) och öppettids-NOTAM blir veckorader (UTC/Local), övriga NOTAM i
// klartext med originalet ett tryck bort (utils/notamDecode.ts, regelbaserat). ⓘ = källor, ↻ = hämta om (3 coins).
// Ligger över kartornas Modal → inga native Alert/Modal här, allt visas inline.
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { useAirportInfoStore, type InfoRec } from '../store/airportInfoStore';
import { fetchNotams, refreshAirportInfo, RefreshError, type NotamResult, type Notam } from '../services/airportInfo';
import { parseHoursNotam, decodeNotamText, seOffsetHours, shiftHHMM, type HoursNotam } from '../utils/notamDecode';

const MONO = 'JetBrainsMono';
const GOLD = '#FFB830';
const WHITE = '#FFFFFF';
const DIM = '#8FB0CC';

const PPR_SHORT: Record<string, string> = { required: 'Required', partial: 'Partial', not_required: 'Not required', unknown: 'Not stated' };

const open = (url: string) => Linking.openURL(/^(https?:|tel:|mailto:)/.test(url) ? url : `https://${url}`).catch(() => {});
const tel = (ph: string) => open(`tel:${ph.replace(/[^\d+]/g, '')}`);
const shortDate = (d?: string) => {
  if (!d) return '';
  const t = new Date(`${d}T12:00:00Z`);
  if (isNaN(t.getTime())) return d;
  const sameYear = t.getUTCFullYear() === new Date().getUTCFullYear();
  return t.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};
/** "16 NOV 2026 06:00" → Date (UTC) */
const pibDate = (s?: string | null) => {
  const m = s?.match(/^(\d{2}) ([A-Z]{3}) (\d{4}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(m[2]);
  return mon < 0 ? null : new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5]));
};
const dayMon = (s?: string | null) => {
  const d = pibDate(s);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
};
/** Giltighet i klartext: "Until 3 Feb (est.)", "16 Nov – 22 Nov", "Permanent" */
const validity = (n: Notam) => {
  if (n.to === 'PERM') return 'Permanent';
  if (!n.to) return 'Until further notice';
  const from = pibDate(n.from);
  const until = `${dayMon(n.to)}${n.est ? ' (est.)' : ''}`;
  return from && from.getTime() > Date.now() ? `${dayMon(n.from)} – ${until}` : `Until ${until}`;
};
const zTime = (iso?: string | null) => (iso ? `${iso.slice(11, 13)}:${iso.slice(14, 16)}Z` : '');
/** Kort avgift för rutan: första beloppet ("290 SEK", "137 SEK/t"), "Free" när det är gratis */
const feeShort = (landing: string) => {
  const m = landing.match(/\d[\d,]*(?:\.\d+)?\s*SEK(?:\/t)?/);
  if (m) return m[0].replace(/\s+/g, ' ');
  return /\b(no landing fee|free)\b/i.test(landing) ? 'Free' : 'See details';
};
/** Kontaktetikett utan parentes och kort nog för en knapp */
const shortLabel = (l: string) => l.replace(/\s*\(.*$/, '').trim();

type NotamState = { s: 'idle' } | { s: 'loading' } | { s: 'error' } | { s: 'ok'; r: NotamResult; all: boolean };
type RefreshState = 'closed' | 'confirm' | 'working' | { done: string } | { err: string };
type Cell = 'ppr' | 'fuel' | 'fees';
type Item = { key: string; text: string; orig: string; when: string };

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
  const [sel, setSel] = useState<Cell | null>(null);
  const [notam, setNotam] = useState<NotamState>({ s: 'idle' });
  const [refresh, setRefresh] = useState<RefreshState>('closed');
  const [local, setLocal] = useState(false);
  const [origOpen, setOrigOpen] = useState<Record<string, boolean>>({});
  const line = accent + '33';
  const swedish = /^ES[A-Z]{2}$/.test(infoKey);
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

  // ── NOTAM: öppettider → veckorader, resten i klartext ──
  const hours: (HoursNotam & { when: string; at: Date })[] = [];
  const items: Item[] = [];
  if (notam.s === 'ok') {
    if (notam.r.snowtam) items.push({ key: 'snow', text: 'Runway condition report (SNOWTAM).', orig: notam.r.snowtam.text, when: `Issued ${dayMon(notam.r.snowtam.issued)} ${notam.r.snowtam.issued.slice(-5)}Z` });
    notam.r.notams.forEach((n, i) => {
      const h = parseHoursNotam(n.text);
      if (h) hours.push({ ...h, when: validity(n), at: pibDate(n.from) ?? new Date() });
      else items.push({ key: `n${i}`, text: decodeNotamText(n.text), orig: n.text + (n.sched ? `  SCHEDULE: ${n.sched}` : ''), when: validity(n) + (n.sched ? ` · ${n.sched}` : '') });
    });
  }
  const shown = notam.s === 'ok' && !notam.all ? items.slice(0, 2) : items;

  const cells: { k: Cell; label: string; value: string }[] = [
    { k: 'ppr', label: 'PPR', value: info.ppr ? PPR_SHORT[info.ppr.s] ?? 'Not stated' : 'Not stated' },
    { k: 'fuel', label: 'FUEL', value: info.fuel?.t?.length ? info.fuel.t.join(' · ') : 'Not stated' },
    ...(fees ? [{ k: 'fees' as Cell, label: 'FEES', value: feeShort(fees.landing) }] : []),
  ];
  const hasDetail = (k: Cell) => (k === 'ppr' ? !!(info.ppr?.n || info.ppr?.ph || info.ppr?.url) : k === 'fuel' ? !!(info.fuel?.n || info.fuel?.h) : !!fees);

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
  const link = (label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} hitSlop={8} accessibilityRole="link"><Text style={[s.link, { color: accent }]}>{label}</Text></TouchableOpacity>
  );

  return (
    <View style={[s.card, { borderColor: accent + '55' }, height ? { height } : maxHeight ? { maxHeight } : null]}>
      <LinearGradient colors={['rgba(18,48,74,0.97)', 'rgba(15,30,58,0.97)']} locations={[0, 0.55]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[s.head, { borderBottomColor: line }]}>
        <Text style={[s.headTxt, { color: accent }]} numberOfLines={1}>AIRPORT INFO</Text>
        {!!info.v && <Text style={s.verified} numberOfLines={1}>Verified {shortDate(info.v)}</Text>}
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
        {/* PPR | FUEL | FEES — tryck för detaljer */}
        <View style={s.row}>
          {cells.map((c, i) => {
            const on = sel === c.k, can = hasDetail(c.k);
            return (
              <TouchableOpacity key={c.k} disabled={!can} onPress={() => setSel(on ? null : c.k)} activeOpacity={0.8}
                accessibilityRole="button" accessibilityState={{ expanded: on, disabled: !can }} accessibilityLabel={`${c.label}: ${c.value}`}
                style={[s.cell, i > 0 && { borderLeftWidth: 1, borderLeftColor: line }, on && s.cellOn]}>
                <Text style={s.label}>{c.label}{can ? <Text style={{ color: '#6F89A6' }}>{on ? '  ▴' : '  ▾'}</Text> : null}</Text>
                <Text style={s.cellVal} numberOfLines={1}>{c.value}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {sel && (
          <View style={[s.detail, { borderTopColor: line }]}>
            {sel === 'ppr' && (
              <>
                {!!info.ppr?.n && <Text style={s.value}>{info.ppr.n}</Text>}
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  {!!info.ppr?.url && link('Request PPR ↗', () => open(info.ppr!.url!))}
                  {!!info.ppr?.ph && link('Call for PPR', () => tel(info.ppr!.ph!))}
                </View>
              </>
            )}
            {sel === 'fuel' && (
              <>
                {!!info.fuel?.n && <Text style={s.value}>{info.fuel.n}</Text>}
                {!!info.fuel?.h && <Text style={s.sub}>Hours: {info.fuel.h}</Text>}
              </>
            )}
            {sel === 'fees' && fees && (
              <>
                <Text style={s.value}>{fees.landing}{fees.parking ? `. Parking ${fees.parking}.` : ''}</Text>
                {!!fees.note && <Text style={s.sub}>{fees.note}</Text>}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={s.sub}>{fees.year ? `Price list ${fees.year}` : 'Price list'}</Text>
                  {!!fees.url && link('Source ↗', () => open(fees.url!))}
                </View>
              </>
            )}
          </View>
        )}

        {swedish && (
          <View style={[s.block, { borderTopColor: line }]}>
            <View style={s.notamHead}>
              <Text style={s.label}>NOTAM</Text>
              <Text style={[s.sub, { flex: 1 }]} numberOfLines={1}>
                {notam.s === 'ok' ? `LFV PIB · ${zTime(notam.r.issued)}` : notam.s === 'error' ? 'Could not reach the LFV bulletin' : 'Free · official LFV bulletin'}
              </Text>
              {(notam.s === 'idle' || notam.s === 'error') && (
                <TouchableOpacity onPress={loadNotams} activeOpacity={0.8} style={[s.fetchBtn, { borderColor: accent + '99', backgroundColor: accent + '24' }]} accessibilityRole="button">
                  <Text style={[s.fetchTxt, { color: accent }]}>{notam.s === 'error' ? 'Try again' : 'Fetch NOTAMs'}</Text>
                </TouchableOpacity>
              )}
              {notam.s === 'loading' && <ActivityIndicator size="small" color={accent} />}
              {notam.s === 'ok' && hours.length > 0 && (
                <View style={[s.seg, { borderColor: accent + '73' }]} accessibilityRole="radiogroup">
                  {(['UTC', 'Local'] as const).map((z) => {
                    const on = (z === 'Local') === local;
                    return (
                      <TouchableOpacity key={z} onPress={() => setLocal(z === 'Local')} accessibilityRole="radio" accessibilityState={{ selected: on }}
                        style={[s.segBtn, on && { backgroundColor: accent + '40' }]}>
                        <Text style={[s.segTxt, { color: on ? WHITE : DIM }]}>{z}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {notam.s === 'ok' && !notam.r.covered && (
              <Text style={s.sub}>This aerodrome is not in LFV's VFR bulletin. Check NOTAM with the aerodrome or in the AIS.</Text>
            )}
            {hours.map((h, i) => {
              const off = local ? seOffsetHours(h.at) : 0;
              return (
                <View key={i} style={{ gap: 4 }}>
                  <Text style={s.hoursTitle}>{h.title} <Text style={{ color: DIM, fontWeight: '500' }}>· {h.when}</Text></Text>
                  <View style={{ flexDirection: 'row', gap: 3 }}>
                    {h.days.map((d) => (
                      <View key={d.d} style={[s.day, d.closed ? s.dayClosed : s.dayOpen]}>
                        <Text style={s.dayName}>{d.d}</Text>
                        <Text style={s.dayHours}>
                          {d.closed ? 'Closed' : d.h24 ? 'H24' : (() => {
                            const a = shiftHHMM(d.h!.slice(0, 4), off), b = shiftHHMM(d.h!.slice(5, 9), off);
                            return `${a}\n${b}${d.next || b < a ? '+1' : ''}`;   // +1 = stänger dagen efter
                          })()}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
            {notam.s === 'ok' && notam.r.covered && !items.length && !hours.length && <Text style={s.sub}>No NOTAM in the current bulletin.</Text>}
            {shown.map((n) => (
              <View key={n.key} style={{ flexDirection: 'row', gap: 8 }}>
                <View style={s.dot} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.value}>{n.text} <Text style={{ color: DIM }}>{n.when}</Text></Text>
                  <TouchableOpacity onPress={() => setOrigOpen((o) => ({ ...o, [n.key]: !o[n.key] }))} hitSlop={6} accessibilityRole="button"
                    accessibilityState={{ expanded: !!origOpen[n.key] }} style={{ alignSelf: 'flex-start' }}>
                    <Text style={{ color: accent, fontSize: 11.5, fontWeight: '700' }}>{origOpen[n.key] ? 'Hide original' : 'Original NOTAM'}</Text>
                  </TouchableOpacity>
                  {origOpen[n.key] && <Text style={s.orig}>{n.orig}</Text>}
                </View>
              </View>
            ))}
            {notam.s === 'ok' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {items.length > 2 && link(notam.all ? 'Show less' : `+${items.length - 2} more ›`, () => setNotam({ ...notam, all: !notam.all }))}
                {link('Full PIB ↗', () => open(notam.r.covered ? notam.r.pibUrl : notam.r.listUrl))}
              </View>
            )}
          </View>
        )}

        {(!!info.contacts?.length || !!info.web) && (
          <View style={[s.chips, { borderTopColor: line }]}>
            {info.contacts?.map((c, i) => <View key={i} style={{ maxWidth: 170 }}>{chip('call-outline', shortLabel(c.l), () => tel(c.ph), `Call ${c.l}, ${c.ph}`)}</View>)}
            {!!info.web && chip('globe-outline', 'Website', () => open(info.web!))}
          </View>
        )}
        <Text style={s.disclaimer}>Not for operational use. Always check the AIP, NOTAM and with the aerodrome before flight.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 8, height: 46, borderBottomWidth: 1 },
  headTxt: { flex: 1, minWidth: 100, fontFamily: MONO, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  verified: { color: DIM, fontSize: 10.5, flexShrink: 1 },
  round: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(10,22,40,0.9)' },
  mapBtnTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,184,48,0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,184,48,0.3)' },
  confirmTxt: { flex: 1, color: '#FFD080', fontSize: 11.5, lineHeight: 15 },
  confirmBtn: { height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: GOLD, backgroundColor: 'rgba(255,184,48,0.18)', justifyContent: 'center' },
  confirmBtnTxt: { color: '#FFD080', fontSize: 12, fontWeight: '800' },
  srcBox: { paddingHorizontal: 14, paddingVertical: 8, gap: 4, borderBottomWidth: 1 },
  row: { flexDirection: 'row' },
  cell: { flex: 1, minWidth: 0, gap: 4, paddingVertical: 9, paddingHorizontal: 12, minHeight: 54 },
  cellOn: { backgroundColor: 'rgba(255,184,48,0.06)', borderBottomWidth: 2, borderBottomColor: GOLD },
  cellVal: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: WHITE },
  detail: { gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1, backgroundColor: 'rgba(255,255,255,0.03)' },
  block: { gap: 9, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: 1 },
  notamHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  fetchBtn: { height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, justifyContent: 'center' },
  fetchTxt: { fontSize: 12, fontWeight: '800' },
  seg: { flexDirection: 'row', borderRadius: 13, borderWidth: 1, overflow: 'hidden' },
  segBtn: { height: 26, paddingHorizontal: 10, justifyContent: 'center' },
  segTxt: { fontSize: 11, fontWeight: '800' },
  hoursTitle: { color: WHITE, fontSize: 11, fontWeight: '700' },
  day: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  dayOpen: { backgroundColor: 'rgba(45,212,163,0.10)', borderColor: 'rgba(45,212,163,0.35)' },
  dayClosed: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' },
  dayName: { color: GOLD, fontSize: 9.5, fontWeight: '700' },
  dayHours: { color: WHITE, fontFamily: MONO, fontSize: 9.5, fontWeight: '700', lineHeight: 12, textAlign: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD, marginTop: 6 },
  orig: { fontFamily: MONO, fontSize: 10.5, lineHeight: 14, color: '#A9C3DB', padding: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  label: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: GOLD },
  value: { color: WHITE, fontSize: 12.5, lineHeight: 17 },
  sub: { color: DIM, fontSize: 11, lineHeight: 15 },
  link: { fontSize: 12, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 16, borderWidth: 1 },
  pillTxt: { fontSize: 12.5, fontWeight: '800', flexShrink: 1 },
  disclaimer: { color: DIM, fontSize: 10, lineHeight: 13, paddingHorizontal: 14, paddingBottom: 10 },
});
