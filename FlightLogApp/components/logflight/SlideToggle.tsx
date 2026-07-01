// Segment-kontroll med glidande pill (fjädrande "hopp" + glow). Återanvänds för
// Quicklog↔Full, Real↔Sim och VFR/Y·Z/IFR — samma animerade design överallt.
// Pillen mäts per alternativ (onLayout) så den ligger exakt rätt oavsett etikett-
// längd och antal val; `block` ger lika breda val över full bredd.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing } from 'react-native';
import type { LayoutRectangle } from 'react-native';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

const PAD = 2;

export function SlideToggle<T extends string>({ options, value, onChange, activeColor, size = 'sm', block = false, sans = false }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  activeColor?: string;
  size?: 'sm' | 'md';
  block?: boolean;
  sans?: boolean; // använd systemets sans (samma som "Aircraft type"/"Registration") istället för mono
}) {
  const accent = activeColor || Colors.primary;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const [segs, setSegs] = useState<{ x: number; w: number }[]>([]);
  const cur = segs[idx];
  const animX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!cur) return;
    Animated.timing(animX, {
      toValue: cur.x,
      duration: 220,
      easing: Easing.bezier(0.4, 1.3, 0.5, 1), // lätt översläng → fjädrande hopp
      useNativeDriver: true,
    }).start();
  }, [cur?.x, animX]);

  const setSeg = (i: number, l: LayoutRectangle) => setSegs((p) => {
    if (p[i] && p[i].x === l.x && p[i].w === l.width) return p;
    const c = [...p]; c[i] = { x: l.x, w: l.width }; return c;
  });
  const fs = size === 'md' ? 12 : 9.5;
  const py = size === 'md' ? 8 : 4;

  return (
    <View style={{ position: 'relative', flexDirection: 'row', alignSelf: block ? 'stretch' : 'flex-start', backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, padding: PAD }}>
      {cur ? (
        <Animated.View style={{
          position: 'absolute', top: PAD, bottom: PAD, left: 0, width: cur.w, borderRadius: 6,
          backgroundColor: accent, transform: [{ translateX: animX }],
          shadowColor: accent, shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
        }} />
      ) : null}
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <TouchableOpacity key={o.value} onLayout={(e) => setSeg(i, e.nativeEvent.layout)} onPress={() => onChange(o.value)} activeOpacity={0.8}
            style={{ flex: block ? 1 : 0, paddingVertical: py, paddingHorizontal: block ? 0 : 12, alignItems: 'center', borderRadius: 6 }}>
            <Text numberOfLines={1} style={{ fontFamily: sans ? undefined : FONT_MONO, fontSize: fs, fontWeight: '800', letterSpacing: 0.3, color: on ? Colors.background : Colors.textMuted }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
