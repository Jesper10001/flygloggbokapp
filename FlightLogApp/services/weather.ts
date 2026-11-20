// Väder för senaste destinationsflygplatsen (visas som rullande ticker överst på dashboarden).
// Hämtar METAR + TAF från NOAA aviationweather.gov (gratis, ingen nyckel) och AVKODAR dem till
// läsbar prosa (ingen rå "29008KT CAVOK 21/04 Q1002"). Om destinationen saknar METAR eller TAF
// väljs närmaste flygplats som har både och (via getNearbyAirports, sorterat på avstånd).
import { getAirportByIcao, getNearbyAirports } from '../db/icao';

export type FlightCat = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
export type WxStatus = 'fresh' | 'aging' | 'stale'; // färgkod: grön / orange / röd

export type DecodedWx = {
  destIcao: string;             // ursprunglig destination
  // METAR — vald oberoende: destinationen om den har METAR, annars närmaste fält med METAR.
  metarStation: string | null;
  metarStationName?: string;
  metarIsAlternate: boolean;
  metarText: string;            // tolkad METAR (prosa), '' om ingen
  metarTimeZ: string;           // observationstid, "1520Z"
  metarStatus: WxStatus | null; // hur aktuell METAR:en är
  category: FlightCat | null;
  // TAF — vald oberoende: destinationen om den har TAF, annars närmaste fält med TAF.
  tafStation: string | null;
  tafStationName?: string;
  tafIsAlternate: boolean;
  tafText: string | null;       // tolkad TAF (prosa), null om ingen
  tafStatus: WxStatus | null;
  rawMetar?: string;
  rawTaf?: string;
  // Väderkortet på dashboarden: observationens tid, fyra korta värden och nästa förändring i TAF.
  metarObsMs: number | null;
  cells: WxCells | null;        // null utan METAR
  tafNext: TafNext | null;      // null utan TAF
  // Råa API-objekten (aviationweather.gov JSON) för vädersidan, som bygger tidslinjen själv (services/wxPage.ts).
  metarObj?: any;
  tafObj?: any;
};

// Ett värde på väderkortet: stora siffran och enheten under.
export type WxCell = { value: string; unit: string };
export type WxCells = { wind: WxCell; vis: WxCell; cloud: WxCell; qnh: WxCell };
// Nästa förändring i TAF som en rad, och flygkategorin den ger (null när raden inte säger något om tak/sikt).
export type TafNext = { text: string; category: FlightCat | null };

const METAR_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_URL = 'https://aviationweather.gov/api/data/taf';

