// Dag/natt-karta: terminator (gräns dag↔natt), rutt-sampling i tid och projektion.
// Allt beräknas astronomiskt via sun.ts (samma modell som night-tiden) — ingen extern data.
// Projektion: ekvirektangulär i viewBox 0..360 × 0..180 (matchar assets/worldLand).

import { solarAltitudeDeg, subsolarPoint } from './sun';
import { interpLatLon, CIVIL_TWILIGHT_DEG } from './flightTime';

const RAD = Math.PI / 180;

export type SunState = 'day' | 'dusk' | 'night' | 'dawn';
// Klassar sol-fas vid en tidpunkt + plats. Borgerlig skymning (−0.833°..−6°) delas i
// dusk (solen sjunker, kväll) och dawn (solen stiger, morgon) via trenden 5 min framåt.
export function classifySun(date: Date, lat: number, lon: number): SunState {
  const alt = solarAltitudeDeg(date, lat, lon);
  if (alt > -0.833) return 'day';
  if (alt < -6) return 'night';
  const altNext = solarAltitudeDeg(new Date(date.getTime() + 5 * 60000), lat, lon);
  return altNext > alt ? 'dawn' : 'dusk';
}

// Stor-cirkel-avstånd (radianer) — för leg-proportionering.
export function gcRad(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = aLat * RAD, p2 = bLat * RAD, dl = (bLon - aLon) * RAD;
  return Math.acos(Math.max(-1, Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl))));
}

export interface RoutePt { lat: number; lon: number; timeMs: number; state: SunState }
export interface RouteLeg { lat: number; lon: number; dwellMin?: number; label?: string }

// Tidslinje: dwell-tid (min) vid varje punkt (waypoints) + flygtid fördelad på sträckan.
// Total tid = arr − dep; dwell tas FRÅN totalen (flygtid = total − summa dwell).
function timeline(legs: RouteLeg[], totalMs: number) {
  const n = legs.length;
  const dwellMs = legs.map((l) => Math.max(0, l.dwellMin || 0) * 60000);
  const dist: number[] = [];
  let totalDist = 0;
  for (let i = 0; i < n - 1; i++) { const d = gcRad(legs[i].lat, legs[i].lon, legs[i + 1].lat, legs[i + 1].lon); dist.push(d); totalDist += d; }
  const sumDwell = dwellMs.reduce((a, b) => a + b, 0);
  const flyMs = Math.max(0, totalMs - sumDwell);
  const legFlyMs = dist.map((d) => totalDist > 1e-9 ? flyMs * d / totalDist : (n > 1 ? flyMs / (n - 1) : 0));
  const flyStart: number[] = [];
  let cur = 0;
  for (let i = 0; i < n - 1; i++) { cur += dwellMs[i]; flyStart.push(cur); cur += legFlyMs[i]; }
  return { dwellMs, dist, totalDist, legFlyMs, flyStart };
}

// Flygplanets position vid tid t (ms från avgång), med dwell (stillastående) vid waypoints.
export function positionAtMs(legs: RouteLeg[], totalMs: number, t: number): { lat: number; lon: number } {
  if (legs.length === 0) return { lat: 0, lon: 0 };
  if (legs.length === 1) return { lat: legs[0].lat, lon: legs[0].lon };
  const { dwellMs, legFlyMs } = timeline(legs, totalMs);
  let cur = 0;
  for (let i = 0; i < legs.length - 1; i++) {
    if (t <= cur + dwellMs[i]) return { lat: legs[i].lat, lon: legs[i].lon };
    cur += dwellMs[i];
    if (t <= cur + legFlyMs[i]) {
      const f = legFlyMs[i] > 1e-9 ? (t - cur) / legFlyMs[i] : 0;
      return interpLatLon(legs[i].lat, legs[i].lon, legs[i + 1].lat, legs[i + 1].lon, f);
    }
    cur += legFlyMs[i];
  }
  return { lat: legs[legs.length - 1].lat, lon: legs[legs.length - 1].lon };
}

