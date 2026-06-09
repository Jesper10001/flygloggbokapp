// Wrapped data loader. One async pass that gathers everything the 14 chapters
// need, from data the app already computes (FlightStats + db helpers) plus a few
// derived aggregates (distance-around-earth, top/bottom airports, reach extremes,
// XC hours). Mirrors the prototype's W_DATA shape. Pilot-manned only.

import type { Region } from 'react-native-maps';
import {
  getFlightStats, getMonthlyHours, getVisitedAirportIcaos, getTopWeeks,
  getStressHours, getAllAircraftTypes, getSetting,
} from '../../db/flights';
import { getDatabase } from '../../db/database';
import { calculateDistance } from '../../db/icao';
import { getHourTotals, licenceSetFor } from '../EASAProgressChart';
import { useProfileStore } from '../../store/profileStore';
import type { FlightStats } from '../../types/flight';
import type { SeedRow } from '../GlobalAirportMap';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EARTH_KM = 40075;

export interface WAirport { icao: string; name: string; country: string; visits: number; home?: boolean }
export interface WExtreme { icao: string; name: string }

export interface WrappedData {
  firstName: string;
  stats: FlightStats;

  // ch.3 monthly
  monthly: { label: string; h: number }[];
  bestMonth: { label: string; h: number } | null;

  // ch.4/5/6 airports
  visitedCount: number;
  countriesCount: number;
  home: WAirport | null;
  topAirports: WAirport[];      // up to 10, desc
  bottomAirports: WAirport[];   // up to 5, asc
  mapSeed: SeedRow[];           // visited airports for the native map
  mapRegion: Region | null;     // auto-frame
  reach: { north: WExtreme; south: WExtreme; west: WExtreme; east: WExtreme; spanKm: number } | null;

  // ch.2 distance
  distanceKm: number;
  laps: number;

  // ch.7 aircraft
  aircraftTypes: number;
  registrations: number;
  topType: { type: string; hours: number } | null;
  typeBreakdown: { type: string; hours: number }[];

  // ch.13 EASA / reach uses xc
  xcHours: number;
  licence: { code: string; allMet: boolean; progress: number; metCount: number; bars: { label: string; have: number; need: number }[] };

  // ch.12 currency
  recent14: number;
  yearAvg14: number;

  // chapter gating
  has: boolean;          // any flights
  hasMonthly: boolean;
  hasVisited: boolean;
  hasBestWeek: boolean;
  hasLongest: boolean;
  hasRecent: boolean;    // recent14 > 0
}

function regionForBounds(rows: { lat: number; lon: number }[]): Region | null {
  if (!rows.length) return null;
  let latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
  for (const r of rows) {
    if (!isFinite(r.lat) || !isFinite(r.lon)) continue;
    latMin = Math.min(latMin, r.lat); latMax = Math.max(latMax, r.lat);
    lonMin = Math.min(lonMin, r.lon); lonMax = Math.max(lonMax, r.lon);
  }
  if (latMin > latMax) return null;
  const latDelta = Math.max((latMax - latMin) * 1.5, 4);
  const lonDelta = Math.max((lonMax - lonMin) * 1.5, 4);
  return {
    latitude: (latMin + latMax) / 2,
    longitude: (lonMin + lonMax) / 2,
    latitudeDelta: Math.min(latDelta, 140),
    longitudeDelta: Math.min(lonDelta, 140),
  };
}

