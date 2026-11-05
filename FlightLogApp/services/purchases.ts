// RevenueCat-integration (In-App Purchases / prenumeration).
//
// ALL åtkomst går via denna wrapper som LAZY-REQUIRE:ar native-modulen → en build UTAN den
// (Expo Go, eller innan nästa EAS-rebuild) kraschar aldrig; den rapporterar bara "otillgänglig"
// och premium avgörs då enbart av promokod/servern.
//
// Kopplingen till din Cloudflare-proxy: appUserID sätts till samma getDeviceId() som skickas
// i X-Device-ID → proxyn kan fråga RevenueCat (REST eller webhook→KV) om enheten har premium,
// helt server-side. Klienten sätter aldrig sanningen själv.
//
// SETUP som återstår (görs i RevenueCat + App Store Connect + eas.json):
//   1. Skapa entitlement "premium" i RevenueCat och koppla din prenumerationsprodukt.
//   2. Lägg den PUBLIKA iOS-SDK-nyckeln (appl_…) som EXPO_PUBLIC_REVENUECAT_IOS_KEY i eas.json
//      (preview + production env). Den är ofarlig att shippa. Secret-nyckeln ligger BARA i Workern.
//   3. EAS-rebuild (native modul).
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { getDeviceId } from './anthropicClient';
import { getSetting } from '../db/flights';
import { useFlightStore, type SubscriptionTier } from '../store/flightStore';
import { NEW_PAYWALLS, PLANS_OFFERING_ID } from '../constants/paywalls';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const ENTITLEMENT_ID = 'premium';
// Blades Max ger både "premium" och "max", så äldre byggen ser en Max-kund som Premium.
const MAX_ENTITLEMENT_ID = 'max';
const MAX_PRODUCT_ID = 'blades_max_monthly';

// Lazy-require: får aldrig fälla en build som saknar native-modulen.
let Purchases: any = null;
try { Purchases = require('react-native-purchases').default; } catch { Purchases = null; }

// RevenueCats egna paywall-UI (react-native-purchases-ui). Lazy-require → kraschar aldrig en build
// utan native-modulen; då faller presentPaywall() tillbaka på den egna fallback-paywallen.
let RevenueCatUI: any = null;
try { RevenueCatUI = require('react-native-purchases-ui').default; } catch { RevenueCatUI = null; }

let configured = false;

/** True bara när native-modulen finns OCH en nyckel är satt för plattformen. */
export function purchasesAvailable(): boolean {
  const key = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
  return !!Purchases && !!key;
}

// Stabilt app_user_id = iOS identifierForVendor — SAMMA värde som X-Device-ID (cachas där vid
// start). Vi hämtar det direkt här (await) så RevenueCat aldrig råkar konfigureras med bundle-id-
// fallbacken innan cachen hunnit sättas → annars skulle alla iOS-användare dela EN subscriber.
async function stableAppUserId(): Promise<string> {
  try {
    if (Platform.OS === 'ios') {
      const id = await Application.getIosIdForVendorAsync?.();
      if (id) return id;
    }
  } catch { /* fall igenom */ }
  return getDeviceId();
}

/** Konfigurerar RevenueCat en gång vid appstart. appUserID = identifierForVendor (= X-Device-ID). */
export async function configurePurchases(): Promise<void> {
  if (configured || !Purchases) return;
  const apiKey = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
  if (!apiKey) return; // ingen nyckel satt än → hoppa tyst (premium sköts av promo/server tills vidare)
  try {
    Purchases.configure({ apiKey, appUserID: await stableAppUserId() });
    configured = true;
    // Håll premium i synk om Apple förnyar/återkallar prenumerationen i bakgrunden.
    Purchases.addCustomerInfoUpdateListener((info: CustomerInfo) => {
      applyEntitlement(tierOf(info)).catch(() => {});
    });
  } catch { /* native modul saknas/ej konfigurerad → tyst */ }
}

