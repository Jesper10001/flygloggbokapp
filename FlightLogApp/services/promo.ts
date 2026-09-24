// Promo-kod: löses in och verifieras SERVER-SIDE (Cloudflare-proxyn). De giltiga koderna ligger i
// proxyns env (PROMO_CODES) — aldrig i app-bundlen. Servern binder en giltig kod till denna device
// (KV: promo:<device>) → permanent gratis Blades Premium som kontrolleras vid varje appstart.
import { getDeviceId } from './anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const base = () => PROXY_URL.replace(/\/+$/, '');

/** Lös in en promo-kod. true = giltig (Premium aktiverat server-side), false = ogiltig/ingen proxy. */
export async function redeemPromo(code: string): Promise<boolean> {
  if (!PROXY_URL) return false;
  try {
    const r = await fetch(`${base()}/redeem`, {
      method: 'POST',
      headers: { 'X-Device-ID': getDeviceId(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j?.ok;
  } catch {
    return false;
  }
}

/** Har denna device aktiv promo-Premium? true/false från servern, null = kunde inte nå den (offline). */
export async function checkPromoEntitlement(): Promise<boolean | null> {
  if (!PROXY_URL) return null;
  try {
    const r = await fetch(`${base()}/entitlement`, { headers: { 'X-Device-ID': getDeviceId() } });
    if (!r.ok) return null;
    const j = await r.json();
    return !!j?.premium;
  } catch {
    return null;
  }
}
