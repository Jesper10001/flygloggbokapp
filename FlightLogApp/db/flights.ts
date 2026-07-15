import { getDatabase } from './database';
import type { Flight, FlightFormData, FlightStats } from '../types/flight';
import { parseFlightTime } from '../utils/format';
import { getBackfill } from './backfill';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── INSERT ──────────────────────────────────────────────────────────────────

async function getEngineType(db: any, aircraftType: string): Promise<'se' | 'me' | ''> {
  const row = (await db.getFirstAsync(
    `SELECT engine_type FROM aircraft_registry WHERE aircraft_type=? AND engine_type != '' LIMIT 1`,
    [aircraftType.toUpperCase()]
  )) as { engine_type: string } | null;
  const et = row?.engine_type ?? '';
  return (et === 'se' || et === 'me') ? et : '';
}

export async function insertFlight(
  data: FlightFormData,
  opts?: { source?: 'manual' | 'ocr' | 'import'; originalData?: string }
): Promise<number> {
  const db = await getDatabase();
  const source = opts?.source ?? 'manual';
  const status = source === 'manual' ? 'manual' : 'scanned';

  const totalTime = parseFlightTime(data.total_time);
  const engineType = await getEngineType(db, data.aircraft_type);
  // Respektera explicita SE/ME från formuläret; annars härled ur typens motorklass.
  const explicitSe = parseFlightTime(data.se_time);
  const explicitMe = parseFlightTime(data.me_time);
  const hasExplicitSeMe = explicitSe > 0 || explicitMe > 0;
  const seTime = hasExplicitSeMe ? explicitSe : (engineType === 'se' ? totalTime : 0);
  const meTime = hasExplicitSeMe ? explicitMe : (engineType === 'me' ? totalTime : 0);

  const result = await db.runAsync(
    `INSERT INTO flights (
      date, aircraft_type, registration,
      dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual,
      landings_day, landings_night, remarks,
      status, source, original_data,
      flight_rules, second_pilot, second_pilot_role, extra_pilots, nvg, tng_count, flight_type,
      multi_pilot, single_pilot, instructor, picus,
      spic, examiner, safety_pilot, observer, ferry_pic, relief_crew, sim_category, vfr,
      se_time, me_time, stop_place, photo_uri, media_type, max_fl,
      takeoffs_day, takeoffs_night, app_2d, app_3d, pilot_flying,
      landings_fs_day, landings_fs_night, takeoffs_faa_night, landings_faa_night, landings_fs_faa_night, holds
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.date,
      data.aircraft_type,
      data.registration,
      (data.dep_place ?? '').toUpperCase(),
      data.dep_utc ?? '',
      (data.arr_place ?? '').toUpperCase(),
      data.arr_utc ?? '',
      totalTime,
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
      data.second_pilot_role ?? '',
      data.extra_pilots ?? '',
      parseFloat(data.nvg ?? '0') || 0,
      parseInt(data.tng_count ?? '0') || 0,
      data.flight_type ?? 'normal',
      parseFlightTime(data.multi_pilot),
      parseFlightTime(data.single_pilot),
      parseFlightTime(data.instructor),
      parseFlightTime(data.picus),
      parseFlightTime(data.spic),
      parseFlightTime(data.examiner),
      parseFlightTime(data.safety_pilot),
      parseFlightTime(data.observer),
      parseFlightTime(data.ferry_pic),
      parseFlightTime(data.relief_crew),
      data.sim_category ?? '',
      parseFlightTime(data.vfr),
      seTime,
      meTime,
      (data.stop_place ?? '').toUpperCase(),
      data.photo_uri ?? '',
      data.media_type ?? 'image',
      parseInt(data.max_fl ?? '0') || 0,
      parseInt(data.takeoffs_day ?? '0') || 0,
      parseInt(data.takeoffs_night ?? '0') || 0,
      parseInt(data.app_2d ?? '0') || 0,
      parseInt(data.app_3d ?? '0') || 0,
      parseFloat(data.pilot_flying ?? '0') || 0,
      parseInt(data.landings_fs_day ?? '0') || 0,
      parseInt(data.landings_fs_night ?? '0') || 0,
      parseInt(data.takeoffs_faa_night ?? '0') || 0,
      parseInt(data.landings_faa_night ?? '0') || 0,
      parseInt(data.landings_fs_faa_night ?? '0') || 0,
      parseInt(data.holds ?? '0') || 0,
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
    'takeoffs_day','takeoffs_night','app_2d','app_3d','pilot_flying',
    'landings_fs_day','landings_fs_night','takeoffs_faa_night','landings_faa_night','landings_fs_faa_night','holds',
    'multi_pilot','single_pilot','instructor','picus',
    'spic','examiner','safety_pilot','observer','ferry_pic','relief_crew','sim_category','vfr',
  ];

  const norm = (v: any) => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === '0' || s === '0.0' || s === '0.00') return '';
    return s;
  };

  for (const field of fields) {
    const oldVal = norm((existing as any)[field]);
    const newVal = norm(data[field]);
    if (oldVal !== newVal) {
      await db.runAsync(
        `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason)
         VALUES (?,?,?,?,?)`,
        [id, field, oldVal, newVal, reason ?? null]
      );
    }
  }

  const totalTime = parseFlightTime(data.total_time);
  const engineType = await getEngineType(db, data.aircraft_type);
  // Respektera explicita SE/ME från formuläret; annars härled ur typens motorklass.
  const explicitSe = parseFlightTime(data.se_time);
  const explicitMe = parseFlightTime(data.me_time);
  const hasExplicitSeMe = explicitSe > 0 || explicitMe > 0;
  const seTime = hasExplicitSeMe ? explicitSe : (engineType === 'se' ? totalTime : 0);
  const meTime = hasExplicitSeMe ? explicitMe : (engineType === 'me' ? totalTime : 0);

  await db.runAsync(
    `UPDATE flights SET
      date=?, aircraft_type=?, registration=?,
      dep_place=?, dep_utc=?, arr_place=?, arr_utc=?,
      total_time=?, ifr=?, night=?, pic=?, co_pilot=?, dual=?,
      landings_day=?, landings_night=?, remarks=?,
      flight_rules=?, second_pilot=?, second_pilot_role=?, extra_pilots=?, nvg=?, tng_count=?, flight_type=?,
      multi_pilot=?, single_pilot=?, instructor=?, picus=?,
      spic=?, examiner=?, safety_pilot=?, observer=?, ferry_pic=?, relief_crew=?, sim_category=?, vfr=?,
      se_time=?, me_time=?, stop_place=?, photo_uri=?, media_type=?, max_fl=?,
      takeoffs_day=?, takeoffs_night=?, app_2d=?, app_3d=?, pilot_flying=?,
      landings_fs_day=?, landings_fs_night=?, takeoffs_faa_night=?, landings_faa_night=?, landings_fs_faa_night=?, holds=?,
      status=CASE WHEN status IN ('scanned','flagged') THEN 'verified' ELSE status END
    WHERE id=?`,
    [
      data.date, data.aircraft_type, data.registration,
      (data.dep_place ?? '').toUpperCase(), data.dep_utc ?? '',
      (data.arr_place ?? '').toUpperCase(), data.arr_utc ?? '',
      totalTime,
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
      data.second_pilot_role ?? '',
      data.extra_pilots ?? '',
      parseFloat(data.nvg ?? '0') || 0,
      parseInt(data.tng_count ?? '0') || 0,
      data.flight_type ?? 'normal',
      parseFlightTime(data.multi_pilot),
      parseFlightTime(data.single_pilot),
      parseFlightTime(data.instructor),
      parseFlightTime(data.picus),
      parseFlightTime(data.spic),
      parseFlightTime(data.examiner),
      parseFlightTime(data.safety_pilot),
      parseFlightTime(data.observer),
      parseFlightTime(data.ferry_pic),
      parseFlightTime(data.relief_crew),
      data.sim_category ?? '',
      parseFlightTime(data.vfr),
      seTime,
      meTime,
      (data.stop_place ?? '').toUpperCase(),
      data.photo_uri ?? '',
      data.media_type ?? 'image',
      parseInt(data.max_fl ?? '0') || 0,
      parseInt(data.takeoffs_day ?? '0') || 0,
      parseInt(data.takeoffs_night ?? '0') || 0,
      parseInt(data.app_2d ?? '0') || 0,
      parseInt(data.app_3d ?? '0') || 0,
      parseFloat(data.pilot_flying ?? '0') || 0,
      parseInt(data.landings_fs_day ?? '0') || 0,
      parseInt(data.landings_fs_night ?? '0') || 0,
      parseInt(data.takeoffs_faa_night ?? '0') || 0,
      parseInt(data.landings_faa_night ?? '0') || 0,
      parseInt(data.landings_fs_faa_night ?? '0') || 0,
      parseInt(data.holds ?? '0') || 0,
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
     VALUES (?, 'status', 'flagged', 'verified', 'Pilot marked as reviewed')`,
    [id]
  );
}

