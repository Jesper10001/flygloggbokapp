// Blades Ops — mobil driftsida på /ops: live-siffror och 30-dagarsgrafer för App Store Connect, RevenueCat,
// Sentry, Cloudflare, AI-telemetrin och supportmejlen, larm som räknas fram ur dem, och en uppgiftsinkorg
// till Claude. Nycklarna stannar i Workerns secrets; sidan får bara sammanställda tal.
//  • Inloggning: OPS_PASSWORD → HMAC-signerad cookie (OPS_COOKIE_SECRET) i 180 dagar. Utan dem: 503.
//  • Bevakning: cron varje timme (runOpsMonitor) → mejl via send_email-bindningen när något NYTT kräver dig.
//  • Supportmejl: Email Routing skickar support@ till email()-hanteraren → vidarebefordras + räknas
//    (bara antal och tid, inget innehåll, ingen avsändare).
//  • Uppgifter: du skriver dem på sidan; Claude läser /ops/inbox med CLAUDE_TASKS_TOKEN (SessionStart-hook
//    i repot: scripts/ops-inbox.sh) och bockar av med en notering.
//  • Gratisplanen: KV tillåter 1 000 skrivningar per dygn för hela kontot och appens AI-kvoter delar på dem,
//    så historiken skrivs bara när något faktiskt ändrats.
import { EmailMessage } from 'cloudflare:email';
import { ICON_180, ICON_192 } from './opsIcons';

export interface OpsEnv {
  QUOTA_KV: KVNamespace;
  CF_API_TOKEN?: string;           // Analytics Engine (AI-telemetrin) — samma som /stats
  CF_ACCOUNT_ID?: string;
  OPS_PASSWORD?: string;           // inloggning till /ops (secret)
  OPS_COOKIE_SECRET?: string;      // signerar sessionscookien (secret, slumpad)
  SENTRY_API_TOKEN?: string;       // intern integration med läsrättigheter (secret)
  SENTRY_ORG?: string;
  SENTRY_PROJECT?: string;
  SENTRY_PROJECT_ID?: string;
  REVENUECAT_METRICS_KEY?: string; // v2-nyckel med "Charts metrics: Read" (secret)
  REVENUECAT_SECRET_KEY?: string;  // reserv om metrics-nyckeln saknas
  REVENUECAT_PROJECT_ID?: string;
  ASC_ISSUER_ID?: string;          // App Store Connect API (secrets)
  ASC_KEY_ID?: string;
  ASC_PRIVATE_KEY?: string;        // innehållet i AuthKey_….p8
  ASC_VENDOR_NUMBER?: string;      // för nedladdningar (försäljningsrapporter)
  ASC_APP_ID?: string;
  CF_ANALYTICS_TOKEN?: string;     // Account Analytics + Zone Analytics: Read (secret)
  CF_ZONE_ID?: string;             // zonen blades-app.com
  OPS_CREDIT_USD?: string;         // Anthropic-kredit vid OPS_CREDIT_SINCE → uppskattat saldo
  OPS_CREDIT_SINCE?: string;
  SUPPORT_FORWARD_TO?: string;     // verifierad mottagaradress i Email Routing (secret)
  CLAUDE_TASKS_TOKEN?: string;     // Claudes nyckel till uppgiftsinkorgen (secret, samma som ~/.config/blades-ops/token)
  ALERT_MAIL?: { send(message: any): Promise<void> }; // send_email-bindning (wrangler.toml)
  OPS_ALERT_TO?: string;           // larmmejlens mottagare om inte SUPPORT_FORWARD_TO; måste vara verifierad
  OPS_ALERTS?: string;             // "off" stänger av larmmejlen
}

/** Bevakningens cron. Måste också stå i [triggers] crons i wrangler.toml. */
export const OPS_MONITOR_CRON = '7 * * * *';

const COOKIE = 'blades_ops';
const SESSION_DAYS = 180;
const CACHE_KEY = 'ops:cache:v2';
const CACHE_MS = 10 * 60 * 1000;
const DAYS = 30;
const OPS_URL = 'https://api.blades-app.com/ops';
// Workers Free per dygn (UTC). Larm vid 70 %: då är det dags för Workers Paid ($5/mån).
const FREE_LIMITS = { workerRequests: 100_000, kvWrites: 1_000 };
// Sidorna App Review och användarna klickar på (appen länkar till privacy.html och terms).
const SITE_PAGES = ['/', '/privacy.html', '/terms.html', '/support.html'];
const SENSORS: [string, string][] = [['appStore', 'App Store'], ['revenue', 'RevenueCat'], ['stability', 'Sentry'], ['traffic', 'Cloudflare'], ['ai', 'AI-telemetrin']];
const enc = new TextEncoder();

// Datum att bevaka (samma som kontrollrummet). Larm 30 dagar innan.
const DEADLINES = [
  { date: '2027-01-24', text: 'Gamla Esri-nyckeln går ut – ta bort den i ArcGIS', href: 'https://developers.arcgis.com/' },
  { date: '2027-05-14', text: 'Paid Apps-avtalet löper ut – förnya i App Store Connect', href: 'https://appstoreconnect.apple.com/business' },
  { date: '2027-10-26', text: 'Esri-nyckeln går ut (cirka) – skapa en ny och kör wrangler secret put ARCGIS_API_KEY', href: 'https://developers.arcgis.com/' },
];

// ── Hjälpare ─────────────────────────────────────────────────────────────────

class NotConfigured extends Error {
  constructor(what: string) { super(`Inte kopplat än (${what} saknas)`); }
}

type Point = { d: string; v: number | null };
type Settled<T> = { ok: true; data: T } | { ok: false; error: string; notConfigured?: boolean };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** De senaste n dagarna (UTC), äldst först, inklusive i dag. */
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => isoDay(Date.now() - (n - 1 - i) * 86400000));
const num = (v: any) => (v == null || v === '' ? 0 : Number(v) || 0);
const sameJson = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; json: any; headers: Headers }> {
  const r = await fetch(url, init);
  let json: any = null;
  try { json = await r.json(); } catch { /* inget JSON-svar */ }
  return { status: r.status, json, headers: r.headers };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Tog för lång tid att svara')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Kör en insamlare och fångar fel. Felet visas på sensorns kort. */
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, data: await withTimeout(p, 20000) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200), notConfigured: e instanceof NotConfigured };
  }
}

async function aeQuery(env: OpsEnv, sql: string): Promise<any[]> {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: sql,
  });
  if (!r.ok) throw new Error(`Analytics Engine svarade ${r.status}`);
  const j: any = await r.json();
  return Array.isArray(j?.data) ? j.data : [];
}

// Telemetrins dataset heter som bindningen (TELEMETRY) eftersom wrangler.toml aldrig angett något namn.
// Äldre kod frågade "blades-telemetry" → slå upp vilket som finns, en gång per Worker-instans.
let aeDatasetMemo: string | null = null;
export async function resolveAeDataset(env: OpsEnv): Promise<string> {
  if (aeDatasetMemo) return aeDatasetMemo;
  try {
    const rows = await aeQuery(env, 'SHOW TABLES');
    const names = rows.map((r: any) => String(r.dataset ?? r.name ?? Object.values(r ?? {})[0] ?? ''));
    aeDatasetMemo = names.includes('TELEMETRY') ? 'TELEMETRY' : names.find((n: string) => /telemetry/i.test(n)) ?? 'TELEMETRY';
  } catch {
    return 'TELEMETRY'; // försök igen nästa gång
  }
  return aeDatasetMemo;
}

// ── Historik: en JSON-karta dag → värde per serie i KV (120 dagar) ───────────

async function readSeries(env: OpsEnv, name: string): Promise<Record<string, any>> {
  try { return JSON.parse((await env.QUOTA_KV.get(`ops:series:${name}`)) ?? '{}') ?? {}; } catch { return {}; }
}

async function writeSeries(env: OpsEnv, name: string, map: Record<string, any>): Promise<void> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(map).sort().slice(-120)) out[k] = map[k];
  try { await env.QUOTA_KV.put(`ops:series:${name}`, JSON.stringify(out)); } catch { /* historiken är valfri */ }
}

const points = (days: string[], pick: (day: string) => number | null | undefined): Point[] =>
  days.map((d) => { const v = pick(d); return { d, v: v == null || Number.isNaN(v) ? null : v }; });

// ── Inloggning ───────────────────────────────────────────────────────────────

async function makeSession(env: OpsEnv): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${await hmacHex(env.OPS_COOKIE_SECRET!, `ops:${exp}`)}`;
}

async function validSession(request: Request, env: OpsEnv): Promise<boolean> {
  const m = (request.headers.get('Cookie') ?? '').match(/(?:^|;\s*)blades_ops=([0-9]+)\.([0-9a-f]{64})/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!exp || exp < Date.now() / 1000) return false;
  return safeEqual(m[2], await hmacHex(env.OPS_COOKIE_SECRET!, `ops:${exp}`));
}

/** Claudes Bearer-token mot CLAUDE_TASKS_TOKEN (jämförs som HMAC så att längd och innehåll inte läcker). */
async function validClaudeToken(request: Request, env: OpsEnv): Promise<boolean> {
  const token = (env.CLAUDE_TASKS_TOKEN ?? '').trim();
  const got = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !got) return false;
  return safeEqual(await hmacHex(env.OPS_COOKIE_SECRET!, got), await hmacHex(env.OPS_COOKIE_SECRET!, token));
}

/** POST från vår egen sida? (Cookien är SameSite=Lax; det här stänger resten.) */
const sameOrigin = (request: Request, url: URL) => { const o = request.headers.get('Origin'); return !o || o === url.origin; };

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });

async function handleLogin(request: Request, env: OpsEnv): Promise<Response> {
  // Max 10 försök per 15 minuter per (hashad) IP — skyddar lösenordet mot gissning.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rlKey = `ops:login:${(await hmacHex(env.OPS_COOKIE_SECRET!, ip)).slice(0, 32)}`;
  const tries = num(await env.QUOTA_KV.get(rlKey));
  if (tries >= 10) return html(loginPage('För många försök. Vänta en kvart och försök igen.'), 429);
  let password = '';
  try { password = String((await request.formData()).get('password') ?? ''); } catch { /* tomt formulär */ }
  const ok = safeEqual(await hmacHex(env.OPS_COOKIE_SECRET!, password), await hmacHex(env.OPS_COOKIE_SECRET!, env.OPS_PASSWORD!));
  if (!ok) {
    await env.QUOTA_KV.put(rlKey, String(tries + 1), { expirationTtl: 900 });
    return html(loginPage('Fel lösenord.'), 401);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/ops',
      'Set-Cookie': `${COOKIE}=${await makeSession(env)}; Path=/ops; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
      ...SECURITY_HEADERS,
    },
  });
}

// ── Insamlare ────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  PREPARE_FOR_SUBMISSION: 'Förbereds',
  READY_FOR_REVIEW: 'Redo att skickas in',
  WAITING_FOR_REVIEW: 'Väntar på granskning',
  IN_REVIEW: 'Granskas nu',
  WAITING_FOR_EXPORT_COMPLIANCE: 'Väntar på exportuppgifter',
  PENDING_DEVELOPER_RELEASE: 'Godkänd – väntar på att du släpper den',
  PENDING_APPLE_RELEASE: 'Godkänd – väntar på Apple',
  ACCEPTED: 'Godkänd',
  PROCESSING_FOR_APP_STORE: 'Bearbetas',
  PROCESSING_FOR_DISTRIBUTION: 'Bearbetas',
  READY_FOR_SALE: 'Ute i App Store',
  READY_FOR_DISTRIBUTION: 'Ute i App Store',
  REJECTED: 'Avvisad',
  METADATA_REJECTED: 'Metadata avvisad',
  INVALID_BINARY: 'Ogiltigt bygge',
  DEVELOPER_REJECTED: 'Tillbakadragen',
  DEVELOPER_REMOVED_FROM_SALE: 'Borttagen från försäljning',
  REMOVED_FROM_SALE: 'Borttagen från försäljning',
  REPLACED_WITH_NEW_VERSION: 'Ersatt av ny version',
};
const LIVE_STATES = new Set(['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION']);

let ascJwt: { token: string; exp: number } | null = null;

async function ascToken(env: OpsEnv): Promise<string> {
  if (ascJwt && ascJwt.exp - 60 > Date.now() / 1000) return ascJwt.token;
  const pem = env.ASC_PRIVATE_KEY!.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const b64u = (bytes: Uint8Array) => {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 1100; // Apple tillåter max 20 min
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.ASC_KEY_ID!.trim(), typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ iss: env.ASC_ISSUER_ID!.trim(), iat: now, exp, aud: 'appstoreconnect-v1' })));
  // WebCrypto ger signaturen som r||s (64 byte) — exakt vad ES256 i en JWT vill ha.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)));
  ascJwt = { token: `${head}.${body}.${b64u(sig)}`, exp };
  return ascJwt.token;
}

