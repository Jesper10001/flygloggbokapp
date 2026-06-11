// Wrapped chapters — RN port of the prototype chapters.jsx. Each chapter is a
// component receiving { active, accent, data }. `active` gates entrance anims.
// getChapters(data) returns the conditional, ordered list with per-chapter durs.

import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  WC, SERIF, MONO, fmtInt, Rise, useReveal,
  Eyebrow, HeroNum, ChapterTitle, ChapterSub, StatTrio, ChapterBG,
} from './WrappedKit';
import {
  WMonthlyBars, WRoleSplit, WSplitMeter, WTypeBreakdown, WEasaBars,
  WTopAirports, WBottomFive, WCurrencyRing, WGlobeOrbit, WWeekBars,
} from './visuals';
import type { WrappedData } from './wrappedData';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { GlobalAirportMap } from '../GlobalAirportMap';
import type { RouteLeg } from '../milestones/MiniRouteMap';
import { useLongestXcLegs, useBestWeekDetails } from '../../hooks/useMilestoneDetails';

export interface ChapterProps { active: boolean; accent: string; data: WrappedData }

function WChapter({ accent, children, justify = 'center', gap = 18 }: {
  accent: string; children: React.ReactNode; justify?: 'center' | 'flex-start'; gap?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <ChapterBG accent={accent} />
      {/* paddingTop rensar progress-staplar + den större loggan (responsivt mot notch) */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: 28, paddingTop: insets.top + 104, paddingBottom: 40, justifyContent: justify, gap }}>
        {children}
      </View>
    </View>
  );
}

const em = (accent: string) => ({ fontStyle: 'italic' as const, color: accent });

// 1 ── Cover ──
function WCover({ active, accent, data }: ChapterProps) {
  const r1 = useReveal(active, 150), r2 = useReveal(active, 450), r3 = useReveal(active, 900);
  const name = data.firstName?.trim();
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>BLADES · Logbook Wrapped</Eyebrow>
      <Rise show={r1}>
        <ChapterTitle>Every hour{'\n'}you've flown{name ? <Text>, <Text style={em(accent)}>{name}</Text></Text> : null}.</ChapterTitle>
      </Rise>
      <Rise show={r2}>
        <ChapterSub>{fmtInt(data.stats.total_flights)} flights. {data.visitedCount} airports. Your whole logbook, read back to you.</ChapterSub>
      </Rise>
      <Rise show={r3} style={{ marginTop: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.4, color: WC.muted }}>TAP TO BEGIN ›</Text>
      </Rise>
    </WChapter>
  );
}

// 2 ── Totals + globe ──
function WTotals({ active, accent, data }: ChapterProps) {
  const r = useReveal(active, 300);
  const days = Math.round((data.stats.total_time || 0) / 24);
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>Total time aloft</Eyebrow>
      <HeroNum value={fmtInt(data.stats.total_time)} unit="HOURS" accent={accent} />
      <Rise show={r} delay={100}>
        <ChapterSub>That's {fmtInt(days)} full days in command of an aircraft.</ChapterSub>
      </Rise>
      <StatTrio show={r} delay={350} accent={accent} items={[
        { value: `${Math.round(data.stats.year_to_date)} h`, label: 'This year' },
        { value: `${Math.round(data.stats.last_12_months)} h`, label: 'Last 12 mo' },
        { value: fmtInt(data.stats.total_flights), label: 'Flights' },
      ]} />
      <Rise show={useReveal(active, 700)} style={{ alignSelf: 'stretch', marginTop: 4 }}>
        <WGlobeOrbit accent={accent} active={active} laps={data.laps} km={data.distanceKm} />
      </Rise>
    </WChapter>
  );
}

// 3 ── Monthly ──
function WMonthly({ active, accent, data }: ChapterProps) {
  const bm = data.bestMonth;
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>Over the last 12 months</Eyebrow>
      <Rise show={useReveal(active, 150)}>
        <ChapterTitle>You flew most in <Text style={em(accent)}>{bm?.label ?? '—'}</Text>.</ChapterTitle>
      </Rise>
      <Rise show={useReveal(active, 350)}>
        <ChapterSub>{bm?.h ?? 0} hours in a single month — your busiest stretch of the year.</ChapterSub>
      </Rise>
      <View style={{ marginTop: 28 }}><WMonthlyBars accent={accent} active={active} data={data.monthly} /></View>
    </WChapter>
  );
}

