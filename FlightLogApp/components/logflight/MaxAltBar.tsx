// Designens "Max alt" — rektangulär barometer man drar i (vänster/höger) + −/+ knappar.
// Värdet i fot (0–45000, steg 500), LED-siffror. add.tsx lagrar det som flygnivå (FL=fot/100).
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';
import { FONT_LED7 } from './tokens';

const MAXA = 45000;
const STEP = 500;

export function MaxAltBar({ valueFt, onChangeFt, onGrab, onRelease }: { valueFt: number; onChangeFt: (ft: number) => void; onGrab?: () => void; onRelease?: () => void }) {
  const wref = useRef(0);
  const [w, setW] = useState(0);
  const alt = Math.max(0, Math.min(MAXA, valueFt));
  const fill = MAXA > 0 ? alt / MAXA : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const fromX = (e: GestureResponderEvent) => {
    if (!wref.current) return;
    const x = e.nativeEvent.locationX / wref.current;
    onChangeFt(Math.max(0, Math.min(MAXA, Math.round((x * MAXA) / STEP) * STEP)));
  };
  const step = (d: number) => onChangeFt(Math.max(0, Math.min(MAXA, Math.round(alt / STEP) * STEP + d * STEP)));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      <Text style={{ width: 64, fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.textSecondary }}>Max alt</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {/* barometer-kolumn — dra för att ställa */}
        <View
          onLayout={(e) => { wref.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onMoveShouldSetResponderCapture={() => true}
          onResponderGrant={(e) => { onGrab?.(); fromX(e); }}
          onResponderMove={fromX}
          onResponderRelease={() => onRelease?.()}
          onResponderTerminate={() => onRelease?.()}
          onResponderTerminationRequest={() => false}
          hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
          style={{ position: 'relative', flex: 1, height: 26, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border }}
        >
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill * 100}%`, backgroundColor: Colors.primary, opacity: 0.55 }} />
          {w > 0 ? (
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: Math.max(0, Math.min(w - 2, fill * w - 1)), width: 2, backgroundColor: '#F4FAFF' }} />
          ) : null}
          {ticks.map((tk, i) => (
            <View key={i} style={{ position: 'absolute', top: 3, bottom: 3, left: `${tk * 100}%`, width: 1, marginLeft: -0.5, backgroundColor: Colors.textPrimary, opacity: 0.16 }} />
          ))}
          <Text style={{ position: 'absolute', right: 8, top: 0, bottom: 0, textAlignVertical: 'center', fontFamily: FONT_LED7, fontSize: 14, fontWeight: '700', color: '#F4FAFF' }}>
            {alt.toLocaleString()}<Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textSecondary }}>  FT</Text>
          </Text>
        </View>
        {/* −/+ */}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <TouchableOpacity onPress={() => step(-1)} activeOpacity={0.7} style={{ width: 28, height: 26, borderRadius: 6, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="remove" size={15} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => step(1)} activeOpacity={0.7} style={{ width: 28, height: 26, borderRadius: 6, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={15} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
