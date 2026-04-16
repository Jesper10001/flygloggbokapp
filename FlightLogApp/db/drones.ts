import { getDatabase } from './database';

// Fritt textfält i DB så vi klarar både civila (A1/A2/A3/Specific/Certified)
// och militära scheman (MRPAS/RPAS/NATO-C1-Mini etc.)
export type DroneCategory = string;
export type DroneType = 'multirotor' | 'fixedwing' | 'vtol' | 'helicopter' | '';

export interface DroneRegistryEntry {
  id: number;
  drone_type: DroneType;
  model: string;
  registration: string;
  mtow_g: number;
  category: DroneCategory;
  notes: string;
}

export interface DroneBattery {
  id: number;
  drone_id: number;
  label: string;
  serial: string;
  cycle_count: number;
}

export async function listDrones(): Promise<DroneRegistryEntry[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneRegistryEntry>(
    `SELECT * FROM drone_registry ORDER BY model, registration`
  );
}

export interface DroneUsage { drone_id: number; total_time: number; flight_count: number }

export async function getDroneUsage(): Promise<DroneUsage[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneUsage>(
    `SELECT drone_id,
            ROUND(SUM(total_time), 2) AS total_time,
            COUNT(*) AS flight_count
       FROM drone_flights
      WHERE drone_id IS NOT NULL
      GROUP BY drone_id`
  );
}

export async function getDrone(id: number): Promise<DroneRegistryEntry | null> {
  const db = await getDatabase();
  return db.getFirstAsync<DroneRegistryEntry>(
    `SELECT * FROM drone_registry WHERE id=?`,
    [id]
  );
}

export async function addDrone(
  data: Omit<DroneRegistryEntry, 'id'>,
  batteryCount = 2,
): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_registry (drone_type, model, registration, mtow_g, category, notes)
     VALUES (?,?,?,?,?,?)`,
    [data.drone_type, data.model, data.registration.toUpperCase(), data.mtow_g, data.category, data.notes]
  );
  const id = res.lastInsertRowId as number;
  for (let i = 1; i <= batteryCount; i++) {
    await db.runAsync(
      `INSERT INTO drone_batteries (drone_id, label, serial, cycle_count) VALUES (?,?,?,?)`,
      [id, `Battery #${i}`, '', 0]
    );
  }
  return id;
}

export async function updateDrone(id: number, data: Omit<DroneRegistryEntry, 'id'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_registry
     SET drone_type=?, model=?, registration=?, mtow_g=?, category=?, notes=?
     WHERE id=?`,
    [data.drone_type, data.model, data.registration.toUpperCase(), data.mtow_g, data.category, data.notes, id]
  );
}

// Tömmer bara kategori-fältet på alla drönare i registret så användaren måste
// klassa om dem till den nya pilot-typen. Drönarna själva, batterier,
// flygtid och historiska flight.category behålls orörda.
export async function getDroneFlightCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM drone_flights`);
  return row?.c ?? 0;
}

export async function clearDroneRegistryCategories(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE drone_registry SET category=''`);
}

export async function deleteDrone(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_registry WHERE id=?`, [id]);
}

export async function listBatteries(droneId: number): Promise<DroneBattery[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneBattery>(
    `SELECT * FROM drone_batteries WHERE drone_id=? ORDER BY id`,
    [droneId]
  );
}

export async function addBattery(droneId: number, label: string, serial = ''): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_batteries (drone_id, label, serial, cycle_count) VALUES (?,?,?,0)`,
    [droneId, label, serial]
  );
  return res.lastInsertRowId as number;
}

export async function updateBattery(id: number, label: string, serial: string, cycleCount: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_batteries SET label=?, serial=?, cycle_count=? WHERE id=?`,
    [label, serial, cycleCount, id]
  );
}

export async function incrementBatteryCycles(id: number, delta = 1): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_batteries SET cycle_count = cycle_count + ? WHERE id=?`,
    [delta, id]
  );
}

export async function deleteBattery(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_batteries WHERE id=?`, [id]);
}

// ─── BATTERI-ÖVERBLICK FÖR DASHBOARD ────────────────────────────────────────

export interface DroneBatteryStatus {
  drone_id: number;
  drone_model: string;
  drone_reg: string;
  batteries: (DroneBattery & { recent_flights: number })[];
}