/** Nya nedladdningar ur en dagsrapport (SALES/SUMMARY). Uppdateringar och köp räknas inte. */
export function countDownloads(tsv: string): number {
  const lines = tsv.trim().split(/\r?\n/);
  if (lines.length < 2) return 0;
  const head = lines[0].split('\t');
  const ti = head.indexOf('Product Type Identifier');
  const ui = head.indexOf('Units');
  if (ti < 0 || ui < 0) return 0;
  const downloads = new Set(['1', '1F', '1T', '1E', '1EP', '1EU', 'F1']);
  let n = 0;
  for (const l of lines.slice(1)) {
    const c = l.split('\t');
    if (downloads.has((c[ti] ?? '').trim())) n += num(c[ui]);
  }
  return n;
}

let salesVersion = '1_1'; // Apples rapportversion; faller tillbaka till 1_0 om kontot inte har 1_1

/** Nedladdningar per dag. Varje dagsrapport hämtas en gång och sparas (de ändras inte efteråt). */
async function downloadsSeries(env: OpsEnv, token: string): Promise<{ series: Point[]; note: string }> {
  const days = lastDays(DAYS);
  if (!env.ASC_VENDOR_NUMBER) return { series: points(days, () => null), note: 'Leverantörsnummer saknas, så nedladdningar visas inte.' };
  const map = await readSeries(env, 'downloads');
  const today = isoDay(Date.now());
  const complete = days.filter((d) => d < today); // dagsrapporten kommer dagen efter
  const missing = complete.filter((d) => map[d] == null).reverse().slice(0, 6); // nyast först, högst 6 per körning
  const fetchDay = (day: string) => fetch(
    'https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY'
      + `&filter[vendorNumber]=${encodeURIComponent(env.ASC_VENDOR_NUMBER!.trim())}&filter[reportDate]=${day}&filter[version]=${salesVersion}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' } },
  );
  let changed = false;
  await Promise.all(missing.map(async (day) => {
    let r = await fetchDay(day);
    if (r.status === 400 && salesVersion === '1_1') {
      await r.body?.cancel();
      salesVersion = '1_0';
      r = await fetchDay(day);
    }
    if (r.status === 404) {
      // Ingen försäljning den dagen, eller rapporten är inte klar än. 0 sparas först när dagen är 3 dagar gammal.
      if (Date.now() - Date.parse(`${day}T00:00:00Z`) > 3 * 86400000) { map[day] = 0; changed = true; }
      return;
    }
    if (r.status !== 200 || !r.body) return;
    const text = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
    map[day] = countDownloads(text);
    changed = true;
  }));
  if (changed) await writeSeries(env, 'downloads', map);
  return {
    series: points(days, (d) => (map[d] == null ? null : num(map[d]))),
    note: complete.some((d) => num(map[d]) > 0) ? '' : 'Inga nedladdningar rapporterade än. Apples rapporter kommer dagen efter.',
  };
}

async function appStoreData(env: OpsEnv) {
  const appId = env.ASC_APP_ID || '6798360464';
  // Betyg via Apples öppna uppslag (svensk butik) — fungerar så fort appen är publicerad.
  const lookupP = getJson(`https://itunes.apple.com/lookup?id=${appId}&country=se`).catch(() => null);
  if (!env.ASC_ISSUER_ID || !env.ASC_KEY_ID || !env.ASC_PRIVATE_KEY) throw new NotConfigured('App Store Connect-nyckeln');
  const token = await ascToken(env);
  const init = { headers: { Authorization: `Bearer ${token}` } };
  const base = 'https://api.appstoreconnect.apple.com/v1';
  const [versions, reviews] = await Promise.all([
    getJson(`${base}/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=5`, init),
    getJson(`${base}/apps/${appId}/customerReviews?sort=-createdDate&limit=5`, init),
  ]);
  if (versions.status === 401 || versions.status === 403) throw new Error('App Store Connect godkände inte nyckeln');
  if (versions.status !== 200) throw new Error(`App Store Connect svarade ${versions.status}`);
  const all = (versions.json?.data ?? []).map((x: any) => x?.attributes ?? {})
    .sort((a: any, b: any) => String(b.createdDate ?? '').localeCompare(String(a.createdDate ?? '')));
  const v = all[0] ?? {};
  const stateOf = (x: any) => String(x.appVersionState ?? x.appStoreState ?? '');
  const state = stateOf(v);
  const live = all.find((x: any) => LIVE_STATES.has(stateOf(x)));
  const lookup = (await lookupP)?.json?.results?.[0] ?? null;
  const dl = await downloadsSeries(env, token);
  return {
    version: v.versionString ?? null,
    state,
    stateLabel: STATE_LABELS[state] ?? state,
    liveVersion: live?.versionString ?? null,
    rating: lookup?.averageUserRating != null ? Number(lookup.averageUserRating) : null,
    ratingCount: lookup?.userRatingCount != null ? Number(lookup.userRatingCount) : null,
    reviews: reviews.status === 200
      ? (reviews.json?.data ?? []).map((r: any) => ({
        id: String(r.id ?? ''),
        rating: Math.max(0, Math.min(5, num(r.attributes?.rating))),
        title: String(r.attributes?.title ?? '').slice(0, 120),
        body: String(r.attributes?.body ?? '').slice(0, 280),
        date: String(r.attributes?.createdDate ?? '').slice(0, 10),
        territory: String(r.attributes?.territory ?? ''),
      }))
      : [],
    downloads: dl.series,
    downloadsNote: dl.note,
    link: `https://appstoreconnect.apple.com/apps/${appId}/appstore`,
  };
}

async function revenueData(env: OpsEnv) {
  const key = env.REVENUECAT_METRICS_KEY || env.REVENUECAT_SECRET_KEY;
  if (!key || !env.REVENUECAT_PROJECT_ID) throw new NotConfigured('REVENUECAT_METRICS_KEY');
  const r = await getJson(`https://api.revenuecat.com/v2/projects/${env.REVENUECAT_PROJECT_ID}/metrics/overview`, {
    headers: { Authorization: `Bearer ${key.trim()}` },
  });
  if (r.status === 401 || r.status === 403) throw new Error('RevenueCat-nyckeln saknar behörighet för Charts metrics');
  if (r.status !== 200) throw new Error(`RevenueCat svarade ${r.status}`);
  const metrics = Array.isArray(r.json?.metrics) ? r.json.metrics : [];
  const by = (id: string) => metrics.find((m: any) => m?.id === id) ?? null;
  const val = (id: string) => { const m = by(id); return m ? num(m.value) : null; };
  const unit = String(by('mrr')?.unit ?? '$');
  const now = { active: val('active_subscriptions'), mrr: val('mrr'), revenue28: val('revenue'), new28: val('new_customers'), trials: val('active_trials') };
  // RevenueCat ger bara dagens läge → spara en ögonblicksbild per dag (bara när den ändrats) för graferna.
  const map = await readSeries(env, 'rc');
  const day = isoDay(Date.now());
  const snap = { active: now.active, mrr: now.mrr };
  if (!sameJson(map[day], snap)) { map[day] = snap; await writeSeries(env, 'rc', map); }
  const prev = map[isoDay(Date.now() - 86400000)] ?? null;
  const days = lastDays(DAYS);
  return {
    ...now,
    unit: unit === '#' ? '$' : unit,
    activeYesterday: prev?.active != null ? num(prev.active) : null,
    activeSeries: points(days, (d) => (map[d]?.active == null ? null : num(map[d].active))),
    mrrSeries: points(days, (d) => (map[d]?.mrr == null ? null : num(map[d].mrr))),
    link: 'https://app.revenuecat.com/',
  };
}

async function sentryData(env: OpsEnv) {
  if (!env.SENTRY_API_TOKEN) throw new NotConfigured('SENTRY_API_TOKEN');
  const org = env.SENTRY_ORG || 'jesper-toreld';
  const proj = env.SENTRY_PROJECT || 'blades-ios';
  const base = 'https://de.sentry.io/api/0';
  const init = { headers: { Authorization: `Bearer ${env.SENTRY_API_TOKEN.trim()}` } };
  const q = encodeURIComponent;
  const [issues, fresh, sessions] = await Promise.all([
    getJson(`${base}/projects/${org}/${proj}/issues/?query=${q('is:unresolved')}&statsPeriod=14d&sort=freq&limit=5`, init),
    getJson(`${base}/projects/${org}/${proj}/issues/?query=${q('is:unresolved firstSeen:-24h')}&statsPeriod=24h&limit=5`, init),
    env.SENTRY_PROJECT_ID
      ? getJson(`${base}/organizations/${org}/sessions/?project=${env.SENTRY_PROJECT_ID}&field=${q('sum(session)')}&field=${q('count_unique(user)')}&field=${q('crash_free_rate(session)')}&statsPeriod=${DAYS}d&interval=1d`, init)
      : Promise.resolve({ status: 0, json: null, headers: new Headers() }),
  ]);
  if (issues.status === 401 || issues.status === 403) throw new Error('Sentry godkände inte token');
  if (issues.status !== 200) throw new Error(`Sentry svarade ${issues.status}`);
  const list = Array.isArray(issues.json) ? issues.json : [];
  const hits = (res: { headers: Headers; json: any }) => {
    const h = res.headers.get('X-Hits');
    return h != null && h !== '' ? Number(h) : (Array.isArray(res.json) ? res.json.length : 0);
  };
  const g = sessions.status === 200 ? sessions.json?.groups?.[0] : null;
  const intervals: string[] = g && Array.isArray(sessions.json?.intervals) ? sessions.json.intervals : [];
  const byDay = new Map<string, { s: number; u: number; c: number | null }>();
  intervals.forEach((d, i) => {
    const c = g.series?.['crash_free_rate(session)']?.[i];
    byDay.set(String(d).slice(0, 10), { s: num(g.series?.['sum(session)']?.[i]), u: num(g.series?.['count_unique(user)']?.[i]), c: c == null ? null : Number(c) });
  });
  const days = lastDays(DAYS);
  const last7 = days.slice(-7).map((d) => byDay.get(d)).filter(Boolean) as { s: number; c: number | null }[];
  const s7 = last7.reduce((a, x) => a + x.s, 0);
  return {
    unresolved: hits(issues),
    new24h: fresh.status === 200 ? hits(fresh) : null,
    newIssues: fresh.status === 200 && Array.isArray(fresh.json)
      ? fresh.json.slice(0, 5).map((i: any) => ({ id: String(i.id ?? ''), title: String(i.title ?? '').slice(0, 140), url: i.permalink ?? null }))
      : [],
    top: list.slice(0, 3).map((i: any) => ({
      title: String(i.title ?? '').slice(0, 140), count: num(i.count), users: num(i.userCount), lastSeen: i.lastSeen ?? null, url: i.permalink ?? null,
    })),
    crashFree7d: s7 > 0 ? last7.reduce((a, x) => a + (x.c ?? 1) * x.s, 0) / s7 : null,
    sessions: points(days, (d) => (byDay.has(d) ? byDay.get(d)!.s : (g ? 0 : null))),
    users: points(days, (d) => (byDay.has(d) ? byDay.get(d)!.u : (g ? 0 : null))),
    crashFree: points(days, (d) => { const x = byDay.get(d); return x && x.s > 0 && x.c != null ? x.c : null; }),
    link: `https://${org}.sentry.io/issues/`,
  };
}

async function trafficData(env: OpsEnv) {
  const token = (env.CF_ANALYTICS_TOKEN || env.CF_API_TOKEN || '').trim();
  if (!token || !env.CF_ACCOUNT_ID) throw new NotConfigured('CF_ANALYTICS_TOKEN');
  const account = env.CF_ACCOUNT_ID.trim();
  const today = isoDay(Date.now());
  const recent = lastDays(7);
  const next = (d: string) => isoDay(Date.parse(`${d}T00:00:00Z`) + 86400000);
  // En fråga per dag (alias) — gratisplanens dataset tillåter bara ett dygn per fråga och sparar ~8 dagar.
  // Äldre dagar ligger kvar i KV-historiken.
  const range = (d: string) => `datetime_geq: "${d}T00:00:00Z", datetime_lt: "${next(d)}T00:00:00Z"`;
  const zone = (env.CF_ZONE_ID ?? '').trim();
  const site = zone
    ? `zones(filter: {zoneTag: "${zone}"}) { ${recent.map((d, i) => `s${i}: httpRequestsAdaptiveGroups(limit: 1, filter: {${range(d)}, clientRequestHTTPHost: "blades-app.com", requestSource: "eyeball"}) { count sum { visits } }`).join(' ')} }`
    : '';
  const worker = `accounts(filter: {accountTag: "${account}"}) { ${recent.map((d, i) => `w${i}: workersInvocationsAdaptive(limit: 1, filter: {${range(d)}, scriptName: "blades-api"}) { sum { requests errors } }`).join(' ')} }`;
  // KV-skrivningar i går och i dag för hela kontot (gratisgränsen) — egen fråga så att ett fel här inte fäller resten.
  const kvq = `accounts(filter: {accountTag: "${account}"}) { ${recent.slice(-2).map((d, i) => `k${i}: kvOperationsAdaptiveGroups(limit: 20, filter: {${range(d)}}) { sum { requests } dimensions { actionType } }`).join(' ')} }`;
  const gql = (query: string) => getJson('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const [r, kv] = await Promise.all([gql(`{ viewer { ${site} ${worker} } }`), gql(`{ viewer { ${kvq} } }`).catch(() => null)]);
  if (r.status !== 200) throw new Error(`Cloudflare svarade ${r.status}`);
  if (Array.isArray(r.json?.errors) && r.json.errors.length && !r.json?.data?.viewer) {
    throw new Error(`Cloudflare: ${String(r.json.errors[0]?.message ?? 'fel').slice(0, 140)}`);
  }
  const z = r.json?.data?.viewer?.zones?.[0] ?? null;
  const a = r.json?.data?.viewer?.accounts?.[0] ?? null;
  const kvWrites = (alias: string): number | null => {
    const rows = kv?.json?.data?.viewer?.accounts?.[0]?.[alias];
    if (!Array.isArray(rows)) return null;
    return rows.filter((x: any) => x?.dimensions?.actionType === 'write').reduce((s: number, x: any) => s + num(x?.sum?.requests), 0);
  };
  // Hela dagar sparas (bara när de ändrats); dagens siffror tas alltid live.
  const map = await readSeries(env, 'cf');
  let live: any = {};
  let changed = false;
  recent.forEach((d, i) => {
    const cur: any = { ...(map[d] ?? {}) };
    if (z) cur.visits = num(z[`s${i}`]?.[0]?.sum?.visits);
    if (a) { cur.wreq = num(a[`w${i}`]?.[0]?.sum?.requests); cur.werr = num(a[`w${i}`]?.[0]?.sum?.errors); }
    if (d === today) live = cur;
    else if (!sameJson(map[d], cur)) { map[d] = cur; changed = true; }
  });
  if (changed) await writeSeries(env, 'cf', map);
  const at = (d: string) => (d === today ? live : map[d]);
  const pick = (f: string) => (d: string) => { const v = at(d)?.[f]; return v == null ? null : num(v); };
  const days = lastDays(DAYS);
  const yesterday = recent[recent.length - 2];
  return {
    visits: points(days, pick('visits')),
    workerRequests: points(days, pick('wreq')),
    workerErrors: points(days, pick('werr')),
    limits: {
      workerToday: a ? num(live.wreq) : null,
      workerYesterday: a ? num(map[yesterday]?.wreq) : null,
      workerLimit: FREE_LIMITS.workerRequests,
      kvWritesToday: kvWrites('k1'),
      kvWritesYesterday: kvWrites('k0'),
      kvLimit: FREE_LIMITS.kvWrites,
    },
    siteNote: zone ? (z ? '' : 'Saknar behörighet för zonens statistik') : 'CF_ZONE_ID saknas',
    link: 'https://dash.cloudflare.com/',
  };
}

async function aiData(env: OpsEnv) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) throw new NotConfigured('CF_API_TOKEN');
  const ds = await resolveAeDataset(env);
  const since = /^\d{4}-\d{2}-\d{2}$/.test((env.OPS_CREDIT_SINCE ?? '').trim()) ? env.OPS_CREDIT_SINCE!.trim() : '';
  const credit = Number((env.OPS_CREDIT_USD ?? '').trim());
  const users = `blob4 != 'model_fallback' AND blob2 != 'news_cron'`; // appens anrop (inte nyhetsjobbet)
  const [daily, dailyCost, day1, sinceCost, models, fallbacks] = await Promise.all([
    aeQuery(env, `SELECT toDate(timestamp) AS day, SUM(_sample_interval) AS requests, SUM(IF(blob4 != 'ok', _sample_interval, 0)) AS errors FROM ${ds} WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY AND ${users} GROUP BY day ORDER BY day`),
    aeQuery(env, `SELECT toDate(timestamp) AS day, SUM(_sample_interval * double4) AS cost FROM ${ds} WHERE timestamp > NOW() - INTERVAL '${DAYS}' DAY GROUP BY day ORDER BY day`),
    aeQuery(env, `SELECT SUM(_sample_interval) AS requests, SUM(IF(blob4 != 'ok', _sample_interval, 0)) AS errors, COUNT(DISTINCT blob2) AS devices FROM ${ds} WHERE timestamp > NOW() - INTERVAL '1' DAY AND ${users}`),
    since ? aeQuery(env, `SELECT SUM(_sample_interval * double4) AS cost FROM ${ds} WHERE timestamp >= toDateTime('${since} 00:00:00')`) : Promise.resolve([]),
    aeQuery(env, `SELECT blob1 AS model, SUM(_sample_interval) AS requests, SUM(_sample_interval * double4) AS cost FROM ${ds} WHERE timestamp > NOW() - INTERVAL '7' DAY AND ${users} GROUP BY model ORDER BY cost DESC LIMIT 4`),
    aeQuery(env, `SELECT blob1 AS change, SUM(_sample_interval) AS n FROM ${ds} WHERE timestamp > NOW() - INTERVAL '1' DAY AND blob4 = 'model_fallback' GROUP BY change ORDER BY n DESC LIMIT 3`),
  ]);
  const byDay = new Map(daily.map((r: any) => [String(r.day).slice(0, 10), r]));
  const costByDay = new Map(dailyCost.map((r: any) => [String(r.day).slice(0, 10), num(r.cost)]));
  const days = lastDays(DAYS);
  const spent = since ? num(sinceCost[0]?.cost) : null;
  const hasCredit = Number.isFinite(credit) && credit > 0;
  return {
    requests: points(days, (d) => num(byDay.get(d)?.requests)),
    errors: points(days, (d) => num(byDay.get(d)?.errors)),
    cost: points(days, (d) => costByDay.get(d) ?? 0),
    requests24h: num(day1[0]?.requests),
    errors24h: num(day1[0]?.errors),
    devices24h: num(day1[0]?.devices),
    creditStart: hasCredit ? credit : null,
    creditSince: since || null,
    creditSpent: spent,
    creditLeft: hasCredit && spent != null ? Math.max(0, credit - spent) : null,
    models: models.map((m: any) => ({ model: String(m.model ?? ''), requests: num(m.requests), cost: num(m.cost) })),
    fallbacks: fallbacks.map((f: any) => String(f.change ?? '')).filter(Boolean),
    link: 'https://console.anthropic.com/settings/billing',
  };
}

