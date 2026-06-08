import { create } from 'zustand';
import { getFlightCount } from '../db/flights';

// Styr "Wrapped"-genomgången (Spotify-Wrapped-stil) som visas efter en import
// (CSV/skanning/manuell), oavsett om den startats under onboarding eller senare
// från Inställningar. Renderas som en RN Modal-overlay via WrappedHost så den
// ligger ovanpå ev. öppna import-modaler.

interface WrappedStore {
  visible: boolean;
  open: () => void;
  close: () => void;
  /**
   * Anropas från import-flödena efter att flygningar sparats. Öppnar Wrapped om
   * det nu finns flygningar att sammanfatta. Anropas ENBART från de explicita
   * import-flödena (CSV/manuell/skanning), så vanligt användande triggar den
   * inte. Returnerar true om overlayen öppnades (så anroparen kan hoppa över sin
   * egen navigering).
   */
  maybeOpenAfterImport: () => Promise<boolean>;
}

export const useWrappedStore = create<WrappedStore>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  maybeOpenAfterImport: async () => {
    try {
      const count = await getFlightCount();
      if (count <= 0) return false;
      set({ visible: true });
      return true;
    } catch {
      return false;
    }
  },
}));
