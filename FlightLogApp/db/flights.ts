import { getDatabase } from './database';
import type { Flight, FlightFormData, FlightStats } from '../types/flight';
import { parseFlightTime } from '../utils/format';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── INSERT ──────────────────────────────────────────────────────────────────

export async function insertFlight(
  data: FlightFormData,
  opts?: { source?: 'manual' | 'ocr' | 'import'; originalData?: string }
): Promise<number> {
  const db = await getDatabase();
  const source = opts?.source ?? 'manual';
  const status = source === 'manual' ? 'manual' : 'scanned';

  const result = await db.runAsync(
    `INSERT INTO flights (
      date, aircraft_type, registration,
      dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual,
      landings_day, landings_night, remarks,
      status, source, original_data,
      flight_rules, second_pilot, nvg, tng_count, flight_type,
      multi_pilot, single_pilot, instructor
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.date,
      data.aircraft_type,
      data.registration,
      (data.dep_place ?? '').toUpperCase(),
      data.dep_utc ?? '',
      (data.arr_place ?? '').toUpperCase(),
      data.arr_utc ?? '',
      parseFlightTime(data.total_time),
      parseFlightTime(data.ifr),
      parseFlightTime(data.night),
      parseFlightTime(data.pic),
      parseFlightTime(data.co_pilot),
      parseFlightTime(data.dual),
      parseInt(data.landings_day) || 0,
      parseInt(data.landings_night) || 0,
      data.remarks ?? '',
      status,
      source,
      opts?.originalData ?? null,
      data.flight_rules ?? 'VFR',
      data.second_pilot ?? '',
      parseFloat(data.nvg ?? '0') || 0,
      parseInt(data.tng_count ?? '0') || 0,
      data.flight_type ?? 'normal',
      parseFlightTime(data.multi_pilot),
      parseFlightTime(data.single_pilot),
      parseFlightTime(data.instructor),
    ]
  );
  return result.lastInsertRowId;
}

// ─── UPDATE med audit trail ───────────────────────────────────────────────────

export async function updateFlight(
  id: number,
  data: FlightFormData,
  reason?: string
): Promise<void> {
  const db = await getDatabase();
  const existing = await getFlightById(id);
  if (!existing) return;

  // Logga varje ändrat fält
  const fields: (keyof FlightFormData)[] = [
    'date','aircraft_type','registration',
    'dep_place','dep_utc','arr_place','arr_utc',
    'total_time','ifr','night','pic','co_pilot','dual',
    'landings_day','landings_night','remarks',
    'multi_pilot','single_pilot','instructor',
  ];

  for (const field of fields) {
    const oldVal = String((existing as any)[field] ?? '');
    const newVal = String(data[field] ?? '');
    if (oldVal !== newVal) {
      await db.runAsync(
        `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason)
         VALUES (?,?,?,?,?)`,
        [id, field, oldVal, newVal, reason ?? null]
      );
    }
  }

  await db.runAsync(
    `UPDATE flights SET
      date=?, aircraft_type=?, registration=?,
      dep_place=?, dep_utc=?, arr_place=?, arr_utc=?,
      total_time=?, ifr=?, night=?, pic=?, co_pilot=?, dual=?,
      landings_day=?, landings_night=?, remarks=?,
      flight_rules=?, second_pilot=?, nvg=?, tng_count=?, flight_type=?,
      multi_pilot=?, single_pilot=?, instructor=?,
      status=CASE WHEN status='scanned' THEN 'verified' ELSE status END
    WHERE id=?`,
    [
      data.date, data.aircraft_type, data.registration,
      (data.dep_place ?? '').toUpperCase(), data.dep_utc ?? '',
      (data.arr_place ?? '').toUpperCase(), data.arr_utc ?? '',
      parseFlightTime(data.total_time),
      parseFlightTime(data.ifr),
      parseFlightTime(data.night),
      parseFlightTime(data.pic),
      parseFlightTime(data.co_pilot),
      parseFlightTime(data.dual),
      parseInt(data.landings_day) || 0,
      parseInt(data.landings_night) || 0,
      data.remarks ?? '',
      data.flight_rules ?? 'VFR',
      data.second_pilot ?? '',
      parseFloat(data.nvg ?? '0') || 0,
      parseInt(data.tng_count ?? '0') || 0,
      data.flight_type ?? 'normal',
      parseFlightTime(data.multi_pilot),
      parseFlightTime(data.single_pilot),
      parseFlightTime(data.instructor),
      id,
    ]
  );
}

export async function verifyFlight(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE flights SET status='verified' WHERE id=?`, [id]
  );
  await db.runAsync(
    `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason)
     VALUES (?, 'status', 'flagged', 'verified', 'Piloten markerade som granskad')`,
    [id]
  );
}

