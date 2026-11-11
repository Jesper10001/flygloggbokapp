// Delad flygning på väg in i appen (services/flightShare). Två lägen:
//  - pending: paketet som lästs ur en fil ("Open a shared flight" under Import) och väntar på skärmen
//    Shared flight. En länk (blades://shared-flight?d=…) går i stället som parameter till skärmen.
//  - prepared: det mottagaren godkänt, färdigt för Log flight (/flight/add?shared=1), som tar det en gång.
import { create } from 'zustand';
import type { SharedPayload, OwnRole } from '../services/flightShare';

export interface PreparedSharedFlight {
  fromName: string;
  form: Record<string, string>;
  role: OwnRole;
  fi: boolean;
  extraPilots: { role: string; name: string }[];
  multiPilot: boolean;
}

interface State {
  pending: SharedPayload | null;
  prepared: PreparedSharedFlight | null;
  setPending: (p: SharedPayload | null) => void;
  setPrepared: (p: PreparedSharedFlight) => void;
  takePrepared: () => PreparedSharedFlight | null;
}

export const useSharedFlightStore = create<State>((set, get) => ({
  pending: null,
  prepared: null,
  setPending: (pending) => set({ pending }),
  setPrepared: (prepared) => set({ prepared }),
  takePrepared: () => { const p = get().prepared; if (p) set({ prepared: null }); return p; },
}));
