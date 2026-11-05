// De nya paywallsen: Premium eller Max på samma paywall, och köp av fler Blade coins. De är på i TestFlight-bygget
// (EAS-kanalen preview) men inte i App Store-bygget, tills de släpps med nästa version: sätt då
// NEW_PAYWALLS_LIVE = true i det bygget. App Store 1.0 saknar expo-updates och får aldrig den här koden.
const NEW_PAYWALLS_LIVE = false;

let channel: string | null = null;
try { channel = require('expo-updates').channel ?? null; } catch { channel = null; }

export const NEW_PAYWALLS = NEW_PAYWALLS_LIVE || channel === 'preview';

// RevenueCats offering med Premium och Max (identifier i RevenueCat-dashboarden). Det nuvarande erbjudandet
// "standard" ligger kvar som current för App Store-bygget.
export const PLANS_OFFERING_ID = 'premium_max';
