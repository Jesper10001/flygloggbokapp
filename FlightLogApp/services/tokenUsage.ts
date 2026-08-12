// Månadens AI-tokenförbrukning för denna device — hämtas från proxyns
// GET /tokens (räknas server-side per anrop: input + output). Visas som
// mätare i Settings. Utan proxy (lokalt dev-läge) finns ingen mätare → null.
import { getDeviceId } from './anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';

export interface TokenUsage {
  used: number;
  limit: number;
  month: string;    // "YYYY-MM"
  enforced: boolean; // om taket faktiskt spärrar (server-side switch)
}

export async function fetchTokenUsage(): Promise<TokenUsage | null> {
  if (!PROXY_URL) return null;
  try {
    const headers: Record<string, string> = { 'X-Device-ID': getDeviceId() };
    try {
      const { useFlightStore } = require('../store/flightStore');
      const st = useFlightStore.getState();
      if (st.isMax) headers['X-Tier'] = 'max';
      else if (st.isPremium) headers['X-Premium'] = 'true';
    } catch { /* ignore */ }
    const r = await fetch(`${PROXY_URL.replace(/\/+$/, '')}/tokens`, { headers });
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j?.used !== 'number' || typeof j?.limit !== 'number') return null;
    return { used: j.used, limit: j.limit, month: String(j.month ?? ''), enforced: !!j.enforced };
  } catch {
    return null;
  }
}