export async function deleteFlight(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM flights WHERE id=?', [id]);
}

export async function clearAllFlights(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM flights');
  await db.runAsync('DELETE FROM audit_log');
  await db.runAsync('DELETE FROM aircraft_registry');
}

// ─── READ ─────────────────────────────────────────────────────────────────────

export async function getFlights(limit = 100, offset = 0): Promise<Flight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<Flight>(
    'SELECT * FROM flights ORDER BY date DESC, dep_utc DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
}

export async function getFlightById(id: number): Promise<Flight | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<Flight>('SELECT * FROM flights WHERE id=?', [id]);
}

export async function getFlightCount(): Promise<number> {
  const db = await getDatabase();
  const r = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM flights');
  return r?.count ?? 0;
}

export async function getFlaggedFlights(): Promise<Flight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<Flight>(
    `SELECT * FROM flights WHERE status='flagged' ORDER BY date DESC`
  );
}

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

export async function getAuditLog(flightId: number) {
  const db = await getDatabase();
  return await db.getAllAsync(
    `SELECT * FROM audit_log WHERE flight_id=? ORDER BY changed_at DESC`,
    [flightId]
  );
}

export async function getAllAuditLog() {
  const db = await getDatabase();
  return await db.getAllAsync(
    `SELECT a.*, f.date, f.dep_place, f.arr_place
     FROM audit_log a
     LEFT JOIN flights f ON f.id = a.flight_id
     ORDER BY a.changed_at DESC
     LIMIT 500`
  );
}

// ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────────

export async function getRecentAircraftTypes(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ aircraft_type: string }>(
    `SELECT aircraft_type FROM (
       SELECT aircraft_type, MAX(date) as last FROM flights GROUP BY aircraft_type
       UNION
       SELECT aircraft_type, '0000-00-00' as last FROM aircraft_registry GROUP BY aircraft_type
     )
     GROUP BY aircraft_type
     ORDER BY MAX(last) DESC LIMIT 20`
  );
  return rows.map((r) => r.aircraft_type);
}

export async function getRecentRegistrations(type?: string): Promise<string[]> {
  const db = await getDatabase();
  if (type) {
    // Hämta individer från både flygningar och registret
    const rows = await db.getAllAsync<{ registration: string; last_date: string }>(
      `SELECT registration, MAX(last_date) as last_date FROM (
         SELECT registration, MAX(date) as last_date FROM flights
         WHERE aircraft_type=? AND registration != ''
         GROUP BY registration
         UNION ALL
         SELECT registration, '0000-00-00' as last_date FROM aircraft_registry
         WHERE aircraft_type=? AND registration != ''
       )
       GROUP BY registration`,
      [type, type]
    );
    if (!rows.length) return [];
    // Senast flugna individen pinnas först, resten sorteras numeriskt fallande
    const sorted = [...rows].sort((a, b) => b.last_date.localeCompare(a.last_date));
    const mostRecent = sorted[0].registration;
    const rest = rows
      .map((r) => r.registration)
      .filter((r) => r !== mostRecent)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
    return [mostRecent, ...rest];
  }
  const rows = await db.getAllAsync<{ registration: string }>(
    `SELECT registration FROM flights
     GROUP BY registration
     ORDER BY MAX(date) DESC`
  );
  return rows.map((r) => r.registration);
}

export async function getRecentPlaces(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ place: string }>(
    `SELECT place FROM (
       SELECT dep_place as place, MAX(date) as last FROM flights GROUP BY dep_place
       UNION
       SELECT arr_place as place, MAX(date) as last FROM flights GROUP BY arr_place
     ) ORDER BY last DESC LIMIT 20`
  );
  return rows.map((r) => r.place);
}

