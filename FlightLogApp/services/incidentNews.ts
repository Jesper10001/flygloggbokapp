// Flygincident-nyheter (Global map → News). Hybrid, kostnadsoptimerad: proxyn hämtar RSS från etablerade
// flyg-nyhetskällor (gratis) och kör EN liten Haiku-pass för att strukturera + plocka ICAO, och CACHAR
// resultatet globalt i 1 timme. Appen GET:ar bara den färdiga listan → ingen web search, inga tokens från
// användarens pott. Fortsatt Premium-only (server-side). Resultatet matchas mot flygplats-seedet för
// kart-navigering. Se proxy/src/index.ts (GET /incident-news).

import { getDeviceId } from './anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';

export interface AirportIncident {
  airport: string;        // flygplatsens vanliga namn
  icao: string | null;    // ICAO om identifierbar (för kart-navigering), annars null
  date: string;           // ISO-datum (YYYY-MM-DD) eller fritext om okänt
  summary: string;        // kort sammanfattning (1–2 meningar)
  link: string | null;    // länk till källartikeln (attribution)
  source: string | null;  // källans namn (t.ex. "AVweb")
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'X-Device-ID': getDeviceId() };
  try {
    const { useFlightStore } = require('../store/flightStore');
    const st = useFlightStore.getState();
    if (st.isMax) h['X-Tier'] = 'max';
    else if (st.isPremium) h['X-Premium'] = 'true';
  } catch { /* ignore */ }
  return h;
}

export async function fetchAirportIncidents(): Promise<AirportIncident[]> {
  if (!PROXY_URL) throw new Error('news_unavailable');
  const base = PROXY_URL.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(`${base}/incident-news`, { headers: headers(), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 403) throw new Error('premium_required');
  if (!res.ok) throw new Error(`news_unavailable_${res.status}`);
  const data = await res.json().catch(() => ({}));
  const list: AirportIncident[] = Array.isArray((data as any)?.incidents) ? (data as any).incidents : [];
  // Normalisera + släng uppenbart tomma rader; ICAO uppercase.
  return list
    .filter((i) => i && (i.airport || i.summary))
    .map((i) => ({
      airport: String(i.airport ?? '').trim() || 'Unknown airport',
      icao: i.icao ? String(i.icao).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || null : null,
      date: String(i.date ?? '').trim(),
      summary: String(i.summary ?? '').trim(),
      link: i.link ? String(i.link).trim() : null,
      source: i.source ? String(i.source).trim() : null,
    }))
    .slice(0, 15);
}
