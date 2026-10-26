// Blades API Proxy + Telemetri + Stats-dashboard
import { callWithModelFallback, refreshModelRouting } from './modelFallback';

interface Env {
  ANTHROPIC_API_KEY: string;
  TELEMETRY: AnalyticsEngineDataset;
  QUOTA_KV: KVNamespace;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  STATS_PASSWORD: string;
  PROMO_CODES?: string; // kommaseparerade promo-koder (secret) → gratis Blades Premium. Aldrig i app-bundlen.
  APP_KEY?: string;     // valfri app-autentisering: krävs i X-App-Key om satt (se AI-proxyn). Vilande om osatt.
  REVENUECAT_SECRET_KEY?: string;   // RevenueCat v2 secret key (sk_…) — läser kunds active entitlements. Secret.
  REVENUECAT_PROJECT_ID?: string;   // RevenueCat projekt-id (proj…) — behövs i v2-URL:en.
  REVENUECAT_WEBHOOK_AUTH?: string; // delad hemlighet: Authorization-headern i RevenueCat-webhooken.
  ARCGIS_API_KEY?: string;          // ArcGIS Location Platform API-nyckel (privilegie: Basemaps) — share-kortets satellitbilder. Secret.
  MAP_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> }; // Rate Limiting-binding (wrangler.toml)
}

// ── Token-baserad AI-kvot (input+output per device) — den ENDA aktiva spärren ──
// Räknas ALLTID (syns i appens Settings); spärras när TOKEN_QUOTAS_ENABLED=true.
// Spärr för CSV-import, flight-scan och aircraft/drone-lookup: dessa funktioner är
// INTE premium-låsta, bara token-låsta.
// FREE = engångspott (lifetime, nollställs aldrig) · PREMIUM = per månad.
// Visas för användaren som "Blade-coins" (1 coin = 200 tokens) — se appens tokenGate.
const TOKEN_QUOTAS_ENABLED = true;
const TOKEN_LIMITS: Record<string, number> = {
  free: 20_000,     // engångspott (lifetime) = 100 Blade-coins
  premium: 50_000,  // per månad = 250 Blade-coins
};

// ── Incident news (hybrid: gratis RSS + EN liten Haiku-pass, server-cachad) ──
// Kostnadsnyckel: vi hämtar RSS från etablerade flyg-nyhetskällor (gratis) och kör EN Haiku-pass
// (utan web search) för att strukturera + plocka ICAO. Resultatet cachas globalt i KV i 1 timme →
// RSS hämtas + Haiku körs som mest 1 gång/timme för ALLA användare tillsammans → ~0 kr. Appen GET:ar
// bara den cachade listan. Fortsatt Premium-only (produktval), men inte längre dyr per scan.
const NEWS_CACHE_KEY = 'newscache:v2';
const NEWS_CACHE_TTL_SEC = 3600;           // 1 timme delad cache
const NEWS_WINDOW_DAYS = 30;               // bara incidenter från senaste N dygnen ("Latest month")
const NEWS_MODEL = 'claude-haiku-5-5'; // 10× billigare än Haiku 4.5; fasas den ut tar modelFallback nästa Haiku
// Etablerade flyg-nyhetskällor med RSS/Atom-flöden (syndikering). Trasiga flöden hoppas tyst över.
// Lägg bara till källor vars flöden är avsedda för vidarespridning; undvik sajter vars villkor förbjuder det.
const NEWS_FEEDS: { url: string; source: string }[] = [
  // Allmänna flygnyheter
  { url: 'https://www.avweb.com/feed/', source: 'AVweb' },
  { url: 'https://simpleflying.com/feed/', source: 'Simple Flying' },
  { url: 'https://theaviationist.com/feed/', source: 'The Aviationist' },
  { url: 'https://www.aerotime.aero/feed', source: 'AeroTime' },
  // Incident-inriktade källor (fler airport-kopplade händelser). Verifiera flödes-URL:erna live;
  // trasiga/ändrade flöden hoppas tyst över.
  { url: 'https://www.aeroinside.com/rss', source: 'AeroInside' },
  { url: 'https://airlive.net/feed/', source: 'AIRLIVE' },
];

// Free = lifetime-nyckel (ingen TTL); premium = månadsnyckel (löper ut)
function tokenKey(deviceHash: string, tier: string): string {
  return tier === 'free'
    ? `tokens:${deviceHash}:lifetime`
    : `tokens:${deviceHash}:${currentMonth()}`;
}

async function addTokens(kv: KVNamespace, dk: DevKeys, tier: string, tokens: number): Promise<void> {
  if (!kv || tokens <= 0) return;
  try {
    const key = tokenKey(dk.hash, tier);
    let raw = await kv.get(key);
    if (raw === null) raw = await kv.get(tokenKey(dk.legacy, tier)); // lazy migrering från gammal nyckel
    const cur = parseInt(raw ?? '0', 10);
    await kv.put(key, String(cur + tokens), tokenTtl(tier));
  } catch { /* räkningen får aldrig fälla ett anrop */ }
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Modell-ID:n som app-byggen (och proxyns egna anrop) begär → kontrolleras dagligen av cron:en (modelFallback.ts).
// Lägg till nya ID:n här när en app-build börjar begära dem. (Gamla byggens 4.6/4.5 pekas om i modelFallback.)
const APP_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-4-8', 'claude-haiku-4-5', 'claude-haiku-5-5'];

// USD per miljon tokens (indata, utdata) enligt Anthropics prislista 2026-10-26 → telemetrins kostnad följer
// modellen som faktiskt svarade. Okänd modell → Sonnet 4.6-pris.
const MODEL_PRICES: [RegExp, number, number][] = [
  [/^claude-haiku-5-5/, 0.1, 0.5], [/^claude-haiku-4-5/, 1, 5],
  [/^claude-sonnet-5/, 2, 10], [/^claude-sonnet-4/, 3, 15],
  [/^claude-opus-5-5/, 4, 20], [/^claude-opus-[45]/, 5, 25],
  [/^claude-fable/, 10, 50],
];
function costUsd(model: string, inTok: number, outTok: number): number {
  const [, pin, pout] = MODEL_PRICES.find(([re]) => re.test(model)) ?? [null, 3, 15];
  return Math.round(((inTok * pin + outTok * pout) / 1e6) * 10000) / 10000;
}

// Native-appen (iOS) skickar ingen Origin och bryr sig inte om CORS → den påverkas inte.
// Genom att bara tillåta website-origin blockeras webbläsar-anrop från andra sajter (t.ex. en
// scriptad demosida). OBS: CORS stoppar INTE curl/servrar (de ignorerar CORS) — se app-secret nedan.
const ALLOWED_ORIGIN = 'https://blades-app.com';
function corsHeaders(_origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID, X-Premium, X-Tier, X-App-Key, X-Feature',
    'Access-Control-Max-Age': '86400',
  };
}

// Enhets-nyckel för KV + telemetri: SHA-256 (domänseparerad) → 128 bitar hex. Ersätter den gamla
// 32-bitars strängsumman, som kunde krocka mellan två enheter (→ delade coin-räknare, promo och
// premium-cache). 128 bitar = praktiskt taget noll krockrisk även vid miljontals enheter.
async function hashDevice(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`blades-device:v2:${id}`));
  const hex = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  return 'd2_' + hex;
}

// GAMMAL 32-bitars hash — används ENDAST för att läsa/migrera befintliga KV-nycklar (lazy, vid läsning).
function legacyHashDevice(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return 'dev_' + Math.abs(h).toString(36);
}

type DevKeys = { hash: string; legacy: string };
async function deviceKeys(id: string): Promise<DevKeys> {
  return { hash: await hashDevice(id), legacy: legacyHashDevice(id) };
}

const tokenTtl = (tier: string): { expirationTtl?: number } =>
  tier === 'free' ? {} : { expirationTtl: 60 * 60 * 24 * 40 };

