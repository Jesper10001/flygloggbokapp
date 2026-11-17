// Play på kartorna: en flygning spelas upp med Best weeks lager (ReplayKit). Används av Visited airports
// (AirportMapWidget, till eller från flygplatsen, startar utzoomat) och Global map (GlobalMapModal, bara därifrån,
// startar inzoomat med farkosten på banan som rullar iväg innan kartan zoomar ut).
//
// Tidslinjen i sekunder, pre = tiden på banan (0 i Visited airports):
//   0 … pre          farkosten dyker upp på banan och rullar (bara med roll)
//   pre              föräldern ramar in båda flygplatserna (GlobalAirportMap fitTo)
//   pre+1 … pre+5,8  flygningen
//   pre+5,8 … total  landningsringar, sedan avslutar föräldern
import { Polyline } from 'react-native-maps';
import type { Flight } from '../types/flight';
import { getAircraftCategory } from '../db/flights';
import { getRunwayGeo } from '../constants/runwayGeo';
import { ReplayAircraft, RippleMarker, StopMarker, gcPoint, gcPath, gcCourse, ease, clamp, angLerp } from './milestones/ReplayKit';
import { toLatLng, headingDeg, lerpPt, nmBetween, type GeoPt } from './milestones/MilestoneMap';

export type ReplayFlight = {
  icao: string;          // flygplatsen vars kort Play sitter på
  flight: Flight;
  depIcao: string; arrIcao: string;
  dep: GeoPt; arr: GeoPt;
  heli: boolean;
  nm: number;            // från startpunkten (banan eller flygplatsen) till ankomsten
  roll: { from: GeoPt; to: GeoPt; heading: number } | null;   // startrullningen på banan (Global map)
};

export const replayTotal = (pre: number) => pre + 7;
const FLY_START = 1, FLY_LEN = 4.8;

const angDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** Banan som ligger närmast kursen mot ankomsten, i den riktning man startar: rullningen från tröskeln och halvvägs. */
function runwayRoll(icao: string, dep: GeoPt, arr: GeoPt): ReplayFlight['roll'] {
  const rws = getRunwayGeo(icao);
  if (!rws.length) return null;
  const course = headingDeg(dep, arr);
  let best: ReplayFlight['roll'] = null, bestD = 999;
  for (const r of rws) {
    const b = headingDeg(r.le, r.he);
    for (const [s, e, h] of [[r.le, r.he, b], [r.he, r.le, b + 180]] as const) {
      const d = angDiff(h, course);
      if (d < bestD) { bestD = d; best = { from: lerpPt(s, e, 0.08), to: lerpPt(s, e, 0.55), heading: ((h % 360) + 360) % 360 }; }
    }
  }
  return best;
}

export async function buildReplay(icao: string, flight: Flight, dep: GeoPt, arr: GeoPt, withRoll: boolean): Promise<ReplayFlight> {
  const depIcao = (flight.dep_place || '').trim().toUpperCase(), arrIcao = (flight.arr_place || '').trim().toUpperCase();
  const heli = (await getAircraftCategory(flight.aircraft_type || '').catch(() => '')) === 'helicopter';
  const roll = withRoll ? runwayRoll(depIcao, dep, arr) : null;
  return { icao, flight, depIcao, arrIcao, dep, arr, heli, nm: nmBetween(roll ? roll.to : dep, arr), roll };
}

/** Hur långt flygningen har kommit (0–1), för flygkortets förloppslinje. */
export const replayProgress = (t: number, pre: number) => ease(clamp((t - pre - FLY_START) / FLY_LEN, 0, 1));

export function FlightReplayLayer({ r, t, pre, playing, labels = false }: {
  r: ReplayFlight; t: number; pre: number; playing: boolean;
  labels?: boolean;   // koderna vid båda flygplatserna (Global map: utzoomat syns inte alla flygplatser)
}) {
  const start = r.roll ? r.roll.to : r.dep;
  const onRunway = !!r.roll && t < pre;
  const f = replayProgress(t, pre);
  let p: GeoPt, heading: number;
  if (onRunway && r.roll) {
    const x = clamp((t - 0.5) / Math.max(0.1, pre - 0.5), 0, 1);
    p = lerpPt(r.roll.from, r.roll.to, x * x);   // accelererar
    heading = r.roll.heading;
  } else {
    p = gcPoint(start, r.arr, f);
    const course = gcCourse(start, r.arr, f);
    heading = r.roll ? angLerp(r.roll.heading, course, ease(clamp(f / 0.08, 0, 1))) : course;
  }
  const showPlane = t >= (r.roll ? 0.15 : 0);
  const landed = t >= pre + FLY_START + FLY_LEN;
  return (
    <>
      {t >= pre && (
        <Polyline coordinates={gcPath(start, r.arr, 0, 1, r.nm).map(toLatLng)} strokeColor="rgba(255,255,255,0.45)" strokeWidth={1.5} lineDashPattern={[5, 6]} zIndex={6} />
      )}
      {f > 0.002 && (
        <Polyline coordinates={gcPath(start, r.arr, 0, f, r.nm).map(toLatLng)} strokeColor="#67E8F9" strokeWidth={3} lineCap="round" zIndex={7} />
      )}
      {labels && t >= pre && <StopMarker p={r.dep} code={r.depIcao} visited pin />}
      {labels && t >= pre && <StopMarker p={r.arr} code={r.arrIcao} visited pin />}
      {landed && <RippleMarker key={`rip-${r.flight.id}`} p={r.arr} />}
      {showPlane && (
        <ReplayAircraft p={p} heli={r.heli} heading={heading} spinning={playing && r.heli} lift={onRunway ? 0 : Math.sin(Math.PI * f) * 6} />
      )}
    </>
  );
}

