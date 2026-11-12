// Foton från skanningskameran till Block import (app/import/manual.tsx). Kameran lägger fotona här och går
// tillbaka; Block import tar dem (take) och läser summaraderna. 'one' = senaste uppslaget, 'years' = senaste
// uppslaget först och sedan ett uppslag per årsskifte (eller bara fler årsskiften när man fyller på).
import { create } from 'zustand';
import type { ScanImage } from './scanStore';

export type TotalsMode = 'one' | 'years' | 'more';
interface Pending { mode: TotalsMode; images: ScanImage[] }
interface State {
  pending: Pending | null;
  put: (p: Pending) => void;
  take: () => Pending | null;
}

export const useTotalsScanStore = create<State>((set, get) => ({
  pending: null,
  put: (p) => set({ pending: p }),
  take: () => { const p = get().pending; if (p) set({ pending: null }); return p; },
}));