// Ankomsttid (ms) vid varje vertex (dep, stopp..., arr) — dwell-medvetet. out[0]=dep,
// out[last]=arr; mellanvärden = när flygplanet NÅR varje stopp (touchdown), före dwell.
export function vertexArrivalTimes(legs: RouteLeg[], depMs: number, arrMs: number): number[] {
  const out = [depMs];
  if (legs.length < 2) return out;
  const { dwellMs, legFlyMs } = timeline(legs, arrMs - depMs);
  let cur = 0;
  for (let i = 0; i < legs.length - 1; i++) { cur += dwellMs[i] + legFlyMs[i]; out.push(depMs + cur); }
  return out;
}

// Samplar rutt-GEOMETRIN (alla ben) med korrekt tid per punkt (dwell skiftar tiderna).
// Varje punkt klassas efter solhöjden vid den tidpunkt flygplanet är där.
export function sampleTimedRoute(legs: RouteLeg[], depMs: number, arrMs: number, steps = 100): RoutePt[] {
  const out: RoutePt[] = [];
  if (legs.length === 0) return out;
  const totalMs = arrMs - depMs;
  if (legs.length === 1) {
    for (let i = 0; i <= steps; i++) {
      const f = i / steps; const timeMs = depMs + f * totalMs;
      out.push({ lat: legs[0].lat, lon: legs[0].lon, timeMs, state: classifySun(new Date(timeMs), legs[0].lat, legs[0].lon) });
    }
    return out;
  }
  const { dist, totalDist, legFlyMs, flyStart } = timeline(legs, totalMs);
  for (let i = 0; i < legs.length - 1; i++) {
    const segSteps = Math.max(2, Math.round(steps * (totalDist > 1e-9 ? dist[i] / totalDist : 1 / (legs.length - 1))));
    for (let k = 0; k <= segSteps; k++) {
      const f = k / segSteps;
      const p = interpLatLon(legs[i].lat, legs[i].lon, legs[i + 1].lat, legs[i + 1].lon, f);
      const timeMs = depMs + flyStart[i] + f * legFlyMs[i];
      out.push({ lat: p.lat, lon: p.lon, timeMs, state: classifySun(new Date(timeMs), p.lat, p.lon) });
    }
  }
  return out;
}

// Natt-timmar längs den dwell-medvetna rutten (sol < −6°). Samplar HELA tidslinjen
// (inkl. dwell vid waypoints), så T&G/hot refuel-uppehåll räknas in på rätt plats.
export function computeNightHoursTimed(legs: RouteLeg[], depMs: number, arrMs: number, steps = 300): number {
  const totalMs = arrMs - depMs;
  if (!(totalMs > 0) || legs.length === 0) return 0;
  const totalH = totalMs / 3600000;
  let night = 0;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps * totalMs;
    const p = positionAtMs(legs, totalMs, t);
    if (solarAltitudeDeg(new Date(depMs + t), p.lat, p.lon) < CIVIL_TWILIGHT_DEG) night++;
  }
  // Natt-tid får ALDRIG överstiga flygfönstret. 0.1h-avrundningen kan annars runda UPP
  // (t.ex. en helnatts-flygning på 28 min → 0.5h = 30 min) → klamp till totalH.
  return Math.min(totalH, Math.round((night / steps) * totalH * 10) / 10);
}

// Destinationspunkt (storcirkel) på vinkelavstånd distDeg° i bäring bearingDeg° från (lat,lon).
export function destPointDeg(latDeg: number, lonDeg: number, bearingDeg: number, distDeg: number): { lat: number; lon: number } {
  const f1 = latDeg * RAD, l1 = lonDeg * RAD, th = bearingDeg * RAD, d = distDeg * RAD;
  const sinF2 = Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th);
  const f2 = Math.asin(Math.max(-1, Math.min(1, sinF2)));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * sinF2);
  return { lat: f2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
}