export async function deleteFlight(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM flights WHERE id=?', [id]);
}

/** Radera flera flygningar (t.ex. en hel importbatch) i ett svep. */
export async function deleteFlights(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDatabase();
  const ph = ids.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM flights WHERE id IN (${ph})`, ids);
}

/** Koppla (eller ta bort) en fotobiblioteks-referens till en flygning. Endast referensen sparas.
 *  mediaType lagras också (image/video) så appen vet typen utan att resolva assetet. */
export async function setFlightPhotoLocalId(id: number, localId: string | null, mediaType?: 'image' | 'video'): Promise<void> {
  const db = await getDatabase();
  if (mediaType) await db.runAsync('UPDATE flights SET photo_local_id=?, media_type=? WHERE id=?', [localId, mediaType, id]);
  else await db.runAsync('UPDATE flights SET photo_local_id=? WHERE id=?', [localId, id]);
}

export async function clearAllFlights(): Promise<void> {
  const db = await getDatabase();
  // try/catch per sats: en saknad tabell får INTE avbryta innan böckerna (som bär
  // opening_balance/brought-forward) hinner raderas — annars "följer timmarna med".
  const run = async (sql: string) => { try { await db.runAsync(sql); } catch {} };
  await run('DELETE FROM flights');
  await run('DELETE FROM audit_log');
  await run('DELETE FROM aircraft_registry');
  await run('DELETE FROM icao_airports WHERE "temporary" > 0');
  await run('DELETE FROM ocr_learned');
  // Böcker + custom-mallar + sid-summeringar — helt ren slate (annars lever en gammal bok
  // med sin ingående balans/brought-forward kvar).
  await run('DELETE FROM logbook_books');       // både digitala (kind='digital') och pappersböcker
  await run('DELETE FROM custom_templates');    // användarskapade mallar
  await run('DELETE FROM scan_summaries');
  // Gamla digitala-bok-inställningar som annars seedar en ny bok med stale brought-forward.
  await run("DELETE FROM settings WHERE key IN ('dlb_opening_balance','dlb_template_id','dlb_start_page','dlb_custom_cols')");
}

// ─── READ ─────────────────────────────────────────────────────────────────────

export async function getFlights(limit = 100, offset = 0): Promise<Flight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<Flight>(
    'SELECT * FROM flights ORDER BY date DESC, dep_utc DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
}

export async function getFlightsWithPhotos(): Promise<Flight[]> {
  const db = await getDatabase();
  // Inkluderar både uppladdade bilder (photo_uri) och synkade referenser (photo_local_id).
  return await db.getAllAsync<Flight>(
    "SELECT * FROM flights WHERE photo_uri != '' OR (photo_local_id IS NOT NULL AND photo_local_id != '') ORDER BY date DESC, dep_utc DESC"
  );
}

export async function getFlightNumberOfYear(flightId: number, date: string): Promise<number> {
  const db = await getDatabase();
  const year = date.slice(0, 4);
  const row = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM flights WHERE date >= ? AND (date < ? OR (date = ? AND id <= ?)) AND flight_type != 'sim'`,
    [`${year}-01-01`, date, date, flightId]
  );
  return row?.cnt ?? 0;
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

export async function getManualFlightCount(): Promise<number> {
  const db = await getDatabase();
  const r = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM flights WHERE status='manual'");
  return r?.count ?? 0;
}

export async function getFlaggedFlights(): Promise<Flight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<Flight>(
    `SELECT * FROM flights WHERE status='flagged' ORDER BY date DESC`
  );
}

export async function flagFlightsByRegistration(reg: string): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE flights SET status='flagged' WHERE registration=? AND status != 'flagged'`,
    [reg.toUpperCase()]
  );
  return result.changes;
}

export async function flagFlightsBySecondPilot(name: string): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE flights SET status='flagged' WHERE second_pilot=? AND status != 'flagged'`,
    [name]
  );
  return result.changes;
}

export async function removeRegistrationFromFlights(reg: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE flights SET registration='' WHERE registration=?`, [reg.toUpperCase()]);
}

export async function removeSecondPilotFromFlights(name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE flights SET second_pilot='' WHERE second_pilot=?`, [name]);
}

