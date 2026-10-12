// Liten signal-store: när man öppnar "Create custom logbook" från new logbook-arket (BookSetupSheet) sätts
// en reopen-flagga. När man sedan går tillbaka till logbook/index (Your books) läser dess focus-effekt
// flaggan och ÅTERÖPPNAR setup-arket — så man landar på "new logbook"-sidan igen, inte på Your books.
import { create } from 'zustand';

interface LogbookSetupStore {
  reopen: boolean;
  requestReopen: () => void;
  consume: () => boolean; // läs + nollställ (icke-reaktivt via getState) → trigga bara vid nästa fokus
}

export const useLogbookSetupStore = create<LogbookSetupStore>((set, get) => ({
  reopen: false,
  requestReopen: () => set({ reopen: true }),
  consume: () => { const v = get().reopen; if (v) set({ reopen: false }); return v; },
}));
