// Insights §5 — Next licence, i samma kompakta stil som Projections. En stege PPL → CPL → ATPL väljer licens (klara
// är gröna med år, den pågående guld med procent), READY / MET / ETA med LED-siffror, och en växling mellan Chart
// (LicenceChart: hur redo man är över tid, med en ruta per återstående krav) och List (kraven med staplar och datum).
// Datumen följer samma spärr som Projections (projectionUnlock): före 60 dagar och 10 flygningar visas bara timmarna.
// Data: licenceSetFor + haveFor/rateFor/metDateFor/seriesFor.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { FONT_LED7 } from '../logflight/tokens';
import { useInsightsTheme } from './insightsTheme';
import { useInsightsData, projectionUnlock, PROJECTION_MIN_DAYS, PROJECTION_MIN_FLIGHTS } from './insightsData';
import { LicenceChart } from './LicenceChart';
import { buildState, hoursTxt, type LicReq, type LicState } from './licenceState';
import { licenceSetFor } from '../EASAProgressChart';
import { useProfileStore } from '../../store/profileStore';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
import { useFlightStore } from '../../store/flightStore';
import { getAircraftCategory } from '../../db/flights';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const absNow = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
const mLabel = (a: number) => `${MON3[((a % 12) + 12) % 12]} ${Math.floor(a / 12)}`;
const mShort = (a: number) => `${MON3[((a % 12) + 12) % 12]} ’${String(Math.floor(a / 12)).slice(2)}`;
const yShort = (a: number) => `’${String(Math.floor(a / 12)).slice(2)}`;
const dur = (m: number) => (m < 12 ? `${m} mo` : `${Math.floor(m / 12)} yr${m % 12 ? ` ${m % 12} mo` : ''}`);
const dayLabel = (d: Date) => `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}`;
// Uppnådda timmar avrundas nedåt och återstående uppåt, så ett krav aldrig ser klart ut innan det är det.
const haveTxt = (h: number) => hoursTxt(h < 10 ? Math.floor(h * 10) / 10 : Math.floor(h));
const toGoTxt = (h: number) => hoursTxt(h < 10 ? Math.ceil(h * 10) / 10 : Math.ceil(h));

type LicId = 'ppl' | 'cpl' | 'atpl';
const IDS: LicId[] = ['ppl', 'cpl', 'atpl'];

