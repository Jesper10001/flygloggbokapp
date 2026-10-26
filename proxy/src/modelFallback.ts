// Modellfallback — appar som redan är installerade hos användarna skickar FASTA modell-ID:n (t.ex.
// claude-haiku-4-5). Pensionerar Anthropic en modell svarar API:t 404 not_found_error ("model: …") och
// funktionen skulle sluta fungera tills en ny app-build är ute. Därför:
//  1) Vid "modellen finns inte" provar proxyn nästa modell i familjens kedja (Haiku → nyare Haiku → Sonnet)
//     och minns den fungerande modellen (KV model-resolved:<id>, 7 dagar) → bara första anropet tar omvägen.
//  2) Nyare modeller avvisar `temperature` (400 "`temperature` is deprecated for this model.") → samma
//     modell provas igen utan temperature/top_p/top_k, och modellen minns som "utan sampling".
//  3) Senaste modellen i familjen hämtas DYNAMISKT ur GET /v1/models (nyast created_at) → när t.ex. Haiku 5.5
//     fasas ut och Haiku 6 finns används Haiku 6 utan kodändring. Daglig cron (refreshModelRouting) håller
//     listan aktuell och pekar om försvunna modeller i förväg; vid ett "modellen finns inte" hämtas den direkt.
//  4) Omdirigeringar i kod (DEFAULT_MODEL_MAP — t.ex. gamla app-byggens Sonnet 4.6 → Sonnet 5.5) som KV-
//     nyckeln "model-map" kan överstyra utan deploy: {"claude-haiku-4-5":"claude-haiku-5-5"} eller {"haiku":[…]}.
// Andra fel (rate limit, överlast, ogiltig request) skickas oförändrade till appen.

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';

// Omdirigeringar för modell-ID:n som redan installerade app-byggen begär (KV "model-map" vinner).
// 2026-10-26: Sonnet 4.6 → 5.5 och Haiku 4.5 → 5.5 (billigare per token, samma resultat i skanningstester).
const DEFAULT_MODEL_MAP: Record<string, string | string[]> = {
  'claude-sonnet-4-6': 'claude-sonnet-5-5',
  'claude-haiku-4-5': 'claude-haiku-5-5',
};

// Statiska reserver per familj — används efter den dynamiskt hämtade senaste modellen i familjen.
const FAMILY_CHAINS: Record<string, string[]> = {
  haiku: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  sonnet: ['claude-sonnet-5-5', 'claude-opus-5-5'],
  opus: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  fable: ['claude-fable-5-1', 'claude-opus-5-5'],
};
const DEFAULT_CHAIN = ['claude-sonnet-5-5'];
const MAP_KEY = 'model-map';
const LATEST_KEY = 'model-latest';            // KV: {"haiku":"claude-haiku-5-5", …} — nyaste per familj
const LATEST_TTL_SEC = 3 * 86400;
const LATEST_MEMO_MS = 60 * 60 * 1000;
const RESOLVED_PREFIX = 'model-resolved:';
const RESOLVED_TTL_SEC = 7 * 86400;
const MAP_MEMO_MS = 5 * 60 * 1000;

type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};
export interface FallbackDeps {
  apiKey: string;
  kv?: KVLike;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  log?: (msg: string) => void;
}
export interface FallbackResult { resp: Response; requested: string; used: string; fellBack: boolean }

// Per isolat: omdirigeringar, modeller som avvisar sampling-parametrar, och KV-kartan (kort cache).
const resolvedMemo = new Map<string, string>();
const noSampling = new Set<string>();
let mapMemo: { v: Record<string, string | string[]>; at: number } | null = null;
let latestMemo: { v: Record<string, string>; at: number } | null = null;

// Modeller som avvisar temperature/top_p/top_k (Opus 4.7/4.8 och generation 5+) → skickas utan dem direkt.
const rejectsSampling = (m: string) => /^claude-(?:opus-4-[78]|[a-z]+-(?:[5-9]|\d{2})(?:-|$))/.test(m);

const familyOf = (m: string) =>
  /haiku/.test(m) ? 'haiku' : /sonnet/.test(m) ? 'sonnet' : /opus/.test(m) ? 'opus' : /fable/.test(m) ? 'fable' : '';
const asList = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' ? [v] : null;
const dedupe = (xs: string[]) => [...new Set(xs.filter(Boolean))];

async function loadMap(kv?: KVLike): Promise<Record<string, string | string[]>> {
  if (mapMemo && Date.now() - mapMemo.at < MAP_MEMO_MS) return mapMemo.v;
  let v: Record<string, string | string[]> = { ...DEFAULT_MODEL_MAP };
  try { const raw = kv ? await kv.get(MAP_KEY) : null; if (raw) v = { ...v, ...JSON.parse(raw) }; } catch { /* trasig karta → ignorera */ }
  mapMemo = { v, at: Date.now() };
  return v;
}

