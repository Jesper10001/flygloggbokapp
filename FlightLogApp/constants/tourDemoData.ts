// DEMO-data för Blades introduction. Visas ENBART under rundturen (tourStore.demo === true), och bara
// när den aktuella loggboken är helt tom. Swappas in vid RENDER — skrivs ALDRIG till databasen och syns
// aldrig någon annanstans. Alla id:n är NEGATIVA så de aldrig kan krocka med riktiga rader.
import type { Flight, FlightStats } from '../types/flight';
import type { AircraftRegistryEntry } from '../db/flights';
import type { DigitalBook } from '../db/digitalBooks';
import type { DroneFlight, DroneStats, DroneModelFleet } from '../db/drones';
import { buildSunTimeline } from '../utils/sunTimeline';

// Fleet-bilden hämtas i demo på SAMMA sätt som på riktigt (gratis Wikipedia-uppslag via
// fetchAircraftImage/fetchDroneImage i FleetCard/DroneFleetCard) — inte en bundlad asset. Dessa
// kandidat-titlar motsvarar det AI-uppslaget annars ger ('wiki_title' m.fl.).
export const DEMO_AIRCRAFT_IMAGE_QUERIES: Record<string, string[]> = {
  C172: ['Cessna 172', 'Cessna 172 Skyhawk'],
  PA28: ['Piper PA-28 Cherokee', 'Piper PA-28'],
  DA42: ['Diamond DA42', 'Diamond DA42 Twin Star'],
};
export const DEMO_DRONE_IMAGE_QUERIES: Record<string, string[]> = {
  'Mavic 3 Enterprise': ['DJI Mavic 3', 'DJI Mavic'],
  'Matrice 350 RTK': ['DJI Matrice 350 RTK', 'DJI Matrice 300'],
};

// ── Pilot (manned) ────────────────────────────────────────────────────────────

// Fyller alla Flight-fält med nollvärden och låter partialen skriva över → koncis demo-data.
function mkFlight(p: Partial<Flight>): Flight {
  return {
    id: 0, date: '', aircraft_type: '', registration: '',
    dep_place: '', dep_utc: '', arr_place: '', arr_utc: '',
    dep_place_raw: null, arr_place_raw: null,
    total_time: 0, ifr: 0, night: 0, pic: 0, co_pilot: 0, dual: 0,
    landings_day: 0, landings_night: 0, remarks: '', created_at: '2026-01-01T00:00:00.000Z',
    status: 'manual' as any, source: 'manual' as any, flight_rules: 'VFR',
    second_pilot: '', second_pilot_role: '', extra_pilots: '',
    nvg: 0, tng_count: 0, flight_type: 'normal', multi_pilot: 0, single_pilot: 0,
    instructor: 0, picus: 0, spic: 0, examiner: 0, safety_pilot: 0, observer: 0,
    ferry_pic: 0, relief_crew: 0, sim_category: '', operator_data: '', vfr: 0,
    se_time: 0, me_time: 0, solo: 0, cross_country: 0, photo_uri: '', media_type: '',
    photo_local_id: null, max_fl: 0, takeoffs_day: 0, takeoffs_night: 0, app_2d: 0, app_3d: 0,
    pilot_flying: 0, landings_fs_day: 0, landings_fs_night: 0, takeoffs_faa_night: 0,
    landings_faa_night: 0, landings_fs_faa_night: 0, holds: 0,
    ...p,
  };
}

