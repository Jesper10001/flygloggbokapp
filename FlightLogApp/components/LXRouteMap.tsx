import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, G, Line, Path, Circle, Text as SvgText, Filter, FeGaussianBlur } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Colors } from '../constants/colors';

interface Leg {
  icao: string;
  lat: number;
  lon: number;
  name?: string;
  city?: string;
  country?: string;
  role: 'dep' | 'via' | 'arr';
}

interface LXRouteMapProps {
  width: number;
  height: number;
  legs: Leg[];
  showGraticule?: boolean;
  showLabels?: boolean;
  showPlane?: boolean;
  accent?: string;
  onLoaded?: () => void;
}

// ── Projection: Equirectangular over Europe ────────────────────────────────
function projectPoint(lat: number, lon: number, width: number, height: number): { x: number; y: number } {
  // Europe bounds: LON -15..35, LAT 35..70
  const minLon = -15;
  const maxLon = 35;
  const minLat = 35;
  const maxLat = 70;

  // Normalize to 0..1
  const x = (lon - minLon) / (maxLon - minLon);
  const y = (maxLat - lat) / (maxLat - minLat);

  // Scale to canvas
  return {
    x: x * width * 0.9 + width * 0.05,
    y: y * height * 0.85 + height * 0.08,
  };
}

// ── Quadratic Bézier with bow ──────────────────────────────────────────────
function quadraticBezierPath(p1: { x: number; y: number }, p2: { x: number; y: number }, bowFactor = 0.18): string {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Control point offset perpendicular to line
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const cpx = (p1.x + p2.x) / 2 + perpX * dist * bowFactor;
  const cpy = (p1.y + p2.y) / 2 + perpY * dist * bowFactor;

  return `M ${p1.x} ${p1.y} Q ${cpx} ${cpy} ${p2.x} ${p2.y}`;
}

export function LXRouteMap({
  width,
  height,
  legs,
  showGraticule = true,
  showLabels = true,
  showPlane = true,
  accent = Colors.gold,
  onLoaded,
}: LXRouteMapProps) {
  const points = useMemo(() => {
    return legs.map(leg => ({
      ...leg,
      ...projectPoint(leg.lat, leg.lon, width, height),
    }));
  }, [legs, width, height]);

  // Animation: stroke-dashoffset from full to 0
  const strokeDashoffset = useSharedValue(1600);
  const planeProgress = useSharedValue(0);

  useEffect(() => {
    if (points.length < 2) return;

    // Route animation (5.5s, infinite loop)
    strokeDashoffset.value = withRepeat(
      withTiming(0, {
        duration: 5500,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );

    // Plane animation (parallel to route, when enabled)
    if (showPlane) {
      planeProgress.value = withRepeat(
        withTiming(100, {
          duration: 5500,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    }

    onLoaded?.();
  }, [points, strokeDashoffset, planeProgress, showPlane, onLoaded]);

  const routePath = useMemo(() => {
    if (points.length < 2) return '';
    let pathData = '';
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = { x: points[i].x, y: points[i].y };
      const p2 = { x: points[i + 1].x, y: points[i + 1].y };
      pathData += quadraticBezierPath(p1, p2, 0.18);
    }
    return pathData;
  }, [points]);

  // Animated stroke style
  const animatedStrokeStyle = useAnimatedStyle(() => {
    return {
      strokeDashoffset: strokeDashoffset.value,
    };
  });

  return (
    <View style={[s.container, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          {/* Gradient for ghost path */}
          <LinearGradient id="ghostGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={accent} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={accent} stopOpacity="0.12" />
          </LinearGradient>

          {/* Glow filter for animated line */}
          <Filter id="lineGlow">
            <FeGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </Filter>

          {/* Glow filter for pins */}
          <Filter id="pinGlow">
            <FeGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
          </Filter>
        </Defs>

        {/* Graticule (5° lines) */}
        {showGraticule && (
          <G opacity={0.5}>
            {/* Longitude lines */}
            {[-15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35].map(lon => {
              const p1 = projectPoint(35, lon, width, height);
              const p2 = projectPoint(70, lon, width, height);
              return (
                <Line
                  key={`lon-${lon}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={Colors.cardBorder}
                  strokeWidth="0.6"
                />
              );
            })}
            {/* Latitude lines */}
            {[35, 40, 45, 50, 55, 60, 65, 70].map(lat => {
              const p1 = projectPoint(lat, -15, width, height);
              const p2 = projectPoint(lat, 35, width, height);
              return (
                <Line
                  key={`lat-${lat}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={Colors.cardBorder}
                  strokeWidth="0.6"
                />
              );
            })}
          </G>
        )}

        {/* Ghost path (beneath) */}
        {routePath && (
          <Path
            d={routePath}
            stroke={accent}
            strokeWidth="18"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.18"
          />
        )}

        {/* Animated route line */}
        {routePath && (
          <Path
            d={routePath}
            stroke={accent}
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1600"
            strokeDashoffset={strokeDashoffset}
            filter="url(#lineGlow)"
            opacity="1"
          />
        )}

        {/* Airport pins with pulsing halos */}
        {points.map((point, idx) => {
          const isDep = point.role === 'dep';
          const isArr = point.role === 'arr';
          const isVia = point.role === 'via';

          return (
            <G key={`pin-${idx}`}>
              {/* Pulsing halo (animated via opacity + scale) */}
              <Circle
                cx={point.x}
                cy={point.y}
                r="14"
                fill="none"
                stroke={accent}
                strokeWidth="1.5"
                opacity="0.55"
                filter="url(#pinGlow)"
              />

              {/* Solid dot (dep/arr: gold ring; via: solid) */}
              {isDep || isArr ? (
                <>
                  <Circle cx={point.x} cy={point.y} r="6" fill={Colors.background} />
                  <Circle cx={point.x} cy={point.y} r="5" fill="none" stroke={accent} strokeWidth="1" />
                </>
              ) : (
                <Circle cx={point.x} cy={point.y} r="6" fill={Colors.background} />
              )}

              {/* Inner gold dot */}
              <Circle cx={point.x} cy={point.y} r={isDep || isArr ? 1.5 : 4} fill={accent} />

              {/* Label (if enabled) */}
              {showLabels && (
                <>
                  <SvgText
                    x={point.x + 10}
                    y={point.y - 6}
                    fill={Colors.textPrimary}
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="Menlo"
                    letterSpacing="0.06em"
                  >
                    {point.icao}
                  </SvgText>
                  <SvgText
                    x={point.x + 10}
                    y={point.y + 10}
                    fill={Colors.tabIconDefault}
                    fontSize="10"
                    fontFamily="Inter"
                  >
                    {point.city || point.name || ''}
                  </SvgText>
                </>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    borderRadius: 18,
    overflow: 'hidden',
  },
});
