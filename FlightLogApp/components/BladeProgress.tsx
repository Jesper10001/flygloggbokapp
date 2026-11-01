import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBackground } from './AppBackground';
import { Colors } from '../constants/colors';

// Laddskärmen med Blade-myntet, gemensam för det som tar tid (skanning av loggbok, CSV/Excel-import), så att
// de ser likadana ut. Myntet snurrar jämnt runt sin lodräta axel; under det etikett, rubrik, förlopp med tid
// och stegen som en tidslinje. Alla animationer går på den inbyggda animationstråden (useNativeDriver) så
// att inget hackar medan appen arbetar. Klart → myntet bromsar in framåtvänt med en bock.

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const BLADE_COIN = require('../assets/Blade_coin.PNG');
const COIN = 210;              // bildens storlek; själva myntet fyller ~84 % av den
const EDGE = 16;               // myntets tjocklek (px) när det står på högkant
const RIM_LAYERS = 6;          // kantlager som ger tjockleken

export type ProgressStatus = 'busy' | 'done' | 'error';
export type StepState = 'done' | 'active' | 'todo';
export interface ProgressStep { label: string; state: StepState }

export function BladeProgress({
  status, eyebrow, title, body, steps, progress, progressMs, startedAt, footnote, onClose, closeLabel, onRetry, action, safeTop = true,
}: {
  status: ProgressStatus;
  eyebrow: string;
  title: string;
  body: string;
  steps: ProgressStep[];
  progress: number;           // förloppets mål (0–1) för det pågående steget
  progressMs: number;         // hur lång tid förloppet tar att nå målet
  startedAt: number;          // Date.now() när arbetet började
  footnote?: string;
  onClose?: () => void;       // utan: ingen stängknapp
  closeLabel?: string;
  onRetry?: () => void;       // visas vid fel
  action?: { label: string; onPress: () => void };   // vid fel: en egen knapp före "Try again"
  safeTop?: boolean;          // false när skärmen har en egen rubrikrad
}) {
  const insets = useSafeAreaInsets();

  // Förlopp (skalas i x från vänster): närmar sig målet för varje steg, fylls helt när det är klart.
  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status === 'done') {
      Animated.timing(bar, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (status === 'busy') {
      Animated.timing(bar, { toValue: progress, duration: progressMs, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }
  }, [status, progress, progressMs, bar]);

  // Tid sedan start (m:ss) — visar att det arbetar, utan att lova en sluttid.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== 'busy') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [status, startedAt]);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View style={StyleSheet.absoluteFill}>
      <AppBackground />
      <View style={[s.wrap, { paddingTop: (safeTop ? insets.top : 0) + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={s.header}>
          {onClose && (
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel={closeLabel ?? 'Cancel'} style={s.close}>
              <Ionicons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={s.stage}>
          <BladeCoin status={status} />
        </View>

        <View style={s.info}>
          <Text style={[s.eyebrow, status === 'done' && { color: Colors.success }, status === 'error' && { color: Colors.dangerLight }]}>{eyebrow}</Text>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          <Text style={s.body}>{body}</Text>

          {status !== 'error' && (
            <View style={s.progressRow}>
              <View style={s.track}>
                <Animated.View style={[s.fill, status === 'done' && { backgroundColor: Colors.success }, { transform: [{ scaleX: bar }] }]} />
              </View>
              <Text style={s.clock}>{status === 'done' ? 'DONE' : clock}</Text>
            </View>
          )}

          {status === 'error' ? (
            <View style={{ gap: 10 }}>
              {action && (
                <TouchableOpacity style={[s.retry, s.action]} onPress={action.onPress}>
                  <Text style={s.retryText}>{action.label}</Text>
                </TouchableOpacity>
              )}
              {onRetry && (
                <TouchableOpacity style={[s.retry, action && s.retrySecondary]} onPress={onRetry}>
                  <Text style={[s.retryText, action && { color: '#fff' }]}>Try again</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <Timeline steps={steps} />
          )}
        </View>

        {footnote ? <Text style={s.footnote}>{footnote}</Text> : null}
      </View>
    </View>
  );
}

// Ett varv tar så här lång tid (ms). Myntet snurrar jämnt och långsamt hela tiden.
const SPIN_MS = 5000;

// Blade-myntet: snurrar konstant och långsamt runt den lodräta axeln, och bromsar mjukt in till framsidan
// när arbetet är klart. Platt teknik i stället för 3D: bredden följer cos(vinkel) — så ser ett snurrande mynt
// ut framifrån — och är negativ på baksidan, som då visas spegelvänd. Lite skugga när det vänds och kanten när
// det står på högkant. (En 3D-rotation med perspektiv på iOS skar bort halva skärmen runt myntet.)
export function BladeCoin({ status }: { status: ProgressStatus }) {
  const turn = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const busy = status === 'busy';

  // Jämn snurr (linjär). Varvets början och slut ser likadana ut, så varven går ihop utan ryck. Effekten hänger
  // bara på busy, så bytet "hitta boken" → "läsa" startar inte om snurren.
  useEffect(() => {
    if (!busy) return;
    turn.setValue(0);
    const spin = Animated.loop(Animated.timing(turn, { toValue: 1, duration: SPIN_MS, easing: Easing.linear, useNativeDriver: true }));
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    spin.start(); pulse.start();
    return () => { spin.stop(); pulse.stop(); };
  }, [busy, turn, glow]);

  // Klart (eller fel): fortsätt framåt och bromsa mjukt tills framsidan syns igen (helt varv; halva varv är
  // baksidan, som är spegelvänd), utan att backa. Bocken poppar fram när läsningen lyckats.
  useEffect(() => {
    if (busy) return;
    turn.stopAnimation((v) => {
      const target = Math.ceil(v - 0.001);
      const duration = Math.min(1800, Math.max(300, 2 * (target - v) * SPIN_MS));
      Animated.timing(turn, { toValue: target, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
    if (status === 'done') Animated.spring(check, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }).start();
  }, [busy, status, turn, check]);

  // Myntet sett framifrån medan det vrids runt den lodräta axeln (vinkel θ = varv · 360°). Fram- och baksidan
  // är två lager med kanten emellan, som på ett riktigt mynt: framsidan förskjuts åt ena hållet och baksidan
  // åt det andra (± tjockleken/2 · sin θ), och kantlagren fyller avståndet. Den sida som vetter mot oss syns
  // (framsidan när cos θ > 0, baksidan spegelvänd annars). Då ligger kanten först på ena sidan av framsidan
  // och sedan på andra sidan av baksidan, så att myntet ser ut att fortsätta runt i stället för att vända.
  // Kurvorna samplas i 32 steg per varv (nativa interpoleringar är styckvis linjära).
  const steps = Array.from({ length: 33 }, (_, i) => i / 32);
  const c = (t: number) => Math.cos(t * 2 * Math.PI);
  const sn = (t: number) => Math.sin(t * 2 * Math.PI);
  const curve = (f: (t: number) => number) => turn.interpolate({ inputRange: steps, outputRange: steps.map(f) });
  const width = curve((t) => Math.max(0.001, Math.abs(c(t))));
  const widthMirrored = curve((t) => -Math.max(0.001, Math.abs(c(t))));
  const frontX = curve((t) => (EDGE / 2) * sn(t));
  const backX = curve((t) => -(EDGE / 2) * sn(t));
  // Vilken sida som syns byter exakt när myntet står på högkant (kvarts- och trekvartsvarv).
  const frontOpacity = turn.interpolate({ inputRange: [0, 0.25, 0.25001, 0.75, 0.75001, 1], outputRange: [1, 1, 0, 0, 1, 1] });
  const backOpacity = turn.interpolate({ inputRange: [0, 0.25, 0.25001, 0.75, 0.75001, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  // Kantlagren: jämnt fördelade mellan baksidan och framsidan, aldrig helt smala (då syns kanten som ett band).
  const rimWidth = curve((t) => Math.max(0.05, Math.abs(c(t))));
  const rim = Array.from({ length: RIM_LAYERS }, (_, k) => curve((t) => EDGE * sn(t) * ((k + 0.5) / RIM_LAYERS - 0.5)));
  const shade = curve((t) => 0.55 * (1 - Math.abs(c(t))));
  // Glansranden sveper över myntet en gång per halvvarv; syns mest när myntet vänds.
  const gleamX = turn.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [-COIN, COIN, -COIN, COIN] });
  const gleamOpacity = curve((t) => 0.15 + 0.6 * (1 - Math.abs(c(t))) * Math.abs(c(t)) * 2);

  const face = (x: Animated.AnimatedInterpolation<number>, w: Animated.AnimatedInterpolation<number>, opacity: Animated.AnimatedInterpolation<number>) => (
    <Animated.View pointerEvents="none" style={[s.face, { opacity, transform: [{ translateX: x }, { scaleX: w }] }]}>
      <Image source={BLADE_COIN} style={s.coinImage} resizeMode="contain" />
      <Animated.View style={[s.shade, { opacity: shade }]} />
      <View style={s.gleamClip}>
        <Animated.View style={[s.gleam, { opacity: gleamOpacity, transform: [{ translateX: gleamX }, { rotate: '20deg' }] }]}>
          <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </Animated.View>
  );

  return (
    <View style={s.coinWrap}>
      {/* Mjukt ljussken bakom myntet (tonar ut mot kanten), pulserar långsamt. */}
      <Animated.View pointerEvents="none" style={[s.halo, {
        opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] }) }],
      }]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="coinGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={status === 'done' ? Colors.success : Colors.primary} stopOpacity={0.45} />
              <Stop offset="0.55" stopColor={status === 'done' ? Colors.success : Colors.primary} stopOpacity={0.12} />
              <Stop offset="1" stopColor={status === 'done' ? Colors.success : Colors.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#coinGlow)" />
        </Svg>
      </Animated.View>
      {rim.map((tx, k) => (
        <Animated.View key={k} pointerEvents="none" style={[s.rim, { transform: [{ translateX: tx }, { scaleX: rimWidth }] }]}>
          <LinearGradient colors={['#5CC8FF', '#1E5FD0', '#0A2A6E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ))}
      {face(backX, widthMirrored, backOpacity)}
      {face(frontX, width, frontOpacity)}
      <Animated.View style={[s.check, { opacity: check, transform: [{ scale: check }] }]}>
        <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
      </Animated.View>
    </View>
  );
}

// Stegen som en tidslinje: klart (bock), pågår (pulserande punkt), väntar (ring).
function Timeline({ steps }: { steps: ProgressStep[] }) {
  return (
    <View style={s.timeline}>
      {steps.map(({ label: text, state: st }, i) => (
        <View key={text} style={s.tlRow}>
          <View style={s.tlRail}>
            <StepDot state={st} />
            {i < steps.length - 1 && <View style={[s.tlLine, st === 'done' && { backgroundColor: Colors.success + '88' }]} />}
          </View>
          <Text style={[s.tlText, st === 'active' && s.tlTextActive, st === 'done' && s.tlTextDone]}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

function StepDot({ state }: { state: StepState }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'active') return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);
  if (state === 'done') return <View style={[s.dot, s.dotDone]}><Ionicons name="checkmark" size={11} color={Colors.textInverse} /></View>;
  if (state === 'todo') return <View style={[s.dot, s.dotTodo]} />;
  return (
    <View style={s.dot}>
      <Animated.View style={[s.dotHalo, {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
      }]} />
      <View style={s.dotCore} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 28 },
  header: { flexDirection: 'row', minHeight: 38 },
  close: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(10,22,40,0.5)',
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  coinWrap: { width: COIN * 1.6, height: COIN * 1.6, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: COIN * 1.6, height: COIN * 1.6 },
  face: { position: 'absolute', width: COIN, height: COIN, alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', width: COIN * 0.84, height: COIN * 0.84, borderRadius: COIN * 0.42, backgroundColor: '#020814' },
  coinImage: { width: COIN, height: COIN },
  rim: { position: 'absolute', width: COIN * 0.84, height: COIN * 0.84, borderRadius: COIN * 0.42, overflow: 'hidden' },
  gleamClip: { position: 'absolute', width: COIN * 0.84, height: COIN * 0.84, borderRadius: COIN * 0.42, overflow: 'hidden' },
  gleam: { position: 'absolute', top: -COIN * 0.2, bottom: -COIN * 0.2, width: COIN * 0.35, left: COIN * 0.25 },

  check: {
    position: 'absolute', right: COIN * 0.5, bottom: COIN * 0.5, width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.success, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.background,
  },

  info: { gap: 8, paddingBottom: 18 },
  eyebrow: { color: Colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, fontFamily: MONO },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2, backgroundColor: Colors.primary, transformOrigin: 'left' },
  clock: { color: Colors.textSecondary, fontSize: 12, fontFamily: MONO, fontVariant: ['tabular-nums'], minWidth: 38, textAlign: 'right' },

  timeline: { marginTop: 14 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 34 },
  tlRail: { width: 18, alignItems: 'center' },
  tlLine: { width: 1.5, flex: 1, minHeight: 16, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 2 },
  tlText: { color: Colors.textMuted, fontSize: 15, fontWeight: '600', marginTop: -1 },
  tlTextActive: { color: '#fff' },
  tlTextDone: { color: Colors.textSecondary },
  dot: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  dotDone: { borderRadius: 9, backgroundColor: Colors.success },
  dotTodo: { borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)' },
  dotCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  dotHalo: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.primary },

  retry: { marginTop: 14, height: 50, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
  action: { backgroundColor: Colors.gold },
  retrySecondary: { marginTop: 0, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  footnote: { color: Colors.textMuted, fontSize: 12, textAlign: 'center' },
});
