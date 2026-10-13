// Gemensamma hjälpare för demo-generatorerna: RNG, solhöjd/natt, storcirkel, tidszoner, CSV.
import { readFileSync } from 'node:fs';

export const APP = new URL('../../FlightLogApp', import.meta.url).pathname; // appens flygplats-DB
const seed = JSON.parse(readFileSync(`${APP}/assets/icao-airports.dat`, 'utf8'));
export const AIRPORTS = new Map(seed.map((r) => [r[0], { icao: r[0], name: r[1], cc: r[2], lat: r[4], lon: r[5], type: r[8] }]));
export function ap(icao) {
  const a = AIRPORTS.get(icao);
  if (!a || a.type === 'closed') throw new Error(`Okänd/stängd flygplats: ${icao}`);
  return a;
}

// ── Deterministisk RNG (mulberry32) ──
export function makeRng(seedNum) {
  let s = seedNum >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    r,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    float: (a, b) => a + r() * (b - a),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    weighted: (pairs) => { const tot = pairs.reduce((s, [, w]) => s + w, 0); let x = r() * tot; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; },
  };
}

// ── Solhöjd (NOAA-förenklad, ~0,1°) — natt enligt EASA = solen > 6° under horisonten ──
const RAD = Math.PI / 180;
export function sunElevation(ms, lat, lon) {
  const d = (ms - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const g = RAD * ((357.529 + 0.98560028 * d) % 360);
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = RAD * ((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360);
  const e = RAD * (23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstH = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = RAD * ((gmstH * 15 + lon) % 360) - ra;
  const la = RAD * lat;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / RAD;
}
export const isNight = (ms, lat, lon) => sunElevation(ms, lat, lon) < -6;

// ── Storcirkel ──
export function distNm(a, b) {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, dφ = (b.lat - a.lat) * RAD, dλ = (b.lon - a.lon) * RAD;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function gcInterp(a, b, f) {
  const φ1 = a.lat * RAD, λ1 = a.lon * RAD, φ2 = b.lat * RAD, λ2 = b.lon * RAD;
  const δ = distNm(a, b) / 3440.065;
  if (δ < 1e-9) return a;
  const A = Math.sin((1 - f) * δ) / Math.sin(δ), B = Math.sin(f * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
}
// Nattminuter längs rutten (minut för minut, position interpolerad över blocktiden).
export function nightMinutes(a, b, depMs, blockMin) {
  let n = 0;
  for (let m = 0; m < blockMin; m++) {
    const p = gcInterp(a, b, (m + 0.5) / blockMin);
    if (isNight(depMs + (m + 0.5) * 60000, p.lat, p.lon)) n++;
  }
  return n;
}

// ── Tidszoner (EU-sommartid: sista söndagen i mars → sista söndagen i oktober, 01:00 UTC) ──
function lastSundayUtc(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
export function euDst(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSundayUtc(y, 2) && ms < lastSundayUtc(y, 9);
}
const STD_OFFSET = { SE: 1, NO: 1, DK: 1, DE: 1, NL: 1, BE: 1, FR: 1, CH: 1, AT: 1, CZ: 1, PL: 1, GB: 0, FI: 2, EE: 2, LV: 2, LT: 2 };
export const utcOffsetH = (cc, ms) => (STD_OFFSET[cc] ?? 1) + (euDst(ms) ? 1 : 0);
// Lokal tid (y, mo 1-12, d, h, mi) i ett land → UTC-ms.
export function localToUtc(cc, y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - utcOffsetH(cc, guess - 3600000) * 3600000;
}

// ── Datum/tid-format ──
export const pad2 = (n) => String(n).padStart(2, '0');
export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const hhmm = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
export const dur = (min) => (min > 0 ? `${Math.floor(min / 60)}:${pad2(Math.round(min % 60))}` : '0');
export const DAY = 86400000;

// Dagsljusfönster (UTC-ms) för ett datum på en plats: första/sista minuten med solen > 0°.
export function daylight(dayStartUtcMs, lat, lon) {
  let first = null, last = null;
  for (let m = 0; m < 1440; m += 5) {
    const t = dayStartUtcMs + m * 60000;
    if (sunElevation(t, lat, lon) > 0) { if (first === null) first = t; last = t; }
  }
  return first === null ? null : { first, last };
}

// ── CSV ──
export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells) => cells.map(csvCell).join(',');
