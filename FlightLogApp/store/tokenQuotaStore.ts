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

  // Som proxyn: månadspotten först, sedan köpta coins (proxy/src/credits.ts splitCharge).
  recordUsage: (tokens) => {
    if (tokens <= 0) return;
    set((s) => {
      if (!s.usage) return s;
      const u = s.usage;
      if (u.credits <= 0) return { usage: { ...u, used: u.used + tokens } };
      const fromMonthly = Math.min(tokens, Math.max(0, u.limit - u.used));
      const take = Math.min(tokens - fromMonthly, u.credits);
      return { usage: { ...u, used: u.used + fromMonthly + (tokens - fromMonthly - take), credits: u.credits - take } };
    });
  },

  // Fail-open: okänt saldo (proxy ej nådd/ej laddat än) blockerar aldrig en funktion —
  // proxyns egen 429-spärr är sista skyddsnätet om något ändå slinker igenom.
  hasQuota: () => {
    const u = get().usage;
    if (!u) return true;
    return u.used < u.limit + Math.min(0, u.credits) || u.credits > 0;   // som proxyn: en skuld minskar månaden
  },

  remaining: () => {
    const u = get().usage;
    if (!u) return Infinity;
    return Math.max(0, u.limit - u.used + Math.min(0, u.credits)) + Math.max(0, u.credits);
  },
}));
