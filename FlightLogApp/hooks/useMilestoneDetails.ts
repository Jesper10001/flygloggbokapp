import { useMemo } from 'react';
import { useFlightStore } from '../store/flightStore';
import { decimalToHHMM } from './useTimeFormat';

interface DayBreakdown {
  dow: string;
  date: number;
  iso: string;
  hours: number;
  flights: Array<{ dep: string; arr: string; dur: string }>;
}

interface Top5Week {
  rank: number;
  label: string;
  range: string;
  hours: number;
  current: boolean;
}

export interface BestWeekDetails {
  range_label: string;
  hours_label: string;
  sectors: number;
  airports_count: number;
  days_flown: number;
  days: DayBreakdown[];
  top5: Top5Week[];
  baseline_avg_hours: number;
}

interface LegInfo {
  icao: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  role: 'dep' | 'via' | 'arr';
}

interface Top5XC {
  rank: number;
  route: string;
  nm: number;
  date: string;
  current: boolean;
}

export interface LongestXcDetails {
  distance_nm: number;
  distance_km: number;
  duration_label: string;
  date_long: string;
  date_short: string;
  aircraft_reg: string;
  aircraft_type: string;
  role: string;
  rules: 'IFR' | 'VFR';
  cruise_kts?: number;
  alt_fl?: string;
  legs: LegInfo[];
  sunrise: string;
  sunset: string;
  block_off: string;
  block_on: string;
  day_h: number;
  night_h: number;
  top5: Top5XC[];
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Best Week Details ──────────────────────────────────────────────────────
export function useBestWeekDetails(weekStart: string): BestWeekDetails | null {
  const { flights, stats } = useFlightStore();

  return useMemo(() => {
    if (!weekStart || !stats.best_week_hours) return null;

    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);

    // Filter flights in this week
    const weekFlights = flights.filter(f => {
      const fDate = new Date(f.date);
      return fDate >= startDate && fDate <= endDate;
    });

    if (weekFlights.length === 0) return null;

    // Group by day
    const dayMap: Record<string, typeof weekFlights> = {};
    weekFlights.forEach(f => {
      if (!dayMap[f.date]) dayMap[f.date] = [];
      dayMap[f.date].push(f);
    });

    // Build day breakdown
    const days: DayBreakdown[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const dayFlights = dayMap[iso] || [];
      const dayHours = dayFlights.reduce((sum, f) => sum + (parseFloat(f.total_time) || 0), 0);

      days.push({
        dow: DAYS_OF_WEEK[d.getDay()],
        date: d.getDate(),
        iso,
        hours: dayHours,
        flights: dayFlights.map(f => ({
          dep: f.dep_place || '?',
          arr: f.arr_place || '?',
          dur: decimalToHHMM(parseFloat(f.total_time) || 0),
        })),
      });
    }

    // Count metrics
    const sectors = weekFlights.length;
    const uniqueAirports = new Set([
      ...weekFlights.map(f => f.dep_place).filter(Boolean),
      ...weekFlights.map(f => f.arr_place).filter(Boolean),
    ]);
    const airports_count = uniqueAirports.size;
    const days_flown = days.filter(d => d.hours > 0).length;

    // Baseline average (from stats)
    const baseline_avg_hours = stats.baseline_avg_hours || 0;

    // Range label
    const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const rangeStart = formatter.format(startDate);
    const rangeEnd = formatter.format(endDate);
    const range_label = `${rangeStart.split(' ')[0]} ${startDate.getDate()} — ${endDate.getDate()} ${formatter.format(endDate)}`;

    // Top 5 weeks (simplified — would compute from all historical weeks)
    const top5: Top5Week[] = [
      {
        rank: 1,
        label: stats.best_week_label || '',
        range: range_label,
        hours: stats.best_week_hours,
        current: true,
      },
    ];

    return {
      range_label,
      hours_label: decimalToHHMM(stats.best_week_hours),
      sectors,
      airports_count,
      days_flown,
      days,
      top5,
      baseline_avg_hours,
    };
  }, [weekStart, flights, stats]);
}

// ── Longest XC Details ─────────────────────────────────────────────────────
export function useLongestXcDetails(flightId: number | null): LongestXcDetails | null {
  const { flights, stats } = useFlightStore();

  return useMemo(() => {
    if (!flightId) return null;

    const flight = flights.find(f => f.id === flightId);
    if (!flight) return null;

    // Distance (km to nm)
    const distance_km = parseFloat(flight.distance || '0') || 0;
    const distance_nm = distance_km / 1.852;

    // Duration
    const duration_h = parseFloat(flight.total_time) || 0;
    const duration_label = decimalToHHMM(duration_h);

    // Dates
    const flightDate = new Date(flight.date);
    const date_long = flightDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const date_short = flightDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Aircraft info
    const aircraft_reg = flight.registration || '';
    const aircraft_type = flight.aircraft_type || '';

    // Role (from profile or flight data)
    const role = flight.pic && parseFloat(flight.pic) > 0 ? 'PIC' : 'CO';

    // Flight rules
    const rules = (flight.flight_rules || 'VFR').toUpperCase() as 'IFR' | 'VFR';

    // Cruise speed and altitude (optional)
    const cruise_kts = undefined; // Would come from aircraft registry
    const alt_fl = flight.max_fl ? `FL ${flight.max_fl}` : undefined;

    // Legs (simple: dep → arr)
    const legs: LegInfo[] = [];
    if (flight.dep_place) {
      legs.push({
        icao: flight.dep_place,
        name: 'Airport', // Would fetch from DB
        city: '',
        country: '',
        lat: 0,
        lon: 0,
        role: 'dep',
      });
    }
    if (flight.arr_place) {
      legs.push({
        icao: flight.arr_place,
        name: 'Airport',
        city: '',
        country: '',
        lat: 0,
        lon: 0,
        role: 'arr',
      });
    }

    // Day/night breakdown
    const day_h = parseFloat(flight.total_time) || 0; // Simplified
    const night_h = 0;

    // Times
    const block_off = flight.dep_utc || '';
    const block_on = flight.arr_utc || '';

    // Sunrise/sunset (would calculate or fetch)
    const sunrise = '';
    const sunset = '';

    // Top 5 (simplified)
    const top5: Top5XC[] = [
      {
        rank: 1,
        route: `${flight.dep_place} → ${flight.arr_place}`,
        nm: Math.round(distance_nm),
        date: flight.date,
        current: true,
      },
    ];

    return {
      distance_nm: Math.round(distance_nm),
      distance_km,
      duration_label,
      date_long,
      date_short,
      aircraft_reg,
      aircraft_type,
      role,
      rules,
      cruise_kts,
      alt_fl,
      legs,
      sunrise,
      sunset,
      block_off,
      block_on,
      day_h,
      night_h,
      top5,
    };
  }, [flightId, flights, stats]);
}
