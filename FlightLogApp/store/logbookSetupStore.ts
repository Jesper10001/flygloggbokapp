// Liten signal-store: när man lämnar loggbokens uppsättning (BookSetupFlow) för "Create custom
// logbook" eller Imported data sätts en reopen-flagga. När man kommer tillbaka läser skärmens focus-effekt
// flaggan och ÅTERÖPPNAR uppsättningen — så man landar där man var, inte på Your books. editId = boken man
// höll på att ändra (0 = en ny bok).
import { create } from 'zustand';

interface LogbookSetupStore {
  reopen: boolean;
  editId: number;
  requestReopen: (editId?: number) => void;
  consume: () => { editId: number } | null; // läs + nollställ (icke-reaktivt via getState) → trigga bara vid nästa fokus
}

export const useLogbookSetupStore = create<LogbookSetupStore>((set, get) => ({
  reopen: false,
  editId: 0,
  requestReopen: (editId = 0) => set({ reopen: true, editId }),
  consume: () => {
    const { reopen, editId } = get();
    if (!reopen) return null;
    set({ reopen: false, editId: 0 });
    return { editId };
  },
}));
