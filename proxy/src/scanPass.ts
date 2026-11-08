// Skanningspasset: det skanningsrutan lovar ("97 coins · about 3 spreads") ska räcka hela vägen, även om uppslagen
// kostar lite mer än uppskattningen (30 coins). Appen ber om ett pass när läsningen börjar (POST /scan/pass med
// antalet uppslag). Passet ger så många skanningsläsningar som saldot räcker till enligt samma räkning som appen,
// högst 10. Tar coinsen slut innan de läsningarna är klara släpps de igenom ändå: det som går över dras som
// vanligt mot månadspotten (splitCharge), som då hamnar över taket, och visas aldrig som skuld — vi bjuder på
// mellanskillnaden. Nästa läsning efter passet stoppas som förut när saldot är slut.
//
// Gränser: bara riktiga skanningsläsningar (isScanCall), bara så många som passet gav, och passet går ut efter
// tre timmar. Ett nytt pass ersätter det gamla, så ett pass från en tidigare skanning kan inte sparas till senare.
// Läsningarna räknas när de lyckats; i strömmande svar räknas de i bakgrunden, så en läsning till kan hinna
// släppas igenom precis när passet tar slut.
import { TOKENS_PER_COIN } from './credits';
import { isScanCall } from './quotaWeight';

export const SCAN_COINS_PER_SPREAD = 30;   // som appens utils/tokenGate.ts
export const SCAN_PASS_MAX = 10;           // som appens MAX_SPREADS (store/scanStore.ts)
const PASS_TTL_S = 3 * 60 * 60;

const passKey = (deviceHash: string) => `scanpass:${deviceHash}`;

export interface ScanPass { n: number; reads: number; exp: number }

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

const toCoins = (tokens: number) => Math.max(0, Math.round((tokens || 0) / TOKENS_PER_COIN));

/** Hur många uppslag saldot räcker till, räknat som appens skanningsruta (varje pott avrundas till coins för sig). */
export function scanReach(used: number, limit: number, credits: number): number {
  const coins = Math.max(0, toCoins(limit) - toCoins(used)) + toCoins(credits);
  return Math.floor(coins / SCAN_COINS_PER_SPREAD);
}

/**
 * Antal uppslag passet ger: det appen ber om, högst 10, och högst ett mer än saldot räcker till här (appens
 * saldo kan ligga ett anrop efter serverns, och det appen visade ska gälla). Inget pass utan ett helt uppslag.
 */
export function passSize(requested: number, reach: number): number {
  const n = Math.floor(Number(requested) || 0);
  if (n <= 0 || reach <= 0) return 0;
  return Math.min(n, SCAN_PASS_MAX, reach + 1);
}

/** Sparar ett nytt pass (ersätter ett gammalt). n = 0 tar bort ett gammalt pass. */
export async function grantScanPass(kv: Kv, deviceHash: string, n: number, now = Date.now()): Promise<void> {
  if (n <= 0) { await kv.delete(passKey(deviceHash)); return; }
  const pass: ScanPass = { n, reads: 0, exp: now + PASS_TTL_S * 1000 };
  await kv.put(passKey(deviceHash), JSON.stringify(pass), { expirationTtl: PASS_TTL_S });
}

async function readPass(kv: Kv, deviceHash: string, now: number): Promise<ScanPass | null> {
  try {
    const p = JSON.parse((await kv.get(passKey(deviceHash))) ?? 'null') as ScanPass | null;
    return p && typeof p.n === 'number' && typeof p.reads === 'number' && p.exp > now ? p : null;
  } catch {
    return null;
  }
}

/** Får en skanningsläsning släppas igenom fast saldot är slut? Ja om ett giltigt pass har läsningar kvar. */
export async function scanPassCovers(kv: Kv, deviceHash: string, body: any, now = Date.now()): Promise<boolean> {
  if (!isScanCall(body)) return false;
  const p = await readPass(kv, deviceHash, now);
  return !!p && p.reads < p.n;
}

/** En lyckad skanningsläsning: räknas av mot passet (finns inget pass händer inget). */
export async function noteScanRead(kv: Kv, deviceHash: string, body: any, now = Date.now()): Promise<void> {
  if (!isScanCall(body)) return;
  const p = await readPass(kv, deviceHash, now);
  if (!p) return;
  const left = Math.ceil((p.exp - now) / 1000);
  if (left < 60) return; // KV kräver minst 60 s; passet går ändå ut strax
  await kv.put(passKey(deviceHash), JSON.stringify({ ...p, reads: p.reads + 1 }), { expirationTtl: left });
}