// 8 realistiska flygningar (aug–okt 2026) → fyller dashboard, list, book och fleet snyggt.
export const DEMO_FLIGHTS: Flight[] = [
  mkFlight({ id: -1, date: '2026-08-16', aircraft_type: 'C172', registration: 'SE-ABC', dep_place: 'ESSB', dep_utc: '09:10', arr_place: 'ESGG', arr_utc: '10:40', total_time: 1.5, pic: 1.5, se_time: 1.5, single_pilot: 1.5, vfr: 1.5, cross_country: 1.5, landings_day: 1, takeoffs_day: 1, flight_rules: 'VFR', remarks: 'Scenic coastal nav' }),
  mkFlight({ id: -2, date: '2026-08-23', aircraft_type: 'C172', registration: 'SE-ABC', dep_place: 'ESGG', dep_utc: '14:05', arr_place: 'ESSB', arr_utc: '15:45', total_time: 1.6, pic: 1.6, se_time: 1.6, single_pilot: 1.6, vfr: 1.6, cross_country: 1.6, landings_day: 1, takeoffs_day: 1, flight_rules: 'VFR' }),
  mkFlight({ id: -3, date: '2026-09-06', aircraft_type: 'PA28', registration: 'SE-KXY', dep_place: 'ESSB', dep_utc: '08:00', arr_place: 'EKCH', arr_utc: '10:06', total_time: 2.1, pic: 2.1, ifr: 2.1, se_time: 2.1, single_pilot: 2.1, cross_country: 2.1, landings_day: 1, takeoffs_day: 1, app_3d: 1, flight_rules: 'IFR', remarks: 'ILS 04L' }),
  mkFlight({ id: -4, date: '2026-09-13', aircraft_type: 'PA28', registration: 'SE-KXY', dep_place: 'EKCH', dep_utc: '17:30', arr_place: 'ESSB', arr_utc: '19:30', total_time: 2.0, pic: 2.0, ifr: 2.0, night: 0.8, se_time: 2.0, single_pilot: 2.0, cross_country: 2.0, landings_night: 1, takeoffs_night: 1, app_3d: 1, flight_rules: 'IFR', remarks: 'Night return' }),
  mkFlight({ id: -5, date: '2026-09-20', aircraft_type: 'C172', registration: 'SE-ABC', dep_place: 'ESSB', dep_utc: '12:00', arr_place: 'ESSB', arr_utc: '13:12', total_time: 1.2, dual: 1.2, se_time: 1.2, single_pilot: 1.2, vfr: 1.2, landings_day: 3, takeoffs_day: 3, flight_rules: 'VFR', remarks: 'Circuits — crosswind' }),
  mkFlight({ id: -6, date: '2026-09-27', aircraft_type: 'DA42', registration: 'SE-MEL', dep_place: 'ESSA', dep_utc: '07:45', arr_place: 'ENGM', arr_utc: '10:09', total_time: 2.4, pic: 2.4, ifr: 2.4, me_time: 2.4, single_pilot: 2.4, cross_country: 2.4, landings_day: 1, takeoffs_day: 1, app_3d: 1, holds: 1, flight_rules: 'IFR', remarks: 'Airways, light icing' }),
  mkFlight({ id: -7, date: '2026-10-04', aircraft_type: 'DA42', registration: 'SE-MEL', dep_place: 'ENGM', dep_utc: '16:20', arr_place: 'ESSA', arr_utc: '18:38', total_time: 2.3, pic: 2.3, ifr: 2.3, night: 1.0, me_time: 2.3, single_pilot: 2.3, cross_country: 2.3, landings_night: 1, takeoffs_night: 1, app_3d: 1, flight_rules: 'IFR' }),
  mkFlight({ id: -8, date: '2026-10-08', aircraft_type: 'C172', registration: 'SE-ABC', dep_place: 'ESSB', dep_utc: '10:30', arr_place: 'ESSB', arr_utc: '11:30', total_time: 1.0, pic: 1.0, se_time: 1.0, single_pilot: 1.0, solo: 1.0, vfr: 1.0, landings_day: 2, takeoffs_day: 2, flight_rules: 'VFR', remarks: 'Local solo' }),
];

// Förberäknade totaler (demo → behöver inte matcha exakt, bara se levande ut).
export const DEMO_STATS: FlightStats = {
  total_flights: 8, total_time: 14.1, total_pic: 12.9, total_co_pilot: 0, total_dual: 1.2,
  total_ifr: 8.8, total_night: 1.8, total_sim: 0, total_landings_day: 9, total_landings_night: 2,
  last_90_days: 14.1, last_12_months: 14.1,
  best_week_hours: 4.7, best_week_label: 'Sep 27 – Oct 4', best_week_start: '2026-09-27', best_week_last_flight_id: -7,
  longest_xc_hours: 2.4, longest_xc_km: 189, longest_xc_date: '2026-09-27', longest_xc_first_dep: 'ESSA', longest_xc_last_arr: 'ENGM', longest_xc_id: -6,
  total_multi_pilot: 0, total_single_pilot: 14.1, total_instructor: 0, total_se: 9.4, total_me: 4.7,
  total_vfr: 5.3, total_nvg: 0, year_to_date: 14.1,
  total_picus: 0, total_spic: 0, total_ferry_pic: 0, total_observer: 0, total_relief_crew: 0,
  total_examiner: 0, total_safety_pilot: 0,
};

