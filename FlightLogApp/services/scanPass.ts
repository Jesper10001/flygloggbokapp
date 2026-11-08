// Skanningspasset (proxy/src/scanPass.ts): när läsningen börjar ber appen proxyn om ett pass för uppslagen som ska
// läsas. De uppslag passet täcker läses klart även om coinsen tar slut på vägen; går de över uppskattningen
// (30 coins per uppslag) bjuder vi på mellanskillnaden. Utan pass (proxyn inte nådd) gäller saldot som förut.
import { getDeviceId } from './anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';

/** Ber om ett pass för så många uppslag. Svarar med hur många passet gäller (0 = inget pass). */
export async function requestScanPass(spreads: number): Promise<number> {
  if (!PROXY_URL || spreads <= 0) return 0;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Device-ID': getDeviceId() };
    try {
      const { useFlightStore } = require('../store/flightStore');
      const st = useFlightStore.getState();
      if (st.isMax) headers['X-Tier'] = 'max';
      else if (st.isPremium) headers['X-Premium'] = 'true';
    } catch { /* ignore */ }
    const r = await fetch(`${PROXY_URL.replace(/\/+$/, '')}/scan/pass`, {
      method: 'POST', headers, body: JSON.stringify({ spreads }), signal: abort.signal,
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return typeof j?.granted === 'number' ? j.granted : 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