// ── Små hjälpare ────────────────────────────────────────────────────────────
export function num(v: any): number { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : NaN; }
export function pad2(n: number): string { return String(n).padStart(2, '0'); }
function zulu(epochSec: number): string { const d = new Date(epochSec * 1000); return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z`; }
// Som zulu men med UTC-dag i parentes → "1800Z (18)", så TAF-perioder visar vilket dygn de gäller.
function zuluDay(epochSec: number): string { const d = new Date(epochSec * 1000); return `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z (${pad2(d.getUTCDate())})`; }

export function parseVis(v: any): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.replace('+', '').trim();
    if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b : null; }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Avkodare (METAR/TAF-fält → prosa) ────────────────────────────────────────
export function windProse(wdir: any, wspd: any, wgst: any): string {
  const spd = num(wspd);
  if (!spd || spd <= 0) return 'wind calm';
  const dir = wdir === 'VRB' || wdir == null || wdir === '' ? 'variable' : `from ${String(wdir).padStart(3, '0')}°`;
  const g = num(wgst);
  const gust = Number.isFinite(g) && g > 0 ? `, gusting ${g} kt` : '';
  return `wind ${dir} at ${spd} kt${gust}`;
}

export function visProse(v: any): string {
  const sm = parseVis(v); // API:t rapporterar sikt i statute miles
  if (sm == null) return '';
  const km = sm * 1.609344;
  // "+"-värden och allt ≥10 km visas som "10 km or more" (motsvarar metriska 9999 / CAVOK).
  if ((typeof v === 'string' && v.includes('+')) || km >= 10) return 'visibility 10 km or more';
  const val = Math.round(km * 10) / 10; // en decimal
  return `visibility ${val} km`;
}

const WX_PHEN: Record<string, string> = {
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals', PL: 'ice pellets',
  GR: 'hail', GS: 'small hail', UP: 'unknown precipitation', BR: 'mist', FG: 'fog', FU: 'smoke',
  VA: 'volcanic ash', DU: 'widespread dust', SA: 'sand', HZ: 'haze', PY: 'spray', PO: 'dust whirls',
  SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm',
};
const WX_DESC = new Set(['MI', 'PR', 'BC', 'DR', 'BL', 'SH', 'TS', 'FZ']);

function decodeWxToken(tok: string): string {
  let s = tok, vicinity = false, intensity = '';
  if (s.startsWith('VC')) { vicinity = true; s = s.slice(2); }
  if (s[0] === '-') { intensity = 'light '; s = s.slice(1); }
  else if (s[0] === '+') { intensity = 'heavy '; s = s.slice(1); }
  let desc = '';
  if (WX_DESC.has(s.slice(0, 2))) { desc = s.slice(0, 2); s = s.slice(2); }
  const phen: string[] = [];
  while (s.length >= 2 && WX_PHEN[s.slice(0, 2)]) { phen.push(WX_PHEN[s.slice(0, 2)]); s = s.slice(2); }
  const phenText = phen.join(' and ');
  let core: string;
  switch (desc) {
    case 'TS': core = phenText ? `thunderstorm with ${phenText}` : 'thunderstorm'; break;
    case 'SH': core = phenText ? `showers of ${phenText}` : 'showers'; break;
    case 'FZ': core = phenText ? `freezing ${phenText}` : 'freezing'; break;
    case 'MI': core = `shallow ${phenText}`; break;
    case 'PR': core = `partial ${phenText}`; break;
    case 'BC': core = `patches of ${phenText}`; break;
    case 'DR': core = `low drifting ${phenText}`; break;
    case 'BL': core = `blowing ${phenText}`; break;
    default: core = phenText;
  }
  core = (intensity + core).trim();
  if (!core) return '';
  return vicinity ? `${core} in the vicinity` : core;
}

export function wxProse(wxString: any): string {
  if (!wxString || typeof wxString !== 'string') return '';
  return wxString.trim().split(/\s+/).map(decodeWxToken).filter(Boolean).join(', ');
}

const CLOUD_COVER: Record<string, string> = {
  FEW: 'few clouds', SCT: 'scattered clouds', BKN: 'broken clouds', OVC: 'overcast',
  CLR: 'sky clear', SKC: 'sky clear', NSC: 'no significant cloud', NCD: 'no cloud detected',
};
export function cloudsProse(clouds: any): string {
  if (!Array.isArray(clouds) || !clouds.length) return 'sky clear';
  return clouds.map((c) => {
    const label = CLOUD_COVER[c?.cover] ?? c?.cover ?? '';
    if (!c?.cover || ['CLR', 'SKC', 'NSC', 'NCD'].includes(c.cover)) return label;
    const base = typeof c.base === 'number' ? ` at ${c.base.toLocaleString('en-US')} ft` : '';
    const cb = c.type === 'CB' ? ' (cumulonimbus)' : c.type === 'TCU' ? ' (towering cumulus)' : '';
    return `${label}${base}${cb}`;
  }).filter(Boolean).join(', ');
}

function tempProse(temp: any, dewp: any): string {
  const t = typeof temp === 'number' ? `temperature ${Math.round(temp)}°C` : '';
  const d = typeof dewp === 'number' ? `dew point ${Math.round(dewp)}°C` : '';
  return [t, d].filter(Boolean).join(', ');
}
function altProse(altim: any): string {
  const a = num(altim);
  if (!a) return '';
  return a > 100 ? `QNH ${Math.round(a)} hPa` : `altimeter ${a.toFixed(2)} inHg`;
}

// Flygväderkategori ur takhöjd (lägsta BKN/OVC-bas) + sikt.
export function categoryOf(clouds: any, visib: any): FlightCat | null {
  const vis = parseVis(visib);
  let ceil = Infinity;
  if (Array.isArray(clouds)) for (const c of clouds) {
    if ((c?.cover === 'BKN' || c?.cover === 'OVC') && typeof c.base === 'number') ceil = Math.min(ceil, c.base);
  }
  if (vis == null && ceil === Infinity) return null;
  const v = vis ?? 99;
  if (ceil < 500 || v < 1) return 'LIFR';
  if (ceil < 1000 || v < 3) return 'IFR';
  if (ceil <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

// Färskhet för färgkodning. METAR: baserat på observationens ålder (rutin-METAR ~1 gång/timme).
function metarStatusOf(obsMs: number): WxStatus {
  if (!Number.isFinite(obsMs)) return 'aging';
  const min = (Date.now() - obsMs) / 60000;
  if (min <= 60) return 'fresh';   // inom timmen → grön
  if (min <= 120) return 'aging';  // nästa obs försenad → orange
  return 'stale';                   // gammal → röd
}
// TAF: baserat på giltighetsfönstret (validTimeTo). Utgången → röd, < 2h kvar → orange, annars grön.
function tafStatusOf(_validFromSec: any, validToSec: any): WxStatus {
  const to = num(validToSec) * 1000;
  if (!Number.isFinite(to) || to <= 0) return 'fresh';
  const now = Date.now();
  if (now > to) return 'stale';
  if (to - now <= 2 * 3600 * 1000) return 'aging';
  return 'fresh';
}

function metarProse(m: any): string {
  const cavok = typeof m?.rawOb === 'string' && /\bCAVOK\b/.test(m.rawOb);
  const parts = cavok
    ? [windProse(m.wdir, m.wspd, m.wgst), 'CAVOK', tempProse(m.temp, m.dewp), altProse(m.altim)]
    : [windProse(m.wdir, m.wspd, m.wgst), visProse(m.visib), wxProse(m.wxString), cloudsProse(m.clouds), tempProse(m.temp, m.dewp), altProse(m.altim)];
  return parts.filter(Boolean).join(', ');
}

// Kort tolkad sammanfattning: BARA vind · sikt · moln · QNH (utan temp/daggpunkt/väderfenomen).
function metarBrief(m: any): string {
  const cavok = typeof m?.rawOb === 'string' && /\bCAVOK\b/.test(m.rawOb);
  const parts = cavok
    ? [windProse(m.wdir, m.wspd, m.wgst), 'CAVOK', altProse(m.altim)]
    : [windProse(m.wdir, m.wspd, m.wgst), visProse(m.visib), cloudsProse(m.clouds), altProse(m.altim)];
  return parts.filter(Boolean).join('  ·  ');
}

function tafPeriodPrefix(f: any, isFirst: boolean): string {
  const from = f.timeFrom ? zuluDay(f.timeFrom) : '';
  const to = f.timeTo ? zuluDay(f.timeTo) : '';
  const prob = num(f.probability) > 0 ? `${num(f.probability)}% probability ` : '';
  switch (f.fcstChange) {
    case 'TEMPO': return `${prob}temporarily ${from}–${to}: `;
    case 'BECMG': return `becoming ${from}–${to}: `;
    case 'FM': return `from ${from}: `;
    default: return isFirst ? `${from}–${to}: ` : `from ${from}: `;
  }
}
export function tafPeriodProse(f: any): string {
  return [
    f.wdir != null || f.wspd != null ? windProse(f.wdir, f.wspd, f.wgst) : '',
    f.visib != null ? visProse(f.visib) : '',
    wxProse(f.wxString),
    Array.isArray(f.clouds) && f.clouds.length ? cloudsProse(f.clouds) : '',
  ].filter(Boolean).join(', ');
}
function tafProse(t: any): string {
  const fcsts = Array.isArray(t?.fcsts) ? t.fcsts : [];
  const periods = fcsts.map((f: any, i: number) => {
    const body = tafPeriodProse(f);
    return body ? `${tafPeriodPrefix(f, i === 0)}${body}` : '';
  }).filter(Boolean);
  return periods.join('; ');
}

// ── Väderkortet på dashboarden: fyra korta värden + nästa förändring i TAF ────
const NO_CELL: WxCell = { value: '—', unit: '' };
// 3500 → "3 500" (hårt mellanslag, så talet aldrig bryts).
export const grouped = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
export const isCavok = (m: any) => typeof m?.rawOb === 'string' && /\bCAVOK\b/.test(m.rawOb);
const COVER_WORD: Record<string, string> = { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast' };

export function windCell(m: any): WxCell {
  const spd = num(m?.wspd);
  if (m?.wspd == null || !Number.isFinite(spd)) return NO_CELL;
  if (spd <= 0) return { value: 'Calm', unit: '' };
  const d = num(m.wdir);
  const dir = Number.isFinite(d) ? `${String(Math.round(d)).padStart(3, '0')}°` : 'VRB';
  const g = num(m.wgst);
  return { value: `${dir}/${spd}`, unit: Number.isFinite(g) && g > 0 ? `kt, gusts ${g}` : 'kt' };
}

export function visCell(v: any): WxCell {
  const sm = parseVis(v); // API:t rapporterar sikt i statute miles
  if (sm == null) return NO_CELL;
  const km = sm * 1.609344;
  if ((typeof v === 'string' && v.includes('+')) || km >= 10) return { value: '10+', unit: 'km' };
  if (km < 1) return { value: String(Math.round((km * 1000) / 50) * 50), unit: 'm' };
  return { value: String(km < 5 ? Math.round(km * 10) / 10 : Math.round(km)), unit: 'km' };
}

// Lägsta taket (BKN/OVC). Utan tak: null.
export function ceilingOf(clouds: any): { base: number; cover: string } | null {
  let best: { base: number; cover: string } | null = null;
  if (Array.isArray(clouds)) for (const c of clouds) {
    if ((c?.cover === 'BKN' || c?.cover === 'OVC') && typeof c.base === 'number' && (!best || c.base < best.base)) best = { base: c.base, cover: c.cover };
  }
  return best;
}

// Molnrutan: taket om det finns ett, annars det lägsta lagret.
export function cloudCell(m: any): WxCell {
  const clouds: any[] = Array.isArray(m?.clouds) ? m.clouds : [];
  const ceil = ceilingOf(clouds);
  if (ceil) return { value: grouped(ceil.base), unit: `ft, ${COVER_WORD[ceil.cover]}` };
  let low: any = null;
  for (const c of clouds) if (COVER_WORD[c?.cover] && typeof c.base === 'number' && (!low || c.base < low.base)) low = c;
  if (low) return { value: grouped(low.base), unit: `ft, ${COVER_WORD[low.cover]}` };
  const cover = clouds[0]?.cover;
  if (cover === 'OVX') return { value: 'Obscured', unit: '' };
  if (cover === 'NSC' || cover === 'NCD') return { value: cover, unit: '' };
  return { value: 'Clear', unit: '' };
}

export function qnhCell(altim: any): WxCell {
  const a = num(altim);
  if (!a) return NO_CELL;
  return a > 100 ? { value: String(Math.round(a)), unit: 'hPa' } : { value: a.toFixed(2), unit: 'inHg' };
}

export function metarCells(m: any): WxCells {
  const cavok = isCavok(m);
  return {
    wind: windCell(m),
    vis: cavok ? { value: '10+', unit: 'km' } : visCell(m?.visib),
    cloud: cavok ? { value: 'CAVOK', unit: '' } : cloudCell(m),
    qnh: qnhCell(m?.altim),
  };
}

// "18z", "18:30z", "06z tomorrow" (dygnet räknas i UTC, som tiden).
export function hourZ(sec: number, nowSec: number): string {
  const d = new Date(sec * 1000);
  const hm = d.getUTCMinutes() ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}z` : `${pad2(d.getUTCHours())}z`;
  const days = Math.floor(sec / 86400) - Math.floor(nowSec / 86400);
  // Längre fram än i morgon (sällsynt, en TAF gäller högst 30 timmar): dagen i parentes, som i den tolkade TAF:en.
  return days === 1 ? `${hm} tomorrow` : days > 1 ? `${hm} (${pad2(d.getUTCDate())})` : hm;
}