// 4 ── World map (full-bleed native) ──
function WMap({ active, accent, data }: ChapterProps) {
  const r1 = useReveal(active, 200);
  const r2 = useReveal(active, 420);
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: WC.bgDeep }]} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '66%' }}>
        <GlobalAirportMap airports={data.mapSeed} initialRegion={data.mapRegion ?? undefined} interactive={false} />
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' }} pointerEvents="none">
        <LinearGradient colors={[WC.bgDeep + '00', WC.bgDeep]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.7 }} style={StyleSheet.absoluteFill} />
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 28, paddingBottom: 40, gap: 12 }}>
        <Eyebrow accent={accent} show={active}>Your network</Eyebrow>
        <Rise show={r1}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 14 }}>
            <HeroNum value={String(data.visitedCount)} accent={accent} />
            <Text style={{ fontFamily: SERIF, fontSize: 22, color: WC.text2 }}>airports</Text>
          </View>
        </Rise>
        <Rise show={r2}>
          <ChapterSub>Across {data.countriesCount} countries — every one flown from {data.home?.name ?? data.home?.icao ?? 'home'}.</ChapterSub>
        </Rise>
      </View>
    </View>
  );
}

// 5 ── Top-10 + bottom-5 airports ──
function WTopAirportsChapter({ active, accent, data }: ChapterProps) {
  return (
    <WChapter accent={accent} justify="flex-start" gap={12}>
      <Eyebrow accent={accent} show={active}>Most-visited airports</Eyebrow>
      <Rise show={useReveal(active, 120)}><ChapterTitle>Your top ten.</ChapterTitle></Rise>
      <View style={{ marginTop: 2 }}><WTopAirports accent={accent} active={active} rows={data.topAirports} /></View>
      {data.bottomAirports.length > 1 ? (
        <View style={{ alignSelf: 'stretch', marginTop: 2 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.8, color: WC.muted, textTransform: 'uppercase', marginBottom: 8 }}>Least visited</Text>
          <WBottomFive active={active} rows={data.bottomAirports} />
        </View>
      ) : null}
    </WChapter>
  );
}

// 6 ── Reach ──
function WReach({ active, accent, data }: ChapterProps) {
  const r0 = useReveal(active, 120);
  const r = useReveal(active, 300);
  const r2 = useReveal(active, 700);
  const re = data.reach;
  if (!re) return <WChapter accent={accent}><Eyebrow accent={accent} show={active}>How far it reaches</Eyebrow></WChapter>;
  const extremes = [
    { k: 'NORTHERNMOST', v: re.north.icao, c: re.north.name },
    { k: 'SOUTHERNMOST', v: re.south.icao, c: re.south.name },
    { k: 'WESTERNMOST', v: re.west.icao, c: re.west.name },
    { k: 'EASTERNMOST', v: re.east.icao, c: re.east.name },
  ];
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>How far it reaches</Eyebrow>
      <Rise show={r0}>
        <ChapterTitle>{data.countriesCount} countries,{'\n'}corner to corner.</ChapterTitle>
      </Rise>
      <Rise show={r} delay={100}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 }}>
          {extremes.map((e) => (
            <View key={e.k} style={{ width: '47%', gap: 4, paddingVertical: 14, borderTopWidth: 1, borderTopColor: WC.border }}>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: WC.muted }}>{e.k}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 20, fontWeight: '700', color: accent }}>{e.v}</Text>
              <Text style={{ fontSize: 12, color: WC.text3 }} numberOfLines={1}>{e.c}</Text>
            </View>
          ))}
        </View>
      </Rise>
      <Rise show={r2}>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: WC.text3 }}>{fmtInt(re.spanKm)} km between the two furthest fields you've touched.</Text>
      </Rise>
    </WChapter>
  );
}