function tierOf(info: CustomerInfo | null | undefined): SubscriptionTier {
  try {
    const active = info?.entitlements?.active ?? {};
    // Max känns igen på sitt entitlement, eller på att det är Max-produkten som ger "premium".
    if (active[MAX_ENTITLEMENT_ID] || active[ENTITLEMENT_ID]?.productIdentifier === MAX_PRODUCT_ID) return 'max';
    return active[ENTITLEMENT_ID] ? 'premium' : 'free';
  } catch { return 'free'; }
}

// Nivån = RevenueCat-entitlement, och minst Premium med en promokod (server-verifierad). Skriver ALDRIG över
// en aktiv promo till free — de två källorna slås ihop.
async function applyEntitlement(rcTier: SubscriptionTier): Promise<void> {
  const promo = (await getSetting('promo_premium').catch(() => null)) === '1';
  useFlightStore.getState().setTier(rcTier === 'free' && promo ? 'premium' : rcTier);
  refreshTokenQuota(); // Blade-coin-saldot (server /tokens) ska uppdateras direkt när nivån ändras
}

// Laddar om coin-saldot från proxyns /tokens. Lazy-require undviker cirkulär import. Kör direkt
// + en gång till strax efter, så webhooken/serverns premium-cache hinner uppdateras (annars kan
// första hämtningen råka läsa free-tier en kort stund efter köpet).
function refreshTokenQuota(): void {
  try {
    const { useTokenQuotaStore } = require('../store/tokenQuotaStore');
    const reload = () => useTokenQuotaStore.getState().load().catch(() => {});
    reload();
    setTimeout(reload, 4000);
  } catch { /* storen är valfri */ }
}

/** Hämtar färskt entitlement-läge från RevenueCat och uppdaterar storen. Anropas vid start. */
export async function refreshEntitlement(): Promise<void> {
  if (!configured || !Purchases) return;
  try {
    const info = await Purchases.getCustomerInfo();
    await applyEntitlement(tierOf(info));
  } catch { /* tyst — behåll cachat läge */ }
}

/** Aktuellt "offering" (paketen paywallen ska visa), eller null om otillgängligt. */
export async function getPremiumOffering(): Promise<PurchasesOffering | null> {
  if (!configured || !Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings?.current ?? null;
  } catch { return null; }
}

export type PurchaseOutcome = 'success' | 'cancelled' | 'unavailable' | 'nothing' | 'error';

/** Köper ett paket. Returnerar ett stabilt resultat som UI:t kan mappa till en toast. */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!configured || !Purchases) return 'unavailable';
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const tier = tierOf(customerInfo);
    await applyEntitlement(tier);
    return tier !== 'free' ? 'success' : 'error';
  } catch (e: any) {
    if (e?.userCancelled) return 'cancelled';
    return 'error';
  }
}

// Erbjudandet med Premium och Max (bara med de nya paywallsen). Undefined = current offering.
async function plansOffering(): Promise<PurchasesOffering | undefined> {
  if (!NEW_PAYWALLS) return undefined;
  try { return (await Purchases.getOfferings())?.all?.[PLANS_OFFERING_ID] ?? undefined; } catch { return undefined; }
}

/**
 * Visar paywallen. ETT anrop för ALLA triggers (Blades Premium-knappen, slut på coins, premium-
 * funktion). Visar RevenueCats designade paywall när den är tillgänglig; annars den egna fallback-
 * paywallen (usePaywallStore → <PremiumModal> i roten). Returnerar om användaren blev premium.
 * upgrade: en Premium-användare får paywallen ändå, för att byta till Max.
 */
export async function presentPaywall(feature?: string, opts?: { upgrade?: boolean }): Promise<boolean> {
  // Redan premium → ingen paywall behövs, utom för att uppgradera till Max.
  try {
    const st = useFlightStore.getState();
    if (st.isMax || (st.isPremium && !(opts?.upgrade && NEW_PAYWALLS))) return true;
  } catch { /* ignore */ }

  if (configured && Purchases && RevenueCatUI) {
    try {
      // Visar erbjudandets paywall (den du designar i RevenueCat). Resultatet bryr vi oss inte om i
      // detalj — vi läser av entitlement efteråt.
      const offering = await plansOffering();
      if (opts?.upgrade && !offering) return false; // utan Max-erbjudandet finns inget att byta till
      await (offering ? RevenueCatUI.presentPaywall({ offering }) : RevenueCatUI.presentPaywall());
      await refreshEntitlement();
      return useFlightStore.getState().isPremium;
    } catch { /* fall igenom till fallback */ }
  }
  if (opts?.upgrade) return false; // den egna paywallen har inget Max-kort

  // Fallback: egen paywall (innan RC-nyckel/native-rebuild, eller om något fallerar).
  try {
    const { usePaywallStore } = require('../store/paywallStore');
    usePaywallStore.getState().open(feature);
  } catch { /* ignore */ }
  return false;
}