export async function deleteRegistrationFromRegistry(reg: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM aircraft_registry WHERE registration=?`, [reg.toUpperCase()]);
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

/** Flygningar som har nattid men saknar NVG-tid — för NVG-hjälparfunktionen i loggboken */
export async function getNightFlightsMissingNvg(): Promise<Flight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<Flight>(
    `SELECT * FROM flights
     WHERE night > 0 AND (nvg IS NULL OR nvg = 0)
     ORDER BY date DESC, dep_utc DESC`
  );
}

export async function getDualFlightsMissingPilotTracking(): Promise<Flight[]> {
  const db = await getDatabase();
  // Get all flights that could be dual: no PIC, instructor, examiner, etc. and no sim, and no dual logged yet
  const candidates = await db.getAllAsync<Flight>(
    `SELECT * FROM flights
     WHERE (dual IS NULL OR dual = 0)
     AND (pic IS NULL OR pic = 0)
     AND (instructor IS NULL OR instructor = 0)
     AND (examiner IS NULL OR examiner = 0)
     AND (safety_pilot IS NULL OR safety_pilot = 0)
     AND (relief_crew IS NULL OR relief_crew = 0)
     AND (ferry_pic IS NULL OR ferry_pic = 0)
     AND (observer IS NULL OR observer = 0)
     AND (sim_category IS NULL OR sim_category = '')
     ORDER BY aircraft_type, date ASC`
  );

  // Filter to only include flights within first 150h for each aircraft
  const result: Flight[] = [];
  const aircraftHours: Record<string, number> = {};

  for (const flight of candidates) {
    const ac = flight.aircraft_type;
    const currentHours = aircraftHours[ac] || 0;

    if (currentHours < 150) {
      result.push(flight);
      aircraftHours[ac] = currentHours + (flight.total_time || 0);
    }
  }

  return result.reverse(); // Return newest first
}

export async function setFlightNvg(id: number, hours: number): Promise<void> {
  const db = await getDatabase();
  const existing = await getFlightById(id);
  if (!existing) return;

  const norm = (v: any) => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === '0' || s === '0.0' || s === '0.00') return '';
    return s;
  };

  const oldVal = norm(existing.nvg);
  const newVal = norm(hours);

  // Only log if value actually changed
  if (oldVal !== newVal) {
    await db.runAsync(
      `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason)
       VALUES (?,?,?,?,?)`,
      [id, 'nvg', oldVal, newVal, 'Added via NVG modal']
    );
  }

  await db.runAsync('UPDATE flights SET nvg=? WHERE id=?', [hours, id]);
}

export async function setFlightDual(id: number, hours: number): Promise<void> {
  const db = await getDatabase();
  const existing = await getFlightById(id);
  if (!existing) return;

  const norm = (v: any) => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === '0' || s === '0.0' || s === '0.00') return '';
    return s;
  };

  const oldVal = norm(existing.dual);
  const newVal = norm(hours);

  // Only log if value actually changed
  if (oldVal !== newVal) {
    await db.runAsync(
      `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason)
       VALUES (?,?,?,?,?)`,
      [id, 'dual', oldVal, newVal, 'Added via DUAL modal']
    );
  }

  await db.runAsync('UPDATE flights SET dual=? WHERE id=?', [hours, id]);
}

export async function getInstructorFlightsMissingTracking(startDate: string, endDate: string): Promise<Flight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<Flight>(
    `SELECT * FROM flights
     WHERE (instructor IS NULL OR instructor = 0)
     AND pic > 0
     AND date >= ? AND date <= ?
     ORDER BY date DESC, dep_utc DESC`,
    [startDate, endDate]
  );
}

export async function setFlightInstructor(id: number, hours: number): Promise<void> {
  const db = await getDatabase();
  const existing = await getFlightById(id);
  if (!existing) return;

  const norm = (v: any) => {
    if (v === null || v === undefined || v === '') return '';
    const s = String(v);
    if (s === '0' || s === '0.0' || s === '0.00') return '';
    return s;
  };

  const oldVal = norm(existing.instructor);
  const newVal = norm(hours);

  // Only log if value actually changed
  if (oldVal !== newVal) {
    await db.runAsync(
      `INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason)
       VALUES (?,?,?,?,?)`,
      [id, 'instructor', oldVal, newVal, 'Added via INSTRUCTOR modal']
    );
  }

  await db.runAsync('UPDATE flights SET instructor=? WHERE id=?', [hours, id]);
}

export async function getRecentSecondPilots(limit = 10): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ second_pilot: string }>(
    `SELECT second_pilot FROM flights
     WHERE second_pilot != '' AND second_pilot IS NOT NULL
     GROUP BY second_pilot
     ORDER BY MAX(date) DESC LIMIT ?`,
    [limit]
  );
  return rows.map(r => r.second_pilot);
}

// Sparade andra-piloter med den roll de senast flögs med (för auto-ifyllnad av roll).
export async function getRecentSecondPilotsWithRole(limit = 20): Promise<{ name: string; role: string }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ second_pilot: string; second_pilot_role: string; d: string }>(
    `SELECT second_pilot, second_pilot_role, MAX(date) as d FROM flights
     WHERE second_pilot != '' AND second_pilot IS NOT NULL
     GROUP BY second_pilot
     ORDER BY d DESC LIMIT ?`,
    [limit]
  );
  return rows.map(r => ({ name: r.second_pilot, role: r.second_pilot_role || '' }));
}

// Andra-piloter grupperade per flygfarkosttyp (aircraft_type) — distinkta namn per typ,
// ordnade efter senaste flygning. Farkosterna ordnas med senast använd först.
export async function getSecondPilotsByAircraft(): Promise<{ aircraft: string; pilots: string[]; isHeli: boolean }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ aircraft_type: string; second_pilot: string; d: string; category: string }>(
    `SELECT f.aircraft_type, f.second_pilot, MAX(f.date) as d, MAX(ar.category) as category
     FROM flights f
     LEFT JOIN aircraft_registry ar ON ar.aircraft_type = f.aircraft_type
     WHERE f.second_pilot != '' AND f.second_pilot IS NOT NULL
       AND f.aircraft_type != '' AND f.aircraft_type IS NOT NULL
     GROUP BY f.aircraft_type, f.second_pilot
     ORDER BY d DESC`,
  );
  const map = new Map<string, { pilots: string[]; d: string; category: string }>();
  for (const r of rows) {
    let e = map.get(r.aircraft_type);
    if (!e) { e = { pilots: [], d: r.d, category: r.category || '' }; map.set(r.aircraft_type, e); }
    if (!e.pilots.includes(r.second_pilot)) e.pilots.push(r.second_pilot);
    if (r.d > e.d) e.d = r.d;
    if (!e.category && r.category) e.category = r.category;
  }
  return [...map.entries()]
    .sort((a, b) => (a[1].d < b[1].d ? 1 : -1))
    .map(([aircraft, v]) => ({ aircraft, pilots: v.pilots, isHeli: v.category === 'helicopter' }));
}

export async function getRecentRemarks(limit = 20): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ remarks: string }>(
    `SELECT remarks FROM flights
     WHERE remarks != ''
     GROUP BY remarks
     ORDER BY MAX(date) DESC LIMIT ?`,
    [limit]
  );
  return rows.map(r => r.remarks);
}

export async function getRecentPlaces(): Promise<{ icao: string; temporary: boolean }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string; last: string }>(
    `SELECT icao, MAX(last) as last FROM (
       SELECT dep_place as icao, date as last FROM flights
       UNION ALL
       SELECT arr_place as icao, date as last FROM flights
     )
     WHERE icao IS NOT NULL AND icao != ''
     GROUP BY icao
     ORDER BY last DESC LIMIT 20`
  );
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const tempRows = await db.getAllAsync<{ icao: string; temporary: number }>(
    `SELECT icao, temporary FROM icao_airports WHERE icao IN (${placeholders})`,
    rows.map((r) => r.icao)
  );
  const tempMap = new Map(tempRows.map((r) => [r.icao, r.temporary === 1]));
  return rows.map((r) => ({ icao: r.icao, temporary: tempMap.get(r.icao) ?? false }));
}

export async function getRecentDepartures(): Promise<{ icao: string; temporary: boolean }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string; last: string }>(
    `SELECT dep_place as icao, MAX(date) as last FROM flights
     WHERE dep_place IS NOT NULL AND dep_place != ''
     GROUP BY dep_place
     ORDER BY last DESC LIMIT 20`
  );
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const tempRows = await db.getAllAsync<{ icao: string; temporary: number }>(
    `SELECT icao, temporary FROM icao_airports WHERE icao IN (${placeholders})`,
    rows.map((r) => r.icao)
  );
  const tempMap = new Map(tempRows.map((r) => [r.icao, r.temporary === 1]));
  return rows.map((r) => ({ icao: r.icao, temporary: tempMap.get(r.icao) ?? false }));
}

export async function getRecentArrivals(): Promise<{ icao: string; temporary: boolean }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string; last: string }>(
    `SELECT arr_place as icao, MAX(date) as last FROM flights
     WHERE arr_place IS NOT NULL AND arr_place != ''
     GROUP BY arr_place
     ORDER BY last DESC LIMIT 20`
  );
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const tempRows = await db.getAllAsync<{ icao: string; temporary: number }>(
    `SELECT icao, temporary FROM icao_airports WHERE icao IN (${placeholders})`,
    rows.map((r) => r.icao)
  );
  const tempMap = new Map(tempRows.map((r) => [r.icao, r.temporary === 1]));
  return rows.map((r) => ({ icao: r.icao, temporary: tempMap.get(r.icao) ?? false }));
}

// ─── STATISTIK ────────────────────────────────────────────────────────────────

export async function getFlightStats(): Promise<FlightStats> {
  const db = await getDatabase();
  // Backfill-justering laddas FÖRST (triggar migrering av ev. gamla dolda [BACKFILL]-flygningar
  // → borttagna) så SUM-frågorna nedan inte råkar räkna dem + justeringen (dubbelräkning).
  const bf = await getBackfill();

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
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.vfr END), 1) as total_vfr,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.night END), 1) as total_night,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.nvg END), 1) as total_nvg,
      SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.landings_day END) as total_landings_day,
      SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.landings_night END) as total_landings_night,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN f.total_time ELSE 0 END), 1) as total_sim,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.multi_pilot END), 1) as total_multi_pilot,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.single_pilot END), 1) as total_single_pilot,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.instructor END), 1) as total_instructor,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.picus END), 1) as total_picus,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.spic END), 1) as total_spic,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.ferry_pic END), 1) as total_ferry_pic,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.observer END), 1) as total_observer,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.relief_crew END), 1) as total_relief_crew,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.examiner END), 1) as total_examiner,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.safety_pilot END), 1) as total_safety_pilot,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.se_time END), 1) as total_se,
      ROUND(SUM(CASE WHEN ${FFS_EXPR} THEN 0 ELSE f.me_time END), 1) as total_me
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

  const ytd = await db.getFirstAsync<{ hours: number }>(
    `SELECT ROUND(SUM(f.total_time), 1) as hours
     FROM flights f
     WHERE strftime('%Y', date) = strftime('%Y', 'now') AND f.flight_type != 'sim'`
  );

  // Vecka med mest flygtid — sim-pass exkluderas (explicit 'sim' + otaggade som överstiger uthållighet)
  const bestWeek = await db.getFirstAsync<{ hours: number; week_start: string; last_id: number }>(
    `SELECT
       ROUND(SUM(f.total_time), 1) as hours,
       date(f.date, 'weekday 1', '-7 days') as week_start,
       MAX(f.id) as last_id
     FROM flights f
     WHERE f.flight_type NOT IN ('sim', 'summary')
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
    dep_utc: string; arr_utc: string;
  }>(
    `SELECT f.date, f.total_time, f.id as last_id,
            f.dep_place, f.arr_place, f.dep_utc, f.arr_utc,
            dep_ap.lat as dep_lat, dep_ap.lon as dep_lon,
            arr_ap.lat as arr_lat, arr_ap.lon as arr_lon
     FROM flights f
     INNER JOIN icao_airports dep_ap ON dep_ap.icao = f.dep_place AND dep_ap.lat IS NOT NULL AND dep_ap.lon IS NOT NULL AND (dep_ap.temporary IS NULL OR dep_ap.temporary = 0)
     INNER JOIN icao_airports arr_ap ON arr_ap.icao = f.arr_place AND arr_ap.lat IS NOT NULL AND arr_ap.lon IS NOT NULL AND (arr_ap.temporary IS NULL OR arr_ap.temporary = 0)
     LEFT JOIN (
       SELECT aircraft_type, MAX(endurance_h) as endurance_h
       FROM aircraft_registry GROUP BY aircraft_type
     ) ar ON ar.aircraft_type = f.aircraft_type
     WHERE f.dep_place != f.arr_place AND NOT ${FFS_EXPR}
     ORDER BY f.date ASC, f.dep_utc ASC, f.id ASC`
  );

  // Gruppera ben per datum och beräkna total distans (NM) per dag
  const dayMap = new Map<string, { totalTime: number; totalNm: number; lastId: number; firstDep: string; lastArr: string; firstDepUtc: string; lastArrUtc: string }>();
  for (const leg of allXcLegs) {
    const nm = haversineKm(leg.dep_lat, leg.dep_lon, leg.arr_lat, leg.arr_lon) / 1.852;
    const existing = dayMap.get(leg.date);
    if (existing) {
      existing.totalTime += leg.total_time;
      existing.totalNm += nm;
      existing.lastId = Math.max(existing.lastId, leg.last_id);
      existing.lastArr = leg.arr_place;
      existing.lastArrUtc = leg.arr_utc;
    } else {
      dayMap.set(leg.date, {
        totalTime: leg.total_time,
        totalNm: nm,
        lastId: leg.last_id,
        firstDep: leg.dep_place,
        lastArr: leg.arr_place,
        firstDepUtc: leg.dep_utc,
        lastArrUtc: leg.arr_utc,
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

  // Sök efter anslutande flygningar inom 3 timmar före eller efter längsta dagen
  if (longestDate && dayMap.has(longestDate)) {
    const longestDay = dayMap.get(longestDate)!;

    // Konvertera UTC-tid till minuter för enklare jämförelse
    const parseTime = (timeStr: string): number => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    const firstDepMin = parseTime(longestDay.firstDepUtc);
    const lastArrMin = parseTime(longestDay.lastArrUtc);
    const THREE_HOURS_MIN = 180;

    // Lägg till flygningar från dagen före som landar nära första flygningen
    const prevDate = new Date(longestDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    if (dayMap.has(prevDateStr)) {
      const prevDay = dayMap.get(prevDateStr)!;
      const prevArrMin = parseTime(prevDay.lastArrUtc);
      // Om landning dagen innan var inom 3 timmar före första flygningen nästa dag
      const timeUntilNext = firstDepMin + 1440 - prevArrMin; // 1440 = minuter per dag
      if (timeUntilNext >= 0 && timeUntilNext <= THREE_HOURS_MIN) {
        xcKm += prevDay.totalNm;
        longestDayTotal += prevDay.totalTime;
        xcFirstDep = prevDay.firstDep; // Börja från dagen innan
      }
    }

    // Lägg till flygningar från dagen efter som startar nära sista flygningen
    const nextDate = new Date(longestDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().split('T')[0];

    if (dayMap.has(nextDateStr)) {
      const nextDay = dayMap.get(nextDateStr)!;
      const nextDepMin = parseTime(nextDay.firstDepUtc);
      // Om start dagen efter var inom 3 timmar efter landing samma dag
      const timeAfterLanding = nextDepMin + 1440 - lastArrMin; // 1440 = minuter per dag
      if (timeAfterLanding >= 0 && timeAfterLanding <= THREE_HOURS_MIN) {
        xcKm += nextDay.totalNm;
        longestDayTotal += nextDay.totalTime;
        xcLastArr = nextDay.lastArr; // Sluta på dagen efter
      }
    }
  }

  xcKm = Math.round(xcKm);

  // Skapa ett "longest"-objekt för nedanstående return-sats
  const longest = longestDate ? { date: longestDate, day_total: longestDayTotal, last_id: longestLastId } : null;
  // day_total kan innehålla anslutande flygningar, därför uppdaterar vi det

  // Formatera veckoetiketten "W12 · 2024"
  let bestWeekLabel = '';
  if (bestWeek?.week_start) {
    const d = new Date(bestWeek.week_start);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
    bestWeekLabel = `W${weekNum} · ${d.getFullYear()}`;
  }

  return {
    total_flights: totals?.total_flights ?? 0,
    total_time: totals?.total_time ?? 0,
    total_pic: (totals?.total_pic ?? 0) + bf.pic,
    total_co_pilot: (totals?.total_co_pilot ?? 0) + bf.co_pilot,
    total_dual: (totals?.total_dual ?? 0) + bf.dual,
    total_ifr: (totals?.total_ifr ?? 0) + bf.ifr,
    total_vfr: totals?.total_vfr ?? 0,
    total_night: (totals?.total_night ?? 0) + bf.night,
    total_nvg: totals?.total_nvg ?? 0,
    total_sim: (totals?.total_sim ?? 0) + bf.sim,
    total_landings_day: (totals?.total_landings_day ?? 0) + Math.round(bf.landings_day),
    total_landings_night: (totals?.total_landings_night ?? 0) + Math.round(bf.landings_night),
    last_90_days: last90?.hours ?? 0,
    last_12_months: last12m?.hours ?? 0,
    year_to_date: ytd?.hours ?? 0,
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
    total_multi_pilot: (totals?.total_multi_pilot ?? 0) + bf.multi_pilot,
    total_single_pilot: totals?.total_single_pilot ?? 0,
    total_instructor: (totals?.total_instructor ?? 0) + bf.instructor,
    total_picus: (totals?.total_picus ?? 0) + bf.picus,
    total_spic: totals?.total_spic ?? 0,
    total_ferry_pic: totals?.total_ferry_pic ?? 0,
    total_observer: totals?.total_observer ?? 0,
    total_relief_crew: totals?.total_relief_crew ?? 0,
    total_examiner: totals?.total_examiner ?? 0,
    total_safety_pilot: totals?.total_safety_pilot ?? 0,
    total_se: totals?.total_se ?? 0,
    total_me: totals?.total_me ?? 0,
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
       SELECT dep_place as icao, MAX(date) as last FROM flights
         WHERE length(dep_place)=4 AND flight_type != 'sim' GROUP BY dep_place
       UNION
       SELECT arr_place as icao, MAX(date) as last FROM flights
         WHERE length(arr_place)=4 AND flight_type != 'sim' GROUP BY arr_place
       UNION
       SELECT stop_place as icao, MAX(date) as last FROM flights
         WHERE length(stop_place)=4 AND flight_type != 'sim' GROUP BY stop_place
     ) places
     LEFT JOIN icao_airports ia ON ia.icao = places.icao
     WHERE ia.icao IS NULL OR (ia.temporary IS NULL OR ia.temporary = 0)
     ORDER BY places.last DESC`
  );
  return rows.map(r => r.icao);
}

// Antal landningar per flygplats (ankomst + mellanlandning, ej sim).
export async function getAirportLandingCounts(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string; n: number }>(
    `SELECT icao, COUNT(*) as n FROM (
       SELECT arr_place as icao FROM flights WHERE length(arr_place)=4 AND flight_type != 'sim'
       UNION ALL
       SELECT stop_place as icao FROM flights WHERE length(stop_place)=4 AND flight_type != 'sim'
     ) GROUP BY icao`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.icao] = r.n;
  return out;
}

// Senaste flygningen per flygplats (id + datum + registrering) — för länk till loggboken.
// Samma plats-union som getVisitedAirportDates (dep/arr/stop) så datumet matchar "senast besökt".
export async function getAirportLastFlight(): Promise<Record<string, { id: number; date: string; reg: string }>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string; id: number; date: string; registration: string }>(
    `WITH places AS (
       SELECT id, date, registration, dep_place as icao FROM flights WHERE length(dep_place)=4 AND flight_type != 'sim'
       UNION ALL
       SELECT id, date, registration, arr_place as icao FROM flights WHERE length(arr_place)=4 AND flight_type != 'sim'
       UNION ALL
       SELECT id, date, registration, stop_place as icao FROM flights WHERE length(stop_place)=4 AND flight_type != 'sim'
     )
     SELECT icao, id, date, registration, MAX(date) FROM places GROUP BY icao`,
  );
  const out: Record<string, { id: number; date: string; reg: string }> = {};
  for (const r of rows) out[r.icao] = { id: r.id, date: r.date, reg: r.registration };
  return out;
}

export async function getVisitedAirportDates(): Promise<Record<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ icao: string; last: string }>(
    `SELECT places.icao, places.last FROM (
       SELECT dep_place as icao, MAX(date) as last FROM flights
         WHERE length(dep_place)=4 AND flight_type != 'sim' GROUP BY dep_place
       UNION
       SELECT arr_place as icao, MAX(date) as last FROM flights
         WHERE length(arr_place)=4 AND flight_type != 'sim' GROUP BY arr_place
       UNION
       SELECT stop_place as icao, MAX(date) as last FROM flights
         WHERE length(stop_place)=4 AND flight_type != 'sim' GROUP BY stop_place
     ) places
     LEFT JOIN icao_airports ia ON ia.icao = places.icao
     WHERE ia.icao IS NULL OR (ia.temporary IS NULL OR ia.temporary = 0)`
  );
  const result: Record<string, string> = {};
  rows.forEach(r => {
    result[r.icao] = r.last;
  });
  return result;
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
  category = '',
  engineType = '',
  imageUrl = '',
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO aircraft_registry (aircraft_type, registration, cruise_speed_kts, endurance_h, crew_type, category, engine_type, image_url)
     VALUES (?, '', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(aircraft_type, registration) DO UPDATE SET
       cruise_speed_kts=CASE WHEN excluded.cruise_speed_kts>0 THEN excluded.cruise_speed_kts ELSE cruise_speed_kts END,
       endurance_h=CASE WHEN excluded.endurance_h>0 THEN excluded.endurance_h ELSE endurance_h END,
       crew_type=CASE WHEN excluded.crew_type!='' THEN excluded.crew_type ELSE crew_type END,
       category=CASE WHEN excluded.category!='' THEN excluded.category ELSE category END,
       engine_type=CASE WHEN excluded.engine_type!='' THEN excluded.engine_type ELSE engine_type END,
       image_url=CASE WHEN excluded.image_url!='' THEN excluded.image_url ELSE image_url END`,
    [type.toUpperCase(), cruiseSpeedKts, enduranceH, crewType, category, engineType, imageUrl]
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

export async function getAircraftCrewType(type: string): Promise<string> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ crew_type: string }>(
    `SELECT crew_type FROM aircraft_registry WHERE aircraft_type=?`,
    [type.toUpperCase()]
  );
  return row?.crew_type ?? '';
}

// Farkostkategori ('' | 'airplane' | 'helicopter') som angavs när farkosten lades till.
export async function getAircraftCategory(type: string): Promise<string> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ category: string }>(
    `SELECT MAX(category) as category FROM aircraft_registry WHERE aircraft_type=?`,
    [type.toUpperCase()]
  );
  return row?.category ?? '';
}

export async function getAircraftEndurance(type: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ endurance_h: number }>(
    `SELECT MAX(endurance_h) as endurance_h FROM aircraft_registry WHERE aircraft_type=?`,
    [type.toUpperCase()]
  );
  return row?.endurance_h ?? 0;
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
  category: string;
  engine_type: string;
  image_url: string;
  reg_count: number;
  total_hours: number;
  top_registration: string;
  top_registration_hours: number;
  flight_count: number;
  // Fleet-vy (pilot-manned)
  maker: string;
  vne: number;
  vne_unit: string;
  mtow: number;
  mtow_unit: string;
  fuel_burn: number;
  fuel_burn_unit: string;
  power_hp: number;
  ceiling_ft: number;
  wingspan_m: number;
  empty_weight_kg: number;
  fuel_capacity_l: number;
  range_nm: number;
  cutout_url: string; // cachad VisionKit-urklippsbild (transparent bakgrund)
  rating_expiry: string; // '' eller ISO YYYY-MM-DD
  rating_class: string;
  last_flown: string; // MAX(f.date) eller '' (aldrig flugen)
};

export async function getAllAircraftTypes(): Promise<AircraftRegistryEntry[]> {
  const db = await getDatabase();
  return await db.getAllAsync<AircraftRegistryEntry>(`
    SELECT ar.aircraft_type,
           MAX(ar.cruise_speed_kts) as cruise_speed_kts,
           MAX(ar.endurance_h) as endurance_h,
           MAX(ar.crew_type) as crew_type,
           MAX(ar.category) as category,
           MAX(ar.engine_type) as engine_type,
           MAX(ar.image_url) as image_url,
           MAX(ar.maker) as maker,
           MAX(ar.vne) as vne,
           MAX(ar.vne_unit) as vne_unit,
           MAX(ar.mtow) as mtow,
           MAX(ar.mtow_unit) as mtow_unit,
           MAX(ar.fuel_burn) as fuel_burn,
           MAX(ar.fuel_burn_unit) as fuel_burn_unit,
           MAX(ar.power_hp) as power_hp,
           MAX(ar.ceiling_ft) as ceiling_ft,
           MAX(ar.wingspan_m) as wingspan_m,
           MAX(ar.empty_weight_kg) as empty_weight_kg,
           MAX(ar.fuel_capacity_l) as fuel_capacity_l,
           MAX(ar.range_nm) as range_nm,
           MAX(ar.cutout_url) as cutout_url,
           MAX(ar.rating_expiry) as rating_expiry,
           MAX(ar.rating_class) as rating_class,
           COALESCE(MAX(f.date), '') as last_flown,
           COUNT(CASE WHEN ar.registration != '' THEN 1 END) as reg_count,
           COALESCE(ROUND(SUM(f.total_time), 1), 0) as total_hours,
           COUNT(f.id) as flight_count,
           (
             SELECT f2.registration
             FROM flights f2
             WHERE f2.aircraft_type = ar.aircraft_type
               AND f2.registration != ''
               AND f2.flight_type != 'sim'
             GROUP BY f2.registration
             ORDER BY SUM(f2.total_time) DESC
             LIMIT 1
           ) as top_registration,
           (
             SELECT ROUND(SUM(f2.total_time), 1)
             FROM flights f2
             WHERE f2.aircraft_type = ar.aircraft_type
               AND f2.registration != ''
               AND f2.flight_type != 'sim'
             GROUP BY f2.registration
             ORDER BY SUM(f2.total_time) DESC
             LIMIT 1
           ) as top_registration_hours
    FROM aircraft_registry ar
    LEFT JOIN flights f ON f.aircraft_type = ar.aircraft_type AND f.flight_type != 'sim'
    GROUP BY ar.aircraft_type
    ORDER BY total_hours DESC
  `);
}

export async function updateAircraftType(
  type: string,
  speedKts: number,
  enduranceH: number,
  crewType: string,
  category = '',
  engineType = '',
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE aircraft_registry SET cruise_speed_kts=?, endurance_h=?, crew_type=?, category=?, engine_type=? WHERE aircraft_type=?`,
    [speedKts, enduranceH, crewType, category, engineType, type.toUpperCase()]
  );
}

export async function deleteAircraftType(type: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM aircraft_registry WHERE aircraft_type=?`, [type.toUpperCase()]);
}

