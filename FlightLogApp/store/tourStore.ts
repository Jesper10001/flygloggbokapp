// Blades introduction — tillstånd för den guidade rundturen. TourHost (monterad i roten) läser
// detta, ritar info-kortet, navigerar mellan sidorna och "trycker" på knappar. Startas antingen
// automatiskt efter onboarding (via en flagga i settings) eller manuellt från Settings.

import { create } from 'zustand';
import { getSetting, setSetting, getFlightCount, getAllAircraftTypes } from '../db/flights';
import { getDroneFlightCount, listDrones } from '../db/drones';
import { listDigitalBooks } from '../db/digitalBooks';
import { TOURS, type TourMode } from '../constants/tourSteps';

const PENDING_KEY = 'pending_intro_tour'; // '' | 'pilot' | 'drone'

interface TourStore {
  active: boolean;
  mode: TourMode;
  stepIndex: number;
  pressTarget: string | null; // id på knappen som just nu "trycks" (se TourPress)
  openBackfill: boolean;      // driver BackfillMissingHours att fällas ut i Imported data-vyn
  promptMode: TourMode | null; // satt efter onboarding → visa "vill du en rundtur? Ja/Senare"
  globeMenu: boolean;         // dashboard: scrolla till globen + öppna globmenyn
  mapOpen: boolean;           // dashboard: öppna globala kartan (rundturs-styrd)
  mapSearchIcao: string | null; // global map: sök + markera denna ICAO vid öppning (demo: KJFK)
  demo: boolean;              // visa DEMO-data (flights/fleet/bok) — BARA under rundturen när allt är tomt
  start: (mode: TourMode) => void;
  setDemo: (v: boolean) => void;
  next: () => void;           // vidare; förbi sista steget → avsluta
  prev: () => void;
  stop: () => void;
  setPressTarget: (id: string | null) => void;
  setOpenBackfill: (v: boolean) => void;
  setPrompt: (mode: TourMode | null) => void;
  setGlobe: (menu: boolean, open: boolean, icao: string | null) => void;
}

export const useTourStore = create<TourStore>((set, get) => ({
  active: false,
  mode: 'pilot',
  stepIndex: 0,
  pressTarget: null,
  openBackfill: false,
  promptMode: null,
  globeMenu: false,
  mapOpen: false,
  mapSearchIcao: null,
  demo: false,
  start: (mode) => set({ active: true, mode, stepIndex: 0, pressTarget: null, openBackfill: false, promptMode: null, globeMenu: false, mapOpen: false, mapSearchIcao: null, demo: false }),
  setDemo: (v) => set({ demo: v }),
  next: () => {
    const { mode, stepIndex } = get();
    if (stepIndex >= TOURS[mode].length - 1) { set({ active: false, pressTarget: null, openBackfill: false, globeMenu: false, mapOpen: false, mapSearchIcao: null, demo: false }); return; }
    set({ stepIndex: stepIndex + 1 });
  },
  prev: () => set({ stepIndex: Math.max(0, get().stepIndex - 1) }),
  stop: () => set({ active: false, pressTarget: null, openBackfill: false, globeMenu: false, mapOpen: false, mapSearchIcao: null, demo: false }),
  setPressTarget: (id) => set({ pressTarget: id }),
  setOpenBackfill: (v) => set({ openBackfill: v }),
  setPrompt: (mode) => set({ promptMode: mode }),
  setGlobe: (menu, open, icao) => set({ globeMenu: menu, mapOpen: open, mapSearchIcao: icao }),
}));

// Starta rundturen OCH avgör om DEMO-data ska visas: bara när det aktuella lägets loggbok är HELT tom
// (inga flygningar, ingen fleet, ingen byggd bok) → då är rundturens sidor annars tomma. Demo-datan
// lagras aldrig i DB; den swappas bara in vid render medan `demo` är true.
export async function beginTour(mode: TourMode): Promise<void> {
  useTourStore.getState().start(mode);
  try {
    const empty = mode === 'drone'
      ? ((await getDroneFlightCount().catch(() => 1)) === 0
         && (await listDrones().catch(() => [1])).length === 0
         && (await listDigitalBooks('drone').catch(() => [1])).length === 0)
      : ((await getFlightCount().catch(() => 1)) === 0
         && (await getAllAircraftTypes().catch(() => [1])).length === 0
         && (await listDigitalBooks('digital').catch(() => [1])).length === 0);
    // Rundturen kan ha hunnit stoppas → sätt bara demo om den fortfarande kör samma läge.
    const st = useTourStore.getState();
    if (st.active && st.mode === mode) st.setDemo(empty);
  } catch { /* vid fel: ingen demo (säkrast) */ }
}

// Sätts i onboarding → rundturen startar automatiskt EN gång nästa gång rätt dashboard visas
// (överlever även import-flödet och omstart eftersom flaggan ligger i settings).
export async function markIntroTourPending(mode: TourMode): Promise<void> {
  await setSetting(PENDING_KEY, mode).catch(() => {});
}

// Anropas från respektive dashboard (useFocusEffect). Om rundturen väntar för det aktuella läget
// VISAS en fråga ("vill du en rundtur? Ja/Senare") i stället för att starta direkt; flaggan rensas
// så frågan bara dyker upp en gång. No-op om en rundtur redan körs eller en fråga redan visas.
export async function maybeStartIntroTour(mode: TourMode): Promise<void> {
  const st = useTourStore.getState();
  if (st.active || st.promptMode) return;
  const pending = await getSetting(PENDING_KEY).catch(() => null);
  if (pending !== mode) return;
  await setSetting(PENDING_KEY, '').catch(() => {});
  const st2 = useTourStore.getState();
  if (st2.active || st2.promptMode) return; // skydd mot dubbel vid snabba focus-event
  st2.setPrompt(mode);
}
