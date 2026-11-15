// Blades introduction — tillstånd för den guidade rundturen. TourHost (monterad i roten) läser detta,
// ritar kortet och ljuset, byter flik och spelar upp stoppen. Startas efter onboarding (via en flagga i
// settings → en fråga) eller från Settings.

import { create } from 'zustand';
import { getSetting, setSetting, getFlightCount, getAllAircraftTypes } from '../db/flights';
import { getDroneFlightCount, listDrones } from '../db/drones';
import { listDigitalBooks } from '../db/digitalBooks';
import { TOURS, type TourMode } from '../constants/tourSteps';
import type { Flight } from '../types/flight';
import type { DroneFlight } from '../db/drones';

const PENDING_KEY = 'pending_intro_tour'; // '' | 'pilot' | 'drone'

// Äldre versioner av rundturen sparade exempelflygningen (och ev. en exempeldrönare) som riktiga rader.
// Det görs inte längre, men services/tourDemoFlight.ts städar fortfarande en rad som blivit kvar.
export interface TourDemoFlight { kind: 'pilot' | 'drone'; id?: number; droneId?: number }

// Rutan (i fönstrets koordinater) för något som ska lysas upp — rapporteras av TourSpot.
export interface SpotRect { x: number; y: number; w: number; h: number; r: number }

interface TourStore {
  active: boolean;
  mode: TourMode;
  stepIndex: number;
  // Uppspelningen: 'moving' medan rundturen byter skärm (kortets knappar väntar, klockan står still),
  // 'shown' när stoppet är på plats. paused = användaren har tryckt paus.
  phase: 'moving' | 'shown';
  paused: boolean;
  spots: string[];                       // id:n som ska lysas upp på det här stoppet
  spotRects: Record<string, SpotRect>;   // uppmätta rutor för dem (bara de som faktiskt syns)
  formReady: boolean;                    // Log flight-formuläret är monterat (exemplet kan starta)
  pageOpen: boolean;                     // rundturen håller Log flight öppen (sidan förblir push tills den stängts)
  examplePilot: Flight | null;           // exempelflygningen: BARA i minnet, visas överst i loggbokslistan
  exampleDrone: DroneFlight | null;
  pressTarget: string | null; // id på knappen som just nu "trycks" (se TourPress)
  openBackfill: boolean;      // driver BackfillMissingHours att fällas ut i Imported data-vyn
  promptMode: TourMode | null; // satt efter onboarding → visa "vill du en rundtur? Ja/Senare"
  globeMenu: boolean;         // dashboard: scrolla till globen + öppna globmenyn
  mapOpen: boolean;           // dashboard: öppna globala kartan (rundturs-styrd)
  mapSearchIcao: string | null; // global map: sök + markera denna ICAO vid öppning (demo: KJFK)
  demo: boolean;              // visa DEMO-data (flights/fleet/bok) — BARA under rundturen när allt är tomt
  // Loggningsdemon (Log flight fyller själv i en hel flygning och sparar den):
  logForm: 'quick' | 'full' | null; // pilot: tvinga Quicklog/Full i Log flight under rundturen
  logDemoRun: number;         // ökas → Log flight startar (om) demon; ett nytt värde avbryter en pågående
  logDemoDoneAt: number;      // tidpunkt då demon sparat flygningen → TourHost går vidare
  caption: string | null;     // bildtexten i den smala raden medan demon fyller i formuläret
  demoProgress: number;       // 0–1, demons förlopp (tunn linje i bildtextraden)
  demoFlight: TourDemoFlight | null;
  start: (mode: TourMode) => void;
  setDemo: (v: boolean) => void;
  next: () => void;           // vidare; förbi sista steget → avsluta
  prev: () => void;
  stop: () => void;
  setPressTarget: (id: string | null) => void;
  setOpenBackfill: (v: boolean) => void;
  setPrompt: (mode: TourMode | null) => void;
  setGlobe: (menu: boolean, open: boolean, icao: string | null) => void;
  setLogForm: (v: 'quick' | 'full' | null) => void;
  startLogDemo: () => void;
  resetLogDemo: () => void;   // nollställ bildtext/förlopp/"sparad" utan att starta demon
  setCaption: (caption: string | null, progress?: number) => void;
  finishLogDemo: () => void;
  setDemoFlight: (f: TourDemoFlight | null) => void;
  goTo: (index: number) => void;
  setPhase: (p: 'moving' | 'shown') => void;
  setPaused: (v: boolean) => void;
  setSpots: (ids: string[]) => void;
  setSpotRect: (id: string, r: SpotRect | null) => void;
  setFormReady: (v: boolean) => void;
  setPageOpen: (v: boolean) => void;
  setExample: (e: { pilot?: Flight | null; drone?: DroneFlight | null }) => void;
}

