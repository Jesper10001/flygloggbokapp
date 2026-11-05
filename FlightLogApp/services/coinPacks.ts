// Köp av fler Blade coins (bara Premium). Förbrukningsbara App Store-produkter via RevenueCat; proxyn
// krediterar köpet när RevenueCat-webhooken kommer (proxy/src/credits.ts), appen lägger aldrig till coins
// själv. Köpta coins går aldrig ut och används efter månadens 250.
//
// På i TestFlight-bygget och av i App Store-bygget tills de släpps (NEW_PAYWALLS i constants/paywalls.ts).
// Kräver produkterna i App Store Connect och RevenueCats offering "coins".
// I dev-builden visas köpbladet ändå (COIN_SHOP_PREVIEW) så att designen kan provas — utan köp.
import { NEW_PAYWALLS } from '../constants/paywalls';

export const COIN_PACKS_ENABLED = NEW_PAYWALLS;
export const COIN_SHOP_PREVIEW = __DEV__;
export const coinShopAvailable = () => COIN_PACKS_ENABLED || COIN_SHOP_PREVIEW;

// RevenueCats offering med paketen (identifier i RevenueCat-dashboarden).
export const COIN_OFFERING_ID = 'coins';

export interface CoinPack {
  productId: string;     // App Store-produktens id (samma som i proxy/src/credits.ts)
  coins: number;
  fallbackPrice: string; // visas tills App Store-priset är hämtat
  badge?: string;
}

export const COIN_PACKS: CoinPack[] = [
  { productId: 'blades_coins_100', coins: 100, fallbackPrice: '29 kr' },
  { productId: 'blades_coins_250', coins: 250, fallbackPrice: '39 kr', badge: 'Popular' },
  { productId: 'blades_coins_500', coins: 500, fallbackPrice: '69 kr', badge: 'Best value' },
];