// Fleet — 3 typer. Fyller bara fälten Fleet-kortet faktiskt visar; specs lämnas 0/'' (okänt).
function mkAircraft(p: Partial<AircraftRegistryEntry>): AircraftRegistryEntry {
  return {
    aircraft_type: '', cruise_speed_kts: 0, endurance_h: 0, crew_type: 'sp', category: '',
    engine_type: 'piston', image_url: '', image_credit: '', reg_count: 1, total_hours: 0, sim_hours: 0,
    top_registration: '', top_registration_hours: 0, flight_count: 0,
    maker: '', vne: 0, vne_unit: 'kt', mtow: 0, mtow_unit: 'kg', fuel_burn: 0, fuel_burn_unit: 'l/h',
    power_hp: 0, ceiling_ft: 0, wingspan_m: 0, empty_weight_kg: 0, fuel_capacity_l: 0, range_nm: 0,
    cutout_url: '', rating_expiry: '', rating_class: '', last_flown: '', first_flown: '',
    ...p,
  };
}

// Specs är ifyllda (som efter en lyckad fleet-hämtning) → demo-kortet visar aldrig "Fetch".
export const DEMO_AIRCRAFT: AircraftRegistryEntry[] = [
  mkAircraft({ aircraft_type: 'DA42', maker: 'Diamond', category: 'MEP', engine_type: 'piston', total_hours: 4.7, flight_count: 2, reg_count: 1, top_registration: 'SE-MEL', top_registration_hours: 4.7, last_flown: '2026-10-04', first_flown: '2026-09-27', cruise_speed_kts: 170, endurance_h: 7, vne: 194, mtow: 1785, fuel_burn: 38, power_hp: 168, ceiling_ft: 18000, wingspan_m: 13.4, empty_weight_kg: 1420, fuel_capacity_l: 189, range_nm: 1200, rating_class: 'MEP' }),
  mkAircraft({ aircraft_type: 'PA28', maker: 'Piper', category: 'SEP', engine_type: 'piston', total_hours: 4.1, flight_count: 2, reg_count: 1, top_registration: 'SE-KXY', top_registration_hours: 4.1, last_flown: '2026-09-13', first_flown: '2026-09-06', cruise_speed_kts: 124, endurance_h: 5, vne: 154, mtow: 1157, fuel_burn: 34, power_hp: 180, ceiling_ft: 14000, wingspan_m: 10.7, empty_weight_kg: 703, fuel_capacity_l: 182, range_nm: 610, rating_class: 'SEP' }),
  mkAircraft({ aircraft_type: 'C172', maker: 'Cessna', category: 'SEP', engine_type: 'piston', total_hours: 5.3, flight_count: 4, reg_count: 1, top_registration: 'SE-ABC', top_registration_hours: 5.3, last_flown: '2026-10-08', first_flown: '2026-08-16', cruise_speed_kts: 122, endurance_h: 5, vne: 163, mtow: 1157, fuel_burn: 32, power_hp: 160, ceiling_ft: 13500, wingspan_m: 11, empty_weight_kg: 767, fuel_capacity_l: 212, range_nm: 640, rating_class: 'SEP' }),
];

// En byggd "Professional Pilot Logbook" (template-id 'easa-professional-pilot'), obegränsad (end_page 0).
export const DEMO_BOOK: DigitalBook = {
  id: -1, name: 'Example logbook', template_id: 'easa-professional-pilot',
  starting_page: 1, rows_per_spread: 12, end_page: 0, end_row: 0,
  is_active: 1, created_at: '2026-08-01T00:00:00.000Z', kind: 'digital',
  opening_balance: '{}', custom_cols: '{}',
  anchor_flight_id: 0, anchor_page: 0, anchor_row: 0, display_order: 0, acked_spread: 0,
};

