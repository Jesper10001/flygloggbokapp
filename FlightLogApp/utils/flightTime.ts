// Tidszons-medveten blocktid + automatisk natt-tid (borgerlig skymning).
// Tider matas in som UTC (zulu). Blocktid räknas från riktiga tidpunkter
// (avgångsdatum + ev. ankomstdag-offset) så långa flyg över midnatt/tidszoner
// blir rätt. Natt samplas längs storcirkeln med solhöjd < −6°.

import { solarAltitudeDeg } from './sun';
import { isValidTime } from './format';

export const CIVIL_TWILIGHT_DEG = -6;

// UTC-tidpunkter från avgångsdatum (YYYY-MM-DD) + dep/arr "HH:MM" (UTC).
// arrDayOffset: extra dygn för ankomst (0/1/2). 0 ⇒ auto +1 om arr passerar midnatt.
export function buildInstants(
  dateStr: string, depUtc: string, arrUtc: string, arrDayOffset = 0,
): { dep: Date; arr: Date } | null {
  if (!dateStr || !isValidTime(depUtc) || !isValidTime(arrUtc)) return null;
  const [y, mo, da] = dateStr.split('-').map(Number);
  if (!y || !mo || !da) return null;
  const [dh, dm] = depUtc.split(':').map(Number);
  const [ah, am] = arrUtc.split(':').map(Number);
  const dep = new Date(Date.UTC(y, mo - 1, da, dh, dm, 0));
  let offset = arrDayOffset;
  if (offset === 0 && ah * 60 + am < dh * 60 + dm) offset = 1; // auto: passerar midnatt
  const arr = new Date(Date.UTC(y, mo - 1, da + offset, ah, am, 0));
  return { dep, arr };
}

// En UTC-tidpunkt från datum (YYYY-MM-DD) + "HH:MM" (UTC). För lokal-tid-hint.
export function instantFromDateTime(dateStr: string, hhmm: string): Date | null {
  if (!dateStr || !isValidTime(hhmm)) return null;
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  if (!y || !mo || !da) return null;
  return new Date(Date.UTC(y, mo - 1, da, h, m, 0));
}

export function blockHours(dep: Date, arr: Date): number {
  const ms = arr.getTime() - dep.getTime();
  if (!(ms > 0)) return 0;
  return Math.round((ms / 3600000) * 10) / 10; // decimaltimmar, 1 decimal
}

