// Blades introduction — rundturens "regissör" + kort. Ligger i roten (ovanför hela navigatorn).
//
// Sju stopp som spelas upp av sig själva (constants/tourSteps.ts). För varje stopp byter regissören flik,
// väntar tills skärmen själv rapporterat det som ska lysas upp (TourSpot) och visar då kortet; strecket i
// kortet fylls medan kortet visas och rundturen går vidare när det är fullt. Paus stannar klockan, pilarna
// hoppar ett stopp bakåt eller framåt. Klockan går bara medan kortet syns: inte under ett skärmbyte, inte
// när appen ligger i bakgrunden och inte i paus.
//
// Rundturen öppnar en enda sida, Log flight, och den öppnas som push (app/_layout.tsx) så att kortet alltid
// ligger överst. Inga rutor (native-modaler) öppnas — de lägger sig ovanpå kortet. Loggningsexemplet sparas
// aldrig: raden visas ur minnet (tourStore.examplePilot/exampleDrone).

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, AppState, AccessibilityInfo, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import Animated, {
  FadeIn, FadeInDown, FadeInUp, LinearTransition, useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, cancelAnimation, runOnJS, Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { GlassDialog, DialogIcon } from './GlassDialog';
import { useTourStore, beginTour, clearIntroTourPending, type SpotRect } from '../store/tourStore';
import { TOURS, TOUR_STOPS, type TourMode, type TourStep } from '../constants/tourSteps';
import { makeTourExampleFlight, makeTourExampleDroneFlight, tourExampleDate } from '../constants/tourDemoData';
import { useProfileStore } from '../store/profileStore';
import { useToastStore } from './Toast';
import { getAllAircraftTypes, getManualFlightCount, getSetting } from '../db/flights';
import { getDroneFlightCount, listDrones } from '../db/drones';
import { listDigitalBooks } from '../db/digitalBooks';
import { cleanupTourDemo } from '../services/tourDemoFlight';
import { SCAN_OPEN } from '../store/scanStore';
import { TourCaptionBar } from './TourCaptionBar';
import { useTabBarSpace } from './GlassTabBar';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const waitFor = async (ok: () => boolean, maxMs: number) => {
  const t0 = Date.now();
  while (!ok() && Date.now() - t0 < maxMs) await delay(60);
};
// Knapparna i kortet är små; tryckytan är större (minst 44 px på höjden).
const TB_SLOP = { top: 8, bottom: 8, left: 3, right: 3 };
const SETTLE = 380;   // en push/back eller ett flikbyte hinner bli klart
const SPOT_WAIT = 1500; // så länge väntar kortet högst på ljuset — sen visas det ändå
const REPLAY_HINT = 'You can replay this tour anytime in Settings, under "Blades introduction".';
const DIM = 'rgba(4,10,20,0.68)';
const PILOT_SCAN_WITH_LOGBOOK = 'The scan button fills in flights from a photo: an ACARS printout or the flight log screen, or a page of your paper logbook.';
const PILOT_HOURS_WITH_SCAN = 'Scan your paper logbook, import a file from another app, or enter your totals by hand. Your stats update at once.';

// Flikens route + en nonce (så vy/expand-effekterna triggar om) och, för loggboken, exempelradens månad.
function tabRoute(step: TourStep): string {
  const extras: string[] = [`t=${Date.now()}`];
  if (step.focusToday) {
    const m = /^(\d{4})-(\d{2})/.exec(tourExampleDate());
    if (m) extras.push(`focusYear=${Number(m[1])}`, `focusMonth=${Number(m[2])}`);
  }
  return step.tab + (step.tab.includes('?') ? '&' : '?') + extras.join('&');
}

// Loggboken ska alltid ha en exempelrad att visa, även om exemplet hoppades över.
function ensureExample(mode: TourMode) {
  const st = useTourStore.getState();
  if (mode === 'pilot' && !st.examplePilot) {
    const rotary = useProfileStore.getState().profile?.subRole === 'rotary';
    st.setExample({ pilot: makeTourExampleFlight(rotary ? { aircraft_type: 'H145', registration: 'SE-HEM', me_time: 0.92 } : {}) });
  }
  if (mode === 'drone' && !st.exampleDrone) st.setExample({ drone: makeTourExampleDroneFlight() });
}

// Skanningsknappens val, som rundturen visar dem (samma val och ordning som appens egen meny).
type MenuItem = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap };
function scanMenu(mode: TourMode): MenuItem[] {
  if (mode === 'drone') return [
    { key: 'shot', label: 'Choose a screenshot', icon: 'images-outline' },
    { key: 'photo', label: 'Take a photo', icon: 'camera-outline' },
  ];
  return [
    ...(SCAN_OPEN ? [{ key: 'logbook', label: 'Logbook scan', icon: 'book-outline' as const }] : []),
    { key: 'acars', label: 'ACARS scan', icon: 'hardware-chip-outline' },
  ];
}
const PILL_H = 48;
const PILL_GAP = 8;
const MENU_PRESS_MS = 650; // så länge lyser knappen innan "trycket" och valen kommer

