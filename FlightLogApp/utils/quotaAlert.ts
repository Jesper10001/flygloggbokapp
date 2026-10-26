import { useFlightStore } from '../store/flightStore';
import { presentPaywall } from '../services/purchases';
import { showMonthlyTokenLimitAlert } from './tokenGate';

type TranslateFn = (key: string) => string;

// AI-gränsen nådd (proxyns Blade-coins): gratis → riktiga Premium-betalväggen; Premium → besked att coinsen
// fylls på nästa månad. (Tidigare "Top up 49 kr" här nollställde kvoten UTAN betalning — borttaget.)
export function showQuotaExceededAlert(_t: TranslateFn, _reason: string) {
  const { isPremium, isMax } = useFlightStore.getState();
  if (isPremium || isMax) showMonthlyTokenLimitAlert();
  else presentPaywall('Logbook builder');
}
