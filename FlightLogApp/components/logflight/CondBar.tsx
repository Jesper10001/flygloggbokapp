// Dragbar för en flygnings-andel (VFR/IFR/NVG). Dra var som helst på spåret för att
// sätta hur stor del av flygningen som flögs i det villkoret. Snäpper i 5-min-steg
// med detents; fyllning över `warnAbove` blir röd (NVG utanför mörkerfönstret).
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

const hm = (mins: number) => `${Math.floor(mins / 60)}:${String(Math.round(mins % 60)).padStart(2, '0')}`;

export function CondBar({ label, pct, onPct, tint, totalMin, readOnly, warnAbove, snaps, notches, autoLabel, bare, onReset, onGrab, onRelease }: {
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
}) {
  const [w, setW] = useState(0);
  const wref = useRef(0);
  const mins = Math.round(totalMin * pct / 100);

  const snap = (raw: number) => {
    if (!totalMin) return Math.round(raw);
    const stepPct = (5 / totalMin) * 100; // 5-minutersinkrement
    let best = Math.round(raw / stepPct) * stepPct;
    [50, 100, ...(snaps || [])].forEach((e) => { if (Math.abs(raw - e) < Math.abs(raw - best)) best = e; });
    return Math.max(0, Math.min(100, best));
  };
  const fromX = (e: GestureResponderEvent) => {
    if (readOnly || !wref.current) return;
    onPct(snap((e.nativeEvent.locationX / wref.current) * 100));
  };

  const over = !!warnAbove && pct > warnAbove;
  const fillPct = Math.min(pct, warnAbove || 100);

  const track = (
    <View
      onLayout={(e) => { wref.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); }}
      onStartShouldSetResponder={() => !readOnly}
      onMoveShouldSetResponder={() => !readOnly}
      onMoveShouldSetResponderCapture={() => !readOnly}
      onResponderGrant={(e) => { onGrab?.(); fromX(e); }}
      onResponderMove={fromX}
      onResponderRelease={() => onRelease?.()}
      onResponderTerminate={() => onRelease?.()}
      onResponderTerminationRequest={() => false}
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      style={{ flex: bare ? 1 : undefined, position: 'relative', height: 20, borderRadius: 8, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', opacity: readOnly ? 0.9 : 1 }}
    >
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fillPct}%`, backgroundColor: tint, opacity: 0.5 }} />
      {over ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${warnAbove}%`, width: `${pct - (warnAbove || 0)}%`, backgroundColor: Colors.danger, opacity: 0.7 }} /> : null}
      {(notches || []).map((n, i) => (
        <View key={i} style={{ position: 'absolute', top: 2, bottom: 2, left: `${n}%`, width: 2, marginLeft: -1, backgroundColor: Colors.textPrimary, opacity: 0.4, borderRadius: 1 }} />
      ))}
      {!readOnly && w > 0 ? (
        <View style={{ position: 'absolute', top: -2, bottom: -2, left: Math.max(0, Math.min(w - 10, (pct / 100) * w - 5)), width: 10, borderRadius: 4, backgroundColor: over ? Colors.danger : tint }} />
      ) : null}
    </View>
  );

  if (bare) return track;

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
        <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '800', color: over ? Colors.danger : tint }}>{hm(mins)}</Text>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted, marginLeft: 6, width: 30, textAlign: 'right' }}>{Math.round(pct)}%</Text>
      </View>
      {track}
    </View>
  );
}