// Fleet-vy: timmar per registrering för en modell (nyast flugen först). Exkl. sim.
export async function getRegistrationHours(
  type: string,
): Promise<{ registration: string; hours: number; last_flown: string }[]> {
  const db = await getDatabase();
  return await db.getAllAsync<{ registration: string; hours: number; last_flown: string }>(
    `SELECT registration,
            ROUND(SUM(total_time), 1) as hours,
            MAX(date) as last_flown
     FROM flights
     WHERE aircraft_type=? AND registration != '' AND flight_type != 'sim'
     GROUP BY registration
     ORDER BY hours DESC, last_flown DESC`,
    [type.toUpperCase()],
  );
}

// Fleet-vy: uppdaterar modell-nivå-fält (tillverkare, VNE, MTOW, cruise, endurance, typ-rating).
// Skriver alla rader för typen (WHERE aircraft_type=?). Dynamisk SET, bara angivna fält.
export async function updateAircraftFleetFields(
  type: string,
  fields: Partial<{
    maker: string;
    vne: number;
    vne_unit: string;
    cruise_speed_kts: number;
    endurance_h: number;
    mtow: number;
    mtow_unit: string;
    fuel_burn: number;
    fuel_burn_unit: string;
    power_hp: number;
    ceiling_ft: number;
    wingspan_m: number;
    empty_weight_kg: number;
    fuel_capacity_l: number;
    range_nm: number;
    image_url: string;
    cutout_url: string;
    rating_expiry: string;
    rating_class: string;
    category: string;
    engine_type: string;
    crew_type: string;
  }>,
): Promise<void> {
  const allowed = ['maker', 'vne', 'vne_unit', 'cruise_speed_kts', 'endurance_h', 'mtow', 'mtow_unit', 'fuel_burn', 'fuel_burn_unit', 'power_hp', 'ceiling_ft', 'wingspan_m', 'empty_weight_kg', 'fuel_capacity_l', 'range_nm', 'image_url', 'cutout_url', 'rating_expiry', 'rating_class', 'category', 'engine_type', 'crew_type'] as const;
  const keys = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => allowed.includes(k as any));
  if (keys.length === 0) return;
  const db = await getDatabase();
  const setClause = keys.map((k) => `${k}=?`).join(', ');
  const values = keys.map((k) => fields[k] as string | number);
  await db.runAsync(
    `UPDATE aircraft_registry SET ${setClause} WHERE aircraft_type=?`,
    [...values, type.toUpperCase()],
  );
}