/** Hämta batterier grupperade per drönare för drönare med ≥N flygningar senaste 90 dagarna */
export async function getBatteryOverview(minRecentFlights = 3): Promise<DroneBatteryStatus[]> {
  const db = await getDatabase();
  const drones = await db.getAllAsync<DroneRegistryEntry & { recent_flights: number }>(
    `SELECT dr.*, (
       SELECT COUNT(*) FROM drone_flights df
       WHERE df.drone_id = dr.id
       AND df.date >= date('now', '-90 days')
     ) as recent_flights
     FROM drone_registry dr
     ORDER BY dr.model, dr.registration`
  );
  const active = drones.filter((d) => d.recent_flights >= minRecentFlights);
  const out: DroneBatteryStatus[] = [];
  for (const d of active) {
    const bats = await db.getAllAsync<DroneBattery>(
      `SELECT * FROM drone_batteries WHERE drone_id=? ORDER BY id`, [d.id]
    );
    const withRecent = await Promise.all(bats.map(async (b) => {
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM drone_flights
         WHERE battery_id=? AND date >= date('now', '-90 days')`, [b.id]
      );
      return { ...b, recent_flights: row?.c ?? 0 };
    }));
    out.push({
      drone_id: d.id,
      drone_model: d.model || d.drone_type || '—',
      drone_reg: d.registration,
      batteries: withRecent,
    });
  }
  return out;
}

// ─── CERTIFIKAT ──────────────────────────────────────────────────────────────

export interface DroneCertificate {
  id: number;
  cert_type: string;
  label: string;
  issued_date: string;
  expires_date: string;
  notes: string;
}

export async function listCertificates(): Promise<DroneCertificate[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneCertificate>(
    `SELECT * FROM drone_certificates ORDER BY expires_date ASC`
  );
}

export async function addCertificate(data: Omit<DroneCertificate, 'id'>): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_certificates (cert_type, label, issued_date, expires_date, notes)
     VALUES (?,?,?,?,?)`,
    [data.cert_type, data.label, data.issued_date, data.expires_date, data.notes]
  );
  return res.lastInsertRowId as number;
}

export async function updateCertificate(id: number, data: Omit<DroneCertificate, 'id'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_certificates
     SET cert_type=?, label=?, issued_date=?, expires_date=?, notes=?
     WHERE id=?`,
    [data.cert_type, data.label, data.issued_date, data.expires_date, data.notes, id]
  );
}

export async function deleteCertificate(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_certificates WHERE id=?`, [id]);
}

export function certStatus(expiresDate: string): 'valid' | 'warning' | 'critical' | 'expired' | 'no_date' {
  if (!expiresDate) return 'no_date';
  const exp = new Date(expiresDate);
  const now = new Date();
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'expired';
  if (days < 30) return 'critical';
  if (days < 60) return 'warning';
  return 'valid';
}

export async function getExpiringCertificates(daysAhead = 60): Promise<DroneCertificate[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DroneCertificate>(
    `SELECT * FROM drone_certificates WHERE expires_date != '' ORDER BY expires_date ASC`
  );
  const now = new Date();
  return rows.filter((c) => {
    const exp = new Date(c.expires_date);
    const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days <= daysAhead;
  });
}

// ─── FLYGNINGAR ──────────────────────────────────────────────────────────────

export type DroneFlightMode = 'VLOS' | 'EVLOS' | 'BVLOS';

export interface DroneFlight {
  id: number;
  date: string;
  drone_id: number | null;
  drone_type: string;
  registration: string;
  location: string;
  lat: number;
  lon: number;
  mission_type: string;
  category: string;
  flight_mode: DroneFlightMode;
  total_time: number;
  max_altitude_m: number;
  is_night: number;
  has_observer: number;
  observer_name: string;
  battery_id: number | null;
  battery_start_cycles: number;
  remarks: string;
  created_at: string;
}

export interface DroneFlightFormData {
  date: string;
  drone_id: number | null;
  drone_type?: string;
  registration?: string;
  location: string;
  lat?: number;
  lon?: number;
  mission_type: string;
  category: string;
  flight_mode: DroneFlightMode;
  total_time: string;
  max_altitude_m: string;
  is_night: boolean;
  has_observer: boolean;
  observer_name: string;
  battery_id: number | null;
  battery_start_cycles: string;
  remarks: string;
}

export async function insertDroneFlight(data: DroneFlightFormData): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_flights (
      date, drone_id, drone_type, registration, location, lat, lon,
      mission_type, category, flight_mode, total_time, max_altitude_m,
      is_night, has_observer, observer_name, battery_id, battery_start_cycles, remarks
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.date,
      data.drone_id,
      data.drone_type ?? '',
      (data.registration ?? '').toUpperCase(),
      data.location,
      data.lat ?? 0,
      data.lon ?? 0,
      data.mission_type,
      data.category,
      data.flight_mode,
      parseFloat(data.total_time) || 0,
      parseInt(data.max_altitude_m, 10) || 0,
      data.is_night ? 1 : 0,
      data.has_observer ? 1 : 0,
      data.observer_name,
      data.battery_id,
      parseInt(data.battery_start_cycles, 10) || 0,
      data.remarks,
    ]
  );
  if (data.battery_id) {
    await db.runAsync(`UPDATE drone_batteries SET cycle_count = cycle_count + 1 WHERE id=?`, [data.battery_id]);
  }
  return res.lastInsertRowId as number;
}