// ─── STATISTIK ────────────────────────────────────────────────────────────────

export async function getFlightStats(): Promise<FlightStats> {
  const db = await getDatabase();

  // is_ffs = explicit 'sim' ELLER pass som överstiger luftfartygets uthållighet.
  // 'hot_refuel' och 'summary' är undantagna från uthållighetskontrollen.
  // 'summary' = manuellt registrerad erfarenhetssammanfattning — ska aldrig klassas som FFS.
  const FFS_EXPR = `(
    f.flight_type = 'sim'
    OR (f.flight_type NOT IN ('hot_refuel', 'summary')
        AND ar.endurance_h > 0
        AND f.total_time > ar.endurance_h)
  )`;

  const totals = await db.getFirstAsync<any>(`
    SELECT
      COUNT(*) as total_flights,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.total_time END), 1) as total_time,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.pic END), 1) as total_pic,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.co_pilot END), 1) as total_co_pilot,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.dual END), 1) as total_dual,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.ifr END), 1) as total_ifr,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.night END), 1) as total_night,
      SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.landings_day END) as total_landings_day,
      SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.landings_night END) as total_landings_night,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN f.total_time ELSE 0 END), 1) as total_sim,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.multi_pilot END), 1) as total_multi_pilot,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.single_pilot END), 1) as total_single_pilot,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.instructor END), 1) as total_instructor
    FROM flights f
    LEFT JOIN (
      SELECT aircraft_type, MAX(endurance_h) as endurance_h
      FROM aircraft_registry GROUP BY aircraft_type
    ) ar ON ar.aircraft_type = f.aircraft_type
  `);

  const last90 = await db.getFirstAsync<{ hours: number }>(
    `SELECT ROUND(SUM(f.total_time), 1) as hours
     FROM flights f
     LEFT JOIN (
       SELECT aircraft_type, MAX(endurance_h) as endurance_h
       FROM aircraft_registry GROUP BY aircraft_type
     ) ar ON ar.aircraft_type = f.aircraft_type
     WHERE date >= date('now', '-90 days') AND NOT ${FFS_EXPR}`
  );

  const last12m = await db.getFirstAsync<{ hours: number }>(
    `SELECT ROUND(SUM(f.total_time), 1) as hours
     FROM flights f
     LEFT JOIN (
       SELECT aircraft_type, MAX(endurance_h) as endurance_h
       FROM aircraft_registry GROUP BY aircraft_type
     ) ar ON ar.aircraft_type = f.aircraft_type
     WHERE date >= date('now', '-12 months') AND NOT ${FFS_EXPR}`
  );

  // Vecka med mest flygtid — sim-pass exkluderas (explicit 'sim' + otaggade som överstiger uthållighet)
  const bestWeek = await db.getFirstAsync<{ hours: number; week_start: string; last_id: number }>(
    `SELECT
       ROUND(SUM(f.total_time), 1) as hours,
       date(f.date, 'weekday 1', '-7 days') as week_start,
       MAX(f.id) as last_id
     FROM flights f
     LEFT JOIN (
       SELECT aircraft_type, MAX(endurance_h) as endurance_h
       FROM aircraft_registry GROUP BY aircraft_type
     ) ar ON ar.aircraft_type = f.aircraft_type
     WHERE f.flight_type NOT IN ('sim', 'summary')
       AND (ar.endurance_h IS NULL OR ar.endurance_h = 0 OR f.total_time <= ar.endurance_h)
     GROUP BY week_start
     ORDER BY hours DESC
     LIMIT 1`
  );

  // Längsta cross country (dag med längsta totala distans i NM) — SQLite kan inte beräkna haversine,
  // så vi hämtar alla kandidatdagar med koordinater och räknar ut distansen i JS.
  const allXcLegs = await db.getAllAsync<{
    date: string; total_time: number; last_id: number;
    dep_place: string; arr_place: string;
    dep_lat: number; dep_lon: number; arr_lat: number; arr_lon: number;
  }>(
    `SELECT f.date, f.total_time, f.id as last_id,
            f.dep_place, f.arr_place,
            dep_ap.lat as dep_lat, dep_ap.lon as dep_lon,
            arr_ap.lat as arr_lat, arr_ap.lon as arr_lon
     FROM flights f
     INNER JOIN icao_airports dep_ap ON dep_ap.icao = f.dep_place AND dep_ap.lat IS NOT NULL AND dep_ap.lon IS NOT NULL
     INNER JOIN icao_airports arr_ap ON arr_ap.icao = f.arr_place AND arr_ap.lat IS NOT NULL AND arr_ap.lon IS NOT NULL
     LEFT JOIN (
       SELECT aircraft_type, MAX(endurance_h) as endurance_h
       FROM aircraft_registry GROUP BY aircraft_type
     ) ar ON ar.aircraft_type = f.aircraft_type
     WHERE f.dep_place != f.arr_place AND NOT ${FFS_EXPR}
     ORDER BY f.date ASC, f.dep_utc ASC, f.id ASC`
  );

  // Gruppera ben per datum och beräkna total distans (NM) per dag
  const dayMap = new Map<string, { totalTime: number; totalNm: number; lastId: number; firstDep: string; lastArr: string }>();
  for (const leg of allXcLegs) {
    const nm = haversineKm(leg.dep_lat, leg.dep_lon, leg.arr_lat, leg.arr_lon) / 1.852;
    const existing = dayMap.get(leg.date);
    if (existing) {
      existing.totalTime += leg.total_time;
      existing.totalNm += nm;
      existing.lastId = Math.max(existing.lastId, leg.last_id);
      existing.lastArr = leg.arr_place;
    } else {
      dayMap.set(leg.date, {
        totalTime: leg.total_time,
        totalNm: nm,
        lastId: leg.last_id,
        firstDep: leg.dep_place,
        lastArr: leg.arr_place,
      });
    }
  }

  // Välj dagen med störst total distans
  let xcFirstDep = '';
  let xcLastArr = '';
  let xcKm = 0;
  let longestDate = '';
  let longestDayTotal = 0;
  let longestLastId: number | null = null;

  for (const [date, day] of dayMap) {
    if (day.totalNm > xcKm) {
      xcKm = day.totalNm;
      longestDate = date;
      longestDayTotal = day.totalTime;
      longestLastId = day.lastId;
      xcFirstDep = day.firstDep;
      xcLastArr = day.lastArr;
    }
  }
  xcKm = Math.round(xcKm);

  // Skapa ett "longest"-objekt för nedanstående return-sats
  const longest = longestDate ? { date: longestDate, day_total: longestDayTotal, last_id: longestLastId } : null;

  // Formatera veckoetiketten "v.12 · 2024"
  let bestWeekLabel = '';
  if (bestWeek?.week_start) {
    const d = new Date(bestWeek.week_start);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
    bestWeekLabel = `v.${weekNum} · ${d.getFullYear()}`;
  }

  return {
    total_flights: totals?.total_flights ?? 0,
    total_time: totals?.total_time ?? 0,
    total_pic: totals?.total_pic ?? 0,
    total_co_pilot: totals?.total_co_pilot ?? 0,
    total_dual: totals?.total_dual ?? 0,
    total_ifr: totals?.total_ifr ?? 0,
    total_night: totals?.total_night ?? 0,
    total_sim: totals?.total_sim ?? 0,
    total_landings_day: totals?.total_landings_day ?? 0,
    total_landings_night: totals?.total_landings_night ?? 0,
    last_90_days: last90?.hours ?? 0,
    last_12_months: last12m?.hours ?? 0,
    best_week_hours: bestWeek?.hours ?? 0,
    best_week_label: bestWeekLabel,
    best_week_start: bestWeek?.week_start ?? '',
    best_week_last_flight_id: bestWeek?.last_id ?? null,
    longest_xc_hours: longest?.day_total ?? 0,
    longest_xc_km: xcKm,
    longest_xc_date: longest?.date ?? '',
    longest_xc_first_dep: xcFirstDep,
    longest_xc_last_arr: xcLastArr,
    longest_xc_id: longest?.last_id ?? null,
    total_multi_pilot: totals?.total_multi_pilot ?? 0,
    total_single_pilot: totals?.total_single_pilot ?? 0,
    total_instructor: totals?.total_instructor ?? 0,
  };
}

