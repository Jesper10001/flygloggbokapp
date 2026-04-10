import { create } from 'zustand';
import type { Flight, FlightStats } from '../types/flight';
import {
  getFlights,
  getFlightStats,
  getFlightCount,
  deleteFlight,
} from '../db/flights';
import { FREE_TIER_LIMIT } from '../constants/easa';

interface FlightStore {
  flights: Flight[];
  stats: FlightStats | null;
  flightCount: number;
  isPremium: boolean;
  isLoading: boolean;

  loadFlights: () => Promise<void>;
  loadStats: () => Promise<void>;
  removeFlight: (id: number) => Promise<void>;
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
  total_landings_day: 0,
  total_landings_night: 0,
  last_90_days: 0,
  last_12_months: 0,
};

export const useFlightStore = create<FlightStore>((set, get) => ({
  flights: [],
  stats: null,
  flightCount: 0,
  isPremium: false,
  isLoading: false,

  loadFlights: async () => {
    set({ isLoading: true });
    try {
      const [flights, count] = await Promise.all([
        getFlights(100),
        getFlightCount(),
      ]);
      set({ flights, flightCount: count });
    } finally {
      set({ isLoading: false });
    }
  },

  loadStats: async () => {
    try {
      const stats = await getFlightStats();
      const count = await getFlightCount();
      set({ stats, flightCount: count });
    } catch {
      set({ stats: emptyStats });
    }
  },

  removeFlight: async (id: number) => {
    await deleteFlight(id);
    await get().loadFlights();
    await get().loadStats();
  },

  setIsPremium: (val: boolean) => set({ isPremium: val }),

  canAddFlight: () => {
    const { isPremium, flightCount } = get();
    return isPremium || flightCount < FREE_TIER_LIMIT;
  },
}));
