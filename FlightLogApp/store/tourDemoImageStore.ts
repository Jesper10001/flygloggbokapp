// Prefetch av fleet-BILDER för Blades introduction. Startas så fort rundturen startar (beginTour) så att
// demo-korten har bild + subject-lift-urklipp (cutout) redo när man når Fleet-steget. Hämtas på SAMMA sätt
// som på riktigt (gratis Wikipedia-uppslag + ensureAircraftCutout som bara cachar FILER) och sparas ALDRIG
// till databasen. Reaktiv store → korten uppdateras när varje bild droppar in.
import { create } from 'zustand';
import { Image } from 'react-native';
import { fetchAircraftImage, fetchDroneImage } from '../services/aircraftLookup';
import { ensureAircraftCutout } from '../services/aircraftCutout';
import {
  DEMO_AIRCRAFT, DEMO_DRONE_MODELS, DEMO_AIRCRAFT_IMAGE_QUERIES, DEMO_DRONE_IMAGE_QUERIES,
} from '../constants/tourDemoData';

export interface DemoImageEntry { image: string | null; cutout: string | null; aspect: number }

interface TourDemoImageStore {
  byKey: Record<string, DemoImageEntry>;
  started: boolean;
  prefetch: () => void;
}

const getAspect = (uri: string) =>
  new Promise<number>((res) => Image.getSize(uri, (w, h) => res(h > 0 ? w / h : 1.5), () => res(1.5)));

export const useTourDemoImageStore = create<TourDemoImageStore>((set, get) => ({
  byKey: {},
  started: false,
  prefetch: () => {
    if (get().started) return;   // en gång per session — bilderna cachas ändå
    set({ started: true });
    const load = async (key: string, cands: string[], kind: 'ac' | 'drone') => {
      try {
        const url = await (kind === 'ac' ? fetchAircraftImage(cands) : fetchDroneImage(cands)).catch(() => '');
        if (!url) { set((s) => ({ byKey: { ...s.byKey, [key]: { image: null, cutout: null, aspect: 1.5 } } })); return; }
        const r = await ensureAircraftCutout(url).catch(() => ({ original: url, cutout: null }));
        const image = r.original || url;
        const aspect = await getAspect(image).catch(() => 1.5);
        set((s) => ({ byKey: { ...s.byKey, [key]: { image, cutout: r.cutout, aspect } } }));
      } catch {
        set((s) => ({ byKey: { ...s.byKey, [key]: { image: null, cutout: null, aspect: 1.5 } } }));
      }
    };
    for (const ac of DEMO_AIRCRAFT) load('ac:' + ac.aircraft_type, DEMO_AIRCRAFT_IMAGE_QUERIES[ac.aircraft_type] ?? [ac.aircraft_type], 'ac');
    for (const d of DEMO_DRONE_MODELS) load('drone:' + d.model, DEMO_DRONE_IMAGE_QUERIES[d.model] ?? [d.model], 'drone');
  },
}));
