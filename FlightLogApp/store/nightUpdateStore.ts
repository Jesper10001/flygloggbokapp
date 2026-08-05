// Kö av föreslagna natt-uppdateringar: när en okänd plats fått koordinater kan auto-natten för
// flighter som använder platsen ha ändrats. Dashboarden visar "Update night time for flight X to Y?"
// med bock/kryss. In-memory (per session).
import { create } from 'zustand';

export type NightUpdate = { flightId: number; label: string; newNight: number };

type NightUpdateState = {
  items: NightUpdate[];
  addMany: (items: NightUpdate[]) => void;
  remove: (flightId: number) => void;
  clear: () => void;
};

export const useNightUpdateStore = create<NightUpdateState>((set) => ({
  items: [],
  addMany: (items) => set((s) => {
    const byId = new Map(s.items.map((i) => [i.flightId, i]));
    for (const it of items) byId.set(it.flightId, it); // senaste förslaget vinner per flight
    return { items: [...byId.values()] };
  }),
  remove: (flightId) => set((s) => ({ items: s.items.filter((i) => i.flightId !== flightId) })),
  clear: () => set({ items: [] }),
}));
