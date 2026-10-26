// Drönarens "Instrument scan": läser en skärmdump/ett foto av en drönarapps flyglogg (t.ex. DJI Fly →
// Flight Data Center: Date / Distance / Altitude / Duration) och returnerar flygningarna grupperade per
// datum, senaste datum först. Claude läser bara av raderna — normalisering (enheter, minuter, gruppering)
// sker lokalt. Token-styrt som övriga AI-funktioner (anroparen kollar hasTokenQuota).
import { callAnthropicJson } from './anthropicClient';
import { prepareScanImage } from './scanImage';

export interface ScannedDroneFlight {
  minutes: number;        // flygtid i minuter
  altitude_m: number;     // max höjd i meter (0 = okänd)
  distance_m: number;     // sträcka i meter (0 = okänd)
  takeoff_time: string;   // "HH:MM" lokal tid om den syns, annars ''
  aircraft: string;       // drönarmodell om den syns, annars ''
  location: string;       // platsnamn om det syns (ej platshållare som "Map Loading"), annars ''
}
export interface ScannedDroneDay { date: string; flights: ScannedDroneFlight[] }
export interface DroneLogScanResult { source: string; days: ScannedDroneDay[] }

const systemPrompt = (today: string) => `You read drone flight logs from screenshots of drone apps (DJI Fly "Flight Data Center" or flight records, DJI Pilot 2, DJI GO 4, Autel Explorer, Litchi, AirData …) or photos of a controller screen. Today's date is ${today}.

Extract EVERY flight row you can see. Lists may be sorted by any column (altitude, distance …) — keep all rows, in the order shown. Ignore summary totals such as "Total Distance", "Total Flight Time" or "Total Flights".

Return ONLY a raw JSON object (no markdown):
{"source":"<app name, or ''>","flights":[{"date":"YYYY-MM-DD","takeoff_time":"HH:MM or ''","duration_min":19,"max_altitude":501,"altitude_unit":"m","distance":854,"distance_unit":"m","aircraft":"<model, or ''>","location":"<place name, or ''>"}]}

Rules:
- duration_min: flight time in minutes ("19 min" → 19, "1h 5min" → 65, "12:30" as mm:ss → 12.5).
- max_altitude: the highest altitude shown for that flight; altitude_unit "m" or "ft" as displayed. 0 if not shown.
- distance with distance_unit "m", "km", "ft" or "mi" as displayed. 0 if not shown.
- takeoff_time only if a clock time is visible for the flight; aircraft only if a model name is visible.
- location: the place name shown for the flight (city, site or address). Use '' for placeholders such as "Map Loading", "Loading…", "Unknown" or "--".
- Dates: work out the format from the WHOLE list — if any row reads e.g. 16/03/2017, the list is day/month/year, so 04/03/2017 is 2017-03-04. Only if the whole list is ambiguous, pick the interpretation closest to today's date.
- Skip rows without a readable date or duration. Never invent rows.`;

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const clock = (v: unknown) => {
  const m = String(v ?? '').match(/^(\d{1,2})[:.](\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};
// Platsnamn — platshållare (DJI GO 4 visar "Map Loading" tills kartan laddat) räknas som okänd plats.
const placeName = (v: unknown) => {
  const t = String(v ?? '').trim();
  return !t || /^(map\s*loading|loading|unknown|n\/?a|-+)\W*$/i.test(t) ? '' : t;
};
const toMeters = (v: number, unit: unknown) => {
  const u = String(unit ?? 'm').toLowerCase();
  if (u === 'ft') return v * 0.3048;
  if (u === 'km') return v * 1000;
  if (u === 'mi') return v * 1609.344;
  return v;
};

/** Läser flygningarna i bilden → per datum (senaste först). Kastar vid AI-/nätverksfel. */
export async function scanDroneFlightLog(uri: string): Promise<DroneLogScanResult> {
  const base64 = await prepareScanImage(uri);
  const today = new Date().toISOString().slice(0, 10);
  const parsed = await callAnthropicJson<{ source?: string; flights?: any[] }>({
    system: systemPrompt(today),
    maxTokens: 3000,
    timeoutMs: 60000,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
      { type: 'text', text: 'Extract every flight in this drone flight log.' },
    ],
  });

  const byDate = new Map<string, ScannedDroneFlight[]>();
  for (const f of Array.isArray(parsed?.flights) ? parsed.flights : []) {
    const date = String(f?.date ?? '');
    const minutes = num(f?.duration_min);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime()) || minutes <= 0) continue;
    const flight: ScannedDroneFlight = {
      minutes,
      altitude_m: Math.round(toMeters(num(f?.max_altitude), f?.altitude_unit) * 100) / 100,
      distance_m: Math.round(toMeters(num(f?.distance), f?.distance_unit)),
      takeoff_time: clock(f?.takeoff_time),
      aircraft: String(f?.aircraft ?? '').trim(),
      location: placeName(f?.location),
    };
    const list = byDate.get(date) ?? [];
    list.push(flight);
    byDate.set(date, list);
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    // Inom dagen: starttid om den finns (1st flight = tidigaste), annars ordningen i bilden.
    .map(([date, flights]) => ({ date, flights: [...flights].sort((x, y) => (x.takeoff_time && y.takeoff_time ? x.takeoff_time.localeCompare(y.takeoff_time) : 0)) }));
  return { source: String(parsed?.source ?? ''), days };
}
