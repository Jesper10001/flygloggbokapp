// Blades Ops — mobil driftsida på /ops med live-siffror från App Store Connect, RevenueCat, Sentry,
// Cloudflare, AI-telemetrin och supportmejlen. Nycklarna stannar i Workerns secrets; sidan får bara
// sammanställda tal. Inloggning med lösenord (OPS_PASSWORD) → signerad cookie i 180 dagar.
// Saknas OPS_PASSWORD eller OPS_COOKIE_SECRET svarar /ops 503 (stängt tills det är konfigurerat).
// Supportmejlen: Email Routing skickar support@ till Workerns email()-hanterare, som vidarebefordrar
// till SUPPORT_FORWARD_TO och bara räknar mejlen (tid och antal — inget innehåll, ingen avsändare).
import { ICON_180, ICON_192 } from './opsIcons';

export interface OpsEnv {
  QUOTA_KV: KVNamespace;
  CF_API_TOKEN?: string;          // Analytics Engine (AI-telemetrin) — samma som /stats
  CF_ACCOUNT_ID?: string;
  OPS_PASSWORD?: string;          // inloggning till /ops (secret)
  OPS_COOKIE_SECRET?: string;     // signerar sessionscookien (secret, slumpad)
  SENTRY_API_TOKEN?: string;      // intern integration med läsrättigheter (secret)
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
}

const COOKIE = 'blades_ops';
const SESSION_DAYS = 180;
const CACHE_KEY = 'ops:cache:v1';
const CACHE_MS = 10 * 60 * 1000;
const SALES_CACHE_KEY = 'ops:cache:asc-sales:v1';
const SALES_CACHE_MS = 6 * 3600 * 1000;
const enc = new TextEncoder();

// ── Hjälpare ─────────────────────────────────────────────────────────────────

class NotConfigured extends Error {
  constructor(what: string) { super(`Inte kopplat än (${what} saknas)`); }
}

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

/** Kör en insamlare och fångar fel: { ok, data } eller { ok: false, error }. Felet visas på sidan. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string; notConfigured?: boolean }> {
  try {
    return { ok: true, data: await withTimeout(p, 15000) };
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

const num = (v: any) => (v == null || v === '' ? 0 : Number(v) || 0);

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

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra } });

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
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ iss: env.ASC_ISSUER_ID, iat: now, exp, aud: 'appstoreconnect-v1' })));
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

async function salesData(env: OpsEnv, token: string): Promise<{ total: number | null; daily: { day: string; downloads: number | null }[]; note: string }> {
  if (!env.ASC_VENDOR_NUMBER) return { total: null, daily: [], note: 'ASC_VENDOR_NUMBER saknas — nedladdningar visas inte' };
  try {
    const raw = await env.QUOTA_KV.get(SALES_CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (Date.now() - c.at < SALES_CACHE_MS) return c;
    }
  } catch { /* läs om */ }
  // Dagsrapporterna kommer dagen efter → de 7 senaste hela dagarna.
  const days = Array.from({ length: 7 }, (_, i) => isoDay(Date.now() - (7 - i) * 86400000));
  const fetchDay = async (day: string, version: string): Promise<Response> => fetch(
    'https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY'
      + `&filter[vendorNumber]=${encodeURIComponent(env.ASC_VENDOR_NUMBER!)}&filter[reportDate]=${day}&filter[version]=${version}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' } },
  );
  let missing = 0;
  const daily = await Promise.all(days.map(async (day) => {
    let r = await fetchDay(day, '1_1');
    if (r.status === 400) r = await fetchDay(day, '1_0');
    if (r.status === 404) { missing++; return { day, downloads: 0 }; } // ingen försäljning/rapport den dagen
    if (r.status !== 200 || !r.body) return { day, downloads: null };
    const text = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
    return { day, downloads: countDownloads(text) };
  }));
  const known = daily.filter((d) => d.downloads != null) as { day: string; downloads: number }[];
  const out = {
    at: Date.now(),
    total: known.length ? known.reduce((s, d) => s + d.downloads, 0) : null,
    daily,
    note: missing === days.length ? 'Inga rapporter än — de kommer när appen är släppt' : '',
  };
  try { await env.QUOTA_KV.put(SALES_CACHE_KEY, JSON.stringify(out), { expirationTtl: 86400 }); } catch { /* cache är valfri */ }
  return out;
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
    getJson(`${base}/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=3`, init),
    getJson(`${base}/apps/${appId}/customerReviews?sort=-createdDate&limit=3`, init),
  ]);
  if (versions.status === 401 || versions.status === 403) throw new Error('App Store Connect godkände inte nyckeln');
  if (versions.status !== 200) throw new Error(`App Store Connect svarade ${versions.status}`);
  const v = versions.json?.data?.[0]?.attributes ?? {};
  const state = String(v.appVersionState ?? v.appStoreState ?? '');
  const lookup = (await lookupP)?.json?.results?.[0] ?? null;
  const sales = await salesData(env, token);
  return {
    version: v.versionString ?? null,
    state,
    stateLabel: STATE_LABELS[state] ?? state,
    rating: lookup?.averageUserRating != null ? Number(lookup.averageUserRating) : null,
    ratingCount: lookup?.userRatingCount != null ? Number(lookup.userRatingCount) : null,
    reviews: reviews.status === 200
      ? (reviews.json?.data ?? []).map((r: any) => ({
        rating: num(r.attributes?.rating),
        title: String(r.attributes?.title ?? '').slice(0, 120),
        body: String(r.attributes?.body ?? '').slice(0, 280),
        date: String(r.attributes?.createdDate ?? '').slice(0, 10),
        territory: String(r.attributes?.territory ?? ''),
      }))
      : [],
    downloads7d: sales.total,
    downloadsDaily: sales.daily,
    salesNote: sales.note,
    link: `https://appstoreconnect.apple.com/apps/${appId}/appstore`,
  };
}