// Läser `key`; saknas den men den GAMLA nyckeln finns → kopiera över (lazy migrering) så att befintliga
// coin-räknare och promo-koder följer med till nya nyckeln. Gamla nycklar raderas INTE: en tidigare krock
// kan ha delat en nyckel mellan två enheter, och en radering kunde då ta promo från fel enhet.
async function kvGetMigrating(kv: KVNamespace, key: string, legacyKey: string, putOpts: { expirationTtl?: number } = {}): Promise<string | null> {
  const v = await kv.get(key);
  if (v !== null || key === legacyKey) return v;
  const old = await kv.get(legacyKey);
  if (old !== null) { try { await kv.put(key, old, putOpts); } catch { /* migrering får aldrig fälla ett anrop */ } }
  return old;
}

async function promoActive(kv: KVNamespace | undefined, dk: DevKeys): Promise<boolean> {
  if (!kv) return false;
  return (await kvGetMigrating(kv, `promo:${dk.hash}`, `promo:${dk.legacy}`)) === '1';
}

// ── RevenueCat v2: server-side premium (kan inte spoofas via headers) ─────────
// Frågar RevenueCat om kundens aktiva entitlements. customerId = RÅA X-Device-ID
// (= appens identifierForVendor = RevenueCats app_user_id). Aldrig hashat mot RC.
const PREMIUM_TTL_POS = 900; // aktiv premium cachas 15 min
const PREMIUM_TTL_NEG = 60;  // "ingen premium" cachas kort → nyss köpt syns snabbt (även utan webhook)
// v3 = ny SHA-256-nyckel. Premium-värdet är bara en kort cache av RevenueCat → ingen migrering behövs.
const premiumKey = async (deviceId: string) => `premium:v3:${await hashDevice(deviceId)}`;

// Hämtar kundens aktiva entitlement-id:n + HTTP-status.
// RÅA customerId (= app_user_id) mot RevenueCat.
async function rcFetchActive(customerId: string, env: Env): Promise<{ status: number; ids: string[] }> {
  if (!env.REVENUECAT_SECRET_KEY || !env.REVENUECAT_PROJECT_ID) return { status: 0, ids: [] };
  try {
    const r = await fetch(
      `https://api.revenuecat.com/v2/projects/${env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(customerId)}/active_entitlements`,
      { headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}` } },
    );
    if (!r.ok) return { status: r.status, ids: [] }; // 401/403 = nyckel/behörighet, 404 = okänd kund
    const data = await r.json() as { items?: Array<{ entitlement_id?: string }> };
    const ids = (Array.isArray(data?.items) ? data.items : []).map((e) => e.entitlement_id ?? '').filter(Boolean);
    return { status: r.status, ids };
  } catch {
    return { status: -1, ids: [] };
  }
}

// Blades har ETT entitlement ("premium") → vilken aktiv entitlement som helst = premium.
// (Undviker att matcha RevenueCats interna entl-id mot lookup_key "premium".)
async function rcActive(customerId: string, env: Env): Promise<boolean> {
  const { ids } = await rcFetchActive(customerId, env);
  return ids.length > 0;
}

// KV-cachead premium-koll. KV-nyckeln hashas (som promo/token-nycklarna); RC-anropet
// använder det råa id:t. Negativt svar cachas kort så ett nytt köp syns snabbt.
async function checkPremium(deviceId: string, env: Env): Promise<boolean> {
  if (!deviceId || deviceId === 'unknown' || !env.QUOTA_KV) return false;
  const key = await premiumKey(deviceId);
  const cached = await env.QUOTA_KV.get(key);
  if (cached !== null) return cached === '1';
  const active = await rcActive(deviceId, env);
  await env.QUOTA_KV.put(key, active ? '1' : '0', { expirationTtl: active ? PREMIUM_TTL_POS : PREMIUM_TTL_NEG });
  return active;
}

// Server-sanningen för tier: promo-kod ELLER RevenueCat. Ersätter tilliten till
// klientens X-Tier/X-Premium-headers.
async function resolveTier(deviceId: string, env: Env): Promise<string> {
  const promo = await promoActive(env.QUOTA_KV, await deviceKeys(deviceId));
  return (promo || await checkPremium(deviceId, env)) ? 'premium' : 'free';
}

// ── Login-sida ─────────────────────────────────────────────────────────────

function loginPage(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Toreld Apps</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0D1117;color:#E6EDF3;display:flex;align-items:center;justify-content:center;height:100vh}
.box{background:#161B22;border:1px solid #30363D;border-radius:16px;padding:32px;width:320px;text-align:center}
.box h1{font-size:18px;margin-bottom:6px}
.box p{font-size:12px;color:#8B949E;margin-bottom:20px}
input{width:100%;padding:12px;border-radius:8px;border:1px solid #30363D;background:#0D1117;color:#E6EDF3;font-size:14px;text-align:center;outline:none}
input:focus{border-color:#00C8E8}
button{width:100%;padding:12px;border-radius:8px;border:none;background:#00C8E8;color:#0D1117;font-size:14px;font-weight:700;margin-top:10px;cursor:pointer}
button:hover{background:#33D4ED}
</style>
</head><body>
<div class="box">
  <p>Ange lösenord för att fortsätta</p>
  <form onsubmit="event.preventDefault();location.href='/stats?key='+encodeURIComponent(document.getElementById('pw').value)">
    <input id="pw" type="password" placeholder="Lösenord" autofocus>
    <button type="submit">Logga in</button>
  </form>
</div>
</body></html>`;
}

// ── Analytics Engine queries ───────────────────────────────────────────────

async function queryAE(env: Env, sql: string): Promise<any> {
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      { method: 'POST', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: sql },
    );
    if (!r.ok) return { data: [] };
    return await r.json();
  } catch {
    return { data: [] };
  }
}

const n = (v: any, fallback = 0) => {
  const x = Number(v);
  return isNaN(x) ? fallback : x;
};

// ── Landing page ──────────────────────────────────────────────────────────