/** Kedjan utan minne: omdirigering (eller begärd modell) följt av familjens reserver. */
export async function baseChain(requested: string, kv?: KVLike): Promise<string[]> {
  const map = await loadMap(kv);
  const fam = familyOf(requested);
  const head = asList(map[requested]) ?? [requested];
  const latest = fam ? (await loadLatest(kv))[fam] : undefined; // senaste i familjen (cron/KV)
  const tail = asList(map[fam]) ?? FAMILY_CHAINS[fam] ?? DEFAULT_CHAIN;
  return dedupe([...head, ...(latest ? [latest] : []), ...tail]);
}

// Nyaste modell per familj ur modellistan (created_at); daterade ID:n och alias räknas likadant.
function latestByFamily(models: { id: string; created_at?: string }[]): Record<string, string> {
  const best: Record<string, { id: string; t: number }> = {};
  for (const m of models) {
    const fam = familyOf(m.id);
    if (!fam) continue;
    const t = Date.parse(m.created_at ?? '') || 0;
    const cur = best[fam];
    // Samma tidpunkt → föredra det kortare ID:t (alias utan datum).
    if (!cur || t > cur.t || (t === cur.t && m.id.length < cur.id.length)) best[fam] = { id: m.id, t };
  }
  return Object.fromEntries(Object.entries(best).map(([f, v]) => [f, v.id]));
}
async function loadLatest(kv?: KVLike): Promise<Record<string, string>> {
  if (latestMemo && Date.now() - latestMemo.at < LATEST_MEMO_MS) return latestMemo.v;
  let v: Record<string, string> = {};
  try { const raw = kv ? await kv.get(LATEST_KEY) : null; if (raw) v = JSON.parse(raw); } catch { /* ignorera */ }
  latestMemo = { v, at: Date.now() };
  return v;
}
// Hämta modellistan nu (vid "modellen finns inte" eller från cron) → nyaste per familj sparas i KV + minnet.
async function fetchModels(deps: FallbackDeps): Promise<{ id: string; created_at?: string }[] | null> {
  const doFetch = deps.fetch ?? fetch;
  try {
    const r = await doFetch(MODELS_URL, { method: 'GET', headers: { 'x-api-key': deps.apiKey, 'anthropic-version': '2023-06-01' } });
    if (!r.ok) { deps.log?.(`[model-check] models list failed: ${r.status}`); return null; }
    const data = await r.json() as { data?: { id: string; created_at?: string }[] };
    const models = data.data ?? [];
    if (models.length) {
      const latest = latestByFamily(models);
      latestMemo = { v: latest, at: Date.now() };
      try { await deps.kv?.put(LATEST_KEY, JSON.stringify(latest), { expirationTtl: LATEST_TTL_SEC }); } catch { /* KV valfritt */ }
    }
    return models;
  } catch { return null; }
}

async function getResolved(requested: string, kv?: KVLike): Promise<string | null> {
  if (resolvedMemo.has(requested)) return resolvedMemo.get(requested)!;
  try { const v = kv ? await kv.get(RESOLVED_PREFIX + requested) : null; if (v) { resolvedMemo.set(requested, v); return v; } } catch { /* KV valfritt */ }
  return null;
}
async function remember(requested: string, used: string, kv?: KVLike): Promise<void> {
  if (resolvedMemo.get(requested) === used) return; // redan känt → ingen KV-skrivning
  resolvedMemo.set(requested, used);
  try { await kv?.put(RESOLVED_PREFIX + requested, used, { expirationTtl: RESOLVED_TTL_SEC }); } catch { /* KV valfritt */ }
}
async function forget(requested: string, kv?: KVLike): Promise<void> {
  resolvedMemo.delete(requested);
  try { await kv?.delete(RESOLVED_PREFIX + requested); } catch { /* KV valfritt */ }
}

/** Kedjan som provas: ihågkommen fungerande modell först (den begärda hoppas då över — den är borta). */
export async function modelChain(requested: string, kv?: KVLike): Promise<string[]> {
  const base = await baseChain(requested, kv);
  const resolved = await getResolved(requested, kv);
  return resolved ? dedupe([resolved, ...base.filter((m) => m !== requested)]) : base;
}

function parseError(text: string): { type: string; message: string } {
  try { const j = JSON.parse(text); return { type: String(j?.error?.type ?? ''), message: String(j?.error?.message ?? '') }; } catch { return { type: '', message: '' }; }
}
const isModelGone = (status: number, e: { type: string; message: string }) =>
  (status === 404 && e.type === 'not_found_error' && /model/i.test(e.message))
  || (status === 400 && e.type === 'invalid_request_error' && /\bmodel\b/i.test(e.message)
      && /(not found|does not exist|no longer|retired|deprecated model|unknown model|invalid model)/i.test(e.message));
const isSamplingRejected = (status: number, e: { type: string; message: string }) =>
  status === 400 && e.type === 'invalid_request_error' && /(temperature|top_p|top_k)/i.test(e.message);
const SAMPLING = ['temperature', 'top_p', 'top_k'];
const hasSampling = (b: Record<string, unknown>) => SAMPLING.some((k) => k in b);
const withoutSampling = (b: Record<string, unknown>) => { const c = { ...b }; for (const k of SAMPLING) delete c[k]; return c; };

