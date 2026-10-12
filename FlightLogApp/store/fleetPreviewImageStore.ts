// Bild-prefetch för Fleet-TOMTILLSTÅNDETS preview-kort (Black Hawk / A320 / DJI Matrice 4T). Hämtas på
// SAMMA gratis sätt som på riktigt (Wikipedia-uppslag + ensureAircraftCutout som bara cachar filer) och
// sparas ALDRIG till databasen. Reaktiv store → preview-kortet uppdateras när bilden droppar in, och
// bilden cachas mellan mount/unmount (Fleet-vyn remountar vid varje fokus).
import { create } from 'zustand';
import { Image } from 'react-native';
import { fetchAircraftImage, fetchDroneImage } from '../services/aircraftLookup';
import { ensureAircraftCutout } from '../services/aircraftCutout';

export interface PreviewImageEntry { image: string | null; cutout: string | null; aspect: number; done: boolean }

interface FleetPreviewImageStore {
  byKey: Record<string, PreviewImageEntry>;
  load: (key: string, candidates: string[], kind: 'ac' | 'drone') => void;
}

const getAspect = (uri: string) =>
  new Promise<number>((res) => Image.getSize(uri, (w, h) => res(h > 0 ? w / h : 1.6), () => res(1.6)));

export const useFleetPreviewImageStore = create<FleetPreviewImageStore>((set, get) => ({
  byKey: {},
  load: (key, candidates, kind) => {
    if (get().byKey[key]) return; // redan hämtad eller pågår
    set((s) => ({ byKey: { ...s.byKey, [key]: { image: null, cutout: null, aspect: 1.6, done: false } } }));
    (async () => {
      try {
        const url = await (kind === 'ac' ? fetchAircraftImage(candidates) : fetchDroneImage(candidates)).catch(() => '');
        if (!url) { set((s) => ({ byKey: { ...s.byKey, [key]: { image: null, cutout: null, aspect: 1.6, done: true } } })); return; }
        const r = await ensureAircraftCutout(url).catch(() => ({ original: url, cutout: null as string | null }));
        const image = r.original || url;
        const aspect = await getAspect(image).catch(() => 1.6);
        set((s) => ({ byKey: { ...s.byKey, [key]: { image, cutout: r.cutout, aspect, done: true } } }));
      } catch {
        set((s) => ({ byKey: { ...s.byKey, [key]: { image: null, cutout: null, aspect: 1.6, done: true } } }));
      }
    })();
  },
}));
