import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, G, Line, Path, Circle, Text as SvgText, Filter, FeGaussianBlur } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, delay } from 'react-native-reanimated';
import { Colors } from '../constants/colors';

interface DayFlight {
  date: string;
  dep: string;
  arr: string;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

interface BWWeekMapProps {
  width: number;
  height: number;
  flights: DayFlight[];
  showGraticule?: boolean;
  showLabels?: boolean;
  accent?: string;
}

// ── Projection: Equirectangular ────────────────────────────────────────────
function projectPoint(lat: number, lon: number, width: number, height: number): { x: number; y: number } {
  const minLon = -15;
  const maxLon = 35;
  const minLat = 35;
  const maxLat = 70;

  const x = (lon - minLon) / (maxLon - minLon);
  const y = (maxLat - lat) / (maxLat - minLat);

  return {
    x: x * width * 0.9 + width * 0.05,
    y: y * height * 0.85 + height * 0.08,
  };
}

function quadraticBezierPath(p1: { x: number; y: number }, p2: { x: number; y: number }, bowFactor = 0.18): string {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const perpX = -dy / dist;
  const perpY = dx / dist;

  const cpx = (p1.x + p2.x) / 2 + perpX * dist * bowFactor;
  const cpy = (p1.y + p2.y) / 2 + perpY * dist * bowFactor;

  return `M ${p1.x} ${p1.y} Q ${cpx} ${cpy} ${p2.x} ${p2.y}`;
}

export function BWWeekMap({ width, height, flights, showGraticule = true, showLabels = true, accent = Colors.gold }: BWWeekMapProps) {
  // Get all unique airports
  const airportMap = useMemo(() => {
    const map = new Map<string, { lat: number; lon: number; name: string }>();
    flights.forEach(f => {
      if (!map.has(f.dep)) map.set(f.dep, { lat: f.depLat, lon: f.depLon, name: f.dep });
      if (!map.has(f.arr)) map.set(f.arr, { lat: f.arrLat, lon: f.arrLon, name: f.arr });
    });
    return map;
  }, [flights]);

  // Project all airports
  const projectedAirports = useMemo(() => {
    const result: Record<string, { x: number; y: number }> = {};
    airportMap.forEach((info, icao) => {
      result[icao] = projectPoint(info.lat, info.lon, width, height);
    });
    return result;
  }, [airportMap, width, height]);

  // Animated values for each route
  const strokeOffsets = useMemo(
    () => flights.map(() => useSharedValue(1600)),
    [flights.length]
  );

  useEffect(() => {
    if (flights.length === 0) return;

    // Stagger animations: route N starts when N-1 is ~70% done
    const baseDuration = 6500; // Multi-route duration
    const startDelay = baseDuration * 0.7; // 70% of duration

    flights.forEach((_, idx) => {
      const delayMs = idx * startDelay;
      strokeOffsets[idx].value = withRepeat(
        withTiming(0, {
          duration: baseDuration,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    });
  }, [flights, strokeOffsets]);

  // Build paths for each flight
  const routePaths = useMemo(() => {
    return flights.map(flight => {
      const dep = projectedAirports[flight.dep];
      const arr = projectedAirports[flight.arr];
      if (!dep || !arr) return '';
      return quadraticBezierPath(dep, arr, 0.18);
    });
  }, [flights, projectedAirports]);

  return (
    <View style={[s.container, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="weekGhostGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={accent} stopOpacity="0.12" />
            <Stop offset="100%" stopColor={accent} stopOpacity="0.08" />
          </LinearGradient>
          <Filter id="weekLineGlow">
            <FeGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </Filter>
          <Filter id="weekPinGlow">
            <FeGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
          </Filter>
        </Defs>

        {/* Graticule */}
        {showGraticule && (
          <G opacity={0.5}>
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

        {/* Ghost paths for all routes */}
        {routePaths.map((path, idx) => (
          path && (
            <Path
              key={`ghost-${idx}`}
              d={path}
              stroke={accent}
              strokeWidth="18"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.18"
            />
          )
        ))}

        {/* Animated route lines */}
        {routePaths.map((path, idx) => (
          path && (
            <Path
              key={`route-${idx}`}
              d={path}
              stroke={accent}
              strokeWidth={idx === 0 ? '2.6' : '1.8'}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1600"
              strokeDashoffset={strokeOffsets[idx]}
              filter="url(#weekLineGlow)"
              opacity={idx === 0 ? '1' : '0.7'}
            />
          )
        ))}

        {/* Airport pins */}
        {Array.from(airportMap.entries()).map(([icao, info]) => {
          const projected = projectedAirports[icao];
          if (!projected) return null;

          const isStart = flights[0]?.dep === icao;
          const isEnd = flights[flights.length - 1]?.arr === icao;

          return (
            <G key={`airport-${icao}`}>
              {/* Pulsing halo */}
              <Circle
                cx={projected.x}
                cy={projected.y}
                r="14"
                fill="none"
                stroke={accent}
                strokeWidth="1.5"
                opacity="0.55"
                filter="url(#weekPinGlow)"
              />

              {/* Pin dot */}
              {isStart || isEnd ? (
                <>
                  <Circle cx={projected.x} cy={projected.y} r="6" fill={Colors.background} />
                  <Circle cx={projected.x} cy={projected.y} r="5" fill="none" stroke={accent} strokeWidth="1" />
                </>
              ) : (
                <Circle cx={projected.x} cy={projected.y} r="6" fill={Colors.background} />
              )}

              {/* Inner dot */}
              <Circle cx={projected.x} cy={projected.y} r={isStart || isEnd ? 1.5 : 4} fill={accent} />

              {/* Label */}
              {showLabels && (
                <>
                  <SvgText
                    x={projected.x + 10}
                    y={projected.y - 6}
                    fill={Colors.textPrimary}
                    fontSize="12"
                    fontWeight="700"
                    fontFamily="Menlo"
                    letterSpacing="0.06em"
                  >
                    {icao}
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
