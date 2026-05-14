// Blades API Proxy + Telemetri + Stats-dashboard

interface Env {
  ANTHROPIC_API_KEY: string;
  TELEMETRY: AnalyticsEngineDataset;
  QUOTA_KV: KVNamespace;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  STATS_PASSWORD: string;
}

// ── Quota limits per device per month ────────────────────────────────────────

const FREE_LIMITS: Record<string, number> = {
  scan: 1,
  summarize: 0,
  lookup: 10,
  import: 0,
  flight_import: 0,
};

const PREMIUM_LIMITS: Record<string, number> = {
  scan: 10,
  summarize: 10,
  lookup: 20,
  import: 5,
  flight_import: 30,
};

const MAX_LIMITS: Record<string, number> = {
  scan: 50,
  summarize: 20,
  lookup: 60,
  import: 5,
  flight_import: 100,
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function detectRequestType(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const system = typeof parsed.system === 'string' ? parsed.system : Array.isArray(parsed.system) ? parsed.system.map((s: any) => s.text ?? '').join(' ') : '';
    const userContent = JSON.stringify(parsed.messages ?? []);
    const hasImage = userContent.includes('"type":"image"') || userContent.includes('"type": "image"');

    // Scan detection — check both system and user content, must have image
    if (hasImage && (
      system.includes('flygloggb') || system.includes('EASA') || system.includes('flygningsrad') ||
      userContent.includes('loggbokssida') || userContent.includes('logbook page')
    )) {
      return 'scan';
    }
    // Flight data import — cockpit instrument/app photo
    if (hasImage && system.includes('cockpit instrument') && system.includes('flight data')) {
      return 'flight_import';
    }
    // Summarize — only the dedicated summarize prompt (shorter, no EASA/flygningsrad)
    if (hasImage && system.includes('summera') && !system.includes('flygningsrad') && !system.includes('EASA')) {
      return 'summarize';
    }
    if (system.includes('aircraft') && system.includes('lookup') || system.includes('cruise_speed') && system.includes('manufacturer')) {
      return 'lookup';
    }
    if (system.includes('CSV') || system.includes('column mapping') || system.includes('kolumnmappning')) {
      return 'import';
    }
    if (system.includes('drone') && (system.includes('manufacturer') || system.includes('model'))) {
      return 'lookup';
    }
  } catch {}
  return null;
}

async function checkAndIncrementQuota(
  kv: KVNamespace, deviceHash: string, reqType: string, tier: string
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limits = tier === 'max' ? MAX_LIMITS : tier === 'premium' ? PREMIUM_LIMITS : FREE_LIMITS;
  const limit = limits[reqType];
  if (!limit) return { allowed: true, used: 0, limit: 0 };

  const month = currentMonth();
  const key = `quota:${deviceHash}:${month}:${reqType}`;
  const current = parseInt(await kv.get(key) ?? '0', 10);

  if (current >= limit) {
    return { allowed: false, used: current, limit };
  }

  await kv.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 * 35 });
  return { allowed: true, used: current + 1, limit };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID, X-Premium',
    'Access-Control-Max-Age': '86400',
  };
}