async function revenueData(env: OpsEnv) {
  const key = env.REVENUECAT_METRICS_KEY || env.REVENUECAT_SECRET_KEY;
  if (!key || !env.REVENUECAT_PROJECT_ID) throw new NotConfigured('REVENUECAT_METRICS_KEY');
  const r = await getJson(`https://api.revenuecat.com/v2/projects/${env.REVENUECAT_PROJECT_ID}/metrics/overview`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (r.status === 401 || r.status === 403) throw new Error('RevenueCat-nyckeln saknar behörighet för Charts metrics');
  if (r.status !== 200) throw new Error(`RevenueCat svarade ${r.status}`);
  const metrics = (Array.isArray(r.json?.metrics) ? r.json.metrics : []).map((m: any) => ({
    id: String(m.id ?? ''), name: String(m.name ?? m.id ?? ''), value: num(m.value), unit: String(m.unit ?? ''), period: String(m.period ?? ''),
  }));
  const by = (id: string) => metrics.find((m: any) => m.id === id) ?? null;
  return {
    activeSubscriptions: by('active_subscriptions'),
    mrr: by('mrr'),
    revenue: by('revenue'),
    newCustomers: by('new_customers'),
    activeTrials: by('active_trials'),
    activeUsers: by('active_users'),
    link: 'https://app.revenuecat.com/',
  };
}

async function sentryData(env: OpsEnv) {
  if (!env.SENTRY_API_TOKEN) throw new NotConfigured('SENTRY_API_TOKEN');
  const org = env.SENTRY_ORG || 'jesper-toreld';
  const proj = env.SENTRY_PROJECT || 'blades-ios';
  const base = 'https://de.sentry.io/api/0';
  const init = { headers: { Authorization: `Bearer ${env.SENTRY_API_TOKEN}` } };
  const q = encodeURIComponent;
  const [issues, fresh, sessions] = await Promise.all([
    getJson(`${base}/projects/${org}/${proj}/issues/?query=${q('is:unresolved')}&statsPeriod=14d&sort=freq&limit=5`, init),
    getJson(`${base}/projects/${org}/${proj}/issues/?query=${q('is:unresolved firstSeen:-24h')}&statsPeriod=24h&limit=1`, init),
    env.SENTRY_PROJECT_ID
      ? getJson(`${base}/organizations/${org}/sessions/?project=${env.SENTRY_PROJECT_ID}&field=${q('sum(session)')}&field=${q('count_unique(user)')}&field=${q('crash_free_rate(session)')}&statsPeriod=7d&interval=1d`, init)
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
  const intervals: string[] = sessions.status === 200 && Array.isArray(sessions.json?.intervals) ? sessions.json.intervals : [];
  const crash = g?.totals?.['crash_free_rate(session)'];
  return {
    unresolved: hits(issues),
    new24h: fresh.status === 200 ? hits(fresh) : null,
    top: list.slice(0, 3).map((i: any) => ({
      title: String(i.title ?? '').slice(0, 140), count: num(i.count), users: num(i.userCount), lastSeen: i.lastSeen ?? null, url: i.permalink ?? null,
    })),
    sessions7d: g ? num(g.totals?.['sum(session)']) : null,
    users7d: g ? num(g.totals?.['count_unique(user)']) : null,
    crashFree7d: crash != null ? Number(crash) : null,
    daily: g ? intervals.map((d, i) => ({ day: String(d).slice(0, 10), sessions: num(g.series?.['sum(session)']?.[i]), users: num(g.series?.['count_unique(user)']?.[i]) })) : [],
    link: `https://${org}.de.sentry.io/issues/`,
  };
}

async function trafficData(env: OpsEnv) {
  const token = env.CF_ANALYTICS_TOKEN || env.CF_API_TOKEN;
  if (!token || !env.CF_ACCOUNT_ID) throw new NotConfigured('CF_ANALYTICS_TOKEN');
  const days = lastDays(7);
  const next = (d: string) => isoDay(Date.parse(`${d}T00:00:00Z`) + 86400000);
  // En fråga per dag (alias) — gratisplanens dataset tillåter bara ett dygn per fråga.
  const range = (d: string) => `datetime_geq: "${d}T00:00:00Z", datetime_lt: "${next(d)}T00:00:00Z"`;
  const site = env.CF_ZONE_ID
    ? `zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) { ${days.map((d, i) => `s${i}: httpRequestsAdaptiveGroups(limit: 1, filter: {${range(d)}, clientRequestHTTPHost: "blades-app.com", requestSource: "eyeball"}) { count sum { visits } }`).join(' ')} }`
    : '';
  const worker = `accounts(filter: {accountTag: "${env.CF_ACCOUNT_ID}"}) { ${days.map((d, i) => `w${i}: workersInvocationsAdaptive(limit: 1, filter: {${range(d)}, scriptName: "blades-api"}) { sum { requests errors } }`).join(' ')} }`;
  const r = await getJson('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{ viewer { ${site} ${worker} } }` }),
  });
  if (r.status !== 200) throw new Error(`Cloudflare svarade ${r.status}`);
  if (Array.isArray(r.json?.errors) && r.json.errors.length && !r.json?.data?.viewer) {
    throw new Error(`Cloudflare: ${String(r.json.errors[0]?.message ?? 'fel').slice(0, 140)}`);
  }
  const z = r.json?.data?.viewer?.zones?.[0] ?? null;
  const a = r.json?.data?.viewer?.accounts?.[0] ?? null;
  const siteDays = days.map((day, i) => ({ day, visits: num(z?.[`s${i}`]?.[0]?.sum?.visits), requests: num(z?.[`s${i}`]?.[0]?.count) }));
  const workerDays = days.map((day, i) => ({ day, requests: num(a?.[`w${i}`]?.[0]?.sum?.requests), errors: num(a?.[`w${i}`]?.[0]?.sum?.errors) }));
  return {
    site: z ? { days: siteDays, visits7d: siteDays.reduce((s, d) => s + d.visits, 0) } : null,
    siteNote: env.CF_ZONE_ID ? (z ? '' : 'Saknar behörighet för zonens statistik') : 'CF_ZONE_ID saknas',
    worker: a ? { days: workerDays, requests7d: workerDays.reduce((s, d) => s + d.requests, 0), errors7d: workerDays.reduce((s, d) => s + d.errors, 0) } : null,
    link: 'https://dash.cloudflare.com/',
  };
}

async function aiData(env: OpsEnv) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) throw new NotConfigured('CF_API_TOKEN');
  const since = /^\d{4}-\d{2}-\d{2}$/.test(env.OPS_CREDIT_SINCE ?? '') ? env.OPS_CREDIT_SINCE! : '';
  const credit = Number(env.OPS_CREDIT_USD ?? '');
  const users = `blob4 != 'model_fallback' AND blob2 != 'news_cron'`; // appens anrop (inte nyhetsjobbet)
  const AE_DATASET = await resolveAeDataset(env);
  const [daily, dailyCost, day1, sinceCost, models] = await Promise.all([
    aeQuery(env, `SELECT toDate(timestamp) AS day, SUM(_sample_interval) AS requests, SUM(IF(blob4 != 'ok', _sample_interval, 0)) AS errors, COUNT(DISTINCT blob2) AS devices FROM ${AE_DATASET} WHERE timestamp > NOW() - INTERVAL '7' DAY AND ${users} GROUP BY day ORDER BY day`),
    aeQuery(env, `SELECT toDate(timestamp) AS day, SUM(_sample_interval * double4) AS cost FROM ${AE_DATASET} WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY day ORDER BY day`),
    aeQuery(env, `SELECT SUM(_sample_interval) AS requests, COUNT(DISTINCT blob2) AS devices FROM ${AE_DATASET} WHERE timestamp > NOW() - INTERVAL '1' DAY AND ${users}`),
    since ? aeQuery(env, `SELECT SUM(_sample_interval * double4) AS cost FROM ${AE_DATASET} WHERE timestamp >= toDateTime('${since} 00:00:00')`) : Promise.resolve([]),
    aeQuery(env, `SELECT blob1 AS model, SUM(_sample_interval) AS requests, SUM(_sample_interval * double4) AS cost FROM ${AE_DATASET} WHERE timestamp > NOW() - INTERVAL '7' DAY AND ${users} GROUP BY model ORDER BY cost DESC LIMIT 4`),
  ]);
  const costByDay = new Map(dailyCost.map((r: any) => [String(r.day).slice(0, 10), num(r.cost)]));
  const days = lastDays(7).map((day) => {
    const row = daily.find((r: any) => String(r.day).slice(0, 10) === day);
    return { day, requests: num(row?.requests), errors: num(row?.errors), devices: num(row?.devices), cost: costByDay.get(day) ?? 0 };
  });
  const spent = since ? num(sinceCost[0]?.cost) : null;
  return {
    requests24h: num(day1[0]?.requests),
    devices24h: num(day1[0]?.devices),
    requests7d: days.reduce((s, d) => s + d.requests, 0),
    errors7d: days.reduce((s, d) => s + d.errors, 0),
    cost7d: days.reduce((s, d) => s + d.cost, 0),
    days,
    creditStart: Number.isFinite(credit) && credit > 0 ? credit : null,
    creditSince: since || null,
    creditSpent: spent,
    creditLeft: Number.isFinite(credit) && credit > 0 && spent != null ? Math.max(0, credit - spent) : null,
    models: models.map((m: any) => ({ model: String(m.model ?? ''), requests: num(m.requests), cost: num(m.cost) })),
    link: 'https://console.anthropic.com/settings/billing',
  };
}

