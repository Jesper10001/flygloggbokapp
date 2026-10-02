// Blades introduction — rundturens "regissör" + info-kort. Ligger i roten (ovanför allt).
// Den navigerar själv mellan sidorna, "trycker" på knappar (TourPress) och öppnar/stänger modaler
// enligt stegen i constants/tourSteps.ts. Kortet är lågt + halvtransparent (blur) så man ser appen
// bakom, och stegen tonar mjukt (persistant kort + höjd-morph). Sista steget är en checklista.

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTourStore } from '../store/tourStore';
import { TOURS } from '../constants/tourSteps';
import { useFlightStore } from '../store/flightStore';
import { getAllAircraftTypes, getManualFlightCount } from '../db/flights';
import { getDroneFlightCount, listDrones } from '../db/drones';
import { listDigitalBooks } from '../db/digitalBooks';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Bygg tab-routen för ett steg: lägg på en nonce (så vy/expand-effekterna triggar om) och — för
// loggbokssteget — senaste år+månad så List-vyn fälls ut där det finns flygningar.
function buildTab(tab: string, logExpandLatest?: boolean): string {
  const extras: string[] = [`t=${Date.now()}`];
  if (logExpandLatest) {
    const f = useFlightStore.getState().flights?.[0];
    const m = f?.date ? /^(\d{4})-(\d{2})/.exec(f.date) : null;
    if (m) extras.push(`focusYear=${Number(m[1])}`, `focusMonth=${Number(m[2])}`);
  }
  return tab + (tab.includes('?') ? '&' : '?') + extras.join('&');
}