// 7 ── Aircraft ──
function WAircraft({ active, accent, data }: ChapterProps) {
  const r = useReveal(active, 250);
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>What you flew</Eyebrow>
      <Rise show={useReveal(active, 120)}>
        <ChapterTitle>{data.aircraftTypes} types. <Text style={em(accent)}>{data.registrations}</Text> tails.</ChapterTitle>
      </Rise>
      {data.topType ? (
        <Rise show={r}>
          <ChapterSub>But one machine defined it: the <Text style={{ color: WC.text, fontWeight: '600' }}>{data.topType.type}</Text>, {fmtInt(data.topType.hours)} hours of it.</ChapterSub>
        </Rise>
      ) : null}
      <View style={{ marginTop: 8 }}><WTypeBreakdown accent={accent} active={active} rows={data.typeBreakdown} /></View>
    </WChapter>
  );
}

// 8 ── Roles ──
function WRoles({ active, accent, data }: ChapterProps) {
  const roles = [
    { label: 'PIC', h: Math.round(data.stats.total_pic) },
    { label: 'CO-PILOT', h: Math.round(data.stats.total_co_pilot) },
    { label: 'DUAL', h: Math.round(data.stats.total_dual) },
  ].filter((r) => r.h > 0);
  const total = roles.reduce((s, r) => s + r.h, 0) || 1;
  const picPct = Math.round(((roles[0]?.h ?? 0) / total) * 100);
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>In which seat</Eyebrow>
      <Rise show={useReveal(active, 120)}>
        <ChapterTitle><Text style={em(accent)}>{picPct}%</Text> of it as pilot in command.</ChapterTitle>
      </Rise>
      <View style={{ marginTop: 10 }}><WRoleSplit accent={accent} active={active} roles={roles} /></View>
    </WChapter>
  );
}

// 9 ── Day / night + IFR / VFR ──
function WDayNight({ active, accent, data }: ChapterProps) {
  const s = data.stats;
  const dayH = Math.max(0, Math.round((s.total_time || 0) - (s.total_night || 0)));
  const nightH = Math.round(s.total_night || 0);
  const ifrH = Math.round(s.total_ifr || 0);
  // VFR = all icke-IFR-tid (appens total_vfr-fält loggas sällan explicit).
  const vfrH = Math.max(0, Math.round((s.total_time || 0) - (s.total_ifr || 0)));
  const landings = (s.total_landings_day || 0) + (s.total_landings_night || 0);
  const ifrPct = ifrH + vfrH > 0 ? Math.round((ifrH / (ifrH + vfrH)) * 100) : 0;
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>Light & rules</Eyebrow>
      <Rise show={useReveal(active, 120)}>
        <ChapterTitle>{fmtInt(nightH)} hours flown <Text style={em(accent)}>after dark</Text>.</ChapterTitle>
      </Rise>
      <View style={{ marginTop: 28, gap: 22 }}>
        <WSplitMeter accent={accent} active={active} label="Day vs Night" a={dayH} b={nightH} aLabel="Day" bLabel="Night" delay={150} />
        <WSplitMeter accent={accent} active={active} label="IFR vs VFR" a={ifrH} b={vfrH} aLabel="IFR" bLabel="VFR" delay={350} />
      </View>
      <StatTrio show={useReveal(active, 600)} accent={accent} items={[
        { value: fmtInt(landings), label: 'Landings' },
        { value: fmtInt(s.total_landings_night || 0), label: 'At night' },
        { value: `${ifrPct}%`, label: 'On instruments' },
      ]} />
    </WChapter>
  );
}