// En TAF-periods delar som korta texter ('' = perioden säger inget om den delen).
type TafParts = { cloud: string; wx: string; vis: string; wind: string; gusty: boolean };
function tafParts(f: any): TafParts {
  const clouds: any[] = Array.isArray(f?.clouds) ? f.clouds : [];
  const ceil = ceilingOf(clouds);
  let cloud = '';
  if (ceil) cloud = `cloud base ${grouped(ceil.base)} ft`;
  else {
    let low: any = null;
    for (const c of clouds) if (COVER_WORD[c?.cover] && typeof c.base === 'number' && (!low || c.base < low.base)) low = c;
    const cover = clouds[0]?.cover;
    cloud = low ? `${CLOUD_COVER[low.cover]} at ${grouped(low.base)} ft`
      : cover === 'OVX' ? 'sky obscured'
      : cover ? (CLOUD_COVER[cover] ?? '') : '';
  }
  if (cloud && clouds.some((c) => c?.type === 'CB')) cloud += ', cumulonimbus';
  const v = f?.visib != null ? visCell(f.visib) : NO_CELL;
  const w = windCell(f);
  const g = num(f?.wgst);
  return {
    cloud,
    wx: wxProse(f?.wxString),
    vis: v.value === '—' ? '' : `visibility ${v.value} ${v.unit}`,
    wind: w.value === '—' ? '' : w.value === 'Calm' ? 'wind calm' : `wind ${w.value} ${w.unit}`,
    gusty: Number.isFinite(g) && g > 0,
  };
}

