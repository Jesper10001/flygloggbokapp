import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../constants/colors';

interface LXSunBarProps {
  sunrise: string; // HH:MM
  sunset: string; // HH:MM
  blockOff: string; // HH:MM
  blockOn: string; // HH:MM
  dayHours: number;
  nightHours: number;
  accent?: string;
}

// Parse HH:MM to decimal hours (0-24)
function timeToDecimal(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h + (m || 0) / 60;
}

export function LXSunBar({
  sunrise,
  sunset,
  blockOff,
  blockOn,
  dayHours,
  nightHours,
  accent = Colors.gold,
}: LXSunBarProps) {
  const measurements = useMemo(() => {
    const sunriseTime = timeToDecimal(sunrise);
    const sunsetTime = timeToDecimal(sunset);
    const offTime = timeToDecimal(blockOff);
    const onTime = timeToDecimal(blockOn);

    // If onTime is less than offTime, assume it's next day
    const adjustedOnTime = onTime < offTime ? onTime + 24 : onTime;

    return {
      sunriseTime: Math.max(0, Math.min(24, sunriseTime)),
      sunsetTime: Math.max(0, Math.min(24, sunsetTime)),
      offTime: Math.max(0, Math.min(100, (offTime / 24) * 100)),
      onTime: Math.max(0, Math.min(100, ((adjustedOnTime % 24) / 24) * 100)),
      totalFlightTime: adjustedOnTime - offTime,
    };
  }, [sunrise, sunset, blockOff, blockOn]);

  // Night zones: 0-sunrise and sunset-24
  const nightStartPercent = 0;
  const nightEndPercent = (measurements.sunriseTime / 24) * 100;
  const nightEndOfDayPercent = (measurements.sunsetTime / 24) * 100;

  return (
    <View style={s.container}>
      {/* 28px tall bar */}
      <View style={s.bar}>
        {/* Night before sunrise */}
        <View
          style={[
            s.segment,
            s.nightSegment,
            {
              width: `${nightEndPercent}%`,
            },
          ]}
        />

        {/* Day period */}
        <View
          style={[
            s.segment,
            {
              width: `${nightEndOfDayPercent - nightEndPercent}%`,
              backgroundColor: Colors.background,
            },
          ]}
        />

        {/* Night after sunset */}
        <View
          style={[
            s.segment,
            s.nightSegment,
            {
              width: `${100 - nightEndOfDayPercent}%`,
            },
          ]}
        />

        {/* Sunrise marker */}
        <View
          style={[
            s.marker,
            {
              left: `${nightEndPercent}%`,
              backgroundColor: Colors.warning,
            },
          ]}
        />

        {/* Sunset marker */}
        <View
          style={[
            s.marker,
            {
              left: `${nightEndOfDayPercent}%`,
              backgroundColor: Colors.warning,
            },
          ]}
        />

        {/* Flight window overlay */}
        {measurements.totalFlightTime > 0 && (
          <View
            style={[
              s.flightWindow,
              {
                left: `${measurements.offTime}%`,
                width: `${Math.min(100, (measurements.totalFlightTime / 24) * 100)}%`,
                backgroundColor: accent,
                shadowColor: accent,
              },
            ]}
          />
        )}
      </View>

      {/* Time labels below */}
      <View style={s.labels}>
        <Text style={s.label}>00</Text>
        <Text style={[s.label, { color: Colors.warning }]}>↑ {sunrise}</Text>
        <Text style={[s.label, { color: accent }]}>{blockOff} → {blockOn}</Text>
        <Text style={[s.label, { color: Colors.warning }]}>↓ {sunset}</Text>
        <Text style={s.label}>24</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    width: '100%',
    gap: 10,
  },
  bar: {
    height: 28,
    width: '100%',
    backgroundColor: Colors.elevated,
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
    shadowColor: Colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 2,
  },
  segment: {
    height: '100%',
    backgroundColor: Colors.background,
  },
  nightSegment: {
    backgroundColor: Colors.textMuted,
    opacity: 0.25,
  },
  marker: {
    position: 'absolute',
    width: 1,
    height: '100%',
    top: 0,
  },
  flightWindow: {
    position: 'absolute',
    height: '100%',
    top: 0,
    opacity: 0.9,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  label: {
    fontFamily: 'Menlo',
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