// Deterministisk tids-avstämning för OCR: total_time (ankare) vs blocktid
// (ankomst − avgång, med midnatt-rollover). Returnerar null om dep/arr ogiltiga
// eller ankaret saknas. mismatch = avvikelse > 6 min (≈ 0.1h). Ger även de två
// kandidaterna: rätt ankomst om avgång stämmer, och rätt avgång om ankomst stämmer.
export function reconcileBlockTime(depUtc: string, arrUtc: string, anchorH: number): {
  blockH: number; mismatch: boolean; computedArrIfDepCorrect: string; computedDepIfArrCorrect: string;
} | null {
  if (!isValidTime(depUtc) || !isValidTime(arrUtc) || !(anchorH > 0)) return null;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const fmt = (min: number) => {
    const x = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  const dep = toMin(depUtc);
  let arr = toMin(arrUtc);
  if (arr < dep) arr += 1440; // passerar midnatt
  const blockMin = arr - dep;
  const anchorMin = anchorH * 60;
  return {
    blockH: Math.round((blockMin / 60) * 10) / 10,
    mismatch: Math.abs(blockMin - anchorMin) > 6,
    computedArrIfDepCorrect: fmt(dep + anchorMin),
    computedDepIfArrCorrect: fmt(arr - anchorMin),
  };
}

// Grov lokal tid (UTC→lokal via longitud, ingen DST) — endast hjälptext.
export function localHint(utcHHMM: string, lon: number | null | undefined): string | null {
  if (!isValidTime(utcHHMM) || lon == null || !isFinite(lon)) return null;
  const [h, m] = utcHHMM.split(':').map(Number);
  const offsetMin = Math.round((lon / 15) * 60);
  const total = (((h * 60 + m + offsetMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Storcirkel-interpolation mellan två lat/lon (grader), andel f ∈ [0,1].
export function interpLatLon(lat1: number, lon1: number, lat2: number, lon2: number, f: number): { lat: number; lon: number } {
  const D = Math.PI / 180, R = 180 / Math.PI;
  const φ1 = lat1 * D, λ1 = lon1 * D, φ2 = lat2 * D, λ2 = lon2 * D;
  const Δ = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
  ));
  if (!(Δ > 1e-9)) return { lat: lat1, lon: lon1 };
  const a = Math.sin((1 - f) * Δ) / Math.sin(Δ);
  const b = Math.sin(f * Δ) / Math.sin(Δ);
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * R, lon: Math.atan2(y, x) * R };
}

// Natt-timmar: sampla rutten i tiden och räkna andelen punkter där solen < −6°.
export function computeNightHours(opts: {
  depLat: number; depLon: number; arrLat: number; arrLon: number;
  dep: Date; arr: Date; altitudeDeg?: number;
}): number {
  const { depLat, depLon, arrLat, arrLon, dep, arr, altitudeDeg = CIVIL_TWILIGHT_DEG } = opts;
  const totalMs = arr.getTime() - dep.getTime();
  if (!(totalMs > 0)) return 0;
  const totalH = totalMs / 3600000;
  const steps = Math.min(600, Math.max(12, Math.round(totalMs / 60000 / 2))); // ~2 min/steg
  let night = 0;
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps; // segmentets mittpunkt
    const t = new Date(dep.getTime() + f * totalMs);
    const p = interpLatLon(depLat, depLon, arrLat, arrLon, f);
    if (solarAltitudeDeg(t, p.lat, p.lon) < altitudeDeg) night++;
  }
  return Math.round((night / steps) * totalH * 10) / 10;
}

export interface SunSeg { startFrac: number; endFrac: number; kind: 'day' | 'twilight' | 'night' }

// Dag/skymning/natt-profil längs en FLERBENS-rutt över hela flygfönstret.
// Samplar positionen i tiden längs varje bens storcirkel (och står still på
// marken mellan ben) och klassar solhöjden: dag > −0.833°, skymning −6..−0.833°,
// natt < −6°. Fångar långa "sol-jagande" flyg och natt på flera ställen.
export function computeSunWindow(
  legs: { depLat: number; depLon: number; arrLat: number; arrLon: number; depUtc: string; arrUtc: string }[],
  dateStr: string,
): { segments: SunSeg[]; nightMin: number } | null {
  if (!legs.length || !dateStr) return null;
  const [Y, Mo, Da] = dateStr.split('-').map(Number);
  if (!Y || !Mo || !Da) return null;
  const mk = (hhmm: string, off: number): number | null => {
    if (!isValidTime(hhmm)) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return Date.UTC(Y, Mo - 1, Da + off, h, m);
  };
  // Absoluta tider med dygns-rollover (ben som passerar midnatt UTC).
  const air: { start: number; end: number; aLat: number; aLon: number; bLat: number; bLon: number }[] = [];
  let off = 0, prev = -Infinity;
  for (const lg of legs) {
    let start = mk(lg.depUtc, off); if (start == null) return null;
    if (start < prev) { off++; start = mk(lg.depUtc, off)!; }
    let end = mk(lg.arrUtc, off); if (end == null) return null;
    if (end < start) { off++; end = mk(lg.arrUtc, off)!; }
    air.push({ start, end, aLat: lg.depLat, aLon: lg.depLon, bLat: lg.arrLat, bLon: lg.arrLon });
    prev = end;
  }
  const windowStart = air[0].start;
  const windowEnd = air[air.length - 1].end;
  const totalMs = windowEnd - windowStart;
  if (!(totalMs > 0)) return null;
  const steps = Math.min(360, Math.max(24, Math.round(totalMs / 60000 / 3))); // ~3 min/steg
  const classes: SunSeg['kind'][] = [];
  let nightCount = 0;
  for (let i = 0; i < steps; i++) {
    const t = windowStart + ((i + 0.5) / steps) * totalMs;
    let lat: number, lon: number;
    const seg = air.find((sg) => t >= sg.start && t <= sg.end);
    if (seg) {
      const f = (t - seg.start) / Math.max(1, seg.end - seg.start);
      const p = interpLatLon(seg.aLat, seg.aLon, seg.bLat, seg.bLon, f);
      lat = p.lat; lon = p.lon;
    } else {
      // På marken mellan ben → senast landade flygplatsen.
      let g = air[0];
      for (const sg of air) if (sg.end <= t) g = sg;
      lat = g.bLat; lon = g.bLon;
    }
    const alt = solarAltitudeDeg(new Date(t), lat, lon);
    const k: SunSeg['kind'] = alt > -0.833 ? 'day' : alt > CIVIL_TWILIGHT_DEG ? 'twilight' : 'night';
    classes.push(k);
    if (k === 'night') nightCount++;
  }
  // Slå ihop till sammanhängande segment (andelar av fönstret).
  const segments: SunSeg[] = [];
  let runStart = 0;
  for (let i = 1; i <= steps; i++) {
    if (i === steps || classes[i] !== classes[runStart]) {
      segments.push({ startFrac: runStart / steps, endFrac: i / steps, kind: classes[runStart] });
      runStart = i;
    }
  }
  return { segments, nightMin: Math.round((nightCount / steps) * (totalMs / 60000)) };
}
