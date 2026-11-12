// Promokoder, lösta och kontrollerade här i proxyn (koderna ligger bara i hemligheterna, aldrig i appen):
//   • PROMO_CODES        → Blades Premium för alltid på enheten (som förut; samma kod får användas av flera)
//   • PROMO_CODES_MAX    → Blades Max för alltid på enheten. Varje kod gäller EN enhet.
//   • PROMO_CODES_COINS  → 500 Blade coins en gång, som köpta coins (går aldrig ut). Varje kod gäller EN enhet.
// Enhetens nivå ligger i promo:<enhet> ('1' = Premium, 'max' = Max). En Max- eller coin-kod binds till den första
// enheten som löser in den (promo-code:<KOD>), så en kod som sprids vidare fungerar inte på fler telefoner.
import { TOKENS_PER_COIN, creditKey, getCredits } from './credits';

export type PromoKind = 'premium' | 'max' | 'coins';
export const PROMO_COINS = 500;

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
export interface PromoEnv { PROMO_CODES?: string; PROMO_CODES_MAX?: string; PROMO_CODES_COINS?: string }
export interface RedeemResult { ok: boolean; kind?: PromoKind; coins?: number; reason?: 'invalid' | 'used' }

const list = (raw?: string) => (raw ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
export const normCode = (code: string) => String(code ?? '').trim().toUpperCase();

/** Vilken sorts kod det är, eller null om den inte finns. */
export function promoKind(env: PromoEnv, norm: string): PromoKind | null {
  if (!norm) return null;
  if (list(env.PROMO_CODES_MAX).includes(norm)) return 'max';
  if (list(env.PROMO_CODES_COINS).includes(norm)) return 'coins';
  if (list(env.PROMO_CODES).includes(norm)) return 'premium';
  return null;
}

/** Värdet i promo:<enhet> → nivå. */
export function promoTierOf(value: string | null): 'max' | 'premium' | 'free' {
  return value === 'max' ? 'max' : value === '1' ? 'premium' : 'free';
}

/** Löser in en kod för enheten (deviceHash = den hashade nyckeln, som övriga KV-nycklar). */
export async function redeemCode(kv: Kv, env: PromoEnv, deviceHash: string, code: string): Promise<RedeemResult> {
  const norm = normCode(code);
  const kind = promoKind(env, norm);
  if (!kind) return { ok: false, reason: 'invalid' };
  const promoKey = `promo:${deviceHash}`;
  if (kind === 'premium') {
    // Har enheten redan Max från en kod sänks den inte till Premium.
    if ((await kv.get(promoKey)) !== 'max') await kv.put(promoKey, '1');
    return { ok: true, kind };
  }
  const ownerKey = `promo-code:${norm}`;
  const owner = await kv.get(ownerKey);
  if (owner && owner !== deviceHash) return { ok: false, kind, reason: 'used' };
  if (kind === 'max') {
    await kv.put(promoKey, 'max');
    if (!owner) await kv.put(ownerKey, deviceHash);
    return { ok: true, kind };
  }
  // Coins: en gång. Samma enhet som löser in igen får inga nya coins.
  if (owner) return { ok: false, kind, reason: 'used' };
  await kv.put(ownerKey, deviceHash);
  await kv.put(creditKey(deviceHash), String((await getCredits(kv, deviceHash)) + PROMO_COINS * TOKENS_PER_COIN));
  return { ok: true, kind, coins: PROMO_COINS };
}
