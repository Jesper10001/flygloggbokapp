// Dagsbaren: dag / skymning / natt över flygningen i tidsordning (utils/sunTimeline), med solnedgång och
// nattens början utmärkta ovanför och tiden för varje del under. SunBar och SunEventRow används också av
// Sun route-panelens tidslinje (components/DayNightMap).
import { Fragment, useState } from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';
import { SUN, fmtMin, fmtUtc, type SunTimeline, type SunEventKind } from '../../utils/sunTimeline';

const EVENT_ICON: Record<SunEventKind, keyof typeof MaterialCommunityIcons.glyphMap> = {
  sunset: 'weather-sunset-down', night: 'weather-night', nightEnd: 'weather-night', sunrise: 'weather-sunset-up',
};
const EVENT_LABEL: Record<SunEventKind, string> = { sunset: 'Sunset', night: 'Night', nightEnd: 'Night ends', sunrise: 'Sunrise' };
export const eventColor = (k: SunEventKind) => (k === 'night' || k === 'nightEnd' ? SUN.nightText : SUN.day);

export function SunBar({ tl, height = 12 }: { tl: SunTimeline; height?: number }) {
  return (
    <View style={{ height, borderRadius: height / 2, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
      {tl.runs.map((r, i) => {
        const flex = Math.max(0.0001, r.f1 - r.f0);
        if (r.phase !== 'twilight') return <View key={i} style={{ flex, backgroundColor: r.phase === 'day' ? SUN.day : SUN.night }} />;
        // Skymningen tonar dag → natt på kvällen och natt → dag på morgonen.
        const colors = r.state === 'dawn' ? [...SUN.twilightGradient].reverse() : [...SUN.twilightGradient];
        return <LinearGradient key={i} colors={colors as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex }} />;
      })}
      {tl.events.map((e, i) => (
        <View key={'t' + i} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: `${e.f * 100}%`, width: 1.5, backgroundColor: e.kind === 'night' || e.kind === 'nightEnd' ? 'rgba(255,255,255,0.85)' : 'rgba(10,22,40,0.85)' }} />
      ))}
    </View>
  );
}

