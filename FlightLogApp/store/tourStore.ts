// Blades introduction — tillstånd för den guidade rundturen. TourHost (monterad i roten) läser
// detta, ritar info-kortet, navigerar mellan sidorna och "trycker" på knappar. Startas antingen
// automatiskt efter onboarding (via en flagga i settings) eller manuellt från Settings.

import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';
import { TOURS, type TourMode } from '../constants/tourSteps';

const PENDING_KEY = 'pending_intro_tour'; // '' | 'pilot' | 'drone'

interface TourStore {
  active: boolean;
  mode: TourMode;
  stepIndex: number;
  pressTarget: string | null; // id på knappen som just nu "trycks" (se TourPress)
  openBackfill: boolean;      // driver BackfillMissingHours att fällas ut i Imported data-vyn
  start: (mode: TourMode) => void;
  next: () => void;           // vidare; förbi sista steget → avsluta
  prev: () => void;
  stop: () => void;
  setPressTarget: (id: string | null) => void;
  setOpenBackfill: (v: boolean) => void;
}

export const useTourStore = create<TourStore>((set, get) => ({
  active: false,
  mode: 'pilot',
  stepIndex: 0,
  pressTarget: null,
  openBackfill: false,
  start: (mode) => set({ active: true, mode, stepIndex: 0, pressTarget: null, openBackfill: false }),
  next: () => {
    const { mode, stepIndex } = get();
    if (stepIndex >= TOURS[mode].length - 1) { set({ active: false, pressTarget: null, openBackfill: false }); return; }
    set({ stepIndex: stepIndex + 1 });
  },
  prev: () => set({ stepIndex: Math.max(0, get().stepIndex - 1) }),
  stop: () => set({ active: false, pressTarget: null, openBackfill: false }),
  setPressTarget: (id) => set({ pressTarget: id }),
  setOpenBackfill: (v) => set({ openBackfill: v }),
}));

// Sätts i onboarding → rundturen startar automatiskt EN gång nästa gång rätt dashboard visas
// (överlever även import-flödet och omstart eftersom flaggan ligger i settings).
export async function markIntroTourPending(mode: TourMode): Promise<void> {
  await setSetting(PENDING_KEY, mode).catch(() => {});
}

// Anropas från respektive dashboard (useFocusEffect). Startar rundturen om den väntar för det
// aktuella läget och rensar flaggan. No-op annars (och om en rundtur redan körs).
export async function maybeStartIntroTour(mode: TourMode): Promise<void> {
  if (useTourStore.getState().active) return;
  const pending = await getSetting(PENDING_KEY).catch(() => null);
  if (pending !== mode) return;
  await setSetting(PENDING_KEY, '').catch(() => {});
  if (useTourStore.getState().active) return; // skydd mot dubbelstart vid snabba focus-event
  useTourStore.getState().start(mode);
}
