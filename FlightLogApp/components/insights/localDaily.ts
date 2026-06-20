// Per-dag (lokal tid) flygtid + flight-id:n för Insights-heatmapen. Ett flyg som
// spiller över midnatt (lokal tid på AVGÅNGSflygplatsen) delas på två (eller fler)
// lokala dagar — total_time fördelas vid varje lokal midnatt. Flygets id läggs på
// VARJE dag det rör, så popupen visar samma flight oavsett vilken dag man trycker.

import type { Flight } from '../../types/flight';
import { localOffsetMinutes } from '../../utils/timezone';

export type TzInfo = { country: string; region: string; lon: number };

const pad = (n: number) => String(n).padStart(2, '0');
const validTime = (s?: string) => !!s && /^\d{1,2}:\d{2}$/.test(s);

export function buildLocalDaily(flights: Flight[], tz: Record<string, TzInfo>): { hours: Map<string, number>; ids: Map<string, number[]> } {
  const hours = new Map<string, number>();
  const ids = new Map<string, number[]>();
  const add = (key: string, h: number, id: number) => {
    hours.set(key, (hours.get(key) ?? 0) + h);
    const arr = ids.get(key) ?? [];
    if (!arr.includes(id)) arr.push(id);
    ids.set(key, arr);
  };

  for (const f of flights) {
    if (f.flight_type === 'sim' || !((f.total_time || 0) > 0) || !f.date) continue;
    const info = f.dep_place ? tz[f.dep_place] : undefined;

    if (validTime(f.dep_utc) && info) {
      const [Y, Mo, Da] = f.date.split('-').map(Number);
      const [dh, dm] = f.dep_utc.split(':').map(Number);
      const depUtcMs = Date.UTC(Y, Mo - 1, Da, dh, dm);
      const off = localOffsetMinutes(new Date(depUtcMs), info.country, info.region, info.lon);
      if (off != null) {
        let cursor = depUtcMs + off * 60000; // lokal väggklocka, läses via getUTC*
        let remaining = Math.round((f.total_time || 0) * 60); // minuter
        let guard = 0;
        while (remaining > 0 && guard++ < 6) {
          const c = new Date(cursor);
          const key = `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
          const minOfDay = c.getUTCHours() * 60 + c.getUTCMinutes();
          const take = Math.min(remaining, 1440 - minOfDay);
          add(key, take / 60, f.id);
          remaining -= take;
          cursor += take * 60000;
        }
        continue;
      }
    }
    // ingen giltig tid/tidszon → hela flyget på dess flygdatum
    add(f.date, f.total_time || 0, f.id);
  }
  return { hours, ids };
}