// Spara AI-uppslagets Fleet-fält (tillverkare/VNE/MTOW) TYST på en typ — endast för
// Fleet-korten, syns inte i pilotens ordinarie fält. Skriver bara icke-tomma värden.
export async function persistAircraftFleetLookup(
  type: string,
  r: {
    manufacturer?: string; vne_kt?: number; mtow_kg?: number;
    consumption?: number; consumption_unit?: string; horsepower_hp?: number;
    ceiling_ft?: number; wingspan_m?: number; image_url?: string;
    empty_weight_kg?: number; fuel_capacity_l?: number; range_nm?: number;
    cruise_speed_kts?: number; endurance_h?: number; category?: string; engine_type?: string; crew_type?: string;
  },
): Promise<void> {
  const fields: Partial<{
    maker: string; vne: number; mtow: number;
    fuel_burn: number; fuel_burn_unit: string; power_hp: number; ceiling_ft: number; wingspan_m: number; image_url: string;
    empty_weight_kg: number; fuel_capacity_l: number; range_nm: number;
    cruise_speed_kts: number; endurance_h: number; category: string; engine_type: string; crew_type: string;
  }> = {};
  if (r.manufacturer && r.manufacturer.trim()) fields.maker = r.manufacturer.trim();
  if (r.vne_kt && r.vne_kt > 0) fields.vne = r.vne_kt;
  if (r.mtow_kg && r.mtow_kg > 0) fields.mtow = r.mtow_kg;
  // Override av grunddatan man fyllt i manuellt (AI = auktoritativ källa).
  if (r.cruise_speed_kts && r.cruise_speed_kts > 0) fields.cruise_speed_kts = r.cruise_speed_kts;
  if (r.endurance_h && r.endurance_h > 0) fields.endurance_h = r.endurance_h;
  if (r.category && r.category.trim()) fields.category = r.category.trim();
  if (r.engine_type && r.engine_type.trim()) fields.engine_type = r.engine_type.trim();
  if (r.crew_type && r.crew_type.trim()) {
    // Normalisera till samma sorterade format som serializeCrewType ('mp,sp').
    const ct = r.crew_type.split(',').map((s) => s.trim()).filter((s) => s === 'sp' || s === 'mp').sort().join(',');
    if (ct) fields.crew_type = ct;
  }
  if (r.consumption && r.consumption > 0) {
    fields.fuel_burn = r.consumption;
    if (r.consumption_unit && r.consumption_unit.trim()) fields.fuel_burn_unit = r.consumption_unit.trim().toLowerCase();
  }
  if (r.horsepower_hp && r.horsepower_hp > 0) fields.power_hp = r.horsepower_hp;
  if (r.ceiling_ft && r.ceiling_ft > 0) fields.ceiling_ft = r.ceiling_ft;
  if (r.wingspan_m && r.wingspan_m > 0) fields.wingspan_m = r.wingspan_m;
  if (r.empty_weight_kg && r.empty_weight_kg > 0) fields.empty_weight_kg = r.empty_weight_kg;
  if (r.fuel_capacity_l && r.fuel_capacity_l > 0) fields.fuel_capacity_l = r.fuel_capacity_l;
  if (r.range_nm && r.range_nm > 0) fields.range_nm = r.range_nm;
  if (r.image_url && r.image_url.trim()) fields.image_url = r.image_url.trim();
  if (Object.keys(fields).length) await updateAircraftFleetFields(type, fields);
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

// ── Currency: full-stop backfill (dry-run FÖRST, sedan flagg-skyddad skarp körning) ──
// Stopp-radsdetektor (spegling av add.tsx parseRouteStops, minimal & fristående).
const CURRENCY_STOP_LINE_RE = /^[A-Z]{2,4}\s+(TnG|LA|PU\/DO|PU|DO|HR)\b/i;

export interface StopDryRunRow { id: number; date: string; dep: string; arr: string; reason: string; remarks: string; }

// READ-ONLY: lista flygningar där full-stop-klassning är osäker, för stickprov innan backfill.
export async function dryRunStopParsing(): Promise<StopDryRunRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT id, date, dep_place, arr_place, remarks, flight_type, landings_day, landings_night
     FROM flights ORDER BY date DESC`
  );
  const out: StopDryRunRow[] = [];
  for (const f of rows) {
    const lines = String(f.remarks || '').split('\n').map((l: string) => l.trim()).filter(Boolean);
    const stopLines = lines.filter((l: string) => CURRENCY_STOP_LINE_RE.test(l));
    const ldgTotal = (parseInt(f.landings_day) || 0) + (parseInt(f.landings_night) || 0);
    const reasons: string[] = [];
    if (f.flight_type === 'touch_and_go') reasons.push('touch_and_go — full-stop per stopp okänd historiskt');
    if (stopLines.length > 0 && f.flight_type !== 'touch_and_go') reasons.push(`${stopLines.length} stopp i remarks men flight_type=${f.flight_type}`);
    if (stopLines.length > 0 && ldgTotal !== stopLines.length + 1) reasons.push(`stoppantal (${stopLines.length}+arr) ≠ landningar (${ldgTotal})`);
    if (reasons.length) out.push({ id: f.id, date: f.date, dep: f.dep_place, arr: f.arr_place, reason: reasons.join('; '), remarks: f.remarks });
  }
  console.warn(`[currency dry-run] ${out.length} flygning(ar) med osäker full-stop-klassning`,
    out.map((r) => `#${r.id} ${r.date} ${r.dep}->${r.arr} [${r.reason}]`));
  return out;
}