// ── Drönare (unmanned) ──────────────────────────────────────────────────────────

function mkDroneFlight(p: Partial<DroneFlight>): DroneFlight {
  return {
    id: 0, date: '', drone_id: null, drone_type: 'multirotor', registration: '',
    location: '', lat: 0, lon: 0, takeoff_time: '', landing_location: '', landing_lat: 0, landing_lon: 0,
    mission_type: '', category: '', flight_mode: 'VLOS', total_time: 0, max_altitude_m: 0,
    is_night: 0, night_time: 0, vfr: 0, flight_rules: 'VFR', has_observer: 0, observer_name: '',
    wind_ms: 0, co_pilot_fpv: 0, dual: 0, instructor: 0, ifr: 0, landings_day: 0, landings_night: 0,
    operation_type: 'PRI', remarks: '', created_at: '2026-01-01T00:00:00.000Z',
    photo_uri: '', media_type: '', photo_local_id: null, source: 'manual',
    h_vlos: 0, h_evlos: 0, h_bvlos: 0, h_a1: 0, h_a2: 0, h_a3: 0, h_specific: 0, h_certified: 0, h_night: 0,
    pilot_role: '', second_pilot: '', second_pilot_role: '', extra_pilots: '',
    ...p,
  };
}

export const DEMO_DRONE_FLIGHTS: DroneFlight[] = [
  mkDroneFlight({ id: -1, date: '2026-08-20', drone_type: 'multirotor', registration: 'SE-D001', location: 'Stockholm', takeoff_time: '10:00', flight_mode: 'VLOS', category: 'A1', operation_type: 'PRI', total_time: 0.4, max_altitude_m: 80, landings_day: 1, remarks: 'Rooftop survey' }),
  mkDroneFlight({ id: -2, date: '2026-09-02', drone_type: 'multirotor', registration: 'SE-D001', location: 'Göteborg', takeoff_time: '13:30', flight_mode: 'VLOS', category: 'A2', operation_type: 'COM', total_time: 0.5, max_altitude_m: 60, landings_day: 1, remarks: 'Facade inspection' }),
  mkDroneFlight({ id: -3, date: '2026-09-15', drone_type: 'multirotor', registration: 'SE-D002', location: 'Kiruna', takeoff_time: '09:15', flight_mode: 'BVLOS', category: 'specific', operation_type: 'COM', total_time: 0.7, max_altitude_m: 110, landings_day: 1, has_observer: 1, observer_name: 'A. Berg', remarks: 'Powerline corridor' }),
  mkDroneFlight({ id: -4, date: '2026-09-25', drone_type: 'multirotor', registration: 'SE-D001', location: 'Malmö', takeoff_time: '21:10', flight_mode: 'VLOS', category: 'A3', operation_type: 'COM', total_time: 0.6, max_altitude_m: 100, is_night: 1, night_time: 0.6, landings_night: 1, remarks: 'Night thermal' }),
  mkDroneFlight({ id: -5, date: '2026-10-03', drone_type: 'multirotor', registration: 'SE-D002', location: 'Umeå', takeoff_time: '11:00', flight_mode: 'BVLOS', category: 'specific', operation_type: 'COM', total_time: 0.8, max_altitude_m: 120, landings_day: 1, remarks: 'Forestry mapping' }),
  mkDroneFlight({ id: -6, date: '2026-10-07', drone_type: 'multirotor', registration: 'SE-D001', location: 'Stockholm', takeoff_time: '15:45', flight_mode: 'VLOS', category: 'A1', operation_type: 'PRI', total_time: 0.3, max_altitude_m: 50, landings_day: 1 }),
];

export const DEMO_DRONE_STATS: DroneStats = {
  total_flights: 6, total_time: 3.3, year_to_date: 3.3,
  vlos: 1.8, evlos: 0, bvlos: 1.5, night: 0.6,
  cat_a1: 0.7, cat_a2: 0.5, cat_a3: 0.6, cat_specific: 1.5, cat_certified: 0,
};

