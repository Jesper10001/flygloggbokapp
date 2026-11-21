import { create } from 'zustand';
import { dbChangeStamp, sameStamp, type ChangeStamp } from '../db/flights';

// Senaste läsningarnas ändringsstämplar (se loadFlights)
let flightsStamp: ChangeStamp | null = null;
let statsStamp: ChangeStamp | null = null;
let statsAt = 0;
import type { Flight, FlightStats } from '../types/flight';
import {
  getFlights,
  getFlightStats,
  getFlightCount,
  getManualFlightCount,
  deleteFlight,
} from '../db/flights';
import { getDroneFlightCount } from '../db/drones';
import { FREE_TIER_LIMIT, FREE_TIER_LIMIT_DRONE } from '../constants/easa';

export type SubscriptionTier = 'free' | 'premium' | 'max';

interface FlightStore {
  flights: Flight[];
  stats: FlightStats | null;
  flightCount: number;
  manualFlightCount: number;
  manualDroneFlightCount: number;
  tier: SubscriptionTier;
  isPremium: boolean;
  isMax: boolean;
  isLoading: boolean;

  loadFlights: () => Promise<void>;
  loadDroneFlightCount: () => Promise<void>;
  loadStats: () => Promise<void>;
  removeFlight: (id: number) => Promise<void>;
  setTier: (tier: SubscriptionTier) => void;
  setIsPremium: (val: boolean) => void;
  canAddFlight: () => boolean;
  canAddDroneFlight: () => boolean;
}

const emptyStats: FlightStats = {
  total_flights: 0,
  total_time: 0,
  total_pic: 0,
  total_co_pilot: 0,
  total_dual: 0,
  total_ifr: 0,
  total_night: 0,
  total_sim: 0,
  total_landings_day: 0,
  total_landings_night: 0,
  last_90_days: 0,
  last_12_months: 0,
  best_week_hours: 0,
  best_week_label: '',
  best_week_start: '',
  best_week_last_flight_id: null,
  longest_xc_hours: 0,
  longest_xc_km: 0,
  longest_xc_date: '',
  longest_xc_first_dep: '',
  longest_xc_last_arr: '',
  longest_xc_id: null,
  total_multi_pilot: 0,
  total_single_pilot: 0,
  total_instructor: 0,
  total_se: 0,
  total_me: 0,
  total_vfr: 0,
  total_nvg: 0,
  year_to_date: 0,
  total_picus: 0,
  total_spic: 0,
  total_ferry_pic: 0,
  total_observer: 0,
  total_relief_crew: 0,
  total_examiner: 0,
  total_safety_pilot: 0,
};

export const useFlightStore = create<FlightStore>((set, get) => ({
  flights: [],
  stats: null,
  flightCount: 0,
  manualFlightCount: 0,
  manualDroneFlightCount: 0,
  tier: 'free' as SubscriptionTier,
  isPremium: false,
  isMax: false,
  isLoading: false,

  // Läses vid varje fokus på dashboard, Logbook och Insights. Tidigare lästes hela tabellen om varje gång och
  // flikarna i bakgrunden räknade om allt på den nya listan (JS-frysning ~2 s vid snabba flikbyten, Sentry
  // BLADES-IOS-5). Nu: oförändrad databas (dbChangeStamp) → ingen omläsning och ingen ny lista.
  loadFlights: async () => {
    try {
      const stamp = await dbChangeStamp();
      if (sameStamp(flightsStamp, stamp)) return;
      if (!get().flights.length) set({ isLoading: true });
      const [flights, count, manualCount] = await Promise.all([
        getFlights(10000),
        getFlightCount(),
        getManualFlightCount(),
      ]);
      flightsStamp = stamp;
      set({ flights, flightCount: count, manualFlightCount: manualCount, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  // Alla drönarflygningar loggas manuellt (ingen drönar-import) → drone_flights-antalet = manuell pott.
  loadDroneFlightCount: async () => {
    try {
      const c = await getDroneFlightCount();
      set({ manualDroneFlightCount: c });
    } catch { /* ignore */ }
  },

  loadStats: async () => {
    try {
      const stamp = await dbChangeStamp();
      // Samma data och mindre än 10 min sedan → samma statistik (90 dagar/12 mån beror också på datumet)
      if (sameStamp(statsStamp, stamp) && Date.now() - statsAt < 10 * 60 * 1000) return;
      const stats = await getFlightStats();
      const count = await getFlightCount();
      statsStamp = await dbChangeStamp();   // efter läsningen (syncBackfillRow kan skriva)
      statsAt = Date.now();
      set({ stats, flightCount: count });
    } catch (e) {
      console.error('[loadStats] getFlightStats kraschade:', e);
      set({ stats: emptyStats });
    }
  },

  removeFlight: async (id: number) => {
    await deleteFlight(id);
    await get().loadFlights();
    await get().loadStats();
  },

  setTier: (t: SubscriptionTier) => {
    set({ tier: t, isPremium: t !== 'free', isMax: t === 'max' });
    if (t !== 'free') {
      import('../db/icao').then(({ seedIcaoAirports }) => seedIcaoAirports(true));
    }
  },

  setIsPremium: (val: boolean) => {
    const t = val ? 'premium' : 'free';
    set({ tier: t, isPremium: val, isMax: false });
    if (val) {
      import('../db/icao').then(({ seedIcaoAirports }) => seedIcaoAirports(true));
    }
  },

  canAddFlight: () => {
    const { isPremium, manualFlightCount } = get();
    if (isPremium) return true;
    return manualFlightCount < FREE_TIER_LIMIT;
  },

  canAddDroneFlight: () => {
    const { isPremium, manualDroneFlightCount } = get();
    if (isPremium) return true;
    return manualDroneFlightCount < FREE_TIER_LIMIT_DRONE;
  },
}));
