// Drönar-loggboksuppslag — ICKE-INVASIVT. Adapterar DroneFlight till den form
// (manned Flight) som loggboksmotorn läser, och återanvänder buildBookSpreads +
// drönar-mallen 'sv-drone-logbook'. Inga ändringar i själva motorn.

import type { Flight } from '../../types/flight';
import type { DroneFlight } from '../../db/drones';
import { buildBookSpreads, type LogbookConfig, type LogbookSpread } from './paginate';
import { getTemplate } from '../../constants/logbookTemplates';

// Mappar en drönar-flygning till de flightKeys drönar-mallen läser
// (date, aircraft_type, registration, dep_place, total_time, pic, ifr, night, remarks).
// Fält som saknas i mallen lämnas tomma; fri-text-kolumner (avstånd/höjd/batteri)
// har ingen flightKey och renderas tomma.
export function droneToFlightRow(d: DroneFlight): Flight {
  return {
    id: d.id,
    date: d.date,
    aircraft_type: d.drone_type || '',
    registration: d.registration || '',
    dep_place: d.location || '',
    dep_utc: '',
    arr_place: '',
    arr_utc: '',
    total_time: d.total_time || 0,
    pic: d.total_time || 0,           // drönare = en-operatörs-op → PIC = total
    ifr: 0,
    night: d.is_night ? (d.total_time || 0) : 0,
    remarks: d.remarks || '',
  } as unknown as Flight;
}

export function buildDroneSpreads(droneFlights: DroneFlight[], config: LogbookConfig): LogbookSpread[] {
  const template = getTemplate('sv-drone-logbook');
  // Kronologiskt (äldst först) som en pappersloggbok fylls uppifrån och ned.
  const sorted = [...droneFlights].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return buildBookSpreads(sorted.map(droneToFlightRow), template, config);
}
