// Vädersidan (AirportPickerModal → WeatherPage): bygger allt sidan visar ur METAR- och TAF-objekten från
// aviationweather.gov. Överblick (en mening + Now och de två närmaste förändringarna), METAR-rutorna, en
// tidslinje per flygkategori (grundprognosen på en rad, TEMPO/PROB på egna rader), vind var tredje timme,
// en rad per TAF-grupp och rå TAF uppdelad per grupp. Tider i UTC ("20z") eller telefonens lokala tid ("21:00").
// Ren logik utan React; testas av scripts/test-wx-page.cjs.
import {
  num, pad2, parseVis, windProse, wxProse, categoryOf, tafPeriodProse, visCell, ceilingOf, isCavok, grouped,
  type FlightCat, type WxCell,
} from './weather';

export type WxTz = 'utc' | 'local';
export type WxSeg = {
  id: string; from: number; to: number; cat: FlightCat | null;
  kind: 'base' | 'becmg' | 'temp'; label: string; when: string; text: string;
};
export type WxGlance = { id: string; when: string; cat: FlightCat | null; label: string; note: string };
export type WxNowTile = { label: string; value: string; unit: string; note: string };
export type WxNow = {
  windDir: number | null; windSpd: number; gust: number; variable: boolean;
  windValue: string; windNote: string;
  tiles: WxNowTile[]; // VIS, CLOUD, TEMP/DEW, QNH
};
export type WxTimeline = {
  start: number; end: number;
  base: WxSeg[]; temp: WxSeg[][];
  winds: { t: number; dir: number | null; spd: number; gust: number }[];
  ticks: { t: number; label: string }[];
};
export type WxCard = { id: string; when: string; kind: string; cat: FlightCat | null; text: string };
export type WxRawGroup = { text: string; cat: FlightCat | null; marker: boolean };
export type WxPage = {
  summary: string;
  glance: WxGlance[];
  nowCat: FlightCat | null;
  now: WxNow | null;
  timeline: WxTimeline | null;
  cards: WxCard[];
  tafIssued: string;
  rawTaf: WxRawGroup[];
};

const H = 3600;
const isTemp = (f: any) => f?.fcstChange === 'TEMPO' || f?.fcstChange === 'PROB';
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Klockslag i vald tidszon. UTC: "20z" / "20:30z". Lokal: "21:00". Annan dag än nu: " tomorrow" / " (dd)".
export function fmtTime(sec: number, tz: WxTz, nowSec: number): string {
  const d = new Date(sec * 1000), n = new Date(nowSec * 1000);
  const utc = tz === 'utc';
  const hh = utc ? d.getUTCHours() : d.getHours(), mm = utc ? d.getUTCMinutes() : d.getMinutes();
  const t = utc ? (mm ? `${pad2(hh)}:${pad2(mm)}z` : `${pad2(hh)}z`) : `${pad2(hh)}:${pad2(mm)}`;
  const day = (x: Date) => utc ? Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) : new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 86400000);
  return diff === 0 ? t : diff === 1 ? `${t} tomorrow` : `${t} (${pad2(utc ? d.getUTCDate() : d.getDate())})`;
}
// Tidsspann med dagordet en gång: "00z–15z tomorrow" i stället för "00z tomorrow–15z tomorrow".
export function fmtRange(from: number, to: number, tz: WxTz, nowSec: number, sep = '–'): string {
  const a = fmtTime(from, tz, nowSec), b = fmtTime(to, tz, nowSec);
  const sa = a.split(' '), sb = b.split(' ');
  if (sa.length > 1 && sb.length > 1 && sa.slice(1).join(' ') === sb.slice(1).join(' ')) return `${sa[0]}${sep}${b}`;
  return `${a}${sep}${b}`;
}
const hourLabel = (sec: number, tz: WxTz) => { const d = new Date(sec * 1000); return pad2(tz === 'utc' ? d.getUTCHours() : d.getHours()); };

