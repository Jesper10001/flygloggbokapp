import { create } from 'zustand';
import type { Flight, FlightStats } from '../types/flight';
import {
  getFlights,
  getFlightStats,
  getFlightCount,
  getManualFlightCount,
  deleteFlight,
} from '../db/flights';
import { FREE_TIER_LIMIT } from '../constants/easa';

export type SubscriptionTier = 'free' | 'premium' | 'max';

interface FlightStore {
  flights: Flight[];
  stats: FlightStats | null;
  flightCount: number;
  manualFlightCount: number;
  tier: SubscriptionTier;
  isPremium: boolean;
  isMax: boolean;
  isLoading: boolean;

  loadFlights: () => Promise<void>;
  loadStats: () => Promise<void>;
  removeFlight: (id: number) => Promise<void>;
  setTier: (tier: SubscriptionTier) => void;
  setIsPremium: (val: boolean) => void;
  canAddFlight: () => boolean;
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
  tier: 'free' as SubscriptionTier,
  isPremium: false,
  isMax: false,
  isLoading: false,

  loadFlights: async () => {
    set({ isLoading: true });
    try {
      const [flights, count, manualCount] = await Promise.all([
        getFlights(10000),
        getFlightCount(),
        getManualFlightCount(),
      ]);
      set({ flights, flightCount: count, manualFlightCount: manualCount });
    } finally {
      set({ isLoading: false });
    }
  },

  loadStats: async () => {
    try {
      const stats = await getFlightStats();
      const count = await getFlightCount();
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
}));
