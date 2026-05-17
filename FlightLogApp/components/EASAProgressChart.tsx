import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, TextInput, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../constants/colors';
import { useFlightStore } from '../store/flightStore';
import { useProfileStore } from '../store/profileStore';
import { getDatabase } from '../db/database';

type Requirement = { label: string; current: number; required: number };

const PPL_A: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 45 },
  { label: 'Dual instruction', key: 'dual', required: 25 },
  { label: 'Solo flight', key: 'pic', required: 10 },
  { label: 'Solo cross-country', key: 'xc_pic', required: 5 },
  { label: 'Night', key: 'night', required: 5 },
];

const PPL_H: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 45 },
  { label: 'Dual instruction', key: 'dual', required: 25 },
  { label: 'Solo flight', key: 'pic', required: 10 },
  { label: 'Solo cross-country', key: 'xc_pic', required: 5 },
];

const CPL_A: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 200 },
  { label: 'PIC', key: 'pic', required: 100 },
  { label: 'Cross-country PIC', key: 'xc_pic', required: 20 },
  { label: 'Instrument', key: 'ifr', required: 10 },
  { label: 'Night', key: 'night', required: 5 },
];

const ATPL_A: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 1500 },
  { label: 'Multi-crew ops', key: 'multi_pilot', required: 500 },
  { label: 'PIC', key: 'pic', required: 250 },
  { label: 'Cross-country', key: 'xc', required: 200 },
  { label: 'Instrument (IFR)', key: 'ifr', required: 75 },
  { label: 'Night', key: 'night', required: 100 },
];

const CPL_H: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 185 },
  { label: 'PIC', key: 'pic', required: 50 },
  { label: 'Cross-country PIC', key: 'xc_pic', required: 10 },
  { label: 'Dual instruction', key: 'dual', required: 30 },
  { label: 'Instrument (dual)', key: 'ifr', required: 10 },
  { label: 'Night', key: 'night', required: 5 },
];

const ATPL_H: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 1000 },
  { label: 'PIC', key: 'pic', required: 250 },
  { label: 'Cross-country', key: 'xc', required: 200 },
  { label: 'Instrument (IFR)', key: 'ifr', required: 30 },
  { label: 'Night', key: 'night', required: 100 },
];

// FAA Requirements
const FAA_PPL_A: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 40 },
  { label: 'Dual instruction', key: 'dual', required: 20 },
  { label: 'Solo flight', key: 'pic', required: 10 },
  { label: 'Solo cross-country', key: 'xc_pic', required: 3 },
  { label: 'Night', key: 'night', required: 3 },
];

const FAA_PPL_H: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 40 },
  { label: 'Dual instruction', key: 'dual', required: 20 },
  { label: 'Solo flight', key: 'pic', required: 10 },
  { label: 'Solo cross-country', key: 'xc_pic', required: 3 },
];

const FAA_CPL_A: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 250 },
  { label: 'PIC', key: 'pic', required: 100 },
  { label: 'Cross-country PIC', key: 'xc_pic', required: 50 },
  { label: 'Instrument', key: 'ifr', required: 20 },
];

const FAA_CPL_H: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 150 },
  { label: 'Helicopter time', key: 'pic', required: 50 },
  { label: 'Cross-country PIC', key: 'xc_pic', required: 10 },
];

const FAA_ATPL: { label: string; key: string; required: number }[] = [
  { label: 'Total flight time', key: 'total', required: 1500 },
  { label: 'Cross-country', key: 'xc', required: 500 },
  { label: 'Night', key: 'night', required: 100 },
  { label: 'Instrument (IFR)', key: 'ifr', required: 75 },
];