// ─── KARTA & GRAFER ───────────────────────────────────────────────────────────

export async function getMonthlyHours(): Promise<{ year: number; month: number; hours: number }[]> {
  const db = await getDatabase();
  return await db.getAllAsync<{ year: number; month: number; hours: number }>(
    `SELECT
       CAST(strftime('%Y', date) AS INTEGER) as year,
       CAST(strftime('%m', date) AS INTEGER) as month,
       ROUND(SUM(total_time), 1) as hours
     FROM flights
     WHERE date >= date('now', '-24 months')
     GROUP BY year, month
     ORDER BY year, month`
  );
}

export async function getVisitedAirportIcaos(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string }>(
    `SELECT places.icao FROM (
       SELECT dep_place as icao, MAX(date) as last FROM flights WHERE length(dep_place)=4 GROUP BY dep_place
       UNION
       SELECT arr_place as icao, MAX(date) as last FROM flights WHERE length(arr_place)=4 GROUP BY arr_place
     ) places
     LEFT JOIN icao_airports ia ON ia.icao = places.icao
     WHERE ia.icao IS NULL OR (ia.temporary IS NULL OR ia.temporary = 0)
     ORDER BY places.last DESC`
  );
  return rows.map(r => r.icao);
}

// ─── LUFTFARTYGSREGISTER ──────────────────────────────────────────────────────

