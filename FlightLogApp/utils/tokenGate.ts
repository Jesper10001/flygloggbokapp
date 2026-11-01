// Delad gate-logik för de icke-OCR AI-funktionerna (CSV-import, flight-scan,
// aircraft/drone-lookup) — dessa är INTE längre premium-låsta, bara token-låsta.
// Fri nivå får prova funktionerna tills engångspotten (50k) är slut; premium/max
// har en egen månadspott. OCR-loggboksskanning är opåverkad (fortfarande
// premium-gated på egen hand — inte prissatt/klar än).
import { Alert } from 'react-native';
import { useTokenQuotaStore } from '../store/tokenQuotaStore';

// Blade-coins = användarvänlig enhet ovanpå råa AI-tokens (döljer exakt tokenåtgång per
// funktion). 1 Blade-coin = 200 tokens. Fri pott 20 000 tok = 100 coins; Premium 50 000 = 250.
export const TOKENS_PER_COIN = 200;
export const tokensToCoins = (tokens: number): number => Math.max(0, Math.round((tokens || 0) / TOKENS_PER_COIN));
// Skanning av loggbok för PREMIUM: en coin räcker till dubbelt så många tokens (400). Gratisnivån betalar full
// taxa (200). Proxyn räknar likadant och är den som bestämmer (proxy/src/quotaWeight.ts); appen speglar det
// för sin lokala räknare.
export const SCAN_QUOTA_WEIGHT = 0.5;
export function scanQuotaWeight(): number {
  try {
    const { useFlightStore } = require('../store/flightStore');
    const s = useFlightStore.getState();
    return s.isPremium || s.isMax ? SCAN_QUOTA_WEIGHT : 1;
  } catch {
    return 1;
  }
}

export function hasTokenQuota(): boolean {
  return useTokenQuotaStore.getState().hasQuota();
}

/**
 * Väntar in köpta coins från proxyn efter ett köp (RevenueCat-webhooken krediterar dem, brukar ta några
 * sekunder). True när saldot för köpta coins har ökat.
 */
export async function awaitPurchasedCredits(before: number, timeoutMs = 30000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    await useTokenQuotaStore.getState().load().catch(() => {});
    if ((useTokenQuotaStore.getState().usage?.credits ?? 0) > before) return true;
  }
  return false;
}

/**
 * Fler Blade coins. Bara Premium kan köpa; en gratisanvändare får Premium-paywallen. När köpen är
 * påslagna visas RevenueCats paywall för coin-paketen; finns den inte (eller i dev-förhandsvisningen)
 * visas det egna köpbladet (components/CoinShopSheet.tsx). onDone körs när köpta coins kommit fram.
 */
export function openCoinShop(opts?: { reason?: 'browse' | 'out' | 'scan'; note?: string; onDone?: () => void }): void {
  const { useFlightStore } = require('../store/flightStore');
  const { COIN_PACKS_ENABLED } = require('../services/coinPacks');
  const st = useFlightStore.getState();
  const purchases = require('../services/purchases');
  if (!(st.isPremium || st.isMax)) { purchases.presentPaywall('Blade coins'); return; }
  const openSheet = () => require('../store/coinShopStore').useCoinShopStore.getState().open(opts);
  if (!COIN_PACKS_ENABLED) { openSheet(); return; }
  const before = useTokenQuotaStore.getState().usage?.credits ?? 0;
  purchases.presentCoinPaywall().then(async (r: 'purchased' | 'cancelled' | 'unavailable') => {
    if (r === 'unavailable') { openSheet(); return; }
    if (r !== 'purchased') return;
    if (await awaitPurchasedCredits(before)) opts?.onDone?.();
    else Alert.alert('Coins on the way', 'Your purchase went through. The coins will show up in a moment.');
  }).catch(() => openSheet());
}

/**
 * Premium-användare som nått sin månadspott. När coin-paketen finns öppnas köpbladet (köpta coins går
 * aldrig ut); annars bara ett besked om påfyllningen den 1:a.
 */
export function showMonthlyTokenLimitAlert(): void {
  const { coinShopAvailable } = require('../services/coinPacks');
  if (coinShopAvailable()) { openCoinShop({ reason: 'out' }); return; }
  Alert.alert(
    'Out of Blade-coins',
    'You have used all your Blade-coins for this month. They refill automatically on the 1st.',
  );
}

/** Känner igen felet proxyn kastar när ett anrop ändå slank igenom gate-kollen (race). */
export function isTokenQuotaError(e: any): boolean {
  return typeof e?.message === 'string' && e.message.startsWith('TOKEN_QUOTA_EXCEEDED');
}