// Händelserna ovanför baren: ikonen står rakt över sitt streck i baren och klockslaget (UTC) bredvid, aldrig
// under en annan ikon. Ligger två händelser så tätt att ikonerna skulle krocka skjuts de isär precis så mycket
// som behövs. Klockslaget hamnar på den sida där det finns plats, helst bort från grannen; får texten med ord
// inte plats prövas bara klockslaget, och får inte heller det plats visas bara ikonen.
export function SunEventRow({ tl, words = false }: { tl: SunTimeline; words?: boolean }) {
  const [w, setW] = useState(0);
  const ICON = words ? 13 : 12, FS = words ? 10 : 9.5, GAP = 2, MIN = ICON + 2, OVER = 28;
  const n = tl.events.length;
  const long = tl.events.map((e) => (words ? `${EVENT_LABEL[e.kind]} ${fmtUtc(e.ms)}` : fmtUtc(e.ms)));
  const short = tl.events.map((e) => fmtUtc(e.ms));
  const width = (t: string) => Math.ceil(t.length * FS * 0.6) + 2; // JetBrains Mono: 0,6 em per tecken
  const texts = [...long];
  const tw = texts.map(width);
  // Ikonernas lägen: över strecken, tätt liggande grupper isärskjutna runt sin mitt.
  const pos: number[] = tl.events.map((e) => e.f * w);
  let i0 = 0;
  while (i0 < n) {
    let i1 = i0;
    while (i1 + 1 < n && pos[i1 + 1] - pos[i1] < MIN) i1++;
    if (i1 > i0) {
      const mid = (pos[i0] + pos[i1]) / 2, span = MIN * (i1 - i0);
      for (let k = i0; k <= i1; k++) pos[k] = mid - span / 2 + (k - i0) * MIN;
    }
    i0 = i1 + 1;
  }
  // Klockslagens sida, från vänster: får inte gå in i det som redan står där eller i nästa ikon.
  const side: ('l' | 'r' | null)[] = [];
  let usedRight = -Infinity;
  for (let i = 0; i < n; i++) {
    const iconL = pos[i] - ICON / 2, iconR = pos[i] + ICON / 2;
    const nextIconL = i + 1 < n ? pos[i + 1] - ICON / 2 : w + OVER;
    const choose = (): 'l' | 'r' | null => {
      const leftOk = iconL - GAP - tw[i] >= Math.max(usedRight + GAP, -OVER);
      const rightOk = iconR + GAP + tw[i] <= nextIconL - GAP && iconR + GAP + tw[i] <= w + OVER;
      // Ligger nästa händelse nära, lämnas utrymmet mellan dem åt den.
      const nextClose = i + 1 < n && pos[i + 1] - pos[i] < ICON + tw[i] + tw[i + 1] + 4 * GAP;
      return nextClose ? (leftOk ? 'l' : rightOk ? 'r' : null) : (rightOk ? 'r' : leftOk ? 'l' : null);
    };
    let pick = choose();
    if (!pick && texts[i] !== short[i]) { texts[i] = short[i]; tw[i] = width(short[i]); pick = choose(); }
    side.push(pick);
    usedRight = Math.max(usedRight, iconR, pick === 'r' ? iconR + GAP + tw[i] : -Infinity);
  }
  return (
    <View style={{ height: 16 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && tl.events.map((e, i) => {
        const c = eventColor(e.kind);
        return (
          <Fragment key={i}>
            <View style={{ position: 'absolute', top: 1, left: pos[i] - ICON / 2, width: ICON, alignItems: 'center' }}>
              <MaterialCommunityIcons name={EVENT_ICON[e.kind]} size={ICON} color={c} />
            </View>
            {side[i] ? (
              <Text numberOfLines={1} style={{
                position: 'absolute', top: 1, width: tw[i], textAlign: side[i] === 'l' ? 'right' : 'left',
                left: side[i] === 'l' ? pos[i] - ICON / 2 - GAP - tw[i] : pos[i] + ICON / 2 + GAP,
                fontFamily: FONT_MONO, fontSize: FS, fontWeight: '700', color: c,
              }}>
                {texts[i]}
              </Text>
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

// Route-kortets dagsbar. nightLabel = loggad natt-tid (h:mm), så att siffran är densamma som i loggboken.
export function SunStrip({ tl, nightLabel, nvgPct = 0 }: { tl: SunTimeline; nightLabel?: string; nvgPct?: number }) {
  const SIDE = 24, GAP = 7;
  const nightRuns = tl.runs.filter((r) => r.phase === 'night');
  // NVG-glöden växer ut från nattens mitt inom skymning–natt-fönstret; det som inte får plats blir rött.
  const firstDark = tl.runs.find((r) => r.phase !== 'day');
  const lastDark = [...tl.runs].reverse().find((r) => r.phase !== 'day');
  const validL = (firstDark?.f0 ?? 0) * 100, validR = (lastDark?.f1 ?? 1) * 100;
  const nightL = nightRuns.length ? ((nightRuns[0].f0 + nightRuns[0].f1) / 2) * 100 : 50;
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
  const side = { width: SIDE, textAlign: 'center' as const, fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '800' as const, letterSpacing: 0.5, color: Colors.textSecondary };
  return (
    <View style={{ gap: 4 }}>
      <View style={{ marginHorizontal: SIDE + GAP }}><SunEventRow tl={tl} /></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: GAP }}>
        <Text style={side}>T/O</Text>
        <View style={{ flex: 1 }}>
          <SunBar tl={tl} height={12} />
          {glow ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: `${glow.l}%`, width: `${glow.w}%`, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.45)' }} /> : null}
          {redR > 0 ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: `${validR}%`, width: `${redR}%`, backgroundColor: 'rgba(255,77,106,0.7)' }} /> : null}
          {redL > 0 ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: `${validL - redL}%`, width: `${redL}%`, backgroundColor: 'rgba(255,77,106,0.7)' }} /> : null}
        </View>
        <Text style={side}>LDG</Text>
      </View>
      <View style={{ height: 13, marginHorizontal: SIDE + GAP }}>
        {tl.runs.map((r, i) => {
          const w = r.f1 - r.f0;
          const min = (r.toMs - r.fromMs) / 60000;
          const time = r.phase === 'night' && nightLabel && nightRuns.length === 1 ? nightLabel : fmtMin(min);
          const text = w >= 0.24 ? `${r.phase.toUpperCase()} ${time}` : w >= 0.1 ? time : '';
          if (!text) return null;
          return (
            <Text key={i} numberOfLines={1} style={{ position: 'absolute', left: `${((r.f0 + r.f1) / 2) * 100}%`, marginLeft: -52, width: 104, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: r.phase === 'night' ? '800' : '700', letterSpacing: 0.4, color: r.phase === 'night' ? SUN.nightText : Colors.textSecondary }}>
              {text}
            </Text>
          );
        })}
      </View>
    </View>
  );
}
