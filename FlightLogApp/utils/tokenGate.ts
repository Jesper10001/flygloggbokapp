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

export function hasTokenQuota(): boolean {
  return useTokenQuotaStore.getState().hasQuota();
}

/** Redan betalande användare som nått sin månadspott — inget uppgraderingserbjudande, bara besked. */
export function showMonthlyTokenLimitAlert(): void {
  Alert.alert(
    'Out of Blade-coins',
    'You have used all your Blade-coins for this month. They refill automatically on the 1st.',
  );
}

/** Känner igen felet proxyn kastar när ett anrop ändå slank igenom gate-kollen (race). */
export function isTokenQuotaError(e: any): boolean {
  return typeof e?.message === 'string' && e.message.startsWith('TOKEN_QUOTA_EXCEEDED');
}