// Det en TAF-period ändrar, kort. En tillfällig period (TEMPO/PROB) anger bara det som avviker, så allt i den
// räknas. En ny grundperiod (FM/BECMG) kommer med hela läget, så där jämförs den med perioden före (prev) och
// bara skillnaden visas. Vinden står med när den är byig eller när inget annat ändras. '' = inget att visa.
export function tafPeriodBrief(f: any, prev?: any): string {
  const now = tafParts(f);
  const before = prev ? tafParts(prev) : null;
  const parts: string[] = [];
  if (now.cloud && now.cloud !== before?.cloud) parts.push(now.cloud);
  if (now.wx !== (before?.wx ?? '')) parts.push(now.wx || 'no significant weather');
  // Sikt på 10 km eller mer är bara värd en plats när den är en förbättring mot perioden före.
  if (now.vis && now.vis !== before?.vis && (before ? true : now.vis !== 'visibility 10+ km')) parts.push(now.vis);
  if (now.wind && now.wind !== before?.wind && (now.gusty || !parts.length)) parts.push(now.wind);
  return parts.join(', ');
}

// Nästa förändring i en TAF som en rad: en tillfällig period som pågår, annars nästa period som börjar.
// Grundperioden som gäller just nu är ingen förändring. Ingen förändring kvar → "No change expected before 21z".
export function tafNextChange(t: any, nowMs: number = Date.now()): TafNext | null {
  const now = nowMs / 1000;
  const validTo = num(t?.validTimeTo);
  if (validTo > 0 && now > validTo) return { text: 'This forecast has expired', category: null };
  const fcsts: any[] = (Array.isArray(t?.fcsts) ? t.fcsts : []).filter((f: any) => num(f?.timeFrom) > 0);
  const isTemp = (f: any) => f.fcstChange === 'TEMPO' || f.fcstChange === 'PROB';
  const ahead = fcsts
    .filter((f) => {
      if (num(f.timeFrom) > now) return true;                                   // börjar senare
      if (isTemp(f)) return num(f.timeTo) > now;                                // tillfällig period som pågår
      return f.fcstChange === 'BECMG' && num(f.timeBec) > now;                  // övergång som pågår
    })
    .sort((a, b) => num(a.timeFrom) - num(b.timeFrom));
  for (const f of ahead) {
    // Grundperioden före (för FM/BECMG): den senaste som inte är tillfällig och som börjar tidigare.
    const prev = isTemp(f) ? undefined : fcsts.filter((p) => !isTemp(p) && num(p.timeFrom) < num(f.timeFrom)).sort((a, b) => num(b.timeFrom) - num(a.timeFrom))[0];
    const body = tafPeriodBrief(f, prev);
    if (!body) continue;
    const from = num(f.timeFrom), to = num(f.timeTo);
    const started = from <= now;
    let lead: string;
    if (isTemp(f)) {
      const prob = num(f.probability) > 0 ? `${num(f.probability)}% chance` : 'At times';
      const until = to > 0 ? hourZ(to, now) : '';
      lead = started ? (until ? `${prob} until ${until}` : prob) : until ? `${prob} ${hourZ(from, now)}–${until}` : `${prob} from ${hourZ(from, now)}`;
    } else {
      lead = started ? `By ${hourZ(num(f.timeBec), now)}` : `From ${hourZ(from, now)}`;
    }
    // Kategorin hör bara till raden när raden handlar om tak eller sikt (inte en ren vindändring).
    return { text: `${lead}: ${body}`, category: /cloud|visibility|sky|overcast/.test(body) ? categoryOf(f.clouds, f.visib) : null };
  }
  return { text: validTo > 0 ? `No change expected before ${hourZ(validTo, now)}` : 'No change expected', category: null };
}

