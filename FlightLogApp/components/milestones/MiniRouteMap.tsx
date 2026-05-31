import React, { useEffect, useMemo } from 'react';
import Svg, { Defs, RadialGradient, Stop, Rect, G, Line, Path, Circle, Text as SvgText } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { Colors } from '../../constants/colors';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface RouteLeg {
  icao: string;
  lat: number;
  lon: number;
  role: 'dep' | 'via' | 'arr';
  name?: string;
}

interface MiniRouteMapProps {
  width: number;
  height: number;
  legs: RouteLeg[];
  accent?: string;
  showGraticule?: boolean;
  showLabels?: boolean;
  /** Pause animations when the host screen loses focus (battery). */
  animate?: boolean;
  bowFactor?: number;
  padX?: number;
  padTop?: number;
  padBottom?: number;
}

// Equirectangular projection over Europe → fixed 800×600 base coord system.
const LON_MIN = -15, LON_MAX = 35, LAT_MIN = 35, LAT_MAX = 70;
const BASE_W = 800, BASE_H = 600;
const proj = (lat: number, lon: number) => ({
  x: ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * BASE_W,
  y: ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * BASE_H,
});

// One pulsing airport pin — own clock so pins can be staggered.
function PulsePin({
  x, y, accent, isEnd, delay, animate,
}: { x: number; y: number; accent: string; isEnd: boolean; delay: number; animate: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!animate) { t.value = 0; return; }
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false),
    );
    return () => cancelAnimation(t);
  }, [animate, delay, t]);

  const haloProps = useAnimatedProps(() => ({
    r: 6 + t.value * (14 - 6) * 1.7,
    opacity: 0.55 * (1 - t.value),
  }));

  const r = isEnd ? 5 : 4;
  return (
    <G>
      <AnimatedCircle cx={x} cy={y} fill={accent} animatedProps={haloProps} />
      {/* punch a hole so the halo reads as a ring */}
      <Circle cx={x} cy={y} r={r + 2} fill={Colors.background} />
      <Circle cx={x} cy={y} r={r} fill={accent} />
      {isEnd && <Circle cx={x} cy={y} r={r - 1.7} fill={Colors.background} />}
    </G>
  );
}

export function MiniRouteMap({
  width,
  height,
  legs,
  accent = Colors.accent,
  showGraticule = true,
  showLabels = false,
  animate = true,
  bowFactor = 0.18,
  padX = 22,
  padTop = 18,
  padBottom = 18,
}: MiniRouteMapProps) {
  const { d, pts, viewBox, grat } = useMemo(() => {
    const projected = legs.map(l => ({ ...l, ...proj(l.lat, l.lon) }));

    // No points yet (loading / missing coords) — bail with a valid empty viewBox.
    if (projected.length === 0) {
      return { d: '', pts: [] as Array<RouteLeg & { x: number; y: number }>, viewBox: `0 0 ${width} ${height}`, grat: [] };
    }

    // North-bowed quadratic per leg.
    let path = projected.length ? `M ${projected[0].x} ${projected[0].y}` : '';
    for (let i = 1; i < projected.length; i++) {
      const a = projected[i - 1], b = projected[i];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const cpx = mx, cpy = my - dist * bowFactor; // bow north
      path += ` Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }

    // Fit viewBox to the route, then match the target aspect ratio.
    const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
    let minX = Math.min(...xs) - padX, maxX = Math.max(...xs) + padX;
    let minY = Math.min(...ys) - padTop, maxY = Math.max(...ys) + padBottom;
    let vbW = maxX - minX, vbH = maxY - minY;
    const target = width / height;
    if (vbW / vbH < target) {
      const need = vbH * target; minX -= (need - vbW) / 2; vbW = need;
    } else {
      const need = vbW / target; minY -= (need - vbH) / 2; vbH = need;
    }

    // Graticule lines clipped to the visible viewBox.
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; k: string }> = [];
    if (showGraticule) {
      for (let lon = LON_MIN; lon <= LON_MAX; lon += 5) {
        const { x } = proj(0, lon);
        lines.push({ x1: x, y1: minY, x2: x, y2: minY + vbH, k: `v${lon}` });
      }
      for (let lat = LAT_MIN; lat <= LAT_MAX; lat += 5) {
        const { y } = proj(lat, 0);
        lines.push({ x1: minX, y1: y, x2: minX + vbW, y2: y, k: `h${lat}` });
      }
    }

    return {
      d: path,
      pts: projected,
      viewBox: `${minX} ${minY} ${vbW} ${vbH}`,
      grat: lines,
    };
  }, [legs, width, height, bowFactor, padX, padTop, padBottom, showGraticule]);

  // Draw animation — stroke-dashoffset from full to 0, looping.
  const DASH = 2000;
  const offset = useSharedValue(DASH);
  useEffect(() => {
    if (!animate) { offset.value = 0; return; }
    offset.value = DASH;
    offset.value = withRepeat(
      withTiming(0, { duration: 5500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(offset);
  }, [animate, d, offset]);

  const liveProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  return (
    <Svg width={width} height={height} viewBox={viewBox} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <RadialGradient id="mrm-vignette" cx="50%" cy="50%" r="70%">
          <Stop offset="0%" stopColor={accent} stopOpacity={0.06} />
          <Stop offset="100%" stopColor={Colors.background} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={-9999} y={-9999} width={20000} height={20000} fill="url(#mrm-vignette)" />

      {showGraticule && (
        <G stroke={Colors.cardBorder} strokeWidth={0.6} opacity={0.5}>
          {grat.map(l => <Line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
        </G>
      )}

      {/* ghost route — always visible so the line reads even if anim is off */}
      {!!d && (
        <Path d={d} stroke={accent} strokeWidth={2.4} fill="none" opacity={0.22} strokeLinecap="round" />
      )}
      {/* animated draw on top */}
      {!!d && (
        <AnimatedPath
          d={d}
          stroke={accent}
          strokeWidth={2.4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={DASH}
          animatedProps={liveProps}
        />
      )}

      {pts.map((p, i) => (
        <PulsePin
          key={`${p.icao}-${i}`}
          x={p.x}
          y={p.y}
          accent={accent}
          isEnd={p.role === 'dep' || p.role === 'arr'}
          delay={i * 380}
          animate={animate}
        />
      ))}

      {showLabels && pts.map((p, i) => (
        <G key={`lbl-${p.icao}-${i}`}>
          <SvgText x={p.x + 10} y={p.y - 4} fill={Colors.textPrimary} fontSize={13} fontWeight="700" fontFamily="JetBrainsMono">
            {p.icao}
          </SvgText>
          {p.name ? (
            <SvgText x={p.x + 10} y={p.y + 9} fill={Colors.textSecondary} fontSize={9}>
              {p.name.length > 18 ? p.name.slice(0, 17) + '…' : p.name}
            </SvgText>
          ) : null}
        </G>
      ))}
    </Svg>
  );
}