function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BLADES — Joint Logbook</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,'Helvetica Neue',sans-serif;background:#0A1628;color:#E6EDF3;overflow-x:hidden}
a{color:#00C8E8;text-decoration:none}
.hero{max-width:720px;margin:0 auto;padding:80px 24px 60px;text-align:center}
.logo{display:inline-flex;align-items:center;gap:10px;margin-bottom:32px}
.logo-icon{width:40px;height:40px;border-radius:10px;background:#00C8E8;display:grid;place-items:center;color:#0A1628;font-weight:900;font-size:22px}
.logo-text{font-size:14px;letter-spacing:5px;font-weight:700;color:#7FA8C8}
h1{font-size:clamp(36px,6vw,56px);font-weight:800;letter-spacing:-1.5px;line-height:1.05;margin-bottom:16px}
h1 span{color:#00C8E8}
.sub{font-size:18px;color:#7FA8C8;line-height:1.5;max-width:520px;margin:0 auto 36px}
.cta{display:inline-flex;align-items:center;gap:8px;background:#00C8E8;color:#0A1628;font-weight:800;font-size:16px;padding:14px 32px;border-radius:12px;transition:transform .15s}
.cta:hover{transform:scale(1.03)}
.cta svg{width:20px;height:20px}
.features{max-width:720px;margin:0 auto;padding:0 24px 60px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
@media(max-width:600px){.features{grid-template-columns:1fr}}
.feat{background:#0F1E3A;border:1px solid #1A3A5A;border-radius:14px;padding:24px}
.feat-icon{font-size:28px;margin-bottom:10px}
.feat h3{font-size:15px;font-weight:700;margin-bottom:6px}
.feat p{font-size:13px;color:#7FA8C8;line-height:1.5}
.pricing{max-width:720px;margin:0 auto;padding:0 24px 60px;text-align:center}
.pricing h2{font-size:12px;letter-spacing:3px;color:#7FA8C8;text-transform:uppercase;margin-bottom:16px}
.price-card{background:#0F1E3A;border:1px solid #00C8E8;border-radius:16px;padding:32px;max-width:340px;margin:0 auto}
.price-amount{font-size:48px;font-weight:800;color:#00C8E8;font-variant-numeric:tabular-nums}
.price-period{font-size:14px;color:#7FA8C8;margin-top:4px}
.price-features{text-align:left;margin-top:20px;font-size:13px;color:#B5C8D8;line-height:2}
.price-features li{list-style:none;padding-left:20px;position:relative}
.price-features li::before{content:'✓';position:absolute;left:0;color:#00C8E8;font-weight:700}
.footer{border-top:1px solid #1A3A5A;padding:24px;text-align:center;font-size:12px;color:#5F7FA0}
.footer a{color:#7FA8C8}
</style>
</head><body>

<div class="hero">
  <div class="logo">
    <div class="logo-icon">B</div>
    <div class="logo-text">BLADES</div>
  </div>
  <h1>Your flight log,<br><span>digitised.</span></h1>
  <p class="sub">AI-powered logbook scanning, pilot CV export, certificate tracking — built for helicopter and fixed-wing pilots, operators, and drone pilots.</p>
  <a class="cta" href="https://apps.apple.com">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
    Download on the App Store
  </a>
</div>

<div class="features">
  <div class="feat">
    <div class="feat-icon">📸</div>
    <h3>AI Scan</h3>
    <p>Photograph your paper logbook — AI reads every row, resolves ditto marks, and validates times.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">📄</div>
    <h3>PDF Export</h3>
    <p>Three professional layouts — EASA, Modern, and Editorial — ready for job applications.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">🛡️</div>
    <h3>Certificates</h3>
    <p>Track ratings, medicals, and proficiency checks with expiry alerts and renewal reminders.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">📊</div>
    <h3>Stress Indicator</h3>
    <p>14-day workload gauge based on your flight hours — know when you're pushing limits.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">🔒</div>
    <h3>Offline First</h3>
    <p>All data stored locally on your device. No account needed. Works without internet.</p>
  </div>
  <div class="feat">
    <div class="feat-icon">🚁</div>
    <h3>Multi-role</h3>
    <p>Pilot, crew chief, swimmer, HEMS, loadmaster, drone — one app for everyone.</p>
  </div>
</div>

<div class="pricing">
  <h2>Pricing</h2>
  <div class="price-card">
    <div class="price-amount">49 kr</div>
    <div class="price-period">per month</div>
    <ul class="price-features">
      <li>12 AI logbook scans / month</li>
      <li>20 smart aircraft lookups</li>
      <li>PDF export (3 layouts)</li>
      <li>CSV import & custom export</li>
      <li>Global ICAO airport database</li>
      <li>1 free scan to try before you buy</li>
    </ul>
  </div>
</div>

<div class="footer">
  <p>© ${new Date().getFullYear()} Toreld Apps · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · <a href="mailto:support@blades-app.com">Support</a></p>
</div>

</body></html>`;
}

// ── Privacy Policy ────────────────────────────────────────────────────────

function privacyPage(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — BLADES</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0A1628;color:#C8D8E8;max-width:680px;margin:0 auto;padding:40px 24px;line-height:1.7;font-size:15px}
h1{color:#E6EDF3;font-size:28px;font-weight:800;margin-bottom:8px}
h2{color:#E6EDF3;font-size:18px;font-weight:700;margin:28px 0 8px}
p,ul{margin-bottom:12px}
ul{padding-left:20px}
a{color:#00C8E8}
.meta{color:#5F7FA0;font-size:13px;margin-bottom:24px}
</style>
</head><body>
<h1>Privacy Policy</h1>
<p class="meta">Blades — Pilot Logbook · Last updated: ${new Date().toISOString().slice(0, 10)}</p>

<p>This Privacy Policy explains how the Blades app ("Blades", "the app", "we") handles your information. Blades is a personal flight logbook. <strong>There are no user accounts, and your flight data is stored on your device — not on our servers.</strong></p>

<h2>1. Who is responsible (Data Controller)</h2>
<p>The controller for the processing described here is Jesper Toreld, Upplands Väsby, Sweden. Contact: <a href="mailto:support@blades-app.com">support@blades-app.com</a>.</p>

<h2>2. Data stored on your device</h2>
<p>Everything you enter or scan is stored locally in an <strong>AES-256 encrypted database (SQLCipher)</strong>, in addition to iOS's own device encryption. This includes your flights and drone flights (dates, times, routes/airports, aircraft/drone, roles, times, landings, approaches, remarks), your fleet, digital logbooks, certificates, your profile (name, initials, credentials and your signature drawing), settings, and any airports you add. We cannot see this data.</p>

<h2>3. Device permissions</h2>
<ul>
<li><strong>Camera</strong> — to photograph paper logbooks, cockpit instruments and aircraft/drones for AI extraction.</li>
<li><strong>Photo Library</strong> — to pick images for scanning, add fleet photos, and (optionally) match photos to your flights by time. Photo matching reads photo metadata (capture time and, where present, location) <em>on your device only</em>.</li>
<li><strong>Location</strong> — to find the closest airport, name temporary landing sites, compute magnetic variation and geotag entries. Used only while you use these features.</li>
</ul>
<p>You can grant or revoke each permission in iOS Settings at any time.</p>

<h2>4. Data sent off your device (and why)</h2>
<p>Some features transmit data to third parties over encrypted (HTTPS) connections:</p>
<ul>
<li><strong>AI features</strong> (logbook/instrument scanning, aircraft &amp; drone lookup, CSV column mapping, import analysis) — the image or text you submit is sent to <strong>Anthropic (Claude API)</strong> through our <strong>Cloudflare Workers</strong> proxy. Per Anthropic's API terms it is <strong>not used to train models</strong> and is not retained after processing. Our proxy does not store the content of your request.</li>
<li><strong>Usage telemetry</strong> (our Cloudflare proxy) — for each AI request we record a <em>hashed</em> device identifier (derived from Apple's identifier-for-vendor; not your Apple ID and not reversible to your identity), the country (from Cloudflare's network, not GPS), the AI model, response time, token counts, cost and status. We use this only to enforce fair-use quotas, prevent abuse and monitor cost/reliability, and to store your usage counters and any promo-code entitlement against that hashed identifier.</li>
<li><strong>iCloud Sync</strong> (optional) — if you enable it, an <strong>encrypted</strong> snapshot of your database and your app photos is stored in <strong>your own Apple iCloud account</strong> (Apple, not us) so you can back up and move between your devices.</li>
<li><strong>Weather</strong> — METAR/TAF are fetched from <strong>aviationweather.gov</strong> using airport codes (no personal data).</li>
<li><strong>Aircraft/drone images</strong> — retrieved from <strong>Wikipedia / Wikimedia Commons</strong> using the model name (no personal data).</li>
<li><strong>Maps &amp; place names</strong> — map tiles and geocoding via <strong>Apple Maps</strong>, <strong>OpenStreetMap / Nominatim</strong>, <strong>CARTO</strong> and <strong>Esri</strong>. Turning a coordinate into a place name is done by Apple; searching a place by text sends that text to OpenStreetMap.</li>
</ul>
<p>Blades contains <strong>no advertising, no ad tracking (no IDFA) and no third-party analytics SDKs.</strong></p>

<h2>5. Legal bases (GDPR)</h2>
<ul>
<li><strong>Performance of a contract</strong> — providing the features you actively use (e.g. AI scanning, sync).</li>
<li><strong>Legitimate interests</strong> — security, quota/abuse prevention, and keeping the service reliable and affordable (the pseudonymous telemetry above).</li>
<li><strong>Consent</strong> — optional device permissions (camera, photos, location) and iCloud Sync, which you can withdraw at any time in iOS Settings or in the app.</li>
</ul>

<h2>6. Sub-processors &amp; third parties</h2>
<ul>
<li><strong>Anthropic</strong> — AI processing. <a href="https://www.anthropic.com/legal/privacy">Privacy</a></li>
<li><strong>Cloudflare</strong> — proxy, hosting, telemetry. <a href="https://www.cloudflare.com/privacypolicy/">Privacy</a></li>
<li><strong>Apple</strong> — App Store, iCloud, Maps, geocoding. <a href="https://www.apple.com/legal/privacy/">Privacy</a></li>
<li><strong>aviationweather.gov</strong> (US NWS/FAA), <strong>Wikimedia Foundation</strong>, <strong>OpenStreetMap Foundation</strong>, <strong>CARTO</strong>, <strong>Esri</strong> — weather/imagery/map data.</li>
</ul>

<h2>7. International transfers</h2>
<p>Anthropic and Cloudflare process data in the United States. Transfers rely on the EU Standard Contractual Clauses and/or the EU–US Data Privacy Framework where applicable. The data transmitted is limited to what a feature requires (see §4).</p>

<h2>8. Retention</h2>
<ul>
<li><strong>Your data</strong> stays on your device until you delete it (Settings) or uninstall the app; iCloud snapshots remain in your iCloud until you delete them.</li>
<li><strong>Telemetry</strong> (hashed id, country, usage) is kept only as long as needed for the purposes in §4, then aggregated or deleted.</li>
<li><strong>Promo-code entitlement</strong> is kept until you uninstall or we revoke it.</li>
</ul>

<h2>9. Security</h2>
<p>Local data is encrypted at rest (AES-256 via SQLCipher) and protected by iOS data protection; all network traffic uses HTTPS/TLS. We hold no user accounts and no central copy of your flight data.</p>

<h2>10. Your rights</h2>
<p>Under the GDPR you may request access, rectification, erasure, restriction and portability, object to processing, and withdraw consent. Because your data lives on your device you can exercise most of these directly: <strong>export</strong> (CSV/PDF) and <strong>delete</strong> from Settings, and revoke permissions in iOS Settings. For the pseudonymous telemetry, contact us. You may also lodge a complaint with the Swedish Authority for Privacy Protection (<strong>IMY</strong>, imy.se).</p>

<h2>11. Children</h2>
<p>Blades is intended for pilots and is not directed at children under 13. We do not knowingly collect data from children under 13.</p>

<h2>12. Changes &amp; contact</h2>
<p>We may update this policy; changes are posted here with a new date. Questions or requests: <a href="mailto:support@blades-app.com">support@blades-app.com</a>.</p>

<p style="margin-top:32px;text-align:center"><a href="/">← Back to Blades</a></p>
</body></html>`;
}

// ── Terms of Service ──────────────────────────────────────────────────────

function termsPage(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service — BLADES</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0A1628;color:#C8D8E8;max-width:680px;margin:0 auto;padding:40px 24px;line-height:1.7;font-size:15px}
h1{color:#E6EDF3;font-size:28px;font-weight:800;margin-bottom:8px}
h2{color:#E6EDF3;font-size:18px;font-weight:700;margin:28px 0 8px}
p,ul{margin-bottom:12px}
ul{padding-left:20px}
a{color:#00C8E8}
.meta{color:#5F7FA0;font-size:13px;margin-bottom:24px}
</style>
</head><body>
<h1>Terms of Service</h1>
<p class="meta">Blades — Pilot Logbook · Last updated: ${new Date().toISOString().slice(0, 10)}</p>

<p>These Terms govern your use of the Blades app. By downloading or using Blades you agree to them. If you do not agree, do not use the app.</p>

<h2>1. Who we are</h2>
<p>Blades is provided by Jesper Toreld, Upplands Väsby, Sweden. Contact: <a href="mailto:support@blades-app.com">support@blades-app.com</a>.</p>

<h2>2. The service</h2>
<p>Blades is a digital flight logbook that helps you record, scan and export flight data. It is a <strong>tool</strong>: you are always responsible for the accuracy and completeness of your logbook and for meeting any regulatory requirements. Blades is not an official record and is not a substitute for any logbook your authority requires.</p>

<h2>3. AI features</h2>
<p>AI features (scanning, lookups, import mapping, summaries) are an aid and may be inaccurate. <strong>Always review AI results before saving.</strong> We do not guarantee the accuracy or availability of AI output.</p>

<h2>4. Free use, Premium &amp; purchases</h2>
<ul>
<li><strong>Free</strong> — manual logging and a limited amount of AI usage.</li>
<li><strong>Blades Premium</strong> — an <strong>auto-renewing subscription</strong> that unlocks the full AI allowance and premium features. The current price and billing period are shown in the App Store for your region.</li>
</ul>
<p>Purchases and subscriptions are billed and managed by <strong>Apple</strong>. A subscription renews automatically until cancelled; manage or cancel it any time in your Apple ID settings, where payment is charged to your Apple account. Apple's standard Licensed Application End User License Agreement also applies to your use of the app.</p>

<h2>5. Promo codes</h2>
<p>We may issue promo codes that grant Premium access at no charge (for example, to testers). Promo access is a revocable licence: it may be limited or withdrawn at any time, is tied to your device, and must not be sold or shared.</p>

<h2>6. Your data &amp; ownership</h2>
<p>You own the data you enter. We claim no rights to it and keep no central copy of it (see the Privacy Policy). You can export or delete it at any time.</p>

<h2>7. Acceptable use</h2>
<p>Do not reverse-engineer the app or its API, circumvent quotas or access controls, or use the service other than for your own personal flight logging.</p>

<h2>8. Disclaimers &amp; limitation of liability</h2>
<p>Blades is provided "as is" and "as available". To the extent permitted by law, we are not liable for errors in AI-generated data, loss of data due to device failure or your own actions, or any regulatory consequences of inaccurate logbook entries. <strong>Keep an independent backup of your official logbook.</strong> Nothing in these Terms limits liability that cannot be limited under applicable Swedish or EU law, or your mandatory statutory rights as a consumer.</p>

<h2>9. Changes, suspension &amp; termination</h2>
<p>We may update the app and these Terms, and may suspend the service in case of abuse. Your locally stored data remains yours regardless.</p>

<h2>10. Governing law</h2>
<p>These Terms are governed by Swedish law, without prejudice to the mandatory consumer protections of your country of residence in the EU. Disputes are subject to the Swedish courts; as a consumer you may also use the EU Online Dispute Resolution platform.</p>

<h2>11. App Store (Apple)</h2>
<p>Apple is not a party to these Terms and is not responsible for the app or its content; these Terms are between you and us. Maintenance, support and any warranty are our responsibility, not Apple's. Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you.</p>

<h2>12. Contact</h2>
<p>Questions? Email <a href="mailto:support@blades-app.com">support@blades-app.com</a></p>

<p style="margin-top:32px;text-align:center"><a href="/">← Back to Blades</a></p>
</body></html>`;
}

// ── Stats HTML ─────────────────────────────────────────────────────────────

function renderStats(ov: any, models: any[], countries: any[], devices: any[], daily: any[]): string {
  const totalReq = n(ov?.total_requests);
  const uniqueDev = n(ov?.unique_devices);
  const avgLat = n(ov?.avg_latency);
  const totalCost = n(ov?.total_cost_cents) / 100;
  const SEK_RATE = 10.5;
  const totalCostSek = totalCost * SEK_RATE;
  const inputTok = n(ov?.total_input_tokens);
  const outputTok = n(ov?.total_output_tokens);
  const errorRate = n(ov?.error_count) / Math.max(totalReq, 1) * 100;

  // Horisontella barcharts
  const maxReq = Math.max(1, ...models.map(r => n(r.requests)));
  const maxCountry = Math.max(1, ...countries.map(r => n(r.requests)));

  // Daglig sparkline (SVG)
  const dailyMax = Math.max(1, ...daily.map(d => n(d.requests)));
  const sparkW = 600, sparkH = 80;
  const sparkPoints = daily.map((d: any, i: number) => {
    const x = (i / Math.max(daily.length - 1, 1)) * sparkW;
    const y = sparkH - (n(d.requests) / dailyMax) * (sparkH - 10);
    return `${x},${y}`;
  }).join(' ');
  const sparkArea = sparkPoints + ` ${sparkW},${sparkH} 0,${sparkH}`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Toreld Apps — Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0D1117;color:#E6EDF3;padding:20px 24px;max-width:900px;margin:0 auto}
h1{font-size:22px;display:flex;align-items:center;gap:8px}
.sub{color:#8B949E;font-size:13px;margin:4px 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:24px}
.card{background:#161B22;border:1px solid #30363D;border-radius:10px;padding:14px}
.card .v{font-size:24px;font-weight:800;color:#00C8E8;font-family:Menlo,monospace}
.card .v.gold{color:#FFB830}
.card .v.green{color:#3FB950}
.card .v.red{color:#F85149}
.card .l{font-size:10px;color:#8B949E;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
h2{font-size:11px;color:#8B949E;text-transform:uppercase;letter-spacing:1.5px;margin:20px 0 10px}
.chart-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #21262D}
.chart-label{width:140px;font-size:12px;color:#E6EDF3;font-family:Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chart-bar-bg{flex:1;height:20px;background:#21262D;border-radius:4px;overflow:hidden}
.chart-bar{height:100%;background:linear-gradient(90deg,#00C8E8,#00C8E866);border-radius:4px;transition:width .3s}
.chart-val{width:60px;text-align:right;font-size:12px;color:#8B949E;font-family:Menlo,monospace}
.spark{background:#161B22;border:1px solid #30363D;border-radius:10px;padding:14px;margin-bottom:24px}
.spark svg{width:100%;height:80px}
.spark-labels{display:flex;justify-content:space-between;margin-top:6px}
.spark-labels span{font-size:10px;color:#8B949E}
table{width:100%;border-collapse:collapse;background:#161B22;border-radius:10px;overflow:hidden;margin-bottom:24px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262D;font-size:12px}
th{color:#8B949E;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
td{color:#E6EDF3;font-family:Menlo,monospace}
.foot{color:#8B949E;font-size:11px;text-align:center;margin-top:20px;padding:12px}
.foot a{color:#00C8E8}
.pill{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700}
.pill.ok{background:#3FB95022;color:#3FB950}
.pill.err{background:#F8514922;color:#F85149}
</style>
</head><body>

<h1>⚡ Toreld Apps</h1>
<p class="sub">Live telemetri från proxyn · auto-uppdateras inte — <a href="/stats" style="color:#00C8E8">ladda om</a></p>

<div class="cards">
  <div class="card"><div class="v">${totalReq}</div><div class="l">Requests</div></div>
  <div class="card"><div class="v">${uniqueDev}</div><div class="l">Enheter</div></div>
  <div class="card"><div class="v">${avgLat > 1000 ? (avgLat/1000).toFixed(1)+'s' : Math.round(avgLat)+'ms'}</div><div class="l">Snitt latens</div></div>
  <div class="card"><div class="v gold">$${totalCost.toFixed(2)} · ${totalCostSek.toFixed(0)} kr</div><div class="l">Total kostnad</div></div>
  <div class="card"><div class="v">${inputTok > 1000 ? (inputTok/1000).toFixed(0)+'k' : inputTok}</div><div class="l">Input tokens</div></div>
  <div class="card"><div class="v">${outputTok > 1000 ? (outputTok/1000).toFixed(0)+'k' : outputTok}</div><div class="l">Output tokens</div></div>
  <div class="card"><div class="v ${errorRate > 5 ? 'red' : 'green'}">${errorRate.toFixed(1)}%</div><div class="l">Felfrekvens</div></div>
</div>

${daily.length > 1 ? `
<h2>Requests senaste 7 dagarna</h2>
<div class="spark">
  <svg viewBox="0 0 ${sparkW} ${sparkH}">
    <polygon points="${sparkArea}" fill="#00C8E811" stroke="none"/>
    <polyline points="${sparkPoints}" fill="none" stroke="#00C8E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${daily.map((d: any, i: number) => {
      const x = (i / Math.max(daily.length - 1, 1)) * sparkW;
      const y = sparkH - (n(d.requests) / dailyMax) * (sparkH - 10);
      return `<circle cx="${x}" cy="${y}" r="3" fill="#00C8E8"/>`;
    }).join('')}
  </svg>
  <div class="spark-labels">
    ${daily.map((d: any) => `<span>${d.day?.slice(5) ?? ''}</span>`).join('')}
  </div>
</div>` : ''}

${models.length > 0 ? `
<h2>Per modell</h2>
${models.map(r => `<div class="chart-row">
  <div class="chart-label">${r.model ?? 'unknown'}</div>
  <div class="chart-bar-bg"><div class="chart-bar" style="width:${(n(r.requests)/maxReq*100)}%"></div></div>
  <div class="chart-val">${n(r.requests)} · $${(n(r.cost)/100).toFixed(2)} · ${(n(r.cost)/100*SEK_RATE).toFixed(0)}kr</div>
</div>`).join('')}` : ''}

${countries.length > 0 ? `
<h2>Per land</h2>
${countries.map(r => `<div class="chart-row">
  <div class="chart-label">${r.country ?? 'unknown'}</div>
  <div class="chart-bar-bg"><div class="chart-bar" style="width:${(n(r.requests)/maxCountry*100)}%"></div></div>
  <div class="chart-val">${n(r.requests)}</div>
</div>`).join('')}` : ''}

${devices.length > 0 ? `
<h2>Enheter (anonyma)</h2>
<table>
  <tr><th>Device</th><th>Requests</th><th>Status</th></tr>
  ${devices.map((r: any) => `<tr><td>${r.device ?? '—'}</td><td>${n(r.requests)}</td><td><span class="pill ok">aktiv</span></td></tr>`).join('')}
</table>` : ''}

<div class="foot">
  Toreld Apps · Cloudflare Workers · <a href="/stats/json">JSON-data</a>
</div>

</body></html>`;
}

// ── Incident news: RSS-hämtning + parsning + liten Haiku-strukturering ───────

interface RawFeedItem { source: string; title: string; link: string; date: string; snippet: string; }
interface NewsIncident { airport: string; icao: string | null; date: string; summary: string; link: string | null; source: string | null; }

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, d) => { try { return String.fromCharCode(parseInt(d, 10)); } catch { return ' '; } })
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

// Parsar RSS (<item>) och Atom (<entry>) → rårader. Regex-baserad (ingen XML-parser i Workers).
function parseFeed(xml: string, source: string): RawFeedItem[] {
  const out: RawFeedItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) ?? [];
  for (const b of blocks) {
    const title = pickTag(b, 'title');
    let link = pickTag(b, 'link');
    if (!link) { const lm = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (lm) link = lm[1]; } // Atom
    const date = pickTag(b, 'pubDate') || pickTag(b, 'published') || pickTag(b, 'updated') || pickTag(b, 'dc:date');
    const snippet = (pickTag(b, 'description') || pickTag(b, 'summary') || pickTag(b, 'content')).slice(0, 300);
    if (title) out.push({ source, title, link, date, snippet });
  }
  return out;
}

async function fetchAllFeeds(): Promise<RawFeedItem[]> {
  const results = await Promise.all(NEWS_FEEDS.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'BladesNewsBot/1.0 (+https://blades-app.com)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, cf: { cacheTtl: 1800 } as any });
      if (!r.ok) return [];
      return parseFeed(await r.text(), f.source);
    } catch { return []; }
  }));
  // Platta + behåll bara rader med rimligt färskt datum (senaste ~NEWS_WINDOW_DAYS+2 dygn).
  const cutoff = Date.now() - (NEWS_WINDOW_DAYS + 2) * 86400 * 1000;
  const flat = results.flat().filter((it) => {
    const t = Date.parse(it.date);
    return isNaN(t) ? true : t >= cutoff; // okänt datum → behåll, Haiku filtrerar
  });
  // Sortera nyast först (okänt datum sist) så kapningen till 40 behåller de FÄRSKASTE raderna över
  // alla källor — viktigt med ett bredare fönster. Token-mängden växer inte (fortfarande max 40).
  flat.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return flat.slice(0, 40);
}

// EN liten Haiku-pass (ingen web search): rårader → strukturerade airport-kopplade incidenter.
async function structureIncidents(items: RawFeedItem[], env: Env): Promise<NewsIncident[]> {
  if (!items.length || !env.ANTHROPIC_API_KEY) return [];
  const today = new Date().toISOString().slice(0, 10);
  const system = `You turn aviation news headlines into a structured list of AIRPORT-LINKED flight incidents for a pilot app. Today is ${today}. Keep ONLY genuine flight incidents/accidents (civil or military) from the last ${NEWS_WINDOW_DAYS} days that happened at, or are clearly tied to, a specific named airport or airfield (takeoff, landing, runway excursion, ground/apron, go-around, emergency diversion, military airbase mishap). Drop opinion pieces, product news, route/airline-business stories, and en-route events with no airport link. Be factual and concise.`;
  const user = `Here are recent aviation news items (JSON). Return ONLY a JSON object, no prose:
{"incidents":[{"airport":"<common airport name>","icao":"<4-letter ICAO or null>","date":"<YYYY-MM-DD>","summary":"<1-2 sentence factual summary>","link":"<the item's url>","source":"<the item's source>"}]}
Rules: most recent first; up to 15 items; "icao" is the real 4-letter ICAO when identifiable (e.g. KLAX, EGLL), else null; copy "link" and "source" from the matching input item; if nothing qualifies return {"incidents":[]}.

Items:
${JSON.stringify(items)}`;

  const { resp, used } = await callWithModelFallback(JSON.stringify({
    model: NEWS_MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
  }), { apiKey: env.ANTHROPIC_API_KEY, kv: env.QUOTA_KV, log: (m) => console.log(m) });
  if (!resp.ok) throw new Error(`news_haiku_${resp.status}`);
  const data = await resp.json() as any;
  const inTok = data.usage?.input_tokens ?? 0, outTok = data.usage?.output_tokens ?? 0;
  if (env.TELEMETRY) {
    env.TELEMETRY.writeDataPoint({
      blobs: [used, 'news_cron', '??', resp.status === 200 ? 'ok' : `error_${resp.status}`],
      doubles: [0, inTok, outTok, costUsd(used, inTok, outTok)],
      indexes: ['news_cron'],
    });
  }
  const text = (Array.isArray(data.content) ? data.content : []).filter((c: any) => c.type === 'text').map((c: any) => c.text ?? '').join('\n');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as { incidents?: NewsIncident[] };
  return Array.isArray(parsed.incidents) ? parsed.incidents.slice(0, 15) : [];
}

// Hämtar färsk lista (RSS + Haiku) och skriver till den globala cachen.
async function refreshIncidentNews(env: Env): Promise<NewsIncident[]> {
  const items = await fetchAllFeeds();
  const incidents = await structureIncidents(items, env);
  const payload = JSON.stringify({ incidents, cached_at: Date.now() });
  if (env.QUOTA_KV) { try { await env.QUOTA_KV.put(NEWS_CACHE_KEY, payload, { expirationTtl: NEWS_CACHE_TTL_SEC + 120 }); } catch {} }
  return incidents;
}

// ── Satellitbilder till share-kortet (Esri World Imagery via ArcGIS Location Platform) ──────────
// Appen hämtar 256-px-tiles HÄRIFRÅN och proxyn lägger på API-nyckeln (secret ARCGIS_API_KEY) → nyckeln
// finns aldrig i appen och kan roteras utan app-uppdatering (Esris API-nycklar löper ut efter max 1 år).
// Esri ser bara vår server, inte användarens IP. Tiles LAGRAS INTE här — Esris villkor tillåter inte att
// data skrapas, laddas ner eller lagras — de skickas bara vidare (ingen edge-cache).
const ESRI_IMAGERY_TILE = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile';
const ESRI_IMAGERY_ATTRIBUTION = 'https://static.arcgis.com/attribution/World_Imagery';
const MAP_TILE_MAX_ZOOM = 16;   // share-kortet använder z9–14; taket stoppar skrapning av detaljnivåer
const NO_EDGE_CACHE = { cacheTtlByStatus: { '100-599': -1 } }; // negativ TTL = Cloudflare cachar inte alls

// Dynamisk källhänvisning: Esri kräver att ALLA bildleverantörer för det visade området anges (t.ex.
// "New York State", "GDI Berlin", "Vantor") — de varierar med plats och zoom. Esris lista är ~0,5 MB och
// för tung att tolka per anrop → en kompakt tabell [namn, zMin, zMax, score, minLat, minLon, maxLat,
// maxLon] (bara zoomnivåer vi använder) byggs högst en gång i veckan och sparas i KV. Metadata, inte bilddata.
type AttrRow = [string, number, number, number, number, number, number, number];
const ATTR_KV_KEY = 'esri:imagery-attribution:v1';
const ATTR_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
let attrMemo: { at: number; rows: AttrRow[] } | null = null;
let attrRefreshAt = 0; // senaste ombyggnadsförsök i detta isolat (max ett försök per 5 min)

// Tabellen ur isolatets minne eller KV. stale = äldre än en vecka → används ändå medan den byggs om.
async function loadImageryAttribution(env: Env): Promise<{ rows: AttrRow[]; stale: boolean } | null> {
  const fresh = (m: typeof attrMemo) => !!m && Date.now() - m.at < ATTR_MAX_AGE_MS;
  if (!fresh(attrMemo) && env.QUOTA_KV) {
    try {
      const raw = await env.QUOTA_KV.get(ATTR_KV_KEY);
      if (raw) {
        const kv = JSON.parse(raw) as { at: number; rows: AttrRow[] };
        if (!attrMemo || kv.at > attrMemo.at) attrMemo = kv;
      }
    } catch { /* trasig cache → bygg om */ }
  }
  return attrMemo ? { rows: attrMemo.rows, stale: !fresh(attrMemo) } : null;
}

// Hämtar Esris fullständiga lista och bygger om den kompakta tabellen. Körs i bakgrunden (waitUntil).
async function refreshImageryAttribution(env: Env): Promise<void> {
  const r = await fetch(ESRI_IMAGERY_ATTRIBUTION);
  if (!r.ok) return;
  const j = JSON.parse((await r.text()).replace(/^﻿/, '')) as {
    contributors?: { attribution: string; coverageAreas?: { zoomMin: number; zoomMax: number; score: number; bbox: number[] }[] }[];
  };
  const rows: AttrRow[] = [];
  for (const c of j.contributors ?? []) {
    for (const a of c.coverageAreas ?? []) {
      if (a.zoomMin > MAP_TILE_MAX_ZOOM || a.bbox?.length !== 4) continue;
      rows.push([c.attribution, a.zoomMin, a.zoomMax, a.score, a.bbox[0], a.bbox[1], a.bbox[2], a.bbox[3]]);
    }
  }
  if (!rows.length) return;
  attrMemo = { at: Date.now(), rows };
  if (env.QUOTA_KV) await env.QUOTA_KV.put(ATTR_KV_KEY, JSON.stringify(attrMemo));
}

// Leverantörer som täcker någon av rutorna (s, w, n, e, z), högst score först, utan dubbletter.
function imageryProviders(rows: AttrRow[], boxes: number[][]): string[] {
  const best = new Map<string, number>();
  for (const [name, zMin, zMax, score, minLat, minLon, maxLat, maxLon] of rows) {
    for (const [s, w, n, e, z] of boxes) {
      if (z < zMin || z > zMax || n < minLat || s > maxLat || e < minLon || w > maxLon) continue;
      if ((best.get(name) ?? -1) < score) best.set(name, score);
    }
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

// ── Huvudlogik ─────────────────────────────────────────────────────────────

export default {
  // Daglig modellkontroll (cron i wrangler.toml): pekar om modeller som försvunnit hos Anthropic i förväg.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.ANTHROPIC_API_KEY) return;
    ctx.waitUntil(refreshModelRouting(
      { apiKey: env.ANTHROPIC_API_KEY, kv: env.QUOTA_KV, log: (m) => console.log(m) },
      [...APP_MODELS, NEWS_MODEL],
    ).then((routing) => console.log('[model-check]', JSON.stringify(routing))).catch((e) => console.log('[model-check] failed', e?.message)));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // ── Stats (lösenordsskyddad) ──
    if (url.pathname === '/stats' || url.pathname === '/stats/json') {
      const key = url.searchParams.get('key');
      if (!key || key !== env.STATS_PASSWORD) {
        return new Response(loginPage(), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
        return new Response('Stats ej konfigurerat. Sätt CF_API_TOKEN och CF_ACCOUNT_ID.', { status: 500 });
      }
      const ds = 'blades-telemetry';
      const [overview, byModel, byCountry, byDevice, daily] = await Promise.all([
        queryAE(env, `SELECT
          SUM(_sample_interval) as total_requests,
          COUNT(DISTINCT blob2) as unique_devices,
          AVG(double1) as avg_latency,
          SUM(double2) as total_input_tokens,
          SUM(double3) as total_output_tokens,
          SUM(double4) as total_cost_cents,
          SUM(IF(blob4 != 'ok', _sample_interval, 0)) as error_count
          FROM ${ds}`),
        queryAE(env, `SELECT blob1 as model, SUM(_sample_interval) as requests, AVG(double1) as avg_latency, SUM(double4) as cost FROM ${ds} GROUP BY blob1 ORDER BY requests DESC LIMIT 10`),
        queryAE(env, `SELECT blob3 as country, SUM(_sample_interval) as requests FROM ${ds} GROUP BY blob3 ORDER BY requests DESC LIMIT 10`),
        queryAE(env, `SELECT blob2 as device, SUM(_sample_interval) as requests FROM ${ds} GROUP BY blob2 ORDER BY requests DESC LIMIT 20`),
        queryAE(env, `SELECT toDate(timestamp) as day, SUM(_sample_interval) as requests FROM ${ds} WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY day ORDER BY day`),
      ]);

      const ov = overview?.data?.[0] ?? {};
      if (url.pathname === '/stats/json') {
        return new Response(JSON.stringify({ overview: ov, byModel: byModel?.data, byCountry: byCountry?.data, byDevice: byDevice?.data, daily: daily?.data }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        renderStats(ov, byModel?.data ?? [], byCountry?.data ?? [], byDevice?.data ?? [], daily?.data ?? []),
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    // ── Root: ingen landningssida/marknadsföring på API-domänen. Browser får bara 404. ──
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }

    // ── Privacy/Terms hör hemma på website:n, inte API-domänen → redirecta dit. ──
    if (url.pathname === '/privacy' || url.pathname === '/privacy.html') {
      return Response.redirect('https://blades-app.com/privacy', 301);
    }
    if (url.pathname === '/terms' || url.pathname === '/terms.html') {
      return Response.redirect('https://blades-app.com/terms', 301);
    }

    // ── Satellit-tile till share-kortet: GET /map/imagery/{z}/{y}/{x} (Esri World Imagery) ──
    const tileM = url.pathname.match(/^\/map\/imagery\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})$/);
    if (tileM && request.method === 'GET') {
      const z = +tileM[1], y = +tileM[2], x = +tileM[3], n = 2 ** z;
      if (z < 1 || z > MAP_TILE_MAX_ZOOM || x >= n || y >= n) return new Response('Bad tile', { status: 400 });
      if (!env.ARCGIS_API_KEY) return new Response('Map imagery not configured', { status: 503 });
      // Bara appen (skickar X-Device-ID) → en <img>-hotlänk från en webbsida kan inte bränna Esri-kvoten.
      // Rate limit per enhet: ett share-kort behöver ≤ 18 tiles per zoomnivå.
      const devId = request.headers.get('X-Device-ID');
      if (!devId) return new Response('Forbidden', { status: 403 });
      if (env.MAP_LIMITER) {
        const { success } = await env.MAP_LIMITER.limit({ key: `tile:${await hashDevice(devId)}` });
        if (!success) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } });
      }
      try {
        const upstream = await fetch(`${ESRI_IMAGERY_TILE}/${z}/${y}/${x}?token=${encodeURIComponent(env.ARCGIS_API_KEY)}`, { cf: NO_EDGE_CACHE } as RequestInit);
        const ct = upstream.headers.get('Content-Type') ?? '';
        // Esri svarar 200 + JSON vid nyckelfel → släpp bara igenom riktiga bilder.
        if (!upstream.ok || !ct.startsWith('image/')) {
          return new Response('Tile unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
        }
        // Appens bildcache får hålla tilen lika länge som Esris egen max-age (1 dygn).
        return new Response(upstream.body, { headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=86400' } });
      } catch {
        return new Response('Tile unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
    }

    // ── Källhänvisning för satellitbilderna: GET /map/imagery/attribution?b=s,w,n,e,z[&b=…] ──
    // → { providers: [...] } för de visade rutorna, eller providers: null medan tabellen byggs (appen visar
    // då Esris generella källtext). Ombyggnaden körs i bakgrunden → svaret väntar aldrig på den.
    if (url.pathname === '/map/imagery/attribution' && request.method === 'GET') {
      const boxes = url.searchParams.getAll('b').slice(0, 4)
        .map((b) => b.split(',').map(Number))
        .filter((b) => b.length === 5 && b.every((v) => Number.isFinite(v)));
      const attr = await loadImageryAttribution(env);
      if ((!attr || attr.stale) && Date.now() - attrRefreshAt > 5 * 60 * 1000) {
        attrRefreshAt = Date.now();
        ctx.waitUntil(refreshImageryAttribution(env).catch(() => {}));
      }
      const providers = attr && boxes.length ? imageryProviders(attr.rows, boxes) : null;
      return new Response(JSON.stringify({ providers }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': providers ? 'private, max-age=86400' : 'no-store' },
      });
    }

    // ── Token-saldo: månadens AI-förbrukning för denna device (Settings-mätaren) ──
    if (url.pathname === '/tokens' && request.method === 'GET') {
      const devId = request.headers.get('X-Device-ID') ?? 'unknown';
      const dk = await deviceKeys(devId);
      const tier = await resolveTier(devId, env); // server-sanning (promo/RevenueCat), inte headern
      const limit = TOKEN_LIMITS[tier] ?? TOKEN_LIMITS.free;
      const used = env.QUOTA_KV
        ? parseInt(await kvGetMigrating(env.QUOTA_KV, tokenKey(dk.hash, tier), tokenKey(dk.legacy, tier), tokenTtl(tier)) ?? '0', 10)
        : 0;
      const premium = tier === 'premium';
      const period = tier === 'free' ? 'lifetime' : currentMonth();
      return new Response(JSON.stringify({ used, limit, month: period, enforced: TOKEN_QUOTAS_ENABLED, premium }), {
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // ── Version / app news endpoint ──
    if (url.pathname === '/version') {
      const versionData = {
        min_version: '1.0.0',
        latest_version: '1.0.0',
        force_update: false,
        news: null,
      };
      return new Response(JSON.stringify(versionData), {
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
      });
    }

    // ── Incident news: server-cachad lista (gratis RSS + liten Haiku, 1h delad cache) ──
    // Premium-only (produktval). Nästan gratis: RSS+Haiku körs max 1 gång/timme för alla ihop.
    if (url.pathname === '/incident-news' && request.method === 'GET') {
      const devId = request.headers.get('X-Device-ID') ?? 'unknown';
      if ((await resolveTier(devId, env)) !== 'premium') {
        return new Response(JSON.stringify({ error: 'premium_required', message: 'Incident news is a Premium feature.' }), {
          status: 403, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        });
      }
      // 1) Färsk cache → returnera direkt (noll kostnad).
      let cached: { incidents?: NewsIncident[]; cached_at?: number } | null = null;
      if (env.QUOTA_KV) { try { const raw = await env.QUOTA_KV.get(NEWS_CACHE_KEY); if (raw) cached = JSON.parse(raw); } catch {} }
      const fresh = cached?.cached_at && (Date.now() - cached.cached_at) < NEWS_CACHE_TTL_SEC * 1000;
      if (cached && fresh) {
        return new Response(JSON.stringify({ incidents: cached.incidents ?? [], cached_at: cached.cached_at }), {
          headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
        });
      }
      // 2) Ingen färsk cache → bygg ny (RSS + Haiku). Vid fel: fall tillbaka på ev. gammal cache.
      try {
        const incidents = await refreshIncidentNews(env);
        return new Response(JSON.stringify({ incidents, cached_at: Date.now() }), {
          headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
        });
      } catch (e: any) {
        if (cached) {
          return new Response(JSON.stringify({ incidents: cached.incidents ?? [], cached_at: cached.cached_at, stale: true }), {
            headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'news_unavailable', message: 'Could not load incidents right now.' }), {
          status: 502, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Entitlement: har denna device Premium (promo-kod ELLER RevenueCat)? ──
    // promo skickas separat så appen bara cachar en riktig promokod lokalt (en prenumeration sköts av
    // RevenueCat-SDK:n och får inte ligga kvar som "promo" efter att den gått ut).
    if (url.pathname === '/entitlement' && request.method === 'GET') {
      const devId = request.headers.get('X-Device-ID') ?? 'unknown';
      const premium = (await resolveTier(devId, env)) === 'premium';
      const promo = premium && await promoActive(env.QUOTA_KV, await deviceKeys(devId));
      return new Response(JSON.stringify({ premium, promo }), {
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // ── Lös in promo-kod → permanent gratis Blades Premium för denna device ──
    // Giltiga koder ligger BARA i servern (env.PROMO_CODES, kommaseparerat). Bindningen (promo:<device>)
    // sparas i KV utan TTL → kontrolleras vid varje /entitlement- och /tokens-anrop. Revocera = ta bort KV-nyckeln.
    if (url.pathname === '/redeem' && request.method === 'POST') {
      const dk = await deviceKeys(request.headers.get('X-Device-ID') ?? 'unknown');
      let code = '';
      try { code = String((JSON.parse(await request.text()) as any)?.code ?? ''); } catch { /* ogiltig body */ }
      const norm = code.trim().toUpperCase();
      const valid = norm.length > 0 && (env.PROMO_CODES ?? '')
        .split(',').map((c) => c.trim().toUpperCase()).filter(Boolean).includes(norm);
      if (!valid) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 400, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        });
      }
      if (env.QUOTA_KV) await env.QUOTA_KV.put(`promo:${dk.hash}`, '1'); // permanent (ingen TTL)
      return new Response(JSON.stringify({ ok: true, premium: true }), {
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // ── RevenueCat-webhook: uppdatera premium-cachen direkt vid köp/förnyelse/uppsägning ──
    // Konfigureras i RevenueCat → Integrations → Webhooks (URL hit, Authorization = REVENUECAT_WEBHOOK_AUTH).
    if (url.pathname === '/revenuecat-webhook' && request.method === 'POST') {
      if (env.REVENUECAT_WEBHOOK_AUTH && request.headers.get('Authorization') !== env.REVENUECAT_WEBHOOK_AUTH) {
        return new Response('unauthorized', { status: 401 });
      }
      let appUserId = '';
      try { appUserId = String(((JSON.parse(await request.text()) as any)?.event?.app_user_id) ?? ''); } catch { /* ogiltig body */ }
      if (appUserId && env.QUOTA_KV) {
        const active = await rcActive(appUserId, env);
        await env.QUOTA_KV.put(await premiumKey(appUserId), active ? '1' : '0', { expirationTtl: active ? PREMIUM_TTL_POS : PREMIUM_TTL_NEG });
      }
      return new Response('ok');
    }

    // ── CORS ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    // ── App-autentisering (valfri, VILANDE tills APP_KEY-secret är satt) ──
    // När du sätter `APP_KEY` som wrangler-secret krävs att appen skickar samma värde i X-App-Key,
    // annars 401. Blockerar curl/skript som inte känner till nyckeln. Sätt INTE secreten förrän en
    // app-build som skickar headern är ute, annars slutar AI-funktionerna funka i nuvarande build.
    if (env.APP_KEY && request.headers.get('X-App-Key') !== env.APP_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key missing' }), {
        status: 500, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    // ── Proxy ──
    const deviceId = request.headers.get('X-Device-ID') ?? 'unknown';
    const dk = await deviceKeys(deviceId);
    const deviceHash = dk.hash;
    const country = (request as any).cf?.country ?? '??';

    try {
      const body = await request.text();
      let model = 'unknown';
      try { model = JSON.parse(body).model ?? 'unknown'; } catch {}

      // ── Server-side tier: promo ELLER RevenueCat (aldrig klient-headern) ──
      const tierHeader = await resolveTier(deviceId, env);

      // (Incident news hanteras numera av den cachade GET /incident-news — ingen web search här.)

      // ── Token-tak (enda aktiva spärren) — CSV-import/flight-scan/lookup är token-låsta ──
      if (TOKEN_QUOTAS_ENABLED && env.QUOTA_KV) {
        const tLimit = TOKEN_LIMITS[tierHeader] ?? TOKEN_LIMITS.free;
        const tUsed = parseInt(await kvGetMigrating(env.QUOTA_KV, tokenKey(dk.hash, tierHeader), tokenKey(dk.legacy, tierHeader), tokenTtl(tierHeader)) ?? '0', 10);
        if (tUsed >= tLimit) {
          return new Response(JSON.stringify({
            error: 'token_quota_exceeded',
            used: tUsed,
            limit: tLimit,
            message: `Monthly AI token quota exceeded (${tUsed}/${tLimit})`,
          }), {
            status: 429, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
          });
        }
      }

      const t0 = Date.now();
      // Modellfallback: försvunnen modell → nästa i familjen; nyare modeller utan temperature (modelFallback.ts).
      const fb = await callWithModelFallback(body, { apiKey: env.ANTHROPIC_API_KEY, kv: env.QUOTA_KV, log: (m) => console.log(m) });
      const resp = fb.resp;
      if (fb.used) model = fb.used; // telemetrin visar modellen som faktiskt svarade
      if (fb.fellBack && env.TELEMETRY) {
        env.TELEMETRY.writeDataPoint({
          blobs: [`${fb.requested}→${fb.used}`, deviceHash, country, 'model_fallback'],
          doubles: [0, 0, 0, 0],
          indexes: [deviceHash],
        });
      }

      // ── SSE-passthrough för streamande anrop ────────────────────────────────
      // Appens live-tokenräknare kräver att deltan når klienten löpande — buffra
      // INTE svaret. Telemetrin läser en tee:ad kopia i bakgrunden (waitUntil).
      let wantsStream = false;
      try { wantsStream = JSON.parse(body).stream === true; } catch {}
      if (wantsStream && resp.ok && resp.body) {
        const [toClient, toTelemetry] = resp.body.tee();
        ctx.waitUntil((async () => {
          try {
            const text = await new Response(toTelemetry).text();
            const ms = Date.now() - t0;
            // message_start bär input_tokens; sista message_delta bär slutgiltiga output_tokens
            const mIn = text.match(/"input_tokens":\s*(\d+)/);
            const mOutAll = [...text.matchAll(/"output_tokens":\s*(\d+)/g)];
            const inTok = mIn ? parseInt(mIn[1], 10) : 0;
            const outTok = mOutAll.length ? parseInt(mOutAll[mOutAll.length - 1][1], 10) : 0;
            const cost = costUsd(model, inTok, outTok);
            if (env.TELEMETRY) {
              env.TELEMETRY.writeDataPoint({
                blobs: [model, deviceHash, country, 'ok'],
                doubles: [ms, inTok, outTok, cost],
                indexes: [deviceHash],
              });
            }
            await addTokens(env.QUOTA_KV, dk, tierHeader, inTok + outTok);
          } catch {}
        })());
        return new Response(toClient, {
          status: resp.status,
          headers: {
            ...corsHeaders(origin),
            'Content-Type': resp.headers.get('Content-Type') ?? 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });
      }

      const respBody = await resp.text();
      const ms = Date.now() - t0;
      let inTok = 0, outTok = 0;
      try { const j = JSON.parse(respBody); inTok = j.usage?.input_tokens ?? 0; outTok = j.usage?.output_tokens ?? 0; } catch {}
      const cost = costUsd(model, inTok, outTok);

      if (env.TELEMETRY) {
        env.TELEMETRY.writeDataPoint({
          blobs: [model, deviceHash, country, resp.status === 200 ? 'ok' : `error_${resp.status}`],
          doubles: [ms, inTok, outTok, cost],
          indexes: [deviceHash],
        });
      }
      // Token-räkning i bakgrunden — blockerar inte svaret till appen.
      ctx.waitUntil(addTokens(env.QUOTA_KV, dk, tierHeader, inTok + outTok));

      return new Response(respBody, {
        status: resp.status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      if (env.TELEMETRY) {
        env.TELEMETRY.writeDataPoint({
          blobs: ['unknown', deviceHash, country, 'proxy_error'],
          doubles: [0, 0, 0, 0],
          indexes: [deviceHash],
        });
      }
      return new Response(JSON.stringify({ error: 'Proxy error', message: err.message }), {
        status: 502, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }
  },
};
