// Per-flygning natt-andel + mörkrets inträde (för LatestFlightCard / NightRoute).
// Använder riktiga astronomi-utils + ICAO-koordinater. Faller tillbaka på loggad
// natt-tid om koordinater saknas (t.ex. ZZZZ/off-airport).
import { useEffect, useState } from 'react';
import type { Flight } from '../../types/flight';
import { getAirportCoordinates } from '../../db/icao';
import { buildInstants, computeDarkWindow, CIVIL_TWILIGHT_DEG } from '../../utils/flightTime';
import { arrUtc } from './flightDisplay';

export type NightInfo = { nightFrac: number; darkOnsetUtc: string | null };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const hhmmUTC = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

function fallback(f: Flight): NightInfo {
  const frac = (f.total_time ?? 0) > 0 ? clamp01((f.night ?? 0) / f.total_time) : (f.night > 0 ? 1 : 0);
  return { nightFrac: frac, darkOnsetUtc: null };
}

export function useNightFraction(flight: Flight | null | undefined): NightInfo {
  const [info, setInfo] = useState<NightInfo>({ nightFrac: 0, darkOnsetUtc: null });

  useEffect(() => {
    let alive = true;
    if (!flight) { setInfo({ nightFrac: 0, darkOnsetUtc: null }); return; }
    const f = flight;
    (async () => {
      try {
        const coords = await getAirportCoordinates([f.dep_place, f.arr_place].filter(Boolean));
        const dep = coords.find((c) => c.icao === f.dep_place);
        const arr = coords.find((c) => c.icao === f.arr_place);
        const inst = buildInstants(f.date, f.dep_utc, arrUtc(f));
        if (!dep || !arr || !inst) { if (alive) setInfo(fallback(f)); return; }
        const dark = computeDarkWindow({
          depLat: dep.lat, depLon: dep.lon, arrLat: arr.lat, arrLon: arr.lon,
          dep: inst.dep, arr: inst.arr, altitudeDeg: CIVIL_TWILIGHT_DEG,
        });
        let frac: number;
        if (dark.coverage === 'all') frac = 1;
        else if (dark.coverage === 'none' || !dark.start) frac = 0;
        else {
          const total = inst.arr.getTime() - inst.dep.getTime();
          const nightMs = inst.arr.getTime() - Math.max(inst.dep.getTime(), dark.start.getTime());
          frac = total > 0 ? clamp01(nightMs / total) : 0;
        }
        if (alive) setInfo({ nightFrac: frac, darkOnsetUtc: dark.start ? hhmmUTC(dark.start) : null });
      } catch {
        if (alive) setInfo(fallback(f));
      }
    })();
    return () => { alive = false; };
  }, [flight?.id, flight?.date, flight?.dep_place, flight?.arr_place, flight?.dep_utc, flight?.arr_utc]);

  return info;
}
