// Mottagarens väg in för en flygning som delats av ens second pilot (services/flightShare). Hit kommer man via
// länken blades://shared-flight?d=… (AirDrop öppnar den) eller via "Open a shared flight" under Import (filen
// ligger då i sharedFlightStore.pending).
//  - Pilotläget och en läsbar flygning: inget visas (skärmen är genomskinlig). Flygningen förbereds med omvända
//    roller, flygplanet jämförs med Fleet och dubbletter letas upp, och sedan öppnas Log flight direkt
//    (/flight/add?shared=1), som frågar efter flygplanet om det inte stämmer. Ingenting sparas här.
//  - Drönarläget: sammanfattningen visas med en uppmaning att byta loggbok.
//  - Går flygningen inte att läsa: skälet visas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { FONT_SERIF, FONT_MONO } from '../components/logbook-page/tokens';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { useAppModeStore } from '../store/appModeStore';
import { useSharedFlightStore } from '../store/sharedFlightStore';
import { getFleetRegistrationTypes, getSecondPilotCounts, flightExists } from '../db/flights';
import {
  decodeSharedFlight, reverseRoles, toFormValues, matchAircraft, pickSecondPilotName,
  type DecodeResult, type FleetRow,
} from '../services/flightShare';

const PROBLEM: Record<string, string> = {
  empty: 'This doesn’t look like a flight shared from Blades.',
  unreadable: 'This doesn’t look like a flight shared from Blades.',
  'not-a-flight': 'This doesn’t look like a flight shared from Blades.',
  newer: 'This flight was shared from a newer version of Blades. Update the app to open it.',
  incomplete: 'The shared flight is missing its date, route or flight time, so it can’t be opened.',
};

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function SharedFlightScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { d, problem } = useLocalSearchParams<{ d?: string; problem?: string }>();
  const { formatTime } = useTimeFormat();
  const mode = useAppModeStore((st) => st.mode);
  const pending = useSharedFlightStore((st) => st.pending);

  // Länkens d-värde går före; annars paketet som lästes ur en fil.
  const result: DecodeResult = useMemo(() => {
    // En fil som inte gick att läsa (Import → Open a shared flight) kommer hit med skälet.
    if (typeof problem === 'string' && problem in PROBLEM) return { ok: false, reason: problem as any };
    if (typeof d === 'string' && d) return decodeSharedFlight(d);
    if (pending) return { ok: true, payload: pending };
    return { ok: false, reason: 'empty' };
  }, [d, problem, pending]);
  const payload = result.ok ? result.payload : null;
  const rev = useMemo(() => (payload ? reverseRoles(payload) : null), [payload]);

  const [known, setKnown] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const isDrone = mode === 'drone';

  // Drönarläget visar sammanfattningen: namn och dubblettvarning till den.
  useEffect(() => {
    if (!payload || !isDrone) return;
    getSecondPilotCounts().then((rows) => setKnown(rows.map((r) => r.name))).catch(() => {});
    const f = payload.f;
    flightExists(f.date, f.dep_place, f.arr_place, f.dep_utc, f.arr_utc).then(setDuplicate).catch(() => {});
  }, [payload, isDrone]);

  // Paketet ur en fil är förbrukat när skärmen lämnas.
  useEffect(() => () => { useSharedFlightStore.getState().setPending(null); }, []);

  const close = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)' as any); };

  const senderName = payload?.from.name || payload?.from.initials || '';
  const secondName = payload ? pickSecondPilotName(payload.from, known) : '';

  // Pilotläget: förbered och öppna Log flight direkt (en gång). Den här skärmen stängs först och Log flight
  // öppnas strax efter: två skärmbyten i samma ögonblick kan hänga sig.
  const started = useRef(false);
  useEffect(() => {
    if (!payload || !rev || isDrone || started.current) return;
    started.current = true;
    const f = payload.f;
    Promise.all([
      getFleetRegistrationTypes().catch(() => [] as FleetRow[]),
      getSecondPilotCounts().then((rows) => rows.map((r) => r.name)).catch(() => [] as string[]),
      flightExists(f.date, f.dep_place, f.arr_place, f.dep_utc, f.arr_utc).catch(() => false),
    ]).then(([fleetRows, knownNames, dup]) => {
      const sender = payload.from.name || payload.from.initials || '';
      const second = pickSecondPilotName(payload.from, knownNames);
      const m = matchAircraft({ type: f.aircraft_type, registration: f.registration }, fleetRows);
      const aircraft = m.kind === 'exact' ? { type: m.type, registration: m.registration } : { type: '', registration: '' };
      let extras: { role: string; name: string }[] = [];
      try { extras = f.extra_pilots ? JSON.parse(f.extra_pilots) : []; } catch { extras = []; }
      useSharedFlightStore.getState().setPrepared({
        fromName: sender,
        form: toFormValues(payload, rev, second, aircraft),
        role: rev.role,
        fi: rev.fi,
        extraPilots: extras,
        multiPilot: f.multi_pilot > 0 || rev.role !== 'pic' || !!second,
        duplicate: !!dup,
        aircraftAsk: m.kind === 'exact' ? null : {
          who: sender ? sender.split(' ')[0] : 'The sender',
          sent: [f.aircraft_type, f.registration].filter(Boolean).join(' · ') || 'no aircraft',
          options: m.options,
        },
      });
      close();
      setTimeout(() => router.push('/flight/add?shared=1' as any), 380);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, rev, isDrone]);

  const header = (
    <View style={[st.head, { paddingTop: insets.top + 10 }]}>
      <View style={st.avatar}>
        <Ionicons name="airplane-outline" size={20} color={Colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.eyebrow}>SHARED FLIGHT</Text>
        <Text style={st.h1} numberOfLines={1}>{senderName ? `From ${senderName}` : 'From another pilot'}</Text>
      </View>
      <TouchableOpacity onPress={close} accessibilityLabel="Close" style={st.closeBtn} hitSlop={8}>
        <Ionicons name="close" size={22} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  if (!payload || !rev) {
    return (
      <View style={st.root}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <View style={st.problem}>
          <Ionicons name="alert-circle-outline" size={34} color={Colors.warning} />
          <Text style={st.problemText}>{PROBLEM[result.ok ? 'empty' : result.reason]}</Text>
        </View>
        <View style={[st.foot, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={st.cta} onPress={close} activeOpacity={0.85}><Text style={st.ctaText}>Close</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  // Pilotläget: inget att visa, Log flight öppnas direkt (effekten ovan).
  if (!isDrone) return <View style={{ flex: 1 }} pointerEvents="none" />;

  const f = payload.f;
  const who = senderName ? senderName.split(' ')[0] : 'The sender';
  const hours = (n: number) => formatTime(n);
  const same: [string, string][] = [
    ['Departure and arrival', `${f.dep_utc || '—'}z · ${f.arr_utc || '—'}z`],
    ['Aircraft', [f.aircraft_type, f.registration].filter(Boolean).join(' · ') || '—'],
    ['Flight rules', f.ifr > 0 && f.vfr > 0 ? `IFR ${hours(f.ifr)} · VFR ${hours(f.vfr)}` : f.ifr > 0 ? `IFR ${hours(f.ifr)}` : 'VFR'],
    ['Night', hours(f.night)],
    ...(f.nvg > 0 ? [['NVG', hours(f.nvg)] as [string, string]] : []),
    ['Landings', `${f.landings_day} day · ${f.landings_night} night`],
    ['Take-offs', `${f.takeoffs_day} day · ${f.takeoffs_night} night`],
    ...(f.app_2d + f.app_3d > 0 ? [['Approaches', `${f.app_2d} 2D · ${f.app_3d} 3D`] as [string, string]] : []),
  ];
  return (
    <View style={st.root}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 16, gap: 12 }} showsVerticalScrollIndicator={false}>
        <View style={st.hero}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={st.route}>{f.dep_place_raw || f.dep_place} <Text style={{ color: Colors.primary }}>→</Text> {f.arr_place_raw || f.arr_place}</Text>
            <Text style={st.sub}>{prettyDate(f.date)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={st.total}>{hours(f.total_time)}</Text>
            <Text style={st.totalLab}>FLIGHT TIME</Text>
          </View>
        </View>

        {duplicate ? (
          <View style={st.warn}>
            <Ionicons name="copy-outline" size={18} color={Colors.warning} />
            <Text style={st.warnText}>You already have a flight with this date, route and times in your logbook.</Text>
          </View>
        ) : null}

        <View style={st.cols}>
          <View style={{ width: 92 }} />
          <Text style={[st.eyebrow, { flex: 1 }]} numberOfLines={1}>{who.toUpperCase()} LOGGED</Text>
          <View style={{ width: 16 }} />
          <Text style={[st.eyebrow, { flex: 1, color: Colors.primary }]}>YOU GET</Text>
        </View>
        <View style={[st.box, { marginTop: -6 }]}>
          {([
            ['Role', `${rev.senderRoleLabel} ${hours(f.total_time)}`, `${rev.receiverRoleLabel} ${hours(f.total_time)}`],
            ['Second pilot', `You, ${rev.receiverAsSecondLabel}`, `${secondName || 'The sender'}, ${rev.senderAsSecondLabel}`],
          ] as [string, string, string][]).map(([k, a, y], i) => (
            <View key={k} style={[st.swap, i > 0 && st.line]}>
              <Text style={[st.key, { width: 92 }]}>{k}</Text>
              <Text style={[st.theirs, { flex: 1 }]}>{a}</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.primary} style={{ width: 16 }} />
              <Text style={[st.yours, { flex: 1 }]}>{y}</Text>
            </View>
          ))}
        </View>

        <Text style={[st.eyebrow, { paddingHorizontal: 14, paddingTop: 4 }]}>THE SAME FOR BOTH OF YOU</Text>
        <View style={[st.box, { marginTop: -6 }]}>
          {same.map(([k, v], i) => (
            <View key={k} style={[st.same, i > 0 && st.line]}>
              <Text style={st.key}>{k}</Text>
              <Text style={st.val}>{v}</Text>
            </View>
          ))}
        </View>

        {rev.remarks ? (
          <>
            <Text style={[st.eyebrow, { paddingHorizontal: 14, paddingTop: 4 }]}>REMARKS</Text>
            <View style={[st.box, { marginTop: -6, padding: 14 }]}><Text style={st.remarks}>{rev.remarks}</Text></View>
          </>
        ) : null}
        <Text style={st.note}>Pilot flying is filled in by your own app. The crew line in the remarks is written again with {secondName || 'the sender'} as your second pilot.</Text>
      </ScrollView>

      <View style={[st.foot, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={st.footNote}>Shared flights open in the Pilot logbook. Switch logbook in Settings first.</Text>
        <TouchableOpacity style={st.cta} onPress={close} activeOpacity={0.85}><Text style={st.ctaText}>Close</Text></TouchableOpacity>
      </View>

    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '24', borderWidth: 1, borderColor: Colors.primary + '80' },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 2, color: '#9DB6CC' },
  h1: { fontFamily: FONT_SERIF, fontSize: 23, fontWeight: '600', color: Colors.textPrimary },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  hero: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: Colors.primary + '55', backgroundColor: Colors.primary + '14' },
  route: { fontFamily: FONT_MONO, fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: 12.5, color: '#9DB6CC' },
  total: { fontFamily: FONT_MONO, fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  totalLab: { fontFamily: FONT_MONO, fontSize: 9, color: '#9DB6CC' },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: Colors.warning + '66', backgroundColor: Colors.warning + '12' },
  warnText: { flex: 1, fontSize: 13, lineHeight: 18, color: '#FFD080' },
  cols: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 4 },
  box: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', backgroundColor: 'rgba(255,255,255,0.04)' },
  line: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 14, paddingVertical: 8 },
  same: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 40, paddingHorizontal: 14, paddingVertical: 8 },
  key: { fontSize: 13, color: '#9DB6CC' },
  theirs: { fontSize: 13.5, color: '#C3D4E3' },
  yours: { fontSize: 13.5, fontWeight: '700', color: Colors.textPrimary },
  val: { fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  remarks: { fontSize: 13.5, lineHeight: 19, color: '#C3D4E3' },
  note: { fontSize: 12.5, lineHeight: 17, color: '#9DB6CC', paddingHorizontal: 4 },
  problem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 36 },
  problemText: { fontSize: 15.5, lineHeight: 22, color: Colors.textPrimary, textAlign: 'center' },
  foot: { paddingHorizontal: 18, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  footNote: { fontSize: 12.5, lineHeight: 17, color: '#9DB6CC', textAlign: 'center' },
  cta: { height: 54, borderRadius: 16, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16.5, fontWeight: '700', color: Colors.textInverse },
});
