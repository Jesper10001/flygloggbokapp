// Segmenterad skymningsstapel — dag/skymning/natt/gryning över flygningen, med
// natt-tiden centrerad ovanför natt-segmentet och NVG-glow som växer ut från natten.
// Segmenten (`segs`) härleds ur tvilight-beräkningen i add.tsx (auto, read-only).
import { View, Text } from 'react-native';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

export type TwilightSeg = { k: 'day' | 'dusk' | 'night' | 'dawn'; f: number; c: string };

export function TwilightBar({ segs, nightLabel, nvgPct = 0 }: {
  segs: TwilightSeg[];
  nightLabel?: string;
  nvgPct?: number;
}) {
  // natt-segmentets mitt + giltigt NVG-fönster (dusk→dawn) i procent.
  let acc = 0, nightL = 50, validL = 0, validR = 100;
  segs.forEach((s) => {
    if (s.k === 'dusk') validL = acc;
    if (s.k === 'night') nightL = acc + s.f / 2;
    if (s.k === 'dawn') validR = acc + s.f;
    acc += s.f;
  });

  let glow: { l: number; w: number } | null = null;
  let redR = 0, redL = 0;
  if (nvgPct > 0) {
    const half = nvgPct / 2;
    let wl = nightL - half, wr = nightL + half;
    if (wl < validL) { wr += validL - wl; wl = validL; }
    if (wr > validR) { wl -= wr - validR; wr = validR; }
    wl = Math.max(validL, wl); wr = Math.min(validR, wr);
    const excess = Math.max(0, nvgPct - (wr - wl));
    redR = Math.min(excess, 100 - validR);
    redL = Math.max(0, excess - redR);
    glow = { l: wl, w: wr - wl };
  }

  // T/O (start) och LDG (slut) flankerar baren och ligger i linje med SJÄLVA baren;
  // dag/skymning/natt/gryning-etiketterna hänger under baren (offsetade så de linjerar med den).
  const SIDE = 24, GAP = 7;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GAP }}>
        <Text style={{ width: SIDE, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '800', letterSpacing: 0.5, color: Colors.textSecondary }}>T/O</Text>
        <View style={{ flex: 1, flexDirection: 'row', height: 14, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border }}>
          {segs.map((s, i) => <View key={i} style={{ width: `${s.f}%`, backgroundColor: s.c, opacity: s.k === 'night' ? 0.85 : 0.4 }} />)}
          {glow ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${glow.l}%`, width: `${glow.w}%`, backgroundColor: 'rgba(255,255,255,0.5)' }} /> : null}
          {redR > 0 ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${validR}%`, width: `${redR}%`, backgroundColor: 'rgba(255,77,106,0.7)' }} /> : null}
          {redL > 0 ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${validL - redL}%`, width: `${redL}%`, backgroundColor: 'rgba(255,77,106,0.7)' }} /> : null}
        </View>
        <Text style={{ width: SIDE, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '800', letterSpacing: 0.5, color: Colors.textSecondary }}>LDG</Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 2, marginLeft: SIDE + GAP, marginRight: SIDE + GAP }}>
        {segs.map((s, i) => (
          <Text key={i} numberOfLines={1} style={{ width: `${s.f}%`, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 7, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', color: s.k === 'night' ? Colors.info : Colors.textMuted }}>
            {s.f >= 8 ? s.k : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
