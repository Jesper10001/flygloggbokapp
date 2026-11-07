// Loggboken som öppnar sig och bläddrar själv, som på hemsidan (website-v4/js/bookflip.js): en pappersloggbok med
// sidor renderade av appens egen kod (demologgboken, assets/logbook-demo). Omslaget öppnas och innehållssidan och fyra
// uppslag bläddras fram till det senaste, där boken blir liggande (ingen inzoomning och ingen bläddring för hand).
// Boken ritas i sin öppna storlek (skala 1 och hela pixlar när den ligger öppen), så att sidorna blir skarpa; bara den
// stängda boken är förstorad. Används på Your books innan man har en bok (app/logbook/index.tsx Intro). Med reducerad
// rörelse visas uppslaget direkt.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Image, StyleSheet, type ImageSourcePropType } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion, type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT_SERIF } from '../logbook-page/tokens';

// Demologgbokens sidor i öppningen (uppslagen 71–80, senaste flygningen på uppslaget 79–80).
const PAGE: Record<number, ImageSourcePropType> = {
  71: require('../../assets/logbook-demo/pilot-71.webp'), 72: require('../../assets/logbook-demo/pilot-72.webp'),
  73: require('../../assets/logbook-demo/pilot-73.webp'), 74: require('../../assets/logbook-demo/pilot-74.webp'),
  75: require('../../assets/logbook-demo/pilot-75.webp'), 76: require('../../assets/logbook-demo/pilot-76.webp'),
  77: require('../../assets/logbook-demo/pilot-77.webp'), 78: require('../../assets/logbook-demo/pilot-78.webp'),
  79: require('../../assets/logbook-demo/pilot-79.webp'), 80: require('../../assets/logbook-demo/pilot-80.webp'),
};
const TOC = require('../../assets/logbook-demo/pilot-toc.webp');
const MARK = require('../../assets/blades-mark.png');
const SPREADS = [71, 73, 75, 77, 79];
const LATEST = SPREADS.indexOf(79);
const LEAVES = 5;                // sidor som bläddras när boken öppnas: innehållet och de fyra uppslagen före det senaste
const OPEN_MS = 4960;            // från stängd bok till senaste uppslaget
const FLIPPED = 0.8;
const CLOSED = 1 / 0.92;         // den stängda boken är lite större än den öppna
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
  const reduce = useReducedMotion();
  const W = Math.floor((width - 28) / 2) * 2;  // sidornas bredd, jämn så att mitten hamnar på en hel pixel
  const H = Math.round(W * RATIO);
  const H0 = Math.round(H * 1.12 + 22);       // scenens höjd med hela boken
  const left = Math.round((width - W) / 2);
  const top = Math.round((H0 - H) / 2);

  const p = useSharedValue(reduce ? FLIPPED : 0);   // öppningen 0 → 0.8
  const [open, setOpen] = useState(!!reduce);        // boken ligger öppen på senaste uppslaget
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (reduce) return;
    const lead = 450;
    p.value = withDelay(lead, withTiming(FLIPPED, { duration: OPEN_MS, easing: Easing.linear }));
    timer.current = setTimeout(() => setOpen(true), lead + OPEN_MS + 30);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Boken: den stängda boken (omslaget) i mitten, glider till sin plats när den öppnas ──
  const bookStyle = useAnimatedStyle(() => {
    const o = leafR(0, p.value);
    const sc = CLOSED + o * (1 - CLOSED);                  // 1 när boken ligger öppen
    return o >= 1 ? { transform: [{ translateX: 0 }, { scale: 1 }] } : { transform: [{ translateX: -0.25 * W * (1 - o) * sc }, { scale: sc }] };
  });
  const landedStyle = useAnimatedStyle(() => ({ opacity: clamp((leafR(0, p.value) - 0.9) / 0.1) }));
  const foldStyle = useAnimatedStyle(() => ({ opacity: leafR(0, p.value) }));
  const shadowStyle = useAnimatedStyle(() => {
    const open = leafR(0, p.value);
    return { transform: [{ translateX: (1 - open) * 0.22 * W }, { scaleX: 0.55 + open * 0.45 }] };
  });

  // Bredd och höjd uttryckligen: utan dem får Image bildfilens egna mått (1280 × 928 px) och sidan visas inzoomad.
  const pageImg = (src: ImageSourcePropType) => <Image source={src} style={s.pageImg} resizeMode="stretch" />;
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

  return (
    <View style={{ width, alignSelf: 'center' }}>
      <View style={{ width, height: H0, overflow: 'hidden' }} pointerEvents="none"
        accessible accessibilityRole="image" accessibilityLabel="Example logbook opening at the page with the latest flights">
        <Animated.View style={[{ position: 'absolute', left, top, width: W, height: H }, bookStyle]}>
          {/* Skugga under boken */}
          <Animated.View style={[s.shadow, { left: W * 0.06, right: W * 0.06, bottom: -H * 0.12, height: H * 0.14 }, shadowStyle]}>
            <LinearGradient colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']} style={StyleSheet.absoluteFill} />
          </Animated.View>
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
            {pageImg(R(LATEST))}{gutter('left')}
          </View>
          {!open ? (
            leaves.map((lf, i) => <Leaf key={i} i={i} p={p} W={W} H={H} front={lf.front} back={lf.back} />)
          ) : (
            // Öppen: vänstersidan ligger platt (ingen 3D-transform), lika skarp som högersidan.
            <View style={[s.paper, { position: 'absolute', left: 0, top: 0, width: W / 2, height: H }]}>
              {pageImg(L(LATEST))}{gutter('right')}
            </View>
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
    // Ett blad som ligger still ritas platt (ingen perspektiv-transform), så att sidan blir skarp: orört = som det är,
    // vänt = speglat runt ryggen. Bara bladet som vänds just nu får 3D.
    const transform = r <= 0 ? [{ translateX: 0 }, { scaleX: 1 }]
      : r >= 1 ? [{ translateX: -W / 2 }, { scaleX: -1 }]
      : [{ perspective: 2000 }, { translateX: -W / 4 }, { rotateY: `${-180 * r}deg` }, { translateX: W / 4 }];
    return { zIndex: r > 0.5 ? 10 + i : 40 - i, transform };
  });
  const frontStyle = useAnimatedStyle(() => ({ opacity: leafR(i, p.value) < 0.5 ? 1 : 0 }));
  const backStyle = useAnimatedStyle(() => ({ opacity: leafR(i, p.value) < 0.5 ? 0 : 1 }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: Math.sin(leafR(i, p.value) * Math.PI) * 0.5 }));
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
  shadow: { position: 'absolute', borderRadius: 999, overflow: 'hidden' },
  pageImg: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  cover: { borderTopRightRadius: 8, borderBottomRightRadius: 8, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, overflow: 'hidden' },
  hinge: { position: 'absolute', top: 0, bottom: 0, left: '6%', width: 2, backgroundColor: 'rgba(0,0,0,0.45)' },
  coverIn: { position: 'absolute', top: '8%', bottom: '8%', left: '11%', right: '7%', borderWidth: 1.2, borderColor: 'rgba(212,180,106,0.7)', borderRadius: 4, alignItems: 'center', justifyContent: 'center', gap: 6 },
  coverTitle: { fontFamily: FONT_SERIF, fontWeight: '600', letterSpacing: 2, color: GOLD, textAlign: 'center' },
  coverSub: { fontWeight: '700', letterSpacing: 3, color: GOLD, opacity: 0.85 },
});