// Återställs vid start/stopp (demoFlight städas separat av tourDemoFlight.ts, som sätter null).
const LOG_DEMO_RESET = { logForm: null, logDemoDoneAt: 0, caption: null, demoProgress: 0 } as const;
// Allt som hör till en körning — nollställs när rundturen startar och när den slutar.
const RUN_RESET = {
  pressTarget: null, openBackfill: false, globeMenu: false, mapOpen: false, mapSearchIcao: null, demo: false,
  phase: 'moving', paused: false, spots: [] as string[], spotRects: {} as Record<string, SpotRect>,
  examplePilot: null, exampleDrone: null, ...LOG_DEMO_RESET,
} as const;

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
  logForm: null,
  logDemoRun: 0,
  logDemoDoneAt: 0,
  caption: null,
  demoProgress: 0,
  demoFlight: null,
  phase: 'moving',
  paused: false,
  spots: [],
  spotRects: {},
  formReady: false,
  pageOpen: false,
  examplePilot: null,
  exampleDrone: null,
  start: (mode) => set({ ...RUN_RESET, active: true, mode, stepIndex: 0, promptMode: null }),
  setDemo: (v) => set({ demo: v }),
  next: () => {
    const { mode, stepIndex } = get();
    if (stepIndex >= TOURS[mode].length - 1) { set({ ...RUN_RESET, active: false }); return; }
    set({ stepIndex: stepIndex + 1, phase: 'moving', spots: [], spotRects: {} });
  },
  prev: () => {
    // Bakåt hoppar över loggningsexemplet: från loggboken går man till "Log a flight", inte in i exemplet igen.
    const { mode, stepIndex } = get();
    let i = Math.max(0, stepIndex - 1);
    if (i > 0 && TOURS[mode][i]?.logDemo && stepIndex > i) i -= 1;
    if (i !== stepIndex) set({ stepIndex: i, phase: 'moving', spots: [], spotRects: {} });
  },
  stop: () => set({ ...RUN_RESET, active: false }),
  goTo: (index) => set({ stepIndex: index, phase: 'moving', spots: [], spotRects: {} }),
  setPhase: (p) => set({ phase: p }),
  setPaused: (v) => set({ paused: v }),
  setSpots: (ids) => set({ spots: ids, spotRects: {} }),
  setSpotRect: (id, r) => {
    const cur = get().spotRects[id];
    if (!r) { if (cur) { const next = { ...get().spotRects }; delete next[id]; set({ spotRects: next }); } return; }
    if (cur && Math.abs(cur.x - r.x) < 1 && Math.abs(cur.y - r.y) < 1 && Math.abs(cur.w - r.w) < 1 && Math.abs(cur.h - r.h) < 1) return;
    set({ spotRects: { ...get().spotRects, [id]: r } });
  },
  setFormReady: (v) => set({ formReady: v }),
  setPageOpen: (v) => set({ pageOpen: v }),
  setExample: (e) => set({ ...('pilot' in e ? { examplePilot: e.pilot ?? null } : {}), ...('drone' in e ? { exampleDrone: e.drone ?? null } : {}) }),
  setPressTarget: (id) => set({ pressTarget: id }),
  setOpenBackfill: (v) => set({ openBackfill: v }),
  setPrompt: (mode) => set({ promptMode: mode }),
  setGlobe: (menu, open, icao) => set({ globeMenu: menu, mapOpen: open, mapSearchIcao: icao }),
  setLogForm: (v) => set({ logForm: v }),
  startLogDemo: () => set({ logDemoRun: get().logDemoRun + 1, logDemoDoneAt: 0, caption: null, demoProgress: 0 }),
  resetLogDemo: () => set({ logDemoDoneAt: 0, caption: null, demoProgress: 0 }),
  setCaption: (caption, progress) => set(progress == null ? { caption } : { caption, demoProgress: progress }),
  finishLogDemo: () => set({ logDemoDoneAt: Date.now(), demoProgress: 1 }),
  setDemoFlight: (f) => set({ demoFlight: f }),
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
    if (st.active && st.mode === mode) {
      st.setDemo(empty);
      // Börja hämta fleet-bilderna direkt så de (+ cutout) är redo när man når Fleet-steget.
      if (empty) { try { require('./tourDemoImageStore').useTourDemoImageStore.getState().prefetch(); } catch { /* valfritt */ } }
    }
  } catch { /* vid fel: ingen demo (säkrast) */ }
}

// Sätts i onboarding → rundturen startar automatiskt EN gång nästa gång rätt dashboard visas
// (överlever även import-flödet och omstart eftersom flaggan ligger i settings).
export async function markIntroTourPending(mode: TourMode): Promise<void> {
  await setSetting(PENDING_KEY, mode).catch(() => {});
}

// Anropas från respektive dashboard (useFocusEffect). Om rundturen väntar för det aktuella läget
// VISAS en fråga ("vill du en rundtur? Ja/Senare") i stället för att starta direkt. Flaggan rensas först
// när frågan besvarats (clearIntroTourPending), så den överlever om appen stängs medan frågan visas.
// No-op om en rundtur redan körs eller en fråga redan visas.
export async function maybeStartIntroTour(mode: TourMode): Promise<void> {
  const st = useTourStore.getState();
  if (st.active || st.promptMode) return;
  const pending = await getSetting(PENDING_KEY).catch(() => null);
  if (pending !== mode) return;
  const st2 = useTourStore.getState();
  if (st2.active || st2.promptMode) return; // skydd mot dubbel vid snabba focus-event
  st2.setPrompt(mode);
}

/** Väntar Blades introduction fortfarande på svar efter onboarding? (UpdateReadyDialog väntar då.) */
export async function isIntroTourPending(): Promise<boolean> {
  const pending = await getSetting(PENDING_KEY).catch(() => null);
  return !!pending;
}

/** Frågan efter onboarding är besvarad (Ja eller Senare) → visa den inte igen. */
export async function clearIntroTourPending(): Promise<void> {
  await setSetting(PENDING_KEY, '').catch(() => {});
}