// Longest XC route on a native Apple map with a glowing line between airports.
function LongestRouteMap({ legs, accent }: { legs: RouteLeg[]; accent: string }) {
  if (legs.length < 2) return null;
  const lats = legs.map((l) => l.lat), lons = legs.map((l) => l.lon);
  const latMin = Math.min(...lats), latMax = Math.max(...lats), lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const region = {
    latitude: (latMin + latMax) / 2, longitude: (lonMin + lonMax) / 2,
    latitudeDelta: Math.max((latMax - latMin) * 1.7, 1.5),
    longitudeDelta: Math.max((lonMax - lonMin) * 1.7, 1.5),
  };
  const coords = legs.map((l) => ({ latitude: l.lat, longitude: l.lon }));
  return (
    <View style={{ height: 280, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: WC.border }}>
      <MapView
        style={{ flex: 1 }} initialRegion={region} userInterfaceStyle="dark"
        scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
        showsPointsOfInterest={false} showsCompass={false} toolbarEnabled={false}
      >
        {/* glödande streck — bred svag underläggare + tunn skarp linje */}
        <Polyline coordinates={coords} strokeColor={accent + '22'} strokeWidth={14} />
        <Polyline coordinates={coords} strokeColor={accent + '55'} strokeWidth={7} />
        <Polyline coordinates={coords} strokeColor={accent} strokeWidth={3} />
        {legs.map((l, i) => (
          <Marker key={`${l.icao}-${i}`} coordinate={{ latitude: l.lat, longitude: l.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ backgroundColor: WC.bgDeep + 'E6', borderColor: accent, borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, marginBottom: 3 }}>
                <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: WC.text }}>{l.icao}</Text>
              </View>
              <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: accent, borderWidth: 1.5, borderColor: '#FFFFFF' }} />
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

// 10 ── Longest XC ──
function WLongest({ active, accent, data }: ChapterProps) {
  const s = data.stats;
  const legs = useLongestXcLegs(s.longest_xc_date || undefined);
  const nm = Math.round((s.longest_xc_km || 0)); // field stores NM despite the name
  const dur = s.longest_xc_hours ? `${Math.floor(s.longest_xc_hours)}h ${Math.round((s.longest_xc_hours % 1) * 60)}m` : '';
  const dateStr = (s.longest_xc_date || '').toUpperCase();
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>Your longest flight</Eyebrow>
      <Rise show={useReveal(active, 120)}><HeroNum value={fmtInt(nm)} unit="NM" accent={accent} /></Rise>
      <Rise show={useReveal(active, 280)}>
        <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: WC.text3, letterSpacing: 0.8 }}>
          {s.longest_xc_first_dep} → {s.longest_xc_last_arr}{dur ? ` · ${dur}` : ''}{dateStr ? ` · ${dateStr}` : ''}
        </Text>
      </Rise>
      <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
        <LongestRouteMap legs={legs} accent={accent} />
      </View>
    </WChapter>
  );
}

// 11 ── Best week ──
function WBestWeek({ active, accent, data }: ChapterProps) {
  const s = data.stats;
  const details = useBestWeekDetails(s.best_week_start || undefined);
  const label = s.best_week_label || '';
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>Your busiest week</Eyebrow>
      <Rise show={useReveal(active, 120)}><HeroNum value={fmtHM(s.best_week_hours || 0)} accent={accent} /></Rise>
      <Rise show={useReveal(active, 280)}>
        <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: WC.text3, letterSpacing: 0.8 }}>
          {label}{details.sectors ? ` · ${details.sectors} SECTORS` : ''}{details.airports ? ` · ${details.airports} AIRPORTS` : ''}
        </Text>
      </Rise>
      <View style={{ marginTop: 14 }}>
        {details.days.length ? <WWeekBars accent={accent} active={active} days={details.days} /> : null}
      </View>
    </WChapter>
  );
}

// 12 ── Currency ──
function WCurrency({ active, accent, data }: ChapterProps) {
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>Your current rhythm</Eyebrow>
      <Rise show={useReveal(active, 150)} style={{ alignSelf: 'center' }}>
        <WCurrencyRing accent={accent} active={active} recent14={data.recent14} yearAvg14={data.yearAvg14} />
      </Rise>
      <Rise show={useReveal(active, 500)} style={{ alignSelf: 'center' }}>
        <Text style={{ fontSize: 16, lineHeight: 24, color: WC.text2, textAlign: 'center', maxWidth: 320 }}>
          The last 14 days against your own baseline.
        </Text>
      </Rise>
    </WChapter>
  );
}