export async function loadWrappedData(): Promise<WrappedData> {
  const db = await getDatabase();

  const [firstName, stats, monthlyRaw, visitedIcaos, stress, types] = await Promise.all([
    getSetting('profile_first_name').then((v) => v ?? '').catch(() => ''),
    getFlightStats(),
    getMonthlyHours().catch(() => [] as { year: number; month: number; hours: number }[]),
    getVisitedAirportIcaos().catch(() => [] as string[]),
    getStressHours().catch(() => ({ recent14: 0, yearAvg14: 0 })),
    getAllAircraftTypes().catch(() => []),
  ]);

  // ── Monthly: last 12 calendar months, zero-filled ──
  const mMap = new Map<string, number>();
  for (const m of monthlyRaw) mMap.set(`${m.year}-${m.month}`, m.hours);
  const now = new Date();
  const monthly: { label: string; h: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const h = mMap.get(`${d.getFullYear()}-${d.getMonth() + 1}`) ?? 0;
    monthly.push({ label: MONTHS_SHORT[d.getMonth()], h: Math.round(h) });
  }
  let bestMonth: { label: string; h: number } | null = null;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const h = mMap.get(`${d.getFullYear()}-${d.getMonth() + 1}`) ?? 0;
    if (!bestMonth || h > bestMonth.h) bestMonth = { label: MONTHS_LONG[d.getMonth()], h: Math.round(h) };
  }
  if (bestMonth && bestMonth.h <= 0) bestMonth = null;

  // ── Visited airports: rows (name/country/coords) + visit counts ──
  const icaos = [...new Set(visitedIcaos)]; // getVisitedAirportIcaos kan ge dubbletter
  let visitedRows: { icao: string; name: string; country: string; lat: number; lon: number }[] = [];
  let countMap = new Map<string, number>();
  if (icaos.length) {
    const ph = icaos.map(() => '?').join(',');
    visitedRows = await db.getAllAsync<{ icao: string; name: string; country: string; lat: number; lon: number }>(
      `SELECT icao, name, country, lat, lon FROM icao_airports WHERE icao IN (${ph}) AND lat IS NOT NULL`,
      icaos,
    ).catch(() => []);
    const counts = await db.getAllAsync<{ place: string; c: number }>(
      `SELECT place, COUNT(*) c FROM (
         SELECT dep_place AS place FROM flights WHERE flight_type != 'sim'
         UNION ALL SELECT arr_place AS place FROM flights WHERE flight_type != 'sim'
         UNION ALL SELECT stop_place AS place FROM flights WHERE flight_type != 'sim'
       ) WHERE place IN (${ph}) GROUP BY place`,
      icaos,
    ).catch(() => []);
    countMap = new Map(counts.map((r) => [r.place, r.c]));
  }
  const rowByIcao = new Map(visitedRows.map((r) => [r.icao, r]));
  const nameOf = (icao: string) => rowByIcao.get(icao)?.name || icao;

  const ranked: WAirport[] = icaos
    .map((icao) => ({
      icao,
      name: nameOf(icao),
      country: rowByIcao.get(icao)?.country || '',
      visits: countMap.get(icao) ?? 0,
    }))
    .filter((a) => a.visits > 0)
    .sort((a, b) => b.visits - a.visits);
  if (ranked.length) ranked[0].home = true;

  const topAirports = ranked.slice(0, 10);
  const bottomAirports = [...ranked].reverse().slice(0, 5);
  const home = ranked[0] ?? null;
  const countriesCount = new Set(visitedRows.map((r) => r.country).filter(Boolean)).size;
  const mapSeed: SeedRow[] = visitedRows.map((r) => [r.icao, r.name, r.country, '', r.lat, r.lon]);
  const mapRegion = regionForBounds(visitedRows);

  // ── Reach extremes ──
  let reach: WrappedData['reach'] = null;
  if (visitedRows.length >= 2) {
    let n = visitedRows[0], s = visitedRows[0], w = visitedRows[0], e = visitedRows[0];
    for (const r of visitedRows) {
      if (r.lat > n.lat) n = r;
      if (r.lat < s.lat) s = r;
      if (r.lon < w.lon) w = r;
      if (r.lon > e.lon) e = r;
    }
    // span = greatest great-circle distance between any two visited fields
    let spanKm = 0;
    for (let i = 0; i < visitedRows.length; i++) {
      for (let j = i + 1; j < visitedRows.length; j++) {
        const d = calculateDistance(visitedRows[i].lat, visitedRows[i].lon, visitedRows[j].lat, visitedRows[j].lon);
        if (d > spanKm) spanKm = d;
      }
    }
    reach = {
      north: { icao: n.icao, name: n.name }, south: { icao: s.icao, name: s.name },
      west: { icao: w.icao, name: w.name }, east: { icao: e.icao, name: e.name },
      spanKm: Math.round(spanKm),
    };
  }

  // ── Distance around the Earth (Σ time × cruise per type) ──
  const distRow = await db.getFirstAsync<{ nm: number }>(
    `SELECT COALESCE(SUM(f.total_time * ar.spd), 0) AS nm
     FROM flights f
     LEFT JOIN (SELECT aircraft_type, MAX(cruise_speed_kts) AS spd FROM aircraft_registry GROUP BY aircraft_type) ar
       ON ar.aircraft_type = f.aircraft_type
     WHERE f.flight_type != 'sim'`,
  ).catch(() => ({ nm: 0 }));
  const distanceKm = Math.round((distRow?.nm ?? 0) * 1.852);
  const laps = distanceKm / EARTH_KM;

  // ── Aircraft ──
  const typeRows = types.filter((t) => t.total_hours > 0);
  const typeBreakdown = typeRows.map((t) => ({ type: t.aircraft_type, hours: Math.round(t.total_hours) }));
  const registrations = typeRows.reduce((sum, t) => sum + (t.reg_count || 0), 0);
  const topType = typeBreakdown[0] ? { type: typeBreakdown[0].type, hours: typeBreakdown[0].hours } : null;

  // ── XC hours (app's existing measure) ──
  const xcRow = await db.getFirstAsync<{ h: number }>(
    `SELECT COALESCE(ROUND(SUM(total_time), 0), 0) AS h FROM flights
     WHERE flight_type != 'sim' AND dep_place != arr_place AND total_time >= 0.5`,
  ).catch(() => ({ h: 0 }));
  const xcHours = xcRow?.h ?? 0;

  // ── Adaptive licence (rätt kategori + regelverk, samma tabeller som progresskartan) ──
  const stdRaw = await getSetting('regulation_standard').catch(() => null);
  const standard: 'easa' | 'faa' | 'caa' = stdRaw === 'faa' ? 'faa' : stdRaw === 'caa' ? 'caa' : 'easa';
  const subRole = useProfileStore.getState().profile?.subRole;
  // Kategori utifrån vad man FAKTISKT flyger (aircraft_registry.category), annars
  // onboarding-subrollen. Helikopter → (H)-licenser, flygplan → (A).
  let heliH = 0, fixedH = 0;
  for (const t of types) {
    if (t.category === 'helicopter') heliH += t.total_hours;
    else if (t.category === 'airplane') fixedH += t.total_hours;
  }
  const effectiveSubRole = (heliH > 0 || fixedH > 0) ? (heliH > fixedH ? 'rotary' : 'fixed') : subRole;
  const totals = await getHourTotals().catch(() => ({} as Record<string, number>));
  const set = licenceSetFor(effectiveSubRole, standard);
  const steps = [set.ppl, set.cpl, set.atpl];
  const isMet = (s: typeof steps[number]) => s.reqs.every((r) => (totals[r.key] ?? 0) >= r.required);
  const target = steps.find((s) => !isMet(s));
  const licAllMet = !target;
  const lic = licAllMet ? set.atpl : target!;
  const licBars = lic.reqs.map((r) => ({ label: r.label, have: totals[r.key] ?? 0, need: r.required }));
  const licMetCount = licBars.filter((b) => b.have >= b.need).length;
  const licProgress = Math.round(licBars.reduce((s, b) => s + Math.min(b.have / b.need, 1), 0) / licBars.length * 100);
  const licence = { code: lic.code, allMet: licAllMet, progress: licProgress, metCount: licMetCount, bars: licBars };

  const has = (stats.total_flights ?? 0) > 0;

  return {
    firstName, stats,
    monthly, bestMonth,
    visitedCount: icaos.length, countriesCount, home, topAirports, bottomAirports,
    mapSeed, mapRegion, reach,
    distanceKm, laps,
    aircraftTypes: typeBreakdown.length, registrations, topType, typeBreakdown,
    xcHours, licence,
    recent14: stress.recent14 ?? 0, yearAvg14: stress.yearAvg14 ?? 0,
    has,
    hasMonthly: monthly.some((m) => m.h > 0),
    hasVisited: icaos.length > 0,
    hasBestWeek: !!stats.best_week_start,
    hasLongest: !!stats.longest_xc_date,
    hasRecent: (stress.recent14 ?? 0) > 0,
  };
}
