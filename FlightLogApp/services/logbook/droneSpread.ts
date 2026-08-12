// Drönar-loggboksuppslag — ICKE-INVASIVT. Adapterar DroneFlight till de flightKeys
// som drönar-mallen 'sv-drone-logbook' läser, och återanvänder buildBookSpreads
// (samma motor som manned → brought forward / total to date / signatur identiskt).
// Inga ändringar i själva motorn.

import type { Flight } from '../../types/flight';
import { listDrones, type DroneFlight, type DroneRegistryEntry } from '../../db/drones';
import { buildBookSpreads, type LogbookConfig, type LogbookSpread } from './paginate';
import { getTemplate } from '../../constants/logbookTemplates';

type DroneMeta = { model: string; klass: string }; // klass = multirotor|helicopter|fixedwing|vtol

// Land-UTC härleds ur start-tid + total flygtid (drönare loggar sällan sluttid separat).
function addTime(hhmm: string, hours: number): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm) || !(hours > 0)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + Math.round(hours * 60)) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Mappar en drönar-flygning → alla mall-kolumner. `meta` (modell + airframe-klass ur
// registret) driver Make-Mod + multi/single/fixed-wing-uppdelningen.
export function droneToFlightRow(d: DroneFlight, meta?: DroneMeta): Flight {
  const total = d.total_time || 0;
  const coFpv = d.co_pilot_fpv || 0;
  const dual = d.dual || 0;
  const pic = Math.max(0, total - coFpv - dual);
  const klass = meta?.klass || '';
  const single = klass === 'helicopter' ? total : 0;
  const fixed = klass === 'fixedwing' || klass === 'vtol' ? total : 0;
  const multi = single || fixed ? 0 : total; // default multirotor
  const op = d.operation_type || (d.mission_type === 'Recreation' ? 'PRI' : d.mission_type ? 'COM' : '');
  const cat = d.category || '';
  const missionCat = op && cat ? `${op}/${cat}` : op || cat || '';
  const bvlos = d.flight_mode === 'BVLOS' ? total : 0;
  const vlos = bvlos ? 0 : total; // VLOS/EVLOS → VLOS-kolumnen

  return {
    id: d.id,
    date: d.date,
    aircraft_type: meta?.model || d.drone_type || '',   // Make-Mod
    registration: d.registration || '',                  // Reg or S/N
    dep_place: d.location || '',                          // Location
    dep_utc: d.takeoff_time || '',                        // Start UTC
    arr_utc: addTime(d.takeoff_time || '', total),        // Land UTC (härledd)
    total_time: total,
    pic,
    ifr: d.ifr || 0,
    night: (d.night_time && d.night_time > 0) ? d.night_time : (d.is_night ? total : 0),
    landings_day: d.landings_day || 0,
    landings_night: d.landings_night || 0,
    remarks: d.remarks || '',
    // Drönar-specifika mall-nycklar (utanför Flight-typen; mallen läser dem via flightKey)
    mission_cat: missionCat,
    multi_rotor: multi,
    single_rotor: single,
    fixed_wing: fixed,
    co_pilot_fpv: coFpv,
    dual,
    instructor: d.instructor || 0,
    vlos,
    bvlos,
  } as unknown as Flight;
}

export function buildDroneSpreads(droneFlights: DroneFlight[], config: LogbookConfig, dronesById?: Map<number, DroneMeta>): LogbookSpread[] {
  const template = getTemplate('sv-drone-logbook');
  // Kronologiskt (äldst först) som en pappersloggbok fylls uppifrån och ned.
  const sorted = [...droneFlights].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return buildBookSpreads(sorted.map((d) => droneToFlightRow(d, d.drone_id != null ? dronesById?.get(d.drone_id) : undefined)), template, config);
}

// Hjälpare för skärmen: bygg drone_id → {model, klass} ur registret.
export async function loadDroneMetaById(): Promise<Map<number, DroneMeta>> {
  const drones: DroneRegistryEntry[] = await listDrones();
  const map = new Map<number, DroneMeta>();
  for (const dr of drones) map.set(dr.id, { model: dr.model || dr.drone_type || '', klass: dr.drone_type || '' });
  return map;
}
