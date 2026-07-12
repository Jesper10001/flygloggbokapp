// Currency/recency (BLADES): dubbelklassning av varje start/landning per stopp (dwell-aware)
// för BÅDE EASA (borgerlig skymning, sol < −6°) och FAA-nattfönstret (solnedgång+1h → soluppgång−1h).
//
// FAA-fönstret beräknas altitud-baserat i stället för via klocktider: en tidpunkt är "FAA-natt"
// om solen är under horisonten (−0.833°) NU och även 1h före och 1h efter (dvs > 1h efter
// solnedgång och > 1h före soluppgång). Robust mot midnattsövergång och polära fall.
import { solarAltitudeDeg } from './sun';
import { vertexArrivalTimes, type RouteLeg } from './dayNight';
import { CIVIL_TWILIGHT_DEG } from './flightTime';

const SUN_HORIZON_DEG = -0.833;          // geometrisk soluppgång/-nedgång
const HOUR_MS = 3600000;
// Stopp-typer med en landning (och därmed en efterföljande start). 'lowapp' = ingen landning.
const LANDING_KINDS = new Set(['tng', 'pickup', 'dropoff', 'refuel']);
// Full-stop-landningar (touch & go exkluderas).
const FULLSTOP_KINDS = new Set(['pickup', 'dropoff', 'refuel']);

export function isFaaNight(date: Date, lat: number, lon: number): boolean {
  if (solarAltitudeDeg(date, lat, lon) >= SUN_HORIZON_DEG) return false; // solen uppe
  const prev = solarAltitudeDeg(new Date(date.getTime() - HOUR_MS), lat, lon);
  const next = solarAltitudeDeg(new Date(date.getTime() + HOUR_MS), lat, lon);
  return prev < SUN_HORIZON_DEG && next < SUN_HORIZON_DEG; // > 1h efter solnedgång OCH > 1h före soluppgång
}

export type EventLeg = RouteLeg & { kind?: string };

export interface EventCounts {
  to_day: number; to_night: number; to_faa_night: number;
  ldg_day: number; ldg_night: number; ldg_faa_night: number;
  ldg_fs_day: number; ldg_fs_night: number; ldg_fs_faa_night: number;
}

const empty = (): EventCounts => ({
  to_day: 0, to_night: 0, to_faa_night: 0,
  ldg_day: 0, ldg_night: 0, ldg_faa_night: 0,
  ldg_fs_day: 0, ldg_fs_night: 0, ldg_fs_faa_night: 0,
});

// Klassa varje start- och landningshändelse längs rutten (dep + stopp + arr), dwell-aware.
export function classifyRouteEvents(legs: EventLeg[], depMs: number, arrMs: number): EventCounts {
  const c = empty();
  if (legs.length < 2 || !(arrMs > depMs)) return c;
  const times = vertexArrivalTimes(legs, depMs, arrMs);
  const easaNight = (t: number, lat: number, lon: number) => solarAltitudeDeg(new Date(t), lat, lon) < CIVIL_TWILIGHT_DEG;
  const faaNight = (t: number, lat: number, lon: number) => isFaaNight(new Date(t), lat, lon);
  const addTakeoff = (t: number, lat: number, lon: number) => {
    if (easaNight(t, lat, lon)) c.to_night++; else c.to_day++;
    if (faaNight(t, lat, lon)) c.to_faa_night++;
  };
  const addLanding = (t: number, lat: number, lon: number, fullStop: boolean) => {
    const en = easaNight(t, lat, lon), fn = faaNight(t, lat, lon);
    if (en) c.ldg_night++; else c.ldg_day++;
    if (fn) c.ldg_faa_night++;
    if (fullStop) { if (en) c.ldg_fs_night++; else c.ldg_fs_day++; if (fn) c.ldg_fs_faa_night++; }
  };

  // Start vid avgång.
  addTakeoff(depMs, legs[0].lat, legs[0].lon);

  // Mellanstopp: landning vid ankomst + start efter dwell (utom low approach).
  for (let i = 1; i < legs.length - 1; i++) {
    const leg = legs[i];
    const kind = leg.kind ?? 'tng';
    if (!LANDING_KINDS.has(kind)) continue;
    const landT = times[i];
    addLanding(landT, leg.lat, leg.lon, FULLSTOP_KINDS.has(kind));
    addTakeoff(landT + (leg.dwellMin ?? 0) * 60000, leg.lat, leg.lon);
  }

  // Slutlandning vid ankomst (alltid full stop).
  const arr = legs[legs.length - 1];
  addLanding(arrMs, arr.lat, arr.lon, true);
  return c;
}