export function LicenceJourney() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const subRole = useProfileStore((s) => s.profile?.subRole);
  const standard = useRegulationStandardStore((s) => s.standard);
  const flights = useFlightStore((s) => s.flights);
  const unlock = useMemo(() => projectionUnlock(flights), [flights]);
  const [view, setView] = useState<'chart' | 'list' | null>(null);   // null = Chart, eller List medan datumen är låsta
  const [selId, setSelId] = useState<LicId | null>(null);             // null = nästa licens
  const [focus, setFocus] = useState<string | null>(null);

  // Licenskategori (H/A) baseras på FLOTTAN, inte profilens subRole: har man bara rotary → H, bara
  // fixed → A, båda → kategorin på den senast flugna farkosten. Faller tillbaka på subRole om
  // ingen farkostkategori är känd (t.ex. inga loggade flygningar / okategoriserade farkoster).
  const [fleetCat, setFleetCat] = useState<'rotary' | 'fixed' | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const real = flights.filter((f) => f.flight_type !== 'sim' && f.aircraft_type?.trim());
      if (!real.length) { if (alive) setFleetCat(null); return; }
      const types = [...new Set(real.map((f) => f.aircraft_type.trim().toUpperCase()))];
      const cat = new Map<string, string>();
      await Promise.all(types.map(async (t) => cat.set(t, await getAircraftCategory(t))));
      let hasRotary = false, hasFixed = false;
      for (const t of types) {
        const c = cat.get(t);
        if (c === 'helicopter') hasRotary = true;
        else if (c === 'airplane') hasFixed = true;
      }
      let result: 'rotary' | 'fixed' | null = null;
      if (hasRotary && !hasFixed) result = 'rotary';
      else if (hasFixed && !hasRotary) result = 'fixed';
      else if (hasRotary && hasFixed) {
        const latest = [...real].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        const lc = cat.get(latest.aircraft_type.trim().toUpperCase());
        result = lc === 'helicopter' ? 'rotary' : lc === 'airplane' ? 'fixed' : null;
      }
      if (alive) setFleetCat(result);
    })();
    return () => { alive = false; };
  }, [flights]);

  // "Other"-regelverk: vi modellerar inte dess licensväg → visa ett neutralt kort i stället för
  // EASA/FAA-krav (annars vilseledande). Early-return narrow:ar standard till easa/faa/caa nedan.
  if (standard === 'other') {
    return (
      <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Ionicons name="ribbon-outline" size={17} color={C.primary} />
          <Text style={{ fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: C.text }}>Next licence</Text>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 12, color: C.text3, lineHeight: 18 }}>
          Licence tracking isn't available for the "Other" framework. Choose EASA, FAA or CAA in Settings to see your path to PPL, CPL and ATPL.
        </Text>
      </View>
    );
  }

  const nowA = absNow();
  const startA = D.journey.length ? D.journey[0].date.getFullYear() * 12 + D.journey[0].date.getMonth() : nowA;
  // Flottan styr; annars profilens subRole.
  const set = licenceSetFor(fleetCat ?? subRole, standard);
  const states: Record<LicId, LicState> = { ppl: buildState(set.ppl, D, nowA), cpl: buildState(set.cpl, D, nowA), atpl: buildState(set.atpl, D, nowA) };
  const current = IDS.find((id) => !states[id].done) ?? 'atpl';
  const sel = selId ?? current;
  const S = states[sel];
  const shown = view ?? (unlock.ready ? 'chart' : 'list');
  const datesLocked = !unlock.ready && !S.done;
  const etaA = S.etaM != null ? nowA + S.etaM : null;
  const accent = S.done ? C.success : C.gold;
  const tap = () => { Haptics.selectionAsync().catch(() => {}); };

  const flightsLeft = Math.max(0, PROJECTION_MIN_FLIGHTS - unlock.flights);
  const daysOk = unlock.days >= PROJECTION_MIN_DAYS;
  const moreFlights = `${flightsLeft} more ${flightsLeft === 1 ? 'flight' : 'flights'}`;
  const lockWhen = !daysOk && flightsLeft > 0 ? `From ${unlock.unlockDate ? dayLabel(unlock.unlockDate) : ''}, after ${moreFlights}`
    : !daysOk ? `From ${unlock.unlockDate ? dayLabel(unlock.unlockDate) : ''}`
    : `After ${moreFlights}`;

  let subLeft: string, subRight = '';
  if (S.done) {
    subLeft = `All ${S.reqs.length} requirements met`;
    if (S.doneA != null) subRight = `${dur(Math.max(0, S.doneA - startA))} from first flight`;
  } else if (datesLocked) {
    subLeft = `${S.metCount} of ${S.reqs.length} requirements met`;
  } else if (S.etaM == null) {
    subLeft = `No ${S.lim?.short ?? ''} time in the last 12 months`;
  } else {
    subLeft = `${S.lim?.short ?? ''} sets the date · ${toGoTxt(S.lim?.toGo ?? 0)} h`;
    const fastA = S.fastM != null ? nowA + S.fastM : null, slowA = S.slowM != null ? nowA + S.slowM : null;
    subRight = fastA != null && slowA != null && fastA !== slowA ? `likely ${mShort(fastA)}–${mShort(slowA)}` : `in ${dur(S.etaM)}`;
  }

  const etaHead = S.done ? 'COMPLETE' : 'ETA';
  const etaText = S.done ? mLabel(S.doneA ?? nowA) : datesLocked ? 'Locked' : etaA != null ? mLabel(etaA) : '—';
  const etaColor = datesLocked ? C.muted : accent;
  const readyPct = S.done ? 100 : Math.min(99, Math.floor(S.ready * 100));

  // Rutorna under kurvan: kraven som återstår i den ordning de blir klara, eller en klar licens krav i den ordning de blev klara.
  const tileReqs = S.done
    ? [...S.reqs].sort((p, q) => (p.metA ?? 0) - (q.metA ?? 0))
    : [...S.open].sort((p, q) => (p.m ?? Infinity) - (q.m ?? Infinity));
  const cols = tileReqs.length <= 4 ? Math.max(1, tileReqs.length) : 3;
  const tileRows: (LicReq | null)[][] = [];
  for (let i = 0; i < tileReqs.length; i += cols) {
    const row: (LicReq | null)[] = tileReqs.slice(i, i + cols);
    while (row.length < cols) row.push(null);
    tileRows.push(row);
  }

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Ionicons name="ribbon-outline" size={17} color={C.primary} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: C.text }}>Next licence</Text>
        <View style={[st.seg, { backgroundColor: C.deep }]}>
          {(['chart', 'list'] as const).map((v) => {
            const on = shown === v;
            return (
              <TouchableOpacity key={v} onPress={() => { tap(); setView(v); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={v === 'chart' ? 'Show as chart' : 'Show as list'}
                style={[st.segBtn, { backgroundColor: on ? C.elevated : 'transparent' }]}>
                <Ionicons name={v === 'chart' ? 'analytics-outline' : 'list'} size={12} color={on ? C.primary : C.muted} />
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: on ? C.primary : C.muted }}>{v === 'chart' ? 'Chart' : 'List'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {IDS.map((id, i) => {
          const L2 = states[id], on = id === sel, cur = id === current && !L2.done;
          const color = L2.done ? C.success : cur ? C.gold : C.muted;
          const pct = Math.min(99, Math.floor(L2.ready * 100));
          return (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', flex: i ? 1 : 0, minWidth: 0 }}>
              {i > 0 ? <View style={{ flex: 1, minWidth: 6, height: 1.5, backgroundColor: states[IDS[i - 1]].done ? C.success + '73' : C.border }} /> : null}
              <TouchableOpacity onPress={() => { tap(); setSelId(id); setFocus(null); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={L2.done && L2.doneA != null ? `${L2.code}, complete ${mLabel(L2.doneA)}` : `${L2.code}, ${pct} percent ready`}
                style={[st.rung, {
                  borderColor: on ? color : L2.done ? C.success + '59' : cur ? C.gold + '8C' : C.border,
                  borderStyle: L2.done || cur ? 'solid' : 'dashed',
                  backgroundColor: on ? color + '1F' : 'transparent',
                }]}>
                {L2.done ? <Ionicons name="checkmark" size={11} color={color} /> : null}
                <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color }}>{L2.code}</Text>
                <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 11, fontWeight: '500', color: L2.done ? C.success + 'BF' : cur ? C.gold : C.muted }}>
                  {L2.done && L2.doneA != null ? yShort(L2.doneA) : `${pct}%`}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ gap: 3 }}>
          <Text style={[st.cap, { color: C.text2 }]}>READY</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={[st.led, { color: S.done ? C.success : C.text }]}>{readyPct}</Text>
            <Text style={[st.unit, { color: S.done ? C.success : C.primary }]}>%</Text>
          </View>
        </View>
        <View style={{ width: 1, height: 30, backgroundColor: C.border, marginBottom: 2 }} />
        <View style={{ gap: 3 }}>
          <Text style={[st.cap, { color: C.text2 }]}>MET</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[st.led, { color: C.text }]}>{S.metCount}</Text>
            <Text style={[st.unit, { color: C.text2, fontSize: 11 }]}>/{S.reqs.length}</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end', gap: 1, minWidth: 0 }}>
          <Text style={[st.cap, { color: C.text2 }]}>{etaHead}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 24, fontWeight: '600', color: etaColor }}>{etaText}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: -4 }}>
        <Text style={[st.small, { flex: 1, color: C.text2 }]}>{subLeft}</Text>
        {subRight ? <Text numberOfLines={1} style={[st.small, { color: C.text2 }]}>{subRight}</Text> : null}
      </View>

      {shown === 'chart' ? (
        datesLocked ? (
          <View style={[st.lockBox, { backgroundColor: C.deep, borderColor: C.border }]}>
            <View style={[st.lockIcon, { borderColor: C.border, backgroundColor: C.elevated }]}>
              <Ionicons name="lock-closed" size={16} color={C.gold} />
            </View>
            <Text style={{ fontFamily: SERIF, fontSize: 16, fontWeight: '600', color: C.text }}>Dates come later</Text>
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.gold, textAlign: 'center' }}>{lockWhen}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, color: C.text2, textAlign: 'center', lineHeight: 15 }}>
              A projection needs {PROJECTION_MIN_DAYS} days of history and {PROJECTION_MIN_FLIGHTS} flights. Your hours are in the list.
            </Text>
          </View>
        ) : (
          <>
            <LicenceChart C={C} S={S} nowA={nowA} startA={startA} focus={focus} />
            <View style={{ gap: 6 }}>
              {tileRows.map((row, ri) => (
                <View key={ri} style={{ flexDirection: 'row', gap: 6 }}>
                  {row.map((r, ci) => {
                    if (!r) return <View key={ci} style={{ flex: 1 }} />;
                    const on = focus === r.key, isLim = !S.done && r === S.lim;
                    const value = S.done ? `✓ ${mShort(r.metA ?? nowA)}` : r.m != null ? mShort(nowA + r.m) : '—';
                    return (
                      <TouchableOpacity key={r.key} onPress={() => { tap(); setFocus(on ? null : r.key); }}
                        accessibilityRole="button" accessibilityState={{ selected: on }}
                        accessibilityLabel={S.done ? `${r.label}, met ${mLabel(r.metA ?? nowA)}`
                          : `${r.label}, ${toGoTxt(r.toGo)} hours to go${r.m != null ? `, ${mLabel(nowA + r.m)}` : ''}`}
                        style={[st.tile, { borderColor: on ? C.primary : C.border, backgroundColor: on ? C.primary + '1F' : C.elevated }]}>
                        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, color: C.text2 }}>{r.short.toUpperCase()}</Text>
                        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: S.done ? C.success : isLim ? C.gold : C.text }}>{value}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          </>
        )
      ) : (
        <View style={{ gap: 11, paddingVertical: 2 }}>
          {S.reqs.map((r) => {
            const isLim = !S.done && !datesLocked && S.etaM != null && r === S.lim;
            const pct = Math.min(1, r.have / r.required);
            const when = r.met ? `✓ ${mShort(r.metA ?? nowA)}` : datesLocked ? `${toGoTxt(r.toGo)} h to go` : r.m != null ? mShort(nowA + r.m) : 'No pace';
            const whenColor = r.met ? C.success : datesLocked ? C.text2 : r.m == null ? C.muted : isLim ? C.gold : C.text;
            return (
              <View key={r.key} style={{ gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12, fontWeight: '600', color: C.text }}>{r.label}</Text>
                  {isLim ? (
                    <View style={{ paddingVertical: 2, paddingHorizontal: 5, borderRadius: 5, backgroundColor: C.gold + '24' }}>
                      <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, color: C.gold }}>SETS THE DATE</Text>
                    </View>
                  ) : null}
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: whenColor }}>{when}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: C.elevated, overflow: 'hidden' }}>
                    {isLim ? (
                      <LinearGradient colors={[C.primary, C.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 3 }} />
                    ) : (
                      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 3, backgroundColor: r.met ? C.success : C.primary }} />
                    )}
                  </View>
                  <Text style={{ minWidth: 74, textAlign: 'right', fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: r.met ? C.success : C.text }}>
                    {haveTxt(r.have)}<Text style={{ fontWeight: '400', color: C.muted }}>/{hoursTxt(r.required)} h</Text>
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  cap: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  small: { fontFamily: MONO, fontSize: 10 },
  led: { fontFamily: FONT_LED7, fontWeight: '800', fontSize: 22 },
  unit: { fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  seg: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 11 },
  segBtn: { minHeight: 32, paddingHorizontal: 9, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  rung: { minHeight: 32, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  tile: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 8, justifyContent: 'center', gap: 4 },
  lockBox: { height: 164 + 56, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18 },
  lockIcon: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
});