export async function getDroneFlights(limit = 200): Promise<DroneFlight[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneFlight>(
    `SELECT * FROM drone_flights ORDER BY date DESC, id DESC LIMIT ?`,
    [limit]
  );
}

export async function getDroneFlightById(id: number): Promise<DroneFlight | null> {
  const db = await getDatabase();
  return db.getFirstAsync<DroneFlight>('SELECT * FROM drone_flights WHERE id=?', [id]);
}

export async function updateDroneFlight(id: number, data: DroneFlightFormData): Promise<void> {
  const db = await getDatabase();
  // Hämta originalet för att justera batteri-cykel-räkning om batteri-kopplingen ändrats
  const prev = await getDroneFlightById(id);
  await db.runAsync(
    `UPDATE drone_flights SET
      date=?, drone_id=?, drone_type=?, registration=?, location=?, lat=?, lon=?,
      mission_type=?, category=?, flight_mode=?, total_time=?, max_altitude_m=?,
      is_night=?, has_observer=?, observer_name=?, battery_id=?, battery_start_cycles=?, remarks=?
     WHERE id=?`,
    [
      data.date,
      data.drone_id,
      data.drone_type ?? '',
      (data.registration ?? '').toUpperCase(),
      data.location,
      data.lat ?? 0,
      data.lon ?? 0,
      data.mission_type,
      data.category,
      data.flight_mode,
      parseFloat(data.total_time) || 0,
      parseInt(data.max_altitude_m, 10) || 0,
      data.is_night ? 1 : 0,
      data.has_observer ? 1 : 0,
      data.observer_name,
      data.battery_id,
      parseInt(data.battery_start_cycles, 10) || 0,
      data.remarks,
      id,
    ]
  );
  // Om batteriet ändrats: sänk räknaren på förra, höj på nya. Om samma batteri → inget.
  if (prev && prev.battery_id !== data.battery_id) {
    if (prev.battery_id) {
      await db.runAsync(
        `UPDATE drone_batteries SET cycle_count = MAX(0, cycle_count - 1) WHERE id=?`,
        [prev.battery_id]
      );
    }
    if (data.battery_id) {
      await db.runAsync(`UPDATE drone_batteries SET cycle_count = cycle_count + 1 WHERE id=?`, [data.battery_id]);
    }
  }
}

export async function deleteDroneFlight(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM drone_flights WHERE id=?', [id]);
}

export interface DroneStats {
  total_flights: number;
  total_time: number;
  year_to_date: number;
  vlos: number;
  evlos: number;
  bvlos: number;
  night: number;
  cat_a1: number;
  cat_a2: number;
  cat_a3: number;
  cat_specific: number;
  cat_certified: number;
}

export async function getDroneStats(): Promise<DroneStats> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(`
    SELECT
      COUNT(*) as total_flights,
      ROUND(SUM(total_time), 2) as total_time,
      ROUND(SUM(CASE WHEN strftime('%Y', date) = strftime('%Y', 'now') THEN total_time ELSE 0 END), 2) as year_to_date,
      ROUND(SUM(CASE WHEN flight_mode='VLOS' THEN total_time ELSE 0 END), 2) as vlos,
      ROUND(SUM(CASE WHEN flight_mode='EVLOS' THEN total_time ELSE 0 END), 2) as evlos,
      ROUND(SUM(CASE WHEN flight_mode='BVLOS' THEN total_time ELSE 0 END), 2) as bvlos,
      ROUND(SUM(CASE WHEN is_night=1 THEN total_time ELSE 0 END), 2) as night,
      ROUND(SUM(CASE WHEN category='A1' THEN total_time ELSE 0 END), 2) as cat_a1,
      ROUND(SUM(CASE WHEN category='A2' THEN total_time ELSE 0 END), 2) as cat_a2,
      ROUND(SUM(CASE WHEN category='A3' THEN total_time ELSE 0 END), 2) as cat_a3,
      ROUND(SUM(CASE WHEN category='Specific' THEN total_time ELSE 0 END), 2) as cat_specific,
      ROUND(SUM(CASE WHEN category='Certified' THEN total_time ELSE 0 END), 2) as cat_certified
    FROM drone_flights
  `);
  return {
    total_flights: row?.total_flights ?? 0,
    total_time: row?.total_time ?? 0,
    year_to_date: row?.year_to_date ?? 0,
    vlos: row?.vlos ?? 0,
    evlos: row?.evlos ?? 0,
    bvlos: row?.bvlos ?? 0,
    night: row?.night ?? 0,
    cat_a1: row?.cat_a1 ?? 0,
    cat_a2: row?.cat_a2 ?? 0,
    cat_a3: row?.cat_a3 ?? 0,
    cat_specific: row?.cat_specific ?? 0,
    cat_certified: row?.cat_certified ?? 0,
  };
}