// Rundad rektangel som SVG-bana (hålet i dämpningen).
function holePath(r: SpotRect): string {
  const rad = Math.max(0, Math.min(r.r, r.w / 2, r.h / 2));
  const { x, y, w, h } = r;
  return `M${x + rad} ${y}H${x + w - rad}A${rad} ${rad} 0 0 1 ${x + w} ${y + rad}V${y + h - rad}A${rad} ${rad} 0 0 1 ${x + w - rad} ${y + h}`
    + `H${x + rad}A${rad} ${rad} 0 0 1 ${x} ${y + h - rad}V${y + rad}A${rad} ${rad} 0 0 1 ${x + rad} ${y}Z`;
}

export function TourHost() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { width: W, height: H } = useWindowDimensions();
  const active = useTourStore((s) => s.active);
  const mode = useTourStore((s) => s.mode);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const phase = useTourStore((s) => s.phase);
  const paused = useTourStore((s) => s.paused);
  const spotRects = useTourStore((s) => s.spotRects);
  const demoProgress = useTourStore((s) => s.demoProgress);
  const logDemoDoneAt = useTourStore((s) => s.logDemoDoneAt);
  const promptMode = useTourStore((s) => s.promptMode);
  const next = useTourStore((s) => s.next);
  const prev = useTourStore((s) => s.prev);
  const stop = useTourStore((s) => s.stop);
  const setPaused = useTourStore((s) => s.setPaused);
  const setPrompt = useTourStore((s) => s.setPrompt);

  const steps = TOURS[mode];
  const step: TourStep | undefined = steps[stepIndex];

  const openPageRef = useRef<string | null>(null); // sidan (push) som rundturen just nu håller öppen
  const runRef = useRef(0);
  const [cardH, setCardH] = useState(130);
  // Skanningsstoppet: knappen lyser en stund, "trycks" och valen glider fram.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuStep = !!step?.menu && active && phase === 'shown';
  useEffect(() => {
    setMenuOpen(false);
    if (!menuStep) return;
    const t = setTimeout(() => setMenuOpen(true), MENU_PRESS_MS);
    return () => clearTimeout(t);
  }, [menuStep, stepIndex]);

  // Appen i bakgrunden → klockan står still.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  // Med skärmläsare startar rundturen pausad: man går vidare själv med pilarna, i egen takt.
  useEffect(() => {
    if (!active) return;
    AccessibilityInfo.isScreenReaderEnabled().then((on) => { if (on && useTourStore.getState().active) setPaused(true); }).catch(() => {});
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Regissören: ett stopp i taget. Medan den arbetar är fasen 'moving' (pilarna väntar). ──
  useEffect(() => {
    if (!active || !step) return;
    const token = ++runRef.current;
    const st = useTourStore.getState;
    const alive = () => runRef.current === token && st().active;
    (async () => {
      // 1 · Stäng Log flight om det här stoppet inte använder den.
      if (openPageRef.current && openPageRef.current !== (step.page ?? null)) {
        router.back(); openPageRef.current = null;
        st().setPressTarget(null); st().setLogForm(null);
        await delay(SETTLE); if (!alive()) return;
        st().setPageOpen(false);
      }
      if (!step.logDemo) ensureExample(mode);

      // 2 · Rätt flik.
      router.navigate(tabRoute(step) as any);
      await delay(SETTLE); if (!alive()) return;

      // 3 · Log flight: öppna och vänta tills formuläret självt sagt att det är monterat.
      if (step.page && openPageRef.current !== step.page) {
        st().setFormReady(false); st().resetLogDemo();
        if (mode === 'pilot') st().setLogForm('quick');
        st().setPageOpen(true);
        router.push(step.page as any); openPageRef.current = step.page;
        await waitFor(() => st().formReady, 3000); if (!alive()) return;
        await delay(250); if (!alive()) return;
      }

      // 4 · Ljuset: vänta tills skärmen rapporterat något som syns. Dröjer det visas kortet ändå.
      const ids = step.spots ?? [];
      st().setSpots(ids);
      if (ids.length) {
        await waitFor(() => ids.some((id) => !!st().spotRects[id]), SPOT_WAIT); if (!alive()) return;
        await delay(320); if (!alive()) return; // sidan hinner rulla klart; ljuset följer ändå med
      }
      st().setPhase('shown');
      if (step.logDemo) st().startLogDemo();
    })();
  }, [active, stepIndex, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Klockan: strecket fylls medan kortet visas; fullt → nästa stopp. ──
  const prog = useSharedValue(0);
  const idxRef = useRef(stepIndex);
  idxRef.current = stepIndex;
  const autoNext = (forIndex: number) => {
    const s = useTourStore.getState();
    if (s.active && s.stepIndex === forIndex && s.phase === 'shown' && !s.paused) s.next();
  };
  useEffect(() => { cancelAnimation(prog); prog.value = 0; }, [stepIndex, active, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const timed = !!step && !step.final && !step.logDemo;
  const running = active && timed && phase === 'shown' && !paused && appActive;
  useEffect(() => {
    if (!running || !step) return;
    const forIndex = stepIndex;
    const left = Math.max(0, 1 - prog.value) * step.seconds * 1000;
    prog.value = withTiming(1, { duration: left, easing: Easing.linear }, (fin) => { if (fin) runOnJS(autoNext)(forIndex); });
    return () => cancelAnimation(prog);
  }, [running, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(prog.value * 1000) / 10}%` }));

  // Exemplet är klart → vidare till loggboken efter en kort "Saved"-paus.
  useEffect(() => {
    if (!active || !logDemoDoneAt || !step?.logDemo) return;
    const t = setTimeout(() => {
      const s = useTourStore.getState();
      if (s.active && TOURS[s.mode][s.stepIndex]?.logDemo) s.next();
    }, 1200);
    return () => clearTimeout(t);
  }, [logDemoDoneAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avslut: stäng Log flight om den är öppen. Körs även vid appstart (active=false) och städar då en
  // exempelflygning som en äldre version av rundturen kan ha lämnat kvar i databasen.
  useEffect(() => {
    if (active) return;
    const st = useTourStore.getState();
    if (openPageRef.current) {
      router.back(); openPageRef.current = null;
      setTimeout(() => useTourStore.getState().setPageOpen(false), SETTLE + 200);
    }
    st.setPressTarget(null);
    cleanupTourDemo();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fråga efter onboarding: vill du ha rundturen? Flaggan rensas först när man svarat.
  if (promptMode && !active) {
    const m = promptMode;
    return (
      <TourPrompt
        onYes={() => { setPrompt(null); clearIntroTourPending(); beginTour(m); }}
        onLater={() => { setPrompt(null); clearIntroTourPending(); useToastStore.getState().show(REPLAY_HINT); }}
      />
    );
  }

  if (!active || !step) return null;

  const moving = phase === 'moving';

  // Loggningsexemplet: inget kort som skymmer formuläret, bara en smal bildtextrad med paus och Skip.
  // Skip hoppar över exemplet (inte hela rundturen). Hela skärmen sväljer tryck så exemplet inte störs.
  if (step.logDemo) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { /* svälj */ }} accessible={false} />
        {!moving ? (
          <TourCaptionBar eyebrow={mode === 'drone' ? 'LOGGING AN EXAMPLE SESSION' : 'LOGGING AN EXAMPLE FLIGHT'}
            onSkip={() => { ensureExample(mode); next(); }} />
        ) : null}
      </View>
    );
  }

  if (step.final) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: moving ? 'transparent' : DIM }]} onPress={() => { /* svälj */ }} accessible={false} />
        {!moving ? (
          <Animated.View entering={FadeInDown.duration(320)} style={[styles.shadow, { left: 10, right: 10, bottom: Math.max(insets.bottom, 10) + 4 }]}>
            <View style={[styles.cardClip, { borderRadius: 30 }]}>
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, styles.cardTint]} />
              <ReadySheet mode={mode} title={step.title}
                onBack={prev}
                onExplore={() => { stop(); useToastStore.getState().show(REPLAY_HINT); }}
                onGo={(go) => {
                  // Rundturen avslutas HELT innan man går vidare — den ligger aldrig kvar dold i bakgrunden.
                  stop();
                  setTimeout(() => { go.startsWith('/(tabs)') ? router.navigate(go as any) : router.push(go as any); }, 120);
                }} />
            </View>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  // Det som lyser: bara rutor som faktiskt ligger på skärmen.
  const rects = (step.spots ?? [])
    .map((id) => ({ id, r: spotRects[id] }))
    .filter((x): x is { id: string; r: SpotRect } => !!x.r && x.r.y + x.r.h > 0 && x.r.y < H && x.r.x + x.r.w > 0 && x.r.x < W);
  const dimPath = `M0 0H${W}V${H}H0Z ${rects.map((x) => holePath(x.r)).join(' ')}`;

  // Kortet står längst ner, ovanför flikraden. Skulle det skymma det som lyser flyttas det högst upp.
  const bottomOffset = tabSpace + 12;
  const cardTop = H - bottomOffset - cardH;
  const main = rects.filter((x) => x.id !== 'fab');
  const onTop = main.some((x) => x.r.y + x.r.h > cardTop - 6 && x.r.y > insets.top + cardH + 20);
  const cardPos = onTop ? { top: insets.top + 8 } : { bottom: bottomOffset };

  const isFirst = stepIndex === 0;
  const body = mode === 'pilot' && SCAN_OPEN && step.key === 'hours' ? PILOT_HOURS_WITH_SCAN
    : mode === 'pilot' && SCAN_OPEN && step.key === 'logscan' ? PILOT_SCAN_WITH_LOGBOOK : step.body;

  // Skanningsknappens val: ovanför knappen när de får plats, annars under, i linje med knappens närmaste sida.
  const menuAnchor = step.menu ? rects[0]?.r : undefined;
  const menuItems = step.menu ? scanMenu(mode) : [];
  const menuH = menuItems.length * (PILL_H + PILL_GAP);
  const menuAbove = !!menuAnchor && menuAnchor.y - menuH >= insets.top + 8;
  const menuLeft = !!menuAnchor && menuAnchor.x + menuAnchor.w / 2 <= W / 2;
  const hit = (x: number, y: number) => rects.some(({ r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Sväljer alla tryck. Ett tryck på det som lyser går vidare, precis som pilen. */}
      <Pressable style={StyleSheet.absoluteFill} accessible={false}
        onPress={(e) => { if (!moving && hit(e.nativeEvent.pageX, e.nativeEvent.pageY)) next(); }} />

      {!moving ? (
        <Animated.View key={`dim-${stepIndex}`} entering={FadeIn.duration(260)} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={W} height={H}>
            <Path d={dimPath} fill={rects.length ? DIM : 'rgba(4,10,20,0.28)'} fillRule="evenodd" />
            {rects.map(({ id, r }) => {
              const rad = Math.max(0, Math.min(r.r, r.w / 2, r.h / 2));
              return (
                <Rect key={id} x={r.x} y={r.y} width={r.w} height={r.h} rx={rad} ry={rad} fill="none" stroke={Colors.primary} strokeWidth={2} />
              );
            })}
            {rects.map(({ id, r }) => {
              const rad = Math.max(0, Math.min(r.r + 3, r.w / 2 + 3, r.h / 2 + 3));
              return (
                <Rect key={`g-${id}`} x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} rx={rad} ry={rad} fill="none" stroke={Colors.primary} strokeOpacity={0.28} strokeWidth={5} />
              );
            })}
          </Svg>
        </Animated.View>
      ) : null}

      {!moving && menuAnchor && menuOpen ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <PressPulse r={menuAnchor} />
          <View style={[styles.menuStack, {
            top: menuAbove ? menuAnchor.y - menuH : menuAnchor.y + menuAnchor.h + PILL_GAP,
            alignItems: menuLeft ? 'flex-start' : 'flex-end',
            ...(menuLeft ? { left: menuAnchor.x } : { right: W - menuAnchor.x - menuAnchor.w }),
          }]}>
            {menuItems.map((o, i) => {
              const order = menuAbove ? menuItems.length - 1 - i : i; // närmast knappen först
              const Enter = menuAbove ? FadeInDown : FadeInUp;
              return (
                <Animated.View key={o.key} entering={Enter.delay(180 + order * 90).duration(260)} style={styles.pill}>
                  <Ionicons name={o.icon} size={19} color={Colors.primary} />
                  <Text style={styles.pillText} maxFontSizeMultiplier={1.2}>{o.label}</Text>
                </Animated.View>
              );
            })}
          </View>
        </View>
      ) : null}

      {!moving ? (
        <Animated.View entering={FadeIn.duration(240)} layout={LinearTransition.duration(300)} style={[styles.shadow, styles.cardSide, cardPos]}
          onLayout={(e) => { const h = e.nativeEvent.layout.height; if (Math.abs(h - cardH) > 2) setCardH(h); }}>
          <View style={styles.cardClip}>
            <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, styles.cardTint]} />
            <View style={styles.cardInner}>
              <View style={styles.topRow}>
                <Segments stop={step.stop} fillStyle={fillStyle} />
                <Text style={styles.count} maxFontSizeMultiplier={1.2}>{step.stop} of {TOUR_STOPS}</Text>
                <TouchableOpacity onPress={stop} hitSlop={{ top: 14, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Skip the tour">
                  <Text style={styles.skip} maxFontSizeMultiplier={1.2}>Skip tour</Text>
                </TouchableOpacity>
              </View>

              {/* Rubriken och knapparna delar rad, så kortet tar så lite av skärmen som möjligt. */}
              <View style={styles.headRow}>
                <Animated.View key={stepIndex} entering={FadeInDown.duration(300)} style={{ flex: 1 }}>
                  <Text style={styles.title} maxFontSizeMultiplier={1.3}>{step.title}</Text>
                </Animated.View>
                <View style={styles.transport}>
                  <TouchableOpacity onPress={prev} disabled={isFirst} activeOpacity={0.8} style={[styles.sb, isFirst && styles.tbOff]} hitSlop={TB_SLOP}
                    accessibilityRole="button" accessibilityLabel="Previous stop">
                    <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setPaused(!paused)} activeOpacity={0.85} style={[styles.sb, styles.sbMain]} hitSlop={TB_SLOP}
                    accessibilityRole="button" accessibilityLabel={paused ? 'Play' : 'Pause'}>
                    <Ionicons name={paused ? 'play' : 'pause'} size={17} color={Colors.textInverse} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={next} activeOpacity={0.8} style={styles.sb} hitSlop={TB_SLOP}
                    accessibilityRole="button" accessibilityLabel="Next stop">
                    <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
              <Animated.View key={`b-${stepIndex}`} entering={FadeInDown.duration(300)}>
                <Text style={styles.body} maxFontSizeMultiplier={1.3}>{body}</Text>
              </Animated.View>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

// Ett kort "tryck" på knappen som lyser: en cyan ton som blinkar till när valen kommer fram.
function PressPulse({ r }: { r: SpotRect }) {
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = withSequence(withTiming(0.4, { duration: 120 }), withDelay(60, withTiming(0, { duration: 320 })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r, backgroundColor: Colors.primary }, st]} />;
}

// Sju streck: klara stopp fyllda, det pågående fylls medan kortet visas.
function Segments({ stop, fillStyle, full = false }: { stop: number; fillStyle?: any; full?: boolean }) {
  return (
    <View style={styles.segs}>
      {Array.from({ length: TOUR_STOPS }, (_, i) => {
        const n = i + 1;
        return (
          <View key={n} style={styles.seg}>
            {full || n < stop ? <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.primary }]} />
              : n === stop ? <Animated.View style={[styles.segFill, fillStyle]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// ── Sista stoppet: "You're ready" med ett nästa steg som passar användaren ─────────────
interface NextStep { key: string; label: string; sub: string; cta: string; go: string; done: boolean }

function ReadySheet({ mode, title, onGo, onExplore, onBack }: {
  mode: TourMode; title: string; onGo: (go: string) => void; onExplore: () => void; onBack: () => void;
}) {
  const [items, setItems] = useState<NextStep[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: NextStep[];
      try {
        const [paper, hours] = await Promise.all([getSetting('onboarding_paper').catch(() => ''), getSetting('onboarding_hours').catch(() => '')]);
        const hasHours = !!hours && hours !== 'Just starting';
        if (mode === 'drone') {
          const [drones, fc, books] = await Promise.all([listDrones(), getDroneFlightCount(), listDigitalBooks('drone')]);
          list = [
            { key: 'fleet', label: 'Add your drones', sub: 'Register what you fly once, then pick it with one tap every time you log.', cta: 'Add a drone', go: '/settings/drones', done: drones.length > 0 },
            ...(hasHours && fc === 0 ? [{ key: 'import', label: 'Bring in your hours', sub: 'Scan a controller screenshot, import a file, or enter your totals by hand.', cta: 'Open Import', go: '/(tabs)/drone-settings?expand=import', done: false }] : []),
            { key: 'flight', label: 'Log your first flight', sub: 'Tap the B, add the place and the time, and save.', cta: 'Log a flight', go: '/drone-flight/add', done: fc > 0 },
            { key: 'book', label: 'Build your logbook', sub: 'See your flights laid out like a real logbook.', cta: 'Open Book', go: '/(tabs)/drone-log?view=book', done: books.length > 0 },
          ];
        } else {
          const [types, fc, books] = await Promise.all([getAllAircraftTypes(), getManualFlightCount(), listDigitalBooks('digital')]);
          const first: NextStep[] = [];
          if (SCAN_OPEN && paper === '1' && fc === 0) first.push({ key: 'scan', label: 'Scan your paper logbook', sub: 'You said you have one. Photograph the pages and Blades reads the flights.', cta: 'Start scanning', go: '/import/scan', done: false });
          else if ((hasHours || paper === '1') && fc === 0) first.push({ key: 'import', label: 'Bring in your hours', sub: 'Import a file from another logbook app, or enter your totals by hand.', cta: 'Open Import', go: '/(tabs)/settings?expand=import', done: false });
          list = [
            ...first,
            { key: 'flight', label: 'Log your first flight', sub: 'Tap the B, add the route and the times, and save.', cta: 'Log a flight', go: '/flight/add', done: fc > 0 },
            { key: 'fleet', label: 'Add your aircraft', sub: 'Build up your fleet, with hours per type.', cta: 'Open Fleet', go: '/(tabs)/log?view=fleet', done: types.length > 0 },
            { key: 'book', label: 'Build your logbook', sub: 'See your flights laid out like a real logbook.', cta: 'Open Book', go: '/(tabs)/log?view=book', done: books.length > 0 },
          ];
        }
      } catch { list = []; }
      if (!cancelled) setItems(list);
    })();
    return () => { cancelled = true; };
  }, [mode]);

  const primary = items?.find((i) => !i.done) ?? null;
  const rest = (items ?? []).filter((i) => i !== primary).slice(0, 2);

  return (
    <View style={styles.sheetInner}>
      <View style={styles.topRow}>
        <Segments stop={TOUR_STOPS} full />
        <Text style={styles.count} maxFontSizeMultiplier={1.2}>{TOUR_STOPS} of {TOUR_STOPS}</Text>
      </View>
      <Text style={styles.readyTitle} maxFontSizeMultiplier={1.3}>{title}</Text>

      {primary ? (
        <View style={styles.primary}>
          <Text style={styles.primaryEyebrow} maxFontSizeMultiplier={1.2}>BEST NEXT STEP FOR YOU</Text>
          <Text style={styles.primaryLabel} maxFontSizeMultiplier={1.3}>{primary.label}</Text>
          <Text style={styles.body} maxFontSizeMultiplier={1.3}>{primary.sub}</Text>
          <TouchableOpacity onPress={() => onGo(primary.go)} activeOpacity={0.85} style={styles.primaryBtn} accessibilityRole="button">
            <Text style={styles.primaryBtnText} maxFontSizeMultiplier={1.3}>{primary.cta}</Text>
          </TouchableOpacity>
        </View>
      ) : items ? (
        <Text style={styles.body} maxFontSizeMultiplier={1.3}>You have already done the first steps. Enjoy Blades.</Text>
      ) : null}

      {rest.map((it) => (
        <TouchableOpacity key={it.key} onPress={() => onGo(it.go)} activeOpacity={0.8} style={styles.nextRow} accessibilityRole="button">
          {it.done ? <Ionicons name="checkmark-circle" size={20} color={Colors.success} /> : null}
          <Text style={styles.nextLabel} maxFontSizeMultiplier={1.3}>{it.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
        </TouchableOpacity>
      ))}

      <View style={styles.readyNav}>
        <TouchableOpacity onPress={onBack} activeOpacity={0.8} style={styles.tb} accessibilityRole="button" accessibilityLabel="Previous stop">
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onExplore} activeOpacity={0.8} style={styles.exploreBtn} accessibilityRole="button">
          <Text style={styles.exploreText} maxFontSizeMultiplier={1.3}>Explore on my own</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.foot} maxFontSizeMultiplier={1.2}>Your logbook is stored on this phone. Replay the tour in Settings.</Text>
    </View>
  );
}

// ── Fråga efter onboarding ───────────────────────────────────────────────────
function TourPrompt({ onYes, onLater }: { onYes: () => void; onLater: () => void }) {
  // Samma stil som appens övriga popup-rutor (GlassDialog). Tryck utanför stänger inte: man väljer Ja eller Senare.
  return (
    <GlassDialog
      visible
      onClose={onLater}
      closeOnScrim={false}
      icon={<DialogIcon name="compass-outline" />}
      eyebrow="Welcome to Blades"
      title="Take the 90-second tour?"
      body="It plays by itself: logging a flight, your logbook, your insights and bringing in the hours you already have. Pause or step back whenever you like."
      primary={{ label: 'Show me around', onPress: onYes }}
      secondary={{ label: 'Not now', onPress: onLater }}
    />
  );
}

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  cardSide: { left: 14, right: 14 },
  cardClip: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: Colors.primary + '5C' },
  cardTint: { backgroundColor: 'rgba(12,26,50,0.78)' },
  cardInner: { paddingHorizontal: 13, paddingTop: 10, paddingBottom: 11 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  segs: { flex: 1, flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF2E', overflow: 'hidden' },
  segFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: Colors.primary },
  count: { color: '#9DB4CC', fontSize: 11.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  skip: { color: '#A9C3DA', fontSize: 13, fontWeight: '700' },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  title: { color: Colors.textPrimary, fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2 },
  body: { color: '#C3D6E8', fontSize: 13, lineHeight: 18 },

  transport: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sb: { width: 36, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF29' },
  sbMain: { width: 44, backgroundColor: Colors.primary, borderColor: Colors.primary },

  menuStack: { position: 'absolute', gap: PILL_GAP },
  pill: { height: PILL_H, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, borderRadius: 16,
    // Fast yta i stället för glas: glas som tonas in ritas inte alltid av iOS.
    backgroundColor: 'rgba(16,32,58,0.97)', borderWidth: 1, borderColor: '#FFFFFF2E' },
  pillText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  tb: { width: 48, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF29' },
  tbMain: { width: 72, backgroundColor: Colors.primary, borderColor: Colors.primary },
  tbOff: { opacity: 0.35 },

  sheetInner: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12, gap: 10 },
  readyTitle: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  primary: { borderRadius: 18, backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '73', padding: 14, gap: 6 },
  primaryEyebrow: { color: Colors.primaryLight, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.1 },
  primaryLabel: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  primaryBtn: { height: 50, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryBtnText: { color: Colors.textInverse, fontSize: 15.5, fontWeight: '800' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: 14, backgroundColor: '#FFFFFF10', borderWidth: 1, borderColor: '#FFFFFF1F', paddingHorizontal: 13 },
  nextLabel: { flex: 1, color: Colors.textPrimary, fontSize: 14.5, fontWeight: '700' },
  readyNav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  exploreBtn: { flex: 1, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF14', borderWidth: 1, borderColor: '#FFFFFF29' },
  exploreText: { color: Colors.textPrimary, fontSize: 14.5, fontWeight: '700' },
  foot: { color: '#9DB4CC', fontSize: 12, textAlign: 'center', marginTop: 2 },
});
