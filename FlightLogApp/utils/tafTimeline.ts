// TAF som tidslinje och ändringsrader för väderkortet på kartan (components/MapWxPanel.tsx).
// Indata = aviationweather.gov:s TAF-objekt (services/weather.ts tafObj). Rent och testbart (scripts/test-taf-timeline.cjs).
// - tafBar: prognosens giltighetstid uppdelad efter grundperiodernas flygkategori (FM/BECMG; TEMPO/PROB ritas inte).
//   En period som inte anger moln eller sikt ärver dem från perioden före.
// - tafChanges: kommande eller pågående ändringar (FM, BECMG, TEMPO, PROB) som rader med tid, typ, text och kategori.
import { categoryOf, tafPeriodBrief, num, pad2, type FlightCat } from '../services/weather';

export type BarSeg = { from: number; to: number; cat: FlightCat | null };   // sekunder (UTC)
export type TafRow = { time: string; kind: string; text: string; cat: FlightCat | null };

const isTemp = (f: any) => f?.fcstChange === 'TEMPO' || f?.fcstChange === 'PROB';
const hz = (sec: number) => `${pad2(new Date(sec * 1000).getUTCHours())}z`;
/** Tidsformat för en timme: UTC som standard ("21z"); kortet skickar in lokal tid ("22") när GMT±N är valt. */
export type HourFmt = (sec: number) => string;

export function tafBar(t: any): BarSeg[] {
  const from = num(t?.validTimeFrom), to = num(t?.validTimeTo);
  if (!(from > 0 && to > from)) return [];
  const base = (Array.isArray(t?.fcsts) ? t.fcsts : []).filter((f: any) => num(f?.timeFrom) > 0 && !isTemp(f))
    .sort((a: any, b: any) => num(a.timeFrom) - num(b.timeFrom));
  const segs: BarSeg[] = [];
  let clouds: any = undefined, visib: any = undefined;
  base.forEach((f: any, i: number) => {
    if (f.clouds != null) clouds = f.clouds;
    if (f.visib != null) visib = f.visib;
    const s = Math.max(from, num(f.timeFrom));
    const e = Math.min(to, i + 1 < base.length ? num(base[i + 1].timeFrom) : to);
    if (e <= s) return;
    const cat = categoryOf(clouds, visib);
    const last = segs[segs.length - 1];
    if (last && last.cat === cat && last.to === s) last.to = e;
    else segs.push({ from: s, to: e, cat });
  });
  return segs;
}

/** Tidsetiketter jämnt över giltighetstiden, bara på hela timmar så att etiketten stämmer med sin plats:
 *  24 h → 00z 06z 12z 18z 24z; 2 h → 15z 16z 17z; 5 h → bara början och slut. */
export function tafTicks(t: any, fmt: HourFmt = hz): string[] {
  const from = num(t?.validTimeFrom), to = num(t?.validTimeTo);
  if (!(from > 0 && to > from)) return [];
  const label = (s: number, last: boolean) => { const x = fmt(s); return last && (x === '00z' || x === '00') ? x.replace('00', '24') : x; };
  for (const n of [4, 3, 2, 1]) {
    const pts = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
    if (pts.every((p) => Math.round(p) % 3600 === 0)) return pts.map((p, i) => label(p, i === n));
  }
  return [label(from, false), label(to, true)];
}

export function tafChanges(t: any, nowMs: number = Date.now(), max = 3, fmt: HourFmt = hz): TafRow[] {
  const now = nowMs / 1000;
  const all: any[] = (Array.isArray(t?.fcsts) ? t.fcsts : []).filter((f: any) => num(f?.timeFrom) > 0);
  const rows: { at: number; row: TafRow }[] = [];
  for (const f of all) {
    const ch = f.fcstChange;
    if (!ch) continue;                                     // grundperioden (FM saknas i JSON för första perioden)
    const from = num(f.timeFrom), to = num(f.timeTo);
    const temp = isTemp(f);
    if (temp ? to <= now : (ch === 'BECMG' ? Math.max(from, num(f.timeBec)) : from) <= now) continue;   // passerad
    // Perioden före: den sista grundperioden i TAF:ens ordning som börjar före (vid lika starttid vinner den senare)
    const prev = temp ? undefined : all.filter((p) => p !== f && !isTemp(p) && num(p.timeFrom) <= from && all.indexOf(p) < all.indexOf(f)).pop();
    const body = tafPeriodBrief(f, prev);
    if (!body) continue;
    const prob = num(f.probability) > 0 ? `PROB${num(f.probability)}` : '';
    // Typen utskriven (FM → FROM, BECMG → BECOMING, TEMPO → TEMPORARY, PROB40 → 40% CHANCE), som på vädersidan
    const pct = num(f.probability) > 0 ? `${num(f.probability)}% CHANCE` : 'CHANCE';
    const kind = ch === 'PROB' || prob ? pct : ch === 'TEMPO' ? 'TEMPORARY' : ch === 'BECMG' ? 'BECOMING' : ch === 'FM' ? 'FROM' : ch;
    const bec = num(f.timeBec);
    const time = temp ? `${from <= now ? 'Now' : fmt(from)}–${fmt(to)}`
      : ch === 'BECMG' && bec > from ? (from <= now ? `By ${fmt(bec)}` : `${fmt(from)}–${fmt(bec)}`)
      : `${fmt(from)} →`;
    const cat = /cloud|visibility|sky|overcast/.test(body) ? categoryOf(f.clouds, f.visib) : null;
    rows.push({ at: from, row: { time, kind, text: body[0].toUpperCase() + body.slice(1), cat } });
  }
  return rows.sort((a, b) => a.at - b.at).slice(0, max).map((r) => r.row);
}

export function tafExpired(t: any, nowMs: number = Date.now()): boolean {
  const to = num(t?.validTimeTo);
  return to > 0 && nowMs / 1000 > to;
}
