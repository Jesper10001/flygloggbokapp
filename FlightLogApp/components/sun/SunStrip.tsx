// Dagsbaren: dag / skymning / natt över flygningen i tidsordning (utils/sunTimeline), med solnedgång och
// nattens början utmärkta ovanför och tiden för varje del under. SunBar och SunEventRow används också av
// Sun route-panelens tidslinje (components/DayNightMap).
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

// Händelserna ovanför baren: ikon + klockslag (UTC), med ord när det får plats. Ligger två för tätt visas
// bara ikonen på den senare.
export function SunEventRow({ tl, words = false }: { tl: SunTimeline; words?: boolean }) {
  const W = words ? 112 : 64;
  let lastF = -1;
  return (
    <View style={{ height: 16 }}>
      {tl.events.map((e, i) => {
        const crowded = lastF >= 0 && e.f - lastF < (words ? 0.3 : 0.2);
        lastF = e.f;
        const c = eventColor(e.kind);
        return (
          <View key={i} style={{ position: 'absolute', left: `${e.f * 100}%`, marginLeft: -W / 2, width: W, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <MaterialCommunityIcons name={EVENT_ICON[e.kind]} size={words ? 13 : 12} color={c} />
            {!crowded && (
              <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: words ? 10 : 9.5, fontWeight: '700', color: c }}>
                {words ? `${EVENT_LABEL[e.kind]} ${fmtUtc(e.ms)}` : fmtUtc(e.ms)}
              </Text>
            )}
          </View>
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
