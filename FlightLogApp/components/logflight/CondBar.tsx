// Dragbar för en flygnings-andel (VFR/IFR/Night/NVG). Dra på spåret för att sätta andelen.
// Snäpper i 5-min-steg vid commit; fyllning över `warnAbove` blir röd.
//
// PRESTANDA: själva dragningen (fyllning + handtag) körs på UI-tråden via react-native-reanimated
// + gesture-handler → mjukt även när JS-tråden är upptagen (stort add.tsx-träd, Expo Go dev-läge).
// React-state (setForm) uppdateras bara när 5-min-bucketen byts, inte varje pixel.
import { useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';
import { FONT_LED7 } from './tokens';

const hm = (mins: number) => `${Math.floor(mins / 60)}:${String(Math.round(mins % 60)).padStart(2, '0')}`;

export function CondBar({ label, pct, onPct, tint, totalMin, readOnly, warnAbove, snaps, notches, autoLabel, bare, onReset, onGrab, onRelease,
  editable, timeValue, onTimeChange, onTimeBlur, onTimeFocus }: {
  label?: string;
  pct: number;
  onPct: (v: number) => void;
  tint: string;
  totalMin: number;
  readOnly?: boolean;
  warnAbove?: number;
  snaps?: number[];
  notches?: number[];
  autoLabel?: string;
  bare?: boolean; // bara spåret (utan etikett/hm/%-rad) — för att ersätta en slider i befintlig rad
  onReset?: () => void; // visas i headern (där auto-pillen satt) när värdet ändrats manuellt
  onGrab?: () => void;  // drag startar → lås skärm-scroll
  onRelease?: () => void; // fingret släpper → lås upp scroll
  editable?: boolean; // liten LED-tidsruta till höger om baren för att skriva in tid direkt
  timeValue?: string; // HH:MM (styrt)
  onTimeChange?: (raw: string) => void;
  onTimeBlur?: () => void;
  onTimeFocus?: () => void;
}) {
  const width = useSharedValue(0);      // spårets bredd (px) — sätts i onLayout
  const sv = useSharedValue(pct);       // live-% under dragning (UI-tråd)
  const dragging = useSharedValue(false);
  const lastBucket = useSharedValue(-1);
  const dangerCol = Colors.danger;
  const cap = warnAbove ?? 100;
  const snapsArr = snaps || [];

  // Synka visuellt värde från prop när användaren INTE drar (auto-uppdatering, redigering m.m.).
  useEffect(() => { if (!dragging.value) sv.value = pct; }, [pct, dragging, sv]);

  // JS: snäpp till 5-min-steg + detents och skicka till föräldern (setForm) — bara vid bucketbyte.
  const commit = (rawPct: number) => {
    if (!totalMin) { onPct(Math.round(rawPct)); return; }
    const stepPct = (5 / totalMin) * 100;
    let best = Math.round(rawPct / stepPct) * stepPct;
    [50, 100, ...snapsArr].forEach((e) => { if (Math.abs(rawPct - e) < Math.abs(rawPct - best)) best = e; });
    onPct(Math.max(0, Math.min(100, best)));
  };
  // UI-tråd: samma snäppning för att avgöra bucket (throttlar runOnJS till bucketbyten).
  const bucketOf = (raw: number) => {
    'worklet';
    if (!totalMin) return Math.round(raw);
    const stepPct = (5 / totalMin) * 100;
    let best = Math.round(raw / stepPct) * stepPct;
    for (const e of [50, 100, ...snapsArr]) { if (Math.abs(raw - e) < Math.abs(raw - best)) best = e; }
    return Math.max(0, Math.min(100, best));
  };

  const pan = Gesture.Pan()
    .enabled(!readOnly)
    .activeOffsetX([-6, 6])   // aktiveras vid horisontell rörelse …
    .failOffsetY([-12, 12])   // … men släpper igenom vertikal scroll
    .onStart(() => {
      'worklet';
      dragging.value = true;
      lastBucket.value = -1;
      if (onGrab) runOnJS(onGrab)();
    })
    .onUpdate((e) => {
      'worklet';
      const raw = Math.max(0, Math.min(100, (e.x / (width.value || 1)) * 100));
      sv.value = raw;
      const b = bucketOf(raw);
      if (b !== lastBucket.value) { lastBucket.value = b; runOnJS(commit)(raw); }
    })
    .onEnd(() => { 'worklet'; runOnJS(commit)(sv.value); })
    .onFinalize(() => {
      'worklet';
      if (dragging.value) { dragging.value = false; if (onRelease) runOnJS(onRelease)(); }
    });

  const tap = Gesture.Tap()
    .enabled(!readOnly)
    .maxDuration(250)
    .onEnd((e) => {
      'worklet';
      const raw = Math.max(0, Math.min(100, (e.x / (width.value || 1)) * 100));
      sv.value = raw;
      runOnJS(commit)(raw);
    });
  const gesture = Gesture.Race(pan, tap);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.min(sv.value, cap)}%` }));
  const overStyle = useAnimatedStyle(() => {
    const over = sv.value > cap;
    return { left: `${cap}%`, width: `${over ? sv.value - cap : 0}%`, opacity: over ? 0.7 : 0 };
  });
  const handleStyle = useAnimatedStyle(() => {
    const wpx = width.value;
    const left = Math.max(0, Math.min(wpx - 10, (sv.value / 100) * wpx - 5));
    return { left, backgroundColor: sv.value > cap ? dangerCol : tint };
  });

  const track = (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={(e) => { width.value = e.nativeEvent.layout.width; }}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
        style={{ flex: 1, position: 'relative', height: 20, borderRadius: 8, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', opacity: readOnly ? 0.9 : 1 }}
      >
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: tint, opacity: 0.5 }, fillStyle]} />
        <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, backgroundColor: dangerCol }, overStyle]} />
        {(notches || []).map((n, i) => (
          <View key={i} style={{ position: 'absolute', top: 2, bottom: 2, left: `${n}%`, width: 2, marginLeft: -1, backgroundColor: Colors.textPrimary, opacity: 0.4, borderRadius: 1 }} />
        ))}
        {!readOnly ? (
          <Animated.View style={[{ position: 'absolute', top: -2, bottom: -2, width: 10, borderRadius: 4, shadowColor: tint, shadowOpacity: 0.85, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 3 }, handleStyle]} />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );

  if (bare) return track;

  const mins = Math.round(totalMin * pct / 100);
  const over = !!warnAbove && pct > warnAbove; // för %-text + tidsrutans röda kant (commit-värdet)

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>{label}</Text>
          {autoLabel ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: Colors.success + '24', borderWidth: 1, borderColor: Colors.success + '66' }}>
              <Ionicons name="checkmark" size={8} color={Colors.success} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.success }}>{autoLabel}</Text>
            </View>
          ) : onReset ? (
            <TouchableOpacity onPress={onReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: Colors.gold + '22', borderWidth: 1, borderColor: Colors.gold + '7A' }}>
              <Ionicons name="refresh" size={8} color={Colors.gold} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.gold }}>auto</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted, width: 34, textAlign: 'right' }}>{Math.round(pct)}%</Text>
      </View>
      {/* spår + liten redigerbar LED-tidsruta till höger om barens slut (röd om över regeln) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {track}
        {editable ? (
          <View style={{ width: 58, height: 26, justifyContent: 'center', borderWidth: 1, borderColor: over ? Colors.danger : Colors.border, borderRadius: 6, backgroundColor: Colors.elevated, paddingHorizontal: 4 }}>
            <TextInput
              value={timeValue ?? ''}
              onChangeText={onTimeChange}
              onFocus={onTimeFocus}
              onBlur={onTimeBlur}
              placeholder="0:00"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              maxLength={5}
              style={{ textAlign: 'center', fontFamily: FONT_LED7, fontSize: 14, fontWeight: '700', color: over ? Colors.danger : tint, padding: 0 }}
            />
          </View>
        ) : (
          <Text style={{ width: 58, textAlign: 'center', fontFamily: FONT_LED7, fontSize: 14, fontWeight: '700', color: over ? Colors.danger : tint }}>{hm(mins)}</Text>
        )}
      </View>
    </View>
  );
}
