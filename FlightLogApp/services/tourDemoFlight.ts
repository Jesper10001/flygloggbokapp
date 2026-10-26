// Blades introduction — flygningen som loggningsdemon sparar (och ev. exempeldrönaren den skapat) är
// RIKTIGA rader så att loggboken kan visa den. De raderas när rundturen slutar (Skip/Finish), när man
// når checklistan och när demon körs om. Raden sparas även i settings → städas efter krasch/omstart.

import { getSetting, setSetting, deleteFlight } from '../db/flights';
import { deleteDroneFlight, deleteDroneRegistration } from '../db/drones';
import { useTourStore, type TourDemoFlight } from '../store/tourStore';
import { useFlightStore } from '../store/flightStore';
import { useDroneFlightStore } from '../store/droneFlightStore';

const KEY = 'tour_demo_flight';

/** Minns demo-flygningen (och ev. exempeldrönaren) — slås ihop med det som redan är känt. */
export async function rememberTourDemo(patch: TourDemoFlight): Promise<void> {
  const cur = useTourStore.getState().demoFlight;
  const next: TourDemoFlight = cur && cur.kind === patch.kind ? { ...cur, ...patch } : patch;
  useTourStore.getState().setDemoFlight(next);
  await setSetting(KEY, JSON.stringify(next)).catch(() => {});
}

/** Raderar demo-flygningen (+ exempeldrönaren) om det finns någon — även en kvarlämnad från en krasch. */
export async function cleanupTourDemo(): Promise<void> {
  let f = useTourStore.getState().demoFlight;
  if (!f) {
    try { const raw = await getSetting(KEY); if (raw) f = JSON.parse(raw) as TourDemoFlight; } catch { /* trasig → ignorera */ }
  }
  if (!f) return;
  try {
    if (f.kind === 'pilot') {
      if (f.id) await deleteFlight(f.id);
      const fs = useFlightStore.getState();
      await Promise.all([fs.loadFlights(), fs.loadStats()]);
    } else {
      if (f.id) await deleteDroneFlight(f.id);
      if (f.droneId) await deleteDroneRegistration(f.droneId);
      const ds = useDroneFlightStore.getState();
      await Promise.all([ds.loadFlights(), ds.loadStats()]);
    }
  } catch { /* redan borta */ }
  useTourStore.getState().setDemoFlight(null);
  await setSetting(KEY, '').catch(() => {});
}