async function supportData(env: OpsEnv) {
  const days = lastDays(DAYS);
  const recent = days.slice(-7);
  const map = await readSeries(env, 'mail');
  // Övergång: första versionen räknade i en nyckel per dag. De försvinner av sig själva efter 40 dagar.
  const [last, ...legacy] = await Promise.all([
    env.QUOTA_KV.get('ops:mail:last'),
    ...recent.map((d) => env.QUOTA_KV.get(`ops:mail:day:${d}`)),
  ]);
  recent.forEach((d, i) => { if (legacy[i]) map[d] = num(map[d]) + num(legacy[i]); });
  const mails = days.map((d) => ({ d, v: num(map[d]) }));
  return {
    counting: !!env.SUPPORT_FORWARD_TO,
    mails,
    today: mails[mails.length - 1].v,
    last: last || null,
    link: 'https://mail.google.com/',
  };
}

async function uptimeData() {
  const checks = await Promise.all(SITE_PAGES.map(async (path) => {
    try {
      const r = await fetch(`https://blades-app.com${path}`, { redirect: 'follow', headers: { 'User-Agent': 'BladesOps-uptime' } });
      await r.body?.cancel();
      return { path, status: r.status };
    } catch {
      return { path, status: 0 };
    }
  }));
  const failed = checks.filter((c) => c.status !== 200);
  return { checks, ok: failed.length === 0, failed: failed.map((c) => `${c.path} (${c.status || 'nere'})`) };
}

// ── Larm ─────────────────────────────────────────────────────────────────────

type Alert = {
  key: string;        // samma key mejlas bara en gång (eller igen efter cooldownH om larmet står kvar)
  level: 'bad' | 'warn' | 'good' | 'info';
  text: string;
  href?: string;
  act?: boolean;      // kräver dig fast nyheten är god (t.ex. en godkänd version att släppa)
  notify: boolean;    // mejla
  page?: boolean;     // visa överst på sidan (standard ja)
  cooldownH?: number;
};