// ── Batch-hämtning (kommaseparerade ids → en request per typ) ─────────────────
async function batchFetch(url: string, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const kind = url.split('/').pop(); // "metar" | "taf"
  const full = `${url}?ids=${ids.join(',')}&format=json`;
  try {
    const res = await fetch(full, { headers: { Accept: 'application/json', 'User-Agent': 'BladesPilotLogbook/1.0' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[weather] ${kind} HTTP ${res.status}:`, body.slice(0, 200));
      return map;
    }
    const arr = await res.json();
    if (!Array.isArray(arr)) return map;
    for (const it of arr) {
      const id = String(it?.icaoId ?? it?.icao ?? '').trim().toUpperCase();
      if (id && !map.has(id)) map.set(id, it);
    }
  } catch (e: any) {
    console.warn(`[weather] ${kind} fetch failed →`, e?.message ?? String(e));
  }
  return map;
}

// ── Publikt: tolkad METAR + TAF för destinationen (med närmaste-fält-fallback) ─
// Kärna: gör METAR/TAF-uppslag för en ordnad kandidatlista (närmast/viktigast först). `primary` är
// referensfältet (destination för pilot, närmaste för drönare) → styr "alternate"-flaggan.
async function decodeFromCandidates(candidates: string[], names: Map<string, string>, primary: string): Promise<DecodedWx | null> {
  // aviationweather.gov kräver giltiga 4-bokstavs-ICAO. Filtrera bort custom/GPS-koder (t.ex. "SE-0065")
  // — annars svarar API:t 400 på HELA batchen ("Must specify station IDs …") och inget väder visas.
  const ids = candidates.filter((c) => /^[A-Z]{4}$/.test(c)).slice(0, 20);
  if (!ids.length) return null;

  // Sekventiellt (inte parallellt) för att undvika ev. avvisade samtidiga anrop.
  const metars = await batchFetch(METAR_URL, ids);
  const tafs = await batchFetch(TAF_URL, ids);

  // Oberoende val: närmaste station (primary först) med METAR resp. med TAF. De kan vara olika fält.
  const metarStation = ids.find((ic) => metars.has(ic)) ?? null;
  const tafStation = ids.find((ic) => tafs.has(ic)) ?? null;
  console.log(`[weather] metar=${metarStation ?? '—'} taf=${tafStation ?? '—'} (m:${metars.size} t:${tafs.size})`);
  if (!metarStation && !tafStation) return null;

  // METAR
  let metarText = '', metarTimeZ = '', metarStatus: WxStatus | null = null, category: FlightCat | null = null;
  let rawMetar: string | undefined, metarStationName: string | undefined;
  let metarObsMs: number | null = null, cells: WxCells | null = null;
  if (metarStation) {
    const m = metars.get(metarStation);
    const obsMs = typeof m.obsTime === 'number' ? m.obsTime * 1000 : m.reportTime ? Date.parse(m.reportTime) : NaN;
    metarTimeZ = Number.isFinite(obsMs) ? zulu(obsMs / 1000) : '';
    metarText = metarProse(m);
    metarStatus = metarStatusOf(obsMs);
    metarObsMs = Number.isFinite(obsMs) ? obsMs : null;
    cells = metarCells(m);
    category = m.fltCat === 'VFR' || m.fltCat === 'MVFR' || m.fltCat === 'IFR' || m.fltCat === 'LIFR'
      ? m.fltCat : categoryOf(m.clouds, m.visib);
    rawMetar = m.rawOb;
    metarStationName = names.get(metarStation);
  }

  // TAF
  let tafText: string | null = null, tafStatus: WxStatus | null = null;
  let rawTaf: string | undefined, tafStationName: string | undefined;
  let tafNext: TafNext | null = null;
  if (tafStation) {
    const t = tafs.get(tafStation);
    tafText = tafProse(t) || null;
    tafNext = tafNextChange(t);
    tafStatus = tafStatusOf(t.validTimeFrom, t.validTimeTo);
    rawTaf = t.rawTAF;
    tafStationName = names.get(tafStation);
  }

  return {
    destIcao: primary,
    metarStation, metarStationName, metarIsAlternate: !!metarStation && metarStation !== primary,
    metarText, metarTimeZ, metarStatus, category,
    tafStation, tafStationName, tafIsAlternate: !!tafStation && tafStation !== primary,
    tafText, tafStatus,
    rawMetar, rawTaf,
    metarObsMs, cells, tafNext,
    metarObj: metarStation ? metars.get(metarStation) : undefined,
    tafObj: tafStation ? tafs.get(tafStation) : undefined,
  };
}

// Pilot: väder för destinationen, med närmaste-fält-fallback när dest saknar METAR/TAF.
export async function fetchDecodedWx(destIcao: string): Promise<DecodedWx | null> {
  const dest = destIcao.trim().toUpperCase();
  if (!dest) return null;
  const candidates: string[] = [dest];
  const names = new Map<string, string>();
  try {
    const ap = await getAirportByIcao(dest);
    if (ap?.name) names.set(dest, ap.name);
    if (ap && (ap.lat || ap.lon)) {
      const near = await getNearbyAirports(ap.lat, ap.lon, 20);
      for (const n of near) {
        const ic = n.icao?.toUpperCase();
        if (ic && !candidates.includes(ic)) { candidates.push(ic); if (n.name) names.set(ic, n.name); }
      }
    }
  } catch { /* fortsätt med enbart destinationen */ }
  return decodeFromCandidates(candidates, names, dest);
}

// Drönare: väder för NÄRMASTE tillgängliga station från en position (de flyger inte mellan flygplatser).
export async function fetchDecodedWxNear(lat: number, lon: number): Promise<DecodedWx | null> {
  const candidates: string[] = [];
  const names = new Map<string, string>();
  try {
    const near = await getNearbyAirports(lat, lon, 25); // sorterade på avstånd (närmast först)
    for (const n of near) {
      const ic = n.icao?.toUpperCase();
      if (ic && /^[A-Z]{4}$/.test(ic) && !candidates.includes(ic)) { candidates.push(ic); if (n.name) names.set(ic, n.name); }
    }
  } catch { /* ingen position/närhet → inget väder */ }
  if (!candidates.length) return null;
  return decodeFromCandidates(candidates, names, candidates[0]);
}

// ── En enskild flygplats EGNA METAR (ingen närmaste-fält-fallback) ────────────
// Används av moln-knappen på infokortet: molnet visas bara om flygplatsen SJÄLV har METAR.
export type AirportMetar = {
  icao: string;
  text: string;    // tolkad prosa (fullständig)
  brief: string;   // kort tolkad: bara vind · sikt · moln · QNH
  raw: string;     // rå METAR
  timeZ: string;   // "1550Z"
  status: WxStatus;
  category: FlightCat | null;
  windDir: number | null; // vindriktning (grader, varifrån). null = variabel/saknas → ingen aktiv bana
  windSpeed: number | null; // vindstyrka (kt)
};

export async function fetchAirportMetar(icao: string): Promise<AirportMetar | null> {
  const id = (icao || '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(id)) return null; // METAR keyas på 4-bokstavs-ICAO
  const metars = await batchFetch(METAR_URL, [id]);
  const m = metars.get(id);
  if (!m) return null; // ingen EGEN METAR → ingen molnsymbol
  const obsMs = typeof m.obsTime === 'number' ? m.obsTime * 1000 : m.reportTime ? Date.parse(m.reportTime) : NaN;
  const category: FlightCat | null =
    m.fltCat === 'VFR' || m.fltCat === 'MVFR' || m.fltCat === 'IFR' || m.fltCat === 'LIFR' ? m.fltCat : categoryOf(m.clouds, m.visib);
  return {
    icao: id,
    text: metarProse(m) || 'No data',
    brief: metarBrief(m) || 'No data',
    raw: typeof m.rawOb === 'string' ? m.rawOb : '',
    timeZ: Number.isFinite(obsMs) ? zulu(obsMs / 1000) : '',
    status: metarStatusOf(obsMs),
    category,
    // wdir kan komma som tal ELLER sträng ("300"); 'VRB'/saknas → null (ingen aktiv bana).
    windDir: Number.isFinite(num(m.wdir)) ? num(m.wdir) : null,
    windSpeed: Number.isFinite(num(m.wspd)) ? num(m.wspd) : null,
  };
}

// ── Bulk-METAR för ett geografiskt område (Global map väderfilter) ────────────
// Ett enda anrop till bbox-endpointen returnerar ALLA rapporterande stationer i lådan med färdig
// fltCat → mycket effektivare än ett fält i taget. bbox = minLat,minLon,maxLat,maxLon.
export type BboxStation = { icao: string; lat: number; lon: number; category: FlightCat | null; obsMs: number };

export async function fetchMetarsInBbox(
  minLat: number, minLon: number, maxLat: number, maxLon: number,
): Promise<BboxStation[]> {
  const bbox = `${minLat.toFixed(2)},${minLon.toFixed(2)},${maxLat.toFixed(2)},${maxLon.toFixed(2)}`;
  const url = `${METAR_URL}?bbox=${bbox}&format=json`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'BladesPilotLogbook/1.0' } });
    if (!res.ok) { console.warn(`[weather] bbox HTTP ${res.status}`); return []; }
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    const out: BboxStation[] = [];
    for (const m of arr) {
      const icao = String(m?.icaoId ?? m?.icao ?? '').trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(icao)) continue;
      const category: FlightCat | null =
        m.fltCat === 'VFR' || m.fltCat === 'MVFR' || m.fltCat === 'IFR' || m.fltCat === 'LIFR' ? m.fltCat : categoryOf(m.clouds, m.visib);
      const obsMs = typeof m.obsTime === 'number' ? m.obsTime * 1000 : m.reportTime ? Date.parse(m.reportTime) : NaN;
      out.push({ icao, lat: num(m.lat), lon: num(m.lon), category, obsMs: Number.isFinite(obsMs) ? obsMs : 0 });
    }
    return out;
  } catch (e: any) {
    console.warn('[weather] bbox fetch failed →', e?.message ?? String(e));
    return [];
  }
}

// Färg för flygväderkategori (kart-prickar/legend/accent). Mjukare, moderna nyanser (samma bas
// grön/blå/röd/lila) som harmonierar med den mörka kartan istället för de tidigare neon-tonerna.
export function categoryColor(c: FlightCat): string {
  switch (c) {
    case 'VFR': return '#34D399';  // emerald – fräsch grön
    case 'MVFR': return '#60A5FA'; // mjuk klar blå (skiljd från cyan-accenten)
    case 'IFR': return '#F87171';  // dämpad korallröd
    case 'LIFR': return '#C084FC'; // elegant violett
  }
}
