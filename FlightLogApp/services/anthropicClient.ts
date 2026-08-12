// Gemensam klient för alla Anthropic-API-anrop i appen.
// Ger enhetlig felhantering, trunkeringsskydd, JSON-reparation och prompt-caching.
//
// Ersätter duplicerad fetch/headers/parse-kod som tidigare låg i:
//   services/ocr.ts, services/droneScan.ts, services/aircraftLookup.ts,
//   services/import.ts
//
// Prompt-caching: systemprompten cacheas automatiskt (ephemeral, 5-min TTL)
// så efterföljande anrop inom 5 min får ~90 % lägre input-kostnad på prompten.

// Proxy-URL: appen pratar med din Cloudflare Worker, ALDRIG direkt med Anthropic.
// Proxyn lägger på API-nyckeln — den finns inte i appen.
// Fallback till direkt Anthropic-anrop om PROXY_URL inte är satt (lokalt dev-läge).
import * as Application from 'expo-application';
import { Platform } from 'react-native';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
const API_URL = PROXY_URL || 'https://api.anthropic.com/v1/messages';
const USE_PROXY = !!PROXY_URL;
const ANTHROPIC_VERSION = '2023-06-01';

// Anonym device-ID för telemetri/kvoter — inte personuppgift.
// iOS: identifierForVendor (unikt per enhet) hämtas asynkront en gång och cachas.
// Utan detta föll iOS tillbaka på bundle-id → ALLA iOS-användare delade samma id.
let cachedDeviceId: string | null = null;
try {
  if (Platform.OS === 'ios') {
    Application.getIosIdForVendorAsync?.().then((id) => { if (id) cachedDeviceId = id; }).catch(() => {});
  }
} catch { /* ignore */ }

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    return Application.getAndroidId?.() ?? Application.applicationId ?? Platform.OS;
  } catch {
    return Platform.OS;
  }
}

export type AnthropicContent =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

export interface CallAnthropicOptions {
  model?: string;                        // default 'claude-sonnet-4-6'
  system: string;                        // system prompt (cachas)
  userContent: AnthropicContent[] | string; // string → { type:'text', text }
  maxTokens: number;
  temperature?: number;                  // default 0
  cacheSystemPrompt?: boolean;           // default true
  timeoutMs?: number;                    // default 30000 — höj för långsamma anrop (t.ex. import-mappning)
  onUsage?: (u: { inputTokens: number; outputTokens: number }) => void; // faktisk tokenförbrukning när svaret är klart
}

export interface AnthropicRawResult {
  text: string;
  stopReason: string | null;
}

/**
 * Försöker reparera trunkerad JSON genom att stänga öppna strängar, arrayer
 * och objekt. Används som fallback när Claude-svaret skärs av mitt i.
 * Hellre få delvis data än ett hårt fel.
 */
export function repairTruncatedJson(s: string): string {
  let out = s.trim();
  out = out.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, '');
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (const ch of out) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}') { if (stack[stack.length - 1] === '{') stack.pop(); }
    else if (ch === ']') { if (stack[stack.length - 1] === '[') stack.pop(); }
  }
  if (inString) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }
  return out;
}

// Rapporterar EVERY AI-anrops tokenförbrukning till den lokala kvot-storen
// (oavsett anropstyp — OCR, lookup, import, flightscan, allt delar samma pott).
// Lazy require undviker en cirkulär import (storen importerar inget härifrån).
function reportTokenUsage(total: number): void {
  if (total <= 0) return;
  try {
    const { useTokenQuotaStore } = require('../store/tokenQuotaStore');
    useTokenQuotaStore.getState().recordUsage(total);
  } catch { /* storen är valfri — får aldrig fälla ett AI-anrop */ }
}

