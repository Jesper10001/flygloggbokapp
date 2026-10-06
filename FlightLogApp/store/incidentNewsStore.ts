// Cache för flygincident-nyheterna (Global map → News). Resultatet ligger kvar i minnet så att man kan
// stänga/öppna rutan utan ny hämtning. Funktionen är Premium-only (server-side). Datan kommer färdig från
// proxyns cachade GET /incident-news (gratis RSS + liten Haiku, 1h delad cache) → ingen kostnad mot
// användarens coin-pott, ingen klient-rate-limit behövs.

import { create } from 'zustand';
import { fetchAirportIncidents, type AirportIncident } from '../services/incidentNews';
import { useFlightStore } from './flightStore';

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'locked';

interface IncidentNewsStore {
  status: Status;
  incidents: AirportIncident[];
  error: string | null;
  lastFetched: number | null;
  load: (force?: boolean) => Promise<void>;
}

function isPremium(): boolean {
  const s = useFlightStore.getState();
  return !!(s.isPremium || s.isMax);
}

export const useIncidentNewsStore = create<IncidentNewsStore>((set, get) => ({
  status: 'idle',
  incidents: [],
  error: null,
  lastFetched: null,
  load: async (force = false) => {
    const st = get();
    if (st.status === 'loading') return;
    if (!force && st.status === 'ready') return; // in-memory cache
    if (!isPremium()) { set({ status: 'locked' }); return; }
    set({ status: 'loading', error: null });
    try {
      const incidents = await fetchAirportIncidents();
      set({ status: 'ready', incidents, lastFetched: Date.now() });
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (msg.includes('premium_required')) { set({ status: 'locked' }); return; }
      set({ status: 'error', error: 'Could not load incidents right now.' });
    }
  },
}));