// Insights-stoppet (drönare): en fylligare operatör än loggbokens sex exempel, så att sidan ser ut som efter ett
// år av riktigt flygande. Bara i minnet under rundturen.
export const DEMO_DRONE_INSIGHTS = {
  stats: {
    total_flights: 148, total_time: 96.4, year_to_date: 41.2,
    vlos: 58.3, evlos: 12.5, bvlos: 25.6, night: 9.8,
    cat_a1: 14.2, cat_a2: 21.7, cat_a3: 18.9, cat_specific: 41.6, cat_certified: 0,
  } as DroneStats,
  last90: 14.5,
  recency: [
    { category: 'Specific', daysAgo: 2, lastFlightDate: '', isStale: false },
    { category: 'A2', daysAgo: 6, lastFlightDate: '', isStale: false },
    { category: 'A1', daysAgo: 19, lastFlightDate: '', isStale: false },
    { category: 'A3', daysAgo: 104, lastFlightDate: '', isStale: true },
  ],
  bank: {
    total: 96.4, flights: 148, night_flights: 17,
    pic: 82.1, sic: 6.3, dual: 8.0, instructor: 0,
    vlos: 58.3, evlos: 12.5, bvlos: 25.6,
    night: 9.8, ifr: 0, com: 71.9, pri: 24.5,
    landings_day: 131, landings_night: 17,
    cats: [{ label: 'A1', v: 14.2 }, { label: 'A2', v: 21.7 }, { label: 'A3', v: 18.9 }, { label: 'Specific', v: 41.6 }],
  },
};

function mkDroneModel(p: Partial<DroneModelFleet>): DroneModelFleet {
  return {
    id: 0, model: '', drone_type: 'multirotor', mtow_g: 0, category: '', drone_class: '', manufacturer: '',
    c_class: '', max_flight_min: 0, max_speed_kmh: 0, ceiling_m: 0, range_km: 0, image_url: '', cutout_url: '', image_credit: '',
    total_hours: 0, last_flown: '', first_flown: '', reg_count: 1, flight_count: 0,
    ...p,
  };
}

// Specs ifyllda (som efter en lyckad fleet-hämtning) → demo-kortet visar aldrig "Fetch".
export const DEMO_DRONE_MODELS: DroneModelFleet[] = [
  mkDroneModel({ id: -1, model: 'Mavic 3 Enterprise', manufacturer: 'DJI', drone_type: 'multirotor', mtow_g: 920, c_class: 'C2', max_flight_min: 45, max_speed_kmh: 75, ceiling_m: 6000, range_km: 15, total_hours: 1.8, flight_count: 4, reg_count: 1, last_flown: '2026-10-07', first_flown: '2026-08-20' }),
  mkDroneModel({ id: -2, model: 'Matrice 350 RTK', manufacturer: 'DJI', drone_type: 'multirotor', mtow_g: 6300, c_class: '', max_flight_min: 55, max_speed_kmh: 82, ceiling_m: 7000, range_km: 20, total_hours: 1.5, flight_count: 2, reg_count: 1, last_flown: '2026-10-03', first_flown: '2026-09-15' }),
];

// En byggd "Remote Pilot Logbook" (template-id 'sv-drone-logbook', 15 rader), obegränsad.
export const DEMO_DRONE_BOOK: DigitalBook = {
  id: -2, name: 'Example logbook', template_id: 'sv-drone-logbook',
  starting_page: 1, rows_per_spread: 15, end_page: 0, end_row: 0,
  is_active: 1, created_at: '2026-08-01T00:00:00.000Z', kind: 'drone',
  opening_balance: '{}', custom_cols: '{}',
  anchor_flight_id: 0, anchor_page: 0, anchor_row: 0, display_order: 0, acked_spread: 0,
};