/** Bygger HTTP-headers — via proxy behövs ingen API-nyckel från appen. */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (USE_PROXY) {
    headers['X-Device-ID'] = getDeviceId();
    try {
      const { useFlightStore } = require('../store/flightStore');
      const st = useFlightStore.getState();
      if (st.isMax) headers['X-Tier'] = 'max';
      else if (st.isPremium) headers['X-Premium'] = 'true';
    } catch { /* ignore */ }
  } else {
    headers['x-api-key'] = API_KEY;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  }
  return headers;
}

/** Kastar ett tydligt fel för ett icke-OK-svar (hanterar 429/quota särskilt). */
async function throwForErrorResponse(response: { status: number; text: () => Promise<string> }): Promise<never> {
  const errText = await response.text();
  if (response.status === 429) {
    try {
      const quota = JSON.parse(errText);
      if (quota.error === 'quota_exceeded') {
        throw new Error(`QUOTA_EXCEEDED:${quota.type}:${quota.used}:${quota.limit}`);
      }
      if (quota.error === 'token_quota_exceeded') {
        throw new Error(`TOKEN_QUOTA_EXCEEDED:${quota.used}:${quota.limit}`);
      }
    } catch (e: any) {
      if (e.message?.startsWith('QUOTA_EXCEEDED') || e.message?.startsWith('TOKEN_QUOTA_EXCEEDED')) throw e;
    }
  }
  throw new Error(`API-fel ${response.status}: ${errText}`);
}

/** Gör ett råtext-anrop till Claude och returnerar text + stop_reason. */
export async function callAnthropicRaw(opts: CallAnthropicOptions): Promise<AnthropicRawResult> {
  if (!USE_PROXY && (!API_KEY || API_KEY === 'your_api_key_here')) {
    throw new Error('Varken proxy-URL eller API-nyckel är konfigurerad.');
  }

  const userContent = typeof opts.userContent === 'string'
    ? [{ type: 'text' as const, text: opts.userContent }]
    : opts.userContent;

  const cacheSystem = opts.cacheSystemPrompt !== false;
  const systemBlocks = cacheSystem
    ? [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }]
    : opts.system;

  const headers = buildHeaders();

  // Timeout för API-anrop — 30s som standard, höjbart per anrop via timeoutMs
  const timeoutMs = opts.timeoutMs ?? 30000;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model ?? 'claude-sonnet-4-6',
        max_tokens: opts.maxTokens,
        ...(modelDeprecatesTemperature(opts.model ?? 'claude-sonnet-4-6') ? {} : { temperature: opts.temperature ?? 0 }),
        system: systemBlocks,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: abortController.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`API-anrop timeout (${Math.round(timeoutMs / 1000)}s). Kontrollera din internetuppkoppling.`);
    }
    throw err;
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    await throwForErrorResponse(response);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';
  const stopReason = data.stop_reason ?? null;
  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  reportTokenUsage(inputTokens + outputTokens);
  try {
    opts.onUsage?.({ inputTokens, outputTokens });
  } catch { /* usage-rapportering får aldrig fälla anropet */ }
  return { text, stopReason };
}

/**
 * Gör ett API-anrop, extraherar JSON från svaret och parsar det.
 * Hanterar trunkering automatiskt — om stop_reason='max_tokens' kastas ett
 * tydligt fel; annars försöker vi reparera ofullständig JSON.
 */
export async function callAnthropicJson<T = any>(opts: CallAnthropicOptions): Promise<T> {
  const { text, stopReason } = await callAnthropicRaw(opts);
  return parseJsonText<T>(text, stopReason);
}

