// Designens "Max FL/alt" — rektangulär barometer man drar i (vänster/höger) + −/+ knappar.
// Generisk: arbetar i värdets egen enhet (pilot: fot, visas som FL; drönare: meter). Drag snappar
// till dragStep, −/+ finjusterar i fineStep; min/max i samma enhet. Visning via toDisplay + unit.
//
// PRESTANDA: dragningen (fyllning + handtag) körs på UI-tråden via reanimated + gesture-handler
// → mjukt även när JS-tråden är upptagen. onChange (setForm) anropas bara vid bucketbyte.
import { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';
import { FONT_LED7 } from './tokens';

export function MaxAltBar({
  value, onChange, onGrab, onRelease,
  min = 3000, max = 60000, dragStep = 500, fineStep = 500,
  label = 'Max FL', unit = 'FL', unitBefore = true, toDisplay,
}: {
  value: number; onChange: (v: number) => void; onGrab?: () => void; onRelease?: () => void;
  min?: number; max?: number; dragStep?: number; fineStep?: number;
  label?: string; unit?: string; unitBefore?: boolean; toDisplay?: (v: number) => string;
}) {
  const RANGE = Math.max(1, max - min);
  const clampV = (v: number) => Math.max(min, Math.min(max, v));
  const width = useSharedValue(0);
  const sv = useSharedValue(clampV(value)); // live-värde (UI-tråd)
  const dragging = useSharedValue(false);
  const lastBucket = useSharedValue(-1);
  const propAlt = clampV(value);
  const alt = Math.round(propAlt / fineStep) * fineStep; // rent stegat värde (React, uppdateras vid commit)
  const shown = toDisplay ? toDisplay(alt) : String(Math.round(alt / 100));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  useEffect(() => { if (!dragging.value) sv.value = propAlt; }, [propAlt, dragging, sv]);

  const commit = (raw: number) => onChange(clampV(Math.round(raw / dragStep) * dragStep));
  const step = (d: number) => onChange(clampV(Math.round(propAlt / fineStep) * fineStep + d * fineStep));

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart(() => { 'worklet'; dragging.value = true; lastBucket.value = -1; if (onGrab) runOnJS(onGrab)(); })
    .onUpdate((e) => {
      'worklet';
      const raw = Math.max(min, Math.min(max, min + (e.x / (width.value || 1)) * RANGE));
      sv.value = raw;
      const b = Math.round(raw / dragStep) * dragStep;
      if (b !== lastBucket.value) { lastBucket.value = b; runOnJS(commit)(raw); }
    })
    .onEnd(() => { 'worklet'; runOnJS(commit)(sv.value); })
    .onFinalize(() => { 'worklet'; if (dragging.value) { dragging.value = false; if (onRelease) runOnJS(onRelease)(); } });

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e) => {
      'worklet';
      const raw = Math.max(min, Math.min(max, min + (e.x / (width.value || 1)) * RANGE));
      sv.value = raw;
      runOnJS(commit)(raw);
    });
  const gesture = Gesture.Race(pan, tap);

  const fillStyle = useAnimatedStyle(() => ({ width: `${((sv.value - min) / RANGE) * 100}%` }));
  const handleStyle = useAnimatedStyle(() => {
    const wpx = width.value;
    return { left: Math.max(0, Math.min(wpx - 3, ((sv.value - min) / RANGE) * wpx - 1.5)) };
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 }}>
      <Text style={{ width: 70, fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.textSecondary }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {/* barometer-kolumn — dra för att ställa (UI-tråd) */}
        <GestureDetector gesture={gesture}>
          <Animated.View
            onLayout={(e) => { width.value = e.nativeEvent.layout.width; }}
            hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
            style={{ position: 'relative', flex: 1, height: 28, borderRadius: 7, overflow: 'hidden', backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border }}
          >
            <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: Colors.primary, opacity: 0.5 }, fillStyle]} />
            {ticks.map((tk, i) => (
              <View key={i} style={{ position: 'absolute', top: 4, bottom: 4, left: `${tk * 100}%`, width: 1, marginLeft: -0.5, backgroundColor: Colors.textPrimary, opacity: 0.16 }} />
            ))}
            <Animated.View style={[{ position: 'absolute', top: -1, bottom: -1, width: 3, backgroundColor: '#F4FAFF', shadowColor: Colors.primary, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 }, elevation: 4 }, handleStyle]} />
            {/* Värdet vertikalt centrerat via flex. */}
            <View pointerEvents="none" style={{ position: 'absolute', right: 9, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' }}>
              {unitBefore ? <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textSecondary, marginRight: 3 }}>{unit}</Text> : null}
              <Text style={{ fontFamily: FONT_LED7, fontSize: 14, fontWeight: '700', color: '#F4FAFF' }}>{shown}</Text>
              {!unitBefore ? <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textSecondary, marginLeft: 3 }}>{unit}</Text> : null}
            </View>
          </Animated.View>
        </GestureDetector>
        {/* −/+ (finjustering i fineStep) */}
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <TouchableOpacity onPress={() => step(-1)} activeOpacity={0.6} style={{ width: 32, height: 28, borderRadius: 7, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="remove" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => step(1)} activeOpacity={0.6} style={{ width: 32, height: 28, borderRadius: 7, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={20} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
