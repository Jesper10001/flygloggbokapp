// Köpta Blade coins (för Premium): ett eget saldo utöver månadspotten som aldrig går ut — App Review 3.1.1:
// köpt valuta får inte förfalla. Månadspotten används först, de köpta sist, så att de räcker så länge
// som möjligt. Allt räknas i tokens (1 coin = 200 tokens), som månadspotten.
//
// Krediteras BARA server-side: RevenueCat-webhooken (NON_RENEWING_PURCHASE för en coin-produkt), en gång
// per transaktion (credit-tx:<id>). Appen kan aldrig lägga till coins själv.
//
// Återbetalar Apple ett köp (webhooken CANCELLATION för en coin-produkt) dras köpets coins tillbaka. Har de
// redan använts blir saldot negativt — en skuld som minskar månadspotten tills den är betald, eller tas ut
// av nästa köp. Coins är en rätt att använda appens funktioner, inte något användaren äger.

export const TOKENS_PER_COIN = 200;

// App Store-produkterna (förbrukningsbara) → antal coins. Priser sätts i App Store Connect:
// 100 = 29 kr, 250 = 39 kr, 500 = 69 kr.
export const COIN_PACKS: Record<string, number> = {
  blades_coins_100: 100,
  blades_coins_250: 250,
  blades_coins_500: 500,
};

export const creditKey = (deviceHash: string) => `credits:${deviceHash}`;
const creditTxKey = (tx: string) => `credit-tx:${tx}`;
const refundTxKey = (tx: string) => `credit-refund:${tx}`;

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** Köpta tokens kvar för enheten. Negativt = skuld efter ett återbetalt köp vars coins redan använts. */
export async function getCredits(kv: Kv, deviceHash: string): Promise<number> {
  return parseInt((await kv.get(creditKey(deviceHash))) ?? '0', 10) || 0;
}

/**
 * Lägger till ett köp. Samma transaktion krediteras bara en gång (webhooken kan komma flera gånger).
 * Returnerar antalet tillagda tokens (0 om köpet redan var krediterat eller produkten okänd).
 */
export async function grantPurchase(kv: Kv, deviceHash: string, transactionId: string, productId: string): Promise<number> {
  const coins = COIN_PACKS[productId];
  if (!coins || !transactionId) return 0;
  if (await kv.get(creditTxKey(transactionId)) || await kv.get(refundTxKey(transactionId))) return 0;
  await kv.put(creditTxKey(transactionId), deviceHash);
  const tokens = coins * TOKENS_PER_COIN;
  await kv.put(creditKey(deviceHash), String((await getCredits(kv, deviceHash)) + tokens));
  return tokens;
}

/**
 * Återbetalt köp: drar tillbaka köpets coins, en gång per transaktion. Kom återbetalningen före köpet
 * markeras transaktionen så att köpet aldrig krediteras. Returnerar antalet återtagna tokens.
 */
export async function revokePurchase(kv: Kv, deviceHash: string, transactionId: string, productId: string): Promise<number> {
  const coins = COIN_PACKS[productId];
  if (!coins || !transactionId || await kv.get(refundTxKey(transactionId))) return 0;
  await kv.put(refundTxKey(transactionId), deviceHash);
  if (!(await kv.get(creditTxKey(transactionId)))) return 0;
  const tokens = coins * TOKENS_PER_COIN;
  await kv.put(creditKey(deviceHash), String((await getCredits(kv, deviceHash)) - tokens));
  return tokens;
}

/**
 * Hur ett anrops tokens dras: först från månadspotten (det som är kvar till taket), sedan från köpta
 * coins. Har användaren inga köpta coins räknas allt mot månaden som förut (även det som går över taket,
 * eftersom anropet redan släppts igenom). Räcker de köpta inte hela vägen går resten mot månaden.
 */
export function splitCharge(used: number, limit: number, credits: number, tokens: number): { addUsed: number; takeCredits: number } {
  if (tokens <= 0) return { addUsed: 0, takeCredits: 0 };
  if (credits <= 0) return { addUsed: tokens, takeCredits: 0 };
  const fromMonthly = Math.min(tokens, Math.max(0, limit - used));
  const rest = tokens - fromMonthly;
  const takeCredits = Math.min(rest, credits);
  return { addUsed: fromMonthly + (rest - takeCredits), takeCredits };
}

/** Får anropet släppas igenom? Kvar i månadspotten (minus en ev. skuld) eller köpta coins. */
export function hasAllowance(used: number, limit: number, credits: number): boolean {
  return used < limit + Math.min(0, credits) || credits > 0;
}