function computeAlerts(d: any): Alert[] {
  const out: Alert[] = [];
  for (const [k, label] of SENSORS) {
    const r = d[k];
    if (r && !r.ok && !r.notConfigured) out.push({ key: `sensor:${k}`, level: 'warn', text: `${label} kan inte läsas just nu: ${r.error}`, notify: false });
  }
  const a = d.appStore?.ok ? d.appStore.data : null;
  if (a) {
    if (['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(a.state)) {
      out.push({ key: `asc:${a.state}:${a.version}`, level: 'bad', text: `App Store: ${a.stateLabel} (${a.version}). Läs Apples svar i App Store Connect.`, href: a.link, notify: true });
    }
    if (a.state === 'PENDING_DEVELOPER_RELEASE') {
      out.push({ key: `asc:${a.state}:${a.version}`, level: 'good', act: true, text: `Version ${a.version} är godkänd. Släpp den med "Release This Version".`, href: a.link, notify: true });
    }
    if (a.liveVersion) out.push({ key: `asc:live:${a.liveVersion}`, level: 'good', text: `Version ${a.liveVersion} är ute i App Store`, href: a.link, notify: true, page: false });
    for (const r of (a.reviews ?? []).filter((x: any) => x.date >= isoDay(Date.now() - 2 * 86400000))) {
      out.push({ key: `review:${r.id}`, level: r.rating <= 2 ? 'warn' : 'info', text: `Ny recension ${'★'.repeat(r.rating)}: ${r.title || '(utan rubrik)'}`, href: a.link, notify: true });
    }
  }
  const rv = d.revenue?.ok ? d.revenue.data : null;
  if (rv && rv.active != null && rv.activeYesterday != null && rv.active > rv.activeYesterday) {
    out.push({ key: `rc:active:${rv.active}`, level: 'good', text: `Ny betalande kund – ${rv.active} totalt`, href: rv.link, notify: true });
  }
  const s = d.stability?.ok ? d.stability.data : null;
  if (s) {
    for (const i of s.newIssues ?? []) out.push({ key: `sentry:issue:${i.id}`, level: 'warn', text: `Nytt fel i appen: ${i.title}`, href: i.url ?? s.link, notify: true });
    if (s.crashFree7d != null && s.crashFree7d < 0.99) {
      out.push({ key: 'sentry:crashfree', level: 'warn', text: `Kraschfria sessioner under 99 % (${(s.crashFree7d * 100).toFixed(1).replace('.', ',')} % senaste veckan)`, href: s.link, notify: true, cooldownH: 72 });
    }
  }
  const i = d.ai?.ok ? d.ai.data : null;
  if (i) {
    if (i.creditLeft != null && i.creditLeft < 5) {
      out.push({ key: 'ai:credit', level: i.creditLeft < 1 ? 'bad' : 'warn', text: `AI-krediten börjar ta slut: cirka $${i.creditLeft.toFixed(2)} kvar. Fyll på och uppdatera OPS_CREDIT_USD/OPS_CREDIT_SINCE.`, href: i.link, notify: true, cooldownH: 72 });
    }
    if (i.requests24h >= 5 && i.errors24h / i.requests24h >= 0.2) {
      out.push({ key: 'ai:errors', level: 'warn', text: `${i.errors24h} av ${i.requests24h} AI-anrop misslyckades senaste dygnet`, notify: true, cooldownH: 24 });
    }
    for (const f of i.fallbacks ?? []) out.push({ key: `model:${f}`, level: 'info', text: `AI-modellen byttes automatiskt: ${f}`, notify: true, cooldownH: 24 * 30 });
  }
  const t = d.traffic?.ok ? d.traffic.data : null;
  if (t) {
    const req = num(t.workerRequests[t.workerRequests.length - 2]?.v); // i går (hel dag)
    const err = num(t.workerErrors[t.workerErrors.length - 2]?.v);
    if (err > 20 && req > 0 && err / req > 0.02) {
      out.push({ key: 'proxy:errors', level: 'warn', text: `Proxyn hade ${thousands(err)} fel i går (${((err / req) * 100).toFixed(1).replace('.', ',')} % av anropen)`, href: t.link, notify: true, cooldownH: 24 });
    }
    const L = t.limits;
    const wr = Math.max(num(L.workerToday), num(L.workerYesterday));
    if (wr >= 0.7 * L.workerLimit) {
      out.push({ key: 'limit:worker', level: wr >= 0.9 * L.workerLimit ? 'bad' : 'warn', text: `Proxyn närmar sig gratisgränsen: ${thousands(wr)} av ${thousands(L.workerLimit)} anrop per dygn. Byt till Workers Paid ($5/mån).`, href: 'https://dash.cloudflare.com/?to=/:account/workers/plans', notify: true, cooldownH: 24 });
    }
    const kw = Math.max(num(L.kvWritesToday), num(L.kvWritesYesterday));
    if (kw >= 0.7 * L.kvLimit) {
      out.push({ key: 'limit:kv', level: kw >= 0.9 * L.kvLimit ? 'bad' : 'warn', text: `KV-skrivningar närmar sig gratisgränsen: ${thousands(kw)} av ${thousands(L.kvLimit)} per dygn. Byt till Workers Paid ($5/mån), annars slutar AI-kvoterna räknas.`, href: 'https://dash.cloudflare.com/?to=/:account/workers/plans', notify: true, cooldownH: 24 });
    }
  }
  const p = d.support?.ok ? d.support.data : null;
  if (p && p.today > 0) out.push({ key: `mail:${isoDay(Date.now())}`, level: 'info', text: `${p.today} supportmejl i dag – svara från Gmail`, href: p.link, notify: false });
  const u = d.uptime?.ok ? d.uptime.data : null;
  if (u && !u.ok) out.push({ key: 'site:down', level: 'bad', text: `Sajten svarar inte som den ska: ${u.failed.join(', ')}`, href: 'https://blades-app.com', notify: true, cooldownH: 6 });
  for (const dl of d.deadlines ?? []) {
    if (dl.daysLeft <= 30) out.push({ key: `deadline:${dl.date}`, level: dl.daysLeft <= 7 ? 'bad' : 'warn', text: `${dl.text} (om ${dl.daysLeft} dagar)`, href: dl.href, notify: true, cooldownH: 24 * 7 });
  }
  const rank = (x: Alert) => (x.level === 'bad' ? 0 : x.level === 'warn' ? 1 : x.act ? 2 : x.level === 'good' ? 3 : 4);
  return out.sort((x, y) => rank(x) - rank(y));
}

async function collectOps(env: OpsEnv) {
  const [appStore, revenue, stability, traffic, ai, support, uptime] = await Promise.all([
    settle(appStoreData(env)), settle(revenueData(env)), settle(sentryData(env)),
    settle(trafficData(env)), settle(aiData(env)), settle(supportData(env)), settle(uptimeData()),
  ]);
  const deadlines = DEADLINES.map((x) => ({ ...x, daysLeft: Math.ceil((Date.parse(`${x.date}T00:00:00Z`) - Date.now()) / 86400000) }));
  const data: any = { at: Date.now(), appStore, revenue, stability, traffic, ai, support, uptime, deadlines };
  data.alerts = computeAlerts(data);
  return data;
}

async function opsData(env: OpsEnv, ctx: ExecutionContext, force: boolean): Promise<any> {
  if (!force) {
    try {
      const raw = await env.QUOTA_KV.get(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (Date.now() - c.at < CACHE_MS) return c;
      }
    } catch { /* hämta om */ }
  } else {
    // Tvingad uppdatering högst en gång per minut — skyddar API-kvoterna.
    const lastForce = num(await env.QUOTA_KV.get('ops:cache:forced'));
    if (Date.now() - lastForce < 60000) return opsData(env, ctx, false);
    ctx.waitUntil(env.QUOTA_KV.put('ops:cache:forced', String(Date.now()), { expirationTtl: 300 }));
  }
  const data = await collectOps(env);
  ctx.waitUntil(env.QUOTA_KV.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: 3600 }));
  return data;
}

// ── Bevakning (cron varje timme) → larmmejl ──────────────────────────────────

type MailStatus = 'ready' | 'off' | 'no-binding' | 'no-recipient';
const alertRecipient = (env: OpsEnv) => (env.OPS_ALERT_TO || env.SUPPORT_FORWARD_TO || '').trim();
function mailStatus(env: OpsEnv): MailStatus {
  if ((env.OPS_ALERTS ?? '').trim().toLowerCase() === 'off') return 'off';
  if (!env.ALERT_MAIL) return 'no-binding';
  if (!alertRecipient(env)) return 'no-recipient';
  return 'ready';
}
const MAIL_STATUS_TEXT: Record<MailStatus, string> = {
  ready: '',
  off: 'Larmmejlen är avstängda (OPS_ALERTS = "off").',
  'no-binding': 'Bindningen ALERT_MAIL saknas. Deploya med den nya wrangler.toml.',
  'no-recipient': 'Ingen mottagare. Sätt OPS_ALERT_TO eller SUPPORT_FORWARD_TO.',
};

async function monitorInfo(env: OpsEnv) {
  let m: any = null;
  try { m = JSON.parse((await env.QUOTA_KV.get('ops:monitor')) ?? 'null'); } catch { /* ingen körning än */ }
  return { at: m?.at ?? null, sent: num(m?.sent), lastMailAt: m?.lastMailAt ?? null, lastError: m?.lastError ?? null, mail: mailStatus(env) };
}

const b64 = (s: string) => { let bin = ''; for (const b of enc.encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

/** RFC 2047-ämnesrad: högst 75 tecken per kodat ord → bitar om ≤ 45 byte UTF-8, vikta på nya rader. */
function encodeSubject(s: string): string {
  const parts: string[] = [];
  let chunk = '';
  for (const ch of s) {
    if (chunk && enc.encode(chunk + ch).length > 45) { parts.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) parts.push(chunk);
  return parts.map((p) => `=?UTF-8?B?${b64(p)}?=`).join('\r\n ');
}

async function sendAlertEmail(env: OpsEnv, to: string, items: { text: string; href?: string }[], subject?: string): Promise<void> {
  let subj = subject ?? (items.length === 1 ? `Blades Ops: ${items[0].text}` : `Blades Ops: ${items.length} saker att kolla – ${items[0].text}`);
  if (subj.length > 110) subj = `${subj.slice(0, 107)}…`;
  const body = [
    ...items.map((a) => `• ${a.text}${a.href ? `\r\n  ${a.href}` : ''}`),
    '',
    `Öppna Blades Ops: ${OPS_URL}`,
    '',
    '– Skickat av driftsidans bevakning. Den kollar varje timme och mejlar bara när något är nytt.',
  ].join('\r\n');
  const raw = [
    'From: Blades Ops <ops@blades-app.com>',
    `To: <${to}>`,
    `Subject: ${encodeSubject(subj)}`,
    `Message-ID: <${crypto.randomUUID()}@blades-app.com>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body).replace(/(.{76})(?=.)/g, '$1\r\n'),
  ].join('\r\n');
  await env.ALERT_MAIL!.send(new EmailMessage('ops@blades-app.com', to, raw));
}

/** Körs av cron varje timme: hämtar färsk data och mejlar bara larm som är NYA (eller vars väntetid gått ut).
 *  En sensor som slutat svara mejlas först efter tre körningar i rad, sajten efter två (tillfälliga fel tystas). */
export async function runOpsMonitor(env: OpsEnv): Promise<{ sent: number; alerts: number }> {
  const data = await collectOps(env);
  let state: any = {};
  try { state = JSON.parse((await env.QUOTA_KV.get('ops:monitor')) ?? '{}') ?? {}; } catch { state = {}; }
  const fails: Record<string, number> = state.fails ?? {};
  const alerts: Alert[] = data.alerts.filter((a: Alert) => a.notify);
  for (const [k, label] of SENSORS) {
    const r = data[k];
    fails[k] = r && !r.ok && !r.notConfigured ? num(fails[k]) + 1 : 0;
    if (fails[k] >= 3) alerts.push({ key: `sensor:${k}`, level: 'warn', text: `${label} har inte gått att läsa på ${fails[k]} timmar: ${r.error}`, href: OPS_URL, notify: true, cooldownH: 24 });
  }
  fails.site = data.uptime?.ok && !data.uptime.data.ok ? num(fails.site) + 1 : 0;
  const mailable = alerts.filter((a) => a.key !== 'site:down' || fails.site >= 2);

  let sent = 0;
  let lastError: string | null = state.lastError ?? null;
  let lastMailAt: number | null = state.lastMailAt ?? null;
  if (mailable.length && mailStatus(env) === 'ready') {
    let sentMap: Record<string, number> = {};
    try { sentMap = JSON.parse((await env.QUOTA_KV.get('ops:alerts:sent')) ?? '{}') ?? {}; } catch { sentMap = {}; }
    const now = Date.now();
    const fresh = mailable.filter((a) => { const t = sentMap[a.key]; return !t || (a.cooldownH != null && now - t > a.cooldownH * 3600000); });
    if (fresh.length) {
      try {
        await sendAlertEmail(env, alertRecipient(env), fresh);
        for (const a of fresh) sentMap[a.key] = now;
        for (const [k, t] of Object.entries(sentMap)) if (now - t > 400 * 86400000) delete sentMap[k];
        await env.QUOTA_KV.put('ops:alerts:sent', JSON.stringify(sentMap));
        sent = fresh.length;
        lastMailAt = now;
        lastError = null;
      } catch (e: any) {
        lastError = String(e?.message ?? e).slice(0, 200); // försöker igen nästa timme
      }
    }
  }
  await env.QUOTA_KV.put('ops:monitor', JSON.stringify({ at: Date.now(), sent, alerts: mailable.length, fails, lastMailAt, lastError }));
  return { sent, alerts: mailable.length };
}

// ── Uppgifter (du ⇄ Claude) ──────────────────────────────────────────────────

type Task = { id: string; text: string; to: 'claude' | 'you'; status: 'open' | 'done'; createdAt: string; doneAt?: string; note?: string };
const TASKS_KEY = 'ops:tasks:v1';

async function readTasks(env: OpsEnv): Promise<Task[]> {
  try { const t = JSON.parse((await env.QUOTA_KV.get(TASKS_KEY)) ?? '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}

async function writeTasks(env: OpsEnv, tasks: Task[]): Promise<void> {
  // Alla öppna + de 30 senast avklarade.
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, 30);
  await env.QUOTA_KV.put(TASKS_KEY, JSON.stringify([...open, ...done]));
}

const newId = () => hex(crypto.getRandomValues(new Uint8Array(4)).buffer);
const cleanText = (s: any, max: number) => String(s ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);

async function readBody(request: Request): Promise<Record<string, any>> {
  const type = request.headers.get('Content-Type') ?? '';
  try {
    if (type.includes('application/json')) return (await request.json()) ?? {};
    if (type.includes('form')) return Object.fromEntries((await request.formData()).entries());
  } catch { /* ogiltig body */ }
  return {};
}

/** Öppna uppgifter till Claude som rader (äldst först) — skriptet i repot skriver ut dem i Claudes kontext. */
const inboxText = (tasks: Task[]) => tasks.filter((t) => t.status === 'open' && t.to === 'claude').reverse()
  .map((t) => `[${t.id}] ${t.createdAt.slice(0, 10)}: ${t.text.split('\n').join('\n    ')}`).join('\n');

// ── Supportmejl (Email Routing → Worker) ─────────────────────────────────────

/** Vidarebefordrar supportmejlet och räknar det. Bara räknare och tid sparas — inget innehåll,
 *  ingen avsändare. Misslyckas vidarebefordringen kastas felet, så att mejlet studsar i stället
 *  för att tyst försvinna (avsändaren kan då skicka igen). */
export async function handleSupportEmail(message: any, env: OpsEnv): Promise<void> {
  if (!env.SUPPORT_FORWARD_TO) {
    message.setReject('Support mailbox is temporarily unavailable. Please try again later.');
    return;
  }
  await message.forward(env.SUPPORT_FORWARD_TO.trim());
  try {
    const map = await readSeries(env, 'mail');
    const day = isoDay(Date.now());
    map[day] = num(map[day]) + 1;
    await writeSeries(env, 'mail', map);
    await env.QUOTA_KV.put('ops:mail:last', new Date().toISOString());
    await env.QUOTA_KV.delete(CACHE_KEY); // nästa titt på /ops visar mejlet direkt
  } catch { /* räkningen får aldrig stoppa ett mejl */ }
}

// ── Routning ─────────────────────────────────────────────────────────────────

/** Hanterar /ops och dess ikoner/manifest. Returnerar null för alla andra sökvägar. */
export async function handleOps(request: Request, env: OpsEnv, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  // Ikoner och manifest ligger utanför /ops: telefonen hämtar dem utan inloggningscookie.
  if (pathname === '/assets/ops-icon-180.png' || pathname === '/assets/ops-icon-192.png') {
    const icon = pathname.endsWith('180.png') ? ICON_180 : ICON_192;
    return new Response(Uint8Array.from(atob(icon), (c) => c.charCodeAt(0)), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
    });
  }
  if (pathname === '/assets/ops-manifest.webmanifest') {
    return new Response(JSON.stringify({
      name: 'Blades Ops', short_name: 'Blades Ops', start_url: '/ops', scope: '/ops', display: 'standalone',
      background_color: '#0A1628', theme_color: '#0C1C35',
      icons: [
        { src: '/assets/ops-icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/assets/ops-icon-180.png', sizes: '180x180', type: 'image/png' },
      ],
    }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' } });
  }

  if (pathname !== '/ops' && !pathname.startsWith('/ops/')) return null;
  if (!env.OPS_PASSWORD || !env.OPS_COOKIE_SECRET) {
    return new Response('Blades Ops är inte konfigurerat (OPS_PASSWORD och OPS_COOKIE_SECRET saknas).', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
    });
  }

  // Claudes inkorg (Bearer-token, ingen cookie): läs öppna uppgifter, bocka av, lägg uppgifter till dig.
  if (pathname === '/ops/inbox' || pathname.startsWith('/ops/inbox/')) {
    if (!(await validClaudeToken(request, env))) return json({ error: 'unauthorized' }, 401);
    const tasks = await readTasks(env);
    if (pathname === '/ops/inbox' && request.method === 'GET') {
      if (searchParams.get('format') === 'text') {
        return new Response(inboxText(tasks), { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });
      }
      return json({ open: tasks.filter((t) => t.status === 'open' && t.to === 'claude'), forYou: tasks.filter((t) => t.status === 'open' && t.to === 'you') });
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const body = await readBody(request);
    if (pathname === '/ops/inbox/done') {
      const t = tasks.find((x) => x.id === String(body.id ?? '').trim());
      if (!t) return json({ error: 'not_found' }, 404);
      t.status = 'done';
      t.doneAt = new Date().toISOString();
      t.note = cleanText(body.note, 600) || 'Klar';
      await writeTasks(env, tasks);
      return json({ ok: true, id: t.id, status: t.status, note: t.note });
    }
    if (pathname === '/ops/inbox/add') {
      const text = cleanText(body.text, 2000);
      if (!text) return json({ error: 'empty' }, 400);
      const t: Task = { id: newId(), text, to: 'you', status: 'open', createdAt: new Date().toISOString() };
      tasks.unshift(t);
      await writeTasks(env, tasks);
      return json({ ok: true, id: t.id });
    }
    return json({ error: 'not_found' }, 404);
  }

  if (pathname === '/ops/login' && request.method === 'POST') return handleLogin(request, env);
  if (pathname === '/ops/logout') {
    return new Response(null, { status: 303, headers: { Location: '/ops', 'Set-Cookie': `${COOKIE}=; Path=/ops; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, ...SECURITY_HEADERS } });
  }

  const authed = await validSession(request, env);
  if (pathname === '/ops' || pathname === '/ops/') return html(authed ? OPS_PAGE : loginPage(''));
  if (!authed) return json({ error: 'login' }, 401);

  if (pathname === '/ops/data') {
    const [data, monitor] = await Promise.all([opsData(env, ctx, searchParams.get('refresh') === '1'), monitorInfo(env)]);
    return json({ ...data, monitor });
  }
  if (request.method === 'POST' && !sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);

  if (pathname === '/ops/tasks' || pathname === '/ops/tasks/update') {
    if (request.method === 'POST') {
      const tasks = await readTasks(env);
      const body = await readBody(request);
      if (pathname === '/ops/tasks') {
        const text = cleanText(body.text, 2000);
        if (!text) return json({ error: 'empty' }, 400);
        if (tasks.filter((t) => t.status === 'open').length >= 100) return json({ error: 'too_many' }, 400);
        tasks.unshift({ id: newId(), text, to: 'claude', status: 'open', createdAt: new Date().toISOString() });
      } else {
        const t = tasks.find((x) => x.id === String(body.id ?? ''));
        if (!t) return json({ error: 'not_found' }, 404);
        if (body.action === 'delete') tasks.splice(tasks.indexOf(t), 1);
        else if (body.action === 'done') { t.status = 'done'; t.doneAt = new Date().toISOString(); }
        else if (body.action === 'open') { t.status = 'open'; delete t.doneAt; }
      }
      await writeTasks(env, tasks);
    }
    return json({ tasks: await readTasks(env), claudeConnected: !!env.CLAUDE_TASKS_TOKEN });
  }

  if (pathname === '/ops/alerts/test' && request.method === 'POST') {
    const status = mailStatus(env);
    if (status !== 'ready') return json({ ok: false, error: MAIL_STATUS_TEXT[status] }, 400);
    if (await env.QUOTA_KV.get('ops:testmail')) return json({ ok: false, error: 'Ett testmejl skickades nyss. Vänta några minuter.' }, 429);
    try {
      await sendAlertEmail(env, alertRecipient(env), [{ text: 'Testmejl: larmen från Blades Ops kommer fram.', href: OPS_URL }], 'Blades Ops: testmejl');
      await env.QUOTA_KV.put('ops:testmail', '1', { expirationTtl: 300 });
      return json({ ok: true });
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, 502);
    }
  }
  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
}