/** Extraherar och parsar JSON ur ett textsvar (delad av vanligt + streamande anrop). */
function parseJsonText<T>(text: string, stopReason: string | null): T {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  // Try parsing the whole thing first (if AI returned pure JSON)
  try { return JSON.parse(cleaned) as T; } catch {}
  // Fall back to extracting first JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Kunde inte tolka svaret från Claude. Svar: "${text.slice(0, 160)}"`);
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch (e: any) {
    if (stopReason === 'max_tokens') {
      throw new Error(
        'Svaret från AI blev för långt och skars av. Prova färre rader åt gången eller närbild på halvt uppslag.',
      );
    }
    // Försök autoläka trunkerad JSON
    const repaired = repairTruncatedJson(jsonMatch[0]);
    try {
      return JSON.parse(repaired) as T;
    } catch {
      throw new Error(`JSON-fel: ${e.message}. Svaret kan ha trunkerats — prova igen.`);
    }
  }
}

/**
 * Som callAnthropicJson men STREAMAR svaret (SSE via expo/fetch) och rapporterar
 * live-tokenförbrukning under genereringen. onTokens(outputTokens, maxTokens)
 * anropas löpande — uppskattat från textlängd (~3.8 tecken/token) under streamen,
 * exakt siffra från API:ets usage när meddelandet är klart. Kasta-fallet
 * "Strömning stöds inte" låter anroparen falla tillbaka på callAnthropicJson.
 */
export async function callAnthropicJsonStream<T = any>(
  opts: CallAnthropicOptions & {
    onTokens?: (outputTokens: number, maxTokens: number) => void;
    inactivityMs?: number;
  },
): Promise<T> {
  if (!USE_PROXY && (!API_KEY || API_KEY === 'your_api_key_here')) {
    throw new Error('Varken proxy-URL eller API-nyckel är konfigurerad.');
  }
  // Lazy require så web-bundlen inte tvingas dra in expo/fetch i onödan.
  const { fetch: streamFetch } = require('expo/fetch');
  const headers = buildHeaders();

  const userContent = typeof opts.userContent === 'string'
    ? [{ type: 'text' as const, text: opts.userContent }]
    : opts.userContent;
  const cacheSystem = opts.cacheSystemPrompt !== false;
  const systemBlocks = cacheSystem
    ? [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }]
    : opts.system;
  const body = JSON.stringify({
    model: opts.model ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens,
    ...(modelDeprecatesTemperature(opts.model ?? 'claude-sonnet-4-6') ? {} : { temperature: opts.temperature ?? 0 }),
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
    stream: true,
  });

  // Inaktivitetstimer i stället för hård timeout — så länge deltan kommer lever anropet
  const abortController = new AbortController();
  const inactivityMs = opts.inactivityMs ?? 25000;
  let timer: any;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => abortController.abort(), inactivityMs); };
  arm();

  let response: any;
  try {
    response = await streamFetch(API_URL, { method: 'POST', headers, body, signal: abortController.signal });
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`API-anrop avbröts — ingen respons på ${Math.round(inactivityMs / 1000)}s.`);
    }
    throw err;
  }
  if (!response.ok) {
    clearTimeout(timer);
    await throwForErrorResponse(response);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    clearTimeout(timer);
    throw new Error('Strömning stöds inte i denna miljö (response.body saknas). Använd icke-streamande läge.');
  }

  const reader = response.body.getReader();
  const TD = (globalThis as any).TextDecoder;
  const decoder = TD ? new TD() : null;
  const decode = (b: Uint8Array) => (decoder ? decoder.decode(b, { stream: true }) : utf8FromBytes(b));

  let buffer = '';
  let acc = '';
  let stopReason: string | null = null;
  let lastReported = -1;
  let usageIn = 0;
  let usageOut = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decode(value);
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split('\n')) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          const payload = m[1];
          if (!payload || payload === '[DONE]') continue;
          let evt: any;
          try { evt = JSON.parse(payload); } catch { continue; }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            acc += evt.delta.text ?? '';
            const est = Math.round(acc.length / 3.8); // live-uppskattning under generering
            if (est !== lastReported) { lastReported = est; opts.onTokens?.(est, opts.maxTokens); }
          } else if (evt.type === 'message_start') {
            usageIn = evt.message?.usage?.input_tokens ?? 0;
          } else if (evt.type === 'message_delta') {
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            const exact = evt.usage?.output_tokens;
            if (typeof exact === 'number') { usageOut = exact; lastReported = exact; opts.onTokens?.(exact, opts.maxTokens); }
          } else if (evt.type === 'error') {
            throw new Error(`API-fel (stream): ${evt.error?.message ?? 'okänt fel'}`);
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  reportTokenUsage(usageIn + usageOut);
  try { opts.onUsage?.({ inputTokens: usageIn, outputTokens: usageOut }); } catch { /* aldrig fälla anropet */ }
  return parseJsonText<T>(acc, stopReason);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool use / structured output
//
// Tvingar Claude att svara via ett verktygsanrop med ett JSON-schema. Ger
// GARANTERAT giltig JSON — ingen regex-extraktion, ingen trunkeringsreparation,
// inga "kunde inte tolka svaret"-fel. Används för OCR-skanning.
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolCallOptions extends CallAnthropicOptions {
  toolName: string;                      // verktygets namn (t.ex. 'emit_flights')
  inputSchema: Record<string, any>;      // JSON-schema för verktygets input (top-level type:'object')
  toolDescription?: string;
}

// Nyare modeller (t.ex. Opus 4.8) returnerar 400 om `temperature` skickas med.
function modelDeprecatesTemperature(model: string): boolean {
  return /^claude-opus-4-8/.test(model);
}

/** Bygger request-body för ett tvingat verktygsanrop. */
function buildToolBody(opts: ToolCallOptions, stream: boolean): string {
  const cacheSystem = opts.cacheSystemPrompt !== false;
  const systemBlocks = cacheSystem
    ? [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }]
    : opts.system;
  const userContent = typeof opts.userContent === 'string'
    ? [{ type: 'text' as const, text: opts.userContent }]
    : opts.userContent;
  return JSON.stringify({
    model: opts.model ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens,
    ...(modelDeprecatesTemperature(opts.model ?? 'claude-sonnet-4-6') ? {} : { temperature: opts.temperature ?? 0 }),
    system: systemBlocks,
    tools: [{
      name: opts.toolName,
      description: opts.toolDescription ?? 'Returnera strukturerad data',
      input_schema: opts.inputSchema,
    }],
    tool_choice: { type: 'tool', name: opts.toolName },
    ...(stream ? { stream: true } : {}),
    messages: [{ role: 'user', content: userContent }],
  });
}