// Grundprognosen: FM ersätter allt, BECMG ändrar bara det den anger. Varje grundperiod får sitt sammanslagna läge.
type State = { wdir: any; wspd: any; wgst: any; visib: any; wxString: any; clouds: any[] };
function merge(prev: State | null, f: any, full: boolean): State {
  const base: State = full || !prev ? { wdir: null, wspd: null, wgst: null, visib: null, wxString: null, clouds: [] } : { ...prev };
  if (f.wspd != null) { base.wdir = f.wdir; base.wspd = f.wspd; base.wgst = f.wgst ?? null; }
  if (f.visib != null) base.visib = f.visib;
  if (f.wxString != null || full) base.wxString = f.wxString ?? null;
  if (Array.isArray(f.clouds) && f.clouds.length) base.clouds = f.clouds;
  return base;
}
const catOf = (s: { clouds: any; visib: any }) => categoryOf(s.clouds, s.visib);

function stateProse(s: State): string {
  const vis = parseVis(s.visib);
  const km = vis != null ? vis * 1.609344 : null;
  const parts = [
    s.wspd != null ? windProse(s.wdir, s.wspd, s.wgst) : '',
    km == null ? '' : (typeof s.visib === 'string' && s.visib.includes('+')) || km >= 10 ? 'visibility 10 km or more' : `visibility ${visCell(s.visib).value} ${visCell(s.visib).unit}`,
    wxProse(s.wxString),
    cloudShort(s.clouds),
  ].filter(Boolean);
  return cap(parts.join(', ')) + (parts.length ? '.' : '');
}
function cloudShort(clouds: any[]): string {
  if (!Array.isArray(clouds) || !clouds.length) return '';
  const cov = clouds[0]?.cover;
  if (cov === 'CAVOK') return 'no cloud below 5000 ft';
  if (cov === 'NSC' || cov === 'SKC' || cov === 'CLR' || cov === 'NCD') return 'no significant cloud';
  const word: Record<string, string> = { FEW: 'a few clouds', SCT: 'scattered cloud', BKN: 'broken cloud', OVC: 'overcast' };
  const ceil = ceilingOf(clouds);
  const layer = ceil ?? clouds.filter((c) => typeof c?.base === 'number').sort((a, b) => a.base - b.base)[0];
  if (!layer || !word[layer.cover]) return cov === 'OVX' ? 'sky obscured' : '';
  const cb = clouds.some((c) => c?.type === 'CB') ? ' with cumulonimbus' : clouds.some((c) => c?.type === 'TCU') ? ' with towering cumulus' : '';
  return `${word[layer.cover]} at ${grouped(layer.base)} ft${cb}`;
}
// Kort anteckning till översiktsrutorna: väder först, annars byar, annars molnbas.
function shortNote(s: { wxString?: any; wgst?: any; wspd?: any; clouds?: any[] }): string {
  const wx = wxProse(s.wxString).split(',')[0];
  const g = num(s.wgst);
  const bits: string[] = [];
  if (wx) bits.push(cap(wx.replace(/^light /, 'light ')));
  if (Number.isFinite(g) && g > 0) bits.push(`gusts ${g}`);
  if (bits.length < 2) {
    const ceil = ceilingOf(s.clouds);
    if (ceil) bits.push(`cloud ${grouped(ceil.base)} ft`);
  }
  if (!bits.length) { const w = num(s.wspd); bits.push(Number.isFinite(w) ? (w > 0 ? `${w} kt, clear` : 'Calm, clear') : 'No change'); }
  return cap(bits.slice(0, 2).join(', '));
}

const CAT_PHRASE: Record<FlightCat, string> = { VFR: 'Good VFR now.', MVFR: 'Marginal VFR now.', IFR: 'IFR now.', LIFR: 'Low IFR now.' };
const RANK: Record<FlightCat, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

