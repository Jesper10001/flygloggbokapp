import { create } from 'zustand';
import { getDroneFlights, getDroneStats, type DroneFlight, type DroneStats } from '../db/drones';

interface DroneFlightStore {
  flights: DroneFlight[];
  stats: DroneStats | null;
  isLoading: boolean;
  loadFlights: () => Promise<void>;
  loadStats: () => Promise<void>;
}

export const useDroneFlightStore = create<DroneFlightStore>((set) => ({
  flights: [],
  stats: null,
  isLoading: false,

  loadFlights: async () => {
    set({ isLoading: true });
    const flights = await getDroneFlights(500);
    set({ flights, isLoading: false });
  },

  loadStats: async () => {
    const stats = await getDroneStats();
    set({ stats });
  },
}));
