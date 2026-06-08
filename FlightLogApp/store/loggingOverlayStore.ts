import { create } from 'zustand';

// Styr "loggar flygning"-snurran som visas centrerat över dashboarden när en ny
// flygning loggas (refresh-cyan, eller refresh-gold för premium). Renderas av
// LoggingOverlay som monteras i roten.
interface LoggingOverlayStore {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

export const useLoggingOverlayStore = create<LoggingOverlayStore>((set) => ({
  visible: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
}));