/**
 * Visar RevenueCats **Customer Center** (prenumerationsstatus + hantera/säg upp/återställ) för
 * användare som REDAN har premium. Returnerar true om den visades. Kräver att Customer Center är
 * aktiverat i RevenueCat-dashboarden; annars (eller utan native-modul) returneras false → anroparen
 * faller tillbaka på den egna premium-sidan (som visar "Premium active").
 */
export async function presentManageSubscription(): Promise<boolean> {
  if (configured && Purchases && RevenueCatUI?.presentCustomerCenter) {
    try {
      await RevenueCatUI.presentCustomerCenter();
      await refreshEntitlement();
      return true;
    } catch { /* ej konfigurerad/otillgänglig → fallback */ }
  }
  return false;
}

/**
 * Coin-paketen ur RevenueCats offering "coins", med App Store-priset. Tom lista om köp inte är möjliga
 * (ingen nyckel/native-modul, eller offeringen finns inte än).
 */
export async function getCoinPackages(): Promise<{ productId: string; priceString: string; pkg: PurchasesPackage }[]> {
  if (!configured || !Purchases) return [];
  try {
    const { COIN_OFFERING_ID } = require('./coinPacks');
    const offerings = await Purchases.getOfferings();
    const offering: PurchasesOffering | undefined = offerings?.all?.[COIN_OFFERING_ID];
    return (offering?.availablePackages ?? []).map((pkg: PurchasesPackage) => ({
      productId: pkg.product.identifier, priceString: pkg.product.priceString, pkg,
    }));
  } catch { return []; }
}

/**
 * RevenueCats designade paywall för coin-paketen (erbjudandet "coins", designas i RevenueCat-dashboarden).
 * 'unavailable' om paywallen eller erbjudandet saknas → anroparen visar det egna köpbladet i stället.
 */
export async function presentCoinPaywall(): Promise<'purchased' | 'cancelled' | 'unavailable'> {
  if (!configured || !Purchases || !RevenueCatUI) return 'unavailable';
  try {
    const { COIN_OFFERING_ID } = require('./coinPacks');
    const offerings = await Purchases.getOfferings();
    const offering = offerings?.all?.[COIN_OFFERING_ID];
    if (!offering) return 'unavailable';
    const result = await RevenueCatUI.presentPaywall({ offering });
    const { PAYWALL_RESULT } = require('react-native-purchases-ui');
    if (result === PAYWALL_RESULT.PURCHASED) return 'purchased';
    if (result === PAYWALL_RESULT.NOT_PRESENTED || result === PAYWALL_RESULT.ERROR) return 'unavailable';
    return 'cancelled';
  } catch { return 'unavailable'; }
}

/**
 * Köper ett coin-paket (förbrukningsbart). Coinsen läggs till av proxyn när RevenueCat meddelar köpet;
 * anroparen väntar in dem via /tokens (waitForCredits).
 */
export async function purchaseCoinPackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!configured || !Purchases) return 'unavailable';
  try {
    await Purchases.purchasePackage(pkg);
    return 'success';
  } catch (e: any) {
    if (e?.userCancelled) return 'cancelled';
    return 'error';
  }
}

/** Återställer tidigare köp (t.ex. ny enhet/ominstallation, samma Apple-ID). */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!configured || !Purchases) return 'unavailable';
  try {
    const info = await Purchases.restorePurchases();
    const tier = tierOf(info);
    await applyEntitlement(tier);
    return tier !== 'free' ? 'success' : 'nothing';
  } catch (e: any) {
    if (e?.userCancelled) return 'cancelled';
    return 'error';
  }
}
