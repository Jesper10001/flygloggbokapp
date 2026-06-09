// Wrapped story engine — progress-bar header, auto-advance timer, tap zones,
// press-and-hold to pause. One chapter mounted at a time so entrance animations
// fire. RN port of the prototype story.jsx. Pilot-manned only (route-gated).

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, Image, Animated, Easing,
  ActivityIndicator, AccessibilityInfo,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WC, SERIF, MONO, Rise, ChapterBG, setWrappedReduced } from './WrappedKit';
import { getChapters, type ChapterDef } from './chapters';
import { loadWrappedData, type WrappedData } from './wrappedData';

const ACCENT = WC.primary; // editorial + cyan (shipped variant)

export function WrappedStories({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<WrappedData | null>(null);
  const [chapters, setChapters] = useState<ChapterDef[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const valRef = useRef(0);

  // Load data + reduced-motion flag once.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => setWrappedReduced(!!r)).catch(() => {});
    loadWrappedData()
      .then((d) => { if (!alive) return; setData(d); setChapters(getChapters(d)); })
      .catch(() => { if (alive) { setData(null); onClose(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = progress.addListener(({ value }) => { valRef.current = value; });
    return () => progress.removeListener(id);
  }, [progress]);

  const count = chapters.length;
  const safe = Math.min(index, Math.max(0, count - 1));
  const chapter = chapters[safe];
  const dur = chapter ? chapter.dur + 5000 : 5000; // each slide lingers +5s

  const next = useCallback(() => {
    setIndex((i) => { if (i >= count - 1) { setDone(true); return i; } return i + 1; });
  }, [count]);
  const prev = useCallback(() => { setDone(false); setIndex((i) => Math.max(0, i - 1)); }, []);
  const restart = useCallback(() => { setDone(false); setIndex(0); }, []);

  // Reset the active bar whenever the chapter changes.
  useEffect(() => { progress.setValue(0); valRef.current = 0; }, [safe, progress]);

  // Auto-advance driver: animate the active bar 0→1 over `dur`; advance on finish.
  useEffect(() => {
    if (!chapter || done || paused) return;
    const remaining = dur * (1 - valRef.current);
    const anim = Animated.timing(progress, {
      toValue: 1, duration: Math.max(0, remaining), easing: Easing.linear, useNativeDriver: false,
    });
    anim.start(({ finished }) => { if (finished) next(); });
    return () => { anim.stop(); };
  }, [safe, paused, done, chapter, dur, progress, next]);

  // Hold-to-pause + tap-to-navigate.
  const holdRef = useRef<{ t: ReturnType<typeof setTimeout> | null; held: boolean }>({ t: null, held: false });
  const onPressIn = () => {
    holdRef.current.held = false;
    holdRef.current.t = setTimeout(() => { holdRef.current.held = true; setPaused(true); }, 220);
  };
  const onPressOut = (dir: 'prev' | 'next') => {
    if (holdRef.current.t) { clearTimeout(holdRef.current.t); holdRef.current.t = null; }
    if (holdRef.current.held) { setPaused(false); return; }
    if (dir === 'prev') prev(); else next();
  };

  if (!data || !chapter) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const Comp = chapter.Comp;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* chapter (remounts on key → entrance anims fire) */}
      {!done && <Comp key={chapter.key} active accent={ACCENT} data={data} />}

      {/* end card */}
      {done && <EndCard accent={ACCENT} onRestart={restart} />}

      {/* top scrim for bar/header legibility */}
      <View style={[styles.topScrim, { height: insets.top + 70 }]} pointerEvents="none" />

      {!done && (
        <>
          {/* progress bars */}
          <View style={[styles.bars, { top: insets.top + 6 }]} pointerEvents="none">
            {chapters.map((c, i) => (
              <View key={c.key} style={styles.barTrack}>
                {i < safe && <View style={[styles.barFill, { width: '100%', backgroundColor: ACCENT }]} />}
                {i === safe && <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: ACCENT }]} />}
              </View>
            ))}
          </View>

          {/* header: brand + close */}
          <View style={[styles.header, { top: insets.top + 18 }]}>
            <Image source={require('../../assets/floating-bladesjointlogbook.png')} style={styles.lockup} resizeMode="contain" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: paused ? ACCENT : WC.muted }}>
                {paused ? 'PAUSED' : 'WRAPPED'}
              </Text>
              <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                <Text style={{ color: WC.text2, fontSize: 14, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* tap zones */}
          <Pressable style={[styles.zone, { left: 0, width: '30%', top: insets.top + 52 }]} onPressIn={onPressIn} onPressOut={() => onPressOut('prev')} />
          <Pressable style={[styles.zone, { right: 0, width: '70%', top: insets.top + 52 }]} onPressIn={onPressIn} onPressOut={() => onPressOut('next')} />
        </>
      )}
    </View>
  );
}

function EndCard({ accent, onRestart }: { accent: string; onRestart: () => void }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <ChapterBG accent={accent} />
      <View style={[StyleSheet.absoluteFill, styles.center, { gap: 22, padding: 28 }]}>
        <Rise show delay={100}>
          <Image source={require('../../assets/blades-mark.png')} style={{ width: 180, height: 189 }} resizeMode="contain" />
        </Rise>
        <Rise show delay={250}>
          <Text style={{ fontFamily: SERIF, fontSize: 38, fontWeight: '400', letterSpacing: -0.6, color: WC.text, textAlign: 'center' }}>
            That's your logbook.
          </Text>
        </Rise>
        <Rise show delay={420}>
          <Pressable onPress={onRestart} style={styles.againBtn}>
            <Text style={{ color: WC.text2, fontSize: 14, fontWeight: '600' }}>↺ Watch again</Text>
          </Pressable>
        </Rise>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: WC.bgDeep, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: WC.bgDeep, opacity: 0.55, zIndex: 4 },
  bars: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', gap: 4, zIndex: 6 },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  header: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 6 },
  lockup: { height: 40, width: 210 },
  closeBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  zone: { position: 'absolute', bottom: 0, zIndex: 5 },
  againBtn: { paddingVertical: 13, paddingHorizontal: 22, borderRadius: 999, borderWidth: 1, borderColor: WC.border },
});
