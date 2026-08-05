// Kö av okända dep/arr-koder efter sparad flight → dashboarden visar en notis per kod
// ("XXXX does not exist in local database. Add place and name?") mellan latest-flight och log-flight.
// In-memory (försvinner vid app-omstart) — notisen är per spar-tillfälle, inte permanent.
import { create } from 'zustand';

type PendingPlaceState = {
  codes: string[];
  add: (code: string) => void;
  remove: (code: string) => void;
  clear: () => void;
};

export const usePendingPlaceStore = create<PendingPlaceState>((set) => ({
  codes: [],
  add: (code) => set((s) => {
    const c = code.trim().toUpperCase();
    if (!c || s.codes.includes(c)) return s;
    return { codes: [...s.codes, c] };
  }),
  remove: (code) => set((s) => ({ codes: s.codes.filter((c) => c !== code.trim().toUpperCase()) })),
  clear: () => set({ codes: [] }),
}));