export function buildWxPage(m: any, t: any, tz: WxTz, nowMs: number = Date.now()): WxPage {
  const now = nowMs / 1000;
  // ── METAR ──
  let nowCat: FlightCat | null = null, nowState: any = null, wxNow: WxNow | null = null;
  if (m) {
    nowCat = m.fltCat === 'VFR' || m.fltCat === 'MVFR' || m.fltCat === 'IFR' || m.fltCat === 'LIFR' ? m.fltCat : categoryOf(m.clouds, m.visib);
    nowState = m;
    const spd = num(m.wspd), g = num(m.wgst), dir = num(m.wdir);
    const variable = m.wdir === 'VRB' || !Number.isFinite(dir);
    const cavok = isCavok(m);
    const vis = cavok ? { value: '10+', unit: 'km' } as WxCell : visCell(m.visib);
    const wx = wxProse(m.wxString);
    const ceil = ceilingOf(m.clouds);
    const clouds: any[] = Array.isArray(m.clouds) ? m.clouds : [];
    const low = clouds.filter((c) => typeof c?.base === 'number').sort((a, b) => a.base - b.base)[0];
    const coverWord: Record<string, string> = { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast' };
    const cloudTile: WxNowTile = cavok ? { label: 'CLOUD', value: 'None', unit: '', note: 'below 5000 ft' }
      : ceil ? { label: 'CLOUD', value: grouped(ceil.base), unit: ' ft', note: coverWord[ceil.cover] }
      : low && coverWord[low.cover] ? { label: 'CLOUD', value: grouped(low.base), unit: ' ft', note: coverWord[low.cover] }
      : clouds[0]?.cover === 'OVX' ? { label: 'CLOUD', value: 'Obscured', unit: '', note: 'vertical vis.' }
      : { label: 'CLOUD', value: 'None', unit: '', note: clouds[0]?.cover === 'NSC' ? 'no significant' : 'sky clear' };
    const temp = num(m.temp), dew = num(m.dewp);
    const spread = Number.isFinite(temp) && Number.isFinite(dew) ? temp - dew : NaN;
    const tempTile: WxNowTile = Number.isFinite(temp)
      ? { label: 'TEMP/DEW', value: `${Math.round(temp)}°/${Number.isFinite(dew) ? Math.round(dew) + '°' : '—'}`, unit: '',
          note: !Number.isFinite(spread) ? '' : spread <= 1 ? 'fog likely' : spread <= 3 ? 'fog risk' : 'low fog risk' }
      : { label: 'TEMP/DEW', value: '—', unit: '', note: '' };
    const a = num(m.altim);
    const qnhTile: WxNowTile = !a ? { label: 'QNH', value: '—', unit: '', note: '' }
      : a > 100 ? { label: 'QNH', value: String(Math.round(a)), unit: '', note: `${(a * 0.02953).toFixed(2)} inHg` }
      : { label: 'QNH', value: String(Math.round(a * 33.8639)), unit: '', note: `${a.toFixed(2)} inHg` };
    wxNow = {
      windDir: variable ? null : dir, windSpd: Number.isFinite(spd) ? spd : 0, gust: Number.isFinite(g) ? g : 0, variable,
      windValue: !Number.isFinite(spd) ? '—' : spd <= 0 ? 'Calm' : `${variable ? 'VRB' : String(Math.round(dir)).padStart(3, '0') + '°'}/${spd}`,
      windNote: !Number.isFinite(spd) ? '' : spd <= 0 ? 'Any runway' : Number.isFinite(g) && g > 0 ? `Gusting ${g} kt` : variable ? 'Variable direction' : 'Steady, no gusts',
      tiles: [
        { label: 'VIS', value: vis.value, unit: vis.unit ? ` ${vis.unit}` : '', note: cavok ? 'CAVOK' : wx ? wx.split(',')[0] : 'dry' },
        cloudTile, tempTile, qnhTile,
      ],
    };
  }

  // ── TAF ──
  const fcsts: any[] = (Array.isArray(t?.fcsts) ? t.fcsts : []).filter((f: any) => num(f?.timeFrom) > 0)
    .sort((a: any, b: any) => num(a.timeFrom) - num(b.timeFrom));
  const validTo = num(t?.validTimeTo);
  const start = Math.floor(now / H) * H;
  const end = Number.isFinite(validTo) ? Math.min(validTo, start + 30 * H) : start;
  const baseList: { f: any; s: State; cat: FlightCat | null; id: string }[] = [];
  let prev: State | null = null;
  fcsts.forEach((f, i) => {
    if (isTemp(f)) return;
    const full = !prev || f.fcstChange !== 'BECMG';
    prev = merge(prev, f, full);
    baseList.push({ f, s: prev, cat: catOf(prev), id: `f${i}` });
  });
  const baseAt = (sec: number) => {
    let cur = baseList[0];
    for (const b of baseList) if (num(b.f.timeFrom) <= sec) cur = b;
    return cur;
  };
  const issued = typeof t?.issueTime === 'string' ? Date.parse(t.issueTime) / 1000 : num(t?.issueTime);
  const tafIssued = Number.isFinite(issued) && issued > 0 ? fmtTime(issued, tz, now).toUpperCase() : '';

  let timeline: WxTimeline | null = null;
  const cards: WxCard[] = [];
  const allSegs: WxSeg[] = [];
  if (baseList.length && end > start) {
    const base: WxSeg[] = [];
    baseList.forEach((b, i) => {
      const from = Math.max(num(b.f.timeFrom), start);
      const next = baseList[i + 1];
      const to = Math.min(next ? num(next.f.timeFrom) : end, end);
      if (to <= from) return;
      const bec = b.f.fcstChange === 'BECMG' ? Math.min(num(b.f.timeBec) || from, to) : from;
      if (bec > from) {
        base.push({ id: b.id, from, to: bec, cat: b.cat, kind: 'becmg', label: '›',
          when: `${fmtRange(from, bec, tz, now, ' – ')} · becoming`.toUpperCase(),
          text: `Changing gradually to: ${stateProse(b.s).replace(/^./, (c) => c.toLowerCase())}` });
      }
      if (to > bec) base.push({ id: b.id, from: bec, to, cat: b.cat, kind: 'base', label: b.cat ?? '',
        when: (bec <= now ? `Now – ${fmtTime(to, tz, now)}` : fmtRange(bec, to, tz, now, ' – ')).toUpperCase(), text: stateProse(b.s) });
    });
    // Tillfälliga perioder: grundläget när de börjar + det de själva anger. Läggs på första lediga raden (högst två).
    const rows: WxSeg[][] = [[], []];
    fcsts.forEach((f, i) => {
      if (!isTemp(f)) return;
      const from = Math.max(num(f.timeFrom), start), to = Math.min(num(f.timeTo), end);
      if (to <= from) return;
      const b = baseAt(num(f.timeFrom));
      const over = merge(b?.s ?? null, f, false);
      const cat = catOf(over);
      const p = num(f.probability);
      const kind = p > 0 ? `${p}% chance` : 'temporarily';
      const seg: WxSeg = { id: `f${i}`, from, to, cat, kind: 'temp', label: `${p > 0 ? p + '%' : 'TEMPO'} ${cat ?? ''}`.trim(),
        when: `${fmtRange(from, to, tz, now, ' – ')} · ${kind}`.toUpperCase(),
        text: `${p > 0 ? 'Possibly' : 'At times'} ${stateProse({ wdir: f.wdir, wspd: f.wspd, wgst: f.wgst, visib: f.visib, wxString: f.wxString, clouds: Array.isArray(f.clouds) ? f.clouds : [] }).replace(/^./, (c) => c.toLowerCase())}` };
      const row = rows.find((r) => r.every((x) => x.to <= from || x.from >= to));
      if (row) row.push(seg);
    });
    const winds: WxTimeline['winds'] = [];
    for (let s = start; s <= end + 1; s += 3 * H) {
      if (s === start && m && Number.isFinite(num(m.wspd))) { winds.push({ t: s, dir: num(m.wdir), spd: num(m.wspd), gust: num(m.wgst) || 0 }); continue; }
      const b = baseAt(s);
      if (!b || b.s.wspd == null) continue;
      winds.push({ t: s, dir: Number.isFinite(num(b.s.wdir)) ? num(b.s.wdir) : null, spd: num(b.s.wspd), gust: num(b.s.wgst) || 0 });
    }
    const ticks: WxTimeline['ticks'] = [];
    for (let s = start; s <= end + 1; s += 3 * H) ticks.push({ t: s, label: s === start ? 'NOW' : hourLabel(s, tz) + (tz === 'utc' && s + 3 * H > end ? 'Z' : '') });
    timeline = { start, end, base, temp: rows.filter((r) => r.length), winds, ticks };
    allSegs.push(...base, ...rows.flat());

    // Kort: en per TAF-grupp som inte redan är slut.
    fcsts.forEach((f, i) => {
      const toS = isTemp(f) ? num(f.timeTo) : (() => { const bi = baseList.findIndex((b) => b.id === `f${i}`); const nx = baseList[bi + 1]; return nx ? num(nx.f.timeFrom) : validTo; })();
      if (toS <= now) return;
      const seg = allSegs.find((x) => x.id === `f${i}` && x.kind !== 'becmg') ?? allSegs.find((x) => x.id === `f${i}`);
      const p = num(f.probability);
      const kind = isTemp(f) ? (p > 0 ? `${p}% CHANCE` : 'TEMPORARY') : f.fcstChange === 'BECMG' ? 'BECOMING' : 'FROM';
      const from = num(f.timeFrom);
      const when = from <= now ? `Now – ${fmtTime(toS, tz, now)}` : fmtRange(from, toS, tz, now, ' – ');
      const own = tafPeriodProse(f);
      cards.push({ id: `f${i}`, when, kind, cat: seg?.cat ?? null, text: cap(own) + (own ? '.' : '') || 'No change in the conditions.' });
    });
  }

  // ── Överblick ──
  const nowBase = baseList.length ? baseAt(now) : null;
  if (!nowCat && nowBase) nowCat = nowBase.cat;
  const upcoming = allSegs.filter((x) => x.from > now + 60 && x.kind !== 'becmg')
    .filter((x) => (x.cat && nowCat && x.cat !== nowCat) || x.kind === 'temp')
    .sort((a, b) => a.from - b.from);
  // Samma kategori två gånger i rad (t.ex. MVFR, sedan MVFR med regn) blir en.
  const picked: WxSeg[] = [];
  for (const x of upcoming) { if (picked.length >= 2) break; if (!picked.some((p) => p.cat === x.cat && p.kind === x.kind)) picked.push(x); }
  const glance: WxGlance[] = [];
  if (nowCat || wxNow) glance.push({ id: nowBase?.id ?? 'now', when: 'NOW', cat: nowCat, label: nowCat ?? '—', note: nowState ? shortNote(nowState) : '' });
  for (const x of picked) {
    const f = fcsts[Number(x.id.slice(1))];
    const over = x.kind === 'temp' ? f : baseList.find((b) => b.id === x.id)!.s;
    const startAt = x.kind === 'base' ? (allSegs.find((y) => y.id === x.id && y.kind === 'becmg')?.from ?? x.from) : x.from;
    glance.push({
      id: x.id, cat: x.cat,
      when: (x.kind === 'temp' ? fmtRange(x.from, x.to, tz, now) : `from ${fmtTime(startAt, tz, now)}`).replace(' tomorrow', '').toUpperCase(),
      label: x.kind === 'temp' ? x.label : x.cat ?? '—',
      note: shortNote(over),
    });
  }

  const sentences: string[] = [];
  if (nowCat) sentences.push(CAT_PHRASE[nowCat]);
  const nextBase = picked.find((x) => x.kind === 'base');
  if (nextBase) {
    const st = baseList.find((b) => b.id === nextBase.id)!.s;
    const wx = wxProse(st.wxString).split(',')[0];
    const worse = nowCat && nextBase.cat ? RANK[nextBase.cat] > RANK[nowCat] : false;
    const startAt = allSegs.find((y) => y.id === nextBase.id && y.kind === 'becmg')?.from ?? nextBase.from;
    sentences.push(`${worse ? 'Worsening to' : 'Improving to'} ${nextBase.cat} from ${fmtTime(startAt, tz, now)}${wx ? ` with ${wx}` : ''}.`);
  }
  const tempWorst = picked.filter((x) => x.kind === 'temp').sort((a, b) => (b.cat ? RANK[b.cat] : 0) - (a.cat ? RANK[a.cat] : 0))[0];
  if (tempWorst) {
    const f = fcsts[Number(tempWorst.id.slice(1))];
    const p = num(f.probability);
    sentences.push(`${p > 0 ? `${p}% chance of` : 'At times'} ${tempWorst.cat ?? 'changes'} ${fmtRange(tempWorst.from, tempWorst.to, tz, now)}.`);
  }
  if (sentences.length === 1 && timeline) sentences.push(`No big change expected before ${fmtTime(end, tz, now)}.`);
  if (!sentences.length) sentences.push(m ? 'Latest observation below.' : 'No current observation for this station.');

  // ── Rå TAF per grupp (färg = gruppens kategori) ──
  const rawTaf: WxRawGroup[] = [];
  const raw = typeof t?.rawTAF === 'string' ? t.rawTAF.trim() : '';
  if (raw) {
    const parts = raw.split(/\s+(?=(?:BECMG|TEMPO|FM\d{6}|PROB\d{2})\b)/);
    let fi = 0;
    parts.forEach((txt: string, i: number) => {
      // PROB40 TEMPO … är en grupp i JSON men kan ha delats i två här.
      if (/^TEMPO\b/.test(txt) && /^PROB\d{2}$/.test(parts[i - 1] ?? '')) return;
      const text = /^PROB\d{2}$/.test(txt) && /^TEMPO\b/.test(parts[i + 1] ?? '') ? `${txt} ${parts[i + 1]}` : txt;
      const f = fcsts[fi];
      const seg = allSegs.find((x) => x.id === `f${fi}` && x.kind !== 'becmg') ?? allSegs.find((x) => x.id === `f${fi}`);
      const cat = seg?.cat ?? (f ? (isTemp(f) ? catOf(merge(baseAt(num(f.timeFrom))?.s ?? null, f, false)) : baseList.find((b) => b.id === `f${fi}`)?.cat ?? null) : null);
      rawTaf.push({ text, cat, marker: i > 0 });
      fi++;
    });
  }

  return { summary: sentences.join(' '), glance, nowCat, now: wxNow, timeline, cards, tafIssued, rawTaf };
}

// Mot- och sidvind per bana: bästa änden per bana (mest motvind), parallella banor slås ihop ("19L/R").
// favored = index i `runways` för banorna vinden gynnar (lyses upp i kartan).
export type RwyWind = { ident: string; head: number; cross: number; favored: boolean };
export function runwayWinds(runways: { leIdent: string; heIdent: string; bearing: number }[], dir: number | null, spd: number): { list: RwyWind[]; favored: number[] } {
  if (dir == null || !(spd > 0) || !runways.length) return { list: [], favored: [] };
  const rows = runways.map((r, i) => {
    const useLe = Math.cos(((dir - r.bearing) * Math.PI) / 180) >= 0;
    const brg = useLe ? r.bearing : (r.bearing + 180) % 360;
    const ang = ((dir - brg) * Math.PI) / 180;
    return { i, ident: (useLe ? r.leIdent : r.heIdent) || '', head: Math.round(Math.cos(ang) * spd), cross: Math.round(Math.abs(Math.sin(ang)) * spd) };
  });
  const groups: { num: string; sfx: string[]; head: number; cross: number; idx: number[] }[] = [];
  for (const r of rows) {
    const m = /^(\d+)([LRC]?)$/.exec(r.ident);
    const numPart = m ? m[1] : r.ident;
    const g = m && m[2] ? groups.find((x) => x.num === numPart && x.sfx.length && x.head === r.head && x.cross === r.cross) : undefined;
    if (g) { g.sfx.push(m![2]); g.idx.push(r.i); }
    else groups.push({ num: numPart, sfx: m && m[2] ? [m[2]] : [], head: r.head, cross: r.cross, idx: [r.i] });
  }
  groups.sort((a, b) => b.head - a.head || a.cross - b.cross);
  const best = groups[0]?.head ?? 0;
  const favored: number[] = [];
  const list = groups.map((g) => {
    const fav = best > 0 && g.head >= best - 1;
    if (fav) favored.push(...g.idx);
    const order = ['L', 'C', 'R'];
    const sfx = g.sfx.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return { ident: g.num + (sfx.length ? sfx[0] + (sfx.length > 1 ? '/' + sfx.slice(1).join('/') : '') : ''), head: g.head, cross: g.cross, favored: fav };
  });
  return { list, favored };
}
