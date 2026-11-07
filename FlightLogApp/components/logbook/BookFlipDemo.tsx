// Loggboken som öppnar sig och bläddrar själv, som på hemsidan (website-v4/js/bookflip.js): en pappersloggbok med
// sidor renderade av appens egen kod (demologgboken, assets/logbook-demo). Omslaget öppnas och innehållssidan och fyra
// uppslag bläddras fram till det senaste (ingen inzoomning, till skillnad från hemsidan i mobilen). Sedan går boken att
// bläddra i: ett tryck på högersidan bläddrar framåt, på vänstersidan bakåt, eller ett svep.
// Används på Your books innan man har en bok (app/logbook/index.tsx Intro). Med reducerad rörelse visas uppslaget direkt.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Image, StyleSheet, PanResponder, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, cancelAnimation, Easing, useReducedMotion, type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT_SERIF } from '../logbook-page/tokens';

// Demologgbokens sidor (vänstersidorna 71–85, senaste flygningen på uppslaget 79–80).
const PAGE: Record<number, ImageSourcePropType> = {
  71: require('../../assets/logbook-demo/pilot-71.webp'), 72: require('../../assets/logbook-demo/pilot-72.webp'),
  73: require('../../assets/logbook-demo/pilot-73.webp'), 74: require('../../assets/logbook-demo/pilot-74.webp'),
  75: require('../../assets/logbook-demo/pilot-75.webp'), 76: require('../../assets/logbook-demo/pilot-76.webp'),
  77: require('../../assets/logbook-demo/pilot-77.webp'), 78: require('../../assets/logbook-demo/pilot-78.webp'),
  79: require('../../assets/logbook-demo/pilot-79.webp'), 80: require('../../assets/logbook-demo/pilot-80.webp'),
  81: require('../../assets/logbook-demo/pilot-81.webp'), 82: require('../../assets/logbook-demo/pilot-82.webp'),
  83: require('../../assets/logbook-demo/pilot-83.webp'), 84: require('../../assets/logbook-demo/pilot-84.webp'),
  85: require('../../assets/logbook-demo/pilot-85.webp'), 86: require('../../assets/logbook-demo/pilot-86.webp'),
};
const TOC = require('../../assets/logbook-demo/pilot-toc.webp');
const MARK = require('../../assets/blades-mark.png');
const SPREADS = [71, 73, 75, 77, 79, 81, 83, 85];
const LATEST = SPREADS.indexOf(79);
const LEAVES = 5;                // sidor som bläddras när boken öppnas: innehållet och de fyra uppslagen före det senaste
const OPEN_MS = 4960;            // från stängd bok till senaste uppslaget
const FLIPPED = 0.8;
const FIT = 0.92;                // bokens storlek när den ligger öppen
const BOARD = 0.516;             // halva boken med pärmar, som andel av sidornas bredd
const RATIO = 928 / 2560;        // uppslagets höjd / bredd (sidbilderna är 1280 × 928)
const GOLD = '#D4B46A';

const clamp = (v: number, a = 0, b = 1) => { 'worklet'; return Math.min(b, Math.max(a, v)); };
const ease = (x: number) => { 'worklet'; return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2; };
// Hur långt blad i har vänt (0–1) vid öppningens tidpunkt p: omslaget först, innehållssidan hålls en stund.
const leafR = (i: number, p: number) => {
  'worklet';
  if (i === 0) return ease(clamp(p / 0.21));
  const start = i === 1 ? 0.25 : 0.34 + (i - 2) * 0.097;
  return ease(clamp((p - start) / 0.17));
};
const L = (i: number) => PAGE[SPREADS[i]];
const R = (i: number) => PAGE[SPREADS[i] + 1];