function hashDevice(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return 'dev_' + Math.abs(h).toString(36);
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
<p class="meta">BLADES — Joint Logbook · Last updated: ${new Date().toISOString().slice(0, 10)}</p>

<h2>1. Data Storage</h2>
<p>BLADES stores all flight data, certificates, and settings <strong>locally on your device</strong> using an encrypted SQLite database. We do not operate user accounts, and no flight data is stored on our servers.</p>

<h2>2. AI Processing</h2>
<p>When you use AI-powered features (logbook scanning, aircraft lookup, CSV import mapping), the image or text you submit is sent to Anthropic's Claude API via our Cloudflare Workers proxy for processing. This data is:</p>
<ul>
<li>Transmitted over HTTPS (encrypted in transit)</li>
<li>Processed by Anthropic and <strong>not stored</strong> on their servers after processing</li>
<li>Not used to train AI models (per Anthropic's API terms)</li>
<li>Not stored on our proxy beyond the duration of the request</li>
</ul>

<h2>3. Data We Collect</h2>
<p>Our proxy collects minimal anonymous telemetry:</p>
<ul>
<li>An anonymous device hash (not your Apple ID or personal identifier)</li>
<li>Request count and type (scan, lookup, etc.) for quota enforcement</li>
<li>Country of origin (from Cloudflare, not GPS)</li>
<li>No names, email addresses, flight data, or personal information</li>
</ul>

<h2>4. Third-Party Services</h2>
<ul>
<li><strong>Anthropic (Claude API)</strong> — AI processing. <a href="https://www.anthropic.com/privacy">Anthropic Privacy Policy</a></li>
<li><strong>Cloudflare Workers</strong> — API proxy and hosting. <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare Privacy Policy</a></li>
<li><strong>Apple App Store</strong> — distribution and payments</li>
<li><strong>OpenStreetMap / CARTO / Esri</strong> — map tiles (no personal data sent)</li>
</ul>

<h2>5. Your Rights</h2>
<p>Since all data is stored locally on your device, you have full control:</p>
<ul>
<li><strong>Export</strong> your data at any time (CSV or PDF)</li>
<li><strong>Delete</strong> all data from Settings → Clear all logbook data</li>
<li><strong>Uninstall</strong> the app to remove all data permanently</li>
</ul>

<h2>6. Children</h2>
<p>BLADES is not directed at children under 13. We do not knowingly collect data from children.</p>

<h2>7. Changes</h2>
<p>We may update this policy. Changes will be posted at this URL. Continued use of the app constitutes acceptance.</p>

<h2>8. Contact</h2>
<p>Questions? Email <a href="mailto:support@blades-app.com">support@blades-app.com</a></p>

<p style="margin-top:32px;text-align:center"><a href="/">← Back to BLADES</a></p>
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
<p class="meta">BLADES — Joint Logbook · Last updated: ${new Date().toISOString().slice(0, 10)}</p>

<h2>1. Service</h2>
<p>BLADES is a digital flight logbook application. It assists pilots in recording, scanning, and exporting flight data. The app is a <strong>tool</strong> — the pilot is always responsible for the accuracy of their logbook entries.</p>

<h2>2. AI Features</h2>
<p>AI-powered features (OCR scanning, aircraft lookup) are provided as an aid. Results should always be reviewed by the pilot before saving. We do not guarantee 100% accuracy of AI-generated data.</p>

<h2>3. Subscriptions</h2>
<ul>
<li>Free tier: manual logging, 1 free AI scan, 10 aircraft lookups</li>
<li>Premium: 49 kr/month — full AI quota, PDF export, CSV import, global ICAO database</li>
<li>Quota top-up: 49 kr — resets all monthly limits once</li>
<li>Scan packs: 10 scans for 30 kr, 50 scans for 150 kr</li>
</ul>
<p>Subscriptions are managed through Apple's App Store. Cancel any time in your Apple ID settings.</p>

<h2>4. Data Ownership</h2>
<p>You own your flight data. We do not claim any rights to the data you enter or scan into the app. You can export or delete your data at any time.</p>

<h2>5. Limitation of Liability</h2>
<p>BLADES is provided "as is". We are not liable for any errors in AI-scanned data, lost data due to device failure, or regulatory consequences of logbook inaccuracies. Always maintain a backup of your official logbook.</p>

<h2>6. Acceptable Use</h2>
<p>Do not attempt to reverse-engineer the API, bypass quota limits, or use the service for purposes other than personal flight logging.</p>

<h2>7. Termination</h2>
<p>We reserve the right to suspend service for abuse. Your local data remains yours regardless.</p>

<h2>8. Contact</h2>
<p>Questions? Email <a href="mailto:support@blades-app.com">support@blades-app.com</a></p>

<p style="margin-top:32px;text-align:center"><a href="/">← Back to BLADES</a></p>
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

// ── Huvudlogik ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    // ── Landing page ──
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(landingPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── Privacy policy ──
    if (url.pathname === '/privacy') {
      return new Response(privacyPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── Terms of service ──
    if (url.pathname === '/terms') {
      return new Response(termsPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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

    // ── CORS ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only. Visit /stats for dashboard.' }), {
        status: 405, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key missing' }), {
        status: 500, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    // ── Proxy ──
    const deviceId = request.headers.get('X-Device-ID') ?? 'unknown';
    const deviceHash = hashDevice(deviceId);
    const country = (request as any).cf?.country ?? '??';

    try {
      const body = await request.text();
      let model = 'unknown';
      try { model = JSON.parse(body).model ?? 'unknown'; } catch {}

      // ── Server-side quota check ──
      const tierHeader = request.headers.get('X-Tier') || (request.headers.get('X-Premium') === 'true' ? 'premium' : 'free');
      if (env.QUOTA_KV) {
        const reqType = detectRequestType(body);
        if (reqType) {
          const quota = await checkAndIncrementQuota(env.QUOTA_KV, deviceHash, reqType, tierHeader);
          if (!quota.allowed) {
            return new Response(JSON.stringify({
              error: 'quota_exceeded',
              type: reqType,
              used: quota.used,
              limit: quota.limit,
              message: `Monthly ${reqType} quota exceeded (${quota.used}/${quota.limit})`,
            }), {
              status: 429, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
            });
          }
        }
      }

      const t0 = Date.now();
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body,
      });

      const respBody = await resp.text();
      const ms = Date.now() - t0;
      let inTok = 0, outTok = 0;
      try { const j = JSON.parse(respBody); inTok = j.usage?.input_tokens ?? 0; outTok = j.usage?.output_tokens ?? 0; } catch {}
      const cost = Math.round((inTok * 0.3 + outTok * 1.5) / 1000) / 100;

      if (env.TELEMETRY) {
        env.TELEMETRY.writeDataPoint({
          blobs: [model, deviceHash, country, resp.status === 200 ? 'ok' : `error_${resp.status}`],
          doubles: [ms, inTok, outTok, cost],
          indexes: [deviceHash],
        });
      }

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