/**
 * Icke-streamande verktygsanrop. Returnerar verktygets validerade input-objekt.
 * Kräver INGEN proxy-ändring (vanlig POST, vanligt JSON-svar).
 */
export async function callAnthropicTool<T = any>(opts: ToolCallOptions): Promise<T> {
  if (!USE_PROXY && (!API_KEY || API_KEY === 'your_api_key_here')) {
    throw new Error('Varken proxy-URL eller API-nyckel är konfigurerad.');
  }
  const headers = buildHeaders();
  const body = buildToolBody(opts, false);

  // 60s tak (omit-empty + tool-use gör svaren kortare än tidigare 30s-version)
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  let response;
  try {
    response = await fetch(API_URL, { method: 'POST', headers, body, signal: abortController.signal });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('API-anrop timeout (60s). Kontrollera din internetuppkoppling.');
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    await throwForErrorResponse(response);
  }

  const data = await response.json();
  reportTokenUsage((data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0));
  const content = Array.isArray(data.content) ? data.content : [];
  const toolBlock = content.find((c: any) => c.type === 'tool_use');
  if (toolBlock?.input !== undefined) {
    return toolBlock.input as T;
  }
  // Robusthet: om proxyn/modellen råkade svara med text istället för tool_use,
  // fall tillbaka på JSON-extraktion (samma logik som callAnthropicJson).
  const textBlock = content.find((c: any) => c.type === 'text');
  const text: string = textBlock?.text ?? '';
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Inget verktygssvar från Claude. Svar: "${text.slice(0, 160)}"`);
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return JSON.parse(repairTruncatedJson(match[0])) as T;
  }
}

/** Minimal UTF-8-avkodning som fallback om TextDecoder saknas i runtime. */
function utf8FromBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const esc = (globalThis as any).escape;
  try { return decodeURIComponent(esc ? esc(s) : s); } catch { return s; }
}

/**
 * Streamande verktygsanrop via expo/fetch. Ackumulerar tool-use-deltats
 * partial_json och parsar när strömmen är klar. Använder en INAKTIVITETS-timeout
 * (avbryter bara om INGEN token kommit på N sekunder) istället för en total
 * timeout — så långa-men-aktiva svar aldrig dödas.
 *
 * KRÄVER att proxyn (CF Worker) vidarebefordrar SSE-strömmen utan att buffra:
 *   return new Response(upstream.body, { headers: { 'content-type':'text/event-stream' } })
 *
 * onText(delta, acc) anropas per fragment — för framtida live-ifyllning av rader.
 */
export async function callAnthropicToolStream<T = any>(
  opts: ToolCallOptions & { onText?: (delta: string, acc: string) => void; inactivityMs?: number },
): Promise<T> {
  if (!USE_PROXY && (!API_KEY || API_KEY === 'your_api_key_here')) {
    throw new Error('Varken proxy-URL eller API-nyckel är konfigurerad.');
  }
  // Lazy require så web-bundlen inte tvingas dra in expo/fetch i onödan.
  const { fetch: streamFetch } = require('expo/fetch');
  const headers = buildHeaders();
  const body = buildToolBody(opts, true);

  const abortController = new AbortController();
  const inactivityMs = opts.inactivityMs ?? 25000;
  let timer: any;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => abortController.abort(), inactivityMs); };
  arm();

  let response: any;
  try {
    response = await streamFetch(API_URL, { method: 'POST', headers, body, signal: abortController.signal });
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`API-anrop avbröts — ingen respons på ${Math.round(inactivityMs / 1000)}s.`);
    }
    throw err;
  }
  if (!response.ok) {
    clearTimeout(timer);
    await throwForErrorResponse(response);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    clearTimeout(timer);
    throw new Error('Strömning stöds inte i denna miljö (response.body saknas). Använd icke-streamande läge.');
  }

  const reader = response.body.getReader();
  const TD = (globalThis as any).TextDecoder;
  const decoder = TD ? new TD() : null;
  const decode = (b: Uint8Array) => (decoder ? decoder.decode(b, { stream: true }) : utf8FromBytes(b));

  let buffer = '';
  let jsonAcc = '';
  let stopReason: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buffer += decode(value);
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split('\n')) {
          const m = line.match(/^data:\s?(.*)$/);
          if (!m) continue;
          const payload = m[1];
          if (!payload || payload === '[DONE]') continue;
          let evt: any;
          try { evt = JSON.parse(payload); } catch { continue; }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'input_json_delta') {
            const frag = evt.delta.partial_json ?? '';
            jsonAcc += frag;
            opts.onText?.(frag, jsonAcc);
          } else if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
            stopReason = evt.delta.stop_reason;
          } else if (evt.type === 'error') {
            throw new Error(`API-fel (stream): ${evt.error?.message ?? 'okänt fel'}`);
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!jsonAcc) {
    throw new Error('Tomt strömsvar från AI — kontrollera att proxyn vidarebefordrar SSE utan att buffra.');
  }
  try {
    return JSON.parse(jsonAcc) as T;
  } catch (e: any) {
    if (stopReason === 'max_tokens') {
      throw new Error('Svaret blev för långt och skars av. Prova färre rader åt gången eller närbild på halvt uppslag.');
    }
    return JSON.parse(repairTruncatedJson(jsonAcc)) as T;
  }
}
