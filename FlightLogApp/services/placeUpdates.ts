// När en okänd plats fått koordinater (via Manage airports): räkna om auto-natten för de flighter
// som använder platsen som dep/arr. Om den skiljer sig från den natt användaren själv fyllde i →
// köa ett förslag till dashboardens "Update night time"-notis.
import { getFlights } from '../db/flights';
import { getAirportTzInfo } from '../db/icao';
import { buildInstants } from '../utils/flightTime';
import { computeNightHoursTimed } from '../utils/dayNight';
import { placeCode } from '../utils/format';
import { useNightUpdateStore, type NightUpdate } from '../store/nightUpdateStore';

export async function queueNightUpdatesForPlace(code: string): Promise<void> {
  const c = code.trim().toUpperCase();
  if (!c) return;
  const flights = await getFlights(100000);
  const affected = flights.filter((f) => f.dep_place?.toUpperCase() === c || f.arr_place?.toUpperCase() === c);
  if (!affected.length) return;

  const updates: NightUpdate[] = [];
  for (const f of affected) {
    const inst = buildInstants(f.date, f.dep_utc, f.arr_utc, 0);
    if (!inst) continue; // ogiltiga tider → ingen natt-beräkning
    // Båda ändpunkterna måste ha koordinater för att natten ska gå att beräkna.
    const tz = await getAirportTzInfo([f.dep_place, f.arr_place]);
    const dep = tz.find((r) => r.icao?.toUpperCase() === f.dep_place?.toUpperCase());
    const arr = tz.find((r) => r.icao?.toUpperCase() === f.arr_place?.toUpperCase());
    if (!dep || !arr) continue;
    const auto = computeNightHoursTimed(
      [{ lat: dep.lat, lon: dep.lon }, { lat: arr.lat, lon: arr.lon }],
      inst.dep.getTime(), inst.arr.getTime(),
    );
    const current = f.night ?? 0;
    if (Math.abs(auto - current) >= 0.1) {
      updates.push({
        flightId: f.id,
        label: `${placeCode(f.dep_place, f.dep_place_raw)}–${placeCode(f.arr_place, f.arr_place_raw)} · ${f.date}`,
        newNight: auto,
      });
    }
  }
  if (updates.length) useNightUpdateStore.getState().addMany(updates);
}