export async function addToAircraftRegistry(type: string, registration: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO aircraft_registry (aircraft_type, registration) VALUES (?, ?)`,
    [type.toUpperCase(), registration.toUpperCase()]
  );
}

export async function addAircraftTypeToRegistry(
  type: string,
  cruiseSpeedKts = 0,
  enduranceH = 0,
  crewType = '',
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO aircraft_registry (aircraft_type, registration, cruise_speed_kts, endurance_h, crew_type)
     VALUES (?, '', ?, ?, ?)
     ON CONFLICT(aircraft_type, registration) DO UPDATE SET
       cruise_speed_kts=CASE WHEN excluded.cruise_speed_kts>0 THEN excluded.cruise_speed_kts ELSE cruise_speed_kts END,
       endurance_h=CASE WHEN excluded.endurance_h>0 THEN excluded.endurance_h ELSE endurance_h END,
       crew_type=CASE WHEN excluded.crew_type!='' THEN excluded.crew_type ELSE crew_type END`,
    [type.toUpperCase(), cruiseSpeedKts, enduranceH, crewType]
  );
}

export async function getAircraftCruiseSpeed(type: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ cruise_speed_kts: number }>(
    `SELECT MAX(cruise_speed_kts) as cruise_speed_kts FROM aircraft_registry WHERE aircraft_type=?`,
    [type.toUpperCase()]
  );
  return row?.cruise_speed_kts ?? 0;
}

export async function updateAircraftCruiseSpeed(type: string, speedKts: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE aircraft_registry SET cruise_speed_kts=? WHERE aircraft_type=?`,
    [speedKts, type.toUpperCase()]
  );
}

export async function updateAircraftEndurance(type: string, enduranceH: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE aircraft_registry SET endurance_h=? WHERE aircraft_type=?`,
    [enduranceH, type.toUpperCase()]
  );
}

export type AircraftRegistryEntry = {
  aircraft_type: string;
  cruise_speed_kts: number;
  endurance_h: number;
  crew_type: string;
  reg_count: number;
};

export async function getAllAircraftTypes(): Promise<AircraftRegistryEntry[]> {
  const db = await getDatabase();
  return await db.getAllAsync<AircraftRegistryEntry>(`
    SELECT aircraft_type,
           MAX(cruise_speed_kts) as cruise_speed_kts,
           MAX(endurance_h) as endurance_h,
           MAX(crew_type) as crew_type,
           COUNT(CASE WHEN registration != '' THEN 1 END) as reg_count
    FROM aircraft_registry
    GROUP BY aircraft_type
    ORDER BY aircraft_type
  `);
}

export async function updateAircraftType(
  type: string,
  speedKts: number,
  enduranceH: number,
  crewType: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE aircraft_registry SET cruise_speed_kts=?, endurance_h=?, crew_type=? WHERE aircraft_type=?`,
    [speedKts, enduranceH, crewType, type.toUpperCase()]
  );
}

export async function deleteAircraftType(type: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM aircraft_registry WHERE aircraft_type=?`, [type.toUpperCase()]);
}

