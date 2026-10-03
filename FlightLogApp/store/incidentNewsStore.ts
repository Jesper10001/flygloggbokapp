// Cache för AI-flygincident-nyheterna (Global map → News). Resultatet ligger kvar i minnet så att
// man kan stänga/öppna nyhetsrutan utan ny sökning. Funktionen är Premium-only + rate-limitad
// (1 scan/timme) — hårt i proxyn, mjukt här för snabb återkoppling. Faktiska tokens debiteras.

import { create } from 'zustand';
import { fetchAirportIncidents, type AirportIncident } from '../services/incidentNews';
import { hasTokenQuota, isTokenQuotaError, showMonthlyTokenLimitAlert } from '../utils/tokenGate';
import { useFlightStore } from './flightStore';
import { useToastStore } from '../components/Toast';

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'locked';

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 scan / timme (matchar proxyns INCIDENT_NEWS_RATE_LIMIT_SEC)

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
    if (!force && st.status === 'ready') return; // cache: visa samma utan ny sökning
    if (!isPremium()) { set({ status: 'locked' }); return; }
    // Mjuk rate-limit (proxyn är den hårda): undvik en bortkastad sökning samma session.
    if (force && st.lastFetched && Date.now() - st.lastFetched < RATE_LIMIT_MS) {
      useToastStore.getState().show('You can scan once per hour. Try again later.');
      return;
    }
    if (!hasTokenQuota()) { showMonthlyTokenLimitAlert(); return; }
    set({ status: 'loading', error: null });
    try {
      const incidents = await fetchAirportIncidents();
      set({ status: 'ready', incidents, lastFetched: Date.now() });
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (msg.includes('premium_required')) { set({ status: 'locked' }); return; }
      if (msg.includes('news_rate_limited')) {
        useToastStore.getState().show('You can scan once per hour. Try again later.');
        set(get().incidents.length ? { status: 'ready' } : { status: 'error', error: 'You can scan once per hour. Try again later.' });
        return;
      }
      if (isTokenQuotaError(e)) { showMonthlyTokenLimitAlert(); set({ status: get().incidents.length ? 'ready' : 'idle' }); return; }
      set({ status: 'error', error: e?.message ?? 'Could not load incidents right now.' });
    }
  },
}));
