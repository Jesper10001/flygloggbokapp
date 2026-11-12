// Räknare som ritar om flikarnas innehåll från början (app/(tabs)/_layout.tsx, screenLayout med key).
// Skanningskameran vrider appen till liggande; flikarna under ritas då om i liggande format, och text i dem
// kunde bli kvar halvt klippt och suddig när appen vreds tillbaka (Logbook-rubriken, sökfältet, filterknapparna).
// Kameran räknar upp när den har vridit tillbaka till stående, så ritas flikarna om rent.
import { create } from 'zustand';

export const useLayoutEpochStore = create<{ epoch: number; bump: () => void }>((set) => ({
  epoch: 0,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
}));
