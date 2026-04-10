import { getDatabase } from './database';
import type { Flight, FlightFormData, FlightStats } from '../types/flight';
import { parseFlightTime } from '../utils/format';

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
      flight_rules, second_pilot, nvg, tng_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      flight_rules=?, second_pilot=?, nvg=?, tng_count=?,
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
    `SELECT aircraft_type FROM flights
     GROUP BY aircraft_type
     ORDER BY MAX(date) DESC LIMIT 10`
  );
  return rows.map((r) => r.aircraft_type);
}

export async function getRecentRegistrations(type?: string): Promise<string[]> {
  const db = await getDatabase();
  if (type) {
    const rows = await db.getAllAsync<{ registration: string }>(
      `SELECT registration FROM flights
       WHERE aircraft_type=?
       GROUP BY registration
       ORDER BY MAX(date) DESC`,
      [type]
    );
    return rows.map((r) => r.registration);
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

  const totals = await db.getFirstAsync<any>(`
    SELECT
      COUNT(*) as total_flights,
      ROUND(SUM(total_time), 1) as total_time,
      ROUND(SUM(pic), 1) as total_pic,
      ROUND(SUM(co_pilot), 1) as total_co_pilot,
      ROUND(SUM(dual), 1) as total_dual,
      ROUND(SUM(ifr), 1) as total_ifr,
      ROUND(SUM(night), 1) as total_night,
      SUM(landings_day) as total_landings_day,
      SUM(landings_night) as total_landings_night
    FROM flights
  `);

  const last90 = await db.getFirstAsync<{ hours: number }>(
    `SELECT ROUND(SUM(total_time), 1) as hours FROM flights
     WHERE date >= date('now', '-90 days')`
  );

  const last12m = await db.getFirstAsync<{ hours: number }>(
    `SELECT ROUND(SUM(total_time), 1) as hours FROM flights
     WHERE date >= date('now', '-12 months')`
  );

  return {
    total_flights: totals?.total_flights ?? 0,
    total_time: totals?.total_time ?? 0,
    total_pic: totals?.total_pic ?? 0,
    total_co_pilot: totals?.total_co_pilot ?? 0,
    total_dual: totals?.total_dual ?? 0,
    total_ifr: totals?.total_ifr ?? 0,
    total_night: totals?.total_night ?? 0,
    total_landings_day: totals?.total_landings_day ?? 0,
    total_landings_night: totals?.total_landings_night ?? 0,
    last_90_days: last90?.hours ?? 0,
    last_12_months: last12m?.hours ?? 0,
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
    `SELECT icao FROM (
       SELECT dep_place as icao, MAX(date) as last FROM flights WHERE length(dep_place)=4 GROUP BY dep_place
       UNION
       SELECT arr_place as icao, MAX(date) as last FROM flights WHERE length(arr_place)=4 GROUP BY arr_place
     ) ORDER BY last DESC`
  );
  return rows.map(r => r.icao);
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
