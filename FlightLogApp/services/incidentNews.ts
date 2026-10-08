// Flygincident-nyheter (Global map → News). Hybrid, kostnadsoptimerad: proxyn hämtar RSS från etablerade
// flyg-nyhetskällor (gratis) och kör EN liten Haiku-pass för att strukturera + plocka ICAO, och CACHAR
// resultatet globalt i 1 timme. Appen GET:ar bara den färdiga listan → ingen web search, inga tokens från
// användarens pott. Fortsatt Premium-only (server-side). Resultatet matchas mot flygplats-seedet för
// kart-navigering. Se proxy/src/index.ts (GET /incident-news).

import { getDeviceId } from './anthropicClient';
import { getAirportByIcaoOrIata, getBestAirportByCity, searchAirports } from '../db/icao';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';

export interface AirportIncident {
  airport: string;        // flygplatsens vanliga namn
  icao: string | null;    // ICAO från nyheten (kan vara fel/saknas)
  date: string;           // ISO-datum (YYYY-MM-DD) eller fritext om okänt
  summary: string;        // kort sammanfattning (1–2 meningar)
  link: string | null;    // länk till källartikeln (attribution)
  source: string | null;  // källans namn (t.ex. "AVweb")
  resolvedIcao?: string | null; // lokalt verifierad ICAO (finns i vår DB) → driver "Map"-knappen
}

// Normaliserar ett flygplatsnamn för jämförelse (bort med "international/airport/…" + skiljetecken).
function normName(s: string): string {
  return (s || '').toLowerCase()
    .replace(/\b(international|airport|airfield|air ?base|regional|municipal|intl|aerodrome|field)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Token-baserad namn-matchning: lika efter normalisering, ELLER att ALLA betydande ord (≥3 tecken) i
// nyhetens namn finns som HELA ord i DB-namnet. Undviker lösa substräng-träffar (t.ex. "Abha"⊄"Sabha").
function nameMatches(query: string, dbName: string): boolean {
  const q = normName(query), d = normName(dbName);
  if (!q || !d) return false;
  if (q === d) return true;
  const qTokens = q.split(' ').filter((t) => t.length >= 3);
  const dTokens = new Set(d.split(' ').filter(Boolean));
  return qTokens.length > 0 && qTokens.every((t) => dTokens.has(t));
}

/**
 * Löser upp varje incidents flygplats till en ICAO som FINNS i vår lokala databas (för kart-knappen),
 * helt utan AI. NAMNET matchas FÖRST — nyhetens koder är opålitliga och krockar dessutom på GPS/IATA
 * (t.ex. "KJRO" matchade GPS-koden för en US-flygplats istället för Kilimanjaro/HTKJ). Fallback: bara
 * en EXAKT 4-bokstavs ICAO ur nyheten (ej GPS/IATA-fuzzy).
 */
// Hittar bästa DB-ICAO för ett flygplatsnamn. Söker på det NORMALISERADE namnet (utan "Regional/
// International/Airport…") och faller tillbaka på första betydande ordet, eftersom searchAirports
// matchar hela söksträngen som delsträng ("Abha Regional" finns inte i "Abha International Airport").
// Rangordnar träffar: exakt normaliserat namn > riktig flygplatstyp > kortast namn (mest kanoniskt).
async function findIcaoByName(name: string): Promise<string | null> {
  const norm = normName(name);
  if (!norm) return null;
  const queries = [norm];
  const firstTok = norm.split(' ').filter((t) => t.length >= 3)[0];
  if (firstTok && firstTok !== norm) queries.push(firstTok);
  for (const q of queries) {
    const res = await searchAirports(q, 2).catch(() => []);
    const cands = res.filter((r) => !(r as any).temporary && nameMatches(name, r.name));
    if (!cands.length) continue;
    // Rangordna: riktig kommersiell flygplats först (har IATA) → större typ → exakt normaliserat namn
    // → kortast namn. Så "Heathrow" → EGLL (London Heathrow) och inte en liten privat "Heathrow"-strip.
    const typeRank = (t: string) => (t === 'large' ? 0 : t === 'medium' ? 1 : t === 'small' ? 2 : 3);
    cands.sort((a, b) => {
      const ai = (a as any).iata ? 0 : 1, bi = (b as any).iata ? 0 : 1;
      if (ai !== bi) return ai - bi;
      const at = typeRank((a as any).type), bt = typeRank((b as any).type);
      if (at !== bt) return at - bt;
      const ax = normName(a.name) === norm ? 0 : 1, bx = normName(b.name) === norm ? 0 : 1;
      if (ax !== bx) return ax - bx;
      return (a.name?.length ?? 0) - (b.name?.length ?? 0);
    });
    return cands[0].icao;
  }
  return null;
}

export async function resolveIncidentIcaos(incidents: AirportIncident[]): Promise<AirportIncident[]> {
  return Promise.all(incidents.map(async (inc) => {
    let resolvedIcao: string | null = null;
    const name = (inc.airport || '').trim();
    const named = name.length >= 4 && !/^unknown/i.test(name);
    // 1) Namn-matchning (primär, mest pålitlig).
    if (named) {
      resolvedIcao = await findIcaoByName(name);
    }
    // 2) Nyhetens kod som EXAKT ICAO eller IATA (ej GPS → undviker "KJRO"-krocken).
    if (!resolvedIcao && inc.icao && /^[A-Za-z0-9]{3,4}$/.test(inc.icao.trim())) {
      const a = await getAirportByIcaoOrIata(inc.icao.trim()).catch(() => null);
      if (a && !(a as any).temporary) resolvedIcao = a.icao;
    }
    // 3) Stad/municipality-fallback: fångar namn där flygplatsen heter annat än staden
    //    (t.ex. "Riyadh International" → King Khalid/OERK, municipality=Riyadh).
    if (!resolvedIcao && named) {
      for (const tok of normName(name).split(' ').filter((t) => t.length >= 4)) {
        const a = await getBestAirportByCity(tok).catch(() => null);
        if (a) { resolvedIcao = a.icao; break; }
      }
    }
    return { ...inc, resolvedIcao };
  }));
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
