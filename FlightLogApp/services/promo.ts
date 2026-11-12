// Promo-kod: löses in och verifieras SERVER-SIDE (Cloudflare-proxyn, src/promo.ts). De giltiga koderna ligger i
// proxyns hemligheter — aldrig i app-bundlen. Tre sorter: Premium (PROMO_CODES), Blades Max (PROMO_CODES_MAX,
// en enhet per kod) och 500 Blade coins en gång (PROMO_CODES_COINS, en enhet per kod). Premium och Max binds
// till enheten (KV: promo:<device>) och kontrolleras vid varje appstart.
import { getDeviceId } from './anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const base = () => PROXY_URL.replace(/\/+$/, '');

export type PromoKind = 'premium' | 'max' | 'coins';
export interface PromoResult { ok: boolean; kind?: PromoKind; coins?: number; reason?: 'invalid' | 'used' | 'offline' }

/** Lös in en promo-kod. kind säger vad den gav; reason varför den inte gick (used = redan använd). */
export async function redeemPromo(code: string): Promise<PromoResult> {
  if (!PROXY_URL) return { ok: false, reason: 'offline' };
  try {
    const r = await fetch(`${base()}/redeem`, {
      method: 'POST',
      headers: { 'X-Device-ID': getDeviceId(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) return { ok: false, kind: j?.kind, reason: j?.reason === 'used' ? 'used' : 'invalid' };
    // Äldre proxy svarar bara { ok, premium }.
    const kind: PromoKind = j?.kind === 'max' || j?.kind === 'coins' ? j.kind : 'premium';
    return { ok: true, kind, coins: Number(j?.coins) || undefined };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

/** Har denna device aktiv promo-Premium? true/false från servern, null = kunde inte nå den (offline). */
// Serverns syn på enhetens Premium: premium = promokod ELLER RevenueCat, promo = bara promokoden (null =
// äldre proxy som inte skiljer på dem). null = okänt (offline/fel).
// promoTier: vilken nivå promokoden ger ('max' | 'premium'), null = ingen eller äldre proxy.
export async function checkPromoEntitlement(): Promise<{ premium: boolean; promo: boolean | null; promoTier: 'max' | 'premium' | null } | null> {
  if (!PROXY_URL) return null;
  try {
    const r = await fetch(`${base()}/entitlement`, { headers: { 'X-Device-ID': getDeviceId() } });
    if (!r.ok) return null;
    const j = await r.json();
    const promoTier = j?.promo_tier === 'max' || j?.promo_tier === 'premium' ? j.promo_tier : null;
    return { premium: !!j?.premium, promo: typeof j?.promo === 'boolean' ? j.promo : null, promoTier };
  } catch {
    return null;
  }
}
