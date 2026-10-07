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
import { useFlightStore } from '../store/flightStore';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const ENTITLEMENT_ID = 'premium';

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
      applyEntitlement(isEntitlementActive(info)).catch(() => {});
    });
  } catch { /* native modul saknas/ej konfigurerad → tyst */ }
}

function isEntitlementActive(info: CustomerInfo | null | undefined): boolean {
  try { return !!info?.entitlements?.active?.[ENTITLEMENT_ID]; } catch { return false; }
}

// Premium = RevenueCat-entitlement ELLER promokod (server-verifierad). Skriver ALDRIG över en
// aktiv promo till false — de två källorna OR:as ihop.
async function applyEntitlement(rcActive: boolean): Promise<void> {
  const promo = (await getSetting('promo_premium').catch(() => null)) === '1';
  useFlightStore.getState().setIsPremium(rcActive || promo);
  refreshTokenQuota(); // Blade-coin-saldot (server /tokens) ska uppdateras direkt när premium ändras
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
    await applyEntitlement(isEntitlementActive(info));
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
    const active = isEntitlementActive(customerInfo);
    await applyEntitlement(active);
    return active ? 'success' : 'error';
  } catch (e: any) {
    if (e?.userCancelled) return 'cancelled';
    return 'error';
  }
}

/**
 * Visar paywallen. ETT anrop för ALLA triggers (Blades Premium-knappen, slut på coins, premium-
 * funktion). Visar RevenueCats designade paywall när den är tillgänglig; annars den egna fallback-
 * paywallen (usePaywallStore → <PremiumModal> i roten). Returnerar om användaren blev premium.
 */
export async function presentPaywall(feature?: string): Promise<boolean> {
  // Redan premium → ingen paywall behövs.
  try { if (useFlightStore.getState().isPremium) return true; } catch { /* ignore */ }

  if (configured && Purchases && RevenueCatUI) {
    try {
      // Visar current offerings paywall (den du designar i RevenueCat). Resultatet bryr vi oss inte
      // om i detalj — vi läser av entitlement efteråt.
      await RevenueCatUI.presentPaywall();
      await refreshEntitlement();
      return useFlightStore.getState().isPremium;
    } catch { /* fall igenom till fallback */ }
  }

  // Fallback: egen paywall (innan RC-nyckel/native-rebuild, eller om något fallerar).
  try {
    const { usePaywallStore } = require('../store/paywallStore');
    usePaywallStore.getState().open(feature);
  } catch { /* ignore */ }
  return false;
}

/** Återställer tidigare köp (t.ex. ny enhet/ominstallation, samma Apple-ID). */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!configured || !Purchases) return 'unavailable';
  try {
    const info = await Purchases.restorePurchases();
    const active = isEntitlementActive(info);
    await applyEntitlement(active);
    return active ? 'success' : 'nothing';
  } catch (e: any) {
    if (e?.userCancelled) return 'cancelled';
    return 'error';
  }
}