// Natt-tid för en flygning som utgår OCH landar på samma plats (dep = arr). Flygningen kan ha
// gått ut i valfri riktning och tillbaka, så flygenvelopen är en CIRKEL med radie radiusNM
// (= flygtid × marschfart / 2) runt flygplatsen.
//
// Natt räknas så snart natt (solhöjd < −6°) faller in NÅGONSTANS i cirkeln. Måttstocken är
// cirkelns mest ÖSTLIGA resp. mest VÄSTLIGA punkt: natten sveper i longitud, så östkanten
// mörknar FÖRST (kvällen) och västkanten är SIST att ljusna (gryningen). "Öst i natt ELLER
// väst i natt" täcker därför exakt hela fönstret då någon del av cirkeln är i natt. Reduceras
// till punkt-fallet (solhöjd i centrum < −6°) när radien är 0.
export function computeNightHoursCircle(
  center: { lat: number; lon: number }, radiusNM: number, depMs: number, arrMs: number, steps = 300,
): number {
  const totalMs = arrMs - depMs;
  if (!(totalMs > 0)) return 0;
  const totalH = totalMs / 3600000;
  const radiusDeg = Math.max(0, radiusNM) / 60;                 // 1 NM ≈ 1 bågminut
  const east = destPointDeg(center.lat, center.lon, 90, radiusDeg);
  const west = destPointDeg(center.lat, center.lon, 270, radiusDeg);
  let night = 0;
  for (let k = 0; k < steps; k++) {
    const dt = new Date(depMs + (k + 0.5) / steps * totalMs);
    if (solarAltitudeDeg(dt, east.lat, east.lon) < CIVIL_TWILIGHT_DEG
      || solarAltitudeDeg(dt, west.lat, west.lon) < CIVIL_TWILIGHT_DEG) night++;
  }
  return Math.min(totalH, Math.round((night / steps) * totalH * 10) / 10);
}

// Natt-region(er) som ribbon-polygoner (lon/lat) vid en tidpunkt. Universell metod:
// för varje longitud-kolumn beräknas det latitud-intervall där solhöjden < h0, och
// kontiguösa kolumner knyts ihop till en polygon (övre kant fram, nedre kant tillbaka).
// Hanterar BÅDE solstånds-polkalott OCH dagjämnings-band (då natten är ett band, inte
// en kalott) korrekt — till skillnad från en enkel terminator-per-kolumn.
export function nightRings(
  date: Date, h0Deg = -0.833, lonStep = 2, latStep = 2,
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number } = { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 },
): {
  rings: { lon: number; lat: number }[][]; sub: { lat: number; lon: number };
} {
  const sub = subsolarPoint(date);
  const dec = sub.lat * RAD;
  const sinH0 = Math.sin(h0Deg * RAD);
  const sinDec = Math.sin(dec), cosDec = Math.cos(dec);
  const latLo = Math.max(-90, bounds.latMin), latHi = Math.min(90, bounds.latMax);
  const lons: number[] = [];
  const cols: ({ lo: number; hi: number } | null)[] = [];
  for (let lon = bounds.lonMin; lon <= bounds.lonMax + 1e-6; lon += lonStep) {
    const cH = Math.cos((lon - sub.lon) * RAD);
    let lo = NaN, hi = NaN, any = false;
    for (let lat = latLo; lat <= latHi + 1e-6; lat += latStep) {
      const phi = lat * RAD;
      const f = Math.sin(phi) * sinDec + Math.cos(phi) * cosDec * cH; // = sin(solhöjd)
      if (f < sinH0) { if (!any) { lo = lat; any = true; } hi = lat; }
    }
    lons.push(lon);
    cols.push(any ? { lo, hi } : null);
  }
  const rings: { lon: number; lat: number }[][] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const ring: { lon: number; lat: number }[] = [];
      for (const idx of run) ring.push({ lon: lons[idx], lat: cols[idx]!.hi });
      for (let k = run.length - 1; k >= 0; k--) ring.push({ lon: lons[run[k]], lat: cols[run[k]]!.lo });
      rings.push(ring);
    }
    run = [];
  };
  for (let i = 0; i < cols.length; i++) { if (cols[i]) run.push(i); else flush(); }
  flush();
  return { rings, sub };
}
