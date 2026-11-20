// GET /notam?icao=ESSA → aktuella NOTAM för en svensk flygplats ur LFV:s officiella Pre-Flight Information
// Bulletin (ESAA FIR VFR 24hr, uppdateras var 30:e minut). Gratis: ingen AI, bara PDF → text → parser.
// Hela bulletinen tolkas en gång och delas av alla användare via KV i NOTAM_TTL_MS.
import { extractText, getDocumentProxy } from 'unpdf';
import { parsePib, pibIssued } from './notamParse.mjs';

const LIST_URL = 'https://aro.lfv.se/Links/Link/ShowFileList?type=AIS&path=%5Cpibsweden%5C&torlinkName=NOTAM%20Sweden';
const KV_KEY = 'notam:v1:pib';
const NOTAM_TTL_MS = 15 * 60 * 1000;
const UA = { 'User-Agent': 'BladesApp/1.0 (+https://blades-app.com)' };

type Kv = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
type Pib = { fetched: number; issued: string | null; pibUrl: string; ads: Record<string, any> };

async function fetchPib(): Promise<Pib> {
  const html = await (await fetch(LIST_URL, { headers: UA })).text();
  const links = [...html.matchAll(/href="([^"]*ESAA FIR VFR 24hr_(\d{14})\.pdf)"/g)];
  if (!links.length) throw new Error('pib_link_missing');
  links.sort((a, b) => b[2].localeCompare(a[2]));
  const pibUrl = encodeURI(links[0][1]);
  const r = await fetch(pibUrl, { headers: UA });
  if (!r.ok) throw new Error(`pib_${r.status}`);
  const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  const raw = Array.isArray(text) ? text.join(' ') : text;
  const ads = parsePib(raw);
  if (Object.keys(ads).length < 20) throw new Error('pib_parse_failed');
  return { fetched: Date.now(), issued: pibIssued(raw), pibUrl, ads };
}

async function getPib(kv: Kv | undefined): Promise<Pib> {
  let cached: Pib | null = null;
  if (kv) { try { cached = JSON.parse((await kv.get(KV_KEY)) ?? 'null'); } catch {} }
  if (cached && Date.now() - cached.fetched < NOTAM_TTL_MS) return cached;
  try {
    const fresh = await fetchPib();
    if (kv) await kv.put(KV_KEY, JSON.stringify(fresh), { expirationTtl: 86400 });
    return fresh;
  } catch (e) {
    if (cached) return cached;   // LFV nere: senaste bulletinen hellre än inget (appen visar tiden)
    throw e;
  }
}

export async function handleNotam(request: Request, env: { QUOTA_KV?: Kv }, cors: Record<string, string>): Promise<Response> {
  const icao = (new URL(request.url).searchParams.get('icao') ?? '').toUpperCase();
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (!/^ES[A-Z]{2}$/.test(icao)) return json({ error: 'swedish_icao_only' }, 400);
  try {
    const pib = await getPib(env.QUOTA_KV);
    const ad = pib.ads[icao];
    return json({
      icao, issued: pib.issued, pibUrl: pib.pibUrl, listUrl: LIST_URL,
      covered: !!ad, notams: ad?.notams ?? [], snowtam: ad?.snowtam ?? null,
    });
  } catch (e) {
    return json({ error: 'notam_unavailable', listUrl: LIST_URL, detail: String((e as Error)?.message ?? e) }, 502);
  }
}