// ── Exempelflygningen (Blades introduction) ───────────────────────────────────
// Raden som rundturens loggningsexempel "sparar". Den finns BARA i minnet (tourStore.examplePilot /
// exampleDrone) och läggs överst i loggbokslistan medan rundturen kör — den skrivs aldrig till databasen,
// så den kan inte bli kvar efter en krasch och räknas aldrig in i timmar, currency eller statistik.
export const TOUR_EXAMPLE_ID = -9001;

/** Gårdagens datum (lokal tid) — exemplet är alltid en flygning som redan är gjord. */
export function tourExampleDate(): string {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Exemplets rutt och besättning. Koordinaterna står här så att tiderna kan räknas ut utan databasen.
export const TOUR_EXAMPLE_ROUTE = {
  dep: 'ESSA', arr: 'ESGG',
  legs: [{ lat: 59.6519, lon: 17.9186, label: 'ESSA', dwellMin: 0 }, { lat: 57.6628, lon: 12.2798, label: 'ESGG', dwellMin: 0 }],
};
export const TOUR_EXAMPLE_CAPTAIN = 'Anna Berg';

const hhmm = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/**
 * Avgångs- och ankomsttid (UTC) för exemplet, valda så att ungefär halva flygningen går i dagsljus och
 * halva i natt det datumet: då syns det i Log flight hur dag, skymning och natt ritas ut längs rutten.
 * Kvällen väljs före morgonen (start i dagsljus, landning i mörker). Samma sol-modell som appens natt-tid.
 */
export function tourExampleTimes(date: string, durMin: number): { dep: string; arr: string; nightH: number } {
  const [y, mo, d] = date.split('-').map(Number);
  const day0 = Date.UTC(y, (mo || 1) - 1, d || 1, 0, 0, 0);
  let best = { dep: 16 * 60 + 40, score: Infinity, night: 0 };
  for (let m = 0; m < 1440; m += 5) {
    const depMs = day0 + m * 60000;
    const tl = buildSunTimeline(TOUR_EXAMPLE_ROUTE.legs, depMs, depMs + durMin * 60000, 36);
    if (!tl) continue;
    const frac = tl.minutes.night / durMin;
    const score = Math.abs(frac - 0.5) + (tl.runs[0]?.phase === 'night' ? 0.1 : 0);
    if (score < best.score) best = { dep: m, score, night: tl.minutes.night };
  }
  return { dep: hhmm(best.dep), arr: hhmm(best.dep + durMin), nightH: Math.round((best.night / 60) * 10) / 10 };
}

export function makeTourExampleFlight(p: Partial<Flight> = {}): Flight {
  // Du är SIC, kaptenen är PIC — som i loggningsexemplet.
  const date = p.date ?? tourExampleDate();
  const total = p.total_time ?? 0.92;
  const t = tourExampleTimes(date, Math.round(total * 60));
  const night = Math.min(total, t.nightH);
  return mkFlight({
    id: TOUR_EXAMPLE_ID, date, aircraft_type: 'AT72', registration: 'SE-MKG',
    dep_place: TOUR_EXAMPLE_ROUTE.dep, dep_utc: t.dep, arr_place: TOUR_EXAMPLE_ROUTE.arr, arr_utc: t.arr,
    total_time: total, co_pilot: total, ifr: total, multi_pilot: total, me_time: total, cross_country: total, night,
    second_pilot: TOUR_EXAMPLE_CAPTAIN, second_pilot_role: 'PIC', pilot_flying: total,
    landings_day: night > 0 ? 0 : 1, landings_night: night > 0 ? 1 : 0, takeoffs_day: 1,
    flight_rules: 'IFR', remarks: 'Example flight · Blades introduction',
    ...p,
  });
}

export function makeTourExampleDroneFlight(p: Partial<DroneFlight> = {}): DroneFlight {
  return mkDroneFlight({
    id: TOUR_EXAMPLE_ID, date: tourExampleDate(), drone_type: 'multirotor', registration: 'SE-D001',
    location: 'Stockholm', takeoff_time: '10:30', flight_mode: 'BVLOS', category: 'specific', operation_type: 'COM',
    total_time: 0.72, h_vlos: 0.22, h_bvlos: 0.5, landings_day: 2, max_altitude_m: 110,
    remarks: 'Example flight · Blades introduction',
    ...p,
  });
}
