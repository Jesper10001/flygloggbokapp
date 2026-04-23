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

const MONTHLY_LIMITS: Record<string, number> = {
  scan: 12,
  summarize: 20,
  lookup: 15,
  import: 5,
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

    if (system.includes('loggbokssida') || system.includes('logbook page') || system.includes('row-by-row')) {
      return hasImage ? 'scan' : 'scan';
    }
    if (system.includes('Total this page') || system.includes('summarize') || system.includes('summera')) {
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
  kv: KVNamespace, deviceHash: string, reqType: string
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = MONTHLY_LIMITS[reqType];
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
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
      if (env.QUOTA_KV) {
        const reqType = detectRequestType(body);
        if (reqType) {
          const quota = await checkAndIncrementQuota(env.QUOTA_KV, deviceHash, reqType);
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