/**
 * POST /v1/messages med modellfallback. Streamade svar skickas orörda vidare (fel för saknad modell
 * kommer som vanlig JSON före strömmen, så de fångas ändå). Returnerar faktisk modell för telemetrin.
 */
export async function callWithModelFallback(bodyText: string, deps: FallbackDeps): Promise<FallbackResult> {
  const doFetch = deps.fetch ?? fetch;
  const headers = { 'Content-Type': 'application/json', 'x-api-key': deps.apiKey, 'anthropic-version': '2023-06-01' };
  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText); } catch { body = {}; }
  const requested = typeof body.model === 'string' ? body.model : '';
  if (!requested) {
    const resp = await doFetch(MESSAGES_URL, { method: 'POST', headers, body: bodyText });
    return { resp, requested, used: requested, fellBack: false };
  }

  const chain = await modelChain(requested, deps.kv);
  let lastStatus = 404, lastText = '', lastHeaders: HeadersInit = { 'Content-Type': 'application/json' };
  let discovered = false;
  for (let idx = 0; idx < chain.length; idx++) {
    const model = chain[idx];
    let attempt: Record<string, unknown> = { ...body, model };
    if (noSampling.has(model) || rejectsSampling(model)) attempt = withoutSampling(attempt);
    for (let tries = 0; tries < 2; tries++) {
      const resp = await doFetch(MESSAGES_URL, { method: 'POST', headers, body: JSON.stringify(attempt) });
      if (resp.ok) {
        if (model !== requested) {
          await remember(requested, model, deps.kv);
          deps.log?.(`[model-fallback] ${requested} → ${model}`);
        }
        return { resp, requested, used: model, fellBack: model !== requested };
      }
      if (resp.status !== 400 && resp.status !== 404) return { resp, requested, used: model, fellBack: model !== requested };
      const text = await resp.text();
      const err = parseError(text);
      if (isSamplingRejected(resp.status, err) && hasSampling(attempt)) {
        noSampling.add(model);
        attempt = withoutSampling(attempt);
        continue; // samma modell, utan temperature/top_p/top_k
      }
      if (isModelGone(resp.status, err)) {
        deps.log?.(`[model-fallback] ${model} unavailable: ${err.message}`);
        lastStatus = resp.status; lastText = text; lastHeaders = { 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' };
        // Första gången: hämta modellistan nu → senaste modellen i familjen provas härnäst (även en helt ny).
        // (Hoppas över om den kända senaste modellen ännu inte provats i kedjan.)
        if (!discovered) {
          discovered = true;
          const fam = familyOf(requested);
          const known = (await loadLatest(deps.kv))[fam];
          if (!known || chain.indexOf(known) <= idx) {
            if (await fetchModels(deps)) {
              const fresh = (await loadLatest(deps.kv))[fam];
              if (fresh && !chain.includes(fresh)) chain.splice(idx + 1, 0, fresh);
            }
          }
        }
        break; // nästa modell i kedjan
      }
      // Annat 400/404 (t.ex. ogiltig request) → oförändrat till appen.
      return {
        resp: new Response(text, { status: resp.status, headers: { 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' } }),
        requested, used: model, fellBack: model !== requested,
      };
    }
  }
  // Ingen modell i kedjan fungerade → sista felet till appen.
  return { resp: new Response(lastText || '{"type":"error","error":{"type":"not_found_error","message":"no available model"}}', { status: lastStatus, headers: lastHeaders }), requested, used: requested, fellBack: false };
}

/**
 * Daglig kontroll: vilka modeller finns hos Anthropic? Saknas en modell som appen begär → peka om till
 * första tillgängliga i kedjan i förväg (ingen användare får då ett misslyckat anrop). Finns den igen → återställ.
 */
export async function refreshModelRouting(deps: FallbackDeps, requestedModels: string[]): Promise<Record<string, string>> {
  const models = await fetchModels(deps); // sparar även nyaste per familj (dynamisk fallback)
  const ids = (models ?? []).map((m) => m.id);
  if (!ids.length) return {};
  const available = (m: string) => ids.some((id) => id === m || id.startsWith(`${m}-`)); // alias "claude-haiku-4-5" ⇢ "claude-haiku-4-5-20251001"
  const routing: Record<string, string> = {};
  for (const req of dedupe(requestedModels)) {
    const first = (await baseChain(req, deps.kv)).find(available);
    if (!first) { deps.log?.(`[model-check] no available model for ${req}`); continue; }
    routing[req] = first;
    if (first === req) { if (await getResolved(req, deps.kv)) await forget(req, deps.kv); }
    else { await remember(req, first, deps.kv); deps.log?.(`[model-check] ${req} ${available(req) ? 'redirected' : 'unavailable'} → ${first}`); }
  }
  return routing;
}

/** Endast för tester: nollställ isolat-minnet. */
export function _resetModelFallbackMemo(): void { resolvedMemo.clear(); noSampling.clear(); mapMemo = null; latestMemo = null; }
