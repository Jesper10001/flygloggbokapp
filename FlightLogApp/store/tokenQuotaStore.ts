// Delad klientstate för AI-token-kvoten (fri engångspott / premium-månadspott).
// Källa: proxyns GET /tokens (server räknar per device, se anthropicClient.ts
// reportTokenUsage). recordUsage() ger en optimistisk lokal höjning direkt efter
// varje AI-anrop, så mätaren i Settings och spärrarna i UI känns omedelbara utan
// att vänta på en ny nätverksrunda.
import { create } from 'zustand';
import { fetchTokenUsage, type TokenUsage } from '../services/tokenUsage';

interface TokenQuotaState {
  usage: TokenUsage | null;
  loaded: boolean;
  load: () => Promise<void>;
  recordUsage: (tokens: number) => void;
  hasQuota: () => boolean;
  remaining: () => number;
}

export const useTokenQuotaStore = create<TokenQuotaState>((set, get) => ({
  usage: null,
  loaded: false,

  load: async () => {
    const usage = await fetchTokenUsage();
    set({ usage, loaded: true });
  },

  recordUsage: (tokens) => {
    if (tokens <= 0) return;
    set((s) => (s.usage ? { usage: { ...s.usage, used: s.usage.used + tokens } } : s));
  },

  // Fail-open: okänt saldo (proxy ej nådd/ej laddat än) blockerar aldrig en funktion —
  // proxyns egen 429-spärr är sista skyddsnätet om något ändå slinker igenom.
  hasQuota: () => {
    const u = get().usage;
    if (!u) return true;
    return u.used < u.limit;
  },

  remaining: () => {
    const u = get().usage;
    if (!u) return Infinity;
    return Math.max(0, u.limit - u.used);
  },
}));
