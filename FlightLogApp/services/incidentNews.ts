// AI-nyheter: senaste flygincidenter/-olyckor (civila OCH militära) som kan knytas till en specifik
// flygplats/airfield. Använder Claudes web search-verktyg (via proxyn) → senaste ~10 dygnen.
// Resultatet matchas sedan mot flygplats-seedet (ICAO) för att kunna navigera till platsen på kartan.

import { callAnthropicWebSearchJson } from './anthropicClient';

export interface AirportIncident {
  airport: string;        // flygplatsens vanliga namn
  icao: string | null;    // ICAO om identifierbar (för kart-navigering), annars null
  date: string;           // ISO-datum (YYYY-MM-DD) eller fritext om okänt
  summary: string;        // kort sammanfattning (1–2 meningar)
}

// Kostnadskontroll: web search drar mycket tokens (sidinnehåll i kontext). Vi håller nere det via
// få sökningar (max 2), fokuserade källor, Haiku-modellen och kort output. Funktionen är dessutom
// Premium-only + rate-limitad (1 scan/timme) server-side (se proxy/src/index.ts) — faktiska tokens
// debiteras mot coin-potten (ingen rabatt).
const SOURCES = [
  'aviation-safety.net', 'avherald.com', 'flightglobal.com',
  'simpleflying.com', 'aerotime.aero', 'theaviationist.com',
];

const SYSTEM = `You are an aviation-safety news assistant for a pilot logbook app. Using web search, find
flight incidents and accidents — BOTH civil and military — from the LAST 5 DAYS that happened at, or can
be clearly linked to, a specific airport or airfield (takeoff, landing, runway excursion, ground incident,
go-around, emergency diversion, military airbase mishap, etc.). Only include events tied to a named airport
or airfield; skip en-route events with no airport link. Prefer reputable sources. Be token-efficient.`;

const USER = `Search the web and return the most recent airport-linked flight incidents from the last 5 days.
Return ONLY a JSON object, no prose, in exactly this shape:
{"incidents":[{"airport":"<common airport name>","icao":"<ICAO code or null>","date":"<YYYY-MM-DD>","summary":"<1-2 sentence plain-English summary>"}]}
Rules: most recent first; up to 15 items; "icao" must be the 4-letter ICAO code when you can identify it
(e.g. KLAX, EGLL, KJFK), otherwise null; keep summaries concise and factual; if you find nothing, return
{"incidents":[]}.`;

export async function fetchAirportIncidents(): Promise<AirportIncident[]> {
  const res = await callAnthropicWebSearchJson<{ incidents?: AirportIncident[] }>({
    system: SYSTEM,
    userContent: USER,
    maxTokens: 2000,
    maxSearches: 2,
    allowedDomains: SOURCES,
    feature: 'incident-news',
    timeoutMs: 120000,
  });
  const list = Array.isArray(res?.incidents) ? res.incidents : [];
  // Normalisera + släng uppenbart tomma rader; ICAO uppercase.
  return list
    .filter((i) => i && (i.airport || i.summary))
    .map((i) => ({
      airport: String(i.airport ?? '').trim() || 'Unknown airport',
      icao: i.icao ? String(i.icao).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || null : null,
      date: String(i.date ?? '').trim(),
      summary: String(i.summary ?? '').trim(),
    }))
    .slice(0, 15);
}