const FS_BACKFILL_KEY = 'currency_fs_backfill_v1';

// Skarp backfill (idempotent, körs en gång via flagg): icke-T&G → alla landningar är full stop.
// T&G lämnas 0 (konservativt; syns i dry-run för manuell redigering). FAA-natt lämnas 0 = okänt.
export async function backfillFullStopLandings(): Promise<{ updated: number; skipped: boolean }> {
  if ((await getSetting(FS_BACKFILL_KEY)) === '1') return { updated: 0, skipped: true };
  const db = await getDatabase();
  const res = await db.runAsync(
    `UPDATE flights
       SET landings_fs_day = landings_day, landings_fs_night = landings_night
     WHERE flight_type != 'touch_and_go'
       AND landings_fs_day = 0 AND landings_fs_night = 0
       AND (landings_day > 0 OR landings_night > 0)`
  );
  await setSetting(FS_BACKFILL_KEY, '1');
  return { updated: res.changes ?? 0, skipped: false };
}

// Sparade kabinpersonalsnamn (cabin crew) — lagras som JSON-lista i settings,
// senast använd först. Cabin crew lagras i remarks, så det finns ingen kolumn att
// härleda namnen från (till skillnad från second_pilot).
const SAVED_CREW_KEY = 'saved_cabin_crew';

