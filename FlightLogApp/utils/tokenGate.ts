// Delad gate-logik för de icke-OCR AI-funktionerna (CSV-import, flight-scan,
// aircraft/drone-lookup) — dessa är INTE längre premium-låsta, bara token-låsta.
// Fri nivå får prova funktionerna tills engångspotten (50k) är slut; premium/max
// har en egen månadspott. OCR-loggboksskanning är opåverkad (fortfarande
// premium-gated på egen hand — inte prissatt/klar än).
import { Alert } from 'react-native';
import { useTokenQuotaStore } from '../store/tokenQuotaStore';

export function hasTokenQuota(): boolean {
  return useTokenQuotaStore.getState().hasQuota();
}

/** Redan betalande användare som nått sin månadspott — inget uppgraderingserbjudande, bara besked. */
export function showMonthlyTokenLimitAlert(): void {
  Alert.alert(
    'Monthly AI limit reached',
    'You have used your AI budget for this month. It resets automatically on the 1st.',
  );
}

/** Känner igen felet proxyn kastar när ett anrop ändå slank igenom gate-kollen (race). */
export function isTokenQuotaError(e: any): boolean {
  return typeof e?.message === 'string' && e.message.startsWith('TOKEN_QUOTA_EXCEEDED');
}
