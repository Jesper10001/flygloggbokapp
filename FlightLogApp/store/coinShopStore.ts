// Köpbladet för fler Blade coins (components/CoinShopSheet.tsx, monterat i roten via CoinShopHost).
// Öppnas när coinsen tar slut (tokenGate) eller från Settings. onDone körs när köpta coins har kommit
// fram — skanningen använder det för att fortsätta där den stannade.
import { create } from 'zustand';

export type CoinShopReason = 'browse' | 'out' | 'scan';

interface CoinShopStore {
  visible: boolean;
  reason: CoinShopReason;
  note?: string;
  onDone?: () => void;
  open: (opts?: { reason?: CoinShopReason; note?: string; onDone?: () => void }) => void;
  close: () => void;
}

export const useCoinShopStore = create<CoinShopStore>((set) => ({
  visible: false,
  reason: 'browse',
  open: (opts) => set({ visible: true, reason: opts?.reason ?? 'browse', note: opts?.note, onDone: opts?.onDone }),
  close: () => set({ visible: false, note: undefined, onDone: undefined }),
}));