export async function getSavedCrewNames(): Promise<string[]> {
  const raw = await getSetting(SAVED_CREW_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function addSavedCrewNames(names: string[]): Promise<void> {
  const fresh = names.map((n) => n.trim()).filter(Boolean);
  if (!fresh.length) return;
  const existing = await getSavedCrewNames();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...fresh, ...existing]) {
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  await setSetting(SAVED_CREW_KEY, JSON.stringify(out.slice(0, 50)));
}

export async function deleteSavedCrewName(name: string): Promise<void> {
  const existing = await getSavedCrewNames();
  await setSetting(SAVED_CREW_KEY, JSON.stringify(existing.filter((n) => n.toLowerCase() !== name.trim().toLowerCase())));
}

export async function getStressHours(): Promise<{ recent14: number; yearAvg14: number }> {
  const db = await getDatabase();
  const r14 = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 2) as h FROM flights WHERE date >= date('now', '-14 days')`
  );

  // Get hours per month for the last ~13 months (excluding last 14 days)
  const monthRows = await db.getAllAsync<{ m: string; h: number }>(
    `SELECT strftime('%m', date) as m, ROUND(SUM(total_time), 2) as h FROM flights
     WHERE date >= date('now', '-379 days') AND date < date('now', '-14 days')
     GROUP BY strftime('%m', date)`
  );

  if (monthRows.length === 0) {
    return { recent14: r14?.h ?? 0, yearAvg14: 0 };
  }

  // Calculate average monthly hours across all months with data
  const avgMonthly = monthRows.reduce((s, r) => s + r.h, 0) / monthRows.length;

  // Identify inactive months: 0 hours or <30% of the average
  const inactiveMonths = new Set(
    monthRows.filter(r => r.h < avgMonthly * 0.3).map(r => r.m)
  );
  for (let m = 1; m <= 12; m++) {
    const key = String(m).padStart(2, '0');
    if (!monthRows.find(r => r.m === key)) inactiveMonths.add(key);
  }

  // Identify inactive weekdays: count flights per weekday (0=Sun..6=Sat)
  // A weekday with <20% of the most active weekday is "normally off"
  const weekdayRows = await db.getAllAsync<{ wd: number; cnt: number }>(
    `SELECT CAST(strftime('%w', date) AS INTEGER) as wd, COUNT(*) as cnt FROM flights
     WHERE date >= date('now', '-379 days') AND date < date('now', '-14 days')
     GROUP BY strftime('%w', date)`
  );
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun–Sat
  for (const r of weekdayRows) weekdayCounts[r.wd] = r.cnt;
  const maxWeekday = Math.max(...weekdayCounts);
  const activeWeekdays = weekdayCounts.filter(c => c >= maxWeekday * 0.2).length;
  const activeDaysPerWeek = Math.max(activeWeekdays, 1);

  // Calculate baseline: total active hours / active days * 14
  const activeHours = monthRows.filter(r => !inactiveMonths.has(r.m)).reduce((s, r) => s + r.h, 0);
  const activeMonths = 12 - inactiveMonths.size;
  // Active days = active months * days/month * (active weekdays / 7)
  const activeDays = activeMonths * 30.4 * (activeDaysPerWeek / 7);
  const avg14 = activeDays > 0 ? Math.round((activeHours / activeDays * 14) * 100) / 100 : 0;

  return { recent14: r14?.h ?? 0, yearAvg14: avg14 };
}

export async function getDailyHours14(): Promise<{ date: string; hours: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ d: string; h: number }>(
    `SELECT date as d, ROUND(SUM(total_time), 2) as h FROM flights
     WHERE date >= date('now', '-13 days')
     GROUP BY date ORDER BY date ASC`
  );
  const result: { date: string; hours: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const row = rows.find(r => r.d === iso);
    result.push({ date: iso, hours: row?.h ?? 0 });
  }
  return result;
}

// Per-dag total flygtid mellan två datum (inkl.) — för 3D-månadsheatmapen.
// Matchar getDailyHours14:s semantik (ingen sim-filtrering). Caller noll-fyller dagar.
export async function getDailyHours(startISO: string, endISO: string): Promise<{ date: string; hours: number }[]> {
  const db = await getDatabase();
  return db.getAllAsync<{ date: string; hours: number }>(
    `SELECT date, ROUND(SUM(total_time), 2) as hours FROM flights
     WHERE date >= ? AND date <= ? AND flight_type != 'sim'
     GROUP BY date ORDER BY date ASC`,
    [startISO, endISO]
  );
}

// Flight-id:n för ett datum — för dag-popupens "öppna i loggboken".
export async function getFlightIdsForDate(date: string): Promise<number[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: number }>(
    `SELECT id FROM flights WHERE date = ? AND flight_type != 'sim' ORDER BY dep_utc`,
    [date]
  );
  return rows.map((r) => r.id);
}

export async function getFlightsForWeek(weekStart: string): Promise<Flight[]> {
  const db = await getDatabase();
  // Exkludera enbart simulatorpass och summary-aggregat (överförda totaler).
  // Hot refuel / flygningar som överstiger uthålligheten SKA räknas.
  return await db.getAllAsync<Flight>(
    `SELECT f.* FROM flights f
     WHERE f.date >= ? AND f.date < date(?, '+7 days')
       AND f.flight_type NOT IN ('sim', 'summary')
     ORDER BY f.date ASC, f.dep_utc ASC`,
    [weekStart, weekStart]
  );
}

// Topp-N veckor — speglar EXAKT best_week-frågan (samma filter: endast sim och
// summary-aggregat exkluderas) så att #1 alltid blir den lagrade "best week".
export async function getTopWeeks(limit = 5): Promise<{ hours: number; week_start: string; last_id: number }[]> {
  const db = await getDatabase();
  return await db.getAllAsync<{ hours: number; week_start: string; last_id: number }>(
    `SELECT
       ROUND(SUM(f.total_time), 1) as hours,
       date(f.date, 'weekday 1', '-7 days') as week_start,
       MAX(f.id) as last_id
     FROM flights f
     WHERE f.flight_type NOT IN ('sim', 'summary')
     GROUP BY week_start
     ORDER BY hours DESC
     LIMIT ?`,
    [limit]
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
     INNER JOIN icao_airports dep_ap ON dep_ap.icao = f.dep_place AND dep_ap.lat IS NOT NULL AND dep_ap.lon IS NOT NULL AND (dep_ap.temporary IS NULL OR dep_ap.temporary = 0)
     INNER JOIN icao_airports arr_ap ON arr_ap.icao = f.arr_place AND arr_ap.lat IS NOT NULL AND arr_ap.lon IS NOT NULL AND (arr_ap.temporary IS NULL OR arr_ap.temporary = 0)
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