async function getAdaptiveRates(): Promise<Record<string, number>> {
  const db = await getDatabase();

  // Find how long the user has been logging
  const first = await db.getFirstAsync<{ d: string }>(
    `SELECT MIN(date) as d FROM flights WHERE flight_type != 'sim'`
  );
  if (!first?.d) return { _insufficient: 1 };

  const firstDate = new Date(first.d);
  const now = new Date();
  const totalMonths = Math.max(1, Math.round((now.getTime() - firstDate.getTime()) / (30.4 * 86400000)));

  // Adaptive window: <6 months → use 3mo, <12 months → use 6mo, else → use 12mo
  let windowMonths: number;
  let windowDays: number;
  if (totalMonths < 6) { windowMonths = 3; windowDays = 90; }
  else if (totalMonths < 12) { windowMonths = 6; windowDays = 183; }
  else { windowMonths = 12; windowDays = 365; }

  const r = await db.getFirstAsync<any>(
    `SELECT
      ROUND(SUM(total_time), 1) as total,
      ROUND(SUM(pic), 1) as pic,
      ROUND(SUM(co_pilot), 1) as co_pilot,
      ROUND(SUM(dual), 1) as dual,
      ROUND(SUM(ifr), 1) as ifr,
      ROUND(SUM(night), 1) as night,
      ROUND(SUM(multi_pilot), 1) as multi_pilot,
      COUNT(*) as cnt
    FROM flights WHERE flight_type != 'sim' AND date >= date('now', '-${windowDays} days')`
  );
  const xc = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 1) as h FROM flights
     WHERE flight_type != 'sim' AND dep_place != arr_place AND total_time >= 0.5
     AND date >= date('now', '-${windowDays} days')`
  );
  const xcPic = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 1) as h FROM flights
     WHERE flight_type != 'sim' AND dep_place != arr_place AND total_time >= 0.5 AND pic > 0
     AND date >= date('now', '-${windowDays} days')`
  );
  const cnt = r?.cnt ?? 0;
  if (cnt < 3) return { _insufficient: 1 };
  return {
    total: (r?.total ?? 0) / windowMonths,
    pic: (r?.pic ?? 0) / windowMonths,
    co_pilot: (r?.co_pilot ?? 0) / windowMonths,
    dual: (r?.dual ?? 0) / windowMonths,
    ifr: (r?.ifr ?? 0) / windowMonths,
    night: (r?.night ?? 0) / windowMonths,
    multi_pilot: (r?.multi_pilot ?? 0) / windowMonths,
    xc: (xc?.h ?? 0) / windowMonths,
    xc_pic: (xcPic?.h ?? 0) / windowMonths,
  };
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function forecastDate(remaining: number, ratePerMonth: number): string | null {
  if (remaining <= 0) return null;
  if (ratePerMonth <= 0) return null;
  const monthsLeft = Math.ceil(remaining / ratePerMonth);
  const d = new Date();
  d.setMonth(d.getMonth() + monthsLeft);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

async function getHourTotals(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const r = await db.getFirstAsync<any>(
    `SELECT
      ROUND(SUM(total_time), 1) as total,
      ROUND(SUM(pic), 1) as pic,
      ROUND(SUM(co_pilot), 1) as co_pilot,
      ROUND(SUM(dual), 1) as dual,
      ROUND(SUM(ifr), 1) as ifr,
      ROUND(SUM(night), 1) as night,
      ROUND(SUM(multi_pilot), 1) as multi_pilot
    FROM flights WHERE flight_type != 'sim'`
  );
  // Cross-country is approximated — flights where dep != arr and total_time > 0.5h
  const xc = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 1) as h FROM flights
     WHERE flight_type != 'sim' AND dep_place != arr_place AND total_time >= 0.5`
  );
  const xcPic = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 1) as h FROM flights
     WHERE flight_type != 'sim' AND dep_place != arr_place AND total_time >= 0.5 AND pic > 0`
  );
  return {
    total: r?.total ?? 0,
    pic: r?.pic ?? 0,
    co_pilot: r?.co_pilot ?? 0,
    dual: r?.dual ?? 0,
    ifr: r?.ifr ?? 0,
    night: r?.night ?? 0,
    multi_pilot: r?.multi_pilot ?? 0,
    xc: xc?.h ?? 0,
    xc_pic: xcPic?.h ?? 0,
  };
}