async function supportData(env: OpsEnv) {
  const days = lastDays(7);
  const counts = await Promise.all(days.map((d) => env.QUOTA_KV.get(`ops:mail:day:${d}`)));
  const last = await env.QUOTA_KV.get('ops:mail:last');
  const daily = days.map((day, i) => ({ day, mails: num(counts[i]) }));
  return {
    counting: !!env.SUPPORT_FORWARD_TO,
    today: daily[daily.length - 1].mails,
    week: daily.reduce((s, d) => s + d.mails, 0),
    daily,
    last: last || null,
    link: 'https://mail.google.com/',
  };
}

async function opsData(env: OpsEnv, ctx: ExecutionContext, force: boolean) {
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
  const [appStore, revenue, stability, traffic, ai, support] = await Promise.all([
    settle(appStoreData(env)), settle(revenueData(env)), settle(sentryData(env)),
    settle(trafficData(env)), settle(aiData(env)), settle(supportData(env)),
  ]);
  const out = { at: Date.now(), appStore, revenue, stability, traffic, ai, support };
  ctx.waitUntil(env.QUOTA_KV.put(CACHE_KEY, JSON.stringify(out), { expirationTtl: 3600 }));
  return out;
}

// ── Supportmejl (Email Routing → Worker) ─────────────────────────────────────