export async function getAircraftTypesWithoutSpeed(): Promise<{ type: string; hasSpeed: boolean; hasEndurance: boolean }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ aircraft_type: string; cruise_speed_kts: number; endurance_h: number }>(
    `SELECT aircraft_type, MAX(cruise_speed_kts) as cruise_speed_kts, MAX(endurance_h) as endurance_h
     FROM aircraft_registry
     GROUP BY aircraft_type`
  );
  return rows
    .filter((r) => !r.cruise_speed_kts || !r.endurance_h)
    .map((r) => ({
      type: r.aircraft_type,
      hasSpeed: r.cruise_speed_kts > 0,
      hasEndurance: r.endurance_h > 0,
    }));
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, value]
  );
}

export async function getStressHours(): Promise<{ recent14: number; yearAvg14: number }> {
  const db = await getDatabase();
  const r14 = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 2) as h FROM flights WHERE date >= date('now', '-14 days')`
  );
  const rYear = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 2) as h FROM flights
     WHERE date >= date('now', '-379 days') AND date < date('now', '-14 days')
     AND strftime('%m', date) NOT IN ('07', '12')`
  );
  // ~365 days minus juli (31) + december (31) = ~303 giltiga dagar
  const avg14 = rYear?.h ? Math.round((rYear.h * 14 / 303) * 100) / 100 : 0;
  return { recent14: r14?.h ?? 0, yearAvg14: avg14 };
}

export async function getFlightsForWeek(weekStart: string): Promise<Flight[]> {
  const db = await getDatabase();
  // Exkludera: explicit sim-taggade flights, SAMT otaggade flights som överstiger fartygets uthållighet
  return await db.getAllAsync<Flight>(
    `SELECT f.* FROM flights f
     LEFT JOIN (
       SELECT aircraft_type, MAX(endurance_h) as endurance_h
       FROM aircraft_registry GROUP BY aircraft_type
     ) ar ON ar.aircraft_type = f.aircraft_type
     WHERE f.date >= ? AND f.date < date(?, '+7 days')
       AND f.flight_type != 'sim'
       AND (ar.endurance_h IS NULL OR ar.endurance_h = 0 OR f.total_time <= ar.endurance_h)
     ORDER BY f.date ASC, f.dep_utc ASC`,
    [weekStart, weekStart]
  );
}

export interface XCLeg {
  dep_place: string;
  arr_place: string;
  dep_utc: string;
  arr_utc: string;
  total_time: number;
  pic: number;
  co_pilot: number;
  aircraft_type: string;
  registration: string;
  second_pilot: string;
}

export async function getXCLegsForDate(date: string): Promise<XCLeg[]> {
  const db = await getDatabase();
  return await db.getAllAsync<XCLeg>(
    `SELECT f.dep_place, f.arr_place, f.dep_utc, f.arr_utc,
            f.total_time, f.pic, f.co_pilot, f.aircraft_type, f.registration, f.second_pilot
     FROM flights f
     INNER JOIN icao_airports dep_ap ON dep_ap.icao = f.dep_place AND dep_ap.lat IS NOT NULL AND dep_ap.lon IS NOT NULL
     INNER JOIN icao_airports arr_ap ON arr_ap.icao = f.arr_place AND arr_ap.lat IS NOT NULL AND arr_ap.lon IS NOT NULL
     WHERE f.date = ? AND f.dep_place != f.arr_place
     ORDER BY f.dep_utc ASC, f.id ASC`,
    [date]
  );
}

export async function searchFlights(query: string): Promise<Flight[]> {
  const db = await getDatabase();
  const q = `%${query.toUpperCase()}%`;
  return await db.getAllAsync<Flight>(
    `SELECT * FROM flights
     WHERE dep_place LIKE ? OR arr_place LIKE ?
        OR aircraft_type LIKE ? OR registration LIKE ?
        OR remarks LIKE ?
     ORDER BY date DESC LIMIT 50`,
    [q, q, q, `%${query}%`, `%${query}%`]
  );
}