function ProgressCard({ title, subtitle, reqs, totals, rates, isCpl, standard = 'easa' }: {
  title: string; subtitle: string; reqs: { label: string; key: string; required: number }[]; totals: Record<string, number>; rates: Record<string, number>; isCpl?: boolean; standard?: 'easa' | 'faa';
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [completionDate, setCompletionDate] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const items: Requirement[] = reqs.map(r => ({
    label: r.label,
    current: totals[r.key] ?? 0,
    required: r.required,
  }));

  const allMet = items.every(i => i.current >= i.required);

  // Calculate the date when all requirements were met
  useEffect(() => {
    if (allMet && !completionDate) {
      // Get the most recent flight date that contributed to meeting all requirements
      getDatabase().then(db => {
        db.getFirstAsync<{ d: string }>(
          `SELECT MAX(date) as d FROM flights WHERE flight_type != 'sim'`
        ).then(result => {
          if (result?.d) {
            const date = new Date(result.d);
            const formatted = date.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
            setCompletionDate(formatted);
          }
        }).catch(() => {
          // Fallback to today if query fails
          const today = new Date();
          const formatted = today.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
          setCompletionDate(formatted);
        });
      });
    }
  }, [allMet]);

  if (allMet && !showDetails) {
    // Show completion state
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setShowDetails(true)}
        style={{
          backgroundColor: Colors.card, borderRadius: 14,
          borderWidth: 1, borderColor: Colors.cardBorder,
          padding: 14, gap: 10, position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Dimmed background */}
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: Colors.background + '80',
          borderRadius: 14,
        }} />

        {/* Completion message */}
        <View style={{ position: 'relative', zIndex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.gold, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>
            ✓ COMPLETED
          </Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: Colors.gold, textAlign: 'center', fontFamily: 'Georgia', marginBottom: 8 }}>
            {title.replace(' Requirements', '')} Requirements Completed
          </Text>
          <Text style={{ fontSize: 12, color: Colors.textMuted }}>
            {completionDate || 'Date'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={{
      backgroundColor: Colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
      padding: 14, gap: 10, position: 'relative',
    }}>
      <View>
        <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.gold, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {standard === 'faa' ? 'FAA' : 'EASA'} · PREMIUM
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'Georgia' }}>
            {title}
          </Text>
          {allMet && !showDetails && (
            <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.success }}>✓ COMPLETE</Text>
          )}
          {allMet && showDetails && (
            <TouchableOpacity onPress={() => setShowDetails(false)} activeOpacity={0.7}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted }}>Hide</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>{subtitle}</Text>
      </View>

      <View style={{ gap: 8 }}>
        {items.map((item, i) => {
          const pct = Math.min(100, (item.current / item.required) * 100);
          const met = item.current >= item.required;
          const remaining = item.required - item.current;
          const rate = rates[reqs[i].key] ?? 0;
          const forecast = met ? null : forecastDate(remaining, rate);
          const insufficient = rates._insufficient === 1;
          return (
            <View key={i} style={{ gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontSize: 12, color: Colors.textPrimary, fontWeight: '500' }}>{item.label}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Menlo', fontWeight: '700', color: met ? Colors.success : Colors.textPrimary }}>
                  {item.current.toFixed(0)}
                  <Text style={{ color: Colors.textMuted, fontWeight: '400' }}>/{item.required}h</Text>
                </Text>
              </View>
              <View style={{
                height: 6, backgroundColor: Colors.separator, borderRadius: 3, overflow: 'hidden',
              }}>
                <View style={{
                  height: 6, borderRadius: 3, width: `${pct}%`,
                  backgroundColor: met ? Colors.success : pct > 70 ? Colors.primary : Colors.warning,
                }} />
              </View>
              {!met && (
                <Text style={{ fontSize: 9, color: Colors.textMuted, marginTop: 1 }}>
                  {insufficient
                    ? 'Log more flights for forecast'
                    : forecast
                      ? `📅 ${forecast} · ${rate.toFixed(1)}h/mo avg`
                      : rate <= 0 ? 'No recent activity in this category' : ''}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Help button */}
      <TouchableOpacity
        style={{ position: 'absolute', top: 12, right: 12, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}
        onPress={() => setShowHelp(true)}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.textMuted }}>?</Text>
      </TouchableOpacity>

      {/* Help modal */}
      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <View style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: Colors.surface, borderRadius: 18, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.separator }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: Colors.textPrimary }}>{title}</Text>
              <TouchableOpacity onPress={() => setShowHelp(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>What this tracks</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  {isCpl
                    ? 'The minimum flight experience required for a Commercial Pilot Licence under EASA Part-FCL. Each bar shows your logged hours against the regulatory minimum. All requirements must be met before you can take the CPL skill test.'
                    : 'The minimum flight experience required for an Airline Transport Pilot Licence under EASA Part-FCL. These are the hours you need to hold an ATPL. Requirements build on top of your CPL hours — they are cumulative, not additional.'}
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Progress bar colours</Text>
                <View style={{ gap: 4, marginTop: 4 }}>
                  {[
                    { color: Colors.warning, label: 'Orange', desc: 'Less than 70% complete' },
                    { color: Colors.primary, label: 'Blue', desc: '70–99% complete — almost there' },
                    { color: Colors.success, label: 'Green', desc: '100% — requirement met' },
                  ].map((z, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: z.color }} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: z.color, width: 55 }}>{z.label}</Text>
                      <Text style={{ fontSize: 11, color: Colors.textMuted, flex: 1 }}>{z.desc}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Why are my hours lower than expected?</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  There are several common reasons your progress bars may show less than you expect:
                </Text>
                <View style={{ gap: 6, marginTop: 4 }}>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                    <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>Simulator time excluded — </Text>
                    Only actual flight time counts. FFS/FSTD sessions are tracked separately and do not add to these totals.
                  </Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                    <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>PIC vs Dual — </Text>
                    Time logged as Dual (student) does not count towards PIC requirements. Only time where you were the acting pilot-in-command counts as PIC.
                  </Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                    <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>Cross-country approximation — </Text>
                    Cross-country hours are estimated from flights where departure and arrival are different airports and the flight is at least 30 minutes. Short repositioning flights or flights where you forgot to log a different arrival may not count.
                  </Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                    <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>Imported data — </Text>
                    If you imported flights from CSV or scanned them, some role fields (PIC, Dual, IFR) may not have been correctly mapped. Check individual flights under the logbook tab.
                  </Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                    <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>Multi-crew time — </Text>
                    For ATPL, multi-crew hours require that the flight was operated with two pilots. This is only counted if multi-pilot time was logged on the flight.
                  </Text>
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>Regulatory reference</Text>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                  {subtitle}. These are minimum requirements — your national authority may have additional requirements. Always verify with your flight school or examiner before applying for a skill test.
                </Text>
              </View>

            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LockedOverlay() {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: Colors.background + '55',
        borderRadius: 14, zIndex: 10,
        alignItems: 'center', justifyContent: 'center', gap: 8,
      }}
      activeOpacity={0.9}
      onPress={() => router.push('/settings/premium')}
    >
      <Ionicons name="lock-closed" size={22} color={Colors.gold} />
      <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.gold, textAlign: 'center' }}>
        EASA Progress Tracking
      </Text>
      <Text style={{ fontSize: 12, color: Colors.textPrimary, textAlign: 'center', paddingHorizontal: 24 }}>
        Unlock with Premium to track your CPL/ATPL requirements live
      </Text>
    </TouchableOpacity>
  );
}