// ── Sidor ────────────────────────────────────────────────────────────────────

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0C1C35">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Blades Ops">
<link rel="apple-touch-icon" href="/assets/ops-icon-180.png">
<link rel="manifest" href="/assets/ops-manifest.webmanifest">`;

// Samma navy-värld som appen (constants/colors.ts + AppBackground): mörk gradient, cyan accent.
const BASE_CSS = `:root{--bg:#0A1628;--deep:#060C18;--surface:#0F1E3A;--elev:#152338;--border:#1A3A5A;--sep:#122030;
--fg:#FFFFFF;--fg2:#B5C8D8;--muted:#7FA8C8;--faint:#4F7194;
--accent:#00C8E8;--ok:#00E8A0;--warn:#FFB830;--bad:#FF4D6A;--sky:#6FB6FF;--ai:#8EA2FF;--mail:#FFD080;
--num:ui-rounded,"SF Pro Rounded",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color-scheme:dark}
*{box-sizing:border-box}
html{background:var(--deep)}
body{margin:0;min-height:100vh;color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent;
padding:calc(env(safe-area-inset-top,0px) + 14px) 16px calc(env(safe-area-inset-bottom,0px) + 32px);
background:radial-gradient(900px 420px at 8% -6%,rgba(52,110,200,.32),transparent 62%),radial-gradient(700px 380px at 104% 2%,rgba(60,70,170,.12),transparent 60%),linear-gradient(180deg,#0C1C35 0%,#0A1628 40%,#091424 70%,#060C18 100%)}
a{color:var(--accent);text-decoration:none}
button{font:inherit;color:inherit}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

function loginPage(message: string): string {
  const msg = message ? `<p class="err">${message}</p>` : '';
  return `<!doctype html><html lang="sv"><head>${HEAD}<title>Blades Ops</title><style>${BASE_CSS}
.box{max-width:22rem;margin:14vh auto 0;display:flex;flex-direction:column;gap:14px}
.logo{width:60px;height:60px;border-radius:15px;box-shadow:0 8px 28px rgba(0,200,232,.18)}
h1{font-size:28px;margin:0;letter-spacing:-.5px}p{margin:0;color:var(--muted)}.err{color:var(--bad)}
input{font:inherit;padding:14px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--fg)}
button{font-weight:650;padding:14px;border:0;border-radius:14px;background:var(--accent);color:#04121C;cursor:pointer}</style></head>
<body><form class="box" method="post" action="/ops/login"><img class="logo" src="/assets/ops-icon-180.png" alt=""><h1>Blades Ops</h1><p>Logga in för att se hur appen mår.</p>${msg}
<input id="password" name="password" type="password" autocomplete="current-password" placeholder="Lösenord" aria-label="Lösenord" required autofocus>
<button type="submit">Logga in</button></form></body></html>`;
}

// Klientskriptet ligger i en template literal: inga backticks, inga dollar-klammer och inga bakåtsnedstreck i det.
const OPS_PAGE = `<!doctype html><html lang="sv"><head>${HEAD}<title>Blades Ops</title><style>${BASE_CSS}
.wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.top{display:flex;align-items:center;gap:12px}
.top img{width:42px;height:42px;border-radius:12px;box-shadow:0 6px 20px rgba(0,200,232,.16)}
.top .t{flex:1;min-width:0}
.top h1{font-size:24px;line-height:1.1;margin:0;letter-spacing:-.5px}
.sub{color:var(--muted);font-size:12.5px;margin-top:3px}
.iconbtn{width:42px;height:42px;border-radius:13px;border:1px solid var(--border);background:rgba(15,30,58,.8);font-size:19px;cursor:pointer;display:grid;place-items:center}
.iconbtn.spin span{display:inline-block;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.hero{--tone:var(--ok);border-radius:22px;padding:16px;border:1px solid var(--border);display:flex;flex-direction:column;gap:12px;
background:linear-gradient(160deg,var(--elev),var(--surface));
background:radial-gradient(130% 150% at 0% 0%,color-mix(in srgb,var(--tone) 16%,transparent),transparent 58%),linear-gradient(160deg,var(--elev),var(--surface))}
.hero.warn{--tone:var(--warn)}.hero.bad{--tone:var(--bad)}
.hero .h{display:flex;align-items:center;gap:14px}
.pulse{position:relative;width:12px;height:12px;border-radius:50%;background:var(--tone);flex:none;margin:0 2px}
.pulse::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid var(--tone);opacity:.3}
.ht{font-size:20px;font-weight:700;letter-spacing:-.3px;line-height:1.2}
.hs{font-size:13px;color:var(--muted);margin-top:2px}
.alerts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.alerts a,.alerts .row{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:14px;background:rgba(6,12,24,.5);color:var(--fg);font-size:14px;line-height:1.35}
.alerts .dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none}
.alerts .tx{flex:1;min-width:0;overflow-wrap:anywhere}
.alerts .chev{color:var(--faint);font-size:18px;line-height:1;flex:none}
.l-bad .dot{background:var(--bad)}.l-warn .dot{background:var(--warn)}.l-good .dot{background:var(--ok)}.l-info .dot{background:var(--accent)}
.mon{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);padding-top:2px}
.mdot{width:7px;height:7px;border-radius:50%;background:var(--ok)}.mdot.warn{background:var(--warn)}
.linkbtn{border:0;background:none;padding:0;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;margin-left:auto}
.linkbtn:disabled{color:var(--muted);cursor:default}

.segrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.seghint{font-size:12px;color:var(--faint)}
.seg{display:inline-flex;padding:3px;border-radius:13px;background:rgba(15,30,58,.85);border:1px solid var(--border)}
.seg button{font-size:13px;font-weight:650;padding:7px 15px;border-radius:10px;border:0;background:transparent;color:var(--muted);cursor:pointer}
.seg button[aria-pressed=true]{background:var(--elev);color:var(--fg);box-shadow:0 1px 0 rgba(255,255,255,.05) inset}

.kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:760px){.kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
.kpi{border-radius:18px;padding:12px 12px 0;background:rgba(15,30,58,.82);border:1px solid var(--border);min-width:0;overflow:hidden;display:flex;flex-direction:column}
.kpi .l{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .l i{width:7px;height:7px;border-radius:50%;flex:none}
.kpi .v{font-family:var(--num);font-size:26px;font-weight:700;letter-spacing:-.5px;font-variant-numeric:tabular-nums;line-height:1.1;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl{font-size:11.5px;font-weight:600;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
.dl.up{color:var(--ok)}.dl.down{color:var(--bad)}
.kpi .sp,.kpi .sp0{display:block;width:calc(100% + 24px);height:30px;margin:6px -12px 0}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));gap:12px;align-items:start}
.card{background:linear-gradient(180deg,rgba(21,35,56,.94),rgba(15,30,58,.94));border:1px solid var(--border);border-radius:22px;padding:16px;min-width:0;box-shadow:0 10px 30px rgba(0,0,0,.16)}
.card h2{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:650;margin:0 0 14px;letter-spacing:-.2px}
.card h2 .sw{width:9px;height:9px;border-radius:50%;background:var(--c,var(--accent))}
.card h2 a{margin-left:auto;font-size:13px;font-weight:600;color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:650;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.06);margin-bottom:14px}
.chip::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.chip.ok{color:var(--ok)}.chip.warn{color:var(--warn)}.chip.bad{color:var(--bad)}.chip.info{color:var(--accent)}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px}
.stat{min-width:0}
.stat .v{font-family:var(--num);font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stat .l{font-size:12px;color:var(--muted);margin-top:2px}
.chart{position:relative;margin-top:18px}
.chart svg{display:block;width:100%;height:auto;overflow:visible;touch-action:pan-y;-webkit-user-select:none;user-select:none}
.cap{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12.5px;color:var(--fg2);margin-bottom:6px}
.cap b{font-family:var(--num);font-size:14.5px;font-weight:700;color:var(--fg);font-variant-numeric:tabular-nums;white-space:nowrap}
.cap .since{color:var(--faint);font-size:11.5px;margin-left:6px}
.tip{position:absolute;top:-4px;pointer-events:none;background:#081325;border:1px solid var(--border);border-radius:10px;padding:5px 9px;font-size:12px;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.4);z-index:2}
.tip .td{color:var(--muted);margin-right:4px}
.tip b{font-family:var(--num)}
.list{margin:14px 0 0;padding:0;list-style:none;display:flex;flex-direction:column}
.list li{font-size:13.5px;padding:10px 0;border-top:1px solid var(--sep);min-width:0}
.list .t{overflow-wrap:anywhere}.list .m{color:var(--muted);font-size:12px;margin-top:2px}
.stars{color:var(--warn);letter-spacing:1px}.stars s{color:var(--border);text-decoration:none}
.note{color:var(--muted);font-size:12.5px;margin:10px 0 0}
.err{color:var(--warn);font-size:13.5px;margin:0}
.h3{font-size:11.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--faint);margin:18px 0 6px}
.meter{margin-top:10px}
.meter .ml{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--fg2)}
.meter .ml b{font-family:var(--num);font-weight:650;color:var(--fg);font-variant-numeric:tabular-nums}
.bar{height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;border-radius:99px;background:var(--accent)}
.bar.warn i{background:var(--warn)}.bar.bad i{background:var(--bad)}
.gauge{height:10px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:14px}
.gauge i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--ai),var(--accent))}

.tasks textarea{width:100%;font:inherit;font-size:15px;padding:12px;border-radius:14px;border:1px solid var(--border);background:rgba(6,12,24,.55);color:var(--fg);resize:vertical;min-height:84px}
.tasks textarea::placeholder{color:var(--faint)}
.btn{font-size:14px;font-weight:650;padding:10px 15px;border-radius:12px;border:0;background:var(--accent);color:#04121C;cursor:pointer}
.btn:disabled{opacity:.5;cursor:default}
.btn.ghost{background:rgba(255,255,255,.06);color:var(--fg);border:1px solid var(--border)}
.btn.small{font-size:12.5px;padding:6px 11px;border-radius:10px}
.btn.armed{background:var(--bad);color:#fff;border-color:var(--bad)}
.row2{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.hint{color:var(--muted);font-size:12.5px;flex:1;min-width:12rem}
.task{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-top:1px solid var(--sep)}
.task .t{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14.5px}
.task .m{font-size:12px;color:var(--muted)}
.task.done .t{color:var(--fg2)}
.task .nt{font-size:13px;color:var(--ok);white-space:pre-wrap;overflow-wrap:anywhere}
.task .acts{display:flex;gap:8px}
.links{display:flex;flex-wrap:wrap;gap:8px}
.links a{font-size:13.5px;padding:8px 12px;border-radius:11px;background:rgba(255,255,255,.05);border:1px solid var(--border)}
.skel{color:var(--muted);font-size:13.5px}
@media (prefers-reduced-motion:no-preference){
.pulse::after{animation:ring 2.6s ease-out infinite}
@keyframes ring{0%{transform:scale(.55);opacity:.6}100%{transform:scale(1.7);opacity:0}}
.card,.kpi,.hero{animation:rise .35s ease-out both}
@keyframes rise{from{opacity:.4;transform:translateY(4px)}to{opacity:1;transform:none}}}
</style></head><body><div class="wrap">
<header class="top"><img src="/assets/ops-icon-180.png" alt=""><div class="t"><h1>Blades Ops</h1><div class="sub" id="updated">Hämtar…</div></div>
<button class="iconbtn" id="refresh" type="button" aria-label="Uppdatera"><span>↻</span></button></header>
<section class="hero" id="hero" aria-live="polite"><div class="h"><span class="pulse"></span><div><div class="ht">Hämtar läget…</div></div></div></section>
<div class="segrow"><div class="seg" role="group" aria-label="Period"><button type="button" data-range="7" aria-pressed="true">7 dagar</button><button type="button" data-range="30" aria-pressed="false">30 dagar</button></div><span class="seghint" id="seghint">▲▼ jämför med veckan innan</span></div>
<section class="kpis" id="kpis" aria-label="Nyckeltal"></section>
<div class="grid">
<section class="card" id="c-rev" style="--c:var(--ok)"><h2><span class="sw"></span>Intäkter</h2><p class="skel">Hämtar…</p></section>
<section class="card" id="c-app" style="--c:var(--accent)"><h2><span class="sw"></span>App Store</h2><p class="skel">Hämtar…</p></section>
<section class="card" id="c-stab" style="--c:var(--sky)"><h2><span class="sw"></span>Stabilitet</h2><p class="skel">Hämtar…</p></section>
<section class="card" id="c-traffic" style="--c:var(--sky)"><h2><span class="sw"></span>Trafik</h2><p class="skel">Hämtar…</p></section>
<section class="card" id="c-ai" style="--c:var(--ai)"><h2><span class="sw"></span>AI</h2><p class="skel">Hämtar…</p></section>
<section class="card" id="c-mail" style="--c:var(--mail)"><h2><span class="sw"></span>Supportmejl</h2><p class="skel">Hämtar…</p></section>
<section class="card tasks" id="c-tasks" style="--c:var(--accent)"><h2><span class="sw"></span>Uppgifter till Claude</h2>
<textarea id="task-text" aria-label="Ny uppgift till Claude" placeholder="Vad ska Claude göra? T.ex. &quot;Byt texten på köpknappen till Get Premium&quot;"></textarea>
<div class="row2"><button class="btn" id="task-send" type="button">Skicka till Claude</button><span class="hint" id="task-hint"></span></div>
<div id="task-list"><p class="skel">Hämtar…</p></div></section>
<section class="card" id="c-dates" style="--c:var(--warn)"><h2><span class="sw"></span>Datum att bevaka</h2><p class="skel">Hämtar…</p></section>
<section class="card" style="--c:var(--fg2)"><h2><span class="sw"></span>Genvägar</h2><div class="links">
<a href="https://appstoreconnect.apple.com/apps/6798360464/appstore" target="_blank" rel="noopener noreferrer">App Store Connect</a>
<a href="https://app.revenuecat.com/" target="_blank" rel="noopener noreferrer">RevenueCat</a>
<a href="https://jesper-toreld.sentry.io/issues/" target="_blank" rel="noopener noreferrer">Sentry</a>
<a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Cloudflare</a>
<a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer">Anthropic</a>
<a href="https://mail.google.com/" target="_blank" rel="noopener noreferrer">Gmail</a>
<a href="https://blades-app.com/" target="_blank" rel="noopener noreferrer">blades-app.com</a>
<a href="https://claude.ai/artifact/HxbZx36SF78Bz1mVZZtCeo" target="_blank" rel="noopener noreferrer">Kontrollrum</a>
</div><p class="note"><a href="/ops/logout">Logga ut</a></p></section>
</div></div>
<script>
(function () {
  'use strict';
  var D = null, RANGE = 7, uid = 0;
  try { RANGE = Number(localStorage.getItem('ops-range')) === 30 ? 30 : 7; } catch (e) {}
  if (location.hash === '#30') RANGE = 30; // /ops#30 öppnar 30-dagarsvyn direkt
  // Samma färger som CSS-variablerna.
  var C = { accent: '#00C8E8', ok: '#00E8A0', warn: '#FFB830', bad: '#FF4D6A', sky: '#6FB6FF', ai: '#8EA2FF', mail: '#FFD080', grid: '#16304F', axis: '#6487A8', zero: '#203F63', rule: '#B5C8D8' };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n, d) { return n == null || isNaN(n) ? '–' : Number(n).toLocaleString('sv-SE', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); };
  var short = function (v) {
    var a = Math.abs(v);
    if (a >= 1e6) return fmt(v / 1e6, a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return fmt(v / 1e3, a >= 1e4 ? 0 : 1) + 'k';
    return fmt(v, a === 0 || a >= 10 || v % 1 === 0 ? 0 : a < 1 ? 2 : 1);
  };
  var usd = function (n) { return n == null ? '–' : '$' + fmt(n, n > 0 && n < 0.1 ? 3 : 2); };
  var pct = function (r) { return r == null ? '–' : fmt(r * 100, r >= 0.9995 ? 0 : 1) + ' %'; };
  var dayLabel = function (d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }); };
  var ago = function (t) {
    if (!t) return 'aldrig';
    var s = (Date.now() - (typeof t === 'number' ? t : Date.parse(t))) / 1000;
    if (s < 90) return 'nyss';
    if (s < 5400) return Math.round(s / 60) + ' min sedan';
    if (s < 129600) return Math.round(s / 3600) + ' tim sedan';
    return Math.round(s / 86400) + ' dagar sedan';
  };
  var link = function (href, text) { return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>' : esc(text); };
  var stat = function (v, l) { return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + esc(l) + '</div></div>'; };
  var slice = function (pts) { return (pts || []).slice(-RANGE); };
  var sum = function (pts) { return pts.reduce(function (a, p) { return a + (p.v || 0); }, 0); };
  var total = function (pts) { return sum(slice(pts)); };
  var gaps = function (pts) { return slice(pts).some(function (p) { return p.v == null; }); };
  var lowest = function (pts) {
    var v = slice(pts).map(function (p) { return p.v; }).filter(function (x) { return x != null; });
    return v.length ? Math.min.apply(null, v) : null;
  };
  // Kraschfria sessioner över vald period, viktat med antal sessioner per dag.
  var crashFree = function (S) {
    var s = slice(S.sessions), c = slice(S.crashFree), all = 0, fine = 0;
    s.forEach(function (p, i) { if (p.v) { all += p.v; fine += p.v * (c[i] && c[i].v != null ? c[i].v : 1); } });
    return all ? fine / all : null;
  };
  var niceMax = function (v, int) {
    if (!(v > 0)) return int ? 2 : 1;
    if (int && v <= 8) return Math.max(2, Math.ceil(v / 2) * 2);
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    var m = int ? (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10);
    return m * e;
  };

  // Diagram: staplar eller linje med yta, tre stödlinjer, datum under och värdet vid tryck eller hovring.
  function chart(el, all, o) {
    var pts = slice(all), n = pts.length;
    var W = Math.max(240, Math.round(el.clientWidth || 300)), H = o.h || 120, L = 36, R = 4, T = 6, B = 20;
    var vals = pts.filter(function (p) { return p.v != null; }).map(function (p) { return p.v; });
    var dmax = vals.length ? Math.max.apply(null, vals) : 0, dmin = vals.length ? Math.min.apply(null, vals) : 0;
    var min = o.min != null ? o.min : Math.min(0, dmin), max = o.max != null ? o.max : niceMax(dmax, o.int);
    if (max <= min) max = min + 1;
    var axis = o.axis || short, tipf = o.tip || function (v) { return fmt(v); };
    var y = function (v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); };
    var band = (W - L - R) / Math.max(1, n), xc = function (i) { return L + band * i + band / 2; };
    var color = o.color || C.accent, id = 'g' + (++uid), s = '';
    s += '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".34"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
    [min, (min + max) / 2, max].forEach(function (v) {
      var yy = y(v);
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="' + C.grid + '" stroke-width="1"/>';
      s += '<text x="' + (L - 7) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + C.axis + '">' + esc(axis(v)) + '</text>';
    });
    if (o.ref != null && o.ref > min && o.ref < max) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(o.ref).toFixed(1) + '" y2="' + y(o.ref).toFixed(1) + '" stroke="' + C.warn + '" stroke-opacity=".7" stroke-dasharray="3 4"/>';
    }
    (n > 1 ? [0, Math.round((n - 1) / 2), n - 1] : [0]).forEach(function (i) {
      var anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
      var x = anchor === 'start' ? L : anchor === 'end' ? W - R : xc(i);
      s += '<text x="' + x.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="' + anchor + '" font-size="10" fill="' + C.axis + '">' + esc(dayLabel(pts[i].d)) + '</text>';
    });
    if (!vals.length) {
      s += '<text x="' + ((L + W - R) / 2).toFixed(1) + '" y="' + ((H - B) / 2 + 6).toFixed(1) + '" text-anchor="middle" font-size="12" fill="' + C.axis + '">Ingen data än</text>';
    } else if (o.type === 'line') {
      var path = '', fx = null, lx = null, ly = null;
      pts.forEach(function (p, i) {
        if (p.v == null) return;
        var X = xc(i).toFixed(1), Y = y(p.v).toFixed(1);
        path += (path ? 'L' : 'M') + X + ' ' + Y;
        if (fx == null) fx = X;
        lx = X; ly = Y;
      });
      var base = y(min).toFixed(1);
      s += '<path d="' + path + 'L' + lx + ' ' + base + 'L' + fx + ' ' + base + 'Z" fill="url(#' + id + ')"/>';
      s += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
      s += '<circle cx="' + lx + '" cy="' + ly + '" r="6" fill="' + color + '" fill-opacity=".22"/><circle cx="' + lx + '" cy="' + ly + '" r="3" fill="' + color + '"/>';
    } else {
      var bw = Math.max(2, Math.min(18, band * (n > 14 ? 0.62 : 0.5)));
      pts.forEach(function (p, i) {
        if (p.v == null) return;
        var top = p.v > 0 ? y(p.v) : y(min) - 2, h = Math.max(2, y(min) - top);
        s += '<rect x="' + (xc(i) - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(3, bw / 2).toFixed(1) + '" fill="' + (p.v > 0 ? color : C.zero) + '"' + (p.v > 0 && i < n - 1 ? ' fill-opacity=".8"' : '') + '/>';
      });
    }
    s += '<line class="rule" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="' + C.rule + '" stroke-opacity=".35" visibility="hidden"/>';
    var first = -1;
    pts.some(function (p, i) { if (p.v != null) { first = i; return true; } return false; });
    var since = first > 0 ? '<span class="since">från ' + esc(dayLabel(pts[first].d)) + '</span>' : '';
    el.innerHTML = '<div class="cap"><span>' + esc(o.title) + since + '</span><b>' + esc(o.total == null ? '' : o.total) + '</b></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(o.title) + '">' + s + '</svg><div class="tip" hidden></div>';
    var svg = el.querySelector('svg'), tip = el.querySelector('.tip'), rule = svg.querySelector('.rule');
    var show = function (ev) {
      var box = svg.getBoundingClientRect();
      if (!box.width || !n) return;
      var x = (ev.clientX - box.left) * (W / box.width), i = Math.max(0, Math.min(n - 1, Math.floor((x - L) / band))), p = pts[i];
      rule.setAttribute('x1', xc(i)); rule.setAttribute('x2', xc(i)); rule.setAttribute('visibility', 'visible');
      tip.innerHTML = '<span class="td">' + esc(dayLabel(p.d)) + '</span><b>' + esc(p.v == null ? 'ingen data' : tipf(p.v)) + '</b>';
      tip.hidden = false;
      var px = xc(i) * (box.width / W) - tip.offsetWidth / 2;
      tip.style.left = Math.max(0, Math.min(box.width - tip.offsetWidth, px)) + 'px';
    };
    var hide = function () { tip.hidden = true; rule.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') hide(); });
    el.hideTip = hide;
  }
  document.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest && ev.target.closest('.chart')) return;
    document.querySelectorAll('.chart').forEach(function (c) { if (c.hideTip) c.hideTip(); });
  });

  // Minikurva i nyckeltalsrutorna.
  function spark(all, color, lo) {
    var pts = slice(all), have = pts.filter(function (p) { return p.v != null; });
    if (have.length < 2) return '<div class="sp0"></div>';
    var vals = have.map(function (p) { return p.v; }), max = Math.max.apply(null, vals), min = lo != null ? lo : Math.min(0, Math.min.apply(null, vals));
    if (max <= min) max = min + 1;
    var n = pts.length, d = '', fx = null, lx = 0;
    pts.forEach(function (p, i) {
      if (p.v == null) return;
      var X = n > 1 ? (i / (n - 1)) * 100 : 50, Y = 3 + (1 - (p.v - min) / (max - min)) * 24;
      d += (d ? 'L' : 'M') + X.toFixed(2) + ' ' + Y.toFixed(2);
      if (fx == null) fx = X.toFixed(2);
      lx = X.toFixed(2);
    });
    var id = 's' + (++uid);
    return '<svg class="sp" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".3"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + 'L' + lx + ' 30L' + fx + ' 30Z" fill="url(#' + id + ')"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }

  // Förändring mot förra veckan (bara i 7-dagarsvyn, och bara när hela förra veckan finns).
  function delta(pts, better) {
    if (RANGE !== 7 || !pts || pts.length < 14) return '';
    var prevPts = pts.slice(-14, -7);
    if (prevPts.some(function (p) { return p.v == null; })) return '';
    var cur = sum(pts.slice(-7)), prev = sum(prevPts);
    if (!prev && !cur) return '<div class="dl">oförändrat</div>';
    if (!prev) return '<div class="dl">ny aktivitet</div>';
    var ch = (cur - prev) / prev, cls = Math.abs(ch) < 0.005 || !better ? '' : (ch > 0) === (better > 0) ? 'up' : 'down';
    return '<div class="dl ' + cls + '">' + (ch > 0.0049 ? '▲ ' : ch < -0.0049 ? '▼ ' : '') + fmt(Math.abs(ch) * 100, 0) + ' %</div>';
  }
  var dayDelta = function (cur, prev) {
    if (cur == null || prev == null || cur === prev) return '';
    return '<div class="dl ' + (cur > prev ? 'up' : 'down') + '">' + (cur > prev ? '+' : '−') + fmt(Math.abs(cur - prev)) + ' sedan i går</div>';
  };
  var kpi = function (label, value, color, dl, sp) {
    return '<div class="kpi"><div class="l"><i style="background:' + color + '"></i>' + esc(label) + '</div><div class="v">' + value + '</div>' + (dl || '<div class="dl"></div>') + (sp || '<div class="sp0"></div>') + '</div>';
  };
  var head = function (title, href) { return '<h2><span class="sw"></span>' + esc(title) + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Öppna ↗</a>' : '') + '</h2>'; };
  var failed = function (r) { return '<p class="err">' + esc(r ? r.error : 'Ingen data') + '</p>'; };
  var box = function () { return '<div class="chart"></div>'; };
  var meter = function (label, v, limit) {
    if (v == null) return '';
    var p = Math.min(1, v / limit), cls = p >= 0.9 ? 'bad' : p >= 0.7 ? 'warn' : '';
    return '<div class="meter"><div class="ml"><span>' + esc(label) + '</span><b>' + fmt(v) + ' / ' + fmt(limit) + '</b></div><div class="bar ' + cls + '"><i style="width:' + Math.max(1, p * 100).toFixed(1) + '%"></i></div></div>';
  };

  function renderHero(d) {
    var al = (d.alerts || []).filter(function (a) { return a.page !== false; });
    var need = al.filter(function (a) { return a.level === 'bad' || a.level === 'warn' || a.act; }).length;
    var tone = al.some(function (a) { return a.level === 'bad'; }) ? 'bad' : need ? 'warn' : 'ok';
    var title = need ? (need === 1 ? '1 sak kräver dig' : need + ' saker kräver dig') : 'Allt ser lugnt ut';
    var sub = need ? 'Tryck på en rad för att öppna rätt ställe.' : 'Inget behöver göras just nu. Du får ett mejl om något dyker upp.';
    var list = al.map(function (a) {
      var inner = '<span class="dot"></span><span class="tx">' + esc(a.text) + '</span>' + (a.href ? '<span class="chev" aria-hidden="true">›</span>' : '');
      return '<li class="l-' + a.level + '">' + (a.href ? '<a href="' + esc(a.href) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>' : '<div class="row">' + inner + '</div>') + '</li>';
    }).join('');
    var m = d.monitor || {};
    var mt = { ready: 'Larmmejl på', off: 'Larmmejl avstängda', 'no-binding': 'Larmmejl inte kopplade än', 'no-recipient': 'Mottagare för larmmejl saknas' }[m.mail] || 'Larmmejl';
    var mon = '<div class="mon"><span class="mdot' + (m.mail === 'ready' ? '' : ' warn') + '"></span><span>' + esc(mt) + ' · ' + (m.at ? 'kollade ' + esc(ago(m.at)) : 'första kollen inom en timme') + '</span>' +
      (m.mail === 'ready' ? '<button class="linkbtn" type="button" data-test-mail>Skicka testmejl</button>' : '') + '</div>' +
      (m.lastError ? '<p class="err">Senaste larmmejlet gick inte iväg: ' + esc(m.lastError) + '</p>' : '');
    var h = $('hero');
    h.className = 'hero ' + tone;
    h.innerHTML = '<div class="h"><span class="pulse"></span><div><div class="ht">' + esc(title) + '</div><div class="hs">' + esc(sub) + '</div></div></div>' + (list ? '<ul class="alerts">' + list + '</ul>' : '') + mon;
  }

  function render() {
    var d = D;
    if (!d) return;
    var get = function (k) { return d[k] && d[k].ok ? d[k].data : null; };
    var A = get('appStore'), RV = get('revenue'), S = get('stability'), TR = get('traffic'), AI = get('ai'), M = get('support');
    renderHero(d);

    var k = '';
    k += kpi('Betalande kunder', RV ? fmt(RV.active) : '–', C.ok, RV ? dayDelta(RV.active, RV.activeYesterday) : '', RV ? spark(RV.activeSeries, C.ok) : '');
    k += kpi('MRR', RV ? esc(RV.unit) + fmt(RV.mrr, 2) : '–', C.ok, '', RV ? spark(RV.mrrSeries, C.ok) : '');
    k += kpi('Nedladdningar', A ? fmt(total(A.downloads)) : '–', C.accent, A ? delta(A.downloads, 1) : '', A ? spark(A.downloads, C.accent) : '');
    k += kpi('Sessioner i appen', S ? fmt(total(S.sessions)) : '–', C.sky, S ? delta(S.sessions, 1) : '', S ? spark(S.sessions, C.sky) : '');
    k += kpi('Kraschfria sessioner', S ? pct(crashFree(S)) : '–', C.ok, '', S ? spark(S.crashFree, C.ok, Math.min(0.95, lowest(S.crashFree) == null ? 1 : lowest(S.crashFree))) : '');
    k += kpi('Besök på sajten', TR ? fmt(total(TR.visits)) : '–', C.sky, TR ? delta(TR.visits, 1) : '', TR ? spark(TR.visits, C.sky) : '');
    k += kpi('AI-kostnad', AI ? usd(total(AI.cost)) : '–', C.ai, AI ? delta(AI.cost, -1) : '', AI ? spark(AI.cost, C.ai) : '');
    k += kpi('Supportmejl', M ? fmt(total(M.mails)) : '–', C.mail, M ? delta(M.mails, 0) : '', M ? spark(M.mails, C.mail) : '');
    $('kpis').innerHTML = k;

    var el = $('c-rev'), c;
    if (RV) {
      el.innerHTML = head('Intäkter', RV.link) + '<div class="stats">' + stat(fmt(RV.active), 'Betalande kunder') + stat(esc(RV.unit) + fmt(RV.mrr, 2), 'MRR (intäkt per månad)') +
        stat(esc(RV.unit) + fmt(RV.revenue28, 2), 'Intäkt, 28 dagar') + stat(fmt(RV.new28), 'Nya appanvändare, 28 dagar') + '</div>' + box() + box() +
        (gaps(RV.activeSeries) ? '<p class="note">Graferna fylls på en dag i taget, eftersom RevenueCat bara ger dagens läge.</p>' : '');
      c = el.querySelectorAll('.chart');
      chart(c[0], RV.activeSeries, { type: 'line', int: true, color: C.ok, title: 'Betalande kunder', total: fmt(RV.active) });
      chart(c[1], RV.mrrSeries, { type: 'line', color: C.ok, title: 'MRR', total: RV.unit + fmt(RV.mrr, 2), axis: function (v) { return RV.unit + short(v); }, tip: function (v) { return RV.unit + fmt(v, 2); } });
    } else el.innerHTML = head('Intäkter') + failed(d.revenue);

    el = $('c-app');
    if (A) {
      var st = A.state || '', lvl = /^(REJECTED|METADATA_REJECTED|INVALID_BINARY)$/.test(st) ? 'bad' : st === 'PENDING_DEVELOPER_RELEASE' ? 'warn' : /^READY_FOR_(SALE|DISTRIBUTION)$/.test(st) ? 'ok' : 'info';
      var rev = (A.reviews || []).slice(0, 3).map(function (r) {
        return '<li><div class="t"><span class="stars">' + '★'.repeat(r.rating) + '<s>' + '★'.repeat(5 - r.rating) + '</s></span> ' + esc(r.title) + '</div><div class="m">' + esc(r.date ? dayLabel(r.date) : '') + ' · ' + esc(r.territory) + (r.body ? ' · ' + esc(r.body.slice(0, 110)) : '') + '</div></li>';
      }).join('');
      el.innerHTML = head('App Store', A.link) + '<span class="chip ' + lvl + '">' + esc(A.stateLabel || 'Okänt läge') + (A.version ? ' · ' + esc(A.version) : '') + '</span>' +
        (A.liveVersion && A.liveVersion !== A.version ? '<p class="note" style="margin:-6px 0 12px">' + esc(A.liveVersion) + ' ligger ute i App Store.</p>' : '') +
        '<div class="stats">' + stat(A.rating != null ? '★ ' + fmt(A.rating, 1) : '–', A.ratingCount ? fmt(A.ratingCount) + ' betyg i Sverige' : 'Inga betyg än') + stat(fmt(total(A.downloads)), 'Nedladdningar, ' + RANGE + ' dagar') + '</div>' +
        box() + (A.downloadsNote ? '<p class="note">' + esc(A.downloadsNote) + '</p>' : '') + (rev ? '<div class="h3">Senaste recensionerna</div><ul class="list" style="margin-top:0">' + rev + '</ul>' : '');
      chart(el.querySelector('.chart'), A.downloads, { int: true, color: C.accent, title: 'Nedladdningar per dag', total: fmt(total(A.downloads)) });
    } else el.innerHTML = head('App Store') + failed(d.appStore);

    el = $('c-stab');
    if (S) {
      var top = (S.top || []).map(function (i) { return '<li><div class="t">' + link(i.url, i.title) + '</div><div class="m">' + fmt(i.count) + ' gånger · ' + fmt(i.users) + ' användare · ' + esc(ago(i.lastSeen)) + '</div></li>'; }).join('');
      var cf = crashFree(S), lo = lowest(S.crashFree);
      el.innerHTML = head('Stabilitet', S.link) + '<div class="stats">' + stat(pct(cf), 'Kraschfria sessioner, ' + RANGE + ' d') + stat(fmt(S.unresolved), 'Olösta fel') +
        stat(fmt(total(S.sessions)), 'Sessioner, ' + RANGE + ' d') + stat(S.new24h == null ? '–' : fmt(S.new24h), 'Nya fel, senaste dygnet') + '</div>' + box() + box() +
        (top ? '<div class="h3">Vanligaste felen</div><ul class="list" style="margin-top:0">' + top + '</ul>' : '');
      c = el.querySelectorAll('.chart');
      chart(c[0], S.sessions, { int: true, color: C.sky, title: 'Sessioner per dag', total: fmt(total(S.sessions)) });
      chart(c[1], S.crashFree, { type: 'line', color: C.ok, title: 'Kraschfria sessioner', total: pct(cf), min: Math.min(0.95, lo == null ? 1 : Math.floor(lo * 20) / 20), max: 1, ref: 0.99,
        axis: function (v) { return fmt(v * 100, 0) + ' %'; }, tip: function (v) { return pct(v); } });
    } else el.innerHTML = head('Stabilitet') + failed(d.stability);

    el = $('c-traffic');
    if (TR) {
      var lim = TR.limits || {};
      el.innerHTML = head('Trafik', TR.link) + box() + '<p class="note">' + esc(TR.siteNote || 'Räknar alla besök, även robotar och sökmotorer.') + '</p>' + box() +
        '<div class="stats" style="margin-top:16px">' + stat(fmt(total(TR.workerRequests)), 'Anrop till proxyn, ' + RANGE + ' d') + stat(fmt(total(TR.workerErrors)), 'Fel i proxyn, ' + RANGE + ' d') + '</div>' +
        '<div class="h3">Gratisgränser i dag</div>' + meter('Anrop till proxyn', lim.workerToday, lim.workerLimit) + meter('KV-skrivningar (hela kontot)', lim.kvWritesToday, lim.kvLimit) +
        '<p class="note">Nollställs vid midnatt UTC. Du får ett mejl vid 70 %.</p>';
      c = el.querySelectorAll('.chart');
      chart(c[0], TR.visits, { int: true, color: C.sky, title: 'Besök på blades-app.com', total: fmt(total(TR.visits)) });
      chart(c[1], TR.workerRequests, { type: 'line', int: true, color: C.accent, title: 'Anrop till proxyn (appen)', total: fmt(total(TR.workerRequests)) });
    } else el.innerHTML = head('Trafik') + failed(d.traffic);

    el = $('c-ai');
    if (AI) {
      var left = AI.creditStart ? Math.max(0, 1 - (AI.creditSpent || 0) / AI.creditStart) : 0;
      var mods = (AI.models || []).map(function (q) { return '<li><div class="t">' + esc(q.model) + '</div><div class="m">' + fmt(q.requests) + ' anrop · ' + usd(q.cost) + ' senaste 7 d</div></li>'; }).join('');
      var fb = (AI.fallbacks || []).map(function (f) { return '<li><div class="t">' + esc(f) + '</div><div class="m">Bytt automatiskt senaste dygnet</div></li>'; }).join('');
      el.innerHTML = head('AI', AI.link) + '<div class="stats">' + stat(AI.creditLeft != null ? usd(AI.creditLeft) : '–', 'Kvar av krediten (uppskattat)') + stat(usd(total(AI.cost)), 'Kostnad, ' + RANGE + ' d') + '</div>' +
        (AI.creditStart ? '<div class="gauge" role="img" aria-label="Kvar av krediten"><i style="width:' + Math.max(2, left * 100).toFixed(1) + '%"></i></div><p class="note">' + usd(AI.creditStart) + ' den ' + esc(AI.creditSince) + '. Stapeln visar hur mycket som är kvar.</p>' : '') +
        box() + box() + '<div class="stats" style="margin-top:16px">' + stat(fmt(AI.requests24h), 'Anrop, senaste dygnet') + stat(fmt(AI.errors24h), 'Misslyckade, senaste dygnet') + '</div>' +
        (mods ? '<div class="h3">Modeller</div><ul class="list" style="margin-top:0">' + mods + fb + '</ul>' : '');
      c = el.querySelectorAll('.chart');
      chart(c[0], AI.requests, { int: true, color: C.ai, title: 'Anrop per dag', total: fmt(total(AI.requests)) });
      chart(c[1], AI.cost, { type: 'line', color: C.ai, title: 'Kostnad per dag', total: usd(total(AI.cost)), axis: function (v) { return '$' + short(v); }, tip: function (v) { return usd(v); } });
    } else el.innerHTML = head('AI') + failed(d.ai);

    el = $('c-mail');
    if (M) {
      el.innerHTML = head('Supportmejl', M.link) + '<div class="stats">' + stat(fmt(M.today), 'I dag') + stat(esc(ago(M.last)), 'Senaste mejlet') + '</div>' + box() +
        (M.counting ? '<p class="note">Räknar mejl till support@blades-app.com. Bara antal och tid sparas, aldrig innehållet.</p>' : '<p class="note">Räkningen startar när support@ skickas via Workern.</p>');
      chart(el.querySelector('.chart'), M.mails, { int: true, color: C.mail, title: 'Mejl per dag', total: fmt(total(M.mails)) });
    } else el.innerHTML = head('Supportmejl') + failed(d.support);

    var dates = (d.deadlines || []).map(function (x) {
      var cl = x.daysLeft <= 7 ? 'bad' : x.daysLeft <= 30 ? 'warn' : 'info';
      return '<li><div class="t">' + link(x.href, x.text) + '</div><div class="m"><span class="chip ' + cl + '" style="margin:6px 0 0;font-size:11.5px;padding:3px 9px">om ' + fmt(x.daysLeft) + ' dagar · ' + esc(x.date) + '</span></div></li>';
    }).join('');
    $('c-dates').innerHTML = head('Datum att bevaka') + '<ul class="list" style="margin-top:0">' + dates + '</ul><p class="note">Du får ett mejl 30 dagar innan.</p>';

    $('updated').textContent = 'Uppdaterad ' + new Date(d.at).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // Testmejl
  $('hero').addEventListener('click', function (e) {
    var b = e.target.closest('[data-test-mail]');
    if (!b) return;
    b.disabled = true;
    b.textContent = 'Skickar…';
    fetch('/ops/alerts/test', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (res) { b.textContent = res.ok ? 'Skickat – kolla inkorgen' : (res.error || 'Gick inte att skicka'); })
      .catch(function () { b.textContent = 'Gick inte att skicka'; });
  });

  // Uppgifter
  function renderTasks(res) {
    if (!res || !res.tasks) return;
    var list = res.tasks;
    var forClaude = list.filter(function (t) { return t.status === 'open' && t.to === 'claude'; });
    var forYou = list.filter(function (t) { return t.status === 'open' && t.to === 'you'; });
    var done = list.filter(function (t) { return t.status === 'done'; }).slice(0, 6);
    var item = function (t) {
      var acts = t.status === 'open'
        ? '<button class="btn ghost small" type="button" data-act="done" data-id="' + esc(t.id) + '">Klar</button><button class="btn ghost small" type="button" data-act="delete" data-id="' + esc(t.id) + '">Ta bort</button>'
        : '<button class="btn ghost small" type="button" data-act="open" data-id="' + esc(t.id) + '">Öppna igen</button>';
      return '<div class="task' + (t.status === 'done' ? ' done' : '') + '"><div class="t">' + esc(t.text) + '</div>' +
        (t.note ? '<div class="nt">Claude: ' + esc(t.note) + '</div>' : '') +
        '<div class="m">' + (t.status === 'done' ? 'Klar ' + esc(ago(t.doneAt)) : 'Skapad ' + esc(ago(t.createdAt))) + '</div><div class="acts">' + acts + '</div></div>';
    };
    var h = '<div class="h3">Väntar på Claude</div>' + (forClaude.length ? forClaude.map(item).join('') : '<p class="note" style="margin-top:2px">Inga öppna uppgifter.</p>');
    if (forYou.length) h += '<div class="h3">Till dig, från Claude</div>' + forYou.map(item).join('');
    if (done.length) h += '<div class="h3">Klart</div>' + done.map(item).join('');
    $('task-list').innerHTML = h;
    $('task-hint').textContent = res.claudeConnected ? 'Claude ser uppgiften nästa gång du startar Claude i VS Code, eller direkt med /inbox.' : 'Claude är inte kopplad än (CLAUDE_TASKS_TOKEN saknas).';
  }
  function tasksCall(path, body) {
    var init = body
      ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { credentials: 'same-origin', cache: 'no-store' };
    return fetch(path, init)
      .then(function (r) { if (r.status === 401) { location.reload(); throw new Error('login'); } return r.json(); })
      .then(function (res) { renderTasks(res); return res; })
      .catch(function () { return null; });
  }
  var send = function () {
    var ta = $('task-text'), text = ta.value.trim(), b = $('task-send');
    if (!text) { ta.focus(); return; }
    b.disabled = true;
    tasksCall('/ops/tasks', { text: text }).then(function (res) {
      b.disabled = false;
      if (res && res.tasks) ta.value = '';
    });
  };
  $('task-send').addEventListener('click', send);
  $('task-text').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
  $('task-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'delete' && !b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = 'Tryck igen';
      setTimeout(function () { b.classList.remove('armed'); b.textContent = 'Ta bort'; }, 3000);
      return;
    }
    tasksCall('/ops/tasks/update', { id: b.getAttribute('data-id'), action: act });
  });

  // Period
  var segs = document.querySelectorAll('.seg button');
  var setRange = function (r) {
    RANGE = r;
    try { localStorage.setItem('ops-range', String(r)); } catch (e) {}
    segs.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-range')) === r)); });
    $('seghint').hidden = r !== 7;
    render();
  };
  segs.forEach(function (b) { b.addEventListener('click', function () { setRange(Number(b.getAttribute('data-range'))); }); });
  setRange(RANGE);

  // Hämtning
  var busy = false, btn = $('refresh');
  function load(force) {
    if (busy) return;
    busy = true;
    btn.classList.add('spin');
    fetch('/ops/data' + (force ? '?refresh=1' : ''), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { if (res.status === 401) { location.reload(); throw new Error('login'); } return res.json(); })
      .then(function (d) { D = d; render(); })
      .catch(function (e) { if (e.message !== 'login') $('updated').textContent = 'Kunde inte hämta: ' + e.message; })
      .then(function () { busy = false; btn.classList.remove('spin'); });
  }
  btn.addEventListener('click', function () { load(true); tasksCall('/ops/tasks'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { load(false); tasksCall('/ops/tasks'); } });
  setInterval(function () { if (!document.hidden) load(false); }, 5 * 60 * 1000);
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });
  load(false);
  tasksCall('/ops/tasks');
})();
</script></body></html>`;
