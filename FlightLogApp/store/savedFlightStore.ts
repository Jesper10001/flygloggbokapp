// Notisen "Saved flight" efter att en flygning redigerats: vad som ändrades (services/flightSaveDiff).
// Visas av components/SavedFlightNotice, som ligger både i rotlayouten och inne i flight detail (den är
// en modal, och rotlayoutens notis hamnar bakom den).
import { create } from 'zustand';
import type { SavedLine } from '../services/flightSaveDiff';

interface SavedFlightStore {
  notice: { key: number; flightId: number; lines: SavedLine[] } | null;
  /** Antal notiser som ligger inne i en skärm just nu; då håller rotlayoutens notis tyst. */
  inline: number;
  show: (flightId: number, lines: SavedLine[]) => void;
  hide: () => void;
  mountInline: () => () => void;
}

let seq = 0;
export const useSavedFlightStore = create<SavedFlightStore>((set, get) => ({
  notice: null,
  inline: 0,
  show: (flightId, lines) => {
    const key = ++seq;
    set({ notice: { key, flightId, lines } });
    // Längre när det finns mer att läsa, men alltid kort.
    const ttl = Math.min(8000, 3500 + lines.length * 500);
    setTimeout(() => { if (get().notice?.key === key) set({ notice: null }); }, ttl);
  },
  hide: () => set({ notice: null }),
  mountInline: () => {
    set((s) => ({ inline: s.inline + 1 }));
    return () => set((s) => ({ inline: Math.max(0, s.inline - 1) }));
  },
}));