export function BookFlipDemo({ width }: { width: number }) {
  const { width: winW } = useWindowDimensions();
  const reduce = useReducedMotion();
  const W = width - 40;                       // sidornas bredd (scenen är skärmbred, boken har luft runt sig)
  const H = Math.round(W * RATIO);
  const H0 = Math.round(H * 1.16 + 18);       // scenens höjd med hela boken

  const p = useSharedValue(0);                // öppningen 0 → 0.8
  const t = useSharedValue(0);                // bladet som vänds för hand
  const [mode, setMode] = useState<'opening' | 'browse'>(reduce ? 'browse' : 'opening');
  const [idx, setIdx] = useState(LATEST);   // uppslaget som ligger öppet
  const [leftIdx, setLeftIdx] = useState(LATEST);     // uppslaget vars vänstersida ligger öppen
  const [rightIdx, setRightIdx] = useState(LATEST);   // och högersida
  const [turn, setTurn] = useState<{ front: ImageSourcePropType; back: ImageSourcePropType } | null>(null);
  const turning = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  const toBrowse = () => {
    clearTimers();
    cancelAnimation(p);
    p.value = FLIPPED;
    setMode('browse');
  };
  const play = () => {
    clearTimers();
    turning.current = false;
    setTurn(null);
    setIdx(LATEST); setLeftIdx(LATEST); setRightIdx(LATEST);
    if (reduce) { p.value = FLIPPED; setMode('browse'); return; }
    setMode('opening');
    p.value = 0;
    const lead = 450;
    p.value = withDelay(lead, withTiming(FLIPPED, { duration: OPEN_MS, easing: Easing.linear }));
    timers.current.push(setTimeout(() => setMode('browse'), lead + OPEN_MS + 30));
  };
  useEffect(() => { play(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bläddra: framåt lyfter högersidan, bakåt vänstersidan; sidorna under syns redan.
  const turnPage = (dir: 1 | -1) => {
    if (turning.current) return;
    const to = idx + dir;
    if (to < 0 || to >= SPREADS.length) return;
    turning.current = true;
    setTurn(dir > 0 ? { front: R(idx), back: L(to) } : { front: R(to), back: L(idx) });
    if (dir > 0) setRightIdx(to); else setLeftIdx(to);
    t.value = dir > 0 ? 0 : 1;
    t.value = withTiming(dir > 0 ? 1 : 0, { duration: 620, easing: Easing.inOut(Easing.quad) });
    timers.current.push(setTimeout(() => {
      setIdx(to); setLeftIdx(to); setRightIdx(to); setTurn(null); turning.current = false;
    }, 650));
  };

  // Ett tryck eller ett svep på boken (scenen är centrerad på skärmen). Under öppningen: hoppa fram till uppslaget.
  const handlers = useRef({ release: (_x0: number, _dx: number, _dy: number) => {} });
  handlers.current.release = (x0, dx, dy) => {
    if (mode === 'opening') { toBrowse(); return; }
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) { turnPage(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) turnPage(x0 > winW / 2 ? 1 : -1);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: (_, g) => { handlers.current.release(g.x0, g.dx, g.dy); },
  })).current;

  // ── Boken: den stängda boken (omslaget) i mitten, glider till sin plats när den öppnas ──
  const bookStyle = useAnimatedStyle(() => {
    const open = leafR(0, p.value);
    const fz = 1 + open * (FIT - 1);                       // den stängda boken är lite större
    return { transform: [{ translateX: -0.25 * W * (1 - open) * fz }, { scale: fz }] };
  });
  const landedStyle = useAnimatedStyle(() => ({ opacity: clamp((leafR(0, p.value) - 0.9) / 0.1) }));
  const foldStyle = useAnimatedStyle(() => ({ opacity: leafR(0, p.value) }));
  const shadowStyle = useAnimatedStyle(() => {
    const open = leafR(0, p.value);
    return { transform: [{ translateX: (1 - open) * 0.22 * W }, { scaleX: 0.55 + open * 0.45 }] };
  });

  const pageImg = (src: ImageSourcePropType) => <Image source={src} style={StyleSheet.absoluteFill} resizeMode="stretch" />;
  const gutter = (side: 'left' | 'right') => (
    <LinearGradient pointerEvents="none" colors={['rgba(70,48,14,0.42)', 'rgba(70,48,14,0)']} start={{ x: side === 'left' ? 0 : 1, y: 0.5 }} end={{ x: side === 'left' ? 0.14 : 0.86, y: 0.5 }} style={StyleSheet.absoluteFill} />
  );
  const cover = (
    <LinearGradient colors={['#1d355d', '#10203d', '#0b1730']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[StyleSheet.absoluteFill, s.cover]}>
      <View style={s.hinge} />
      <View style={s.coverIn}>
        <Image source={MARK} style={{ width: H * 0.16, height: H * 0.16 * (686 / 654), tintColor: GOLD, opacity: 0.9 }} resizeMode="contain" />
        <Text style={[s.coverTitle, { fontSize: Math.max(10, H * 0.085) }]}>PILOT{'\n'}LOGBOOK</Text>
        <Text style={[s.coverSub, { fontSize: Math.max(6.5, H * 0.036) }]}>BLADES</Text>
      </View>
    </LinearGradient>
  );
  const endpaper = <LinearGradient colors={['#0b1730', '#15294b']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />;

  // Bladen i öppningen: blad i visar högersidan av uppslaget före (blad 1: innehållet) och sitt eget uppslags vänstersida.
  const leaves = Array.from({ length: LEAVES + 1 }, (_, i) => {
    if (i === 0) return { front: cover, back: endpaper };
    const sp = LATEST - LEAVES + i;
    return {
      front: <View style={[StyleSheet.absoluteFill, s.paper]}>{pageImg(i === 1 ? TOC : R(sp - 1))}{gutter('left')}</View>,
      back: <View style={[StyleSheet.absoluteFill, s.paper]}>{pageImg(L(sp))}{gutter('right')}</View>,
    };
  });

  const pages = SPREADS[idx];
  return (
    <View style={{ width, alignSelf: 'center' }}>
      <View style={{ width, height: H0, overflow: 'hidden' }} {...pan.panHandlers}
        accessible accessibilityRole="adjustable"
        accessibilityLabel={`Example logbook, pages ${pages} to ${pages + 1}. Swipe up or down to turn the pages.`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => { if (mode === 'opening') toBrowse(); else turnPage(e.nativeEvent.actionName === 'increment' ? 1 : -1); }}>
        <Animated.View style={[{ position: 'absolute', left: (width - W) / 2, top: (H0 - H) / 2, width: W, height: H }, bookStyle]}>
          {/* Skugga under boken */}
          <Animated.View style={[s.shadow, { left: W * 0.06, right: W * 0.06, bottom: -H * 0.1, height: H * 0.14 }, shadowStyle]} />
          {/* Pärmarna: den högra syns hela tiden, den vänstra när omslaget lagt sig */}
          <LinearGradient colors={['#1d355d', '#10203d', '#0b1730']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
            style={[s.board, { left: W / 2, width: W * BOARD, top: -H * 0.018, bottom: -H * 0.026, borderTopRightRadius: 8, borderBottomRightRadius: 8 }]} />
          <Animated.View style={[s.board, { right: W / 2, width: W * BOARD, top: -H * 0.018, bottom: -H * 0.026, overflow: 'hidden', borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }, landedStyle]}>
            <LinearGradient colors={['#0b1730', '#10203d', '#1d355d']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
          {/* De vända sidornas kanter till vänster, de kommande till höger */}
          <Animated.View style={[s.block, { left: -2, top: 1, width: W / 2, height: H }, landedStyle]} />
          <View style={[s.block, { left: W / 2 + 2, top: 1.5, width: W / 2, height: H }]} />
          {/* Högersidan som ligger öppen under bladen */}
          <View style={[s.paper, { position: 'absolute', left: W / 2, top: 0, width: W / 2, height: H }]}>
            {pageImg(R(mode === 'browse' ? rightIdx : LATEST))}{gutter('left')}
          </View>
          {mode === 'opening' ? (
            leaves.map((lf, i) => <Leaf key={i} i={i} p={p} W={W} H={H} front={lf.front} back={lf.back} />)
          ) : (
            <>
              {/* Vänstersidan som ligger öppen */}
              <View style={[s.paper, { position: 'absolute', left: 0, top: 0, width: W / 2, height: H }]}>
                {pageImg(L(leftIdx))}{gutter('right')}
              </View>
              {turn && (
                <TurnLeaf t={t} W={W} H={H}
                  front={<View style={[StyleSheet.absoluteFill, s.paper]}>{pageImg(turn.front)}{gutter('left')}</View>}
                  back={<View style={[StyleSheet.absoluteFill, s.paper]}>{pageImg(turn.back)}{gutter('right')}</View>} />
              )}
            </>
          )}
          {/* Vecket i mitten när boken ligger öppen */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: W / 2 - W * 0.02, width: W * 0.04, top: 0, bottom: 0, zIndex: 60 }, foldStyle]}>
            <LinearGradient colors={['rgba(40,26,6,0)', 'rgba(40,26,6,0.28)', 'rgba(40,26,6,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

function Leaf({ i, p, W, H, front, back }: { i: number; p: SharedValue<number>; W: number; H: number; front: ReactNode; back: ReactNode }) {
  const leafStyle = useAnimatedStyle(() => {
    const r = leafR(i, p.value);
    return {
      zIndex: r > 0.5 ? 10 + i : 40 - i,
      transform: [{ perspective: 2000 }, { translateX: -W / 4 }, { rotateY: `${-180 * r}deg` }, { translateX: W / 4 }],
    };
  });
  const frontStyle = useAnimatedStyle(() => ({ opacity: leafR(i, p.value) < 0.5 ? 1 : 0 }));
  const backStyle = useAnimatedStyle(() => ({ opacity: leafR(i, p.value) < 0.5 ? 0 : 1 }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: Math.sin(leafR(i, p.value) * Math.PI) * 0.5 }));
  return <Faces W={W} H={H} front={front} back={back} leafStyle={leafStyle} frontStyle={frontStyle} backStyle={backStyle} shadeStyle={shadeStyle} />;
}

function TurnLeaf({ t, W, H, front, back }: { t: SharedValue<number>; W: number; H: number; front: ReactNode; back: ReactNode }) {
  const leafStyle = useAnimatedStyle(() => ({
    zIndex: 50,
    transform: [{ perspective: 2000 }, { translateX: -W / 4 }, { rotateY: `${-180 * t.value}deg` }, { translateX: W / 4 }],
  }));
  const frontStyle = useAnimatedStyle(() => ({ opacity: t.value < 0.5 ? 1 : 0 }));
  const backStyle = useAnimatedStyle(() => ({ opacity: t.value < 0.5 ? 0 : 1 }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: Math.sin(t.value * Math.PI) * 0.5 }));
  return <Faces W={W} H={H} front={front} back={back} leafStyle={leafStyle} frontStyle={frontStyle} backStyle={backStyle} shadeStyle={shadeStyle} />;
}

function Faces({ W, H, front, back, leafStyle, frontStyle, backStyle, shadeStyle }: {
  W: number; H: number; front: ReactNode; back: ReactNode; leafStyle: any; frontStyle: any; backStyle: any; shadeStyle: any;
}) {
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: W / 2, top: 0, width: W / 2, height: H }, leafStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, frontStyle]}>{front}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scaleX: -1 }] }, backStyle]}>{back}</Animated.View>
      {/* Skugga mot ryggen och lite ljus på ytterkanten medan bladet vänds */}
      <Animated.View style={[StyleSheet.absoluteFill, shadeStyle]}>
        <LinearGradient colors={['rgba(0,0,0,0.34)', 'rgba(0,0,0,0)', 'rgba(255,255,255,0.16)']} locations={[0, 0.58, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  board: { position: 'absolute', borderRadius: 3 },
  block: { position: 'absolute', backgroundColor: '#d9ccae', borderRadius: 3 },
  paper: { backgroundColor: '#f5eedb', overflow: 'hidden' },
  shadow: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', shadowColor: '#000', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  cover: { borderTopRightRadius: 8, borderBottomRightRadius: 8, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, overflow: 'hidden' },
  hinge: { position: 'absolute', top: 0, bottom: 0, left: '6%', width: 2, backgroundColor: 'rgba(0,0,0,0.45)' },
  coverIn: { position: 'absolute', top: '8%', bottom: '8%', left: '11%', right: '7%', borderWidth: 1.2, borderColor: 'rgba(212,180,106,0.7)', borderRadius: 4, alignItems: 'center', justifyContent: 'center', gap: 6 },
  coverTitle: { fontFamily: FONT_SERIF, fontWeight: '600', letterSpacing: 2, color: GOLD, textAlign: 'center' },
  coverSub: { fontWeight: '700', letterSpacing: 3, color: GOLD, opacity: 0.85 },
});