/** Vidarebefordrar supportmejlet och räknar det. Bara räknare och tid sparas — inget innehåll,
 *  ingen avsändare. Misslyckas vidarebefordringen kastas felet, så att mejlet studsar i stället
 *  för att tyst försvinna (avsändaren kan då skicka igen). */
export async function handleSupportEmail(message: any, env: OpsEnv): Promise<void> {
  if (!env.SUPPORT_FORWARD_TO) {
    message.setReject('Support mailbox is temporarily unavailable. Please try again later.');
    return;
  }
  await message.forward(env.SUPPORT_FORWARD_TO);
  try {
    const key = `ops:mail:day:${isoDay(Date.now())}`;
    await env.QUOTA_KV.put(key, String(num(await env.QUOTA_KV.get(key)) + 1), { expirationTtl: 40 * 86400 });
    await env.QUOTA_KV.put('ops:mail:last', new Date().toISOString());
    await env.QUOTA_KV.delete(CACHE_KEY); // nästa titt på /ops visar mejlet direkt
  } catch { /* räkningen får aldrig stoppa ett mejl */ }
}

// ── Routning ─────────────────────────────────────────────────────────────────

/** Hanterar /ops och dess ikoner/manifest. Returnerar null för alla andra sökvägar. */
export async function handleOps(request: Request, env: OpsEnv, ctx: ExecutionContext): Promise<Response | null> {
  const { pathname, searchParams } = new URL(request.url);

  // Ikoner och manifest ligger utanför /ops: telefonen hämtar dem utan inloggningscookie.
  if (pathname === '/assets/ops-icon-180.png' || pathname === '/assets/ops-icon-192.png') {
    const b64 = pathname.endsWith('180.png') ? ICON_180 : ICON_192;
    return new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' },
    });
  }
  if (pathname === '/assets/ops-manifest.webmanifest') {
    return new Response(JSON.stringify({
      name: 'Blades Ops', short_name: 'Blades Ops', start_url: '/ops', scope: '/ops', display: 'standalone',
      background_color: '#0A1628', theme_color: '#0A1628',
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

  if (pathname === '/ops/login' && request.method === 'POST') return handleLogin(request, env);
  if (pathname === '/ops/logout') {
    return new Response(null, { status: 303, headers: { Location: '/ops', 'Set-Cookie': `${COOKIE}=; Path=/ops; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, ...SECURITY_HEADERS } });
  }

  const authed = await validSession(request, env);
  if (pathname === '/ops/data') {
    if (!authed) return new Response(JSON.stringify({ error: 'login' }), { status: 401, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });
    const data = await opsData(env, ctx, searchParams.get('refresh') === '1');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });
  }
  if (pathname === '/ops' || pathname === '/ops/') return html(authed ? OPS_PAGE : loginPage(''));
  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
}

// ── Sidor ────────────────────────────────────────────────────────────────────

const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0A1628">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Blades Ops">
<link rel="apple-touch-icon" href="/assets/ops-icon-180.png">
<link rel="manifest" href="/assets/ops-manifest.webmanifest">`;

const BASE_CSS = `:root{--bg:#0A1628;--panel:#0F2038;--panel2:#132845;--line:#1F3656;--fg:#E8F1FA;--muted:#8FA6BF;--accent:#00C8E8;--ok:#3DDC97;--warn:#FFC857;--bad:#FF6B6B;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:15px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:calc(env(safe-area-inset-top,0px) + 16px) 16px calc(env(safe-area-inset-bottom,0px) + 24px);-webkit-text-size-adjust:100%}
a{color:var(--accent);text-decoration:none}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

function loginPage(message: string): string {
  const msg = message ? `<p class="err">${message}</p>` : '';
  return `<!doctype html><html lang="sv"><head>${HEAD}<title>Blades Ops</title><style>${BASE_CSS}
.box{max-width:22rem;margin:12vh auto 0;display:flex;flex-direction:column;gap:14px}
h1{font-size:24px;margin:0}p{margin:0;color:var(--muted)}.err{color:var(--bad)}
input{font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--fg)}
button{font:inherit;font-weight:600;padding:12px 14px;border:0;border-radius:12px;background:var(--accent);color:#04121F}</style></head>
<body><form class="box" method="post" action="/ops/login"><h1>Blades Ops</h1><p>Logga in för att se appens drift.</p>${msg}
<input id="password" name="password" type="password" autocomplete="current-password" placeholder="Lösenord" required autofocus>
<button type="submit">Logga in</button></form></body></html>`;
}

const OPS_PAGE = `<!doctype html><html lang="sv"><head>${HEAD}<title>Blades Ops</title><style>${BASE_CSS}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
h1{font-size:26px;line-height:1.1;margin:0;letter-spacing:-.3px}
.sub{color:var(--muted);font-size:12.5px;margin-top:4px}
.btn{font:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--fg);cursor:pointer}
.alerts{display:flex;flex-direction:column;gap:8px;margin:0 0 16px;padding:0;list-style:none}
.alerts li{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:var(--panel);border:1px solid var(--line);font-size:14px}
.dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--muted)}
.ok .dot{background:var(--ok)}.warn .dot{background:var(--warn)}.bad .dot{background:var(--bad)}.info .dot{background:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:12px;align-items:start}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px;min-width:0}
.card h2{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.card h2 a{font-size:12.5px;font-weight:600;letter-spacing:0;text-transform:none}
.big{font-size:30px;font-weight:700;letter-spacing:-.5px;font-variant-numeric:tabular-nums;line-height:1.1}
.big small{font-size:13px;font-weight:500;color:var(--muted);letter-spacing:0;margin-left:6px}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin-top:12px}
.stat .v{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums}.stat .l{font-size:12px;color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--panel2)}
.chip.ok{color:var(--ok)}.chip.warn{color:var(--warn)}.chip.bad{color:var(--bad)}.chip.info{color:var(--accent)}
.list{margin:12px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.list li{font-size:13.5px;padding-top:8px;border-top:1px solid var(--line);min-width:0}
.list .t{overflow-wrap:anywhere}.list .m{color:var(--muted);font-size:12px}
.note{color:var(--muted);font-size:12.5px;margin-top:10px}.err{color:var(--warn);font-size:13.5px}
.spark{display:block;width:100%;height:36px;margin-top:10px}
.links{display:flex;flex-wrap:wrap;gap:8px}.links a{font-size:13.5px;padding:8px 12px;border-radius:10px;background:var(--panel2)}
.skel{color:var(--muted)}
@media (prefers-reduced-motion:no-preference){.card{animation:in .25s ease-out both}@keyframes in{from{opacity:.4}to{opacity:1}}}
</style></head><body>
<div class="top"><div><h1>Blades Ops</h1><div class="sub" id="updated">Hämtar…</div></div>
<button class="btn" id="refresh" type="button">Uppdatera</button></div>
<ul class="alerts" id="alerts"></ul>
<div class="grid">
<section class="card" id="c-app"><h2>App Store</h2><div class="skel">Hämtar…</div></section>
<section class="card" id="c-rev"><h2>Intäkter</h2><div class="skel">Hämtar…</div></section>
<section class="card" id="c-stab"><h2>Stabilitet</h2><div class="skel">Hämtar…</div></section>
<section class="card" id="c-mail"><h2>Supportmejl</h2><div class="skel">Hämtar…</div></section>
<section class="card" id="c-traffic"><h2>Trafik</h2><div class="skel">Hämtar…</div></section>
<section class="card" id="c-ai"><h2>AI</h2><div class="skel">Hämtar…</div></section>
<section class="card"><h2>Länkar</h2><div class="links">
<a href="https://appstoreconnect.apple.com/apps/6798360464/appstore" target="_blank" rel="noopener noreferrer">App Store Connect</a>
<a href="https://app.revenuecat.com/" target="_blank" rel="noopener noreferrer">RevenueCat</a>
<a href="https://jesper-toreld.de.sentry.io/issues/" target="_blank" rel="noopener noreferrer">Sentry</a>
<a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Cloudflare</a>
<a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer">Anthropic</a>
<a href="https://mail.google.com/" target="_blank" rel="noopener noreferrer">Gmail</a>
<a href="https://claude.ai/artifact/HxbZx36SF78Bz1mVZZtCeo" target="_blank" rel="noopener noreferrer">Kontrollrum (uppgifter)</a>
</div><p class="note"><a href="/ops/logout">Logga ut</a></p></section>
</div>
<script>
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n, d) { return n == null || isNaN(n) ? '–' : Number(n).toLocaleString('sv-SE', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); };
  var usd = function (n) { return n == null ? '–' : '$' + fmt(n, n > 0 && n < 0.1 ? 3 : 2); };
  var pct = function (r) { return r == null ? '–' : fmt(r * 100, 1) + ' %'; };
  var ago = function (iso) {
    if (!iso) return 'aldrig';
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 90) return 'nyss';
    if (s < 5400) return Math.round(s / 60) + ' min sedan';
    if (s < 129600) return Math.round(s / 3600) + ' tim sedan';
    return Math.round(s / 86400) + ' dagar sedan';
  };
  var link = function (href, text) { return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>' : ''; };
  var stat = function (v, l) { return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + esc(l) + '</div></div>'; };
  var spark = function (vals, color) {
    var max = Math.max.apply(null, vals.concat([1])), w = 100 / vals.length, out = '';
    vals.forEach(function (v, i) {
      var h = Math.max(v > 0 ? 6 : 2, (v / max) * 100);
      out += '<rect x="' + (i * w + w * 0.15) + '" y="' + (100 - h) + '" width="' + (w * 0.7) + '" height="' + h + '" rx="2" fill="' + (v > 0 ? color : '#1F3656') + '"/>';
    });
    return '<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
  };
  var card = function (id, title, linkHref, body) {
    document.getElementById(id).innerHTML = '<h2><span>' + esc(title) + '</span>' + link(linkHref, 'Öppna') + '</h2>' + body;
  };
  var failed = function (r) { return '<p class="err">' + esc(r.error) + '</p>'; };

  function render(d) {
    var alerts = [];
    var add = function (level, text) { alerts.push('<li class="' + level + '"><span class="dot"></span><span>' + esc(text) + '</span></li>'); };

    // App Store
    var a = d.appStore;
    if (a.ok) {
      var x = a.data, st = x.state || '';
      var lvl = /REJECTED|INVALID/.test(st) ? 'bad' : st === 'PENDING_DEVELOPER_RELEASE' ? 'warn' : /READY_FOR_(SALE|DISTRIBUTION)/.test(st) ? 'ok' : 'info';
      if (lvl === 'bad') add('bad', 'App Store: ' + x.stateLabel + ' – läs Apples svar i App Store Connect');
      if (st === 'PENDING_DEVELOPER_RELEASE') add('warn', 'Appen är godkänd! Släpp den med "Release This Version"');
      var rev = (x.reviews || []).map(function (r) { return '<li><div class="t">' + '★'.repeat(r.rating) + ' ' + esc(r.title) + '</div><div class="m">' + esc(r.date) + ' · ' + esc(r.territory) + '</div></li>'; }).join('');
      card('c-app', 'App Store', x.link,
        '<span class="chip ' + lvl + '">' + esc(x.stateLabel || 'Okänt läge') + '</span>' +
        '<div class="stats">' + stat(esc(x.version || '–'), 'Version') +
        stat(x.rating != null ? '★ ' + fmt(x.rating, 1) : '–', x.ratingCount ? fmt(x.ratingCount) + ' betyg i Sverige' : 'Inga betyg än') +
        stat(fmt(x.downloads7d), 'Nedladdningar, 7 dagar') + '</div>' +
        ((x.downloadsDaily || []).length ? spark(x.downloadsDaily.map(function (z) { return z.downloads || 0; }), '#00C8E8') : '') +
        (x.salesNote ? '<p class="note">' + esc(x.salesNote) + '</p>' : '') +
        (rev ? '<ul class="list">' + rev + '</ul>' : ''));
    } else card('c-app', 'App Store', null, failed(a));

    // Intäkter
    var r = d.revenue;
    if (r.ok) {
      var m = r.data, val = function (o, money) { return o ? (money ? (o.unit && o.unit !== '#' ? esc(o.unit) : '$') + fmt(o.value, o.value < 1000 ? 2 : 0) : fmt(o.value)) : '–'; };
      card('c-rev', 'Intäkter', m.link,
        '<div class="big">' + val(m.activeSubscriptions) + '<small>betalande kunder</small></div>' +
        '<div class="stats">' + stat(val(m.mrr, true), 'MRR (månadsintäkt)') + stat(val(m.revenue, true), 'Intäkt, 28 dagar') +
        stat(val(m.newCustomers), 'Nya appanvändare, 28 dagar') + stat(val(m.activeTrials), 'Provperioder') + '</div>');
    } else card('c-rev', 'Intäkter', null, failed(r));

    // Stabilitet
    var s = d.stability;
    if (s.ok) {
      var y = s.data;
      if (y.new24h > 0) add('warn', y.new24h + (y.new24h === 1 ? ' nytt fel' : ' nya fel') + ' i Sentry senaste dygnet');
      if (y.crashFree7d != null && y.crashFree7d < 0.99) add('warn', 'Kraschfria sessioner under 99 % (' + pct(y.crashFree7d) + ')');
      var top = (y.top || []).map(function (i) { return '<li><div class="t">' + link(i.url, i.title) + '</div><div class="m">' + fmt(i.count) + ' gånger · ' + fmt(i.users) + ' användare · ' + ago(i.lastSeen) + '</div></li>'; }).join('');
      card('c-stab', 'Stabilitet', y.link,
        '<div class="big">' + pct(y.crashFree7d) + '<small>kraschfria sessioner, 7 dagar</small></div>' +
        '<div class="stats">' + stat(fmt(y.sessions7d), 'Sessioner, 7 dagar') + stat(fmt(y.users7d), 'Användare, 7 dagar') +
        stat(fmt(y.unresolved), 'Olösta fel') + stat(y.new24h == null ? '–' : fmt(y.new24h), 'Nya fel, senaste dygnet') + '</div>' +
        ((y.daily || []).length ? spark(y.daily.map(function (z) { return z.sessions; }), '#3DDC97') : '') +
        (top ? '<ul class="list">' + top + '</ul>' : ''));
    } else card('c-stab', 'Stabilitet', null, failed(s));

    // Supportmejl
    var p = d.support;
    if (p.ok) {
      var z = p.data;
      if (z.today > 0) add('info', z.today + ' supportmejl i dag');
      card('c-mail', 'Supportmejl', z.link,
        '<div class="big">' + fmt(z.today) + '<small>i dag</small></div>' +
        '<div class="stats">' + stat(fmt(z.week), 'Senaste 7 dagarna') + stat(esc(ago(z.last)), 'Senaste mejlet') + '</div>' +
        spark(z.daily.map(function (q) { return q.mails; }), '#FFC857') +
        (z.counting ? '' : '<p class="note">Räkningen startar när support@ skickas via Workern.</p>'));
    } else card('c-mail', 'Supportmejl', null, failed(p));

    // Trafik
    var t = d.traffic;
    if (t.ok) {
      var w = t.data;
      card('c-traffic', 'Trafik', w.link,
        '<div class="big">' + (w.site ? fmt(w.site.visits7d) : '–') + '<small>besök på sajten, 7 dagar</small></div>' +
        (w.site ? spark(w.site.days.map(function (q) { return q.visits; }), '#00C8E8') + '<p class="note">Räknar alla besök, även robotar och sökmotorer.</p>' : '<p class="note">' + esc(w.siteNote) + '</p>') +
        '<div class="stats">' + stat(w.worker ? fmt(w.worker.requests7d) : '–', 'Anrop till proxyn, 7 dagar') + stat(w.worker ? fmt(w.worker.errors7d) : '–', 'Fel i proxyn, 7 dagar') + '</div>');
    } else card('c-traffic', 'Trafik', null, failed(t));

    // AI
    var i = d.ai;
    if (i.ok) {
      var k = i.data;
      if (k.creditLeft != null && k.creditLeft < 5) add('warn', 'AI-krediten börjar ta slut (cirka ' + usd(k.creditLeft) + ' kvar)');
      var mods = (k.models || []).map(function (q) { return '<li><div class="t">' + esc(q.model) + '</div><div class="m">' + fmt(q.requests) + ' anrop · ' + usd(q.cost) + '</div></li>'; }).join('');
      card('c-ai', 'AI', k.link,
        '<div class="big">' + (k.creditLeft != null ? usd(k.creditLeft) : '–') + '<small>kvar av krediten (uppskattat)</small></div>' +
        '<div class="stats">' + stat(fmt(k.requests24h), 'Anrop, senaste dygnet') + stat(fmt(k.devices24h), 'Enheter, senaste dygnet') +
        stat(usd(k.cost7d), 'Kostnad, 7 dagar') + stat(fmt(k.errors7d), 'Misslyckade anrop, 7 dagar') + '</div>' +
        spark(k.days.map(function (q) { return q.requests; }), '#B79CFF') +
        (k.creditStart ? '<p class="note">Kredit ' + usd(k.creditStart) + ' den ' + esc(k.creditSince) + ', minus proxyns beräknade kostnad sedan dess.</p>' : '') +
        (mods ? '<ul class="list">' + mods + '</ul>' : ''));
    } else card('c-ai', 'AI', null, failed(i));

    if (!alerts.length) add('ok', 'Allt ser lugnt ut');
    document.getElementById('alerts').innerHTML = alerts.join('');
    var at = new Date(d.at);
    document.getElementById('updated').textContent = 'Uppdaterad ' + at.toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  var busy = false;
  function load(force) {
    if (busy) return;
    busy = true;
    document.getElementById('refresh').textContent = 'Hämtar…';
    fetch('/ops/data' + (force ? '?refresh=1' : ''), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) { if (res.status === 401) { location.reload(); throw new Error('login'); } return res.json(); })
      .then(render)
      .catch(function (e) { if (e.message !== 'login') document.getElementById('updated').textContent = 'Kunde inte hämta: ' + e.message; })
      .then(function () { busy = false; document.getElementById('refresh').textContent = 'Uppdatera'; });
  }
  document.getElementById('refresh').addEventListener('click', function () { load(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(false); });
  setInterval(function () { if (!document.hidden) load(false); }, 5 * 60 * 1000);
  load(false);
})();
</script></body></html>`;
