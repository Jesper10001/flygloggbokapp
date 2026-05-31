import { useEffect, useState } from 'react';
import { getXCLegsForDate, getFlightsForWeek, getStressHours, getAircraftCruiseSpeed, getTopWeeks } from '../db/flights';
import { getAirportCoordinates } from '../db/icao';
import { useFlightStore } from '../store/flightStore';
import { useLanguageStore } from '../store/languageStore';
import { decimalToHHMM } from './useTimeFormat';
import { sunTimesUTC } from '../utils/sun';
import { monthShort, monthLong, dowShort } from '../utils/dateLabels';
import type { Flight } from '../types/flight';
import type { RouteLeg } from '../components/milestones/MiniRouteMap';

// ── helpers ────────────────────────────────────────────────────────────────
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay();
  x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow));
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoWeekLabel(monday: Date): string {
  const jan4 = new Date(monday.getFullYear(), 0, 4);
  const weekNum = Math.ceil(((monday.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
  return `v.${weekNum} · ${monday.getFullYear()}`;
}
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1.852;
}

// ════════════════════════════════════════════════════════════════════════════
// LIGHT — dashboard cards
// ════════════════════════════════════════════════════════════════════════════

export function useLongestXcLegs(date?: string): RouteLeg[] {
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  useEffect(() => {
    let alive = true;
    if (!date) { setLegs([]); return; }
    (async () => {
      const raw = await getXCLegsForDate(date);
      if (!raw.length) { if (alive) setLegs([]); return; }
      const icaos = [...new Set(raw.flatMap(l => [l.dep_place, l.arr_place]))];
      const coords = await getAirportCoordinates(icaos);
      const find = (icao: string) => coords.find(c => c.icao === icao);
      const seq: string[] = [raw[0].dep_place, ...raw.map(l => l.arr_place)];
      const pts: RouteLeg[] = [];
      seq.forEach((icao, idx) => {
        if (idx > 0 && seq[idx - 1] === icao) return;
        const c = find(icao);
        if (!c) return;
        pts.push({ icao, lat: c.lat, lon: c.lon, role: 'via' });
      });
      if (pts.length) { pts[0].role = 'dep'; pts[pts.length - 1].role = 'arr'; }
      if (alive) setLegs(pts);
    })().catch(() => { if (alive) setLegs([]); });
    return () => { alive = false; };
  }, [date]);
  return legs;
}

export interface BestWeekDay {
  dow: string;
  date: number;
  iso: string;
  hours: number;
}
export interface BestWeekDetails {
  days: BestWeekDay[];
  sectors: number;
  airports: number;
}

export function useBestWeekDetails(weekStart?: string): BestWeekDetails {
  const language = useLanguageStore(s => s.language);
  const [data, setData] = useState<BestWeekDetails>({ days: [], sectors: 0, airports: 0 });
  useEffect(() => {
    let alive = true;
    if (!weekStart) { setData({ days: [], sectors: 0, airports: 0 }); return; }
    (async () => {
      const flights = await getFlightsForWeek(weekStart);
      const start = parseISO(weekStart);
      const days: BestWeekDay[] = [];
      for (let i = 0; i < 7; i++) {
        const dd = new Date(start);
        dd.setDate(start.getDate() + i);
        days.push({ dow: dowShort(language, dd.getDay()), date: dd.getDate(), iso: isoLocal(dd), hours: 0 });
      }
      flights.forEach(f => {
        const day = days.find(x => x.iso === f.date);
        if (day) day.hours += f.total_time ?? 0;
      });
      const airports = new Set(flights.flatMap(f => [f.dep_place, f.arr_place].filter(Boolean)));
      if (alive) setData({ days, sectors: flights.length, airports: airports.size });
    })().catch(() => { if (alive) setData({ days: [], sectors: 0, airports: 0 }); });
    return () => { alive = false; };
  }, [weekStart, language]);
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
// FULL — fullscreen views
// ════════════════════════════════════════════════════════════════════════════

export interface BWFlightRow { id: number; dep: string; arr: string; dur: string; isPic: boolean }
export interface BWDayFull extends BestWeekDay { flights: BWFlightRow[] }
export interface BWTop5Row { rank: number; label: string; range: string; hours: number; current: boolean }
export interface BestWeekFull {
  ready: boolean;
  hoursLabel: string;
  hoursNum: number;
  weekLabel: string;
  rangeLabel: string;
  days: BWDayFull[];
  daysFlown: number;
  sectors: number;
  airports: number;
  topDay: string;
  baselineWeek: number;
  baselineLabel: string;
  vsAvg: number;
  top5: BWTop5Row[];
}

export function useBestWeekFull(weekStart?: string, weekLabel?: string, hoursNum?: number): BestWeekFull {
  const language = useLanguageStore(s => s.language);
  const [data, setData] = useState<BestWeekFull>({
    ready: false, hoursLabel: '', hoursNum: 0, weekLabel: weekLabel ?? '', rangeLabel: '',
    days: [], daysFlown: 0, sectors: 0, airports: 0, topDay: '—',
    baselineWeek: 0, baselineLabel: '—', vsAvg: 0, top5: [],
  });

  useEffect(() => {
    let alive = true;
    if (!weekStart) { return; }
    (async () => {
      const weekFlights = await getFlightsForWeek(weekStart);
      const stress = await getStressHours().catch(() => ({ yearAvg14: 0, recent14: 0 }));
      const baselineWeek = (stress.yearAvg14 ?? 0) / 2;

      const start = parseISO(weekStart);
      const days: BWDayFull[] = [];
      for (let i = 0; i < 7; i++) {
        const dd = new Date(start);
        dd.setDate(start.getDate() + i);
        days.push({ dow: dowShort(language, dd.getDay()), date: dd.getDate(), iso: isoLocal(dd), hours: 0, flights: [] });
      }
      weekFlights.forEach(f => {
        const day = days.find(x => x.iso === f.date);
        if (!day) return;
        day.hours += f.total_time ?? 0;
        day.flights.push({
          id: f.id,
          dep: f.dep_place || '?',
          arr: f.arr_place || '?',
          dur: decimalToHHMM(f.total_time ?? 0),
          isPic: (f.pic ?? 0) > 0,
        });
      });

      const airports = new Set(weekFlights.flatMap(f => [f.dep_place, f.arr_place].filter(Boolean)));
      const flown = days.filter(d => d.hours > 0);
      const topDay = flown.length ? flown.reduce((a, b) => (b.hours > a.hours ? b : a)).dow : '—';
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const rangeLabel =
        start.getMonth() === end.getMonth()
          ? `${start.getDate()} — ${end.getDate()} ${monthLong(language, end.getMonth())} ${end.getFullYear()}`
          : `${start.getDate()} ${monthShort(language, start.getMonth())} — ${end.getDate()} ${monthShort(language, end.getMonth())} ${end.getFullYear()}`;

      const total = hoursNum ?? weekFlights.reduce((s, f) => s + (f.total_time ?? 0), 0);

      // Top-5 weeks — mirrors the stored best_week query exactly (same filters),
      // so #1 always equals the dashboard's best week.
      const topWeeks = await getTopWeeks(5);
      const top5: BWTop5Row[] = topWeeks.map((w, i) => {
        const mon = parseISO(w.week_start);
        return {
          rank: i + 1,
          label: isoWeekLabel(mon),
          range: `${mon.getDate()} ${monthShort(language, mon.getMonth())}`,
          hours: w.hours,
          current: w.week_start === weekStart,
        };
      });

      if (alive) setData({
        ready: true,
        hoursLabel: decimalToHHMM(total),
        hoursNum: total,
        weekLabel: weekLabel ?? '',
        rangeLabel,
        days,
        daysFlown: flown.length,
        sectors: weekFlights.length,
        airports: airports.size,
        topDay,
        baselineWeek,
        baselineLabel: decimalToHHMM(baselineWeek),
        vsAvg: baselineWeek > 0 ? total / baselineWeek : 0,
        top5,
      });
    })().catch(() => { /* keep not-ready */ });
    return () => { alive = false; };
  }, [weekStart, weekLabel, hoursNum, language]);

  return data;
}

// ── Longest XC full ──────────────────────────────────────────────────────────
export interface LXLeg { icao: string; name: string; lat: number; lon: number; role: 'dep' | 'via' | 'arr' }
export interface LXTop5Row { rank: number; route: string; nm: number; date: string; current: boolean }
export interface LongestXcFull {
  ready: boolean;
  distanceNm: number;
  distanceKm: number;
  durationLabel: string;
  dateLong: string;
  dateShort: string;
  routeFrom: string;
  routeTo: string;
  aircraftReg: string;
  aircraftType: string;
  role: string;
  rules?: string;       // 'IFR' | 'VFR' | undefined
  altFl?: string;       // "FL 280"
  cruiseKts?: number;   // from aircraft_registry (0/undefined = hide)
  blockOff: string;
  blockOn: string;
  totalLabel: string;
  dayLabel: string;
  nightLabel: string;
  sunrise?: string;     // UTC "HH:MM" at departure (undefined = polar/unknown)
  sunset?: string;
  legs: LXLeg[];
  top5: LXTop5Row[];
}

interface XcStatInput {
  date?: string;
  km?: number;        // already NM in this app
  hours?: number;
  flightId?: number | null;
  firstDep?: string;
  lastArr?: string;
}

export function useLongestXcFull(input: XcStatInput): LongestXcFull {
  const allFlights = useFlightStore(s => s.flights);
  const language = useLanguageStore(s => s.language);
  const { date, km, hours, flightId, firstDep, lastArr } = input;
  const [data, setData] = useState<LongestXcFull>({
    ready: false, distanceNm: 0, distanceKm: 0, durationLabel: '', dateLong: '', dateShort: '',
    routeFrom: firstDep ?? '—', routeTo: lastArr ?? '—', aircraftReg: '', aircraftType: '',
    role: '', rules: undefined, altFl: undefined, cruiseKts: undefined, blockOff: '', blockOn: '',
    totalLabel: '', dayLabel: '', nightLabel: '', sunrise: undefined, sunset: undefined, legs: [], top5: [],
  });

  useEffect(() => {
    let alive = true;
    if (!date) { return; }
    (async () => {
      // Legs + coordinates for the route map / leg list.
      const raw = await getXCLegsForDate(date);
      const seq: string[] = raw.length ? [raw[0].dep_place, ...raw.map(l => l.arr_place)] : [];

      // Coordinates for everything we need (legs + all flights for top-5).
      const flightIcaos = new Set<string>();
      allFlights.forEach(f => { if (f.dep_place) flightIcaos.add(f.dep_place); if (f.arr_place) flightIcaos.add(f.arr_place); });
      seq.forEach(i => flightIcaos.add(i));
      const coords = await getAirportCoordinates([...flightIcaos]);
      const cmap = new Map(coords.map(c => [c.icao, c]));

      const legs: LXLeg[] = [];
      seq.forEach((icao, idx) => {
        if (idx > 0 && seq[idx - 1] === icao) return;
        const c = cmap.get(icao);
        if (!c) return;
        legs.push({ icao, name: c.name, lat: c.lat, lon: c.lon, role: 'via' });
      });
      if (legs.length) { legs[0].role = 'dep'; legs[legs.length - 1].role = 'arr'; }

      // The day's flights (for aircraft, day/night, block window).
      const dayFlights = allFlights.filter(f => f.date === date);
      const idFlight = (flightId ? allFlights.find(f => f.id === flightId) : undefined) ?? dayFlights[dayFlights.length - 1];
      const nightSum = dayFlights.reduce((s, f) => s + (f.night ?? 0), 0);
      const totalSum = hours ?? dayFlights.reduce((s, f) => s + (f.total_time ?? 0), 0);
      const daySum = Math.max(0, totalSum - nightSum);
      const maxFl = Math.max(0, ...dayFlights.map(f => f.max_fl ?? 0));
      const sortedByDep = [...dayFlights].sort((a, b) => (a.dep_utc || '').localeCompare(b.dep_utc || ''));

      const d = parseISO(date);
      const dateLong = `${d.getDate()} ${monthLong(language, d.getMonth())} ${d.getFullYear()}`;
      const dateShort = `${String(d.getDate()).padStart(2, '0')} ${monthShort(language, d.getMonth())} ${d.getFullYear()}`;

      // Day-based top-5 (matches the headline day-distance), great-circle per leg.
      const byDate = new Map<string, Flight[]>();
      allFlights.forEach(f => {
        if (!f.date) return;
        if (!byDate.has(f.date)) byDate.set(f.date, []);
        byDate.get(f.date)!.push(f);
      });
      const dayDist: Array<{ date: string; nm: number; from: string; to: string }> = [];
      byDate.forEach((fs, dt) => {
        let nm = 0;
        fs.forEach(f => {
          const a = cmap.get(f.dep_place), b = cmap.get(f.arr_place);
          if (a && b) nm += haversineNm(a.lat, a.lon, b.lat, b.lon);
        });
        if (nm <= 0) return;
        const sorted = [...fs].sort((a, b) => (a.dep_utc || '').localeCompare(b.dep_utc || ''));
        dayDist.push({ date: dt, nm: Math.round(nm), from: sorted[0]?.dep_place || '', to: sorted[sorted.length - 1]?.arr_place || '' });
      });
      const top5: LXTop5Row[] = dayDist
        .sort((a, b) => b.nm - a.nm)
        .slice(0, 5)
        .map((r, i) => {
          const rd = parseISO(r.date);
          return {
            rank: i + 1,
            route: `${r.from} → ${r.to}`,
            nm: r.nm,
            date: `${String(rd.getDate()).padStart(2, '0')} ${monthShort(language, rd.getMonth())} ${rd.getFullYear()}`,
            current: r.date === date,
          };
        });

      const rules = idFlight?.flight_rules ? idFlight.flight_rules.toUpperCase() : undefined;

      // Cruise speed from the aircraft registry (0 → hide chip).
      const cruise = idFlight?.aircraft_type
        ? await getAircraftCruiseSpeed(idFlight.aircraft_type).catch(() => 0)
        : 0;

      // Sun times at the departure airport, in UTC (same timeline as block off/on).
      let sunrise: string | undefined, sunset: string | undefined;
      const dep = legs[0];
      if (dep) {
        const s = sunTimesUTC(d, dep.lat, dep.lon);
        sunrise = s.sunrise ?? undefined;
        sunset = s.sunset ?? undefined;
      }

      if (alive) setData({
        ready: true,
        distanceNm: km ?? 0,
        distanceKm: Math.round((km ?? 0) * 1.852),
        durationLabel: decimalToHHMM(totalSum),
        dateLong, dateShort,
        routeFrom: legs[0]?.icao || firstDep || '—',
        routeTo: legs[legs.length - 1]?.icao || lastArr || '—',
        aircraftReg: idFlight?.registration || '',
        aircraftType: idFlight?.aircraft_type || '',
        role: (idFlight?.pic ?? 0) > 0 ? 'PIC' : (idFlight?.co_pilot ?? 0) > 0 ? 'CO' : '',
        rules,
        altFl: maxFl > 0 ? `FL ${maxFl}` : undefined,
        cruiseKts: cruise > 0 ? cruise : undefined,
        blockOff: sortedByDep[0]?.dep_utc || '',
        blockOn: sortedByDep[sortedByDep.length - 1]?.arr_utc || '',
        totalLabel: decimalToHHMM(totalSum),
        dayLabel: decimalToHHMM(daySum),
        nightLabel: decimalToHHMM(nightSum),
        sunrise,
        sunset,
        legs,
        top5,
      });
    })().catch(() => { /* keep not-ready */ });
    return () => { alive = false; };
  }, [date, km, hours, flightId, firstDep, lastArr, allFlights, language]);

  return data;
}