export function EASAProgressCharts({ standard = 'easa' }: { standard?: 'easa' | 'faa' }) {
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const flightCount = useFlightStore(s => s.flightCount);
  const isPremium = useFlightStore(s => s.isPremium);
  const profile = useProfileStore(s => s.profile);
  const cardWidth = Dimensions.get('window').width - 24;

  useEffect(() => {
    getHourTotals().then(setTotals);
    getAdaptiveRates().then(setRates);
  }, [flightCount]);

  if (!profile || profile.mainRole !== 'pilot-manned') return null;

  const isRotary = profile.subRole === 'rotary';

  let pplReqs, cplReqs, atplReqs, suffix, pplRef, cplRef, atplRef, pplTitle, cplTitle, atplTitle;

  if (standard === 'faa') {
    pplReqs = isRotary ? FAA_PPL_H : FAA_PPL_A;
    cplReqs = isRotary ? FAA_CPL_H : FAA_CPL_A;
    atplReqs = FAA_ATPL;
    suffix = isRotary ? '(H)' : '';
    pplRef = 'FAA Private Pilot';
    cplRef = 'FAA Commercial Pilot';
    atplRef = 'FAA Airline Transport Pilot';
    pplTitle = `PPL${suffix} Requirements`;
    cplTitle = `CPL${suffix} Requirements`;
    atplTitle = 'ATPL Requirements';
  } else {
    pplReqs = isRotary ? PPL_H : PPL_A;
    cplReqs = isRotary ? CPL_H : CPL_A;
    atplReqs = isRotary ? ATPL_H : ATPL_A;
    suffix = isRotary ? '(H)' : '(A)';
    pplRef = isRotary ? 'FCL.210.H' : 'FCL.210.A';
    cplRef = isRotary ? 'FCL.310.H' : 'FCL.310.A';
    atplRef = isRotary ? 'FCL.510.H' : 'FCL.510.A';
    pplTitle = `PPL${suffix} Requirements`;
    cplTitle = `CPL${suffix} Requirements`;
    atplTitle = `ATPL${suffix} Requirements`;
  }

  const displayTotals = isPremium ? totals : {};

  const cards = [
    { title: pplTitle, subtitle: `${pplRef} — Minimum flight experience`, reqs: pplReqs, isCpl: true },
    { title: cplTitle, subtitle: `${cplRef} — Minimum flight experience`, reqs: cplReqs, isCpl: true },
    { title: atplTitle, subtitle: `${atplRef} — Minimum flight experience`, reqs: atplReqs, isCpl: false },
  ];

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={true}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
          setActiveIdx(idx);
        }}
        decelerationRate="fast"
        snapToInterval={cardWidth}
      >
        {cards.map((card, i) => (
          <View key={i} style={{ width: cardWidth, position: 'relative' }}>
            <View style={!isPremium ? { opacity: 0.25 } : undefined}>
              <ProgressCard
                title={card.title}
                subtitle={card.subtitle}
                reqs={card.reqs}
                totals={displayTotals}
                rates={isPremium ? rates : {}}
                isCpl={card.isCpl}
                standard={standard}
              />
            </View>
            {!isPremium && <LockedOverlay />}
          </View>
        ))}
      </ScrollView>
      {/* Page dots */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {cards.map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => {
              scrollRef.current?.scrollTo({ x: i * cardWidth, animated: true });
              setActiveIdx(i);
            }}
            activeOpacity={0.7}
            style={{ padding: 4 }}
          >
            <View style={{
              width: activeIdx === i ? 16 : 6, height: 6, borderRadius: 3,
              backgroundColor: activeIdx === i ? Colors.primary : Colors.separator,
            }} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Goal Calculator ─────────────────────────────────────────────────────────

function getGoalPresets(currentTotal: number): { label: string; value: number }[] {
  const base = Math.floor(currentTotal / 500) * 500;
  const next1 = base + 500;
  const next2 = base + 1000;
  return [
    { label: `${next1.toLocaleString()}h`, value: next1 },
    { label: `${next2.toLocaleString()}h`, value: next2 },
  ];
}

export function GoalCalculator() {
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const [goal, setGoal] = useState(0);
  const [showCustom, setShowCustom] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [sliderRate, setSliderRate] = useState(0);
  const flightCount = useFlightStore(s => s.flightCount);
  const isPremium = useFlightStore(s => s.isPremium);
  const profile = useProfileStore(s => s.profile);

  useEffect(() => {
    getHourTotals().then(t => {
      setTotals(t);
      if (goal === 0) {
        const presets = getGoalPresets(t.total ?? 0);
        setGoal(presets[0].value);
      }
      getAdaptiveRates().then(r => {
        setRates(r);
        if (r.total && r.total > 0 && sliderRate === 0) setSliderRate(Math.round(r.total / 5) * 5 || 5);
      });
    });
  }, [flightCount]);

  if (!profile || profile.mainRole !== 'pilot-manned') return null;

  const currentTotal = totals.total ?? 0;
  const actualRate = rates.total ?? 0;
  const useRate = sliderRate || actualRate || 5;
  const remaining = Math.max(0, goal - currentTotal);
  const monthsLeft = useRate > 0 ? Math.ceil(remaining / useRate) : 0;
  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + monthsLeft);
  const targetDateStr = remaining <= 0 ? 'Goal reached!' : `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  const pct = Math.min(100, (currentTotal / goal) * 100);

  // Simple progress visualization
  const barSegments = 20;
  const filledSegments = Math.round((pct / 100) * barSegments);

  return (
    <View style={{
      backgroundColor: Colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
      padding: 14, gap: 8, position: 'relative',
    }}>
      <View>
        <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.textPrimary, fontFamily: 'Georgia' }}>
          When will I reach {goal.toLocaleString()}h?
        </Text>
      </View>

      {/* Goal presets */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {getGoalPresets(currentTotal).map(p => (
          <TouchableOpacity
            key={p.value}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
              backgroundColor: goal === p.value && !showCustom ? Colors.primary : Colors.elevated,
              borderWidth: 1, borderColor: goal === p.value && !showCustom ? Colors.primary : Colors.border,
            }}
            onPress={() => { setGoal(p.value); setShowCustom(false); }}
            activeOpacity={0.75}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: goal === p.value && !showCustom ? Colors.textInverse : Colors.textSecondary }}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={{
            flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
            backgroundColor: showCustom ? Colors.primary : Colors.elevated,
            borderWidth: 1, borderColor: showCustom ? Colors.primary : Colors.border,
          }}
          onPress={() => setShowCustom(true)}
          activeOpacity={0.75}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: showCustom ? Colors.textInverse : Colors.textSecondary }}>
            Custom
          </Text>
        </TouchableOpacity>
      </View>
      {showCustom && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center',
            backgroundColor: Colors.elevated, borderRadius: 8,
            borderWidth: 1, borderColor: Colors.border,
            paddingHorizontal: 10,
          }}>
            <Text style={{ color: Colors.textMuted, fontSize: 13 }}>Goal: </Text>
            <TextInput
              style={{ flex: 1, color: Colors.textPrimary, fontSize: 14, fontFamily: 'Menlo', fontWeight: '700', paddingVertical: 8 }}
              value={customInput}
              onChangeText={setCustomInput}
              placeholder="e.g. 3000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
            />
            <Text style={{ color: Colors.textMuted, fontSize: 13 }}>h</Text>
          </View>
          <TouchableOpacity
            style={{ backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}
            onPress={() => {
              const v = parseInt(customInput);
              if (v && v > currentTotal) { setGoal(v); }
            }}
            activeOpacity={0.75}
          >
            <Text style={{ color: Colors.textInverse, fontSize: 12, fontWeight: '700' }}>Set</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Progress bar */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontSize: 11, fontFamily: 'Menlo', fontWeight: '700', color: Colors.textPrimary }}>
            {currentTotal.toFixed(0)}h
          </Text>
          <Text style={{ fontSize: 11, fontFamily: 'Menlo', color: Colors.textMuted }}>
            {goal.toLocaleString()}h
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {Array.from({ length: barSegments }, (_, i) => (
            <View key={i} style={{
              flex: 1, height: 8, borderRadius: 2,
              backgroundColor: i < filledSegments ? Colors.primary : Colors.separator,
            }} />
          ))}
        </View>
        <Text style={{ fontSize: 10, color: Colors.textMuted, textAlign: 'center' }}>
          {pct.toFixed(0)}% complete · {remaining.toFixed(0)}h remaining
        </Text>
      </View>

      {/* Target date */}
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: Colors.gold, fontFamily: 'Georgia' }}>
          {targetDateStr}
        </Text>
        {remaining > 0 && (
          <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
            {monthsLeft} months · {(monthsLeft / 12).toFixed(1)} years at {useRate}h/mo
          </Text>
        )}
      </View>
    </View>
  );
}
