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

// Anonym device-ID för telemetri — inte personuppgift
function getDeviceId(): string {
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

  // Bygg headers — via proxy behövs ingen API-nyckel från appen
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (USE_PROXY) {
    headers['X-Device-ID'] = getDeviceId();
  } else {
    headers['x-api-key'] = API_KEY;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model ?? 'claude-sonnet-4-6',
      max_tokens: opts.maxTokens,
      temperature: opts.temperature ?? 0,
      system: systemBlocks,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API-fel ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';
  const stopReason = data.stop_reason ?? null;
  return { text, stopReason };
}

/**
 * Gör ett API-anrop, extraherar JSON från svaret och parsar det.
 * Hanterar trunkering automatiskt — om stop_reason='max_tokens' kastas ett
 * tydligt fel; annars försöker vi reparera ofullständig JSON.
 */
export async function callAnthropicJson<T = any>(opts: CallAnthropicOptions): Promise<T> {
  const { text, stopReason } = await callAnthropicRaw(opts);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
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