// 13 ── Adaptive licence (rätt kategori H/A + regelverk; beräknad i wrappedData) ──
function WEasa({ active, accent, data }: ChapterProps) {
  const lic = data.licence;
  const r0 = useReveal(active, 120);
  const r1 = useReveal(active, 300);
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>The road to your licence</Eyebrow>
      <Rise show={r0}>
        <ChapterTitle>
          {lic.allMet
            ? <Text>Every <Text style={em(accent)}>{lic.code}</Text> hour requirement — met.</Text>
            : <Text>On your way to <Text style={em(accent)}>{lic.code}</Text>.</Text>}
        </ChapterTitle>
      </Rise>
      {!lic.allMet ? (
        <Rise show={r1}>
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: WC.text3, letterSpacing: 0.8 }}>
            {lic.progress}% THERE · {lic.metCount}/{lic.bars.length} REQUIREMENTS MET
          </Text>
        </Rise>
      ) : null}
      <View style={{ marginTop: 12 }}><WEasaBars accent={accent} active={active} bars={lic.bars} /></View>
    </WChapter>
  );
}

// 14 ── Outro ──
function WOutro({ active, accent }: ChapterProps) {
  const r = useReveal(active, 300);
  const features = [
    'Currency & flight-load, always live',
    'EASA-ready PDF & CSV export',
    'Scan paper logs — OCR does the typing',
    'Best week, longest XC, milestones — automatic',
  ];
  return (
    <WChapter accent={accent}>
      <Eyebrow accent={accent} show={active}>This is just the beginning</Eyebrow>
      <Rise show={useReveal(active, 120)}>
        <ChapterTitle>Every flight you log{'\n'}sharpens the <Text style={em(accent)}>picture</Text>.</ChapterTitle>
      </Rise>
      <Rise show={r}>
        <View style={{ gap: 11, marginTop: 6 }}>
          {features.map((f, i) => (
            <Rise key={i} show={r} delay={i * 90}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: accent + '22', borderWidth: 1, borderColor: accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: accent, fontSize: 10, fontWeight: '900' }}>✓</Text>
                </View>
                <Text style={{ fontSize: 14, color: WC.text2 }}>{f}</Text>
              </View>
            </Rise>
          ))}
        </View>
      </Rise>
    </WChapter>
  );
}

function fmtHM(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

export interface ChapterDef { key: string; dur: number; Comp: (p: ChapterProps) => React.ReactElement }

export function getChapters(data: WrappedData): ChapterDef[] {
  const all: (ChapterDef & { show: boolean })[] = [
    { key: 'cover', dur: 4500, Comp: WCover, show: true },
    { key: 'totals', dur: 5200, Comp: WTotals, show: data.has },
    { key: 'monthly', dur: 5500, Comp: WMonthly, show: data.hasMonthly },
    { key: 'map', dur: 6800, Comp: WMap, show: data.hasVisited && data.mapSeed.length > 0 },
    { key: 'airports', dur: 6200, Comp: WTopAirportsChapter, show: data.topAirports.length > 0 },
    { key: 'reach', dur: 5500, Comp: WReach, show: !!data.reach },
    { key: 'aircraft', dur: 5800, Comp: WAircraft, show: data.registrations >= 2 },
    { key: 'roles', dur: 5200, Comp: WRoles, show: data.has },
    { key: 'daynight', dur: 5800, Comp: WDayNight, show: data.has },
    { key: 'longest', dur: 6000, Comp: WLongest, show: data.hasLongest },
    { key: 'bestweek', dur: 5500, Comp: WBestWeek, show: data.hasBestWeek },
    { key: 'currency', dur: 5200, Comp: WCurrency, show: data.hasRecent },
    { key: 'easa', dur: 6000, Comp: WEasa, show: true },
    { key: 'outro', dur: 7000, Comp: WOutro, show: true },
  ];
  return all.filter((c) => c.show).map(({ key, dur, Comp }) => ({ key, dur, Comp }));
}