export function TourHost() {
  const router = useRouter();
  const active = useTourStore((s) => s.active);
  const mode = useTourStore((s) => s.mode);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const next = useTourStore((s) => s.next);
  const prev = useTourStore((s) => s.prev);
  const stop = useTourStore((s) => s.stop);
  const setPressTarget = useTourStore((s) => s.setPressTarget);
  const setOpenBackfill = useTourStore((s) => s.setOpenBackfill);

  const steps = TOURS[mode];
  const step = steps[stepIndex];

  const openPageRef = useRef<string | null>(null); // sid-route (push) som rundturen just nu håller öppen
  const runRef = useRef(0);

  // Regissör: reagerar på stegbyte → stänger ev. öppen sida, navigerar, "trycker", öppnar nästa sida.
  // Sidorna öppnas som PUSH (se app/_layout.tsx) → kortet (root-överlägg) ligger alltid överst och
  // rundturen kan aldrig fastna bakom en sida.
  useEffect(() => {
    if (!active || !step) return;
    const token = ++runRef.current;
    const alive = () => runRef.current === token && useTourStore.getState().active;

    (async () => {
      const cur = openPageRef.current;
      const want = step.modal ?? null;

      // Samma sida ska stanna öppen (t.ex. Imported data → Backfill): byt bara flagga + tryck.
      if (want && cur === want) {
        if (step.press) { setPressTarget(step.press); await delay(1100); if (!alive()) return; }
        setOpenBackfill(!!step.backfill);
        await delay(250); if (!alive()) return;
        setPressTarget(null);
        return;
      }

      setOpenBackfill(false);
      if (cur) { router.back(); openPageRef.current = null; await delay(480); if (!alive()) return; }

      if (step.tab) { router.navigate(buildTab(step.tab, step.logExpandLatest) as any); await delay(cur ? 260 : 440); if (!alive()) return; }

      // Lugnt tempo: visa tryck-markeringen en stund INNAN sidan öppnas, så man hinner se vad som klickas.
      if (step.press) { setPressTarget(step.press); await delay(1000); if (!alive()) return; }

      if (want) {
        router.push(want as any); openPageRef.current = want;
        await delay(480); if (!alive()) return;
        setOpenBackfill(!!step.backfill);
      }
      setPressTarget(null);
    })();
  }, [active, stepIndex, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avslut: stäng ev. öppen sida.
  useEffect(() => {
    if (active) return;
    if (openPageRef.current) { router.back(); openPageRef.current = null; }
    setPressTarget(null); setOpenBackfill(false);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !step) return null;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const doneFlex = stepIndex + 1;
  const restFlex = steps.length - doneFlex;

  return (
    // Root-överlägg: ligger ovanför HELA navigatorn (flikar + push-sidor). Rundturens sidor öppnas
    // som push (ej native-modal, se app/_layout.tsx) → kortet ligger alltid överst och man fastnar aldrig.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Mycket lätt scrim: appen syns tydligt, men tryck fångas (rundturen styrs via pilarna). */}
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={() => { /* svälj */ }} />

      <Animated.View entering={FadeIn.duration(260)} layout={LinearTransition.duration(320)} style={styles.cardShadow}>
        <View style={styles.cardClip}>
          <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.cardTint]} />
          <View style={styles.cardInner}>
            {step.checklist ? (
              <Checklist mode={mode} stepKey={step.key} title={step.title} onFinish={stop} onBack={prev}
                onGo={(go) => { stop(); setTimeout(() => { go.startsWith('/(tabs)') ? router.navigate(go as any) : router.push(go as any); }, 70); }} />
            ) : (
              <>
                <View style={styles.topRow}>
                  <View style={styles.track}>
                    <View style={{ flex: doneFlex, backgroundColor: Colors.primary }} />
                    {restFlex > 0 ? <View style={{ flex: restFlex }} /> : null}
                  </View>
                  <TouchableOpacity onPress={stop} hitSlop={10}><Text style={styles.skip}>Skip</Text></TouchableOpacity>
                </View>

                <Animated.View key={stepIndex} entering={FadeInDown.duration(320)}>
                  <Text style={styles.title}>{step.title}</Text>
                  <Text style={styles.body}>{step.body}</Text>
                </Animated.View>

                <View style={styles.navRow}>
                  <TouchableOpacity onPress={prev} disabled={isFirst} hitSlop={8} style={[styles.backBtn, isFirst && styles.hidden]}>
                    <Ionicons name="chevron-back" size={17} color={Colors.textSecondary} />
                    <Text style={styles.backText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={next} activeOpacity={0.85} style={styles.nextBtn}>
                    <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
                    {!isLast && <Ionicons name="chevron-forward" size={17} color={Colors.textInverse} />}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ── Checklista (sista steget) ───────────────────────────────────────────────
type CheckState = { fleet: boolean; flight: boolean; book: boolean } | null;

function Checklist({ mode, stepKey, title, onFinish, onBack, onGo }: {
  mode: 'pilot' | 'drone'; stepKey: string; title: string; onFinish: () => void; onBack: () => void; onGo: (go: string) => void;
}) {
  const [c, setC] = useState<CheckState>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (mode === 'drone') {
          const [drones, fc, books] = await Promise.all([listDrones(), getDroneFlightCount(), listDigitalBooks('drone')]);
          if (!cancelled) setC({ fleet: drones.length > 0, flight: fc > 0, book: books.length > 0 });
        } else {
          const [types, fc, books] = await Promise.all([getAllAircraftTypes(), getManualFlightCount(), listDigitalBooks('digital')]);
          if (!cancelled) setC({ fleet: types.length > 0, flight: fc > 0, book: books.length > 0 });
        }
      } catch { if (!cancelled) setC({ fleet: false, flight: false, book: false }); }
    })();
    return () => { cancelled = true; };
  }, [mode, stepKey]);

  // "Build your logbook" = den animerade loggboken i appen (Book-vyn) som visar flygningarna som en
  // riktig loggbok — inte en separat/fysisk bok.
  const items = mode === 'drone'
    ? [
        { icon: 'hardware-chip-outline', label: 'Add your drones', sub: 'Register the drones you fly', done: c?.fleet, go: '/settings/drones' },
        { icon: 'navigate-outline', label: 'Log your first flight', sub: 'Record a flight to get going', done: c?.flight, go: '/drone-flight/add' },
        { icon: 'book-outline', label: 'Build your logbook', sub: 'See your flights laid out like a real logbook', done: c?.book, go: '/(tabs)/drone-log?view=book' },
      ]
    : [
        { icon: 'airplane-outline', label: 'Add your aircraft', sub: 'Build up your fleet', done: c?.fleet, go: '/(tabs)/log?view=fleet' },
        { icon: 'add-circle-outline', label: 'Log your first flight', sub: 'Record a flight to get going', done: c?.flight, go: '/flight/add' },
        { icon: 'book-outline', label: 'Build your logbook', sub: 'See your flights laid out like a real logbook', done: c?.book, go: '/(tabs)/log?view=book' },
      ];

  return (
    <Animated.View entering={FadeIn.duration(260)}>
      <Text style={styles.clTitle}>{title}</Text>
      <Text style={styles.clSub}>A few things to get you started — tap any to jump in.</Text>
      <View style={{ gap: 8, marginTop: 12 }}>
        {items.map((it) => (
          <TouchableOpacity key={it.label} onPress={() => onGo(it.go)} activeOpacity={0.8} style={styles.clRow}>
            <View style={[styles.clIcon, it.done && { backgroundColor: Colors.success + '22', borderColor: Colors.success + '55' }]}>
              <Ionicons name={(it.done ? 'checkmark' : it.icon) as any} size={17} color={it.done ? Colors.success : Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clLabel}>{it.label}</Text>
              <Text style={styles.clRowSub}>{it.done ? 'Done' : it.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={17} color={Colors.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onFinish} activeOpacity={0.85} style={styles.nextBtn}>
          <Text style={styles.nextText}>Finish</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: '#00000018' },
  cardShadow: {
    position: 'absolute', left: 14, right: 14, bottom: 96,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  cardClip: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: Colors.primary + '4D' },
  cardTint: { backgroundColor: 'rgba(10,22,40,0.52)' },
  cardInner: { padding: 15 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF22', overflow: 'hidden', flexDirection: 'row' },
  skip: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },

  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18.5 },

  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingRight: 8 },
  backText: { color: Colors.textSecondary, fontSize: 14.5, fontWeight: '700' },
  hidden: { opacity: 0 },
  nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.primary, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 18 },
  nextText: { color: Colors.textInverse, fontSize: 14.5, fontWeight: '800' },

  clTitle: { color: Colors.textPrimary, fontSize: 19, fontWeight: '800' },
  clSub: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 3 },
  clRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF10', borderRadius: 12, borderWidth: 1, borderColor: '#FFFFFF1A', paddingVertical: 10, paddingHorizontal: 12 },
  clIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '44' },
  clLabel: { color: Colors.textPrimary, fontSize: 14.5, fontWeight: '700' },
  clRowSub: { color: Colors.textMuted, fontSize: 11.5, marginTop: 1 },
  clFinish: { marginTop: 14, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
});
